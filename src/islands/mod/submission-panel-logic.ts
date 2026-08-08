import type { SubmissionItem, SubmissionItemInput, SubmissionStatus } from '../../lib/deliberation';

/**
 * 조별 산출물(submission) 패널의 순수 로직 — 편집 행 조작, 저장 페이로드 변환,
 * 잠금(final)/재오픈(reopened) 판정. 서버 규칙(20260808_s1)의 UI측 거울:
 * final이면 저장·제출 버튼 자체를 내리지 않고, 빈 제출은 최종 제출을 막는다.
 */

export type EditorRow = { content: string; rationale: string };

/** submission_save p_items 상한(RPC: max 30). */
export const MAX_SUBMISSION_ROWS = 30;

export const FINALIZE_CONFIRM_MESSAGE =
  '최종 제출 후에는 본부(HQ)만 다시 열 수 있습니다. 최종 제출할까요?';
export const LEAVE_CONFIRM_MESSAGE =
  '저장하지 않은 변경이 있습니다. 지금 이동하면 사라집니다. 계속할까요?';

export function emptyRow(): EditorRow {
  return { content: '', rationale: '' };
}

/** 서버 항목 → 편집 행. 항목이 없으면 빈 행 1개로 시작한다(빈 편집기 방지). */
export function rowsFromItems(items: SubmissionItem[]): EditorRow[] {
  const sorted = [...items].sort((a, b) => a.ordinal - b.ordinal);
  const rows = sorted.map((item) => ({ content: item.content, rationale: item.rationale ?? '' }));
  return rows.length > 0 ? rows : [emptyRow()];
}

/**
 * 편집 가능 여부. status null(아직 제출물 없음)·draft·reopened = 편집 가능,
 * final(잠금)·archived = 불가.
 */
export function isEditable(status: SubmissionStatus | null): boolean {
  return status !== 'final' && status !== 'archived';
}

/**
 * 편집 행 → submission_save p_items. 내용이 빈 행은 버리고 ordinal을 1부터 다시 매긴다
 * (RPC도 빈 content를 걸러내므로 여기서 미리 맞춰 보내야 저장 건수 표시가 어긋나지 않는다).
 * rationale은 빈 문자열 대신 null.
 */
export function toSaveItems(rows: EditorRow[]): SubmissionItemInput[] {
  return rows
    .map((row) => ({ content: row.content.trim(), rationale: row.rationale.trim() }))
    .filter((row) => row.content.length > 0)
    .map((row, index) => ({
      ordinal: index + 1,
      kind: 'core' as const,
      content: row.content,
      rationale: row.rationale.length > 0 ? row.rationale : null,
    }));
}

/** 최종 제출 가능: 편집 가능한 상태 + 내용 있는 행 1개 이상(빈 제출은 RPC도 거부). */
export function canFinalize(rows: EditorRow[], status: SubmissionStatus | null): boolean {
  return isEditable(status) && toSaveItems(rows).length > 0;
}

// ── 행 조작(전부 불변 갱신) ──────────────────────────────────

export function addRow(rows: EditorRow[]): EditorRow[] {
  if (rows.length >= MAX_SUBMISSION_ROWS) return rows;
  return [...rows, emptyRow()];
}

/** 마지막 한 행은 지우는 대신 비운다 — 편집기에 행이 0개가 되는 상태를 만들지 않는다. */
export function removeRow(rows: EditorRow[], index: number): EditorRow[] {
  if (index < 0 || index >= rows.length) return rows;
  if (rows.length <= 1) return [emptyRow()];
  return rows.filter((_, i) => i !== index);
}

/** 위/아래 이동. 경계 밖이면 그대로 반환한다. */
export function moveRow(rows: EditorRow[], index: number, direction: -1 | 1): EditorRow[] {
  const target = index + direction;
  if (index < 0 || index >= rows.length || target < 0 || target >= rows.length) return rows;
  const next = [...rows];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

function serializeRows(rows: EditorRow[]): string {
  return JSON.stringify(rows.map((row) => [row.content, row.rationale]));
}

/** 저장 이후 달라진 것이 있는가 — 저장 버튼 활성화·이탈 confirm의 판정 기준. */
export function isDirty(rows: EditorRow[], baseline: EditorRow[]): boolean {
  return serializeRows(rows) !== serializeRows(baseline);
}

export type SubmissionBadge = { label: string; tone: 'locked' | 'reopened' | 'draft' } | null;

/** 상태 배지. draft/없음은 배지 없이 두고, 잠금·재오픈만 눈에 띄게 표시한다. */
export function submissionBadge(status: SubmissionStatus | null): SubmissionBadge {
  if (status === 'final') return { label: '최종 제출됨 · 잠금', tone: 'locked' };
  if (status === 'reopened') return { label: '재오픈됨 · 다시 편집 가능', tone: 'reopened' };
  return null;
}
