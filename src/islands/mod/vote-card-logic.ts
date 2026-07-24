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

/** 투표 결과에 따른 로컬 상태 전이. idle → voted | duplicate. */
export type CastState = 'idle' | 'voted' | 'duplicate';

export function nextCastState(result: 'ok' | 'duplicate'): CastState {
  return result === 'ok' ? 'voted' : 'duplicate';
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
  if (input.round.status === 'pending') return 'pending';
  if (input.castState === 'voted') return 'voted';
  if (input.castState === 'duplicate') return 'duplicate';
  return 'active';
}
