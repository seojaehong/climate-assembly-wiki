import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getSupabase } from './supabase';
import { fetchBallotRoster, submitBallot, submitBallotNamed } from './ballot';
import { ballotNamedResponses, namedVoteSettings, setNamedVoteSettings } from './deliberation';

vi.mock('./supabase', () => ({ getSupabase: vi.fn() }));

function mockRpc(results: Array<{ data: unknown; error: unknown }>) {
  const rpc = vi.fn(() => Promise.resolve(results.shift() ?? { data: null, error: null }));
  const schema = vi.fn(() => ({ rpc }));
  vi.mocked(getSupabase).mockReturnValue({ schema } as never);
  return rpc;
}

const TOKEN = 'b'.repeat(32);

describe('실명 투표 RPC 배선 (s28)', () => {
  beforeEach(() => vi.mocked(getSupabase).mockReset());

  it('명단 조회: 행이 있으면 그대로, 함수가 없으면(PGRST202) 빈 명단 = 무기명', async () => {
    let rpc = mockRpc([{ data: { roster: [{ team: '1분과 1조', no: 1, name: '가나다' }] }, error: null }]);
    expect(await fetchBallotRoster(TOKEN)).toEqual([{ team: '1분과 1조', no: 1, name: '가나다' }]);
    expect(rpc).toHaveBeenCalledWith('ballot_roster_get', { p_token: TOKEN });

    mockRpc([{ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } }]);
    expect(await fetchBallotRoster(TOKEN)).toEqual([]);

    // 명단 없는 세션(또는 수집 꺼짐) — 서버가 빈 배열.
    mockRpc([{ data: { roster: [] }, error: null }]);
    expect(await fetchBallotRoster(TOKEN)).toEqual([]);

    // 투표 토큰이 없거나 비공개 — null.
    mockRpc([{ data: null, error: null }]);
    expect(await fetchBallotRoster(TOKEN)).toEqual([]);
  });

  it('명단 조회의 다른 오류는 삼키지 않는다(이름을 조용히 빼먹지 않게)', async () => {
    mockRpc([{ data: null, error: { code: '500', message: 'network' } }]);
    await expect(fetchBallotRoster(TOKEN)).rejects.toBeTruthy();
  });

  it('실명 제출: 인자와 결과 매핑(같은 이름 → name_taken, 같은 기기 → duplicate, 마감 → closed, 수집 꺼짐 → named_off)', async () => {
    const rpc = mockRpc([{ data: { ok: true }, error: null }]);
    expect(await submitBallotNamed(TOKEN, 'device-123456', { i: 2 }, '1분과 3조', '홍길동')).toBe('ok');
    expect(rpc).toHaveBeenCalledWith('ballot_submit_named', {
      p_token: TOKEN,
      p_client_id: 'device-123456',
      p_answers: { i: 2 },
      p_voter_team: '1분과 3조',
      p_voter_name: '홍길동',
    });
    mockRpc([{ data: null, error: { message: 'name already submitted' } }]);
    expect(await submitBallotNamed(TOKEN, 'device-123456', { i: 2 }, '1분과 3조', '홍길동')).toBe('name_taken');
    mockRpc([{ data: null, error: { message: 'already submitted' } }]);
    expect(await submitBallotNamed(TOKEN, 'device-123456', { i: 2 }, '1분과 3조', '홍길동')).toBe('duplicate');
    mockRpc([{ data: null, error: { message: 'ballot not open or event unavailable' } }]);
    expect(await submitBallotNamed(TOKEN, 'device-123456', { i: 2 }, '1분과 3조', '홍길동')).toBe('closed');
    mockRpc([{ data: null, error: { message: 'named voting off' } }]);
    expect(await submitBallotNamed(TOKEN, 'device-123456', { i: 2 }, '1분과 3조', '홍길동')).toBe('named_off');
    mockRpc([{ data: null, error: { message: 'voter team not in roster' } }]);
    await expect(submitBallotNamed(TOKEN, 'device-123456', { i: 2 }, '9조', '홍길동')).rejects.toBeTruthy();
  });

  it('무기명 제출은 옛 ballot_submit 그대로(조·이름 인자 없음)', async () => {
    const rpc = mockRpc([{ data: { ok: true }, error: null }]);
    expect(await submitBallot(TOKEN, 'device-123456', { i: 1 })).toBe('ok');
    expect(rpc).toHaveBeenCalledWith('ballot_submit', { p_token: TOKEN, p_client_id: 'device-123456', p_answers: { i: 1 } });
  });

  it('운영 RPC: 실명 응답·스위치 — 함수 없으면 null', async () => {
    const access = { accessToken: 'a'.repeat(64) };
    let rpc = mockRpc([{ data: { id: 'x', responses: [] }, error: null }]);
    expect(await ballotNamedResponses(access, 'x')).toEqual({ id: 'x', responses: [] });
    expect(rpc).toHaveBeenCalledWith('ballot_named_responses_v2', { p_token: access.accessToken, p_ballot_id: 'x' });
    mockRpc([{ data: null, error: { code: 'PGRST202', message: '' } }]);
    expect(await ballotNamedResponses(access, 'x')).toBeNull();
    mockRpc([{ data: null, error: { code: 'PGRST202', message: '' } }]);
    expect(await namedVoteSettings(access)).toBeNull();
    rpc = mockRpc([{ data: { collect: false, show_names: true }, error: null }]);
    expect(await setNamedVoteSettings(access, { collect: false })).toEqual({ collect: false, show_names: true });
    expect(rpc).toHaveBeenCalledWith('ballot_named_settings_set_v2', { p_token: access.accessToken, p_collect: false, p_show_names: null });
  });
});

/**
 * DB 를 띄우지 못하는 대신 마이그레이션 글을 지킨다 — 범위·검사·권한이 빠지면 여기서 깨진다.
 */
describe('s28 마이그레이션 불변식', () => {
  const sql = readFileSync(new URL('../../supabase/migrations/20261017_s28_named_ballot.sql', import.meta.url), 'utf8');
  const fn = (name: string) => {
    const start = sql.indexOf(`function climate_vote.${name}(`);
    expect(start).toBeGreaterThan(-1);
    const end = sql.indexOf('$function$;', start);
    return sql.slice(start, end);
  };
  const SCOPE = "(nullif(btrim(v_ballot.subgroup),'') is null or r.subgroup=btrim(v_ballot.subgroup))";

  it('명단 읽기는 그 투표의 세션·분과로만 걸린다(다른 분과 명단을 못 읽는다)', () => {
    const body = fn('ballot_roster_get');
    expect(body).toContain('r.session_id = v_ballot.session_id');
    expect(body).toContain("(nullif(btrim(v_ballot.subgroup),'') is null or r.subgroup = btrim(v_ballot.subgroup))");
    expect(body).toContain("status in ('open','closed','published')");
  });

  it('실명 제출은 ballot_submit 의 검사를 그대로 갖고, 이름 중복·기기 중복·명단 조를 막는다', () => {
    const body = fn('ballot_submit_named');
    for (const guard of [
      "raise exception 'ballot token required'",
      "raise exception 'ballot client id required'",
      "raise exception 'answers must be object'",
      "b.status='open' and b.archived_at is null",
      'for update of b',
      "raise exception 'answers contain unknown ballot item'",
      "raise exception 'answer out of scale for item %'",
      "raise exception 'named voting off'",
      "raise exception 'ballot roster not configured'",
      "raise exception 'voter team not in roster'",
      "raise exception 'name already submitted'",
      "raise exception 'already submitted'",
      'br.voter_name_norm=v_norm',
    ]) {
      expect(body).toContain(guard);
    }
    // 기기 중복을 이름 중복보다 먼저 본다(같은 기기 재전송이 「이름 중복」으로 보이지 않게).
    expect(body.indexOf('br.client_id=trim(p_client_id)')).toBeLessThan(body.indexOf("'name already submitted'"));
    expect(body.split(SCOPE).length - 1).toBeGreaterThanOrEqual(3);
  });

  it('운영 RPC 는 set_status_v2 와 같은 인증·분과 범위', () => {
    for (const name of ['ballot_named_responses_v2', 'ballot_voter_correct_v2']) {
      const body = fn(name);
      expect(body).toContain('climate_vote.attendance_token_row(p_token)');
      expect(body).toContain('climate_vote.team_token_row(p_token)');
      expect(body).toContain('btrim(v_team.subgroup) <> btrim(v_ballot.subgroup)');
    }
  });

  it('정정은 조·이름만 바꾸고 answers 를 건드리지 않으며 감사 기록을 남긴다', () => {
    const body = fn('ballot_voter_correct_v2');
    const update = body.slice(body.indexOf('update climate_vote.ballot_response'), body.indexOf('where id=v_resp.id;'));
    expect(update).not.toMatch(/answers/);
    expect(body).toContain("'ballot_voter_correct'");
  });

  it('새 함수는 전부 anon·authenticated grant + PUBLIC revoke 짝', () => {
    for (const sig of [
      'ballot_roster_get(text)',
      'ballot_submit_named(text,text,jsonb,text,text)',
      'ballot_named_responses_v2(text,uuid)',
      'ballot_voter_correct_v2(text,uuid,uuid,text,text)',
      'ballot_named_settings_set_v2(text,boolean,boolean)',
      'ballot_named_settings_v2(text)',
    ]) {
      expect(sql).toContain(`grant execute on function climate_vote.${sig} to anon, authenticated;`);
      expect(sql).toContain(`revoke execute on function climate_vote.${sig} from public;`);
    }
    expect(sql).toContain('revoke all on climate_vote.ballot_roster from public, anon, authenticated;');
    expect(sql).toContain('alter table climate_vote.ballot_roster enable row level security;');
    // 옛 ballot_submit 시그니처는 건드리지 않는다.
    expect(sql).not.toMatch(/function climate_vote\.ballot_submit\(/);
  });
});
