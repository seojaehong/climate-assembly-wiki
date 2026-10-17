/**
 * 10/17 오후 결정 — 투표 단위 = 카드(3자리) 하나씩. 카드마다 안 하나, 제목은 카드 원 제목(비었으면 「(제목 미정)」)으로 미리 채워
 * 고치지 않아도 바로 투표를 열 수 있게 한다. 순서 = 묶음 A..G → 그 안에서 카드 번호(원천 순서). 묶음은 묶기·줄 세우기용으로만 남는다.
 * 순수 로직(vitest). 로더: scripts/load-1017-baseline.ts --per-card.
 */
import {
  createMotion,
  initPrepState,
  sortMotions,
  type MotionGroup,
  type PrepState,
  type RecsDivision,
  type SimilarGroup,
} from './division-vote-logic';

export const UNTITLED_CARD_TITLE = '(제목 미정)';

export function cardMotionKey(cardNo: string): string {
  return `card:${cardNo}`;
}

/** 카드별 안으로 된 새 판. 묶음에 없는 카드는 맨 뒤(원천 순서). 만들지 못한 카드는 failed 로. */
export function cardMotionsState(
  source: RecsDivision,
  groups: readonly SimilarGroup[],
): { state: PrepState; created: number; failed: { card: string; reason: string }[] } {
  let s = initPrepState(source);
  const allCards = source.topics.flatMap((t) => t.cards);
  const pos = new Map(allCards.map((c, i) => [c.no, i]));
  const mine = groups
    .filter((g) => g.division === source.division)
    .sort((a, b) => (a.letter ?? a.id).localeCompare(b.letter ?? b.id) || a.id.localeCompare(b.id));
  const groupOf = new Map<string, SimilarGroup>();
  const ordered: string[] = [];
  for (const g of mine) {
    for (const c of [...g.cards].sort((a, b) => (pos.get(a) ?? 1e9) - (pos.get(b) ?? 1e9))) {
      if (groupOf.has(c) || !pos.has(c)) continue;
      groupOf.set(c, g);
      ordered.push(c);
    }
  }
  for (const c of allCards) if (!groupOf.has(c.no)) ordered.push(c.no);

  const failed: { card: string; reason: string }[] = [];
  let created = 0;
  ordered.forEach((cardNo, i) => {
    const card = allCards.find((c) => c.no === cardNo)!;
    const title = card.title.trim() || UNTITLED_CARD_TITLE;
    const r = createMotion(s, { cardNos: [cardNo], title, text: '', key: cardMotionKey(cardNo) });
    if (!r.ok) {
      failed.push({ card: cardNo, reason: r.error });
      return;
    }
    const g = groupOf.get(cardNo);
    const group: MotionGroup | undefined = g
      ? {
          id: g.id,
          name: g.name,
          recs: g.recs.filter((no) => no.startsWith(`${cardNo}-`)),
          teams: g.cardTeams?.[cardNo] ? [g.cardTeams[cardNo]] : [],
          ...(g.letter !== undefined ? { letter: g.letter } : {}),
          ...(g.level !== undefined ? { level: g.level } : {}),
          ...(g.common !== undefined ? { common: g.common } : {}),
          ...(g.cardTeams?.[cardNo] ? { cardTeams: { [cardNo]: g.cardTeams[cardNo] } } : {}),
        }
      : undefined;
    s = {
      ...r.state,
      motions: r.state.motions.map((m) => (m.id === r.motion.id ? { ...m, order: i + 1, ...(group ? { group } : {}) } : m)),
    };
    created += 1;
  });
  return { state: { ...s, motions: sortMotions(source, s.motions) }, created, failed };
}
