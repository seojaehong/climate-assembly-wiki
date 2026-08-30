import { getSupabase } from './supabase';

/**
 * 본부(HQ) 조별 산출물 취합 데이터 레이어 — 20260827_s7의 hq_submissions RPC를 감싼다.
 *
 * 조 콘솔의 submission_* RPC가 조 코드 capability인 것과 달리, 이쪽은 본부 토큰
 * (attendance_hq_unlock 발급, scope='hq')을 쓴다. 조 15개 × 꼭지 3개를 한 번에 읽는다.
 * 손유지 타입이므로 마이그레이션을 고치면 여기부터 맞출 것.
 */

function client() {
  const sb = getSupabase();
  if (!sb) throw new Error('Supabase client unavailable (missing env)');
  return sb;
}

/** hq_submissions 반환 행 하나 — 주제 × 조 × 항목의 평면 조인 결과. */
export type HqSubmissionRow = {
  topic_id: string;
  topic_ordinal: number;
  topic_prompt: string;
  topic_status: 'open' | 'closed';
  team_id: string;
  team_name: string;
  team_subgroup: string | null;
  table_no: string | null;
  /** 재오픈 호출에 필요하다. 아직 제출물이 없는 조는 null. */
  submission_id: string | null;
  submission_status: 'draft' | 'final' | 'reopened' | 'archived' | null;
  submission_updated_at: string | null;
  /** 최종 제출 시각. 잠기지 않았으면 null. */
  submission_finalized_at: string | null;
  /** 아직 한 줄도 안 쓴 조는 item_* 가 전부 null인 빈 행으로 온다. */
  item_ordinal: number | null;
  item_kind: 'core' | 'extra' | null;
  item_content: string | null;
  item_rationale: string | null;
};

/**
 * ★ 이번 행사의 세션 slug. **행사마다 여기를 바꾼다.**
 *
 * 왜 상수 하나로 두는가 — 2026-08-30 점검에서 이 값이 여섯 함수의 **기본 인자**로
 * 숨어 있었다. 호출부는 한 곳도 세션을 넘기지 않았고, 그래서 9.12 에 새 세션을
 * 열어도 본부 화면 전체가 8.29 를 가리켰을 것이다. 「전체 비우기」를 누르면
 * 8.29 의 641줄이 지워진다(아카이브로 복구는 되지만 행사 중에는 사고다).
 *
 * 그래서 **기본값을 없앴다.** 이제 모든 호출이 세션을 명시해야 하고, 빠뜨리면
 * 조용히 8.29 로 가는 대신 **타입 검사가 막는다.**
 */
export const CURRENT_SESSION_SLUG = '0829-deliberation';

/** @deprecated 기본 인자로 쓰지 말 것 — 세션을 명시하라. 남긴 것은 옛 import 호환용이다. */
export const DEFAULT_SESSION_SLUG = CURRENT_SESSION_SLUG;

/** 세션 전체 산출물을 평면 행으로 읽는다. 본부 토큰이 아니면 RPC가 예외를 던진다. */
export async function fetchHqSubmissions(
  token: string,
  sessionSlug: string
): Promise<HqSubmissionRow[]> {
  // ⚠️ .schema('climate_vote')를 빼면 PostgREST가 public.hq_submissions를 찾다가
  // PGRST202로 죽는다. 이 저장소의 RPC는 전부 climate_vote 스키마에 있다(deliberation.ts와 같다).
  const { data, error } = await client()
    .schema('climate_vote')
    .rpc('hq_submissions', {
      p_token: token,
      p_session_slug: sessionSlug,
    });
  if (error) throw new Error(`${error.code ?? 'rpc'}: ${error.message ?? '알 수 없는 오류'}`);
  return (data ?? []) as HqSubmissionRow[];
}

/**
 * 조가 저장하는 즉시 본부 화면이 따라오도록 구독한다.
 * submission_item(줄 추가·수정)과 submission(최종 제출·재오픈) 둘 다 본다.
 */
export function subscribeHqSubmissions(onChange: () => void): () => void {
  const sb = client();
  const channel = sb
    .channel('hq:submissions')
    .on(
      'postgres_changes',
      { event: '*', schema: 'climate_vote', table: 'submission_item' },
      onChange
    )
    .on('postgres_changes', { event: '*', schema: 'climate_vote', table: 'submission' }, onChange)
    .subscribe();
  return () => {
    sb.removeChannel(channel);
  };
}

/**
 * 최종 제출을 되돌린다 — 본부 토큰만, 사유 필수.
 *
 * 조가 당일 잘못 눌렀을 때의 유일한 복구 경로다. 서버가 사유를 2자 이상 요구하고
 * submission_lock_event에 누가·언제·왜를 남기므로, 되돌린 사실 자체가 기록으로 남는다.
 */
export async function reopenSubmission(
  token: string,
  submissionId: string,
  reason: string
): Promise<void> {
  const { error } = await client()
    .schema('climate_vote')
    .rpc('submission_reopen', {
      p_token: token,
      p_submission_id: submissionId,
      p_reason: reason,
    });
  if (error) throw new Error(`${error.code ?? 'rpc'}: ${error.message ?? '알 수 없는 오류'}`);
}

/** hq_submission_history 한 행 — 최종 제출·재오픈·저장으로 교체된 문장. */
export type HqHistoryRow = {
  team_name: string;
  topic_ordinal: number;
  topic_prompt: string;
  event_at: string;
  /** 'finalize' | 'reopen' | 'replaced' */
  kind: string;
  actor_label: string;
  /** reopen이면 사유, replaced면 교체되어 사라진 문장. */
  detail: string | null;
};

/**
 * 조별 저장·제출 이력. 조가 저장할 때마다 교체되어 사라진 문장까지 들어 있다.
 *
 * submission_save가 항목을 통째로 갈아끼우기 때문에, 이력이 없으면 조가 고친 순간
 * 앞 문장을 되살릴 수 없다. 회의자료의 「원 발언과 결과물 추적 가능하게 기록」이 근거다.
 */
export async function fetchHqSubmissionHistory(
  token: string,
  sessionSlug: string
): Promise<HqHistoryRow[]> {
  const { data, error } = await client()
    .schema('climate_vote')
    .rpc('hq_submission_history', { p_token: token, p_session_slug: sessionSlug });
  if (error) throw new Error(`${error.code ?? 'rpc'}: ${error.message ?? '알 수 없는 오류'}`);
  return (data ?? []) as HqHistoryRow[];
}

/**
 * L3 4범주 — 저장값 네 가지. src/islands/mod/four-category.ts 의 `FOUR_CATEGORIES` 및
 * 20260828_s8_submission_category.sql 의 check 제약과 같은 문자열이어야 한다.
 * 한국어 라벨(공통·차이·갈등·질문)은 화면에만 있고 DB 에 들어가지 않는다.
 *
 * ※ 여기서 아일랜드를 import 하지 않는다 — 이 리포의 import 방향은 islands → lib 한쪽이다.
 */
export type SubmissionCategory = 'common' | 'difference' | 'conflict' | 'question';

/** hq_submission_categories 한 행 — 항목별 **마지막** 배정. category가 null이면 해제된 것이다. */
export type HqCategoryRow = {
  topic_id: string;
  team_id: string;
  submission_id: string;
  item_ordinal: number;
  /** null = 배정 해제. 앞 배정이 되살아나지 않도록 서버가 해제 사건도 그대로 내려준다. */
  category: SubmissionCategory | null;
  actor_label: string;
  assigned_at: string;
};

/**
 * 배정 행을 보드 카드 id로 옮긴다.
 *
 * DB는 (submission_id, item_ordinal)로 항목을 가리키고 보드는 `topic:team:ordinal`로 가리킨다.
 * 두 규격이 어긋나면 배정이 조용히 아무 카드에도 안 붙으므로 이 변환을 한 곳에 둔다
 * (카드 id 규격은 hq-submission-board-logic.ts의 buildBoards가 만든다).
 */
export function categoryNoteId(row: Pick<HqCategoryRow, 'topic_id' | 'team_id' | 'item_ordinal'>): string {
  return `${row.topic_id}:${row.team_id}:${row.item_ordinal}`;
}

/**
 * 4범주 배정을 남긴다 — 본부 토큰만. `category`가 null이면 배정 해제다.
 *
 * 서버 표는 append-only라 되돌려도 앞 기록이 남는다(누가·언제 묶었는지가 책임으로 남아야 한다).
 * 원문(submission_item)은 건드리지 않는다 — 카드는 지워지지도 합쳐지지도 않는다.
 */
export async function assignSubmissionCategory(
  token: string,
  submissionId: string,
  itemOrdinal: number,
  category: SubmissionCategory | null
): Promise<void> {
  const { error } = await client()
    .schema('climate_vote')
    .rpc('hq_submission_category_assign', {
      p_token: token,
      p_submission_id: submissionId,
      p_item_ordinal: itemOrdinal,
      p_category: category,
    });
  if (error) throw new Error(`${error.code ?? 'rpc'}: ${error.message ?? '알 수 없는 오류'}`);
}

/** 세션 전체의 현재 배정을 읽는다. 총괄모더레이터 3인이 같은 것을 보게 하는 경로다. */
export async function fetchHqSubmissionCategories(
  token: string,
  sessionSlug: string
): Promise<HqCategoryRow[]> {
  const { data, error } = await client()
    .schema('climate_vote')
    .rpc('hq_submission_categories', { p_token: token, p_session_slug: sessionSlug });
  if (error) throw new Error(`${error.code ?? 'rpc'}: ${error.message ?? '알 수 없는 오류'}`);
  return (data ?? []) as HqCategoryRow[];
}

// ── 온톨로지 종류(s12) ──────────────────────────────────────────────
// 4범주(s9)와 같은 방식이다. 배정을 사건으로 쌓고 현재 상태는 마지막 사건으로 읽는다.

export type HqKindRow = {
  topic_id: string;
  team_id: string;
  submission_id: string;
  item_ordinal: number;
  kind: string | null;
  actor_label: string;
  assigned_at: string;
};

/** 종류를 붙이거나(kind) 해제한다(null). */
export async function assignSubmissionKind(
  token: string,
  submissionId: string,
  itemOrdinal: number,
  kind: string | null
): Promise<void> {
  const { error } = await client()
    .schema('climate_vote')
    .rpc('hq_submission_kind_assign', {
      p_token: token,
      p_submission_id: submissionId,
      p_item_ordinal: itemOrdinal,
      p_kind: kind,
    });
  if (error) throw new Error(`${error.code ?? 'rpc'}: ${error.message ?? '알 수 없는 오류'}`);
}

export async function fetchSubmissionKinds(
  token: string,
  sessionSlug: string
): Promise<HqKindRow[]> {
  const { data, error } = await client()
    .schema('climate_vote')
    .rpc('hq_submission_kinds', { p_token: token, p_session_slug: sessionSlug });
  if (error) throw new Error(`${error.code ?? 'rpc'}: ${error.message ?? '알 수 없는 오류'}`);
  return (data ?? []) as HqKindRow[];
}

/** 전체 비우기 확인 문구. 화면과 DB 함수가 **같은 문자열**을 봐야 한다. */
export const CLEAR_CONFIRM_PHRASE = '전체 비우기';

export type ClearResult = {
  cleared_items: number;
  cleared_submissions: number;
};

/**
 * 조별 산출물 전체 비우기 — 8.29 오전 연습 값을 오후 본 숙의 전에 치운다.
 *
 * 확인 문구를 정확히 넘겨야 지운다(오타 하나면 아무것도 안 지운다). 잘못 누른
 * 클릭으로는 15개 조의 글이 사라지지 않게 하려는 것이다.
 *
 * 지운 문장은 s8 아카이브(submission_item_archive)에 그대로 남는다 — 유실이 아니라
 * 화면에서 치우는 것이다. 되살리는 SQL은 s14 마이그레이션 주석에 적어 두었다.
 */
export async function clearAllSubmissions(
  token: string,
  confirmPhrase: string,
  sessionSlug: string
): Promise<ClearResult> {
  const { data, error } = await client()
    .schema('climate_vote')
    .rpc('hq_clear_submissions', {
      p_token: token,
      p_session_slug: sessionSlug,
      p_confirm: confirmPhrase,
    });
  if (error) throw new Error(`${error.code ?? 'rpc'}: ${error.message ?? '알 수 없는 오류'}`);
  return data as ClearResult;
}
