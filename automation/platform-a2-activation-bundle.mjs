import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const MAX_BUNDLE_BYTES = 256 * 1024;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

export const A2_PREREQUISITE_PATHS = [
  'supabase/migrations/platform_p1_tenancy.sql',
  'supabase/migrations/platform_p1c_org_selection.sql',
  'supabase/migrations/platform_p2_analysis_review.sql',
];

export const A2_ACTIVATION_OPERATIONS = [
  {
    id: 'install_preflight_rpc',
    kind: 'apply_sql',
    path: 'supabase/migrations/platform_p1c_activation_preflight.sql',
  },
  {
    id: 'verify_preflight_rpc',
    kind: 'verify_sql',
    path: 'supabase/verify/activation_preflight_post_apply.sql',
    variables: {},
  },
  {
    id: 'collect_ready_evidence',
    kind: 'automation_command',
    command: 'preflight:platform-activation',
    path: 'automation/platform-activation-preflight.mjs',
  },
  {
    id: 'verify_ready_evidence',
    kind: 'automation_command',
    command: 'verify:platform-activation',
    path: 'automation/platform-activation-preflight.mjs',
  },
  {
    id: 'activate_staff_grants',
    kind: 'apply_sql',
    path: 'supabase/migrations/platform_p1c_org_selection_activation.sql',
  },
  {
    id: 'verify_staff_grants_active',
    kind: 'verify_sql',
    path: 'supabase/verify/org_selection_post_apply.sql',
    variables: { expect_staff_grants: 'on' },
  },
];

export const A2_ROLLBACK_OPERATIONS = [
  {
    id: 'revoke_staff_grants',
    kind: 'rollback_sql',
    path: 'supabase/rollbacks/platform_p1c_org_selection_activation_BEFORE.sql',
  },
  {
    id: 'verify_staff_grants_dormant',
    kind: 'verify_sql',
    path: 'supabase/verify/org_selection_post_apply.sql',
    variables: { expect_staff_grants: 'off' },
  },
  {
    id: 'remove_preflight_rpc',
    kind: 'rollback_sql',
    path: 'supabase/rollbacks/platform_p1c_activation_preflight_BEFORE.sql',
  },
  {
    id: 'verify_preflight_rpc_removed',
    kind: 'verify_sql',
    path: 'supabase/verify/activation_preflight_post_remove.sql',
    variables: {},
  },
];

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
    throw new Error('A2 activation bundle source artifact is unavailable');
  }
  if (bytes.length === 0) throw new Error('A2 activation bundle source artifact is empty');
  return { path, sha256: sha256(bytes), bytes: bytes.length };
}

function operation(repoRoot, definition) {
  if (!definition.path) return { ...definition };
  const { path, ...metadata } = definition;
  return {
    ...metadata,
    artifact: artifact(repoRoot, path),
  };
}

export function activationBundleChecksum(bundle) {
  const { checksum: _checksum, ...unsigned } = bundle;
  return sha256(canonicalJson(unsigned));
}

export function buildA2ActivationBundle({ repoRoot = REPO_ROOT } = {}) {
  const unsigned = {
    schemaVersion: 1,
    planKind: 'platform_a2_activation_bundle',
    dryRun: true,
    databaseMutationExecuted: false,
    credentialsRead: false,
    requiresApproval: true,
    prerequisiteSchema: A2_PREREQUISITE_PATHS.map((path) => artifact(repoRoot, path)),
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
    activation: A2_ACTIVATION_OPERATIONS.map((definition) => operation(repoRoot, definition)),
    rollback: A2_ROLLBACK_OPERATIONS.map((definition) => operation(repoRoot, definition)),
    boundaries: {
      appliesDatabaseChanges: false,
      provisionsAuthUsers: false,
      writesMemberships: false,
      enablesProductionTraffic: false,
    },
  };
  return { ...unsigned, checksum: activationBundleChecksum(unsigned) };
}

function requireBundleShape(bundle) {
  if (!bundle || typeof bundle !== 'object' || Array.isArray(bundle)
    || bundle.schemaVersion !== 1
    || bundle.planKind !== 'platform_a2_activation_bundle'
    || bundle.dryRun !== true
    || bundle.databaseMutationExecuted !== false
    || bundle.credentialsRead !== false
    || bundle.requiresApproval !== true
    || !SHA256_PATTERN.test(bundle.checksum ?? '')) {
    throw new Error('Invalid A2 activation bundle');
  }
}

export function verifyA2ActivationBundle(bundle, { repoRoot = REPO_ROOT } = {}) {
  requireBundleShape(bundle);
  if (activationBundleChecksum(bundle) !== bundle.checksum) {
    throw new Error('A2 activation bundle checksum verification failed');
  }
  const expected = buildA2ActivationBundle({ repoRoot });
  if (canonicalJson(bundle) !== canonicalJson(expected)) {
    throw new Error('A2 activation bundle does not match the current approved draft sources');
  }
  return {
    status: 'verified',
    checksum: bundle.checksum,
    prerequisiteCount: bundle.prerequisiteSchema.length,
    activationOperationCount: bundle.activation.length,
    rollbackOperationCount: bundle.rollback.length,
    databaseMutationExecuted: false,
  };
}

function readBundle(path) {
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    throw new Error('Unable to read A2 activation bundle');
  }
  if (Buffer.byteLength(text, 'utf8') > MAX_BUNDLE_BYTES) {
    throw new Error('A2 activation bundle exceeds the size limit');
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('A2 activation bundle is malformed');
  }
}

export function runA2ActivationBundleCli(args) {
  const verifyIndex = args.indexOf('--verify');
  const outputIndex = args.indexOf('--output');
  const force = args.includes('--force');
  if (verifyIndex >= 0) {
    if (outputIndex >= 0 || force || verifyIndex + 2 !== args.length) {
      throw new Error('Invalid A2 activation bundle verification arguments');
    }
    return verifyA2ActivationBundle(readBundle(resolve(args[verifyIndex + 1])));
  }
  if (outputIndex < 0 || outputIndex + 2 + Number(force) !== args.length) {
    throw new Error('Use --output <path> to create an A2 activation bundle');
  }
  const outputPath = resolve(args[outputIndex + 1]);
  if (existsSync(outputPath) && !force) {
    throw new Error('A2 activation bundle output already exists; use --force to replace it');
  }
  const bundle = buildA2ActivationBundle();
  writeFileSync(outputPath, `${JSON.stringify(bundle, null, 2)}\n`, 'utf8');
  return {
    status: 'written',
    outputPath,
    checksum: bundle.checksum,
    databaseMutationExecuted: false,
  };
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (invokedPath === import.meta.url) {
  try {
    process.stdout.write(`${JSON.stringify(runA2ActivationBundleCli(process.argv.slice(2)))}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown failure';
    console.error(`platform A2 activation bundle failed: ${message}`);
    process.exitCode = 1;
  }
}
