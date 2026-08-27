/** 카운트다운 타이머 순수 로직 — React/DOM 의존 없음. */

/**
 * 발언 타이머 원터치 프리셋(분). 0.5 = 30초.
 * 30초 규격은 8.29 제5차 회의 운영의 핵심 장치다 — 7·4 실측에서 인사 라운드에
 * 30초 규격을 건 조는 13명이 2분 16초, 규격 없는 조는 9분 45초를 썼다.
 */
export const SPEECH_PRESET_MINUTES = [0.5, 1, 2, 3] as const;

/** 세션 타이머 원터치 프리셋(분) — 8.29 오후 진행표의 블록 값. */
export const SESSION_PRESET_MINUTES = [5, 10, 15, 20, 25, 40] as const;

/**
 * 분 → ms. 0.5분처럼 소수 프리셋도 초 단위 정수를 거쳐 계산해
 * durationMs가 항상 정수 ms가 되게 한다(로그의 duration_s가 30.000000004 같은 값이 되지 않도록).
 */
export function minutesToMs(minutes: number): number {
  return Math.round(minutes * 60) * 1000;
}

/**
 * 프리셋 버튼 라벨 — 1분 미만은 초로 표기한다(0.5분 → 「30초」, 1분 → 「1분」).
 * 큰 숫자와 단위를 따로 렌더하는 버튼 구조에 맞춰 분리해 반환한다.
 */
export function formatPresetLabel(minutes: number): { value: string; unit: string } {
  if (minutes < 1) return { value: String(Math.round(minutes * 60)), unit: '초' };
  return { value: String(minutes), unit: '분' };
}

/** 세션 타이머가 받는 분 범위. 1분 미만·180분 초과는 진행 실수로 본다. */
export const SESSION_MIN_MINUTES = 1;
export const SESSION_MAX_MINUTES = 180;

/**
 * 세션 분 입력칸에 찍힌 글자를 분 값으로 바꾼다.
 *
 * 편집 중에는 칸이 잠시 비거나 「0」이 될 수 있으므로, 그런 값은 확정하지 않고 null을 돌려
 * 호출부가 직전 값을 그대로 두게 한다(입력칸이 스스로 되돌아가 글자를 못 지우는 일이 없도록).
 * 확정 가능한 숫자는 1~180으로 자른다.
 */
export function parseSessionMinutes(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  if (!/^\d{1,4}$/.test(trimmed)) return null;
  const value = Number(trimmed);
  if (value < SESSION_MIN_MINUTES) return null;
  return Math.min(value, SESSION_MAX_MINUTES);
}

/** ＋/− 한 칸 이동. 범위를 벗어나면 경계에서 멈춘다. */
export function stepSessionMinutes(current: number, delta: number): number {
  return Math.min(SESSION_MAX_MINUTES, Math.max(SESSION_MIN_MINUTES, current + delta));
}

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

/**
 * handleStop이 timer_log를 남겨야 하는지 판정한다.
 * expired는 만료 useEffect가 이미 로그를 남겼으므로 중복 방지를 위해 false.
 * running/paused는 수동 종료도 유효한 발언 구간이므로 true. idle은 로그할 구간이 없다.
 */
export function shouldLogOnStop(phase: TimerPhase): boolean {
  return phase === 'running' || phase === 'paused';
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
