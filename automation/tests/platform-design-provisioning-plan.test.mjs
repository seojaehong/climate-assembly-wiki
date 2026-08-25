import { spawn, spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { expect, test } from 'vitest';
import {
  DESIGN_BLUEPRINT_CONTRACT,
  DESIGN_PROVISIONING_BLOCKERS,
  buildDesignProvisioningPlan,
  claimDesignProvisioningExecutionApproval,
  createInMemoryDesignProvisioningAuthorizationAdapter,
  createInMemoryDesignProvisioningReceiptAdapter,
  designProvisioningPlanChecksum,
  executeDesignProvisioningApprovalLifecycle,
  finalizeDesignProvisioningExecutionApproval,
  reconcileDesignProvisioningApprovalLifecycle,
  runDesignProvisioningCli,
  sealDesignProvisioningExecutionApproval,
  sealDesignProvisioningExecutionReceipt,
  validateDesignBlueprint,
  verifyDesignProvisioningExecutionApproval,
  verifyDesignProvisioningExecutionReceipt,
  verifyDesignProvisioningPlan,
} from '../platform-design-provisioning-plan.mjs';
import {
  auditLocalDesignProvisioningRehearsalStore,
  createLocalDesignProvisioningAuthorizationAdapter,
  createLocalDesignProvisioningReceiptAdapter,
  initializeLocalDesignProvisioningRehearsalStore,
  LOCAL_DESIGN_PROVISIONING_STORE_BOUNDARIES,
  replaceLocalDesignProvisioningAuthorizationContext,
  revokeLocalDesignProvisioningAuthorization,
  sealLocalDesignProvisioningRehearsalStoreCheckpoint,
} from '../platform-design-provisioning-durable-store.mjs';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const modulePath = fileURLToPath(new URL('../platform-design-provisioning-plan.mjs', import.meta.url));
const durableStoreModulePath = fileURLToPath(
  new URL('../platform-design-provisioning-durable-store.mjs', import.meta.url),
);

function blueprint() {
  return {
    schemaVersion: 4,
    kind: 'platform-design-blueprint',
    dryRun: true,
    databaseMutationExecuted: false,
    requiresApproval: true,
    assembly: {
      title: '기후 공론화 2026',
      slug: 'climate-2026',
      purpose: '감축과 적응의 실행 조건을 시민과 함께 검토한다.',
      mode: 'vote',
      config: { readiness: ['topics_open', 'teams_active'] },
    },
    sessions: [
      {
        ordinal: 1,
        title: '감축 숙의',
        slug: 'mitigation-session',
        heldOn: '2026-09-12',
        topics: [{ ordinal: 1, prompt: '감축 경로' }],
        teams: [{ ordinal: 1, name: '1조', plannedCapacity: 12 }],
      },
      {
        ordinal: 2,
        title: '적응 숙의',
        slug: 'adaptation-session',
        heldOn: '2026-09-13',
        topics: [{ ordinal: 1, prompt: '적응 정책' }],
        teams: [{ ordinal: 1, name: '1조', plannedCapacity: 10 }],
      },
    ],
    stats: { sessionCount: 2, topicCount: 2, teamCount: 2, participantCount: 22 },
  };
}

function sourceBytes(value = blueprint()) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

const approvalKey = 'test-design-provisioning-approval-key-32-bytes';
const approvalKeyId = 'design-provisioning-2026-08-v1';
const approvedAt = '2026-08-25T13:00:00.000Z';
const expiresAt = '2026-08-25T13:15:00.000Z';

function approvalMetadata(overrides = {}) {
  return {
    approvalId: '33333333-3333-4333-8333-333333333333',
    executionId: '44444444-4444-4444-8444-444444444444',
    organizationId: '22222222-2222-4222-8222-222222222222',
    targetHost: 'production-primary',
    approvedBy: 'auth-user:55555555-5555-4555-8555-555555555555',
    approvedRole: 'org_admin',
    approvedAt,
    expiresAt,
    keyId: approvalKeyId,
    ...overrides,
  };
}

function approvalState(overrides = {}) {
  return {
    approvalId: '33333333-3333-4333-8333-333333333333',
    revokedAt: null,
    claim: null,
    ...overrides,
  };
}

function liveContext(overrides = {}) {
  return {
    userId: 'auth-user:55555555-5555-4555-8555-555555555555',
    role: 'org_admin',
    organizationId: '22222222-2222-4222-8222-222222222222',
    targetHost: 'production-primary',
    membershipActive: true,
    organizationActive: true,
    ...overrides,
  };
}

function executionApproval(source = blueprint(), metadata = approvalMetadata()) {
  const bytes = sourceBytes(source);
  const plan = buildDesignProvisioningPlan(source, bytes);
  return {
    source,
    bytes,
    plan,
    approval: sealDesignProvisioningExecutionApproval(
      plan,
      source,
      bytes,
      metadata,
      approvalKey,
    ),
  };
}

function claimedApprovalState(approval, plan, claimedAt = '2026-08-25T13:05:00.000Z') {
  return approvalState({
    claim: {
      approvalId: approval.approvalId,
      executionId: approval.executionId,
      organizationId: approval.organizationId,
      targetHost: approval.targetHost,
      claimedBy: approval.approvedBy,
      claimedRole: approval.approvedRole,
      planChecksum: plan.checksum,
      status: 'claimed',
      claimedAt,
    },
  });
}

function executionPlanCandidate(plan) {
  const candidate = {
    ...structuredClone(plan),
    blockers: [],
    readyForExecution: true,
    serverContractImplemented: true,
    dryRun: false,
    requiresApproval: false,
  };
  return { ...candidate, checksum: designProvisioningPlanChecksum(candidate) };
}

function completedExecutionResult(executionPlan, operationStatus = 'applied') {
  return {
    status: 'completed',
    response: {
      schemaVersion: 1,
      planChecksum: executionPlan.checksum,
      operationCount: executionPlan.operations.length,
      operations: executionPlan.operations.map((operation, index) => ({
        operationId: operation.operationId,
        resourceId: `${String(index + 1).padStart(8, '0')}-0000-4000-8000-000000000000`,
        status: operationStatus,
        ...(operation.type === 'create_team' ? { joinCode: `${123450 + index}` } : {}),
      })),
    },
  };
}

function sequenceClock(...values) {
  let index = 0;
  return () => {
    if (index >= values.length) throw new Error('test clock exhausted');
    const value = values[index];
    index += 1;
    return new Date(value);
  };
}

function runNodeEval(source, args) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(
      process.execPath,
      ['--input-type=module', '--eval', source, ...args],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      if (stdout.length > 64 * 1024) child.kill();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
      if (stderr.length > 64 * 1024) child.kill();
    });
    child.on('error', rejectPromise);
    child.on('close', (code) => {
      if (code !== 0) {
        rejectPromise(new Error(`child process failed: ${stderr.trim() || 'unknown failure'}`));
        return;
      }
      try {
        resolvePromise(JSON.parse(stdout));
      } catch {
        rejectPromise(new Error('child process returned malformed output'));
      }
    });
  });
}

test('shares the exact browser blueprint contract', () => {
  const tracked = JSON.parse(readFileSync(
    join(repoRoot, 'src', 'islands', 'platform', 'design', 'design-blueprint-contract.json'),
    'utf8',
  ));
  expect(DESIGN_BLUEPRINT_CONTRACT).toEqual(tracked);
  expect(DESIGN_BLUEPRINT_CONTRACT.assemblyModes).toEqual(['consensus', 'vote']);
  expect(DESIGN_BLUEPRINT_CONTRACT.readinessChecks).toEqual([
    'topics_open', 'teams_active', 'roster_loaded',
  ]);
  expect(DESIGN_PROVISIONING_BLOCKERS).toEqual([
    'approval.production_apply_not_granted',
    'schema.design_provisioning_migration_not_applied',
    'server.design_provisioning_rpc_not_activated',
    'server.idempotent_operation_ledger_not_activated',
    'team.join_code_generation_not_activated',
  ]);
});

test('keeps the durable adapter outside the repository and explicitly rehearsal-only', async () => {
  expect(LOCAL_DESIGN_PROVISIONING_STORE_BOUNDARIES).toEqual({
    authorizationCas: 'immutable_hard_link_v1',
    localRehearsalOnly: true,
    productionAdapter: false,
    productionCredentialAccessed: false,
    databaseMutationExecuted: false,
    rpcMutationExecuted: false,
  });
  expect(() => initializeLocalDesignProvisioningRehearsalStore({
    directory: repoRoot,
    authorization: {
      approvalId: approvalMetadata().approvalId,
      context: liveContext(),
    },
  })).toThrow('outside the repository');
});

test('durably recovers an A4 receipt and terminal claim after adapter restart', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'a4-durable-store-'));
  const { source, bytes, plan, approval } = executionApproval();
  let executionCount = 0;
  try {
    await initializeLocalDesignProvisioningRehearsalStore({
      directory,
      authorization: { approvalId: approval.approvalId, context: liveContext() },
    });
    const first = await executeDesignProvisioningApprovalLifecycle({
      approval,
      plan,
      blueprint: source,
      sourceBytes: bytes,
      authorizationAdapter: createLocalDesignProvisioningAuthorizationAdapter({ directory }),
      receiptAdapter: createLocalDesignProvisioningReceiptAdapter({ directory }),
      executionAdapter: {
        async execute({ plan: executionPlan }) {
          executionCount += 1;
          return completedExecutionResult(executionPlan);
        },
      },
      trustedKey: approvalKey,
      expectedKeyId: approvalKeyId,
      clock: sequenceClock(
        '2026-08-25T13:05:00.000Z',
        '2026-08-25T13:06:00.000Z',
        '2026-08-25T13:07:00.000Z',
      ),
    });
    expect(first).toMatchObject({
      status: 'execution_completed',
      executionDisposition: 'executed',
      receiptDisposition: 'appended',
    });

    const restartedAuthorization = createLocalDesignProvisioningAuthorizationAdapter({ directory });
    const restartedReceipts = createLocalDesignProvisioningReceiptAdapter({ directory });
    const replay = await executeDesignProvisioningApprovalLifecycle({
      approval,
      plan,
      blueprint: source,
      sourceBytes: bytes,
      authorizationAdapter: restartedAuthorization,
      receiptAdapter: restartedReceipts,
      executionAdapter: {
        async execute() {
          executionCount += 1;
          throw new Error('durable replay must not execute the RPC');
        },
      },
      trustedKey: approvalKey,
      expectedKeyId: approvalKeyId,
      clock: () => new Date('2026-08-25T13:08:00.000Z'),
    });
    expect(replay).toMatchObject({
      status: 'execution_completed',
      executionDisposition: 'existing_receipt',
      receiptDisposition: 'existing',
    });
    expect(executionCount).toBe(1);
    expect((await restartedAuthorization.readSnapshot(approval.approvalId)).state.claim.status)
      .toBe('completed');
    const storedReceipt = await restartedReceipts.read(approval.executionId);
    expect(storedReceipt).toMatchObject({
      status: 'completed',
      approvalId: approval.approvalId,
      executionId: approval.executionId,
      containsSensitiveValues: false,
    });
    expect(JSON.stringify(storedReceipt)).not.toContain(approval.approvedBy);
    expect(storedReceipt.operations.every((operation) => (
      Object.keys(operation).sort().join(',') === 'operationId,status,type'
    ))).toBe(true);
    expect(await auditLocalDesignProvisioningRehearsalStore({ directory })).toMatchObject({
      status: 'verified',
      authorizationCount: 1,
      authorizationRecordCount: 3,
      activeClaimCount: 0,
      terminalClaimCount: 1,
      receiptCount: 1,
      completedReceiptCount: 1,
      failedReceiptCount: 0,
      containsSensitiveValues: false,
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('audits every durable authorization journal and receipt without exposing identifiers', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'a4-durable-store-'));
  const { source, bytes, plan, approval } = executionApproval();
  const secondApprovalId = '66666666-6666-4666-8666-666666666666';
  try {
    await initializeLocalDesignProvisioningRehearsalStore({
      directory,
      authorization: { approvalId: approval.approvalId, context: liveContext() },
    });
    await initializeLocalDesignProvisioningRehearsalStore({
      directory,
      authorization: { approvalId: secondApprovalId, context: liveContext() },
    });
    const authorizationAdapter = createLocalDesignProvisioningAuthorizationAdapter({ directory });
    const snapshot = await authorizationAdapter.readSnapshot(approval.approvalId);
    await authorizationAdapter.claim(snapshot, claimedApprovalState(approval, plan).claim);
    const receipt = sealDesignProvisioningExecutionReceipt({
      plan,
      blueprint: source,
      sourceBytes: bytes,
      approval,
      approvalState: claimedApprovalState(approval, plan),
      executionResult: completedExecutionResult(executionPlanCandidate(plan)),
      startedAt: '2026-08-25T13:05:00.000Z',
      completedAt: '2026-08-25T13:06:00.000Z',
      trustedKey: approvalKey,
      expectedKeyId: approvalKeyId,
    });
    await createLocalDesignProvisioningReceiptAdapter({ directory }).append(receipt);

    const audit = await auditLocalDesignProvisioningRehearsalStore({ directory });
    expect(audit).toEqual({
      schemaVersion: 1,
      kind: 'platform_design_provisioning_local_store_audit',
      status: 'verified',
      authorizationCount: 2,
      authorizationRecordCount: 3,
      unclaimedAuthorizationCount: 1,
      activeClaimCount: 1,
      terminalClaimCount: 0,
      revokedAuthorizationCount: 0,
      receiptCount: 1,
      completedReceiptCount: 1,
      failedReceiptCount: 0,
      orphanTemporaryFileCount: 0,
      containsSensitiveValues: false,
      catalogCompletenessVerified: false,
      checkpointFreshnessVerified: false,
      receiptSignatureVerified: false,
      ...LOCAL_DESIGN_PROVISIONING_STORE_BOUNDARIES,
    });
    const serialized = JSON.stringify(audit);
    expect(serialized).not.toContain(approval.approvalId);
    expect(serialized).not.toContain(secondApprovalId);
    expect(serialized).not.toContain(approval.executionId);
    expect(serialized).not.toContain(approval.approvedBy);
    expect(await auditLocalDesignProvisioningRehearsalStore({
      directory,
      trustedReceiptKey: approvalKey,
      expectedReceiptKeyId: approvalKeyId,
    })).toMatchObject({
      status: 'verified',
      receiptCount: 1,
      receiptSignatureVerified: true,
      containsSensitiveValues: false,
      productionCredentialAccessed: false,
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('seals and verifies an off-store inventory checkpoint without exposing store identifiers', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'a4-durable-store-'));
  const { source, bytes, plan, approval } = executionApproval();
  const firstApprovalId = approval.approvalId;
  const secondApprovalId = '66666666-6666-4666-8666-666666666666';
  const checkpointKeyId = 'a4-inventory-checkpoint-v1';
  const createdAt = '2026-08-25T13:10:00.000Z';
  const checkpointVerifiedAt = '2026-08-25T13:20:00.000Z';
  try {
    await initializeLocalDesignProvisioningRehearsalStore({
      directory,
      authorization: { approvalId: firstApprovalId, context: liveContext() },
    });
    await initializeLocalDesignProvisioningRehearsalStore({
      directory,
      authorization: { approvalId: secondApprovalId, context: liveContext() },
    });
    const authorizationAdapter = createLocalDesignProvisioningAuthorizationAdapter({ directory });
    const snapshot = await authorizationAdapter.readSnapshot(approval.approvalId);
    await authorizationAdapter.claim(snapshot, claimedApprovalState(approval, plan).claim);
    const receipt = sealDesignProvisioningExecutionReceipt({
      plan,
      blueprint: source,
      sourceBytes: bytes,
      approval,
      approvalState: claimedApprovalState(approval, plan),
      executionResult: completedExecutionResult(executionPlanCandidate(plan)),
      startedAt: '2026-08-25T13:05:00.000Z',
      completedAt: '2026-08-25T13:06:00.000Z',
      trustedKey: approvalKey,
      expectedKeyId: approvalKeyId,
    });
    const receiptAdapter = createLocalDesignProvisioningReceiptAdapter({ directory });
    await receiptAdapter.append(receipt);
    const legacyBackdatedCheckpoint = {
      schemaVersion: 1,
      kind: 'platform_design_provisioning_local_store_checkpoint',
      keyId: checkpointKeyId,
      createdAt: '2026-08-25T13:05:59.999Z',
      authorizationCount: 2,
      authorizationRecordCount: 3,
      receiptCount: 1,
      containsSensitiveValues: false,
      localRehearsalOnly: true,
      digest: '29877a122ae70d7e925973573720453e0cf69f12ae30ad7c409fa526138a520c',
    };
    await expect(sealLocalDesignProvisioningRehearsalStoreCheckpoint({
      directory,
      trustedCheckpointKey: approvalKey,
      checkpointKeyId,
      createdAt: '2026-08-25T13:05:59.999Z',
    })).rejects.toThrow('inventory checkpoint temporal verification failed');
    await expect(auditLocalDesignProvisioningRehearsalStore({
      directory,
      inventoryCheckpoint: legacyBackdatedCheckpoint,
      trustedCheckpointKey: approvalKey,
      expectedCheckpointKeyId: checkpointKeyId,
      checkpointVerifiedAt: '2026-08-25T13:06:00.000Z',
    })).rejects.toThrow('inventory checkpoint temporal verification failed');
    const checkpoint = await sealLocalDesignProvisioningRehearsalStoreCheckpoint({
      directory,
      trustedCheckpointKey: approvalKey,
      checkpointKeyId,
      createdAt,
    });
    expect(checkpoint).toEqual({
      schemaVersion: 1,
      kind: 'platform_design_provisioning_local_store_checkpoint',
      keyId: checkpointKeyId,
      createdAt,
      authorizationCount: 2,
      authorizationRecordCount: 3,
      receiptCount: 1,
      containsSensitiveValues: false,
      localRehearsalOnly: true,
      digest: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    const serialized = JSON.stringify(checkpoint);
    expect(serialized).not.toContain(firstApprovalId);
    expect(serialized).not.toContain(secondApprovalId);
    expect(serialized).not.toContain(approvalKey);
    expect(await auditLocalDesignProvisioningRehearsalStore({
      directory,
      inventoryCheckpoint: checkpoint,
      trustedCheckpointKey: approvalKey,
      expectedCheckpointKeyId: checkpointKeyId,
      checkpointVerifiedAt,
    })).toMatchObject({
      status: 'verified',
      catalogCompletenessVerified: true,
      checkpointFreshnessVerified: true,
      containsSensitiveValues: false,
    });
    const receiptPath = join(directory, 'receipts', `${approval.executionId}.json`);
    rmSync(receiptPath);
    await expect(auditLocalDesignProvisioningRehearsalStore({
      directory,
      inventoryCheckpoint: checkpoint,
      trustedCheckpointKey: approvalKey,
      expectedCheckpointKeyId: checkpointKeyId,
      checkpointVerifiedAt,
    })).rejects.toThrow('inventory checkpoint verification failed');
    await receiptAdapter.append(receipt);
    expect(await auditLocalDesignProvisioningRehearsalStore({
      directory,
      inventoryCheckpoint: checkpoint,
      trustedCheckpointKey: approvalKey,
      expectedCheckpointKeyId: checkpointKeyId,
      checkpointVerifiedAt,
    })).toMatchObject({ catalogCompletenessVerified: true });
    await expect(auditLocalDesignProvisioningRehearsalStore({
      directory,
      inventoryCheckpoint: checkpoint,
      trustedCheckpointKey: approvalKey,
      checkpointVerifiedAt,
    })).rejects.toThrow('inventory checkpoint configuration is invalid');
    await expect(auditLocalDesignProvisioningRehearsalStore({
      directory,
      inventoryCheckpoint: { ...checkpoint, digest: 'f'.repeat(64) },
      trustedCheckpointKey: approvalKey,
      expectedCheckpointKeyId: checkpointKeyId,
      checkpointVerifiedAt,
    })).rejects.toThrow('inventory checkpoint verification failed');
    await expect(auditLocalDesignProvisioningRehearsalStore({
      directory,
      inventoryCheckpoint: checkpoint,
      trustedCheckpointKey: approvalKey,
      expectedCheckpointKeyId: checkpointKeyId,
    })).rejects.toThrow('inventory checkpoint configuration is invalid');
    await expect(auditLocalDesignProvisioningRehearsalStore({
      directory,
      inventoryCheckpoint: checkpoint,
      trustedCheckpointKey: approvalKey,
      expectedCheckpointKeyId: checkpointKeyId,
      checkpointVerifiedAt: '2026-08-25T13:20:00.001Z',
    })).rejects.toThrow('inventory checkpoint freshness verification failed');
    await expect(auditLocalDesignProvisioningRehearsalStore({
      directory,
      inventoryCheckpoint: checkpoint,
      trustedCheckpointKey: approvalKey,
      expectedCheckpointKeyId: checkpointKeyId,
      checkpointVerifiedAt: '2026-08-25T13:09:59.999Z',
    })).rejects.toThrow('inventory checkpoint freshness verification failed');
    await expect(auditLocalDesignProvisioningRehearsalStore({
      directory,
      inventoryCheckpoint: checkpoint,
      trustedCheckpointKey: approvalKey,
      expectedCheckpointKeyId: checkpointKeyId,
      checkpointVerifiedAt,
      checkpointMaxAgeSeconds: 0,
    })).rejects.toThrow('inventory checkpoint configuration is invalid');
    await expect(auditLocalDesignProvisioningRehearsalStore({
      directory,
      checkpointMaxAgeSeconds: 60,
    })).rejects.toThrow('inventory checkpoint configuration is invalid');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('rejects an inventory checkpoint older than a claim or revocation event', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'a4-durable-store-'));
  const { plan, approval } = executionApproval();
  const secondApprovalId = '66666666-6666-4666-8666-666666666666';
  const checkpointOptions = {
    directory,
    trustedCheckpointKey: approvalKey,
    checkpointKeyId: 'a4-inventory-checkpoint-v1',
  };
  try {
    await initializeLocalDesignProvisioningRehearsalStore({
      directory,
      authorization: { approvalId: approval.approvalId, context: liveContext() },
    });
    const authorizationAdapter = createLocalDesignProvisioningAuthorizationAdapter({ directory });
    const initialSnapshot = await authorizationAdapter.readSnapshot(approval.approvalId);
    await authorizationAdapter.claim(initialSnapshot, claimedApprovalState(approval, plan).claim);
    await expect(sealLocalDesignProvisioningRehearsalStoreCheckpoint({
      ...checkpointOptions,
      createdAt: '2026-08-25T13:04:59.999Z',
    })).rejects.toThrow('inventory checkpoint temporal verification failed');

    await initializeLocalDesignProvisioningRehearsalStore({
      directory,
      authorization: { approvalId: secondApprovalId, context: liveContext() },
    });
    const secondSnapshot = await authorizationAdapter.readSnapshot(secondApprovalId);
    await revokeLocalDesignProvisioningAuthorization({
      directory,
      expectedSnapshot: secondSnapshot,
      revokedAt: '2026-08-25T13:07:00.000Z',
    });
    await expect(sealLocalDesignProvisioningRehearsalStoreCheckpoint({
      ...checkpointOptions,
      createdAt: '2026-08-25T13:06:59.999Z',
    })).rejects.toThrow('inventory checkpoint temporal verification failed');
    await expect(sealLocalDesignProvisioningRehearsalStoreCheckpoint({
      ...checkpointOptions,
      createdAt: '2026-08-25T13:07:00.000Z',
    })).resolves.toMatchObject({ createdAt: '2026-08-25T13:07:00.000Z' });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('inventory checkpoint detects deleted authorization state and a changed journal tail', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'a4-durable-store-'));
  const { plan, approval } = executionApproval();
  const secondApprovalId = '66666666-6666-4666-8666-666666666666';
  const checkpointKeyId = 'a4-inventory-checkpoint-v1';
  try {
    await initializeLocalDesignProvisioningRehearsalStore({
      directory,
      authorization: { approvalId: approval.approvalId, context: liveContext() },
    });
    await initializeLocalDesignProvisioningRehearsalStore({
      directory,
      authorization: { approvalId: secondApprovalId, context: liveContext() },
    });
    const checkpoint = await sealLocalDesignProvisioningRehearsalStoreCheckpoint({
      directory,
      trustedCheckpointKey: approvalKey,
      checkpointKeyId,
      createdAt: '2026-08-25T13:10:00.000Z',
    });
    const anchoredAudit = () => auditLocalDesignProvisioningRehearsalStore({
      directory,
      inventoryCheckpoint: checkpoint,
      trustedCheckpointKey: approvalKey,
      expectedCheckpointKeyId: checkpointKeyId,
      checkpointVerifiedAt: '2026-08-25T13:15:00.000Z',
    });

    rmSync(join(directory, 'authorization', secondApprovalId), { recursive: true, force: true });
    await expect(anchoredAudit()).rejects.toThrow('inventory checkpoint verification failed');
    expect(await auditLocalDesignProvisioningRehearsalStore({ directory })).toMatchObject({
      status: 'verified',
      authorizationCount: 1,
      catalogCompletenessVerified: false,
    });

    await initializeLocalDesignProvisioningRehearsalStore({
      directory,
      authorization: { approvalId: secondApprovalId, context: liveContext() },
    });
    expect(await anchoredAudit()).toMatchObject({ catalogCompletenessVerified: true });
    const authorizationAdapter = createLocalDesignProvisioningAuthorizationAdapter({ directory });
    const snapshot = await authorizationAdapter.readSnapshot(approval.approvalId);
    await authorizationAdapter.claim(snapshot, claimedApprovalState(approval, plan).claim);
    await expect(anchoredAudit()).rejects.toThrow('inventory checkpoint verification failed');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('store-wide audit discovers an unread authorization journal integrity failure', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'a4-durable-store-'));
  const firstApprovalId = approvalMetadata().approvalId;
  const secondApprovalId = '66666666-6666-4666-8666-666666666666';
  try {
    await initializeLocalDesignProvisioningRehearsalStore({
      directory,
      authorization: { approvalId: firstApprovalId, context: liveContext() },
    });
    await initializeLocalDesignProvisioningRehearsalStore({
      directory,
      authorization: { approvalId: secondApprovalId, context: liveContext() },
    });
    const recordPath = join(directory, 'authorization', secondApprovalId, '000000000000.json');
    const modified = JSON.parse(readFileSync(recordPath, 'utf8'));
    modified.context.organizationActive = false;
    writeFileSync(recordPath, `${JSON.stringify(modified)}\n`, 'utf8');

    await expect(auditLocalDesignProvisioningRehearsalStore({ directory }))
      .rejects.toThrow('journal integrity failed');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('store-wide audit rejects unexpected root and receipt entries', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'a4-durable-store-'));
  try {
    await initializeLocalDesignProvisioningRehearsalStore({
      directory,
      authorization: { approvalId: approvalMetadata().approvalId, context: liveContext() },
    });
    expect(await auditLocalDesignProvisioningRehearsalStore({
      directory,
      trustedReceiptKey: approvalKey,
      expectedReceiptKeyId: approvalKeyId,
    })).toMatchObject({ receiptCount: 0, receiptSignatureVerified: false });
    await expect(auditLocalDesignProvisioningRehearsalStore({
      directory,
      trustedReceiptKey: approvalKey,
    })).rejects.toThrow('receipt audit key configuration is invalid');
    const temporaryPath = join(
      directory,
      'authorization',
      approvalMetadata().approvalId,
      '.tmp-123-77777777-7777-4777-8777-777777777777',
    );
    writeFileSync(temporaryPath, 'partial', 'utf8');
    expect(await auditLocalDesignProvisioningRehearsalStore({ directory }))
      .toMatchObject({ orphanTemporaryFileCount: 1 });
    rmSync(temporaryPath);
    writeFileSync(join(directory, 'unexpected.json'), '{}\n', 'utf8');
    await expect(auditLocalDesignProvisioningRehearsalStore({ directory }))
      .rejects.toThrow('layout contains an unexpected entry');
    rmSync(join(directory, 'unexpected.json'));
    writeFileSync(join(directory, 'receipts', 'unexpected.json'), '{}\n', 'utf8');
    await expect(auditLocalDesignProvisioningRehearsalStore({ directory }))
      .rejects.toThrow('receipt directory contains an unexpected entry');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('store-wide audit rejects a receipt that is not linked to its current authorization claim', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'a4-durable-store-'));
  const { source, bytes, plan, approval } = executionApproval();
  const secondApprovalId = '66666666-6666-4666-8666-666666666666';
  try {
    await initializeLocalDesignProvisioningRehearsalStore({
      directory,
      authorization: { approvalId: approval.approvalId, context: liveContext() },
    });
    await initializeLocalDesignProvisioningRehearsalStore({
      directory,
      authorization: { approvalId: secondApprovalId, context: liveContext() },
    });
    const authorizationAdapter = createLocalDesignProvisioningAuthorizationAdapter({ directory });
    const snapshot = await authorizationAdapter.readSnapshot(approval.approvalId);
    await authorizationAdapter.claim(snapshot, claimedApprovalState(approval, plan).claim);
    const receipt = sealDesignProvisioningExecutionReceipt({
      plan,
      blueprint: source,
      sourceBytes: bytes,
      approval,
      approvalState: claimedApprovalState(approval, plan),
      executionResult: completedExecutionResult(executionPlanCandidate(plan)),
      startedAt: '2026-08-25T13:05:00.000Z',
      completedAt: '2026-08-25T13:06:00.000Z',
      trustedKey: approvalKey,
      expectedKeyId: approvalKeyId,
    });
    await createLocalDesignProvisioningReceiptAdapter({ directory }).append(receipt);
    const receiptPath = join(directory, 'receipts', `${approval.executionId}.json`);
    writeFileSync(receiptPath, `${JSON.stringify({
      ...receipt,
      approvalId: secondApprovalId,
    })}\n`, 'utf8');

    await expect(auditLocalDesignProvisioningRehearsalStore({ directory }))
      .rejects.toThrow('receipt authorization linkage is invalid');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('keyed store-wide audit rejects a receipt with a forged HMAC digest', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'a4-durable-store-'));
  const { source, bytes, plan, approval } = executionApproval();
  try {
    await initializeLocalDesignProvisioningRehearsalStore({
      directory,
      authorization: { approvalId: approval.approvalId, context: liveContext() },
    });
    const authorizationAdapter = createLocalDesignProvisioningAuthorizationAdapter({ directory });
    const snapshot = await authorizationAdapter.readSnapshot(approval.approvalId);
    await authorizationAdapter.claim(snapshot, claimedApprovalState(approval, plan).claim);
    const receipt = sealDesignProvisioningExecutionReceipt({
      plan,
      blueprint: source,
      sourceBytes: bytes,
      approval,
      approvalState: claimedApprovalState(approval, plan),
      executionResult: completedExecutionResult(executionPlanCandidate(plan)),
      startedAt: '2026-08-25T13:05:00.000Z',
      completedAt: '2026-08-25T13:06:00.000Z',
      trustedKey: approvalKey,
      expectedKeyId: approvalKeyId,
    });
    await createLocalDesignProvisioningReceiptAdapter({ directory }).append(receipt);
    const receiptPath = join(directory, 'receipts', `${approval.executionId}.json`);
    writeFileSync(receiptPath, `${JSON.stringify({
      ...receipt,
      digest: 'f'.repeat(64),
    })}\n`, 'utf8');

    expect(await auditLocalDesignProvisioningRehearsalStore({ directory })).toMatchObject({
      status: 'verified',
      receiptSignatureVerified: false,
    });
    await expect(auditLocalDesignProvisioningRehearsalStore({
      directory,
      trustedReceiptKey: approvalKey,
      expectedReceiptKeyId: approvalKeyId,
    })).rejects.toThrow('receipt signature verification failed');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('serializes concurrent durable claims and preserves append-only receipt conflicts', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'a4-durable-store-'));
  const { source, bytes, plan, approval } = executionApproval();
  try {
    await initializeLocalDesignProvisioningRehearsalStore({
      directory,
      authorization: { approvalId: approval.approvalId, context: liveContext() },
    });
    const claims = await Promise.all([
      createLocalDesignProvisioningAuthorizationAdapter({ directory }),
      createLocalDesignProvisioningAuthorizationAdapter({ directory }),
    ].map((authorizationAdapter) => claimDesignProvisioningExecutionApproval({
      approval,
      plan,
      blueprint: source,
      sourceBytes: bytes,
      authorizationAdapter,
      trustedKey: approvalKey,
      expectedKeyId: approvalKeyId,
      now: new Date('2026-08-25T13:05:00.000Z'),
    })));
    expect(claims.map(({ claimDisposition }) => claimDisposition).sort())
      .toEqual(['new', 'reconciled']);

    const receipt = sealDesignProvisioningExecutionReceipt({
      plan,
      blueprint: source,
      sourceBytes: bytes,
      approval,
      approvalState: claimedApprovalState(approval, plan),
      executionResult: completedExecutionResult(executionPlanCandidate(plan)),
      startedAt: '2026-08-25T13:05:00.000Z',
      completedAt: '2026-08-25T13:06:00.000Z',
      trustedKey: approvalKey,
      expectedKeyId: approvalKeyId,
    });
    const receiptAdapters = [
      createLocalDesignProvisioningReceiptAdapter({ directory }),
      createLocalDesignProvisioningReceiptAdapter({ directory }),
    ];
    const appends = await Promise.all(receiptAdapters.map((adapter) => adapter.append(receipt)));
    expect(appends.map(({ status }) => status).sort()).toEqual(['appended', 'existing']);

    const conflictingReceipt = { ...receipt, digest: 'f'.repeat(64) };
    expect(await receiptAdapters[0].append(conflictingReceipt)).toEqual({
      status: 'conflict',
      receipt,
    });
    expect(await createLocalDesignProvisioningReceiptAdapter({ directory }).read(
      approval.executionId,
    )).toEqual(receipt);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('rejects a durable terminal claim finalized before it was claimed', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'a4-durable-store-'));
  const { plan, approval } = executionApproval();
  try {
    await initializeLocalDesignProvisioningRehearsalStore({
      directory,
      authorization: { approvalId: approval.approvalId, context: liveContext() },
    });
    const authorizationAdapter = createLocalDesignProvisioningAuthorizationAdapter({ directory });
    const initialSnapshot = await authorizationAdapter.readSnapshot(approval.approvalId);
    const claimedState = claimedApprovalState(approval, plan);
    await authorizationAdapter.claim(initialSnapshot, claimedState.claim);
    const claimedSnapshot = await authorizationAdapter.readSnapshot(approval.approvalId);

    await expect(authorizationAdapter.finalize(claimedSnapshot, {
      ...claimedState.claim,
      status: 'completed',
      finalizedAt: '2026-08-25T13:04:59.999Z',
    })).rejects.toThrow('authorization claim is invalid');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('rejects durable receipt chronology that contradicts its authorization claim', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'a4-durable-store-'));
  const { source, bytes, plan, approval } = executionApproval();
  const executionResult = completedExecutionResult(executionPlanCandidate(plan));
  try {
    await initializeLocalDesignProvisioningRehearsalStore({
      directory,
      authorization: { approvalId: approval.approvalId, context: liveContext() },
    });
    const authorizationAdapter = createLocalDesignProvisioningAuthorizationAdapter({ directory });
    const receiptAdapter = createLocalDesignProvisioningReceiptAdapter({ directory });
    const initialSnapshot = await authorizationAdapter.readSnapshot(approval.approvalId);
    const claimedState = claimedApprovalState(approval, plan);
    await authorizationAdapter.claim(initialSnapshot, claimedState.claim);

    const earlyReceipt = sealDesignProvisioningExecutionReceipt({
      plan,
      blueprint: source,
      sourceBytes: bytes,
      approval,
      approvalState: claimedApprovalState(approval, plan, '2026-08-25T13:04:00.000Z'),
      executionResult,
      startedAt: '2026-08-25T13:04:00.000Z',
      completedAt: '2026-08-25T13:04:30.000Z',
      trustedKey: approvalKey,
      expectedKeyId: approvalKeyId,
    });
    await expect(receiptAdapter.append(earlyReceipt))
      .rejects.toThrow('receipt authorization linkage is invalid');

    const lateReceipt = sealDesignProvisioningExecutionReceipt({
      plan,
      blueprint: source,
      sourceBytes: bytes,
      approval,
      approvalState: claimedState,
      executionResult,
      startedAt: '2026-08-25T13:05:00.000Z',
      completedAt: '2026-08-25T13:07:00.000Z',
      trustedKey: approvalKey,
      expectedKeyId: approvalKeyId,
    });
    await receiptAdapter.append(lateReceipt);
    const claimedSnapshot = await authorizationAdapter.readSnapshot(approval.approvalId);
    await expect(authorizationAdapter.finalize(claimedSnapshot, {
      ...claimedState.claim,
      status: 'completed',
      finalizedAt: '2026-08-25T13:06:59.999Z',
    })).rejects.toThrow('receipt authorization linkage is invalid');

    const receiptPath = join(directory, 'receipts', `${approval.executionId}.json`);
    rmSync(receiptPath);
    await authorizationAdapter.finalize(claimedSnapshot, {
      ...claimedState.claim,
      status: 'completed',
      finalizedAt: '2026-08-25T13:06:59.999Z',
    });
    writeFileSync(receiptPath, `${JSON.stringify(lateReceipt)}\n`, 'utf8');
    await expect(auditLocalDesignProvisioningRehearsalStore({ directory }))
      .rejects.toThrow('receipt authorization linkage is invalid');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('fails closed when a durable authorization journal record is modified', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'a4-durable-store-'));
  const approvalId = approvalMetadata().approvalId;
  try {
    await initializeLocalDesignProvisioningRehearsalStore({
      directory,
      authorization: { approvalId, context: liveContext() },
    });
    const recordPath = join(
      directory,
      'authorization',
      approvalId,
      '000000000000.json',
    );
    const modified = JSON.parse(readFileSync(recordPath, 'utf8'));
    modified.context.membershipActive = false;
    writeFileSync(recordPath, `${JSON.stringify(modified)}\n`, 'utf8');
    await expect(createLocalDesignProvisioningAuthorizationAdapter({ directory })
      .readSnapshot(approvalId)).rejects.toThrow('journal integrity failed');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('refuses an authorization directory junction that escapes the rehearsal store', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'a4-durable-store-'));
  const escapedDirectory = mkdtempSync(join(tmpdir(), 'a4-durable-escape-'));
  const firstApprovalId = approvalMetadata().approvalId;
  const secondApprovalId = '66666666-6666-4666-8666-666666666666';
  try {
    await initializeLocalDesignProvisioningRehearsalStore({
      directory,
      authorization: { approvalId: firstApprovalId, context: liveContext() },
    });
    symlinkSync(
      escapedDirectory,
      join(directory, 'authorization', secondApprovalId),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    await expect(initializeLocalDesignProvisioningRehearsalStore({
      directory,
      authorization: { approvalId: secondApprovalId, context: liveContext() },
    })).rejects.toThrow('authorization directory is invalid');
  } finally {
    rmSync(directory, { recursive: true, force: true });
    rmSync(escapedDirectory, { recursive: true, force: true });
  }
});

test('persists a local revocation across restart and rejects a later claim', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'a4-durable-store-'));
  const { source, bytes, plan, approval } = executionApproval();
  try {
    await initializeLocalDesignProvisioningRehearsalStore({
      directory,
      authorization: { approvalId: approval.approvalId, context: liveContext() },
    });
    const authorizationAdapter = createLocalDesignProvisioningAuthorizationAdapter({ directory });
    const expectedSnapshot = await authorizationAdapter.readSnapshot(approval.approvalId);
    expect(await revokeLocalDesignProvisioningAuthorization({
      directory,
      expectedSnapshot,
      revokedAt: '2026-08-25T13:04:00.000Z',
    })).toMatchObject({
      status: 'updated',
      state: { approvalId: approval.approvalId, revokedAt: '2026-08-25T13:04:00.000Z', claim: null },
    });
    const restarted = createLocalDesignProvisioningAuthorizationAdapter({ directory });
    await expect(claimDesignProvisioningExecutionApproval({
      approval,
      plan,
      blueprint: source,
      sourceBytes: bytes,
      authorizationAdapter: restarted,
      trustedKey: approvalKey,
      expectedKeyId: approvalKeyId,
      now: new Date('2026-08-25T13:05:00.000Z'),
    })).rejects.toThrow('approval has been revoked');
    expect((await restarted.readSnapshot(approval.approvalId)).state.claim).toBeNull();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('keeps an active claim open when synthetic membership becomes inactive before finalize', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'a4-durable-store-'));
  const { source, bytes, plan, approval } = executionApproval();
  try {
    await initializeLocalDesignProvisioningRehearsalStore({
      directory,
      authorization: { approvalId: approval.approvalId, context: liveContext() },
    });
    const authorizationAdapter = createLocalDesignProvisioningAuthorizationAdapter({ directory });
    await claimDesignProvisioningExecutionApproval({
      approval,
      plan,
      blueprint: source,
      sourceBytes: bytes,
      authorizationAdapter,
      trustedKey: approvalKey,
      expectedKeyId: approvalKeyId,
      now: new Date('2026-08-25T13:05:00.000Z'),
    });
    const claimedSnapshot = await authorizationAdapter.readSnapshot(approval.approvalId);
    expect(await replaceLocalDesignProvisioningAuthorizationContext({
      directory,
      expectedSnapshot: claimedSnapshot,
      context: liveContext({ membershipActive: false }),
    })).toMatchObject({ status: 'updated', context: { membershipActive: false } });
    const restarted = createLocalDesignProvisioningAuthorizationAdapter({ directory });
    await expect(finalizeDesignProvisioningExecutionApproval({
      approval,
      plan,
      blueprint: source,
      sourceBytes: bytes,
      authorizationAdapter: restarted,
      trustedKey: approvalKey,
      expectedKeyId: approvalKeyId,
      outcome: 'completed',
      now: new Date('2026-08-25T13:06:00.000Z'),
    })).rejects.toThrow('live authorization context is invalid');
    const inactiveSnapshot = await restarted.readSnapshot(approval.approvalId);
    expect(inactiveSnapshot.state.claim.status).toBe('claimed');
    await expect(replaceLocalDesignProvisioningAuthorizationContext({
      directory,
      expectedSnapshot: inactiveSnapshot,
      context: liveContext(),
    })).resolves.toMatchObject({
      status: 'conflict',
      context: { membershipActive: false },
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('allows only one durable transition when claim and revocation race', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'a4-durable-store-'));
  const { source, bytes, plan, approval } = executionApproval();
  try {
    await initializeLocalDesignProvisioningRehearsalStore({
      directory,
      authorization: { approvalId: approval.approvalId, context: liveContext() },
    });
    const authorizationAdapter = createLocalDesignProvisioningAuthorizationAdapter({ directory });
    const expectedSnapshot = await authorizationAdapter.readSnapshot(approval.approvalId);
    const results = await Promise.allSettled([
      claimDesignProvisioningExecutionApproval({
        approval,
        plan,
        blueprint: source,
        sourceBytes: bytes,
        authorizationAdapter,
        trustedKey: approvalKey,
        expectedKeyId: approvalKeyId,
        now: new Date('2026-08-25T13:05:00.000Z'),
      }),
      revokeLocalDesignProvisioningAuthorization({
        directory,
        expectedSnapshot,
        revokedAt: '2026-08-25T13:04:00.000Z',
      }),
    ]);
    const finalSnapshot = await createLocalDesignProvisioningAuthorizationAdapter({ directory })
      .readSnapshot(approval.approvalId);
    expect(Boolean(finalSnapshot.state.claim) === Boolean(finalSnapshot.state.revokedAt)).toBe(false);
    if (finalSnapshot.state.claim) {
      expect(results[0].status).toBe('fulfilled');
      expect(results[1]).toMatchObject({ status: 'fulfilled', value: { status: 'conflict' } });
    } else {
      expect(finalSnapshot.state.revokedAt).toBe('2026-08-25T13:04:00.000Z');
      expect(results[1]).toMatchObject({ status: 'fulfilled', value: { status: 'updated' } });
      expect(results[0]).toMatchObject({ status: 'rejected' });
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('uses immutable journal publication without a stale lock and ignores an orphan temp', async () => {
  const durableSource = readFileSync(durableStoreModulePath, 'utf8');
  expect(durableSource).not.toContain('write.lock');
  expect(durableSource).not.toContain('acquireLock(');

  const directory = mkdtempSync(join(tmpdir(), 'a4-durable-store-'));
  const { source, bytes, plan, approval } = executionApproval();
  try {
    await initializeLocalDesignProvisioningRehearsalStore({
      directory,
      authorization: { approvalId: approval.approvalId, context: liveContext() },
    });
    const approvalDirectory = join(directory, 'authorization', approval.approvalId);
    writeFileSync(
      join(approvalDirectory, '.tmp-999-77777777-7777-4777-8777-777777777777'),
      '{"incomplete":',
      'utf8',
    );
    const authorizationAdapter = createLocalDesignProvisioningAuthorizationAdapter({ directory });
    await expect(claimDesignProvisioningExecutionApproval({
      approval,
      plan,
      blueprint: source,
      sourceBytes: bytes,
      authorizationAdapter,
      trustedKey: approvalKey,
      expectedKeyId: approvalKeyId,
      now: new Date('2026-08-25T13:05:00.000Z'),
    })).resolves.toMatchObject({ claimDisposition: 'new' });
    const names = readdirSync(approvalDirectory);
    expect(names.filter((name) => /^\d{12}\.json$/.test(name))).toHaveLength(2);
    expect(names).not.toContain('write.lock');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('publishes exactly one authorization claim across independent Node processes', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'a4-durable-store-'));
  const { plan, approval } = executionApproval();
  try {
    await initializeLocalDesignProvisioningRehearsalStore({
      directory,
      authorization: { approvalId: approval.approvalId, context: liveContext() },
    });
    const authorizationAdapter = createLocalDesignProvisioningAuthorizationAdapter({ directory });
    const snapshot = await authorizationAdapter.readSnapshot(approval.approvalId);
    const inputPath = join(directory, 'cross-process-input.json');
    writeFileSync(inputPath, JSON.stringify({
      snapshot,
      claim: claimedApprovalState(approval, plan).claim,
    }), 'utf8');
    const durableModuleUrl = pathToFileURL(durableStoreModulePath).href;
    const childSource = `
      import { readFile } from 'node:fs/promises';
      import { createLocalDesignProvisioningAuthorizationAdapter } from ${JSON.stringify(durableModuleUrl)};
      const [directory, inputPath] = process.argv.slice(1);
      const input = JSON.parse(await readFile(inputPath, 'utf8'));
      const adapter = createLocalDesignProvisioningAuthorizationAdapter({ directory });
      const result = await adapter.claim(input.snapshot, input.claim);
      process.stdout.write(JSON.stringify({ status: result.status }));
    `;
    const results = await Promise.all(Array.from(
      { length: 6 },
      () => runNodeEval(childSource, [directory, inputPath]),
    ));
    expect(results.filter(({ status }) => status === 'claimed')).toHaveLength(1);
    expect(results.filter(({ status }) => status === 'conflict')).toHaveLength(5);
    expect(readdirSync(join(directory, 'authorization', approval.approvalId))
      .filter((name) => /^\d{12}\.json$/.test(name))).toHaveLength(2);
    expect((await authorizationAdapter.readSnapshot(approval.approvalId)).state.claim)
      .toEqual(claimedApprovalState(approval, plan).claim);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}, 15_000);

test('keeps the plan scripts and shared design contract in Linux CI', () => {
  const packageJson = JSON.parse(readFileSync(join(repoRoot, 'automation', 'package.json'), 'utf8'));
  const workflow = readFileSync(join(repoRoot, '.github', 'workflows', 'test.yml'), 'utf8');
  const source = readFileSync(modulePath, 'utf8');

  expect(packageJson.scripts['plan:platform-design-provisioning']).toBe(
    'node platform-design-provisioning-plan.mjs',
  );
  expect(packageJson.scripts['verify:platform-design-provisioning']).toBe(
    'node platform-design-provisioning-plan.mjs --verify',
  );
  expect(workflow).toContain("- 'src/islands/platform/design/**'");
  expect(workflow).toContain('src/islands/platform/design/design-console-logic.test.ts');
  expect(source).not.toContain('@supabase/supabase-js');
  expect(source).not.toContain('createClient(');
  expect(source).not.toContain('executeDesignProvisioningPlan');
});

test('validates and preserves the complete canonical blueprint hierarchy', () => {
  expect(validateDesignBlueprint(blueprint())).toEqual(blueprint());
});

test('builds stable parent-before-child operations without executing them', () => {
  const source = blueprint();
  const plan = buildDesignProvisioningPlan(source, sourceBytes(source));

  expect(plan).toMatchObject({
    schemaVersion: 2,
    planKind: 'platform_design_provisioning_plan',
    summary: {
      assemblyCount: 1,
      sessionCount: 2,
      topicCount: 2,
      teamCount: 2,
      participantCount: 22,
      operationCount: 7,
    },
    blockers: DESIGN_PROVISIONING_BLOCKERS,
    readyForExecution: false,
    serverContractImplemented: false,
    dryRun: true,
    databaseMutationExecuted: false,
    requiresApproval: true,
  });
  expect(plan.operations.map(({ type, ref, parentRef }) => ({ type, ref, parentRef }))).toEqual([
    { type: 'create_assembly', ref: 'assembly:climate-2026', parentRef: null },
    { type: 'create_session', ref: 'assembly:climate-2026/session:mitigation-session', parentRef: 'assembly:climate-2026' },
    { type: 'create_topic', ref: 'assembly:climate-2026/session:mitigation-session/topic:1', parentRef: 'assembly:climate-2026/session:mitigation-session' },
    { type: 'create_team', ref: 'assembly:climate-2026/session:mitigation-session/team:1', parentRef: 'assembly:climate-2026/session:mitigation-session' },
    { type: 'create_session', ref: 'assembly:climate-2026/session:adaptation-session', parentRef: 'assembly:climate-2026' },
    { type: 'create_topic', ref: 'assembly:climate-2026/session:adaptation-session/topic:1', parentRef: 'assembly:climate-2026/session:adaptation-session' },
    { type: 'create_team', ref: 'assembly:climate-2026/session:adaptation-session/team:1', parentRef: 'assembly:climate-2026/session:adaptation-session' },
  ]);
  expect(plan.operations.every((operation) => /^[0-9a-f]{64}$/.test(operation.operationId))).toBe(true);
  expect(buildDesignProvisioningPlan(source, sourceBytes(source))).toEqual(plan);
});

test('binds exact source bytes and reconstructs the complete plan', () => {
  const source = blueprint();
  const bytes = sourceBytes(source);
  const plan = buildDesignProvisioningPlan(source, bytes);

  expect(verifyDesignProvisioningPlan(plan, source, bytes)).toEqual({
    status: 'verified',
    checksum: plan.checksum,
    operationCount: 7,
    blockerCount: 5,
    readyForExecution: false,
    databaseMutationExecuted: false,
  });
  expect(() => verifyDesignProvisioningPlan(
    plan,
    source,
    Buffer.from(JSON.stringify(source), 'utf8'),
  )).toThrow('does not match its source blueprint');
});

test('seals a short-lived A4 execution approval to the exact verified plan and source', () => {
  const { source, bytes, plan, approval } = executionApproval();

  expect(approval).toMatchObject({
    schemaVersion: 1,
    kind: 'platform_design_provisioning_execution_approval',
    planChecksum: plan.checksum,
    sourceBlueprintSha256: plan.sourceBlueprint.sha256,
    sourceBlueprintBytes: plan.sourceBlueprint.bytes,
    operationCount: plan.summary.operationCount,
    approvalId: '33333333-3333-4333-8333-333333333333',
    executionId: '44444444-4444-4444-8444-444444444444',
    organizationId: '22222222-2222-4222-8222-222222222222',
    targetHost: 'production-primary',
    approvedBy: 'auth-user:55555555-5555-4555-8555-555555555555',
    approvedRole: 'org_admin',
    approvedAt,
    expiresAt,
    keyId: approvalKeyId,
    allowDesignProvisioningMutation: true,
    allowJoinCodeDisclosure: true,
  });
  expect(approval.digest).toMatch(/^[0-9a-f]{64}$/);
  expect(verifyDesignProvisioningExecutionApproval(approval, plan, source, bytes, {
    trustedKey: approvalKey,
    expectedKeyId: approvalKeyId,
    expectedOrganizationId: approval.organizationId,
    expectedTargetHost: approval.targetHost,
    now: new Date('2026-08-25T13:05:00.000Z'),
    approvalState: approvalState(),
  })).toEqual({
    status: 'verified',
    approvalId: approval.approvalId,
    executionId: approval.executionId,
    organizationId: approval.organizationId,
    targetHost: approval.targetHost,
    approvedRole: 'org_admin',
    planChecksum: plan.checksum,
    claimAction: 'claim_required',
    databaseMutationExecuted: false,
  });
});

test('seals and verifies a non-sensitive A4 receipt from an exact completed RPC response', () => {
  const { source, bytes, plan, approval } = executionApproval();
  const executionPlan = executionPlanCandidate(plan);
  const resourceIds = plan.operations.map((_, index) => (
    `${String(index + 1).padStart(8, '0')}-0000-4000-8000-000000000000`
  ));
  const joinCodes = plan.operations.map((_, index) => `${123450 + index}`);
  const response = {
    schemaVersion: 1,
    planChecksum: executionPlan.checksum,
    operationCount: plan.operations.length,
    operations: plan.operations.map((operation, index) => ({
      operationId: operation.operationId,
      resourceId: resourceIds[index],
      status: index === 0 ? 'replayed' : 'applied',
      ...(operation.type === 'create_team' ? { joinCode: joinCodes[index] } : {}),
    })),
  };
  const receipt = sealDesignProvisioningExecutionReceipt({
    plan,
    blueprint: source,
    sourceBytes: bytes,
    approval,
    approvalState: claimedApprovalState(approval, plan),
    executionResult: { status: 'completed', response },
    startedAt: '2026-08-25T13:05:00.000Z',
    completedAt: '2026-08-25T13:06:00.000Z',
    trustedKey: approvalKey,
    expectedKeyId: approvalKeyId,
  });

  expect(receipt).toMatchObject({
    schemaVersion: 1,
    kind: 'platform_design_provisioning_execution_receipt',
    status: 'completed',
    approvedPlanChecksum: plan.checksum,
    executedPlanChecksum: executionPlan.checksum,
    sourceBlueprintSha256: plan.sourceBlueprint.sha256,
    approvalId: approval.approvalId,
    executionId: approval.executionId,
    keyId: approvalKeyId,
    failureCode: null,
    rollbackVerified: false,
    summary: {
      plannedOperationCount: plan.operations.length,
      observedOperationCount: plan.operations.length,
      appliedCount: plan.operations.length - 1,
      replayedCount: 1,
    },
    containsSensitiveValues: false,
  });
  expect(receipt.operations).toEqual(plan.operations.map((operation, index) => ({
    operationId: operation.operationId,
    type: operation.type,
    status: index === 0 ? 'replayed' : 'applied',
  })));
  expect(receipt.digest).toMatch(/^[0-9a-f]{64}$/);
  expect(receipt.executedPlanChecksum).not.toBe(receipt.approvedPlanChecksum);
  const receiptWithoutDigest = JSON.stringify({ ...receipt, digest: '' });
  for (const joinCode of joinCodes) expect(receiptWithoutDigest).not.toContain(joinCode);
  for (const resourceId of resourceIds) expect(receiptWithoutDigest).not.toContain(resourceId);
  expect(verifyDesignProvisioningExecutionReceipt(
    receipt,
    plan,
    source,
    bytes,
    approval,
    { trustedKey: approvalKey, expectedKeyId: approvalKeyId },
  )).toEqual({
    status: 'verified',
    executionStatus: 'completed',
    approvalId: approval.approvalId,
    executionId: approval.executionId,
    planChecksum: plan.checksum,
    executedPlanChecksum: executionPlan.checksum,
    operationCount: plan.operations.length,
    containsSensitiveValues: false,
  });
  expect(() => verifyDesignProvisioningExecutionReceipt(
    { ...receipt, summary: { ...receipt.summary, replayedCount: 0 } },
    plan,
    source,
    bytes,
    approval,
    { trustedKey: approvalKey, expectedKeyId: approvalKeyId },
  )).toThrow('receipt summary is invalid');
});

test('seals only allowlisted rollback-verified A4 failure receipts and rejects malformed outcomes', () => {
  const { source, bytes, plan, approval } = executionApproval();
  const base = {
    plan,
    blueprint: source,
    sourceBytes: bytes,
    approval,
    approvalState: claimedApprovalState(approval, plan),
    startedAt: '2026-08-25T13:05:00.000Z',
    completedAt: '2026-08-25T13:06:00.000Z',
    trustedKey: approvalKey,
    expectedKeyId: approvalKeyId,
  };
  const receipt = sealDesignProvisioningExecutionReceipt({
    ...base,
    executionResult: {
      status: 'failed',
      failureCode: 'design_operation_conflict',
      rollbackVerified: true,
    },
  });
  expect(receipt).toMatchObject({
    status: 'failed',
    failureCode: 'design_operation_conflict',
    rollbackVerified: true,
    operations: [],
    summary: {
      plannedOperationCount: plan.operations.length,
      observedOperationCount: 0,
      appliedCount: 0,
      replayedCount: 0,
    },
    containsSensitiveValues: false,
  });
  expect(verifyDesignProvisioningExecutionReceipt(
    receipt,
    plan,
    source,
    bytes,
    approval,
    { trustedKey: approvalKey, expectedKeyId: approvalKeyId },
  ).executionStatus).toBe('failed');

  expect(() => sealDesignProvisioningExecutionReceipt({
    ...base,
    approvalState: approvalState(),
    executionResult: {
      status: 'failed',
      failureCode: 'design_operation_conflict',
      rollbackVerified: true,
    },
  })).toThrow('requires an active claim');
  expect(() => sealDesignProvisioningExecutionReceipt({
    ...base,
    executionResult: {
      status: 'failed',
      failureCode: 'raw_database_error_with_secret',
      rollbackVerified: true,
    },
  })).toThrow('execution result is invalid');
  expect(() => sealDesignProvisioningExecutionReceipt({
    ...base,
    executionResult: {
      status: 'failed',
      failureCode: 'design_operation_conflict',
      rollbackVerified: false,
    },
  })).toThrow('execution result is invalid');
  expect(() => sealDesignProvisioningExecutionReceipt({
    ...base,
    executionResult: {
      status: 'completed',
      response: {
        schemaVersion: 1,
        planChecksum: plan.checksum,
        operationCount: plan.operations.length,
        operations: plan.operations.map((operation) => ({
          operationId: operation.operationId,
          resourceId: '11111111-1111-4111-8111-111111111111',
          status: 'applied',
          ...(operation.type === 'create_team' ? { joinCode: '123456' } : {}),
        })),
      },
    },
  })).toThrow('RPC response is invalid');
});

test('executes claim, exact RPC, append-only receipt, and finalization in order', async () => {
  const { source, bytes, plan, approval } = executionApproval();
  const authorizationAdapter = createInMemoryDesignProvisioningAuthorizationAdapter(liveContext());
  const receiptAdapter = createInMemoryDesignProvisioningReceiptAdapter();
  const events = [];
  const executionAdapter = {
    async execute({ plan: executionPlan, sourceBytes: executionBytes }) {
      events.push('execute');
      expect(executionPlan).toEqual(executionPlanCandidate(plan));
      expect(Buffer.from(executionBytes)).toEqual(bytes);
      return completedExecutionResult(executionPlan);
    },
  };

  const result = await executeDesignProvisioningApprovalLifecycle({
    approval,
    plan,
    blueprint: source,
    sourceBytes: bytes,
    authorizationAdapter,
    receiptAdapter: {
      async read(executionId) {
        events.push('read');
        return receiptAdapter.read(executionId);
      },
      async append(receipt) {
        events.push('append');
        return receiptAdapter.append(receipt);
      },
    },
    executionAdapter,
    trustedKey: approvalKey,
    expectedKeyId: approvalKeyId,
    clock: sequenceClock(
      '2026-08-25T13:05:00.000Z',
      '2026-08-25T13:06:00.000Z',
      '2026-08-25T13:07:00.000Z',
    ),
  });

  expect(events).toEqual(['read', 'read', 'execute', 'append', 'read']);
  expect(result).toMatchObject({
    status: 'execution_completed',
    executionDisposition: 'executed',
    receiptDisposition: 'appended',
    finalizationDisposition: 'new',
    approvalId: approval.approvalId,
    executionId: approval.executionId,
    planChecksum: plan.checksum,
    operationCount: plan.operations.length,
    containsSensitiveValues: false,
  });
  const storedReceipt = await receiptAdapter.read(approval.executionId);
  expect(storedReceipt.status).toBe('completed');
  expect(JSON.stringify({ ...storedReceipt, digest: '' })).not.toContain('123450');
  expect((await authorizationAdapter.readSnapshot(approval.approvalId)).state.claim.status)
    .toBe('completed');
});

test('keeps an A4 claim open when finalization time predates receipt completion', async () => {
  const { source, bytes, plan, approval } = executionApproval();
  const authorizationAdapter = createInMemoryDesignProvisioningAuthorizationAdapter(liveContext());
  const receiptAdapter = createInMemoryDesignProvisioningReceiptAdapter();
  let executionCount = 0;
  const base = {
    approval,
    plan,
    blueprint: source,
    sourceBytes: bytes,
    authorizationAdapter,
    receiptAdapter,
    executionAdapter: {
      async execute({ plan: executionPlan }) {
        executionCount += 1;
        return completedExecutionResult(executionPlan);
      },
    },
    trustedKey: approvalKey,
    expectedKeyId: approvalKeyId,
  };

  await expect(executeDesignProvisioningApprovalLifecycle({
    ...base,
    clock: sequenceClock(
      '2026-08-25T13:05:00.000Z',
      '2026-08-25T13:07:00.000Z',
      '2026-08-25T13:06:59.999Z',
    ),
  })).rejects.toThrow('receipt finalization time is invalid');
  expect((await authorizationAdapter.readSnapshot(approval.approvalId)).state.claim.status)
    .toBe('claimed');
  expect(await receiptAdapter.read(approval.executionId)).not.toBeNull();

  await expect(executeDesignProvisioningApprovalLifecycle({
    ...base,
    clock: sequenceClock('2026-08-25T13:06:59.999Z'),
  })).rejects.toThrow('receipt finalization time is invalid');
  const recovered = await executeDesignProvisioningApprovalLifecycle({
    ...base,
    clock: sequenceClock('2026-08-25T13:07:00.000Z'),
  });
  expect(recovered).toMatchObject({
    executionDisposition: 'existing_receipt',
    finalizationDisposition: 'new',
  });
  expect(executionCount).toBe(1);
});

test('recovers a persisted A4 receipt after append response loss without invoking RPC again', async () => {
  const { source, bytes, plan, approval } = executionApproval();
  const authorizationAdapter = createInMemoryDesignProvisioningAuthorizationAdapter(liveContext());
  const storedReceipts = createInMemoryDesignProvisioningReceiptAdapter();
  let appendResponseLost = true;
  let executionCount = 0;
  const receiptAdapter = {
    async read(executionId) { return storedReceipts.read(executionId); },
    async append(receipt) {
      const result = await storedReceipts.append(receipt);
      if (appendResponseLost) {
        appendResponseLost = false;
        throw new Error('raw receipt storage response with secret');
      }
      return result;
    },
  };
  const executionAdapter = {
    async execute({ plan: executionPlan }) {
      executionCount += 1;
      return completedExecutionResult(executionPlan);
    },
  };
  const base = {
    approval,
    plan,
    blueprint: source,
    sourceBytes: bytes,
    authorizationAdapter,
    receiptAdapter,
    executionAdapter,
    trustedKey: approvalKey,
    expectedKeyId: approvalKeyId,
  };

  await expect(executeDesignProvisioningApprovalLifecycle({
    ...base,
    clock: sequenceClock(
      '2026-08-25T13:05:00.000Z',
      '2026-08-25T13:06:00.000Z',
    ),
  })).rejects.toThrow('execution receipt append failed');
  expect((await authorizationAdapter.readSnapshot(approval.approvalId)).state.claim.status)
    .toBe('claimed');
  expect(await storedReceipts.read(approval.executionId)).not.toBeNull();

  const recovered = await executeDesignProvisioningApprovalLifecycle({
    ...base,
    clock: sequenceClock('2026-08-25T13:07:00.000Z'),
  });
  expect(recovered).toMatchObject({
    status: 'execution_completed',
    executionDisposition: 'existing_receipt',
    receiptDisposition: 'existing',
    finalizationDisposition: 'new',
  });
  expect(executionCount).toBe(1);
  expect(JSON.stringify(recovered)).not.toContain('raw receipt storage response with secret');
});

test('does not finalize when an acknowledged A4 receipt is not observable after append', async () => {
  const { source, bytes, plan, approval } = executionApproval(blueprint(), approvalMetadata({
    approvalId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    executionId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  }));
  const authorizationAdapter = createInMemoryDesignProvisioningAuthorizationAdapter(liveContext());
  await expect(executeDesignProvisioningApprovalLifecycle({
    approval,
    plan,
    blueprint: source,
    sourceBytes: bytes,
    authorizationAdapter,
    receiptAdapter: {
      async read() { return null; },
      async append(receipt) { return { status: 'appended', receipt }; },
    },
    executionAdapter: {
      async execute({ plan: executionPlan }) {
        return completedExecutionResult(executionPlan);
      },
    },
    trustedKey: approvalKey,
    expectedKeyId: approvalKeyId,
    clock: sequenceClock(
      '2026-08-25T13:05:00.000Z',
      '2026-08-25T13:06:00.000Z',
    ),
  })).rejects.toThrow('execution receipt persistence is not observable');
  expect((await authorizationAdapter.readSnapshot(approval.approvalId)).state.claim.status)
    .toBe('claimed');
});

test('finalizes only rollback-verified failures and leaves unconfirmed execution claimed', async () => {
  const failed = executionApproval();
  const failedAuthorization = createInMemoryDesignProvisioningAuthorizationAdapter(liveContext());
  const failedReceipts = createInMemoryDesignProvisioningReceiptAdapter();
  const failedResult = await executeDesignProvisioningApprovalLifecycle({
    approval: failed.approval,
    plan: failed.plan,
    blueprint: failed.source,
    sourceBytes: failed.bytes,
    authorizationAdapter: failedAuthorization,
    receiptAdapter: failedReceipts,
    executionAdapter: {
      async execute() {
        return {
          status: 'failed',
          failureCode: 'design_operation_conflict',
          rollbackVerified: true,
        };
      },
    },
    trustedKey: approvalKey,
    expectedKeyId: approvalKeyId,
    clock: sequenceClock(
      '2026-08-25T13:05:00.000Z',
      '2026-08-25T13:06:00.000Z',
      '2026-08-25T13:07:00.000Z',
    ),
  });
  expect(failedResult).toMatchObject({
    status: 'execution_failed',
    failureCode: 'design_operation_conflict',
    executionDisposition: 'executed',
    finalizationDisposition: 'new',
  });
  expect((await failedAuthorization.readSnapshot(failed.approval.approvalId)).state.claim.status)
    .toBe('failed');

  const unconfirmed = executionApproval(blueprint(), approvalMetadata({
    approvalId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    executionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  }));
  const unconfirmedAuthorization = createInMemoryDesignProvisioningAuthorizationAdapter(liveContext());
  const unconfirmedReceipts = createInMemoryDesignProvisioningReceiptAdapter();
  let unconfirmedExecutionCount = 0;
  await expect(executeDesignProvisioningApprovalLifecycle({
    approval: unconfirmed.approval,
    plan: unconfirmed.plan,
    blueprint: unconfirmed.source,
    sourceBytes: unconfirmed.bytes,
    authorizationAdapter: unconfirmedAuthorization,
    receiptAdapter: unconfirmedReceipts,
    executionAdapter: {
      async execute() {
        unconfirmedExecutionCount += 1;
        throw new Error('raw RPC response with secret');
      },
    },
    trustedKey: approvalKey,
    expectedKeyId: approvalKeyId,
    clock: sequenceClock('2026-08-25T13:05:00.000Z'),
  })).rejects.toThrow('execution adapter failed');
  expect((await unconfirmedAuthorization.readSnapshot(unconfirmed.approval.approvalId)).state.claim.status)
    .toBe('claimed');
  expect(await unconfirmedReceipts.read(unconfirmed.approval.executionId)).toBeNull();

  await expect(executeDesignProvisioningApprovalLifecycle({
    approval: unconfirmed.approval,
    plan: unconfirmed.plan,
    blueprint: unconfirmed.source,
    sourceBytes: unconfirmed.bytes,
    authorizationAdapter: unconfirmedAuthorization,
    receiptAdapter: unconfirmedReceipts,
    executionAdapter: {
      async execute({ plan: executionPlan }) {
        unconfirmedExecutionCount += 1;
        return completedExecutionResult(executionPlan);
      },
    },
    trustedKey: approvalKey,
    expectedKeyId: approvalKeyId,
    clock: sequenceClock('2026-08-25T13:06:00.000Z'),
  })).rejects.toThrow('existing claim requires receipt reconciliation');
  expect(unconfirmedExecutionCount).toBe(1);
  expect(await unconfirmedReceipts.read(unconfirmed.approval.executionId)).toBeNull();
});

test('allows only the new A4 claim owner to invoke RPC during concurrent lifecycle calls', async () => {
  const { source, bytes, plan, approval } = executionApproval();
  const authorizationAdapter = createInMemoryDesignProvisioningAuthorizationAdapter(liveContext());
  const receiptAdapter = createInMemoryDesignProvisioningReceiptAdapter();
  let executionCount = 0;
  let signalFirstExecutionStarted;
  let releaseFirstExecution;
  const firstExecutionStarted = new Promise((resolve) => { signalFirstExecutionStarted = resolve; });
  const firstExecutionRelease = new Promise((resolve) => { releaseFirstExecution = resolve; });
  const executionAdapter = {
    async execute({ plan: executionPlan }) {
      executionCount += 1;
      if (executionCount === 1) {
        signalFirstExecutionStarted();
        await firstExecutionRelease;
      }
      return completedExecutionResult(executionPlan);
    },
  };
  const base = {
    approval,
    plan,
    blueprint: source,
    sourceBytes: bytes,
    authorizationAdapter,
    receiptAdapter,
    executionAdapter,
    trustedKey: approvalKey,
    expectedKeyId: approvalKeyId,
  };

  const firstLifecycle = executeDesignProvisioningApprovalLifecycle({
    ...base,
    clock: sequenceClock(
      '2026-08-25T13:05:00.000Z',
      '2026-08-25T13:06:00.000Z',
      '2026-08-25T13:07:00.000Z',
    ),
  });
  await firstExecutionStarted;
  const secondLifecycle = executeDesignProvisioningApprovalLifecycle({
    ...base,
    clock: sequenceClock(
      '2026-08-25T13:05:30.000Z',
      '2026-08-25T13:06:30.000Z',
      '2026-08-25T13:07:30.000Z',
    ),
  });

  try {
    await expect(secondLifecycle).rejects.toThrow(
      'existing claim requires receipt reconciliation',
    );
  } finally {
    releaseFirstExecution();
    await firstLifecycle;
  }
  expect(executionCount).toBe(1);
  expect((await receiptAdapter.read(approval.executionId)).status).toBe('completed');
});

test('explicitly reconciles an unknown A4 RPC outcome without executing it again', async () => {
  const { source, bytes, plan, approval } = executionApproval();
  const authorizationAdapter = createInMemoryDesignProvisioningAuthorizationAdapter(liveContext());
  const receiptAdapter = createInMemoryDesignProvisioningReceiptAdapter();
  let executionCount = 0;
  await expect(executeDesignProvisioningApprovalLifecycle({
    approval,
    plan,
    blueprint: source,
    sourceBytes: bytes,
    authorizationAdapter,
    receiptAdapter,
    executionAdapter: {
      async execute() {
        executionCount += 1;
        throw new Error('raw RPC response with secret');
      },
    },
    trustedKey: approvalKey,
    expectedKeyId: approvalKeyId,
    clock: sequenceClock('2026-08-25T13:05:00.000Z'),
  })).rejects.toThrow('execution adapter failed');

  let reconciliationCount = 0;
  const result = await reconcileDesignProvisioningApprovalLifecycle({
    approval,
    plan,
    blueprint: source,
    sourceBytes: bytes,
    authorizationAdapter,
    receiptAdapter,
    reconciliationAdapter: {
      async reconcile({ query }) {
        reconciliationCount += 1;
        expect(query).toEqual({
          schemaVersion: 1,
          kind: 'platform_design_provisioning_reconciliation_query',
          approvalId: approval.approvalId,
          executionId: approval.executionId,
          approvedPlanChecksum: plan.checksum,
          executedPlanChecksum: executionPlanCandidate(plan).checksum,
          sourceBlueprintSha256: plan.sourceBlueprint.sha256,
          sourceBlueprintBytes: plan.sourceBlueprint.bytes,
          operationCount: plan.operations.length,
          operations: plan.operations.map(({ operationId, type }) => ({ operationId, type })),
          containsSensitiveValues: false,
        });
        expect(query).not.toHaveProperty('sourceBytes');
        expect(query).not.toHaveProperty('readyForExecution');
        return completedExecutionResult(executionPlanCandidate(plan), 'replayed');
      },
    },
    trustedKey: approvalKey,
    expectedKeyId: approvalKeyId,
    clock: sequenceClock(
      '2026-08-25T13:20:00.000Z',
      '2026-08-25T13:21:00.000Z',
      '2026-08-25T13:22:00.000Z',
    ),
  });

  expect(result).toMatchObject({
    status: 'execution_completed',
    executionDisposition: 'reconciled',
    receiptDisposition: 'appended',
    finalizationDisposition: 'new',
  });
  expect(executionCount).toBe(1);
  expect(reconciliationCount).toBe(1);
  const storedReceipt = await receiptAdapter.read(approval.executionId);
  expect(storedReceipt).toMatchObject({
    startedAt: '2026-08-25T13:05:00.000Z',
    completedAt: '2026-08-25T13:21:00.000Z',
    status: 'completed',
  });
  expect((await authorizationAdapter.readSnapshot(approval.approvalId)).state.claim.status)
    .toBe('completed');
});

test('requires a pre-existing A4 claim before explicit reconciliation', async () => {
  const { source, bytes, plan, approval } = executionApproval();
  const authorizationAdapter = createInMemoryDesignProvisioningAuthorizationAdapter(liveContext());
  let reconciliationCount = 0;
  await expect(reconcileDesignProvisioningApprovalLifecycle({
    approval,
    plan,
    blueprint: source,
    sourceBytes: bytes,
    authorizationAdapter,
    receiptAdapter: createInMemoryDesignProvisioningReceiptAdapter(),
    reconciliationAdapter: {
      async reconcile() {
        reconciliationCount += 1;
        return { status: 'pending' };
      },
    },
    trustedKey: approvalKey,
    expectedKeyId: approvalKeyId,
    clock: sequenceClock('2026-08-25T13:05:00.000Z'),
  })).rejects.toThrow('reconciliation requires an active claim');
  expect(reconciliationCount).toBe(0);
  expect((await authorizationAdapter.readSnapshot(approval.approvalId)).state.claim).toBeNull();
});

test('keeps the A4 claim open when explicit reconciliation remains pending', async () => {
  const { source, bytes, plan, approval } = executionApproval();
  const authorizationAdapter = createInMemoryDesignProvisioningAuthorizationAdapter(liveContext());
  const receiptAdapter = createInMemoryDesignProvisioningReceiptAdapter();
  await expect(executeDesignProvisioningApprovalLifecycle({
    approval,
    plan,
    blueprint: source,
    sourceBytes: bytes,
    authorizationAdapter,
    receiptAdapter,
    executionAdapter: {
      async execute() { throw new Error('unknown RPC outcome'); },
    },
    trustedKey: approvalKey,
    expectedKeyId: approvalKeyId,
    clock: sequenceClock('2026-08-25T13:05:00.000Z'),
  })).rejects.toThrow('execution adapter failed');

  await expect(reconcileDesignProvisioningApprovalLifecycle({
    approval,
    plan,
    blueprint: source,
    sourceBytes: bytes,
    authorizationAdapter,
    receiptAdapter,
    reconciliationAdapter: {
      async reconcile() { return { status: 'pending' }; },
    },
    trustedKey: approvalKey,
    expectedKeyId: approvalKeyId,
    clock: sequenceClock('2026-08-25T13:08:00.000Z'),
  })).rejects.toThrow('reconciliation remains pending');
  expect((await authorizationAdapter.readSnapshot(approval.approvalId)).state.claim.status)
    .toBe('claimed');
  expect(await receiptAdapter.read(approval.executionId)).toBeNull();
});

test('sanitizes A4 reconciliation adapter failures and preserves the active claim', async () => {
  const { source, bytes, plan, approval } = executionApproval();
  const authorizationAdapter = createInMemoryDesignProvisioningAuthorizationAdapter(liveContext());
  const receiptAdapter = createInMemoryDesignProvisioningReceiptAdapter();
  await expect(executeDesignProvisioningApprovalLifecycle({
    approval,
    plan,
    blueprint: source,
    sourceBytes: bytes,
    authorizationAdapter,
    receiptAdapter,
    executionAdapter: {
      async execute() { throw new Error('unknown RPC outcome'); },
    },
    trustedKey: approvalKey,
    expectedKeyId: approvalKeyId,
    clock: sequenceClock('2026-08-25T13:05:00.000Z'),
  })).rejects.toThrow('execution adapter failed');

  await expect(reconcileDesignProvisioningApprovalLifecycle({
    approval,
    plan,
    blueprint: source,
    sourceBytes: bytes,
    authorizationAdapter,
    receiptAdapter,
    reconciliationAdapter: {
      async reconcile() { throw new Error('raw ledger response with secret'); },
    },
    trustedKey: approvalKey,
    expectedKeyId: approvalKeyId,
    clock: sequenceClock('2026-08-25T13:08:00.000Z'),
  })).rejects.toThrow('reconciliation adapter failed');
  expect((await authorizationAdapter.readSnapshot(approval.approvalId)).state.claim.status)
    .toBe('claimed');
  expect(await receiptAdapter.read(approval.executionId)).toBeNull();
});

test('allows only the same in-flight execution claim to resume', () => {
  const { source, bytes, plan, approval } = executionApproval();
  const claim = {
    approvalId: approval.approvalId,
    executionId: approval.executionId,
    organizationId: approval.organizationId,
    targetHost: approval.targetHost,
    claimedBy: approval.approvedBy,
    claimedRole: approval.approvedRole,
    planChecksum: plan.checksum,
    status: 'claimed',
    claimedAt: '2026-08-25T13:01:00.000Z',
  };
  expect(verifyDesignProvisioningExecutionApproval(approval, plan, source, bytes, {
    trustedKey: approvalKey,
    expectedKeyId: approvalKeyId,
    expectedOrganizationId: approval.organizationId,
    expectedTargetHost: approval.targetHost,
    now: new Date('2026-08-25T13:05:00.000Z'),
    approvalState: approvalState({ claim }),
  }).claimAction).toBe('resume_existing_claim');

  const reused = structuredClone(approval);
  reused.executionId = '66666666-6666-4666-8666-666666666666';
  expect(() => verifyDesignProvisioningExecutionApproval(reused, plan, source, bytes, {
    trustedKey: approvalKey,
    expectedKeyId: approvalKeyId,
    expectedOrganizationId: approval.organizationId,
    expectedTargetHost: approval.targetHost,
    now: new Date('2026-08-25T13:05:00.000Z'),
    approvalState: approvalState({ claim }),
  })).toThrow('integrity verification failed');

  expect(() => verifyDesignProvisioningExecutionApproval(approval, plan, source, bytes, {
    trustedKey: approvalKey,
    expectedKeyId: approvalKeyId,
    expectedOrganizationId: approval.organizationId,
    expectedTargetHost: approval.targetHost,
    now: new Date('2026-08-25T13:05:00.000Z'),
    approvalState: approvalState({ claim: { ...claim, executionId: '77777777-7777-4777-8777-777777777777' } }),
  })).toThrow('has already been claimed');
  expect(() => verifyDesignProvisioningExecutionApproval(approval, plan, source, bytes, {
    trustedKey: approvalKey,
    expectedKeyId: approvalKeyId,
    expectedOrganizationId: approval.organizationId,
    expectedTargetHost: approval.targetHost,
    now: new Date('2026-08-25T13:05:00.000Z'),
    approvalState: approvalState({
      claim: { ...claim, claimedBy: 'auth-user:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
    }),
  })).toThrow('has already been claimed');
});

test('rejects revoked, completed, expired, wrong-role, and tampered A4 approvals', () => {
  const { source, bytes, plan, approval } = executionApproval();
  const options = (state = approvalState()) => ({
    trustedKey: approvalKey,
    expectedKeyId: approvalKeyId,
    expectedOrganizationId: approval.organizationId,
    expectedTargetHost: approval.targetHost,
    now: new Date('2026-08-25T13:05:00.000Z'),
    approvalState: state,
  });
  expect(() => verifyDesignProvisioningExecutionApproval(
    approval,
    plan,
    source,
    bytes,
    options(approvalState({ revokedAt: '2026-08-25T13:02:00.000Z' })),
  )).toThrow('has been revoked');
  expect(() => verifyDesignProvisioningExecutionApproval(
    approval,
    plan,
    source,
    bytes,
    options(approvalState({ claim: {
      approvalId: approval.approvalId,
      executionId: approval.executionId,
      organizationId: approval.organizationId,
      targetHost: approval.targetHost,
      claimedBy: approval.approvedBy,
      claimedRole: approval.approvedRole,
      planChecksum: plan.checksum,
      status: 'completed',
      claimedAt: '2026-08-25T13:01:00.000Z',
      finalizedAt: '2026-08-25T13:02:00.000Z',
    } })),
  )).toThrow('has already been consumed');
  expect(() => verifyDesignProvisioningExecutionApproval(approval, plan, source, bytes, {
    ...options(),
    now: new Date('2026-08-25T13:16:00.000Z'),
  })).toThrow('expired or not yet valid');
  expect(() => executionApproval(blueprint(), approvalMetadata({ approvedRole: 'operator' }))).toThrow(
    'approval metadata is invalid',
  );
  expect(executionApproval(blueprint(), approvalMetadata({ approvedRole: 'hq' })).approval.approvedRole).toBe('hq');
  expect(() => executionApproval(blueprint(), approvalMetadata({
    expiresAt: '2026-08-25T13:15:00.001Z',
  }))).toThrow('approval time is invalid');
  expect(() => verifyDesignProvisioningExecutionApproval(approval, plan, source, bytes, {
    ...options(),
    trustedKey: 'different-design-provisioning-key-32-bytes-minimum',
  })).toThrow('integrity verification failed');
  expect(() => verifyDesignProvisioningExecutionApproval(approval, plan, source, bytes, {
    ...options(),
    expectedOrganizationId: '88888888-8888-4888-8888-888888888888',
  })).toThrow('is invalid');
  expect(() => verifyDesignProvisioningExecutionApproval(approval, plan, source, bytes, {
    ...options(),
    expectedTargetHost: 'production-secondary',
  })).toThrow('is invalid');
  expect(() => verifyDesignProvisioningExecutionApproval(
    { ...approval, operationCount: approval.operationCount + 1 },
    plan,
    source,
    bytes,
    options(),
  )).toThrow('is invalid');
  expect(() => verifyDesignProvisioningExecutionApproval(approval, plan, source, bytes, {
    ...options(),
    approvalState: { approvalId: approval.approvalId, revokedAt: null },
  })).toThrow('approval state is invalid');
});

test('atomically claims an A4 approval after exact live membership verification', async () => {
  const { source, bytes, plan, approval } = executionApproval();
  const authorizationAdapter = createInMemoryDesignProvisioningAuthorizationAdapter(liveContext());
  const input = {
    approval,
    plan,
    blueprint: source,
    sourceBytes: bytes,
    authorizationAdapter,
    trustedKey: approvalKey,
    expectedKeyId: approvalKeyId,
    now: new Date('2026-08-25T13:05:00.000Z'),
  };

  const concurrentResults = await Promise.all([
    claimDesignProvisioningExecutionApproval(input),
    claimDesignProvisioningExecutionApproval(input),
  ]);
  expect(concurrentResults.map(({ claimDisposition }) => claimDisposition).sort()).toEqual([
    'new', 'reconciled',
  ]);
  expect(concurrentResults.find(({ claimDisposition }) => claimDisposition === 'new')).toEqual({
    status: 'approval_claimed',
    approvalId: approval.approvalId,
    executionId: approval.executionId,
    organizationId: approval.organizationId,
    targetHost: approval.targetHost,
    claimedBy: approval.approvedBy,
    claimedRole: approval.approvedRole,
    claimDisposition: 'new',
    approvalGateVerified: true,
    readyForExecution: false,
    rpcMutationExecuted: false,
    databaseMutationExecuted: false,
  });
  expect((await authorizationAdapter.readSnapshot(approval.approvalId)).state.claim).toMatchObject({
    approvalId: approval.approvalId,
    executionId: approval.executionId,
    claimedBy: approval.approvedBy,
    claimedRole: approval.approvedRole,
    status: 'claimed',
  });
  expect((await claimDesignProvisioningExecutionApproval(input)).claimDisposition).toBe('existing');
});

test('atomically finalizes an A4 claim and reconciles the same terminal outcome', async () => {
  const { source, bytes, plan, approval } = executionApproval();
  const authorizationAdapter = createInMemoryDesignProvisioningAuthorizationAdapter(liveContext());
  const base = {
    approval,
    plan,
    blueprint: source,
    sourceBytes: bytes,
    authorizationAdapter,
    trustedKey: approvalKey,
    expectedKeyId: approvalKeyId,
  };
  await claimDesignProvisioningExecutionApproval({
    ...base,
    now: new Date('2026-08-25T13:05:00.000Z'),
  });

  const concurrentResults = await Promise.all([
    finalizeDesignProvisioningExecutionApproval({
      ...base,
      outcome: 'completed',
      now: new Date('2026-08-25T13:16:00.000Z'),
    }),
    finalizeDesignProvisioningExecutionApproval({
      ...base,
      outcome: 'completed',
      now: new Date('2026-08-25T13:16:00.000Z'),
    }),
  ]);
  expect(concurrentResults.map(({ finalizationDisposition }) => finalizationDisposition).sort()).toEqual([
    'new', 'reconciled',
  ]);
  expect(concurrentResults.find(({ finalizationDisposition }) => finalizationDisposition === 'new')).toEqual({
    status: 'approval_completed',
    approvalId: approval.approvalId,
    executionId: approval.executionId,
    organizationId: approval.organizationId,
    targetHost: approval.targetHost,
    finalizedBy: approval.approvedBy,
    finalizedRole: approval.approvedRole,
    finalizationDisposition: 'new',
    approvalGateVerified: true,
    readyForExecution: false,
    rpcMutationExecuted: false,
    databaseMutationExecuted: false,
  });
  expect((await authorizationAdapter.readSnapshot(approval.approvalId)).state.claim).toMatchObject({
    approvalId: approval.approvalId,
    executionId: approval.executionId,
    status: 'completed',
    finalizedAt: '2026-08-25T13:16:00.000Z',
  });
  expect((await finalizeDesignProvisioningExecutionApproval({
    ...base,
    outcome: 'completed',
    now: new Date('2026-08-25T13:17:00.000Z'),
  })).finalizationDisposition).toBe('existing');
  await expect(finalizeDesignProvisioningExecutionApproval({
    ...base,
    outcome: 'failed',
    now: new Date('2026-08-25T13:17:00.000Z'),
  })).rejects.toThrow('terminal outcome conflicts');
  await expect(claimDesignProvisioningExecutionApproval({
    ...base,
    now: new Date('2026-08-25T13:17:00.000Z'),
  })).rejects.toThrow('expired or not yet valid');

  const failureAdapter = createInMemoryDesignProvisioningAuthorizationAdapter(liveContext());
  const failureBase = { ...base, authorizationAdapter: failureAdapter };
  await claimDesignProvisioningExecutionApproval({
    ...failureBase,
    now: new Date('2026-08-25T13:05:00.000Z'),
  });
  expect(await finalizeDesignProvisioningExecutionApproval({
    ...failureBase,
    outcome: 'failed',
    now: new Date('2026-08-25T13:06:00.000Z'),
  })).toMatchObject({
    status: 'approval_failed',
    finalizationDisposition: 'new',
    rpcMutationExecuted: false,
    databaseMutationExecuted: false,
  });
});

test('fails closed when finalization loses its claim, authorization context, or adapter contract', async () => {
  const { source, bytes, plan, approval } = executionApproval();
  const claimedAt = '2026-08-25T13:05:00.000Z';
  const claimedState = approvalState({
    claim: {
      approvalId: approval.approvalId,
      executionId: approval.executionId,
      organizationId: approval.organizationId,
      targetHost: approval.targetHost,
      claimedBy: approval.approvedBy,
      claimedRole: approval.approvedRole,
      planChecksum: approval.planChecksum,
      status: 'claimed',
      claimedAt,
    },
  });
  const base = {
    approval,
    plan,
    blueprint: source,
    sourceBytes: bytes,
    trustedKey: approvalKey,
    expectedKeyId: approvalKeyId,
    outcome: 'failed',
    now: new Date('2026-08-25T13:06:00.000Z'),
  };

  await expect(finalizeDesignProvisioningExecutionApproval({
    ...base,
    authorizationAdapter: {
      async readSnapshot() { return { state: claimedState, context: liveContext() }; },
      async claim() { throw new Error('claim must not run'); },
    },
  })).rejects.toThrow('authorization adapter is invalid');

  const contextChangedAdapter = {
    async readSnapshot() {
      return { state: structuredClone(claimedState), context: liveContext() };
    },
    async claim() { throw new Error('claim must not run'); },
    async finalize(_expectedSnapshot, terminalClaim) {
      return {
        status: 'finalized',
        state: approvalState({ claim: structuredClone(terminalClaim) }),
        context: liveContext({ membershipActive: false }),
      };
    },
  };
  await expect(finalizeDesignProvisioningExecutionApproval({
    ...base,
    authorizationAdapter: contextChangedAdapter,
  })).rejects.toThrow('live authorization context is invalid');

  const rewrittenFinalizationAdapter = {
    async readSnapshot() {
      return { state: structuredClone(claimedState), context: liveContext() };
    },
    async claim() { throw new Error('claim must not run'); },
    async finalize(_expectedSnapshot, terminalClaim) {
      return {
        status: 'finalized',
        state: approvalState({
          claim: { ...structuredClone(terminalClaim), finalizedAt: '2026-08-25T13:05:30.000Z' },
        }),
        context: liveContext(),
      };
    },
  };
  await expect(finalizeDesignProvisioningExecutionApproval({
    ...base,
    authorizationAdapter: rewrittenFinalizationAdapter,
  })).rejects.toThrow('finalization result is invalid');

  const lostClaimAdapter = {
    async readSnapshot() {
      return { state: structuredClone(claimedState), context: liveContext() };
    },
    async claim() { throw new Error('claim must not run'); },
    async finalize() {
      return { status: 'conflict', state: approvalState(), context: liveContext() };
    },
  };
  await expect(finalizeDesignProvisioningExecutionApproval({
    ...base,
    authorizationAdapter: lostClaimAdapter,
  })).rejects.toThrow('finalization result is invalid');
});

test('reconciles a same-claim CAS response loss and rejects a competing claim or revocation', async () => {
  const { source, bytes, plan, approval } = executionApproval();
  const base = {
    approval,
    plan,
    blueprint: source,
    sourceBytes: bytes,
    trustedKey: approvalKey,
    expectedKeyId: approvalKeyId,
    now: new Date('2026-08-25T13:05:00.000Z'),
  };
  const emptyState = approvalState();
  const responseLossAdapter = {
    async readSnapshot() {
      return { state: structuredClone(emptyState), context: liveContext() };
    },
    async claim(_expectedSnapshot, claim) {
      return {
        status: 'conflict',
        state: approvalState({ claim: structuredClone(claim) }),
        context: liveContext(),
      };
    },
  };
  expect((await claimDesignProvisioningExecutionApproval({
    ...base,
    authorizationAdapter: responseLossAdapter,
  })).claimDisposition).toBe('reconciled');

  const competingAdapter = {
    async readSnapshot() {
      return { state: structuredClone(emptyState), context: liveContext() };
    },
    async claim(_expectedSnapshot, claim) {
      return {
        status: 'conflict',
        state: approvalState({
          claim: { ...claim, executionId: '99999999-9999-4999-8999-999999999999' },
        }),
        context: liveContext(),
      };
    },
  };
  await expect(claimDesignProvisioningExecutionApproval({
    ...base,
    authorizationAdapter: competingAdapter,
  })).rejects.toThrow('has already been claimed');

  const revokedAdapter = {
    async readSnapshot() {
      return { state: structuredClone(emptyState), context: liveContext() };
    },
    async claim() {
      return {
        status: 'conflict',
        state: approvalState({ revokedAt: '2026-08-25T13:04:00.000Z' }),
        context: liveContext(),
      };
    },
  };
  await expect(claimDesignProvisioningExecutionApproval({
    ...base,
    authorizationAdapter: revokedAdapter,
  })).rejects.toThrow('has been revoked');

  const contextChangedAdapter = {
    async readSnapshot() {
      return { state: structuredClone(emptyState), context: liveContext() };
    },
    async claim(_expectedSnapshot, claim) {
      return {
        status: 'claimed',
        state: approvalState({ claim: structuredClone(claim) }),
        context: liveContext({ userId: 'auth-user:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }),
      };
    },
  };
  await expect(claimDesignProvisioningExecutionApproval({
    ...base,
    authorizationAdapter: contextChangedAdapter,
  })).rejects.toThrow('live authorization context is invalid');
});

test('rejects inactive, cross-user, cross-role, and malformed live authorization context before claim', async () => {
  const { source, bytes, plan, approval } = executionApproval();
  let claimCallCount = 0;
  const adapterFor = (context) => ({
    async readSnapshot() { return { state: approvalState(), context }; },
    async claim() {
      claimCallCount += 1;
      throw new Error('claim must not run');
    },
  });
  const base = {
    approval,
    plan,
    blueprint: source,
    sourceBytes: bytes,
    trustedKey: approvalKey,
    expectedKeyId: approvalKeyId,
    now: new Date('2026-08-25T13:05:00.000Z'),
  };
  const invalidContexts = [
    liveContext({ membershipActive: false }),
    liveContext({ organizationActive: false }),
    liveContext({ userId: 'auth-user:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }),
    liveContext({ role: 'hq' }),
    liveContext({ organizationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }),
    liveContext({ targetHost: 'production-secondary' }),
    { ...liveContext(), unknown: true },
  ];
  for (const context of invalidContexts) {
    await expect(claimDesignProvisioningExecutionApproval({
      ...base,
      authorizationAdapter: adapterFor(context),
    })).rejects.toThrow(
      'live authorization context is invalid',
    );
  }
  expect(claimCallCount).toBe(0);
});

test('fails closed on malformed authorization adapter snapshots and claim results', async () => {
  const { source, bytes, plan, approval } = executionApproval();
  const base = {
    approval,
    plan,
    blueprint: source,
    sourceBytes: bytes,
    trustedKey: approvalKey,
    expectedKeyId: approvalKeyId,
    now: new Date('2026-08-25T13:05:00.000Z'),
  };
  await expect(claimDesignProvisioningExecutionApproval({
    ...base,
    authorizationAdapter: {},
  })).rejects.toThrow('authorization adapter is invalid');
  await expect(claimDesignProvisioningExecutionApproval({
    ...base,
    authorizationAdapter: {
      async readSnapshot() {
        return { state: approvalState(), context: liveContext(), unknown: true };
      },
      async claim() { throw new Error('must not run'); },
    },
  })).rejects.toThrow('authorization snapshot is invalid');
  await expect(claimDesignProvisioningExecutionApproval({
    ...base,
    authorizationAdapter: {
      async readSnapshot() {
        return { state: approvalState(), context: liveContext() };
      },
      async claim() {
        return { status: 'claimed', state: approvalState(), context: liveContext() };
      },
    },
  })).rejects.toThrow('authorization claim result is invalid');
});

test('rejects checksum tampering and a self-resealed operation change', () => {
  const source = blueprint();
  const bytes = sourceBytes(source);
  const tampered = structuredClone(buildDesignProvisioningPlan(source, bytes));
  tampered.operations.reverse();
  expect(() => verifyDesignProvisioningPlan(tampered, source, bytes)).toThrow(
    'checksum verification failed',
  );
  tampered.checksum = designProvisioningPlanChecksum(tampered);
  expect(() => verifyDesignProvisioningPlan(tampered, source, bytes)).toThrow(
    'does not match its source blueprint',
  );
  const legacy = structuredClone(buildDesignProvisioningPlan(source, bytes));
  legacy.schemaVersion = 1;
  legacy.checksum = designProvisioningPlanChecksum(legacy);
  expect(() => verifyDesignProvisioningPlan(legacy, source, bytes)).toThrow(
    'checksum verification failed',
  );
});

test('rejects hierarchy, readiness, statistics, and unknown-field drift', () => {
  const invalidValues = [];
  const reversedDates = blueprint();
  reversedDates.sessions[1].heldOn = '2026-09-11';
  invalidValues.push(reversedDates);
  const reorderedReadiness = blueprint();
  reorderedReadiness.assembly.config.readiness.reverse();
  invalidValues.push(reorderedReadiness);
  const damagedStats = blueprint();
  damagedStats.stats.participantCount = 23;
  invalidValues.push(damagedStats);
  const unknownField = blueprint();
  unknownField.assembly.unknown = true;
  invalidValues.push(unknownField);
  const invalidTeamName = blueprint();
  invalidTeamName.sessions[0].teams[0].name = '임의 조';
  invalidValues.push(invalidTeamName);

  for (const value of invalidValues) {
    expect(() => validateDesignBlueprint(value)).toThrow('Design blueprint is invalid');
  }
});

test('writes and verifies external plans without exposing an apply command', () => {
  const directory = mkdtempSync(join(tmpdir(), 'design-provisioning-'));
  const sourcePath = join(directory, 'blueprint.json');
  const outputPath = join(directory, 'plan.json');
  try {
    writeFileSync(sourcePath, sourceBytes());
    expect(runDesignProvisioningCli([
      '--source', sourcePath,
      '--output', outputPath,
    ])).toMatchObject({
      status: 'written',
      operationCount: 7,
      blockerCount: 5,
      readyForExecution: false,
      databaseMutationExecuted: false,
    });
    expect(runDesignProvisioningCli([
      '--verify', outputPath,
      '--source', sourcePath,
    ])).toMatchObject({ status: 'verified', operationCount: 7, blockerCount: 5 });
    expect(() => runDesignProvisioningCli([
      '--source', sourcePath,
      '--output', outputPath,
    ])).toThrow('already exists');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('rejects repository paths before writing a plan', () => {
  expect(() => runDesignProvisioningCli([
    '--source', join(repoRoot, 'src', 'islands', 'platform', 'design', 'design-blueprint-contract.json'),
    '--output', join(tmpdir(), 'must-not-write-design-plan.json'),
  ])).toThrow('must remain outside the repository');
});

test('CLI failures do not echo malformed blueprint content', () => {
  const directory = mkdtempSync(join(tmpdir(), 'design-provisioning-cli-'));
  const sourcePath = join(directory, 'blueprint.json');
  const outputPath = join(directory, 'plan.json');
  try {
    writeFileSync(sourcePath, '{"secret":"do-not-echo"}', 'utf8');
    const result = spawnSync(process.execPath, [
      modulePath,
      '--source', sourcePath,
      '--output', outputPath,
    ], { encoding: 'utf8' });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Design blueprint is invalid');
    expect(result.stderr).not.toContain('do-not-echo');
    expect(result.stderr).not.toContain(sourcePath);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
