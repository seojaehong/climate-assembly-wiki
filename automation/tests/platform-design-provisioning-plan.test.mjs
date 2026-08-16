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
  designProvisioningPlanChecksum,
  runDesignProvisioningCli,
  validateDesignBlueprint,
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
    'schema.session_base_contract_not_migration_owned',
    'schema.team_stable_identity_not_approved',
    'server.design_provisioning_rpc_not_implemented',
    'server.idempotent_operation_ledger_not_implemented',
    'team.join_code_generation_contract_not_approved',
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
