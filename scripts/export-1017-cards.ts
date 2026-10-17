/** 당일 세션 준비판(서버) → 카드별 최종 세부권고 JSON(재투표용 정리). 사용: npx tsx scripts/export-1017-cards.ts <states.json> <out.json> */
import { readFileSync, writeFileSync } from 'node:fs';
import { migratePrep } from '../src/islands/mod/division-vote-logic';
import { cardRecList, recLine, remainingRecs } from '../src/islands/mod/division-rec-edits';

const rows = JSON.parse(readFileSync(process.argv[2], 'utf8')) as { subgroup: string; state: unknown }[];
const out: unknown[] = [];
for (const r of rows) {
  const s = migratePrep(r.state);
  if (!s) continue;
  const motions = [...s.motions].sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
  for (const m of motions) {
    if (!m.cardNos.length) continue;
    const card = s.source.topics.flatMap((t) => t.cards).find((c) => c.no === m.cardNos[0]);
    const list = m.cardNos.flatMap((cn) => cardRecList(s.source, s.recEdits ?? [], cn));
    out.push({
      division: r.subgroup,
      motion: m.id,
      card: m.cardNos.join(' + '),
      title: m.title || card?.title || '',
      origTitle: card?.title ?? '',
      recs: list.map((d) => ({ no: d.no, mark: d.mark, ref: d.ref ?? null, text: d.text, line: recLine(d) })),
      remaining: remainingRecs(list).length,
      rounds: m.rounds.map((x) => ({ round: x.round, yes: (x.onlineYes ?? 0) + (x.handYes ?? 0), no: (x.onlineNo ?? 0) + (x.handNo ?? 0), present: x.present, verdict: x.verdict })),
    });
  }
}
writeFileSync(process.argv[3], JSON.stringify(out, null, 1));
console.log('cards', out.length);
