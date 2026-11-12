import { describe, expect, it } from 'vitest';
import {
  durationLabel,
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
  classifyLoadError,
  clickerStep,
  clockDisplay,
  liveDenominator,
  parsePresent,
  restoreTimer,
  serializeTimer,
  showQr,
  staleSeconds,
  statusText,
  submittedExceedsPresent,
  withTimeout,
  PollTimeoutError,
  type ShowMode,
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

describe('parsePresent — 양의 정수만, 아니면 null(명단 수로 조용히 바꾸지 않는다)', () => {
  it('정수면 그 값(앞뒤 공백 허용)', () => {
    expect(parsePresent('174')).toBe(174);
    expect(parsePresent(' 174 ')).toBe(174);
  });
  it('없거나 0·음수·숫자 아님·단위 붙음·소수·지수면 null', () => {
    for (const raw of [null, undefined, '', '0', '-3', 'abc', '174명', '174.5', '1e2', 'NaN', '17 4']) {
      expect(parsePresent(raw)).toBeNull();
    }
  });
});

describe('liveDenominator — 진행·실시간 분모(출석 없으면 명단 기준이라고 적는다)', () => {
  it('출석이 있으면 출석', () => expect(liveDenominator(174, 180)).toEqual({ n: 174, label: '참석 174명', byRoster: false }));
  it('출석이 없으면 명단 + 「명단 기준」', () => expect(liveDenominator(null, 180)).toEqual({ n: 180, label: '명단 180명 기준', byRoster: true }));
});

describe('submittedExceedsPresent — 제출 > 출석 경고', () => {
  it('하나라도 넘으면 true, 같으면 false, 출석 없으면 false', () => {
    expect(submittedExceedsPresent(174, [100, 175])).toBe(true);
    expect(submittedExceedsPresent(174, [174, 0])).toBe(false);
    expect(submittedExceedsPresent(null, [999])).toBe(false);
  });
});

describe('statusText · showQr · clockDisplay — 서버 상태와 노트북 타이머', () => {
  it('상태 문구(닫힌 매핑)', () => {
    expect(statusText('draft', false)).toBe('투표 시작 전');
    expect(statusText('open', false)).toBe('투표 진행 중');
    expect(statusText('closed', false)).toBe('투표 마감');
    expect(statusText('published', false)).toBe('결과 공개');
    expect(statusText('archived', false)).toBe('');
    expect(statusText('', true)).toBe('');
  });
  it('타이머가 0 이어도 서버가 open 이면 「시간 종료」 — 「투표 마감」은 서버 closed 에서만', () => {
    expect(statusText('open', true)).toBe('시간 종료');
    expect(statusText('closed', true)).toBe('투표 마감');
    expect(statusText('draft', true)).toBe('투표 시작 전');
  });
  it('QR 은 open 에서만', () => {
    expect(showQr('open')).toBe(true);
    for (const s of ['draft', 'closed', 'published', '']) expect(showQr(s)).toBe(false);
  });
  it('시계 칸', () => {
    expect(clockDisplay('open', 61_000, 90_000)).toEqual({ text: '01:01', ended: false });
    expect(clockDisplay('open', 0, 90_000)).toEqual({ text: '시간 종료', ended: true });
    expect(clockDisplay('closed', 30_000, 90_000)).toEqual({ text: '마감', ended: true });
    expect(clockDisplay('published', 0, 90_000)).toEqual({ text: '마감', ended: true });
    expect(clockDisplay('draft', 90_000, 90_000)).toEqual({ text: '01:30', ended: false });
  });
});

describe('타이머 저장 · 되살리기(F5)', () => {
  const now = 1_000_000_000;
  it('저장한 그대로 되살린다(흐르는 중이면 흐름 유지)', () => {
    const t = { durationMs: 90_000, pausedRemainingMs: 50_000, runningSince: now - 5000 };
    const r = restoreTimer(serializeTimer(t, now), 90_000, now + 1000);
    expect(r).toEqual(t);
    expect(timerRemainingMs(r!, now + 1000)).toBe(44_000);
  });
  it('전체 시간이 다르면(min= 바뀜) 버린다', () => {
    const t = { durationMs: 90_000, pausedRemainingMs: 50_000, runningSince: null };
    expect(restoreTimer(serializeTimer(t, now), 120_000, now)).toBeNull();
  });
  it('오래된 값(리허설)은 버린다', () => {
    const t = { durationMs: 90_000, pausedRemainingMs: 0, runningSince: null };
    expect(restoreTimer(serializeTimer(t, now), 90_000, now + 3 * 3600_000 + 1)).toBeNull();
    expect(restoreTimer(serializeTimer(t, now), 90_000, now + 3600_000)).toEqual(t);
  });
  it('없거나 깨진 값은 null', () => {
    expect(restoreTimer(null, 90_000, now)).toBeNull();
    expect(restoreTimer('{broken', 90_000, now)).toBeNull();
    expect(restoreTimer(JSON.stringify({ v: 1, durationMs: 90_000 }), 90_000, now)).toBeNull();
    expect(restoreTimer(JSON.stringify({ v: 1, durationMs: 90_000, pausedRemainingMs: 1, runningSince: 'x', savedAt: now }), 90_000, now)).toBeNull();
  });
});

describe('withTimeout · classifyLoadError · staleSeconds — 읽기 실패', () => {
  it('시간 안에 끝나면 그 값', async () => expect(await withTimeout(Promise.resolve(3), 50)).toBe(3));
  it('끝나지 않으면 PollTimeoutError', async () => {
    await expect(withTimeout(new Promise(() => undefined), 20)).rejects.toBeInstanceOf(PollTimeoutError);
  });
  it('실패는 그대로 넘긴다', async () => {
    await expect(withTimeout(Promise.reject(new Error('x')), 50)).rejects.toThrow('x');
  });
  it('「없는 토큰」과 연결 실패를 가른다', () => {
    expect(classifyLoadError({ message: 'ballot not found' })).toBe('not_found');
    expect(classifyLoadError({ message: 'ballot token required' })).toBe('not_found');
    expect(classifyLoadError({ message: 'TypeError: Failed to fetch' })).toBe('network');
    expect(classifyLoadError(new PollTimeoutError())).toBe('network');
    expect(classifyLoadError(null)).toBe('network');
  });
  it('마지막 성공이 10초보다 오래되면 지난 초', () => {
    expect(staleSeconds(1000, 0, 11_000)).toBeNull();
    expect(staleSeconds(1000, 0, 11_001)).toBe(10);
    expect(staleSeconds(1000, 0, 26_000)).toBe(25);
    // 아직 한 번도 성공 못 했으면 읽기 시작 시각부터
    expect(staleSeconds(null, 5000, 12_000)).toBeNull();
    expect(staleSeconds(null, 5000, 20_000)).toBe(15);
  });
});

describe('clickerStep — PageDown/PageUp 은 투표 중 화면끼리만, 결과 화면에는 닿지 않는다', () => {
  const live: ShowMode = { view: 'live', video: false };
  it('진행 → 실시간 → 영상 → 진행', () => {
    const a = clickerStep(live, 1);
    expect(a).toEqual({ view: 'rotate', video: false });
    const b = clickerStep(a, 1);
    expect(b).toEqual({ view: 'live', video: true });
    expect(clickerStep(b, 1)).toEqual(live);
  });
  it('PageUp 은 거꾸로', () => {
    expect(clickerStep(live, -1)).toEqual({ view: 'live', video: true });
    expect(clickerStep({ view: 'live', video: true }, -1).view).toBe('rotate');
  });
  it('결과 화면에서는 그대로', () => {
    expect(clickerStep({ view: 'detail', video: false }, 1)).toEqual({ view: 'detail', video: false });
    expect(clickerStep({ view: 'summary', video: true }, -1)).toEqual({ view: 'summary', video: true });
  });
  it('어떤 순서로 눌러도 진행·실시간·영상에서 결과 화면으로 가지 않는다', () => {
    const starts: ShowMode[] = [live, { view: 'live', video: true }, { view: 'rotate', video: false }, { view: 'rotate', video: true }];
    for (const s of starts) {
      let m = s;
      let seed = 7;
      for (let i = 0; i < 200; i++) {
        seed = (seed * 1103515245 + 12345) % 2147483648;
        m = clickerStep(m, seed % 2 === 0 ? 1 : -1);
        expect(m.view === 'live' || m.view === 'rotate').toBe(true);
      }
    }
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
  it('durationLabel = 시안 꼴', () => {
    expect(durationLabel(defaultDurationSec(19) * 1000, 19)).toBe('전체 28분 30초 · 권고안 19건 × 1분 30초');
    expect(durationLabel(defaultDurationSec(28) * 1000, 28)).toBe('전체 42분 · 권고안 28건 × 1분 30초');
    expect(durationLabel(30 * 60 * 1000, 19)).toBe('전체 30분 · 권고안 19건');
    expect(durationLabel(30 * 60 * 1000, 0)).toBe('전체 30분');
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
  it('motion=0 이면 움직임 끔, 그 밖에는 켬', () => {
    expect(parseShowParams('?t=x').motion).toBe(true);
    expect(parseShowParams('?motion=0').motion).toBe(false);
    expect(parseShowParams('?motion=1').motion).toBe(true);
  });
});
