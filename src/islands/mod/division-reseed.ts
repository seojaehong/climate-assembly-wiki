/**
 * 기본 자료 다시 깔기(load-1017-baseline.ts)의 판단 — 순수 로직(vitest).
 * 사람이 화면에서 넣은 흔적을 빠짐없이 세고(덮기 전에 미리보기에 다 나오게), 통째로 바꿀 때 살릴 수 있는 기록은 옮긴다.
 */
import { initPrepState, type PrepState } from './division-vote-logic';

/**
 * 사람이 넣은 흔적. presetTitles = 로더가 미리 넣는 안건(열쇠 → 제목) — 그 제목 그대로면 사람 입력이 아니다.
 * 투표 기록은 「… 투표 기록」·「투표」로 끝난다(이것이 있으면 --force 로도 바꾸지 않는다).
 */
export function humanInput(s: PrepState, presetTitles: ReadonlyMap<string, string>): string[] {
  const out: string[] = [];
  for (const m of s.motions) {
    if (m.rounds.length) out.push(`${m.id} 투표 기록`);
    if (m.title.trim() && !(m.key && presetTitles.get(m.key) === m.title)) out.push(`${m.id} 제목`);
    if (m.text.trim()) out.push(`${m.id} 수정 문안`);
    if (m.otherOpinion.trim() || m.minorityOpinion.trim()) out.push(`${m.id} 의견 칸`);
    if (Object.keys(m.grid).length || Object.keys(m.override).length) out.push(`${m.id} 권고 수준`);
  }
  // 카드 처리 상태(유지·제외·병합 …)를 처음 값에서 바꿨다.
  const base = initPrepState(s.source).cards;
  const changed = Object.entries(s.cards).filter(([no, c]) => c.status !== base[no]?.status || !!c.target).map(([no]) => no);
  if (changed.length) out.push(`카드 상태 ${changed.length}장(${changed.slice(0, 4).join(',')}${changed.length > 4 ? ' …' : ''})`);
  for (const [id, b] of Object.entries(s.bundles ?? {})) {
    if (b.decision || b.movedRecs.trim() || b.minority.trim() || b.teams.length) out.push(`묶음 ${id} 기록`);
  }
  const reviewers = Object.values(s.reviewers ?? {}).filter((v) => v && v.trim());
  if (reviewers.length) out.push(`검토위원 ${reviewers.length}명`);
  if (s.attendance.enrolled !== null || s.attendance.present !== null) out.push('참석 인원');
  if (Object.keys(s.ballots).length) out.push('투표');
  return out;
}

/**
 * 통째로 바꿀 때 살리는 기록 — 새 판에도 있는 묶음 번호의 헤쳐모여 기록, 검토위원(조 1~5는 늘 있다).
 * 새 판에 없는 묶음 기록은 버리고 그 번호를 돌려준다(미리보기에 찍는다).
 */
export function carryOverRecords(cur: PrepState, next: PrepState): { state: PrepState; carried: string[]; dropped: string[] } {
  const ids = new Set(next.motions.map((m) => m.group?.id).filter((x): x is string => !!x));
  const carried: string[] = [];
  const dropped: string[] = [];
  const bundles = { ...(next.bundles ?? {}) };
  for (const [id, rec] of Object.entries(cur.bundles ?? {})) {
    if (ids.has(id)) {
      bundles[id] = { ...rec, teams: [...rec.teams] };
      carried.push(`묶음 ${id}`);
    } else dropped.push(`묶음 ${id}`);
  }
  const reviewers = { ...(cur.reviewers ?? {}) };
  const hasReviewers = Object.values(reviewers).some((v) => v && v.trim());
  if (hasReviewers) carried.push('검토위원');
  return {
    state: {
      ...next,
      ...(Object.keys(bundles).length ? { bundles } : {}),
      ...(hasReviewers ? { reviewers: { ...(next.reviewers ?? {}), ...reviewers } } : {}),
    },
    carried,
    dropped,
  };
}
