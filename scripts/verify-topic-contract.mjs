/**
 * 손유지 타입 ↔ s17·s19 SQL 대조 드라이런 — **파일만 읽는다. DB 에 접속조차 하지 않는다.**
 *
 *   node scripts/verify-topic-contract.mjs
 *
 * 무엇을 재는가
 *   `src/lib/deliberation.ts` 의 `Topic` 타입과 `topicSetDeadline` 호출부가
 *   `supabase/migrations/20260901_s17_topic_deadline.sql` 의 실제 시그니처와
 *   **몇 개 중 몇 개 일치하는지** 이름 단위로 센다. 「맞다」가 아니라
 *   「topic_list 컬럼 8/8 · topic_set_deadline 인자 3/3」으로 찍는다.
 *
 * 왜 이 대조가 필요한가
 *   deliberation.ts 머리말이 스스로 밝히듯 이 파일은 **손유지 타입**이다 —
 *   DB 와의 일치를 타입체커가 검증하지 못한다. 그래서 컬럼을 하나 빠뜨리거나
 *   `p_deadline_at` 을 `p_deadline` 으로 잘못 적어도 tsc 는 통과하고,
 *   틀린 것은 **행사 당일 본부가 마감을 걸려는 순간** PGRST202/42883 으로 드러난다.
 *   그 순간을 여기서 앞당겨 잡는다.
 *
 * ★ 이 스크립트가 재는 것은 「저장소 파일끼리의 정합」이지 「운영 DB 적용 여부」가 아니다.
 *   s17 은 아직 적용하지 않았다(적용 확인은 s17 주석의 anon 키 RPC 호출로 따로 한다).
 *
 * ★ `supabase/verify/20260901_s17_topic_deadline_contract.sql`(K1~K8)과 **다른 것을 잰다.**
 *   저쪽은 버려도 되는 Postgres 를 띄워 **서버가 실제로 어떻게 동작하나**(anon 실행권한·
 *   조 토큰 거부·마감 지우기)를 보고, 이쪽은 도커 없이 **클라이언트 타입이 그 서버와
 *   말이 맞나**를 본다. 서버가 멀쩡해도 이름 하나가 어긋나면 화면은 여전히 죽는다.
 *
 * 쓰기 없음 — 읽기 전용.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(resolve(HERE, '..', p), 'utf8');

const SQL_PATH = 'supabase/migrations/20260901_s17_topic_deadline.sql';
const TS_PATH = 'src/lib/deliberation.ts';

const sql = read(SQL_PATH);
const ts = read(TS_PATH);

let pass = 0;
let fail = 0;
function check(label, fn) {
  try {
    const detail = fn();
    pass += 1;
    console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`);
  } catch (error) {
    fail += 1;
    console.log(`  FAIL  ${label} — ${error.message}`);
  }
}
function must(cond, message) {
  if (!cond) throw new Error(message);
}

console.log(`\n  s17·s19 SQL ↔ deliberation.ts · hq-submissions.ts 대조 (읽기 전용)\n`);

// ── 1. topic_list 반환 컬럼 ↔ Topic 타입 필드 ────────────────────────

/** `returns table(...)` 안의 컬럼 이름을 순서대로 뽑는다. */
function sqlTopicListColumns() {
  const m = sql.match(/create\s+function\s+climate_vote\.topic_list\s*\([^)]*\)\s*returns\s+table\(([\s\S]*?)\)\s*language/i);
  must(m, `${SQL_PATH} 에서 topic_list 의 returns table 을 못 찾았다`);
  return m[1]
    .split(',')
    .map((s) => s.trim().split(/\s+/)[0])
    .filter(Boolean);
}

/** `export type Topic = { ... }` 안의 필드 이름을 뽑는다(주석·선택 표시 제거). */
function tsTopicFields() {
  const m = ts.match(/export type Topic = \{([\s\S]*?)\n\};/);
  must(m, `${TS_PATH} 에서 export type Topic 을 못 찾았다`);
  const body = m[1].replace(/\/\*\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  return [...body.matchAll(/^\s*([a-z_][a-z0-9_]*)\??\s*:/gim)].map((x) => x[1]);
}

const sqlCols = sqlTopicListColumns();
const tsFields = tsTopicFields();

check('topic_list 반환 컬럼이 Topic 타입 필드와 같다', () => {
  const missing = sqlCols.filter((c) => !tsFields.includes(c));
  const extra = tsFields.filter((f) => !sqlCols.includes(f));
  must(missing.length === 0, `타입에 없는 SQL 컬럼: ${missing.join(', ')}`);
  must(extra.length === 0, `SQL 에 없는 타입 필드: ${extra.join(', ')}`);
  return `${sqlCols.length}/${sqlCols.length} 일치 (${sqlCols.join(' · ')})`;
});

check('s17 이 더한 두 컬럼이 Topic 에 있다', () => {
  for (const col of ['deadline_at', 'server_now']) {
    must(sqlCols.includes(col), `SQL 반환에 ${col} 이 없다`);
    must(tsFields.includes(col), `Topic 에 ${col} 이 없다`);
  }
  return 'deadline_at · server_now';
});

check('★ 두 컬럼은 선택 필드다 — s17 미적용 DB 에서도 화면이 죽지 않는다', () => {
  const body = ts.match(/export type Topic = \{([\s\S]*?)\n\};/)[1];
  for (const col of ['deadline_at', 'server_now']) {
    must(
      new RegExp(`^\\s*${col}\\?\\s*:`, 'm').test(body),
      `${col} 이 필수 필드다 — 옛 RPC 응답이 타입에서 막힌다`,
    );
  }
  return '둘 다 `?:` 로 선언됨';
});

// ── 2. topic_set_deadline 인자 이름 ↔ 호출부 키 ──────────────────────

check('topic_set_deadline 인자 이름이 호출부 키와 같다', () => {
  const m = sql.match(/create or replace function climate_vote\.topic_set_deadline\(([\s\S]*?)\)\s*returns/i);
  must(m, `${SQL_PATH} 에서 topic_set_deadline 정의를 못 찾았다`);
  const sqlArgs = m[1]
    .split(',')
    .map((s) => s.trim().split(/\s+/)[0])
    .filter(Boolean);

  const call = ts.match(/\.rpc\('topic_set_deadline',\s*\{([\s\S]*?)\}\)/);
  must(call, `${TS_PATH} 에서 topic_set_deadline 호출부를 못 찾았다`);
  const callKeys = [...call[1].matchAll(/^\s*([a-z_][a-z0-9_]*)\s*:/gim)].map((x) => x[1]);

  const missing = sqlArgs.filter((a) => !callKeys.includes(a));
  const extra = callKeys.filter((k) => !sqlArgs.includes(k));
  must(missing.length === 0, `호출부에 없는 SQL 인자: ${missing.join(', ')}`);
  must(extra.length === 0, `SQL 에 없는 호출부 키: ${extra.join(', ')}`);
  return `${sqlArgs.length}/${sqlArgs.length} 일치 (${sqlArgs.join(' · ')})`;
});

check('★ 마감 설정은 본부 토큰 축이다 — 조 코드(p_code)로 부르지 않는다', () => {
  const call = ts.match(/\.rpc\('topic_set_deadline',\s*\{([\s\S]*?)\}\)/)[1];
  must(!/p_code/.test(call), '호출부가 p_code 를 넘긴다');
  must(/p_token/.test(call), '호출부가 p_token 을 안 넘긴다');
  must(/v_auth\.scope <> 'hq'/.test(sql), 'SQL 이 scope=hq 를 확인하지 않는다');
  return "p_token + SQL 의 scope <> 'hq' 거부";
});

// ── 3. grant 재부여 (topic_list 는 drop 됐다) ───────────────────────

check('★ drop 된 topic_list 에 anon·authenticated grant 가 재부여돼 있다', () => {
  const grant = sql.match(/grant execute on function([\s\S]*?);/i);
  must(grant, 'grant execute 문이 없다');
  must(/topic_list\(text\)/.test(grant[1]), 'grant 대상에 topic_list 가 없다');
  must(/topic_set_deadline\(text, uuid, timestamptz\)/.test(grant[1]), 'grant 대상에 topic_set_deadline 이 없다');
  must(/to anon, authenticated/.test(grant[1]), 'anon·authenticated 둘 다에게 주지 않는다');
  return 'topic_list · topic_set_deadline → anon, authenticated';
});

// ── 4. P1a hq_topic_deadlines_v2 ↔ HqTopicDeadlineRow · 호출부 ─────
//
// s17 이 「걸기」만 주고 「읽기」를 안 줘서 본부가 새로고침하면 자기가 무엇을 걸었는지
// 몰랐다. s19 의 되읽기를 P1a 가 세션·조직 범위 v2 로 감싼다. 여기서도 재는 것은
// **배포할 SQL 과 실제 클라이언트의 정합**이다.

const P1A_PATH = 'supabase/migrations/platform_p1a_0912_event_access.sql';
const HQ_TS_PATH = 'src/lib/hq-submissions.ts';
const p1a = read(P1A_PATH);
const hqTs = read(HQ_TS_PATH);

check('hq_topic_deadlines_v2 반환 컬럼이 HqTopicDeadlineRow 필드와 같다', () => {
  const m = p1a.match(
    /create or replace function climate_vote\.hq_topic_deadlines_v2\([\s\S]*?\)\s*returns\s+table\(([\s\S]*?)\)\s*language/i,
  );
  must(m, `${P1A_PATH} 에서 hq_topic_deadlines_v2 의 returns table 을 못 찾았다`);
  const cols = m[1]
    .split(',')
    .map((s) => s.trim().split(/\s+/)[0])
    .filter(Boolean);

  const t = hqTs.match(/export type HqTopicDeadlineRow = \{([\s\S]*?)\n\};/);
  must(t, `${HQ_TS_PATH} 에서 export type HqTopicDeadlineRow 를 못 찾았다`);
  const body = t[1].replace(/\/\*\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const fields = [...body.matchAll(/^\s*([a-z_][a-z0-9_]*)\??\s*:/gim)].map((x) => x[1]);

  const missing = cols.filter((c) => !fields.includes(c));
  const extra = fields.filter((f) => !cols.includes(f));
  must(missing.length === 0, `타입에 없는 SQL 컬럼: ${missing.join(', ')}`);
  must(extra.length === 0, `SQL 에 없는 타입 필드: ${extra.join(', ')}`);
  return `${cols.length}/${cols.length} 일치 (${cols.join(' · ')})`;
});

check('hq_topic_deadlines_v2 인자 이름이 호출부 키와 같다', () => {
  const m = p1a.match(
    /create or replace function climate_vote\.hq_topic_deadlines_v2\(([\s\S]*?)\)\s*returns/i,
  );
  must(m, `${P1A_PATH} 에서 hq_topic_deadlines_v2 정의를 못 찾았다`);
  const args = m[1]
    .split(',')
    .map((s) => s.trim().split(/\s+/)[0])
    .filter(Boolean);

  const call = hqTs.match(/\.rpc\('hq_topic_deadlines_v2',\s*\{([\s\S]*?)\}\)/);
  must(call, `${HQ_TS_PATH} 에서 hq_topic_deadlines_v2 호출부를 못 찾았다`);
  const keys = [...call[1].matchAll(/([a-z_][a-z0-9_]*)\s*:/gim)].map((x) => x[1]);

  const missing = args.filter((a) => !keys.includes(a));
  const extra = keys.filter((k) => !args.includes(k));
  must(missing.length === 0, `호출부에 없는 SQL 인자: ${missing.join(', ')}`);
  must(extra.length === 0, `SQL 에 없는 호출부 키: ${extra.join(', ')}`);
  must(!/p_code/.test(call[1]), '되읽기가 조 코드(p_code)를 넘긴다 — 본부는 토큰 축이다');
  return `${args.length}/${args.length} 일치 (${args.join(' · ')})`;
});

check('★ P1a v2 권한 — revoke from public 이 grant to anon, authenticated 보다 앞이다', () => {
  const revokeBlocks = [...p1a.matchAll(/revoke execute on function([\s\S]*?)from public, anon, authenticated;/gi)];
  const grantBlocks = [...p1a.matchAll(/grant execute on function([\s\S]*?)to anon, authenticated;/gi)];
  const revoke = revokeBlocks.find((match) => /hq_topic_deadlines_v2\(text,text\)/i.test(match[1]));
  const grant = grantBlocks.find((match) => /hq_topic_deadlines_v2\(text,text\)/i.test(match[1]));
  must(revoke, 'hq_topic_deadlines_v2 revoke execute … from public, anon, authenticated 가 없다');
  must(grant, 'hq_topic_deadlines_v2 grant execute … to anon, authenticated 가 없다');
  must(revoke.index < grant.index, 'grant 가 revoke 보다 앞이다 — 순서를 지킬 것');
  return 'revoke(public) → grant(anon, authenticated)';
});

check('★ P1a 미적용 DB 에서 래퍼가 「모름」으로 퇴화한다 (PGRST202 → null)', () => {
  const fn = hqTs.match(/export async function fetchHqTopicDeadlines\([\s\S]*?\n\}/);
  must(fn, `${HQ_TS_PATH} 에서 fetchHqTopicDeadlines 를 못 찾았다`);
  must(/PGRST202/.test(fn[0]), 'PGRST202 를 구별하지 않는다 — 화면이 죽는다');
  must(/return null/.test(fn[0]), 'null(= 모름)을 돌려주지 않는다');
  must(
    /Promise<HqTopicDeadlineRow\[\] \| null>/.test(fn[0]),
    '반환 타입이 `HqTopicDeadlineRow[] | null` 이 아니다 — 호출부가 「모름」을 구별할 수 없다',
  );
  return 'PGRST202/42883 → null · 그 밖의 오류는 던진다';
});

console.log(`\n  ${pass} PASS / ${fail} FAIL\n`);
// ★ 한 건도 못 돌면 통과가 아니라 실패다(verify-save-status-badge.mjs 와 같은 규약).
if (pass + fail === 0) {
  console.error('  FAIL: 검사를 한 건도 돌지 못했다.\n');
  process.exit(1);
}
process.exit(fail === 0 ? 0 : 1);
