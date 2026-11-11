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

/**
 * 11/14 전체회의 의결 투표지(의제별 3장). 분과 지정(subgroup)을 비워 세션 명단 전원이 투표하고,
 * 투표지는 제목으로 알아본다: `전체회의 의결 의제${N}` 또는 `전체회의 의결 의제${N} ${의제 이름}` (N = 1~9).
 * 「N분과 의결」 모양과 겹치지 않게 접두를 따로 둔다(20_투표_최종안 W00/W01). 건수는 제목에 넣지 않는다 —
 * 넘김식 요약이 「· 권고안 N건」을 덧붙인다.
 */
const PLENARY_TITLE = /^전체회의 의결 (?:의제([1-9])(?:\s|$)|정책권고안(?:\s|$))/;

/**
 * 11/11 주최 결정 — 투표지를 의제별 3장으로 나누지 않고 1장(QR 하나)에 70건을 넣는다.
 * 제목 `전체회의 의결 정책권고안` 은 plenaryAgendaNo 가 0(의제 전체)을 낸다. 의제 구분은 문항 번호 앞자리(「2-5」 → 의제2)로 한다.
 */
export const PLENARY_ALL_TITLE = '전체회의 의결 정책권고안';
export function isPlenaryAllTitle(title: string | null | undefined): boolean {
  return plenaryAgendaNo(title) === 0;
}

export function plenaryBallotTitle(agendaNo: number, name?: string): string {
  const n = name?.trim();
  return n ? `전체회의 의결 의제${agendaNo} ${n}` : `전체회의 의결 의제${agendaNo}`;
}

/** 제목에서 의제 번호. 의제 전체를 한 장에 담은 투표지(PLENARY_ALL_TITLE)는 0. 전체회의 의결 제목이 아니면 null. */
export function plenaryAgendaNo(title: string | null | undefined): number | null {
  const m = PLENARY_TITLE.exec(title?.trim() ?? '');
  if (!m) return null;
  return m[1] ? Number(m[1]) : 0;
}

export type DecisionBallotKind = 'division' | 'plenary';

/**
 * 의결 투표의 종류. 분과 의결(10/17, subgroup 「N분과」) · 전체회의 의결(11/14, subgroup 비움) · 아니면 null.
 * 전체회의 제목인데 분과 지정이 남아 있으면 null — 명단이 그 분과로 좁혀진 잘못 만든 투표지다.
 */
export function decisionBallotKind(ballot: { title?: string | null; subgroup?: string | null }): DecisionBallotKind | null {
  if (isDivisionDecisionBallot(ballot)) return 'division';
  if (!ballot.subgroup?.trim() && plenaryAgendaNo(ballot.title) !== null) return 'plenary';
  return null;
}

/** 의결 투표인가(넘김식 · 찬반색 · 확인창 · 세부권고 접기 · 「투표」 문구). */
export function isDecisionBallot(ballot: { title?: string | null; subgroup?: string | null }): boolean {
  return decisionBallotKind(ballot) !== null;
}
