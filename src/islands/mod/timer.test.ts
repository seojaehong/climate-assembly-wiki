import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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
  SPEECH_PRESET_MINUTES,
  SESSION_PRESET_MINUTES,
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

describe('shouldLogOnStop — 만료 이중 로깅 방지', () => {
  it('expired는 false (만료 useEffect가 이미 로그를 남김)', () => {
    expect(shouldLogOnStop('expired')).toBe(false);
  });
  it('running은 true (수동 종료도 유효한 구간)', () => {
    expect(shouldLogOnStop('running')).toBe(true);
  });
  it('paused는 true (일시정지 중 종료도 유효한 구간)', () => {
    expect(shouldLogOnStop('paused')).toBe(true);
  });
  it('idle은 false (로그할 구간 없음)', () => {
    expect(shouldLogOnStop('idle')).toBe(false);
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

// ── 8.29 제5차 회의 운영 설계용 프리셋 ──────────────────────────────
// 근거: 7·4 녹취 실측에서 인사 라운드에 30초 규격을 건 조는 13명이 2분 16초,
// 규격 없는 조는 9분 45초를 썼다. 30초를 원터치로 걸 수 있어야 한다.

describe('minutesToMs — 30초 프리셋 정확성', () => {
  it('0.5분 = 정확히 30_000ms (부동소수점 오차 없음)', () => {
    expect(minutesToMs(0.5)).toBe(30_000);
  });
  it('기존 1/2/3분 프리셋 값은 그대로', () => {
    expect(minutesToMs(1)).toBe(60_000);
    expect(minutesToMs(2)).toBe(120_000);
    expect(minutesToMs(3)).toBe(180_000);
  });
  it('세션 프리셋 6종 모두 정수 ms', () => {
    expect(SESSION_PRESET_MINUTES.map(minutesToMs)).toEqual([
      300_000, 600_000, 900_000, 1_200_000, 1_500_000, 2_400_000,
    ]);
  });
  it('로깅 표현식(Math.round(durationMs/1000))이 30초에서 30을 낸다', () => {
    // Timer.tsx 만료 로깅 경로와 동일한 식
    expect(Math.round(minutesToMs(0.5) / 1000)).toBe(30);
  });
  it('30초 타이머를 끝까지 돌린 뒤 durationMs 기준 duration_s = 30', () => {
    let s = startTimer('speech', minutesToMs(0.5), 0);
    s = tickTimer(s, 30_000);
    expect(s.phase).toBe('expired');
    expect(Math.round(s.durationMs / 1000)).toBe(30);
  });
  it('30초 타이머 수동 종료 경로((durationMs - remainingMs)/1000)도 정수', () => {
    let s = startTimer('speech', minutesToMs(0.5), 0);
    s = tickTimer(s, 12_000); // 12초 경과
    expect(Math.round((s.durationMs - s.remainingMs) / 1000)).toBe(12);
  });
});

describe('formatPresetLabel — 1분 미만은 초 표기', () => {
  it('0.5분 → 「30초」 (「0.5분」이 아니다)', () => {
    expect(formatPresetLabel(0.5)).toEqual({ value: '30', unit: '초' });
  });
  it('1분 이상은 「N분」 유지', () => {
    expect(formatPresetLabel(1)).toEqual({ value: '1', unit: '분' });
    expect(formatPresetLabel(2)).toEqual({ value: '2', unit: '분' });
    expect(formatPresetLabel(3)).toEqual({ value: '3', unit: '분' });
  });
  it('세션 프리셋도 같은 규칙으로 「N분」', () => {
    expect(formatPresetLabel(40)).toEqual({ value: '40', unit: '분' });
  });
});

describe('프리셋 목록 — 8.29 오후 진행표 블록 값', () => {
  it('발언 프리셋에 30초가 포함되고 기존 1/2/3분이 유지된다', () => {
    expect(SPEECH_PRESET_MINUTES).toEqual([0.5, 1, 2, 3]);
  });
  it('세션 프리셋은 5·10·15·20·25·40분', () => {
    expect(SESSION_PRESET_MINUTES).toEqual([5, 10, 15, 20, 25, 40]);
  });
  it('세션 프리셋 기본값(15분)이 목록에 있다 — 스테퍼 초기값과 일치', () => {
    expect(SESSION_PRESET_MINUTES).toContain(15);
  });
});
