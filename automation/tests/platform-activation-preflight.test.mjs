import { expect, test } from 'vitest';
import {
  evaluateActivationReadiness,
  runActivationPreflight,
  runActivationPreflightCli,
} from '../platform-activation-preflight.mjs';

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
  const fixtures = readyFixtures();
  const client = makeReadOnlyClient(fixtures);
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
    },
    createClient,
    checkedAt: '2026-08-11T07:00:00.000Z',
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
    accessMethod: 'postgrest_and_auth_admin_service_role_read_only',
  });
  expect(output[0]).not.toContain('test-service-role-secret');
  expect(output[0]).not.toContain('user-admin');
});

test('CLI returns a distinct nonzero code when activation is not ready', async () => {
  const fixtures = Object.fromEntries(REQUIRED_TABLES.map((table) => [table, []]));
  fixtures.org = [];
  fixtures.membership = [];
  const output = [];

  const exitCode = await runActivationPreflightCli({
    environment: {
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_SERVICE_ROLE: 'test-service-role-secret',
    },
    createClient: () => makeReadOnlyClient(fixtures),
    checkedAt: '2026-08-11T07:00:00.000Z',
    stdout: (line) => output.push(line),
  });

  expect(exitCode).toBe(2);
  expect(JSON.parse(output[0])).toMatchObject({
    status: 'not_ready',
    blockers: [{ code: 'no_active_organization', count: 1 }],
  });
});

test('CLI emits a sanitized not-verified report when read access is unavailable', async () => {
  const output = [];

  const exitCode = await runActivationPreflightCli({
    environment: {
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-secret',
    },
    createClient: () => makeReadOnlyClient({}, 'membership'),
    checkedAt: '2026-08-11T07:00:00.000Z',
    stdout: (line) => output.push(line),
  });

  expect(exitCode).toBe(2);
  expect(JSON.parse(output[0])).toEqual({
    schemaVersion: 1,
    status: 'not_verified',
    checkedAt: '2026-08-11T07:00:00.000Z',
    targetHost: 'example.supabase.co',
    accessMethod: 'postgrest_and_auth_admin_service_role_read_only',
    databaseMutationExecuted: false,
    evidenceComplete: false,
    readConsistency: 'multi_request',
    requiresImmediateRecheckBeforeActivation: true,
    blockers: [{ code: 'read_access_unavailable', resource: 'membership' }],
  });
  expect(output[0]).not.toContain('secret-row-value');
  expect(output[0]).not.toContain('test-service-role-secret');
});
