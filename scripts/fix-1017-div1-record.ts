/**
 * 10/17 1분과 기록 정리(한 번 쓰고 마는 운영 스크립트).
 *   npx tsx scripts/fix-1017-div1-record.ts --code <운영팀형> [--apply]
 * - 1-3-안1 1차: 참석 50 · 찬성 37 · 반대 13 → 2/3(34) 넘음. 「무효」로 남은 판정을 「가결」로 고친다(값이 그대로일 때만).
 * - 1-15-안1: 시트 B6 취지대로 안 제목을 바꾼다. 투표 때 제목(rounds[].title)은 그대로 둔다.
 */
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { migratePrep, decideVote } from '../src/islands/mod/division-vote-logic';

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
const NEW_1_15 = '배출권거래제의 감축 유인과 시장기능을 강화한다';

const auth = await rpc('mod_exchange_join_code', { p_join_code: arg('--code'), p_device_id: randomUUID(), p_device_label: 'div1-record' });
const got = await rpc('division_prep_get_v1', { p_token: auth.accessToken });
const row = (got.rows ?? []).find((r: { subgroup: string }) => r.subgroup === '1분과');
const cur = migratePrep(row?.state);
if (!cur) throw new Error('1분과 판을 읽지 못했습니다');
console.log(`1분과 판 ${row.version}`);

const motions = cur.motions.map((m) => {
  if (m.id === '1-3-안1') {
    const rounds = m.rounds.map((r) => {
      if (r.round !== 1 || r.verdict !== 'invalid' || r.voidedAt) return r;
      const yes = (r.onlineYes ?? 0) + r.handYes;
      const no = (r.onlineNo ?? 0) + r.handNo;
      const v = decideVote(r.enrolled ?? 0, r.present ?? 0, yes, no);
      console.log(`  1-3-안1 1차: 재적 ${r.enrolled} 참석 ${r.present} 찬성 ${yes} 반대 ${no} → 다시 판정 ${JSON.stringify(v)}`);
      if (v.kind !== 'decided') return r;
      return { ...r, verdict: (v.passed ? 'passed' : 'failed') as 'passed' | 'failed' };
    });
    return { ...m, rounds };
  }
  if (m.id === '1-15-안1') {
    console.log(`  1-15-안1 제목: ${m.title} → ${NEW_1_15}`);
    return { ...m, title: NEW_1_15 };
  }
  return m;
});
if (!process.argv.includes('--apply')) process.exit(0);
const saved = await rpc('division_prep_save_v1', { p_token: auth.accessToken, p_subgroup: '1분과', p_expected_version: row.version, p_state: { ...cur, motions }, p_label: '운영팀(1분과 기록 정리)' });
console.log(saved?.ok ? `  → 저장 판 ${saved.version}` : `  → 저장 실패 ${JSON.stringify(saved).slice(0, 200)}`);
