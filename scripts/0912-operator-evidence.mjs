import {
  createHash,
  createPublicKey,
  KeyObject,
  verify as verifySignature,
} from 'node:crypto';

const FULL_COMMIT_PATTERN = /^[0-9a-f]{40}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,95}$/;
const CANONICAL_UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ENVIRONMENT_ID_PATTERN = /^[a-z][a-z0-9-]{2,63}$/;
const SUPABASE_PROJECT_REF_PATTERN = /^[a-z0-9]{20}$/;
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;
const MAX_EVIDENCE_AGE_MS = 24 * 60 * 60 * 1000;

export const CANONICAL_0912_PRODUCTION_RESULT_PATHS = Object.freeze({
  'p3-design-provisioning': 'evaluation/0912-p3-production-result.json',
  'p4-audit-log': 'evaluation/0912-p4-production-result.json',
});

export const CANONICAL_0912_RELEASE_ARTIFACT_PATHS = Object.freeze([
  'evaluation/0912-13-backup-manifest.json',
  'evaluation/0912-13-field-rehearsal.json',
  'evaluation/0912-13-hq-rehearsal.json',
  'evaluation/0912-13-implementation-verification.md',
  'evaluation/0912-13-restore-report.json',
  'evaluation/0912-13-security-diff-review.md',
  'evaluation/0912-13-traceability-report.json',
  'evaluation/0912-hq-dashboard-accessibility.json',
  'evaluation/0912-p1a-postgres-report.json',
  ...Object.values(CANONICAL_0912_PRODUCTION_RESULT_PATHS),
  'evaluation/platform-accessibility-manual-evaluation.json',
]);

export const CANONICAL_0912_GATE_IDS = Object.freeze([
  'source-clean',
  'root-vitest',
  'automation-vitest',
  'astro-check-production-build',
  'rpc-contract',
  'traceability-report',
  'security-diff-review',
  'postgres-p1a-p2a-disposable',
  'roster-canonical-review',
  'p1-tenancy-production-approval',
  'secure-seed-sync-production-approval',
  's20-topics-production-approval',
  'p1a-additive-production-approval',
  'p1a-production-verification',
  'named-hq-operators-ready',
  'hq-join-code-pre-rotation',
  'join-code-throttle-edge-probe',
  'p2-p1b-p1c-production-approval',
  'maintenance-token-staff-client-deployed',
  'deployed-revision-match',
  'production-routine-acl-inventory',
  'p2a-cutover-separate-production-approval',
  'p2a-positive-legacy-negative-verification',
  'p2a-token-revocation-verification',
  'p3-design-provisioning-production-approval',
  'p4-audit-log-production-approval',
  'post-p4-legacy-negative-verification',
  'field-rehearsal',
  'hq-field-rehearsal',
  'onsite-device-network-rehearsal',
  'mod-hq-automated-a11y',
  'mod-hq-manual-a11y',
  'backup',
  'restore-isolated',
  'final-token-cleanup',
]);

export const CANONICAL_0912_ROLLOUT_IDS = Object.freeze([
  'session-roster-review',
  'p1-tenancy',
  'secure-session-team-seed',
  's20-draft-topics',
  'p1a-additive-and-verify',
  'hq-rotate-join-codes',
  'p2-analysis',
  'p1b-p1c-org-selection',
  'maintenance-deploy-token-staff-client',
  'p2a-atomic-token-grant-legacy-revoke',
  'p2a-positive-legacy-negative-verify',
  'p3-design-provisioning',
  'p4-audit-log',
  'post-p4-legacy-negative-and-final-status',
]);

export const CANONICAL_0912_APPROVAL_SCOPES = Object.freeze([
  Object.freeze({
    scope: 'p1-tenancy',
    rolloutStepIds: Object.freeze(['p1-tenancy']),
    gateIds: Object.freeze(['p1-tenancy-production-approval']),
  }),
  Object.freeze({
    scope: 'secure-seed-sync',
    rolloutStepIds: Object.freeze(['secure-session-team-seed']),
    gateIds: Object.freeze(['secure-seed-sync-production-approval']),
  }),
  Object.freeze({
    scope: 's20-topics',
    rolloutStepIds: Object.freeze(['s20-draft-topics']),
    gateIds: Object.freeze(['s20-topics-production-approval']),
  }),
  Object.freeze({
    scope: 'p1a-additive',
    rolloutStepIds: Object.freeze(['p1a-additive-and-verify']),
    gateIds: Object.freeze([
      'p1a-additive-production-approval',
      'p1a-production-verification',
    ]),
  }),
  Object.freeze({
    scope: 'join-code-pre-rotation',
    rolloutStepIds: Object.freeze(['hq-rotate-join-codes']),
    gateIds: Object.freeze(['hq-join-code-pre-rotation', 'join-code-throttle-edge-probe']),
  }),
  Object.freeze({
    scope: 'p2-p1b-p1c',
    rolloutStepIds: Object.freeze(['p2-analysis', 'p1b-p1c-org-selection']),
    gateIds: Object.freeze(['p2-p1b-p1c-production-approval']),
  }),
  Object.freeze({
    scope: 'maintenance-deploy',
    rolloutStepIds: Object.freeze(['maintenance-deploy-token-staff-client']),
    gateIds: Object.freeze([
      'maintenance-token-staff-client-deployed',
      'deployed-revision-match',
    ]),
  }),
  Object.freeze({
    scope: 'p2a-cutover',
    rolloutStepIds: Object.freeze([
      'p2a-atomic-token-grant-legacy-revoke',
      'p2a-positive-legacy-negative-verify',
    ]),
    gateIds: Object.freeze([
      'p2a-cutover-separate-production-approval',
      'p2a-positive-legacy-negative-verification',
      'p2a-token-revocation-verification',
    ]),
  }),
  Object.freeze({
    scope: 'p3-design',
    rolloutStepIds: Object.freeze(['p3-design-provisioning']),
    gateIds: Object.freeze(['p3-design-provisioning-production-approval']),
  }),
  Object.freeze({
    scope: 'p4-audit',
    rolloutStepIds: Object.freeze([
      'p4-audit-log',
      'post-p4-legacy-negative-and-final-status',
    ]),
    gateIds: Object.freeze([
      'p4-audit-log-production-approval',
      'post-p4-legacy-negative-verification',
    ]),
  }),
  Object.freeze({
    scope: 'backup-snapshot',
    rolloutStepIds: Object.freeze([]),
    gateIds: Object.freeze(['backup']),
  }),
  Object.freeze({
    scope: 'final-token-cleanup',
    rolloutStepIds: Object.freeze([]),
    gateIds: Object.freeze(['final-token-cleanup']),
  }),
]);

const TOP_LEVEL_FIELDS = Object.freeze([
  'schemaVersion',
  'evidenceType',
  'session',
  'releaseRunId',
  'generatedAt',
  'sourceCommit',
  'targetRevision',
  'productionEnvironment',
  'artifactBindings',
  'status',
  'attestation',
  'approvals',
  'safety',
  'gates',
  'rolloutSteps',
  'controls',
]);
const ATTESTATION_FIELDS = Object.freeze([
  'algorithm',
  'keyId',
  'payloadSha256',
  'signatureBase64',
  'signedAt',
]);
const APPROVAL_FIELDS = Object.freeze([
  'id',
  'scope',
  'status',
  'approvedAt',
  'approver',
  'session',
  'sourceCommit',
  'targetRevision',
  'rolloutStepIds',
  'gateIds',
]);
const APPROVER_FIELDS = Object.freeze(['id', 'label', 'role']);
const EXECUTION_FIELDS = Object.freeze(['id', 'status', 'executedAt', 'evidence']);
const EVIDENCE_FIELDS = Object.freeze([
  'type',
  'reference',
  'measurement',
  'productionAccess',
]);
const MEASUREMENT_FIELDS = Object.freeze(['name', 'expected', 'observed', 'unit']);
const PRODUCTION_ACCESS_FIELDS = Object.freeze([
  'mode',
  'connectionCount',
  'mutationCount',
  'approvalId',
  'environmentId',
]);
const PRODUCTION_ENVIRONMENT_FIELDS = Object.freeze([
  'id',
  'webOrigin',
  'supabaseProjectRef',
  'databaseTlsSpkiSha256',
  'organizationId',
  'assemblyId',
  'sessionId',
  'sessionSlug',
]);
const ARTIFACT_BINDING_FIELDS = Object.freeze(['path', 'sha256']);
const SAFETY_FIELDS = Object.freeze([
  'sensitiveMaterialDetected',
  'unapprovedProductionMutationCount',
  'syntheticRehearsalProductionMutationCount',
  'capabilityValuesLeakedToDraftQueueOrEvidence',
  'approvedRolloutDatabaseConnectionCount',
  'approvedRolloutMutationCount',
  'observationDatabaseConnectionCount',
  'observationMutationCount',
]);
const CONTROL_FIELDS = Object.freeze([
  'status',
  'checkedAt',
  'evidenceRef',
  'sourceCommit',
  'targetRevision',
  'productionAccess',
  'details',
]);
export const CANONICAL_0912_CONTROL_NAMES = Object.freeze([
  'aclInventory',
  'directEdgeProbe',
  'deploymentRevision',
  'backupRestore',
  'onsiteRehearsal',
  'tokenRevocation',
  'rollbackReadiness',
]);
const CONTROL_NAMES = CANONICAL_0912_CONTROL_NAMES;
const CONTROL_DETAIL_FIELDS = Object.freeze({
  aclInventory: Object.freeze([
    'identityArgumentAllowlistMatched',
    'publicExecutableRoutineCount',
    'unapprovedAnonAuthenticatedRoutineCount',
    'legacyExecutableRoutineCount',
  ]),
  directEdgeProbe: Object.freeze([
    'requestCount',
    'forwardedForOverrideCount',
    'realIpOverrideCount',
    'trustedEdgeSourceStable',
    'edgeOnlyExchangeVerified',
  ]),
  deploymentRevision: Object.freeze([
    'endpointCount',
    'expectedRevision',
    'observedRevision',
  ]),
  backupRestore: Object.freeze([
    'snapshotId',
    'archiveSha256',
    'checksumMatch',
    'rowCountMatch',
    'postgresMajorVersion',
    'isolatedNetwork',
    'containerDisposed',
  ]),
  onsiteRehearsal: Object.freeze([
    'deviceCount',
    'networkProfileCount',
    'failedScenarioCount',
    'desktopVerified',
    'mobileVerified',
    'keyboardOnlyVerified',
  ]),
  tokenRevocation: Object.freeze([
    'revokedTokenReuseAcceptedCount',
    'hqLogoutRevocationVerified',
    'passwordChangeAllDevicesRevoked',
    'teamDeviceRevocationVerified',
  ]),
  rollbackReadiness: Object.freeze([
    'rollbackArtifactSha256',
    'activityGuardRefusalVerified',
    'isolatedRollbackExercisePassed',
    'activationReapplyVerified',
  ]),
});

export const CANONICAL_0912_CONTROL_RECEIPT_IDS = Object.freeze([
  'acl-inventory',
  'direct-edge-probe',
  'deployment-revision',
  'backup-restore',
  'onsite-rehearsal',
  'token-revocation',
  'rollback-readiness',
]);

const RECEIPT_CONFIG = Object.freeze({
  gate: Object.freeze({ directory: 'gates', ids: CANONICAL_0912_GATE_IDS }),
  rollout: Object.freeze({ directory: 'rollout', ids: CANONICAL_0912_ROLLOUT_IDS }),
  control: Object.freeze({ directory: 'controls', ids: CANONICAL_0912_CONTROL_RECEIPT_IDS }),
});

export function canonical0912OperatorReceiptPath(kind, index, id) {
  const config = RECEIPT_CONFIG[kind];
  if (!config || !Number.isSafeInteger(index) || index < 0 || config.ids[index] !== id) {
    throw new TypeError('invalid canonical 0912 operator receipt coordinate');
  }
  return `evaluation/0912-operator/${config.directory}/${index}-${id}.json`;
}

export const CANONICAL_0912_OPERATOR_RECEIPT_PATHS = Object.freeze([
  ...CANONICAL_0912_GATE_IDS.map((id, index) => (
    canonical0912OperatorReceiptPath('gate', index, id)
  )),
  ...CANONICAL_0912_ROLLOUT_IDS.map((id, index) => (
    canonical0912OperatorReceiptPath('rollout', index, id)
  )),
  ...CANONICAL_0912_CONTROL_RECEIPT_IDS.map((id, index) => (
    canonical0912OperatorReceiptPath('control', index, id)
  )),
]);

export const CANONICAL_0912_OPERATOR_BINDING_PATHS = Object.freeze([
  ...CANONICAL_0912_RELEASE_ARTIFACT_PATHS,
  ...CANONICAL_0912_OPERATOR_RECEIPT_PATHS,
].sort());

const PRODUCTION_ENVIRONMENT_GATE_IDS = new Set([
  'join-code-throttle-edge-probe',
  'maintenance-token-staff-client-deployed',
  'deployed-revision-match',
  'onsite-device-network-rehearsal',
]);
const PRODUCTION_ENVIRONMENT_CONTROL_NAMES = new Set([
  'directEdgeProbe',
  'deploymentRevision',
  'onsiteRehearsal',
]);
const APPROVAL_GATE_BEFORE_ROLLOUT = Object.freeze([
  Object.freeze(['p1-tenancy-production-approval', 'p1-tenancy']),
  Object.freeze(['secure-seed-sync-production-approval', 'secure-session-team-seed']),
  Object.freeze(['s20-topics-production-approval', 's20-draft-topics']),
  Object.freeze(['p1a-additive-production-approval', 'p1a-additive-and-verify']),
  Object.freeze(['hq-join-code-pre-rotation', 'hq-rotate-join-codes']),
  Object.freeze(['p2-p1b-p1c-production-approval', 'p2-analysis']),
  Object.freeze(['p2-p1b-p1c-production-approval', 'p1b-p1c-org-selection']),
  Object.freeze(['p2a-cutover-separate-production-approval', 'p2a-atomic-token-grant-legacy-revoke']),
  Object.freeze(['p3-design-provisioning-production-approval', 'p3-design-provisioning']),
  Object.freeze(['p4-audit-log-production-approval', 'p4-audit-log']),
]);
const ROLLOUT_BEFORE_VERIFICATION_GATE = Object.freeze([
  Object.freeze(['p1a-additive-and-verify', 'p1a-production-verification']),
  Object.freeze(['hq-rotate-join-codes', 'join-code-throttle-edge-probe']),
  Object.freeze(['maintenance-deploy-token-staff-client', 'maintenance-token-staff-client-deployed']),
  Object.freeze(['maintenance-deploy-token-staff-client', 'deployed-revision-match']),
  Object.freeze(['p2a-positive-legacy-negative-verify', 'p2a-positive-legacy-negative-verification']),
  Object.freeze(['p2a-positive-legacy-negative-verify', 'p2a-token-revocation-verification']),
  Object.freeze(['post-p4-legacy-negative-and-final-status', 'post-p4-legacy-negative-verification']),
  Object.freeze(['post-p4-legacy-negative-and-final-status', 'backup']),
]);
const APPROVAL_PREREQUISITES = Object.freeze([
  Object.freeze({
    approvalId: 'approval-p1-tenancy',
    afterGateIds: Object.freeze(['roster-canonical-review']),
    afterRolloutIds: Object.freeze(['session-roster-review']),
  }),
  Object.freeze({
    approvalId: 'approval-secure-seed-sync',
    afterGateIds: Object.freeze([]),
    afterRolloutIds: Object.freeze(['p1-tenancy']),
  }),
  Object.freeze({
    approvalId: 'approval-s20-topics',
    afterGateIds: Object.freeze([]),
    afterRolloutIds: Object.freeze(['secure-session-team-seed']),
  }),
  Object.freeze({
    approvalId: 'approval-p1a-additive',
    afterGateIds: Object.freeze([]),
    afterRolloutIds: Object.freeze(['s20-draft-topics']),
  }),
  Object.freeze({
    approvalId: 'approval-join-code-pre-rotation',
    afterGateIds: Object.freeze(['p1a-production-verification']),
    afterRolloutIds: Object.freeze(['p1a-additive-and-verify']),
  }),
  Object.freeze({
    approvalId: 'approval-p2-p1b-p1c',
    afterGateIds: Object.freeze(['join-code-throttle-edge-probe']),
    afterRolloutIds: Object.freeze(['hq-rotate-join-codes']),
  }),
  Object.freeze({
    approvalId: 'approval-maintenance-deploy',
    afterGateIds: Object.freeze([]),
    afterRolloutIds: Object.freeze(['p2-analysis', 'p1b-p1c-org-selection']),
  }),
  Object.freeze({
    approvalId: 'approval-p2a-cutover',
    afterGateIds: Object.freeze([
      'named-hq-operators-ready',
      'maintenance-token-staff-client-deployed',
      'deployed-revision-match',
      'production-routine-acl-inventory',
    ]),
    afterRolloutIds: Object.freeze(['maintenance-deploy-token-staff-client']),
  }),
  Object.freeze({
    approvalId: 'approval-p3-design',
    afterGateIds: Object.freeze([
      'p2a-positive-legacy-negative-verification',
      'p2a-token-revocation-verification',
    ]),
    afterRolloutIds: Object.freeze([
      'p2a-atomic-token-grant-legacy-revoke',
      'p2a-positive-legacy-negative-verify',
    ]),
  }),
  Object.freeze({
    approvalId: 'approval-p4-audit',
    afterGateIds: Object.freeze([]),
    afterRolloutIds: Object.freeze(['p3-design-provisioning']),
  }),
  Object.freeze({
    approvalId: 'approval-backup-snapshot',
    afterGateIds: Object.freeze([
      'post-p4-legacy-negative-verification',
      'onsite-device-network-rehearsal',
      'mod-hq-manual-a11y',
    ]),
    afterRolloutIds: Object.freeze(['post-p4-legacy-negative-and-final-status']),
  }),
  Object.freeze({
    approvalId: 'approval-final-token-cleanup',
    afterGateIds: Object.freeze(['restore-isolated']),
    afterRolloutIds: Object.freeze([]),
  }),
]);

const ALLOWED_SENSITIVE_SEMANTIC_KEYS = new Set([
  'sensitivematerialdetected',
  'secretmaterialdetected',
  'concurrentnamedpasswordrecoveryverification',
  'predictablejoincodeexclusionverification',
  'legacyjoincoderpccount',
  'tokenresumecount',
  'tokencontractviolationcount',
  'databaseauthorizationorlifecycleevidence',
  'tokenrevocation',
  'revokedtokenreuseacceptedcount',
  'hqlogoutrevocationverified',
  'passwordchangealldevicesrevoked',
  'teamdevicerevocationverified',
]);
const ALLOWED_CRYPTOGRAPHIC_VALUE_KEYS = new Set([
  'sha256',
  'sourcescommit',
  'sourcecommit',
  'targetrevision',
  'payloadsha256',
  'targetmanifestsha256',
  'fixturesha256',
  'checksumsha256',
  'databasetlsspkisha256',
  'signaturebase64',
  'archivesha256',
  'rollbackartifactsha256',
  'snapshotsha256',
  'sha256before',
  'sha256after',
  'expectedrevision',
  'observedrevision',
]);
const SENSITIVE_KEY_PATTERN = /(password|passwd|secret|credential|authorization|cookie|joincode|accesstoken|refreshtoken|apikey|privatekey|passphrase)/i;
const SENSITIVE_VALUE_PATTERNS = Object.freeze([
  /\b(?:basic|bearer)\s+[A-Za-z0-9._~+/=-]{8,}\b/i,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/,
  /\b(?:sk|ghp|github_pat|sbp|xox[baprs])[-_][A-Za-z0-9_-]{12,}\b/i,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i,
  /(?:password|passwd|secret|credential|authorization|access[_-]?token|refresh[_-]?token|api[_-]?key|join[_-]?code)\s*[:=]\s*\S+/i,
  /[?&](?:token|access_token|refresh_token|password|secret|join_code)=/i,
  /[?&]code=(?!\[redacted\](?:[&#\s]|$))[^&#\s"']+/i,
  /[?&]t=(?!(?:accessibility-audit-public-ballot-token|<approved-synthetic-ballot-token>)(?:[&#\s]|$))[^&#\s"']+/i,
]);
const SIX_DIGIT_IDENTIFIER_KEYS = new Set(['snapshotid', 'runid']);

function isCanonicalSyntheticModeratorRoute(value, normalizedKey) {
  return ['path', 'url'].includes(normalizedKey)
    && (value === '/mod?code=000000'
      || value === 'http://127.0.0.1:4331/mod?code=000000');
}

const ACCESS_MODES = new Set([
  'no-production-db',
  'read-only-observation',
  'verified-already-applied',
  'approved-non-db-rollout',
  'approved-db-rollout',
]);
const ALREADY_APPLIED_ROLLOUT_IDS = new Set([
  'p1-tenancy',
  'p1a-additive-and-verify',
  'p2-analysis',
  'p1b-p1c-org-selection',
  'p2a-atomic-token-grant-legacy-revoke',
  'p3-design-provisioning',
  'p4-audit-log',
]);

const SPECIAL_GATE_MEASUREMENTS = Object.freeze({
  'source-clean': Object.freeze({
    name: 'source_tree_clean', expected: true, observed: true, unit: 'boolean',
  }),
  'root-vitest': Object.freeze({
    name: 'root_vitest_failed_test_count', expected: 0, observed: 0, unit: 'tests',
  }),
  'automation-vitest': Object.freeze({
    name: 'automation_vitest_failed_test_count', expected: 0, observed: 0, unit: 'tests',
  }),
  'astro-check-production-build': Object.freeze({
    name: 'astro_check_build_error_count', expected: 0, observed: 0, unit: 'errors',
  }),
  'rpc-contract': Object.freeze({
    name: 'rpc_contract_mismatch_count', expected: 0, observed: 0, unit: 'mismatches',
  }),
  'traceability-report': Object.freeze({
    name: 'traceability_failed_check_count', expected: 0, observed: 0, unit: 'checks',
  }),
  'security-diff-review': Object.freeze({
    name: 'unresolved_blocking_security_finding_count', expected: 0, observed: 0, unit: 'findings',
  }),
  'postgres-p1a-p2a-disposable': Object.freeze({
    name: 'disposable_postgres_failed_check_count', expected: 0, observed: 0, unit: 'checks',
  }),
  'roster-canonical-review': Object.freeze({
    name: 'canonical_roster_team_count', expected: 15, observed: 15, unit: 'teams',
  }),
  'named-hq-operators-ready': Object.freeze({
    name: 'unverified_named_hq_operator_count', expected: 0, observed: 0, unit: 'operators',
  }),
  'hq-join-code-pre-rotation': Object.freeze({
    name: 'rotation_target_team_count', expected: 15, observed: 15, unit: 'teams',
  }),
  'join-code-throttle-edge-probe': Object.freeze({
    name: 'untrusted_forwarding_header_acceptance_count', expected: 0, observed: 0, unit: 'requests',
  }),
  'deployed-revision-match': Object.freeze({
    name: 'deployed_revision', expected: '$targetRevision', observed: '$targetRevision', unit: 'git-commit',
  }),
  'production-routine-acl-inventory': Object.freeze({
    name: 'unapproved_executable_routine_count', expected: 0, observed: 0, unit: 'routines',
  }),
  'p2a-positive-legacy-negative-verification': Object.freeze({
    name: 'legacy_positive_execution_count', expected: 0, observed: 0, unit: 'calls',
  }),
  'p2a-token-revocation-verification': Object.freeze({
    name: 'p2a_token_revocation_failed_check_count', expected: 0, observed: 0, unit: 'checks',
  }),
  'field-rehearsal': Object.freeze({
    name: 'field_rehearsal_failed_check_count', expected: 0, observed: 0, unit: 'checks',
  }),
  'hq-field-rehearsal': Object.freeze({
    name: 'hq_rehearsal_failed_check_count', expected: 0, observed: 0, unit: 'checks',
  }),
  'onsite-device-network-rehearsal': Object.freeze({
    name: 'onsite_failed_scenario_count', expected: 0, observed: 0, unit: 'scenarios',
  }),
  'mod-hq-automated-a11y': Object.freeze({
    name: 'automated_accessibility_violation_count', expected: 0, observed: 0, unit: 'violations',
  }),
  'mod-hq-manual-a11y': Object.freeze({
    name: 'manual_accessibility_failed_case_count', expected: 0, observed: 0, unit: 'cases',
  }),
  backup: Object.freeze({
    name: 'verified_backup_snapshot_count', expected: 1, observed: 1, unit: 'snapshots',
  }),
  'restore-isolated': Object.freeze({
    name: 'isolated_restore_mismatch_count', expected: 0, observed: 0, unit: 'mismatches',
  }),
  'final-token-cleanup': Object.freeze({
    name: 'remaining_temporary_event_token_count', expected: 0, observed: 0, unit: 'tokens',
  }),
});

const SPECIAL_ROLLOUT_MEASUREMENTS = Object.freeze({
  'session-roster-review': Object.freeze({
    name: 'rollout_approved_roster_team_count', expected: 15, observed: 15, unit: 'teams',
  }),
  'secure-session-team-seed': Object.freeze({
    name: 'rollout_active_team_count', expected: 15, observed: 15, unit: 'teams',
  }),
  's20-draft-topics': Object.freeze({
    name: 'rollout_draft_topic_count', expected: 6, observed: 6, unit: 'topics',
  }),
  'hq-rotate-join-codes': Object.freeze({
    name: 'rollout_rotated_team_count', expected: 15, observed: 15, unit: 'teams',
  }),
  'maintenance-deploy-token-staff-client': Object.freeze({
    name: 'rollout_deployed_revision', expected: '$targetRevision', observed: '$targetRevision', unit: 'git-commit',
  }),
  'p2a-positive-legacy-negative-verify': Object.freeze({
    name: 'rollout_legacy_positive_execution_count', expected: 0, observed: 0, unit: 'calls',
  }),
  'p3-design-provisioning': Object.freeze({
    name: 'rollout_p3_apply_and_post_apply_verified', expected: true, observed: true, unit: 'boolean',
  }),
  'p4-audit-log': Object.freeze({
    name: 'rollout_p4_apply_and_audit_verified', expected: true, observed: true, unit: 'boolean',
  }),
  'post-p4-legacy-negative-and-final-status': Object.freeze({
    name: 'rollout_final_status_tuple',
    expected: '1-session/15-teams/6-topics',
    observed: '1-session/15-teams/6-topics',
    unit: 'state',
  }),
});

const ALREADY_APPLIED_MEASUREMENTS = Object.freeze({
  'p1-tenancy': Object.freeze({
    name: 'rollout_p1_tenancy_history_checksum_verified', expected: true, observed: true, unit: 'boolean',
  }),
  'p1a-additive-and-verify': Object.freeze({
    name: 'rollout_p1a_history_checksum_and_contract_verified', expected: true, observed: true, unit: 'boolean',
  }),
  'p2-analysis': Object.freeze({
    name: 'rollout_p2_analysis_history_checksum_verified', expected: true, observed: true, unit: 'boolean',
  }),
  'p1b-p1c-org-selection': Object.freeze({
    name: 'rollout_p1b_p1c_history_checksum_verified', expected: true, observed: true, unit: 'boolean',
  }),
  'p2a-atomic-token-grant-legacy-revoke': Object.freeze({
    name: 'rollout_p2a_history_checksum_verified', expected: true, observed: true, unit: 'boolean',
  }),
  'p3-design-provisioning': Object.freeze({
    name: 'rollout_p3_history_checksum_and_post_apply_verified', expected: true, observed: true, unit: 'boolean',
  }),
  'p4-audit-log': Object.freeze({
    name: 'rollout_p4_history_checksum_and_audit_verified', expected: true, observed: true, unit: 'boolean',
  }),
});

export class OperatorEvidenceValidationError extends Error {
  constructor(codes) {
    const uniqueCodes = [...new Set(codes)];
    super(`0912 operator evidence invalid: ${uniqueCodes.join(', ')}`);
    this.name = 'OperatorEvidenceValidationError';
    this.codes = Object.freeze(uniqueCodes);
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(value, keys) {
  if (!isPlainObject(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
}

function arraysEqual(left, right) {
  return Array.isArray(left)
    && Array.isArray(right)
    && left.length === right.length
    && left.every((item, index) => item === right[index]);
}

function isCanonicalUtcTimestamp(value) {
  if (typeof value !== 'string' || !CANONICAL_UTC_PATTERN.test(value)) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function isHttpsOrigin(value) {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:'
      && url.origin === value
      && url.username === ''
      && url.password === '';
  } catch {
    return false;
  }
}

function isValidProductionEnvironment(value) {
  return hasExactKeys(value, PRODUCTION_ENVIRONMENT_FIELDS)
    && ENVIRONMENT_ID_PATTERN.test(value.id ?? '')
    && isHttpsOrigin(value.webOrigin)
    && SUPABASE_PROJECT_REF_PATTERN.test(value.supabaseProjectRef ?? '')
    && SHA256_PATTERN.test(value.databaseTlsSpkiSha256 ?? '')
    && UUID_PATTERN.test(value.organizationId ?? '')
    && UUID_PATTERN.test(value.assemblyId ?? '')
    && UUID_PATTERN.test(value.sessionId ?? '')
    && new Set([value.organizationId, value.assemblyId, value.sessionId]).size === 3
    && value.sessionSlug === '0912-deliberation';
}

function validateProductionEnvironment(actual, expected, errors) {
  const expectedIsValid = isValidProductionEnvironment(expected);
  const actualIsValid = isValidProductionEnvironment(actual);
  if (!expectedIsValid) {
    errors.push('expected_production_environment_invalid');
  }
  if (!actualIsValid) {
    errors.push('production_environment_invalid');
  }
  if (!expectedIsValid
    || !actualIsValid
    || PRODUCTION_ENVIRONMENT_FIELDS.some((field) => actual?.[field] !== expected?.[field])) {
    errors.push('production_environment_mismatch');
  }
}

function validateArtifactBindings(bindings, errors) {
  if (!Array.isArray(bindings)
    || bindings.length !== CANONICAL_0912_OPERATOR_BINDING_PATHS.length) {
    errors.push('artifact_bindings_schema_invalid');
    return;
  }
  bindings.forEach((binding, index) => {
    const prefix = `artifact_binding_${index}`;
    if (!hasExactKeys(binding, ARTIFACT_BINDING_FIELDS)) {
      errors.push(`${prefix}_schema_invalid`);
      return;
    }
    if (binding.path !== CANONICAL_0912_OPERATOR_BINDING_PATHS[index]) {
      errors.push(`${prefix}_path_invalid`);
    }
    if (!SHA256_PATTERN.test(binding.sha256 ?? '')) {
      errors.push(`${prefix}_sha256_invalid`);
    }
  });
}

function validateEvidenceWindow(generatedAt, signedAt, operationalTimestamps, verifiedAt, errors) {
  if (!isCanonicalUtcTimestamp(verifiedAt)) {
    errors.push('verified_at_invalid');
    return;
  }
  const verifiedAtMs = Date.parse(verifiedAt);
  if (isCanonicalUtcTimestamp(generatedAt)) {
    const generatedAtMs = Date.parse(generatedAt);
    if (generatedAtMs > verifiedAtMs + MAX_FUTURE_SKEW_MS) {
      errors.push('operator_generated_at_future_skew_exceeded');
    }
    if (verifiedAtMs - generatedAtMs > MAX_EVIDENCE_AGE_MS) {
      errors.push('operator_evidence_stale');
    }
  }
  if (isCanonicalUtcTimestamp(signedAt)
    && Date.parse(signedAt) > verifiedAtMs + MAX_FUTURE_SKEW_MS) {
    errors.push('attestation_signed_at_future_skew_exceeded');
  }
  for (const timestamp of operationalTimestamps) {
    if (!isCanonicalUtcTimestamp(timestamp)) continue;
    const eventAtMs = Date.parse(timestamp);
    if (eventAtMs > verifiedAtMs + MAX_FUTURE_SKEW_MS) {
      errors.push('operator_operational_event_future_skew_exceeded');
    }
    if (verifiedAtMs - eventAtMs > MAX_EVIDENCE_AGE_MS) {
      errors.push('operator_operational_event_stale');
    }
  }
}

function isNonNegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function isPositiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function isSafeLabel(value) {
  return typeof value === 'string'
    && value === value.trim()
    && value.length >= 2
    && value.length <= 80
    && !/[\u0000-\u001f\u007f]/.test(value);
}

function keyLooksSensitive(key) {
  const normalized = key.replace(/[^A-Za-z0-9]/g, '').toLowerCase();
  return SENSITIVE_KEY_PATTERN.test(normalized)
    && !ALLOWED_SENSITIVE_SEMANTIC_KEYS.has(normalized);
}

function containsSensitiveMaterial(value, seen = new Set(), propertyKey = '') {
  if (typeof value === 'string') {
    const normalizedKey = propertyKey.replace(/[^A-Za-z0-9]/g, '').toLowerCase();
    if (isCanonicalSyntheticModeratorRoute(value, normalizedKey)) return false;
    const publicSigningKeyId = normalizedKey === 'keyid'
      && /^ed25519-sha256:[0-9a-f]{64}$/u.test(value);
    const rawCapabilityLikeHex = /\b[0-9a-f]{64}\b/i.test(value)
      && !publicSigningKeyId
      && !ALLOWED_CRYPTOGRAPHIC_VALUE_KEYS.has(normalizedKey);
    const sixDigitCapability = /\b\d{6}\b/u.test(value)
      && !(SIX_DIGIT_IDENTIFIER_KEYS.has(normalizedKey) && /^\d{6}$/u.test(value));
    return rawCapabilityLikeHex
      || sixDigitCapability
      || SENSITIVE_VALUE_PATTERNS.some((pattern) => pattern.test(value));
  }
  if (typeof value === 'number') {
    const normalizedKey = propertyKey.replace(/[^A-Za-z0-9]/g, '').toLowerCase();
    return Number.isSafeInteger(value)
      && value >= 100000
      && value <= 999999
      && !SIX_DIGIT_IDENTIFIER_KEYS.has(normalizedKey);
  }
  if (value === null || typeof value !== 'object') return false;
  if (seen.has(value)) return true;
  seen.add(value);
  if (Array.isArray(value)) {
    const found = value.some((entry) => containsSensitiveMaterial(entry, seen, propertyKey));
    seen.delete(value);
    return found;
  }
  const found = Object.entries(value).some(([key, entry]) => (
    keyLooksSensitive(key) || containsSensitiveMaterial(entry, seen, key)
  ));
  seen.delete(value);
  return found;
}

function findSensitiveMaterialPath(value, seen = new Set(), propertyKey = '', path = '$') {
  if (typeof value === 'string') {
    const normalizedKey = propertyKey.replace(/[^A-Za-z0-9]/g, '').toLowerCase();
    if (isCanonicalSyntheticModeratorRoute(value, normalizedKey)) return null;
    const publicSigningKeyId = normalizedKey === 'keyid'
      && /^ed25519-sha256:[0-9a-f]{64}$/u.test(value);
    const rawCapabilityLikeHex = /\b[0-9a-f]{64}\b/i.test(value)
      && !publicSigningKeyId
      && !ALLOWED_CRYPTOGRAPHIC_VALUE_KEYS.has(normalizedKey);
    const sixDigitCapability = /\b\d{6}\b/u.test(value)
      && !(SIX_DIGIT_IDENTIFIER_KEYS.has(normalizedKey) && /^\d{6}$/u.test(value));
    return rawCapabilityLikeHex
      || sixDigitCapability
      || SENSITIVE_VALUE_PATTERNS.some((pattern) => pattern.test(value))
      ? path
      : null;
  }
  if (typeof value === 'number') {
    const normalizedKey = propertyKey.replace(/[^A-Za-z0-9]/g, '').toLowerCase();
    return Number.isSafeInteger(value)
      && value >= 100000
      && value <= 999999
      && !SIX_DIGIT_IDENTIFIER_KEYS.has(normalizedKey)
      ? path
      : null;
  }
  if (value === null || typeof value !== 'object') return null;
  if (seen.has(value)) return path;
  seen.add(value);
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const found = findSensitiveMaterialPath(value[index], seen, propertyKey, `${path}[${index}]`);
      if (found !== null) {
        seen.delete(value);
        return found;
      }
    }
    seen.delete(value);
    return null;
  }
  for (const [key, entry] of Object.entries(value)) {
    const entryPath = `${path}.${key}`;
    if (keyLooksSensitive(key)) {
      seen.delete(value);
      return entryPath;
    }
    const found = findSensitiveMaterialPath(entry, seen, key, entryPath);
    if (found !== null) {
      seen.delete(value);
      return found;
    }
  }
  seen.delete(value);
  return null;
}

/** Shared fail-closed scanner for every 9/12 release evidence artifact. */
export function contains0912SensitiveMaterial(value) {
  return containsSensitiveMaterial(value);
}

/** Return only the offending property path, never the sensitive value itself. */
export function find0912SensitiveMaterialPath(value) {
  return findSensitiveMaterialPath(value);
}

function canonicalJson(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || Object.is(value, -0)) throw new TypeError('invalid canonical number');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalJson(entry)).join(',')}]`;
  if (!isPlainObject(value)) throw new TypeError('invalid canonical value');
  const entries = Object.keys(value).sort().map((key) => {
    if (value[key] === undefined) throw new TypeError('invalid canonical property');
    return `${JSON.stringify(key)}:${canonicalJson(value[key])}`;
  });
  return `{${entries.join(',')}}`;
}

function unsignedOperatorPayload(operator) {
  if (!isPlainObject(operator)) return operator;
  return Object.fromEntries(Object.entries(operator).filter(([key]) => key !== 'attestation'));
}

function attestationSigningMessage({ keyId, payloadSha256, signedAt }) {
  return Buffer.from(
    `0912-operator-evidence-v1\n${keyId}\n${payloadSha256}\n${signedAt}`,
    'utf8',
  );
}

function readTrustedEd25519PublicSpki(trustedPublicKey, errors) {
  let publicKey;
  if (trustedPublicKey instanceof KeyObject) {
    if (trustedPublicKey.type !== 'public') {
      errors.push('attestation_trusted_key_not_public_spki');
      return undefined;
    }
    publicKey = trustedPublicKey;
  } else if (typeof trustedPublicKey === 'string' || Buffer.isBuffer(trustedPublicKey)) {
    const pem = (Buffer.isBuffer(trustedPublicKey)
      ? trustedPublicKey.toString('utf8').trim()
      : trustedPublicKey.trim()).replaceAll('\r\n', '\n');
    const match = /^-----BEGIN PUBLIC KEY-----\n([A-Za-z0-9+/=\n]+)\n-----END PUBLIC KEY-----$/.exec(pem);
    const base64 = match?.[1].replaceAll('\n', '') ?? '';
    const canonicalBase64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
    if (!match || !canonicalBase64.test(base64)) {
      errors.push('attestation_trusted_key_not_public_spki');
      return undefined;
    }
    try {
      const der = Buffer.from(base64, 'base64');
      if (der.toString('base64') !== base64) {
        errors.push('attestation_trusted_key_not_public_spki');
        return undefined;
      }
      publicKey = createPublicKey({ key: der, type: 'spki', format: 'der' });
    } catch {
      errors.push('attestation_trusted_public_key_invalid');
      return undefined;
    }
  } else {
    errors.push('attestation_trusted_public_key_invalid');
    return undefined;
  }
  if (publicKey.asymmetricKeyType !== 'ed25519') {
    errors.push('attestation_trusted_key_type_invalid');
    return undefined;
  }
  try {
    publicKey.export({ type: 'spki', format: 'der' });
  } catch {
    errors.push('attestation_trusted_key_not_public_spki');
    return undefined;
  }
  return publicKey;
}

function validateAttestation({ operator, trustedPublicKey, generatedAt, errors }) {
  const attestation = operator?.attestation;
  if (!hasExactKeys(attestation, ATTESTATION_FIELDS)) {
    errors.push('attestation_schema_invalid');
    return;
  }
  if (attestation.algorithm !== 'Ed25519') errors.push('attestation_algorithm_invalid');
  if (!isCanonicalUtcTimestamp(attestation.signedAt)) {
    errors.push('attestation_signed_at_invalid');
  } else if (isCanonicalUtcTimestamp(generatedAt)
    && Date.parse(attestation.signedAt) < Date.parse(generatedAt)) {
    errors.push('attestation_signed_before_report');
  }
  if (!SHA256_PATTERN.test(attestation.payloadSha256 ?? '')) {
    errors.push('attestation_payload_sha256_invalid');
  }

  let canonicalPayload;
  let calculatedPayloadSha256;
  try {
    canonicalPayload = canonicalJson(unsignedOperatorPayload(operator));
    calculatedPayloadSha256 = createHash('sha256').update(canonicalPayload, 'utf8').digest('hex');
  } catch {
    errors.push('attestation_payload_not_canonicalizable');
    return;
  }
  if (attestation.payloadSha256 !== calculatedPayloadSha256) {
    errors.push('attestation_payload_sha256_mismatch');
  }

  let signature;
  if (typeof attestation.signatureBase64 !== 'string') {
    errors.push('attestation_signature_invalid');
  } else {
    try {
      signature = Buffer.from(attestation.signatureBase64, 'base64');
      if (signature.length !== 64 || signature.toString('base64') !== attestation.signatureBase64) {
        errors.push('attestation_signature_invalid');
        signature = undefined;
      }
    } catch {
      errors.push('attestation_signature_invalid');
    }
  }

  const publicKey = readTrustedEd25519PublicSpki(trustedPublicKey, errors);
  if (!publicKey) return;

  const expectedKeyId = `ed25519-sha256:${createHash('sha256')
    .update(publicKey.export({ type: 'spki', format: 'der' }))
    .digest('hex')}`;
  if (attestation.keyId !== expectedKeyId) errors.push('attestation_key_id_invalid');
  if (!signature
    || !isCanonicalUtcTimestamp(attestation.signedAt)
    || !SHA256_PATTERN.test(attestation.payloadSha256 ?? '')) return;
  try {
    const verified = verifySignature(
      null,
      attestationSigningMessage(attestation),
      publicKey,
      signature,
    );
    if (!verified) errors.push('attestation_signature_verification_failed');
  } catch {
    errors.push('attestation_signature_verification_failed');
  }
}

function resolvedMeasurement(kind, id, expectedTargetRevision) {
  const configured = kind === 'gate'
    ? SPECIAL_GATE_MEASUREMENTS[id]
    : SPECIAL_ROLLOUT_MEASUREMENTS[id];
  const fallback = {
    name: `${kind}_${id.replaceAll('-', '_')}_result`,
    expected: 'pass',
    observed: 'pass',
    unit: 'result',
  };
  const measurement = configured ?? fallback;
  return {
    ...measurement,
    expected: measurement.expected === '$targetRevision'
      ? expectedTargetRevision
      : measurement.expected,
    observed: measurement.observed === '$targetRevision'
      ? expectedTargetRevision
      : measurement.observed,
  };
}

function templateApprovalId(kind, id) {
  const scope = CANONICAL_0912_APPROVAL_SCOPES.find((entry) => (
    kind === 'gate' ? entry.gateIds.includes(id) : entry.rolloutStepIds.includes(id)
  ));
  return scope ? `approval-${scope.scope}` : null;
}

function templateProductionAccess(kind, id, environmentId) {
  let mode = 'no-production-db';
  if (kind === 'rollout' && id !== 'session-roster-review') {
    mode = id === 'maintenance-deploy-token-staff-client'
      ? 'approved-non-db-rollout'
      : 'approved-db-rollout';
  } else if (kind === 'gate' && id === 'production-routine-acl-inventory') {
    mode = 'read-only-observation';
  } else if (kind === 'gate' && ['backup', 'final-token-cleanup'].includes(id)) {
    mode = 'approved-db-rollout';
  }
  const productionEnvironmentRequired = mode !== 'no-production-db'
    || (kind === 'gate' && PRODUCTION_ENVIRONMENT_GATE_IDS.has(id));
  return {
    mode,
    connectionCount: null,
    mutationCount: null,
    approvalId: mode.startsWith('approved-') ? templateApprovalId(kind, id) : null,
    environmentId: productionEnvironmentRequired ? environmentId : null,
  };
}

function templateMeasurement(kind, id, targetRevision) {
  const measurement = resolvedMeasurement(kind, id, targetRevision);
  return {
    ...measurement,
    observed: null,
  };
}

/** Build the canonical unsigned worksheet so the checked-in template cannot drift. */
export function create0912OperatorEvidenceTemplate({
  releaseRunId = null,
  sourceCommit = null,
  targetRevision = null,
  productionEnvironment = null,
} = {}) {
  const environment = productionEnvironment ?? {
    id: null,
    webOrigin: null,
    supabaseProjectRef: null,
    databaseTlsSpkiSha256: null,
    organizationId: null,
    assemblyId: null,
    sessionId: null,
    sessionSlug: '0912-deliberation',
  };
  const environmentId = environment.id ?? null;
  const executions = (kind, ids) => ids.map((id, index) => ({
    id,
    status: 'not_run',
    executedAt: null,
    evidence: {
      type: null,
      reference: canonical0912OperatorReceiptPath(kind, index, id),
      measurement: templateMeasurement(kind, id, targetRevision),
      productionAccess: templateProductionAccess(kind, id, environmentId),
    },
  }));
  const controls = Object.fromEntries(CONTROL_NAMES.map((name, index) => [name, {
    status: 'not_run',
    checkedAt: null,
    evidenceRef: canonical0912OperatorReceiptPath(
      'control',
      index,
      CANONICAL_0912_CONTROL_RECEIPT_IDS[index],
    ),
    sourceCommit,
    targetRevision,
    productionAccess: {
      mode: 'no-production-db',
      connectionCount: null,
      mutationCount: null,
      approvalId: null,
      environmentId: PRODUCTION_ENVIRONMENT_CONTROL_NAMES.has(name) ? environmentId : null,
    },
    details: Object.fromEntries(CONTROL_DETAIL_FIELDS[name].map((field) => [field, null])),
  }]));

  return {
    schemaVersion: 2,
    evidenceType: '0912-operator-readiness',
    session: '0912-deliberation',
    releaseRunId,
    generatedAt: null,
    sourceCommit,
    targetRevision,
    productionEnvironment: { ...environment },
    artifactBindings: CANONICAL_0912_OPERATOR_BINDING_PATHS.map((path) => ({
      path,
      sha256: null,
    })),
    status: 'not_run',
    attestation: null,
    approvals: CANONICAL_0912_APPROVAL_SCOPES.map((scope) => ({
      id: `approval-${scope.scope}`,
      scope: scope.scope,
      status: 'pending',
      approvedAt: null,
      approver: { id: null, label: null, role: null },
      session: '0912-deliberation',
      sourceCommit,
      targetRevision,
      rolloutStepIds: [...scope.rolloutStepIds],
      gateIds: [...scope.gateIds],
    })),
    safety: Object.fromEntries(SAFETY_FIELDS.map((field) => [field, null])),
    gates: executions('gate', CANONICAL_0912_GATE_IDS),
    rolloutSteps: executions('rollout', CANONICAL_0912_ROLLOUT_IDS),
    controls,
  };
}

function measurementsEqual(left, right) {
  return hasExactKeys(left, MEASUREMENT_FIELDS)
    && hasExactKeys(right, MEASUREMENT_FIELDS)
    && MEASUREMENT_FIELDS.every((field) => left[field] === right[field]);
}

function validateExpectedIds(actual, canonical, prefix, errors) {
  if (!arraysEqual(actual, canonical)) errors.push(`${prefix}_invalid`);
}

function validateProductionAccess({
  access,
  approvalById,
  executedAt,
  expectedEnvironmentId,
  productionEnvironmentRequired = false,
  expectedApprovalId = undefined,
  prefix,
  errors,
}) {
  if (!hasExactKeys(access, PRODUCTION_ACCESS_FIELDS)) {
    errors.push(`${prefix}_production_access_schema_invalid`);
    return;
  }
  if (!ACCESS_MODES.has(access.mode)) errors.push(`${prefix}_production_access_mode_invalid`);
  const requiresEnvironment = access.mode !== 'no-production-db' || productionEnvironmentRequired;
  const expectedAccessEnvironmentId = requiresEnvironment ? expectedEnvironmentId : null;
  if (access.environmentId !== expectedAccessEnvironmentId) {
    errors.push(`${prefix}_production_environment_invalid`);
  }
  if (!isNonNegativeInteger(access.connectionCount)) {
    errors.push(`${prefix}_production_connection_count_invalid`);
  }
  if (!isNonNegativeInteger(access.mutationCount)) {
    errors.push(`${prefix}_production_mutation_count_invalid`);
  }

  if (access.mode === 'no-production-db') {
    if (access.connectionCount !== 0 || access.mutationCount !== 0 || access.approvalId !== null) {
      errors.push(`${prefix}_no_production_db_access_invalid`);
    }
    return;
  }
  if (access.mode === 'read-only-observation') {
    if (!isPositiveInteger(access.connectionCount)
      || access.mutationCount !== 0
      || access.approvalId !== null) {
      errors.push(`${prefix}_read_only_observation_invalid`);
    }
    return;
  }

  const approval = approvalById.get(access.approvalId);
  if (typeof access.approvalId !== 'string' || !approval) {
    errors.push(`${prefix}_approval_reference_invalid`);
    return;
  }
  if (expectedApprovalId !== undefined && access.approvalId !== expectedApprovalId) {
    errors.push(`${prefix}_approval_scope_invalid`);
  }
  if (isCanonicalUtcTimestamp(executedAt)
    && isCanonicalUtcTimestamp(approval.approvedAt)
    && Date.parse(executedAt) <= Date.parse(approval.approvedAt)) {
    errors.push(`${prefix}_executed_before_approval`);
  }
  if (access.mode === 'approved-non-db-rollout') {
    if (access.connectionCount !== 0 || access.mutationCount !== 0) {
      errors.push(`${prefix}_approved_non_db_access_invalid`);
    }
  }
  if (access.mode === 'verified-already-applied'
    && (!isPositiveInteger(access.connectionCount) || access.mutationCount !== 0)) {
    errors.push(`${prefix}_already_applied_verification_invalid`);
  }
  if (access.mode === 'approved-db-rollout'
    && (!isPositiveInteger(access.connectionCount)
      || !isPositiveInteger(access.mutationCount))) {
    errors.push(`${prefix}_approved_db_access_invalid`);
  }
}

function validateApprovals({
  approvals,
  expectedSourceCommit,
  expectedTargetRevision,
  generatedAt,
  errors,
}) {
  const approvalById = new Map();
  const approvalIdByRolloutStep = new Map();
  const approvalIdByGate = new Map();
  if (!Array.isArray(approvals) || approvals.length !== CANONICAL_0912_APPROVAL_SCOPES.length) {
    errors.push('approvals_schema_invalid');
    return { approvalById, approvalIdByRolloutStep, approvalIdByGate };
  }

  let previousApprovedAt = null;
  approvals.forEach((approval, index) => {
    const prefix = `approval_${index}`;
    const expected = CANONICAL_0912_APPROVAL_SCOPES[index];
    const expectedApprovalId = `approval-${expected.scope}`;
    if (!hasExactKeys(approval, APPROVAL_FIELDS)) errors.push(`${prefix}_schema_invalid`);
    if (approval?.id !== expectedApprovalId) errors.push(`${prefix}_id_invalid`);
    if (approvalById.has(approval?.id)) errors.push('approval_id_duplicate');
    if (approval?.scope !== expected.scope) errors.push(`${prefix}_scope_invalid`);
    if (approval?.status !== 'approved') errors.push(`${prefix}_status_invalid`);
    if (!isCanonicalUtcTimestamp(approval?.approvedAt)) {
      errors.push(`${prefix}_approved_at_invalid`);
    } else {
      if (previousApprovedAt !== null && Date.parse(approval.approvedAt) <= previousApprovedAt) {
        errors.push('approval_order_invalid');
      }
      previousApprovedAt = Date.parse(approval.approvedAt);
      if (isCanonicalUtcTimestamp(generatedAt)
        && Date.parse(approval.approvedAt) > Date.parse(generatedAt)) {
        errors.push(`${prefix}_approved_after_report`);
      }
    }
    if (!hasExactKeys(approval?.approver, APPROVER_FIELDS)) {
      errors.push(`${prefix}_approver_schema_invalid`);
    } else {
      if (!SAFE_ID_PATTERN.test(approval.approver.id ?? '')) {
        errors.push(`${prefix}_approver_id_invalid`);
      }
      if (!isSafeLabel(approval.approver.label)) errors.push(`${prefix}_approver_label_invalid`);
      if (approval.approver.role !== 'situation-owner') {
        errors.push(`${prefix}_approver_role_invalid`);
      }
    }
    if (approval?.session !== '0912-deliberation') errors.push(`${prefix}_session_invalid`);
    if (approval?.sourceCommit !== expectedSourceCommit) errors.push(`${prefix}_source_commit_invalid`);
    if (approval?.targetRevision !== expectedTargetRevision) {
      errors.push(`${prefix}_target_revision_invalid`);
    }
    if (!arraysEqual(approval?.rolloutStepIds, expected.rolloutStepIds)) {
      errors.push(`${prefix}_rollout_scope_invalid`);
    }
    if (!arraysEqual(approval?.gateIds, expected.gateIds)) {
      errors.push(`${prefix}_gate_scope_invalid`);
    }

    if (typeof approval?.id === 'string' && !approvalById.has(approval.id)) {
      approvalById.set(approval.id, approval);
      for (const rolloutStepId of expected.rolloutStepIds) {
        if (approvalIdByRolloutStep.has(rolloutStepId)) errors.push('approval_rollout_scope_duplicate');
        approvalIdByRolloutStep.set(rolloutStepId, approval.id);
      }
      for (const gateId of expected.gateIds) {
        if (approvalIdByGate.has(gateId)) errors.push('approval_gate_scope_duplicate');
        approvalIdByGate.set(gateId, approval.id);
      }
    }
  });
  return { approvalById, approvalIdByRolloutStep, approvalIdByGate };
}

function validateExecutions({
  values,
  ids,
  kind,
  expectedTargetRevision,
  expectedEnvironmentId,
  generatedAt,
  approvalById,
  approvalIdByRolloutStep,
  approvalIdByGate,
  evidenceTypes,
  evidenceReferences,
  measurementNames,
  accessRecords,
  errors,
}) {
  if (!Array.isArray(values) || values.length !== ids.length) {
    errors.push(`${kind}_executions_schema_invalid`);
    return new Map();
  }
  const byId = new Map();
  let previousExecutedAt = null;
  values.forEach((value, index) => {
    const expectedId = ids[index];
    const prefix = `${kind}_${index}`;
    if (!hasExactKeys(value, EXECUTION_FIELDS)) errors.push(`${prefix}_schema_invalid`);
    if (value?.id !== expectedId) errors.push(`${prefix}_id_order_invalid`);
    if (byId.has(value?.id)) errors.push(`${kind}_id_duplicate`);
    if (value?.status !== 'pass') errors.push(`${prefix}_status_invalid`);
    if (!isCanonicalUtcTimestamp(value?.executedAt)) {
      errors.push(`${prefix}_executed_at_invalid`);
    } else {
      const executedAt = Date.parse(value.executedAt);
      if (previousExecutedAt !== null && executedAt <= previousExecutedAt) {
        errors.push(`${kind}_execution_order_invalid`);
      }
      previousExecutedAt = executedAt;
      if (isCanonicalUtcTimestamp(generatedAt) && executedAt > Date.parse(generatedAt)) {
        errors.push(`${prefix}_executed_after_report`);
      }
    }

    const evidence = value?.evidence;
    if (!hasExactKeys(evidence, EVIDENCE_FIELDS)) {
      errors.push(`${prefix}_evidence_schema_invalid`);
    } else {
      const expectedEvidenceType = `0912-${kind}-${expectedId}-v1`;
      if (evidence.type !== expectedEvidenceType) errors.push(`${prefix}_evidence_type_invalid`);
      if (evidenceTypes.has(evidence.type)) errors.push('evidence_type_duplicate');
      evidenceTypes.add(evidence.type);
      const expectedReference = canonical0912OperatorReceiptPath(kind, index, expectedId);
      if (evidence.reference !== expectedReference) errors.push(`${prefix}_evidence_reference_invalid`);
      if (evidenceReferences.has(evidence.reference)) errors.push('evidence_reference_duplicate');
      evidenceReferences.add(evidence.reference);

      const expectedMeasurement = kind === 'rollout'
        && evidence.productionAccess?.mode === 'verified-already-applied'
        ? ALREADY_APPLIED_MEASUREMENTS[expectedId]
        : resolvedMeasurement(kind, expectedId, expectedTargetRevision);
      if (!measurementsEqual(evidence.measurement, expectedMeasurement)) {
        errors.push(`${prefix}_measurement_invalid`);
      }
      if (isPlainObject(evidence.measurement)) {
        if (measurementNames.has(evidence.measurement.name)) errors.push('measurement_name_duplicate');
        measurementNames.add(evidence.measurement.name);
      }

      const expectedApprovalId = kind === 'rollout'
        ? approvalIdByRolloutStep.get(expectedId)
        : approvalIdByGate.get(expectedId);
      validateProductionAccess({
        access: evidence.productionAccess,
        approvalById,
        executedAt: value?.executedAt,
        expectedEnvironmentId,
        productionEnvironmentRequired: kind === 'gate'
          && PRODUCTION_ENVIRONMENT_GATE_IDS.has(expectedId),
        expectedApprovalId,
        prefix,
        errors,
      });
      if (kind === 'rollout') {
        const expectedModes = expectedId === 'session-roster-review'
          ? new Set(['no-production-db'])
          : expectedId === 'maintenance-deploy-token-staff-client'
            ? new Set(['approved-non-db-rollout'])
            : ALREADY_APPLIED_ROLLOUT_IDS.has(expectedId)
              ? new Set(['approved-db-rollout', 'verified-already-applied'])
              : new Set(['approved-db-rollout']);
        if (!expectedModes.has(evidence.productionAccess?.mode)) {
          errors.push(`${prefix}_production_access_mode_for_step_invalid`);
        }
        if (expectedApprovalId !== undefined
          && evidence.productionAccess?.approvalId !== expectedApprovalId) {
          errors.push(`${prefix}_approval_scope_invalid`);
        }
      } else {
        const expectedModes = expectedId === 'production-routine-acl-inventory'
          ? new Set(['read-only-observation'])
          : expectedId === 'backup'
            ? new Set(['approved-db-rollout'])
            : expectedId === 'final-token-cleanup'
              ? new Set(['approved-db-rollout', 'read-only-observation'])
              : new Set(['no-production-db']);
        if (!expectedModes.has(evidence.productionAccess?.mode)) {
          errors.push(`${prefix}_production_access_mode_for_gate_invalid`);
        }
        if ((expectedId === 'backup'
          || (expectedId === 'final-token-cleanup'
            && evidence.productionAccess?.mode === 'approved-db-rollout'))
          && (!isPositiveInteger(evidence.productionAccess?.mutationCount)
            || evidence.productionAccess?.approvalId !== expectedApprovalId)) {
          errors.push(`${prefix}_approved_mutation_invalid`);
        }
      }
      if (hasExactKeys(evidence.productionAccess, PRODUCTION_ACCESS_FIELDS)) {
        accessRecords.push(evidence.productionAccess);
      }
    }
    if (typeof value?.id === 'string' && !byId.has(value.id)) byId.set(value.id, value);
  });
  return byId;
}

function validateControlCommon({
  name,
  index,
  control,
  expectedSourceCommit,
  expectedTargetRevision,
  expectedEnvironmentId,
  generatedAt,
  approvalById,
  evidenceReferences,
  accessRecords,
  errors,
}) {
  const prefix = `control_${name}`;
  if (!hasExactKeys(control, CONTROL_FIELDS)) {
    errors.push(`${prefix}_schema_invalid`);
    return false;
  }
  if (control.status !== 'pass') errors.push(`${prefix}_status_invalid`);
  if (!isCanonicalUtcTimestamp(control.checkedAt)) {
    errors.push(`${prefix}_checked_at_invalid`);
  } else if (isCanonicalUtcTimestamp(generatedAt)
    && Date.parse(control.checkedAt) > Date.parse(generatedAt)) {
    errors.push(`${prefix}_checked_after_report`);
  }
  const expectedEvidenceRef = canonical0912OperatorReceiptPath(
    'control',
    index,
    CANONICAL_0912_CONTROL_RECEIPT_IDS[index],
  );
  if (control.evidenceRef !== expectedEvidenceRef) {
    errors.push(`${prefix}_evidence_reference_invalid`);
  }
  if (evidenceReferences.has(control.evidenceRef)) errors.push('evidence_reference_duplicate');
  evidenceReferences.add(control.evidenceRef);
  if (control.sourceCommit !== expectedSourceCommit) errors.push(`${prefix}_source_commit_invalid`);
  if (control.targetRevision !== expectedTargetRevision) {
    errors.push(`${prefix}_target_revision_invalid`);
  }
  validateProductionAccess({
    access: control.productionAccess,
    approvalById,
    executedAt: control.checkedAt,
    expectedEnvironmentId,
    productionEnvironmentRequired: PRODUCTION_ENVIRONMENT_CONTROL_NAMES.has(name),
    prefix,
    errors,
  });
  if (hasExactKeys(control.productionAccess, PRODUCTION_ACCESS_FIELDS)) {
    accessRecords.push(control.productionAccess);
  }
  if (!hasExactKeys(control.details, CONTROL_DETAIL_FIELDS[name])) {
    errors.push(`${prefix}_details_schema_invalid`);
    return false;
  }
  return true;
}

function executionTime(byId, id) {
  const timestamp = byId.get(id)?.executedAt;
  return isCanonicalUtcTimestamp(timestamp) ? Date.parse(timestamp) : null;
}

function validateExecutionDependencies({
  gateById,
  rolloutById,
  approvalById,
  approvalIdByGate,
  errors,
}) {
  const configuredApprovalIds = new Set(APPROVAL_PREREQUISITES.map((entry) => entry.approvalId));
  const expectedApprovalIds = new Set(
    CANONICAL_0912_APPROVAL_SCOPES.map((entry) => `approval-${entry.scope}`),
  );
  if (configuredApprovalIds.size !== expectedApprovalIds.size
    || [...expectedApprovalIds].some((id) => !configuredApprovalIds.has(id))) {
    errors.push('dag_approval_prerequisite_config_invalid');
  }
  for (const prerequisite of APPROVAL_PREREQUISITES) {
    const approval = approvalById.get(prerequisite.approvalId);
    if (!approval || !isCanonicalUtcTimestamp(approval.approvedAt)) continue;
    const approvalTime = Date.parse(approval.approvedAt);
    for (const gateId of prerequisite.afterGateIds) {
      const gateTime = executionTime(gateById, gateId);
      if (gateTime === null) {
        errors.push(`dag_${prerequisite.approvalId}_prerequisite_${gateId}_missing`);
      } else if (approvalTime <= gateTime) {
        errors.push(`dag_${prerequisite.approvalId}_not_after_${gateId}`);
      }
    }
    for (const rolloutId of prerequisite.afterRolloutIds) {
      const rolloutTime = executionTime(rolloutById, rolloutId);
      if (rolloutTime === null) {
        errors.push(`dag_${prerequisite.approvalId}_prerequisite_${rolloutId}_missing`);
      } else if (approvalTime <= rolloutTime) {
        errors.push(`dag_${prerequisite.approvalId}_not_after_${rolloutId}`);
      }
    }
  }
  for (const [gateId, approvalId] of approvalIdByGate) {
    const gateTime = executionTime(gateById, gateId);
    const approvedAt = approvalById.get(approvalId)?.approvedAt;
    if (gateTime !== null
      && isCanonicalUtcTimestamp(approvedAt)
      && gateTime <= Date.parse(approvedAt)) {
      errors.push(`dag_${gateId}_not_after_approval`);
    }
  }
  for (const [gateId, rolloutId] of APPROVAL_GATE_BEFORE_ROLLOUT) {
    const gateTime = executionTime(gateById, gateId);
    const rolloutTime = executionTime(rolloutById, rolloutId);
    if (gateTime !== null && rolloutTime !== null && gateTime >= rolloutTime) {
      errors.push(`dag_${gateId}_not_before_${rolloutId}`);
    }
  }
  for (const [rolloutId, gateId] of ROLLOUT_BEFORE_VERIFICATION_GATE) {
    const rolloutTime = executionTime(rolloutById, rolloutId);
    const gateTime = executionTime(gateById, gateId);
    if (rolloutTime !== null && gateTime !== null && rolloutTime >= gateTime) {
      errors.push(`dag_${gateId}_not_after_${rolloutId}`);
    }
  }
  const backupTime = executionTime(gateById, 'backup');
  const restoreTime = executionTime(gateById, 'restore-isolated');
  if (backupTime !== null && restoreTime !== null && backupTime >= restoreTime) {
    errors.push('dag_restore-isolated_not_after_backup');
  }
}

function validateControlAfterExecutions(control, byId, ids, prefix, errors) {
  if (!isCanonicalUtcTimestamp(control?.checkedAt)) return;
  const checkedAt = Date.parse(control.checkedAt);
  for (const id of ids) {
    const executedAt = executionTime(byId, id);
    if (executedAt !== null && checkedAt < executedAt) {
      errors.push(`${prefix}_checked_before_gate`);
      return;
    }
  }
}

function validateControls({
  controls,
  expectedSourceCommit,
  expectedTargetRevision,
  expectedEnvironmentId,
  generatedAt,
  approvalById,
  gateById,
  evidenceReferences,
  accessRecords,
  errors,
}) {
  if (!hasExactKeys(controls, CONTROL_NAMES)) {
    errors.push('controls_schema_invalid');
    return;
  }
  const validDetails = {};
  CONTROL_NAMES.forEach((name, index) => {
    validDetails[name] = validateControlCommon({
      name,
      index,
      control: controls[name],
      expectedSourceCommit,
      expectedTargetRevision,
      expectedEnvironmentId,
      generatedAt,
      approvalById,
      evidenceReferences,
      accessRecords,
      errors,
    });
  });

  const acl = controls.aclInventory;
  if (validDetails.aclInventory) {
    const details = acl.details;
    if (details.identityArgumentAllowlistMatched !== true
      || details.publicExecutableRoutineCount !== 0
      || details.unapprovedAnonAuthenticatedRoutineCount !== 0
      || details.legacyExecutableRoutineCount !== 0) {
      errors.push('control_acl_inventory_result_invalid');
    }
    if (acl.productionAccess?.mode !== 'no-production-db') {
      errors.push('control_acl_inventory_access_invalid');
    }
    validateControlAfterExecutions(
      acl,
      gateById,
      ['production-routine-acl-inventory'],
      'control_acl_inventory',
      errors,
    );
  }

  const edge = controls.directEdgeProbe;
  if (validDetails.directEdgeProbe) {
    const details = edge.details;
    if (!isPositiveInteger(details.requestCount)
      || details.forwardedForOverrideCount !== 0
      || details.realIpOverrideCount !== 0
      || details.trustedEdgeSourceStable !== true
      || details.edgeOnlyExchangeVerified !== true) {
      errors.push('control_direct_edge_probe_result_invalid');
    }
    if (edge.productionAccess?.mode !== 'no-production-db') {
      errors.push('control_direct_edge_probe_access_invalid');
    }
    validateControlAfterExecutions(
      edge,
      gateById,
      ['join-code-throttle-edge-probe'],
      'control_direct_edge_probe',
      errors,
    );
  }

  const deployment = controls.deploymentRevision;
  if (validDetails.deploymentRevision) {
    const details = deployment.details;
    if (!isPositiveInteger(details.endpointCount)
      || details.expectedRevision !== expectedTargetRevision
      || details.observedRevision !== expectedTargetRevision) {
      errors.push('control_deployment_revision_result_invalid');
    }
    if (deployment.productionAccess?.mode !== 'no-production-db') {
      errors.push('control_deployment_revision_access_invalid');
    }
    validateControlAfterExecutions(
      deployment,
      gateById,
      ['deployed-revision-match'],
      'control_deployment_revision',
      errors,
    );
  }

  const backupRestore = controls.backupRestore;
  if (validDetails.backupRestore) {
    const details = backupRestore.details;
    if (!Number.isSafeInteger(details.snapshotId) || details.snapshotId <= 0
      || !SHA256_PATTERN.test(details.archiveSha256 ?? '')
      || details.checksumMatch !== true
      || details.rowCountMatch !== true
      || details.postgresMajorVersion !== 16
      || details.isolatedNetwork !== true
      || details.containerDisposed !== true) {
      errors.push('control_backup_restore_result_invalid');
    }
    if (backupRestore.productionAccess?.mode !== 'no-production-db') {
      errors.push('control_backup_restore_access_invalid');
    }
    validateControlAfterExecutions(
      backupRestore,
      gateById,
      ['backup', 'restore-isolated'],
      'control_backup_restore',
      errors,
    );
  }

  const onsite = controls.onsiteRehearsal;
  if (validDetails.onsiteRehearsal) {
    const details = onsite.details;
    if (!isPositiveInteger(details.deviceCount)
      || !isPositiveInteger(details.networkProfileCount)
      || details.failedScenarioCount !== 0
      || details.desktopVerified !== true
      || details.mobileVerified !== true
      || details.keyboardOnlyVerified !== true) {
      errors.push('control_onsite_rehearsal_result_invalid');
    }
    if (onsite.productionAccess?.mode !== 'no-production-db') {
      errors.push('control_onsite_rehearsal_access_invalid');
    }
    validateControlAfterExecutions(
      onsite,
      gateById,
      ['onsite-device-network-rehearsal'],
      'control_onsite_rehearsal',
      errors,
    );
  }

  const token = controls.tokenRevocation;
  if (validDetails.tokenRevocation) {
    const details = token.details;
    if (details.revokedTokenReuseAcceptedCount !== 0
      || details.hqLogoutRevocationVerified !== true
      || details.passwordChangeAllDevicesRevoked !== true
      || details.teamDeviceRevocationVerified !== true) {
      errors.push('control_token_revocation_result_invalid');
    }
    if (token.productionAccess?.mode !== 'no-production-db') {
      errors.push('control_token_revocation_access_invalid');
    }
    validateControlAfterExecutions(
      token,
      gateById,
      ['p2a-token-revocation-verification'],
      'control_token_revocation',
      errors,
    );
  }

  const rollback = controls.rollbackReadiness;
  if (validDetails.rollbackReadiness) {
    const details = rollback.details;
    if (!SHA256_PATTERN.test(details.rollbackArtifactSha256 ?? '')
      || details.activityGuardRefusalVerified !== true
      || details.isolatedRollbackExercisePassed !== true
      || details.activationReapplyVerified !== true) {
      errors.push('control_rollback_readiness_result_invalid');
    }
    if (rollback.productionAccess?.mode !== 'no-production-db') {
      errors.push('control_rollback_readiness_access_invalid');
    }
    validateControlAfterExecutions(
      rollback,
      gateById,
      ['postgres-p1a-p2a-disposable'],
      'control_rollback_readiness',
      errors,
    );
  }
}

function accessTotals(accessRecords) {
  return accessRecords.reduce((totals, access) => {
    if (access.mode === 'approved-db-rollout') {
      totals.approvedRolloutDatabaseConnectionCount += access.connectionCount;
      totals.approvedRolloutMutationCount += access.mutationCount;
    }
    if (access.mode === 'read-only-observation' || access.mode === 'verified-already-applied') {
      totals.observationDatabaseConnectionCount += access.connectionCount;
      totals.observationMutationCount += access.mutationCount;
    }
    return totals;
  }, {
    approvedRolloutDatabaseConnectionCount: 0,
    approvedRolloutMutationCount: 0,
    observationDatabaseConnectionCount: 0,
    observationMutationCount: 0,
  });
}

function validateSafety(safety, totals, errors) {
  if (!hasExactKeys(safety, SAFETY_FIELDS)) {
    errors.push('safety_schema_invalid');
    return;
  }
  if (safety.sensitiveMaterialDetected !== false) errors.push('safety_sensitive_material_detected');
  if (safety.unapprovedProductionMutationCount !== 0) {
    errors.push('safety_unapproved_production_mutation_detected');
  }
  if (safety.syntheticRehearsalProductionMutationCount !== 0) {
    errors.push('safety_synthetic_rehearsal_production_mutation_detected');
  }
  if (safety.capabilityValuesLeakedToDraftQueueOrEvidence !== false) {
    errors.push('safety_capability_material_detected');
  }
  for (const field of Object.keys(totals)) {
    if (safety[field] !== totals[field]) errors.push(`safety_${field}_mismatch`);
  }
  if (safety.observationMutationCount !== 0) errors.push('safety_observation_mutation_detected');
}

function throwIfErrors(errors) {
  if (errors.length > 0) throw new OperatorEvidenceValidationError(errors);
}

function validate0912OperatorEvidenceInternal({
  operator,
  expectedSourceCommit,
  expectedTargetRevision,
  expectedReleaseRunId,
  expectedProductionEnvironment,
  expectedGateIds,
  expectedRolloutIds,
  trustedPublicKey,
  verifiedAt,
} = {}, requireAttestation = true) {
  const errors = [];
  if (containsSensitiveMaterial(operator)) errors.push('sensitive_material_detected');
  if (!FULL_COMMIT_PATTERN.test(expectedSourceCommit ?? '')) errors.push('expected_source_commit_invalid');
  if (!FULL_COMMIT_PATTERN.test(expectedTargetRevision ?? '')) {
    errors.push('expected_target_revision_invalid');
  }
  if (!UUID_PATTERN.test(expectedReleaseRunId ?? '')) {
    errors.push('expected_release_run_id_invalid');
  }
  validateExpectedIds(expectedGateIds, CANONICAL_0912_GATE_IDS, 'expected_gate_ids', errors);
  validateExpectedIds(expectedRolloutIds, CANONICAL_0912_ROLLOUT_IDS, 'expected_rollout_ids', errors);

  if (!hasExactKeys(operator, TOP_LEVEL_FIELDS)) errors.push('operator_schema_invalid');
  if (operator?.schemaVersion !== 2) errors.push('operator_schema_version_invalid');
  if (operator?.evidenceType !== '0912-operator-readiness') errors.push('operator_evidence_type_invalid');
  if (operator?.session !== '0912-deliberation') errors.push('operator_session_invalid');
  if (!UUID_PATTERN.test(operator?.releaseRunId ?? '')) {
    errors.push('operator_release_run_id_invalid');
  }
  if (operator?.releaseRunId !== expectedReleaseRunId) {
    errors.push('operator_release_run_id_mismatch');
  }
  if (!isCanonicalUtcTimestamp(operator?.generatedAt)) errors.push('operator_generated_at_invalid');
  if (operator?.sourceCommit !== expectedSourceCommit) errors.push('operator_source_commit_invalid');
  if (operator?.targetRevision !== expectedTargetRevision) {
    errors.push('operator_target_revision_invalid');
  }
  if (operator?.status !== 'pass') errors.push('operator_status_invalid');
  validateProductionEnvironment(
    operator?.productionEnvironment,
    expectedProductionEnvironment,
    errors,
  );
  validateArtifactBindings(operator?.artifactBindings, errors);
  const operationalTimestamps = [
    ...(Array.isArray(operator?.approvals)
      ? operator.approvals.map((approval) => approval?.approvedAt)
      : []),
    ...(Array.isArray(operator?.gates)
      ? operator.gates.map((gate) => gate?.executedAt)
      : []),
    ...(Array.isArray(operator?.rolloutSteps)
      ? operator.rolloutSteps.map((step) => step?.executedAt)
      : []),
    ...(isPlainObject(operator?.controls)
      ? Object.values(operator.controls).map((control) => control?.checkedAt)
      : []),
  ];
  validateEvidenceWindow(
    operator?.generatedAt,
    operator?.attestation?.signedAt,
    operationalTimestamps,
    verifiedAt,
    errors,
  );
  if (requireAttestation) {
    validateAttestation({
      operator,
      trustedPublicKey,
      generatedAt: operator?.generatedAt,
      errors,
    });
  } else if (operator?.attestation !== null) {
    errors.push('unsigned_operator_attestation_must_be_null');
  }

  const { approvalById, approvalIdByRolloutStep, approvalIdByGate } = validateApprovals({
    approvals: operator?.approvals,
    expectedSourceCommit,
    expectedTargetRevision,
    generatedAt: operator?.generatedAt,
    errors,
  });
  const evidenceTypes = new Set();
  const evidenceReferences = new Set();
  const measurementNames = new Set();
  const accessRecords = [];
  const gateById = validateExecutions({
    values: operator?.gates,
    ids: CANONICAL_0912_GATE_IDS,
    kind: 'gate',
    expectedTargetRevision,
    expectedEnvironmentId: expectedProductionEnvironment?.id,
    generatedAt: operator?.generatedAt,
    approvalById,
    approvalIdByRolloutStep,
    approvalIdByGate,
    evidenceTypes,
    evidenceReferences,
    measurementNames,
    accessRecords,
    errors,
  });
  const rolloutById = validateExecutions({
    values: operator?.rolloutSteps,
    ids: CANONICAL_0912_ROLLOUT_IDS,
    kind: 'rollout',
    expectedTargetRevision,
    expectedEnvironmentId: expectedProductionEnvironment?.id,
    generatedAt: operator?.generatedAt,
    approvalById,
    approvalIdByRolloutStep,
    approvalIdByGate,
    evidenceTypes,
    evidenceReferences,
    measurementNames,
    accessRecords,
    errors,
  });
  validateExecutionDependencies({
    gateById,
    rolloutById,
    approvalById,
    approvalIdByGate,
    errors,
  });
  validateControls({
    controls: operator?.controls,
    expectedSourceCommit,
    expectedTargetRevision,
    expectedEnvironmentId: expectedProductionEnvironment?.id,
    generatedAt: operator?.generatedAt,
    approvalById,
    gateById,
    evidenceReferences,
    accessRecords,
    errors,
  });
  const totals = accessTotals(accessRecords);
  validateSafety(operator?.safety, totals, errors);
  throwIfErrors(errors);

  return Object.freeze({
    valid: true,
    session: '0912-deliberation',
    sourceCommit: expectedSourceCommit,
    targetRevision: expectedTargetRevision,
    releaseRunId: operator.releaseRunId,
    productionEnvironmentId: operator.productionEnvironment.id,
    artifactBindingCount: CANONICAL_0912_OPERATOR_BINDING_PATHS.length,
    approvalCount: CANONICAL_0912_APPROVAL_SCOPES.length,
    gateCount: CANONICAL_0912_GATE_IDS.length,
    rolloutStepCount: CANONICAL_0912_ROLLOUT_IDS.length,
    attestationKeyId: requireAttestation ? operator.attestation.keyId : null,
    payloadSha256: requireAttestation ? operator.attestation.payloadSha256 : null,
    ...totals,
    sensitiveMaterialDetected: false,
    unapprovedProductionMutationCount: operator.safety.unapprovedProductionMutationCount,
    syntheticRehearsalProductionMutationCount:
      operator.safety.syntheticRehearsalProductionMutationCount,
    capabilityValuesLeakedToDraftQueueOrEvidence:
      operator.safety.capabilityValuesLeakedToDraftQueueOrEvidence,
  });
}

export function validate0912OperatorEvidence(options = {}) {
  return validate0912OperatorEvidenceInternal(options, true);
}

export function validate0912UnsignedOperatorEvidence(options = {}) {
  return validate0912OperatorEvidenceInternal(options, false);
}
