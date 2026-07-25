export const SESSION_DATE = '2026-08-29';

const sessionDateParts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(SESSION_DATE);
if (!sessionDateParts) throw new Error('SESSION_DATE must use YYYY-MM-DD');
const [, , sessionMonth, sessionDay] = sessionDateParts;

export const SESSION_DATE_MMDD = `${sessionMonth}${sessionDay}`;
export const SESSION_SLUG = `${SESSION_DATE_MMDD}-deliberation`;
export const SESSION_TITLE = `${Number(sessionMonth)}/${Number(sessionDay)} 숙의`;
export const SESSION_CONFIG = { modules: ['poll', 'timer'] };
export const TEAM_CAPACITY = 20;

export const OFFICIAL_TEAM_ROSTER = Object.freeze([
  { name: '1분과 1조', subgroup: '1분과', ordinal: 1 },
  { name: '1분과 2조', subgroup: '1분과', ordinal: 2 },
  { name: '1분과 3조', subgroup: '1분과', ordinal: 3 },
  { name: '1분과 4조', subgroup: '1분과', ordinal: 4 },
  { name: '1분과 5조', subgroup: '1분과', ordinal: 5 },
  { name: '2분과 1조', subgroup: '2분과', ordinal: 6 },
  { name: '2분과 2조', subgroup: '2분과', ordinal: 7 },
  { name: '2분과 3조', subgroup: '2분과', ordinal: 8 },
  { name: '2분과 4조', subgroup: '2분과', ordinal: 9 },
  { name: '2분과 5조', subgroup: '2분과', ordinal: 10 },
  { name: '3분과 1조', subgroup: '3분과', ordinal: 11 },
  { name: '3분과 2조', subgroup: '3분과', ordinal: 12 },
  { name: '3분과 3조', subgroup: '3분과', ordinal: 13 },
  { name: '3분과 4조', subgroup: '3분과', ordinal: 14 },
  { name: '3분과 5조', subgroup: '3분과', ordinal: 15 },
]);

/**
 * Full target roster of 15 teams. `ordinal` is the canonical all-session team number
 * used by the join-code generator: 1분과 1조=01 ... 3분과 5조=15.
 */
export function fullTeamRoster() {
  return OFFICIAL_TEAM_ROSTER.map((team) => ({ ...team }));
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
 */
export function formatJoinCodeSyncSql() {
  const rows = fullTeamRoster().map((team) => ({
    ...team,
    code: joinCodeForTeamName(team.name),
  }));
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
  where slug = '${SESSION_SLUG}';

  if target_session_id is null then
    raise exception 'session not found: ${SESSION_SLUG}';
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
where s.slug = '${SESSION_SLUG}'
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
  where s.slug = '${SESSION_SLUG}';

  if verified_count <> ${rows.length} then
    raise exception 'join-code verification failed: % of ${rows.length}', verified_count;
  end if;
end
$verify$;

commit;`;
}

/** Build one transaction for an administrator to create a new session and its roster. */
export function formatSessionSeedSql() {
  const rows = fullTeamRoster().map((team) => ({
    ...team,
    code: joinCodeForTeamName(team.name),
  }));
  const values = rows
    .map((row) => `  ('${row.name}', '${row.subgroup}', ${row.ordinal}, '${row.code}')`)
    .join(',\n');
  const escapedTitle = SESSION_TITLE.replaceAll("'", "''");

  return `begin;

insert into climate_vote.session (slug, title, config, status)
values ('${SESSION_SLUG}', '${escapedTitle}', '${JSON.stringify(SESSION_CONFIG)}'::jsonb, 'active')
on conflict (slug) do nothing;

insert into climate_vote.team (session_id, name, subgroup, join_code, capacity, status)
select s.id, expected.name, expected.subgroup, expected.join_code, ${TEAM_CAPACITY}, 'active'
from climate_vote.session s
cross join (values
${values}
) as expected(name, subgroup, ordinal, join_code)
where s.slug = '${SESSION_SLUG}'
on conflict (session_id, name) do nothing;

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
  where s.slug = '${SESSION_SLUG}';

  if verified_count <> ${rows.length} then
    raise exception 'session seed verification failed: % of ${rows.length}', verified_count;
  end if;
end
$verify$;

commit;`;
}

/** Build one transaction for an administrator to replace a leaked team code. */
export function formatJoinCodeRotationSql(teamName, newCode) {
  if (!fullTeamRoster().some((team) => team.name === teamName)) {
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
    and s.slug = '${SESSION_SLUG}'
    and t.name = '${escapedTeamName}';

  get diagnostics updated_count = row_count;
  if updated_count <> 1 then
    raise exception 'expected one team update, got %', updated_count;
  end if;
end
$rotate$;

commit;`;
}
