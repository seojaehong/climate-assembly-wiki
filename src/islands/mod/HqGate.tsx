/**
 * /hq 전체를 감싸는 본부 비밀번호 게이트.
 *
 * 프론트 게이트와 DB 권한을 함께 적용한다. 로스터·라운드·집계·제출물은
 * 이 게이트가 발급받은 HQ 토큰의 org/session에 묶인 v2 RPC로만 조회·변경한다.
 * P2a 활성화 후에는 구 unscoped RPC의 anon/authenticated EXECUTE를 회수하며,
 * 비밀번호 카드를 숨기는 것만으로 보안 경계를 대신하지 않는다.
 *
 * 게이트가 발급받은 토큰을 안쪽 출석 관리에도 prop으로 직접 전달한다. 저장소가 차단된
 * 브라우저에서도 이중 로그인이나 구형 공유 비밀번호 fallback이 생기지 않는다.
 * 인증은 운영자별 attendance_hq_unlock_named RPC의 crypt 비교와 rate limit을 쓴다.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { unlockHqNamed, changeHqPassword, revokeHqSession } from '../../lib/attendance';
import HqGrid from './HqGrid';
import HqSubmissionBoard from './HqSubmissionBoard';
import WorkshopHqStatus from './WorkshopHqStatus';
import { createSafeBrowserStorage } from '../../lib/safe-browser-storage';
import {
  HQ_ACTOR_KEY,
  HQ_NEW_PASSWORD_MAX_BYTES,
  HQ_TOKEN_KEY,
  classifyHqAuthorizationError,
  gateFailureMessage,
  isValidHqToken,
  normalizeActorLabel,
  utf8ByteLength,
  validateHqNewPassword,
} from './hq-gate-logic';

const hqSessionStorage = createSafeBrowserStorage('sessionStorage');

function storedToken(): string | null {
  const saved = hqSessionStorage.getItem(HQ_TOKEN_KEY);
  return isValidHqToken(saved) ? saved : null;
}

function storedActor(): string {
  return hqSessionStorage.getItem(HQ_ACTOR_KEY) ?? '';
}

export default function HqGate() {
  // client:only 아일랜드라 SSR이 없어 초기 렌더에서 바로 sessionStorage를 읽는다
  // (useEffect 복원 방식은 로그인 카드가 한 프레임 번쩍이는 문제가 있다).
  const [token, setToken] = useState<string | null>(storedToken);
  const [actor, setActor] = useState<string>(storedActor);
  const [actorInput, setActorInput] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [logoutBusy, setLogoutBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [nonPersistentMode, setNonPersistentMode] = useState(
    () => !hqSessionStorage.isPersistent(),
  );
  // 비밀번호 변경 — 임시 비밀번호를 5인이 함께 쓰는 동안은 「이름이 증명된다」가 성립하지 않는다.
  const [pwOpen, setPwOpen] = useState(false);
  const [pwCurrent, setPwCurrent] = useState('');
  const [pwNext, setPwNext] = useState('');
  const [pwConfirm, setPwConfirm] = useState('');
  const [pwBusy, setPwBusy] = useState(false);
  const [pwMessage, setPwMessage] = useState<string | null>(null);
  const [pwDone, setPwDone] = useState(false);
  const passwordDialogRef = useRef<HTMLFormElement>(null);
  const passwordTriggerRef = useRef<HTMLButtonElement>(null);
  const currentPasswordRef = useRef<HTMLInputElement>(null);
  // 본부 화면 전환 — 8.29의 본 과업이 조별 산출물이므로 그것을 기본으로 연다.
  // (투표·출석 그리드는 여전히 필요하지만 그날의 중심은 아니다.)
  const [view, setView] = useState<'submissions' | 'grid'>('submissions');

  const clearLocalSession = useCallback((nextMessage: string | null) => {
    hqSessionStorage.removeItem(HQ_TOKEN_KEY);
    hqSessionStorage.removeItem(HQ_ACTOR_KEY);
    setNonPersistentMode(!hqSessionStorage.isPersistent());
    setToken(null);
    setActor('');
    setActorInput('');
    setPassword('');
    setPwOpen(false);
    setPwCurrent('');
    setPwNext('');
    setPwConfirm('');
    setPwDone(false);
    setMessage(nextMessage);
  }, []);

  const handleAuthorizationExpired = useCallback(() => {
    clearLocalSession('로그인이 만료되었거나 다른 기기에서 폐기되었습니다. 다시 로그인해 주세요.');
  }, [clearLocalSession]);

  useEffect(() => {
    if (!pwOpen) return;

    const dialog = passwordDialogRef.current;
    window.requestAnimationFrame(() => currentPasswordRef.current?.focus());

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setPwOpen(false);
        return;
      }
      if (event.key !== 'Tab' || !dialog) return;

      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      passwordTriggerRef.current?.focus();
    };
  }, [pwOpen]);

  const unlock = async (event: React.SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const label = normalizeActorLabel(actorInput);
    if (!label || !password) {
      setMessage(gateFailureMessage('missing-input'));
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      // 개인 비밀번호만 허용한다. 공유 비밀번호에 호출자 입력 이름을 붙이는 구형
      // fallback은 감사 로그의 행위자를 증명하지 못하므로 activation 대상이 아니다.
      const nextToken = await unlockHqNamed(label, password);
      setPassword('');
      if (!isValidHqToken(nextToken)) {
        setMessage(gateFailureMessage('wrong-password'));
        return;
      }
      hqSessionStorage.setItem(HQ_TOKEN_KEY, nextToken);
      hqSessionStorage.setItem(HQ_ACTOR_KEY, label);
      setNonPersistentMode(!hqSessionStorage.isPersistent());
      setToken(nextToken);
      setActor(label);
    } catch (error) {
      console.error('[HQ gate] unlock failed', error);
      setPassword('');
      setMessage(gateFailureMessage('request-failed'));
    } finally {
      setBusy(false);
    }
  };

  const submitPasswordChange = async (event: React.SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!token) return;
    const validationMessage = validateHqNewPassword(pwNext, pwConfirm);
    if (validationMessage) {
      setPwMessage(validationMessage);
      return;
    }
    setPwBusy(true);
    setPwMessage(null);
    try {
      await changeHqPassword(token, pwCurrent, pwNext);
      // Password rotation revokes every server-side bearer for this operator,
      // including the current browser. Never leave a locally cached dead token.
      clearLocalSession('비밀번호가 바뀌어 모든 기기에서 로그아웃되었습니다. 새 비밀번호로 다시 로그인해 주세요.');
    } catch (error) {
      if (classifyHqAuthorizationError(error) === 'expired') {
        handleAuthorizationExpired();
        return;
      }
      // 서버가 한국어로 사유를 돌려준다(현재 비밀번호 불일치·8자 미만·잠금 등).
      setPwMessage(error instanceof Error ? error.message : '비밀번호를 바꾸지 못했습니다.');
    } finally {
      setPwBusy(false);
    }
  };

  const logout = async () => {
    if (!token || logoutBusy) return;
    setLogoutBusy(true);
    setMessage(null);
    try {
      await revokeHqSession(token);
      clearLocalSession('서버에서도 안전하게 로그아웃했습니다.');
    } catch (error) {
      console.error('[HQ gate] server logout failed', error);
      if (classifyHqAuthorizationError(error) === 'expired') {
        // The server has already proved this bearer cannot be revoked again.
        // Removing only the local copy is safe and restores the login route.
        handleAuthorizationExpired();
        return;
      }
      setMessage('서버 로그아웃을 완료하지 못했습니다. 연결을 확인하고 다시 눌러 주세요.');
    } finally {
      setLogoutBusy(false);
    }
  };

  if (!token) {
    return (
      <main id="hq-console-content" tabIndex={-1} className="grid min-h-screen place-items-center bg-[#F5F8FB] p-4">
        <section
          className="w-full max-w-xl rounded-2xl border border-[#C4D8E4] bg-white p-6 shadow-sm sm:p-8"
          aria-labelledby="hq-gate-title"
        >
          <h1 id="hq-gate-title" className="text-[26px] font-extrabold text-[#1F2933]">
            기후시민회의 운영 현황 · 본부
          </h1>
          <p className="mt-2 text-[15px] leading-relaxed text-[#5A6B73]">
            본부 운영 화면입니다. 등록된 운영자 이름과 개인 비밀번호를 입력해 주세요.
          </p>
          <form onSubmit={unlock} className="mt-5 grid gap-4">
            <label className="text-[14px] font-bold text-[#334E5C]">
              운영자 표시 이름
              <input
                value={actorInput}
                onChange={(event) => setActorInput(event.target.value)}
                autoComplete="name"
                autoFocus
                className="mt-1 min-h-12 w-full rounded-xl border border-[#C4D8E4] px-3 text-[16px]"
              />
            </label>
            <label className="text-[14px] font-bold text-[#334E5C]">
              개인 비밀번호
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                className="mt-1 min-h-12 w-full rounded-xl border border-[#C4D8E4] px-3 text-[16px]"
              />
            </label>
            <button
              type="submit"
              disabled={busy}
              className="min-h-12 rounded-xl bg-[#1F4E79] px-5 text-[16px] font-extrabold text-white disabled:opacity-50"
            >
              {busy ? '확인 중…' : '본부 로그인'}
            </button>
          </form>
          {message ? (
            <p role="alert" className="mt-4 rounded-lg bg-[#FFF4D6] px-3 py-2 text-[14px] font-bold text-[#6B4B00]">
              {message}
            </p>
          ) : null}
          {nonPersistentMode ? (
            <p role="alert" className="mt-4 rounded-lg border-2 border-[#B5651D] bg-[#FFF4D6] px-3 py-2 text-[14px] font-bold text-[#6B4B00]">
              브라우저 저장소가 차단되어 로그인 정보가 이 페이지 메모리에만 유지됩니다. 새로고침하면 다시 로그인해야 합니다.
            </p>
          ) : null}
        </section>
      </main>
    );
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-3 bg-[#1F4E79] px-4 py-2 text-white">
        <div
          role="tablist"
          aria-label="본부 화면"
          className="flex gap-1"
          onKeyDown={(event) => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
            const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
            const current = tabs.indexOf(document.activeElement as HTMLButtonElement);
            if (current < 0 || tabs.length === 0) return;
            event.preventDefault();
            const target = event.key === 'Home'
              ? 0
              : event.key === 'End'
                ? tabs.length - 1
                : (current + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
            tabs[target].focus();
            tabs[target].click();
          }}
        >
          {([
            ['submissions', '조별 산출물'],
            ['grid', '투표·출석 현황'],
          ] as const).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              id={`hq-tab-${id}`}
              aria-controls="hq-console-content"
              aria-selected={view === id}
              tabIndex={view === id ? 0 : -1}
              onClick={() => setView(id)}
              className={`min-h-11 rounded-lg px-4 text-[14px] font-bold transition focus-visible:outline focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-[#F4C542] ${
                view === id ? 'bg-white text-[#1F4E79]' : 'border border-white/40 text-white/85'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <span className="ml-auto text-[14px] font-bold">
          본부 로그인됨{actor ? ` · ${actor}` : ''}
        </span>
        <button
          ref={passwordTriggerRef}
          type="button"
          onClick={() => {
            setPwMessage(null);
            setPwDone(false);
            setPwOpen(true);
          }}
          className="min-h-11 rounded-lg border border-white/60 px-3 text-[13px] font-bold focus-visible:outline focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-[#F4C542]"
        >
          비밀번호 변경
        </button>
        <button
          type="button"
          onClick={logout}
          disabled={logoutBusy}
          aria-busy={logoutBusy}
          className="min-h-11 rounded-lg border border-white/60 px-3 text-[13px] font-bold focus-visible:outline focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-[#F4C542]"
        >
          {logoutBusy ? '로그아웃 중…' : '로그아웃'}
        </button>
      </div>
      {message ? (
        <p role="alert" className="border-b-2 border-[#B5651D] bg-[#FFF4D6] px-4 py-3 text-center text-[14px] font-extrabold text-[#6B4B00]">
          {message}
        </p>
      ) : null}
      {nonPersistentMode ? (
        <p role="alert" className="border-b-2 border-[#B5651D] bg-[#FFF4D6] px-4 py-3 text-center text-[14px] font-extrabold text-[#6B4B00]">
          브라우저 저장소가 차단되어 로그인 정보가 이 페이지 메모리에만 유지됩니다. 새로고침하면 다시 로그인해야 합니다.
        </p>
      ) : null}

      {pwOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#1F4E79]/55 p-5">
          <form
            ref={passwordDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="hq-password-dialog-title"
            aria-describedby="hq-password-dialog-description"
            tabIndex={-1}
            onSubmit={submitPasswordChange}
            className="w-full max-w-md rounded-2xl border border-[#DCE7EE] bg-white p-6"
          >
            <h4 id="hq-password-dialog-title" className="text-[21px] font-extrabold text-[#1F4E79]">
              비밀번호 변경{actor ? ` · ${actor}` : ''}
            </h4>
            <p id="hq-password-dialog-description" className="mt-2 text-[15px] leading-[1.6] text-[#5A6B73]">
              지금 비밀번호를 한 번 더 확인합니다. 자리를 비운 사이 남이 바꾸지 못하게 하려는 것입니다.
            </p>
            <label className="mt-4 block text-[15px] font-bold text-[#1F2933]">
              현재 비밀번호
              <input
                ref={currentPasswordRef}
                type="password"
                autoComplete="current-password"
                value={pwCurrent}
                onChange={(e) => setPwCurrent(e.target.value)}
                className="mt-1 h-12 w-full rounded-xl border border-[#C4D8E4] px-3 text-[16px] font-normal"
              />
            </label>
            <label className="mt-3 block text-[15px] font-bold text-[#1F2933]">
              새 비밀번호 (8자 이상)
              <input
                type="password"
                autoComplete="new-password"
                value={pwNext}
                onChange={(e) => setPwNext(e.target.value)}
                maxLength={HQ_NEW_PASSWORD_MAX_BYTES}
                aria-describedby="hq-new-password-guidance"
                className="mt-1 h-12 w-full rounded-xl border border-[#C4D8E4] px-3 text-[16px] font-normal"
              />
            </label>
            <p id="hq-new-password-guidance" className="mt-1 text-[13px] leading-[1.5] text-[#5A6B73]">
              UTF-8 기준 {utf8ByteLength(pwNext)}/{HQ_NEW_PASSWORD_MAX_BYTES}바이트… 한글·이모지는 한 글자가 여러 바이트입니다.
            </p>
            <label className="mt-3 block text-[15px] font-bold text-[#1F2933]">
              새 비밀번호 확인
              <input
                type="password"
                autoComplete="new-password"
                value={pwConfirm}
                onChange={(e) => setPwConfirm(e.target.value)}
                maxLength={HQ_NEW_PASSWORD_MAX_BYTES}
                aria-describedby="hq-new-password-guidance"
                className="mt-1 h-12 w-full rounded-xl border border-[#C4D8E4] px-3 text-[16px] font-normal"
              />
            </label>
            {pwMessage ? (
              <p
                role="alert"
                className={`mt-4 rounded-lg px-3 py-2 text-[14px] font-bold ${
                  pwDone ? 'bg-[#E8F5E9] text-[#2F6322]' : 'bg-[#FFF4D6] text-[#6B4B00]'
                }`}
              >
                {pwMessage}
              </p>
            ) : null}
            <div className="mt-5 grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setPwOpen(false)}
                className="h-12 rounded-xl border border-[#C4D8E4] bg-white text-[17px] font-bold text-[#1F4E79]"
              >
                닫기
              </button>
              <button
                type="submit"
                disabled={pwBusy || !pwCurrent || !pwNext || !pwConfirm}
                className="h-12 rounded-xl bg-[#1F4E79] text-[17px] font-bold text-white disabled:opacity-40"
              >
                {pwBusy ? '바꾸는 중…' : '바꾸기'}
              </button>
            </div>
          </form>
        </div>
      ) : null}
      <main
        id="hq-console-content"
        role="tabpanel"
        aria-labelledby={`hq-tab-${view}`}
        tabIndex={-1}
      >
        {view === 'submissions' ? (
          <>
            <WorkshopHqStatus token={token} onAuthorizationExpired={handleAuthorizationExpired} />
            <HqSubmissionBoard token={token} onAuthorizationExpired={handleAuthorizationExpired} />
          </>
        ) : <HqGrid token={token} onAuthorizationExpired={handleAuthorizationExpired} />}
      </main>
    </>
  );
}
