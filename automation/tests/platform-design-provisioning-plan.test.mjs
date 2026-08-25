import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import {
  DESIGN_BLUEPRINT_CONTRACT,
  DESIGN_PROVISIONING_BLOCKERS,
  buildDesignProvisioningPlan,
  claimDesignProvisioningExecutionApproval,
  createInMemoryDesignProvisioningAuthorizationAdapter,
  designProvisioningPlanChecksum,
  runDesignProvisioningCli,
  sealDesignProvisioningExecutionApproval,
  validateDesignBlueprint,
  verifyDesignProvisioningExecutionApproval,
  verifyDesignProvisioningPlan,
} from '../platform-design-provisioning-plan.mjs';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const modulePath = fileURLToPath(new URL('../platform-design-provisioning-plan.mjs', import.meta.url));

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
