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
  submission_status: 'draft' | 'final' | 'reopened' | 'archived' | null;
  submission_updated_at: string | null;
  /** 아직 한 줄도 안 쓴 조는 item_* 가 전부 null인 빈 행으로 온다. */
  item_ordinal: number | null;
  item_kind: 'core' | 'extra' | null;
  item_content: string | null;
  item_rationale: string | null;
};

export const DEFAULT_SESSION_SLUG = '0829-deliberation';

/** 세션 전체 산출물을 평면 행으로 읽는다. 본부 토큰이 아니면 RPC가 예외를 던진다. */
export async function fetchHqSubmissions(
  token: string,
  sessionSlug: string = DEFAULT_SESSION_SLUG
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
