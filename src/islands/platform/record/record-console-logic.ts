import type { IssueItemLink, IssueItemsResult } from '../../../lib/platform';
import type { TopicTarget } from '../platform-nav-logic';
import { toReviewItem, type ReviewItem } from '../review/review-console-logic';

export type RecordScope = 'topic' | 'session' | 'assembly';

export interface RecordTopicResult {
  target: TopicTarget & { sessionId?: string; sessionLabel?: string };
  result: IssueItemsResult;
}

export interface RecordItem extends ReviewItem {
  topicId: string;
  topicLabel: string;
  teamId: string;
  links: IssueItemLink[];
  sessionId?: string;
  sessionLabel?: string;
}

export interface RecordStats {
  topicCount: number;
  submissionCount: number;
  teamCount: number;
  itemCount: number;
  classifiedCount: number;
  unclassifiedCount: number;
}

export interface RecordView {
  scope: RecordScope;
  items: RecordItem[];
  stats: RecordStats;
}

/** Builds a traceable record model from one or more topic item results. */
export function buildRecordView(
  scope: RecordScope,
  topicResults: readonly RecordTopicResult[],
): RecordView {
  const items = topicResults.flatMap(({ target, result }) =>
    result.items.map((row) => ({
      ...toReviewItem(row),
      topicId: target.id,
      topicLabel: target.label,
      teamId: row.team_id,
      links: Array.isArray(row.links) ? row.links.map((link) => ({ ...link })) : [],
      sessionId: target.sessionId,
      sessionLabel: target.sessionLabel,
    })),
  );
  const classifiedCount = items.filter((item) => item.issueIds.length > 0).length;
  return {
    scope,
    items,
    stats: {
      topicCount: topicResults.length,
      submissionCount: new Set(items.map((item) => item.submissionId)).size,
      teamCount: new Set(items.map((item) => item.teamId)).size,
      itemCount: items.length,
      classifiedCount,
      unclassifiedCount: items.length - classifiedCount,
    },
  };
}
