import { describe, it, expect } from 'vitest';
import { isValidJoinCode, tallyVotes } from './mod-console';

describe('isValidJoinCode', () => {
  it('6자리 숫자만 허용', () => {
    expect(isValidJoinCode('123456')).toBe(true);
    expect(isValidJoinCode('12345')).toBe(false);
    expect(isValidJoinCode('12345a')).toBe(false);
    expect(isValidJoinCode(' 123456')).toBe(false);
  });
});
describe('tallyVotes', () => {
  const round = { id: 'r', title: 't', type: 'RADIO', options: ['A','B'], status: 'active', team_id: null } as const;
  it('RADIO 집계 + archived 제외', () => {
    const votes = [
      { id: 1, round_id: 'r', choice: 'A', archived_at: null },
      { id: 2, round_id: 'r', choice: 'A', archived_at: null },
      { id: 3, round_id: 'r', choice: 'B', archived_at: '2026-07-24' },
    ];
    expect(tallyVotes(round, votes)).toEqual({ total: 2, byOption: { A: 2, B: 0 } });
  });
  it('CHECKBOX는 배열 각 항목 1카운트', () => {
    const r = { ...round, type: 'CHECKBOX' as const };
    const votes = [{ id: 1, round_id: 'r', choice: ['A','B'], archived_at: null }];
    expect(tallyVotes(r, votes)).toEqual({ total: 1, byOption: { A: 1, B: 1 } });
  });
});
