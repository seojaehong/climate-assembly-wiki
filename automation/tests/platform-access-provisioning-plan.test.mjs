import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import {
  ORGANIZATION_ACCESS_PLAN_CONTRACT,
  buildOrganizationAccessProvisioningPlan,
  provisioningPlanChecksum,
  runOrganizationAccessProvisioningCli,
  validateOrganizationAccessPlan,
  verifyOrganizationAccessProvisioningPlan,
} from '../platform-access-provisioning-plan.mjs';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const modulePath = fileURLToPath(new URL('../platform-access-provisioning-plan.mjs', import.meta.url));

function accessPlan() {
  return {
    schemaVersion: 1,
    kind: 'platform-organization-access-plan',
    organization: {
      id: '11111111-1111-4111-8111-111111111111',
      label: '기후 시민회의',
    },
    invitations: [{ email: 'staff@example.invalid', role: 'org_admin' }],
    memberships: [{ userId: '22222222-2222-4222-8222-222222222222', role: 'hq' }],
    dryRun: true,
    authAccountsCreated: false,
    invitationsSent: false,
    databaseMutationExecuted: false,
    requiresApproval: true,
  };
}

function sourceBytes(value = accessPlan()) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

test('shares the exact browser access-plan schema and role contract', () => {
  const tracked = JSON.parse(readFileSync(
    join(repoRoot, 'src', 'islands', 'platform', 'access', 'access-plan-contract.json'),
    'utf8',
  ));
  expect(ORGANIZATION_ACCESS_PLAN_CONTRACT).toEqual(tracked);
  expect(ORGANIZATION_ACCESS_PLAN_CONTRACT.roles).toEqual([
    'org_admin', 'operator', 'hq', 'facilitator',
  ]);
  expect(ORGANIZATION_ACCESS_PLAN_CONTRACT.maxBytes).toBe(256 * 1024);
});

test('keeps the CLI scripts and browser contract in the Linux test workflow', () => {
  const packageJson = JSON.parse(readFileSync(join(repoRoot, 'automation', 'package.json'), 'utf8'));
  const workflow = readFileSync(join(repoRoot, '.github', 'workflows', 'test.yml'), 'utf8');

  expect(packageJson.scripts['plan:platform-access-provisioning']).toBe(
    'node platform-access-provisioning-plan.mjs',
  );
  expect(packageJson.scripts['verify:platform-access-provisioning']).toBe(
    'node platform-access-provisioning-plan.mjs --verify',
  );
  expect(workflow).toContain("- 'src/islands/platform/access/**'");
  expect(workflow).toContain('src/islands/platform/access/access-plan-logic.test.ts');
});

test('builds deterministic invitation and membership operations without executing them', () => {
  const source = accessPlan();
  const bytes = sourceBytes(source);
  const plan = buildOrganizationAccessProvisioningPlan(source, bytes);

  expect(plan).toMatchObject({
    schemaVersion: 1,
    planKind: 'platform_access_provisioning_plan',
    organization: source.organization,
    summary: { invitationCount: 1, membershipCount: 1, operationCount: 2 },
    executionPolicy: {
      stableOperationIdsRequired: true,
      lookupBeforeMutationRequired: true,
      stopOnFailure: true,
      auditReceiptRequired: true,
      partialSuccessRequiresReconciliation: true,
    },
    dryRun: true,
    authAccountsCreated: false,
    invitationsSent: false,
    databaseMutationExecuted: false,
    requiresApproval: true,
  });
  expect(plan.operations).toEqual([
    expect.objectContaining({
      type: 'invite_and_assign_role',
      organizationId: source.organization.id,
      email: 'staff@example.invalid',
      role: 'org_admin',
      operationId: expect.stringMatching(/^[0-9a-f]{64}$/),
    }),
    expect.objectContaining({
      type: 'assign_existing_user_role',
      organizationId: source.organization.id,
      userId: '22222222-2222-4222-8222-222222222222',
      role: 'hq',
      operationId: expect.stringMatching(/^[0-9a-f]{64}$/),
    }),
  ]);
  expect(buildOrganizationAccessProvisioningPlan(source, bytes)).toEqual(plan);
});

test('binds the exact source bytes and verifies the reconstructed plan', () => {
  const source = accessPlan();
  const bytes = sourceBytes(source);
  const plan = buildOrganizationAccessProvisioningPlan(source, bytes);
  const whitespaceChanged = Buffer.from(JSON.stringify(source), 'utf8');

  expect(verifyOrganizationAccessProvisioningPlan(plan, source, bytes)).toEqual({
    status: 'verified',
    checksum: plan.checksum,
    invitationCount: 1,
    membershipCount: 1,
    operationCount: 2,
    databaseMutationExecuted: false,
  });
  expect(() => verifyOrganizationAccessProvisioningPlan(plan, source, whitespaceChanged)).toThrow(
    'does not match its source',
  );
});

test('rejects checksum tampering and a self-resealed operation change', () => {
  const source = accessPlan();
  const bytes = sourceBytes(source);
  const tampered = structuredClone(buildOrganizationAccessProvisioningPlan(source, bytes));
  tampered.operations.reverse();
  expect(() => verifyOrganizationAccessProvisioningPlan(tampered, source, bytes)).toThrow(
    'checksum verification failed',
  );
  tampered.checksum = provisioningPlanChecksum(tampered);
  expect(() => verifyOrganizationAccessProvisioningPlan(tampered, source, bytes)).toThrow(
    'does not match its source',
  );
});

test('rejects noncanonical, duplicate, empty, or mutation-marked access plans', () => {
  const valid = accessPlan();
  expect(() => validateOrganizationAccessPlan({ ...valid, invitationsSent: true })).toThrow(
    'Organization access plan is invalid',
  );
  expect(() => validateOrganizationAccessPlan({
    ...valid,
    invitations: [{ email: 'Staff@Example.Invalid', role: 'org_admin' }],
  })).toThrow('Organization access plan is invalid');
  expect(() => validateOrganizationAccessPlan({
    ...valid,
    invitations: [...valid.invitations, ...valid.invitations],
  })).toThrow('Organization access plan is invalid');
  expect(() => validateOrganizationAccessPlan({ ...valid, invitations: [], memberships: [] })).toThrow(
    'Organization access plan is invalid',
  );
});

test('creates and verifies a plan outside the repository and refuses overwrite', () => {
  const directory = mkdtempSync(join(tmpdir(), 'access-provisioning-'));
  const sourcePath = join(directory, 'access-plan.json');
  const outputPath = join(directory, 'provisioning-plan.json');
  writeFileSync(sourcePath, sourceBytes());
  try {
    expect(runOrganizationAccessProvisioningCli([
      '--source', sourcePath, '--output', outputPath,
    ])).toMatchObject({ status: 'written', operationCount: 2, databaseMutationExecuted: false });
    expect(() => runOrganizationAccessProvisioningCli([
      '--source', sourcePath, '--output', outputPath,
    ])).toThrow('use --force');
    expect(runOrganizationAccessProvisioningCli([
      '--source', sourcePath, '--verify', outputPath,
    ])).toMatchObject({ status: 'verified', operationCount: 2, databaseMutationExecuted: false });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('rejects access or provisioning files located inside the repository', () => {
  const directory = mkdtempSync(join(tmpdir(), 'access-provisioning-output-'));
  const outputPath = join(directory, 'provisioning-plan.json');
  try {
    expect(() => runOrganizationAccessProvisioningCli([
      '--source', join(repoRoot, 'package.json'), '--output', outputPath,
    ])).toThrow('must remain outside the repository');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('CLI keeps emails, user IDs, and credentials out of stdout and errors', () => {
  const directory = mkdtempSync(join(tmpdir(), 'access-provisioning-private-'));
  const sourcePath = join(directory, 'access-plan.json');
  const outputPath = join(directory, 'provisioning-plan.json');
  writeFileSync(sourcePath, sourceBytes());
  try {
    const result = spawnSync(process.execPath, [
      modulePath, '--source', sourcePath, '--output', outputPath,
    ], {
      cwd: repoRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        SUPABASE_SERVICE_ROLE_KEY: 'secret-that-must-not-appear',
      },
    });
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ status: 'written', operationCount: 2 });
    expect(`${result.stdout}${result.stderr}`).not.toContain('staff@example.invalid');
    expect(`${result.stdout}${result.stderr}`).not.toContain('22222222-2222-4222-8222-222222222222');
    expect(`${result.stdout}${result.stderr}`).not.toContain('secret-that-must-not-appear');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('malformed semantic content is rejected without echoing its value', () => {
  const directory = mkdtempSync(join(tmpdir(), 'access-provisioning-malformed-'));
  const sourcePath = join(directory, 'access-plan.json');
  const outputPath = join(directory, 'provisioning-plan.json');
  const malformed = accessPlan();
  malformed.invitations[0].role = 'private-secret-role';
  writeFileSync(sourcePath, sourceBytes(malformed));
  try {
    const result = spawnSync(process.execPath, [
      modulePath, '--source', sourcePath, '--output', outputPath,
    ], { cwd: repoRoot, encoding: 'utf8' });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Organization access plan is invalid');
    expect(result.stderr).not.toContain('private-secret-role');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
