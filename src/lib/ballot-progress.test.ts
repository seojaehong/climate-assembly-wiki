import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getSupabase } from './supabase';
import { ballotProgressNamed, resetBallotProgressForTest } from './ballot';
import { progressOrdinalsToSend } from '../islands/ballot/ballot-pager-logic';

vi.mock('./supabase', () => ({ getSupabase: vi.fn() }));

function mockRpc(impl: () => Promise<{ data: unknown; error: unknown }>) {
  const rpc = vi.fn(impl);
  const schema = vi.fn(() => ({ rpc }));
  vi.mocked(getSupabase).mockReturnValue({ schema } as never);
  return rpc;
}

const TOKEN = 'b'.repeat(32);

describe('진행 기록 ballotProgressNamed (s34)', () => {
  beforeEach(() => {
    vi.mocked(getSupabase).mockReset();
    resetBallotProgressForTest();
  });

  it('인자: 토큰·기기·조·이름·문항 번호만(찬반 값 없음)', async () => {
    const rpc = mockRpc(() => Promise.resolve({ data: { ok: true }, error: null }));
    expect(await ballotProgressNamed(TOKEN, 'device-123456', '1분과 3조', '홍길동', 5)).toBe(true);
    expect(rpc).toHaveBeenCalledWith('ballot_progress_named', {
      p_token: TOKEN,
      p_client_id: 'device-123456',
      p_voter_team: '1분과 3조',
      p_voter_name: '홍길동',
      p_ordinal: 5,
    });
  });

  it('같은 문항은 한 번만(답을 바꿔 다시 눌러도) — 다른 문항은 따로', async () => {
    const rpc = mockRpc(() => Promise.resolve({ data: { ok: true }, error: null }));
    await ballotProgressNamed(TOKEN, 'device-123456', '1조', '가나다', 1);
    await ballotProgressNamed(TOKEN, 'device-123456', '1조', '가나다', 1);
    // 보내는 중(await 전) 두 번 눌러도 하나.
    await Promise.all([
      ballotProgressNamed(TOKEN, 'device-123456', '1조', '가나다', 2),
      ballotProgressNamed(TOKEN, 'device-123456', '1조', '가나다', 2),
    ]);
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it('실패를 삼킨다 — 오류 응답 · 던짐 · 클라이언트 없음 · 기기 토큰 만들기 실패', async () => {
    mockRpc(() => Promise.resolve({ data: null, error: { message: 'ballot not open or event unavailable' } }));
    await expect(ballotProgressNamed(TOKEN, 'device-123456', '1조', '가나다', 1)).resolves.toBe(false);
    mockRpc(() => Promise.reject(new Error('network down')));
    await expect(ballotProgressNamed(TOKEN, 'device-123456', '1조', '가나다', 2)).resolves.toBe(false);
    vi.mocked(getSupabase).mockReturnValue(null as never);
    await expect(ballotProgressNamed(TOKEN, 'device-123456', '1조', '가나다', 3)).resolves.toBe(false);
    mockRpc(() => Promise.resolve({ data: { ok: true }, error: null }));
    await expect(
      ballotProgressNamed(TOKEN, () => { throw new Error('no randomUUID'); }, '1조', '가나다', 4),
    ).resolves.toBe(false);
  });

  it('실패한 문항은 다음 누름에 다시 보낸다', async () => {
    let fail = true;
    const rpc = mockRpc(() =>
      Promise.resolve(fail ? { data: null, error: { message: 'network' } } : { data: { ok: true }, error: null }),
    );
    expect(await ballotProgressNamed(TOKEN, 'device-123456', '1조', '가나다', 7)).toBe(false);
    fail = false;
    expect(await ballotProgressNamed(TOKEN, 'device-123456', '1조', '가나다', 7)).toBe(true);
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it('함수 없음(PGRST202, s34 미적용)이면 이 화면에서는 더 부르지 않는다', async () => {
    const rpc = mockRpc(() => Promise.resolve({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } }));
    expect(await ballotProgressNamed(TOKEN, 'device-123456', '1조', '가나다', 1)).toBe(false);
    for (let o = 2; o <= 28; o += 1) expect(await ballotProgressNamed(TOKEN, 'device-123456', '1조', '가나다', o)).toBe(false);
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});

describe('넘김식 → 보낼 문항 번호(progressOrdinalsToSend)', () => {
  const items = [1, 2, 3].map((n) => ({ id: `item-${n}`, ordinal: n }));
  const open = { named: true, confirmed: true, submitted: false };

  it('새로 고른 건 · 값을 바꾼 건만', () => {
    expect(progressOrdinalsToSend(items, {}, { 'item-2': 2 }, open)).toEqual([2]);
    expect(progressOrdinalsToSend(items, { 'item-2': 2 }, { 'item-2': 1 }, open)).toEqual([2]);
    expect(progressOrdinalsToSend(items, { 'item-1': 2 }, { 'item-1': 2, 'item-3': 1 }, open)).toEqual([3]);
  });

  it('처음 그릴 때(되살린 답 그대로) · 위치만 바뀜 → 없음', () => {
    const restored = { 'item-1': 2, 'item-2': 1 };
    expect(progressOrdinalsToSend(items, restored, { ...restored }, open)).toEqual([]);
  });

  it('이름 확인 전 · 무기명 · 제출 뒤 → 없음', () => {
    const next = { 'item-1': 2 };
    expect(progressOrdinalsToSend(items, {}, next, { ...open, confirmed: false })).toEqual([]);
    expect(progressOrdinalsToSend(items, {}, next, { ...open, named: false })).toEqual([]);
    expect(progressOrdinalsToSend(items, {}, next, { ...open, submitted: true })).toEqual([]);
  });

  it('찬반 값을 돌려주지 않는다(번호만)', () => {
    expect(progressOrdinalsToSend(items, {}, { 'item-1': 2, 'item-2': 1 }, open)).toEqual([1, 2]);
  });
});

describe('투표지 화면 배선(BallotCard)', () => {
  const src = readFileSync(new URL('../islands/ballot/BallotCard.tsx', import.meta.url), 'utf8');
  it('넘김식 onChange 에서 progressOrdinalsToSend → ballotProgressNamed(보내고 잊음)', () => {
    const start = src.indexOf('onChange={(nextAnswers, nextPos) => {');
    expect(start).toBeGreaterThan(-1);
    const body = src.slice(start, src.indexOf('setPagerPos(nextPos);', start));
    expect(body).toContain('progressOrdinalsToSend(ballot.items, answers, nextAnswers');
    expect(body).toMatch(/void ballotProgressNamed\(token, getDeviceToken, voter\.team, displayVoterName\(voter\.name\), ordinal\)/);
    expect(body).toContain("confirmed: voter.confirmed === true");
    expect(body).toContain("submitted: locallySubmitted || submitState !== 'idle' || submitting");
    expect(body).not.toMatch(/await\s+ballotProgressNamed/);
  });
});

describe('s34 SQL 계약(파일)', () => {
  const sql = readFileSync(new URL('../../supabase/migrations/20261112_s34_ballot_progress.sql', import.meta.url), 'utf8');
  const fn = (name: string) => {
    const start = sql.indexOf(`function climate_vote.${name}(`);
    expect(start).toBeGreaterThan(-1);
    return sql.slice(start, sql.indexOf('$function$;', start));
  };
  it('두 함수 모두 PUBLIC 회수 + anon·authenticated 부여(짝)', () => {
    for (const sig of ['ballot_progress_named(text,text,text,text,int)', 'ballot_progress_board(text,uuid)']) {
      expect(sql).toContain(`grant execute on function climate_vote.${sig} to anon, authenticated;`);
      expect(sql).toContain(`revoke execute on function climate_vote.${sig} from public;`);
    }
    expect(sql).toContain('alter table climate_vote.ballot_progress enable row level security;');
    expect(sql).toContain('revoke all on climate_vote.ballot_progress from public, anon, authenticated;');
  });
  it('쓰기: s33 ballot_start_named 와 같은 토큰·이름 검증과 open 투표지 조건', () => {
    const body = fn('ballot_progress_named');
    for (const guard of [
      "if p_token is null or length(p_token)<>32 then raise exception 'ballot token required'; end if;",
      'climate_vote.voter_name_norm(p_voter_name)',
      "s.status='active'",
      's.access_expires_at is not null and s.access_expires_at>now()',
      "b.status='open' and b.archived_at is null",
    ]) expect(body).toContain(guard);
    expect(body).not.toMatch(/answers/);
  });
  it('운영 보드: 접속 토큰 인가 블록, 응답 answers 는 키 존재(?)로만', () => {
    const body = fn('ballot_progress_board');
    expect(body).toContain('v_auth:=climate_vote.attendance_token_row(p_token);');
    expect(body).toContain('v_team:=climate_vote.team_token_row(p_token);');
    expect(body).toContain("raise exception 'ballot not in authorization scope'");
    const answerRefs = body.match(/[a-z_.]*answers[^\n]*/g) ?? [];
    for (const ref of answerRefs) expect(ref).toMatch(/br\.answers \? bi\.id::text|p\.answered|answered/);
    expect(body).not.toMatch(/'answers'/);
    expect(body).not.toMatch(/br\.answers\s*->/);
  });
});
