import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import {
  A4_MIGRATION_ARTIFACTS,
  a4MigrationBundleChecksum,
  buildA4MigrationBundle,
  canonicalA4ArtifactBytes,
  runA4MigrationBundleCli,
  verifyA4MigrationBundle,
} from '../platform-a4-migration-bundle.mjs';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

test('canonicalizes Git text line endings without hiding UTF-8 content changes', () => {
  expect(canonicalA4ArtifactBytes(Buffer.from('alpha\r\nbeta\r\n')))
    .toEqual(canonicalA4ArtifactBytes(Buffer.from('alpha\nbeta\n')));
  expect(canonicalA4ArtifactBytes(Buffer.from('alpha\ngamma\n')))
    .not.toEqual(canonicalA4ArtifactBytes(Buffer.from('alpha\nbeta\n')));
  expect(() => canonicalA4ArtifactBytes(Buffer.from([0xc3, 0x28])))
    .toThrow('not UTF-8 text');
});

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
  expect(A4_MIGRATION_ARTIFACTS).toContain('automation/platform-design-provisioning-key-registry.mjs');
  expect(A4_MIGRATION_ARTIFACTS).toContain('automation/platform-design-provisioning-supabase-adapter.mjs');
  expect(A4_MIGRATION_ARTIFACTS).toContain('automation/tests/platform-a4-migration-bundle.test.mjs');
  expect(A4_MIGRATION_ARTIFACTS).toContain('automation/tests/platform-design-provisioning-plan.test.mjs');
  expect(A4_MIGRATION_ARTIFACTS).toContain(
    'automation/tests/platform-design-provisioning-supabase-adapter.test.mjs',
  );
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
    artifactCount: 20,
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
      status: 'written', artifactCount: 20, databaseMutationExecuted: false,
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
    artifactCount: 20,
    productionApplyApproved: false,
    databaseMutationExecuted: false,
  });
  expect(tracked).toEqual(buildA4MigrationBundle());
});

test('A4 SQL draft keeps preflight and post-apply verification read-only', () => {
  const migration = readFileSync(join(repoRoot, 'supabase', 'migrations', 'platform_p3_design_provisioning.sql'), 'utf8');
  const rollback = readFileSync(join(repoRoot, 'supabase', 'rollbacks', 'platform_p3_design_provisioning_BEFORE.sql'), 'utf8');
  const preflight = readFileSync(join(repoRoot, 'supabase', 'verify', 'design_provisioning_preflight.sql'), 'utf8');
  const postApply = readFileSync(join(repoRoot, 'supabase', 'verify', 'design_provisioning_post_apply.sql'), 'utf8');
  for (const sql of [preflight, postApply]) {
    expect(sql).not.toMatch(/^\s*(?:insert|update|delete|alter|create|drop|grant|revoke)\s+/im);
  }
  expect(preflight).toContain("'readyForAdditiveMigration'");
  expect(preflight).toContain("'readyForActivation'");
  expect(preflight).toContain("'teamOrdinalNullCount'");
  expect(preflight).toContain("'requiresApprovedBackfill'");
  const runtimeRoles = 'public,anon,authenticated,authenticator,service_role';
  const normalizedMigration = migration.replace(/\s+/g, ' ').replace(/,\s*/g, ',');
  const normalizedRollback = rollback.replace(/\s+/g, ' ').replace(/,\s*/g, ',');
  const functionSignatures = [
    'climate_vote.platform_json_canonical(jsonb)',
    'climate_vote.platform_sha256_hex(text)',
    'climate_vote.platform_design_join_code()',
    'climate_vote.platform_design_authorization_revision()',
    'climate_vote.design_provision(jsonb,bytea)',
    'climate_vote.design_provision(jsonb,bytea,jsonb)',
    'climate_vote.design_provisioning_status(jsonb)',
    'climate_vote.design_provisioning_status(jsonb,jsonb)',
  ];
  expect(normalizedMigration).toContain(
    `revoke all on climate_vote.design_provisioning_operation from ${runtimeRoles};`,
  );
  const schemaCreateRevoke = `revoke create on schema climate_vote from ${runtimeRoles};`;
  expect(normalizedMigration).toContain(schemaCreateRevoke);
  expect(normalizedRollback).toContain(schemaCreateRevoke);
  for (const signature of functionSignatures) {
    const revoke = `revoke all on function ${signature} from ${runtimeRoles};`;
    expect(normalizedMigration).toContain(revoke);
    expect(normalizedRollback).toContain(revoke);
  }
  for (const role of ['public', 'anon', 'authenticated', 'authenticator', 'service_role']) {
    expect(postApply).toContain(`('${role}')`);
  }
  for (const signature of functionSignatures) {
    expect(postApply).toContain(`('${signature}')`);
  }
  expect(postApply).toContain(
    "has_function_privilege(roles.role_name, function_signatures.signature, 'EXECUTE')",
  );
  for (const privilege of [
    'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER',
  ]) {
    expect(postApply).toContain(`('${privilege}')`);
  }
  expect(postApply).toContain('where has_table_privilege(roles.role_name,');
  expect(postApply).toContain(
    "'climate_vote.design_provisioning_operation', privileges.privilege_name)",
  );
  expect(postApply).toContain('where has_any_column_privilege(roles.role_name,');
  expect(postApply).toContain(
    "'climate_vote.design_provisioning_operation', column_privileges.privilege_name)",
  );
  expect(postApply).toContain(
    "has_schema_privilege(roles.role_name, 'climate_vote', 'CREATE')",
  );
  expect(postApply).toContain('checksum helper contract is unsafe');
  const exactFunctionConfigs = [
    ["v_config is distinct from array['search_path=pg_catalog']::text[]", 1],
    ["v_config is distinct from array['search_path=pg_catalog, extensions']::text[]", 2],
    [
      "v_config is distinct from array['search_path=pg_catalog, climate_vote, auth', 'row_security=off']::text[]",
      1,
    ],
    [
      "v_config is distinct from array['search_path=pg_catalog, climate_vote, auth, extensions', 'row_security=off']::text[]",
      4,
    ],
  ];
  for (const [configContract, expectedCount] of exactFunctionConfigs) {
    expect(postApply.split(configContract).length - 1).toBe(expectedCount);
  }
  expect(postApply).not.toContain('= any(v_config)');
  expect(postApply).toContain("p.proname = 'platform_json_canonical'");
  expect(postApply).toContain("p.proname = 'platform_sha256_hex'");
  expect(postApply).toContain('p.proisstrict');
  expect(postApply).toContain("climate_vote.platform_json_canonical('{\"b\":1,\"a\":[true,null]}'::jsonb)");
  expect(postApply).toContain("climate_vote.platform_sha256_hex('abc')");
  expect(postApply).toContain('owner contract is unsafe');
  expect(postApply).toContain('pg_get_userbyid(v_owner_oid)');
  expect(postApply).toContain('(r.rolsuper or r.rolbypassrls)');
  expect(postApply).toContain('p.proowner <> v_owner_oid');
  expect(postApply).toContain('v_existing.plan_checksum <> v_checksum');
  expect(postApply).toContain("('team', 'platform_team_capacity_positive', 'c'");
  expect(postApply).toContain("'CHECK ((capacity > 0))'");
  expect(postApply).toContain('c.conrelid = r.oid and c.conname = expected.constraint_name');
  expect(postApply).toContain('pg_get_constraintdef(c.oid, false) <> expected.definition');
  expect(postApply).toContain("('team', 'ordinal', 'integer', false, null::text)");
  expect(postApply).toContain("('design_provisioning_operation', 'applied_at', 'timestamp with time zone', true");
  expect(postApply).toContain("('design_provisioning_operation', 'source_blueprint_sha256', 'text', true");
  expect(postApply).toContain("('design_provisioning_operation', 'source_blueprint_bytes', 'integer', true");
  expect(postApply).toContain("'platform_design_operation_source_sha256_shape'");
  expect(postApply).toContain("'platform_design_operation_source_bytes_range'");
  expect(postApply).toContain("('design_provisioning_operation', 'approval_id', 'uuid', false");
  expect(postApply).toContain("('design_provisioning_operation', 'execution_id', 'uuid', false");
  expect(postApply).toContain("('design_provisioning_operation', 'approved_plan_checksum', 'text', false");
  expect(postApply).toContain("('design_provisioning_operation', 'authorization_revision', 'text', false");
  expect(postApply).toContain("'platform_design_operation_execution_binding_complete'");
  expect(postApply).toContain('format_type(a.atttypid, a.atttypmod) <> expected.data_type');
  expect(postApply).toContain("('session', 'FOREIGN KEY (assembly_id) REFERENCES assembly(id)')");
  expect(postApply).toContain('foreign key contract is unsafe');
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
  expect(migration).toContain("v_existing.source_blueprint_sha256 <> p_plan #>> '{sourceBlueprint,sha256}'");
  expect(migration).toContain("v_existing.source_blueprint_bytes <> (p_plan #>> '{sourceBlueprint,bytes}')::integer");
  expect(migration).toContain('design_execution_binding_conflict');
  expect(migration).toContain('approved_plan_checksum = p_authorization_fence ->> \'approvedPlanChecksum\'');
  expect(migration).toContain('ledger.authorization_revision is distinct from v_authorization_revision');
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
  expect(rehearsal).toContain('fenced reconciliation response did not echo its authorization revision');
  expect(rehearsal).toContain('completed reconciliation response is unsafe');
  expect(rehearsal).toContain('unauthorized malformed plan was validated before role denial');
  expect(rehearsal).toContain('unauthorized malformed reconciliation query was validated before role denial');
  expect(rehearsal).toContain('disabled team replay unexpectedly exposed its join code');
  expect(rehearsal).toContain('active assembly replay unexpectedly succeeded');
  expect(rehearsal).toContain('active session replay unexpectedly succeeded');
  expect(rehearsal).toContain('open topic replay unexpectedly succeeded');
  expect(rehearsal).toContain('disabled team reconciliation unexpectedly exposed its join code');
  expect(rehearsal).toContain('reconciliation checksum conflict unexpectedly succeeded');
  expect(rehearsal).toContain('cross-execution mutation replay unexpectedly succeeded');
  expect(rehearsal).toContain('cross-approval-checksum mutation replay unexpectedly succeeded');
  expect(rehearsal).toContain('reconciliation approved checksum conflict unexpectedly succeeded');
  expect(rehearsal).toContain('reconciliation execution identity conflict unexpectedly succeeded');
  expect(rehearsal).toContain('unbound ledger reconciliation unexpectedly succeeded');
  expect(rehearsal).toContain('reconciliation source digest conflict unexpectedly succeeded');
  expect(rehearsal).toContain('reconciliation source length conflict unexpectedly succeeded');
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

test('A4 dormant RPC draft accepts and echoes an exact live authorization revision fence', () => {
  const migration = readFileSync(
    join(repoRoot, 'supabase', 'migrations', 'platform_p3_design_provisioning.sql'),
    'utf8',
  ).replace(/\r\n/g, '\n');
  const rehearsal = readFileSync(
    join(repoRoot, 'supabase', 'verify', 'design_provisioning_test.sql'),
    'utf8',
  );
  const postApply = readFileSync(
    join(repoRoot, 'supabase', 'verify', 'design_provisioning_post_apply.sql'),
    'utf8',
  );
  const rollback = readFileSync(
    join(repoRoot, 'supabase', 'rollbacks', 'platform_p3_design_provisioning_BEFORE.sql'),
    'utf8',
  );

  expect(migration).toContain('platform_design_authorization_revision()');
  expect(migration).toMatch(
    /design_provision\(\s*p_plan jsonb,\s*p_source_bytes bytea,\s*p_authorization_fence jsonb\s*\)/,
  );
  expect(migration).toMatch(
    /design_provisioning_status\(\s*p_query jsonb,\s*p_authorization_fence jsonb\s*\)/,
  );
  expect(migration).toContain("'platform_design_provisioning_authorization_fence'");
  expect(migration).toContain("'approvedPlanChecksum'");
  expect(migration).toContain("raise exception using message = 'design_authorization_stale'");
  expect(migration).toContain("'authorizationRevision', v_authorization_revision");
  expect(migration).toContain(
    'revoke all on function climate_vote.design_provision(jsonb, bytea, jsonb)',
  );
  expect(migration).toContain(
    'revoke all on function climate_vote.design_provisioning_status(jsonb, jsonb)',
  );
  const fencedStatusBody = migration.slice(
    migration.indexOf('create or replace function climate_vote.design_provisioning_status(\n  p_query jsonb,'),
  );
  expect(fencedStatusBody).toContain('volatile\nsecurity definer');
  expect(fencedStatusBody).toContain('for share of m, o');

  expect(rehearsal).toContain('stale mutation authorization fence unexpectedly succeeded');
  expect(rehearsal).toContain('fenced provisioning response did not echo its authorization revision');
  expect(rehearsal).toContain('stale reconciliation authorization fence unexpectedly succeeded');
  expect(rehearsal).toContain('cross-execution reconciliation fence unexpectedly succeeded');
  expect(rehearsal).toContain('membership ABA revision unexpectedly remained reusable');
  expect(rehearsal).toContain('membership ABA mutation fence unexpectedly succeeded');
  expect(rehearsal).toContain('membership ABA reconciliation fence unexpectedly succeeded');
  expect(rehearsal).toContain('fenced reconciliation response did not echo its authorization revision');
  expect(postApply).toContain("to_regprocedure('climate_vote.design_provision(jsonb,bytea,jsonb)')");
  expect(postApply).toContain(
    "('climate_vote.design_provision(jsonb,bytea,jsonb)')",
  );
  expect(migration).toMatch(
    /\(p_authorization_fence ->> 'executionId'\)\s+is distinct from \(p_query ->> 'executionId'\)/,
  );
  expect(migration).toMatch(
    /\(p_authorization_fence ->> 'approvedPlanChecksum'\)\s+is distinct from \(p_query ->> 'approvedPlanChecksum'\)/,
  );
  expect(rollback).toContain(
    'drop function if exists climate_vote.design_provision(jsonb, bytea, jsonb)',
  );
  expect(rollback).toContain(
    'drop function if exists climate_vote.design_provisioning_status(jsonb, jsonb)',
  );
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
  expect(workflow).toContain('Unsafe A4 internal helper grant unexpectedly passed verification');
  expect(workflow).toContain('Unsafe A4 ledger table grant unexpectedly passed verification');
  expect(workflow).toContain('Unsafe A4 ledger column grant unexpectedly passed verification');
  expect(workflow).toContain('Altered A4 checksum helper unexpectedly passed verification');
  expect(workflow).toContain('Untrusted A4 function owner unexpectedly passed verification');
  expect(workflow).toContain('Untrusted A4 unified owner unexpectedly passed verification');
  expect(workflow).toContain('Unsafe A4 authenticator function grant unexpectedly passed verification');
  expect(workflow).toContain('for ledger_role in public anon authenticated authenticator service_role');
  expect(workflow).toContain('for schema_role in public anon authenticated authenticator service_role');
  expect(workflow).toContain('Unsafe A4 schema CREATE grant unexpectedly passed verification');
  expect(workflow).toContain('Altered A4 function configuration unexpectedly passed verification');
  expect(workflow).toContain('set session_replication_role = replica');
  expect(workflow).toContain('Shadow A4 constraint unexpectedly passed verification');
  expect(workflow).toContain('Wrong A4 constraint definition unexpectedly passed verification');
  expect(workflow).toContain('Wrong A4 column type unexpectedly passed verification');
  expect(workflow).toContain('Missing A4 foreign key unexpectedly passed verification');
  expect(workflow).toContain('Populated A4 rollback unexpectedly succeeded');
  expect(workflow).toContain('design_provisioning_rollback_requires_data_plan');
  expect(workflow).toContain('design_provisioning_rollback_cleanup_fixture.sql');
});

test('A4 mutation RPC holds authorization rows through the whole transaction', () => {
  const migration = readFileSync(
    join(repoRoot, 'supabase', 'migrations', 'platform_p3_design_provisioning.sql'),
    'utf8',
  );
  const postApply = readFileSync(
    join(repoRoot, 'supabase', 'verify', 'design_provisioning_post_apply.sql'),
    'utf8',
  );
  const rehearsal = readFileSync(
    join(repoRoot, 'supabase', 'verify', 'design_provisioning_test.sql'),
    'utf8',
  );
  const cleanupFixture = readFileSync(
    join(repoRoot, 'supabase', 'verify', 'design_provisioning_rollback_cleanup_fixture.sql'),
    'utf8',
  );

  expect(migration).toContain('for share of m, o;');
  expect(postApply).toContain("v_definition not like '%for share of m, o%'");
  expect(rehearsal).toContain(
    'A4 semantic test failed: membership authorization lock unexpectedly released',
  );
  expect(rehearsal).toContain(
    'A4 semantic test failed: organization authorization lock unexpectedly released',
  );
  expect(rehearsal).toContain('canceling statement due to lock timeout');
  expect(cleanupFixture).toContain("'a4-membership-lock'");
  expect(cleanupFixture).toContain("'a4-organization-lock'");
});
