import { spawnSync } from 'node:child_process';
import {
  createHash,
  generateKeyPairSync,
  sign as signPayload,
} from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test, vi } from 'vitest';
import { createManualAccessibilityTemplate } from '../automation/platform-accessibility-manual-evidence.mjs';
import {
  CANONICAL_0912_APPROVAL_SCOPES,
  CANONICAL_0912_CONTROL_RECEIPT_IDS,
  CANONICAL_0912_GATE_IDS,
  CANONICAL_0912_OPERATOR_BINDING_PATHS,
  CANONICAL_0912_PRODUCTION_RESULT_PATHS,
  CANONICAL_0912_ROLLOUT_IDS,
  canonical0912OperatorReceiptPath,
  contains0912SensitiveMaterial,
  find0912SensitiveMaterialPath,
  validate0912OperatorEvidence,
  validate0912UnsignedOperatorEvidence,
} from './0912-operator-evidence.mjs';
import { finalize0912OperatorPacket } from './prepare-0912-operator-packet.mjs';
import {
  REQUIRED_0912_CRITICAL_GATES,
  verify0912Readiness,
} from './verify-0912-readiness.mjs';
import {
  CANONICAL_ACCESSIBILITY_ROUTE_PATHS,
  derive0912PostgresTargetPaths,
  hasPassingAutomatedAccessibilityEvidence,
  hasPassingPostgresEvidence,
  parse0912JsonStrict,
  parse0912ReleaseReportCliArgs,
  readCanonicalEvidenceTrustPolicy,
  validateReleaseSourceBinding,
  validate0912ReleaseReport,
  verify0912LatestBackupBytes,
  verify0912ReleaseReport,
  verifyReadyArtifactPayloads,
} from './verify-0912-release-report.mjs';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const validatorPath = resolve(projectRoot, 'scripts/verify-0912-release-report.mjs');
const CANONICAL_REPORT_PATH = 'evaluation/0912-13-readiness-report.json';
const SOURCE_COMMIT = 'a'.repeat(40);
const OTHER_COMMIT = 'b'.repeat(40);
const RELEASE_RUN_ID = '00000000-0000-4000-8000-000000000099';
const EXPECTED_APPROVED_MUTATION_COUNT = 14;
const { privateKey: OPERATOR_PRIVATE_KEY, publicKey: OPERATOR_PUBLIC_KEY } = generateKeyPairSync('ed25519');
const { privateKey: BACKUP_PRIVATE_KEY, publicKey: BACKUP_PUBLIC_KEY } = generateKeyPairSync('ed25519');
const { privateKey: RESTORE_PRIVATE_KEY, publicKey: RESTORE_PUBLIC_KEY } = generateKeyPairSync('ed25519');
function evidenceKeyId(publicKey) {
  return `ed25519-sha256:${createHash('sha256')
    .update(publicKey.export({ type: 'spki', format: 'der' }))
    .digest('hex')}`;
}
const OPERATOR_KEY_ID = evidenceKeyId(OPERATOR_PUBLIC_KEY);
const BACKUP_KEY_ID = evidenceKeyId(BACKUP_PUBLIC_KEY);
const RESTORE_KEY_ID = evidenceKeyId(RESTORE_PUBLIC_KEY);
const EVIDENCE_TRUST_POLICY = Object.freeze({
  schemaVersion: 1,
  policyId: '0912-evidence-trust',
  status: 'configured',
  environment: {
    id: 'climate-assembly-production',
    webOrigin: 'https://climate-assembly.org',
    supabaseProjectRef: 'pleyuknjnprsckssxvrh',
    databaseTlsSpkiSha256: 'c'.repeat(64),
    orgId: '00000000-0000-4000-8000-000000000101',
    assemblyId: '00000000-0000-4000-8000-000000000102',
    sessionId: '00000000-0000-4000-8000-000000000103',
    sessionSlug: '0912-deliberation',
  },
  keyIds: {
    operator: OPERATOR_KEY_ID,
    backup: BACKUP_KEY_ID,
    restore: RESTORE_KEY_ID,
  },
});
const TRUSTED_EVIDENCE_PUBLIC_KEYS = Object.freeze({
  operator: OPERATOR_PUBLIC_KEY,
  backup: BACKUP_PUBLIC_KEY,
  restore: RESTORE_PUBLIC_KEY,
});
const canonicalTemplate = JSON.parse(readFileSync(
  resolve(projectRoot, 'evaluation/0912-13-readiness-report.template.json'),
  'utf8',
));
const canonicalRolloutIds = canonicalTemplate.productionRollout.orderedSteps.map((step) => step.id);
const canonicalRequirementIds = canonicalTemplate.requirements.map((requirement) => requirement.id);
const canonicalArtifactKeys = Object.keys(canonicalTemplate.artifacts);
const canonicalBlockers = canonicalTemplate.blockers;
const readyArtifacts = {
  traceabilityReport: 'evaluation/0912-13-traceability-report.json',
  postgresVerificationReport: 'evaluation/0912-p1a-postgres-report.json',
  fieldRehearsalReport: 'evaluation/0912-13-field-rehearsal.json',
  hqFieldRehearsalReport: 'evaluation/0912-13-hq-rehearsal.json',
  accessibilityReport: 'evaluation/0912-hq-dashboard-accessibility.json',
  manualAccessibilityEvidence: 'evaluation/platform-accessibility-manual-evaluation.json',
  backupManifest: 'evaluation/0912-13-backup-manifest.json',
  restoreLog: 'evaluation/0912-13-restore-report.json',
  operatorLog: 'evaluation/0912-13-operator-log.json',
};

function items(ids, status, evidence) {
  return ids.map((id) => ({ id, status, evidence }));
}

function runGit(root, args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`git command failed: ${args[0]}`);
  }
  return result.stdout.trim();
}

function initializeTestRepository(root) {
  runGit(root, ['init']);
  runGit(root, ['config', 'user.name', '0912 verifier test']);
  runGit(root, ['config', 'user.email', '0912-verifier@example.invalid']);
}

function canonicalJson(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalJson(entry)).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => (
    `${JSON.stringify(key)}:${canonicalJson(value[key])}`
  )).join(',')}}`;
}

function attestEvidence(value, signedAt) {
  const isBackup = value.evidenceType === '0912-backup-manifest';
  const privateKey = isBackup ? BACKUP_PRIVATE_KEY : RESTORE_PRIVATE_KEY;
  const keyId = isBackup ? BACKUP_KEY_ID : RESTORE_KEY_ID;
  const unsigned = Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'attestation'));
  const payloadSha256 = createHash('sha256').update(canonicalJson(unsigned), 'utf8').digest('hex');
  const signingMessage = Buffer.from(
    `0912-${value.evidenceType}-v1\n${keyId}\n${payloadSha256}\n${signedAt}`,
    'utf8',
  );
  return {
    algorithm: 'Ed25519',
    keyId,
    payloadSha256,
    signatureBase64: signPayload(null, signingMessage, privateKey).toString('base64'),
    signedAt,
  };
}

const OPERATOR_PRODUCTION_ENVIRONMENT = Object.freeze({
  id: EVIDENCE_TRUST_POLICY.environment.id,
  webOrigin: EVIDENCE_TRUST_POLICY.environment.webOrigin,
  supabaseProjectRef: EVIDENCE_TRUST_POLICY.environment.supabaseProjectRef,
  databaseTlsSpkiSha256: EVIDENCE_TRUST_POLICY.environment.databaseTlsSpkiSha256,
  organizationId: EVIDENCE_TRUST_POLICY.environment.orgId,
  assemblyId: EVIDENCE_TRUST_POLICY.environment.assemblyId,
  sessionId: EVIDENCE_TRUST_POLICY.environment.sessionId,
  sessionSlug: EVIDENCE_TRUST_POLICY.environment.sessionSlug,
});
const OPERATOR_GATE_TIMES = Object.freeze([
  [0, 0], [0, 1], [0, 2], [0, 3], [0, 4], [0, 5], [0, 6], [0, 7], [0, 8],
  [0, 26], [0, 36], [0, 46], [0, 56], [1, 5], [1, 6], [1, 10], [1, 25],
  [1, 30], [2, 15], [2, 16], [2, 17], [2, 20], [2, 45], [2, 46], [2, 50],
  [3, 10], [3, 35], [3, 36], [3, 37], [3, 38], [3, 39], [3, 40], [3, 42],
  [3, 43], [3, 46],
]);
const OPERATOR_ROLLOUT_TIMES = Object.freeze([
  [0, 20], [0, 30], [0, 40], [0, 50], [1, 0], [1, 20], [1, 40], [1, 50],
  [2, 10], [2, 30], [2, 40], [3, 0], [3, 20], [3, 30],
]);
const OPERATOR_APPROVAL_TIMES = Object.freeze([
  [0, 21], [0, 31], [0, 41], [0, 51], [1, 7], [1, 27],
  [1, 55], [2, 18], [2, 47], [3, 5], [3, 41], [3, 45],
]);
const OPERATOR_GATE_MEASUREMENTS = Object.freeze({
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
  'deployed-revision-match': ['deployed_revision', SOURCE_COMMIT, SOURCE_COMMIT, 'git-commit'],
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
  'mod-hq-automated-a11y': ['automated_accessibility_violation_count', 0, 0, 'violations'],
  'mod-hq-manual-a11y': ['manual_accessibility_failed_case_count', 0, 0, 'cases'],
  backup: ['verified_backup_snapshot_count', 1, 1, 'snapshots'],
  'restore-isolated': ['isolated_restore_mismatch_count', 0, 0, 'mismatches'],
  'final-token-cleanup': ['remaining_temporary_event_token_count', 0, 0, 'tokens'],
});
const OPERATOR_ROLLOUT_MEASUREMENTS = Object.freeze({
  'session-roster-review': ['rollout_approved_roster_team_count', 15, 15, 'teams'],
  'secure-session-team-seed': ['rollout_active_team_count', 15, 15, 'teams'],
  's20-draft-topics': ['rollout_draft_topic_count', 6, 6, 'topics'],
  'hq-rotate-join-codes': ['rollout_rotated_team_count', 15, 15, 'teams'],
  'maintenance-deploy-token-staff-client': [
    'rollout_deployed_revision', SOURCE_COMMIT, SOURCE_COMMIT, 'git-commit',
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

function operatorTime(phase, minute) {
  return new Date(Date.UTC(2026, 8, 5, 12, 40 + phase, minute, 0)).toISOString();
}

function operatorApprovalId(kind, id) {
  const entry = CANONICAL_0912_APPROVAL_SCOPES.find((scope) => (
    kind === 'gate' ? scope.gateIds.includes(id) : scope.rolloutStepIds.includes(id)
  ));
  return entry ? `approval-${entry.scope}` : null;
}

function operatorAccess(mode, approvalId = null, environmentId = null) {
  return {
    mode,
    connectionCount: mode === 'approved-db-rollout' || mode === 'read-only-observation' ? 1 : 0,
    mutationCount: mode === 'approved-db-rollout' ? 1 : 0,
    approvalId,
    environmentId,
  };
}

function operatorExecutionAccess(kind, id) {
  if (kind === 'rollout') {
    if (id === 'session-roster-review') return operatorAccess('no-production-db');
    const approvalId = operatorApprovalId(kind, id);
    return id === 'maintenance-deploy-token-staff-client'
      ? operatorAccess('approved-non-db-rollout', approvalId, OPERATOR_PRODUCTION_ENVIRONMENT.id)
      : operatorAccess('approved-db-rollout', approvalId, OPERATOR_PRODUCTION_ENVIRONMENT.id);
  }
  if (id === 'production-routine-acl-inventory') {
    return operatorAccess('read-only-observation', null, OPERATOR_PRODUCTION_ENVIRONMENT.id);
  }
  if (id === 'backup' || id === 'final-token-cleanup') {
    return operatorAccess(
      'approved-db-rollout',
      operatorApprovalId(kind, id),
      OPERATOR_PRODUCTION_ENVIRONMENT.id,
    );
  }
  if ([
    'join-code-throttle-edge-probe',
    'maintenance-token-staff-client-deployed',
    'deployed-revision-match',
    'onsite-device-network-rehearsal',
  ].includes(id)) {
    return operatorAccess('no-production-db', null, OPERATOR_PRODUCTION_ENVIRONMENT.id);
  }
  return operatorAccess('no-production-db');
}

function operatorMeasurement(kind, id, targetRevision = SOURCE_COMMIT) {
  const configured = kind === 'gate'
    ? OPERATOR_GATE_MEASUREMENTS[id]
    : OPERATOR_ROLLOUT_MEASUREMENTS[id];
  const [name, expected, observed, unit] = configured ?? [
    `${kind}_${id.replaceAll('-', '_')}_result`, 'pass', 'pass', 'result',
  ];
  return {
    name,
    expected: expected === SOURCE_COMMIT ? targetRevision : expected,
    observed: observed === SOURCE_COMMIT ? targetRevision : observed,
    unit,
  };
}

function attestOperator(operator) {
  const signedAt = '2026-09-05T13:31:00.000Z';
  const unsigned = Object.fromEntries(Object.entries(operator).filter(([key]) => key !== 'attestation'));
  const payloadSha256 = createHash('sha256').update(canonicalJson(unsigned), 'utf8').digest('hex');
  const signingMessage = Buffer.from(
    `0912-operator-evidence-v1\n${OPERATOR_KEY_ID}\n${payloadSha256}\n${signedAt}`,
    'utf8',
  );
  return {
    algorithm: 'Ed25519',
    keyId: OPERATOR_KEY_ID,
    payloadSha256,
    signatureBase64: signPayload(null, signingMessage, OPERATOR_PRIVATE_KEY).toString('base64'),
    signedAt,
  };
}

function makeReadyReport(sourceCommit = SOURCE_COMMIT) {
  return {
    schemaVersion: 1,
    reportId: '0912-13-readiness',
    releaseRunId: RELEASE_RUN_ID,
    generatedAt: '2026-09-05T13:40:00.000Z',
    sourceCommit,
    sourceTreeClean: true,
    targetRevision: { status: 'verified', sourceCommit },
    status: 'pass',
    releaseDecision: 'ready',
    safety: {
      fixtureClassification: 'synthetic-no-pii-no-secrets',
      approvedProductionMutationCount: EXPECTED_APPROVED_MUTATION_COUNT,
      unapprovedProductionMutationCount: 0,
      syntheticRehearsalProductionMutationCount: 0,
      capabilityValuesLeakedToDraftQueueOrEvidence: false,
    },
    criticalGates: items(
      REQUIRED_0912_CRITICAL_GATES,
      'pass',
      'evaluation/0912-13-operator-log.json',
    ),
    productionRollout: {
      status: 'pass',
      productionMutationRequiresExplicitApproval: true,
      orderedSteps: items(canonicalRolloutIds, 'pass', 'evaluation/0912-13-operator-log.json'),
    },
    requirements: items(
      canonicalRequirementIds,
      'pass',
      ['evaluation/0912-13-operator-log.json'],
    ),
    artifacts: { ...readyArtifacts },
    blockers: [...canonicalBlockers],
  };
}

function makeNeedsReviewReport() {
  const report = makeReadyReport();
  report.status = 'needs_review';
  report.releaseDecision = 'not_ready';
  report.releaseRunId = null;
  report.targetRevision = null;
  report.safety.capabilityValuesLeakedToDraftQueueOrEvidence = null;
  report.criticalGates = items(REQUIRED_0912_CRITICAL_GATES, 'not_run', null);
  report.productionRollout.status = 'not_run';
  report.productionRollout.orderedSteps = items(canonicalRolloutIds, 'not_run', null);
  report.requirements = items(canonicalRequirementIds, 'not_run', []);
  report.artifacts = structuredClone(canonicalTemplate.artifacts);
  return report;
}

function validate(report, overrides = {}) {
  return validate0912ReleaseReport({
    report,
    canonicalRolloutIds,
    canonicalRequirementIds,
    canonicalArtifactKeys,
    canonicalBlockers,
    evidencePathExists: () => true,
    artifactPayloadsVerified: report.releaseDecision === 'ready',
    ...overrides,
  });
}

describe('9/12 release report validator', () => {
  test.each([
    ['literal duplicate', '{"reportId":"Bearer hidden-capability","reportId":"0912-13-readiness"}'],
    ['escaped duplicate', '{"reportId":"Bearer hidden-capability","report\\u0049d":"0912-13-readiness"}'],
    ['nested duplicate', '{"outer":{"id":1,"id":2}}'],
  ])('strict JSON parser rejects %s keys before values can be overwritten', (_label, json) => {
    expect(() => parse0912JsonStrict(json)).toThrow('invalid_json_evidence');
  });

  test('strict JSON parser accepts unique escaped keys and values', () => {
    expect(parse0912JsonStrict('{"report\\u0049d":"0912-13-readiness","items":[true,null,-1.5e2]}'))
      .toEqual({ reportId: '0912-13-readiness', items: [true, null, -150] });
  });
  test('accepts only the exact configured or fully empty trust-policy states', () => {
    const root = mkdtempSync(join(tmpdir(), '0912-trust-policy-'));
    try {
      const policyPath = resolve(root, 'docs/operations/0912-evidence-trust-policy.json');
      mkdirSync(dirname(policyPath), { recursive: true });
      writeFileSync(policyPath, JSON.stringify(EVIDENCE_TRUST_POLICY), 'utf8');
      expect(readCanonicalEvidenceTrustPolicy(root)).toEqual(EVIDENCE_TRUST_POLICY);

      const unconfigured = structuredClone(EVIDENCE_TRUST_POLICY);
      unconfigured.status = 'unconfigured';
      unconfigured.environment.databaseTlsSpkiSha256 = null;
      unconfigured.environment.orgId = null;
      unconfigured.environment.assemblyId = null;
      unconfigured.environment.sessionId = null;
      unconfigured.keyIds.operator = null;
      unconfigured.keyIds.backup = null;
      unconfigured.keyIds.restore = null;
      writeFileSync(policyPath, JSON.stringify(unconfigured), 'utf8');
      expect(readCanonicalEvidenceTrustPolicy(root)).toEqual(unconfigured);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test.each([
    ['partially configured', (policy) => {
      policy.status = 'unconfigured';
      policy.keyIds.operator = null;
    }],
    ['reused signing key', (policy) => {
      policy.keyIds.restore = policy.keyIds.backup;
    }],
    ['reused environment UUID', (policy) => {
      policy.environment.sessionId = policy.environment.assemblyId;
    }],
    ['unapproved production origin', (policy) => {
      policy.environment.webOrigin = 'https://example.invalid';
    }],
    ['unexpected field', (policy) => {
      policy.environment.unreviewed = true;
    }],
  ])('rejects a %s trust policy', (_label, mutate) => {
    const root = mkdtempSync(join(tmpdir(), '0912-trust-policy-'));
    try {
      const policy = structuredClone(EVIDENCE_TRUST_POLICY);
      mutate(policy);
      const policyPath = resolve(root, 'docs/operations/0912-evidence-trust-policy.json');
      mkdirSync(dirname(policyPath), { recursive: true });
      writeFileSync(policyPath, JSON.stringify(policy), 'utf8');
      expect(() => readCanonicalEvidenceTrustPolicy(root))
        .toThrow('evidence_trust_policy_invalid');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('accepts a consistent not_ready execution report without promoting it', () => {
    const result = validate(makeNeedsReviewReport());

    expect(result).toMatchObject({
      valid: true,
      releaseReady: false,
      reportStatus: 'needs_review',
      releaseDecision: 'not_ready',
      targetRevisionVerified: false,
    });
  });

  test('rejects secret-bearing not_ready reports before any promotion checks', () => {
    const report = makeNeedsReviewReport();
    report.targetRevision = {
      status: 'not_verified',
      sourceCommit: null,
      reason: 'Bearer do-not-publish-this-capability',
    };

    expect(() => validate(report)).toThrow('sensitive_material_detected');
  });

  test('accepts a failed not_ready report when an evidenced failure exists', () => {
    const report = makeNeedsReviewReport();
    report.status = 'fail';
    report.releaseRunId = RELEASE_RUN_ID;
    report.safety.capabilityValuesLeakedToDraftQueueOrEvidence = false;
    report.criticalGates[0] = {
      ...report.criticalGates[0],
      status: 'fail',
      evidence: 'evaluation/0912-13-implementation-verification.md',
    };

    expect(validate(report).releaseReady).toBe(false);
  });

  test('accepts an evidenced stopped report without promoting it', () => {
    const report = makeNeedsReviewReport();
    report.status = 'stopped';
    report.releaseDecision = 'stopped';
    report.releaseRunId = RELEASE_RUN_ID;
    report.criticalGates[0] = {
      ...report.criticalGates[0],
      status: 'stopped',
      evidence: 'evaluation/0912-13-operator-log.json',
    };

    expect(validate(report).releaseReady).toBe(false);
  });

  test('accepts a fully bound ready report', () => {
    const result = validate(makeReadyReport(), {
      expectedCommit: SOURCE_COMMIT,
      expectedTargetRevision: SOURCE_COMMIT,
    });

    expect(result).toMatchObject({
      valid: true,
      releaseReady: true,
      reportStatus: 'pass',
      releaseDecision: 'ready',
      targetRevisionVerified: true,
    });
  });

  test.each([
    ['gate missing', (report) => { report.criticalGates.pop(); }],
    ['gate duplicate', (report) => { report.criticalGates.push({ ...report.criticalGates.at(-1) }); }],
    ['gate unknown', (report) => { report.criticalGates[0].id = 'unknown-gate'; }],
    ['gate reordered', (report) => { [report.criticalGates[0], report.criticalGates[1]] = [report.criticalGates[1], report.criticalGates[0]]; }],
    ['gate not passed', (report) => { report.criticalGates[0] = { ...report.criticalGates[0], status: 'fail' }; }],
    ['gate evidence missing', (report) => { report.criticalGates[0].evidence = null; }],
    ['gate evidence path arbitrary', (report) => { report.criticalGates[0].evidence = 'ok'; }],
    ['rollout not passed', (report) => { report.productionRollout.status = 'fail'; }],
    ['rollout step not passed', (report) => { report.productionRollout.orderedSteps[0] = { ...report.productionRollout.orderedSteps[0], status: 'fail' }; }],
    ['rollout step evidence missing', (report) => { report.productionRollout.orderedSteps[0].evidence = null; }],
    ['rollout reordered', (report) => { [report.productionRollout.orderedSteps[0], report.productionRollout.orderedSteps[1]] = [report.productionRollout.orderedSteps[1], report.productionRollout.orderedSteps[0]]; }],
    ['dirty source', (report) => { report.sourceTreeClean = false; }],
    ['invalid source commit', (report) => { report.sourceCommit = 'short'; }],
    ['target missing', (report) => { report.targetRevision = null; }],
    ['target mismatch', (report) => { report.targetRevision.sourceCommit = OTHER_COMMIT; }],
    ['capability leak true', (report) => { report.safety.capabilityValuesLeakedToDraftQueueOrEvidence = true; }],
    ['capability leak unknown', (report) => { report.safety.capabilityValuesLeakedToDraftQueueOrEvidence = null; }],
    ['unapproved live mutation', (report) => {
      report.safety.unapprovedProductionMutationCount = 1;
    }],
    ['approval boundary removed', (report) => { report.productionRollout.productionMutationRequiresExplicitApproval = false; }],
    ['requirement not passed', (report) => { report.requirements[0] = { ...report.requirements[0], status: 'not_run', evidence: [] }; }],
    ['requirement evidence missing', (report) => { report.requirements[0].evidence = []; }],
    ['artifact missing', (report) => { report.artifacts.traceabilityReport = null; }],
    ['artifact path arbitrary', (report) => { report.artifacts.traceabilityReport = 'missing/nope.json'; }],
    ['artifact schema extended', (report) => { report.artifacts.unreviewed = 'evaluation/unreviewed.json'; }],
    ['blocker guardrail removed', (report) => { report.blockers.pop(); }],
    ['top-level contract extended', (report) => { report.unreviewed = true; }],
    ['not ready pairing forged', (report) => { report.releaseDecision = 'not_ready'; }],
  ])('rejects forged ready state when %s', (_label, mutate) => {
    const report = makeReadyReport();
    mutate(report);
    expect(() => validate(report)).toThrow('0912 release report rejected');
  });

  test('rejects ready promotion unless artifact producers were verified', () => {
    expect(() => validate(makeReadyReport(), { artifactPayloadsVerified: false }))
      .toThrow('ready_artifact_payloads_unverified');
  });

  test.each([
    [[], 'report_required'],
    [['--root', projectRoot], 'report_required'],
    [['--unknown', 'value', '--report', 'report.json'], 'unsupported_option'],
    [['--report'], 'option_value_required'],
    [['--report', '--root', projectRoot], 'option_value_required'],
    [['--report', CANONICAL_REPORT_PATH], 'expected_commit_required'],
    [['--report', 'one.json', '--report', 'two.json'], 'duplicate_option'],
    [['--expected-commit', 'not-a-commit', '--report', CANONICAL_REPORT_PATH], 'commit_value_invalid'],
    [['--expected-target-revision', 'not-a-commit', '--report', CANONICAL_REPORT_PATH], 'commit_value_invalid'],
    [['--expected-release-run-id', 'not-a-uuid', '--report', CANONICAL_REPORT_PATH,
      '--expected-commit', SOURCE_COMMIT], 'release_run_id_value_invalid'],
    [['--report', 'report.json', '--expected-commit', SOURCE_COMMIT], 'report_path_not_canonical'],
  ])('strict CLI parsing rejects malformed args before report processing: %j', (args, code) => {
    expect(() => parse0912ReleaseReportCliArgs(args)).toThrow(code);
  });

  test('strict CLI parser accepts every supported option once', () => {
    expect(parse0912ReleaseReportCliArgs([
      '--report', CANONICAL_REPORT_PATH,
      '--root', projectRoot,
      '--expected-commit', SOURCE_COMMIT,
      '--expected-target-revision', SOURCE_COMMIT,
      '--expected-release-run-id', RELEASE_RUN_ID,
      '--trusted-operator-public-key', 'keys/approved-operator-public.pem',
      '--trusted-backup-public-key', 'keys/approved-backup-public.pem',
      '--trusted-restore-public-key', 'keys/approved-restore-public.pem',
      '--backup-archive', 'archives/snapshot-77.dump',
      '--latest-backup', 'archives/latest.json',
    ])).toEqual({
      reportPath: CANONICAL_REPORT_PATH,
      root: projectRoot,
      expectedCommit: SOURCE_COMMIT,
      expectedTargetRevision: SOURCE_COMMIT,
      expectedReleaseRunId: RELEASE_RUN_ID,
      trustedOperatorPublicKeyPath: 'keys/approved-operator-public.pem',
      trustedBackupPublicKeyPath: 'keys/approved-backup-public.pem',
      trustedRestorePublicKeyPath: 'keys/approved-restore-public.pem',
      backupArchivePath: 'archives/snapshot-77.dump',
      latestBackupPath: 'archives/latest.json',
    });
  });

  test('CLI reports an unreadable trusted public key without echoing its path', () => {
    const sensitivePath = 'keys/customer-name-approved-evidence-public.pem';
    const result = spawnSync(process.execPath, [
      validatorPath,
      '--report', CANONICAL_REPORT_PATH,
      '--root', projectRoot,
      '--expected-commit', '0'.repeat(40),
      '--trusted-operator-public-key', sensitivePath,
    ], { cwd: projectRoot, encoding: 'utf8', timeout: 10_000 });

    const output = `${result.stdout}\n${result.stderr}`;
    expect(result.status).not.toBe(0);
    expect(output).toContain('trusted_operator_public_key_unreadable');
    expect(output).not.toContain(sensitivePath);
  });

  test('CLI rejects malformed arguments before attempting to read a report', () => {
    const result = spawnSync(process.execPath, [
      validatorPath,
      '--report', 'does-not-exist.json',
      '--report', 'also-does-not-exist.json',
    ], { cwd: projectRoot, encoding: 'utf8', timeout: 10_000 });

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain('duplicate_option');
    expect(`${result.stdout}\n${result.stderr}`).not.toContain('report_unreadable');
  });

  test('validation and CLI errors never echo evidence or token values', () => {
    const secret = 'Bearer highly-sensitive-capability-token';
    const report = makeReadyReport();
    report.criticalGates[0].status = 'unknown';
    report.criticalGates[0].evidence = secret;
    report.targetRevision = {
      status: 'not_verified',
      sourceCommit: null,
      reason: secret,
    };

    let validationMessage = '';
    try {
      validate(report);
    } catch (error) {
      validationMessage = error instanceof Error ? error.message : String(error);
    }
    expect(validationMessage).not.toContain(secret);

    const directory = mkdtempSync(join(tmpdir(), '0912-release-report-'));
    try {
      const reportPath = join(directory, 'report.json');
      writeFileSync(reportPath, JSON.stringify(report), 'utf8');
      const result = spawnSync(process.execPath, [
        validatorPath,
        '--root', projectRoot,
        '--report', reportPath,
        '--expected-commit', SOURCE_COMMIT,
      ], { cwd: projectRoot, encoding: 'utf8', timeout: 10_000 });
      const output = `${result.stdout}\n${result.stderr}`;
      expect(result.status).not.toBe(0);
      expect(output).not.toContain(secret);
      expect(output).toContain('report_path_not_canonical');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test('verifies a canonical not-ready report through the complete immutable-source wrapper', () => {
    const root = mkdtempSync(join(tmpdir(), '0912-release-wrapper-'));
    try {
      initializeTestRepository(root);
      for (const relativePath of [
        'evaluation/0912-13-readiness-report.template.json',
        'evaluation/platform-accessibility-manual-evaluation.json',
        'docs/operations/0912-evidence-trust-policy.json',
      ]) {
        const destination = resolve(root, relativePath);
        mkdirSync(dirname(destination), { recursive: true });
        writeFileSync(destination, readFileSync(resolve(projectRoot, relativePath)));
      }
      runGit(root, ['add', '.']);
      runGit(root, ['commit', '-m', 'test: seed canonical release contract']);
      const expectedCommit = runGit(root, ['rev-parse', 'HEAD']);
      const report = makeNeedsReviewReport();
      report.sourceCommit = expectedCommit;
      const reportPath = resolve(root, CANONICAL_REPORT_PATH);
      writeFileSync(reportPath, JSON.stringify(report), 'utf8');

      expect(verify0912ReleaseReport({
        root,
        reportPath: CANONICAL_REPORT_PATH,
        expectedCommit,
      })).toMatchObject({
        valid: true,
        releaseReady: false,
        sourceBindingVerified: true,
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 15_000);

  test('requires the out-of-band release run id before reading a ready evidence packet', () => {
    const root = mkdtempSync(join(tmpdir(), '0912-release-run-binding-'));
    try {
      initializeTestRepository(root);
      for (const relativePath of [
        'evaluation/0912-13-readiness-report.template.json',
        'evaluation/platform-accessibility-manual-evaluation.json',
        'docs/operations/0912-evidence-trust-policy.json',
      ]) {
        const destination = resolve(root, relativePath);
        mkdirSync(dirname(destination), { recursive: true });
        writeFileSync(destination, readFileSync(resolve(projectRoot, relativePath)));
      }
      runGit(root, ['add', '.']);
      runGit(root, ['commit', '-m', 'test: seed release run binding']);
      const expectedCommit = runGit(root, ['rev-parse', 'HEAD']);
      const report = makeReadyReport();
      report.sourceCommit = expectedCommit;
      report.targetRevision.sourceCommit = expectedCommit;
      writeFileSync(resolve(root, CANONICAL_REPORT_PATH), JSON.stringify(report), 'utf8');

      expect(() => verify0912ReleaseReport({
        root,
        reportPath: CANONICAL_REPORT_PATH,
        expectedCommit,
        expectedTargetRevision: expectedCommit,
      })).toThrow('expected_release_run_id_required');
      expect(() => verify0912ReleaseReport({
        root,
        reportPath: CANONICAL_REPORT_PATH,
        expectedCommit,
        expectedTargetRevision: expectedCommit,
        expectedReleaseRunId: '55555555-5555-4555-8555-555555555555',
      })).toThrow('release_run_id_mismatch');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 15_000);

  test('rejects a source rename into an allowlisted evidence destination', () => {
    const root = mkdtempSync(join(tmpdir(), '0912-source-rename-'));
    try {
      initializeTestRepository(root);
      writeFileSync(resolve(root, 'source.txt'), 'tracked source', 'utf8');
      runGit(root, ['add', '.']);
      runGit(root, ['commit', '-m', 'test: seed source']);
      const expectedCommit = runGit(root, ['rev-parse', 'HEAD']);
      mkdirSync(resolve(root, 'evaluation'), { recursive: true });
      runGit(root, ['mv', 'source.txt', CANONICAL_REPORT_PATH]);
      runGit(root, ['commit', '-m', 'test: rename source']);

      expect(() => validateReleaseSourceBinding({ root, expectedCommit }))
        .toThrow('source_changes_after_expected_commit');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('rejects ignored public inputs and hidden index flags', () => {
    const root = mkdtempSync(join(tmpdir(), '0912-hidden-source-'));
    try {
      initializeTestRepository(root);
      writeFileSync(resolve(root, '.gitignore'), 'public/tmp-*\n', 'utf8');
      writeFileSync(resolve(root, 'source.txt'), 'tracked source', 'utf8');
      runGit(root, ['add', '.']);
      runGit(root, ['commit', '-m', 'test: seed source controls']);
      const expectedCommit = runGit(root, ['rev-parse', 'HEAD']);
      mkdirSync(resolve(root, 'public'), { recursive: true });
      writeFileSync(resolve(root, 'public/tmp-hidden.html'), 'hidden deploy input', 'utf8');
      expect(() => validateReleaseSourceBinding({ root, expectedCommit }))
        .toThrow('source_changes_after_expected_commit');

      rmSync(resolve(root, 'public/tmp-hidden.html'));
      runGit(root, ['update-index', '--assume-unchanged', 'source.txt']);
      writeFileSync(resolve(root, 'source.txt'), 'silently changed source', 'utf8');
      expect(() => validateReleaseSourceBinding({ root, expectedCommit }))
        .toThrow('source_index_flags_or_state_invalid');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('9/12 ready artifact binding', () => {
  const manualTargetState = {
    isCommitAncestor: true,
    changedPaths: [],
    commitCommittedAt: '2026-09-05T11:00:00.000Z',
  };
  const manualVerifiedAt = new Date('2026-09-05T14:00:00.000Z');
  const readSourceArtifact = (path) => Buffer.from(`source:${path}`, 'utf8');
  const expectedPostgresManifestPaths = Array.from(
    { length: 69 },
    (_unused, index) => `fixture/file-${String(index).padStart(2, '0')}.sql`,
  );

  function writeJson(root, relativePath, value) {
    const path = resolve(root, relativePath);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(value), 'utf8');
  }

  function passingManualEvidence(sourceCommit = SOURCE_COMMIT) {
    const evidence = createManualAccessibilityTemplate({
      baseUrl: 'https://climate-assembly.org',
      commitSha: sourceCommit,
      generatedAt: '2026-09-05T12:00:00.000Z',
    });
    evidence.status = 'pass';
    evidence.profiles = evidence.profiles.map((profile) => ({
      ...profile,
      environment: {
        assistiveTechnology: { name: 'Synthetic AT', version: '1' },
        browser: { name: 'Synthetic browser', version: '1' },
        operatingSystem: { name: 'Synthetic OS', version: '1' },
        device: 'Synthetic device',
      },
    }));
    evidence.cases = evidence.cases.map((item) => ({
      ...item,
      evaluator: 'Synthetic evaluator',
      testedAt: '2026-09-05T12:30:00.000Z',
      checks: item.checks.map((check) => ({
        ...check,
        status: 'pass',
        notes: 'Synthetic observation.',
      })),
    }));
    return evidence;
  }

  function writeReadyArtifacts(root, overrides = {}, options = {}) {
    const sourceCommit = options.sourceCommit ?? SOURCE_COMMIT;
    const sourceArtifact = options.readSourceArtifact ?? readSourceArtifact;
    const postgresManifestPaths = options.postgresManifestPaths ?? expectedPostgresManifestPaths;
    const traceabilityCheckIds = [
      'manifest-schema',
      'requirement-links',
      'report-template',
      'field-report-template',
      'hq-report-template',
      'canonical-plan-contract',
      'synthetic-fixture',
      'ci-matrix',
      'postgres-p1a-p2a-disposable',
      'seed-live-write-disabled',
      'backup-token-bound-export',
      'hq-attendance-session-boundary',
      'accessibility-routes',
      'field-context-preservation',
      'runbook-controls',
    ];
    const fieldCheckIds = ['0', '1', '1b', '2', '3', '4', '5', '6', '7', '8', '9'];
    const hqCheckIds = [
      'named-hq-session',
      'category-stable-retry',
      'kind-stable-retry',
      'stale-conflict-recovery',
      'clear-exact-set-conflict',
      'logout-failure-retains-capability',
      'logout-success-clears-capability',
      'deny-by-default-network',
    ];
    const manifest = postgresManifestPaths.map((path) => ({
      path,
      sha256: createHash('sha256')
        .update(sourceArtifact(path))
        .digest('hex'),
    }));
    const manifestSha256 = createHash('sha256')
      .update(JSON.stringify(manifest))
      .digest('hex');
    const snapshotCounts = {
      submission: 1,
      submission_item: 2,
      issue: 3,
      issue_link: 4,
      result_page: 5,
      ballot: 6,
      ballot_item: 7,
      ballot_response: 8,
    };
    const latestBackupPayload = {
      schema: 'climate-0829-backup/1',
      session: '0912-deliberation',
      captured_at: '2026-09-05T12:10:00.000Z',
      captured_at_kst: '2026-09-05_211000',
      captured_by: 'Synthetic operator',
      counts: { rows: 5, items: 4, teams_with_items: 3, finalized: 1 },
      submissions: [
        {
          item_content: 'item-a',
          team_id: 'team-1',
          submission_status: 'final',
          submission_id: 'submission-1',
        },
        {
          item_content: 'item-b',
          team_id: 'team-2',
          submission_status: 'draft',
          submission_id: 'submission-2',
        },
        {
          item_content: 'item-c',
          team_id: 'team-3',
          submission_status: 'draft',
          submission_id: 'submission-3',
        },
        {
          item_content: 'item-d',
          team_id: 'team-1',
          submission_status: 'final',
          submission_id: 'submission-1',
        },
        {
          item_content: null,
          team_id: 'team-3',
          submission_status: 'draft',
          submission_id: 'submission-3',
        },
      ],
      teams: [],
      attendance_summary: [],
    };
    const latestChecksumBody = JSON.stringify({
      ...latestBackupPayload,
      captured_at: undefined,
      captured_at_kst: undefined,
    }, null, 0);
    latestBackupPayload.checksum = `sha256:${createHash('sha256')
      .update(latestChecksumBody)
      .digest('hex')}`;
    const latestBackupBytes = Buffer.from(JSON.stringify(latestBackupPayload, null, 2), 'utf8');
    const latestBackupPath = resolve(root, 'latest.json');
    writeFileSync(latestBackupPath, latestBackupBytes);
    const latestBackupSha256 = createHash('sha256').update(latestBackupBytes).digest('hex');
    const archiveAudit = {
      schemaVersion: 2,
      event: 'platform_snapshot_export',
      exportedAt: '2026-09-05T12:10:00.000Z',
      repository: 'seojaehong/climate-assembly-wiki',
      runId: 'synthetic-run-1',
      commitSha: sourceCommit,
      workflowRef: '.github/workflows/snapshot.yml@refs/heads/main',
      keyId: 'snapshot-hmac-v3',
      snapshotId: 777,
      integrityAlgorithm: 'hmac-sha256',
      integrityTarget: 'legacy+platform+provenance',
    };
    const assignmentContract = (assignmentField) => ({
      effect: 'fixture-mutation',
      requestFields: [
        'p_token',
        'p_session_slug',
        'p_submission_id',
        'p_item_ordinal',
        assignmentField,
        'p_expected_submission_updated_at',
        'p_expected_event_id',
        'p_idempotency_key',
      ],
      responseStatuses: ['applied', 'conflict'],
      stableIdempotencyForExactRetry: true,
      compareAndSetFields: ['p_expected_submission_updated_at', 'p_expected_event_id'],
    });
    const accessibilityRouteEntries = Object.entries(CANONICAL_ACCESSIBILITY_ROUTE_PATHS);
    const accessibilityAudited = accessibilityRouteEntries.flatMap(([routeId]) => (
      ['desktop', 'mobile'].map((profile) => `${routeId}:${profile}`)
    ));
    const accessibilityRoutes = accessibilityAudited.map((id, index) => {
      const profile = index % 2 === 0 ? 'desktop' : 'mobile';
      const [routeId, path] = accessibilityRouteEntries[Math.floor(index / 2)];
      return {
        id,
        routeId,
        profile,
        viewport: profile === 'desktop'
          ? { width: 1440, height: 1000 }
          : { width: 360, height: 800 },
        path,
        url: `http://127.0.0.1:4331${path}`,
        fixture: 'synthetic-accessibility-fixture',
        fixtureNetworkRequired: false,
        fixtureNetwork: null,
        readiness: null,
        httpStatus: 200,
        passed: true,
        skipLink: { found: true, target: 'main', focusMoved: true },
        keyboardFocusOrder: {
          passed: true,
          focusAppearance: { passed: true },
        },
        requiredScrollRegions: [],
        layout: {
          horizontalOverflow: false,
          contentWidthSufficient: true,
          clippedOutsideScrollRegions: [],
        },
        violations: [],
        incomplete: [],
        error: null,
      };
    });
    const payloads = {
      traceabilityReport: options.traceabilityReport ?? {
        schemaVersion: 1,
        reportId: '0912-13-traceability-verification',
        generatedAt: '2026-09-05T12:00:00.000Z',
        sourceCommit,
        sourceTreeClean: true,
        status: 'pass',
        safety: { liveDatabaseMutationCount: 0, networkRequestCount: 0 },
        summary: {
          requirementCount: 15,
          checkCount: traceabilityCheckIds.length,
          passCount: traceabilityCheckIds.length,
          failCount: 0,
        },
        checks: traceabilityCheckIds.map((id) => ({
          id,
          status: 'pass',
          evidence: { verified: true },
        })),
        errors: [],
      },
      postgresVerificationReport: {
        schemaVersion: 1,
        reportId: '0912-p1a-p2a-postgres-verification',
        generatedAt: '2026-09-05T12:00:00.000Z',
        sourceCommit,
        sourceTreeClean: true,
        releaseMode: true,
        status: 'pass',
        database: 'disposable-postgres-16',
        checkFunctionBodies: true,
        staticContractVerification: 'passed',
        migrationOrderVerification: 'passed',
        behaviorVerification: 'passed',
        concurrentJoinRateLimitVerification: 'passed',
        concurrentTeamDeviceLimitVerification: 'passed',
        concurrentActiveRoundCreationVerification: 'passed',
        concurrentSharedHqThrottleVerification: 'passed',
        concurrentNamedPasswordRecoveryVerification: 'passed',
        ballotCloseRaceVerification: 'passed',
        rollbackWithoutActivity: 'passed',
        rollbackWithActivity: 'refused',
        canvasScopeRollbackGuardVerification: 'passed',
        tokenOnlyActivationVerification: 'passed',
        legacyPermissionNegativeVerification: 'passed',
        legacyCrossSessionDeadlineNegativeVerification: 'passed',
        predictableJoinCodeExclusionVerification: 'passed',
        postP4LegacyNegativeVerification: 'passed',
        p3ReadOnlyPostApplyVerification: 'passed',
        p4ReadOnlyPostApplyVerification: 'passed',
        p4LegacyHistoryPreservationVerification: 'passed',
        p4BehaviorVerification: 'passed',
        activationRollbackGuardVerification: 'passed',
        activationRollbackExerciseVerification: 'passed',
        activationReapplyVerification: 'passed',
        seedCliSqlSyntaxAndSuccessVerification: 'passed',
        seedCliPartialTenancyFailClosedVerification: 'passed',
        seedCliCapabilityValuesLogged: 0,
        seedCliHostTemporaryFileMode: '0600',
        seedCliHostTemporaryFileRemovedBeforeExecution: true,
        seedCliContainerCopyRemovedWithCreatedContainer: true,
        targetManifestCount: manifest.length,
        targetManifestSha256: manifestSha256,
        targetManifestVerifiedAtCompletion: true,
        targetManifest: manifest,
        safety: { productionDatabaseConnectionCount: 0, productionMutationCount: 0 },
        elapsedSeconds: 1,
      },
      fieldRehearsalReport: {
        schemaVersion: 1,
        rehearsalId: '0912-13-field-rehearsal',
        generatedAt: '2026-09-05T12:00:00.000Z',
        elapsedMs: 1,
        sourceCommit,
        sourceTreeClean: true,
        target: { baseUrl: 'http://127.0.0.1:4331', route: '/mod?code=[redacted]' },
        fixture: 'automation/fixtures/0912-rehearsal.json',
        fixtureSha256: createHash('sha256')
          .update(sourceArtifact('automation/fixtures/0912-rehearsal.json'))
          .digest('hex'),
        fixtureIdentity: {
          schemaVersion: 1,
          fixtureId: '0912-field-rehearsal-v1',
          classification: 'synthetic-no-pii-no-secrets',
        },
        observedConfiguration: {
          fixtureId: '0912-field-rehearsal-v1',
          session: {},
          team: {},
          topics: [],
          rpcAllowlist: [],
          flow: {},
        },
        status: 'pass',
        summary: {
          checkCount: fieldCheckIds.length,
          passCount: fieldCheckIds.length,
          failCount: 0,
        },
        safety: {
          liveNetworkRequestCount: 0,
          liveDatabaseMutationCount: 0,
          capabilityValuesLeakedToDraftQueueOrEvidence: false,
          capabilityLeakScan: {
            draftQueueEntryCount: 1,
            draftQueueMatchCount: 0,
            evidenceMatchCount: 0,
          },
        },
        networkContract: {
          codeRemovedBeforeExchange: true,
          workshopSessionPersisted: true,
          codeExchangeCount: 1,
          tokenResumeCount: 1,
          legacyJoinCodeRpcCount: 0,
          tokenContractViolationCount: 0,
          unexpectedRpcRequestCount: 0,
          unexpectedRpcNames: [],
          fixtureMutationRequestCount: 1,
          escapedExternalRequestCount: 0,
          escapedExternalOrigins: [],
          queueSchemaVersion: 2,
          occRequestCount: 1,
          webSocket: {
            stubbed: true,
            stubConnectionAttemptCount: 0,
            actualNetworkConnectionCount: 0,
            blockedExternalConnectionAttemptCount: 0,
            blockedExternalOrigins: [],
          },
        },
        checks: fieldCheckIds.map((id) => ({
          id,
          title: `check ${id}`,
          status: 'pass',
          expected: 'expected behavior',
          observed: 'observed behavior',
        })),
        findings: [],
        screenshots: '.tmp-verify/rehearsal-*.png',
      },
      hqFieldRehearsalReport: {
        schemaVersion: 1,
        rehearsalId: '0912-13-hq-v3-browser-rehearsal',
        generatedAt: '2026-09-05T12:00:00.000Z',
        elapsedMs: 1,
        sourceCommit,
        sourceTreeClean: true,
        status: 'pass',
        target: { baseUrl: 'http://127.0.0.1:4331', route: '/hq?ops=1' },
        fixture: 'automation/fixtures/0912-hq-rehearsal.json',
        fixtureSha256: createHash('sha256')
          .update(sourceArtifact('automation/fixtures/0912-hq-rehearsal.json'))
          .digest('hex'),
        fixtureIdentity: {
          schemaVersion: 1,
          fixtureId: '0912-hq-v3-rehearsal-v1',
          classification: 'synthetic-no-pii-no-secrets',
        },
        evidenceBoundary: {
          evidenceClass: 'ui-fixture-only',
          databaseAuthorizationOrLifecycleEvidence: false,
          canonicalDatabaseVerifier: 'scripts/verify-0912-postgres.sh',
          statement: 'Synthetic browser evidence only.',
        },
        summary: {
          checkCount: hqCheckIds.length,
          passCount: hqCheckIds.length,
          failCount: 0,
        },
        safety: {
          allSupabaseHttpIntercepted: true,
          interceptedSupabaseHttpRequestCount: 1,
          forwardedSupabaseHttpRequestCount: 0,
          blockedUnexpectedSupabaseHttpRequestCount: 0,
          blockedUnexpectedSupabaseRpcNames: [],
          blockedExternalHttpRequestCount: 0,
          fixtureReadRequestCount: 1,
          fixtureMutationRequestCount: 1,
          productionDatabaseMutationCount: 0,
          contractViolationCount: 0,
          contractViolations: [],
          webSocket: { stubbed: true, attemptCount: 0, actualConnectionCount: 0 },
          screenshotsWritten: 0,
          runtimeCapabilityMaterialDetectedBeforeWrite: false,
          runtimeCapabilityMaterialInWrittenReport: false,
        },
        namedHqSession: {
          injected: true,
          actorLabel: 'Synthetic operator',
          capabilitySource: 'runtime-generated',
          capabilityPersistedAfterLogoutFailure: true,
          capabilityClearedAfterLogoutSuccess: true,
        },
        rpcContracts: {
          hq_submission_category_assign_v3: assignmentContract('p_category'),
          hq_submission_kind_assign_v3: assignmentContract('p_kind'),
          hq_clear_submissions_v3: {
            effect: 'fixture-mutation',
            requestFields: [
              'p_token',
              'p_session_slug',
              'p_confirm',
              'p_expected_submissions',
              'p_idempotency_key',
            ],
            responseStatuses: ['applied', 'conflict'],
            exactSetField: 'p_expected_submissions',
          },
          workshop_hq_logout_v2: {
            effect: 'fixture-mutation',
            requestFields: ['p_token'],
            successResponse: 'true',
            failureKeepsLocalCapability: true,
          },
        },
        observations: {
          rpcCallCounts: { hq_submissions_v3: 1 },
          categoryRetry: {
            exactRequestRetried: true,
            stableIdempotencyKey: true,
            stableExpectedEventId: true,
            stableExpectedSubmissionUpdatedAt: true,
          },
          kindRetry: {
            exactRequestRetried: true,
            stableIdempotencyKey: true,
            stableExpectedEventId: true,
            stableExpectedSubmissionUpdatedAt: true,
          },
          staleConflictReloaded: true,
          exactSetClearConflictPreservedRows: true,
          logoutFailurePreservedCapability: true,
          logoutSuccessClearedCapability: true,
        },
        checks: hqCheckIds.map((id) => ({
          id,
          label: `check ${id}`,
          status: 'pass',
          observed: { verified: true },
        })),
        findings: [],
      },
      accessibilityReport: {
        schemaVersion: 5,
        generatedAt: '2026-09-05T12:00:00.000Z',
        sourceCommit,
        sourceTreeClean: true,
        evidenceClassification: 'release-evidence',
        releaseEvidence: true,
        targetRevision: { status: 'verified', sourceCommit },
        baseUrl: 'http://127.0.0.1:4331',
        standard: 'WCAG 2.2 AA automated subset',
        engine: {
          name: 'axe-core',
          version: '4.12.1',
          tags: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'],
        },
        status: 'needs_review',
        summary: {
          routeCount: 23,
          profileCount: 2,
          passedRoutes: 23,
          auditCaseCount: 46,
          passedCases: 46,
          violationCount: 0,
          incompleteCount: 0,
          excludedSurfaceCount: 1,
        },
        coverage: {
          profiles: [
            { id: 'desktop', viewport: { width: 1440, height: 1000 } },
            {
              id: 'mobile',
              viewport: { width: 360, height: 800 },
              minimumContentWidth: 280,
            },
          ],
          audited: accessibilityAudited,
          excluded: [{
            id: 'assistive-technology-manual-evaluation',
            reason: 'Requires manual evaluation.',
          }],
        },
        routes: accessibilityRoutes,
      },
      manualAccessibilityEvidence: passingManualEvidence(sourceCommit),
      backupManifest: {
        schemaVersion: 1,
        evidenceType: '0912-backup-manifest',
        status: 'pass',
        releaseRunId: RELEASE_RUN_ID,
        sourceCommit,
        generatedAt: '2026-09-05T12:20:00.000Z',
        attestation: null,
        producer: 'approved-snapshot-workflow',
        workflow: {
          runId: 'synthetic-run-1',
          keyId: 'snapshot-hmac-v3',
          executionMode: 'approved-service-role-workflow',
          hmacVerified: true,
          browserExecution: false,
        },
        snapshot: {
          snapshotId: 777,
          session: '0912-deliberation',
          archiveObjectRef: 's3://climate-backups/0912/snapshot-77.dump?versionId=fixture-77',
          archiveSizeBytes: 1,
          archiveSha256: 'e'.repeat(64),
          archiveAudit: { ...archiveAudit },
          counts: { ...snapshotCounts },
        },
        latest: {
          capturedAt: '2026-09-05T12:10:00.000Z',
          checksumSha256: latestBackupSha256,
          teamCount: 3,
          itemCount: 4,
          finalizedSubmissionCount: 1,
        },
      },
      restoreLog: {
        schemaVersion: 1,
        evidenceType: '0912-restore-rehearsal',
        status: 'pass',
        releaseRunId: RELEASE_RUN_ID,
        sourceCommit,
        generatedAt: '2026-09-05T12:30:00.000Z',
        attestation: null,
        producer: 'isolated-postgres-restore-rehearsal',
        snapshot: {
          snapshotId: 777,
          archiveObjectRef: 's3://climate-backups/0912/snapshot-77.dump?versionId=fixture-77',
          archiveSizeBytes: 1,
          archiveSha256: 'e'.repeat(64),
          archiveAudit: { ...archiveAudit },
        },
        environment: {
          engine: 'postgresql',
          majorVersion: 16,
          databaseName: 'verify',
          networkMode: 'none',
          containerName: 'synthetic-restore-1',
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
          originalCounts: { ...snapshotCounts },
          restoredCounts: { ...snapshotCounts },
        },
      },
      operatorLog: null,
      ...overrides,
    };

    if (payloads.backupManifest?.attestation === null) {
      payloads.backupManifest.attestation = attestEvidence(
        payloads.backupManifest,
        '2026-09-05T12:21:00.000Z',
      );
    }
    if (payloads.restoreLog?.attestation === null) {
      payloads.restoreLog.attestation = attestEvidence(
        payloads.restoreLog,
        '2026-09-05T12:31:00.000Z',
      );
    }

    const archiveBytes = Buffer.from(JSON.stringify({
      legacy: {},
      platform: { id: 777, source: 'platform' },
      audit: {
        schemaVersion: archiveAudit.schemaVersion,
        event: archiveAudit.event,
        exportedAt: archiveAudit.exportedAt,
        repository: archiveAudit.repository,
        runId: archiveAudit.runId,
        commitSha: archiveAudit.commitSha,
        workflowRef: archiveAudit.workflowRef,
        keyId: archiveAudit.keyId,
        snapshotId: archiveAudit.snapshotId,
        integrity: {
          algorithm: archiveAudit.integrityAlgorithm,
          target: archiveAudit.integrityTarget,
          digest: 'f'.repeat(64),
        },
      },
    }), 'utf8');
    const archiveSha256 = createHash('sha256').update(archiveBytes).digest('hex');
    const backupArchivePath = resolve(root, 'snapshot-77.dump');
    writeFileSync(backupArchivePath, archiveBytes);
    for (const value of [payloads.backupManifest, payloads.restoreLog]) {
      value.snapshot.archiveSizeBytes = archiveBytes.length;
      value.snapshot.archiveSha256 = archiveSha256;
      value.attestation = attestEvidence(
        value,
        value.evidenceType === '0912-backup-manifest'
          ? '2026-09-05T12:21:00.000Z'
          : '2026-09-05T12:31:00.000Z',
      );
    }

    for (const [key, payload] of Object.entries(payloads)) {
      if (key !== 'operatorLog') writeJson(root, readyArtifacts[key], payload);
    }

    const controlNames = [
      'aclInventory',
      'directEdgeProbe',
      'deploymentRevision',
      'backupRestore',
      'onsiteRehearsal',
      'tokenRevocation',
      'rollbackReadiness',
    ];
    const operator = {
      schemaVersion: 2,
      evidenceType: '0912-operator-readiness',
      session: '0912-deliberation',
      releaseRunId: RELEASE_RUN_ID,
      generatedAt: '2026-09-05T13:30:00.000Z',
      sourceCommit,
      targetRevision: sourceCommit,
      productionEnvironment: { ...OPERATOR_PRODUCTION_ENVIRONMENT },
      artifactBindings: [],
      status: 'pass',
      attestation: null,
      approvals: CANONICAL_0912_APPROVAL_SCOPES.map((scope, index) => {
        const [phase, minute] = OPERATOR_APPROVAL_TIMES[index];
        return {
        id: `approval-${scope.scope}`,
        scope: scope.scope,
        status: 'approved',
        approvedAt: operatorTime(phase, minute),
        approver: {
          id: `situation-owner-${index + 1}`,
          label: `상황 책임자 ${index + 1}`,
          role: 'situation-owner',
        },
        session: '0912-deliberation',
        sourceCommit,
        targetRevision: sourceCommit,
        rolloutStepIds: [...scope.rolloutStepIds],
        gateIds: [...scope.gateIds],
        };
      }),
      safety: null,
      gates: CANONICAL_0912_GATE_IDS.map((id, index) => {
        const [phase, minute] = OPERATOR_GATE_TIMES[index];
        return {
          id,
          status: 'pass',
          executedAt: operatorTime(phase, minute),
          evidence: {
            type: `0912-gate-${id}-v1`,
            reference: canonical0912OperatorReceiptPath('gate', index, id),
            measurement: operatorMeasurement('gate', id, sourceCommit),
            productionAccess: operatorExecutionAccess('gate', id),
          },
        };
      }),
      rolloutSteps: CANONICAL_0912_ROLLOUT_IDS.map((id, index) => {
        const [phase, minute] = OPERATOR_ROLLOUT_TIMES[index];
        return {
          id,
          status: 'pass',
          executedAt: operatorTime(phase, minute),
          evidence: {
            type: `0912-rollout-${id}-v1`,
            reference: canonical0912OperatorReceiptPath('rollout', index, id),
            measurement: operatorMeasurement('rollout', id, sourceCommit),
            productionAccess: operatorExecutionAccess('rollout', id),
          },
        };
      }),
      controls: {
        aclInventory: {
          status: 'pass',
          checkedAt: '2026-09-05T12:50:00.000Z',
          evidenceRef: canonical0912OperatorReceiptPath('control', 0, 'acl-inventory'),
          sourceCommit,
          targetRevision: sourceCommit,
          productionAccess: operatorAccess('no-production-db'),
          details: {
            identityArgumentAllowlistMatched: true,
            publicExecutableRoutineCount: 0,
            unapprovedAnonAuthenticatedRoutineCount: 0,
            legacyExecutableRoutineCount: 0,
          },
        },
        directEdgeProbe: {
          status: 'pass',
          checkedAt: '2026-09-05T12:51:00.000Z',
          evidenceRef: canonical0912OperatorReceiptPath('control', 1, 'direct-edge-probe'),
          sourceCommit,
          targetRevision: sourceCommit,
          productionAccess: operatorAccess(
            'no-production-db', null, OPERATOR_PRODUCTION_ENVIRONMENT.id,
          ),
          details: {
            requestCount: 4,
            forwardedForOverrideCount: 0,
            realIpOverrideCount: 0,
            trustedEdgeSourceStable: true,
            edgeOnlyExchangeVerified: true,
          },
        },
        deploymentRevision: {
          status: 'pass',
          checkedAt: '2026-09-05T12:52:00.000Z',
          evidenceRef: canonical0912OperatorReceiptPath('control', 2, 'deployment-revision'),
          sourceCommit,
          targetRevision: sourceCommit,
          productionAccess: operatorAccess(
            'no-production-db', null, OPERATOR_PRODUCTION_ENVIRONMENT.id,
          ),
          details: {
            endpointCount: 2,
            expectedRevision: sourceCommit,
            observedRevision: sourceCommit,
          },
        },
        backupRestore: {
          status: 'pass',
          checkedAt: '2026-09-05T12:53:00.000Z',
          evidenceRef: canonical0912OperatorReceiptPath('control', 3, 'backup-restore'),
          sourceCommit,
          targetRevision: sourceCommit,
          productionAccess: operatorAccess('no-production-db'),
          details: {
            snapshotId: 777,
            archiveSha256,
            checksumMatch: true,
            rowCountMatch: true,
            postgresMajorVersion: 16,
            isolatedNetwork: true,
            containerDisposed: true,
          },
        },
        onsiteRehearsal: {
          status: 'pass',
          checkedAt: '2026-09-05T12:54:00.000Z',
          evidenceRef: canonical0912OperatorReceiptPath('control', 4, 'onsite-rehearsal'),
          sourceCommit,
          targetRevision: sourceCommit,
          productionAccess: operatorAccess(
            'no-production-db',
            null,
            OPERATOR_PRODUCTION_ENVIRONMENT.id,
          ),
          details: {
            deviceCount: 3,
            networkProfileCount: 2,
            failedScenarioCount: 0,
            desktopVerified: true,
            mobileVerified: true,
            keyboardOnlyVerified: true,
          },
        },
        tokenRevocation: {
          status: 'pass',
          checkedAt: '2026-09-05T12:55:00.000Z',
          evidenceRef: canonical0912OperatorReceiptPath('control', 5, 'token-revocation'),
          sourceCommit,
          targetRevision: sourceCommit,
          productionAccess: operatorAccess('no-production-db'),
          details: {
            revokedTokenReuseAcceptedCount: 0,
            hqLogoutRevocationVerified: true,
            passwordChangeAllDevicesRevoked: true,
            teamDeviceRevocationVerified: true,
          },
        },
        rollbackReadiness: {
          status: 'pass',
          checkedAt: '2026-09-05T12:56:00.000Z',
          evidenceRef: canonical0912OperatorReceiptPath('control', 6, 'rollback-readiness'),
          sourceCommit,
          targetRevision: sourceCommit,
          productionAccess: operatorAccess('no-production-db'),
          details: {
            rollbackArtifactSha256: createHash('sha256')
              .update(sourceArtifact(
                'supabase/rollbacks/platform_p2a_0912_token_only_activation_BEFORE.sql',
              ))
              .digest('hex'),
            activityGuardRefusalVerified: true,
            isolatedRollbackExercisePassed: true,
            activationReapplyVerified: true,
          },
        },
      },
    };
    const productionAccesses = [
      ...operator.gates.map((entry) => entry.evidence.productionAccess),
      ...operator.rolloutSteps.map((entry) => entry.evidence.productionAccess),
      ...Object.values(operator.controls).map((control) => control.productionAccess),
    ];
    operator.safety = productionAccesses.reduce((safety, access) => {
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
    expect(operator.safety.approvedRolloutMutationCount)
      .toBe(EXPECTED_APPROVED_MUTATION_COUNT);
    for (const definition of [
      {
        rolloutId: 'p3-design-provisioning',
        evidenceType: '0912-p3-production-result',
        migrationPath: 'supabase/migrations/platform_p3_design_provisioning.sql',
        verificationPath: 'supabase/verify/design_provisioning_post_apply.sql',
        historyId: 'platform_p3_design_provisioning',
        checkIds: ['p3-post-apply-script'],
        startedAt: '2026-09-05T12:42:48.000Z',
        completedAt: '2026-09-05T12:42:59.000Z',
      },
      {
        rolloutId: 'p4-audit-log',
        evidenceType: '0912-p4-production-result',
        migrationPath: 'supabase/migrations/platform_p4_audit_log.sql',
        verificationPath: 'supabase/verify/platform_audit_post_apply.sql',
        historySnapshotPath: 'supabase/verify/platform_audit_history_snapshot.sql',
        historyId: 'platform_p4_audit_log',
        checkIds: ['p4-post-apply-script', 'p4-legacy-history-preserved'],
        startedAt: '2026-09-05T12:43:06.000Z',
        completedAt: '2026-09-05T12:43:19.000Z',
      },
    ]) {
      const rollout = operator.rolloutSteps.find((entry) => entry.id === definition.rolloutId);
      const access = rollout.evidence.productionAccess;
      const productionResult = {
        schemaVersion: 1,
        evidenceType: definition.evidenceType,
        rolloutId: definition.rolloutId,
        releaseRunId: RELEASE_RUN_ID,
        sourceCommit,
        targetRevision: sourceCommit,
        productionEnvironmentId: OPERATOR_PRODUCTION_ENVIRONMENT.id,
        mode: access.mode,
        approvalId: access.approvalId,
        startedAt: definition.startedAt,
        completedAt: definition.completedAt,
        migration: {
          path: definition.migrationPath,
          sha256: createHash('sha256').update(sourceArtifact(definition.migrationPath)).digest('hex'),
          historyId: definition.historyId,
          historyRowCount: 1,
          historyChecksumMatched: true,
        },
        verification: {
          path: definition.verificationPath,
          sha256: createHash('sha256').update(sourceArtifact(definition.verificationPath)).digest('hex'),
          exitCode: 0,
          status: 'pass',
          checkCount: definition.checkIds.length,
          failedCheckCount: 0,
          checks: definition.checkIds.map((id) => ({ id, status: 'pass' })),
        },
        productionAccess: {
          connectionCount: access.connectionCount,
          mutationCount: access.mutationCount,
        },
      };
      if (definition.historySnapshotPath) {
        productionResult.legacyHistory = {
          snapshotPath: definition.historySnapshotPath,
          snapshotSha256: createHash('sha256')
            .update(sourceArtifact(definition.historySnapshotPath))
            .digest('hex'),
          algorithm: 'sha256-canonical-jsonb-v1',
          capturedBeforeAt: '2026-09-05T12:43:07.000Z',
          capturedAfterAt: '2026-09-05T12:43:18.000Z',
          attendance: {
            rowCountBefore: 11,
            rowCountAfter: 11,
            sha256Before: 'a'.repeat(64),
            sha256After: 'a'.repeat(64),
          },
          workshop: {
            rowCountBefore: 7,
            rowCountAfter: 7,
            sha256Before: 'b'.repeat(64),
            sha256After: 'b'.repeat(64),
          },
        };
      }
      writeJson(
        root,
        CANONICAL_0912_PRODUCTION_RESULT_PATHS[definition.rolloutId],
        productionResult,
      );
    }
    const receiptCoordinates = [
      ...CANONICAL_0912_GATE_IDS.map((id, index) => ({
        kind: 'gate', id, index, record: operator.gates[index], recordedAt: operator.gates[index].executedAt,
      })),
      ...CANONICAL_0912_ROLLOUT_IDS.map((id, index) => ({
        kind: 'rollout', id, index, record: operator.rolloutSteps[index], recordedAt: operator.rolloutSteps[index].executedAt,
      })),
      ...CANONICAL_0912_CONTROL_RECEIPT_IDS.map((id, index) => ({
        kind: 'control',
        id,
        index,
        record: operator.controls[controlNames[index]],
        recordedAt: operator.controls[controlNames[index]].checkedAt,
      })),
    ];
    for (const coordinate of receiptCoordinates) {
      writeJson(root, canonical0912OperatorReceiptPath(
        coordinate.kind,
        coordinate.index,
        coordinate.id,
      ), {
        schemaVersion: 1,
        evidenceType: `0912-${coordinate.kind}-${coordinate.id}-receipt-v1`,
        releaseRunId: RELEASE_RUN_ID,
        sourceCommit,
        targetRevision: sourceCommit,
        productionEnvironmentId: OPERATOR_PRODUCTION_ENVIRONMENT.id,
        kind: coordinate.kind,
        id: coordinate.id,
        recordedAt: coordinate.recordedAt,
        record: coordinate.record,
      });
    }
    for (const path of [
      'evaluation/0912-13-implementation-verification.md',
      'evaluation/0912-13-security-diff-review.md',
    ]) {
      const absolutePath = resolve(root, path);
      mkdirSync(dirname(absolutePath), { recursive: true });
      writeFileSync(absolutePath, '# Synthetic reviewed evidence\n\nNo blocking finding.\n', 'utf8');
    }
    operator.artifactBindings = CANONICAL_0912_OPERATOR_BINDING_PATHS.map((path) => ({
      path,
      sha256: createHash('sha256').update(readFileSync(resolve(root, path))).digest('hex'),
    }));
    operator.attestation = attestOperator(operator);
    writeJson(root, readyArtifacts.operatorLog, operator);
    return { backupArchivePath, latestBackupPath };
  }

  test('requires the signed latest backup bytes to match the backup producer schema and counts', () => {
    const root = mkdtempSync(join(tmpdir(), '0912-latest-backup-'));
    try {
      const { latestBackupPath } = writeReadyArtifacts(root);
      const backup = JSON.parse(readFileSync(
        resolve(root, readyArtifacts.backupManifest),
        'utf8',
      ));
      expect(verify0912LatestBackupBytes(latestBackupPath, backup)).toBe(true);

      const semanticMismatch = JSON.parse(readFileSync(latestBackupPath, 'utf8'));
      semanticMismatch.counts.items = 3;
      const unsignedMismatch = {
        ...semanticMismatch,
        captured_at: undefined,
        captured_at_kst: undefined,
        checksum: undefined,
      };
      semanticMismatch.checksum = `sha256:${createHash('sha256')
        .update(JSON.stringify(unsignedMismatch, null, 0))
        .digest('hex')}`;
      const mismatchBytes = Buffer.from(JSON.stringify(semanticMismatch, null, 2), 'utf8');
      writeFileSync(latestBackupPath, mismatchBytes);
      backup.latest.checksumSha256 = createHash('sha256').update(mismatchBytes).digest('hex');
      backup.latest.itemCount = 3;
      expect(verify0912LatestBackupBytes(latestBackupPath, backup)).toBe(false);

      const plainText = Buffer.from('synthetic latest backup bytes', 'utf8');
      writeFileSync(latestBackupPath, plainText);
      backup.latest.checksumSha256 = createHash('sha256').update(plainText).digest('hex');
      expect(verify0912LatestBackupBytes(latestBackupPath, backup)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('combines a complete automated audit with separate passing manual evidence', () => {
    const root = mkdtempSync(join(tmpdir(), '0912-ready-artifacts-'));
    try {
      const { backupArchivePath, latestBackupPath } = writeReadyArtifacts(root);
      const postgres = JSON.parse(readFileSync(
        resolve(root, readyArtifacts.postgresVerificationReport),
        'utf8',
      ));
      const accessibility = JSON.parse(readFileSync(
        resolve(root, readyArtifacts.accessibilityReport),
        'utf8',
      ));
      const operator = JSON.parse(readFileSync(
        resolve(root, readyArtifacts.operatorLog),
        'utf8',
      ));
      expect(() => validate0912OperatorEvidence({
        operator,
        expectedSourceCommit: SOURCE_COMMIT,
        expectedTargetRevision: SOURCE_COMMIT,
        expectedReleaseRunId: RELEASE_RUN_ID,
        expectedProductionEnvironment: OPERATOR_PRODUCTION_ENVIRONMENT,
        expectedGateIds: CANONICAL_0912_GATE_IDS,
        expectedRolloutIds: CANONICAL_0912_ROLLOUT_IDS,
        trustedPublicKey: OPERATOR_PUBLIC_KEY,
        verifiedAt: manualVerifiedAt.toISOString(),
      })).not.toThrow();
      expect(hasPassingPostgresEvidence(postgres, expectedPostgresManifestPaths)).toBe(true);
      expect(hasPassingAutomatedAccessibilityEvidence(accessibility)).toBe(true);
      for (const [artifactKey, artifactPath] of Object.entries(readyArtifacts)) {
        const artifact = JSON.parse(readFileSync(resolve(root, artifactPath), 'utf8'));
        expect(
          contains0912SensitiveMaterial(artifact),
          `${artifactKey}: ${find0912SensitiveMaterialPath(artifact) ?? 'none'}`,
        ).toBe(false);
      }
      const readyReport = makeReadyReport();
      expect(
        contains0912SensitiveMaterial(readyReport),
        `readiness report: ${find0912SensitiveMaterialPath(readyReport) ?? 'none'}`,
      ).toBe(false);
      expect(verifyReadyArtifactPayloads(
        root,
        readyReport,
        SOURCE_COMMIT,
        {
          manualTargetState,
          manualVerifiedAt,
          readSourceArtifact,
          expectedPostgresManifestPaths,
          trustedEvidencePublicKeys: TRUSTED_EVIDENCE_PUBLIC_KEYS,
          trustPolicy: EVIDENCE_TRUST_POLICY,
          backupArchivePath,
          latestBackupPath,
          traceabilityEvidenceVerifier: () => true,
        },
      )).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test.each([
    ['cross-run replay', (result) => { result.releaseRunId = '55555555-5555-4555-8555-555555555555'; }],
    ['wrong committed verifier hash', (result) => { result.verification.sha256 = '0'.repeat(64); }],
    ['verification before approval', (result) => { result.startedAt = '2026-09-05T12:42:00.000Z'; }],
    ['production count mismatch', (result) => { result.productionAccess.mutationCount += 1; }],
    ['failed post-apply check', (result) => {
      result.verification.status = 'fail';
      result.verification.failedCheckCount = 1;
      result.verification.checks[0].status = 'fail';
    }],
  ])('rejects a re-signed P3 production result with %s', (_label, mutate) => {
    const root = mkdtempSync(join(tmpdir(), '0912-production-result-'));
    try {
      const { backupArchivePath, latestBackupPath } = writeReadyArtifacts(root);
      const resultPath = CANONICAL_0912_PRODUCTION_RESULT_PATHS['p3-design-provisioning'];
      const result = JSON.parse(readFileSync(resolve(root, resultPath), 'utf8'));
      mutate(result);
      writeJson(root, resultPath, result);

      const operatorPath = resolve(root, readyArtifacts.operatorLog);
      const operator = JSON.parse(readFileSync(operatorPath, 'utf8'));
      const binding = operator.artifactBindings.find((entry) => entry.path === resultPath);
      binding.sha256 = createHash('sha256').update(readFileSync(resolve(root, resultPath))).digest('hex');
      operator.attestation = attestOperator(operator);
      writeJson(root, readyArtifacts.operatorLog, operator);

      expect(verifyReadyArtifactPayloads(
        root,
        makeReadyReport(),
        SOURCE_COMMIT,
        {
          manualTargetState,
          manualVerifiedAt,
          readSourceArtifact,
          expectedPostgresManifestPaths,
          trustedEvidencePublicKeys: TRUSTED_EVIDENCE_PUBLIC_KEYS,
          trustPolicy: EVIDENCE_TRUST_POLICY,
          backupArchivePath,
          latestBackupPath,
          traceabilityEvidenceVerifier: () => true,
        },
      )).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test.each([
    ['legacy attendance count drift', (result) => { result.legacyHistory.attendance.rowCountAfter += 1; }],
    ['legacy workshop digest drift', (result) => { result.legacyHistory.workshop.sha256After = 'c'.repeat(64); }],
    ['wrong committed snapshot query hash', (result) => {
      result.legacyHistory.snapshotSha256 = '0'.repeat(64);
    }],
    ['snapshot captured outside the rollout interval', (result) => {
      result.legacyHistory.capturedBeforeAt = '2026-09-05T12:43:05.000Z';
    }],
    ['missing history preservation check', (result) => {
      result.verification.checkCount = 1;
      result.verification.checks.pop();
    }],
  ])('rejects a re-signed P4 production result with %s', (_label, mutate) => {
    const root = mkdtempSync(join(tmpdir(), '0912-p4-production-result-'));
    try {
      const { backupArchivePath, latestBackupPath } = writeReadyArtifacts(root);
      const resultPath = CANONICAL_0912_PRODUCTION_RESULT_PATHS['p4-audit-log'];
      const result = JSON.parse(readFileSync(resolve(root, resultPath), 'utf8'));
      mutate(result);
      writeJson(root, resultPath, result);

      const operatorPath = resolve(root, readyArtifacts.operatorLog);
      const operator = JSON.parse(readFileSync(operatorPath, 'utf8'));
      const binding = operator.artifactBindings.find((entry) => entry.path === resultPath);
      binding.sha256 = createHash('sha256').update(readFileSync(resolve(root, resultPath))).digest('hex');
      operator.attestation = attestOperator(operator);
      writeJson(root, readyArtifacts.operatorLog, operator);

      expect(verifyReadyArtifactPayloads(
        root,
        makeReadyReport(),
        SOURCE_COMMIT,
        {
          manualTargetState,
          manualVerifiedAt,
          readSourceArtifact,
          expectedPostgresManifestPaths,
          trustedEvidencePublicKeys: TRUSTED_EVIDENCE_PUBLIC_KEYS,
          trustPolicy: EVIDENCE_TRUST_POLICY,
          backupArchivePath,
          latestBackupPath,
          traceabilityEvidenceVerifier: () => true,
        },
      )).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('finalizes one filled operator draft into 56 canonical receipts and 68 bindings', () => {
    const root = mkdtempSync(join(tmpdir(), '0912-finalize-operator-'));
    try {
      writeReadyArtifacts(root);
      const operatorPath = resolve(root, readyArtifacts.operatorLog);
      const draft = JSON.parse(readFileSync(operatorPath, 'utf8'));
      draft.attestation = null;
      draft.artifactBindings = draft.artifactBindings.map(({ path }) => ({ path, sha256: null }));
      for (const path of CANONICAL_0912_OPERATOR_BINDING_PATHS) {
        if (path.includes('/0912-operator/')) rmSync(resolve(root, path));
      }

      const outputPath = '.tmp-verify/0912-operator/final-unsigned.json';

      const packet = finalize0912OperatorPacket({
        root,
        draft,
        verifiedAt: manualVerifiedAt.toISOString(),
        outputPath,
      });
      const receiptPaths = CANONICAL_0912_OPERATOR_BINDING_PATHS
        .filter((path) => path.includes('/0912-operator/'));
      expect(receiptPaths).toHaveLength(56);
      expect(receiptPaths.every((path) => existsSync(resolve(root, path)))).toBe(true);
      expect(JSON.parse(readFileSync(resolve(root, outputPath), 'utf8'))).toEqual(packet);
      expect(packet.artifactBindings).toHaveLength(68);
      expect(() => validate0912UnsignedOperatorEvidence({
        operator: packet,
        expectedSourceCommit: SOURCE_COMMIT,
        expectedTargetRevision: SOURCE_COMMIT,
        expectedReleaseRunId: RELEASE_RUN_ID,
        expectedProductionEnvironment: OPERATOR_PRODUCTION_ENVIRONMENT,
        expectedGateIds: CANONICAL_0912_GATE_IDS,
        expectedRolloutIds: CANONICAL_0912_ROLLOUT_IDS,
        verifiedAt: manualVerifiedAt.toISOString(),
      })).not.toThrow();

      const committedHashes = new Map([...receiptPaths, outputPath].map((path) => [
        path,
        createHash('sha256').update(readFileSync(resolve(root, path))).digest('hex'),
      ]));
      expect(() => finalize0912OperatorPacket({
        root,
        draft,
        verifiedAt: manualVerifiedAt.toISOString(),
        outputPath,
      })).toThrow('output_exists');
      expect([...committedHashes].every(([path, sha256]) => (
        createHash('sha256').update(readFileSync(resolve(root, path))).digest('hex') === sha256
      ))).toBe(true);

      expect(() => finalize0912OperatorPacket({
        root,
        draft,
        force: true,
        verifiedAt: manualVerifiedAt.toISOString(),
        outputPath,
      })).not.toThrow();
      expect([...committedHashes].every(([path, sha256]) => (
        createHash('sha256').update(readFileSync(resolve(root, path))).digest('hex') === sha256
      ))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 60_000);

  test('accepts the complete ready wrapper path against one immutable source commit', () => {
    const root = mkdtempSync(join(tmpdir(), '0912-full-ready-wrapper-'));
    const externalEvidenceRoot = mkdtempSync(join(tmpdir(), '0912-full-ready-external-'));
    try {
      const requestedPaths = new Set();
      const trackingSourceReader = (path) => {
        requestedPaths.add(path);
        return readFileSync(resolve(projectRoot, path));
      };
      const currentTraceability = verify0912Readiness({
        root: projectRoot,
        sourceReader: trackingSourceReader,
        sourceCommit: SOURCE_COMMIT,
        sourceTreeClean: true,
        generatedAt: new Date('2026-09-05T12:00:00.000Z'),
      });
      expect(currentTraceability.status, currentTraceability.errors.join('\n')).toBe('pass');
      for (const path of derive0912PostgresTargetPaths(projectRoot)) requestedPaths.add(path);
      requestedPaths.add('docs/operations/0912-evidence-trust-policy.json');
      requestedPaths.add('automation/fixtures/0912-hq-rehearsal.json');

      for (const path of requestedPaths) {
        const sourcePath = resolve(projectRoot, path);
        if (!existsSync(sourcePath)) continue;
        const destinationPath = resolve(root, path);
        mkdirSync(dirname(destinationPath), { recursive: true });
        writeFileSync(destinationPath, readFileSync(sourcePath));
      }
      writeJson(root, 'docs/operations/0912-evidence-trust-policy.json', EVIDENCE_TRUST_POLICY);
      initializeTestRepository(root);
      runGit(root, ['add', '--all']);
      const commitResult = spawnSync('git', ['commit', '-m', 'test: seed immutable 0912 source'], {
        cwd: root,
        encoding: 'utf8',
        env: {
          ...process.env,
          GIT_AUTHOR_DATE: '2026-09-05T11:00:00.000Z',
          GIT_COMMITTER_DATE: '2026-09-05T11:00:00.000Z',
        },
      });
      expect(commitResult.status, `${commitResult.stdout}\n${commitResult.stderr}`).toBe(0);
      const expectedCommit = runGit(root, ['rev-parse', 'HEAD']);
      const committedReader = (path) => {
        const result = spawnSync('git', ['show', `${expectedCommit}:${path}`], {
          cwd: root,
          encoding: null,
          maxBuffer: 8 * 1024 * 1024,
        });
        if (result.status !== 0 || !Buffer.isBuffer(result.stdout)) {
          throw new Error(`committed source unreadable: ${path}`);
        }
        return result.stdout;
      };
      const postgresManifestPaths = derive0912PostgresTargetPaths(root, expectedCommit);
      const traceabilityReport = verify0912Readiness({
        root,
        sourceReader: committedReader,
        sourceCommit: expectedCommit,
        sourceTreeClean: true,
        generatedAt: new Date('2026-09-05T12:00:00.000Z'),
      });
      expect(traceabilityReport.status, traceabilityReport.errors.join('\n')).toBe('pass');

      const generated = writeReadyArtifacts(root, {}, {
        sourceCommit: expectedCommit,
        readSourceArtifact: committedReader,
        postgresManifestPaths,
        traceabilityReport,
      });
      const backupArchivePath = resolve(externalEvidenceRoot, 'snapshot-77.dump');
      const latestBackupPath = resolve(externalEvidenceRoot, 'latest.json');
      writeFileSync(backupArchivePath, readFileSync(generated.backupArchivePath));
      writeFileSync(latestBackupPath, readFileSync(generated.latestBackupPath));
      rmSync(generated.backupArchivePath);
      rmSync(generated.latestBackupPath);
      const readyReport = makeReadyReport(expectedCommit);
      writeJson(root, CANONICAL_REPORT_PATH, readyReport);

      vi.useFakeTimers();
      vi.setSystemTime(manualVerifiedAt);
      const result = verify0912ReleaseReport({
        root,
        reportPath: CANONICAL_REPORT_PATH,
        expectedCommit,
        expectedTargetRevision: expectedCommit,
        expectedReleaseRunId: RELEASE_RUN_ID,
        backupArchivePath,
        latestBackupPath,
        trustedEvidencePublicKeys: TRUSTED_EVIDENCE_PUBLIC_KEYS,
      });
      expect(result).toMatchObject({
        valid: true,
        releaseReady: true,
        sourceBindingVerified: true,
      });
    } finally {
      vi.useRealTimers();
      rmSync(root, { recursive: true, force: true });
      rmSync(externalEvidenceRoot, { recursive: true, force: true });
    }
  }, 240_000);

  test.each([
    ['unconfigured policy', {
      policy: {
        ...EVIDENCE_TRUST_POLICY,
        status: 'unconfigured',
      },
      keys: TRUSTED_EVIDENCE_PUBLIC_KEYS,
    }],
    ['mismatched operator key', {
      policy: EVIDENCE_TRUST_POLICY,
      keys: {
        ...TRUSTED_EVIDENCE_PUBLIC_KEYS,
        operator: BACKUP_PUBLIC_KEY,
      },
    }],
    ['reused public key', {
      policy: {
        ...EVIDENCE_TRUST_POLICY,
        keyIds: {
          ...EVIDENCE_TRUST_POLICY.keyIds,
          restore: BACKUP_KEY_ID,
        },
      },
      keys: {
        ...TRUSTED_EVIDENCE_PUBLIC_KEYS,
        restore: BACKUP_PUBLIC_KEY,
      },
    }],
    ['private key input', {
      policy: EVIDENCE_TRUST_POLICY,
      keys: {
        ...TRUSTED_EVIDENCE_PUBLIC_KEYS,
        operator: OPERATOR_PRIVATE_KEY,
      },
    }],
  ])('rejects ready binding with %s', (_label, trust) => {
    const root = mkdtempSync(join(tmpdir(), '0912-ready-artifacts-'));
    try {
      const { backupArchivePath, latestBackupPath } = writeReadyArtifacts(root);
      expect(verifyReadyArtifactPayloads(root, makeReadyReport(), SOURCE_COMMIT, {
        manualTargetState,
        manualVerifiedAt,
        readSourceArtifact,
        expectedPostgresManifestPaths,
        trustedEvidencePublicKeys: trust.keys,
        trustPolicy: trust.policy,
        backupArchivePath,
        latestBackupPath,
        traceabilityEvidenceVerifier: () => true,
      })).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test.each([
    ['missing archive', (_root, archivePath) => {
      rmSync(archivePath);
      return archivePath;
    }],
    ['modified archive bytes', (_root, archivePath) => {
      writeFileSync(archivePath, '{"platform":{"id":"777","source":"platform"}}', 'utf8');
      return archivePath;
    }],
    ['directory in place of archive', (root) => {
      const directoryPath = resolve(root, 'archive-directory');
      mkdirSync(directoryPath);
      return directoryPath;
    }],
  ])('rejects ready binding with %s', (_label, mutateArchive) => {
    const root = mkdtempSync(join(tmpdir(), '0912-ready-artifacts-'));
    try {
      const { backupArchivePath, latestBackupPath } = writeReadyArtifacts(root);
      const candidatePath = mutateArchive(root, backupArchivePath);
      expect(verifyReadyArtifactPayloads(root, makeReadyReport(), SOURCE_COMMIT, {
        manualTargetState,
        manualVerifiedAt,
        readSourceArtifact,
        expectedPostgresManifestPaths,
        trustedEvidencePublicKeys: TRUSTED_EVIDENCE_PUBLIC_KEYS,
        trustPolicy: EVIDENCE_TRUST_POLICY,
        backupArchivePath: candidatePath,
        latestBackupPath,
        traceabilityEvidenceVerifier: () => true,
      })).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test.each([
    ['an unknown automated exclusion', {
      status: 'needs_review',
      sourceCommit: SOURCE_COMMIT,
      sourceTreeClean: true,
      releaseEvidence: true,
      targetRevision: { status: 'verified', sourceCommit: SOURCE_COMMIT },
      summary: {
        routeCount: 23,
        passedRoutes: 23,
        auditCaseCount: 46,
        passedCases: 46,
        violationCount: 0,
        incompleteCount: 0,
        excludedSurfaceCount: 1,
      },
      coverage: { excluded: [{ id: 'unknown-surface' }] },
    }],
    ['an incomplete automated case', {
      status: 'needs_review',
      sourceCommit: SOURCE_COMMIT,
      sourceTreeClean: true,
      releaseEvidence: true,
      targetRevision: { status: 'verified', sourceCommit: SOURCE_COMMIT },
      summary: {
        routeCount: 23,
        passedRoutes: 23,
        auditCaseCount: 46,
        passedCases: 45,
        violationCount: 0,
        incompleteCount: 0,
        excludedSurfaceCount: 1,
      },
      coverage: { excluded: [{ id: 'assistive-technology-manual-evaluation' }] },
    }],
  ])('rejects ready binding with %s', (_label, accessibilityReport) => {
    const root = mkdtempSync(join(tmpdir(), '0912-ready-artifacts-'));
    try {
      const { backupArchivePath, latestBackupPath } = writeReadyArtifacts(
        root,
        { accessibilityReport },
      );
      expect(verifyReadyArtifactPayloads(
        root,
        makeReadyReport(),
        SOURCE_COMMIT,
        {
          manualTargetState,
          manualVerifiedAt,
          readSourceArtifact,
          expectedPostgresManifestPaths,
          trustedEvidencePublicKeys: TRUSTED_EVIDENCE_PUBLIC_KEYS,
          trustPolicy: EVIDENCE_TRUST_POLICY,
          backupArchivePath,
          latestBackupPath,
          traceabilityEvidenceVerifier: () => true,
        },
      )).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test.each([
    ['the wrong approved origin', (evidence) => { evidence.baseUrl = 'https://example.invalid'; }],
    ['a missing matrix case', (evidence) => { evidence.cases.pop(); }],
    ['an unexecuted check', (evidence) => {
      evidence.status = 'needs_review';
      evidence.cases[0].checks[0].status = 'not_run';
      evidence.cases[0].checks[0].notes = null;
    }],
  ])('rejects ready binding with %s in manual evidence', (_label, mutate) => {
    const root = mkdtempSync(join(tmpdir(), '0912-ready-artifacts-'));
    try {
      const manualAccessibilityEvidence = passingManualEvidence();
      mutate(manualAccessibilityEvidence);
      const { backupArchivePath, latestBackupPath } = writeReadyArtifacts(
        root,
        { manualAccessibilityEvidence },
      );
      expect(verifyReadyArtifactPayloads(
        root,
        makeReadyReport(),
        SOURCE_COMMIT,
        {
          manualTargetState,
          manualVerifiedAt,
          readSourceArtifact,
          expectedPostgresManifestPaths,
          trustedEvidencePublicKeys: TRUSTED_EVIDENCE_PUBLIC_KEYS,
          trustPolicy: EVIDENCE_TRUST_POLICY,
          backupArchivePath,
          latestBackupPath,
          traceabilityEvidenceVerifier: () => true,
        },
      )).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test.each([
    ['a missing traceability check', 'traceabilityReport', (payload) => { payload.checks.pop(); }],
    ['an unexecuted PostgreSQL behavior check', 'postgresVerificationReport', (payload) => {
      payload.behaviorVerification = 'not-run';
    }],
    ['a PostgreSQL target manifest checksum mismatch', 'postgresVerificationReport', (payload) => {
      payload.targetManifest[0].sha256 = '9'.repeat(64);
      payload.targetManifestSha256 = createHash('sha256')
        .update(JSON.stringify(payload.targetManifest))
        .digest('hex');
    }],
    ['a source-detached field fixture checksum', 'fieldRehearsalReport', (payload) => {
      payload.fixtureSha256 = '9'.repeat(64);
    }],
    ['a field rehearsal count mismatch', 'fieldRehearsalReport', (payload) => {
      payload.summary.passCount -= 1;
    }],
    ['an escaped field rehearsal request', 'fieldRehearsalReport', (payload) => {
      payload.networkContract.escapedExternalRequestCount = 1;
    }],
    ['a forwarded HQ request', 'hqFieldRehearsalReport', (payload) => {
      payload.safety.forwardedSupabaseHttpRequestCount = 1;
    }],
    ['a missing HQ recovery check', 'hqFieldRehearsalReport', (payload) => {
      payload.checks.pop();
    }],
    ['an automated accessibility route violation', 'accessibilityReport', (payload) => {
      payload.routes[0].passed = false;
      payload.routes[0].violations = [{ id: 'synthetic-violation' }];
    }],
    ['a disabled restore trigger', 'restoreLog', (payload) => {
      payload.verification.businessTriggersEnabledDuringRestore = false;
    }],
    ['an operator backup snapshot mismatch', 'operatorLog', (payload) => {
      payload.controls.backupRestore.details.snapshotId = 778;
    }],
  ])('rejects ready binding with %s', (_label, artifactKey, mutate) => {
    const root = mkdtempSync(join(tmpdir(), '0912-ready-artifacts-'));
    try {
      const { backupArchivePath, latestBackupPath } = writeReadyArtifacts(root);
      const artifactPath = resolve(root, readyArtifacts[artifactKey]);
      const payload = JSON.parse(readFileSync(artifactPath, 'utf8'));
      mutate(payload);
      writeFileSync(artifactPath, JSON.stringify(payload), 'utf8');

      expect(verifyReadyArtifactPayloads(
        root,
        makeReadyReport(),
        SOURCE_COMMIT,
        {
          manualTargetState,
          manualVerifiedAt,
          readSourceArtifact,
          expectedPostgresManifestPaths,
          trustedEvidencePublicKeys: TRUSTED_EVIDENCE_PUBLIC_KEYS,
          trustPolicy: EVIDENCE_TRUST_POLICY,
          backupArchivePath,
          latestBackupPath,
          traceabilityEvidenceVerifier: () => true,
        },
      )).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('rejects generic report evidence paths that bypass the signed operator packet', () => {
    const root = mkdtempSync(join(tmpdir(), '0912-ready-artifacts-'));
    try {
      const { backupArchivePath, latestBackupPath } = writeReadyArtifacts(root);
      const report = makeReadyReport();
      report.criticalGates[0].evidence = 'evaluation/0912-13-traceability-report.json';

      expect(verifyReadyArtifactPayloads(root, report, SOURCE_COMMIT, {
        manualTargetState,
        manualVerifiedAt,
        readSourceArtifact,
        expectedPostgresManifestPaths,
        trustedEvidencePublicKeys: TRUSTED_EVIDENCE_PUBLIC_KEYS,
        trustPolicy: EVIDENCE_TRUST_POLICY,
        backupArchivePath,
        latestBackupPath,
        traceabilityEvidenceVerifier: () => true,
      })).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
