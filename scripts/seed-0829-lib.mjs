// 조 구성은 회차마다 다르므로 이 파일이 아니라 scripts/session-rosters.mjs에 정의한다.
// 여기 있는 것은 회차와 무관한 규칙(접속코드 생성·SQL 포맷)뿐이다.
import { ACTIVE_SESSION_SLUG, sessionRoster } from './session-rosters.mjs';

/** 활성 회차의 정규화된 정의. 정의가 잘못돼 있으면 import 시점에 바로 터진다. */
const ACTIVE_ROSTER = sessionRoster(ACTIVE_SESSION_SLUG);

export const SESSION_DATE = ACTIVE_ROSTER.date;
export const SESSION_DATE_MMDD = ACTIVE_ROSTER.mmdd;
export const SESSION_SLUG = ACTIVE_ROSTER.slug;
export const SESSION_TITLE = ACTIVE_ROSTER.title;
export const SESSION_CONFIG = { modules: ['poll', 'timer'] };
export const TEAM_CAPACITY = 20;

export const OFFICIAL_TEAM_ROSTER = Object.freeze(
  ACTIVE_ROSTER.teams.map((team) => Object.freeze({ ...team }))
);

/**
 * Full target roster of the active session. `ordinal` is the canonical all-session team
 * number used by the join-code generator: 1분과 1조=01 ... 3분과 5조=15.
 */
export function fullTeamRoster() {
  return OFFICIAL_TEAM_ROSTER.map((team) => ({ ...team }));
}

/** 정규화된 회차 정의에서 조별 접속코드까지 붙인 행을 만든다. */
function rosterCodeRows(roster) {
  return roster.teams.map((team) => ({ ...team, code: joinCodeForTeam(roster.mmdd, team.ordinal) }));
}

/**
 * Given the set of team names that already exist for this session, return only the
 * teams that still need to be created (idempotent — never re-plans existing rows).
 * @param {Iterable<string>} existingNames
 */
export function buildTeamPlan(existingNames) {
  const existing = new Set(existingNames ?? []);
  return fullTeamRoster().filter((team) => !existing.has(team.name));
}

/**
 * Build a six-digit field code from MMDD + the global team ordinal.
 * Example: July 25, team 1 => 072501.
 * @param {string} mmdd
 * @param {number} teamOrdinal
 */
export function joinCodeForTeam(mmdd, teamOrdinal) {
  if (!/^\d{4}$/.test(mmdd)) {
    throw new Error('joinCodeForTeam: mmdd must be exactly four digits');
  }
  if (!Number.isInteger(teamOrdinal) || teamOrdinal < 1 || teamOrdinal > 99) {
    throw new Error('joinCodeForTeam: teamOrdinal must be an integer from 1 to 99');
  }
  return `${mmdd}${String(teamOrdinal).padStart(2, '0')}`;
}

/** Return the deterministic code for a roster team while preserving the global 1..15 order. */
export function joinCodeForTeamName(teamName, mmdd = SESSION_DATE_MMDD) {
  const team = fullTeamRoster().find((row) => row.name === teamName);
  if (!team) throw new Error(`joinCodeForTeamName: unknown team "${teamName}"`);
  return joinCodeForTeam(mmdd, team.ordinal);
}

/**
 * Generate n unique 6-digit join codes (100000-999999) not present in `taken`.
 * Emergency rotation only. Normal session seeding uses MMDD + team ordinal.
 * @param {number} n
 * @param {Iterable<string|number>} taken
 * @param {() => number} randomInt - defaults to crypto-backed randomInt(100000,999999) via injected fn
 */
export function genUniqueCodes(n, taken, randomInt) {
  if (typeof randomInt !== 'function') {
    throw new Error('genUniqueCodes requires a randomInt() generator function');
  }
  const used = new Set([...(taken ?? [])].map(String));
  const codes = [];
  let guard = 0;
  while (codes.length < n) {
    guard += 1;
    if (guard > n * 1000 + 1000) {
      throw new Error('genUniqueCodes: could not find enough unique codes');
    }
    const code = String(randomInt());
    if (used.has(code)) continue;
    used.add(code);
    codes.push(code);
  }
  return codes;
}

/**
 * Decide what to do with a session row found (or not) by slug lookup.
 * Pure helper — never overwrites an existing session (create-only semantics).
 * @param {object|null|undefined} existing - the session row from a SELECT by slug, or null/undefined if none.
 * @returns {'use'|'create'}
 */
export function sessionAction(existing) {
  return existing ? 'use' : 'create';
}

export function formatCodeTable(rows) {
  const header = ['조 이름', '코드'];
  const widths = [
    Math.max(header[0].length, ...rows.map((r) => r.name.length)),
    Math.max(header[1].length, ...rows.map((r) => String(r.code).length)),
  ];
  const pad = (s, w) => String(s) + ' '.repeat(Math.max(0, w - String(s).length));
  const lines = [
    `${pad(header[0], widths[0])}  ${pad(header[1], widths[1])}`,
    `${'-'.repeat(widths[0])}  ${'-'.repeat(widths[1])}`,
    ...rows.map((r) => `${pad(r.name, widths[0])}  ${pad(r.code, widths[1])}`),
  ];
  return lines.join('\n');
}

/**
 * Build one transaction for an administrator to align an existing session roster.
 * The SQL validates the full roster and code collisions before updating any row.
 * @param {ReturnType<import('./session-rosters.mjs').sessionRoster>} [roster] 생략하면 활성 회차.
 */
export function formatJoinCodeSyncSql(roster = ACTIVE_ROSTER) {
  const rows = rosterCodeRows(roster);
  const values = rows
    .map((row) => `    ('${row.name.replaceAll("'", "''")}', '${row.code}')`)
    .join(',\n');

  return `begin;

do $preflight$
declare
  target_session_id uuid;
begin
  select id into target_session_id
  from climate_vote.session
  where slug = '${roster.slug}';

  if target_session_id is null then
    raise exception 'session not found: ${roster.slug}';
  end if;

  if (
    select count(*)
    from climate_vote.team t
    join (values
${values}
    ) as expected(name, join_code) on expected.name = t.name
    where t.session_id = target_session_id
  ) <> ${rows.length} then
    raise exception 'complete official ${rows.length}-team roster is required';
  end if;

  if exists (
    select 1
    from climate_vote.team t
    join (values
${values}
    ) as expected(name, join_code) on expected.join_code = t.join_code
    where t.session_id <> target_session_id
       or t.name <> expected.name
  ) then
    raise exception 'join-code collision detected';
  end if;
end
$preflight$;

update climate_vote.team t
set join_code = expected.join_code
from climate_vote.session s,
  (values
${values}
  ) as expected(name, join_code)
where s.slug = '${roster.slug}'
  and t.session_id = s.id
  and t.name = expected.name
  and t.join_code is distinct from expected.join_code;

do $verify$
declare
  verified_count integer;
begin
  select count(*) into verified_count
  from climate_vote.team t
  join climate_vote.session s on s.id = t.session_id
  join (values
${values}
  ) as expected(name, join_code)
    on expected.name = t.name
   and expected.join_code = t.join_code
  where s.slug = '${roster.slug}';

  if verified_count <> ${rows.length} then
    raise exception 'join-code verification failed: % of ${rows.length}', verified_count;
  end if;
end
$verify$;

commit;`;
}

/**
 * Build one transaction for an administrator to create a new session and its roster.
 *
 * ★ roster.inheritTenancyFrom 이 있으면 세션·조가 그 세션의 `org_id`(와 `assembly_id`)를
 *   물려받는다. `platform_p1b_backfill.sql` 이 적용된 DB 에서는 org_id 가 NOT NULL 이라
 *   그 값 없이는 insert 자체가 실패하고, 나중에 update 로 메울 수도 없다.
 *   상속하면 p1b 적용 여부와 무관하게 맞는다(미적용이면 상속값이 null 이다).
 *   자세한 근거는 scripts/session-rosters.mjs 머리말 「테넌시 상속」.
 *
 * @param {ReturnType<import('./session-rosters.mjs').sessionRoster>} [roster] 생략하면 활성 회차.
 */
export function formatSessionSeedSql(roster = ACTIVE_ROSTER) {
  const rows = rosterCodeRows(roster);
  const values = rows
    .map((row) => `  ('${row.name}', '${row.subgroup}', ${row.ordinal}, '${row.code}')`)
    .join(',\n');
  const escapedTitle = roster.title.replaceAll("'", "''");
  const source = roster.inheritTenancyFrom ?? null;
  const escapedSource = source ? source.replaceAll("'", "''") : null;

  // 상속본은 원본 세션 행에서 org_id·assembly_id 를 읽어 온다 — 그래서 insert 가 values 가
  // 아니라 select 다. held_on 은 이 회차의 행사일이다(상속하지 않는다).
  const sessionInsert = source
    ? `do $tenancy$
begin
  if not exists (select 1 from climate_vote.session where slug = '${escapedSource}') then
    raise exception 'tenancy source session not found: ${escapedSource}';
  end if;
end
$tenancy$;

insert into climate_vote.session (slug, title, config, status, org_id, assembly_id, held_on)
select '${roster.slug}', '${escapedTitle}', '${JSON.stringify(SESSION_CONFIG)}'::jsonb, 'active',
       src.org_id, src.assembly_id, date '${roster.date}'
from climate_vote.session src
where src.slug = '${escapedSource}'
on conflict (slug) do nothing;`
    : `insert into climate_vote.session (slug, title, config, status)
values ('${roster.slug}', '${escapedTitle}', '${JSON.stringify(SESSION_CONFIG)}'::jsonb, 'active')
on conflict (slug) do nothing;`;

  const teamColumns = source
    ? '(session_id, name, subgroup, join_code, capacity, status, org_id)'
    : '(session_id, name, subgroup, join_code, capacity, status)';
  const teamSelect = source
    ? `select s.id, expected.name, expected.subgroup, expected.join_code, ${TEAM_CAPACITY}, 'active', s.org_id`
    : `select s.id, expected.name, expected.subgroup, expected.join_code, ${TEAM_CAPACITY}, 'active'`;

  return `begin;

${sessionInsert}

insert into climate_vote.team ${teamColumns}
${teamSelect}
from climate_vote.session s
cross join (values
${values}
) as expected(name, subgroup, ordinal, join_code)
where s.slug = '${roster.slug}'
  and not exists (
    select 1
    from climate_vote.team existing
    where existing.session_id = s.id
      and existing.name = expected.name
  );

do $verify$
declare
  verified_count integer;
begin
  select count(*) into verified_count
  from climate_vote.team t
  join climate_vote.session s on s.id = t.session_id
  join (values
${values}
  ) as expected(name, subgroup, ordinal, join_code)
    on expected.name = t.name
   and expected.subgroup = t.subgroup
   and expected.join_code = t.join_code
  where s.slug = '${roster.slug}';

  if verified_count <> ${rows.length} then
    raise exception 'session seed verification failed: % of ${rows.length}', verified_count;
  end if;
end
$verify$;

commit;`;
}

/**
 * Build one transaction for an administrator to replace a leaked team code.
 * @param {ReturnType<import('./session-rosters.mjs').sessionRoster>} [roster] 생략하면 활성 회차.
 */
export function formatJoinCodeRotationSql(teamName, newCode, roster = ACTIVE_ROSTER) {
  if (!roster.teams.some((team) => team.name === teamName)) {
    throw new Error(`formatJoinCodeRotationSql: unknown team "${teamName}"`);
  }
  if (!/^\d{6}$/.test(newCode)) {
    throw new Error('formatJoinCodeRotationSql: newCode must be exactly six digits');
  }
  const escapedTeamName = teamName.replaceAll("'", "''");

  return `begin;

do $rotate$
declare
  updated_count integer;
begin
  update climate_vote.team t
  set join_code = '${newCode}'
  from climate_vote.session s
  where s.id = t.session_id
    and s.slug = '${roster.slug}'
    and t.name = '${escapedTeamName}'
    and t.join_code is distinct from '${newCode}';

  get diagnostics updated_count = row_count;
  if updated_count <> 1 then
    raise exception 'expected one team update, got %', updated_count;
  end if;
end
$rotate$;

commit;`;
}
