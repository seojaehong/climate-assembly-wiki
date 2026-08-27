#!/usr/bin/env node
/**
 * 8.29 조별 입력 — 경우의 수 검증.
 *
 * verify-0829-e2e.mjs 가 「정상 경로 45칸이 도는가」를 본다면, 이쪽은 **어긋난 경우에
 * 제대로 막히는가**를 본다. 막히지 않으면 당일 남의 조 자료가 열리거나 잠긴 제출물이
 * 조용히 바뀐다.
 *
 * 보는 것
 *   E1 없는 코드          → 조를 찾지 못한다
 *   E2 없는 코드로 저장    → 예외
 *   E3 조 격리            → A조가 쓴 것이 B조에게 보이지 않는다
 *   E4 빈 제출 최종 제출   → 거부
 *   E5 상한(30행) 초과     → 거부
 *   E6 최종 제출 후 저장   → 차단(잠금)
 *   E7 최종 제출 후 재제출 → 차단
 *   E8 수정 이력          → 고쳐 쓰면 직전 문장이 아카이브에 남는다(건수는 화면에 출력)
 *
 * ⚠️ E6·E7은 한 조를 실제로 잠근다. 스크립트가 끝에 되돌리지 못하므로(재오픈은 본부
 *    토큰이 필요하다) **행사 전에만** 돌리고, 끝나고 나오는 정리 SQL을 실행할 것.
 *
 * 사용: node scripts/verify-0829-edge.mjs [--lock]
 *   --lock 없으면 E6·E7을 건너뛴다(잠그지 않는다).
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MARK = '[검증]';
const LOCK_TEAM = { code: '082915', name: '3분과 5조' };
const PEER_TEAM = { code: '082914', name: '3분과 4조' };
const DO_LOCK = new Set(process.argv.slice(2)).has('--lock');

function loadEnv() {
  const out = { ...process.env };
  try {
    for (const line of readFileSync(resolve(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
      const m = /^([A-Z_]+)=(.*)$/.exec(line.trim());
      if (m && !out[m[1]]) out[m[1]] = m[2];
    }
  } catch {
    /* .env 없으면 셸 환경만 */
  }
  return out;
}

const env = loadEnv();
const URL_BASE = env.PUBLIC_SUPABASE_URL;
const ANON = env.PUBLIC_SUPABASE_ANON_KEY;
if (!URL_BASE || !ANON) {
  console.error('환경변수 누락: PUBLIC_SUPABASE_URL / PUBLIC_SUPABASE_ANON_KEY');
  process.exit(1);
}

async function rpc(name, body) {
  const res = await fetch(`${URL_BASE}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: ANON,
      Authorization: `Bearer ${ANON}`,
      'Content-Type': 'application/json',
      'Accept-Profile': 'climate_vote',
      'Content-Profile': 'climate_vote',
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let parsed;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  if (!res.ok) {
    const err = new Error(parsed?.message ?? String(text).slice(0, 200));
    err.code = parsed?.code;
    throw err;
  }
  return parsed;
}

const results = [];
function check(label, ok, detail) {
  results.push({ label, ok, detail });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
}

/** 예외가 나야 통과인 검사. 기대 문구가 있으면 메시지에 포함되는지도 본다. */
async function expectReject(label, fn, expect) {
  try {
    await fn();
    check(label, false, '막히지 않고 통과했다');
  } catch (error) {
    const msg = error?.message ?? '';
    check(label, expect ? msg.includes(expect) : true, msg.slice(0, 90));
  }
}

const item = (n, text) => ({ ordinal: n, kind: 'core', content: `${MARK} ${text}`, rationale: null });

console.log('8.29 조별 입력 — 경우의 수 검증');
console.log(`대상: ${URL_BASE} · 잠금 검사 ${DO_LOCK ? '포함' : '건너뜀(--lock 으로 켠다)'}\n`);

const topics = await rpc('topic_list', { p_code: LOCK_TEAM.code });
if (!Array.isArray(topics) || topics.length !== 3) {
  console.error('꼭지가 3건이 아니다 — s6 SQL을 먼저 적용할 것.');
  process.exit(1);
}
const [t1, t2] = topics;

console.log('[E1~E2] 없는 코드');
const ghost = await rpc('topic_list', { p_code: '000000' });
check('없는 코드는 꼭지를 못 본다', Array.isArray(ghost) && ghost.length === 0, `${ghost?.length ?? '?'}건`);
await expectReject('없는 코드로 저장하면 거부', () =>
  rpc('submission_save', { p_code: '000000', p_topic_id: t1.id, p_items: [item(1, '침입')] }),
  'invalid join code');

console.log('\n[E3] 조 격리');
await rpc('submission_save', {
  p_code: LOCK_TEAM.code, p_topic_id: t1.id, p_items: [item(1, `${LOCK_TEAM.name}만 쓴 문장`)],
});
const peer = await rpc('submission_get', { p_code: PEER_TEAM.code, p_topic_id: t1.id });
const peerItems = peer?.items ?? [];
check(
  `${PEER_TEAM.name}에게 ${LOCK_TEAM.name}의 문장이 보이지 않는다`,
  !peerItems.some((i) => String(i.content).includes(`${LOCK_TEAM.name}만 쓴 문장`)),
  `${PEER_TEAM.name} 항목 ${peerItems.length}건`
);

console.log('\n[E4~E5] 저장 규칙');
await expectReject('빈 제출은 최종 제출할 수 없다', async () => {
  await rpc('submission_save', { p_code: PEER_TEAM.code, p_topic_id: t2.id, p_items: [] });
  await rpc('submission_finalize', { p_code: PEER_TEAM.code, p_topic_id: t2.id });
});
await expectReject('31행은 거부된다(상한 30)', () =>
  rpc('submission_save', {
    p_code: PEER_TEAM.code, p_topic_id: t2.id,
    p_items: Array.from({ length: 31 }, (_, i) => item(i + 1, `${i + 1}번째`)),
  }), 'max 30');
const thirty = await rpc('submission_save', {
  p_code: PEER_TEAM.code, p_topic_id: t2.id,
  p_items: Array.from({ length: 30 }, (_, i) => item(i + 1, `${i + 1}번째`)),
});
check('30행은 저장된다', thirty?.saved === 30, `${thirty?.saved}건`);

console.log('\n[E8] 수정 이력');
let archived = 0;
await rpc('submission_save', { p_code: PEER_TEAM.code, p_topic_id: t1.id, p_items: [item(1, '첫 판')] });
archived += 0; // 첫 저장은 지울 것이 없다
await rpc('submission_save', { p_code: PEER_TEAM.code, p_topic_id: t1.id, p_items: [item(1, '고친 판')] });
archived += 1;
await rpc('submission_save', { p_code: PEER_TEAM.code, p_topic_id: t1.id, p_items: [item(1, '다시 고친 판')] });
archived += 1;
const after = await rpc('submission_get', { p_code: PEER_TEAM.code, p_topic_id: t1.id });
check(
  '화면에는 마지막 판만 남는다',
  (after?.items ?? []).length === 1 && String(after.items[0].content).includes('다시 고친 판'),
  after?.items?.[0]?.content ?? '없음'
);
console.log(`  (아카이브에 쌓였어야 할 문장: 이 단계에서만 ${archived}건 — SQL로 대조할 것)`);

if (DO_LOCK) {
  console.log('\n[E6~E7] 최종 제출 잠금');
  await rpc('submission_save', { p_code: LOCK_TEAM.code, p_topic_id: t2.id, p_items: [item(1, '잠금 검사용')] });
  const fin = await rpc('submission_finalize', { p_code: LOCK_TEAM.code, p_topic_id: t2.id });
  check('최종 제출이 된다', fin?.status === 'final', fin?.status);
  await expectReject('잠긴 뒤에는 저장이 막힌다', () =>
    rpc('submission_save', { p_code: LOCK_TEAM.code, p_topic_id: t2.id, p_items: [item(1, '몰래 고치기')] }));
  await expectReject('잠긴 뒤에는 다시 최종 제출할 수 없다', () =>
    rpc('submission_finalize', { p_code: LOCK_TEAM.code, p_topic_id: t2.id }), 'already finalized');
  console.log('\n  ⚠️ ' + LOCK_TEAM.name + ' 의 「' + t2.prompt + '」가 잠긴 채 남았다. 아래 정리 SQL을 실행할 것.');
} else {
  console.log('\n[E6~E7] 건너뜀 — 조를 실제로 잠그므로 --lock 을 줘야 돈다.');
}

console.log('\n[정리] 검증 데이터 삭제');
let wiped = 0;
for (const team of [LOCK_TEAM, PEER_TEAM]) {
  for (const topic of topics) {
    try {
      const got = await rpc('submission_get', { p_code: team.code, p_topic_id: topic.id });
      const items = got?.items ?? [];
      if (items.length === 0) continue;
      if (!items.every((i) => String(i.content).startsWith(MARK))) continue;
      await rpc('submission_save', { p_code: team.code, p_topic_id: topic.id, p_items: [] });
      wiped += 1;
    } catch {
      /* 잠긴 칸은 여기서 못 지운다 — 정리 SQL이 처리한다 */
    }
  }
}
check('검증 데이터 삭제', true, `${wiped}칸 비움`);

const failed = results.filter((r) => !r.ok);
console.log('\n' + '─'.repeat(60));
console.log(`합계 ${results.length}건 · 통과 ${results.length - failed.length} · 실패 ${failed.length}`);
if (failed.length > 0) {
  console.log('\n실패 목록:');
  for (const f of failed) console.log(`  · ${f.label} — ${f.detail}`);
}
console.log('\n── 정리 SQL (Supabase SQL Editor) ──');
console.log(`update climate_vote.submission s set status = 'draft'
  from climate_vote.team t where t.id = s.team_id and s.status = 'final'
   and exists (select 1 from climate_vote.submission_item i
               where i.submission_id = s.id and i.content like '${MARK}%');
delete from climate_vote.submission_item where content like '${MARK}%';
delete from climate_vote.submission_item_archive where content like '${MARK}%';
select count(*) as 남은_검증데이터 from climate_vote.submission_item where content like '${MARK}%';`);
process.exit(failed.length > 0 ? 1 : 0);
