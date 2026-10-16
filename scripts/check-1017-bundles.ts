/**
 * 10/17 A–G 묶음 파일 오프라인 점검 — 서버를 부르지 않는다. 로더(load-1017-baseline.ts)를 돌리기 전에 본다.
 *
 *   npx tsx scripts/check-1017-bundles.ts --recs <recs_1017.json> --groups <bundles_ag_1017.json> [--expert <expert_1017.json>]
 *
 * 분과마다: 묶음 수 · 만든 안 수 · 못 만든 묶음 · 카드가 한 번씩만 덮였는지(빠진 카드·두 번 든 카드) · 카드별 조가 다 있는지.
 * 출력은 번호·수만(이름 없음).
 */
import { readFileSync } from 'node:fs';
import { importSimilarGroups, initPrepState, parseImport, parseSimilarGroups } from '../src/islands/mod/division-vote-logic';
import { bundleViews } from '../src/islands/mod/division-bundle';
import { attachExpertOpinions, parseExpertFile } from '../src/islands/mod/division-expert';

const arg = (k: string) => {
  const i = process.argv.indexOf(k);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const recsPath = arg('--recs');
const groupsPath = arg('--groups');
if (!recsPath || !groupsPath) throw new Error('--recs --groups 가 필요합니다');
const recs = parseImport(readFileSync(recsPath, 'utf8'));
if (recs.kind !== 'recs') throw new Error('권고안 파일이 아닙니다');
const groups = parseSimilarGroups(readFileSync(groupsPath, 'utf8'));
if (!groups.ok) throw new Error(groups.message);
const expertPath = arg('--expert');
const expert = expertPath ? parseExpertFile(readFileSync(expertPath, 'utf8')) : null;
if (expertPath && !expert) throw new Error('전문가 의견 파일 모양이 맞지 않습니다');

let bad = false;
for (const source of recs.divisions) {
  const mine = groups.groups.filter((g) => g.division === source.division);
  const res = importSimilarGroups(initPrepState(source), mine);
  const all = source.topics.flatMap((t) => t.cards.map((c) => c.no));
  const seen = new Map<string, number>();
  for (const g of mine) for (const c of g.cards) seen.set(c, (seen.get(c) ?? 0) + 1);
  const missing = all.filter((c) => !seen.has(c));
  const twice = [...seen.entries()].filter(([, n]) => n > 1).map(([c]) => c);
  const noTeam = mine.flatMap((g) => g.cards.filter((c) => !g.cardTeams?.[c]));
  const views = bundleViews(res.state);
  console.log(
    `${source.division}분과: 카드 ${all.length} · 묶음 ${mine.length} · 안 ${res.created.length} · 이름표 ${views.map((v) => v.label.split(' ')[0]).join('')}` +
      ` · 못 만듦 ${res.failed.length} · 빠진 카드 ${missing.length}${missing.length ? `(${missing.join(',')})` : ''}` +
      ` · 두 번 든 카드 ${twice.length}${twice.length ? `(${twice.join(',')})` : ''} · 조 없는 카드 ${noTeam.length}`,
  );
  if (res.failed.length || missing.length || twice.length || noTeam.length) bad = true;
  if (expert) {
    const recCount = source.topics.reduce((n, t) => n + t.cards.reduce((m, c) => m + c.recs.length, 0), 0);
    const r = attachExpertOpinions(res.state, expert);
    const bytes = Buffer.byteLength(JSON.stringify(r.state), "utf8");
    console.log(`  전문가 의견: 세부권고 ${recCount} 중 ${r.attached} · 원천에 없는 번호 ${r.unknown.length} · 판 크기 ${Math.round(bytes / 1024)}KB(서버 한도 512KB)`);
    if (r.unknown.length || bytes > 450 * 1024) bad = true;
  }
}
process.exit(bad ? 1 : 0);
