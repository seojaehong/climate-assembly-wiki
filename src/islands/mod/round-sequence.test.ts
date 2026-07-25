import { describe, it, expect } from 'vitest';
import type { Round } from '../../lib/mod-console';
import { roundSequence, maxRoundSequence } from './round-sequence';

/** 리터럴 유니온(type/status) 때문에 반환 타입을 Round로 명시해야 한다. */
function round(id: string, teamId: string | null, createdAt?: string, status: Round['status'] = 'closed'): Round {
  return { id, title: `제목 ${id}`, type: 'RADIO', options: ['가', '나'], status, team_id: teamId, created_at: createdAt };
}

function asObject(seq: Map<string, number>): Record<string, number> {
  return Object.fromEntries([...seq.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

describe('roundSequence', () => {
  it('해당 팀 라운드를 created_at 오름차순으로 1부터 번호 매긴다', () => {
    const rounds = [
      round('r-b', 't1', '2026-08-29T10:30:00Z'),
      round('r-a', 't1', '2026-08-29T09:00:00Z'),
      round('r-c', 't1', '2026-08-29T13:15:00Z'),
    ];
    expect(asObject(roundSequence('t1', rounds))).toEqual({ 'r-a': 1, 'r-b': 2, 'r-c': 3 });
  });

  it('다른 팀의 라운드는 번호 계산에 포함하지 않는다', () => {
    const rounds = [
      round('r-x', 't2', '2026-08-29T09:00:00Z'),
      round('r-a', 't1', '2026-08-29T09:30:00Z'),
      round('r-y', 't2', '2026-08-29T10:00:00Z'),
      round('r-b', 't1', '2026-08-29T10:30:00Z'),
      round('r-z', null, '2026-08-29T11:00:00Z'),
    ];
    const seq = roundSequence('t1', rounds);
    expect(asObject(seq)).toEqual({ 'r-a': 1, 'r-b': 2 });
    expect(seq.has('r-x')).toBe(false);
    expect(seq.has('r-z')).toBe(false);
  });

  it('입력 배열 순서에 의존하지 않는다 (원본·역순·셔플이 모두 같은 번호)', () => {
    const rounds = [
      round('r-a', 't1', '2026-08-29T09:00:00Z'),
      round('r-b', 't1', '2026-08-29T10:30:00Z'),
      round('r-c', 't1', '2026-08-29T13:15:00Z'),
    ];
    const expected = { 'r-a': 1, 'r-b': 2, 'r-c': 3 };
    expect(asObject(roundSequence('t1', rounds))).toEqual(expected);
    expect(asObject(roundSequence('t1', [...rounds].reverse()))).toEqual(expected);
    expect(asObject(roundSequence('t1', [rounds[1], rounds[2], rounds[0]]))).toEqual(expected);
  });

  it('created_at이 같으면 id로 안정적인 전순서를 유지한다', () => {
    const same = '2026-08-29T09:00:00Z';
    const rounds = [round('r-b', 't1', same), round('r-a', 't1', same), round('r-c', 't1', same)];
    const expected = { 'r-a': 1, 'r-b': 2, 'r-c': 3 };
    expect(asObject(roundSequence('t1', rounds))).toEqual(expected);
    expect(asObject(roundSequence('t1', [...rounds].reverse()))).toEqual(expected);
  });

  it('created_at이 없는 라운드는 가장 오래된 쪽에 놓이고 id로 갈린다', () => {
    const rounds = [
      round('r-c', 't1', '2026-08-29T09:00:00Z'),
      round('r-b', 't1', undefined),
      round('r-a', 't1', undefined),
    ];
    const expected = { 'r-a': 1, 'r-b': 2, 'r-c': 3 };
    expect(asObject(roundSequence('t1', rounds))).toEqual(expected);
    expect(asObject(roundSequence('t1', [...rounds].reverse()))).toEqual(expected);
  });

  it('status와 무관하게 pending·active·closed 모두 번호를 받는다', () => {
    const rounds = [
      round('r-a', 't1', '2026-08-29T09:00:00Z', 'closed'),
      round('r-b', 't1', '2026-08-29T10:00:00Z', 'active'),
      round('r-c', 't1', '2026-08-29T11:00:00Z', 'pending'),
    ];
    expect(asObject(roundSequence('t1', rounds))).toEqual({ 'r-a': 1, 'r-b': 2, 'r-c': 3 });
  });

  it('빈 배열이면 빈 Map을 돌려준다', () => {
    expect(roundSequence('t1', []).size).toBe(0);
  });

  it('해당 팀 라운드가 하나도 없으면 빈 Map을 돌려준다', () => {
    expect(roundSequence('t9', [round('r-x', 't2', '2026-08-29T09:00:00Z')]).size).toBe(0);
  });

  it('입력 배열을 변형하지 않는다', () => {
    const rounds = [
      round('r-b', 't1', '2026-08-29T10:30:00Z'),
      round('r-a', 't1', '2026-08-29T09:00:00Z'),
    ];
    roundSequence('t1', rounds);
    expect(rounds.map((r) => r.id)).toEqual(['r-b', 'r-a']);
  });
});

describe('maxRoundSequence', () => {
  it('전체 조 중 가장 많이 진행한 조의 회차 수를 돌려준다', () => {
    const rounds = [
      round('r-a', 't1', '2026-08-29T09:00:00Z'),
      round('r-b', 't1', '2026-08-29T10:00:00Z'),
      round('r-x', 't2', '2026-08-29T09:10:00Z'),
      round('r-y', 't2', '2026-08-29T10:10:00Z'),
      round('r-z', 't2', '2026-08-29T11:10:00Z'),
    ];
    expect(maxRoundSequence(rounds)).toBe(3);
  });

  it('빈 배열이면 0이다', () => {
    expect(maxRoundSequence([])).toBe(0);
  });

  it('team_id가 없는 라운드는 세지 않는다', () => {
    expect(maxRoundSequence([round('r-z', null, '2026-08-29T09:00:00Z')])).toBe(0);
    const mixed = [
      round('r-z', null, '2026-08-29T09:00:00Z'),
      round('r-w', null, '2026-08-29T10:00:00Z'),
      round('r-a', 't1', '2026-08-29T11:00:00Z'),
    ];
    expect(maxRoundSequence(mixed)).toBe(1);
  });

  it('조가 1개뿐이면 그 조의 라운드 수가 최대다', () => {
    const rounds = [round('r-a', 't1', '2026-08-29T09:00:00Z'), round('r-b', 't1', '2026-08-29T10:00:00Z')];
    expect(maxRoundSequence(rounds)).toBe(2);
  });

  it('roundSequence가 붙이는 최대 번호와 일치한다', () => {
    const rounds = [
      round('r-a', 't1', '2026-08-29T09:00:00Z'),
      round('r-b', 't1', '2026-08-29T10:00:00Z'),
      round('r-x', 't2', '2026-08-29T09:10:00Z'),
    ];
    const t1Max = Math.max(...roundSequence('t1', rounds).values());
    expect(maxRoundSequence(rounds)).toBe(t1Max);
  });
});
