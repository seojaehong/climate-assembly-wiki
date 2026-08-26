import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import {
  ORGANIZATION_ACCESS_PLAN_CONTRACT,
  buildOrganizationAccessProvisioningPlan,
  executeOrganizationAccessProvisioningPlan,
  provisioningPlanChecksum,
  runOrganizationAccessProvisioningCli,
  sealOrganizationAccessProvisioningApproval,
  validateOrganizationAccessPlan,
  verifyOrganizationAccessProvisioningApproval,
  verifyOrganizationAccessProvisioningExecutionReceipt,
  verifyOrganizationAccessProvisioningPlan,
} from '../platform-access-provisioning-plan.mjs';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const modulePath = fileURLToPath(new URL('../platform-access-provisioning-plan.mjs', import.meta.url));
const approvalKey = 'test-provisioning-approval-key-32-bytes-minimum';
const approvalKeyId = 'access-provisioning-2026-08-v1';
const approvedAt = '2026-08-17T02:00:00.000Z';
const expiresAt = '2026-08-17T02:15:00.000Z';

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalValue(value[key])]));
  }
  return value;
}

const trackedAccessPlanContract = JSON.parse(readFileSync(
  join(repoRoot, 'src', 'islands', 'platform', 'access', 'access-plan-contract.json'),
  'utf8',
));
const ACCESS_PLAN_CONTRACT_SHA256 = createHash('sha256')
  .update(JSON.stringify(canonicalValue(trackedAccessPlanContract)))
  .digest('hex');

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

function approvalFor(plan) {
  return sealOrganizationAccessProvisioningApproval(plan, {
    approvalId: '33333333-3333-4333-8333-333333333333',
    approvedBy: 'auth-user:44444444-4444-4444-8444-444444444444',
    approvedAt,
    expiresAt,
    keyId: approvalKeyId,
  }, approvalKey);
}

function executionAdapter(overrides = {}) {
  return {
    capabilities: {
      stableOperationLookup: true,
      idempotentApply: true,
      automaticMutationRetry: false,
      receiptPersistence: true,
    },
    lookupOperation: async (operation) => ({ status: 'absent', operationId: operation.operationId }),
    applyOperation: async (operation) => ({ status: 'applied', operationId: operation.operationId }),
    persistReceipt: async () => {},
    ...overrides,
  };
}

test('shares the exact browser access-plan schema and role contract', () => {
  expect(ORGANIZATION_ACCESS_PLAN_CONTRACT).toEqual(trackedAccessPlanContract);
  expect(ORGANIZATION_ACCESS_PLAN_CONTRACT.roles).toEqual([
    'org_admin', 'operator', 'hq', 'facilitator',
  ]);
  expect(ORGANIZATION_ACCESS_PLAN_CONTRACT.maxBytes).toBe(256 * 1024);
});

test('keeps the CLI scripts and browser contract in the Linux test workflow', () => {
  const packageJson = JSON.parse(readFileSync(join(repoRoot, 'automation', 'package.json'), 'utf8'));
  const workflow = readFileSync(join(repoRoot, '.github', 'workflows', 'test.yml'), 'utf8');
  const source = readFileSync(modulePath, 'utf8');

  expect(packageJson.scripts['plan:platform-access-provisioning']).toBe(
    'node platform-access-provisioning-plan.mjs',
  );
  expect(packageJson.scripts['verify:platform-access-provisioning']).toBe(
    'node platform-access-provisioning-plan.mjs --verify',
  );
  expect(workflow).toContain("- 'src/islands/platform/access/**'");
  expect(workflow).toContain('src/islands/platform/access/access-plan-logic.test.ts');
  expect(Object.keys(packageJson.scripts).some((name) => /apply.*access|access.*apply/.test(name))).toBe(false);
  expect(source).not.toContain('@supabase/supabase-js');
  expect(source).not.toContain('createClient(');
});

test('builds deterministic invitation and membership operations without executing them', () => {
  const source = accessPlan();
  const bytes = sourceBytes(source);
  const plan = buildOrganizationAccessProvisioningPlan(source, bytes);

  expect(plan).toMatchObject({
    schemaVersion: 2,
    planKind: 'platform_access_provisioning_plan',
    accessPlanContract: {
      schemaVersion: 1,
      canonicalSha256: ACCESS_PLAN_CONTRACT_SHA256,
    },
    organization: source.organization,
    summary: { invitationCount: 1, membershipCount: 1, operationCount: 2 },
    executionPolicy: {
      stableOperationIdsRequired: true,
      lookupBeforeMutationRequired: true,
      stopOnFailure: true,
      auditReceiptRequired: true,
      partialSuccessRequiresReconciliation: true,
      signedApprovalRequired: true,
      approvalMaxAgeSeconds: 900,
      nonSensitiveReceiptRequired: true,
      automaticMutationRetryAllowed: false,
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

test('rejects a self-resealed forged contract identity and legacy provisioning plan schema', () => {
  const source = accessPlan();
  const bytes = sourceBytes(source);
  const plan = buildOrganizationAccessProvisioningPlan(source, bytes);

  const forged = structuredClone(plan);
  forged.accessPlanContract.canonicalSha256 = 'b'.repeat(64);
  forged.checksum = provisioningPlanChecksum(forged);
  expect(() => verifyOrganizationAccessProvisioningPlan(forged, source, bytes)).toThrow(
    'does not match its source',
  );

  const legacy = structuredClone(plan);
  delete legacy.accessPlanContract;
  legacy.schemaVersion = 1;
  legacy.checksum = provisioningPlanChecksum(legacy);
  expect(() => verifyOrganizationAccessProvisioningPlan(legacy, source, bytes)).toThrow(
    'provisioning plan is invalid',
  );
});

test('seals a short-lived approval to the exact plan and trusted key', () => {
  const source = accessPlan();
  const bytes = sourceBytes(source);
  const plan = buildOrganizationAccessProvisioningPlan(source, bytes);
  const approval = approvalFor(plan);

  expect(verifyOrganizationAccessProvisioningApproval(approval, plan, {
    trustedKey: approvalKey,
    expectedKeyId: approvalKeyId,
    now: new Date('2026-08-17T02:10:00.000Z'),
  })).toEqual({
    approvalId: '33333333-3333-4333-8333-333333333333',
    keyId: approvalKeyId,
    planChecksum: plan.checksum,
  });
  expect(() => verifyOrganizationAccessProvisioningApproval(
    { ...approval, approvedBy: 'auth-user:55555555-5555-4555-8555-555555555555' },
    plan,
    {
      trustedKey: approvalKey,
      expectedKeyId: approvalKeyId,
      now: new Date('2026-08-17T02:10:00.000Z'),
    },
  )).toThrow('integrity verification failed');
  expect(() => verifyOrganizationAccessProvisioningApproval(approval, plan, {
    trustedKey: approvalKey,
    expectedKeyId: approvalKeyId,
    now: new Date('2026-08-17T02:16:00.000Z'),
  })).toThrow('expired or not yet valid');
  expect(() => sealOrganizationAccessProvisioningApproval(plan, {
    approvalId: '33333333-3333-4333-8333-333333333333',
    approvedBy: 'auth-user:44444444-4444-4444-8444-444444444444',
    approvedAt,
    expiresAt: '2026-08-17T02:15:01.000Z',
    keyId: approvalKeyId,
  }, approvalKey)).toThrow('approval time is invalid');
});

test('executes sequential idempotent operations and persists a non-sensitive receipt', async () => {
  const source = accessPlan();
  const bytes = sourceBytes(source);
  const plan = buildOrganizationAccessProvisioningPlan(source, bytes);
  const applied = [];
  const persisted = [];
  const receipt = await executeOrganizationAccessProvisioningPlan({
    plan,
    accessPlan: source,
    sourceBytes: bytes,
    approval: approvalFor(plan),
    trustedKey: approvalKey,
    expectedKeyId: approvalKeyId,
    runId: '66666666-6666-4666-8666-666666666666',
    adapter: executionAdapter({
      applyOperation: async (operation) => {
        applied.push(operation.operationId);
        return { status: 'applied', operationId: operation.operationId };
      },
      persistReceipt: async (value) => { persisted.push(value); },
    }),
    clock: () => new Date('2026-08-17T02:10:00.000Z'),
  });

  expect(applied).toHaveLength(2);
  expect(persisted).toEqual([receipt]);
  expect(receipt).toMatchObject({
    status: 'completed',
    summary: {
      operationCount: 2,
      appliedCount: 2,
      alreadyAppliedCount: 0,
      reconciledCount: 0,
      failedCount: 0,
      pendingCount: 0,
      mutationAttemptedCount: 2,
    },
    containsSensitiveValues: false,
    clockRollbackDetected: false,
  });
  expect(receipt.operations.map((operation) => operation.status)).toEqual(['applied', 'applied']);
  expect(verifyOrganizationAccessProvisioningExecutionReceipt(receipt, {
    trustedKey: approvalKey,
    expectedKeyId: approvalKeyId,
    expectedPlanChecksum: plan.checksum,
  })).toEqual({
    status: 'verified',
    executionStatus: 'completed',
    planChecksum: plan.checksum,
    approvalId: '33333333-3333-4333-8333-333333333333',
    runId: '66666666-6666-4666-8666-666666666666',
    operationCount: 2,
  });
  expect(() => verifyOrganizationAccessProvisioningExecutionReceipt({
    ...receipt,
    operations: receipt.operations.map((operation, index) => (
      index === 0 ? { ...operation, type: 'assign_existing_user_role' } : operation
    )),
  }, {
    trustedKey: approvalKey,
    expectedKeyId: approvalKeyId,
    expectedPlanChecksum: plan.checksum,
  })).toThrow('integrity verification failed');
  expect(JSON.stringify(receipt)).not.toContain('staff@example.invalid');
  expect(JSON.stringify(receipt)).not.toContain('22222222-2222-4222-8222-222222222222');
});

test('reconciles a committed mutation after response loss without retrying apply', async () => {
  const source = { ...accessPlan(), memberships: [] };
  const bytes = sourceBytes(source);
  const plan = buildOrganizationAccessProvisioningPlan(source, bytes);
  let state = 'absent';
  let applyCalls = 0;
  const receipt = await executeOrganizationAccessProvisioningPlan({
    plan,
    accessPlan: source,
    sourceBytes: bytes,
    approval: approvalFor(plan),
    trustedKey: approvalKey,
    expectedKeyId: approvalKeyId,
    runId: '77777777-7777-4777-8777-777777777777',
    adapter: executionAdapter({
      lookupOperation: async (operation) => ({ status: state, operationId: operation.operationId }),
      applyOperation: async () => {
        applyCalls += 1;
        state = 'applied';
        throw new Error('synthetic response loss');
      },
    }),
    clock: () => new Date('2026-08-17T02:10:00.000Z'),
  });

  expect(applyCalls).toBe(1);
  expect(receipt.status).toBe('completed');
  expect(receipt.operations[0]).toMatchObject({ status: 'reconciled', mutationAttempted: true });
});

test('treats an exact prior operation as already applied without another mutation', async () => {
  const source = { ...accessPlan(), memberships: [] };
  const bytes = sourceBytes(source);
  const plan = buildOrganizationAccessProvisioningPlan(source, bytes);
  let applyCalls = 0;
  const receipt = await executeOrganizationAccessProvisioningPlan({
    plan,
    accessPlan: source,
    sourceBytes: bytes,
    approval: approvalFor(plan),
    trustedKey: approvalKey,
    expectedKeyId: approvalKeyId,
    runId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    adapter: executionAdapter({
      lookupOperation: async (operation) => ({ status: 'applied', operationId: operation.operationId }),
      applyOperation: async (operation) => {
        applyCalls += 1;
        return { status: 'applied', operationId: operation.operationId };
      },
    }),
    clock: () => new Date('2026-08-17T02:10:00.000Z'),
  });

  expect(applyCalls).toBe(0);
  expect(receipt).toMatchObject({
    status: 'completed',
    summary: { alreadyAppliedCount: 1, mutationAttemptedCount: 0 },
  });
});

test('does not retry an unresolved mutation and stops the remaining plan', async () => {
  const source = accessPlan();
  const bytes = sourceBytes(source);
  const plan = buildOrganizationAccessProvisioningPlan(source, bytes);
  let applyCalls = 0;
  const receipt = await executeOrganizationAccessProvisioningPlan({
    plan,
    accessPlan: source,
    sourceBytes: bytes,
    approval: approvalFor(plan),
    trustedKey: approvalKey,
    expectedKeyId: approvalKeyId,
    runId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    adapter: executionAdapter({
      applyOperation: async () => {
        applyCalls += 1;
        throw new Error('synthetic unresolved response loss');
      },
    }),
    clock: () => new Date('2026-08-17T02:10:00.000Z'),
  });

  expect(applyCalls).toBe(1);
  expect(receipt.status).toBe('failed');
  expect(receipt.operations).toEqual([
    expect.objectContaining({ status: 'failed', reason: 'apply_outcome_unresolved' }),
    expect.objectContaining({ status: 'pending', reason: 'stopped_after_failure' }),
  ]);
});

test('stops after a conflict and records later operations as pending', async () => {
  const source = accessPlan();
  const bytes = sourceBytes(source);
  const plan = buildOrganizationAccessProvisioningPlan(source, bytes);
  let applyCalls = 0;
  const receipt = await executeOrganizationAccessProvisioningPlan({
    plan,
    accessPlan: source,
    sourceBytes: bytes,
    approval: approvalFor(plan),
    trustedKey: approvalKey,
    expectedKeyId: approvalKeyId,
    runId: '88888888-8888-4888-8888-888888888888',
    adapter: executionAdapter({
      lookupOperation: async (operation) => ({ status: 'conflict', operationId: operation.operationId }),
      applyOperation: async (operation) => {
        applyCalls += 1;
        return { status: 'applied', operationId: operation.operationId };
      },
    }),
    clock: () => new Date('2026-08-17T02:10:00.000Z'),
  });

  expect(applyCalls).toBe(0);
  expect(receipt.status).toBe('failed');
  expect(receipt.operations).toEqual([
    expect.objectContaining({ status: 'failed', reason: 'operation_conflict' }),
    expect.objectContaining({ status: 'pending', reason: 'stopped_after_failure' }),
  ]);
});

test('rejects unsafe adapters before lookup and propagates receipt persistence failure', async () => {
  const source = { ...accessPlan(), memberships: [] };
  const bytes = sourceBytes(source);
  const plan = buildOrganizationAccessProvisioningPlan(source, bytes);
  const common = {
    plan,
    accessPlan: source,
    sourceBytes: bytes,
    approval: approvalFor(plan),
    trustedKey: approvalKey,
    expectedKeyId: approvalKeyId,
    runId: '99999999-9999-4999-8999-999999999999',
    clock: () => new Date('2026-08-17T02:10:00.000Z'),
  };

  await expect(executeOrganizationAccessProvisioningPlan({
    ...common,
    adapter: executionAdapter({
      capabilities: {
        stableOperationLookup: true,
        idempotentApply: false,
        automaticMutationRetry: false,
        receiptPersistence: true,
      },
    }),
  })).rejects.toThrow('execution adapter is unsafe');
  await expect(executeOrganizationAccessProvisioningPlan({
    ...common,
    adapter: executionAdapter({
      capabilities: {
        stableOperationLookup: true,
        idempotentApply: true,
        automaticMutationRetry: true,
        receiptPersistence: true,
      },
    }),
  })).rejects.toThrow('execution adapter is unsafe');
  await expect(executeOrganizationAccessProvisioningPlan({
    ...common,
    adapter: executionAdapter({
      persistReceipt: async () => { throw new Error('synthetic receipt failure'); },
    }),
  })).rejects.toThrow('receipt could not be persisted');
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
