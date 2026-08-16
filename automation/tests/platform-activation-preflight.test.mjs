import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import {
  ACTIVATION_APPROVAL_SOURCE_PATHS,
  evaluateActivationReadiness,
  readActivationSourceTreeStatus,
  runActivationPreflight,
  runActivationPreflightCli,
  runActivationPreflightRpc,
  sealActivationPreflightEvidence,
  validateActivationPreflightRpcReport,
  verifyActivationPreflightEvidence,
} from '../platform-activation-preflight.mjs';

const sourceModulePath = fileURLToPath(new URL('../platform-activation-preflight.mjs', import.meta.url));

function createCommittedActivationCliFixture(prefix) {
  const repoRoot = mkdtempSync(join(tmpdir(), prefix));
  const automationDirectory = join(repoRoot, 'automation');
  const verificationDirectory = join(repoRoot, 'supabase', 'verify');
  const accessDirectory = join(repoRoot, 'src', 'islands', 'platform', 'access');
  mkdirSync(automationDirectory, { recursive: true });
  mkdirSync(verificationDirectory, { recursive: true });
  mkdirSync(accessDirectory, { recursive: true });
  const modulePath = join(automationDirectory, 'platform-activation-preflight.mjs');
  writeFileSync(modulePath, readFileSync(sourceModulePath), 'utf8');
  writeFileSync(join(automationDirectory, 'package.json'), '{}\n', 'utf8');
  writeFileSync(join(automationDirectory, 'package-lock.json'), '{}\n', 'utf8');
  writeFileSync(join(verificationDirectory, 'README.md'), 'fixture\n', 'utf8');
  writeFileSync(join(accessDirectory, 'README.md'), 'fixture\n', 'utf8');
  execFileSync('git', ['init', '--quiet'], { cwd: repoRoot });
  execFileSync('git', ['config', 'user.email', 'activation-fixture@example.test'], { cwd: repoRoot });
  execFileSync('git', ['config', 'user.name', 'Activation Fixture'], { cwd: repoRoot });
  execFileSync('git', ['add', '.'], { cwd: repoRoot });
  execFileSync('git', ['commit', '--quiet', '-m', 'fixture'], { cwd: repoRoot });
  const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: repoRoot,
    encoding: 'utf8',
  }).trim();
  const scriptSha256 = createHash('sha256').update(readFileSync(modulePath)).digest('hex');
  return { repoRoot, modulePath, sourceCommit, scriptSha256 };
}

const REQUIRED_TABLES = [
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

function readyInventory() {
  return {
    organizations: [{ id: 'org-1', status: 'active' }],
    memberships: [
      { org_id: 'org-1', user_id: 'user-admin', role: 'org_admin', status: 'active' },
      { org_id: 'org-1', user_id: 'user-hq', role: 'hq', status: 'active' },
    ],
    authUsers: [
      { id: 'user-admin', active: true },
      { id: 'user-hq', active: true },
    ],
    orgIdTables: Object.fromEntries(
      REQUIRED_TABLES.map((table) => [table, { totalCount: 1, nullOrgCount: 0 }]),
    ),
    hierarchyRows: {
      assembly: [{ id: 'assembly-1', org_id: 'org-1' }],
      session: [{ id: 'session-1', assembly_id: 'assembly-1', org_id: 'org-1' }],
      discussion_topic: [{ id: 'topic-1', session_id: 'session-1', org_id: 'org-1' }],
      team: [{ id: 'team-1', session_id: 'session-1', org_id: 'org-1' }],
      submission: [{ id: 'submission-1', topic_id: 'topic-1', team_id: 'team-1', org_id: 'org-1' }],
      ballot: [{ id: 'ballot-1', session_id: 'session-1', org_id: 'org-1' }],
      issue: [{ id: 'issue-1', topic_id: 'topic-1', org_id: 'org-1' }],
      result_page: [{ id: 'result-1', scope: 'topic', scope_id: 'topic-1', org_id: 'org-1' }],
      assembly_member: [{ id: 'member-1', org_id: 'org-1' }],
      team_assignment: [{
        id: 'assignment-1',
        session_id: 'session-1',
        team_id: 'team-1',
        member_id: 'member-1',
        org_id: 'org-1',
      }],
      attendance: [{ id: 'attendance-1', assignment_id: 'assignment-1', org_id: 'org-1' }],
      attendance_auth_session: [{
        token_hash: 'hash-1',
        scope: 'team',
        team_id: 'team-1',
        expires_at: '2026-08-11T08:00:00.000Z',
        org_id: 'org-1',
      }],
    },
    unboundActiveHqSessionCount: 0,
  };
}

function readyFixtures() {
  const inventory = readyInventory();
  return {
    org: inventory.organizations,
    membership: inventory.memberships,
    auth_user: inventory.authUsers.map((user) => ({
      id: user.id,
      email: `${user.id}@example.test`,
      email_confirmed_at: '2026-08-10T00:00:00.000Z',
      is_anonymous: false,
    })),
    ...inventory.hierarchyRows,
  };
}

function rpcReport(inventory = readyInventory(), checkedAt = '2026-08-11T07:00:00.000Z') {
  return {
    ...evaluateActivationReadiness(inventory, checkedAt),
    readConsistency: 'single_statement',
  };
}

function makeRpcClient(report, error = null) {
  const operations = [];
  return {
    operations,
    schema(schemaName) {
      return {
        async rpc(functionName) {
          operations.push({ schema: schemaName, functionName });
          return { data: error ? null : report, error };
        },
      };
    },
  };
}

function makeReadOnlyClient(fixtures, failTable = null) {
  const operations = [];
  const schema = (schemaName) => ({
    from: (table) => ({
      select: (columns, options = {}) => {
        const filters = [];
        let range = null;
        let order = null;
        const builder = {
          eq(column, value) {
            filters.push({ kind: 'eq', column, value });
            return builder;
          },
          is(column, value) {
            filters.push({ kind: 'is', column, value });
            return builder;
          },
          gt(column, value) {
            filters.push({ kind: 'gt', column, value });
            return builder;
          },
          range(from, to) {
            range = { from, to };
            return builder;
          },
          order(column, options) {
            order = { column, options };
            return builder;
          },
          then(resolve) {
            operations.push({ schema: schemaName, table, columns, options, filters: [...filters], range, order });
            if (table === failTable) {
              return resolve({ data: null, count: null, error: { message: 'secret-row-value' } });
            }
            const matching = (fixtures[table] ?? []).filter((row) => filters.every((filter) => {
              if (filter.kind === 'eq') return row[filter.column] === filter.value;
              if (filter.kind === 'is') return row[filter.column] === filter.value;
              return row[filter.column] > filter.value;
            }));
            if (options.head) return resolve({ data: null, count: matching.length, error: null });
            const sliced = range ? matching.slice(range.from, range.to + 1) : matching;
            const selected = columns.split(',').map((column) => column.trim());
            return resolve({
              data: sliced.map((row) => Object.fromEntries(selected.map((column) => [column, row[column]]))),
              count: matching.length,
              error: null,
            });
          },
        };
        return builder;
      },
    }),
  });
  const auth = {
    admin: {
      async getUserById(userId) {
        operations.push({ resource: 'auth_user', userId });
        if (failTable === 'auth_user') {
          return { data: { user: null }, error: { status: 500, message: 'secret-auth-value' } };
        }
        const user = (fixtures.auth_user ?? []).find((candidate) => candidate.id === userId) ?? null;
        if (!user) return { data: { user: null }, error: { status: 404, message: 'not found' } };
        return { data: { user }, error: null };
      },
    },
  };
  return { schema, auth, operations };
}

test('reports ready only when every active organization has staff coverage and complete org ids', () => {
  const report = evaluateActivationReadiness(readyInventory(), '2026-08-11T07:00:00.000Z');

  expect(report).toMatchObject({
    schemaVersion: 1,
    status: 'ready',
    checkedAt: '2026-08-11T07:00:00.000Z',
    databaseMutationExecuted: false,
    evidenceComplete: true,
    summary: {
      activeOrganizationCount: 1,
      activeMembershipCount: 2,
      requiredTableCount: 12,
      totalNullOrgCount: 0,
      organizationsWithoutAdminCount: 0,
      organizationsWithoutHqCount: 0,
      multiOrganizationUserCount: 0,
      unboundActiveHqSessionCount: 0,
    },
    blockers: [],
  });
});

test('fails closed with count-only blockers for incomplete tenancy data', () => {
  const inventory = readyInventory();
  inventory.organizations.push({ id: 'org-2', status: 'active' });
  inventory.memberships.push({
    org_id: 'org-2',
    user_id: 'user-admin',
    role: 'operator',
    status: 'active',
  });
  inventory.orgIdTables.issue = { totalCount: 4, nullOrgCount: 2 };
  inventory.unboundActiveHqSessionCount = 3;

  const report = evaluateActivationReadiness(inventory, '2026-08-11T07:00:00.000Z');

  expect(report.status).toBe('not_ready');
  expect(report.blockers).toEqual([
    { code: 'organization_without_admin', count: 1 },
    { code: 'organization_without_hq', count: 1 },
    { code: 'multi_organization_user', count: 1 },
    { code: 'null_org_id', count: 2 },
    { code: 'unbound_active_hq_session', count: 3 },
  ]);
  expect(JSON.stringify(report)).not.toContain('org-2');
  expect(JSON.stringify(report)).not.toContain('user-admin');
});

test('reads only scoped metadata and produces the same readiness report', async () => {
  const fixtures = readyFixtures();
  const client = makeReadOnlyClient(fixtures);

  const report = await runActivationPreflight({
    client,
    checkedAt: '2026-08-11T07:00:00.000Z',
    pageSize: 1,
  });

  expect(report.status).toBe('ready');
  expect(report.summary).toMatchObject({ activeOrganizationCount: 1, activeMembershipCount: 2 });
  const databaseOperations = client.operations.filter((operation) => operation.schema);
  expect(databaseOperations).toHaveLength(REQUIRED_TABLES.length + 3);
  expect(databaseOperations.every((operation) => operation.schema === 'climate_vote')).toBe(true);
  expect(databaseOperations.every((operation) => typeof operation.columns === 'string')).toBe(true);
  expect(databaseOperations
    .filter((operation) => operation.options.head)
    .every((operation) => operation.columns === '*')).toBe(true);
  expect(databaseOperations
    .filter((operation) => operation.range)
    .every((operation) => operation.order?.options?.ascending === true)).toBe(true);
  expect(client.operations.filter((operation) => operation.resource === 'auth_user')).toHaveLength(2);
});

test('accepts only the count-only single-statement RPC contract', async () => {
  const report = rpcReport();
  const client = makeRpcClient(report);

  await expect(runActivationPreflightRpc({ client })).resolves.toEqual(report);
  expect(client.operations).toEqual([{
    schema: 'climate_vote',
    functionName: 'platform_activation_preflight',
  }]);

  expect(() => validateActivationPreflightRpcReport({
    ...report,
    userIds: ['sensitive-user-id'],
  })).toThrow('activation preflight could not read activation_preflight_rpc');
});

test('rejects inconsistent or malformed RPC counts without exposing response content', async () => {
  const report = rpcReport();
  const malformed = {
    ...report,
    summary: { ...report.summary, totalNullOrgCount: 1 },
  };

  await expect(runActivationPreflightRpc({
    client: makeRpcClient(malformed),
  })).rejects.toThrow('activation preflight could not read activation_preflight_rpc');
  await expect(runActivationPreflightRpc({
    client: makeRpcClient(null, { message: 'sensitive-database-error' }),
  })).rejects.not.toThrow('sensitive-database-error');
});

test('fails closed without echoing database error content', async () => {
  const client = makeReadOnlyClient({}, 'membership');

  await expect(runActivationPreflight({
    client,
    checkedAt: '2026-08-11T07:00:00.000Z',
  })).rejects.toThrow('activation preflight could not read membership');
  await expect(runActivationPreflight({
    client,
    checkedAt: '2026-08-11T07:00:00.000Z',
  })).rejects.not.toThrow('secret-row-value');
});

test('fails closed without echoing auth error content', async () => {
  const client = makeReadOnlyClient(readyFixtures(), 'auth_user');

  await expect(runActivationPreflight({
    client,
    checkedAt: '2026-08-11T07:00:00.000Z',
  })).rejects.toThrow('activation preflight could not read auth_user');
  await expect(runActivationPreflight({
    client,
    checkedAt: '2026-08-11T07:00:00.000Z',
  })).rejects.not.toThrow('secret-auth-value');
});

test.each([
  ['confirmed anonymous identity', { is_anonymous: true }],
  ['unconfirmed identity', { email_confirmed_at: null }],
  ['future confirmation', { email_confirmed_at: '2026-08-12T00:00:00.000Z' }],
  ['currently banned identity', { banned_until: '2026-08-12T00:00:00.000Z' }],
])('does not count %s as active staff', async (_label, override) => {
  const fixtures = readyFixtures();
  fixtures.auth_user[1] = {
    ...fixtures.auth_user[1],
    ...override,
  };

  const report = await runActivationPreflight({
    client: makeReadOnlyClient(fixtures),
    checkedAt: '2026-08-11T07:00:00.000Z',
  });

  expect(report.status).toBe('not_ready');
  expect(report.blockers).toContainEqual({ code: 'membership_auth_user_unavailable', count: 1 });
});

test('treats a missing required table count as not ready', () => {
  const inventory = readyInventory();
  delete inventory.orgIdTables.result_page;

  const report = evaluateActivationReadiness(inventory, '2026-08-11T07:00:00.000Z');

  expect(report.status).toBe('not_ready');
  expect(report.blockers).toContainEqual({ code: 'missing_table_count', count: 1 });
});

test('fails closed when a non-null org id disagrees with its authoritative parent path', () => {
  const inventory = readyInventory();
  inventory.organizations.push({ id: 'org-2', status: 'active' });
  inventory.memberships.push(
    { org_id: 'org-2', user_id: 'user-admin-2', role: 'org_admin', status: 'active' },
    { org_id: 'org-2', user_id: 'user-hq-2', role: 'hq', status: 'active' },
  );
  inventory.authUsers.push(
    { id: 'user-admin-2', active: true },
    { id: 'user-hq-2', active: true },
  );
  inventory.hierarchyRows.session[0].org_id = 'org-2';

  const report = evaluateActivationReadiness(inventory, '2026-08-11T07:00:00.000Z');

  expect(report.status).toBe('not_ready');
  expect(report.summary.hierarchyMismatchCount).toBe(5);
  expect(report.blockers).toContainEqual({ code: 'hierarchy_org_mismatch', count: 5 });
});

test('fails closed when an active membership is not backed by an active auth user', () => {
  const inventory = readyInventory();
  inventory.authUsers[1].active = false;

  const report = evaluateActivationReadiness(inventory, '2026-08-11T07:00:00.000Z');

  expect(report.status).toBe('not_ready');
  expect(report.summary.unavailableAuthUserCount).toBe(1);
  expect(report.blockers).toContainEqual({ code: 'membership_auth_user_unavailable', count: 1 });
  expect(JSON.stringify(report)).not.toContain('user-hq');
});

test('fails closed for active staff or HQ sessions bound to an inactive organization', () => {
  const inventory = readyInventory();
  inventory.organizations.push({ id: 'org-archived', status: 'archived' });
  inventory.memberships.push({
    org_id: 'org-archived',
    user_id: 'user-archived-org',
    role: 'hq',
    status: 'active',
  });
  inventory.authUsers.push({ id: 'user-archived-org', active: true });
  inventory.hierarchyRows.attendance_auth_session.push({
    token_hash: 'hash-archived-org',
    scope: 'hq',
    team_id: null,
    expires_at: '2026-08-11T08:00:00.000Z',
    org_id: 'org-archived',
  });

  const report = evaluateActivationReadiness(inventory, '2026-08-11T07:00:00.000Z');

  expect(report.status).toBe('not_ready');
  expect(report.summary.unavailableMembershipOrganizationCount).toBe(1);
  expect(report.blockers).toContainEqual({ code: 'membership_unavailable_organization', count: 1 });
  expect(report.blockers).toContainEqual({ code: 'hierarchy_org_mismatch', count: 1 });
});

test('allows an expired auth session to preserve a valid archived organization reference', () => {
  const inventory = readyInventory();
  inventory.organizations.push({ id: 'org-archived', status: 'archived' });
  inventory.hierarchyRows.attendance_auth_session.push({
    token_hash: 'hash-expired-archived-org',
    scope: 'hq',
    team_id: null,
    expires_at: '2026-08-11T06:00:00.000Z',
    org_id: 'org-archived',
  });

  const report = evaluateActivationReadiness(inventory, '2026-08-11T07:00:00.000Z');

  expect(report.status).toBe('ready');
  expect(report.summary.hierarchyMismatchCount).toBe(0);
});

test('CLI writes a count-only report and never persists an auth session', async () => {
  const client = makeRpcClient(rpcReport());
  const createClient = (...args) => {
    createClient.calls.push(args);
    return client;
  };
  createClient.calls = [];
  const output = [];

  const exitCode = await runActivationPreflightCli({
    environment: {
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-secret',
      ACTIVATION_PREFLIGHT_AUDIT_HMAC_KEY: 'test-activation-audit-key-32-bytes-minimum',
    },
    createClient,
    checkedAt: '2026-08-11T07:00:00.000Z',
    provenance: {
      sourceCommit: 'a'.repeat(40),
      scriptSha256: 'b'.repeat(64),
      sourceTreeClean: true,
      runId: 'activation-local-1',
      keyId: 'activation-audit-2026-08-v1',
    },
    stdout: (line) => output.push(line),
  });

  expect(exitCode).toBe(0);
  expect(createClient.calls).toEqual([[
    'https://example.supabase.co',
    'test-service-role-secret',
    { auth: { persistSession: false, autoRefreshToken: false } },
  ]]);
  expect(JSON.parse(output[0]).status).toBe('ready');
  expect(JSON.parse(output[0])).toMatchObject({
    targetHost: 'example.supabase.co',
    accessMethod: 'security_definer_count_only_rpc',
    approvalEvidence: {
      schemaVersion: 2,
      event: 'platform_activation_preflight',
      toolVersion: 2,
      sourceCommit: 'a'.repeat(40),
      scriptSha256: 'b'.repeat(64),
      sourceTreeClean: true,
      runId: 'activation-local-1',
      keyId: 'activation-audit-2026-08-v1',
      integrity: {
        algorithm: 'hmac-sha256',
        target: 'preflight-report+provenance+source-tree',
      },
    },
  });
  expect(output[0]).not.toContain('test-service-role-secret');
  expect(output[0]).not.toContain('user-admin');
});

test('CLI refuses an unsigned ready report when approval evidence configuration is missing', async () => {
  const output = [];

  await expect(runActivationPreflightCli({
    environment: {
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-secret',
    },
    createClient: () => makeRpcClient(rpcReport()),
    checkedAt: '2026-08-11T07:00:00.000Z',
    provenance: {
      sourceCommit: 'a'.repeat(40),
      scriptSha256: 'b'.repeat(64),
      runId: 'activation-local-1',
      keyId: '',
    },
    stdout: (line) => output.push(line),
  })).rejects.toThrow('activation evidence trusted key is invalid');

  expect(output).toEqual([]);
});

test('CLI returns a distinct nonzero code when activation is not ready', async () => {
  const inventory = readyInventory();
  inventory.organizations = [];
  inventory.memberships = [];
  inventory.authUsers = [];
  const output = [];

  const exitCode = await runActivationPreflightCli({
    environment: {
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_SERVICE_ROLE: 'test-service-role-secret',
    },
    createClient: () => makeRpcClient(rpcReport(inventory)),
    checkedAt: '2026-08-11T07:00:00.000Z',
    stdout: (line) => output.push(line),
  });

  expect(exitCode).toBe(2);
  const report = JSON.parse(output[0]);
  expect(report.status).toBe('not_ready');
  expect(report.blockers).toContainEqual({ code: 'no_active_organization', count: 1 });
});

test('CLI emits a sanitized not-verified report when read access is unavailable', async () => {
  const output = [];

  const exitCode = await runActivationPreflightCli({
    environment: {
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-secret',
    },
    createClient: () => makeRpcClient(null, { message: 'secret-row-value' }),
    checkedAt: '2026-08-11T07:00:00.000Z',
    stdout: (line) => output.push(line),
  });

  expect(exitCode).toBe(2);
  expect(JSON.parse(output[0])).toEqual({
    schemaVersion: 1,
    status: 'not_verified',
    checkedAt: '2026-08-11T07:00:00.000Z',
    targetHost: 'example.supabase.co',
    accessMethod: 'security_definer_count_only_rpc',
    databaseMutationExecuted: false,
    evidenceComplete: false,
    readConsistency: 'single_statement',
    requiresImmediateRecheckBeforeActivation: true,
    blockers: [{ code: 'read_access_unavailable', resource: 'activation_preflight_rpc' }],
  });
  expect(output[0]).not.toContain('secret-row-value');
  expect(output[0]).not.toContain('test-service-role-secret');
});

test('verifies a fresh ready report bound to the current commit, script, host, and trusted key', () => {
  const report = {
    ...evaluateActivationReadiness(readyInventory(), '2026-08-11T07:00:00.000Z'),
    targetHost: 'example.supabase.co',
    accessMethod: 'postgrest_and_auth_admin_service_role_read_only',
  };
  const evidence = sealActivationPreflightEvidence(report, {
    sourceCommit: 'a'.repeat(40),
    scriptSha256: 'b'.repeat(64),
    sourceTreeClean: true,
    runId: 'activation-local-1',
    keyId: 'activation-audit-2026-08-v1',
  }, 'test-activation-audit-key-32-bytes-minimum');

  expect(verifyActivationPreflightEvidence(evidence, {
    trustedKey: 'test-activation-audit-key-32-bytes-minimum',
    expectedKeyId: 'activation-audit-2026-08-v1',
    currentCommit: 'a'.repeat(40),
    currentScriptSha256: 'b'.repeat(64),
    currentSourceTreeClean: true,
    expectedTargetHost: 'example.supabase.co',
    now: '2026-08-11T07:05:00.000Z',
    maxAgeMs: 10 * 60 * 1000,
  })).toEqual({
    status: 'verified',
    checkedAt: '2026-08-11T07:00:00.000Z',
    targetHost: 'example.supabase.co',
    sourceCommit: 'a'.repeat(40),
    sourceTreeClean: true,
    runId: 'activation-local-1',
    ageSeconds: 300,
  });
});

test('rejects a ready report whose signed counts were edited after generation', () => {
  const report = {
    ...evaluateActivationReadiness(readyInventory(), '2026-08-11T07:00:00.000Z'),
    targetHost: 'example.supabase.co',
    accessMethod: 'postgrest_and_auth_admin_service_role_read_only',
  };
  const evidence = sealActivationPreflightEvidence(report, {
    sourceCommit: 'a'.repeat(40),
    scriptSha256: 'b'.repeat(64),
    sourceTreeClean: true,
    runId: 'activation-local-1',
    keyId: 'activation-audit-2026-08-v1',
  }, 'test-activation-audit-key-32-bytes-minimum');
  evidence.summary.activeOrganizationCount = 99;

  expect(() => verifyActivationPreflightEvidence(evidence, {
    trustedKey: 'test-activation-audit-key-32-bytes-minimum',
    expectedKeyId: 'activation-audit-2026-08-v1',
    currentCommit: 'a'.repeat(40),
    currentScriptSha256: 'b'.repeat(64),
    currentSourceTreeClean: true,
    expectedTargetHost: 'example.supabase.co',
    now: '2026-08-11T07:05:00.000Z',
    maxAgeMs: 10 * 60 * 1000,
  })).toThrow('activation evidence integrity verification failed');
});

test.each([
  ['stale timestamp', { now: '2026-08-11T07:11:00.000Z' }, 'activation evidence is stale'],
  ['future timestamp', { now: '2026-08-11T06:59:00.000Z' }, 'activation evidence is stale'],
  ['different commit', { currentCommit: 'c'.repeat(40) }, 'activation evidence provenance does not match the trusted target'],
  ['different script', { currentScriptSha256: 'c'.repeat(64) }, 'activation evidence provenance does not match the trusted target'],
  ['dirty source tree', { currentSourceTreeClean: false }, 'activation evidence verification configuration is invalid'],
  ['different host', { expectedTargetHost: 'other.supabase.co' }, 'activation evidence is not an approvable ready report'],
  ['untrusted key', { trustedKey: 'different-activation-audit-key-32-bytes' }, 'activation evidence integrity verification failed'],
])('rejects approval evidence with %s', (_label, override, expectedError) => {
  const report = {
    ...evaluateActivationReadiness(readyInventory(), '2026-08-11T07:00:00.000Z'),
    targetHost: 'example.supabase.co',
    accessMethod: 'postgrest_and_auth_admin_service_role_read_only',
  };
  const evidence = sealActivationPreflightEvidence(report, {
    sourceCommit: 'a'.repeat(40),
    scriptSha256: 'b'.repeat(64),
    sourceTreeClean: true,
    runId: 'activation-local-1',
    keyId: 'activation-audit-2026-08-v1',
  }, 'test-activation-audit-key-32-bytes-minimum');
  const options = {
    trustedKey: 'test-activation-audit-key-32-bytes-minimum',
    expectedKeyId: 'activation-audit-2026-08-v1',
    currentCommit: 'a'.repeat(40),
    currentScriptSha256: 'b'.repeat(64),
    currentSourceTreeClean: true,
    expectedTargetHost: 'example.supabase.co',
    now: '2026-08-11T07:05:00.000Z',
    maxAgeMs: 10 * 60 * 1000,
    ...override,
  };

  expect(() => verifyActivationPreflightEvidence(evidence, options)).toThrow(expectedError);
});

test('verification CLI validates signed evidence without loading database credentials', () => {
  const fixture = createCommittedActivationCliFixture('activation-preflight-');
  const evidencePath = join(fixture.repoRoot, 'ready.json');
  const checkedAt = new Date().toISOString();
  const report = {
    ...evaluateActivationReadiness(readyInventory(), checkedAt),
    targetHost: 'example.supabase.co',
    accessMethod: 'postgrest_and_auth_admin_service_role_read_only',
  };
  const evidence = sealActivationPreflightEvidence(report, {
    sourceCommit: fixture.sourceCommit,
    scriptSha256: fixture.scriptSha256,
    sourceTreeClean: true,
    runId: 'activation-cli-1',
    keyId: 'activation-audit-2026-08-v1',
  }, 'test-activation-audit-key-32-bytes-minimum');
  writeFileSync(evidencePath, `${JSON.stringify(evidence)}\n`, 'utf8');

  try {
    const result = spawnSync(process.execPath, [
      fixture.modulePath,
      '--verify-evidence', evidencePath,
      '--expected-host', 'example.supabase.co',
      '--max-age-seconds', '600',
    ], {
      cwd: fixture.repoRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        GITHUB_SHA: fixture.sourceCommit,
        SUPABASE_URL: '',
        SUPABASE_SERVICE_ROLE_KEY: '',
        SUPABASE_SERVICE_ROLE: '',
        ACTIVATION_PREFLIGHT_AUDIT_HMAC_KEY: 'test-activation-audit-key-32-bytes-minimum',
        ACTIVATION_PREFLIGHT_AUDIT_KEY_ID: 'activation-audit-2026-08-v1',
      },
    });

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      status: 'verified',
      targetHost: 'example.supabase.co',
      sourceCommit: fixture.sourceCommit,
      sourceTreeClean: true,
      runId: 'activation-cli-1',
    });
    expect(result.stderr).not.toContain('test-activation-audit-key-32-bytes-minimum');
  } finally {
    rmSync(fixture.repoRoot, { recursive: true, force: true });
  }
});

test('activation source status rejects tracked changes in an approval input', () => {
  const fixture = createCommittedActivationCliFixture('activation-preflight-dirty-');
  try {
    expect(ACTIVATION_APPROVAL_SOURCE_PATHS).toEqual(expect.arrayContaining([
      'automation/platform-activation-preflight.mjs',
      'automation/platform-a2-activation-bundle.mjs',
      'automation/platform-access-provisioning-plan.mjs',
      'automation/package-lock.json',
      'evaluation/platform-a2-activation-bundle.json',
      'src/islands/platform/access',
      'supabase/migrations',
      'supabase/rollbacks',
      'supabase/verify',
    ]));
    expect(readActivationSourceTreeStatus({ repoRoot: fixture.repoRoot })).toEqual({ sourceTreeClean: true });
    writeFileSync(
      join(fixture.repoRoot, 'src', 'islands', 'platform', 'access', 'README.md'),
      'changed\n',
      'utf8',
    );
    expect(readActivationSourceTreeStatus({ repoRoot: fixture.repoRoot })).toEqual({ sourceTreeClean: false });
  } finally {
    rmSync(fixture.repoRoot, { recursive: true, force: true });
  }
});

test('verification CLI rejects an untracked migration in the approval source tree', () => {
  const fixture = createCommittedActivationCliFixture('activation-preflight-untracked-');
  const evidencePath = join(fixture.repoRoot, 'ready.json');
  const report = {
    ...evaluateActivationReadiness(readyInventory(), new Date().toISOString()),
    targetHost: 'example.supabase.co',
    accessMethod: 'postgrest_and_auth_admin_service_role_read_only',
  };
  const evidence = sealActivationPreflightEvidence(report, {
    sourceCommit: fixture.sourceCommit,
    scriptSha256: fixture.scriptSha256,
    sourceTreeClean: true,
    runId: 'activation-untracked-1',
    keyId: 'activation-audit-2026-08-v1',
  }, 'test-activation-audit-key-32-bytes-minimum');
  writeFileSync(evidencePath, `${JSON.stringify(evidence)}\n`, 'utf8');
  const migrationDirectory = join(fixture.repoRoot, 'supabase', 'migrations');
  mkdirSync(migrationDirectory, { recursive: true });
  writeFileSync(join(migrationDirectory, 'unapproved.sql'), 'select 1;\n', 'utf8');

  try {
    const result = spawnSync(process.execPath, [
      fixture.modulePath,
      '--verify-evidence', evidencePath,
      '--expected-host', 'example.supabase.co',
    ], {
      cwd: fixture.repoRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        GITHUB_SHA: fixture.sourceCommit,
        ACTIVATION_PREFLIGHT_AUDIT_HMAC_KEY: 'test-activation-audit-key-32-bytes-minimum',
        ACTIVATION_PREFLIGHT_AUDIT_KEY_ID: 'activation-audit-2026-08-v1',
      },
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('activation evidence source tree is not clean');
    expect(result.stderr).not.toContain('unapproved.sql');
  } finally {
    rmSync(fixture.repoRoot, { recursive: true, force: true });
  }
});

test('verification CLI rejects a workflow SHA that differs from the actual checkout HEAD', () => {
  const fixture = createCommittedActivationCliFixture('activation-preflight-head-');
  const evidencePath = join(fixture.repoRoot, 'stale-checkout.json');
  const staleCommit = 'c'.repeat(40);
  const report = {
    ...evaluateActivationReadiness(readyInventory(), new Date().toISOString()),
    targetHost: 'example.supabase.co',
    accessMethod: 'postgrest_and_auth_admin_service_role_read_only',
  };
  const evidence = sealActivationPreflightEvidence(report, {
    sourceCommit: staleCommit,
    scriptSha256: fixture.scriptSha256,
    sourceTreeClean: true,
    runId: 'activation-stale-checkout-1',
    keyId: 'activation-audit-2026-08-v1',
  }, 'test-activation-audit-key-32-bytes-minimum');
  writeFileSync(evidencePath, `${JSON.stringify(evidence)}\n`, 'utf8');

  try {
    const result = spawnSync(process.execPath, [
      fixture.modulePath,
      '--verify-evidence', evidencePath,
      '--expected-host', 'example.supabase.co',
    ], {
      cwd: fixture.repoRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        GITHUB_SHA: staleCommit,
        ACTIVATION_PREFLIGHT_AUDIT_HMAC_KEY: 'test-activation-audit-key-32-bytes-minimum',
        ACTIVATION_PREFLIGHT_AUDIT_KEY_ID: 'activation-audit-2026-08-v1',
      },
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('activation evidence checkout does not match workflow commit');
  } finally {
    rmSync(fixture.repoRoot, { recursive: true, force: true });
  }
});

test('verification CLI does not echo malformed evidence or the trusted key', () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), 'activation-preflight-malformed-'));
  const evidencePath = join(temporaryDirectory, 'malformed.json');
  const modulePath = fileURLToPath(new URL('../platform-activation-preflight.mjs', import.meta.url));
  writeFileSync(evidencePath, '{"secret":"malformed-sensitive-value"', 'utf8');

  try {
    const result = spawnSync(process.execPath, [
      modulePath,
      '--verify-evidence', evidencePath,
      '--expected-host', 'example.supabase.co',
    ], {
      encoding: 'utf8',
      env: {
        ...process.env,
        SUPABASE_URL: '',
        SUPABASE_SERVICE_ROLE_KEY: '',
        SUPABASE_SERVICE_ROLE: '',
        ACTIVATION_PREFLIGHT_AUDIT_HMAC_KEY: 'test-activation-audit-key-32-bytes-minimum',
        ACTIVATION_PREFLIGHT_AUDIT_KEY_ID: 'activation-audit-2026-08-v1',
      },
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('activation evidence file could not be parsed');
    expect(result.stderr).not.toContain('malformed-sensitive-value');
    expect(result.stderr).not.toContain('test-activation-audit-key-32-bytes-minimum');
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});
