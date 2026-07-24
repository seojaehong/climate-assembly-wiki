import { useEffect, useReducer, useRef, useState } from 'react';
import QRCode from 'qrcode';
import {
  isValidJoinCode,
  tallyVotes,
  joinTeam,
  createPoll,
  setPollStatus,
  fetchVotes,
  fetchActiveRound,
  subscribeRound,
  proxyVote,
  type Round,
  type Vote,
} from '../../lib/mod-console';
import { modReducer, initialModState } from './mod-state';
import Timer from './Timer';

const CODE_KEY = 'mod_code';
const OPTION_COLORS = ['#23B2C3', '#2E75B6', '#4F9D3A', '#F5A623', '#135C73', '#1F4E79'];

// ============================================================
// 작은 UI 조각 — 목업 확정 톤(하얀 바탕, 헤어라인, 트래킹, mono eyebrow)
// ============================================================

function Eyebrow({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={`font-mono text-[12px] font-semibold uppercase ${className}`}
      style={{ letterSpacing: '.14em' }}
    >
      {children}
    </div>
  );
}

function Logo() {
  return (
    <div className="w-12 h-12 rounded-2xl bg-[#23B2C3] grid place-items-center text-white font-extrabold text-2xl shrink-0">
      M
    </div>
  );
}

// ============================================================
// State 01 — 입장
// ============================================================

function JoinScreen({
  onJoin,
  error,
  busy,
}: {
  onJoin: (code: string) => void;
  error: string | null;
  busy: boolean;
}) {
  const [digits, setDigits] = useState<string>('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const submit = () => {
    if (isValidJoinCode(digits)) onJoin(digits);
  };

  const cells = Array.from({ length: 6 }, (_, i) => digits[i] ?? '');

  return (
    <div className="min-h-screen bg-[#F5F8FB] flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md bg-white rounded-3xl border border-[#DCE7EE] overflow-hidden shadow-[0_1px_2px_rgba(31,78,121,.04),0_8px_24px_-16px_rgba(31,78,121,.18)]">
        <div className="px-7 pt-12 pb-10 flex flex-col items-center text-center">
          <div className="mb-6">
            <Logo />
          </div>
          <Eyebrow className="text-[#23B2C3] mb-2">기후시민회의</Eyebrow>
          <h1
            className="text-[30px] font-extrabold text-[#1F4E79] leading-snug mb-2"
            style={{ letterSpacing: '-.022em' }}
          >
            조 접속코드를 입력하세요
          </h1>
          <p className="text-[#5A6B73] text-[16px] mb-9">
            운영진이 배부한 <b className="text-[#1F2933]">6자리 숫자</b>를 입력합니다.
          </p>

          <div
            className="flex justify-center gap-2 sm:gap-3 mb-3"
            role="group"
            aria-label="접속코드 6자리"
          >
            {cells.map((d, i) => (
              <div
                key={i}
                className={`w-[72px] h-[96px] sm:w-[88px] sm:h-[120px] rounded-2xl border grid place-items-center text-[44px] font-extrabold tr-num ${
                  error
                    ? 'border-2 border-[#DC2626] bg-[#FEF2F2] text-[#DC2626]'
                    : d
                      ? 'border-[#C4D8E4] bg-[#F1F7FA] text-[#1F4E79]'
                      : 'border-[#DCE7EE] bg-white text-[#1F4E79]'
                }`}
                style={{ fontVariantNumeric: 'tabular-nums' }}
              >
                {d}
              </div>
            ))}
          </div>

          <input
            ref={inputRef}
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={6}
            value={digits}
            aria-label="조 접속코드 6자리 입력"
            className="sr-only"
            onChange={(e) => {
              const v = e.target.value.replace(/\D/g, '').slice(0, 6);
              setDigits(v);
              if (v.length === 6 && isValidJoinCode(v)) onJoin(v);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit();
            }}
          />

          {error ? (
            <div className="flex items-center gap-2 text-[#B91C1C] text-[16px] font-semibold mb-8 bg-[#FEF2F2] border border-[#DC2626]/30 rounded-xl px-4 py-2.5">
              <span aria-hidden="true">⛔</span>
              <span>{error}</span>
            </div>
          ) : (
            <Eyebrow className="text-[#5A6B73] mb-9">Numeric keypad</Eyebrow>
          )}

          <button
            type="button"
            onClick={submit}
            disabled={!isValidJoinCode(digits) || busy}
            className="w-full h-16 rounded-2xl bg-[#23B2C3] text-white text-[22px] font-bold shadow-sm active:scale-[.99] transition disabled:opacity-40"
          >
            {busy ? '입장 중…' : error ? '다시 입장' : '입장'}
          </button>
          <p className="text-[14px] text-[#5A6B73] mt-5">코드를 모르면 운영 데스크에 문의하세요.</p>
          <a
            href="/mod-help"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[13px] text-[#23B2C3] font-semibold underline underline-offset-2 mt-2"
          >
            도움말
          </a>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// State 02 — 홈 (투표 만들기)  * 타이머 카드는 Task 5 placeholder
// ============================================================

function HomeScreen({
  teamName,
  code,
  onCreatePoll,
  creating,
}: {
  teamName: string;
  code: string | null;
  onCreatePoll: (input: { title: string; type: 'RADIO' | 'CHECKBOX'; options: string[] }) => void;
  creating: boolean;
}) {
  const [title, setTitle] = useState('');
  const [type, setType] = useState<'RADIO' | 'CHECKBOX'>('RADIO');
  const [options, setOptions] = useState<string[]>(['', '']);

  const setOption = (i: number, v: string) =>
    setOptions((prev) => prev.map((o, idx) => (idx === i ? v : o)));
  const addOption = () => setOptions((prev) => (prev.length < 6 ? [...prev, ''] : prev));
  const removeOption = (i: number) =>
    setOptions((prev) => (prev.length > 2 ? prev.filter((_, idx) => idx !== i) : prev));

  const trimmed = options.map((o) => o.trim()).filter(Boolean);
  const canOpen = title.trim().length > 0 && trimmed.length >= 2;

  return (
    <div className="min-h-screen bg-[#F5F8FB]">
      <TopBar right={<TeamBadge name={teamName} live />} />

      <div className="max-w-5xl mx-auto p-6 sm:p-8">
        <h2 className="text-[24px] font-extrabold text-[#1F4E79] mb-1" style={{ letterSpacing: '-.01em' }}>
          무엇을 하시겠어요?
        </h2>
        <p className="text-[#5A6B73] text-[16px] mb-8">아래에서 하나를 선택하세요.</p>

        <div className="grid lg:grid-cols-2 gap-6">
          {/* 투표 만들기 카드 */}
          <section className="rounded-2xl border border-[#DCE7EE] bg-white overflow-hidden shadow-sm">
            <div className="flex items-center gap-3 px-6 py-4 bg-[#23B2C3]/8 border-b border-[#DCE7EE]">
              <span className="w-11 h-11 rounded-xl bg-[#23B2C3] grid place-items-center text-white text-2xl" aria-hidden="true">
                🗳️
              </span>
              <h3 className="text-[22px] font-extrabold text-[#1F4E79]" style={{ letterSpacing: '-.01em' }}>
                투표 만들기
              </h3>
            </div>
            <div className="p-6 space-y-5">
              <div>
                <label className="block text-[#5A6B73] font-mono text-[12px] font-semibold uppercase mb-2" style={{ letterSpacing: '.14em' }}>
                  질문
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="예: 우리 조가 가장 중요하게 볼 의제는?"
                  className="w-full h-14 rounded-xl border border-[#C4D8E4] focus:border-[#23B2C3] px-4 text-[18px] text-[#1F2933] outline-none"
                />
              </div>

              <div>
                <label className="block text-[#5A6B73] font-mono text-[12px] font-semibold uppercase mb-2" style={{ letterSpacing: '.14em' }}>
                  유형
                </label>
                <div className="inline-flex rounded-xl border border-[#C4D8E4] overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setType('RADIO')}
                    className={`px-6 h-12 text-[17px] font-bold ${type === 'RADIO' ? 'bg-[#23B2C3] text-white' : 'bg-white text-[#5A6B73]'}`}
                  >
                    단일선택
                  </button>
                  <button
                    type="button"
                    onClick={() => setType('CHECKBOX')}
                    className={`px-6 h-12 text-[17px] font-semibold ${type === 'CHECKBOX' ? 'bg-[#23B2C3] text-white' : 'bg-white text-[#5A6B73]'}`}
                  >
                    복수선택
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-[#5A6B73] font-mono text-[12px] font-semibold uppercase mb-2" style={{ letterSpacing: '.14em' }}>
                  보기 (2~6개)
                </label>
                <div className="space-y-3">
                  {options.map((opt, i) => (
                    <div key={i} className="flex items-center gap-3">
                      <span className="w-9 h-9 shrink-0 rounded-lg bg-[#F1F7FA] border border-[#DCE7EE] grid place-items-center text-[16px] font-bold text-[#1F4E79]">
                        {i + 1}
                      </span>
                      <input
                        type="text"
                        value={opt}
                        onChange={(e) => setOption(i, e.target.value)}
                        className="flex-1 h-[52px] rounded-xl border border-[#C4D8E4] focus:border-[#23B2C3] px-4 text-[18px] text-[#1F2933] outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => removeOption(i)}
                        disabled={options.length <= 2}
                        aria-label={`보기 ${i + 1} 삭제`}
                        className="w-12 h-12 shrink-0 rounded-lg border border-[#DCE7EE] text-[#5A6B73] text-2xl grid place-items-center disabled:opacity-30"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={addOption}
                  disabled={options.length >= 6}
                  className="mt-3 w-full h-[52px] rounded-xl border border-dashed border-[#23B2C3] text-[#135C73] text-[18px] font-bold flex items-center justify-center gap-2 disabled:opacity-30"
                >
                  <span className="text-2xl leading-none">＋</span> 보기 추가
                </button>
              </div>

              <button
                type="button"
                disabled={!canOpen || creating}
                onClick={() => onCreatePoll({ title: title.trim(), type, options: trimmed })}
                className="w-full h-16 rounded-2xl bg-[#23B2C3] text-white text-[22px] font-bold shadow-sm active:scale-[.99] transition mt-2 disabled:opacity-40"
              >
                {creating ? '여는 중…' : '투표 열기'}
              </button>
            </div>
          </section>

          {/* 타이머 카드 */}
          <Timer code={code} teamName={teamName} />
        </div>
      </div>
    </div>
  );
}

function TopBar({ right, live }: { right: React.ReactNode; live?: boolean }) {
  return (
    <div className="flex items-center justify-between px-6 py-4 border-b border-[#DCE7EE] bg-[#F1F7FA]">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-[#23B2C3] grid place-items-center text-white font-bold">M</div>
        {live ? (
          <span className="flex items-center gap-2 text-[#135C73] font-bold text-[16px]">
            <span className="w-3 h-3 rounded-full bg-[#23B2C3] animate-pulse" />
            <Eyebrow className="text-[#135C73]">Live</Eyebrow> 투표 진행 중
          </span>
        ) : (
          <Eyebrow className="text-[#5A6B73]">Moderator Console</Eyebrow>
        )}
      </div>
      {right}
    </div>
  );
}

function TeamBadge({ name, live }: { name: string; live?: boolean }) {
  return (
    <div className="flex items-center gap-2 bg-[#1F4E79] text-white rounded-full pl-4 pr-3 py-2">
      <span className="text-[19px] font-bold" style={{ letterSpacing: '-.01em' }}>
        {name}
      </span>
      {live !== undefined && (
        <span className={`w-2.5 h-2.5 rounded-full ${live ? 'bg-[#4F9D3A]' : 'bg-[#5A6B73]'}`} title="접속됨" />
      )}
    </div>
  );
}

// ============================================================
// State 03 — 투표 진행 (QR + 실시간 집계)
// ============================================================

function PollingScreen({
  teamName,
  code,
  capacity,
  round,
  votes,
  onClose,
  closing,
  restoreNotice,
}: {
  teamName: string;
  code: string | null;
  capacity: number;
  round: Round;
  votes: Vote[];
  onClose: () => void;
  closing: boolean;
  restoreNotice?: boolean;
}) {
  const [qr, setQr] = useState<string | null>(null);
  const participantUrl = `${typeof window !== 'undefined' ? window.location.origin : ''}/v?r=${round.id}`;
  const participantUrlDisplay = participantUrl.replace(/^https?:\/\//, '');

  useEffect(() => {
    QRCode.toDataURL(participantUrl, { width: 480, margin: 1 })
      .then(setQr)
      .catch(() => setQr(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [round.id]);

  const tally = tallyVotes(round, votes);
  const options = round.options ?? [];

  return (
    <div className="min-h-screen bg-[#F5F8FB]">
      <TopBar right={<TeamBadge name={teamName} />} live />

      <div className="max-w-6xl mx-auto p-6 sm:p-8">
        {restoreNotice ? (
          <div className="mb-4 flex items-center gap-2 rounded-xl border border-[#C4D8E4] bg-[#F1F7FA] px-4 py-2.5 text-[14px] font-semibold text-[#135C73]">
            <span aria-hidden="true">↻</span> 진행 중인 투표를 불러왔습니다.
          </div>
        ) : null}
        <div className="mb-6">
          <Eyebrow className="text-[#5A6B73] mb-1.5">질문</Eyebrow>
          <h2 className="text-[26px] font-extrabold text-[#1F4E79] leading-snug" style={{ letterSpacing: '-.022em' }}>
            {round.title}
          </h2>
        </div>

        <div className="grid lg:grid-cols-2 gap-8">
          {/* 좌: QR */}
          <div className="flex flex-col items-center text-center">
            <div className="w-full max-w-[380px] aspect-square rounded-3xl border border-[#DCE7EE] bg-white p-6 grid place-items-center shadow-sm">
              {qr ? (
                <img src={qr} alt="참가용 QR 코드" className="w-full h-full object-contain" />
              ) : (
                <div className="w-full h-full bg-[#F1F7FA] rounded-xl animate-pulse" />
              )}
            </div>
            <div className="mt-5 flex items-center gap-2 text-[#1F4E79] text-[20px] font-bold">
              <span aria-hidden="true">📷</span> 휴대폰 카메라로 스캔하세요
            </div>
            <p className="text-[#5A6B73] text-[15px] mt-1">카메라를 QR에 비추면 투표 화면이 열립니다.</p>

            <div className="mt-6 pt-5 border-t border-[#DCE7EE] w-full max-w-[380px]">
              <Eyebrow className="text-[#5A6B73] mb-2">QR이 안 되면</Eyebrow>
              <p
                className="font-mono text-[20px] font-bold text-[#1F4E79] break-all select-all"
                style={{ letterSpacing: '-.01em' }}
              >
                {participantUrlDisplay}
              </p>
            </div>
          </div>

          {/* 우: 집계 */}
          <div className="flex flex-col">
            <div className="flex items-end justify-between mb-4">
              <div>
                <Eyebrow className="text-[#5A6B73] mb-1.5">참여 현황</Eyebrow>
                <div className="text-[46px] font-extrabold text-[#1F4E79] leading-none tr-num">
                  {tally.total}
                  <span className="text-[#5A6B73] text-[26px] font-bold"> / {capacity}명</span>
                </div>
              </div>
              <div className="text-right">
                <Eyebrow className="text-[#5A6B73] mb-1.5">진행률</Eyebrow>
                <div className="text-[28px] font-extrabold text-[#135C73] leading-none tr-num">
                  {capacity > 0 ? Math.min(100, Math.round((tally.total / capacity) * 100)) : 0}%
                </div>
              </div>
            </div>

            <div className="space-y-4 flex-1">
              {options.map((opt, i) => {
                const count = tally.byOption[opt] ?? 0;
                const pct = tally.total > 0 ? Math.round((count / tally.total) * 100) : 0;
                return (
                  <div key={opt}>
                    <div className="flex justify-between items-baseline mb-1.5">
                      <span className="text-[18px] font-bold text-[#1F2933]">{opt}</span>
                      <span className="text-[18px] font-extrabold text-[#1F4E79] tr-num">
                        {count}표 <span className="text-[#5A6B73] text-[15px] font-semibold">{pct}%</span>
                      </span>
                    </div>
                    <div className="h-10 rounded-lg bg-[#F1F7FA] overflow-hidden">
                      <div
                        className="h-full rounded-lg transition-all"
                        style={{ width: `${pct}%`, background: OPTION_COLORS[i % OPTION_COLORS.length] }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="mt-7 space-y-3">
              <button
                type="button"
                onClick={onClose}
                disabled={closing}
                className="w-full h-16 rounded-2xl bg-[#DC2626] text-white text-[22px] font-bold shadow-sm active:scale-[.99] transition flex items-center justify-center gap-2 disabled:opacity-50"
              >
                <span aria-hidden="true">⛔</span> {closing ? '마감 중…' : '투표 마감'}
              </button>
              {code ? <ProxyVoteControl code={code} round={round} /> : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// 대리 입력 — 보기+매수 선택 → 확인 다이얼로그 → proxyVote
// ============================================================

function ProxyVoteControl({ code, round }: { code: string; round: Round }) {
  const [step, setStep] = useState<'closed' | 'pick' | 'confirm'>('closed');
  const [choice, setChoice] = useState<string>(round.options?.[0] ?? '');
  const [n, setN] = useState(1);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  const openPicker = () => {
    setChoice(round.options?.[0] ?? '');
    setN(1);
    setStep('pick');
  };

  const confirmProxy = async () => {
    setBusy(true);
    try {
      await proxyVote(code, round.id, choice, n);
      setToast(`대리 ${n}표 입력됨`);
      setStep('closed');
    } catch {
      setToast('대리 입력 실패 — 다시 시도해 주세요');
      setStep('closed');
    } finally {
      setBusy(false);
    }
  };

  const options = round.options ?? [];

  return (
    <>
      <button
        type="button"
        onClick={openPicker}
        className="w-full h-[52px] rounded-2xl border border-[#C4D8E4] bg-white text-[#1F4E79] text-[18px] font-bold"
      >
        대리 입력
      </button>
      <p className="text-[14px] text-[#5A6B73] text-center">
        대리 입력: 휴대폰이 없는 참가자의 표를 진행자가 대신 넣습니다.
      </p>

      {toast ? (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-[#1F4E79] text-white text-[16px] font-bold rounded-full px-5 py-3 shadow-lg">
          {toast}
        </div>
      ) : null}

      {step === 'pick' ? (
        <div className="fixed inset-0 z-40 bg-[#1F4E79]/55 backdrop-blur-[1px] flex items-center justify-center p-5">
          <div className="w-full max-w-md bg-white rounded-2xl border border-[#DCE7EE] overflow-hidden">
            <div className="px-6 pt-6 pb-5">
              <Eyebrow className="text-[#5A6B73] mb-2">대리 입력</Eyebrow>
              <h4 className="text-[22px] font-extrabold text-[#1F4E79] leading-snug mb-4" style={{ letterSpacing: '-.01em' }}>
                누구에게 몇 표를 넣을까요?
              </h4>

              <Eyebrow className="text-[#5A6B73] mb-2">보기</Eyebrow>
              <div className="grid grid-cols-1 gap-2 mb-5">
                {options.map((opt) => (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => setChoice(opt)}
                    className={`h-14 rounded-xl border text-[18px] font-bold px-4 text-left ${
                      choice === opt ? 'border-[#23B2C3] bg-[#23B2C3]/8 text-[#1F4E79]' : 'border-[#C4D8E4] text-[#1F2933]'
                    }`}
                  >
                    {opt}
                  </button>
                ))}
              </div>

              <Eyebrow className="text-[#5A6B73] mb-2">매수 (1~5)</Eyebrow>
              <div className="flex items-center gap-3 mb-1">
                <div className="flex items-center rounded-xl border border-[#C4D8E4] overflow-hidden">
                  <button
                    type="button"
                    aria-label="매수 감소"
                    onClick={() => setN((v) => Math.max(1, v - 1))}
                    className="w-14 h-16 text-3xl text-[#5A6B73] bg-[#F1F7FA]"
                  >
                    −
                  </button>
                  <div className="w-24 h-16 grid place-items-center text-[30px] font-extrabold text-[#1F4E79] tr-num">{n}</div>
                  <button
                    type="button"
                    aria-label="매수 증가"
                    onClick={() => setN((v) => Math.min(5, v + 1))}
                    className="w-14 h-16 text-3xl text-[#5A6B73] bg-[#F1F7FA]"
                  >
                    ＋
                  </button>
                </div>
                <span className="text-[18px] text-[#5A6B73] font-semibold">표</span>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 p-5 pt-2">
              <button
                type="button"
                onClick={() => setStep('closed')}
                className="h-14 rounded-2xl border border-[#C4D8E4] bg-white text-[#1F4E79] text-[19px] font-bold"
              >
                취소
              </button>
              <button
                type="button"
                disabled={!choice}
                onClick={() => setStep('confirm')}
                className="h-14 rounded-2xl bg-[#1F4E79] text-white text-[19px] font-bold disabled:opacity-40"
              >
                다음
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {step === 'confirm' ? (
        <div className="fixed inset-0 z-40 bg-[#1F4E79]/55 backdrop-blur-[1px] flex items-center justify-center p-5">
          <div className="w-full max-w-md bg-white rounded-2xl border border-[#DCE7EE] overflow-hidden">
            <div className="px-6 pt-6 pb-5 text-center">
              <div className="w-14 h-14 mx-auto rounded-2xl bg-[#F5A623]/15 border border-[#F5A623]/40 grid place-items-center text-3xl mb-4" aria-hidden="true">
                🗳️
              </div>
              <Eyebrow className="text-[#B5651D] mb-2">Confirm</Eyebrow>
              <h4 className="text-[22px] font-extrabold text-[#1F4E79] leading-snug mb-3" style={{ letterSpacing: '-.01em' }}>
                대리 입력을 진행할까요?
              </h4>
              <p className="text-[17px] text-[#1F2933] leading-relaxed">
                무기명 투표에 <b className="text-[#1F4E79]">{choice}</b>
                <b className="text-[#1F4E79] tr-num"> {n}표</b>를 대리 입력합니다.
              </p>
              <p className="text-[14px] text-[#5A6B73] mt-3">확정 후에는 되돌릴 수 없습니다. 참가자 수를 다시 확인하세요.</p>
            </div>
            <div className="grid grid-cols-2 gap-3 p-5 pt-0">
              <button
                type="button"
                onClick={() => setStep('closed')}
                disabled={busy}
                className="h-[56px] rounded-2xl border border-[#C4D8E4] bg-white text-[#1F4E79] text-[19px] font-bold disabled:opacity-50"
              >
                취소
              </button>
              <button
                type="button"
                onClick={confirmProxy}
                disabled={busy}
                className="h-[56px] rounded-2xl bg-[#1F4E79] text-white text-[19px] font-bold shadow-sm disabled:opacity-50"
              >
                {busy ? '입력 중…' : '확인'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

// ============================================================
// State 03-b — 마감 후 결과 확정 (풀스크린 진입점 포함)
// ============================================================

function ResultsScreen({
  teamName,
  round,
  votes,
  onNewPoll,
  onEnterFullscreen,
}: {
  teamName: string;
  round: Round;
  votes: Vote[];
  onNewPoll: () => void;
  onEnterFullscreen: () => void;
}) {
  const tally = tallyVotes(round, votes);
  const ranked = (round.options ?? [])
    .map((opt) => ({ opt, count: tally.byOption[opt] ?? 0 }))
    .sort((a, b) => b.count - a.count);

  return (
    <div className="min-h-screen bg-[#F5F8FB]">
      <TopBar right={<TeamBadge name={teamName} />} />

      <div className="max-w-2xl mx-auto p-6 sm:p-8">
        <div className="bg-white rounded-3xl border border-[#DCE7EE] overflow-hidden shadow-sm">
          <div className="px-6 py-4 border-b border-[#DCE7EE] bg-[#1F4E79] text-white flex items-center justify-between">
            <span className="flex items-center gap-2 text-[16px] font-bold">
              <span aria-hidden="true">✔</span> 투표 마감됨 · 결과 확정
            </span>
            <span className="text-[15px] font-semibold bg-white/15 rounded-full px-3 py-1 tr-num">
              총 {tally.total}표
            </span>
          </div>
          <div className="p-6 space-y-3">
            {ranked.map(({ opt, count }, i) => {
              const pct = tally.total > 0 ? Math.round((count / tally.total) * 100) : 0;
              return (
                <div
                  key={opt}
                  className={`flex items-center gap-3 rounded-xl border p-3 ${
                    i === 0 ? 'border-[#23B2C3] bg-[#23B2C3]/6' : 'border-[#DCE7EE]'
                  }`}
                >
                  <span
                    className={`w-9 h-9 rounded-lg grid place-items-center font-bold ${
                      i === 0 ? 'bg-[#23B2C3] text-white' : 'bg-[#F1F7FA] text-[#1F4E79]'
                    }`}
                  >
                    {i + 1}위
                  </span>
                  <span className={`flex-1 ${i === 0 ? 'text-[19px] font-extrabold text-[#1F4E79]' : 'text-[18px] font-bold text-[#1F2933]'}`}>
                    {opt}
                  </span>
                  <span className={`tr-num ${i === 0 ? 'text-[19px] font-extrabold text-[#1F4E79]' : 'text-[18px] font-bold text-[#1F2933]'}`}>
                    {count}표 · {pct}%
                  </span>
                </div>
              );
            })}

            <button
              type="button"
              onClick={onEnterFullscreen}
              className="w-full h-16 mt-2 rounded-2xl bg-[#23B2C3] text-white text-[20px] font-bold shadow-sm flex items-center justify-center gap-2"
            >
              <span aria-hidden="true">🖥️</span> 결과 크게 보기
            </button>
            <p className="text-[13px] text-[#5A6B73] text-center">대형 스크린(빔프로젝터)으로 결과를 송출합니다.</p>

            <button
              type="button"
              onClick={onNewPoll}
              className="w-full h-[52px] rounded-2xl border border-[#C4D8E4] bg-white text-[#1F4E79] text-[18px] font-bold"
            >
              새 투표
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// State 05 — 풀스크린 결과 송출 (대형 스크린)
// ============================================================

function FullscreenResults({
  teamName,
  round,
  votes,
  onExit,
}: {
  teamName: string;
  round: Round;
  votes: Vote[];
  onExit: () => void;
}) {
  const tally = tallyVotes(round, votes);
  const ranked = (round.options ?? [])
    .map((opt) => ({ opt, count: tally.byOption[opt] ?? 0 }))
    .sort((a, b) => b.count - a.count);
  const rankLabel = ['1위', '2위', '3위', '4위', '5위', '6위'];
  const rankColor = ['#135C73', '#2E75B6', '#5A6B73', '#5A6B73', '#5A6B73', '#5A6B73'];
  const barColor = ['#135C73', '#2E75B6', '#4F9D3A', '#F5A623', '#23B2C3', '#1F4E79'];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onExit();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onExit]);

  return (
    <div className="fixed inset-0 z-50 bg-white flex flex-col px-6 sm:px-14 py-8 sm:py-10">
      <div className="flex items-center justify-between mb-6">
        <div>
          <Eyebrow className="text-[#135C73] mb-2">최종 결과 · 총 {tally.total}표</Eyebrow>
          <h1
            className="text-[clamp(30px,3.6vw,52px)] font-extrabold text-[#1F4E79] leading-tight"
            style={{ letterSpacing: '-.022em' }}
          >
            {round.title}
          </h1>
        </div>
        <div className="hidden sm:flex items-center gap-2 bg-[#1F4E79] text-white rounded-full px-5 py-2.5 text-[22px] font-bold shrink-0" style={{ letterSpacing: '-.01em' }}>
          {teamName}
        </div>
        <button
          type="button"
          onClick={onExit}
          aria-label="풀스크린 결과 나가기"
          className="fixed top-4 right-4 sm:static ml-0 sm:ml-4 z-10 rounded-full border border-[#C4D8E4] bg-white/90 px-4 py-2 text-[15px] font-bold text-[#5A6B73] shadow-sm"
        >
          나가기 (ESC)
        </button>
      </div>

      <div className="flex-1 flex flex-col justify-center gap-[3.2%]">
        {ranked.map(({ opt, count }, i) => {
          const pct = tally.total > 0 ? Math.round((count / tally.total) * 100) : 0;
          return (
            <div key={opt}>
              <div className="flex items-baseline justify-between mb-1.5">
                <div className="flex items-baseline gap-3">
                  <span className="text-[clamp(20px,2vw,30px)] font-extrabold tr-num" style={{ color: rankColor[i] ?? '#5A6B73' }}>
                    {rankLabel[i] ?? `${i + 1}위`}
                  </span>
                  <span className="text-[clamp(24px,2.6vw,40px)] font-extrabold text-[#1F4E79]">{opt}</span>
                </div>
                <div className="flex items-baseline gap-3">
                  <span className="text-[clamp(48px,7vw,110px)] font-extrabold text-[#1F4E79] leading-none tr-num">
                    {pct}
                    <span className="text-[0.5em]">%</span>
                  </span>
                  <span className="text-[clamp(20px,2vw,30px)] font-bold text-[#5A6B73] tr-num w-[3.2em] text-right">{count}표</span>
                </div>
              </div>
              <div className="h-[clamp(28px,4.2vh,60px)] rounded-xl bg-[#F1F7FA] overflow-hidden border border-[#DCE7EE]">
                <div
                  className="h-full rounded-xl transition-all"
                  style={{ width: `${pct}%`, background: barColor[i % barColor.length] }}
                />
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex items-center justify-between mt-6 pt-5 border-t border-[#DCE7EE]">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-[#23B2C3] grid place-items-center text-white font-bold text-lg">M</div>
          <span className="text-[clamp(16px,1.6vw,22px)] font-bold text-[#1F4E79]">기후시민회의 · {teamName}</span>
        </div>
        <Eyebrow className="text-[#5A6B73]">climate-assembly.org</Eyebrow>
      </div>
    </div>
  );
}

// ============================================================
// Root
// ============================================================

export default function ModConsole() {
  const [state, dispatch] = useReducer(modReducer, initialModState);
  const [joinBusy, setJoinBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [closing, setClosing] = useState(false);
  const [votes, setVotes] = useState<Vote[]>([]);
  const [fullscreen, setFullscreen] = useState(false);
  const [restoreNotice, setRestoreNotice] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const codeRef = useRef<string | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  // 새로고침 시 sessionStorage 코드로 조용히 재입장
  useEffect(() => {
    const saved = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem(CODE_KEY) : null;
    if (!saved || !isValidJoinCode(saved)) return;
    codeRef.current = saved;
    joinTeam(saved)
      .then(async (team) => {
        if (!team) {
          sessionStorage.removeItem(CODE_KEY);
          return;
        }
        // 진행 중인 라운드가 있으면 함께 복원해 polling 화면(QR + 실시간 집계)으로 재진입한다.
        const round = await fetchActiveRound(team.id).catch(() => null);
        if (round) setVotes([]);
        dispatch({ type: 'RESTORE_TEAM', team, round });
      })
      // RPC/네트워크 오류(일시 장애)에는 저장 코드를 지우지 않는다 — 다음 새로고침에서 재시도.
      // 무효/재발급된 코드는 위의 team===null 분기에서만 제거된다.
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 라운드 실시간 구독 + 5초 폴백 폴링
  useEffect(() => {
    if (state.screen !== 'polling' || !state.round) return;
    const roundId = state.round.id;
    let cancelled = false;

    const refresh = () => {
      fetchVotes(roundId)
        .then((v) => {
          if (!cancelled) setVotes(v);
        })
        .catch(() => {});
    };
    refresh();

    const unsubscribe = subscribeRound(roundId, refresh);
    const interval = setInterval(refresh, 5000);

    return () => {
      cancelled = true;
      unsubscribe();
      clearInterval(interval);
    };
  }, [state.screen, state.round]);

  // results 화면에서도 최종 표를 한 번 더 가져온다(마감 직전 마지막 표 반영)
  useEffect(() => {
    if (state.screen !== 'results' || !state.round) return;
    fetchVotes(state.round.id)
      .then(setVotes)
      .catch(() => {});
  }, [state.screen, state.round]);

  useEffect(() => {
    const onFsChange = () => {
      if (!document.fullscreenElement) setFullscreen(false);
    };
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  const handleJoin = async (code: string) => {
    setJoinBusy(true);
    try {
      const team = await joinTeam(code);
      if (team) {
        codeRef.current = code;
        sessionStorage.setItem(CODE_KEY, code);
        dispatch({ type: 'JOIN_SUCCESS', team });
      } else {
        dispatch({ type: 'JOIN_FAILURE', message: '존재하지 않는 접속코드입니다. 다시 확인해 주세요.' });
      }
    } catch {
      // joinTeam이 throw하는 경우는 RPC/네트워크 오류(코드 자체 오류가 아님) —
      // "코드가 틀렸습니다" 대신 연결 문제임을 명확히 안내한다.
      dispatch({ type: 'JOIN_FAILURE', message: '연결에 실패했습니다 — 네트워크(와이파이)를 확인해 주세요.' });
    } finally {
      setJoinBusy(false);
    }
  };

  const handleCreatePoll = async (input: { title: string; type: 'RADIO' | 'CHECKBOX'; options: string[] }) => {
    const code = codeRef.current;
    if (!code || !state.team) return;
    setCreating(true);
    try {
      // 방어적 이중 클릭/새로고침 경합 대비 — 이미 진행 중인 라운드가 있으면 새로 만들지 않고 복원한다.
      const active = await fetchActiveRound(state.team.id).catch(() => null);
      if (active) {
        setRestoreNotice(true);
        setVotes([]);
        dispatch({ type: 'RESTORE_TEAM', team: state.team, round: active });
        return;
      }
      const round = await createPoll(code, input);
      const opened = await setPollStatus(code, round.id, 'active');
      setVotes([]);
      dispatch({ type: 'CREATE_POLL_SUCCESS', round: opened });
    } catch {
      // 개설 실패 — 홈에 머무름(재시도 가능), 단 무슨 일이 일어났는지는 토스트로 알린다.
      setToast('투표 열기에 실패했습니다 — 네트워크를 확인하고 다시 시도해 주세요.');
    } finally {
      setCreating(false);
    }
  };

  const handleClosePoll = async () => {
    const code = codeRef.current;
    if (!code || !state.round) return;
    setClosing(true);
    try {
      const closed = await setPollStatus(code, state.round.id, 'closed');
      setRestoreNotice(false);
      dispatch({ type: 'CLOSE_POLL', round: closed });
    } catch {
      // 마감 실패 — 진행 화면에 머무름, 토스트로 재시도를 안내한다.
      setToast('투표 마감에 실패했습니다 — 다시 시도해 주세요.');
    } finally {
      setClosing(false);
    }
  };

  const enterFullscreen = () => {
    // 풀스크린 진입 시 1회 재조회 — 마감 직전(가드 적용 이전) 도착한 표까지 반영한다.
    if (state.round) {
      fetchVotes(state.round.id)
        .then(setVotes)
        .catch(() => {});
    }
    setFullscreen(true);
    const el = document.documentElement;
    if (el.requestFullscreen) {
      el.requestFullscreen().catch(() => {
        /* 전체화면 API 미지원/거부 — 일반 풀뷰포트 오버레이로 폴백 */
      });
    }
  };

  const exitFullscreen = () => {
    setFullscreen(false);
    if (document.fullscreenElement && document.exitFullscreen) {
      document.exitFullscreen().catch(() => {});
    }
  };

  const teamName = state.team?.name ?? '';

  let screenEl: React.ReactNode;

  if (state.screen === 'home') {
    screenEl = (
      <HomeScreen teamName={teamName} code={codeRef.current} onCreatePoll={handleCreatePoll} creating={creating} />
    );
  } else if (state.screen === 'polling' && state.round) {
    screenEl = (
      <PollingScreen
        teamName={teamName}
        code={codeRef.current}
        capacity={state.team?.capacity ?? 0}
        round={state.round}
        votes={votes}
        onClose={handleClosePoll}
        closing={closing}
        restoreNotice={restoreNotice}
      />
    );
  } else if (state.screen === 'results' && state.round && fullscreen) {
    screenEl = <FullscreenResults teamName={teamName} round={state.round} votes={votes} onExit={exitFullscreen} />;
  } else if (state.screen === 'results' && state.round) {
    screenEl = (
      <ResultsScreen
        teamName={teamName}
        round={state.round}
        votes={votes}
        onNewPoll={() => dispatch({ type: 'NEW_POLL' })}
        onEnterFullscreen={enterFullscreen}
      />
    );
  } else {
    screenEl = <JoinScreen onJoin={handleJoin} error={state.joinError} busy={joinBusy} />;
  }

  return (
    <>
      {screenEl}
      {toast ? (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-[#1F4E79] text-white text-[16px] font-bold rounded-full px-5 py-3 shadow-lg">
          {toast}
        </div>
      ) : null}
    </>
  );
}
