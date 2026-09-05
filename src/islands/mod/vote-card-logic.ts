import type { Round } from '../../lib/mod-console';

export const TEXT_VOTE_MAX_LENGTH = 2_000;

/**
 * TEXT 응답은 서버 계약과 동일하게 앞뒤 공백을 제거한 뒤 검증한다.
 * 공백뿐인 값과 한도를 넘는 값은 제출 가능한 choice가 아니다.
 */
export function normalizeTextVoteChoice(value: string): string | null {
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > TEXT_VOTE_MAX_LENGTH) return null;
  return normalized;
}

/** URL 쿼리에서 round id(`?r=...` 또는 Canvas의 `?round=...`)를 파싱한다. */
export function parseVoteUrl(search: string): { roundId: string } | null {
  const params = new URLSearchParams(search);
  const raw = params.get('r') ?? params.get('round');
  if (!raw) return null;
  const roundId = raw.trim();
  if (!roundId) return null;
  return { roundId };
}

/**
 * 투표 결과에 따른 로컬 상태 전이. idle → voted | duplicate | closed.
 * 'closed'는 제출 시점에 라운드가 이미 마감된 경우(DB 가드가 차단) — 에러가 아니라
 * resolveVoteScreen이 결과 화면으로 보내도록 하는 신호다.
 */
export type CastState = 'idle' | 'voted' | 'duplicate' | 'closed';

export function nextCastState(result: 'ok' | 'duplicate' | 'closed'): CastState {
  if (result === 'ok') return 'voted';
  if (result === 'closed') return 'closed';
  return 'duplicate';
}

/** Manual refresh feedback while the participant waits for result publication. */
export function refreshStatusMessage(round: Round): string | null {
  if (round.status === 'closed') return null;
  if (round.status === 'pending') return '아직 투표 시작 전입니다. 이 화면을 유지해 주세요.';
  return '아직 투표가 진행 중입니다. 마감 후 다시 확인해 주세요.';
}

/** 화면에 표시할 상태. round는 로딩 중이면 undefined, 존재하지 않으면 null. */
export type VoteScreen = 'invalid' | 'loading' | 'pending' | 'active' | 'voted' | 'duplicate' | 'closed';

const ROUND_STATUS_RANK: Record<Round['status'], number> = {
  pending: 0,
  active: 1,
  closed: 2,
};

export type RoundSnapshotResolution = {
  applied: boolean;
  round: Round | null | undefined;
};

/**
 * Apply only the newest request and never move one round backwards through its
 * pending -> active -> closed lifecycle. This protects the public ballot from
 * overlapping interval/manual refresh responses arriving out of order.
 */
export function resolveLatestRoundSnapshot(
  current: Round | null | undefined,
  incoming: Round,
  requestSequence: number,
  latestSequence: number,
): RoundSnapshotResolution {
  if (requestSequence !== latestSequence) return { applied: false, round: current };
  if (!current || current.id !== incoming.id) return { applied: true, round: incoming };
  if (ROUND_STATUS_RANK[incoming.status] < ROUND_STATUS_RANK[current.status]) {
    return { applied: true, round: current };
  }
  return { applied: true, round: incoming };
}

export function resolveVoteScreen(input: {
  hasRoundId: boolean;
  round: Round | null | undefined;
  castState: CastState;
}): VoteScreen {
  if (!input.hasRoundId) return 'invalid';
  if (input.round === undefined) return 'loading';
  if (input.round === null) return 'invalid';
  if (input.round.status === 'closed') return 'closed';
  if (input.castState === 'closed') return 'closed';
  if (input.round.status === 'pending') return 'pending';
  if (input.castState === 'voted') return 'voted';
  if (input.castState === 'duplicate') return 'duplicate';
  return 'active';
}
