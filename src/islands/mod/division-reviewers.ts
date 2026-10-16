/**
 * 10/17 위임 안건 — 검토위원(시민대표) 조마다 한 명(1조~5조). 이름은 출석 명단(서버)에서 고르고, 없으면 직접 적는다.
 * 연락처는 두지 않는다. 순수 로직(vitest).
 */
import { TEAM_NOS, type Motion, type PrepState, type TeamNo } from './division-vote-logic';
import type { RosterRow } from '../../lib/named-vote-logic';

/** 위임 의결 안 — 로더가 만든 안(key 'baseline-delegate')이거나, 카드 없는 안건 중 제목에 「위임」. */
export function isDelegationMotion(m: Pick<Motion, 'key' | 'cardNos' | 'title'>): boolean {
  return m.key === 'baseline-delegate' || (m.cardNos.length === 0 && m.title.includes('위임'));
}

/** 「1분과 3조」. */
export function reviewerTeamLabel(division: number, team: TeamNo): string {
  return `${division}분과 ${team}조`;
}

/** 그 조 명단 이름(번호순). */
export function rosterNamesFor(roster: readonly RosterRow[], division: number, team: TeamNo): string[] {
  const label = reviewerTeamLabel(division, team);
  return roster
    .filter((r) => r.team === label)
    .sort((a, b) => (a.no ?? 1e9) - (b.no ?? 1e9) || a.name.localeCompare(b.name, 'ko'))
    .map((r) => r.name);
}

/** 한 조의 검토위원을 정한다(빈 글이면 지운다). */
export function setReviewer(state: PrepState, team: TeamNo, name: string): PrepState {
  if (!TEAM_NOS.includes(team)) return state;
  const next = { ...(state.reviewers ?? {}) };
  // 치는 중에는 공백을 그대로 둔다(「홍 길동」을 칠 때 사이 공백이 사라지지 않게). 빈 글이면 지운다.
  if (name.trim()) next[team] = name;
  else delete next[team];
  return { ...state, reviewers: next };
}

/** CSV 한 줄씩 — [분과, 조, 이름]. 비어 있는 조도 줄을 남긴다(빠진 조가 보이게). */
export function reviewerRows(state: PrepState): string[][] {
  return TEAM_NOS.map((t) => [`${state.division}분과`, `${t}조`, (state.reviewers?.[t] ?? '').trim()]);
}
