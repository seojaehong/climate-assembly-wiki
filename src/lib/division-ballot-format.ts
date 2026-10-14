/**
 * 10/17 분과 의결 투표의 「모양」 — 오퍼레이터 화면(division-vote-logic)과 투표자 화면(/b, ballot-logic)이
 * 같은 규칙을 쓰도록 한 곳에 둔다. 서버는 이 모양을 모른다(일반 다의제 투표와 같은 ballot_create_v3).
 *
 * - 투표 제목: `${N}분과 의결` 또는 `${N}분과 의결 ${라벨}` (ballot.title ≤ 200자)
 * - 문항 문장: `${안 번호} ${안 제목}` (ballot_item.statement ≤ 300자, 안 번호 포함)
 */

/** 문항 문장 = 「안 번호 + 안 제목」. */
export function motionStatementOf(id: string, title: string): string {
  return `${id} ${title.trim()}`;
}

/** 문항 문장을 안 번호와 안 제목으로 가른다. 모양이 다르면 null. */
export function parseMotionStatement(statement: string): { id: string; title: string } | null {
  const match = /^(\S+-안\d+)\s+([\s\S]+)$/.exec(statement.trim());
  return match ? { id: match[1], title: match[2].trim() } : null;
}

/** 분과 의결 투표의 제목. */
export function divisionBallotTitle(subgroup: string, label?: string): string {
  return label ? `${subgroup} 의결 ${label}` : `${subgroup} 의결`;
}

/**
 * 이 투표가 분과 의결 투표인가. 분과(「N분과」)가 있고 제목이 「N분과 의결」로 시작해야 한다.
 * 일반 다의제 투표(분과 의견조사)는 false — 그 화면 문구는 그대로 둔다.
 */
export function isDivisionDecisionBallot(ballot: { title?: string | null; subgroup?: string | null }): boolean {
  const subgroup = ballot.subgroup?.trim() ?? '';
  if (!/^[1-9]분과$/.test(subgroup)) return false;
  const title = ballot.title?.trim() ?? '';
  return title === `${subgroup} 의결` || title.startsWith(`${subgroup} 의결 `);
}
