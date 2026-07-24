import type { Round } from '../../lib/mod-console';

/** URL 쿼리에서 round id(`?r=...`)를 파싱한다. 없거나 공백뿐이면 null. */
export function parseVoteUrl(search: string): { roundId: string } | null {
  const params = new URLSearchParams(search);
  const raw = params.get('r');
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

/** 화면에 표시할 상태. round는 로딩 중이면 undefined, 존재하지 않으면 null. */
export type VoteScreen = 'invalid' | 'loading' | 'pending' | 'active' | 'voted' | 'duplicate' | 'closed';

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
