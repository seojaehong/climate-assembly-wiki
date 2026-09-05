import { spawnSync } from 'node:child_process';
import {
  createHash,
  generateKeyPairSync,
} from 'node:crypto';
import {
  lstat,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';
import {
  CANONICAL_0912_APPROVAL_SCOPES,
  CANONICAL_0912_GATE_IDS,
  CANONICAL_0912_OPERATOR_BINDING_PATHS,
  CANONICAL_0912_ROLLOUT_IDS,
  OperatorEvidenceValidationError,
  canonical0912OperatorReceiptPath,
  validate0912OperatorEvidence,
} from './0912-operator-evidence.mjs';
import {
  BackupRestoreEvidenceValidationError,
  validate0912BackupEvidence,
  validate0912RestoreEvidence,
} from './0912-backup-restore-evidence.mjs';
import {
  EVIDENCE_SIGNING_DOMAINS,
  EvidenceSigningError,
  parseSigningArguments,
  sign0912Evidence,
} from './0912-sign-evidence.mjs';

const SCRIPT_PATH = fileURLToPath(new URL('./0912-sign-evidence.mjs', import.meta.url));
const REPO_ROOT = resolve(dirname(SCRIPT_PATH), '..');
const SOURCE_COMMIT = 'a'.repeat(40);
const TARGET_REVISION = 'b'.repeat(40);
const RELEASE_RUN_ID = '11111111-1111-4111-8111-111111111111';
const ARCHIVE_SHA256 = 'c'.repeat(64);
const LATEST_SHA256 = 'd'.repeat(64);
const ARCHIVE_OBJECT_REF = 's3://climate-backups/0912/snapshot-77.dump?versionId=version-77';
const ARCHIVE_SIZE_BYTES = 4096;
const PRODUCTION_ENVIRONMENT = Object.freeze({
  id: 'climate-assembly-production',
  webOrigin: 'https://climate-assembly.org',
  supabaseProjectRef: 'abcdefghijklmnopqrst',
  databaseTlsSpkiSha256: '9'.repeat(64),
  organizationId: '22222222-2222-4222-8222-222222222222',
  assemblyId: '33333333-3333-4333-8333-333333333333',
  sessionId: '44444444-4444-4444-8444-444444444444',
  sessionSlug: '0912-deliberation',
});
const TEMPLATE_PATHS = Object.freeze({
  operator: join(REPO_ROOT, 'evaluation', '0912-13-operator-log.template.json'),
  backup: join(REPO_ROOT, 'evaluation', '0912-13-backup-manifest.template.json'),
  restore: join(REPO_ROOT, 'evaluation', '0912-13-restore-report.template.json'),
});
const APPROVAL_GROUPS = Object.freeze(CANONICAL_0912_APPROVAL_SCOPES.map((entry) => (
  [entry.scope, entry.rolloutStepIds, entry.gateIds]
)));
const GATE_EXECUTION_TIMES = Object.freeze([
  [0, 0], [0, 1], [0, 2], [0, 3], [0, 4], [0, 5], [0, 6], [0, 7], [0, 8],
  [0, 26], [0, 36], [0, 46], [0, 56], [1, 5], [1, 6], [1, 10], [1, 25],
  [1, 30], [2, 15], [2, 16], [2, 17], [2, 20], [2, 45], [2, 46], [2, 50],
  [3, 10], [3, 35], [3, 36], [3, 37], [3, 38], [3, 39], [3, 40], [3, 42],
  [3, 43], [3, 46],
]);
const ROLLOUT_EXECUTION_TIMES = Object.freeze([
  [0, 20], [0, 30], [0, 40], [0, 50], [1, 0], [1, 20], [1, 40], [1, 50],
  [2, 10], [2, 30], [2, 40], [3, 0], [3, 20], [3, 30],
]);
const APPROVAL_EXECUTION_TIMES = Object.freeze([
  [0, 21], [0, 31], [0, 41], [0, 51], [1, 7], [1, 27],
  [1, 55], [2, 18], [2, 47], [3, 5], [3, 41], [3, 45],
]);
const GATE_MEASUREMENTS = Object.freeze({
  'source-clean': ['source_tree_clean', true, true, 'boolean'],
  'root-vitest': ['root_vitest_failed_test_count', 0, 0, 'tests'],
  'automation-vitest': ['automation_vitest_failed_test_count', 0, 0, 'tests'],
  'astro-check-production-build': ['astro_check_build_error_count', 0, 0, 'errors'],
  'rpc-contract': ['rpc_contract_mismatch_count', 0, 0, 'mismatches'],
  'traceability-report': ['traceability_failed_check_count', 0, 0, 'checks'],
  'security-diff-review': ['unresolved_blocking_security_finding_count', 0, 0, 'findings'],
  'postgres-p1a-p2a-disposable': ['disposable_postgres_failed_check_count', 0, 0, 'checks'],
  'roster-canonical-review': ['canonical_roster_team_count', 15, 15, 'teams'],
  'named-hq-operators-ready': ['unverified_named_hq_operator_count', 0, 0, 'operators'],
  'hq-join-code-pre-rotation': ['rotation_target_team_count', 15, 15, 'teams'],
  'join-code-throttle-edge-probe': [
    'untrusted_forwarding_header_acceptance_count', 0, 0, 'requests',
  ],
  'deployed-revision-match': [
    'deployed_revision', TARGET_REVISION, TARGET_REVISION, 'git-commit',
  ],
  'production-routine-acl-inventory': [
    'unapproved_executable_routine_count', 0, 0, 'routines',
  ],
  'p2a-positive-legacy-negative-verification': [
    'legacy_positive_execution_count', 0, 0, 'calls',
  ],
  'p2a-token-revocation-verification': [
    'p2a_token_revocation_failed_check_count', 0, 0, 'checks',
  ],
  'field-rehearsal': ['field_rehearsal_failed_check_count', 0, 0, 'checks'],
  'hq-field-rehearsal': ['hq_rehearsal_failed_check_count', 0, 0, 'checks'],
  'onsite-device-network-rehearsal': ['onsite_failed_scenario_count', 0, 0, 'scenarios'],
  'mod-hq-automated-a11y': [
    'automated_accessibility_violation_count', 0, 0, 'violations',
  ],
  'mod-hq-manual-a11y': ['manual_accessibility_failed_case_count', 0, 0, 'cases'],
  backup: ['verified_backup_snapshot_count', 1, 1, 'snapshots'],
  'restore-isolated': ['isolated_restore_mismatch_count', 0, 0, 'mismatches'],
  'final-token-cleanup': ['remaining_temporary_event_token_count', 0, 0, 'tokens'],
});
const ROLLOUT_MEASUREMENTS = Object.freeze({
  'session-roster-review': ['rollout_approved_roster_team_count', 15, 15, 'teams'],
  'secure-session-team-seed': ['rollout_active_team_count', 15, 15, 'teams'],
  's20-draft-topics': ['rollout_draft_topic_count', 6, 6, 'topics'],
  'hq-rotate-join-codes': ['rollout_rotated_team_count', 15, 15, 'teams'],
  'maintenance-deploy-token-staff-client': [
    'rollout_deployed_revision', TARGET_REVISION, TARGET_REVISION, 'git-commit',
  ],
  'p2a-positive-legacy-negative-verify': [
    'rollout_legacy_positive_execution_count', 0, 0, 'calls',
  ],
  'p3-design-provisioning': [
    'rollout_p3_apply_and_post_apply_verified', true, true, 'boolean',
  ],
  'p4-audit-log': ['rollout_p4_apply_and_audit_verified', true, true, 'boolean'],
  'post-p4-legacy-negative-and-final-status': [
    'rollout_final_status_tuple',
    '1-session/15-teams/6-topics',
    '1-session/15-teams/6-topics',
    'state',
  ],
});

let testDirectory;
let privateKeyPath;
let publicKey;

function timestamp(nowMs, offsetMs) {
  return new Date(nowMs + offsetMs).toISOString();
}

function approvalIdForStep(stepId) {
  const group = APPROVAL_GROUPS.find(([, stepIds]) => stepIds.includes(stepId));
  return group ? `approval-${group[0]}` : null;
}

function approvalIdForGate(gateId) {
  const group = APPROVAL_GROUPS.find(([, , gateIds]) => gateIds.includes(gateId));
  return group ? `approval-${group[0]}` : null;
}

function noProductionAccess(environmentId = null) {
  return {
    mode: 'no-production-db',
    connectionCount: 0,
    mutationCount: 0,
    approvalId: null,
    environmentId,
  };
}

function readOnlyAccess() {
  return {
    mode: 'read-only-observation',
    connectionCount: 1,
    mutationCount: 0,
    approvalId: null,
    environmentId: PRODUCTION_ENVIRONMENT.id,
  };
}

function approvedDatabaseAccess(approvalId) {
  return {
    mode: 'approved-db-rollout',
    connectionCount: 1,
    mutationCount: 1,
    approvalId,
    environmentId: PRODUCTION_ENVIRONMENT.id,
  };
}

function approvedNonDatabaseAccess(approvalId) {
  return {
    mode: 'approved-non-db-rollout',
    connectionCount: 0,
    mutationCount: 0,
    approvalId,
    environmentId: PRODUCTION_ENVIRONMENT.id,
  };
}

function measurement(kind, id) {
  const configured = kind === 'gate' ? GATE_MEASUREMENTS[id] : ROLLOUT_MEASUREMENTS[id];
  if (configured) {
    const [name, expected, observed, unit] = configured;
    return { name, expected, observed, unit };
  }
  return {
    name: `${kind}_${id.replaceAll('-', '_')}_result`,
    expected: 'pass',
    observed: 'pass',
    unit: 'result',
  };
}

function gateAccess(id) {
  if (id === 'production-routine-acl-inventory') return readOnlyAccess();
  if (id === 'backup' || id === 'final-token-cleanup') {
    return approvedDatabaseAccess(approvalIdForGate(id));
  }
  if (id === 'join-code-throttle-edge-probe'
    || id === 'maintenance-token-staff-client-deployed'
    || id === 'deployed-revision-match'
    || id === 'onsite-device-network-rehearsal') {
    return noProductionAccess(PRODUCTION_ENVIRONMENT.id);
  }
  return noProductionAccess();
}

function rolloutAccess(id) {
  if (id === 'session-roster-review') return noProductionAccess();
  const approvalId = approvalIdForStep(id);
  return id === 'maintenance-deploy-token-staff-client'
    ? approvedNonDatabaseAccess(approvalId)
    : approvedDatabaseAccess(approvalId);
}

function execution(kind, id, index, nowMs) {
  const [hour, minute] = kind === 'gate'
    ? GATE_EXECUTION_TIMES[index]
    : ROLLOUT_EXECUTION_TIMES[index];
  const executedAt = timestamp(nowMs, -300_000 + (((hour * 60) + minute) * 1_000));
  return {
    id,
    status: 'pass',
    executedAt,
    evidence: {
      type: `0912-${kind}-${id}-v1`,
      reference: canonical0912OperatorReceiptPath(kind, index, id),
      measurement: measurement(kind, id),
      productionAccess: kind === 'gate' ? gateAccess(id) : rolloutAccess(id),
    },
  };
}

function commonControl(name, index, nowMs, productionAccess, details) {
  return {
    status: 'pass',
    checkedAt: timestamp(nowMs, -60_000 + (index * 1_000)),
    evidenceRef: canonical0912OperatorReceiptPath('control', index, name),
    sourceCommit: SOURCE_COMMIT,
    targetRevision: TARGET_REVISION,
    productionAccess,
    details,
  };
}

function makeControls(nowMs) {
  return {
    aclInventory: commonControl('acl-inventory', 0, nowMs, noProductionAccess(), {
      identityArgumentAllowlistMatched: true,
      publicExecutableRoutineCount: 0,
      unapprovedAnonAuthenticatedRoutineCount: 0,
      legacyExecutableRoutineCount: 0,
    }),
    directEdgeProbe: commonControl(
      'direct-edge-probe',
      1,
      nowMs,
      noProductionAccess(PRODUCTION_ENVIRONMENT.id),
      {
      requestCount: 4,
      forwardedForOverrideCount: 0,
      realIpOverrideCount: 0,
      trustedEdgeSourceStable: true,
      edgeOnlyExchangeVerified: true,
      },
    ),
    deploymentRevision: commonControl(
      'deployment-revision',
      2,
      nowMs,
      noProductionAccess(PRODUCTION_ENVIRONMENT.id),
      {
      endpointCount: 2,
      expectedRevision: TARGET_REVISION,
      observedRevision: TARGET_REVISION,
      },
    ),
    backupRestore: commonControl('backup-restore', 3, nowMs, noProductionAccess(), {
      snapshotId: 77,
      archiveSha256: ARCHIVE_SHA256,
      checksumMatch: true,
      rowCountMatch: true,
      postgresMajorVersion: 16,
      isolatedNetwork: true,
      containerDisposed: true,
    }),
    onsiteRehearsal: commonControl(
      'onsite-rehearsal',
      4,
      nowMs,
      noProductionAccess(PRODUCTION_ENVIRONMENT.id),
      {
        deviceCount: 3,
        networkProfileCount: 2,
        failedScenarioCount: 0,
        desktopVerified: true,
        mobileVerified: true,
        keyboardOnlyVerified: true,
      },
    ),
    tokenRevocation: commonControl(
      'token-revocation',
      5,
      nowMs,
      noProductionAccess(),
      {
        revokedTokenReuseAcceptedCount: 0,
        hqLogoutRevocationVerified: true,
        passwordChangeAllDevicesRevoked: true,
        teamDeviceRevocationVerified: true,
      },
    ),
    rollbackReadiness: commonControl('rollback-readiness', 6, nowMs, noProductionAccess(), {
      rollbackArtifactSha256: 'e'.repeat(64),
      activityGuardRefusalVerified: true,
      isolatedRollbackExercisePassed: true,
      activationReapplyVerified: true,
    }),
  };
}

function calculateSafety(operator) {
  const accesses = [
    ...operator.gates.map((entry) => entry.evidence.productionAccess),
    ...operator.rolloutSteps.map((entry) => entry.evidence.productionAccess),
    ...Object.values(operator.controls).map((control) => control.productionAccess),
  ];
  return accesses.reduce((safety, access) => {
    if (access.mode === 'approved-db-rollout') {
      safety.approvedRolloutDatabaseConnectionCount += access.connectionCount;
      safety.approvedRolloutMutationCount += access.mutationCount;
    }
    if (access.mode === 'read-only-observation') {
      safety.observationDatabaseConnectionCount += access.connectionCount;
      safety.observationMutationCount += access.mutationCount;
    }
    return safety;
  }, {
    sensitiveMaterialDetected: false,
    unapprovedProductionMutationCount: 0,
    syntheticRehearsalProductionMutationCount: 0,
    capabilityValuesLeakedToDraftQueueOrEvidence: false,
    approvedRolloutDatabaseConnectionCount: 0,
    approvedRolloutMutationCount: 0,
    observationDatabaseConnectionCount: 0,
    observationMutationCount: 0,
  });
}

function operatorFixture(nowMs) {
  const operator = {
    schemaVersion: 2,
    evidenceType: '0912-operator-readiness',
    session: '0912-deliberation',
    releaseRunId: RELEASE_RUN_ID,
    generatedAt: timestamp(nowMs, -20_000),
    sourceCommit: SOURCE_COMMIT,
    targetRevision: TARGET_REVISION,
    productionEnvironment: { ...PRODUCTION_ENVIRONMENT },
    artifactBindings: CANONICAL_0912_OPERATOR_BINDING_PATHS.map((path) => ({
      path,
      sha256: createHash('sha256').update(path, 'utf8').digest('hex'),
    })),
    status: 'pass',
    attestation: null,
    approvals: APPROVAL_GROUPS.map(([scope, rolloutStepIds, gateIds], index) => {
      const [hour, minute] = APPROVAL_EXECUTION_TIMES[index];
      return {
      id: `approval-${scope}`,
      scope,
      status: 'approved',
      approvedAt: timestamp(nowMs, -300_000 + (((hour * 60) + minute) * 1_000)),
      approver: {
        id: `situation-owner-${index + 1}`,
        label: `상황 책임자 ${index + 1}`,
        role: 'situation-owner',
      },
      session: '0912-deliberation',
      sourceCommit: SOURCE_COMMIT,
      targetRevision: TARGET_REVISION,
      rolloutStepIds: [...rolloutStepIds],
      gateIds: [...gateIds],
      };
    }),
    safety: null,
    gates: CANONICAL_0912_GATE_IDS.map((id, index) => execution('gate', id, index, nowMs)),
    rolloutSteps: CANONICAL_0912_ROLLOUT_IDS.map((id, index) => (
      execution('rollout', id, index, nowMs)
    )),
    controls: makeControls(nowMs),
  };
  operator.safety = calculateSafety(operator);
  return operator;
}

function counts() {
  return {
    submission: 15,
    submission_item: 45,
    issue: 8,
    issue_link: 12,
    result_page: 1,
    ballot: 2,
    ballot_item: 6,
    ballot_response: 30,
  };
}

function archiveAudit(nowMs) {
  return {
    schemaVersion: 2,
    event: 'platform_snapshot_export',
    exportedAt: timestamp(nowMs, -30_000),
    repository: 'seojaehong/climate-assembly-wiki',
    runId: 'github-actions:12345/1',
    commitSha: SOURCE_COMMIT,
    workflowRef: '.github/workflows/snapshot.yml@refs/heads/main',
    keyId: 'snapshot-hmac-v3',
    snapshotId: 77,
    integrityAlgorithm: 'hmac-sha256',
    integrityTarget: 'legacy+platform+provenance',
  };
}

function backupFixture(nowMs) {
  return {
    schemaVersion: 1,
    evidenceType: '0912-backup-manifest',
    status: 'pass',
    releaseRunId: RELEASE_RUN_ID,
    sourceCommit: SOURCE_COMMIT,
    generatedAt: timestamp(nowMs, -20_000),
    attestation: null,
    producer: 'approved-snapshot-workflow',
    workflow: {
      runId: 'github-actions:12345/1',
      keyId: 'snapshot-hmac-v3',
      executionMode: 'approved-service-role-workflow',
      hmacVerified: true,
      browserExecution: false,
    },
    snapshot: {
      snapshotId: 77,
      session: '0912-deliberation',
      archiveObjectRef: ARCHIVE_OBJECT_REF,
      archiveSizeBytes: ARCHIVE_SIZE_BYTES,
      archiveSha256: ARCHIVE_SHA256,
      archiveAudit: archiveAudit(nowMs),
      counts: counts(),
    },
    latest: {
      capturedAt: timestamp(nowMs, -30_000),
      checksumSha256: LATEST_SHA256,
      teamCount: 15,
      itemCount: 45,
      finalizedSubmissionCount: 15,
    },
  };
}

function restoreFixture(nowMs) {
  return {
    schemaVersion: 1,
    evidenceType: '0912-restore-rehearsal',
    status: 'pass',
    releaseRunId: RELEASE_RUN_ID,
    sourceCommit: SOURCE_COMMIT,
    generatedAt: timestamp(nowMs, -20_000),
    attestation: null,
    producer: 'isolated-postgres-restore-rehearsal',
    snapshot: {
      snapshotId: 77,
      archiveObjectRef: ARCHIVE_OBJECT_REF,
      archiveSizeBytes: ARCHIVE_SIZE_BYTES,
      archiveSha256: ARCHIVE_SHA256,
      archiveAudit: archiveAudit(nowMs),
    },
    environment: {
      engine: 'postgresql',
      majorVersion: 16,
      databaseName: 'verify',
      networkMode: 'none',
      containerName: 'snapshot-restore-12345-1',
      containerDisposed: true,
      productionDatabaseConnectionCount: 0,
      productionMutationCount: 0,
    },
    verification: {
      restoreRehearsalPassed: true,
      archiveIntegrityVerified: true,
      hmacVerified: true,
      databaseRestoreExecuted: true,
      transactionRolledBack: true,
      archiveRowsVerified: true,
      businessTriggersEnabledBefore: true,
      businessTriggersEnabledDuringRestore: true,
      businessTriggersEnabledAfter: true,
      constraintsEnabled: true,
      secretMaterialDetected: false,
      originalCounts: counts(),
      restoredCounts: counts(),
    },
  };
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
}

function invokeCli(args) {
  return spawnSync(process.execPath, [SCRIPT_PATH, ...args], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    timeout: 15_000,
  });
}

function standardArguments(type, inputPath, outputPath, signedAt) {
  return [
    '--type', type,
    '--input', inputPath,
    '--output', outputPath,
    '--private-key', privateKeyPath,
    '--signed-at', signedAt,
  ];
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

function structuralShape(value) {
  if (Array.isArray(value)) return value.map((entry) => structuralShape(entry));
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, structuralShape(value[key])]));
  }
  return 'leaf';
}

beforeEach(async () => {
  testDirectory = await mkdtemp(join(tmpdir(), '0912-sign-evidence-'));
  const pair = generateKeyPairSync('ed25519');
  publicKey = pair.publicKey;
  privateKeyPath = join(testDirectory, 'attestation-private.pem');
  await writeFile(
    privateKeyPath,
    pair.privateKey.export({ type: 'pkcs8', format: 'pem' }),
    { encoding: 'utf8', mode: 0o600, flag: 'wx' },
  );
});

afterEach(async () => {
  await rm(testDirectory, { recursive: true, force: true });
});

describe('0912 evidence signing CLI', () => {
  it('uses a distinct signing domain for every producer role', () => {
    expect(new Set(Object.values(EVIDENCE_SIGNING_DOMAINS))).toHaveLength(3);
    expect(Object.keys(EVIDENCE_SIGNING_DOMAINS).sort()).toEqual([
      'backup',
      'operator',
      'restore',
    ]);
  });

  it.each([
    ['operator', operatorFixture],
    ['backup', backupFixture],
    ['restore', restoreFixture],
  ])('creates a validator-compatible Ed25519 %s artifact', async (type, makeFixture) => {
    const nowMs = Date.now();
    const inputPath = join(testDirectory, `${type}-input.json`);
    const outputPath = join(testDirectory, `${type}-signed.json`);
    await writeJson(inputPath, makeFixture(nowMs));

    const result = invokeCli(standardArguments(
      type,
      inputPath,
      outputPath,
      timestamp(nowMs, -10_000),
    ));
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('0912 evidence signed\n');
    expect(result.stderr).toBe('');

    const signed = await readJson(outputPath);
    const expectedKeyId = `ed25519-sha256:${createHash('sha256')
      .update(publicKey.export({ type: 'spki', format: 'der' }))
      .digest('hex')}`;
    expect(signed.attestation).toMatchObject({ algorithm: 'Ed25519', keyId: expectedKeyId });
    if (type === 'operator') {
      expect(() => validate0912OperatorEvidence({
        operator: signed,
        expectedSourceCommit: SOURCE_COMMIT,
        expectedTargetRevision: TARGET_REVISION,
        expectedReleaseRunId: RELEASE_RUN_ID,
        expectedProductionEnvironment: PRODUCTION_ENVIRONMENT,
        expectedGateIds: CANONICAL_0912_GATE_IDS,
        expectedRolloutIds: CANONICAL_0912_ROLLOUT_IDS,
        trustedPublicKey: publicKey,
        verifiedAt: timestamp(nowMs, 0),
      })).not.toThrow();
    } else if (type === 'backup') {
      expect(() => validate0912BackupEvidence({
        backup: signed,
        expectedSourceCommit: SOURCE_COMMIT,
        expectedReleaseRunId: RELEASE_RUN_ID,
        backupKey: publicKey,
      })).not.toThrow();
    } else {
      expect(() => validate0912RestoreEvidence({
        restore: signed,
        expectedSourceCommit: SOURCE_COMMIT,
        expectedReleaseRunId: RELEASE_RUN_ID,
        restoreKey: publicKey,
      })).not.toThrow();
    }
  });

  it('makes tampering detectable by the canonical validator', async () => {
    const nowMs = Date.now();
    const inputPath = join(testDirectory, 'backup-input.json');
    const outputPath = join(testDirectory, 'backup-signed.json');
    await writeJson(inputPath, backupFixture(nowMs));
    expect(invokeCli(standardArguments(
      'backup', inputPath, outputPath, timestamp(nowMs, -10_000),
    )).status).toBe(0);

    const signed = await readJson(outputPath);
    signed.latest.teamCount = 14;
    expect(() => validate0912BackupEvidence({
      backup: signed,
      expectedSourceCommit: SOURCE_COMMIT,
      expectedReleaseRunId: RELEASE_RUN_ID,
      backupKey: publicKey,
    }))
      .toThrow(BackupRestoreEvidenceValidationError);
  });

  it('uses the current canonical UTC time when signedAt is omitted', async () => {
    const nowMs = Date.now();
    const inputPath = join(testDirectory, 'default-time-input.json');
    const outputPath = join(testDirectory, 'default-time-output.json');
    await writeJson(inputPath, backupFixture(nowMs));
    const before = Date.now();
    const args = standardArguments('backup', inputPath, outputPath, timestamp(nowMs, -10_000));
    args.splice(-2, 2);

    const result = invokeCli(args);
    const after = Date.now();
    expect(result.status).toBe(0);
    const signed = await readJson(outputPath);
    expect(new Date(signed.attestation.signedAt).toISOString()).toBe(signed.attestation.signedAt);
    expect(Date.parse(signed.attestation.signedAt)).toBeGreaterThanOrEqual(before);
    expect(Date.parse(signed.attestation.signedAt)).toBeLessThanOrEqual(after);
  });

  it.each([
    ['unsupported option', ['--unknown', 'value']],
    ['duplicate option', ['--type', 'backup', '--type', 'backup']],
    ['missing value', ['--type']],
    ['missing required options', ['--type', 'backup']],
  ])('strictly rejects %s without reflecting argument values', (_label, args) => {
    expect(() => parseSigningArguments(args)).toThrow(EvidenceSigningError);
  });

  it('rejects a type/payload mismatch without creating output', async () => {
    const nowMs = Date.now();
    const inputPath = join(testDirectory, 'backup-input.json');
    const outputPath = join(testDirectory, 'wrong-type-output.json');
    await writeJson(inputPath, backupFixture(nowMs));

    const result = invokeCli(standardArguments(
      'restore', inputPath, outputPath, timestamp(nowMs, -10_000),
    ));
    expect(result.status).toBe(1);
    await expect(lstat(outputPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects identical input/output paths and preserves the input', async () => {
    const nowMs = Date.now();
    const inputPath = join(testDirectory, 'same.json');
    const original = `${JSON.stringify(backupFixture(nowMs), null, 2)}\n`;
    await writeFile(inputPath, original, { encoding: 'utf8', flag: 'wx' });

    const result = invokeCli(standardArguments(
      'backup', inputPath, inputPath, timestamp(nowMs, -10_000),
    ));
    expect(result.status).toBe(1);
    expect(await readFile(inputPath, 'utf8')).toBe(original);
  });

  it('refuses overwrite and leaves the existing destination unchanged', async () => {
    const nowMs = Date.now();
    const inputPath = join(testDirectory, 'backup-input.json');
    const outputPath = join(testDirectory, 'existing.json');
    await writeJson(inputPath, backupFixture(nowMs));
    await writeFile(outputPath, 'preserve-me', { encoding: 'utf8', flag: 'wx' });

    const result = invokeCli(standardArguments(
      'backup', inputPath, outputPath, timestamp(nowMs, -10_000),
    ));
    expect(result.status).toBe(1);
    expect(await readFile(outputPath, 'utf8')).toBe('preserve-me');
  });

  it('allows exactly one winner when two writers race for the same output', async () => {
    const now = new Date();
    const inputPath = join(testDirectory, 'race-input.json');
    const outputPath = join(testDirectory, 'race-output.json');
    await writeJson(inputPath, backupFixture(now.getTime()));
    const options = {
      type: 'backup',
      inputPath,
      outputPath,
      privateKeyPath,
      signedAt: timestamp(now.getTime(), -10_000),
      now,
    };

    const outcomes = await Promise.allSettled([
      sign0912Evidence(options),
      sign0912Evidence(options),
    ]);
    expect(outcomes.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter(({ status }) => status === 'rejected')).toHaveLength(1);
    const signed = await readJson(outputPath);
    expect(() => validate0912BackupEvidence({
      backup: signed,
      expectedSourceCommit: SOURCE_COMMIT,
      expectedReleaseRunId: RELEASE_RUN_ID,
      backupKey: publicKey,
    })).not.toThrow();
  });

  it('rejects symlink input when the platform permits creating one', async ({ skip }) => {
    const nowMs = Date.now();
    const inputPath = join(testDirectory, 'backup-input.json');
    const symlinkPath = join(testDirectory, 'backup-link.json');
    const outputPath = join(testDirectory, 'backup-output.json');
    await writeJson(inputPath, backupFixture(nowMs));
    try {
      await symlink(inputPath, symlinkPath, 'file');
    } catch (error) {
      if (error?.code === 'EPERM') skip();
      throw error;
    }

    const result = invokeCli(standardArguments(
      'backup', symlinkPath, outputPath, timestamp(nowMs, -10_000),
    ));
    expect(result.status).toBe(1);
    await expect(lstat(outputPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects secret-bearing input and never emits the secret value', async () => {
    const nowMs = Date.now();
    const secretValue = 'Bearer do-not-reflect-this-capability';
    const inputPath = join(testDirectory, 'secret-input.json');
    const outputPath = join(testDirectory, 'secret-output.json');
    const input = backupFixture(nowMs);
    input.workflow.runId = secretValue;
    await writeJson(inputPath, input);

    const result = invokeCli(standardArguments(
      'backup', inputPath, outputPath, timestamp(nowMs, -10_000),
    ));
    expect(result.status).toBe(1);
    expect(result.stdout).not.toContain(secretValue);
    expect(result.stderr).not.toContain(secretValue);
    await expect(lstat(outputPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('never reflects invalid private-key contents in errors', async () => {
    const nowMs = Date.now();
    const invalidKeyValue = 'private-key-sentinel-do-not-reflect';
    const inputPath = join(testDirectory, 'backup-input.json');
    const outputPath = join(testDirectory, 'backup-output.json');
    const invalidKeyPath = join(testDirectory, 'invalid-private.pem');
    await writeJson(inputPath, backupFixture(nowMs));
    await writeFile(invalidKeyPath, invalidKeyValue, { encoding: 'utf8', flag: 'wx' });

    const result = invokeCli([
      '--type', 'backup',
      '--input', inputPath,
      '--output', outputPath,
      '--private-key', invalidKeyPath,
      '--signed-at', timestamp(nowMs, -10_000),
    ]);
    expect(result.status).toBe(1);
    expect(result.stdout).not.toContain(invalidKeyValue);
    expect(result.stderr).not.toContain(invalidKeyValue);
  });

  it('rejects a valid non-Ed25519 private key', async () => {
    const nowMs = Date.now();
    const inputPath = join(testDirectory, 'rsa-input.json');
    const outputPath = join(testDirectory, 'rsa-output.json');
    const rsaKeyPath = join(testDirectory, 'rsa-private.pem');
    const { privateKey: rsaPrivateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    await writeJson(inputPath, backupFixture(nowMs));
    await writeFile(
      rsaKeyPath,
      rsaPrivateKey.export({ type: 'pkcs8', format: 'pem' }),
      { encoding: 'utf8', mode: 0o600, flag: 'wx' },
    );

    const result = invokeCli([
      '--type', 'backup',
      '--input', inputPath,
      '--output', outputPath,
      '--private-key', rsaKeyPath,
      '--signed-at', timestamp(nowMs, -10_000),
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('private_key_type_invalid');
    await expect(lstat(outputPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('will not re-sign an already attested input', async () => {
    const nowMs = Date.now();
    const inputPath = join(testDirectory, 'attested-input.json');
    const outputPath = join(testDirectory, 'attested-output.json');
    const input = backupFixture(nowMs);
    input.attestation = { existing: true };
    await writeJson(inputPath, input);

    const result = invokeCli(standardArguments(
      'backup', inputPath, outputPath, timestamp(nowMs, -10_000),
    ));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('attestation_must_be_null');
    await expect(lstat(outputPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects signedAt before generatedAt and signedAt in the future', async () => {
    const now = new Date();
    const inputPath = join(testDirectory, 'backup-input.json');
    await writeJson(inputPath, backupFixture(now.getTime()));

    await expect(sign0912Evidence({
      type: 'backup',
      inputPath,
      outputPath: join(testDirectory, 'past-output.json'),
      privateKeyPath,
      signedAt: timestamp(now.getTime(), -30_000),
      now,
    })).rejects.toMatchObject({ code: 'signed_at_before_evidence' });
    await expect(sign0912Evidence({
      type: 'backup',
      inputPath,
      outputPath: join(testDirectory, 'future-output.json'),
      privateKeyPath,
      signedAt: timestamp(now.getTime(), 1),
      now,
    })).rejects.toMatchObject({ code: 'signed_at_in_future' });
  });

  it.each(Object.entries(TEMPLATE_PATHS))(
    'keeps the %s template explicitly not-run and unsigned',
    async (type, templatePath) => {
      const template = await readJson(templatePath);
      const factory = { operator: operatorFixture, backup: backupFixture, restore: restoreFixture }[type];
      expect(template.status).toBe('not_run');
      expect(template.attestation).toBeNull();
      expect(structuralShape(template)).toEqual(structuralShape(factory(Date.now())));
      expect(JSON.stringify(template)).not.toMatch(/Bearer\s|BEGIN PRIVATE KEY|password\s*[:=]/i);

      const result = invokeCli(standardArguments(
        type,
        templatePath,
        join(testDirectory, `${type}-template-output.json`),
        new Date().toISOString(),
      ));
      expect(result.status).toBe(1);
    },
  );

  it('does not contain database, network, or subprocess execution code', async () => {
    const source = await readFile(SCRIPT_PATH, 'utf8');
    expect(source).not.toMatch(/from ['"]node:(?:child_process|http|https|net|tls)['"]/);
    expect(source).not.toMatch(/\bfetch\s*\(/);
    expect(source).not.toMatch(/\b(?:createClient|Client|Pool)\s*\(/);
  });

  it('rejects post-signing payload mutation under the operator validator', async () => {
    const nowMs = Date.now();
    const inputPath = join(testDirectory, 'operator-input.json');
    const outputPath = join(testDirectory, 'operator-output.json');
    await writeJson(inputPath, operatorFixture(nowMs));
    expect(invokeCli(standardArguments(
      'operator', inputPath, outputPath, timestamp(nowMs, -10_000),
    )).status).toBe(0);

    const signed = await readJson(outputPath);
    signed.gates[0].status = 'fail';
    expect(() => validate0912OperatorEvidence({
      operator: signed,
      expectedSourceCommit: SOURCE_COMMIT,
      expectedTargetRevision: TARGET_REVISION,
      expectedReleaseRunId: RELEASE_RUN_ID,
      expectedProductionEnvironment: PRODUCTION_ENVIRONMENT,
      expectedGateIds: CANONICAL_0912_GATE_IDS,
      expectedRolloutIds: CANONICAL_0912_ROLLOUT_IDS,
      trustedPublicKey: publicKey,
      verifiedAt: timestamp(nowMs, 0),
    })).toThrow(OperatorEvidenceValidationError);
  });
});
