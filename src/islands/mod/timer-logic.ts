/** 카운트다운 타이머 순수 로직 — React/DOM 의존 없음. */

export type TimerKind = 'speech' | 'session';
export type TimerPhase = 'idle' | 'running' | 'paused' | 'expired';

export interface TimerState {
  phase: TimerPhase;
  kind: TimerKind;
  /** 최초 설정 총 시간(ms). 로그의 duration_s 계산에 사용. */
  durationMs: number;
  /** running일 때만 유효 — 만료 예정 시각(ms epoch). */
  endAt: number | null;
  /** idle/paused/expired일 때 고정된 남은 시간(ms). running일 때는 tickTimer가 채운다. */
  remainingMs: number;
  /** 타이머가 실제로 시작된 시각(ms epoch). timer_log의 started_at에 사용. null이면 아직 시작 전. */
  startedAt: number | null;
}

export function createIdleTimer(kind: TimerKind, durationMs: number): TimerState {
  return { phase: 'idle', kind, durationMs, endAt: null, remainingMs: durationMs, startedAt: null };
}

/** 타이머를 시작(또는 재시작)한다. */
export function startTimer(kind: TimerKind, durationMs: number, now: number): TimerState {
  return {
    phase: 'running',
    kind,
    durationMs,
    endAt: now + durationMs,
    remainingMs: durationMs,
    startedAt: now,
  };
}

/** running 상태를 일시정지한다. running이 아니면 상태를 그대로 반환한다. */
export function pauseTimer(state: TimerState, now: number): TimerState {
  if (state.phase !== 'running') return state;
  const remainingMs = Math.max(0, (state.endAt ?? now) - now);
  return { ...state, phase: 'paused', endAt: null, remainingMs };
}

/** paused 상태를 재개한다. paused가 아니면 상태를 그대로 반환한다. */
export function resumeTimer(state: TimerState, now: number): TimerState {
  if (state.phase !== 'paused') return state;
  return { ...state, phase: 'running', endAt: now + state.remainingMs };
}

/** 타이머를 종료(정지) 상태로 되돌린다 — idle, 남은 시간은 원래 duration으로 리셋. */
export function stopTimer(state: TimerState): TimerState {
  return createIdleTimer(state.kind, state.durationMs);
}

/**
 * 현재 시각 기준으로 상태를 재계산한다. running이 아니면 그대로 반환.
 * endAt에 도달하면 phase가 'expired'로 전이하고 remainingMs=0이 된다.
 */
export function tickTimer(state: TimerState, now: number): TimerState {
  if (state.phase !== 'running' || state.endAt == null) return state;
  const remainingMs = state.endAt - now;
  if (remainingMs <= 0) {
    return { ...state, phase: 'expired', endAt: null, remainingMs: 0 };
  }
  return { ...state, remainingMs };
}

/** 마지막 10초(경고 임계값) 여부. running/expired 상태에서만 의미 있음. */
export function isLastTenSeconds(state: TimerState): boolean {
  return state.remainingMs > 0 && state.remainingMs <= 10_000 && state.phase === 'running';
}

/** 남은 시간을 mm:ss로 포맷한다(음수는 00:00으로 clamp). */
export function formatRemaining(remainingMs: number): string {
  const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
