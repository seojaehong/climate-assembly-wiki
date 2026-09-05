import type { Round, Team } from '../../lib/mod-console';

export type ModScreen = 'join' | 'home' | 'polling' | 'results';

export interface ModState {
  screen: ModScreen;
  team: Team | null;
  round: Round | null;
  joinError: string | null;
}

export type ModAction =
  | { type: 'JOIN_SUCCESS'; team: Team }
  | { type: 'JOIN_FAILURE'; message: string }
  | { type: 'RESTORE_TEAM'; team: Team; round: Round | null }
  | { type: 'CREATE_POLL_SUCCESS'; round: Round }
  | { type: 'CLOSE_POLL'; round: Round }
  | { type: 'REOPEN_POLL'; round: Round }
  | { type: 'NEW_POLL' }
  | { type: 'LOGOUT' };

/**
 * 조별 딥링크에서 조 코드를 읽는다 — `/mod?code=082901`.
 *
 * 조에 6자리 코드를 따로 불러주지 않고 링크 하나로 입장시키기 위한 것이다.
 * 6자리 숫자가 아니면 null을 돌려 기존 코드 입력 화면으로 떨어뜨린다(잘못된 링크가
 * 조용히 남의 조로 들어가는 일이 없도록 형식 검사는 여기서 끝낸다 — 실제 유효성은
 * mod_join RPC가 판정한다).
 *
 * `code`와 짧은 별칭 `c` 둘 다 받는다. 인쇄물에 넣을 때 주소가 짧은 편이 낫다.
 */
export function joinCodeFromSearch(search: string): string | null {
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(search);
  } catch {
    return null;
  }
  for (const key of ['code', 'c']) {
    const raw = params.get(key);
    if (raw == null) continue;
    const trimmed = raw.trim();
    if (/^\d{6}$/.test(trimmed)) return trimmed;
  }
  return null;
}

/** Client guidance window in ms. The server independently enforces the limit. */
export const REOPEN_WINDOW_MS = 60_000;

/** 마감 직후 REOPEN_WINDOW_MS 안이면 true. closedAt이 없으면(마감 이력 없음) false. */
export function canReopen(closedAt: number | null, now: number): boolean {
  if (closedAt == null) return false;
  return now - closedAt < REOPEN_WINDOW_MS;
}

export type MutableRoundStatus = 'active' | 'closed';

export type RoundStatusIntent = Readonly<{
  roundId: string;
  expectedStatus: MutableRoundStatus;
  status: MutableRoundStatus;
  expectedUpdatedAt: string | null;
  idempotencyKey: string;
}>;

/** Reuse an idempotency key until the observed round or transition changes. */
export function getOrCreateRoundStatusIntent(
  current: RoundStatusIntent | null,
  roundId: string,
  expectedStatus: MutableRoundStatus,
  status: MutableRoundStatus,
  expectedUpdatedAt: string | null,
  createIdempotencyKey: () => string = () => crypto.randomUUID(),
): RoundStatusIntent {
  if (
    current?.roundId === roundId
    && current.expectedStatus === expectedStatus
    && current.status === status
    && current.expectedUpdatedAt === expectedUpdatedAt
  ) {
    return current;
  }
  return {
    roundId,
    expectedStatus,
    status,
    expectedUpdatedAt,
    idempotencyKey: createIdempotencyKey(),
  };
}

/** Use only the server-recorded transition timestamp for reopen guidance. */
export function roundUpdatedAtMs(round: Pick<Round, 'updated_at'>): number | null {
  if (!round.updated_at) return null;
  const parsed = Date.parse(round.updated_at);
  return Number.isFinite(parsed) ? parsed : null;
}

export type RoundStatusRecoveryDecision = Readonly<{
  reachedTarget: boolean;
  unchangedExpectedSnapshot: boolean;
  clearIntent: boolean;
}>;

/** Decide whether an ambiguous retry key is still safe after a scoped server reload. */
export function roundStatusRecoveryDecision(
  latest: Pick<Round, 'status' | 'updated_at'>,
  intent: RoundStatusIntent,
  definitiveFailure: boolean,
): RoundStatusRecoveryDecision {
  const reachedTarget = latest.status === intent.status;
  const unchangedExpectedSnapshot = latest.status === intent.expectedStatus
    && intent.expectedUpdatedAt !== null
    && latest.updated_at === intent.expectedUpdatedAt;
  return {
    reachedTarget,
    unchangedExpectedSnapshot,
    clearIntent: definitiveFailure || reachedTarget || !unchangedExpectedSnapshot,
  };
}

function roundStatusErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error !== null && 'message' in error) {
    return String(error.message);
  }
  return String(error);
}

/** Identify server-final CAS and reopen-window rejections. */
export function isDefinitiveRoundStatusFailure(error: unknown): boolean {
  const message = roundStatusErrorMessage(error);
  return /(?:round status|expected status).*(?:conflict|mismatch|changed|current)|(?:stale|conflict).*(?:round|status)|reopen.*(?:window|expired|elapsed|too late)|(?:window|deadline).*(?:reopen|elapsed|expired)|different request|round status response/i
    .test(message);
}

/**
 * 참여 모수. attendance_round_eligible_count RPC는 출석 체크인을 안 한 조에서 null이 아니라
 * 0을 돌려주므로 `??`로는 걸러지지 않는다 — 0도 "모름"으로 보고 조 정원으로 대체한다.
 */
export function participationBase(eligibleCount: number | null, capacity: number): number {
  return eligibleCount && eligibleCount > 0 ? eligibleCount : capacity;
}

export type ProxyVoteRoundType = Round['type'] | 'TEXT';

export type VoteRefreshPriority = 'background' | 'manual' | 'final';

export type VoteRefreshMeta = {
  failed: boolean;
  finalVerificationStatus: 'not-required' | 'pending' | 'verified' | 'failed';
  lastSuccessAt: number | null;
  busy: boolean;
};

export const EMPTY_VOTE_REFRESH_META: VoteRefreshMeta = {
  failed: false,
  finalVerificationStatus: 'not-required',
  lastSuccessAt: null,
  busy: false,
};

/** Start a tally read. A final read is the only transition into pending verification. */
export function beginVoteRefresh(
  current: VoteRefreshMeta,
  priority: VoteRefreshPriority,
): VoteRefreshMeta {
  const finalVerification = priority === 'final';
  return {
    ...current,
    failed: finalVerification ? false : current.failed,
    finalVerificationStatus: finalVerification ? 'pending' : current.finalVerificationStatus,
    busy: true,
  };
}

/** Apply a successful tally read without letting a background read certify a final result. */
export function completeVoteRefresh(
  current: VoteRefreshMeta,
  priority: VoteRefreshPriority,
  completedAt: number,
): VoteRefreshMeta {
  return {
    failed: false,
    finalVerificationStatus: priority === 'final' ? 'verified' : current.finalVerificationStatus,
    lastSuccessAt: completedAt,
    busy: false,
  };
}

/** Preserve the last normal timestamp while visibly failing a final or live refresh. */
export function failVoteRefresh(
  current: VoteRefreshMeta,
  priority: VoteRefreshPriority,
): VoteRefreshMeta {
  return {
    ...current,
    failed: true,
    finalVerificationStatus: priority === 'final' ? 'failed' : current.finalVerificationStatus,
    busy: false,
  };
}

export function canUseFinalVoteSnapshot(meta: VoteRefreshMeta): boolean {
  return meta.finalVerificationStatus === 'verified';
}

/** Toggle one CHECKBOX option without mutating the prior React state value. */
export function toggleProxyVoteChoice(selected: readonly string[], option: string): string[] {
  return selected.includes(option)
    ? selected.filter((candidate) => candidate !== option)
    : [...selected, option];
}

/** CHECKBOX is the only proxy-vote round whose JSON choice must be an array. */
export function proxyVotePayload(
  type: ProxyVoteRoundType,
  singleChoice: string,
  checkboxChoices: readonly string[],
): string | string[] {
  return type === 'CHECKBOX' ? [...checkboxChoices] : singleChoice;
}

/**
 * 마감 확인 문구. 미투표 인원을 숫자로 못박아 모더레이터가 실수로 마감하는 것을 막는다.
 * 대리 입력으로 득표가 명단 인원을 넘을 수 있으므로 남은 인원은 0으로 클램프한다.
 */
export function closeConfirmMessage(voted: number, base: number): string {
  if (base <= 0) return `지금까지 ${voted}표가 들어왔습니다.`;
  const remaining = Math.max(0, base - voted);
  const tail = remaining > 0 ? `아직 ${remaining}명이 남았습니다.` : '모두 투표했습니다.';
  return `${base}명 중 ${voted}명이 투표했습니다. ${tail}`;
}

export const initialModState: ModState = {
  screen: 'join',
  team: null,
  round: null,
  joinError: null,
};

export function modReducer(state: ModState, action: ModAction): ModState {
  switch (action.type) {
    case 'JOIN_SUCCESS':
      return { ...state, screen: 'home', team: action.team, joinError: null };
    case 'JOIN_FAILURE':
      return { ...state, joinError: action.message };
    case 'RESTORE_TEAM':
      // 새로고침 후 sessionStorage 코드로 조용히 재입장 — 진행 중인 라운드가 있으면
      // polling 화면으로 복원해 QR/실시간 집계를 재구독하고, 없으면 home으로 보낸다.
      return {
        ...state,
        screen: action.round ? 'polling' : 'home',
        team: action.team,
        round: action.round,
        joinError: null,
      };
    case 'CREATE_POLL_SUCCESS':
      return { ...state, screen: 'polling', round: action.round };
    case 'CLOSE_POLL':
      return { ...state, screen: 'results', round: action.round };
    case 'REOPEN_POLL':
      // 마감을 잘못 눌렀을 때만 쓰는 되돌리기 — results 화면에서만 유효하다.
      if (state.screen !== 'results') return state;
      return { ...state, screen: 'polling', round: { ...action.round, status: 'active' } };
    case 'NEW_POLL':
      return { ...state, screen: 'home', round: null };
    case 'LOGOUT':
      return { ...initialModState };
    default:
      return state;
  }
}
