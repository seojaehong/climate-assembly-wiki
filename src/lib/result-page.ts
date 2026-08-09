import { getSupabase } from './supabase';
import type { ResultGetResponse } from '../islands/result/result-view-logic';

/**
 * 공개 결과 페이지 데이터 레이어 — climate_vote.result_get(p_token) 공개 read RPC를 감싼다.
 * (supabase/migrations/platform_p2_analysis_review.sql §7-3)
 *
 * result_get 은 published_at not null & archived_at is null 인 페이지만 반환하고,
 * 없거나 미공개면 **null** 을 반환한다(예외 아님). 따라서:
 *   · 정상 미공개/미존재 → data=null → 여기서도 null 반환(호출부는 "공개되지 않은 결과" 표시).
 *   · 스키마 미적용/네트워크 오류 → RPC error(PGRST202 등) → throw(호출부가 "불러오지 못함"으로 분기).
 * 두 상태를 구분해야 시민에게 "미공개"와 "일시 오류"를 혼동시키지 않는다 — 삼키지 않고 throw.
 *
 * 파라미터명·반환 구조는 SQL과 1:1(손유지 타입, 타입체커 미검증 — 스키마 변경 시 여기부터 맞출 것).
 */
export async function fetchResult(token: string): Promise<ResultGetResponse> {
  const sb = getSupabase();
  if (!sb) return null; // env 미설정 — 호출부가 미공개와 동일 취급(라이브 이후 문제)
  const { data, error } = await sb
    .schema('climate_vote')
    .rpc('result_get', { p_token: token });
  if (error) throw error;
  return (data ?? null) as ResultGetResponse;
}
