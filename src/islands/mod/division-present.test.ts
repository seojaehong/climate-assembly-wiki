import { describe, expect, it } from 'vitest';
import { createAgendaMotion, createMotion, initPrepState, type PrepState } from './division-vote-logic';
import { applyBallotResults, beginVote, confirmHandCount, markBallotClosed, markBallotCreated, markBallotOpened, requestRevote, storedCeremonyItems } from './division-vote-flow';
import { DIVISION_VOTE_FIXTURE } from './division-vote-fixture';
import { isPresentMessage, presentNamesBallot, presentScene, presentTitleSize, type PresentStateMessage } from './division-present';
import type { BallotResults } from '../../lib/deliberation';

const div2 = DIVISION_VOTE_FIXTURE.find((d) => d.division === 2)!;
const NOW = '2026-10-17T07:20:00.000Z';

function base(): PrepState {
  let s = initPrepState(div2);
  for (const [cards, title] of [[['2-1-1'], '다회용기 확대'], [['2-1-2'], '회수 체계']] as const) {
    const r = createMotion(s, { cardNos: [...cards], title, text: '' });
    if (!r.ok) throw new Error(r.error);
    s = r.state;
  }
  return { ...s, attendance: { enrolled: 60, present: 45 } };
}
const msg = (state: PrepState, focus: string | null, counts: Record<string, number> = {}): PresentStateMessage => ({ kind: 'state', v: 1, state, focus, counts });

function open(s: PrepState, id: string, key: string): PrepState {
  const b = beginVote(s, [id], key);
  if (!b.ok) throw new Error(b.error);
  return markBallotOpened(markBallotCreated(b.state, key, { id: `ballot-${key}`, token: `tok-${key}` }), key, NOW);
}
function close(s: PrepState, id: string, key: string, yes: number, no: number, confirm = true): PrepState {
  const rec = s.ballots[key];
  const res: BallotResults = {
    id: rec.ballotId ?? 'b', title: 't', status: 'closed', subgroup: '2분과', responses: yes + no,
    items: [{ id: 'i0', ordinal: 1, statement: rec.statements[0], scale: 2, n: yes + no, avg: null, dist: { '1': no, '2': yes } }],
  };
  const r = applyBallotResults(s, key, res, NOW);
  if (!r.ok) throw new Error(r.error);
  return confirm ? confirmHandCount(r.state, id, 1, 'none') : r.state;
}

describe('presentScene', () => {
  it('idle without message or focus', () => {
    expect(presentScene(null).kind).toBe('idle');
    expect(presentScene(msg(base(), null))).toEqual({ kind: 'idle', division: 2 });
  });

  it('shows the focused motion with its live title', () => {
    const s = base();
    const sc = presentScene(msg(s, '2-1-안2'));
    expect(sc.kind).toBe('motion');
    if (sc.kind === 'motion') expect(sc.motion.title).toBe('회수 체계');
  });

  it('an open vote wins over focus, with the polled count', () => {
    const s = open(base(), '2-1-안1', 'k1');
    const sc = presentScene(msg(s, '2-1-안2', { 'ballot-k1': 17 }));
    expect(sc.kind).toBe('vote');
    if (sc.kind === 'vote') {
      expect(sc.motion?.id).toBe('2-1-안1');
      expect(sc.count).toBe(17);
    }
  });

  it('after closing, the focused motion shows its result (provisional until hand count)', () => {
    let s = open(base(), '2-1-안1', 'k1');
    s = close(s, '2-1-안1', 'k1', 31, 9, false);
    let sc = presentScene(msg(s, '2-1-안1'));
    expect(sc.kind).toBe('result');
    if (sc.kind === 'result') {
      expect([sc.yes, sc.no, sc.threshold, sc.provisional]).toEqual([31, 9, 30, true]);
    }
    s = confirmHandCount(s, '2-1-안1', 1, 'none');
    sc = presentScene(msg(s, '2-1-안1'));
    if (sc.kind === 'result') expect(sc.provisional).toBe(false);
  });

  it('a failed motion being reworded for round 2 shows the motion, not the old result', () => {
    let s = open(base(), '2-1-안1', 'k1');
    s = close(s, '2-1-안1', 'k1', 10, 30);
    const r = requestRevote(s, '2-1-안1');
    s = 'state' in r ? (r as { state: PrepState }).state : (r as PrepState);
    expect(presentScene(msg(s, '2-1-안1')).kind).toBe('motion');
  });

  it('validates messages and sizes titles for 1920 screens', () => {
    expect(isPresentMessage({ kind: 'alive', v: 1 })).toBe(true);
    expect(isPresentMessage({ kind: 'state', v: 2 })).toBe(false);
    expect(presentTitleSize('짧은 제목')).toBe(96);
    expect(presentTitleSize('가'.repeat(300))).toBe(44);
  });
});

describe('실명 투표(10/17) — 발표 창 이름 화면 신호', () => {
  it('names 칸이 있어도 없어도 같은 v1 메시지로 받는다(옛 운영 화면 호환)', () => {
    const base = { kind: 'state', v: 1, state: {}, focus: null, counts: {} };
    expect(isPresentMessage(base)).toBe(true);
    expect(isPresentMessage({ ...base, names: 'ballot-1' })).toBe(true);
  });
});

describe('발표 창 이름 화면 — 노트북 값이 기준, 돌아가기가 먹는다', () => {
  it('노트북이 보내면 띄우고, 발표 창 [돌아가기]는 그 값이 그대로인 동안만 이긴다', () => {
    expect(presentNamesBallot('b1', null, 'b1')).toBe('b1');
    // 발표 창에서 돌아가기
    const back = { msgNames: 'b1', show: null };
    expect(presentNamesBallot('b1', back, 'b1')).toBeNull();
    // 노트북이 다시 보내면(값이 바뀌면) 발표 창 누름은 잊는다
    expect(presentNamesBallot('b2', back, 'b2')).toBe('b2');
    // 노트북이 끄면 발표 창에서 직접 연 것도 그 값(null)에 묶여 있을 때만 남는다
    expect(presentNamesBallot(null, { msgNames: null, show: 'b1' }, 'b1')).toBe('b1');
    expect(presentNamesBallot(null, { msgNames: 'b1', show: 'b1' }, 'b1')).toBeNull();
  });
  it('지금 결과 장면의 투표가 아니면 띄우지 않는다', () => {
    expect(presentNamesBallot('b1', null, 'b2')).toBeNull();
    expect(presentNamesBallot('b1', null, null)).toBeNull();
  });
});

describe('큰 화면 판정 — 판정 불가를 「부결」로 보이지 않는다', () => {
  const R = (o: Partial<import('./division-vote-logic').MotionRound>) => ({
    round: 1, requestId: 'a', title: 't', onlineYes: 30, onlineNo: 5, handYes: 0, handNo: 0,
    enrolled: 60, present: 45, verdict: null, closedAt: '2026-10-17T07:00:00Z', ...o,
  }) as import('./division-vote-logic').MotionRound;
  it('가결·부결은 그대로', async () => {
    const { presentVerdict } = await import('./division-present');
    expect(presentVerdict(R({}), false).word).toBe('가결');
    expect(presentVerdict(R({ onlineYes: 5, onlineNo: 30 }), false).word).toBe('부결');
  });
  it('참석 인원 비었음·찬반이 참석보다 많음·정족수 미달 → 판정불가 + 짧은 이유', async () => {
    const { presentVerdict } = await import('./division-present');
    const a = presentVerdict(R({ present: null }), false);
    expect(a).toEqual({ word: '판정불가', tone: 'warn', reason: '참석 인원 확인 중' });
    const b = presentVerdict(R({ onlineYes: 40, onlineNo: 10 }), false);
    expect(b.word).toBe('판정불가');
    expect(b.reason).toBe('찬반 합계가 참석 인원보다 많음');
    const c = presentVerdict(R({ present: 10 , onlineYes: 5, onlineNo: 1 }), false);
    expect(c.word).toBe('판정불가');
    expect(c.reason).toBe('의사정족수 미달');
  });
  it('거수 확인 전은 집계 중', async () => {
    const { presentVerdict } = await import('./division-present');
    expect(presentVerdict(R({ present: null }), true).word).toBe('집계 중');
  });
  it('발표 창 결과 화면이 판정불가를 그린다', async () => {
    const { createElement } = await import('react');
    const { renderToStaticMarkup } = await import('react-dom/server');
    const { ResultView } = await import('./DivisionPresentScreen');
    const { presentVerdict } = await import('./division-present');
    const html = renderToStaticMarkup(
      createElement(ResultView, {
        division: 1, motion: { id: '1-1-안1' } as never, title: '안', yes: 40, no: 10, threshold: null,
        verdict: presentVerdict(R({ onlineYes: 40, onlineNo: 10 }), false), roundNo: 1,
      }),
    );
    expect(html).toContain('data-verdict="판정불가"');
    expect(html).not.toContain('부결');
  });
});

describe('제출자 대조 차수 — 투표 중에도 보인다', () => {
  it('지금 차수(열림) → 그 투표, 무효면 마지막 결과 차수, 없으면 null', async () => {
    const { reconcileRoundOf } = await import('./division-present');
    const ballots = { a: { ballotId: 'A', voidedAt: undefined }, b: { ballotId: 'B', voidedAt: undefined }, c: { ballotId: null, voidedAt: undefined }, v: { ballotId: 'V', voidedAt: 'x' } };
    expect(reconcileRoundOf({ requestId: 'b', round: 2 }, { requestId: 'a', round: 1 }, ballots)).toEqual({ ballotId: 'B', round: 2 });
    expect(reconcileRoundOf({ requestId: 'c', round: 2 }, { requestId: 'a', round: 1 }, ballots)).toEqual({ ballotId: 'A', round: 1 });
    expect(reconcileRoundOf({ requestId: 'v', round: 2 }, null, ballots)).toBeNull();
    expect(reconcileRoundOf(null, null, ballots)).toBeNull();
  });
});

describe('10/17 시뮬레이션 — 발표 창 흐름', () => {
  it('마감 뒤 결과를 받기 전에는 안 제목이 아니라 「집계 중」(첫 안 공백)', () => {
    let s = open(base(), '2-1-안1', 'k1');
    s = markBallotClosed(s, 'k1', NOW);
    const sc = presentScene(msg(s, '2-1-안1'));
    expect(sc.kind).toBe('counting');
    s = close(s, '2-1-안1', 'k1', 31, 9);
    expect(presentScene(msg(s, '2-1-안1')).kind).toBe('result');
  });
  it('세리머니가 오면 무엇보다 먼저 세리머니', () => {
    const s = open(base(), '2-1-안1', 'k1');
    const ceremony = { division: 2, enrolled: 60, present: 45, items: [], sourceLabel: '투표 결과', step: { phase: 'intro' as const, index: 0 } };
    const sc = presentScene({ ...msg(s, '2-1-안1'), ceremony });
    expect(sc).toEqual({ kind: 'ceremony', ceremony });
    expect(presentScene({ ...msg(s, '2-1-안1'), ceremony: null }).kind).toBe('vote');
  });
});

describe('세리머니 항목 — 투표한 순서, 위임 의결은 따로', () => {
  it('안 번호 순이 아니라 연 순서, 위임 의결은 맨 뒤 「문구 작성 위임 의결」', () => {
    let s = base();
    const d = createAgendaMotion(s, { title: '2분과 최종 권고안 문구 작성 위임 의결', text: '', key: 'baseline-delegate' });
    if (!d.ok) throw new Error();
    s = d.state;
    const delegId = d.motion.id;
    // 위임 → 안2 → 안1 순서로 연다(시각 다르게).
    const at = (k: string, iso: string) => ({ ...s, ballots: { ...s.ballots, [k]: { ...s.ballots[k], openedAt: iso } } });
    s = open(s, delegId, 'kd');
    s = at('kd', '2026-10-17T07:00:00Z');
    s = close(s, delegId, 'kd', 40, 2);
    s = open(s, '2-1-안2', 'k2');
    s = at('k2', '2026-10-17T07:05:00Z');
    s = close(s, '2-1-안2', 'k2', 31, 9);
    s = open(s, '2-1-안1', 'k1');
    s = at('k1', '2026-10-17T07:10:00Z');
    s = close(s, '2-1-안1', 'k1', 10, 30);
    const items = storedCeremonyItems(s);
    expect(items.map((i) => i.label)).toEqual(['2-1-안2', '2-1-안1', '문구 작성 위임 의결']);
    expect(items[2].kind).toBe('delegation');
  });
});
