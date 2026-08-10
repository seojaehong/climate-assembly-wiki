import { describe, expect, it } from 'vitest';
import type { IssueListResult, IssueRow } from '../../../lib/platform';
import { buildAnalysisView, buildScopedAnalysisView } from './analyze-console-logic';

function issue(overrides: Partial<IssueRow> = {}): IssueRow {
  return {
    id: 'issue-1',
    label: '재생에너지 확대',
    stance: 'pro',
    frequency_class: 'consensus',
    summary: '전환 속도를 높이자는 의견입니다.',
    origin: 'ai',
    review_status: 'draft',
    reviewed_by: null,
    reviewed_at: null,
    archived_at: null,
    linked_item_count: 2,
    consensus_denominator: 2,
    ...overrides,
  };
}

function result(issues: IssueRow[]): IssueListResult {
  return {
    topic_id: 'topic-1',
    issues,
    reviewed_count: issues.filter((item) => item.review_status === 'reviewed').length,
    unclassified_count: 3,
  };
}

describe('buildAnalysisView', () => {
  it('쟁점·검수·미분류·원문 연결 요약을 계산한다', () => {
    const view = buildAnalysisView(result([
      issue({ id: 'a', review_status: 'reviewed', origin: 'human', linked_item_count: 4 }),
      issue({ id: 'b', review_status: 'draft', linked_item_count: 2 }),
    ]));

    expect(view.stats).toEqual({
      issueCount: 2,
      reviewedCount: 1,
      unclassifiedCount: 3,
      linkedRelationshipCount: 6,
    });
  });

  it('4×6 코딩 분포에 0건 범주와 미지정을 함께 유지한다', () => {
    const view = buildAnalysisView(result([
      issue({ id: 'a', frequency_class: 'consensus', stance: 'pro' }),
      issue({ id: 'b', frequency_class: 'consensus', stance: 'concern' }),
      issue({ id: 'c', frequency_class: null, stance: null }),
    ]));

    expect(view.frequencyDistribution).toEqual([
      { key: 'consensus', label: '합의', count: 2 },
      { key: 'majority', label: '다수의견', count: 0 },
      { key: 'minority', label: '소수의견', count: 0 },
      { key: 'mixed', label: '혼재', count: 0 },
      { key: 'unassigned', label: '미지정', count: 1 },
    ]);
    expect(view.stanceDistribution.find((item) => item.key === 'pro')?.count).toBe(1);
    expect(view.stanceDistribution.find((item) => item.key === 'concern')?.count).toBe(1);
    expect(view.stanceDistribution.find((item) => item.key === 'unassigned')?.count).toBe(1);
    expect(view.stanceDistribution).toHaveLength(7);
  });
});

describe('buildScopedAnalysisView', () => {
  it('회차의 여러 주제를 하나의 4×6 분석으로 합치고 출처 주제를 보존한다', () => {
    const view = buildScopedAnalysisView('session', [
      {
        target: { id: 'topic-1', label: '에너지 전환' },
        result: result([issue({ id: 'a', review_status: 'reviewed', origin: 'human' })]),
      },
      {
        target: { id: 'topic-2', label: '수송 부문' },
        result: { ...result([issue({ id: 'b', stance: 'concern' })]), topic_id: 'topic-2', unclassified_count: 4 },
      },
    ]);

    expect(view.scope).toBe('session');
    expect(view.stats).toEqual({
      issueCount: 2,
      reviewedCount: 1,
      unclassifiedCount: 7,
      linkedRelationshipCount: 4,
    });
    expect(view.issues.map((item) => [item.id, item.topicId, item.topicLabel])).toEqual([
      ['a', 'topic-1', '에너지 전환'],
      ['b', 'topic-2', '수송 부문'],
    ]);
    expect(view.stanceDistribution.find((item) => item.key === 'concern')?.count).toBe(1);
  });

  it('공론화 집계에서 출처 회차와 주제를 쟁점마다 보존한다', () => {
    const view = buildScopedAnalysisView('assembly', [{
      target: {
        id: 'topic-1',
        label: '에너지 전환',
        sessionId: 'session-1',
        sessionLabel: '제1차 회의',
      },
      result: result([issue({ id: 'a' })]),
    }]);

    expect(view.scope).toBe('assembly');
    expect(view.issues[0]).toMatchObject({
      topicId: 'topic-1',
      topicLabel: '에너지 전환',
      sessionId: 'session-1',
      sessionLabel: '제1차 회의',
    });
  });
});
