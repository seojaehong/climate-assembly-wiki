import { describe, expect, it } from 'vitest';
import { createMotion, initPrepState, type PrepState } from './division-vote-logic';
import { applyBallotResults, beginVote, confirmHandCount, markBallotCreated, markBallotOpened, requestRevote } from './division-vote-flow';
import { DIVISION_VOTE_FIXTURE } from './division-vote-fixture';
import { isPresentMessage, presentScene, presentTitleSize, type PresentStateMessage } from './division-present';
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
