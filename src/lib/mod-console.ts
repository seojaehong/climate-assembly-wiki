import { getSupabase } from './supabase';
import { createSafeBrowserStorage } from './safe-browser-storage';
import { sortTeamsStandard } from './team-order';
import type { WorkshopAccess } from './deliberation';

/**
 * table_no는 20260726_team_table_no.sql이 추가한 열이다. 토큰 교환 응답에서 안전한 팀 필드만 받는다.
 * 이 타입은 손으로 유지하므로(Round와 동일) 마이그레이션 미적용 DB에서도 깨지지 않게 optional로 둔다.
 */
export type Team = {
  id: string;
  name: string;
  subgroup: string | null;
  capacity: number;
  table_no?: string | null;
};
/**
 * updated_at은 mod_set_round_status가 상태를 바꿀 때마다 now()로 갱신한다
 * (20260724_mod_console_core.sql:99). 마감된 라운드에서는 사실상 '마감 시각'이다.
 * 이 타입은 DB에서 생성된 것이 아니라 손으로 유지하는 타입이므로 optional로 둔다 —
 * 컬럼이 없거나 이름이 바뀌어도 타입체커는 알려주지 않는다.
 */
export type Round = {
  id: string;
  title: string;
  description?: string | null;
  type: 'RADIO' | 'CHECKBOX' | 'SCALE' | 'SCALE_MULTI' | 'TEXT';
  options: string[] | null;
  status: 'pending' | 'active' | 'closed';
  team_id: string | null;
  scale_low?: number | null;
  scale_high?: number | null;
  scale_low_label?: string | null;
  scale_high_label?: string | null;
  created_at?: string;
  updated_at?: string;
};
export type Vote = { id: number; round_id: string; choice: unknown; archived_at: string | null };
export type Tally = {
  total: number;
  byOption: Record<string, number>;
  averageByOption: Record<string, number>;
};
/**
 * /hq 읽기전용: join_code 제외 팀 정보(hq_teams RPC 반환).
 *
 * table_no는 hq_teams()가 돌려주는 6번째 열이다(20260726_team_table_no.sql).
 * 손유지 타입이라 타입체커는 DB와의 일치를 검증하지 못한다 — 마이그레이션이 적용되지 않은
 * 환경에서는 런타임 값이 undefined일 수 있으므로 표시부(tableNoLabel)가 그 경우를 흡수한다.
 */
export type HqTeam = { id: string; name: string; subgroup: string | null; capacity: number; status: string; table_no: string | null };

/** 6자리 숫자 조인코드만 허용 (앞뒤 공백 포함 불허). */
export function isValidJoinCode(code: string): boolean {
  return /^\d{6}$/.test(code);
}

/** archived 표를 제외하고 RADIO/SCALE/TEXT=choice 문자열 1카운트, CHECKBOX=choice 배열 각 항목 1카운트로 집계한다. */
export function tallyVotes(round: Round, votes: Vote[]): Tally {
  const byOption: Record<string, number> = {};
  for (const opt of round.options ?? []) byOption[opt] = 0;

  const live = votes.filter((v) => v.archived_at == null);

  for (const v of live) {
    if (round.type === 'CHECKBOX') {
      const choices = Array.isArray(v.choice) ? v.choice : [];
      for (const c of choices) {
        const key = String(c);
        byOption[key] = (byOption[key] ?? 0) + 1;
      }
    } else {
      // RADIO, SCALE, TEXT: choice는 단일 값(문자열 또는 숫자)
      const key = String(v.choice);
      byOption[key] = (byOption[key] ?? 0) + 1;
    }
  }

  return { total: live.length, byOption, averageByOption: {} };
}

const publicVoteStorage = createSafeBrowserStorage('localStorage');

/** Whether the anonymous client id will survive a page reload. */
export function isDeviceTokenPersistent(): boolean {
  return publicVoteStorage.isPersistent();
}

/** 브라우저 로컬 디바이스 토큰. 저장소가 막히면 현재 페이지 메모리에서 재사용한다. */
export function getDeviceToken(): string {
  const existing = publicVoteStorage.getItem('cv_device');
  if (existing) return existing;
  const legacy = publicVoteStorage.getItem('climate_vote_client_id');
  if (legacy) {
    publicVoteStorage.setItem('cv_device', legacy);
    if (publicVoteStorage.getItem('cv_device') === legacy) {
      publicVoteStorage.removeItem('climate_vote_client_id');
    }
    return legacy;
  }
  const token = crypto.randomUUID();
  publicVoteStorage.setItem('cv_device', token);
  return token;
}

function client() {
  const sb = getSupabase();
  if (!sb) throw new Error('Supabase client unavailable (missing env)');
  return sb;
}

/** 새 투표 라운드를 생성한다. */
export async function createPoll(
  access: WorkshopAccess,
  input: { title: string; type: Round['type']; options?: string[] },
  idempotencyKey: string,
): Promise<Round> {
  const sb = client();
  const { data, error } = await sb.schema('climate_vote').rpc('mod_create_round_v3', {
    p_token: access.accessToken,
    p_title: input.title,
    p_type: input.type,
    p_options: input.options ?? null,
    p_idempotency_key: idempotencyKey,
  });
  if (error) throw error;
  return data as Round;
}

/** 토큰에 묶인 조의 진행 중 라운드를 조회한다. */
export async function fetchActiveRound(access: WorkshopAccess): Promise<Round | null> {
  const rows = await fetchTeamRounds(access);
  return rows.find((round) => round.status === 'active') ?? null;
}

/** 공개 투표 링크의 라운드 id 하나만 조회한다. */
export async function fetchRound(roundId: string): Promise<Round | null> {
  const sb = client();
  const { data, error } = await sb.schema('climate_vote').rpc('public_round_get_v2', {
    p_round_id: roundId,
  });
  if (error) throw error;
  const row = ((data ?? []) as Array<Omit<Round, 'team_id'>>)[0];
  return row ? { ...row, team_id: null } : null;
}

/** Atomically change a round status using an expected-state precondition. */
export async function setPollStatus(
  access: WorkshopAccess,
  roundId: string,
  expectedStatus: 'active' | 'closed',
  status: 'active' | 'closed',
  idempotencyKey: string,
): Promise<Round> {
  const sb = client();
  const { data, error } = await sb.schema('climate_vote').rpc('mod_set_round_status_v3', {
    p_token: access.accessToken,
    p_round_id: roundId,
    p_expected_status: expectedStatus,
    p_status: status,
    p_idempotency_key: idempotencyKey,
  });
  if (error) throw error;
  if (typeof data !== 'object' || data === null) {
    throw new Error('round status response is invalid');
  }
  const row = data as Record<string, unknown>;
  if (row.id !== roundId || row.status !== status) {
    throw new Error('round status response does not match the requested transition');
  }
  return data as Round;
}

/**
 * 익명 표를 등록한다. voter_name은 절대 전송하지 않는다. 동일 client_id의 미보관 표가
 * 이미 있으면 'duplicate'를 반환한다. round가 이미 closed로 전환됐으면(스테일 탭·직접
 * REST 호출 등) 서버 RPC가 상태 잠금을 확인한 뒤 'closed'를 반환한다. 선택지는 서버가
 * 라운드 유형과 허용 options에 맞춰 검증하며 중복 투표도 같은 트랜잭션에서 판정한다.
 */
export async function castBallot(roundId: string, choice: unknown): Promise<'ok' | 'duplicate' | 'closed'> {
  const sb = client();
  const clientId = getDeviceToken();
  const { data, error } = await sb.schema('climate_vote').rpc('public_round_cast_v2', {
    p_round_id: roundId,
    p_choice: choice,
    p_client_id: clientId,
  });
  if (error) throw error;
  if (data !== 'ok' && data !== 'duplicate' && data !== 'closed') {
    throw new Error('public vote response is invalid');
  }
  return data;
}

/** 모더레이터가 무투표 시민 n명을 대신해 표를 등록한다. */
export async function proxyVote(
  access: WorkshopAccess,
  roundId: string,
  choice: unknown,
  n: number,
  idempotencyKey: string,
): Promise<number> {
  const sb = client();
  const { data, error } = await sb.schema('climate_vote').rpc('mod_proxy_vote_v3', {
    p_token: access.accessToken,
    p_round_id: roundId,
    p_choice: choice,
    p_n: n,
    p_idempotency_key: idempotencyKey,
  });
  if (error) throw error;
  return data as number;
}

/**
 * 타이머 시작/종료 로그를 남긴다(분석코어의 발언 배분 지표 원천). timer_log는
 * RLS enable + anon 정책이 없어 직접 insert가 불가능하므로 mod_log_timer RPC를 경유한다.
 * 호출부는 fire-and-forget으로 쓰되 실패를 기록해서, 타이머 UX를 막지 않으면서도
 * 운영 로그 유실이 조용히 묻히지 않게 한다.
 */
export async function logTimer(
  access: WorkshopAccess,
  entry: { kind: 'speech' | 'session'; duration_s: number; started_at: string; ended_at?: string | null },
): Promise<void> {
  const sb = client();
  const { error } = await sb.schema('climate_vote').rpc('mod_log_timer_v2', {
    p_token: access.accessToken,
    p_kind: entry.kind,
    p_duration_s: entry.duration_s,
    p_started_at: entry.started_at,
    p_ended_at: entry.ended_at ?? null,
  });
  if (error) throw error;
}

/** 토큰에 묶인 조 라운드의 표(soft-delete 포함)를 가져온다. */
export async function fetchTeamVotes(access: WorkshopAccess, roundId: string): Promise<Vote[]> {
  const sb = client();
  const { data, error } = await sb.schema('climate_vote').rpc('mod_votes_v2', {
    p_token: access.accessToken,
    p_round_id: roundId,
  });
  if (error) throw error;
  return (data ?? []) as Vote[];
}

/** 공개 투표는 마감 뒤 서버 집계만 조회한다. 개별 choice 행은 노출하지 않는다. */
export async function fetchPublicTally(roundId: string): Promise<Tally> {
  const sb = client();
  const { data, error } = await sb.schema('climate_vote').rpc('public_round_votes_v2', {
    p_round_id: roundId,
  });
  if (error) throw error;
  const rows = (data ?? []) as Array<{
    choice: unknown;
    vote_count: number;
    total_votes: number;
    average_score: number | string | null;
  }>;
  return {
    total: rows[0]?.total_votes ?? 0,
    byOption: Object.fromEntries(rows.map((row) => [String(row.choice), row.vote_count])),
    averageByOption: Object.fromEntries(rows.flatMap((row) => {
      if (row.average_score == null) return [];
      const average = Number(row.average_score);
      return Number.isFinite(average) ? [[String(row.choice), average]] : [];
    })),
  };
}

// ============================================================
// /hq — 본부 읽기전용 그리드. 쓰기 경로 없음(전부 SELECT/RPC-읽기).
// ============================================================

/**
 * 활성 팀 목록(join_code 제외, hq_teams RPC 경유). status='active'만 반환한다.
 *
 * hq_teams()에는 order by가 없고 Postgres는 order by 없는 결과의 행 순서를 보장하지 않는다.
 * 그래서 표준 조 순서(1분과 1~5조 → 2분과 1~5조 → 3분과 1~5조) 정렬을 여기서 걸어,
 * 이 함수를 쓰는 모든 화면(/hq 그리드·분과 필터·비교·출석 관리)이 같은 순서를 물려받게 한다.
 */
export async function fetchHqTeams(token: string, sessionSlug: string): Promise<HqTeam[]> {
  const sb = client();
  const { data, error } = await sb.schema('climate_vote').rpc('hq_teams_v2', {
    p_token: token,
    p_session_slug: sessionSlug,
  });
  if (error) throw error;
  const rows = (data ?? []) as HqTeam[];
  return sortTeamsStandard(rows.filter((t) => t.status === 'active'));
}

/** 토큰에 묶인 조의 라운드를 최신순으로 가져온다. */
export async function fetchTeamRounds(access: WorkshopAccess): Promise<Round[]> {
  const sb = client();
  const { data, error } = await sb.schema('climate_vote').rpc('mod_rounds_v2', {
    p_token: access.accessToken,
  });
  if (error) throw error;
  return (data ?? []) as Round[];
}

/** 토큰 세션의 안전한 팀 필드만 가져온다(분과 투표 대상 선택용). */
export async function fetchSessionTeams(access: WorkshopAccess): Promise<HqTeam[]> {
  const sb = client();
  const { data, error } = await sb.schema('climate_vote').rpc('mod_session_teams_v2', {
    p_token: access.accessToken,
  });
  if (error) throw error;
  return sortTeamsStandard((data ?? []) as HqTeam[]);
}

/** 토큰에 묶인 조 라운드들의 미보관 표 개수를 집계한다. */
export async function fetchTeamVoteCounts(
  access: WorkshopAccess,
  roundIds: string[],
): Promise<Record<string, number>> {
  const sb = client();
  const { data, error } = await sb.schema('climate_vote').rpc('mod_vote_counts_v2', {
    p_token: access.accessToken,
    p_round_ids: roundIds,
  });
  if (error) throw error;
  return Object.fromEntries(((data ?? []) as Array<{ round_id: string; vote_count: number }>).map(
    (row) => [row.round_id, row.vote_count],
  ));
}

/** HQ 토큰에 묶인 세션의 팀 목록 라운드를 최신순으로 가져온다. */
export async function fetchHqRounds(token: string, sessionSlug: string): Promise<Round[]> {
  const sb = client();
  const { data, error } = await sb.schema('climate_vote').rpc('hq_rounds_v2', {
    p_token: token,
    p_session_slug: sessionSlug,
  });
  if (error) throw error;
  return (data ?? []) as Round[];
}

/** HQ 토큰에 묶인 세션 라운드들의 미보관 표 개수를 집계한다. */
export async function fetchHqVoteCounts(
  token: string,
  sessionSlug: string,
  roundIds: string[],
): Promise<Record<string, number>> {
  const sb = client();
  const { data, error } = await sb.schema('climate_vote').rpc('hq_vote_counts_v2', {
    p_token: token,
    p_session_slug: sessionSlug,
    p_round_ids: roundIds,
  });
  if (error) throw error;
  return Object.fromEntries(((data ?? []) as Array<{ round_id: string; vote_count: number }>).map(
    (row) => [row.round_id, row.vote_count],
  ));
}

/** HQ 토큰에 묶인 세션의 미보관 표를 라운드별로 묶는다. */
export async function fetchHqVotesForRounds(
  token: string,
  sessionSlug: string,
  roundIds: string[],
): Promise<Record<string, Vote[]>> {
  const votesByRound = Object.fromEntries(roundIds.map((roundId) => [roundId, [] as Vote[]]));
  if (roundIds.length === 0) return votesByRound;

  const sb = client();
  const { data, error } = await sb.schema('climate_vote').rpc('hq_votes_v2', {
    p_token: token,
    p_session_slug: sessionSlug,
    p_round_ids: roundIds,
  });
  if (error) throw error;

  for (const vote of (data ?? []) as Vote[]) {
    (votesByRound[vote.round_id] ??= []).push(vote);
  }
  return votesByRound;
}
