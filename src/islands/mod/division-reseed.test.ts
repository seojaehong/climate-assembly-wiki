import { describe, expect, it } from 'vitest';
import { importSimilarGroups, initPrepState, setCardStatus, type PrepState, type SimilarGroup } from './division-vote-logic';
import { DIVISION_VOTE_FIXTURE } from './division-vote-fixture';
import { setBundleRecord } from './division-bundle';
import { setReviewer } from './division-reviewers';
import { carryOverRecords, humanInput } from './division-reseed';

const G = (id: string, cards: string[]): SimilarGroup => ({ id, division: 2, letter: id.slice(-1), name: id, recs: [], cards, teams: [] });
const seeded = (groups: SimilarGroup[]): PrepState => importSimilarGroups(initPrepState(DIVISION_VOTE_FIXTURE[0]), groups).state;
const NO_PRESET = new Map<string, string>();

describe('다시 깔기 — 사람 입력 세기', () => {
  it('막 깐 판은 사람 입력 0', () => {
    expect(humanInput(seeded([G('2A', ['2-1-1'])]), NO_PRESET)).toEqual([]);
  });
  it('헤쳐모여 기록·검토위원·카드 상태도 사람 입력이다', () => {
    let s = seeded([G('2A', ['2-1-1'])]);
    s = setBundleRecord(s, '2A', { decision: 'merge' });
    s = setReviewer(s, '3', '가나다');
    s = setCardStatus(s, '2-4-1', { status: 'excluded' });
    const h = humanInput(s, NO_PRESET);
    expect(h).toContain('묶음 2A 기록');
    expect(h).toContain('검토위원 1명');
    expect(h.some((x) => x.startsWith('카드 상태 1장'))).toBe(true);
  });
});

describe('다시 깔기 — 기록 옮기기', () => {
  it('새 판에도 있는 묶음 기록과 검토위원은 옮기고, 없는 묶음 기록은 버린 목록에', () => {
    let cur = seeded([G('2A', ['2-1-1']), G('2B', ['2-4-1'])]);
    cur = setBundleRecord(cur, '2A', { decision: 'move', minority: '소수' });
    cur = setBundleRecord(cur, '2B', { decision: 'separate' });
    cur = setReviewer(cur, '1', '가나다');
    const next = seeded([G('2A', ['2-1-1', '2-1-2'])]);
    const r = carryOverRecords(cur, next);
    expect(r.state.bundles?.['2A']).toEqual({ decision: 'move', teams: [], movedRecs: '', minority: '소수' });
    expect(r.state.bundles?.['2B']).toBeUndefined();
    expect(r.state.reviewers).toEqual({ '1': '가나다' });
    expect(r.carried).toEqual(['묶음 2A', '검토위원']);
    expect(r.dropped).toEqual(['묶음 2B']);
    // 안·카드는 새 판 그대로
    expect(r.state.motions).toBe(next.motions);
  });
  it('옮길 것이 없으면 새 판 그대로', () => {
    const next = seeded([G('2A', ['2-1-1'])]);
    const r = carryOverRecords(seeded([]), next);
    expect(r.state).toEqual(next);
    expect(r.carried).toEqual([]);
  });
});
