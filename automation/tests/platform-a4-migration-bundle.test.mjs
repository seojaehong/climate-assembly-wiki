import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import {
  A4_MIGRATION_ARTIFACTS,
  a4MigrationBundleChecksum,
  buildA4MigrationBundle,
  runA4MigrationBundleCli,
  verifyA4MigrationBundle,
} from '../platform-a4-migration-bundle.mjs';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

test('binds the approved A4 draft while keeping production mutation blocked', () => {
  const bundle = buildA4MigrationBundle();
  expect(bundle).toMatchObject({
    schemaVersion: 1,
    bundleKind: 'platform_a4_migration_draft',
    migrationDraftApproved: true,
    productionApplyApproved: false,
    dryRun: true,
    databaseMutationExecuted: false,
    credentialsRead: false,
    requiresProductionApproval: true,
    boundaries: {
      appliesProductionMigration: false,
      backfillsExistingRows: false,
      changesNotNullConstraints: false,
      createsAuthUsersOrMemberships: false,
      activatesStaffGrants: false,
      connectsProductionExecutor: false,
    },
  });
  expect(bundle.artifacts.map(({ path }) => path)).toEqual(A4_MIGRATION_ARTIFACTS);
  expect(bundle.executionOrder).toEqual([
    'read_only_preflight',
    'migration_draft',
    'post_apply_verification',
    'semantic_rehearsal',
    'rollback_draft',
  ]);
  expect(verifyA4MigrationBundle(bundle)).toMatchObject({
    status: 'verified',
    artifactCount: 8,
    productionApplyApproved: false,
    databaseMutationExecuted: false,
  });
});

test('rejects modified and self-resealed A4 bundles', () => {
  const modified = structuredClone(buildA4MigrationBundle());
  modified.executionOrder.reverse();
  expect(() => verifyA4MigrationBundle(modified)).toThrow('checksum verification failed');

  modified.checksum = a4MigrationBundleChecksum(modified);
  expect(() => verifyA4MigrationBundle(modified)).toThrow('does not match current draft sources');
});

test('writes and verifies an A4 bundle without implicit overwrite', () => {
  const directory = mkdtempSync(join(tmpdir(), 'a4-migration-bundle-'));
  const outputPath = join(directory, 'bundle.json');
  try {
    expect(runA4MigrationBundleCli(['--output', outputPath])).toMatchObject({
      status: 'written', artifactCount: 8, databaseMutationExecuted: false,
    });
    expect(() => runA4MigrationBundleCli(['--output', outputPath])).toThrow('use --force');
    expect(runA4MigrationBundleCli(['--verify', outputPath])).toMatchObject({ status: 'verified' });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('A4 SQL draft keeps preflight and post-apply verification read-only', () => {
  const preflight = readFileSync(join(repoRoot, 'supabase', 'verify', 'design_provisioning_preflight.sql'), 'utf8');
  const postApply = readFileSync(join(repoRoot, 'supabase', 'verify', 'design_provisioning_post_apply.sql'), 'utf8');
  for (const sql of [preflight, postApply]) {
    expect(sql).not.toMatch(/^\s*(?:insert|update|delete|alter|create|drop|grant|revoke)\s+/im);
  }
  expect(preflight).toContain("'teamRowsRequiringOrdinalMappingCount'");
  expect(preflight).toContain("'requiresApprovedBackfill'");
  expect(postApply).toContain("has_function_privilege('authenticated', 'climate_vote.design_provision(jsonb,bytea)', 'EXECUTE')");
  expect(postApply).toContain('staffGrantActive');
});

test('A4 migration and rehearsal cover idempotency, conflicts, exhaustion, rollback, and dormant grants', () => {
  const migration = readFileSync(join(repoRoot, 'supabase', 'migrations', 'platform_p3_design_provisioning.sql'), 'utf8');
  const rehearsal = readFileSync(join(repoRoot, 'supabase', 'verify', 'design_provisioning_test.sql'), 'utf8');
  expect(migration).toContain('primary key (org_id, operation_id)');
  expect(migration).toContain("m.role in ('org_admin', 'hq')");
  expect(migration).toContain('design_operation_conflict');
  expect(migration).toContain('design_parent_conflict');
  expect(migration).toContain('design_join_code_exhausted');
  expect(migration).toContain("encode(extensions.digest(p_source_bytes, 'sha256'), 'hex')");
  expect(migration).toContain('revoke all on function climate_vote.design_provision(jsonb, bytea)');
  expect(rehearsal).toContain('exact replay is not idempotent');
  expect(rehearsal).toContain('source mismatch unexpectedly succeeded');
  expect(rehearsal).toContain('payload conflict unexpectedly succeeded');
  expect(rehearsal).toContain('parent conflict unexpectedly succeeded');
  expect(rehearsal).toContain('join-code exhaustion unexpectedly succeeded');
  expect(rehearsal).toContain('late validation did not roll back mutations');
});
