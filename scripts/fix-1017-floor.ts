/**
 * 10/17 현장 거수 결과를 1분과 서버 준비판에 넣는다(한 번 쓰고 마는 운영 스크립트).
 *   npx tsx scripts/fix-1017-floor.ts --code <운영팀형 코드> [--apply]
 * - 1-13-1-1 = 흡수 → 1-9-2 확정: 1-13-1 카드의 1-13-1-1 에서 나온 다른 처리(from=1-13-1-1, 또는 no=1-13-1-1 의 흡수 아닌 처리)를 뺀다.
 * - 통합 의결 3건: 앞 카드의 안에 두 카드를 묶고 제목을 바꾸며, 뒤 카드의 안은 지운다(투표 기록이 있으면 멈춤).
 * 미리보기가 기본. 저장은 division_prep_save_v1(판 번호 대조).
 */
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { migratePrep, type PrepState } from '../src/islands/mod/division-vote-logic';

const URL = 'https://pleyuknjnprsckssxvrh.supabase.co';
const ANON = readFileSync(new globalThis.URL('../src/lib/supabase.ts', import.meta.url), 'utf8').match(/FALLBACK_ANON = '([^']+)'/)?.[1];
const arg = (k: string) => {
  const i = process.argv.indexOf(k);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const code = arg('--code');
const apply = process.argv.includes('--apply');
if (!code) throw new Error('--code 가 필요합니다');

async function rpc(fn: string, body: Record<string, unknown>) {
  const res = await fetch(`${URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: ANON!, Authorization: `Bearer ${ANON}`, 'Content-Type': 'application/json', 'Content-Profile': 'climate_vote', 'Accept-Profile': 'climate_vote' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${fn} ${res.status} ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

const MERGES = [
  { keep: '1-5-3', drop: '1-5-1', cards: ['1-5-1', '1-5-3'], title: '제품별 기준 세분화를 통한 인증의 강화 및 탄소배출량 공개 의무화' },
  { keep: '1-7-1', drop: '1-7-2', cards: ['1-7-1', '1-7-2'], title: '탄소중립 정책의 일관성과 지속성을 확보하고, 이행 책임과 평가공개체계를 강화한다.' },
  { keep: '1-8-1', drop: '1-8-2', cards: ['1-8-1', '1-8-2'], title: '(1-8-1·1-8-2 통합 — 권고제목은 검토위원 위임)' },
];

const auth = await rpc('mod_exchange_join_code', { p_join_code: code, p_device_id: randomUUID(), p_device_label: 'floor-fix' });
if (!auth?.accessToken || auth.team?.subgroup) throw new Error('운영팀형 코드로 들어가지 못했습니다');
const got = await rpc('division_prep_get_v1', { p_token: auth.accessToken });
const row = (got.rows ?? []).find((r: { subgroup: string }) => r.subgroup === '1분과');
const cur: PrepState | null = migratePrep(row?.state);
if (!cur) throw new Error('1분과 서버 판을 읽지 못했습니다');
console.log(`세션 ${auth.sessionSlug} · 1분과 판 ${row.version}${apply ? '' : ' · 미리보기'}`);

let state: PrepState = cur;
// 1) 1-13-1-1
const before = state.recEdits ?? [];
const dropEdits = before.filter((e) => e.card === '1-13-1' && (e.from === '1-13-1-1' || (e.no === '1-13-1-1' && e.action !== '흡수')));
for (const e of before.filter((e) => e.card === '1-13-1' || e.no === '1-13-1-1')) console.log(`  1-13-1 처리: no=${e.no} from=${e.from ?? ''} ${e.action} → ${e.target} | ${e.text.slice(0, 40)}${dropEdits.includes(e) ? '   ← 뺌' : ''}`);
state = { ...state, recEdits: before.filter((e) => !dropEdits.includes(e)) };

// 2) 통합
let bad = false;
for (const m of MERGES) {
  const keep = state.motions.find((x) => x.cardNos.length === 1 && x.cardNos[0] === m.keep) ?? state.motions.find((x) => x.cardNos.includes(m.keep));
  const drop = state.motions.find((x) => x !== keep && x.cardNos.includes(m.drop));
  console.log(`  통합 ${m.cards.join('+')}: 남길 안 ${keep?.id} [${keep?.cardNos}] 「${keep?.title}」 차수 ${keep?.rounds.length} · 지울 안 ${drop?.id ?? '(없음)'} [${drop?.cardNos ?? ''}] 차수 ${drop?.rounds.length ?? '-'}`);
  if (!keep || keep.rounds.length || drop?.rounds.length) {
    console.log('   → 안이 없거나 투표 기록이 있어 이 통합은 하지 않습니다.');
    bad = true;
    continue;
  }
  state = {
    ...state,
    motions: state.motions
      .filter((x) => x !== drop)
      .map((x) => (x === keep ? { ...x, cardNos: [...m.cards], title: m.title } : x)),
    cards: { ...state.cards, [m.drop]: { status: 'merged', target: keep.id } as any },
  };
}
console.log(`  안 수 ${cur.motions.length} → ${state.motions.length} · 1-13-1 처리 뺌 ${dropEdits.length}`);
if (!apply) process.exit(bad ? 1 : 0);
const saved = await rpc('division_prep_save_v1', { p_token: auth.accessToken, p_subgroup: '1분과', p_expected_version: row.version, p_state: state, p_label: '운영팀(현장 거수 통합)' });
console.log(saved?.ok ? `저장 판 ${saved.version}` : `저장 실패 ${JSON.stringify(saved).slice(0, 200)}`);
