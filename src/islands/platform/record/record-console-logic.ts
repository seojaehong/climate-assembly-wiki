import type { IssueItemLink, IssueItemsResult } from '../../../lib/platform';
import { safeSegment } from '../../mod/svg-to-png';
import type { ScopePathContext, TopicTarget, TreeNodeKind } from '../platform-nav-logic';
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
  context: ScopePathContext;
  items: RecordItem[];
  stats: RecordStats;
}

const PATH_KINDS: readonly TreeNodeKind[] = ['org', 'assembly', 'session', 'topic'];

function copyScopePathContext(context: ScopePathContext): ScopePathContext {
  const copy: ScopePathContext = {};
  for (const kind of PATH_KINDS) {
    const ref = context[kind];
    if (ref) copy[kind] = { ...ref };
  }
  return copy;
}

/** Builds a traceable record model from one or more topic item results. */
export function buildRecordView(
  scope: RecordScope,
  topicResults: readonly RecordTopicResult[],
  context: ScopePathContext = {},
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
    context: copyScopePathContext(context),
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

const RECORD_SCOPE_LABEL: Record<RecordScope, string> = {
  topic: '주제',
  session: '회차',
  assembly: '공론화',
};

const RECORD_CSV_HEADERS = [
  '스코프',
  '기관 ID',
  '기관명',
  '공론화 ID',
  '공론화명',
  '회차 ID',
  '회차명',
  '주제 ID',
  '주제명',
  '조 ID',
  '조 이름',
  '제출 ID',
  '원문 ID',
  '항목 종류',
  '항목 순서',
  '원문',
  '근거',
  '분류 상태',
  '쟁점 연결 수',
  '쟁점 연결 JSON',
] as const;

function csvCell(value: string | number): string {
  const raw = String(value);
  const safe = /^[=+\-@]/.test(raw.trimStart()) ? `'${raw}` : raw;
  return `"${safe.replaceAll('"', '""')}"`;
}

/** Serializes the full record read model without dropping source or link provenance. */
export function buildRecordCsv(view: RecordView): string {
  const rows = view.items.map((item) => [
    RECORD_SCOPE_LABEL[view.scope],
    view.context.org?.id ?? '',
    view.context.org?.label ?? '',
    view.context.assembly?.id ?? '',
    view.context.assembly?.label ?? '',
    item.sessionId ?? view.context.session?.id ?? '',
    item.sessionLabel ?? view.context.session?.label ?? '',
    item.topicId,
    item.topicLabel,
    item.teamId,
    item.teamName,
    item.submissionId,
    item.itemId,
    item.kind,
    item.ordinal,
    item.content,
    item.rationale ?? '',
    item.issueIds.length > 0 ? '쟁점 연결' : '미분류',
    item.issueIds.length,
    JSON.stringify(item.links),
  ]);
  return `\uFEFF${RECORD_CSV_HEADERS.map(csvCell).join(',')}\r\n${rows
    .map((row) => row.map(csvCell).join(','))
    .join('\r\n')}`;
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/** Builds a stable local-date filename with the canonical selected scope. */
export function recordCsvFileName(input: { view: RecordView; at: Date }): string {
  const date = `${input.at.getFullYear()}${pad2(input.at.getMonth() + 1)}${pad2(input.at.getDate())}`;
  const scopeRef = input.view.context[input.view.scope];
  const scopeLabel = safeSegment(scopeRef?.label.slice(0, 48) ?? '');
  const scopeId = safeSegment(scopeRef?.id ?? '');
  const parts = [RECORD_SCOPE_LABEL[input.view.scope]];
  if (scopeLabel) parts.push(scopeLabel);
  if (scopeId) parts.push(scopeId);
  parts.push('기록', date);
  return `${parts.join('_')}.csv`;
}
