import { describe, it, expect } from 'vitest';
import type { HqSubmissionRow } from '../../lib/hq-submissions';
import {
  buildBoards,
  flattenNotes,
  silentTeams,
  filterNotes,
  teamSortKey,
  noteColor,
  boardToText,
  NOTE_COLORS,
  subgroupOf,
  subgroupsOf,
  groupBySubgroup,
  filterBoardBySubgroup,
} from './hq-submission-board-logic';

function row(over: Partial<HqSubmissionRow> = {}): HqSubmissionRow {
  return {
    topic_id: 't1',
    topic_ordinal: 1,
    topic_prompt: '배경·문제 인식',
    topic_status: 'open',
    team_id: 'team-1',
    team_name: '1분과 1조',
    team_subgroup: '1분과',
    table_no: null,
    submission_status: 'draft',
    submission_updated_at: '2026-08-29T05:00:00Z',
    submission_finalized_at: null,
    submission_id: 'sub-1',
    item_ordinal: 1,
    item_kind: 'core',
    item_content: '대중교통이 부족하다',
    item_rationale: null,
    ...over,
  };
}

describe('teamSortKey', () => {
  it('sorts 10조 after 2조 — plain string order would not', () => {
    const names = ['1분과 10조', '1분과 2조', '1분과 1조'];
    const sorted = [...names].sort((a, b) => {
      const [ax, ay] = teamSortKey(a);
      const [bx, by] = teamSortKey(b);
      return ax - bx || ay - by;
    });
    expect(sorted).toEqual(['1분과 1조', '1분과 2조', '1분과 10조']);
  });

  it('pushes unrecognised names to the end instead of crashing', () => {
    expect(teamSortKey('테스트조')[0]).toBe(Number.MAX_SAFE_INTEGER);
  });
});

describe('buildBoards', () => {
  it('folds flat rows into 꼭지 → 조 → 포스트잇', () => {
    const boards = buildBoards([
      row(),
      row({ item_ordinal: 2, item_content: '배차 간격이 길다' }),
      row({ team_id: 'team-2', team_name: '1분과 2조', item_ordinal: 1, item_content: '요금이 비싸다' }),
    ]);
    expect(boards).toHaveLength(1);
    expect(boards[0].teams).toHaveLength(2);
    expect(boards[0].teams[0].notes.map((n) => n.content)).toEqual([
      '대중교통이 부족하다',
      '배차 간격이 길다',
    ]);
    expect(boards[0].totalNotes).toBe(3);
    expect(boards[0].teamsWithNotes).toBe(2);
  });

  it('orders 꼭지 by ordinal, not by arrival', () => {
    const boards = buildBoards([
      row({ topic_id: 't3', topic_ordinal: 3, topic_prompt: '의제와 관련된 질문' }),
      row({ topic_id: 't1', topic_ordinal: 1, topic_prompt: '배경·문제 인식' }),
      row({ topic_id: 't2', topic_ordinal: 2, topic_prompt: '바라는 변화(기대 효과)' }),
    ]);
    expect(boards.map((b) => b.prompt)).toEqual([
      '배경·문제 인식',
      '바라는 변화(기대 효과)',
      '의제와 관련된 질문',
    ]);
  });

  // 본부의 관심사 절반은 "아직 안 낸 조가 어디인가" 이므로 빈 조를 지우면 안 된다.
  it('keeps a team that has written nothing as an empty column', () => {
    const boards = buildBoards([
      row(),
      row({
        team_id: 'team-9',
        team_name: '3분과 5조',
        submission_status: null,
        submission_updated_at: null,
        item_ordinal: null,
        item_kind: null,
        item_content: null,
        item_rationale: null,
      }),
    ]);
    expect(boards[0].teams).toHaveLength(2);
    expect(boards[0].teamsWithNotes).toBe(1);
    expect(silentTeams(boards[0])).toEqual(['3분과 5조']);
  });

  it('treats a whitespace-only item as nothing written', () => {
    const boards = buildBoards([row({ item_content: '   ' })]);
    expect(boards[0].totalNotes).toBe(0);
    expect(silentTeams(boards[0])).toEqual(['1분과 1조']);
  });

  it('sorts 조 by 분과 then 조 number across 분과', () => {
    const boards = buildBoards([
      row({ team_id: 'c', team_name: '2분과 1조' }),
      row({ team_id: 'a', team_name: '1분과 10조' }),
      row({ team_id: 'b', team_name: '1분과 2조' }),
    ]);
    expect(boards[0].teams.map((t) => t.teamName)).toEqual([
      '1분과 2조',
      '1분과 10조',
      '2분과 1조',
    ]);
  });

  it('carries the lock status so 본부 can see a finalised 조', () => {
    const boards = buildBoards([row({ submission_status: 'final' })]);
    expect(boards[0].teams[0].status).toBe('final');
  });

  it('returns an empty list for no rows', () => {
    expect(buildBoards([])).toEqual([]);
  });
});

describe('flattenNotes', () => {
  it('reads every card across 조 in one line', () => {
    const boards = buildBoards([
      row(),
      row({ team_id: 'team-2', team_name: '1분과 2조', item_content: '요금이 비싸다' }),
    ]);
    expect(flattenNotes(boards[0]).map((n) => n.content)).toEqual([
      '대중교통이 부족하다',
      '요금이 비싸다',
    ]);
  });
});

describe('filterNotes', () => {
  const notes = flattenNotes(
    buildBoards([
      row({ table_no: '7' }),
      row({ team_id: 'team-2', team_name: '2분과 3조', item_content: '요금이 비싸다', table_no: '12' }),
    ])[0]
  );

  it('returns everything for an empty query', () => {
    expect(filterNotes(notes, '  ')).toHaveLength(2);
  });

  it('matches on note content', () => {
    expect(filterNotes(notes, '요금').map((n) => n.content)).toEqual(['요금이 비싸다']);
  });

  it('matches on team name', () => {
    expect(filterNotes(notes, '2분과')).toHaveLength(1);
  });

  it('matches on the seat number 본부 actually calls out', () => {
    expect(filterNotes(notes, '12')).toHaveLength(1);
  });
});

describe('noteColor', () => {
  it('gives one 조 the same colour every time', () => {
    expect(noteColor('1분과 1조')).toBe(noteColor('1분과 1조'));
  });

  it('only ever returns a colour from the palette', () => {
    for (const name of ['1분과 1조', '2분과 5조', '3분과 3조', '테스트조']) {
      expect(NOTE_COLORS).toContain(noteColor(name) as (typeof NOTE_COLORS)[number]);
    }
  });
});

describe('boardToText', () => {
  it('writes 조별 blocks and names the silent 조', () => {
    const board = buildBoards([
      row(),
      row({ item_ordinal: 2, item_content: '배차 간격이 길다', item_rationale: '7.4 기록' }),
      row({
        team_id: 'team-9',
        team_name: '3분과 5조',
        item_ordinal: null,
        item_content: null,
        item_rationale: null,
      }),
    ])[0];
    const text = boardToText(board);
    expect(text).toContain('■ 배경·문제 인식  (1개 조 · 2건)');
    expect(text).toContain('[1분과 1조]');
    expect(text).toContain('  1. 대중교통이 부족하다');
    expect(text).toContain('     (근거) 7.4 기록');
    expect(text).toContain('※ 미제출 1개 조 — 3분과 5조');
    // 아무것도 안 쓴 조의 제목 블록은 만들지 않는다.
    expect(text).not.toContain('[3분과 5조]');
  });
});

describe('분과 (subgroup)', () => {
  const board = buildBoards([
    row({ team_id: 'a', team_name: '1분과 1조', team_subgroup: '1분과' }),
    row({ team_id: 'b', team_name: '1분과 2조', team_subgroup: '1분과', item_content: '요금이 비싸다' }),
    row({
      team_id: 'c',
      team_name: '2분과 1조',
      team_subgroup: null,
      item_ordinal: null,
      item_content: null,
    }),
    row({ team_id: 'd', team_name: '3분과 5조', team_subgroup: '3분과', item_content: '교육이 없다' }),
  ])[0];

  it('reads 분과 from the field when present', () => {
    expect(subgroupOf({ subgroup: '2분과', teamName: '2분과 1조' })).toBe('2분과');
  });

  // team.subgroup이 비어 있어도 조 이름으로 복구되어야 한다 — 시드가 빠진 조가 실제로 있었다.
  it('recovers 분과 from the team name when the field is empty', () => {
    expect(subgroupOf({ subgroup: null, teamName: '2분과 1조' })).toBe('2분과');
    expect(subgroupOf({ subgroup: '   ', teamName: '3분과 4조' })).toBe('3분과');
  });

  it('falls back to 기타 for a team that is not in a 분과', () => {
    expect(subgroupOf({ subgroup: null, teamName: '테스트조' })).toBe('기타');
  });

  it('orders 분과 numerically', () => {
    expect(subgroupsOf(board)).toEqual(['1분과', '2분과', '3분과']);
  });

  it('folds teams into 분과 blocks without losing any', () => {
    const blocks = groupBySubgroup(board);
    expect(blocks.map((b) => b.subgroup)).toEqual(['1분과', '2분과', '3분과']);
    expect(blocks.reduce((n, b) => n + b.teams.length, 0)).toBe(board.teams.length);
    expect(blocks[0].totalNotes).toBe(2);
    expect(blocks[0].teamsWithNotes).toBe(2);
  });

  // 아직 아무것도 안 낸 분과도 남아야 한다 — 어디가 안 냈는지가 본부의 관심사다.
  it('keeps a 분과 whose teams have written nothing', () => {
    const blocks = groupBySubgroup(board);
    const second = blocks.find((b) => b.subgroup === '2분과');
    expect(second).toBeDefined();
    expect(second?.teams).toHaveLength(1);
    expect(second?.totalNotes).toBe(0);
  });

  it('returns the whole board when no 분과 is selected', () => {
    expect(filterBoardBySubgroup(board, null)).toBe(board);
  });

  // 걸러 놓고 전체 집계를 보여주면 「우리 분과가 다 냈다」를 잘못 읽는다.
  it('recounts totals for the filtered 분과 only', () => {
    const only1 = filterBoardBySubgroup(board, '1분과');
    expect(only1.teams).toHaveLength(2);
    expect(only1.totalNotes).toBe(2);
    expect(only1.teamsWithNotes).toBe(2);
    const only2 = filterBoardBySubgroup(board, '2분과');
    expect(only2.totalNotes).toBe(0);
    expect(only2.teamsWithNotes).toBe(0);
  });
});
