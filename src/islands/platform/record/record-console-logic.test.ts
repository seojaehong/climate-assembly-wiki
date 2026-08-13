import { describe, expect, it } from 'vitest';
import type { IssueItemsResult } from '../../../lib/platform';
import { buildRecordCsv, buildRecordView, recordCsvFileName } from './record-console-logic';

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
        { issueId: 'issue-1', clusterId: 'cluster-1', linkedBy: 'operator' },
        { issueId: 'issue-2', clusterId: null, linkedBy: 'assistant' },
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

describe('record CSV export', () => {
  it('원문별 canonical 출처와 M:N 쟁점 연결 provenance를 보존한다', () => {
    const formulaSafeFixture: IssueItemsResult = {
      ...firstTopic,
      items: firstTopic.items.map((item, index) => ({
        ...item,
        content: index === 0 ? '=HYPERLINK("https://example.org")' : item.content,
      })),
    };
    const view = buildRecordView('assembly', [{
      target: {
        id: 'topic-1',
        label: '에너지 전환',
        sessionId: 'session-1',
        sessionLabel: '제1차 회의',
      },
      result: formulaSafeFixture,
    }], {
      org: { id: 'org-1', label: '한국갈등해결센터' },
      assembly: { id: 'assembly-1', label: '2026 기후시민회의' },
      session: { id: 'session-1', label: '제1차 회의' },
    });

    const csv = buildRecordCsv(view);

    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toContain('"기관 ID","기관명","공론화 ID","공론화명","회차 ID","회차명","주제 ID","주제명"');
    expect(csv).toContain('"org-1","한국갈등해결센터","assembly-1","2026 기후시민회의"');
    expect(csv).toContain('"session-1","제1차 회의","topic-1","에너지 전환"');
    expect(csv).toContain('"team-1","1분과 1조","submission-1","item-1"');
    expect(csv).toContain(`"'=HYPERLINK(""https://example.org"")"`);
    expect(csv).toContain('"issue_id""');
    expect(csv).toContain('"cluster-1"');
    expect(csv).toContain('"linked_by""');
    expect(csv).toContain('\r\n');
  });

  it('스코프와 로컬 날짜를 포함한 안정된 파일명을 만든다', () => {
    const view = buildRecordView('assembly', [], {
      assembly: { id: 'assembly-1', label: '2026 기후시민회의' },
    });
    expect(recordCsvFileName({ view, at: new Date(2026, 7, 11) }))
      .toBe('공론화_2026_기후시민회의_assembly-1_기록_20260811.csv');
  });
});
