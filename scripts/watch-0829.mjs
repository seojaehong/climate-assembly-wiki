/**
 * 8.29 현장 현황판 — **읽기 전용.** 조별 입력과 출석을 한 화면에 모은다.
 *
 * 행사 중에는 쓰기 검증기를 절대 돌리면 안 된다(조가 쓴 글·실제 출석을 건드린다).
 * 그래서 이 파일은 조회만 한다 — 어떤 RPC 도 데이터를 바꾸지 않는다.
 *
 * 사용법
 *   node scripts/watch-0829.mjs                 # 한 번 보고 끝
 *   node scripts/watch-0829.mjs --watch         # 30초마다 갱신
 *   node scripts/watch-0829.mjs --watch --every=60
 *
 * env: wiki/.env 의 PUBLIC_SUPABASE_URL / PUBLIC_SUPABASE_ANON_KEY
 * 본부 비밀번호는 --operator= --password= 로 준다(파일에 적지 않는다).
 */
import { readFileSync } from 'node:fs';

const argv = process.argv.slice(2);
const arg = (name, fallback = '') => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const WATCH = argv.includes('--watch');
const EVERY = Number(arg('every', '30')) * 1000;
const OPERATOR = arg('operator', '박진환');
const PASSWORD = arg('password', '0000');

const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split(String.fromCharCode(10))
    .map((line) => line.trim())
    .filter((line) => line.startsWith('PUBLIC_SUPABASE'))
    .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]),
);

async function rpc(fn, body) {
  const res = await fetch(`${env.PUBLIC_SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      apikey: env.PUBLIC_SUPABASE_ANON_KEY,
      Authorization: `Bearer ${env.PUBLIC_SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
      'Content-Profile': 'climate_vote',
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${fn} ${res.status} ${text.slice(0, 120)}`);
  return text ? JSON.parse(text) : null;
}

const ORDER = [];
for (const block of [1, 2, 3]) for (const no of [1, 2, 3, 4, 5]) ORDER.push(`${block}분과 ${no}조`);

/** 조 코드 → 조 이름·id. mod_join 은 조회만 한다. */
async function teamIndex() {
  const map = new Map();
  for (let i = 1; i <= 15; i += 1) {
    const code = `0829${String(i).padStart(2, '0')}`;
    const got = await rpc('mod_join', { p_code: code });
    const row = Array.isArray(got) ? got[0] : got;
    if (row) map.set(row.id, { name: row.name, code });
  }
  return map;
}

async function snapshot(token, teams) {
  const rows = await rpc('hq_submissions', { p_token: token, p_session_slug: '0829-deliberation' });
  const attend = await rpc('attendance_hq_summary', {});

  const byTeam = new Map();
  for (const r of rows) {
    if (!r.item_content) continue;
    const bucket = byTeam.get(r.team_name) ?? { total: 0, topics: new Map(), last: '' };
    bucket.total += 1;
    bucket.topics.set(r.topic_prompt, (bucket.topics.get(r.topic_prompt) ?? 0) + 1);
    if (r.submission_updated_at > bucket.last) bucket.last = r.submission_updated_at;
    byTeam.set(r.team_name, bucket);
  }
  const finals = new Set(rows.filter((r) => r.submission_status === 'final').map((r) => r.team_name));

  const att = new Map();
  for (const a of attend ?? []) {
    const t = teams.get(a.team_id);
    if (t) att.set(t.name, a);
  }

  const stamp = new Date().toLocaleTimeString('ko-KR', { hour12: false });
  const lines = [`══ 8.29 현황  ${stamp} ══`, ''];
  lines.push('조             입력   꼭지별       출석(명부)  지각 조퇴 결석');
  let totalNotes = 0;
  let wrote = 0;
  for (const name of ORDER) {
    const b = byTeam.get(name);
    const a = att.get(name);
    totalNotes += b?.total ?? 0;
    if (b) wrote += 1;
    const per = b
      ? [...b.topics.entries()].map(([k, v]) => `${k.slice(0, 2)}${v}`).join(' ')
      : '';
    const lock = finals.has(name) ? '🔒' : '  ';
    const attTxt = a
      ? `${String(a.current_present).padStart(2)}/${String(a.roster_total).padStart(2)}` +
        `      ${String(a.late).padStart(2)}   ${String(a.early_leave).padStart(2)}   ${String(a.absent).padStart(2)}`
      : '  —';
    lines.push(
      `${lock}${name.padEnd(11)} ${String(b?.total ?? 0).padStart(4)}   ${per.padEnd(11)}  ${attTxt}`,
    );
  }
  const attTotal = [...att.values()].reduce((s, a) => s + a.current_present, 0);
  const rosterTotal = [...att.values()].reduce((s, a) => s + a.roster_total, 0);
  lines.push('');
  lines.push(`입력 ${totalNotes}건 · 입력한 조 ${wrote}/15 · 최종제출 ${finals.size}조`);
  lines.push(`출석 ${attTotal}/${rosterTotal}명`);
  return lines.join('\n');
}

const token = await rpc('attendance_hq_unlock_named', { p_operator: OPERATOR, p_password: PASSWORD });
if (!token) {
  console.error('본부 로그인 실패 — --operator= --password= 를 확인하세요.');
  process.exit(1);
}
const teams = await teamIndex();

console.log(await snapshot(token, teams));
if (WATCH) {
  setInterval(async () => {
    try {
      console.log('\n' + (await snapshot(token, teams)));
    } catch (error) {
      console.log(`\n[${new Date().toLocaleTimeString('ko-KR', { hour12: false })}] 조회 실패: ${String(error).slice(0, 100)}`);
    }
  }, EVERY);
}
