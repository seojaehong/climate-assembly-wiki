import { useEffect, useRef, useState } from 'react';
import {
  createIdleTimer,
  startTimer,
  pauseTimer,
  resumeTimer,
  stopTimer,
  tickTimer,
  isLastTenSeconds,
  shouldLogOnStop,
  formatRemaining,
  minutesToMs,
  formatPresetLabel,
  parseSessionMinutes,
  stepSessionMinutes,
  SESSION_MAX_MINUTES,
  SPEECH_PRESET_MINUTES,
  SESSION_PRESET_MINUTES,
  type TimerState,
  type TimerKind,
} from './timer-logic';
import { logTimer } from '../../lib/mod-console';
import type { WorkshopAuthorization } from '../../lib/deliberation';

const SPEECH_PRESETS = SPEECH_PRESET_MINUTES; // [0.5, 1, 2, 3] — 0.5는 「30초」로 표시된다
const SESSION_PRESETS = SESSION_PRESET_MINUTES; // [5, 10, 15, 20, 25, 40] — 8.29 오후 진행표 블록

function Eyebrow({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`font-mono text-[12px] font-semibold uppercase ${className}`} style={{ letterSpacing: '.14em' }}>
      {children}
    </div>
  );
}

/**
 * 발언·세션 타이머 카드(홈 화면) + 실행 중 오버레이(마지막 10초 색 반전 + 만료 알림).
 * access/teamName은 timer_log 로깅(mod_log_timer RPC)과 표시용 뱃지에 쓰인다.
 */
export default function Timer({
  access,
  teamName,
}: {
  access: WorkshopAuthorization | null;
  teamName: string;
}) {
  const [state, setState] = useState<TimerState>(createIdleTimer('speech', 60_000));
  const [sessionMinutes, setSessionMinutes] = useState(15);
  // 입력칸에 찍힌 글자. 편집 중 잠시 비는 것을 허용하려고 확정값(sessionMinutes)과 따로 둔다 —
  // 값에 곧장 묶어 두면 지우는 순간 되돌아가 숫자를 고쳐 쓸 수가 없다.
  const [sessionDraft, setSessionDraft] = useState('15');
  /** 프리셋·＋/− 처럼 확정값을 바꾸는 경로는 입력칸 글자도 함께 맞춘다. */
  const commitSessionMinutes = (value: number) => {
    setSessionMinutes(value);
    setSessionDraft(String(value));
  };
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const expiredLoggedRef = useRef(false);

  // 1초 간격 tick — running일 때만 동작
  useEffect(() => {
    if (state.phase !== 'running') return;
    const id = setInterval(() => {
      setState((s) => tickTimer(s, Date.now()));
    }, 250);
    return () => clearInterval(id);
  }, [state.phase]);

  // 만료 시 로그(1회만)
  //
  // 🔇 2026-08-29: 만료음을 끈다. 한 공간에 15개 조가 앉아 있어 한 조의 타이머 소리가
  //    옆 조 숙의를 끊는다. 조마다 타이머가 따로 돌기 때문에 하루 종일 아무 조나
  //    울리는 셈이 된다. 알림은 화면으로 충분하다 — 마지막 10초 색 반전 + 만료 오버레이.
  //    소리 파일(/sounds/timer-end.wav)과 audio 엘리먼트는 남겨 둔다. 다시 켜려면
  //    아래 한 줄을 되살리면 된다.
  useEffect(() => {
    if (state.phase !== 'expired' || expiredLoggedRef.current) return;
    expiredLoggedRef.current = true;
    if (access && state.startedAt != null) {
      void logTimer(access, {
        kind: state.kind,
        duration_s: Math.round(state.durationMs / 1000),
        started_at: new Date(state.startedAt).toISOString(),
        ended_at: new Date().toISOString(),
      }).catch((error: unknown) => {
        console.error('[timer] expiration log failed', error);
      });
    }
  }, [state.phase, state.kind, state.durationMs, state.startedAt, access]);

  const begin = (kind: TimerKind, durationMs: number) => {
    expiredLoggedRef.current = false;
    setState(startTimer(kind, durationMs, Date.now()));
  };

  const handlePause = () => setState((s) => pauseTimer(s, Date.now()));
  const handleResume = () => setState((s) => resumeTimer(s, Date.now()));
  const handleStop = () => {
    // 진행 중 수동 종료도 로그를 남긴다(만료가 아니어도 발언 배분 지표에는 유효한 구간).
    // expired는 만료 useEffect가 이미 로그를 남겼으므로 shouldLogOnStop이 중복 기록을 막는다.
    if (access && state.startedAt != null && shouldLogOnStop(state.phase)) {
      const elapsedMs = state.durationMs - state.remainingMs;
      if (elapsedMs > 0) {
        void logTimer(access, {
          kind: state.kind,
          duration_s: Math.round(elapsedMs / 1000),
          started_at: new Date(state.startedAt).toISOString(),
          ended_at: new Date().toISOString(),
        }).catch((error: unknown) => {
          console.error('[timer] stop log failed', error);
        });
      }
    }
    setState((s) => stopTimer(s));
  };

  const running = state.phase === 'running' || state.phase === 'paused' || state.phase === 'expired';
  const warn = isLastTenSeconds(state) || state.phase === 'expired';

  return (
    <>
      <audio ref={audioRef} src="/sounds/timer-end.wav" preload="auto" />

      {running ? (
        <TimerOverlay
          teamName={teamName}
          state={state}
          warn={warn}
          onPause={handlePause}
          onResume={handleResume}
          onStop={handleStop}
        />
      ) : (
        <section className="rounded-2xl border border-[#DCE7EE] bg-white overflow-hidden shadow-sm">
          <div className="flex items-center gap-3 px-6 py-4 bg-[#2E75B6]/8 border-b border-[#DCE7EE]">
            <span className="w-11 h-11 rounded-xl bg-[#2E75B6] grid place-items-center text-white text-2xl" aria-hidden="true">
              ⏱️
            </span>
            <h3 className="text-[22px] font-extrabold text-[#1F4E79]" style={{ letterSpacing: '-.01em' }}>
              타이머
            </h3>
          </div>
          <div className="p-6 space-y-7">
            <div>
              <Eyebrow className="text-[#5A6B73] mb-1">발언 타이머</Eyebrow>
              <p className="text-[14px] text-[#5A6B73] mb-3">시간을 눌러 바로 시작합니다.</p>
              <div className="grid grid-cols-4 gap-3">
                {SPEECH_PRESETS.map((min) => {
                  const { value, unit } = formatPresetLabel(min);
                  return (
                    <button
                      key={min}
                      type="button"
                      onClick={() => begin('speech', minutesToMs(min))}
                      className="h-24 rounded-2xl border border-[#C4D8E4] bg-[#2E75B6]/5 flex flex-col items-center justify-center active:scale-[.98] transition"
                    >
                      <span className="text-[34px] font-extrabold text-[#1F4E79] leading-none tr-num">{value}</span>
                      <span className="text-[16px] font-semibold text-[#2E75B6] mt-1">{unit}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="h-px bg-[#DCE7EE]" />

            <div>
              <Eyebrow className="text-[#5A6B73] mb-1">세션 타이머</Eyebrow>
              <p className="text-[14px] text-[#5A6B73] mb-3">블록을 고르거나 분 단위로 직접 설정합니다.</p>
              <div className="grid grid-cols-3 gap-3 mb-4">
                {SESSION_PRESETS.map((min) => {
                  const { value, unit } = formatPresetLabel(min);
                  const selected = sessionMinutes === min;
                  return (
                    <button
                      key={min}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => commitSessionMinutes(min)}
                      className={`h-16 rounded-2xl border flex items-center justify-center active:scale-[.98] transition ${
                        selected ? 'border-[#2E75B6] bg-[#2E75B6] text-white' : 'border-[#C4D8E4] bg-[#2E75B6]/5 text-[#1F4E79]'
                      }`}
                    >
                      {/* 버튼에 items-baseline 을 걸었더니 숫자와 「분」의 베이스라인을 맞추느라
                          **두 글자 묶음 전체가 버튼 세로 중앙에서 위로 밀렸다.**
                          정렬을 두 겹으로 나눈다 — 버튼은 묶음을 가운데(items-center)에 두고,
                          숫자와 단위의 베이스라인은 안쪽 묶음에서 맞춘다.
                          발언 타이머(위)는 flex-col items-center 라 원래 문제가 없었다. */}
                      <span className="flex items-baseline gap-1">
                        <span className="text-[26px] font-extrabold leading-none tr-num">{value}</span>
                        <span className={`text-[15px] font-semibold ${selected ? 'text-white' : 'text-[#2E75B6]'}`}>
                          {unit}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center rounded-xl border border-[#C4D8E4] overflow-hidden">
                  <button
                    type="button"
                    aria-label="1분 감소"
                    onClick={() => commitSessionMinutes(stepSessionMinutes(sessionMinutes, -1))}
                    className="w-14 h-16 text-3xl text-[#5A6B73] bg-[#F1F7FA]"
                  >
                    <svg aria-hidden="true" className="mx-auto h-7 w-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.25} strokeLinecap="round">
                      <path d="M6 12h12" />
                    </svg>
                  </button>
                  <input
                    type="text"
                    inputMode="numeric"
                    aria-label="세션 시간(분)"
                    value={sessionDraft}
                    onChange={(e) => {
                      setSessionDraft(e.target.value);
                      const parsed = parseSessionMinutes(e.target.value);
                      if (parsed !== null) setSessionMinutes(parsed);
                    }}
                    onFocus={(e) => e.currentTarget.select()}
                    // 비운 채 벗어나면 마지막 확정값으로 되돌린다 — 빈 칸으로 시작을 누르는 일이 없게.
                    onBlur={() => setSessionDraft(String(sessionMinutes))}
                    maxLength={3}
                    title={`1~${SESSION_MAX_MINUTES}분`}
                    className="w-24 h-16 text-center text-[30px] font-extrabold text-[#1F4E79] tr-num bg-white outline-none focus:bg-[#F1F7FA]"
                  />
                  <button
                    type="button"
                    aria-label="1분 증가"
                    onClick={() => commitSessionMinutes(stepSessionMinutes(sessionMinutes, 1))}
                    className="w-14 h-16 text-3xl text-[#5A6B73] bg-[#F1F7FA]"
                  >
                    <svg aria-hidden="true" className="mx-auto h-7 w-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.25} strokeLinecap="round">
                      <path d="M6 12h12M12 6v12" />
                    </svg>
                  </button>
                </div>
                <span className="text-[18px] text-[#5A6B73] font-semibold">분</span>
                <button
                  type="button"
                  onClick={() => begin('session', minutesToMs(sessionMinutes))}
                  className="h-16 basis-full rounded-2xl bg-[#2E75B6] text-white text-[22px] font-bold shadow-sm active:scale-[.99] transition sm:basis-auto sm:flex-1"
                >
                  시작
                </button>
              </div>
            </div>
          </div>
        </section>
      )}
    </>
  );
}

function TimerOverlay({
  teamName,
  state,
  warn,
  onPause,
  onResume,
  onStop,
}: {
  teamName: string;
  state: TimerState;
  warn: boolean;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
}) {
  const label = state.kind === 'speech' ? '발언 타이머' : '세션 타이머';
  const pct = state.durationMs > 0 ? Math.max(0, Math.min(100, (state.remainingMs / state.durationMs) * 100)) : 0;

  return (
    <section
      className={`rounded-2xl overflow-hidden shadow-sm transition-colors ${
        warn ? 'bg-[#DC2626]' : 'bg-white border border-[#DCE7EE]'
      }`}
      role="timer"
      aria-live="assertive"
    >
      <div className="px-6 pt-8 pb-8 flex flex-col items-center text-center min-h-[300px]">
        <div
          className={`flex items-center gap-2 rounded-full px-4 py-1.5 text-[16px] font-bold mb-6 ${
            warn ? 'bg-white/20 text-white' : 'bg-[#1F4E79] text-white'
          }`}
          style={{ letterSpacing: '-.01em' }}
        >
          {teamName} · {label}
        </div>

        {warn && state.phase !== 'expired' ? (
          <div className="text-[18px] font-bold text-white mb-2 flex items-center gap-2">
            <span aria-hidden="true">⏰</span> 곧 종료됩니다
          </div>
        ) : null}
        {state.phase === 'expired' ? (
          <div className="text-[18px] font-bold text-white mb-2 flex items-center gap-2">
            <span aria-hidden="true">⏰</span> 시간이 종료되었습니다
          </div>
        ) : null}

        <div
          className={`leading-none font-extrabold tr-num ${warn ? 'text-white' : 'text-[#1F4E79]'}`}
          style={{ fontSize: 'clamp(72px, 12vw, 120px)' }}
        >
          {formatRemaining(state.remainingMs)}
        </div>

        <div className={`w-full max-w-sm h-3 rounded-full mt-8 overflow-hidden ${warn ? 'bg-white/25' : 'bg-[#F1F7FA]'}`}>
          <div
            className={`h-full rounded-full transition-all ${warn ? 'bg-white' : 'bg-[#23B2C3]'}`}
            style={{ width: `${pct}%` }}
          />
        </div>

        <div className="flex gap-3 mt-8 w-full max-w-sm">
          {state.phase === 'expired' ? (
            <button
              type="button"
              onClick={onStop}
              className={`flex-1 h-16 rounded-2xl text-[20px] font-bold ${
                warn ? 'bg-white text-[#DC2626]' : 'bg-[#1F4E79] text-white'
              }`}
            >
              확인
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={state.phase === 'paused' ? onResume : onPause}
                className={`flex-1 h-16 rounded-2xl text-[20px] font-bold border-2 ${
                  warn ? 'border-white/60 bg-transparent text-white' : 'border-[#C4D8E4] bg-white text-[#1F4E79]'
                }`}
              >
                {state.phase === 'paused' ? '재개' : '일시정지'}
              </button>
              <button
                type="button"
                onClick={onStop}
                className={`flex-1 h-16 rounded-2xl text-[20px] font-bold ${
                  warn ? 'bg-white text-[#DC2626]' : 'bg-[#1F4E79] text-white'
                }`}
              >
                종료
              </button>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
