import { describe, expect, it } from 'vitest';
import {
  adjustTimer,
  agendaOutcome,
  clockText,
  defaultDurationSec,
  initialTimer,
  itemOutcome,
  parseShowParams,
  participationPct,
  overallTurnout,
  passThreshold,
  resetTimer,
  resolvePresent,
  rotationPanels,
  showModeKey,
  stepPanel,
  timerRemainingMs,
  toggleTimer,
  turnoutBar,
  turnoutPct,
  yesCount,
} from './show-logic';

describe('passThreshold — 참석 P명의 3분의 2 이상(올림)', () => {
  it('174 → 116, 173 → 116, 175 → 117, 3 → 2', () => {
    expect(passThreshold(174)).toBe(116);
    expect(passThreshold(173)).toBe(116);
    expect(passThreshold(175)).toBe(117);
    expect(passThreshold(3)).toBe(2);
  });
  it('0 이하는 0', () => {
    expect(passThreshold(0)).toBe(0);
  });
});

describe('resolvePresent — URL present 우선, 없거나 잘못되면 명단 수', () => {
  it('정수면 그 값', () => expect(resolvePresent('174', 180)).toBe(174));
  it('없거나 0·음수·숫자 아님이면 roster', () => {
    expect(resolvePresent(null, 180)).toBe(180);
    expect(resolvePresent('0', 180)).toBe(180);
    expect(resolvePresent('-3', 180)).toBe(180);
    expect(resolvePresent('abc', 180)).toBe(180);
  });
});

describe('participationPct — 제출 / 참석', () => {
  it('131/174 → 75', () => expect(participationPct(131, 174)).toBe(75));
  it('참석 0 이면 0', () => expect(participationPct(5, 0)).toBe(0));
  it('제출이 참석보다 많아도 숫자는 그대로(막대만 자른다)', () => expect(participationPct(180, 174)).toBe(103));
});

describe('yesCount — 저장값 2 = 찬성', () => {
  it('dist["2"]', () => expect(yesCount({ '1': 20, '2': 150 })).toBe(150));
  it('찬성 0표면 키가 없다 → 0', () => expect(yesCount({ '1': 9 })).toBe(0));
});

describe('itemOutcome — 찬성 수 ≥ ceil(2P/3) 이면 가결', () => {
  it('가결선과 같으면 가결', () => {
    expect(itemOutcome({ '2': 116 }, 174)).toEqual({ yes: 116, pct: 67, passed: true, barPct: 116 / 174 * 100 });
  });
  it('가결선 −1 이면 부결', () => {
    expect(itemOutcome({ '2': 115, '1': 50 }, 174).passed).toBe(false);
  });
  it('막대는 100% 에서 자른다', () => {
    expect(itemOutcome({ '2': 200 }, 174).barPct).toBe(100);
  });
});

describe('agendaOutcome — 가결 수 · 부결 수 · 평균 찬성률', () => {
  it('찬성률 평균(분모 P)', () => {
    const o = agendaOutcome([{ '2': 150 }, { '2': 100 }, { '2': 120 }], 174);
    expect(o.passed).toBe(2);
    expect(o.failed).toBe(1);
    expect(o.avgPct).toBe(Math.round(((150 + 100 + 120) / 3 / 174) * 100));
  });
  it('빈 목록이면 0', () => expect(agendaOutcome([], 174)).toEqual({ passed: 0, failed: 0, avgPct: 0 }));
});

describe('타이머 — 종료 시각 기준(탭이 느려져도 밀리지 않는다)', () => {
  it('기본 = 권고 수 × 90초', () => {
    expect(defaultDurationSec(19)).toBe(28 * 60 + 30);
    expect(defaultDurationSec(28)).toBe(42 * 60);
  });
  it('clockText', () => {
    expect(clockText(28 * 60 * 1000 + 30 * 1000)).toBe('28:30');
    expect(clockText(59_001)).toBe('01:00');
    expect(clockText(0)).toBe('00:00');
    expect(clockText(-5)).toBe('00:00');
  });
  it('처음엔 멈춤, Space 로 시작 → 흐름 → 다시 Space 로 일시정지', () => {
    let t = initialTimer(600);
    expect(timerRemainingMs(t, 1000)).toBe(600_000);
    t = toggleTimer(t, 1000);
    expect(t.runningSince).toBe(1000);
    expect(timerRemainingMs(t, 61_000)).toBe(540_000);
    t = toggleTimer(t, 61_000);
    expect(t.runningSince).toBeNull();
    expect(timerRemainingMs(t, 999_999)).toBe(540_000);
  });
  it('0 아래로 가지 않는다', () => {
    const t = toggleTimer(initialTimer(10), 0);
    expect(timerRemainingMs(t, 60_000)).toBe(0);
  });
  it('↑/↓ = ±1분(흐르는 중에도), 0 아래로 내려가지 않는다', () => {
    let t = toggleTimer(initialTimer(600), 0);
    t = adjustTimer(t, +60, 30_000);
    expect(timerRemainingMs(t, 30_000)).toBe(630_000);
    t = adjustTimer(t, -60 * 20, 30_000);
    expect(timerRemainingMs(t, 30_000)).toBe(0);
  });
  it('R = 처음 시간으로, 멈춤', () => {
    let t = toggleTimer(initialTimer(600), 0);
    t = resetTimer(t);
    expect(t.runningSince).toBeNull();
    expect(timerRemainingMs(t, 100_000)).toBe(600_000);
  });
});

describe('turnoutPct — 실시간 화면 투표율(100% 상한, 반올림)', () => {
  it('131/174 → 75', () => expect(turnoutPct(131, 174)).toBe(75));
  it('제출이 참석보다 많으면 100', () => expect(turnoutPct(180, 174)).toBe(100));
  it('참석 0 이면 0', () => expect(turnoutPct(5, 0)).toBe(0));
});

describe('overallTurnout — 제출 합 / (참석 × 의제 수), 투표 중 합', () => {
  it('의제 셋', () => {
    const o = overallTurnout(
      [
        { submitted: 100, in_progress: 10 },
        { submitted: 80, in_progress: 5 },
        { submitted: 60, in_progress: 0 },
      ],
      174,
    );
    expect(o).toEqual({ submitted: 240, capacity: 522, pct: Math.round((240 / 522) * 100), inProgress: 15 });
  });
  it('의제 하나', () => {
    expect(overallTurnout([{ submitted: 2, in_progress: 1 }], 10)).toEqual({ submitted: 2, capacity: 10, pct: 20, inProgress: 1 });
  });
  it('상한 100, 참석 0 이면 0, 빈 목록이면 0', () => {
    expect(overallTurnout([{ submitted: 300, in_progress: 0 }], 174).pct).toBe(100);
    expect(overallTurnout([{ submitted: 3, in_progress: 0 }], 0).pct).toBe(0);
    expect(overallTurnout([], 174)).toEqual({ submitted: 0, capacity: 0, pct: 0, inProgress: 0 });
  });
});

describe('turnoutBar — 막대(제출)와 투표 시작 표시선 위치(%)', () => {
  it('제출 50 · 시작 80 / 참석 100', () => expect(turnoutBar(50, 80, 100)).toEqual({ submittedPct: 50, startedPct: 80 }));
  it('넘치면 100 에서 자른다, 참석 0 이면 0', () => {
    expect(turnoutBar(120, 150, 100)).toEqual({ submittedPct: 100, startedPct: 100 });
    expect(turnoutBar(1, 2, 0)).toEqual({ submittedPct: 0, startedPct: 0 });
  });
});

describe('rotationPanels · stepPanel — 실시간 순환 판', () => {
  it('의제 하나 주소 = 전체 투표율 → 그 의제 큰 판', () => expect(rotationPanels(1)).toEqual(['overall', 'single']));
  it('종합 주소 = 전체 투표율 → 의제별 투표율', () => expect(rotationPanels(3)).toEqual(['overall', 'agendas']));
  it('앞뒤로 넘기면 돌아 나간다', () => {
    expect(stepPanel(0, 2, 1)).toBe(1);
    expect(stepPanel(1, 2, 1)).toBe(0);
    expect(stepPanel(0, 2, -1)).toBe(1);
    expect(stepPanel(0, 0, 1)).toBe(0);
  });
});

describe('showModeKey — 의제 하나 주소의 화면 전환(1·2·3·4·V)', () => {
  const live = { view: 'live', video: false } as const;
  it('V = 진행 화면에서 영상 켜고 끄기', () => {
    expect(showModeKey(live, 'V')).toEqual({ view: 'live', video: true });
    expect(showModeKey({ view: 'live', video: true }, 'V')).toEqual({ view: 'live', video: false });
  });
  it('영상 중 2·3 → 결과, 1 이나 V 로 영상에 돌아온다', () => {
    const d = showModeKey({ view: 'live', video: true }, '2');
    expect(d).toEqual({ view: 'detail', video: true });
    expect(showModeKey(d, '1')).toEqual({ view: 'live', video: true });
    expect(showModeKey(showModeKey(d, '3'), 'V')).toEqual({ view: 'live', video: true });
  });
  it('결과 화면에서 V 는 영상 없던 때에도 영상으로 간다', () => {
    expect(showModeKey({ view: 'summary', video: false }, 'V')).toEqual({ view: 'live', video: true });
  });
  it('4 = 실시간 들어가기, 다시 4 = 진행 화면', () => {
    const r = showModeKey(live, '4');
    expect(r).toEqual({ view: 'rotate', video: false });
    expect(showModeKey(r, '4')).toEqual({ view: 'live', video: false });
  });
});

describe('parseShowParams', () => {
  it('토큰 하나 + present + min', () => {
    const p = parseShowParams('?t=a4cc141045e5bf384714cf17c3a9cd37&present=174&min=20');
    expect(p.tokens).toEqual(['a4cc141045e5bf384714cf17c3a9cd37']);
    expect(p.present).toBe('174');
    expect(p.minutes).toBe(20);
  });
  it('토큰 셋(쉼표), 32자가 아닌 것은 버린다', () => {
    const a = 'a'.repeat(32);
    const b = 'b'.repeat(32);
    expect(parseShowParams(`?t=${a},${b},짧음`).tokens).toEqual([a, b]);
  });
  it('min 이 없거나 잘못되면 null', () => {
    expect(parseShowParams('?t=x').minutes).toBeNull();
    expect(parseShowParams('?min=0').minutes).toBeNull();
    expect(parseShowParams('?min=abc').minutes).toBeNull();
  });
});
