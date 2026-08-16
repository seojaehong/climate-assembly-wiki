import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import {
  A2_ACTIVATION_OPERATIONS,
  A2_PREREQUISITE_PATHS,
  A2_ROLLBACK_OPERATIONS,
  activationBundleChecksum,
  buildA2ActivationBundle,
  runA2ActivationBundleCli,
  verifyA2ActivationBundle,
} from '../platform-a2-activation-bundle.mjs';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const modulePath = fileURLToPath(new URL('../platform-a2-activation-bundle.mjs', import.meta.url));

function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

test('builds the exact approval-safe A2 activation and rollback order', () => {
  const bundle = buildA2ActivationBundle();

  expect(bundle).toMatchObject({
    schemaVersion: 1,
    planKind: 'platform_a2_activation_bundle',
    dryRun: true,
    databaseMutationExecuted: false,
    credentialsRead: false,
    requiresApproval: true,
    approvalEvidence: {
      schemaVersion: 2,
      sourceTreeCleanRequired: true,
      maximumAgeSeconds: 600,
      targetHostMatchRequired: true,
    },
    executionPolicy: {
      stopOnFailure: true,
      activationRequiresVerifiedReadyEvidence: true,
      rollbackBeforeSchemaRollback: true,
    },
    boundaries: {
      appliesDatabaseChanges: false,
      provisionsAuthUsers: false,
      writesMemberships: false,
      enablesProductionTraffic: false,
    },
  });
  expect(bundle.prerequisiteSchema.map(({ path }) => path)).toEqual(A2_PREREQUISITE_PATHS);
  expect(bundle.activation.map(({ id }) => id)).toEqual(A2_ACTIVATION_OPERATIONS.map(({ id }) => id));
  expect(bundle.rollback.map(({ id }) => id)).toEqual(A2_ROLLBACK_OPERATIONS.map(({ id }) => id));
  expect(bundle.activation[5].variables).toEqual({ expect_staff_grants: 'on' });
  expect(bundle.rollback[1].variables).toEqual({ expect_staff_grants: 'off' });
  expect(bundle.rollback[3].id).toBe('verify_preflight_rpc_removed');
});

test('binds every SQL source to its exact bytes', () => {
  const bundle = buildA2ActivationBundle();
  const artifacts = [
    ...bundle.prerequisiteSchema,
    ...bundle.activation.flatMap((entry) => entry.artifact ? [entry.artifact] : []),
    ...bundle.rollback.flatMap((entry) => entry.artifact ? [entry.artifact] : []),
  ];

  expect(artifacts).toHaveLength(13);
  for (const artifact of artifacts) {
    const absolutePath = join(repoRoot, ...artifact.path.split('/'));
    expect(artifact.sha256).toBe(sha256File(absolutePath));
    expect(artifact.bytes).toBe(readFileSync(absolutePath).length);
  }
});

test('verifies a current bundle without reading credentials or mutating the database', () => {
  const bundle = buildA2ActivationBundle();
  expect(verifyA2ActivationBundle(bundle)).toEqual({
    status: 'verified',
    checksum: bundle.checksum,
    prerequisiteCount: 3,
    activationOperationCount: 6,
    rollbackOperationCount: 4,
    databaseMutationExecuted: false,
  });
});

test('rejects a bundle whose checksum no longer matches its contents', () => {
  const bundle = structuredClone(buildA2ActivationBundle());
  bundle.activation.reverse();
  expect(() => verifyA2ActivationBundle(bundle)).toThrow('checksum verification failed');
});

test('rejects a self-resealed bundle whose operation order differs from current sources', () => {
  const bundle = structuredClone(buildA2ActivationBundle());
  bundle.rollback.reverse();
  bundle.checksum = activationBundleChecksum(bundle);
  expect(() => verifyA2ActivationBundle(bundle)).toThrow('does not match the current approved draft sources');
});

test('fails closed when a required source artifact is unavailable', () => {
  const emptyRoot = mkdtempSync(join(tmpdir(), 'a2-bundle-missing-'));
  try {
    expect(() => buildA2ActivationBundle({ repoRoot: emptyRoot })).toThrow(
      'A2 activation bundle source artifact is unavailable',
    );
  } finally {
    rmSync(emptyRoot, { recursive: true, force: true });
  }
});

test('writes and verifies a bundle while refusing an implicit overwrite', () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), 'a2-bundle-cli-'));
  const outputPath = join(temporaryDirectory, 'bundle.json');
  try {
    const written = runA2ActivationBundleCli(['--output', outputPath]);
    expect(written).toMatchObject({ status: 'written', databaseMutationExecuted: false });
    expect(() => runA2ActivationBundleCli(['--output', outputPath])).toThrow('use --force');
    expect(runA2ActivationBundleCli(['--verify', outputPath])).toMatchObject({
      status: 'verified',
      databaseMutationExecuted: false,
    });
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test('CLI verification does not load database credentials or expose them', () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), 'a2-bundle-child-'));
  const outputPath = join(temporaryDirectory, 'bundle.json');
  writeFileSync(outputPath, `${JSON.stringify(buildA2ActivationBundle())}\n`, 'utf8');
  try {
    const result = spawnSync(process.execPath, [modulePath, '--verify', outputPath], {
      cwd: repoRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        SUPABASE_URL: 'https://should-not-be-used.invalid',
        SUPABASE_SERVICE_ROLE_KEY: 'test-secret-that-must-not-appear',
      },
    });
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ status: 'verified' });
    expect(`${result.stdout}${result.stderr}`).not.toContain('test-secret-that-must-not-appear');
    expect(`${result.stdout}${result.stderr}`).not.toContain('should-not-be-used.invalid');
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test('CI reruns when the tracked activation bundle changes', () => {
  const workflow = readFileSync(join(repoRoot, '.github', 'workflows', 'test.yml'), 'utf8');
  expect(workflow.match(/evaluation\/platform-a2-activation-bundle\.json/g)).toHaveLength(2);
});

test('package scripts bind plan creation and verification to the read-only bundle CLI', () => {
  const packageJson = JSON.parse(readFileSync(join(repoRoot, 'automation', 'package.json'), 'utf8'));
  expect(packageJson.scripts['plan:platform-a2-activation']).toBe('node platform-a2-activation-bundle.mjs');
  expect(packageJson.scripts['verify:platform-a2-activation']).toBe(
    'node platform-a2-activation-bundle.mjs --verify',
  );
});
