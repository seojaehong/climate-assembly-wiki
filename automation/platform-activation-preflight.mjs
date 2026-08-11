import { fileURLToPath } from 'node:url';

export const REQUIRED_ORG_ID_TABLES = [
  'assembly',
  'session',
  'discussion_topic',
  'submission',
  'ballot',
  'team',
  'assembly_member',
  'team_assignment',
  'issue',
  'result_page',
  'attendance',
  'attendance_auth_session',
];

const HIERARCHY_TABLE_COLUMNS = {
  assembly: 'id,org_id',
  session: 'id,assembly_id,org_id',
  discussion_topic: 'id,session_id,org_id',
  submission: 'id,topic_id,team_id,org_id',
  ballot: 'id,session_id,org_id',
  team: 'id,session_id,org_id',
  assembly_member: 'id,org_id',
  team_assignment: 'id,session_id,team_id,member_id,org_id',
  issue: 'id,topic_id,org_id',
  result_page: 'id,scope,scope_id,org_id',
  attendance: 'id,assignment_id,org_id',
  attendance_auth_session: 'token_hash,scope,team_id,expires_at,org_id',
};

function applyFilters(query, filters) {
  return filters.reduce((current, filter) => current[filter.kind](filter.column, filter.value), query);
}

class ActivationPreflightReadError extends Error {
  constructor(resource) {
    super(`activation preflight could not read ${resource}`);
    this.name = 'ActivationPreflightReadError';
    this.code = 'read_access_unavailable';
    this.resource = resource;
  }
}

function readError(table) {
  return new ActivationPreflightReadError(table);
}

async function readRows(client, table, columns, filters, pageSize, orderColumn = 'id') {
  const rows = [];
  let offset = 0;
  while (true) {
    let query = client
      .schema('climate_vote')
      .from(table)
      .select(columns, { count: 'exact' });
    query = applyFilters(query, filters)
      .order(orderColumn, { ascending: true })
      .range(offset, offset + pageSize - 1);
    const { data, count, error } = await query;
    if (error || !Array.isArray(data) || !Number.isSafeInteger(count) || count < 0) {
      throw readError(table);
    }
    rows.push(...data);
    if (rows.length >= count) return rows;
    if (data.length === 0) throw readError(table);
    offset += data.length;
  }
}

async function readAuthUsers(client, memberships, checkedAt) {
  const userIds = [...new Set(memberships.map((membership) => membership.user_id))];
  const checkedAtDate = new Date(checkedAt);
  return Promise.all(userIds.map(async (userId) => {
    const { data, error } = await client.auth.admin.getUserById(userId);
    if (error && error.status !== 404) throw readError('auth_user');
    const user = data?.user ?? null;
    if (!user) return { id: userId, active: false };
    const bannedUntil = user.banned_until ? new Date(user.banned_until) : null;
    const confirmedAtValue = user.email_confirmed_at ?? user.confirmed_at;
    const confirmedAt = confirmedAtValue ? new Date(confirmedAtValue) : null;
    const active = !user.deleted_at
      && user.is_anonymous !== true
      && typeof user.email === 'string'
      && user.email.length > 0
      && Boolean(confirmedAt)
      && !Number.isNaN(confirmedAt?.valueOf())
      && confirmedAt.valueOf() <= checkedAtDate.valueOf()
      && (!bannedUntil || (!Number.isNaN(bannedUntil.valueOf()) && bannedUntil.valueOf() <= checkedAtDate.valueOf()));
    return { id: userId, active };
  }));
}

export async function runActivationPreflight({
  client,
  checkedAt = new Date().toISOString(),
  pageSize = 1000,
}) {
  if (!client || !Number.isSafeInteger(pageSize) || pageSize <= 0) {
    throw new Error('activation preflight configuration is invalid');
  }
  const checkedAtDate = new Date(checkedAt);
  if (Number.isNaN(checkedAtDate.valueOf()) || checkedAtDate.toISOString() !== checkedAt) {
    throw new Error('activation preflight checkedAt must be canonical UTC');
  }

  const organizations = await readRows(
    client,
    'org',
    'id,status',
    [],
    pageSize,
  );
  const memberships = await readRows(
    client,
    'membership',
    'org_id,user_id,role,status',
    [{ kind: 'eq', column: 'status', value: 'active' }],
    pageSize,
  );
  const authUsers = await readAuthUsers(client, memberships, checkedAt);
  const hierarchyEntries = await Promise.all(Object.entries(HIERARCHY_TABLE_COLUMNS).map(
    async ([table, columns]) => [
      table,
      await readRows(
        client,
        table,
        columns,
        [],
        pageSize,
        table === 'attendance_auth_session' ? 'token_hash' : 'id',
      ),
    ],
  ));
  const hierarchyRows = Object.fromEntries(hierarchyEntries);
  const orgIdTables = Object.fromEntries(REQUIRED_ORG_ID_TABLES.map((table) => [
    table,
    {
      totalCount: hierarchyRows[table].length,
      nullOrgCount: hierarchyRows[table].filter((row) => row.org_id === null).length,
    },
  ]));
  const unboundActiveHqSessionCount = hierarchyRows.attendance_auth_session.filter(
    (row) => row.scope === 'hq' && row.org_id === null && row.expires_at > checkedAt,
  ).length;

  return evaluateActivationReadiness({
    organizations,
    memberships,
    authUsers,
    orgIdTables,
    hierarchyRows,
    unboundActiveHqSessionCount,
  }, checkedAt);
}

export async function runActivationPreflightCli({
  environment,
  createClient,
  checkedAt = new Date().toISOString(),
  stdout = console.log,
}) {
  const url = environment.SUPABASE_URL;
  const serviceRoleKey = environment.SUPABASE_SERVICE_ROLE_KEY ?? environment.SUPABASE_SERVICE_ROLE;
  if (typeof url !== 'string' || url.length === 0 || typeof serviceRoleKey !== 'string' || serviceRoleKey.length === 0) {
    throw new Error('platform activation preflight credentials are missing');
  }
  let targetHost;
  try {
    targetHost = new URL(url).host;
  } catch {
    throw new Error('platform activation preflight URL is invalid');
  }
  const client = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  let report;
  try {
    report = await runActivationPreflight({ client, checkedAt });
  } catch (error) {
    if (!(error instanceof ActivationPreflightReadError)) throw error;
    report = {
      schemaVersion: 1,
      status: 'not_verified',
      checkedAt,
      databaseMutationExecuted: false,
      evidenceComplete: false,
      readConsistency: 'multi_request',
      requiresImmediateRecheckBeforeActivation: true,
      blockers: [{ code: error.code, resource: error.resource }],
    };
  }
  report = {
    ...report,
    targetHost,
    accessMethod: 'postgrest_and_auth_admin_service_role_read_only',
  };
  stdout(JSON.stringify(report, null, 2));
  return report.status === 'ready' ? 0 : 2;
}

function hierarchyMismatchCount(organizations, rows, checkedAt) {
  const mismatches = new Set();
  const checkedAtDate = new Date(checkedAt);
  const organizationIds = new Set(organizations.map((organization) => organization.id));
  const activeOrganizationIds = new Set(
    organizations.filter((organization) => organization.status === 'active').map((organization) => organization.id),
  );
  const mapById = (table) => new Map((rows[table] ?? []).map((row) => [row.id, row]));
  const assemblies = mapById('assembly');
  const sessions = mapById('session');
  const topics = mapById('discussion_topic');
  const teams = mapById('team');
  const members = mapById('assembly_member');
  const assignments = mapById('team_assignment');
  const mark = (table, row, valid) => {
    if (row.org_id !== null && row.org_id !== undefined && !valid) {
      mismatches.add(`${table}:${row.id ?? row.token_hash}`);
    }
  };
  const sameOrg = (row, parent) => Boolean(parent) && row.org_id === parent.org_id;

  for (const row of rows.assembly ?? []) {
    mark('assembly', row, organizationIds.has(row.org_id));
  }
  for (const row of rows.assembly_member ?? []) {
    mark('assembly_member', row, organizationIds.has(row.org_id));
  }
  for (const row of rows.session ?? []) {
    mark('session', row, sameOrg(row, assemblies.get(row.assembly_id)));
  }
  for (const row of rows.discussion_topic ?? []) {
    mark('discussion_topic', row, sameOrg(row, sessions.get(row.session_id)));
  }
  for (const row of rows.team ?? []) {
    mark('team', row, sameOrg(row, sessions.get(row.session_id)));
  }
  for (const row of rows.submission ?? []) {
    mark('submission', row, sameOrg(row, topics.get(row.topic_id)) && sameOrg(row, teams.get(row.team_id)));
  }
  for (const row of rows.ballot ?? []) {
    mark('ballot', row, sameOrg(row, sessions.get(row.session_id)));
  }
  for (const row of rows.issue ?? []) {
    mark('issue', row, sameOrg(row, topics.get(row.topic_id)));
  }
  for (const row of rows.result_page ?? []) {
    const parents = { assembly: assemblies, session: sessions, topic: topics };
    mark('result_page', row, sameOrg(row, parents[row.scope]?.get(row.scope_id)));
  }
  for (const row of rows.team_assignment ?? []) {
    mark(
      'team_assignment',
      row,
      sameOrg(row, sessions.get(row.session_id))
        && sameOrg(row, teams.get(row.team_id))
        && sameOrg(row, members.get(row.member_id)),
    );
  }
  for (const row of rows.attendance ?? []) {
    mark('attendance', row, sameOrg(row, assignments.get(row.assignment_id)));
  }
  for (const row of rows.attendance_auth_session ?? []) {
    const expiresAt = new Date(row.expires_at);
    const validExpiration = !Number.isNaN(expiresAt.valueOf());
    const requiresActiveOrganization = validExpiration
      && expiresAt.valueOf() > checkedAtDate.valueOf();
    const validOrganization = requiresActiveOrganization
      ? activeOrganizationIds.has(row.org_id)
      : organizationIds.has(row.org_id);
    const valid = row.scope === 'team'
      ? sameOrg(row, teams.get(row.team_id)) && validOrganization
      : row.scope === 'hq' && validOrganization;
    mark('attendance_auth_session', row, validExpiration && valid);
  }
  return mismatches.size;
}

export function evaluateActivationReadiness(inventory, checkedAt = new Date().toISOString()) {
  const activeOrganizations = inventory.organizations.filter((org) => org.status === 'active');
  const activeMemberships = inventory.memberships.filter((membership) => membership.status === 'active');
  const organizationRoles = new Map(
    activeOrganizations.map((organization) => [organization.id, new Set()]),
  );
  const userOrganizations = new Map();
  const activeAuthUserIds = new Set(
    (inventory.authUsers ?? []).filter((user) => user.active).map((user) => user.id),
  );

  for (const membership of activeMemberships) {
    organizationRoles.get(membership.org_id)?.add(membership.role);
    const organizations = userOrganizations.get(membership.user_id) ?? new Set();
    organizations.add(membership.org_id);
    userOrganizations.set(membership.user_id, organizations);
  }

  const organizationsWithoutAdminCount = [...organizationRoles.values()]
    .filter((roles) => !roles.has('org_admin')).length;
  const organizationsWithoutHqCount = [...organizationRoles.values()]
    .filter((roles) => !roles.has('hq')).length;
  const multiOrganizationUserCount = [...userOrganizations.values()]
    .filter((organizations) => organizations.size > 1).length;
  const unavailableMembershipOrganizationCount = activeMemberships
    .filter((membership) => !activeOrganizations.some(
      (organization) => organization.id === membership.org_id,
    )).length;
  const unavailableAuthUserCount = [...userOrganizations.keys()]
    .filter((userId) => !activeAuthUserIds.has(userId)).length;
  const missingTableCount = REQUIRED_ORG_ID_TABLES
    .filter((table) => !inventory.orgIdTables[table]).length;
  const missingHierarchyEvidenceCount = REQUIRED_ORG_ID_TABLES
    .filter((table) => !inventory.hierarchyRows?.[table]).length;
  const hierarchyMismatchTotal = hierarchyMismatchCount(
    inventory.organizations,
    inventory.hierarchyRows ?? {},
    checkedAt,
  );
  const totalNullOrgCount = REQUIRED_ORG_ID_TABLES.reduce(
    (total, table) => total + (inventory.orgIdTables[table]?.nullOrgCount ?? 0),
    0,
  );
  const blockers = [];

  if (missingTableCount > 0) blockers.push({ code: 'missing_table_count', count: missingTableCount });
  if (missingHierarchyEvidenceCount > 0) {
    blockers.push({ code: 'missing_hierarchy_evidence', count: missingHierarchyEvidenceCount });
  }
  if (hierarchyMismatchTotal > 0) blockers.push({ code: 'hierarchy_org_mismatch', count: hierarchyMismatchTotal });
  if (activeOrganizations.length === 0) blockers.push({ code: 'no_active_organization', count: 1 });
  if (organizationsWithoutAdminCount > 0) blockers.push({ code: 'organization_without_admin', count: organizationsWithoutAdminCount });
  if (organizationsWithoutHqCount > 0) blockers.push({ code: 'organization_without_hq', count: organizationsWithoutHqCount });
  if (multiOrganizationUserCount > 0) blockers.push({ code: 'multi_organization_user', count: multiOrganizationUserCount });
  if (unavailableMembershipOrganizationCount > 0) {
    blockers.push({
      code: 'membership_unavailable_organization',
      count: unavailableMembershipOrganizationCount,
    });
  }
  if (unavailableAuthUserCount > 0) {
    blockers.push({ code: 'membership_auth_user_unavailable', count: unavailableAuthUserCount });
  }
  if (totalNullOrgCount > 0) blockers.push({ code: 'null_org_id', count: totalNullOrgCount });
  if (inventory.unboundActiveHqSessionCount > 0) {
    blockers.push({ code: 'unbound_active_hq_session', count: inventory.unboundActiveHqSessionCount });
  }

  return {
    schemaVersion: 1,
    status: blockers.length === 0 ? 'ready' : 'not_ready',
    checkedAt,
    databaseMutationExecuted: false,
    evidenceComplete: true,
    summary: {
      activeOrganizationCount: activeOrganizations.length,
      activeMembershipCount: activeMemberships.length,
      requiredTableCount: REQUIRED_ORG_ID_TABLES.length,
      missingTableCount,
      missingHierarchyEvidenceCount,
      hierarchyMismatchCount: hierarchyMismatchTotal,
      totalNullOrgCount,
      organizationsWithoutAdminCount,
      organizationsWithoutHqCount,
      multiOrganizationUserCount,
      unavailableMembershipOrganizationCount,
      unavailableAuthUserCount,
      unboundActiveHqSessionCount: inventory.unboundActiveHqSessionCount,
    },
    tables: REQUIRED_ORG_ID_TABLES.map((table) => ({
      table,
      totalCount: inventory.orgIdTables[table]?.totalCount ?? 0,
      nullOrgCount: inventory.orgIdTables[table]?.nullOrgCount ?? 0,
    })),
    blockers,
    readConsistency: 'multi_request',
    requiresImmediateRecheckBeforeActivation: true,
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const { createClient } = await import('@supabase/supabase-js');
    process.exitCode = await runActivationPreflightCli({
      environment: process.env,
      createClient,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    console.error(`platform activation preflight failed: ${message}`);
    process.exitCode = 1;
  }
}
