import { describe, expect, it } from 'vitest';
import { categoryNoteId, type HqCategoryRow, type SubmissionCategory } from './hq-submissions';
import { buildBoards } from '../islands/mod/hq-submission-board-logic';
import { FOUR_CATEGORIES } from '../islands/mod/four-category';
import type { HqSubmissionRow } from './hq-submissions';

/**
 * L3 배정 영속화(US-007)의 이음매 두 곳만 못 박는다.
 * SQL 자체는 vitest로 못 돌리므로, 서버 규격과 화면 규격이 어긋나는 지점을 대신 지킨다.
 */

const TOPIC = '11111111-1111-4111-8111-111111111111';
const TEAM = '22222222-2222-4222-8222-222222222222';
const SUB = '33333333-3333-4333-8333-333333333333';

function row(ordinal: number): HqSubmissionRow {
  return {
    topic_id: TOPIC,
    topic_ordinal: 1,
    topic_prompt: '우리는 ○○을 확인하였다',
    topic_status: 'open',
    team_id: TEAM,
    team_name: '1분과 1조',
    team_subgroup: '1분과',
    table_no: null,
    submission_id: SUB,
    submission_status: 'draft',
    submission_updated_at: null,
    submission_finalized_at: null,
    item_ordinal: ordinal,
    item_kind: 'core',
    item_content: `문장 ${ordinal}`,
    item_rationale: null,
  };
}

describe('categoryNoteId', () => {
  it('보드가 만든 카드 id 와 정확히 같은 문자열을 낸다', () => {
    // 어긋나면 배정이 아무 카드에도 안 붙는데 화면은 조용히 정상으로 보인다.
    const boards = buildBoards([row(1), row(2)]);
    const noteIds = boards[0].teams[0].notes.map((n) => n.id);
    const fromDb = [1, 2].map((ordinal) =>
      categoryNoteId({ topic_id: TOPIC, team_id: TEAM, item_ordinal: ordinal })
    );
    expect(fromDb).toEqual(noteIds);
  });

  it('항목 순번이 다르면 다른 카드를 가리킨다', () => {
    const a = categoryNoteId({ topic_id: TOPIC, team_id: TEAM, item_ordinal: 1 });
    const b = categoryNoteId({ topic_id: TOPIC, team_id: TEAM, item_ordinal: 2 });
    expect(a).not.toBe(b);
  });
});

describe('SubmissionCategory 저장값', () => {
  it('four-category.ts 의 네 범주와 같은 문자열이다', () => {
    // DB check 제약도 같은 네 문자열이다(20260828_s8_submission_category.sql).
    const fromLib: SubmissionCategory[] = ['common', 'difference', 'conflict', 'question'];
    expect(fromLib).toEqual([...FOUR_CATEGORIES]);
  });

  it('해제는 null 이며 화면이 판단한다', () => {
    const cleared: HqCategoryRow = {
      topic_id: TOPIC,
      team_id: TEAM,
      submission_id: SUB,
      item_ordinal: 1,
      category: null,
      actor_label: '본부',
      assigned_at: '2026-08-29T07:00:00Z',
    };
    expect(cleared.category).toBeNull();
    expect(categoryNoteId(cleared)).toBe(`${TOPIC}:${TEAM}:1`);
  });
});
