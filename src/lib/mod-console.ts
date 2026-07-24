import { getSupabase } from './supabase';

export type Team = { id: string; name: string; subgroup: string | null; join_code: string; capacity: number };
export type Round = { id: string; title: string; type: 'RADIO' | 'CHECKBOX' | 'SCALE'; options: string[] | null; status: 'pending' | 'active' | 'closed'; team_id: string | null };
export type Vote = { id: number; round_id: string; choice: unknown; archived_at: string | null };
export type Tally = { total: number; byOption: Record<string, number> };

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

/** 조인코드로 팀에 합류한다. RPC가 예외를 던지면(잘못된 코드) null을 반환한다. */
export async function joinTeam(code: string): Promise<Team | null> {
  const sb = client();
  const { data, error } = await sb.schema('climate_vote').rpc('mod_join', { p_code: code });
  if (error || !data) return null;
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

/** 익명 표를 등록한다. voter_name은 절대 전송하지 않는다. 동일 client_id의 미보관 표가 이미 있으면 'duplicate'를 반환한다. */
export async function castBallot(roundId: string, choice: unknown): Promise<'ok' | 'duplicate'> {
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
