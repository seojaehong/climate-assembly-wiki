import {
  createHash,
  generateKeyPairSync,
  sign as signPayload,
} from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  CANONICAL_0912_APPROVAL_SCOPES,
  CANONICAL_0912_CONTROL_NAMES,
  CANONICAL_0912_CONTROL_RECEIPT_IDS,
  CANONICAL_0912_GATE_IDS,
  CANONICAL_0912_OPERATOR_BINDING_PATHS,
  CANONICAL_0912_OPERATOR_RECEIPT_PATHS,
  CANONICAL_0912_ROLLOUT_IDS,
  OperatorEvidenceValidationError,
  canonical0912OperatorReceiptPath,
  contains0912SensitiveMaterial,
  create0912OperatorEvidenceTemplate,
  validate0912OperatorEvidence,
} from './0912-operator-evidence.mjs';

const SOURCE_COMMIT = 'a'.repeat(40);
const TARGET_REVISION = 'b'.repeat(40);
const RELEASE_RUN_ID = '11111111-1111-4111-8111-111111111111';
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
const { privateKey: ATTESTATION_PRIVATE_KEY, publicKey: ATTESTATION_PUBLIC_KEY } = generateKeyPairSync('ed25519');
const ATTESTATION_KEY_ID = `ed25519-sha256:${createHash('sha256')
  .update(ATTESTATION_PUBLIC_KEY.export({ type: 'spki', format: 'der' }))
  .digest('hex')}`;
const OPERATOR_TEMPLATE = JSON.parse(readFileSync(
  new URL('../evaluation/0912-13-operator-log.template.json', import.meta.url),
  'utf8',
));

const APPROVAL_GROUPS = CANONICAL_0912_APPROVAL_SCOPES.map((entry) => [
  entry.scope,
  entry.rolloutStepIds,
  entry.gateIds,
]);

const GATE_EXECUTION_TIMES = Object.freeze([
  [0, 0], [0, 1], [0, 2], [0, 3], [0, 4], [0, 5], [0, 6], [0, 7], [0, 8],
  [0, 26], [0, 36], [0, 46], [0, 56], [1, 5], [1, 6], [1, 10], [1, 25],
  [1, 30], [2, 15], [2, 16], [2, 17], [2, 20], [2, 45],
  [2, 46], [2, 50], [3, 10], [3, 35], [3, 36], [3, 37], [3, 38], [3, 39],
  [3, 40], [3, 42], [3, 43], [3, 46],
]);
const ROLLOUT_EXECUTION_TIMES = Object.freeze([
  [0, 20], [0, 30], [0, 40], [0, 50], [1, 0], [1, 20], [1, 40], [1, 50],
  [2, 10], [2, 30], [2, 40], [3, 0], [3, 20], [3, 30],
]);

const GATE_MEASUREMENTS = {
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
};

const ROLLOUT_MEASUREMENTS = {
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
};

function timestamp(hour, minute) {
  return new Date(Date.UTC(2026, 8, 11, hour, minute, 0, 0)).toISOString();
}

const APPROVAL_EXECUTION_TIMES = Object.freeze([
  [0, 21], [0, 31], [0, 41], [0, 51], [1, 7], [1, 27],
  [1, 55], [2, 18], [2, 47], [3, 5], [3, 41], [3, 45],
]);

function approvalTimestamp(index) {
  const [hour, minute] = APPROVAL_EXECUTION_TIMES[index];
  return timestamp(hour, minute);
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

function attest(
  operator,
  privateKey = ATTESTATION_PRIVATE_KEY,
  signedAt = timestamp(5, 1),
) {
  const unsigned = Object.fromEntries(Object.entries(operator).filter(([key]) => key !== 'attestation'));
  const payloadSha256 = createHash('sha256').update(canonicalJson(unsigned), 'utf8').digest('hex');
  const signingMessage = Buffer.from(
    `0912-operator-evidence-v1\n${ATTESTATION_KEY_ID}\n${payloadSha256}\n${signedAt}`,
    'utf8',
  );
  return {
    algorithm: 'Ed25519',
    keyId: ATTESTATION_KEY_ID,
    payloadSha256,
    signatureBase64: signPayload(null, signingMessage, privateKey).toString('base64'),
    signedAt,
  };
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

function readOnlyAccess(connectionCount = 1) {
  return {
    mode: 'read-only-observation',
    connectionCount,
    mutationCount: 0,
    approvalId: null,
    environmentId: PRODUCTION_ENVIRONMENT.id,
  };
}

function approvedDatabaseAccess(approvalId, mutationCount = 1) {
  return {
    mode: 'approved-db-rollout',
    connectionCount: 1,
    mutationCount,
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
  if (id === 'production-routine-acl-inventory') {
    return readOnlyAccess();
  }
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
  if (id === 'maintenance-deploy-token-staff-client') {
    return approvedNonDatabaseAccess(approvalId);
  }
  return approvedDatabaseAccess(approvalId);
}

function execution(kind, id, index, access) {
  const [hour, minute] = kind === 'gate'
    ? GATE_EXECUTION_TIMES[index]
    : ROLLOUT_EXECUTION_TIMES[index];
  return {
    id,
    status: 'pass',
    executedAt: timestamp(hour, minute),
    evidence: {
      type: `0912-${kind}-${id}-v1`,
      reference: canonical0912OperatorReceiptPath(kind, index, id),
      measurement: measurement(kind, id),
      productionAccess: access,
    },
  };
}

function commonControl(name, index, productionAccess, details) {
  return {
    status: 'pass',
    checkedAt: timestamp(4, index),
    evidenceRef: canonical0912OperatorReceiptPath('control', index, name),
    sourceCommit: SOURCE_COMMIT,
    targetRevision: TARGET_REVISION,
    productionAccess,
    details,
  };
}

function makeControls() {
  return {
    aclInventory: commonControl('acl-inventory', 0, noProductionAccess(), {
      identityArgumentAllowlistMatched: true,
      publicExecutableRoutineCount: 0,
      unapprovedAnonAuthenticatedRoutineCount: 0,
      legacyExecutableRoutineCount: 0,
    }),
    directEdgeProbe: commonControl(
      'direct-edge-probe',
      1,
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
      noProductionAccess(PRODUCTION_ENVIRONMENT.id),
      {
      endpointCount: 2,
      expectedRevision: TARGET_REVISION,
      observedRevision: TARGET_REVISION,
      },
    ),
    backupRestore: commonControl('backup-restore', 3, noProductionAccess(), {
      snapshotId: 77,
      archiveSha256: 'c'.repeat(64),
      checksumMatch: true,
      rowCountMatch: true,
      postgresMajorVersion: 16,
      isolatedNetwork: true,
      containerDisposed: true,
    }),
    onsiteRehearsal: commonControl(
      'onsite-rehearsal',
      4,
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
      noProductionAccess(),
      {
        revokedTokenReuseAcceptedCount: 0,
        hqLogoutRevocationVerified: true,
        passwordChangeAllDevicesRevoked: true,
        teamDeviceRevocationVerified: true,
      },
    ),
    rollbackReadiness: commonControl('rollback-readiness', 6, noProductionAccess(), {
      rollbackArtifactSha256: 'd'.repeat(64),
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
    if (access.mode === 'read-only-observation' || access.mode === 'verified-already-applied') {
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

function operatorFixture() {
  const operator = {
    schemaVersion: 2,
    evidenceType: '0912-operator-readiness',
    session: '0912-deliberation',
    releaseRunId: RELEASE_RUN_ID,
    generatedAt: timestamp(5, 0),
    sourceCommit: SOURCE_COMMIT,
    targetRevision: TARGET_REVISION,
    productionEnvironment: { ...PRODUCTION_ENVIRONMENT },
    artifactBindings: CANONICAL_0912_OPERATOR_BINDING_PATHS.map((path) => ({
      path,
      sha256: createHash('sha256').update(path, 'utf8').digest('hex'),
    })),
    status: 'pass',
    attestation: null,
    approvals: APPROVAL_GROUPS.map(([scope, rolloutStepIds, gateIds], index) => ({
      id: `approval-${scope}`,
      scope,
      status: 'approved',
      approvedAt: approvalTimestamp(index),
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
    })),
    safety: null,
    gates: CANONICAL_0912_GATE_IDS.map((id, index) => (
      execution('gate', id, index, gateAccess(id))
    )),
    rolloutSteps: CANONICAL_0912_ROLLOUT_IDS.map((id, index) => (
      execution('rollout', id, index, rolloutAccess(id))
    )),
    controls: makeControls(),
  };
  operator.safety = calculateSafety(operator);
  operator.attestation = attest(operator);
  return operator;
}

function validate(operator, overrides = {}) {
  return validate0912OperatorEvidence({
    operator,
    expectedSourceCommit: SOURCE_COMMIT,
    expectedTargetRevision: TARGET_REVISION,
    expectedReleaseRunId: RELEASE_RUN_ID,
    expectedProductionEnvironment: PRODUCTION_ENVIRONMENT,
    expectedGateIds: CANONICAL_0912_GATE_IDS,
    expectedRolloutIds: CANONICAL_0912_ROLLOUT_IDS,
    trustedPublicKey: ATTESTATION_PUBLIC_KEY,
    verifiedAt: timestamp(5, 2),
    ...overrides,
  });
}

function expectCodes(action, expectedCodes) {
  try {
    action();
    throw new Error('expected validation to fail');
  } catch (error) {
    expect(error).toBeInstanceOf(OperatorEvidenceValidationError);
    expect(error.codes).toEqual(expect.arrayContaining(expectedCodes));
  }
}

describe('9/12 operator readiness evidence', () => {
  it('accepts a source- and deployment-bound full operator packet', () => {
    const operator = operatorFixture();
    const result = validate(operator);

    expect(result).toEqual({
      valid: true,
      session: '0912-deliberation',
      sourceCommit: SOURCE_COMMIT,
      targetRevision: TARGET_REVISION,
      releaseRunId: RELEASE_RUN_ID,
      productionEnvironmentId: PRODUCTION_ENVIRONMENT.id,
      artifactBindingCount: 68,
      approvalCount: 12,
      gateCount: 35,
      rolloutStepCount: 14,
      attestationKeyId: ATTESTATION_KEY_ID,
      payloadSha256: operator.attestation.payloadSha256,
      approvedRolloutDatabaseConnectionCount: 14,
      approvedRolloutMutationCount: 14,
      observationDatabaseConnectionCount: 1,
      observationMutationCount: 0,
      sensitiveMaterialDetected: false,
      unapprovedProductionMutationCount: 0,
      syntheticRehearsalProductionMutationCount: 0,
      capabilityValuesLeakedToDraftQueueOrEvidence: false,
    });
    expect(JSON.stringify(result)).not.toContain('approver');
  });

  it('exports the complete deterministic receipt and artifact binding contract', () => {
    const operator = operatorFixture();
    const references = [
      ...operator.gates.map((entry) => entry.evidence.reference),
      ...operator.rolloutSteps.map((entry) => entry.evidence.reference),
      ...Object.values(operator.controls).map((control) => control.evidenceRef),
    ];

    expect(CANONICAL_0912_OPERATOR_RECEIPT_PATHS).toHaveLength(56);
    expect(CANONICAL_0912_CONTROL_NAMES).toEqual([
      'aclInventory',
      'directEdgeProbe',
      'deploymentRevision',
      'backupRestore',
      'onsiteRehearsal',
      'tokenRevocation',
      'rollbackReadiness',
    ]);
    expect(CANONICAL_0912_OPERATOR_BINDING_PATHS).toHaveLength(68);
    expect(CANONICAL_0912_OPERATOR_BINDING_PATHS).toEqual(
      [...CANONICAL_0912_OPERATOR_BINDING_PATHS].sort(),
    );
    expect([...references].sort()).toEqual([...CANONICAL_0912_OPERATOR_RECEIPT_PATHS].sort());
    expect(operator.artifactBindings.map(({ path }) => path))
      .toEqual(CANONICAL_0912_OPERATOR_BINDING_PATHS);
    expect(CANONICAL_0912_OPERATOR_BINDING_PATHS)
      .not.toContain('evaluation/0912-13-operator-log.json');
    expect(canonical0912OperatorReceiptPath('control', 0, CANONICAL_0912_CONTROL_RECEIPT_IDS[0]))
      .toBe('evaluation/0912-operator/controls/0-acl-inventory.json');
    expect(() => canonical0912OperatorReceiptPath('gate', 0, 'wrong-id')).toThrow(TypeError);
  });

  it('keeps the canonical operator template unsigned and explicitly not run', () => {
    expect(OPERATOR_TEMPLATE).toEqual(create0912OperatorEvidenceTemplate());
    expect(OPERATOR_TEMPLATE.status).toBe('not_run');
    expect(OPERATOR_TEMPLATE.attestation).toBeNull();
    expect(OPERATOR_TEMPLATE.releaseRunId).toBeNull();
    expect(OPERATOR_TEMPLATE.productionEnvironment).toEqual({
      id: null,
      webOrigin: null,
      supabaseProjectRef: null,
      databaseTlsSpkiSha256: null,
      organizationId: null,
      assemblyId: null,
      sessionId: null,
      sessionSlug: '0912-deliberation',
    });
    expect(OPERATOR_TEMPLATE.artifactBindings.map(({ path }) => path))
      .toEqual(CANONICAL_0912_OPERATOR_BINDING_PATHS);
    expect(OPERATOR_TEMPLATE.artifactBindings.every(({ sha256 }) => sha256 === null)).toBe(true);
    expect(OPERATOR_TEMPLATE.approvals.map(({ scope, rolloutStepIds, gateIds }) => ({
      scope,
      rolloutStepIds,
      gateIds,
    }))).toEqual(CANONICAL_0912_APPROVAL_SCOPES);
    expect(JSON.stringify(OPERATOR_TEMPLATE)).not.toMatch(/Bearer\s|BEGIN .*PRIVATE KEY/);
  });

  it('materializes deployment-bound expectations and environment IDs in prepared templates', () => {
    const prepared = create0912OperatorEvidenceTemplate({
      releaseRunId: RELEASE_RUN_ID,
      sourceCommit: SOURCE_COMMIT,
      targetRevision: TARGET_REVISION,
      productionEnvironment: PRODUCTION_ENVIRONMENT,
    });
    const accesses = [
      ...prepared.gates.map(({ evidence }) => evidence.productionAccess),
      ...prepared.rolloutSteps.map(({ evidence }) => evidence.productionAccess),
      ...Object.values(prepared.controls).map(({ productionAccess }) => productionAccess),
    ];
    expect(accesses
      .filter(({ mode }) => mode !== 'no-production-db')
      .every(({ environmentId }) => environmentId === PRODUCTION_ENVIRONMENT.id)).toBe(true);
    expect(prepared.gates.find(({ id }) => id === 'deployed-revision-match')?.evidence.measurement)
      .toMatchObject({ expected: TARGET_REVISION, observed: null, unit: 'git-commit' });
    expect(prepared.rolloutSteps
      .find(({ id }) => id === 'maintenance-deploy-token-staff-client')?.evidence.measurement)
      .toMatchObject({ expected: TARGET_REVISION, observed: null, unit: 'git-commit' });
    expect(prepared.rolloutSteps.find(({ id }) => id === 'p3-design-provisioning')?.evidence.measurement)
      .toMatchObject({ expected: true, observed: null, unit: 'boolean' });
    expect(prepared.rolloutSteps.find(({ id }) => id === 'p4-audit-log')?.evidence.measurement)
      .toMatchObject({ expected: true, observed: null, unit: 'boolean' });
  });

  it('rejects arbitrary receipt paths and missing or malformed artifact bindings', () => {
    const arbitraryReference = operatorFixture();
    arbitraryReference.gates[0].evidence.reference = 'evaluation/operator/custom.json';
    expectCodes(() => validate(arbitraryReference), ['gate_0_evidence_reference_invalid']);

    const missingBinding = operatorFixture();
    missingBinding.artifactBindings.pop();
    expectCodes(() => validate(missingBinding), ['artifact_bindings_schema_invalid']);

    const badBindingPath = operatorFixture();
    badBindingPath.artifactBindings[0].path = 'evaluation/untrusted.json';
    expectCodes(() => validate(badBindingPath), ['artifact_binding_0_path_invalid']);

    const badBindingHash = operatorFixture();
    badBindingHash.artifactBindings[0].sha256 = '0'.repeat(63);
    expectCodes(() => validate(badBindingHash), ['artifact_binding_0_sha256_invalid']);
  });

  it('binds the packet and every production touchpoint to one exact environment', () => {
    const packetMismatch = operatorFixture();
    packetMismatch.productionEnvironment.webOrigin = 'https://preview.example.test';
    expectCodes(() => validate(packetMismatch), ['production_environment_mismatch']);

    const rolloutMismatch = operatorFixture();
    rolloutMismatch.rolloutSteps[1].evidence.productionAccess.environmentId = null;
    expectCodes(
      () => validate(rolloutMismatch),
      ['rollout_1_production_environment_invalid'],
    );

    const edgeMismatch = operatorFixture();
    edgeMismatch.controls.directEdgeProbe.productionAccess.environmentId = null;
    expectCodes(
      () => validate(edgeMismatch),
      ['control_directEdgeProbe_production_environment_invalid'],
    );

    const nonDatabaseRolloutMismatch = operatorFixture();
    nonDatabaseRolloutMismatch.rolloutSteps[8].evidence.productionAccess.environmentId = null;
    expectCodes(
      () => validate(nonDatabaseRolloutMismatch),
      ['rollout_8_production_environment_invalid'],
    );

    const isolatedEnvironmentLeak = operatorFixture();
    isolatedEnvironmentLeak.gates[0].evidence.productionAccess.environmentId = PRODUCTION_ENVIRONMENT.id;
    expectCodes(
      () => validate(isolatedEnvironmentLeak),
      ['gate_0_production_environment_invalid'],
    );
  });

  it('binds the packet to the externally selected release run', () => {
    const otherReleaseRunId = '55555555-5555-4555-8555-555555555555';
    expectCodes(
      () => validate(operatorFixture(), { expectedReleaseRunId: otherReleaseRunId }),
      ['operator_release_run_id_mismatch'],
    );
    expectCodes(
      () => validate(operatorFixture(), { expectedReleaseRunId: undefined }),
      ['expected_release_run_id_invalid', 'operator_release_run_id_mismatch'],
    );
  });

  it('requires the approved backup mutation rather than a zero-mutation observation', () => {
    const operator = operatorFixture();
    const backup = operator.gates.find(({ id }) => id === 'backup');
    backup.evidence.productionAccess.mutationCount = 0;
    operator.safety = calculateSafety(operator);
    expectCodes(() => validate(operator), ['gate_32_approved_mutation_invalid']);

    expect(operator.approvals.find(({ id }) => id === 'approval-backup-snapshot')).toMatchObject({
      id: 'approval-backup-snapshot',
      scope: 'backup-snapshot',
      rolloutStepIds: [],
      gateIds: ['backup'],
    });

    const zeroMutationRollout = operatorFixture();
    zeroMutationRollout.rolloutSteps[1].evidence.productionAccess.mutationCount = 0;
    zeroMutationRollout.safety = calculateSafety(zeroMutationRollout);
    expectCodes(
      () => validate(zeroMutationRollout),
      ['rollout_1_approved_db_access_invalid'],
    );
  });

  it('records an already-applied migration as checksum-bound observation without fake mutations', () => {
    const operator = operatorFixture();
    const rollout = operator.rolloutSteps[1];
    rollout.evidence.productionAccess = {
      mode: 'verified-already-applied',
      connectionCount: 1,
      mutationCount: 0,
      approvalId: 'approval-p1-tenancy',
      environmentId: PRODUCTION_ENVIRONMENT.id,
    };
    rollout.evidence.measurement = {
      name: 'rollout_p1_tenancy_history_checksum_verified',
      expected: true,
      observed: true,
      unit: 'boolean',
    };
    operator.safety = calculateSafety(operator);
    operator.attestation = attest(operator);

    expect(validate(operator)).toMatchObject({ valid: true });
    expect(operator.safety.observationDatabaseConnectionCount).toBeGreaterThan(0);

    const fakeAlreadyApplied = structuredClone(operator);
    fakeAlreadyApplied.rolloutSteps[1].evidence.productionAccess.mutationCount = 1;
    expectCodes(
      () => validate(fakeAlreadyApplied),
      ['rollout_1_already_applied_verification_invalid'],
    );

    const unsupportedStep = operatorFixture();
    unsupportedStep.rolloutSteps[2].evidence.productionAccess = {
      ...operator.rolloutSteps[1].evidence.productionAccess,
      approvalId: 'approval-secure-seed-sync',
    };
    expectCodes(
      () => validate(unsupportedStep),
      ['rollout_2_production_access_mode_for_step_invalid'],
    );
  });

  it('rejects dependency DAG inversions across approvals, rollout, and verification', () => {
    const verificationBeforeRollout = operatorFixture();
    verificationBeforeRollout.gates[13].executedAt = timestamp(0, 59);
    expectCodes(
      () => validate(verificationBeforeRollout),
      ['dag_p1a-production-verification_not_after_p1a-additive-and-verify'],
    );

    const approvalGateAfterRollout = operatorFixture();
    approvalGateAfterRollout.gates[9].executedAt = timestamp(0, 31);
    expectCodes(
      () => validate(approvalGateAfterRollout),
      ['dag_p1-tenancy-production-approval_not_before_p1-tenancy'],
    );

    const gateBeforeApproval = operatorFixture();
    gateBeforeApproval.approvals[0].approvedAt = timestamp(0, 27);
    expectCodes(
      () => validate(gateBeforeApproval),
      ['dag_p1-tenancy-production-approval_not_after_approval'],
    );

    const deploymentBeforeRollout = operatorFixture();
    deploymentBeforeRollout.gates[18].executedAt = timestamp(2, 9);
    expectCodes(
      () => validate(deploymentBeforeRollout),
      ['dag_maintenance-token-staff-client-deployed_not_after_maintenance-deploy-token-staff-client'],
    );

    const backupBeforeFinalRollout = operatorFixture();
    backupBeforeFinalRollout.rolloutSteps[13].executedAt = timestamp(3, 43);
    expectCodes(
      () => validate(backupBeforeFinalRollout),
      ['dag_backup_not_after_post-p4-legacy-negative-and-final-status'],
    );

    const restoreBeforeBackup = operatorFixture();
    restoreBeforeBackup.gates[33].executedAt = timestamp(3, 40);
    expectCodes(
      () => validate(restoreBeforeBackup),
      ['dag_restore-isolated_not_after_backup'],
    );

    const tokenGateBeforeCutoverVerification = operatorFixture();
    tokenGateBeforeCutoverVerification.gates[23].executedAt = timestamp(2, 39);
    expectCodes(
      () => validate(tokenGateBeforeCutoverVerification),
      ['dag_p2a-token-revocation-verification_not_after_p2a-positive-legacy-negative-verify'],
    );

    const p2aApprovalBeforeAclInventory = operatorFixture();
    p2aApprovalBeforeAclInventory.approvals[7].approvedAt = timestamp(2, 16);
    expectCodes(
      () => validate(p2aApprovalBeforeAclInventory),
      ['dag_approval-p2a-cutover_not_after_production-routine-acl-inventory'],
    );

    const p4ApprovalBeforeP3Verification = operatorFixture();
    p4ApprovalBeforeP3Verification.approvals[9].approvedAt = timestamp(2, 59);
    expectCodes(
      () => validate(p4ApprovalBeforeP3Verification),
      ['dag_approval-p4-audit_not_after_p3-design-provisioning'],
    );

    const backupApprovalBeforeManualRehearsal = operatorFixture();
    backupApprovalBeforeManualRehearsal.approvals[10].approvedAt = timestamp(3, 39);
    expectCodes(
      () => validate(backupApprovalBeforeManualRehearsal),
      ['dag_approval-backup-snapshot_not_after_mod-hq-manual-a11y'],
    );

    const finalCleanupApprovalBeforeRestore = operatorFixture();
    finalCleanupApprovalBeforeRestore.approvals[11].approvedAt = timestamp(3, 42);
    expectCodes(
      () => validate(finalCleanupApprovalBeforeRestore),
      ['dag_approval-final-token-cleanup_not_after_restore-isolated'],
    );
  });

  it('rejects stale replay and timestamps beyond the verification skew window', () => {
    expectCodes(
      () => validate(operatorFixture(), { verifiedAt: '2026-09-12T05:00:00.001Z' }),
      ['operator_evidence_stale'],
    );
    expectCodes(
      () => validate(operatorFixture(), { verifiedAt: '2026-09-11T04:55:59.999Z' }),
      ['attestation_signed_at_future_skew_exceeded'],
    );

    const signedBeforeGenerated = operatorFixture();
    signedBeforeGenerated.attestation = attest(
      signedBeforeGenerated,
      ATTESTATION_PRIVATE_KEY,
      timestamp(4, 59),
    );
    expectCodes(
      () => validate(signedBeforeGenerated),
      ['attestation_signed_before_report'],
    );

    const staleApproval = operatorFixture();
    staleApproval.approvals[0].approvedAt = '2026-09-09T04:00:00.000Z';
    staleApproval.attestation = attest(staleApproval);
    expectCodes(
      () => validate(staleApproval),
      ['operator_operational_event_stale'],
    );

  });

  it('accepts only a public Ed25519 SPKI trust key and rejects private material', () => {
    const publicPem = ATTESTATION_PUBLIC_KEY.export({ type: 'spki', format: 'pem' });
    expect(() => validate(operatorFixture(), { trustedPublicKey: publicPem })).not.toThrow();

    const privatePem = ATTESTATION_PRIVATE_KEY.export({ type: 'pkcs8', format: 'pem' });
    expectCodes(
      () => validate(operatorFixture(), { trustedPublicKey: privatePem }),
      ['attestation_trusted_key_not_public_spki'],
    );
    expectCodes(
      () => validate(operatorFixture(), { trustedPublicKey: ATTESTATION_PRIVATE_KEY }),
      ['attestation_trusted_key_not_public_spki'],
    );
    expectCodes(
      () => validate(operatorFixture(), {
        trustedPublicKey: ATTESTATION_PUBLIC_KEY.export({ type: 'spki', format: 'der' }),
      }),
      ['attestation_trusted_key_not_public_spki'],
    );
    expectCodes(
      () => validate(operatorFixture(), { trustedPublicKey: `${publicPem}${publicPem}` }),
      ['attestation_trusted_key_not_public_spki'],
    );
  });

  it.each([
    ['extra top-level field', (value) => { value.unexpected = true; }, ['operator_schema_invalid']],
    ['missing top-level field', (value) => { delete value.controls; }, ['operator_schema_invalid', 'controls_schema_invalid']],
    ['wrong session', (value) => { value.session = '0829-deliberation'; }, ['operator_session_invalid']],
    ['invalid release run id', (value) => { value.releaseRunId = 'release-1'; }, ['operator_release_run_id_invalid']],
    ['non-canonical environment origin', (value) => {
      value.productionEnvironment.webOrigin = 'https://climate-assembly.org/';
    }, ['production_environment_invalid', 'production_environment_mismatch']],
    ['non-canonical report timestamp', (value) => {
      value.generatedAt = '2026-09-11T05:00:00Z';
    }, ['operator_generated_at_invalid']],
    ['failed gate', (value) => { value.gates[3].status = 'fail'; }, ['gate_3_status_invalid']],
    ['missing gate', (value) => { value.gates.pop(); }, ['gate_executions_schema_invalid']],
    ['reordered rollout', (value) => {
      [value.rolloutSteps[1], value.rolloutSteps[2]] = [value.rolloutSteps[2], value.rolloutSteps[1]];
    }, ['rollout_1_id_order_invalid', 'rollout_2_id_order_invalid']],
    ['non-increasing gate time', (value) => {
      value.gates[2].executedAt = value.gates[1].executedAt;
    }, ['gate_execution_order_invalid']],
  ])('rejects %s', (_label, mutate, expectedCodes) => {
    const operator = operatorFixture();
    mutate(operator);
    expectCodes(() => validate(operator), expectedCodes);
  });

  it('refuses a caller-supplied weakened gate or rollout contract', () => {
    expectCodes(
      () => validate(operatorFixture(), { expectedGateIds: CANONICAL_0912_GATE_IDS.slice(1) }),
      ['expected_gate_ids_invalid'],
    );
    expectCodes(
      () => validate(operatorFixture(), { expectedRolloutIds: CANONICAL_0912_ROLLOUT_IDS.slice(0, -1) }),
      ['expected_rollout_ids_invalid'],
    );
  });

  it('requires an external canonical verification timestamp', () => {
    expectCodes(() => validate(operatorFixture(), { verifiedAt: undefined }), ['verified_at_invalid']);
    expectCodes(
      () => validate(operatorFixture(), { verifiedAt: '2026-09-11T05:02:00Z' }),
      ['verified_at_invalid'],
    );
  });

  it('requires separate, ordered, revision-bound approvals with a named approver', () => {
    const missing = operatorFixture();
    missing.approvals.pop();
    expectCodes(() => validate(missing), ['approvals_schema_invalid']);

    const shared = operatorFixture();
    shared.approvals[1].id = shared.approvals[0].id;
    expectCodes(() => validate(shared), ['approval_id_duplicate']);

    const arbitraryId = operatorFixture();
    arbitraryId.approvals[0].id = 'approval-external-alias';
    expectCodes(() => validate(arbitraryId), ['approval_0_id_invalid']);

    const anonymous = operatorFixture();
    anonymous.approvals[0].approver.label = '';
    expectCodes(() => validate(anonymous), ['approval_0_approver_label_invalid']);

    const unbound = operatorFixture();
    unbound.approvals[0].targetRevision = 'e'.repeat(40);
    expectCodes(() => validate(unbound), ['approval_0_target_revision_invalid']);

    const wrongGateScope = operatorFixture();
    wrongGateScope.approvals[0].gateIds = ['backup'];
    expectCodes(() => validate(wrongGateScope), ['approval_0_gate_scope_invalid']);

    const simultaneousRollout = operatorFixture();
    simultaneousRollout.approvals[0].approvedAt = simultaneousRollout.rolloutSteps[1].executedAt;
    expectCodes(() => validate(simultaneousRollout), ['rollout_1_executed_before_approval']);
  });

  it('rejects reused generic evidence type, reference, or measurement', () => {
    const typeReuse = operatorFixture();
    typeReuse.gates[1].evidence.type = typeReuse.gates[0].evidence.type;
    expectCodes(() => validate(typeReuse), ['gate_1_evidence_type_invalid', 'evidence_type_duplicate']);

    const referenceReuse = operatorFixture();
    referenceReuse.rolloutSteps[1].evidence.reference = referenceReuse.gates[0].evidence.reference;
    expectCodes(() => validate(referenceReuse), ['evidence_reference_duplicate']);

    const measurementReuse = operatorFixture();
    measurementReuse.gates[1].evidence.measurement = {
      ...measurementReuse.gates[0].evidence.measurement,
    };
    expectCodes(() => validate(measurementReuse), ['gate_1_measurement_invalid', 'measurement_name_duplicate']);
  });

  it('verifies an Ed25519 detached signature over the canonical payload digest', () => {
    const tampered = operatorFixture();
    tampered.gates[0].status = 'fail';
    expectCodes(() => validate(tampered), [
      'gate_0_status_invalid',
      'attestation_payload_sha256_mismatch',
    ]);

    const { publicKey: wrongPublicKey } = generateKeyPairSync('ed25519');
    expectCodes(
      () => validate(operatorFixture(), { trustedPublicKey: wrongPublicKey }),
      ['attestation_key_id_invalid', 'attestation_signature_verification_failed'],
    );

    const unsigned = operatorFixture();
    delete unsigned.attestation;
    expectCodes(() => validate(unsigned), ['operator_schema_invalid', 'attestation_schema_invalid']);
  });

  it('binds the packet and every detailed control to source and deployed revisions', () => {
    const sourceDrift = operatorFixture();
    sourceDrift.sourceCommit = 'e'.repeat(40);
    expectCodes(() => validate(sourceDrift), ['operator_source_commit_invalid']);

    const targetDrift = operatorFixture();
    targetDrift.controls.deploymentRevision.details.observedRevision = 'e'.repeat(40);
    expectCodes(() => validate(targetDrift), ['control_deployment_revision_result_invalid']);

    const splicedControl = operatorFixture();
    splicedControl.controls.aclInventory.sourceCommit = 'e'.repeat(40);
    expectCodes(() => validate(splicedControl), ['control_aclInventory_source_commit_invalid']);
  });

  it.each([
    ['ACL inventory drift', (value) => {
      value.controls.aclInventory.details.unapprovedAnonAuthenticatedRoutineCount = 1;
    }, ['control_acl_inventory_result_invalid']],
    ['edge source override', (value) => {
      value.controls.directEdgeProbe.details.forwardedForOverrideCount = 1;
    }, ['control_direct_edge_probe_result_invalid']],
    ['backup checksum mismatch', (value) => {
      value.controls.backupRestore.details.checksumMatch = false;
    }, ['control_backup_restore_result_invalid']],
    ['non-isolated restore', (value) => {
      value.controls.backupRestore.details.isolatedNetwork = false;
    }, ['control_backup_restore_result_invalid']],
    ['onsite failure', (value) => {
      value.controls.onsiteRehearsal.details.failedScenarioCount = 1;
    }, ['control_onsite_rehearsal_result_invalid']],
    ['revoked capability accepted', (value) => {
      value.controls.tokenRevocation.details.revokedTokenReuseAcceptedCount = 1;
    }, ['control_token_revocation_result_invalid']],
    ['rollback guard missing', (value) => {
      value.controls.rollbackReadiness.details.activityGuardRefusalVerified = false;
    }, ['control_rollback_readiness_result_invalid']],
  ])('rejects %s', (_label, mutate, expectedCodes) => {
    const operator = operatorFixture();
    mutate(operator);
    expectCodes(() => validate(operator), expectedCodes);
  });

  it('requires production access to be classified and approval-bound', () => {
    const observationMutation = operatorFixture();
    observationMutation.controls.aclInventory.productionAccess.mutationCount = 1;
    observationMutation.safety = calculateSafety(observationMutation);
    expectCodes(
      () => validate(observationMutation),
      ['control_aclInventory_no_production_db_access_invalid'],
    );

    const unapprovedRollout = operatorFixture();
    unapprovedRollout.rolloutSteps[1].evidence.productionAccess = noProductionAccess();
    unapprovedRollout.safety = calculateSafety(unapprovedRollout);
    expectCodes(
      () => validate(unapprovedRollout),
      ['rollout_1_production_access_mode_for_step_invalid', 'rollout_1_approval_scope_invalid'],
    );

    const wrongApproval = operatorFixture();
    wrongApproval.rolloutSteps[1].evidence.productionAccess.approvalId = 'approval-p1a-additive';
    expectCodes(() => validate(wrongApproval), ['rollout_1_approval_scope_invalid']);
  });

  it('requires aggregate approved-rollout and observation counts to match every evidence record', () => {
    const operator = operatorFixture();
    operator.safety.approvedRolloutMutationCount -= 1;
    operator.safety.observationDatabaseConnectionCount += 1;
    expectCodes(() => validate(operator), [
      'safety_approvedRolloutMutationCount_mismatch',
      'safety_observationDatabaseConnectionCount_mismatch',
    ]);
  });

  it.each([
    ['unapproved production mutation', 'unapprovedProductionMutationCount'],
    ['synthetic rehearsal production mutation', 'syntheticRehearsalProductionMutationCount'],
  ])('rejects a signed %s assertion', (_label, field) => {
    const operator = operatorFixture();
    operator.safety[field] = 1;
    operator.attestation = attest(operator);
    expectCodes(() => validate(operator), [
      field === 'unapprovedProductionMutationCount'
        ? 'safety_unapproved_production_mutation_detected'
        : 'safety_synthetic_rehearsal_production_mutation_detected',
    ]);
  });

  it('rejects an unknown signed capability-leak assertion', () => {
    const operator = operatorFixture();
    operator.safety.capabilityValuesLeakedToDraftQueueOrEvidence = null;
    operator.attestation = attest(operator);
    expectCodes(() => validate(operator), ['safety_capability_material_detected']);
  });

  it('rejects secret-like keys and values without echoing the rejected material', () => {
    const operator = operatorFixture();
    operator.controls.directEdgeProbe.details.operatorToken = 'Bearer highly-sensitive-value';
    try {
      validate(operator);
      throw new Error('expected validation to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(OperatorEvidenceValidationError);
      expect(error.codes).toContain('sensitive_material_detected');
      expect(error.message).not.toContain('highly-sensitive-value');
      expect(JSON.stringify(error.codes)).not.toContain('highly-sensitive-value');
    }

    const joinCode = operatorFixture();
    joinCode.gates[0].evidence.measurement.observed = '123456';
    expectCodes(() => validate(joinCode), ['sensitive_material_detected']);

    const numericJoinCode = operatorFixture();
    numericJoinCode.controls.directEdgeProbe.details.requestCount = 123456;
    expectCodes(() => validate(numericJoinCode), ['sensitive_material_detected']);

    const rawCapability = operatorFixture();
    rawCapability.gates[0].evidence.reference = 'f'.repeat(64);
    expectCodes(() => validate(rawCapability), ['sensitive_material_detected']);

    const moderatorUrl = operatorFixture();
    moderatorUrl.gates[0].evidence.measurement.observed = 'https://climate-assembly.org/mod?code=123456';
    expectCodes(() => validate(moderatorUrl), ['sensitive_material_detected']);

    const ballotUrl = operatorFixture();
    ballotUrl.gates[0].evidence.measurement.observed = '/b?t=actual-production-capability-1234567890';
    expectCodes(() => validate(ballotUrl), ['sensitive_material_detected']);

    expect(contains0912SensitiveMaterial('https://climate-assembly.org/mod?code=000000'))
      .toBe(true);
    expect(contains0912SensitiveMaterial({ snapshotId: '123456', runId: '654321' }))
      .toBe(false);
    expect(contains0912SensitiveMaterial({ snapshotId: 123456, runId: 654321 }))
      .toBe(false);
    expect(contains0912SensitiveMaterial({ requestCount: 123456 }))
      .toBe(true);

    const hmacKeyDisguisedAsId = operatorFixture();
    hmacKeyDisguisedAsId.controls.backupRestore.details.keyId = 'a'.repeat(64);
    expectCodes(() => validate(hmacKeyDisguisedAsId), ['sensitive_material_detected']);
  });
});
