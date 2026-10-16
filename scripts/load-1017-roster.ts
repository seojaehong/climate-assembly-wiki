/**
 * 10/17 실명 투표(s28) — 출석 명단을 climate_vote.ballot_roster 에 넣는다.
 *
 *   npx tsx scripts/load-1017-roster.ts --roster <roster.json> [--map "<slug>=<분과,분과>;..."] [--replace] [--apply]
 *
 * - ★ 명단 파일은 저장소에 두지 않는다(공개 repo). 경로를 인자로 받아 읽기만 한다. 로그에도 이름을 찍지 않는다(수만).
 * - 명단 행: { division: '1분과'|'2분과'|'3분과'|'기획참여단', team: '1분과 3조'|'기획참여단 분과A', no, name }
 * - 기본 매핑(--map 없을 때):
 *     1017-division-vote, zz-rehearsal-1017-2          ← 1분과·2분과·3분과
 *     planning-rules-vote, zz-rehearsal-planning-vote  ← 기획참여단
 * - --apply 가 없으면 미리보기(세션 존재 확인 + 넣을 수)만 한다.
 * - 이미 있는 (세션, 조, 이름) 은 건너뛴다(여러 번 돌려도 같다). --replace 는 대상 세션 명단을 지우고 다시 넣는다
 *   (응답의 voter_* 칸은 명단을 참조하지 않으므로 제출 기록은 그대로다).
 * - DB 접속 = Supabase Management API(SUPABASE_ACCESS_TOKEN, ~/.claude/.env 또는 환경 변수). 토큰은 출력하지 않는다.
 */
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const PROJECT_REF = 'pleyuknjnprsckssxvrh';

type RosterIn = { division: string; team: string; no: number | null; name: string };
type Row = { slug: string; subgroup: string; team: string; no: number | null; name: string };

const arg = (k: string) => {
  const i = process.argv.indexOf(k);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const rosterPath = arg('--roster');
const apply = process.argv.includes('--apply');
const replace = process.argv.includes('--replace');
if (!rosterPath) throw new Error('--roster <roster.json> 가 필요합니다');

const DEFAULT_MAP = '1017-division-vote=1분과,2분과,3분과;zz-rehearsal-1017-2=1분과,2분과,3분과;planning-rules-vote=기획참여단;zz-rehearsal-planning-vote=기획참여단';

export function parseMap(spec: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const part of spec.split(';').map((s) => s.trim()).filter(Boolean)) {
    const [slug, divs] = part.split('=');
    if (!slug || !divs) throw new Error(`--map 형식 오류: ${part}`);
    out.set(slug.trim(), divs.split(',').map((d) => d.trim()).filter(Boolean));
  }
  return out;
}

function token(): string {
  if (process.env.SUPABASE_ACCESS_TOKEN) return process.env.SUPABASE_ACCESS_TOKEN.trim().replace(/^['"]|['"]$/g, '');
  const envPath = join(homedir(), '.claude', '.env');
  if (!existsSync(envPath)) throw new Error('SUPABASE_ACCESS_TOKEN 이 없습니다');
  const line = readFileSync(envPath, 'utf8').split(/\r?\n/).find((l) => l.trim().startsWith('SUPABASE_ACCESS_TOKEN'));
  if (!line) throw new Error('SUPABASE_ACCESS_TOKEN 이 없습니다');
  return line.slice(line.indexOf('=') + 1).trim().replace(/^['"]|['"]$/g, '');
}

async function sql(query: string): Promise<Record<string, unknown>[]> {
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`query ${res.status} ${text.slice(0, 500)}`);
  return JSON.parse(text);
}

const roster = JSON.parse(readFileSync(rosterPath, 'utf8')) as RosterIn[];
if (!Array.isArray(roster)) throw new Error('명단 파일은 배열이어야 합니다');
for (const r of roster) {
  if (!r || typeof r.team !== 'string' || typeof r.name !== 'string' || typeof r.division !== 'string' || !r.name.trim() || !r.team.trim()) {
    throw new Error(`명단 행 형식 오류(번호 ${String((r as RosterIn)?.no)})`);
  }
}

const map = parseMap(arg('--map') ?? DEFAULT_MAP);
const rows: Row[] = [];
for (const [slug, divs] of map) {
  for (const r of roster.filter((x) => divs.includes(x.division))) {
    rows.push({ slug, subgroup: r.division, team: r.team.trim(), no: typeof r.no === 'number' ? r.no : null, name: r.name.trim() });
  }
}

// 미리보기 — 수만.
const bySlug = new Map<string, Map<string, number>>();
for (const r of rows) {
  const m = bySlug.get(r.slug) ?? new Map<string, number>();
  m.set(r.team, (m.get(r.team) ?? 0) + 1);
  bySlug.set(r.slug, m);
}
for (const [slug, teams] of bySlug) {
  const total = [...teams.values()].reduce((a, b) => a + b, 0);
  console.log(`${slug}: ${total}명 · ${[...teams.entries()].sort(([a], [b]) => a.localeCompare(b, 'ko', { numeric: true })).map(([t, n]) => `${t} ${n}`).join(', ')}`);
}

const slugs = [...map.keys()];
const slugList = slugs.map((s) => `'${s.replace(/'/g, "''")}'`).join(',');
const sessions = await sql(`select s.slug, s.status from climate_vote.session s where s.slug in (${slugList}) order by 1`);
const hasTable = (await sql(`select to_regclass('climate_vote.ballot_roster') is not null as ok`))[0]?.ok === true;
const current = hasTable
  ? await sql(
      `select s.slug, count(r.id)::int as n from climate_vote.session s left join climate_vote.ballot_roster r on r.session_id=s.id where s.slug in (${slugList}) group by 1`,
    )
  : [];
for (const s of sessions) {
  const n = current.find((c) => c.slug === s.slug)?.n ?? (hasTable ? 0 : '표 없음(s28 미적용)');
  console.log(`  DB ${s.slug} · ${s.status} · 지금 명단 ${n}`);
}
const missing = slugs.filter((s) => !sessions.some((x) => x.slug === s));
if (missing.length) throw new Error(`DB 에 없는 세션: ${missing.join(', ')}`);
if (apply && !hasTable) throw new Error('ballot_roster 표가 없습니다 — s28 마이그레이션을 먼저 적용하십시오');

if (!apply) {
  console.log(`미리보기입니다(${rows.length}행). 넣으려면 --apply${replace ? ' --replace' : ''}`);
  process.exit(0);
}

const payload = JSON.stringify(rows);
if (payload.includes('$roster$')) throw new Error('명단에 구분자 문자열이 있습니다');
// --replace: 지우기와 넣기를 한 요청(한 트랜잭션)의 두 문장으로 — 같은 문장의 CTE 로 지우면 on conflict 가 옛 행을 본다.
const del = replace
  ? `delete from climate_vote.ballot_roster r using climate_vote.session s where r.session_id=s.id and s.slug in (${slugList});
`
  : '';
const query = `${del}with src as (
  select * from jsonb_to_recordset($roster$${payload}$roster$::jsonb) as x(slug text, subgroup text, team text, no int, name text)
)
insert into climate_vote.ballot_roster(session_id, subgroup, team_label, no, name)
select s.id, src.subgroup, src.team, src.no, src.name
  from src join climate_vote.session s on s.slug=src.slug
on conflict (session_id, team_label, name_norm) do nothing`;
await sql(query);
const after = await sql(
  `select s.slug, r.subgroup, count(*)::int as n from climate_vote.ballot_roster r join climate_vote.session s on s.id=r.session_id where s.slug in (${slugList}) group by 1,2 order by 1,2`,
);
for (const a of after) console.log(`  넣은 뒤 ${a.slug} · ${a.subgroup} ${a.n}명`);
