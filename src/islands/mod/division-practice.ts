/**
 * 10/17 연습 투표 — 운영팀이 세션에 따로 만든 「N분과 연습 투표」(준비판 안과 무관한 단독 투표)를 분과 화면에서 띄운다.
 * 순수 로직(vitest). 준비판을 받지도 돌려주지도 않는다 — 차수·안·세리머니·결과 CSV 에 들어갈 길이 없다.
 */
import type { BallotListRow } from '../../lib/deliberation';

export const PRACTICE_SUFFIX = '연습 투표';

/** 제목이 「연습 투표」로 끝나고 보관되지 않은 투표. */
export function isPracticeBallot(b: Pick<BallotListRow, 'title' | 'status'>): boolean {
  return b.title.trim().endsWith(PRACTICE_SUFFIX) && b.status !== 'archived';
}

/** 분과 화면은 자기 분과 것만, 운영팀(division null)은 전부. 제목순. */
export function practiceBallots<T extends Pick<BallotListRow, 'title' | 'status' | 'subgroup'>>(rows: readonly T[], division: number | null): T[] {
  const sub = division === null ? null : `${division}분과`;
  return rows
    .filter(isPracticeBallot)
    .filter((b) => sub === null || (b.subgroup ?? '').trim() === sub)
    .sort((a, b) => a.title.localeCompare(b.title, 'ko'));
}

/** 2점 척도 집계 → 찬성(2)·반대(1). */
export function practiceTally(dist: Record<string, number> | undefined): { yes: number; no: number } {
  return { yes: dist?.['2'] ?? 0, no: dist?.['1'] ?? 0 };
}
