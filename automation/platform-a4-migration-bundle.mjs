import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const MAX_BUNDLE_BYTES = 256 * 1024;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

export const A4_MIGRATION_ARTIFACTS = Object.freeze([
  'src/islands/platform/design/design-blueprint-contract.json',
  'automation/platform-design-provisioning-plan.mjs',
  'automation/platform-a4-migration-bundle.mjs',
  'automation/tests/platform-design-provisioning-plan.test.mjs',
  'automation/tests/platform-a4-migration-bundle.test.mjs',
  '.github/workflows/test.yml',
  'docs/platform/A4_DESIGN_PROVISIONING_CONTRACT.md',
  'supabase/verify/design_provisioning_preflight.sql',
  'supabase/verify/design_provisioning_preflight_legacy_fixture.sql',
  'supabase/migrations/platform_p3_design_provisioning.sql',
  'supabase/verify/design_provisioning_preflight_mapping_fixture.sql',
  'supabase/verify/design_provisioning_post_apply.sql',
  'supabase/verify/design_provisioning_test.sql',
  'supabase/verify/design_provisioning_rollback_cleanup_fixture.sql',
  'supabase/rollbacks/platform_p3_design_provisioning_BEFORE.sql',
]);

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalValue(value[key])]));
  }
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(canonicalValue(value));
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function artifact(repoRoot, path) {
  let bytes;
  try {
    bytes = readFileSync(resolve(repoRoot, path));
  } catch {
    throw new Error('A4 migration bundle source artifact is unavailable');
  }
  if (bytes.length === 0) throw new Error('A4 migration bundle source artifact is empty');
  return { path, sha256: sha256(bytes), bytes: bytes.length };
}

export function a4MigrationBundleChecksum(bundle) {
  const { checksum: _checksum, ...unsigned } = bundle;
  return sha256(canonicalJson(unsigned));
}

export function buildA4MigrationBundle({ repoRoot = REPO_ROOT } = {}) {
  const unsigned = {
    schemaVersion: 1,
    bundleKind: 'platform_a4_migration_draft',
    migrationDraftApproved: true,
    productionApplyApproved: false,
    dryRun: true,
    databaseMutationExecuted: false,
    credentialsRead: false,
    requiresProductionApproval: true,
    decisions: {
      teamIdentity: ['session_id', 'ordinal'],
      sessionSlugScope: 'global',
      transactionScope: 'whole_plan',
      joinCodeVisibility: 'authorized_staff_response_only',
      existingRowBackfill: 'separate_approval_required',
    },
    executionOrder: [
      'read_only_additive_preflight',
      'migration_draft',
      'read_only_activation_preflight',
      'post_apply_verification',
      'semantic_rehearsal',
      'rollback_draft',
    ],
    artifacts: A4_MIGRATION_ARTIFACTS.map((path) => artifact(repoRoot, path)),
    boundaries: {
      appliesProductionMigration: false,
      backfillsExistingRows: false,
      changesNotNullConstraints: false,
      createsAuthUsersOrMemberships: false,
      activatesStaffGrants: false,
      connectsProductionExecutor: false,
    },
  };
  return { ...unsigned, checksum: a4MigrationBundleChecksum(unsigned) };
}

export function verifyA4MigrationBundle(bundle, { repoRoot = REPO_ROOT } = {}) {
  if (!bundle || typeof bundle !== 'object' || Array.isArray(bundle)
    || bundle.schemaVersion !== 1
    || bundle.bundleKind !== 'platform_a4_migration_draft'
    || bundle.migrationDraftApproved !== true
    || bundle.productionApplyApproved !== false
    || bundle.databaseMutationExecuted !== false
    || !SHA256_PATTERN.test(bundle.checksum ?? '')) {
    throw new Error('Invalid A4 migration bundle');
  }
  if (a4MigrationBundleChecksum(bundle) !== bundle.checksum) {
    throw new Error('A4 migration bundle checksum verification failed');
  }
  const expected = buildA4MigrationBundle({ repoRoot });
  if (canonicalJson(bundle) !== canonicalJson(expected)) {
    throw new Error('A4 migration bundle does not match current draft sources');
  }
  return {
    status: 'verified',
    checksum: bundle.checksum,
    artifactCount: bundle.artifacts.length,
    productionApplyApproved: false,
    databaseMutationExecuted: false,
  };
}

function readBundle(path) {
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    throw new Error('Unable to read A4 migration bundle');
  }
  if (Buffer.byteLength(text, 'utf8') > MAX_BUNDLE_BYTES) {
    throw new Error('A4 migration bundle exceeds the size limit');
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('A4 migration bundle is malformed');
  }
}

export function runA4MigrationBundleCli(args) {
  const outputIndex = args.indexOf('--output');
  const verifyIndex = args.indexOf('--verify');
  const force = args.includes('--force');
  if (verifyIndex >= 0) {
    if (outputIndex >= 0 || force || verifyIndex + 2 !== args.length) {
      throw new Error('Invalid A4 migration bundle verification arguments');
    }
    return verifyA4MigrationBundle(readBundle(resolve(args[verifyIndex + 1])));
  }
  if (outputIndex < 0 || outputIndex + 2 + Number(force) !== args.length) {
    throw new Error('Use --output <path> to create an A4 migration bundle');
  }
  const outputPath = resolve(args[outputIndex + 1]);
  if (existsSync(outputPath) && !force) {
    throw new Error('A4 migration bundle output already exists; use --force to replace it');
  }
  const bundle = buildA4MigrationBundle();
  writeFileSync(outputPath, `${JSON.stringify(bundle, null, 2)}\n`, 'utf8');
  return {
    status: 'written',
    outputPath,
    checksum: bundle.checksum,
    artifactCount: bundle.artifacts.length,
    databaseMutationExecuted: false,
  };
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (invokedPath === import.meta.url) {
  try {
    process.stdout.write(`${JSON.stringify(runA4MigrationBundleCli(process.argv.slice(2)))}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown failure';
    console.error(`platform A4 migration bundle failed: ${message}`);
    process.exitCode = 1;
  }
}
