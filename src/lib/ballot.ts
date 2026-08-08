import { getSupabase } from './supabase';

/**
 * 다의제 1회 제출 투표(ballot) 데이터 레이어 — /b 참여자 화면 전용.
 * RPC 3종만 사용한다: ballot_get / ballot_submit / ballot_results
 * (20260808_s2_ballot_multi_agenda.sql). 테이블 직접 접근은 revoke되어 있어 불가.
 *
 * 타입은 손으로 유지한다(mod-console.ts의 Round와 동일한 방침) — DB와의 일치를
 * 타입체커가 검증하지 못하므로, RPC 반환 jsonb의 키가 바뀌면 여기도 같이 고쳐야 한다.
 */

export type BallotItem = {
  id: string;
  ordinal: number;
  statement: string;
  description: string | null;
  scale: 2 | 4 | 5 | 7;
  required: boolean;
};

export type Ballot = {
  id: string;
  title: string;
  instructions: string | null;
  /** ballot_get은 draft·archived를 null로 숨기므로 이 세 값만 온다. */
  status: 'open' | 'closed' | 'published';
  items: BallotItem[];
};

export type BallotResultItem = {
  id: string;
  ordinal: number;
  statement: string;
  scale: number;
  /** 해당 문항에 응답한 수(스킵 제외). */
  n: number;
  avg: number | null;
  /** {"1": 3, "2": 10, ...} — 값(1..scale) → 응답 수. 0표 값은 키가 없다. */
  dist: Record<string, number>;
};

export type BallotResults = {
  id: string;
  title: string;
  status: string;
  /** 제출(디바이스) 수. */
  responses: number;
  items: BallotResultItem[];
};

export type BallotSubmitResult = 'ok' | 'duplicate' | 'closed';

function client() {
  const sb = getSupabase();
  if (!sb) throw new Error('Supabase client unavailable (missing env)');
  return sb;
}

/**
 * 토큰으로 투표 정의를 조회한다. 없거나 비공개(draft·archived)면 null —
 * RPC가 둘을 구분하지 않으므로 호출부도 동일하게 "유효하지 않음"으로 안내한다.
 */
export async function fetchBallot(token: string): Promise<Ballot | null> {
  const sb = client();
  const { data, error } = await sb.schema('climate_vote').rpc('ballot_get', { p_token: token });
  if (error) throw error;
  return (data as Ballot | null) ?? null;
}

/**
 * 전 문항 답변을 1회 제출한다. answers = {"<item_id>": 1..scale}.
 * DB 가드 예외를 결과값으로 매핑한다(에러가 아니라 화면 전환 신호):
 * - 'already submitted'(unique_violation) → 'duplicate'
 * - 'ballot not open'(closed·published로 전환됨) → 'closed'
 * 그 외(missing answer, out of scale, 네트워크)는 그대로 throw한다.
 */
export async function submitBallot(
  token: string,
  clientId: string,
  answers: Record<string, number>,
): Promise<BallotSubmitResult> {
  const sb = client();
  const { error } = await sb.schema('climate_vote').rpc('ballot_submit', {
    p_token: token,
    p_client_id: clientId,
    p_answers: answers,
  });
  if (error) {
    const message = (error as { message?: string }).message ?? '';
    if (message.includes('already submitted')) return 'duplicate';
    if (message.includes('ballot not open')) return 'closed';
    throw error;
  }
  return 'ok';
}

/**
 * 결과 집계를 조회한다. p_code 없이 호출하므로 status='published'일 때만 non-null —
 * closed 단계의 잠정 집계는 참여자에게 절대 노출되지 않는다(B7 수동 게이트).
 */
export async function fetchBallotResults(token: string): Promise<BallotResults | null> {
  const sb = client();
  const { data, error } = await sb.schema('climate_vote').rpc('ballot_results', { p_token: token });
  if (error) throw error;
  return (data as BallotResults | null) ?? null;
}
