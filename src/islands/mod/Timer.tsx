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
  type TimerState,
  type TimerKind,
} from './timer-logic';
import { logTimer } from '../../lib/mod-console';

const SPEECH_PRESETS = [1, 2, 3];

function Eyebrow({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`font-mono text-[12px] font-semibold uppercase ${className}`} style={{ letterSpacing: '.14em' }}>
      {children}
    </div>
  );
}

/**
 * 발언·세션 타이머 카드(홈 화면) + 실행 중 오버레이(마지막 10초 색 반전 + 만료 알림).
 * code/teamName은 timer_log 로깅(mod_log_timer RPC)과 표시용 뱃지에 쓰인다.
 */
export default function Timer({ code, teamName }: { code: string | null; teamName: string }) {
  const [state, setState] = useState<TimerState>(createIdleTimer('speech', 60_000));
  const [sessionMinutes, setSessionMinutes] = useState(15);
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

  // 만료 시 소리 재생 + 로그(1회만)
  useEffect(() => {
    if (state.phase !== 'expired' || expiredLoggedRef.current) return;
    expiredLoggedRef.current = true;
    audioRef.current?.play().catch(() => {
      /* 자동재생 정책으로 막혀도 UX는 계속 진행 */
    });
    if (code && state.startedAt != null) {
      void logTimer(code, {
        kind: state.kind,
        duration_s: Math.round(state.durationMs / 1000),
        started_at: new Date(state.startedAt).toISOString(),
        ended_at: new Date().toISOString(),
      }).catch(() => {
        /* fire-and-forget — 로그 실패가 타이머 UX를 막지 않는다 */
      });
    }
  }, [state.phase, state.kind, state.durationMs, state.startedAt, code]);

  const begin = (kind: TimerKind, durationMs: number) => {
    expiredLoggedRef.current = false;
    setState(startTimer(kind, durationMs, Date.now()));
  };

  const handlePause = () => setState((s) => pauseTimer(s, Date.now()));
  const handleResume = () => setState((s) => resumeTimer(s, Date.now()));
  const handleStop = () => {
    // 진행 중 수동 종료도 로그를 남긴다(만료가 아니어도 발언 배분 지표에는 유효한 구간).
    // expired는 만료 useEffect가 이미 로그를 남겼으므로 shouldLogOnStop이 중복 기록을 막는다.
    if (code && state.startedAt != null && shouldLogOnStop(state.phase)) {
      const elapsedMs = state.durationMs - state.remainingMs;
      if (elapsedMs > 0) {
        void logTimer(code, {
          kind: state.kind,
          duration_s: Math.round(elapsedMs / 1000),
          started_at: new Date(state.startedAt).toISOString(),
          ended_at: new Date().toISOString(),
        }).catch(() => {});
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
              <div className="grid grid-cols-3 gap-3">
                {SPEECH_PRESETS.map((min) => (
                  <button
                    key={min}
                    type="button"
                    onClick={() => begin('speech', min * 60_000)}
                    className="h-24 rounded-2xl border border-[#C4D8E4] bg-[#2E75B6]/5 flex flex-col items-center justify-center active:scale-[.98] transition"
                  >
                    <span className="text-[34px] font-extrabold text-[#1F4E79] leading-none tr-num">{min}</span>
                    <span className="text-[16px] font-semibold text-[#2E75B6] mt-1">분</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="h-px bg-[#DCE7EE]" />

            <div>
              <Eyebrow className="text-[#5A6B73] mb-1">세션 타이머</Eyebrow>
              <p className="text-[14px] text-[#5A6B73] mb-3">분 단위로 직접 설정합니다.</p>
              <div className="flex items-center gap-3">
                <div className="flex items-center rounded-xl border border-[#C4D8E4] overflow-hidden">
                  <button
                    type="button"
                    aria-label="1분 감소"
                    onClick={() => setSessionMinutes((m) => Math.max(1, m - 1))}
                    className="w-14 h-16 text-3xl text-[#5A6B73] bg-[#F1F7FA]"
                  >
                    −
                  </button>
                  <div className="w-24 h-16 grid place-items-center text-[30px] font-extrabold text-[#1F4E79] tr-num">
                    {sessionMinutes}
                  </div>
                  <button
                    type="button"
                    aria-label="1분 증가"
                    onClick={() => setSessionMinutes((m) => Math.min(180, m + 1))}
                    className="w-14 h-16 text-3xl text-[#5A6B73] bg-[#F1F7FA]"
                  >
                    ＋
                  </button>
                </div>
                <span className="text-[18px] text-[#5A6B73] font-semibold">분</span>
                <button
                  type="button"
                  onClick={() => begin('session', sessionMinutes * 60_000)}
                  className="flex-1 h-16 rounded-2xl bg-[#2E75B6] text-white text-[22px] font-bold shadow-sm active:scale-[.99] transition"
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
          <div className="text-[18px] font-bold text-white/90 mb-2 flex items-center gap-2">
            <span aria-hidden="true">⏰</span> 곧 종료됩니다
          </div>
        ) : null}
        {state.phase === 'expired' ? (
          <div className="text-[18px] font-bold text-white/90 mb-2 flex items-center gap-2">
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
