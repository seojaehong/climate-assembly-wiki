/** 1~3분과 서버 준비판(읽기만)을 JSON 으로 저장한다. npx tsx scripts/dump-1017-prep.ts --code <운영팀형> --out <폴더> */
import { readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const URL = 'https://pleyuknjnprsckssxvrh.supabase.co';
const ANON = readFileSync(new globalThis.URL('../src/lib/supabase.ts', import.meta.url), 'utf8').match(/FALLBACK_ANON = '([^']+)'/)?.[1];
const arg = (k: string) => process.argv[process.argv.indexOf(k) + 1];
async function rpc(fn: string, body: Record<string, unknown>) {
  const res = await fetch(`${URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: ANON!, Authorization: `Bearer ${ANON}`, 'Content-Type': 'application/json', 'Content-Profile': 'climate_vote', 'Accept-Profile': 'climate_vote' },
    body: JSON.stringify(body),
  });
  const t = await res.text();
  if (!res.ok) throw new Error(`${fn} ${res.status} ${t.slice(0, 300)}`);
  return JSON.parse(t);
}
const auth = await rpc('mod_exchange_join_code', { p_join_code: arg('--code'), p_device_id: randomUUID(), p_device_label: 'dump' });
const got = await rpc('division_prep_get_v1', { p_token: auth.accessToken });
for (const r of got.rows ?? []) {
  const s = r.state;
  const slim = {
    subgroup: r.subgroup, version: r.version,
    motions: s.motions.map((m: any) => ({ id: m.id, cardNos: m.cardNos, title: m.title, rounds: (m.rounds ?? []).map((x: any) => ({ round: x.round, title: x.title, verdict: x.verdict, yes: x.onlineYes, no: x.onlineNo, voided: !!x.voidedAt })) })),
    cards: s.cards, recEdits: s.recEdits ?? [],
    cardTitles: Object.fromEntries((s.source?.topics ?? []).flatMap((t: any) => t.cards.map((c: any) => [c.no, c.title]))),
  };
  writeFileSync(`${arg('--out')}/prep_${r.subgroup}.json`, JSON.stringify(slim, null, 1));
  console.log(r.subgroup, '판', r.version, '안', slim.motions.length, '처리', slim.recEdits.length);
}
