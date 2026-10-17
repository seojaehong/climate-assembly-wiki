/**
 * 투표 전인 안 하나의 제목을 바꾼다(10/17 운영, 시트 「안 쓰기」 표 제목 반영용).
 *   npx tsx scripts/set-1017-title.ts --code <운영팀형> --div 2 --motion 2-10-안2 --title "..." [--apply]
 * 투표 기록(차수)이 있으면 바꾸지 않는다. 저장은 division_prep_save_v1(판 번호 대조).
 */
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { migratePrep } from '../src/islands/mod/division-vote-logic';

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
const sub = `${arg('--div')}분과`;
const id = arg('--motion');
// 공백 있는 제목은 Windows npx.cmd 가 깨뜨리므로 파일로 받는다
const title = process.argv.includes('--title-file') ? readFileSync(arg('--title-file'), 'utf8').trim() : arg('--title');
const auth = await rpc('mod_exchange_join_code', { p_join_code: arg('--code'), p_device_id: randomUUID(), p_device_label: 'set-title' });
const got = await rpc('division_prep_get_v1', { p_token: auth.accessToken });
const row = (got.rows ?? []).find((r: { subgroup: string }) => r.subgroup === sub);
const cur = migratePrep(row?.state);
if (!cur) throw new Error(`${sub} 판을 읽지 못했습니다`);
const m = cur.motions.find((x) => x.id === id);
if (!m) throw new Error(`${id} 안이 없습니다`);
console.log(`${sub} 판 ${row.version} · ${id} [${m.cardNos}] 차수 ${m.rounds.length}\n  지금: ${m.title}\n  바꿈: ${title}`);
if (m.rounds.some((r) => !r.voidedAt)) {
  console.log('  → 투표 기록이 있어 바꾸지 않습니다.');
  process.exit(1);
}
if (!process.argv.includes('--apply')) process.exit(0);
const state = { ...cur, motions: cur.motions.map((x) => (x === m ? { ...x, title } : x)) };
const saved = await rpc('division_prep_save_v1', { p_token: auth.accessToken, p_subgroup: sub, p_expected_version: row.version, p_state: state, p_label: '운영팀(시트 안 제목)' });
console.log(saved?.ok ? `  → 저장 판 ${saved.version}` : `  → 저장 실패 ${JSON.stringify(saved).slice(0, 200)}`);
