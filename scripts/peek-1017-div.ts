/** 분과 서버 판에서 투표 기록(차수·ballots)만 찍는다. npx tsx scripts/peek-1017-div.ts --code <운영팀형> --div 3 */
import { readFileSync } from 'node:fs';
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
const auth = await rpc('mod_exchange_join_code', { p_join_code: arg('--code'), p_device_id: randomUUID(), p_device_label: 'peek' });
const got = await rpc('division_prep_get_v1', { p_token: auth.accessToken });
const row = (got.rows ?? []).find((r: { subgroup: string }) => r.subgroup === `${arg('--div')}분과`);
const s = row.state;
console.log(`판 ${row.version} · 안 ${s.motions.length}`);
for (const m of s.motions) if (m.rounds?.length) console.log(JSON.stringify({ id: m.id, title: m.title.slice(0, 30), rounds: m.rounds }));
console.log('ballots:', JSON.stringify(s.ballots ?? {}).slice(0, 1500));
for (const e of s.recEdits ?? []) if (e.action === '삭제' || String(e.target).includes('가')) console.log('recEdit', e.card, e.no, e.action, e.target, String(e.text).slice(0, 30));
console.log('recEdits 수', (s.recEdits ?? []).length);
const keys = Object.keys(s).filter((k) => !['source', 'motions', 'cards', 'recEdits'].includes(k));
for (const k of keys) console.log(k, JSON.stringify(s[k]).slice(0, 300));
