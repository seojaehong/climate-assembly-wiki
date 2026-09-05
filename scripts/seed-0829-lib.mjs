// 조 구성은 회차마다 다르므로 이 파일이 아니라 scripts/session-rosters.mjs에 정의한다.
// 여기 있는 것은 회차와 무관한 규칙(보안 코드 검증·SQL 포맷)뿐이다.
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
 * display order. Operational join codes are generated independently with a secure source.
 */
export function fullTeamRoster() {
  return OFFICIAL_TEAM_ROSTER.map((team) => ({ ...team }));
}

/** Build validated roster rows with caller-supplied secure codes. */
function rosterCodeRows(roster, codes) {
  if (codes === undefined) {
    throw new Error('roster codes are required; operational callers must use a cryptographically secure generator');
  }
  const resolvedCodes = [...codes].map(String);
  if (resolvedCodes.length !== roster.teams.length
      || new Set(resolvedCodes).size !== resolvedCodes.length
      || resolvedCodes.some((code) => !/^\d{6}$/.test(code))) {
    throw new Error('roster codes must contain one unique six-digit code per team');
  }
  return roster.teams.map((team, index) => ({ ...team, code: resolvedCodes[index] }));
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
 * Build a legacy six-digit fixture code from MMDD + the global team ordinal.
 * This helper is retained only for historical 8/29 verification fixtures. Never use it
 * to create or rotate an operational code packet.
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

/** Return a legacy deterministic fixture code for historical verification only. */
export function joinCodeForTeamName(teamName, mmdd = SESSION_DATE_MMDD) {
  const team = fullTeamRoster().find((row) => row.name === teamName);
  if (!team) throw new Error(`joinCodeForTeamName: unknown team "${teamName}"`);
  return joinCodeForTeam(mmdd, team.ordinal);
}

/**
 * Generate n unique 6-digit join codes (100000-999999) not present in `taken`.
 * The CLI injects a cryptographically secure source for every operational SQL packet.
 * Deterministic sources are accepted only so pure tests can be reproducible.
 * @param {number} n
 * @param {Iterable<string|number>} taken
 * @param {() => number} randomInt - required generator returning an integer in 100000..999999
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
    const candidate = randomInt();
    if (!Number.isInteger(candidate) || candidate < 100000 || candidate > 999999) {
      throw new Error('genUniqueCodes: randomInt must return an integer from 100000 to 999999');
    }
    const code = String(candidate);
    if (used.has(code)) continue;
    used.add(code);
    codes.push(code);
  }
  return codes;
}

/** Generate one unique code per team through a caller-provided secure random source. */
export function genRosterCodes(roster = ACTIVE_ROSTER, randomInt) {
  return genUniqueCodes(roster.teams.length, [], randomInt);
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
 * @param {Iterable<string|number>} codes caller-supplied secure codes, one per team.
 */
export function formatJoinCodeSyncSql(roster = ACTIVE_ROSTER, codes) {
  const rows = rosterCodeRows(roster, codes);
  const source = roster.inheritTenancyFrom ?? null;
  if (typeof source !== 'string' || source.trim().length === 0) {
    throw new Error(
      `formatJoinCodeSyncSql: approved tenancy source is required for existing session "${roster.slug}"`
    );
  }
  const values = rows
    .map((row) => `    ('${row.name.replaceAll("'", "''")}', '${row.subgroup.replaceAll("'", "''")}', '${row.code}')`)
    .join(',\n');
  const escapedSlug = roster.slug.replaceAll("'", "''");
  const escapedSource = source.replaceAll("'", "''");

  return `begin;

do $preflight$
declare
  source_session climate_vote.session%rowtype;
  target_session climate_vote.session%rowtype;
  session_team_count integer;
  roster_match_count integer;
begin
  select src.* into source_session
  from climate_vote.session src
  join climate_vote.assembly source_assembly
    on source_assembly.id = src.assembly_id
   and source_assembly.org_id = src.org_id
  where src.slug = '${escapedSource}'
    and src.org_id is not null
    and src.assembly_id is not null
  for share of src, source_assembly;

  if not found then
    raise exception 'approved tenancy source is missing or invalid: ${escapedSource}';
  end if;

  select * into target_session
  from climate_vote.session
  where slug = '${escapedSlug}'
  for update;

  if not found then
    raise exception 'session not found: ${escapedSlug}';
  end if;

  if target_session.org_id is distinct from source_session.org_id
     or target_session.assembly_id is distinct from source_session.assembly_id
     or target_session.held_on is distinct from date '${roster.date}' then
    raise exception 'existing session tenancy mismatch: ${escapedSlug}';
  end if;

  if exists (
    select 1
    from climate_vote.team t
    where t.session_id = target_session.id
      and t.org_id is distinct from target_session.org_id
  ) then
    raise exception 'existing team tenancy mismatch: ${escapedSlug}';
  end if;

  select count(*) into session_team_count
  from climate_vote.team t
  where t.session_id = target_session.id;

  select count(*) into roster_match_count
  from climate_vote.team t
  join (values
${values}
  ) as expected(name, subgroup, join_code)
    on expected.name = t.name
   and expected.subgroup = t.subgroup
  where t.session_id = target_session.id
    and t.status = 'active'
    and t.capacity = ${TEAM_CAPACITY};

  if session_team_count <> ${rows.length} or roster_match_count <> ${rows.length} then
    raise exception 'complete official ${rows.length}-team roster is required';
  end if;

  if exists (
    select 1
    from climate_vote.team t
    join (values
${values}
    ) as expected(name, subgroup, join_code) on expected.join_code = t.join_code
    where t.session_id <> target_session.id
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
  ) as expected(name, subgroup, join_code)
where s.slug = '${escapedSlug}'
  and t.session_id = s.id
  and t.name = expected.name
  and t.join_code is distinct from expected.join_code;

do $verify$
declare
  verified_count integer;
  session_team_count integer;
begin
  select count(*) into session_team_count
  from climate_vote.team t
  join climate_vote.session s on s.id = t.session_id
  where s.slug = '${escapedSlug}';

  select count(*) into verified_count
  from climate_vote.team t
  join climate_vote.session s on s.id = t.session_id
  join climate_vote.assembly a on a.id = s.assembly_id and a.org_id = s.org_id
  join (values
${values}
  ) as expected(name, subgroup, join_code)
    on expected.name = t.name
   and expected.subgroup = t.subgroup
   and expected.join_code = t.join_code
  where s.slug = '${escapedSlug}'
    and s.held_on = date '${roster.date}'
    and t.org_id = s.org_id
    and t.status = 'active'
    and t.capacity = ${TEAM_CAPACITY};

  if session_team_count <> ${rows.length} or verified_count <> ${rows.length} then
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
 * @param {Iterable<string|number>} codes caller-supplied secure codes, one per team.
 */
export function formatSessionSeedSql(roster = ACTIVE_ROSTER, codes) {
  const rows = rosterCodeRows(roster, codes);
  const values = rows
    .map((row) => `  ('${row.name.replaceAll("'", "''")}', '${row.subgroup.replaceAll("'", "''")}', ${row.ordinal}, '${row.code}')`)
    .join(',\n');
  const escapedSlug = roster.slug.replaceAll("'", "''");
  const escapedTitle = roster.title.replaceAll("'", "''");
  const source = roster.inheritTenancyFrom ?? null;
  const escapedSource = source ? source.replaceAll("'", "''") : null;

  // 상속본은 원본 세션 행에서 org_id·assembly_id 를 읽어 온다. 이미 같은
  // slug가 있으면 조용히 고치지 않고 승인된 원본과 전부 일치하는지 확인한다.
  // held_on 은 상속하지 않고 이 회차의 행사일을 정본으로 삼는다.
  const sessionInsert = source
    ? `do $tenancy$
declare
  source_session climate_vote.session%rowtype;
  target_session climate_vote.session%rowtype;
begin
  select src.* into source_session
  from climate_vote.session src
  join climate_vote.assembly source_assembly
    on source_assembly.id = src.assembly_id
   and source_assembly.org_id = src.org_id
  where src.slug = '${escapedSource}'
    and src.org_id is not null
    and src.assembly_id is not null
  for share of src, source_assembly;

  if not found then
    raise exception 'tenancy source session not found: ${escapedSource}';
  end if;

  insert into climate_vote.session (slug, title, config, status, org_id, assembly_id, held_on)
  select '${escapedSlug}', '${escapedTitle}', '${JSON.stringify(SESSION_CONFIG)}'::jsonb, 'active',
       src.org_id, src.assembly_id, date '${roster.date}'
  from climate_vote.session src
  where src.id = source_session.id
  on conflict (slug) do nothing;

  select * into target_session
  from climate_vote.session
  where slug = '${escapedSlug}'
  for share;

  if not found
     or target_session.org_id is distinct from source_session.org_id
     or target_session.assembly_id is distinct from source_session.assembly_id
     or target_session.held_on is distinct from date '${roster.date}' then
    raise exception 'existing session tenancy mismatch: ${escapedSlug} against approved source ${escapedSource}';
  end if;

  perform 1
  from climate_vote.team t
  where t.session_id = target_session.id
  for share;

  if exists (
    select 1
    from climate_vote.team t
    where t.session_id = target_session.id
      and t.org_id is distinct from target_session.org_id
  ) then
    raise exception 'existing team tenancy mismatch: ${escapedSlug}';
  end if;
end
$tenancy$;`
    : `do $session_seed$
declare
  seeded_session_id uuid;
begin
  insert into climate_vote.session (slug, title, config, status)
  values ('${escapedSlug}', '${escapedTitle}', '${JSON.stringify(SESSION_CONFIG)}'::jsonb, 'active')
  on conflict (slug) do nothing
  returning id into seeded_session_id;

  if seeded_session_id is null then
    raise exception 'existing session cannot be verified without approved tenancy source: ${escapedSlug}';
  end if;
end
$session_seed$;`;

  const teamColumns = source
    ? '(session_id, name, subgroup, join_code, capacity, status, org_id)'
    : '(session_id, name, subgroup, join_code, capacity, status)';
  const teamSelect = source
    ? `select s.id, expected.name, expected.subgroup, expected.join_code, ${TEAM_CAPACITY}, 'active', s.org_id`
    : `select s.id, expected.name, expected.subgroup, expected.join_code, ${TEAM_CAPACITY}, 'active'`;
  const tenancyVerifyJoin = source
    ? '\n  join climate_vote.assembly a on a.id = s.assembly_id and a.org_id = s.org_id'
    : '';
  const tenancyVerifyWhere = source
    ? `
    and s.held_on = date '${roster.date}'
    and t.org_id = s.org_id`
    : '';
  const tenancyVerifyBlock = source
    ? `

  if exists (
    select 1
    from climate_vote.team t
    join climate_vote.session s on s.id = t.session_id
    where s.slug = '${escapedSlug}'
      and t.org_id is distinct from s.org_id
  ) then
    raise exception 'session seed team tenancy verification failed: ${escapedSlug}';
  end if;`
    : '';

  return `begin;

${sessionInsert}

insert into climate_vote.team ${teamColumns}
${teamSelect}
from climate_vote.session s
cross join (values
${values}
) as expected(name, subgroup, ordinal, join_code)
where s.slug = '${escapedSlug}'
  and not exists (
    select 1
    from climate_vote.team existing
    where existing.session_id = s.id
      and existing.name = expected.name
  );

do $verify$
declare
  verified_count integer;
  session_team_count integer;
begin
  select count(*) into session_team_count
  from climate_vote.team t
  join climate_vote.session s on s.id = t.session_id
  where s.slug = '${escapedSlug}';

  select count(*) into verified_count
  from climate_vote.team t
  join climate_vote.session s on s.id = t.session_id${tenancyVerifyJoin}
  join (values
${values}
  ) as expected(name, subgroup, ordinal, join_code)
    on expected.name = t.name
   and expected.subgroup = t.subgroup
   and expected.join_code = t.join_code
  where s.slug = '${escapedSlug}'
    and t.status = 'active'
    and t.capacity = ${TEAM_CAPACITY}${tenancyVerifyWhere};

  if session_team_count <> ${rows.length} then
    raise exception 'complete official ${rows.length}-team roster is required';
  end if;

  if verified_count <> ${rows.length} then
    raise exception 'session seed verification failed: % of ${rows.length}', verified_count;
  end if;${tenancyVerifyBlock}
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
  const escapedSlug = roster.slug.replaceAll("'", "''");

  return `begin;

do $rotate$
declare
  updated_count integer;
begin
  update climate_vote.team t
  set join_code = '${newCode}'
  from climate_vote.session s
  where s.id = t.session_id
    and s.slug = '${escapedSlug}'
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
