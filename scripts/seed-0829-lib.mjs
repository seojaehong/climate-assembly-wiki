const SUBGROUPS = ['1분과', '2분과', '3분과'];
const TEAMS_PER_SUBGROUP = 5;

export const SESSION_SLUG = '0829-deliberation';
export const SESSION_TITLE = '8/29 숙의';
export const SESSION_CONFIG = { modules: ['poll', 'timer'] };
export const TEAM_CAPACITY = 20;

/**
 * Full target roster of 15 team names: "1분과 1조" .. "3분과 5조", grouped by subgroup.
 */
export function fullTeamRoster() {
  const rows = [];
  for (const subgroup of SUBGROUPS) {
    for (let i = 1; i <= TEAMS_PER_SUBGROUP; i++) {
      rows.push({ name: `${subgroup} ${i}조`, subgroup });
    }
  }
  return rows;
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
 * Generate n unique 6-digit join codes (100000-999999) not present in `taken`.
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
