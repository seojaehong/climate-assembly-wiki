import { describe, it, expect } from 'vitest';
import type { Round } from '../../lib/mod-console';
import { roundSequence, maxRoundSequence, teamRoundHistory } from './round-sequence';

/** 리터럴 유니온(type/status) 때문에 반환 타입을 Round로 명시해야 한다. */
function round(id: string, teamId: string | null, createdAt?: string, status: Round['status'] = 'closed'): Round {
  return { id, title: `제목 ${id}`, type: 'RADIO', options: ['가', '나'], status, team_id: teamId, created_at: createdAt };
}

/** 마감 시각(updated_at)까지 지정해야 하는 케이스용. */
function closedRound(id: string, teamId: string, createdAt: string, updatedAt?: string): Round {
  return { ...round(id, teamId, createdAt, 'closed'), updated_at: updatedAt };
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

describe('teamRoundHistory', () => {
  it('회차는 오래된 순으로 매기고 목록은 최신 회차가 먼저 오게 돌려준다', () => {
    const rounds = [
      round('r-a', 't1', '2026-08-29T09:00:00Z'),
      round('r-c', 't1', '2026-08-29T13:15:00Z'),
      round('r-b', 't1', '2026-08-29T10:30:00Z'),
    ];
    const items = teamRoundHistory('t1', rounds, {});
    expect(items.map((i) => [i.id, i.sequence])).toEqual([
      ['r-c', 3],
      ['r-b', 2],
      ['r-a', 1],
    ]);
  });

  it('다른 팀과 전체(team_id null) 라운드는 목록에 넣지 않는다', () => {
    const rounds = [
      round('r-a', 't1', '2026-08-29T09:00:00Z'),
      round('r-x', 't2', '2026-08-29T09:30:00Z'),
      round('r-z', null, '2026-08-29T10:00:00Z'),
    ];
    expect(teamRoundHistory('t1', rounds, {}).map((i) => i.id)).toEqual(['r-a']);
  });

  it('해당 팀 라운드가 없으면 빈 배열이다 (목록 영역을 렌더하지 않기 위한 신호)', () => {
    expect(teamRoundHistory('t1', [], {})).toEqual([]);
    expect(teamRoundHistory('t9', [round('r-x', 't2', '2026-08-29T09:00:00Z')])).toEqual([]);
  });

  it('총 표수는 counts에서 가져오고, 없는 라운드는 null이다 (0표와 구분)', () => {
    const rounds = [
      round('r-a', 't1', '2026-08-29T09:00:00Z'),
      round('r-b', 't1', '2026-08-29T10:00:00Z'),
      round('r-c', 't1', '2026-08-29T11:00:00Z'),
    ];
    const items = teamRoundHistory('t1', rounds, { 'r-a': 7, 'r-b': 0 });
    expect(items.map((i) => [i.id, i.total])).toEqual([
      ['r-c', null],
      ['r-b', 0],
      ['r-a', 7],
    ]);
  });

  it('counts 인자를 생략해도 total은 전부 null이다', () => {
    const items = teamRoundHistory('t1', [round('r-a', 't1', '2026-08-29T09:00:00Z')]);
    expect(items[0].total).toBeNull();
  });

  it('closedAt은 마감된 라운드에만 붙는다 — 진행 중 라운드는 null', () => {
    const rounds = [
      closedRound('r-a', 't1', '2026-08-29T09:00:00Z', '2026-08-29T09:20:00Z'),
      { ...closedRound('r-b', 't1', '2026-08-29T10:00:00Z', '2026-08-29T10:05:00Z'), status: 'active' as const },
    ];
    const items = teamRoundHistory('t1', rounds, {});
    expect(items.map((i) => [i.status, i.closedAt])).toEqual([
      ['active', null],
      ['closed', '2026-08-29T09:20:00Z'],
    ]);
  });

  it('마감됐지만 updated_at이 없으면 closedAt은 null이다 (가짜 시각을 만들지 않는다)', () => {
    const items = teamRoundHistory('t1', [closedRound('r-a', 't1', '2026-08-29T09:00:00Z')], {});
    expect(items[0].closedAt).toBeNull();
  });

  it('결과 다시보기를 위해 원본 Round 객체를 그대로 들려 보낸다', () => {
    const original = round('r-a', 't1', '2026-08-29T09:00:00Z');
    const items = teamRoundHistory('t1', [original], {});
    expect(items[0].round).toBe(original);
    expect(items[0].title).toBe(original.title);
  });

  it('입력 배열 순서에 의존하지 않는다 (원본·역순·셔플이 모두 같은 목록)', () => {
    const rounds = [
      round('r-a', 't1', '2026-08-29T09:00:00Z'),
      round('r-b', 't1', '2026-08-29T10:30:00Z'),
      round('r-c', 't1', '2026-08-29T13:15:00Z'),
    ];
    const expected = [
      ['r-c', 3],
      ['r-b', 2],
      ['r-a', 1],
    ];
    const ids = (rs: Round[]) => teamRoundHistory('t1', rs, {}).map((i) => [i.id, i.sequence]);
    expect(ids(rounds)).toEqual(expected);
    expect(ids([...rounds].reverse())).toEqual(expected);
    expect(ids([rounds[1], rounds[2], rounds[0]])).toEqual(expected);
  });

  it('입력 배열을 변형하지 않는다', () => {
    const rounds = [
      round('r-b', 't1', '2026-08-29T10:30:00Z'),
      round('r-a', 't1', '2026-08-29T09:00:00Z'),
    ];
    teamRoundHistory('t1', rounds, {});
    expect(rounds.map((r) => r.id)).toEqual(['r-b', 'r-a']);
  });
});
