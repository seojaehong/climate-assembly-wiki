import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  createIdleTimer,
  startTimer,
  pauseTimer,
  resumeTimer,
  stopTimer,
  tickTimer,
  isLastTenSeconds,
  formatRemaining,
  type TimerState,
} from './timer-logic';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
});
afterEach(() => {
  vi.useRealTimers();
});

describe('createIdleTimer', () => {
  it('idle 상태, 남은 시간 = 전체 duration', () => {
    const s = createIdleTimer('speech', 60_000);
    expect(s).toEqual<TimerState>({
      phase: 'idle',
      kind: 'speech',
      durationMs: 60_000,
      endAt: null,
      remainingMs: 60_000,
      startedAt: null,
    });
  });
});

describe('startTimer', () => {
  it('running 상태로 전이하고 endAt = now + duration', () => {
    const s = startTimer('speech', 60_000, 1_000);
    expect(s.phase).toBe('running');
    expect(s.endAt).toBe(61_000);
    expect(s.remainingMs).toBe(60_000);
    expect(s.startedAt).toBe(1_000);
  });
});

describe('tickTimer — 남은 초 계산', () => {
  it('running 상태에서 now가 지나면 remainingMs 감소', () => {
    let s = startTimer('speech', 60_000, 0);
    s = tickTimer(s, 10_000);
    expect(s.remainingMs).toBe(50_000);
    expect(s.phase).toBe('running');
  });

  it('idle/paused 상태는 그대로 반환(변화 없음)', () => {
    const idle = createIdleTimer('session', 30_000);
    expect(tickTimer(idle, 5_000)).toBe(idle);
  });

  it('vi.useFakeTimers()로 시간 진행 후 tick', () => {
    let s = startTimer('speech', 5_000, Date.now());
    vi.advanceTimersByTime(3_000);
    s = tickTimer(s, Date.now());
    expect(s.remainingMs).toBe(2_000);
  });
});

describe('tickTimer — 만료 판정', () => {
  it('now >= endAt이면 phase=expired, remainingMs=0', () => {
    let s = startTimer('speech', 5_000, 0);
    s = tickTimer(s, 5_000);
    expect(s.phase).toBe('expired');
    expect(s.remainingMs).toBe(0);
    expect(s.endAt).toBeNull();
  });

  it('now가 endAt을 초과해도 remainingMs는 음수가 아닌 0으로 clamp', () => {
    let s = startTimer('speech', 5_000, 0);
    s = tickTimer(s, 9_999);
    expect(s.phase).toBe('expired');
    expect(s.remainingMs).toBe(0);
  });

  it('만료 후 다시 tick해도 expired 상태 유지(그대로 반환)', () => {
    let s = startTimer('speech', 1_000, 0);
    s = tickTimer(s, 1_000);
    const again = tickTimer(s, 5_000);
    expect(again).toBe(s);
  });
});

describe('pauseTimer / resumeTimer', () => {
  it('running → paused: remainingMs 고정, endAt null', () => {
    let s = startTimer('speech', 60_000, 0);
    s = tickTimer(s, 20_000); // remaining 40_000
    s = pauseTimer(s, 20_000);
    expect(s.phase).toBe('paused');
    expect(s.endAt).toBeNull();
    expect(s.remainingMs).toBe(40_000);
  });

  it('paused → running: endAt = now + remainingMs 재계산', () => {
    let s = startTimer('speech', 60_000, 0);
    s = pauseTimer(s, 10_000); // remaining 50_000
    s = resumeTimer(s, 100_000);
    expect(s.phase).toBe('running');
    expect(s.endAt).toBe(150_000);
  });

  it('idle 상태에서 pauseTimer 호출하면 변화 없음', () => {
    const idle = createIdleTimer('speech', 60_000);
    expect(pauseTimer(idle, 0)).toBe(idle);
  });

  it('running 상태에서 resumeTimer 호출하면 변화 없음', () => {
    const running = startTimer('speech', 60_000, 0);
    expect(resumeTimer(running, 1_000)).toBe(running);
  });
});

describe('stopTimer', () => {
  it('idle로 리셋(남은 시간도 원래 duration으로)', () => {
    let s = startTimer('session', 900_000, 0);
    s = tickTimer(s, 800_000);
    s = stopTimer(s);
    expect(s.phase).toBe('idle');
    expect(s.remainingMs).toBe(900_000);
    expect(s.startedAt).toBeNull();
  });
});

describe('isLastTenSeconds', () => {
  it('remainingMs<=10000이고 running이면 true', () => {
    let s = startTimer('speech', 60_000, 0);
    s = tickTimer(s, 51_000); // remaining 9_000
    expect(isLastTenSeconds(s)).toBe(true);
  });
  it('remainingMs=10000 경계는 true', () => {
    let s = startTimer('speech', 60_000, 0);
    s = tickTimer(s, 50_000); // remaining 10_000
    expect(isLastTenSeconds(s)).toBe(true);
  });
  it('remainingMs>10000이면 false', () => {
    let s = startTimer('speech', 60_000, 0);
    s = tickTimer(s, 40_000); // remaining 20_000
    expect(isLastTenSeconds(s)).toBe(false);
  });
  it('expired 상태는 false(만료 알림은 별도 처리)', () => {
    let s = startTimer('speech', 5_000, 0);
    s = tickTimer(s, 5_000);
    expect(isLastTenSeconds(s)).toBe(false);
  });
  it('idle 상태는 false', () => {
    expect(isLastTenSeconds(createIdleTimer('speech', 60_000))).toBe(false);
  });
});

describe('formatRemaining', () => {
  it('mm:ss 포맷, 초 단위 올림', () => {
    expect(formatRemaining(60_000)).toBe('01:00');
    expect(formatRemaining(125_000)).toBe('02:05');
    expect(formatRemaining(8_400)).toBe('00:09'); // 8.4s -> ceil 9s
    expect(formatRemaining(0)).toBe('00:00');
  });
  it('음수는 00:00으로 clamp', () => {
    expect(formatRemaining(-500)).toBe('00:00');
  });
});
