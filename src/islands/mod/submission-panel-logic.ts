import type { SubmissionItem, SubmissionItemInput, SubmissionStatus } from '../../lib/deliberation';

/**
 * 조별 산출물(submission) 패널의 순수 로직 — 편집 행 조작, 저장 페이로드 변환,
 * 잠금(final)/재오픈(reopened) 판정. 서버 규칙(20260808_s1)의 UI측 거울:
 * final이면 저장·제출 버튼 자체를 내리지 않고, 빈 제출은 최종 제출을 막는다.
 */

export type EditorRow = { content: string; rationale: string };

/**
 * submission_save p_items 상한(RPC: max 200).
 *
 * 2026-08-29 현장에서 30줄로는 모자랐다 — 조가 한글·워드에 정리해 둔 것을 통째로
 * 옮기니 두 조가 상한에 걸렸다. ★ 이 값은 **꼭지당 총량**이라 「나눠서 저장」으로는
 * 우회되지 않는다(저장할 때 화면의 전 행을 통째로 보낸다). 넘치면 문장이 갈 곳이
 * 없으므로 서버 RPC와 함께 200으로 올렸다. 서버보다 크게 두지 말 것 — 저장이 실패한다.
 */
export const MAX_SUBMISSION_ROWS = 200;

export const FINALIZE_CONFIRM_MESSAGE =
  '최종 제출하면 잠깁니다. 잘못 눌렀다면 「다시 열기」로 조가 직접 풀 수 있습니다. 최종 제출할까요?';
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

/**
 * 탭을 옮겼다 왔을 때 되살릴 미저장분을 고른다.
 *
 * 조별 산출물 탭을 떠나면 편집 구역이 통째로 언마운트되어 저장 안 한 줄이 사라졌다.
 * 8.29에는 타이머·출석을 보고 돌아오는 동선이 있어 그대로 두면 현장에서 글이 날아간다.
 *
 * 서버 내용이 언제나 기준이다. 보관분은 **서버와 다를 때만** 되살린다 —
 * 저장을 마치면 둘이 같아지므로 낡은 초안이 되살아나지 않는다.
 *
 * @param raw       보관함에서 꺼낸 문자열(없으면 null)
 * @param serverRows 방금 서버에서 읽은 줄
 * @returns 되살릴 줄. 되살릴 게 없으면 null
 */
export function pickRestoredRows(raw: string | null, serverRows: EditorRow[]): EditorRow[] | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null; // 깨진 값 — 서버 내용으로 연다
  }
  if (!Array.isArray(parsed) || parsed.length === 0) return null;
  const rows = parsed.filter(
    (row): row is EditorRow =>
      typeof row === 'object' && row !== null && typeof (row as EditorRow).content === 'string'
  );
  if (rows.length !== parsed.length || rows.length === 0) return null;
  return isDirty(rows, serverRows) ? rows : null;
}

/**
 * 여러 줄 붙여넣기 분해 — 조가 한글·워드에 써 둔 것을 옮겨 담는 실제 경로다.
 *
 * 2026-08-29 현장 관찰: 조는 대부분 자기 한글/워드 파일에서 작업하고 화면에는
 * 마지막에 옮긴다. 그런데 textarea에 통째로 붙이면 **한 칸에 줄바꿈째로** 들어가
 * 문장 10개가 1건이 된다. 발표 카드도 한 장, 조끼리 겹침 판정도 무의미해진다.
 * 이 시스템은 「한 문장 = 한 행」에 전부 매여 있으므로 입구에서 나눠 받는다.
 *
 * 안전 규칙 — **어떤 경우에도 다른 행의 내용을 건드리지 않는다.**
 * - 붙여넣는 칸이 비어 있으면: 첫 줄을 그 칸에, 나머지는 바로 뒤에 새 행으로
 * - 칸에 이미 글이 있으면: 그 칸은 그대로 두고 전부 뒤에 새 행으로
 *
 * 한 줄짜리(또는 빈) 붙여넣기는 `applied:false`로 돌려보내 브라우저 기본
 * 붙여넣기에 맡긴다 — 커서 위치 편집을 빼앗지 않는다.
 */
export type PasteSplit = {
  /** 분해가 일어났는가. false면 호출부는 기본 붙여넣기를 그대로 둔다. */
  applied: boolean;
  rows: EditorRow[];
  /** 실제로 들어간 줄 수. */
  inserted: number;
  /** 30줄 상한에 걸려 들어가지 못한 줄 수. 0이 아니면 반드시 알려야 한다. */
  dropped: number;
};

/**
 * ★★ 「한 줄」의 정의 — 이 시스템에서 단 하나뿐인 규칙 ★★
 *
 * 1) `\r?\n` 으로 자른다 (한글·워드 클립보드는 CRLF 를 실어 보낸다)
 * 2) 각 조각의 앞뒤 공백을 없앤다
 * 3) 빈 조각은 버린다
 * 4) 남은 줄이 **2개 이상일 때만** 나눈 것으로 본다. 1개면 원문을 손대지 않는다
 *
 * 이 규칙은 세 곳이 함께 쓴다 — 붙여넣기 분해(`splitPastedRows`), 긴 칸 나누기
 * (`splitOverlongRows`), 그리고 **서버 RPC**(`supabase/migrations/20260830_s15_*.sql`
 * 의 `climate_vote.submission_lines`). 규칙이 갈리면 같은 글이 경로에 따라 다르게
 * 저장된다. 여기를 고치면 그 마이그레이션도 함께 고칠 것.
 */
export function splitSubmissionLines(text: string): string[] {
  return text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
}

export function splitPastedRows(
  rows: EditorRow[],
  index: number,
  text: string,
  cap: number = MAX_SUBMISSION_ROWS,
): PasteSplit {
  const none: PasteSplit = { applied: false, rows, inserted: 0, dropped: 0 };
  if (index < 0 || index >= rows.length) return none;
  const lines = splitSubmissionLines(text);
  if (lines.length < 2) return none;

  const target = rows[index];
  const fillsTarget = target.content.trim().length === 0;
  // 채울 자리 = 상한 - 현재 행수 (+ 빈 칸을 채우는 경우 그 한 칸)
  const room = cap - rows.length + (fillsTarget ? 1 : 0);
  if (room <= 0) return { applied: false, rows, inserted: 0, dropped: lines.length };

  const taken = lines.slice(0, room);
  const dropped = lines.length - taken.length;

  const next = [...rows];
  let head = taken;
  if (fillsTarget) {
    next[index] = { ...target, content: taken[0] };
    head = taken.slice(1);
  }
  next.splice(index + 1, 0, ...head.map((content) => ({ content, rationale: '' })));

  return { applied: true, rows: next, inserted: taken.length, dropped };
}

// ── 한 칸에 여러 사람 말이 든 경우 (2차 방어선) ────────────────────
//
// 8.29 실측: 통짜 6건이 전부 668자 이상이었고, 잘 쓴 조의 한 줄 중앙값은 39~90자였다.
// 정당한 장문 한 건일 수도 있으므로 **강제로 나누지 않는다** — 알려 주고 조가 고른다.

/**
 * 「길다」고 볼 글자수. 실측 근거 —
 * 상위 조의 한 줄 중앙값 39~90자, 최장 220자. 통짜 6건은 전부 668자 이상.
 * 300자는 그 사이의 빈 구간이다. 넘는다고 잘못은 아니고, **묻기만 한다.**
 */
export const LONG_ROW_CHARS = 300;

/** 길다고 볼 행의 index 목록. */
export function overlongRowIndexes(rows: EditorRow[]): number[] {
  return rows.reduce<number[]>((acc, row, i) => {
    if (row.content.trim().length > LONG_ROW_CHARS) acc.push(i);
    return acc;
  }, []);
}

/**
 * 길면서 **나눌 수 있는**(줄이 2개 이상인) 행. 줄바꿈 없는 긴 한 문장은 여기 안 든다 —
 * 나눌 근거가 없으므로 버튼도 주지 않는다(경고만 남는다).
 */
export function splittableRowIndexes(rows: EditorRow[]): number[] {
  return overlongRowIndexes(rows).filter((i) => splitSubmissionLines(rows[i].content).length >= 2);
}

export type OverlongSplit = {
  /** 나눴는가. */
  applied: boolean;
  rows: EditorRow[];
  /** 나누기 전 행수 → 나눈 뒤 행수. */
  before: number;
  after: number;
  /** 나누면 상한을 넘어 포기했는가. 서버 RPC 와 같은 판단이다. */
  overCap: boolean;
};

/**
 * 긴 칸을 줄 단위로 나눈다. 위치는 지킨다 — 나뉜 조각이 그 자리에 그대로 늘어서고
 * 다른 행은 순서도 내용도 바뀌지 않는다. rationale 은 첫 조각만 물려받는다
 * (N 벌로 복제하면 원문에 없던 근거가 늘어난다 — 서버 RPC 와 같은 규칙).
 *
 * ★ 나눈 결과가 상한을 넘으면 **아무것도 하지 않는다.** 잘라내면 조가 쓴 문장이
 * 사라진다. 서버 RPC 도 같은 선택을 한다(조용한 잘림 금지).
 */
export function splitOverlongRows(
  rows: EditorRow[],
  cap: number = MAX_SUBMISSION_ROWS,
): OverlongSplit {
  const targets = new Set(splittableRowIndexes(rows));
  const before = rows.length;
  if (targets.size === 0) return { applied: false, rows, before, after: before, overCap: false };

  const next: EditorRow[] = [];
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    if (!targets.has(i)) {
      next.push(row);
      continue;
    }
    const lines = splitSubmissionLines(row.content);
    lines.forEach((content, k) => {
      next.push({ content, rationale: k === 0 ? row.rationale : '' });
    });
  }
  if (next.length > cap) return { applied: false, rows, before, after: before, overCap: true };
  return { applied: true, rows: next, before, after: next.length, overCap: false };
}
