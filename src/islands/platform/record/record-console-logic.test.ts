import { describe, expect, it } from 'vitest';
import type { IssueItemsResult } from '../../../lib/platform';
import { buildRecordView } from './record-console-logic';

const firstTopic: IssueItemsResult = {
  topic_id: 'topic-1',
  items: [
    {
      id: 'item-1',
      submission_id: 'submission-1',
      ordinal: 1,
      team_id: 'team-1',
      team_name: '1분과 1조',
      kind: 'core',
      content: '재생에너지 전환 속도를 높여야 한다.',
      rationale: '지역 일자리와 연결할 수 있다.',
      links: [
        { issue_id: 'issue-1', cluster_id: 'cluster-1', linked_by: 'operator' },
        { issue_id: 'issue-2', cluster_id: null, linked_by: 'assistant' },
      ],
      unclassified: false,
    },
    {
      id: 'item-2',
      submission_id: 'submission-1',
      ordinal: 2,
      team_id: 'team-1',
      team_name: '1분과 1조',
      kind: 'extra',
      content: '취약계층 비용 부담을 고려해야 한다.',
      rationale: null,
      links: [],
      unclassified: true,
    },
  ],
};

describe('buildRecordView', () => {
  it('원문·제출·조·분류 통계를 계산하고 출처 주제를 보존한다', () => {
    const view = buildRecordView('topic', [{
      target: { id: 'topic-1', label: '에너지 전환' },
      result: firstTopic,
    }]);

    expect(view.stats).toEqual({
      topicCount: 1,
      submissionCount: 1,
      teamCount: 1,
      itemCount: 2,
      classifiedCount: 1,
      unclassifiedCount: 1,
    });
    expect(view.items[0]).toMatchObject({
      itemId: 'item-1',
      submissionId: 'submission-1',
      topicId: 'topic-1',
      topicLabel: '에너지 전환',
      teamId: 'team-1',
      teamName: '1분과 1조',
      issueIds: ['issue-1', 'issue-2'],
      links: [
        { issue_id: 'issue-1', cluster_id: 'cluster-1', linked_by: 'operator' },
        { issue_id: 'issue-2', cluster_id: null, linked_by: 'assistant' },
      ],
    });
  });

  it('공론화 기록에서 원문의 출처 회차와 주제를 보존한다', () => {
    const view = buildRecordView('assembly', [{
      target: {
        id: 'topic-1',
        label: '에너지 전환',
        sessionId: 'session-1',
        sessionLabel: '제1차 회의',
      },
      result: firstTopic,
    }]);

    expect(view.scope).toBe('assembly');
    expect(view.items[0]).toMatchObject({
      sessionId: 'session-1',
      sessionLabel: '제1차 회의',
      topicId: 'topic-1',
      topicLabel: '에너지 전환',
    });
  });
});
