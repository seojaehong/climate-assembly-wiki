import { getSupabase } from './supabase';
import type { RosterRow } from './named-vote-logic';

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
  /** 분과 스코프(20260808_s4). null=세션 전체. S4 미적용 DB는 키가 없다(undefined) — 전체로 간주. */
  subgroup?: string | null;
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
  /** 분과 스코프(20260808_s4). null=세션 전체. S4 미적용 DB는 키가 없다(undefined) — 전체로 간주. */
  subgroup?: string | null;
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

// ── 제한 시간 · 제출 재시도(11/14 — 폰 180대 동시 접속) ─────────────────

/** 처음 불러오기(투표지 · 명단) 제한 시간. 넘기면 「불러오는 중」에 머물지 않고 「다시 불러오기」 화면으로 간다. */
export const BALLOT_LOAD_TIMEOUT_MS = 10_000;
/** 제출 요청 한 번의 제한 시간. */
export const BALLOT_SUBMIT_TIMEOUT_MS = 12_000;
/** 제출 시도 횟수 — 처음 1번 + 자동 재시도 2번. */
export const BALLOT_SUBMIT_MAX_ATTEMPTS = 3;

/** 제한 시간을 넘겨 끊은 요청. */
export class BallotTimeoutError extends Error {
  constructor(ms: number) {
    super(`ballot request timed out after ${ms}ms`);
    this.name = 'BallotTimeoutError';
  }
}

/**
 * RPC 한 번을 제한 시간 안에 끝낸다. 넘기면 요청을 끊고(AbortController) BallotTimeoutError 로 던진다.
 * AbortSignal.timeout 은 옛 Safari 에 없어 setTimeout 으로 끊는다.
 */
async function rpcWithTimeout<R>(call: (signal: AbortSignal) => PromiseLike<R>, ms: number): Promise<R> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new BallotTimeoutError(ms));
    }, ms);
  });
  try {
    return await Promise.race([call(controller.signal), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 다시 보내도 되는 일시 장애인가 — 연결 끊김 · 제한 시간 · 서버 5xx(503 · 504 포함) · PGRST003(연결 대기 초과) ·
 * 57014(statement timeout). status 0 = postgrest-js 가 fetch 실패(네트워크 끊김 · 중단)를 돌려주는 값.
 * 업무상 거절(마감 · 명단 밖 · 같은 이름 · 입력 검사)은 raise exception(P0001 · 400)이라 다시 보내지 않는다.
 */
export function isTransientBallotError(error: unknown, status?: number): boolean {
  if (error instanceof BallotTimeoutError) return true;
  const code = (error as { code?: unknown } | null)?.code;
  if (code === 'P0001') return false;
  if (status === 0 || (typeof status === 'number' && status >= 500)) return true;
  return code === 'PGRST003' || code === '57014';
}

/** 재시도 전 기다림 0.5~1.5초 — 무작위로 흩어 폰 여러 대가 한꺼번에 다시 몰리지 않게. */
export function ballotRetryDelayMs(random: () => number = Math.random): number {
  return 500 + Math.floor(random() * 1000);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 토큰으로 투표 정의를 조회한다. 없거나 비공개(draft·archived)면 null —
 * RPC가 둘을 구분하지 않으므로 호출부도 동일하게 "유효하지 않음"으로 안내한다.
 * 10초 안에 답이 없으면 끊고 던진다(화면이 「다시 불러오기」를 띄운다).
 */
export async function fetchBallot(token: string): Promise<Ballot | null> {
  const sb = client();
  const { data, error } = await rpcWithTimeout(
    (signal) => sb.schema('climate_vote').rpc('ballot_get', { p_token: token }).abortSignal(signal),
    BALLOT_LOAD_TIMEOUT_MS,
  );
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

// ── 실명 투표(s28, 10/17) ─────────────────────────────────────────────

export type { RosterRow };

/** PostgREST 가 함수를 못 찾았다(마이그레이션 미적용) — 무기명으로 내려간다. */
export function isMissingRpc(error: unknown): boolean {
  const e = error as { code?: string; message?: string } | null;
  return e?.code === 'PGRST202' || /could not find the function/i.test(e?.message ?? '');
}

/**
 * 투표 범위의 명단. 명단이 없거나 s28 미적용이면 [] — 그때 화면은 지금처럼 무기명이다.
 * 그 밖의 오류는 throw(화면이 「다시 불러오기」를 띄운다 — 이름을 조용히 빼먹지 않게). 10초 제한 시간도 같다.
 */
export async function fetchBallotRoster(token: string): Promise<RosterRow[]> {
  const sb = client();
  const { data, error } = await rpcWithTimeout(
    (signal) => sb.schema('climate_vote').rpc('ballot_roster_get', { p_token: token }).abortSignal(signal),
    BALLOT_LOAD_TIMEOUT_MS,
  );
  if (error) {
    if (isMissingRpc(error)) return [];
    throw error;
  }
  const rows = (data as { roster?: RosterRow[] } | null)?.roster;
  return Array.isArray(rows) ? rows : [];
}

export type NamedSubmitResult = BallotSubmitResult | 'name_taken' | 'named_off';

/**
 * 11/11 — 「투표 시작」 기록(이름 확인 「네」를 누른 순간). 찬성·반대는 보내지 않는다.
 * 실패해도 투표는 그대로 이어진다 — 오류를 삼키고 false 만 돌려준다(s33 미적용 포함).
 * clientId 는 함수로도 받는다 — 기기 토큰 만들기가 던져도(crypto.randomUUID 없는 옛 iOS) 이 try 안에서 삼킨다.
 */
export async function startBallotNamed(
  token: string,
  clientId: string | (() => string),
  voterTeam: string,
  voterName: string,
): Promise<boolean> {
  try {
    const sb = client();
    const { error } = await sb.schema('climate_vote').rpc('ballot_start_named', {
      p_token: token,
      p_client_id: typeof clientId === 'function' ? clientId() : clientId,
      p_voter_team: voterTeam,
      p_voter_name: voterName,
    });
    return !error;
  } catch {
    return false;
  }
}

/** 진행 기록 — 이미 보냈거나 보내는 중인 (토큰·조·이름·문항) 열쇠. 실패하면 지워 다음 누름에 다시 보낸다. */
const progressSent = new Set<string>();
/** s34 미적용(PGRST202)이면 이 화면에서는 더 부르지 않는다 — 70건마다 실패 호출을 쌓지 않게. */
let progressRpcMissing = false;

/** 시험용 — 중복 억제·미적용 걸쇠를 비운다. */
export function resetBallotProgressForTest(): void {
  progressSent.clear();
  progressRpcMissing = false;
}

/**
 * 11/12 — 카드 한 장을 눌렀다는 기록(s34 ballot_progress_named). 찬성·반대 값은 보내지 않는다(문항 번호만).
 * 절대 throw 하지 않는다 — 네트워크 실패 · 함수 없음 · 마감 모두 삼키고 false. 투표 흐름을 막지 않는다.
 * 같은 (토큰·조·이름·문항)은 한 번만 보낸다(답을 바꿔 다시 눌러도). clientId 는 startBallotNamed 처럼 함수로도 받는다.
 */
export async function ballotProgressNamed(
  token: string,
  clientId: string | (() => string),
  voterTeam: string,
  voterName: string,
  ordinal: number,
): Promise<boolean> {
  if (progressRpcMissing) return false;
  const key = `${token}\u0000${voterTeam}\u0000${voterName}\u0000${ordinal}`;
  if (progressSent.has(key)) return false;
  progressSent.add(key);
  try {
    const sb = client();
    const { error } = await sb.schema('climate_vote').rpc('ballot_progress_named', {
      p_token: token,
      p_client_id: typeof clientId === 'function' ? clientId() : clientId,
      p_voter_team: voterTeam,
      p_voter_name: voterName,
      p_ordinal: ordinal,
    });
    if (error) {
      if (isMissingRpc(error)) progressRpcMissing = true;
      progressSent.delete(key);
      return false;
    }
    return true;
  } catch {
    progressSent.delete(key);
    return false;
  }
}

export type BallotLiveCounts = {
  status: string;
  title: string;
  items: number;
  started: number;
  submitted: number;
  in_progress: number;
  roster: number;
  at: string;
};

/** 표출 화면 — 시작·제출·투표 중 인원(수만, 이름 없음). */
export async function fetchBallotLiveCounts(token: string): Promise<BallotLiveCounts> {
  const sb = client();
  const { data, error } = await sb.schema('climate_vote').rpc('ballot_live_counts', { p_token: token });
  if (error) throw error;
  return data as BallotLiveCounts;
}

/**
 * 실명 제출. 같은 이름이 이미 있으면 'name_taken'(이 기기는 잠그지 않는다).
 * 요청 한 번은 12초 제한. 일시 장애(isTransientBallotError)면 0.5~1.5초 쉬고 같은 client_id 로 2번까지 다시 보낸다.
 * 다시 보내도 안전하다 — 서버(s28 · s32)는 투표 행 잠금 아래에서 같은 client_id 를 이름보다 먼저 보고
 * 「already submitted」로 막는다(s2 unique(ballot_id, client_id)도 있다). 그래서 다시 보낸 요청의 'duplicate' 는
 * 앞선 시도가 들어간 것이므로 'ok' 로 돌려준다. 업무상 거절은 다시 보내지 않는다.
 */
export async function submitBallotNamed(
  token: string,
  clientId: string,
  answers: Record<string, number>,
  voterTeam: string,
  voterName: string,
  retry: { sleep?: (ms: number) => Promise<void>; random?: () => number } = {},
): Promise<NamedSubmitResult> {
  const sb = client();
  for (let attempt = 1; ; attempt++) {
    let error: unknown = null;
    let status: number | undefined;
    try {
      ({ error, status } = await rpcWithTimeout(
        (signal) =>
          sb
            .schema('climate_vote')
            .rpc('ballot_submit_named', {
              p_token: token,
              p_client_id: clientId,
              p_answers: answers,
              p_voter_team: voterTeam,
              p_voter_name: voterName,
            })
            .abortSignal(signal),
        BALLOT_SUBMIT_TIMEOUT_MS,
      ));
    } catch (thrown: unknown) {
      error = thrown;
    }
    if (!error) return 'ok';
    const message = (error as { message?: string }).message ?? '';
    if (message.includes('name already submitted')) return 'name_taken';
    if (message.includes('named voting off')) return 'named_off';
    if (message.includes('already submitted')) return attempt > 1 ? 'ok' : 'duplicate';
    if (message.includes('ballot not open')) return 'closed';
    if (attempt >= BALLOT_SUBMIT_MAX_ATTEMPTS || !isTransientBallotError(error, status)) throw error;
    console.warn(`투표 제출 재시도 ${attempt}/${BALLOT_SUBMIT_MAX_ATTEMPTS - 1}`, error);
    await (retry.sleep ?? sleep)(ballotRetryDelayMs(retry.random));
  }
}
