import { getSupabase } from './supabase';

/**
 * 숙의 운영 데이터 레이어 — 20260808_s1(주제·조별 산출물)과 20260808_s2(다의제 투표)의
 * RPC를 감싼다. 모든 운영 RPC는 p_code = 조 접속코드(join_code) capability이며,
 * 파라미터명·반환 구조는 마이그레이션 SQL과 1:1이다(손유지 타입 — DB와의 일치를
 * 타입체커가 검증하지 못하므로 스키마 변경 시 여기부터 맞출 것).
 */

function client() {
  const sb = getSupabase();
  if (!sb) throw new Error('Supabase client unavailable (missing env)');
  return sb;
}

// ============================================================
// S1 — 토론 주제 + 조별 산출물
// ============================================================

/** topic_list 반환 행. draft·archived 주제는 RPC가 이미 걸러 open/closed만 온다. */
export type Topic = {
  id: string;
  ordinal: number;
  block: 'am' | 'pm' | null;
  prompt: string;
  guidance: string | null;
  status: 'open' | 'closed';
};

export type SubmissionStatus = 'draft' | 'final' | 'reopened' | 'archived';

/** submission_get의 items 원소(ordinal 순 정렬 보장). */
export type SubmissionItem = {
  ordinal: number;
  kind: 'core' | 'extra';
  content: string;
  rationale: string | null;
};

/**
 * submission_get 반환. 제출물이 아직 없으면 {status:null, items:[]}만 온다
 * (id·finalized_at·updated_at 없음) — optional로 그 형태를 그대로 담는다.
 */
export type SubmissionGetResult = {
  id?: string;
  status: SubmissionStatus | null;
  finalized_at?: string | null;
  updated_at?: string | null;
  items: SubmissionItem[];
};

/** submission_save의 p_items 원소. rationale은 빈 문자열 대신 null로 보낸다. */
export type SubmissionItemInput = {
  ordinal: number;
  kind: 'core' | 'extra';
  content: string;
  rationale: string | null;
};

export type SubmissionSaveResult = { id: string; status: SubmissionStatus; saved: number };
export type SubmissionFinalizeResult = { id: string; status: 'final' };

/** 내 세션의 토론 주제 목록(open·closed). */
export async function topicList(code: string): Promise<Topic[]> {
  const sb = client();
  const { data, error } = await sb.schema('climate_vote').rpc('topic_list', { p_code: code });
  if (error) throw error;
  return (data ?? []) as Topic[];
}

/** 주제별 우리 조 제출물 + 항목. */
export async function submissionGet(code: string, topicId: string): Promise<SubmissionGetResult> {
  const sb = client();
  const { data, error } = await sb.schema('climate_vote').rpc('submission_get', {
    p_code: code,
    p_topic_id: topicId,
  });
  if (error) throw error;
  return data as SubmissionGetResult;
}

/**
 * 중간 보관 저장 — draft/reopened에서만. items 전체 교체(RPC가 delete 후 insert).
 * final 상태면 RPC가 'submission is finalized — reopen required (hq)' 예외를 던진다.
 */
export async function submissionSave(
  code: string,
  topicId: string,
  items: SubmissionItemInput[],
): Promise<SubmissionSaveResult> {
  const sb = client();
  const { data, error } = await sb.schema('climate_vote').rpc('submission_save', {
    p_code: code,
    p_topic_id: topicId,
    p_items: items,
  });
  if (error) throw error;
  return data as SubmissionSaveResult;
}

/** 최종 제출(잠금). 항목 0건이면 RPC가 거부한다. 되돌리기는 HQ 재오픈뿐. */
/**
 * 조가 스스로 최종 제출을 다시 연다 — 본부 승인 없이.
 *
 * 행사 중 본부가 재오픈 요청을 일일이 받으면 그 조가 몇 분씩 멈춘다. 조는 자기 것만
 * 열 수 있고 내용은 그대로이며, 누가 언제 열었는지는 기록에 남는다(actor_scope='team').
 */
export async function submissionReopenByTeam(code: string, topicId: string): Promise<void> {
  const sb = client();
  const { error } = await sb.schema('climate_vote').rpc('submission_reopen_by_team', {
    p_code: code,
    p_topic_id: topicId,
  });
  if (error) throw new Error(error.message ?? '다시 열지 못했습니다');
}

export async function submissionFinalize(code: string, topicId: string): Promise<SubmissionFinalizeResult> {
  const sb = client();
  const { data, error } = await sb.schema('climate_vote').rpc('submission_finalize', {
    p_code: code,
    p_topic_id: topicId,
  });
  if (error) throw error;
  return data as SubmissionFinalizeResult;
}

// ============================================================
// S2 — 다의제 1회 제출 투표 (ballot)
// ============================================================

export type BallotScale = 2 | 4 | 5 | 7;
export type BallotStatus = 'draft' | 'open' | 'closed' | 'published' | 'archived';

/** ballot_create의 p_items 원소. */
export type BallotItemInput = {
  ordinal: number;
  statement: string;
  description?: string | null;
  scale: BallotScale;
  required?: boolean;
};

export type BallotCreateResult = {
  id: string;
  token: string;
  status: BallotStatus;
  items: number;
  /** S4(20260808_s4) 이후에만 온다. 미적용 DB는 키 자체가 없다 — undefined=전체로 해석. */
  subgroup?: string | null;
};
export type BallotSetStatusResult = { id: string; status: BallotStatus };

/** ballot_list 반환 행(archived 제외, 최신순). count류는 bigint지만 JSON 숫자로 온다. */
export type BallotListRow = {
  id: string;
  title: string;
  status: BallotStatus;
  token: string;
  /** 분과 스코프(S4). null=세션 전체. S4 미적용 DB는 키가 없다(undefined) — 전체로 간주. */
  subgroup?: string | null;
  item_count: number;
  response_count: number;
  created_at: string;
};

/** ballot_results의 items 원소. n=0이면 avg는 null. dist 키는 '1'..'scale' 문자열. */
export type BallotResultItem = {
  id: string;
  ordinal: number;
  statement: string;
  scale: number;
  n: number;
  avg: number | null;
  dist: Record<string, number>;
};

export type BallotResults = {
  id: string;
  title: string;
  status: BallotStatus;
  /** 분과 스코프(S4). null=세션 전체. S4 미적용 DB는 키가 없다(undefined) — 전체로 간주. */
  subgroup?: string | null;
  responses: number;
  items: BallotResultItem[];
};

export type BallotCreateInput = {
  title: string;
  instructions?: string | null;
  items: BallotItemInput[];
  /** 분과 한정 투표(S4). null/undefined=세션 전체. */
  subgroup?: string | null;
};

export type BallotCreateParams = {
  p_code: string;
  p_title: string;
  p_instructions: string | null;
  p_items: BallotItemInput[];
  /** 분과 선택 시에만 존재한다 — 키 자체를 조건부로 넣는다(아래 주석 참조). */
  p_subgroup?: string;
};

/**
 * ballot_create RPC 파라미터(순수 — 테스트 대상). 대상=전체면 **p_subgroup 키 자체를
 * 넣지 않는다**: S4 미적용 DB에는 4인자 함수만 있어서, 키를 보내면(값이 null이어도)
 * PostgREST 함수 매칭에 실패한다. 코드가 DB보다 먼저 배포돼도 기존 동작이 깨지지 않게 한다.
 */
export function ballotCreateParams(code: string, input: BallotCreateInput): BallotCreateParams {
  const params: BallotCreateParams = {
    p_code: code,
    p_title: input.title,
    p_instructions: input.instructions ?? null,
    p_items: input.items,
  };
  const subgroup = input.subgroup?.trim();
  if (subgroup) params.p_subgroup = subgroup;
  return params;
}

/** 다의제 투표 생성(초안). 의제 1~20개, 척도 2/4/5/7. subgroup 지정 시 그 분과 한정. */
export async function ballotCreate(code: string, input: BallotCreateInput): Promise<BallotCreateResult> {
  const sb = client();
  const { data, error } = await sb
    .schema('climate_vote')
    .rpc('ballot_create', ballotCreateParams(code, input));
  if (error) throw error;
  return data as BallotCreateResult;
}

/** 상태 전이 draft→open→closed→published(→archived). 역행은 RPC가 거부한다. */
export async function ballotSetStatus(
  code: string,
  ballotId: string,
  status: 'open' | 'closed' | 'published' | 'archived',
): Promise<BallotSetStatusResult> {
  const sb = client();
  const { data, error } = await sb.schema('climate_vote').rpc('ballot_set_status', {
    p_code: code,
    p_ballot_id: ballotId,
    p_status: status,
  });
  if (error) throw error;
  return data as BallotSetStatusResult;
}

/** 세션의 투표 목록 + 제출 수(운영 콘솔 폴링용). */
export async function ballotList(code: string): Promise<BallotListRow[]> {
  const sb = client();
  const { data, error } = await sb.schema('climate_vote').rpc('ballot_list', { p_code: code });
  if (error) throw error;
  return (data ?? []) as BallotListRow[];
}

/**
 * 결과 집계. p_code(조 코드)를 함께 보내면 상태 무관 잠정 집계(운영진 경로),
 * 없으면 published일 때만 반환된다. 토큰이 무효하거나 게이트에 막히면 null.
 */
export async function ballotResults(token: string, code?: string | null): Promise<BallotResults | null> {
  const sb = client();
  const { data, error } = await sb.schema('climate_vote').rpc('ballot_results', {
    p_token: token,
    p_code: code ?? null,
  });
  if (error) throw error;
  return (data as BallotResults | null) ?? null;
}
