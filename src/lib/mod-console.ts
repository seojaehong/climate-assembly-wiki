import { getSupabase } from './supabase';
import { sortTeamsStandard } from './team-order';

export type Team = { id: string; name: string; subgroup: string | null; join_code: string; capacity: number };
/**
 * updated_at은 mod_set_round_status가 상태를 바꿀 때마다 now()로 갱신한다
 * (20260724_mod_console_core.sql:99). 마감된 라운드에서는 사실상 '마감 시각'이다.
 * 이 타입은 DB에서 생성된 것이 아니라 손으로 유지하는 타입이므로 optional로 둔다 —
 * 컬럼이 없거나 이름이 바뀌어도 타입체커는 알려주지 않는다.
 */
export type Round = { id: string; title: string; type: 'RADIO' | 'CHECKBOX' | 'SCALE'; options: string[] | null; status: 'pending' | 'active' | 'closed'; team_id: string | null; created_at?: string; updated_at?: string };
export type Vote = { id: number; round_id: string; choice: unknown; archived_at: string | null };
export type Tally = { total: number; byOption: Record<string, number> };
/** /hq 읽기전용: join_code 제외 팀 정보(hq_teams RPC 반환). */
export type HqTeam = { id: string; name: string; subgroup: string | null; capacity: number; status: string };

/** 6자리 숫자 조인코드만 허용 (앞뒤 공백 포함 불허). */
export function isValidJoinCode(code: string): boolean {
  return /^\d{6}$/.test(code);
}

/** archived 표를 제외하고 RADIO/SCALE=choice 문자열 1카운트, CHECKBOX=choice 배열 각 항목 1카운트로 집계한다. */
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
      // RADIO, SCALE: choice는 단일 값(문자열 또는 숫자)
      const key = String(v.choice);
      byOption[key] = (byOption[key] ?? 0) + 1;
    }
  }

  return { total: live.length, byOption };
}

/** 브라우저 로컬 디바이스 토큰. SSR(localStorage 없음) 시에는 휘발성 토큰을 생성한다. */
export function getDeviceToken(): string {
  if (typeof localStorage === 'undefined') return crypto.randomUUID();
  const existing = localStorage.getItem('cv_device');
  if (existing) return existing;
  const token = crypto.randomUUID();
  localStorage.setItem('cv_device', token);
  return token;
}

function client() {
  const sb = getSupabase();
  if (!sb) throw new Error('Supabase client unavailable (missing env)');
  return sb;
}

/**
 * 조인코드로 팀에 합류한다. RPC가 정상 실행됐으나 일치하는 팀이 없으면(잘못된 코드) null을
 * 반환한다. RPC 자체가 실패하면(네트워크·서버 오류) 그 error를 throw한다 — 호출부가 "코드가
 * 틀렸습니다"와 "연결에 실패했습니다"를 구분해 안내할 수 있도록 한다.
 */
export async function joinTeam(code: string): Promise<Team | null> {
  const sb = client();
  const { data, error } = await sb.schema('climate_vote').rpc('mod_join', { p_code: code });
  if (error) throw error;
  if (!data) return null;
  const row = Array.isArray(data) ? data[0] : data;
  return (row as Team) ?? null;
}

/** 새 투표 라운드를 생성한다. */
export async function createPoll(
  code: string,
  input: { title: string; type: Round['type']; options?: string[] },
): Promise<Round> {
  const sb = client();
  const { data, error } = await sb.schema('climate_vote').rpc('mod_create_round', {
    p_code: code,
    p_title: input.title,
    p_type: input.type,
    p_options: input.options ?? null,
  });
  if (error) throw error;
  return data as Round;
}

/** 팀의 진행 중(active) 라운드를 조회한다. 없으면 null. rounds SELECT는 공개(anon) 정책이다. */
export async function fetchActiveRound(teamId: string): Promise<Round | null> {
  const sb = client();
  const { data, error } = await sb
    .schema('climate_vote')
    .from('rounds')
    .select('*')
    .eq('team_id', teamId)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1);
  if (error) throw error;
  const rows = (data ?? []) as Round[];
  return rows[0] ?? null;
}

/** 라운드 id로 단건 조회한다. 없으면 null. rounds SELECT는 공개(anon) 정책이다. */
export async function fetchRound(roundId: string): Promise<Round | null> {
  const sb = client();
  const { data, error } = await sb
    .schema('climate_vote')
    .from('rounds')
    .select('*')
    .eq('id', roundId)
    .maybeSingle();
  if (error) throw error;
  return (data as Round | null) ?? null;
}

/** 라운드 상태(active/closed)를 변경한다. */
export async function setPollStatus(code: string, roundId: string, status: 'active' | 'closed'): Promise<Round> {
  const sb = client();
  const { data, error } = await sb.schema('climate_vote').rpc('mod_set_round_status', {
    p_code: code,
    p_round_id: roundId,
    p_status: status,
  });
  if (error) throw error;
  return data as Round;
}

/**
 * 익명 표를 등록한다. voter_name은 절대 전송하지 않는다. 동일 client_id의 미보관 표가
 * 이미 있으면 'duplicate'를 반환한다. round가 이미 closed로 전환됐으면(스테일 탭·직접
 * REST 호출 등) DB 트리거(votes_active_round_guard)가 'round not active' 예외를 던지고,
 * 이를 'closed'로 매핑해 반환한다(에러가 아니라 결과 화면 전환 신호).
 */
export async function castBallot(roundId: string, choice: unknown): Promise<'ok' | 'duplicate' | 'closed'> {
  const sb = client();
  const clientId = getDeviceToken();

  // 중복 체크(select)와 등록(insert) 사이에는 TOCTOU 레이스 윈도우가 존재한다(동일 client_id가
  // 거의 동시에 두 번 castBallot을 호출하면 둘 다 select를 통과할 수 있음). 1차 방어는 UI 단일-탭
  // 비활성화(Task 4)이고, 최종 백스톱은 DB에 이미 존재하는 부분 유니크 인덱스
  // uniq_votes_round_client_active (round_id, client_id) where client_id is not null and
  // archived_at is null — 아래 insert의 23505 처리가 그 신호를 받는다. (신규 인덱스 추가를
  // 검토했으나 이 기존 인덱스와 완전히 중복되어 폐기함 — task-2-report.md Fix 2 참고.)
  const { data: existing, error: selectError } = await sb
    .schema('climate_vote')
    .from('votes')
    .select('id')
    .eq('round_id', roundId)
    .eq('client_id', clientId)
    .is('archived_at', null);
  if (selectError) throw selectError;
  if (existing && existing.length > 0) return 'duplicate';

  const { error } = await sb.schema('climate_vote').from('votes').insert({
    round_id: roundId,
    choice,
    client_id: clientId,
  });
  if (error) {
    if ((error as { code?: string }).code === '23505') return 'duplicate';
    if ((error as { message?: string }).message?.includes('round not active')) return 'closed';
    throw error;
  }
  return 'ok';
}

/** 모더레이터가 무투표 시민 n명을 대신해 표를 등록한다. */
export async function proxyVote(code: string, roundId: string, choice: unknown, n: number): Promise<number> {
  const sb = client();
  const { data, error } = await sb.schema('climate_vote').rpc('mod_proxy_vote', {
    p_code: code,
    p_round_id: roundId,
    p_choice: choice,
    p_n: n,
  });
  if (error) throw error;
  return data as number;
}

/**
 * 타이머 시작/종료 로그를 남긴다(분석코어의 발언 배분 지표 원천). timer_log는
 * RLS enable + anon 정책이 없어 직접 insert가 불가능하므로 mod_log_timer RPC를 경유한다.
 * 호출부는 fire-and-forget(void logTimer(...).catch(() => {}))으로 써서 실패해도
 * 타이머 UX는 절대 막지 않는다.
 */
export async function logTimer(
  code: string,
  entry: { kind: 'speech' | 'session'; duration_s: number; started_at: string; ended_at?: string | null },
): Promise<void> {
  const sb = client();
  const { error } = await sb.schema('climate_vote').rpc('mod_log_timer', {
    p_code: code,
    p_kind: entry.kind,
    p_duration_s: entry.duration_s,
    p_started_at: entry.started_at,
    p_ended_at: entry.ended_at ?? null,
  });
  if (error) throw error;
}

/** 라운드의 표(soft-delete 포함)를 전부 가져온다. */
export async function fetchVotes(roundId: string): Promise<Vote[]> {
  const sb = client();
  const { data, error } = await sb
    .schema('climate_vote')
    .from('votes')
    .select('id,round_id,choice,archived_at')
    .eq('round_id', roundId);
  if (error) throw error;
  return (data ?? []) as Vote[];
}

/** votes 테이블 실시간 변경을 구독한다. 반환값을 호출하면 구독 해제된다. */
export function subscribeRound(roundId: string, onChange: () => void): () => void {
  const sb = client();
  const channel = sb
    .channel(`mod:${roundId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'climate_vote', table: 'votes', filter: `round_id=eq.${roundId}` },
      onChange,
    )
    .subscribe();
  return () => {
    sb.removeChannel(channel);
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
export async function fetchHqTeams(): Promise<HqTeam[]> {
  const sb = client();
  const { data, error } = await sb.schema('climate_vote').rpc('hq_teams');
  if (error) throw error;
  const rows = (data ?? []) as HqTeam[];
  return sortTeamsStandard(rows.filter((t) => t.status === 'active'));
}

/** team_id가 있는 전체 라운드(팀 스코프)를 최신순으로 가져온다. rounds SELECT는 공개(anon) 정책이다. */
export async function fetchTeamRounds(): Promise<Round[]> {
  const sb = client();
  const { data, error } = await sb
    .schema('climate_vote')
    .from('rounds')
    .select('*')
    .not('team_id', 'is', null)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as Round[];
}

/** 주어진 라운드 id들의 미보관(archived_at is null) 표 개수를 라운드별로 집계한다. */
export async function fetchVoteCounts(roundIds: string[]): Promise<Record<string, number>> {
  const sb = client();
  const counts: Record<string, number> = {};
  await Promise.all(
    roundIds.map(async (id) => {
      const { count, error } = await sb
        .schema('climate_vote')
        .from('votes')
        .select('*', { count: 'exact', head: true })
        .eq('round_id', id)
        .is('archived_at', null);
      if (error) throw error;
      counts[id] = count ?? 0;
    }),
  );
  return counts;
}

/** 주어진 라운드들의 미보관 표를 한 번에 조회해 라운드별로 묶는다. /hq 상세·비교 표시 전용 읽기 경로. */
export async function fetchVotesForRounds(roundIds: string[]): Promise<Record<string, Vote[]>> {
  const votesByRound = Object.fromEntries(roundIds.map((roundId) => [roundId, [] as Vote[]]));
  if (roundIds.length === 0) return votesByRound;

  const sb = client();
  const { data, error } = await sb
    .schema('climate_vote')
    .from('votes')
    .select('id,round_id,choice,archived_at')
    .in('round_id', roundIds)
    .is('archived_at', null);
  if (error) throw error;

  for (const vote of (data ?? []) as Vote[]) {
    (votesByRound[vote.round_id] ??= []).push(vote);
  }
  return votesByRound;
}

/** rounds/votes(climate_vote) 실시간 변경을 구독한다(필터 없음 — 그리드 전체 갱신 트리거용). */
export function subscribeHqUpdates(onChange: () => void): () => void {
  const sb = client();
  const channel = sb
    .channel('hq:grid')
    .on('postgres_changes', { event: '*', schema: 'climate_vote', table: 'rounds' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'climate_vote', table: 'votes' }, onChange)
    .subscribe();
  return () => {
    sb.removeChannel(channel);
  };
}
