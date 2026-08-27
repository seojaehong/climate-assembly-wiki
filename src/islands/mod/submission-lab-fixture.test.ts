import { describe, it, expect } from 'vitest';
import type { HqSubmissionRow } from '../../lib/hq-submissions';
import { buildBoards } from './hq-submission-board-logic';
import fixtureRaw from '../../../automation/fixtures/0829-submissions.json';

/**
 * /ko/moderator/insights/submission-lab 이 먹는 픽스처의 성질을 못 박는다.
 *
 * 이 픽스처는 L1~L4(유사 정렬·닮은 짝·4범주·대표 지목) 화면을 브라우저로 검증하는 유일한
 * 입력이다. 「조 사이에 겹치는 문장」이 없어지면 유사도 화면이 아무것도 못 보여주면서도
 * 테스트는 통과하는 상태가 된다 — 그래서 겹침 자체를 여기서 검사한다.
 */

const rows = fixtureRaw as HqSubmissionRow[];

describe('0829 submissions fixture', () => {
  it('has 15 teams across 3 꼭지', () => {
    const boards = buildBoards(rows);
    expect(boards).toHaveLength(3);
    expect(boards.map((b) => b.ordinal)).toEqual([1, 2, 3]);
    for (const board of boards) {
      expect(board.teams).toHaveLength(15);
      expect(board.teamsWithNotes).toBe(15);
    }
  });

  it('gives every team 1~3 항목 in every 꼭지', () => {
    for (const board of buildBoards(rows)) {
      for (const team of board.teams) {
        expect(team.notes.length).toBeGreaterThanOrEqual(1);
        expect(team.notes.length).toBeLessThanOrEqual(3);
      }
    }
  });

  it('names teams as N분과 M조 — teamSortKey and the ontology bridge both regex on that', () => {
    for (const row of rows) expect(row.team_name).toMatch(/^\d분과 \d조$/);
  });

  it('repeats some sentences across different teams — 공통이 실제로 생겨야 한다', () => {
    for (const board of buildBoards(rows)) {
      const teamsByContent = new Map<string, Set<string>>();
      for (const team of board.teams) {
        for (const note of team.notes) {
          const seen = teamsByContent.get(note.content) ?? new Set<string>();
          seen.add(team.teamName);
          teamsByContent.set(note.content, seen);
        }
      }
      const shared = [...teamsByContent.values()].filter((teams) => teams.size >= 2);
      expect(shared.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('also keeps sentences only one team wrote — 차이(소수의견)가 남아야 한다', () => {
    for (const board of buildBoards(rows)) {
      const count = new Map<string, number>();
      for (const team of board.teams) {
        for (const note of team.notes) count.set(note.content, (count.get(note.content) ?? 0) + 1);
      }
      const solo = [...count.values()].filter((n) => n === 1);
      expect(solo.length).toBeGreaterThanOrEqual(3);
    }
  });

  it('matches the HqSubmissionRow shape the RPC returns', () => {
    for (const row of rows) {
      expect(row.topic_status).toBe('open');
      expect(['core', 'extra']).toContain(row.item_kind);
      expect(typeof row.item_content).toBe('string');
      expect(row.item_content?.trim()).toBeTruthy();
      expect(typeof row.item_ordinal).toBe('number');
      expect(row.item_rationale === null || typeof row.item_rationale === 'string').toBe(true);
      expect(row.table_no === null || typeof row.table_no === 'string').toBe(true);
    }
  });
});
