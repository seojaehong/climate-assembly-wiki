/**
 * /hq 전체를 감싸는 본부 비밀번호 게이트.
 *
 * ⚠️ 보안 한계 — 이 게이트는 **프론트 진입 차단**일 뿐 데이터 레벨 보호가 아니다.
 * HqGrid가 읽는 hq_teams·라운드·표 집계 등 read RPC는 기존 설계대로 여전히
 * anon 키로 접근 가능하다. 즉 URL·API를 아는 사람의 데이터 접근을 막지 못하며,
 * 링크 공유·오타 진입 같은 **우연한 접근 방지**가 목적이다. 데이터 자체를
 * 잠그려면 read RPC 권한 재설계가 필요하다(이 컴포넌트 범위 밖).
 *
 * 토큰은 HqAttendanceAdmin과 동일한 sessionStorage 키(HQ_TOKEN_KEY)를 공유한다 —
 * 게이트에서 한 번 로그인하면 안쪽 출석 관리도 이미 잠금 해제 상태가 된다(이중 로그인 방지).
 * 인증은 기존 attendance_hq_unlock RPC(crypt 비교 + 5회/15분 rate limit)를 그대로 쓴다.
 */
import { useState } from 'react';
import { unlockHqAttendance } from '../../lib/attendance';
import HqGrid from './HqGrid';
import HqSubmissionBoard from './HqSubmissionBoard';
import {
  HQ_ACTOR_KEY,
  HQ_TOKEN_KEY,
  gateFailureMessage,
  isValidHqToken,
  normalizeActorLabel,
} from './hq-gate-logic';

function storedToken(): string | null {
  if (typeof sessionStorage === 'undefined') return null;
  const saved = sessionStorage.getItem(HQ_TOKEN_KEY);
  return isValidHqToken(saved) ? saved : null;
}

function storedActor(): string {
  if (typeof sessionStorage === 'undefined') return '';
  return sessionStorage.getItem(HQ_ACTOR_KEY) ?? '';
}

export default function HqGate() {
  // client:only 아일랜드라 SSR이 없어 초기 렌더에서 바로 sessionStorage를 읽는다
  // (useEffect 복원 방식은 로그인 카드가 한 프레임 번쩍이는 문제가 있다).
  const [token, setToken] = useState<string | null>(storedToken);
  const [actor, setActor] = useState<string>(storedActor);
  const [actorInput, setActorInput] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  // 본부 화면 전환 — 8.29의 본 과업이 조별 산출물이므로 그것을 기본으로 연다.
  // (투표·출석 그리드는 여전히 필요하지만 그날의 중심은 아니다.)
  const [view, setView] = useState<'submissions' | 'grid'>('submissions');

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
      const nextToken = await unlockHqAttendance(password, label);
      setPassword('');
      if (!isValidHqToken(nextToken)) {
        setMessage(gateFailureMessage('wrong-password'));
        return;
      }
      sessionStorage.setItem(HQ_TOKEN_KEY, nextToken);
      sessionStorage.setItem(HQ_ACTOR_KEY, label);
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

  const logout = () => {
    sessionStorage.removeItem(HQ_TOKEN_KEY);
    sessionStorage.removeItem(HQ_ACTOR_KEY);
    setToken(null);
    setActor('');
    setActorInput('');
    setPassword('');
    setMessage(null);
  };

  if (!token) {
    return (
      <main className="grid min-h-screen place-items-center bg-[#F5F8FB] p-4">
        <section
          className="w-full max-w-xl rounded-2xl border border-[#C4D8E4] bg-white p-6 shadow-sm sm:p-8"
          aria-labelledby="hq-gate-title"
        >
          <h1 id="hq-gate-title" className="text-[26px] font-extrabold text-[#1F2933]">
            기후시민회의 운영 현황 · 본부
          </h1>
          <p className="mt-2 text-[15px] leading-relaxed text-[#5A6B73]">
            본부 운영 화면입니다. 운영자 이름과 본부 공유 비밀번호를 입력하면 열립니다.
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
              본부 공유 비밀번호
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
        </section>
      </main>
    );
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-3 bg-[#1F4E79] px-4 py-2 text-white">
        <div role="tablist" aria-label="본부 화면" className="flex gap-1">
          {([
            ['submissions', '조별 산출물'],
            ['grid', '투표·출석 현황'],
          ] as const).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={view === id}
              onClick={() => setView(id)}
              className={`min-h-9 rounded-lg px-4 text-[14px] font-bold transition ${
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
          type="button"
          onClick={logout}
          className="min-h-9 rounded-lg border border-white/60 px-3 text-[13px] font-bold"
        >
          로그아웃
        </button>
      </div>
      {view === 'submissions' ? <HqSubmissionBoard token={token} /> : <HqGrid />}
    </>
  );
}
