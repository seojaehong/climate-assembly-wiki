/** 당일 세션 준비판(서버)의 카드별 세부권고 표시를 그대로 뽑아 본다(읽기만). 사용: npx tsx scripts/dump-1017-cards.ts <state.json> */
import { readFileSync } from 'node:fs';
import { migratePrep } from '../src/islands/mod/division-vote-logic';
import { cardRecList, recLine } from '../src/islands/mod/division-rec-edits';

const rows = JSON.parse(readFileSync(process.argv[2], 'utf8')) as { subgroup: string; state: unknown }[];
for (const r of rows) {
  const s = migratePrep(r.state);
  if (!s) { console.log(r.subgroup, '읽기 실패'); continue; }
  console.log(`\n##### ${r.subgroup}`);
  for (const t of s.source.topics) for (const c of t.cards) {
    const list = cardRecList(s.source, s.recEdits ?? [], c.no);
    if (!list.some((d) => d.mark !== 'keep')) continue;
    console.log(`\n[${c.no}] ${c.title}`);
    for (const d of list) console.log(`  ${d.mark.padEnd(9)} ${recLine(d)}`);
  }
}
