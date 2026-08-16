import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';

const ACTIVATION_EVIDENCE_EVENT = 'platform_activation_preflight';
const ACTIVATION_EVIDENCE_TOOL_VERSION = 2;
const ACTIVATION_READ_CONSISTENCIES = new Set(['multi_request', 'single_statement']);
const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

export const ACTIVATION_APPROVAL_SOURCE_PATHS = [
  'automation/platform-activation-preflight.mjs',
  'automation/platform-a2-activation-bundle.mjs',
  'automation/platform-access-provisioning-plan.mjs',
  'automation/package.json',
  'automation/package-lock.json',
  'evaluation/platform-a2-activation-bundle.json',
  'src/islands/platform/access',
  'supabase/migrations',
  'supabase/rollbacks',
  'supabase/verify',
];

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

const SUMMARY_FIELDS = [
  'activeOrganizationCount',
  'activeMembershipCount',
  'requiredTableCount',
  'missingTableCount',
  'missingHierarchyEvidenceCount',
  'hierarchyMismatchCount',
  'totalNullOrgCount',
  'organizationsWithoutAdminCount',
  'organizationsWithoutHqCount',
  'multiOrganizationUserCount',
  'unavailableMembershipOrganizationCount',
  'unavailableAuthUserCount',
  'unboundActiveHqSessionCount',
];

const BLOCKER_SUMMARY_FIELDS = [
  ['hierarchy_org_mismatch', 'hierarchyMismatchCount'],
  ['no_active_organization', 'activeOrganizationCount'],
  ['organization_without_admin', 'organizationsWithoutAdminCount'],
  ['organization_without_hq', 'organizationsWithoutHqCount'],
  ['multi_organization_user', 'multiOrganizationUserCount'],
  ['membership_unavailable_organization', 'unavailableMembershipOrganizationCount'],
  ['membership_auth_user_unavailable', 'unavailableAuthUserCount'],
  ['null_org_id', 'totalNullOrgCount'],
  ['unbound_active_hq_session', 'unboundActiveHqSessionCount'],
];

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

function activationEvidenceDigest(report, audit, key) {
  return createHmac('sha256', key)
    .update(JSON.stringify(canonicalize({ report, audit })))
    .digest('hex');
}

function validateActivationEvidenceConfiguration(provenance, key) {
  if (typeof key !== 'string' || key.length < 32) {
    throw new Error('activation evidence trusted key is invalid');
  }
  if (!/^[0-9a-f]{40}$/.test(provenance.sourceCommit)
    || !/^[0-9a-f]{64}$/.test(provenance.scriptSha256)
    || provenance.sourceTreeClean !== true
    || typeof provenance.runId !== 'string'
    || provenance.runId.length === 0
    || typeof provenance.keyId !== 'string'
    || provenance.keyId.length === 0) {
    throw new Error('activation evidence provenance is incomplete');
  }
}

export function sealActivationPreflightEvidence(report, provenance, key) {
  validateActivationEvidenceConfiguration(provenance, key);
  if (report.status !== 'ready'
    || report.evidenceComplete !== true
    || report.databaseMutationExecuted !== false
    || !ACTIVATION_READ_CONSISTENCIES.has(report.readConsistency)
    || report.requiresImmediateRecheckBeforeActivation !== true
    || !Array.isArray(report.blockers)
    || report.blockers.length !== 0) {
    throw new Error('activation evidence can only seal a complete ready report');
  }
  const audit = {
    schemaVersion: 2,
    event: ACTIVATION_EVIDENCE_EVENT,
    toolVersion: ACTIVATION_EVIDENCE_TOOL_VERSION,
    sourceCommit: provenance.sourceCommit,
    scriptSha256: provenance.scriptSha256,
    sourceTreeClean: true,
    runId: provenance.runId,
    keyId: provenance.keyId,
  };
  return {
    ...report,
    approvalEvidence: {
      ...audit,
      integrity: {
        algorithm: 'hmac-sha256',
        target: 'preflight-report+provenance+source-tree',
        digest: activationEvidenceDigest(report, audit, key),
      },
    },
  };
}

export function verifyActivationPreflightEvidence(evidence, {
  trustedKey,
  expectedKeyId,
  currentCommit,
  currentScriptSha256,
  currentSourceTreeClean,
  expectedTargetHost,
  now = new Date().toISOString(),
  maxAgeMs = 10 * 60 * 1000,
}) {
  const audit = evidence?.approvalEvidence;
  validateActivationEvidenceConfiguration({
    sourceCommit: audit?.sourceCommit,
    scriptSha256: audit?.scriptSha256,
    sourceTreeClean: audit?.sourceTreeClean,
    runId: audit?.runId,
    keyId: audit?.keyId,
  }, trustedKey);
  if (typeof expectedKeyId !== 'string' || expectedKeyId.length === 0
    || !/^[0-9a-f]{40}$/.test(currentCommit)
    || !/^[0-9a-f]{64}$/.test(currentScriptSha256)
    || currentSourceTreeClean !== true
    || typeof expectedTargetHost !== 'string'
    || expectedTargetHost.length === 0
    || !Number.isSafeInteger(maxAgeMs)
    || maxAgeMs <= 0) {
    throw new Error('activation evidence verification configuration is invalid');
  }
  if (audit.schemaVersion !== 2
    || audit.event !== ACTIVATION_EVIDENCE_EVENT
    || audit.toolVersion !== ACTIVATION_EVIDENCE_TOOL_VERSION
    || audit.keyId !== expectedKeyId
    || audit.sourceCommit !== currentCommit
    || audit.scriptSha256 !== currentScriptSha256
    || audit.sourceTreeClean !== true
    || audit.integrity?.algorithm !== 'hmac-sha256'
    || audit.integrity?.target !== 'preflight-report+provenance+source-tree'
    || !/^[0-9a-f]{64}$/.test(audit.integrity?.digest ?? '')) {
    throw new Error('activation evidence provenance does not match the trusted target');
  }
  const { approvalEvidence: _approvalEvidence, ...report } = evidence;
  const { integrity: _integrity, ...signedAudit } = audit;
  const expectedDigest = activationEvidenceDigest(report, signedAudit, trustedKey);
  const actualBuffer = Buffer.from(audit.integrity.digest, 'hex');
  const expectedBuffer = Buffer.from(expectedDigest, 'hex');
  if (actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer)) {
    throw new Error('activation evidence integrity verification failed');
  }
  if (report.status !== 'ready'
    || report.evidenceComplete !== true
    || report.databaseMutationExecuted !== false
    || !ACTIVATION_READ_CONSISTENCIES.has(report.readConsistency)
    || report.requiresImmediateRecheckBeforeActivation !== true
    || !Array.isArray(report.blockers)
    || report.blockers.length !== 0
    || report.targetHost !== expectedTargetHost) {
    throw new Error('activation evidence is not an approvable ready report');
  }
  const checkedAt = new Date(report.checkedAt);
  const nowDate = new Date(now);
  if (Number.isNaN(checkedAt.valueOf())
    || checkedAt.toISOString() !== report.checkedAt
    || Number.isNaN(nowDate.valueOf())
    || nowDate.toISOString() !== now) {
    throw new Error('activation evidence time is invalid');
  }
  const ageMs = nowDate.valueOf() - checkedAt.valueOf();
  if (ageMs < 0 || ageMs > maxAgeMs) {
    throw new Error('activation evidence is stale');
  }
  return {
    status: 'verified',
    checkedAt: report.checkedAt,
    targetHost: report.targetHost,
    sourceCommit: audit.sourceCommit,
    sourceTreeClean: true,
    runId: audit.runId,
    ageSeconds: Math.floor(ageMs / 1000),
  };
}

export function readActivationSourceTreeStatus({ repoRoot = REPO_ROOT } = {}) {
  let status;
  try {
    status = execFileSync(
      'git',
      ['status', '--porcelain=v1', '--untracked-files=all', '--', ...ACTIVATION_APPROVAL_SOURCE_PATHS],
      { cwd: repoRoot, encoding: 'utf8' },
    );
  } catch {
    throw new Error('activation evidence source tree could not be inspected');
  }
  return { sourceTreeClean: status.trim().length === 0 };
}

function requireCleanActivationSourceTree() {
  const status = readActivationSourceTreeStatus();
  if (!status.sourceTreeClean) {
    throw new Error('activation evidence source tree is not clean');
  }
  return true;
}

function currentSourceCommit(environment) {
  const checkoutCommit = execFileSync(
    'git',
    ['rev-parse', 'HEAD'],
    { cwd: REPO_ROOT, encoding: 'utf8' },
  ).trim();
  if (environment.GITHUB_SHA && environment.GITHUB_SHA !== checkoutCommit) {
    throw new Error('activation evidence checkout does not match workflow commit');
  }
  return checkoutCommit;
}

function currentScriptSha256() {
  return createHash('sha256')
    .update(readFileSync(fileURLToPath(import.meta.url)))
    .digest('hex');
}

function currentActivationPreflightProvenance(environment) {
  return {
    sourceCommit: currentSourceCommit(environment),
    scriptSha256: currentScriptSha256(),
    sourceTreeClean: requireCleanActivationSourceTree(),
    runId: environment.GITHUB_RUN_ID ?? environment.ACTIVATION_PREFLIGHT_RUN_ID ?? randomUUID(),
    keyId: environment.ACTIVATION_PREFLIGHT_AUDIT_KEY_ID ?? '',
  };
}

function optionValue(args, option) {
  const index = args.indexOf(option);
  return index >= 0 ? args[index + 1] : undefined;
}

export function runActivationPreflightEvidenceCli({
  args,
  environment,
  now = new Date().toISOString(),
  stdout = console.log,
}) {
  const evidencePath = optionValue(args, '--verify-evidence');
  const expectedTargetHost = optionValue(args, '--expected-host');
  const maxAgeSecondsText = optionValue(args, '--max-age-seconds') ?? '600';
  const maxAgeSeconds = Number(maxAgeSecondsText);
  if (!evidencePath
    || !expectedTargetHost
    || !Number.isSafeInteger(maxAgeSeconds)
    || maxAgeSeconds <= 0) {
    throw new Error('activation evidence verification arguments are invalid');
  }
  let evidence;
  try {
    evidence = JSON.parse(readFileSync(evidencePath, 'utf8'));
  } catch {
    throw new Error('activation evidence file could not be parsed');
  }
  const result = verifyActivationPreflightEvidence(evidence, {
    trustedKey: environment.ACTIVATION_PREFLIGHT_AUDIT_HMAC_KEY,
    expectedKeyId: environment.ACTIVATION_PREFLIGHT_AUDIT_KEY_ID,
    currentCommit: currentSourceCommit(environment),
    currentScriptSha256: currentScriptSha256(),
    currentSourceTreeClean: requireCleanActivationSourceTree(),
    expectedTargetHost,
    now,
    maxAgeMs: maxAgeSeconds * 1000,
  });
  stdout(JSON.stringify(result));
  return 0;
}

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

function hasExactKeys(value, expectedKeys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actualKeys = Object.keys(value).sort();
  return actualKeys.length === expectedKeys.length
    && actualKeys.every((key, index) => key === [...expectedKeys].sort()[index]);
}

function isNonNegativeSafeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

export function validateActivationPreflightRpcReport(report) {
  const rootKeys = [
    'schemaVersion',
    'status',
    'checkedAt',
    'databaseMutationExecuted',
    'evidenceComplete',
    'readConsistency',
    'requiresImmediateRecheckBeforeActivation',
    'summary',
    'tables',
    'blockers',
  ];
  if (!hasExactKeys(report, rootKeys)
    || report.schemaVersion !== 1
    || !['ready', 'not_ready'].includes(report.status)
    || report.databaseMutationExecuted !== false
    || report.evidenceComplete !== true
    || report.readConsistency !== 'single_statement'
    || report.requiresImmediateRecheckBeforeActivation !== true) {
    throw readError('activation_preflight_rpc');
  }
  const checkedAt = new Date(report.checkedAt);
  if (Number.isNaN(checkedAt.valueOf()) || checkedAt.toISOString() !== report.checkedAt) {
    throw readError('activation_preflight_rpc');
  }
  if (!hasExactKeys(report.summary, SUMMARY_FIELDS)
    || SUMMARY_FIELDS.some((field) => !isNonNegativeSafeInteger(report.summary[field]))
    || report.summary.requiredTableCount !== REQUIRED_ORG_ID_TABLES.length
    || report.summary.missingTableCount !== 0
    || report.summary.missingHierarchyEvidenceCount !== 0) {
    throw readError('activation_preflight_rpc');
  }
  if (!Array.isArray(report.tables)
    || report.tables.length !== REQUIRED_ORG_ID_TABLES.length
    || report.tables.some((table, index) => (
      !hasExactKeys(table, ['table', 'totalCount', 'nullOrgCount'])
      || table.table !== REQUIRED_ORG_ID_TABLES[index]
      || !isNonNegativeSafeInteger(table.totalCount)
      || !isNonNegativeSafeInteger(table.nullOrgCount)
      || table.nullOrgCount > table.totalCount
    ))) {
    throw readError('activation_preflight_rpc');
  }
  const totalNullOrgCount = report.tables.reduce((total, table) => total + table.nullOrgCount, 0);
  if (!Number.isSafeInteger(totalNullOrgCount)
    || totalNullOrgCount !== report.summary.totalNullOrgCount
    || !Array.isArray(report.blockers)) {
    throw readError('activation_preflight_rpc');
  }
  const expectedBlockers = BLOCKER_SUMMARY_FIELDS.flatMap(([code, field]) => {
    const count = code === 'no_active_organization'
      ? (report.summary[field] === 0 ? 1 : 0)
      : report.summary[field];
    return count > 0 ? [{ code, count }] : [];
  });
  if (report.blockers.length !== expectedBlockers.length
    || report.blockers.some((blocker, index) => (
      !hasExactKeys(blocker, ['code', 'count'])
      || blocker.code !== expectedBlockers[index].code
      || blocker.count !== expectedBlockers[index].count
    ))
    || report.status !== (expectedBlockers.length === 0 ? 'ready' : 'not_ready')) {
    throw readError('activation_preflight_rpc');
  }
  return report;
}

export async function runActivationPreflightRpc({ client }) {
  if (!client) throw new Error('activation preflight configuration is invalid');
  const { data, error } = await client
    .schema('climate_vote')
    .rpc('platform_activation_preflight');
  if (error) throw readError('activation_preflight_rpc');
  return validateActivationPreflightRpcReport(data);
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
  provenance,
  preflightRunner = runActivationPreflightRpc,
  accessMethod = 'security_definer_count_only_rpc',
  failureReadConsistency = 'single_statement',
  stdout = console.log,
}) {
  const url = environment.SUPABASE_URL;
  const serviceRoleKey = environment.SUPABASE_SERVICE_ROLE_KEY ?? environment.SUPABASE_SERVICE_ROLE;
  if (typeof url !== 'string'
    || url.length === 0
    || typeof serviceRoleKey !== 'string'
    || serviceRoleKey.length === 0) {
    throw new Error('platform activation preflight credentials are missing');
  }
  if (typeof preflightRunner !== 'function'
    || typeof accessMethod !== 'string'
    || accessMethod.length === 0
    || !ACTIVATION_READ_CONSISTENCIES.has(failureReadConsistency)) {
    throw new Error('activation preflight configuration is invalid');
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
    report = await preflightRunner({ client, checkedAt });
  } catch (error) {
    if (!(error instanceof ActivationPreflightReadError)) throw error;
    report = {
      schemaVersion: 1,
      status: 'not_verified',
      checkedAt,
      databaseMutationExecuted: false,
      evidenceComplete: false,
      readConsistency: failureReadConsistency,
      requiresImmediateRecheckBeforeActivation: true,
      blockers: [{ code: error.code, resource: error.resource }],
    };
  }
  report = {
    ...report,
    targetHost,
    accessMethod,
  };
  if (report.status === 'ready') {
    report = sealActivationPreflightEvidence(
      report,
      provenance ?? currentActivationPreflightProvenance(environment),
      environment.ACTIVATION_PREFLIGHT_AUDIT_HMAC_KEY,
    );
  }
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
    const args = process.argv.slice(2);
    if (args.includes('--verify-evidence')) {
      process.exitCode = runActivationPreflightEvidenceCli({ args, environment: process.env });
    } else {
      const { createClient } = await import('@supabase/supabase-js');
      process.exitCode = await runActivationPreflightCli({
        environment: process.env,
        createClient,
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    console.error(`platform activation preflight failed: ${message}`);
    process.exitCode = 1;
  }
}
