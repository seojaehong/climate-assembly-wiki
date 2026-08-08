// 20260808 S1/S2 마이그레이션 적용 검증 — anon 키만 사용, 쓰기 없음(존재·권한 판정 전용)
// 사용: node scripts/verify-s1-s2.mjs [--code <join_code>]
// 판정: PGRST202 + climate_vote.<fn> = 미적용 · 정상/도메인 에러 응답 = 적용됨
// (feedback: migration-applied-check-before-deploy — Content-Profile 헤더 필수)
import { readFileSync } from 'node:fs';

function env(name) {
  if (process.env[name]) return process.env[name];
  try {
    const line = readFileSync(new URL('../.env', import.meta.url), 'utf8')
      .split(/\r?\n/).find((l) => l.startsWith(name + '='));
    if (line) return line.slice(name.length + 1).trim();
  } catch { /* .env 없음 */ }
  return null;
}

const URL_ = env('PUBLIC_SUPABASE_URL') || 'https://pleyuknjnprsckssxvrh.supabase.co';
const ANON = env('PUBLIC_SUPABASE_ANON_KEY');
if (!ANON) { console.error('PUBLIC_SUPABASE_ANON_KEY 필요 (.env)'); process.exit(1); }

const codeArg = process.argv.indexOf('--code');
const JOIN = codeArg > -1 ? process.argv[codeArg + 1] : '000000'; // 무효 코드도 판정에는 충분

async function rpc(fn, body) {
  const res = await fetch(`${URL_}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      apikey: ANON, Authorization: `Bearer ${ANON}`,
      'Content-Type': 'application/json',
      'Accept-Profile': 'climate_vote', 'Content-Profile': 'climate_vote',
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, text };
}

function judge(name, r) {
  let verdict;
  if (r.text.includes('PGRST202')) {
    verdict = r.text.includes(`climate_vote.${name}`)
      ? '❌ 미적용 (함수 없음)'
      : '⚠️ PGRST202인데 public 스키마 조회 — 헤더 확인';
  } else if (r.status === 401 || r.text.includes('42501')) {
    verdict = '⚠️ 권한 문제 (grant 확인)';
  } else {
    verdict = '✅ 적용됨';
  }
  console.log(`${verdict}  ${name}  [HTTP ${r.status}] ${r.text.slice(0, 100)}`);
  return verdict.startsWith('✅');
}

const checks = [
  // S1
  ['topic_list', { p_code: JOIN }],
  ['submission_get', { p_code: JOIN, p_topic_id: '00000000-0000-0000-0000-000000000000' }],
  ['submission_save', { p_code: JOIN, p_topic_id: '00000000-0000-0000-0000-000000000000', p_items: [] }],
  ['submission_finalize', { p_code: JOIN, p_topic_id: '00000000-0000-0000-0000-000000000000' }],
  ['submission_reopen', { p_token: 'x'.repeat(64), p_submission_id: '00000000-0000-0000-0000-000000000000', p_reason: 'verify' }],
  ['readiness_check', { p_session: '00000000-0000-0000-0000-000000000000' }],
  // S2
  ['ballot_create', { p_code: JOIN, p_title: 'x', p_instructions: null, p_items: [] }],
  ['ballot_set_status', { p_code: JOIN, p_ballot_id: '00000000-0000-0000-0000-000000000000', p_status: 'open' }],
  ['ballot_list', { p_code: JOIN }],
  ['ballot_get', { p_token: '0'.repeat(32) }],
  ['ballot_submit', { p_token: '0'.repeat(32), p_client_id: 'verify-device-1', p_answers: {} }],
  ['ballot_results', { p_token: '0'.repeat(32), p_code: null }],
];

let ok = 0;
for (const [fn, body] of checks) {
  const r = await rpc(fn, body);
  if (judge(fn, r)) ok += 1;
}
console.log(`\n${ok}/${checks.length} 적용 확인`);
process.exit(ok === checks.length ? 0 : 2);
