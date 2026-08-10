import type { IssueListResult } from '../../../lib/platform';
import {
  FREQUENCY_OPTIONS,
  STANCE_OPTIONS,
  toIssueViewModels,
  type IssueViewModel,
} from '../review/review-console-logic';
import type { TopicTarget } from '../platform-nav-logic';

export type AnalysisScope = 'topic' | 'session' | 'assembly';

export interface AnalysisStats {
  issueCount: number;
  reviewedCount: number;
  unclassifiedCount: number;
  linkedRelationshipCount: number;
}

export interface AnalysisView {
  scope: AnalysisScope;
  issues: AnalysisIssueView[];
  stats: AnalysisStats;
  frequencyDistribution: DistributionItem[];
  stanceDistribution: DistributionItem[];
}

export interface AnalysisIssueView extends IssueViewModel {
  topicId: string;
  topicLabel: string;
  sessionId?: string;
  sessionLabel?: string;
}

export interface AnalysisTopicResult {
  target: TopicTarget & { sessionId?: string; sessionLabel?: string };
  result: IssueListResult;
}

export interface DistributionItem {
  key: string;
  label: string;
  count: number;
}

function distribution(
  issues: IssueViewModel[],
  options: ReadonlyArray<{ value: string; label: string }>,
  value: (issue: IssueViewModel) => string | null,
): DistributionItem[] {
  const known = new Set(options.map((option) => option.value));
  const counts = new Map<string, number>();
  let unassigned = 0;
  for (const issue of issues) {
    const key = value(issue);
    if (!key || !known.has(key)) unassigned += 1;
    else counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [
    ...options.map((option) => ({
      key: option.value,
      label: option.label,
      count: counts.get(option.value) ?? 0,
    })),
    { key: 'unassigned', label: '미지정', count: unassigned },
  ];
}

/** Builds the read-only topic analysis model from the issue_list contract. */
export function buildAnalysisView(result: IssueListResult): AnalysisView {
  return buildScopedAnalysisView('topic', [{
    target: { id: result.topic_id, label: '현재 주제' },
    result,
  }]);
}

/** Builds one traceable analysis model from one or more topic results. */
export function buildScopedAnalysisView(
  scope: AnalysisScope,
  topicResults: readonly AnalysisTopicResult[],
): AnalysisView {
  const issues = topicResults.flatMap(({ target, result }) =>
    toIssueViewModels(result).map((issue) => ({
      ...issue,
      topicId: target.id,
      topicLabel: target.label,
      sessionId: target.sessionId,
      sessionLabel: target.sessionLabel,
    })),
  );
  return {
    scope,
    issues,
    stats: {
      issueCount: issues.length,
      reviewedCount: issues.filter((issue) => issue.hitl.reviewed).length,
      unclassifiedCount: topicResults.reduce(
        (total, { result }) => total + (result.unclassified_count ?? 0),
        0,
      ),
      linkedRelationshipCount: issues.reduce((total, issue) => total + issue.linkedItemCount, 0),
    },
    frequencyDistribution: distribution(issues, FREQUENCY_OPTIONS, (issue) => issue.frequencyClass),
    stanceDistribution: distribution(issues, STANCE_OPTIONS, (issue) => issue.stance),
  };
}
