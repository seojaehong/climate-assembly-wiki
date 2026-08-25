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
  expect(A4_MIGRATION_ARTIFACTS).toContain('automation/platform-a4-migration-bundle.mjs');
  expect(A4_MIGRATION_ARTIFACTS).toContain('automation/platform-design-provisioning-durable-store.mjs');
  expect(A4_MIGRATION_ARTIFACTS).toContain('automation/tests/platform-a4-migration-bundle.test.mjs');
  expect(A4_MIGRATION_ARTIFACTS).toContain('automation/tests/platform-design-provisioning-plan.test.mjs');
  expect(A4_MIGRATION_ARTIFACTS).toContain('.github/workflows/test.yml');
  expect(A4_MIGRATION_ARTIFACTS).toContain('.gitattributes');
  expect(readFileSync(join(repoRoot, '.gitattributes'), 'utf8')).toContain(
    '.gitattributes text eol=lf\n.github/workflows/*.yml text eol=lf\n',
  );
  expect(bundle.executionOrder).toEqual([
    'read_only_additive_preflight',
    'migration_draft',
    'read_only_activation_preflight',
    'post_apply_verification',
    'semantic_rehearsal',
    'rollback_draft',
  ]);
  expect(verifyA4MigrationBundle(bundle)).toMatchObject({
    status: 'verified',
    artifactCount: 17,
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
      status: 'written', artifactCount: 17, databaseMutationExecuted: false,
    });
    expect(() => runA4MigrationBundleCli(['--output', outputPath])).toThrow('use --force');
    expect(runA4MigrationBundleCli(['--verify', outputPath])).toMatchObject({ status: 'verified' });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('tracked A4 manifest exactly matches every current approval source', () => {
  const tracked = JSON.parse(readFileSync(
    join(repoRoot, 'evaluation', 'platform-a4-migration-bundle.json'),
    'utf8',
  ));
  expect(verifyA4MigrationBundle(tracked)).toMatchObject({
    status: 'verified',
    artifactCount: 17,
    productionApplyApproved: false,
    databaseMutationExecuted: false,
  });
  expect(tracked).toEqual(buildA4MigrationBundle());
});

test('A4 SQL draft keeps preflight and post-apply verification read-only', () => {
  const preflight = readFileSync(join(repoRoot, 'supabase', 'verify', 'design_provisioning_preflight.sql'), 'utf8');
  const postApply = readFileSync(join(repoRoot, 'supabase', 'verify', 'design_provisioning_post_apply.sql'), 'utf8');
  for (const sql of [preflight, postApply]) {
    expect(sql).not.toMatch(/^\s*(?:insert|update|delete|alter|create|drop|grant|revoke)\s+/im);
  }
  expect(preflight).toContain("'readyForAdditiveMigration'");
  expect(preflight).toContain("'readyForActivation'");
  expect(preflight).toContain("'teamOrdinalNullCount'");
  expect(preflight).toContain("'requiresApprovedBackfill'");
  expect(postApply).toContain("has_function_privilege('authenticated', 'climate_vote.design_provision(jsonb,bytea)', 'EXECUTE')");
  expect(postApply).toContain("has_function_privilege('authenticated', 'climate_vote.design_provisioning_status(jsonb)', 'EXECUTE')");
  expect(postApply).toContain('v_existing.plan_checksum <> v_checksum');
  expect(postApply).toContain('extensions.gen_random_bytes(4)');
  expect(postApply).toContain('staffGrantActive');
});

test('A4 migration and rehearsal cover idempotency, conflicts, exhaustion, rollback, and dormant grants', () => {
  const migration = readFileSync(join(repoRoot, 'supabase', 'migrations', 'platform_p3_design_provisioning.sql'), 'utf8');
  const rehearsal = readFileSync(join(repoRoot, 'supabase', 'verify', 'design_provisioning_test.sql'), 'utf8');
  expect(migration).toContain('primary key (org_id, operation_id)');
  expect(migration).toContain("m.role in ('org_admin', 'hq')");
  const mutationBody = migration.slice(
    migration.indexOf('create or replace function climate_vote.design_provision(p_plan jsonb, p_source_bytes bytea)'),
    migration.indexOf('create or replace function climate_vote.design_provisioning_status(p_query jsonb)'),
  );
  const reconciliationBody = migration.slice(
    migration.indexOf('create or replace function climate_vote.design_provisioning_status(p_query jsonb)'),
  );
  expect(mutationBody.indexOf('v_user_id := auth.uid()')).toBeLessThan(
    mutationBody.indexOf("climate_vote.platform_json_canonical(p_plan - 'checksum')"),
  );
  expect(reconciliationBody.indexOf('v_user_id := auth.uid()')).toBeLessThan(
    reconciliationBody.indexOf("jsonb_array_length(p_query -> 'operations')"),
  );
  expect(migration).toContain('design_operation_conflict');
  expect(migration).toContain('pg_catalog.pg_advisory_xact_lock');
  expect(migration).toContain("pg_catalog.hashtextextended('climate_vote.design_provision:' || v_org_id::text, 0)");
  expect(migration).toContain('v_existing.plan_checksum <> v_checksum');
  expect(migration).toContain('design_parent_conflict');
  expect(migration).toContain('design_join_code_exhausted');
  expect(migration).toContain('extensions.gen_random_bytes(4)');
  expect(migration).toContain('v_value < 4294000000');
  expect(migration).not.toContain('floor(random()');
  expect(migration).toContain("count(distinct value ->> 'operationId')");
  expect(migration).toContain("count(distinct value ->> 'ref')");
  expect(migration).toContain("jsonb_typeof(p_plan -> 'readyForExecution') <> 'boolean'");
  expect(migration).toContain("jsonb_typeof(p_plan #> '{sourceBlueprint,bytes}') <> 'number'");
  expect(migration).toContain("jsonb_typeof(p_query -> 'operationCount') <> 'number'");
  expect(migration).toContain("v_operation ->> 'ordinal' <> (v_session_count + 1)::text");
  expect(migration).toContain('v_current_team_count > 0');
  expect(migration).toContain("(v_payload ->> 'name') <> ((v_operation ->> 'ordinal') || '조')");
  expect(migration).toContain('v_current_session_capacity > 100000');
  expect(migration).toContain("to_char(v_session_date, 'YYYY-MM-DD')");
  expect(migration).toContain('v_current_topic_count = 0 or v_current_team_count = 0');
  expect(migration).toContain("and a.status = 'draft'");
  expect(migration).toContain("and s.status = 'draft'");
  expect(migration).toContain("and dt.status = 'draft'");
  expect(migration).toContain("encode(extensions.digest(p_source_bytes, 'sha256'), 'hex')");
  expect(migration).toContain('revoke all on function climate_vote.design_provision(jsonb, bytea)');
  expect(migration).toContain('create or replace function climate_vote.design_provisioning_status(p_query jsonb)');
  expect(migration).toContain('design_reconciliation_conflict');
  expect(migration).toContain('revoke all on function climate_vote.design_provisioning_status(jsonb)');
  expect(rehearsal).toContain('exact replay is not idempotent');
  expect(rehearsal).toContain('concurrent exact plan did not converge to applied and replayed outcomes');
  expect(rehearsal).toContain('cross-plan replay unexpectedly succeeded');
  expect(rehearsal).toContain('pending reconciliation unexpectedly mutated state');
  expect(rehearsal).toContain('completed reconciliation response is unsafe');
  expect(rehearsal).toContain('unauthorized malformed plan was validated before role denial');
  expect(rehearsal).toContain('unauthorized malformed reconciliation query was validated before role denial');
  expect(rehearsal).toContain('disabled team replay unexpectedly exposed its join code');
  expect(rehearsal).toContain('active assembly replay unexpectedly succeeded');
  expect(rehearsal).toContain('active session replay unexpectedly succeeded');
  expect(rehearsal).toContain('open topic replay unexpectedly succeeded');
  expect(rehearsal).toContain('disabled team reconciliation unexpectedly exposed its join code');
  expect(rehearsal).toContain('reconciliation checksum conflict unexpectedly succeeded');
  expect(rehearsal).toContain('partial reconciliation conflict unexpectedly returned pending');
  expect(rehearsal).toContain('source mismatch unexpectedly succeeded');
  expect(rehearsal).toContain('payload conflict unexpectedly succeeded');
  expect(rehearsal).toContain('parent conflict unexpectedly succeeded');
  expect(rehearsal).toContain('join-code exhaustion unexpectedly succeeded');
  expect(rehearsal).toContain('secure join-code generator was not restored');
  expect(rehearsal).toContain('duplicate operation identity unexpectedly succeeded');
  expect(rehearsal).toContain('stringified plan scalar unexpectedly succeeded');
  expect(rehearsal).toContain('malformed plan container unexpectedly succeeded');
  expect(rehearsal).toContain('stringified reconciliation scalar unexpectedly succeeded');
  expect(rehearsal).toContain('invalid calendar date unexpectedly succeeded');
  expect(rehearsal).toContain('noncanonical operation sequence unexpectedly succeeded');
  expect(rehearsal).toContain('noncanonical ordinal unexpectedly succeeded');
  expect(rehearsal).toContain('noncanonical team name unexpectedly succeeded');
  expect(rehearsal).toContain('session capacity overflow unexpectedly succeeded');
  expect(rehearsal).toContain('decreasing session date unexpectedly succeeded');
  expect(rehearsal).toContain('duplicate topic prompt unexpectedly succeeded');
  expect(rehearsal).toContain('incomplete session unexpectedly succeeded');
  expect(rehearsal).toContain('late validation did not roll back mutations');
});

test('legacy lifecycle fixtures are throwaway-only and CI proves both readiness stages', () => {
  const legacyFixture = readFileSync(
    join(repoRoot, 'supabase', 'verify', 'design_provisioning_preflight_legacy_fixture.sql'),
    'utf8',
  );
  const mappingFixture = readFileSync(
    join(repoRoot, 'supabase', 'verify', 'design_provisioning_preflight_mapping_fixture.sql'),
    'utf8',
  );
  const cleanupFixture = readFileSync(
    join(repoRoot, 'supabase', 'verify', 'design_provisioning_rollback_cleanup_fixture.sql'),
    'utf8',
  );
  const workflow = readFileSync(join(repoRoot, '.github', 'workflows', 'test.yml'), 'utf8');
  for (const fixture of [legacyFixture, mappingFixture, cleanupFixture]) {
    expect(fixture).toContain('a4_throwaway_fixture');
    expect(fixture).toContain('current_database() <> \'verify\'');
    expect(fixture).toContain('select 1 / 0 as fixture_guard_failure;');
  }
  expect(workflow).toContain('Unguarded A4 fixture unexpectedly succeeded');
  expect(workflow).toContain('\"status\": \"migration_ready\"');
  expect(workflow).toContain('\"status\": \"activation_ready\"');
  expect(workflow).toContain('\"teamOrdinalNullCount\": 1');
});

test('rollback refuses populated A4 state before any object is removed', () => {
  const rollback = readFileSync(
    join(repoRoot, 'supabase', 'rollbacks', 'platform_p3_design_provisioning_BEFORE.sql'),
    'utf8',
  );
  const workflow = readFileSync(join(repoRoot, '.github', 'workflows', 'test.yml'), 'utf8');
  expect(rollback).toContain('v_populated_ledger_count');
  expect(rollback).toContain('v_populated_ordinal_count');
  expect(rollback).toContain('design_provisioning_rollback_requires_data_plan');
  expect(rollback.indexOf('design_provisioning_rollback_requires_data_plan')).toBeLessThan(
    rollback.indexOf('revoke all on function climate_vote.design_provision'),
  );
  expect(rollback).toContain('drop function if exists climate_vote.design_provisioning_status(jsonb)');
  expect(workflow).toContain('grant execute on function climate_vote.design_provisioning_status(jsonb) to authenticated');
  expect(workflow).toContain('Populated A4 rollback unexpectedly succeeded');
  expect(workflow).toContain('design_provisioning_rollback_requires_data_plan');
  expect(workflow).toContain('design_provisioning_rollback_cleanup_fixture.sql');
});
