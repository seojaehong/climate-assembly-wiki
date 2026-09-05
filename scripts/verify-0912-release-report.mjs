import { execFileSync } from 'node:child_process';
import { createHash, createPublicKey, KeyObject } from 'node:crypto';
import {
  closeSync,
  existsSync,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import {
  evaluateManualAccessibilityEvidence,
  readManualAccessibilityTargetState,
  validateManualAccessibilityTarget,
} from '../automation/platform-accessibility-manual-evidence.mjs';
import { validate0912BackupRestoreEvidence } from './0912-backup-restore-evidence.mjs';
import {
  CANONICAL_0912_CONTROL_RECEIPT_IDS,
  CANONICAL_0912_CONTROL_NAMES,
  CANONICAL_0912_GATE_IDS,
  CANONICAL_0912_OPERATOR_BINDING_PATHS,
  CANONICAL_0912_OPERATOR_RECEIPT_PATHS,
  CANONICAL_0912_PRODUCTION_RESULT_PATHS,
  CANONICAL_0912_ROLLOUT_IDS,
  canonical0912OperatorReceiptPath,
  contains0912SensitiveMaterial,
  validate0912OperatorEvidence,
} from './0912-operator-evidence.mjs';
import {
  REQUIRED_0912_CRITICAL_GATES,
  verify0912Readiness,
} from './verify-0912-readiness.mjs';

const FULL_COMMIT_PATTERN = /^[0-9a-f]{40}$/;
const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPORT_ID = '0912-13-readiness';
const RELEASE_REPORT_PATH = 'evaluation/0912-13-readiness-report.json';
const TEMPLATE_PATH = 'evaluation/0912-13-readiness-report.template.json';
const TRUST_POLICY_PATH = 'docs/operations/0912-evidence-trust-policy.json';
const APPROVED_MANUAL_ACCESSIBILITY_ORIGIN = 'https://climate-assembly.org';
const ITEM_STATUSES = new Set(['pass', 'fail', 'blocked', 'stopped', 'not_run']);
const REPORT_FIELDS = [
  'schemaVersion',
  'reportId',
  'releaseRunId',
  'generatedAt',
  'sourceCommit',
  'sourceTreeClean',
  'targetRevision',
  'status',
  'releaseDecision',
  'safety',
  'criticalGates',
  'productionRollout',
  'requirements',
  'artifacts',
  'blockers',
];
const CANONICAL_ARTIFACT_PATHS = Object.freeze({
  traceabilityReport: 'evaluation/0912-13-traceability-report.json',
  postgresVerificationReport: 'evaluation/0912-p1a-postgres-report.json',
  fieldRehearsalReport: 'evaluation/0912-13-field-rehearsal.json',
  hqFieldRehearsalReport: 'evaluation/0912-13-hq-rehearsal.json',
  accessibilityReport: 'evaluation/0912-hq-dashboard-accessibility.json',
  manualAccessibilityEvidence: 'evaluation/platform-accessibility-manual-evaluation.json',
  backupManifest: 'evaluation/0912-13-backup-manifest.json',
  restoreLog: 'evaluation/0912-13-restore-report.json',
  operatorLog: 'evaluation/0912-13-operator-log.json',
});
const PRODUCTION_RESULT_CONFIG = Object.freeze({
  'p3-design-provisioning': Object.freeze({
    rolloutId: 'p3-design-provisioning',
    path: CANONICAL_0912_PRODUCTION_RESULT_PATHS['p3-design-provisioning'],
    evidenceType: '0912-p3-production-result',
    migrationPath: 'supabase/migrations/platform_p3_design_provisioning.sql',
    verificationPath: 'supabase/verify/design_provisioning_post_apply.sql',
    historyId: 'platform_p3_design_provisioning',
    checkIds: Object.freeze(['p3-post-apply-script']),
  }),
  'p4-audit-log': Object.freeze({
    rolloutId: 'p4-audit-log',
    path: CANONICAL_0912_PRODUCTION_RESULT_PATHS['p4-audit-log'],
    evidenceType: '0912-p4-production-result',
    migrationPath: 'supabase/migrations/platform_p4_audit_log.sql',
    verificationPath: 'supabase/verify/platform_audit_post_apply.sql',
    historySnapshotPath: 'supabase/verify/platform_audit_history_snapshot.sql',
    historyId: 'platform_p4_audit_log',
    checkIds: Object.freeze([
      'p4-post-apply-script',
      'p4-legacy-history-preserved',
    ]),
  }),
});
const ALLOWED_EVIDENCE_PATHS = new Set([
  ...Object.values(CANONICAL_ARTIFACT_PATHS),
  ...Object.values(CANONICAL_0912_PRODUCTION_RESULT_PATHS),
  ...CANONICAL_0912_OPERATOR_RECEIPT_PATHS,
  RELEASE_REPORT_PATH,
  'evaluation/0912-13-security-diff-review.md',
  'evaluation/0912-13-implementation-verification.md',
]);
const REPORT_STATUS_DECISIONS = new Map([
  ['needs_review', 'not_ready'],
  ['fail', 'not_ready'],
  ['stopped', 'stopped'],
  ['pass', 'ready'],
]);
const MANUAL_ACCESSIBILITY_EXCLUSION_ID = 'assistive-technology-manual-evaluation';
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const KEY_ID_PATTERN = /^ed25519-sha256:[0-9a-f]{64}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const CANONICAL_UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const MAX_EVIDENCE_AGE_MS = 24 * 60 * 60 * 1000;
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;
const MAX_EVIDENCE_FILE_BYTES = 4 * 1024 * 1024;
const MAX_OPERATOR_BINDING_TOTAL_BYTES = 32 * 1024 * 1024;
const MAX_PUBLIC_KEY_FILE_BYTES = 64 * 1024;
const MAX_BACKUP_ARCHIVE_BYTES = 128 * 1024 * 1024;
const REQUIREMENT_SIGNED_DEPENDENCIES = Object.freeze({
  'AUTH-2DEVICE': Object.freeze({
    gates: Object.freeze([
      'named-hq-operators-ready',
      'p2a-token-revocation-verification',
      'postgres-p1a-p2a-disposable',
    ]),
    controls: Object.freeze(['tokenRevocation']),
  }),
  'AUTH-TOKEN-ONLY': Object.freeze({
    gates: Object.freeze([
      'p2a-positive-legacy-negative-verification',
      'p2a-token-revocation-verification',
      'final-token-cleanup',
      'postgres-p1a-p2a-disposable',
    ]),
    controls: Object.freeze(['tokenRevocation']),
  }),
  'SYNC-SESSION-STATE': Object.freeze({
    gates: Object.freeze(['field-rehearsal', 'hq-field-rehearsal', 'postgres-p1a-p2a-disposable']),
    controls: Object.freeze([]),
  }),
  'UX-STATUS-RAIL': Object.freeze({
    gates: Object.freeze(['field-rehearsal', 'mod-hq-automated-a11y', 'mod-hq-manual-a11y']),
    controls: Object.freeze([]),
  }),
  'TOPIC-CONTEXT-PRESERVE': Object.freeze({
    gates: Object.freeze(['field-rehearsal', 'postgres-p1a-p2a-disposable']),
    controls: Object.freeze([]),
  }),
  'SAVE-OCC-IDEMPOTENCY': Object.freeze({
    gates: Object.freeze(['field-rehearsal', 'hq-field-rehearsal', 'postgres-p1a-p2a-disposable']),
    controls: Object.freeze([]),
  }),
  'PLATFORM-RECLASSIFY-ATOMIC': Object.freeze({
    gates: Object.freeze(['hq-field-rehearsal', 'postgres-p1a-p2a-disposable']),
    controls: Object.freeze([]),
  }),
  'HQ-CONTROL': Object.freeze({
    gates: Object.freeze([
      'hq-field-rehearsal',
      'production-routine-acl-inventory',
      'p2a-token-revocation-verification',
      'final-token-cleanup',
    ]),
    controls: Object.freeze(['aclInventory', 'tokenRevocation']),
  }),
  'HQ-TOKEN-REVOCATION': Object.freeze({
    gates: Object.freeze([
      'p2a-token-revocation-verification',
      'final-token-cleanup',
      'postgres-p1a-p2a-disposable',
    ]),
    controls: Object.freeze(['tokenRevocation']),
  }),
  'A11Y-MOD-HQ': Object.freeze({
    gates: Object.freeze(['mod-hq-automated-a11y', 'mod-hq-manual-a11y']),
    controls: Object.freeze([]),
  }),
  'DB-P1A-DISPOSABLE': Object.freeze({
    gates: Object.freeze(['postgres-p1a-p2a-disposable']),
    controls: Object.freeze([]),
  }),
  'OPS-ZERO-LIVE-MUTATION': Object.freeze({
    gates: Object.freeze([
      'root-vitest',
      'automation-vitest',
      'field-rehearsal',
      'hq-field-rehearsal',
      'postgres-p1a-p2a-disposable',
    ]),
    controls: Object.freeze(['directEdgeProbe']),
  }),
  'OPS-BACKUP-RESTORE-STOP': Object.freeze({
    gates: Object.freeze(['backup', 'restore-isolated', 'final-token-cleanup']),
    controls: Object.freeze(['backupRestore', 'rollbackReadiness']),
  }),
  'CI-COMPLETE-MATRIX': Object.freeze({
    gates: Object.freeze([
      'root-vitest',
      'automation-vitest',
      'astro-check-production-build',
      'rpc-contract',
      'traceability-report',
      'security-diff-review',
      'postgres-p1a-p2a-disposable',
    ]),
    controls: Object.freeze([]),
  }),
});
export const CANONICAL_ACCESSIBILITY_ROUTE_PATHS = Object.freeze({
  'platform-login': '/platform/',
  'platform-login-error': '/platform/',
  'authenticated-platform': '/platform/',
  'accessibility-statement': '/platform/accessibility/',
  'public-result-unpublished': '/r/_/',
  'published-result': '/r/_/',
  'ontology-review': '/ko/moderator/ontology-review/',
  'public-vote-open': '/v?r=00000000-0000-4000-8000-000000000009',
  'public-vote-submitted': '/v?r=00000000-0000-4000-8000-000000000009',
  'public-vote-duplicate': '/v?r=00000000-0000-4000-8000-000000000009',
  'public-vote-closed': '/v?r=00000000-0000-4000-8000-000000000009',
  'public-vote-error': '/v?r=00000000-0000-4000-8000-000000000009',
  'public-ballot-open': '/b?t=accessibility-audit-public-ballot-token',
  'public-ballot-submitted': '/b?t=accessibility-audit-public-ballot-token',
  'public-ballot-duplicate': '/b?t=accessibility-audit-public-ballot-token',
  'public-ballot-closed': '/b?t=accessibility-audit-public-ballot-token',
  'public-ballot-published': '/b?t=accessibility-audit-public-ballot-token',
  'public-ballot-error': '/b?t=accessibility-audit-public-ballot-token',
  'moderator-console': '/mod?code=000000',
  'moderator-console-timer': '/mod?code=000000',
  'hq-console-gate': '/hq',
  'hq-console-submissions': '/hq',
  'hq-console-dashboard': '/hq?ops=1',
});
const CANONICAL_ACCESSIBILITY_PROFILES = Object.freeze(['desktop', 'mobile']);
const TRACEABILITY_CHECK_IDS = Object.freeze([
  'manifest-schema',
  'requirement-links',
  'report-template',
  'field-report-template',
  'hq-report-template',
  'synthetic-fixture',
  'ci-matrix',
  'postgres-p1a-p2a-disposable',
  'seed-live-write-disabled',
  'backup-token-bound-export',
  'hq-attendance-session-boundary',
  'accessibility-routes',
  'field-context-preservation',
  'runbook-controls',
]);
const FIELD_REHEARSAL_CHECK_IDS = Object.freeze(['0', '1', '1b', '2', '3', '4', '5', '6', '7', '8', '9']);
const HQ_REHEARSAL_CHECK_IDS = Object.freeze([
  'named-hq-session',
  'category-stable-retry',
  'kind-stable-retry',
  'stale-conflict-recovery',
  'clear-exact-set-conflict',
  'logout-failure-retains-capability',
  'logout-success-clears-capability',
  'deny-by-default-network',
]);
const POSTGRES_PASSED_FIELDS = Object.freeze([
  'staticContractVerification',
  'migrationOrderVerification',
  'behaviorVerification',
  'concurrentJoinRateLimitVerification',
  'concurrentTeamDeviceLimitVerification',
  'concurrentActiveRoundCreationVerification',
  'concurrentSharedHqThrottleVerification',
  'concurrentNamedPasswordRecoveryVerification',
  'ballotCloseRaceVerification',
  'rollbackWithoutActivity',
  'canvasScopeRollbackGuardVerification',
  'tokenOnlyActivationVerification',
  'legacyPermissionNegativeVerification',
  'legacyCrossSessionDeadlineNegativeVerification',
  'predictableJoinCodeExclusionVerification',
  'postP4LegacyNegativeVerification',
  'p3ReadOnlyPostApplyVerification',
  'p4ReadOnlyPostApplyVerification',
  'p4LegacyHistoryPreservationVerification',
  'p4BehaviorVerification',
  'activationRollbackGuardVerification',
  'activationRollbackExerciseVerification',
  'activationReapplyVerification',
  'seedCliSqlSyntaxAndSuccessVerification',
  'seedCliPartialTenancyFailClosedVerification',
]);
const POSTGRES_REPORT_FIELDS = Object.freeze([
  'schemaVersion',
  'reportId',
  'generatedAt',
  'sourceCommit',
  'sourceTreeClean',
  'releaseMode',
  'status',
  'database',
  'checkFunctionBodies',
  ...POSTGRES_PASSED_FIELDS,
  'rollbackWithActivity',
  'seedCliCapabilityValuesLogged',
  'seedCliHostTemporaryFileMode',
  'seedCliHostTemporaryFileRemovedBeforeExecution',
  'seedCliContainerCopyRemovedWithCreatedContainer',
  'targetManifestCount',
  'targetManifestSha256',
  'targetManifestVerifiedAtCompletion',
  'targetManifest',
  'safety',
  'elapsedSeconds',
]);

class ReleaseReportValidationError extends Error {
  constructor(codes) {
    const uniqueCodes = [...new Set(codes)];
    super(`0912 release report rejected: ${uniqueCodes.join(', ')}`);
    this.name = 'ReleaseReportValidationError';
    this.codes = uniqueCodes;
  }
}

class ReleaseReportCliError extends Error {
  constructor(code) {
    super(`0912 release report CLI rejected: ${code}`);
    this.name = 'ReleaseReportCliError';
    this.code = code;
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function decodeUtf8Strict(bytes) {
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

/** Parse JSON while rejecting duplicate object keys, including escaped aliases. */
export function parse0912JsonStrict(text) {
  if (typeof text !== 'string') throw new SyntaxError('invalid_json_evidence');
  let cursor = 0;
  const fail = () => { throw new SyntaxError('invalid_json_evidence'); };
  const skipWhitespace = () => {
    while (cursor < text.length && /[\u0009\u000a\u000d\u0020]/u.test(text[cursor])) cursor += 1;
  };
  const parseString = () => {
    if (text[cursor] !== '"') fail();
    const start = cursor;
    cursor += 1;
    while (cursor < text.length) {
      const character = text[cursor];
      cursor += 1;
      if (character === '"') {
        try {
          return JSON.parse(text.slice(start, cursor));
        } catch {
          return fail();
        }
      }
      if (character === '\\') {
        if (cursor >= text.length) fail();
        const escape = text[cursor];
        cursor += 1;
        if (escape === 'u') {
          const codePoint = text.slice(cursor, cursor + 4);
          if (!/^[0-9a-fA-F]{4}$/u.test(codePoint)) fail();
          cursor += 4;
        } else if (!'"\\/bfnrt'.includes(escape)) {
          fail();
        }
      } else if (character.charCodeAt(0) <= 0x1f) {
        fail();
      }
    }
    return fail();
  };
  const parseValue = (depth = 0) => {
    if (depth > 200) fail();
    skipWhitespace();
    const character = text[cursor];
    if (character === '{') {
      cursor += 1;
      skipWhitespace();
      const keys = new Set();
      if (text[cursor] === '}') {
        cursor += 1;
        return;
      }
      while (cursor < text.length) {
        skipWhitespace();
        const key = parseString();
        if (keys.has(key)) fail();
        keys.add(key);
        skipWhitespace();
        if (text[cursor] !== ':') fail();
        cursor += 1;
        parseValue(depth + 1);
        skipWhitespace();
        if (text[cursor] === '}') {
          cursor += 1;
          return;
        }
        if (text[cursor] !== ',') fail();
        cursor += 1;
      }
      return fail();
    }
    if (character === '[') {
      cursor += 1;
      skipWhitespace();
      if (text[cursor] === ']') {
        cursor += 1;
        return;
      }
      while (cursor < text.length) {
        parseValue(depth + 1);
        skipWhitespace();
        if (text[cursor] === ']') {
          cursor += 1;
          return;
        }
        if (text[cursor] !== ',') fail();
        cursor += 1;
      }
      return fail();
    }
    if (character === '"') {
      parseString();
      return;
    }
    const remaining = text.slice(cursor);
    const primitive = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/u.exec(remaining);
    if (!primitive) fail();
    cursor += primitive[0].length;
  };

  parseValue();
  skipWhitespace();
  if (cursor !== text.length) fail();
  try {
    return JSON.parse(text);
  } catch {
    return fail();
  }
}

function parse0912JsonBytes(bytes) {
  return parse0912JsonStrict(decodeUtf8Strict(bytes));
}

function hasExactKeys(value, expectedKeys) {
  if (!isPlainObject(value)) return false;
  const actualKeys = Object.keys(value).sort();
  const sortedExpectedKeys = [...expectedKeys].sort();
  return JSON.stringify(actualKeys) === JSON.stringify(sortedExpectedKeys);
}

function isFullCommit(value) {
  return typeof value === 'string' && FULL_COMMIT_PATTERN.test(value);
}

function isNonEmptyEvidence(value) {
  if (typeof value === 'string') return value.trim().length > 0;
  return Array.isArray(value)
    && value.length > 0
    && value.every((item) => typeof item === 'string' && item.trim().length > 0);
}

function evidencePaths(value) {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value;
  return [];
}

function validateEvidenceFiles(value, evidencePathExists, errorPrefix, errors) {
  for (const path of evidencePaths(value)) {
    if (!ALLOWED_EVIDENCE_PATHS.has(path)) {
      errors.push(`${errorPrefix}_path_not_allowed`);
      continue;
    }
    if (typeof evidencePathExists !== 'function' || !evidencePathExists(path)) {
      errors.push(`${errorPrefix}_file_missing`);
    }
  }
}

function isValidGeneratedAt(value) {
  return typeof value === 'string'
    && value.trim().length > 0
    && Number.isFinite(Date.parse(value));
}

function readJsonSafely(root, relativePath, errorCode, maxBytes = MAX_EVIDENCE_FILE_BYTES) {
  try {
    const bytes = readRegularEvidenceFile(root, relativePath, maxBytes);
    if (bytes === null) throw new Error('unreadable_json_evidence');
    return parse0912JsonBytes(bytes);
  } catch {
    throw new ReleaseReportValidationError([errorCode]);
  }
}

function readCanonicalContract(root, expectedCommit) {
  let template;
  try {
    template = expectedCommit
      ? parse0912JsonStrict(gitOutput(root, ['show', `${expectedCommit}:${TEMPLATE_PATH}`]))
      : readJsonSafely(root, TEMPLATE_PATH, 'canonical_template_unreadable');
  } catch (error) {
    if (error instanceof ReleaseReportValidationError) throw error;
    throw new ReleaseReportValidationError(['canonical_template_unreadable']);
  }
  const rollout = template?.productionRollout;
  const steps = rollout?.orderedSteps;
  if (template?.schemaVersion !== 1
    || template?.reportId !== REPORT_ID
    || rollout?.productionMutationRequiresExplicitApproval !== true
    || !Array.isArray(steps)
    || steps.length === 0
    || steps.some((step) => !hasExactKeys(step, ['id', 'status', 'evidence'])
      || typeof step.id !== 'string'
      || step.id.length === 0
      || step.status !== 'not_run'
      || step.evidence !== null)) {
    throw new ReleaseReportValidationError(['canonical_template_invalid']);
  }
  const ids = steps.map((step) => step.id);
  if (new Set(ids).size !== ids.length) {
    throw new ReleaseReportValidationError(['canonical_template_invalid']);
  }
  const requirements = template?.requirements;
  if (!Array.isArray(requirements)
    || requirements.length === 0
    || requirements.some((requirement) => !hasExactKeys(requirement, ['id', 'status', 'evidence'])
      || typeof requirement.id !== 'string'
      || requirement.id.length === 0
      || requirement.status !== 'not_run'
      || !Array.isArray(requirement.evidence)
      || requirement.evidence.length !== 0)) {
    throw new ReleaseReportValidationError(['canonical_template_invalid']);
  }
  const requirementIds = requirements.map((requirement) => requirement.id);
  if (new Set(requirementIds).size !== requirementIds.length) {
    throw new ReleaseReportValidationError(['canonical_template_invalid']);
  }
  if (!hasExactKeys(template.artifacts, Object.keys(CANONICAL_ARTIFACT_PATHS))
    || Object.values(template.artifacts).some((value) => value !== null
      && (typeof value !== 'string' || value.trim().length === 0))
    || !Array.isArray(template.blockers)
    || template.blockers.length === 0
    || template.blockers.some((blocker) => typeof blocker !== 'string' || blocker.trim().length === 0)) {
    throw new ReleaseReportValidationError(['canonical_template_invalid']);
  }
  for (const [key, value] of Object.entries(template.artifacts)) {
    if (value !== null && value !== CANONICAL_ARTIFACT_PATHS[key]) {
      throw new ReleaseReportValidationError(['canonical_template_invalid']);
    }
  }
  return Object.freeze({
    rolloutIds: ids,
    requirementIds,
    artifactKeys: Object.keys(CANONICAL_ARTIFACT_PATHS),
    blockers: [...template.blockers],
  });
}

export function readCanonicalEvidenceTrustPolicy(root, expectedCommit) {
  let policy;
  try {
    policy = expectedCommit
      ? parse0912JsonStrict(gitOutput(root, ['show', `${expectedCommit}:${TRUST_POLICY_PATH}`]))
      : readJsonSafely(root, TRUST_POLICY_PATH, 'evidence_trust_policy_unreadable');
  } catch (error) {
    if (error instanceof ReleaseReportValidationError) throw error;
    throw new ReleaseReportValidationError(['evidence_trust_policy_unreadable']);
  }
  const environment = policy?.environment;
  const keyIds = policy?.keyIds;
  const commonValid = hasExactKeys(policy, [
    'schemaVersion',
    'policyId',
    'status',
    'environment',
    'keyIds',
  ])
    && policy.schemaVersion === 1
    && policy.policyId === '0912-evidence-trust'
    && ['configured', 'unconfigured'].includes(policy.status)
    && hasExactKeys(environment, [
      'id',
      'webOrigin',
      'supabaseProjectRef',
      'databaseTlsSpkiSha256',
      'orgId',
      'assemblyId',
      'sessionId',
      'sessionSlug',
    ])
    && environment.id === 'climate-assembly-production'
    && environment.webOrigin === APPROVED_MANUAL_ACCESSIBILITY_ORIGIN
    && environment.supabaseProjectRef === 'pleyuknjnprsckssxvrh'
    && environment.sessionSlug === '0912-deliberation'
    && hasExactKeys(keyIds, ['operator', 'backup', 'restore']);
  const configuredValues = [
    environment?.databaseTlsSpkiSha256,
    environment?.orgId,
    environment?.assemblyId,
    environment?.sessionId,
    keyIds?.operator,
    keyIds?.backup,
    keyIds?.restore,
  ];
  const configuredValid = policy?.status === 'configured'
    && SHA256_PATTERN.test(environment?.databaseTlsSpkiSha256 ?? '')
    && [environment?.orgId, environment?.assemblyId, environment?.sessionId]
      .every((value) => UUID_PATTERN.test(value ?? ''))
    && new Set([environment?.orgId, environment?.assemblyId, environment?.sessionId]).size === 3
    && [keyIds?.operator, keyIds?.backup, keyIds?.restore]
      .every((value) => KEY_ID_PATTERN.test(value ?? ''))
    && new Set([keyIds?.operator, keyIds?.backup, keyIds?.restore]).size === 3;
  const unconfiguredValid = policy?.status === 'unconfigured'
    && configuredValues.every((value) => value === null);
  if (!commonValid || (!configuredValid && !unconfiguredValid)) {
    throw new ReleaseReportValidationError(['evidence_trust_policy_invalid']);
  }
  return Object.freeze(structuredClone(policy));
}

function publicKeyId(value) {
  if (value instanceof KeyObject) {
    if (value.type !== 'public' || value.asymmetricKeyType !== 'ed25519') return null;
    return `ed25519-sha256:${createHash('sha256')
      .update(value.export({ type: 'spki', format: 'der' }))
      .digest('hex')}`;
  }
  if (typeof value !== 'string' && !Buffer.isBuffer(value)) return null;
  const pem = (Buffer.isBuffer(value) ? value.toString('utf8') : value)
    .trim()
    .replaceAll('\r\n', '\n');
  if (!pem.startsWith('-----BEGIN PUBLIC KEY-----\n')
    || !pem.endsWith('\n-----END PUBLIC KEY-----')) return null;
  try {
    const key = createPublicKey(pem);
    if (key.type !== 'public' || key.asymmetricKeyType !== 'ed25519') return null;
    return `ed25519-sha256:${createHash('sha256')
      .update(key.export({ type: 'spki', format: 'der' }))
      .digest('hex')}`;
  } catch {
    return null;
  }
}

function trustedEvidenceKeysMatchPolicy(trustedEvidencePublicKeys, trustPolicy) {
  if (trustPolicy?.status !== 'configured'
    || !hasExactKeys(trustedEvidencePublicKeys, ['operator', 'backup', 'restore'])) return false;
  const ids = Object.fromEntries(Object.entries(trustedEvidencePublicKeys).map(([role, key]) => (
    [role, publicKeyId(key)]
  )));
  return Object.entries(ids).every(([role, keyId]) => keyId === trustPolicy.keyIds[role])
    && new Set(Object.values(ids)).size === 3;
}

function inspectTargetRevision(targetRevision, sourceCommit) {
  if (targetRevision === null) {
    return { valid: true, verified: false, bound: false };
  }
  if (!isPlainObject(targetRevision)) {
    return { valid: false, verified: false, bound: false };
  }
  if (targetRevision.status === 'verified') {
    const valid = hasExactKeys(targetRevision, ['status', 'sourceCommit'])
      && isFullCommit(targetRevision.sourceCommit);
    return {
      valid,
      verified: valid,
      bound: valid && targetRevision.sourceCommit === sourceCommit,
    };
  }
  const valid = hasExactKeys(targetRevision, ['status', 'sourceCommit', 'reason'])
    && targetRevision.status === 'not_verified'
    && targetRevision.sourceCommit === null
    && typeof targetRevision.reason === 'string'
    && targetRevision.reason.trim().length > 0;
  return { valid, verified: false, bound: false };
}

function validateStatusEvidenceItems(items, expectedIds, prefix, errors, evidencePathExists) {
  if (!Array.isArray(items)) {
    errors.push(`${prefix}_array_invalid`);
    return [];
  }

  const ids = items.map((item) => item?.id);
  if (JSON.stringify(ids) !== JSON.stringify(expectedIds)
    || new Set(ids).size !== ids.length) {
    errors.push(`${prefix}_ids_or_order_invalid`);
  }

  const statuses = [];
  for (const item of items) {
    if (!hasExactKeys(item, ['id', 'status', 'evidence'])) {
      errors.push(`${prefix}_item_schema_invalid`);
      continue;
    }
    if (!ITEM_STATUSES.has(item.status)) {
      errors.push(`${prefix}_status_invalid`);
      continue;
    }
    statuses.push(item.status);
    if (item.status === 'not_run') {
      if (item.evidence !== null) errors.push(`${prefix}_not_run_evidence_invalid`);
    } else if (!isNonEmptyEvidence(item.evidence)) {
      errors.push(`${prefix}_evidence_missing`);
    } else {
      validateEvidenceFiles(item.evidence, evidencePathExists, `${prefix}_evidence`, errors);
    }
  }
  return statuses;
}

function validateRequirementItems(items, expectedIds, errors, evidencePathExists) {
  if (!Array.isArray(items)) {
    errors.push('requirement_array_invalid');
    return [];
  }
  const ids = items.map((item) => item?.id);
  if (JSON.stringify(ids) !== JSON.stringify(expectedIds)
    || new Set(ids).size !== ids.length) {
    errors.push('requirement_ids_or_order_invalid');
  }
  const statuses = [];
  for (const item of items) {
    if (!hasExactKeys(item, ['id', 'status', 'evidence']) || !Array.isArray(item.evidence)) {
      errors.push('requirement_item_schema_invalid');
      continue;
    }
    if (!ITEM_STATUSES.has(item.status)) {
      errors.push('requirement_status_invalid');
      continue;
    }
    statuses.push(item.status);
    if (item.status === 'not_run') {
      if (item.evidence.length !== 0) errors.push('requirement_not_run_evidence_invalid');
    } else if (!isNonEmptyEvidence(item.evidence)) {
      errors.push('requirement_evidence_missing');
    } else {
      validateEvidenceFiles(item.evidence, evidencePathExists, 'requirement_evidence', errors);
    }
  }
  return statuses;
}

function validateArtifacts(artifacts, expectedKeys, errors, evidencePathExists) {
  if (!hasExactKeys(artifacts, expectedKeys)) {
    errors.push('artifacts_schema_invalid');
    return false;
  }
  let complete = true;
  for (const [key, value] of Object.entries(artifacts)) {
    if (value === null) {
      complete = false;
      continue;
    }
    if (typeof value !== 'string' || value.trim().length === 0) {
      errors.push('artifact_value_invalid');
      complete = false;
      continue;
    }
    if (value !== CANONICAL_ARTIFACT_PATHS[key]) {
      errors.push('artifact_path_invalid');
      complete = false;
      continue;
    }
    validateEvidenceFiles(value, evidencePathExists, 'artifact', errors);
  }
  return complete;
}

function validateRolloutStatus(rollout, stepStatuses, errors) {
  if (!['pass', 'fail', 'stopped', 'not_run'].includes(rollout?.status)) {
    errors.push('rollout_status_invalid');
    return;
  }
  if (rollout.status === 'pass' && !stepStatuses.every((status) => status === 'pass')) {
    errors.push('rollout_pass_inconsistent');
  }
  if (rollout.status === 'not_run' && !stepStatuses.every((status) => status === 'not_run')) {
    errors.push('rollout_not_run_inconsistent');
  }
  if (rollout.status === 'fail'
    && !stepStatuses.some((status) => status === 'fail' || status === 'blocked')) {
    errors.push('rollout_fail_inconsistent');
  }
  if (rollout.status === 'stopped' && !stepStatuses.includes('stopped')) {
    errors.push('rollout_stopped_inconsistent');
  }
}

/**
 * Validates a completed 9/12 readiness report without returning evidence values.
 */
export function validate0912ReleaseReport({
  report,
  canonicalRolloutIds,
  canonicalRequirementIds,
  canonicalArtifactKeys,
  canonicalBlockers,
  evidencePathExists,
  artifactPayloadsVerified = false,
  expectedCommit,
  expectedTargetRevision,
} = {}) {
  const errors = [];
  if (!isPlainObject(report)) {
    throw new ReleaseReportValidationError(['report_schema_invalid']);
  }
  if (contains0912SensitiveMaterial(report)) {
    throw new ReleaseReportValidationError(['sensitive_material_detected']);
  }
  if (!Array.isArray(canonicalRolloutIds) || canonicalRolloutIds.length === 0) {
    throw new ReleaseReportValidationError(['canonical_rollout_contract_missing']);
  }
  if (!Array.isArray(canonicalRequirementIds) || canonicalRequirementIds.length === 0
    || !Array.isArray(canonicalArtifactKeys) || canonicalArtifactKeys.length === 0
    || !Array.isArray(canonicalBlockers) || canonicalBlockers.length === 0) {
    throw new ReleaseReportValidationError(['canonical_report_contract_missing']);
  }

  if (!hasExactKeys(report, REPORT_FIELDS)) errors.push('report_schema_invalid');
  if (report.schemaVersion !== 1) errors.push('report_schema_version_invalid');
  if (report.reportId !== REPORT_ID) errors.push('report_id_invalid');
  if (report.releaseDecision === 'ready') {
    if (!UUID_PATTERN.test(report.releaseRunId ?? '')) errors.push('release_run_id_invalid');
  } else if (report.releaseRunId !== null && !UUID_PATTERN.test(report.releaseRunId ?? '')) {
    errors.push('non_ready_release_run_id_invalid');
  }
  if (['fail', 'stopped'].includes(report.status) && report.releaseRunId === null) {
    errors.push('executed_release_run_id_missing');
  }
  if (!isValidGeneratedAt(report.generatedAt)) errors.push('generated_at_invalid');
  if (!isFullCommit(report.sourceCommit)) errors.push('source_commit_invalid');
  if (typeof report.sourceTreeClean !== 'boolean') errors.push('source_tree_clean_invalid');

  if (expectedCommit !== undefined && report.sourceCommit !== expectedCommit) {
    errors.push('expected_commit_mismatch');
  }

  const criticalStatuses = validateStatusEvidenceItems(
    report.criticalGates,
    REQUIRED_0912_CRITICAL_GATES,
    'critical_gate',
    errors,
    evidencePathExists,
  );

  const rollout = report.productionRollout;
  if (!hasExactKeys(
    rollout,
    ['status', 'productionMutationRequiresExplicitApproval', 'orderedSteps'],
  )) {
    errors.push('rollout_schema_invalid');
  }
  if (rollout?.productionMutationRequiresExplicitApproval !== true) {
    errors.push('rollout_approval_boundary_invalid');
  }
  const stepStatuses = validateStatusEvidenceItems(
    rollout?.orderedSteps,
    canonicalRolloutIds,
    'rollout_step',
    errors,
    evidencePathExists,
  );
  validateRolloutStatus(rollout, stepStatuses, errors);

  const requirementStatuses = validateRequirementItems(
    report.requirements,
    canonicalRequirementIds,
    errors,
    evidencePathExists,
  );
  const artifactsComplete = validateArtifacts(
    report.artifacts,
    canonicalArtifactKeys,
    errors,
    evidencePathExists,
  );
  if (JSON.stringify(report.blockers) !== JSON.stringify(canonicalBlockers)) {
    errors.push('blockers_contract_invalid');
  }

  const safety = report.safety;
  if (!hasExactKeys(safety, [
    'fixtureClassification',
    'approvedProductionMutationCount',
    'unapprovedProductionMutationCount',
    'syntheticRehearsalProductionMutationCount',
    'capabilityValuesLeakedToDraftQueueOrEvidence',
  ])
    || safety.fixtureClassification !== 'synthetic-no-pii-no-secrets'
    || !(safety.approvedProductionMutationCount === null
      || (Number.isSafeInteger(safety.approvedProductionMutationCount)
        && safety.approvedProductionMutationCount >= 0))
    || !Number.isSafeInteger(safety.unapprovedProductionMutationCount)
    || safety.unapprovedProductionMutationCount < 0
    || !Number.isSafeInteger(safety.syntheticRehearsalProductionMutationCount)
    || safety.syntheticRehearsalProductionMutationCount < 0
    || ![null, true, false].includes(safety.capabilityValuesLeakedToDraftQueueOrEvidence)) {
    errors.push('safety_schema_invalid');
  }

  const target = inspectTargetRevision(report.targetRevision, report.sourceCommit);
  if (!target.valid) errors.push('target_revision_invalid');
  if (target.verified && !target.bound) errors.push('target_revision_source_mismatch');
  if (expectedTargetRevision !== undefined
    && (!target.verified || report.targetRevision.sourceCommit !== expectedTargetRevision)) {
    errors.push('expected_target_revision_mismatch');
  }

  const expectedDecision = REPORT_STATUS_DECISIONS.get(report.status);
  if (expectedDecision === undefined || report.releaseDecision !== expectedDecision) {
    errors.push('status_release_decision_inconsistent');
  }

  const allCriticalGatesPassed = criticalStatuses.length === REQUIRED_0912_CRITICAL_GATES.length
    && criticalStatuses.every((status) => status === 'pass');
  const allRolloutStepsPassed = stepStatuses.length === canonicalRolloutIds.length
    && stepStatuses.every((status) => status === 'pass');
  const allRequirementsPassed = requirementStatuses.length === canonicalRequirementIds.length
    && requirementStatuses.every((status) => status === 'pass');
  const rolloutPassed = rollout?.status === 'pass' && allRolloutStepsPassed;
  const capabilityLeakAbsent = safety?.capabilityValuesLeakedToDraftQueueOrEvidence === false;
  const approvedMutationsRecorded = Number.isSafeInteger(safety?.approvedProductionMutationCount)
    && safety.approvedProductionMutationCount > 0;
  const unapprovedDatabaseUntouched = safety?.unapprovedProductionMutationCount === 0
    && safety?.syntheticRehearsalProductionMutationCount === 0;
  const readyConditions = allCriticalGatesPassed
    && rolloutPassed
    && allRequirementsPassed
    && artifactsComplete
    && artifactPayloadsVerified
    && report.sourceTreeClean === true
    && target.verified
    && target.bound
    && capabilityLeakAbsent
    && approvedMutationsRecorded
    && unapprovedDatabaseUntouched;

  if (report.releaseDecision === 'ready') {
    if (!allCriticalGatesPassed) errors.push('ready_critical_gates_incomplete');
    if (!rolloutPassed) errors.push('ready_rollout_incomplete');
    if (!allRequirementsPassed) errors.push('ready_requirements_incomplete');
    if (!artifactsComplete) errors.push('ready_artifacts_incomplete');
    if (!artifactPayloadsVerified) errors.push('ready_artifact_payloads_unverified');
    if (report.sourceTreeClean !== true) errors.push('ready_source_tree_dirty');
    if (!target.verified || !target.bound) errors.push('ready_target_revision_unverified');
    if (!capabilityLeakAbsent) errors.push('ready_capability_leak_state_invalid');
    if (!approvedMutationsRecorded) errors.push('ready_approved_mutation_record_missing');
    if (!unapprovedDatabaseUntouched) errors.push('ready_unapproved_database_mutation_detected');
  } else if (target.verified) {
    // A negative decision must not carry the same shape used as a positive
    // deployment binding. This prevents downstream consumers from treating a
    // non-ready report as deployment approval by inspecting one field only.
    errors.push('non_ready_target_revision_must_be_unverified');
  }

  const failureStatuses = [...criticalStatuses, ...stepStatuses, ...requirementStatuses];
  const hasExplicitFailure = failureStatuses.some((status) => status === 'fail' || status === 'blocked')
    || rollout?.status === 'fail'
    || report.sourceTreeClean === false
    || safety?.unapprovedProductionMutationCount > 0
    || safety?.syntheticRehearsalProductionMutationCount > 0
    || safety?.capabilityValuesLeakedToDraftQueueOrEvidence === true;
  const hasIncompleteWork = failureStatuses.includes('not_run')
    || safety?.capabilityValuesLeakedToDraftQueueOrEvidence === null
    || !target.verified
    || !artifactsComplete;
  const hasStoppedWork = failureStatuses.includes('stopped') || rollout?.status === 'stopped';

  if (report.status === 'fail' && !hasExplicitFailure) errors.push('fail_status_without_failure');
  if (report.status === 'needs_review' && (!hasIncompleteWork || hasExplicitFailure || hasStoppedWork)) {
    errors.push('needs_review_status_inconsistent');
  }
  if (report.status === 'stopped' && !hasStoppedWork) errors.push('stopped_status_without_stop');
  if (report.status === 'pass' && !readyConditions) errors.push('pass_status_without_readiness');

  if (errors.length > 0) throw new ReleaseReportValidationError(errors);

  const releaseReady = report.status === 'pass'
    && report.releaseDecision === 'ready'
    && readyConditions;
  return Object.freeze({
    schemaVersion: 1,
    validatorId: '0912-release-report-validator',
    valid: true,
    releaseReady,
    reportStatus: report.status,
    releaseDecision: report.releaseDecision,
    targetRevisionVerified: target.verified,
    criticalGateCount: REQUIRED_0912_CRITICAL_GATES.length,
    rolloutStepCount: canonicalRolloutIds.length,
  });
}

function resolveContainedEvidencePath(root, relativePath) {
  if (typeof relativePath !== 'string' || !isSafeRelativePath(relativePath)) return null;
  const absoluteRoot = resolve(root);
  const absolutePath = resolve(absoluteRoot, relativePath);
  const normalizedRoot = absoluteRoot.replaceAll('\\', '/').replace(/\/$/u, '');
  const normalizedPath = absolutePath.replaceAll('\\', '/');
  return normalizedPath.startsWith(`${normalizedRoot}/`) ? absolutePath : null;
}

function readRegularFileAtPath(path, maxBytes) {
  if (typeof path !== 'string'
    || !Number.isSafeInteger(maxBytes)
    || maxBytes <= 0) return null;
  const absolutePath = resolve(path);
  let descriptor;
  try {
    const pathStats = lstatSync(absolutePath, { bigint: true });
    if (pathStats.isSymbolicLink()
      || !pathStats.isFile()
      || pathStats.size <= 0n
      || pathStats.size > BigInt(maxBytes)) return null;
    descriptor = openSync(absolutePath, 'r');
    const openedStats = fstatSync(descriptor, { bigint: true });
    const identityMatches = (candidate) => candidate.dev === pathStats.dev
      && candidate.ino === pathStats.ino
      && candidate.size === pathStats.size
      && candidate.mtimeNs === pathStats.mtimeNs
      && candidate.ctimeNs === pathStats.ctimeNs;
    if (!identityMatches(openedStats)) return null;
    const bytes = readFileSync(descriptor);
    if (!identityMatches(fstatSync(descriptor, { bigint: true }))) return null;
    closeSync(descriptor);
    descriptor = undefined;
    return bytes;
  } catch {
    return null;
  } finally {
    if (descriptor !== undefined) {
      try {
        closeSync(descriptor);
      } catch {
        // The caller receives a fail-closed null without exposing local details.
      }
    }
  }
}

function readRegularEvidenceFile(
  root,
  relativePath,
  maxBytes = MAX_EVIDENCE_FILE_BYTES,
) {
  const absolutePath = resolveContainedEvidencePath(root, relativePath);
  return absolutePath === null ? null : readRegularFileAtPath(absolutePath, maxBytes);
}

function createEvidencePathVerifier(root) {
  const cache = new Map();
  return (relativePath) => {
    if (!ALLOWED_EVIDENCE_PATHS.has(relativePath)) return false;
    if (!cache.has(relativePath)) {
      cache.set(relativePath, readRegularEvidenceFile(root, relativePath) !== null);
    }
    return cache.get(relativePath) === true;
  };
}

function readArtifactJson(root, relativePath) {
  try {
    const bytes = readRegularEvidenceFile(root, relativePath);
    return bytes === null ? null : parse0912JsonBytes(bytes);
  } catch {
    return null;
  }
}

function isCanonicalUtcTimestamp(value) {
  if (typeof value !== 'string' || !CANONICAL_UTC_PATTERN.test(value)) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function canonicalVerifiedAt(value) {
  try {
    const timestamp = value instanceof Date ? value.toISOString() : value;
    return isCanonicalUtcTimestamp(timestamp) ? timestamp : null;
  } catch {
    return null;
  }
}

function validateOperatorReceipt({
  receipt,
  operator,
  kind,
  id,
  record,
  recordedAt,
}) {
  return !contains0912SensitiveMaterial(receipt)
    && hasExactKeys(receipt, [
      'schemaVersion',
      'evidenceType',
      'releaseRunId',
      'sourceCommit',
      'targetRevision',
      'productionEnvironmentId',
      'kind',
      'id',
      'recordedAt',
      'record',
    ])
    && receipt.schemaVersion === 1
    && receipt.evidenceType === `0912-${kind}-${id}-receipt-v1`
    && receipt.releaseRunId === operator.releaseRunId
    && receipt.sourceCommit === operator.sourceCommit
    && receipt.targetRevision === operator.targetRevision
    && receipt.productionEnvironmentId === operator.productionEnvironment?.id
    && receipt.kind === kind
    && receipt.id === id
    && receipt.recordedAt === recordedAt
    && isDeepStrictEqual(receipt.record, record);
}

function readCanonicalOperatorBindingFiles(root) {
  const files = new Map();
  let totalBytes = 0;
  for (const path of CANONICAL_0912_OPERATOR_BINDING_PATHS) {
    const bytes = readRegularEvidenceFile(root, path);
    if (bytes === null) return null;
    totalBytes += bytes.byteLength;
    if (totalBytes > MAX_OPERATOR_BINDING_TOTAL_BYTES) return null;
    files.set(path, bytes);
  }
  return files;
}

function fingerprintOperatorBindingFiles(files) {
  if (!(files instanceof Map)) return null;
  return CANONICAL_0912_OPERATOR_BINDING_PATHS.map((path) => {
    const bytes = files.get(path);
    if (bytes === undefined) return null;
    return `${path}:${bytes.byteLength}:${createHash('sha256').update(bytes).digest('hex')}`;
  });
}

function bindingFingerprintsMatch(left, right) {
  return Array.isArray(left)
    && Array.isArray(right)
    && left.length === right.length
    && left.every((value, index) => value !== null && value === right[index]);
}

function parseBoundArtifactJson(boundFiles, relativePath) {
  try {
    const bytes = boundFiles?.get(relativePath);
    return bytes === undefined ? null : parse0912JsonBytes(bytes);
  } catch {
    return null;
  }
}

function sourceSha256(sourceArtifactReader, path) {
  try {
    return createHash('sha256').update(sourceArtifactReader(path)).digest('hex');
  } catch {
    return null;
  }
}

function hasMatchingLegacyAuditHistory({ legacyHistory, result, config, sourceArtifactReader }) {
  if (!config.historySnapshotPath) return legacyHistory === undefined;
  if (!hasExactKeys(legacyHistory, [
    'snapshotPath',
    'snapshotSha256',
    'algorithm',
    'capturedBeforeAt',
    'capturedAfterAt',
    'attendance',
    'workshop',
  ])
    || legacyHistory.snapshotPath !== config.historySnapshotPath
    || legacyHistory.snapshotSha256 !== sourceSha256(
      sourceArtifactReader,
      config.historySnapshotPath,
    )
    || legacyHistory.algorithm !== 'sha256-canonical-jsonb-v1'
    || !isCanonicalUtcTimestamp(legacyHistory.capturedBeforeAt)
    || !isCanonicalUtcTimestamp(legacyHistory.capturedAfterAt)
    || Date.parse(legacyHistory.capturedBeforeAt) < Date.parse(result.startedAt)
    || Date.parse(legacyHistory.capturedBeforeAt) >= Date.parse(legacyHistory.capturedAfterAt)
    || Date.parse(legacyHistory.capturedAfterAt) > Date.parse(result.completedAt)) {
    return false;
  }
  return ['attendance', 'workshop'].every((historyName) => {
    const history = legacyHistory[historyName];
    return hasExactKeys(history, [
      'rowCountBefore',
      'rowCountAfter',
      'sha256Before',
      'sha256After',
    ])
      && Number.isSafeInteger(history.rowCountBefore)
      && history.rowCountBefore >= 0
      && history.rowCountAfter === history.rowCountBefore
      && SHA256_PATTERN.test(history.sha256Before ?? '')
      && history.sha256After === history.sha256Before;
  });
}

function hasPassingProductionRolloutResult({
  result,
  config,
  operator,
  sourceArtifactReader,
}) {
  const expectedResultKeys = [
    'schemaVersion',
    'evidenceType',
    'rolloutId',
    'releaseRunId',
    'sourceCommit',
    'targetRevision',
    'productionEnvironmentId',
    'mode',
    'approvalId',
    'startedAt',
    'completedAt',
    'migration',
    'verification',
    'productionAccess',
  ];
  if (config.historySnapshotPath) expectedResultKeys.push('legacyHistory');
  if (!hasExactKeys(result, expectedResultKeys)) return false;
  const rollout = operator?.rolloutSteps?.find((entry) => entry?.id === result.rolloutId);
  const access = rollout?.evidence?.productionAccess;
  const approval = operator?.approvals?.find((entry) => entry?.id === result.approvalId);
  const migration = result.migration;
  const verification = result.verification;
  const productionAccess = result.productionAccess;
  const checks = verification?.checks;
  if (!rollout || !access || !approval
    || result.schemaVersion !== 1
    || result.evidenceType !== config.evidenceType
    || result.rolloutId !== config.rolloutId
    || result.releaseRunId !== operator.releaseRunId
    || result.sourceCommit !== operator.sourceCommit
    || result.targetRevision !== operator.targetRevision
    || result.productionEnvironmentId !== operator.productionEnvironment?.id
    || result.mode !== access.mode
    || result.approvalId !== access.approvalId
    || !['approved-db-rollout', 'verified-already-applied'].includes(result.mode)
    || !isCanonicalUtcTimestamp(result.startedAt)
    || !isCanonicalUtcTimestamp(result.completedAt)
    || !isCanonicalUtcTimestamp(rollout.executedAt)
    || !isCanonicalUtcTimestamp(approval.approvedAt)
    || Date.parse(approval.approvedAt) >= Date.parse(result.startedAt)
    || Date.parse(result.startedAt) >= Date.parse(result.completedAt)
    || Date.parse(result.completedAt) > Date.parse(rollout.executedAt)
    || !hasExactKeys(migration, [
      'path',
      'sha256',
      'historyId',
      'historyRowCount',
      'historyChecksumMatched',
    ])
    || migration.path !== config.migrationPath
    || migration.sha256 !== sourceSha256(sourceArtifactReader, config.migrationPath)
    || migration.historyId !== config.historyId
    || migration.historyRowCount !== 1
    || migration.historyChecksumMatched !== true
    || !hasExactKeys(verification, [
      'path',
      'sha256',
      'exitCode',
      'status',
      'checkCount',
      'failedCheckCount',
      'checks',
    ])
    || verification.path !== config.verificationPath
    || verification.sha256 !== sourceSha256(sourceArtifactReader, config.verificationPath)
    || verification.exitCode !== 0
    || verification.status !== 'pass'
    || verification.checkCount !== config.checkIds.length
    || verification.failedCheckCount !== 0
    || !Array.isArray(checks)
    || JSON.stringify(checks.map((check) => check?.id)) !== JSON.stringify(config.checkIds)
    || checks.some((check) => !hasExactKeys(check, ['id', 'status']) || check.status !== 'pass')
    || !hasExactKeys(productionAccess, ['connectionCount', 'mutationCount'])
    || productionAccess.connectionCount !== access.connectionCount
    || productionAccess.mutationCount !== access.mutationCount
    || !Number.isSafeInteger(productionAccess.connectionCount)
    || productionAccess.connectionCount <= 0
    || !Number.isSafeInteger(productionAccess.mutationCount)
    || productionAccess.mutationCount < 0
    || (result.mode === 'approved-db-rollout' && productionAccess.mutationCount <= 0)
    || (result.mode === 'verified-already-applied' && productionAccess.mutationCount !== 0)
    || !hasMatchingLegacyAuditHistory({
      legacyHistory: result.legacyHistory,
      result,
      config,
      sourceArtifactReader,
    })) {
    return false;
  }
  return true;
}

function verifyOperatorArtifactBindings(operator, boundFiles) {
  const bindings = operator?.artifactBindings;
  if (!Array.isArray(bindings)
    || bindings.length !== CANONICAL_0912_OPERATOR_BINDING_PATHS.length
    || !(boundFiles instanceof Map)
    || boundFiles.size !== CANONICAL_0912_OPERATOR_BINDING_PATHS.length) return false;
  const bindingByPath = new Map();
  for (let index = 0; index < CANONICAL_0912_OPERATOR_BINDING_PATHS.length; index += 1) {
    const expectedPath = CANONICAL_0912_OPERATOR_BINDING_PATHS[index];
    const binding = bindings[index];
    if (!hasExactKeys(binding, ['path', 'sha256'])
      || binding.path !== expectedPath
      || !SHA256_PATTERN.test(binding.sha256 ?? '')
      || bindingByPath.has(binding.path)) return false;
    const bytes = boundFiles.get(binding.path);
    if (bytes === undefined
      || createHash('sha256').update(bytes).digest('hex') !== binding.sha256) return false;
    bindingByPath.set(binding.path, bytes);
  }

  for (const path of [
    'evaluation/0912-13-implementation-verification.md',
    'evaluation/0912-13-security-diff-review.md',
  ]) {
    const bytes = bindingByPath.get(path);
    try {
      if (bytes === undefined || contains0912SensitiveMaterial(decodeUtf8Strict(bytes))) return false;
    } catch {
      return false;
    }
  }

  const receiptCoordinates = [
    ...CANONICAL_0912_GATE_IDS.map((id, index) => ({
      kind: 'gate',
      id,
      index,
      record: operator?.gates?.[index],
      recordedAt: operator?.gates?.[index]?.executedAt,
    })),
    ...CANONICAL_0912_ROLLOUT_IDS.map((id, index) => ({
      kind: 'rollout',
      id,
      index,
      record: operator?.rolloutSteps?.[index],
      recordedAt: operator?.rolloutSteps?.[index]?.executedAt,
    })),
    ...CANONICAL_0912_CONTROL_RECEIPT_IDS.map((id, index) => {
      const controlName = CANONICAL_0912_CONTROL_NAMES[index];
      return {
        kind: 'control',
        id,
        index,
        record: operator?.controls?.[controlName],
        recordedAt: operator?.controls?.[controlName]?.checkedAt,
      };
    }),
  ];
  return receiptCoordinates.every((coordinate) => {
    const path = canonical0912OperatorReceiptPath(
      coordinate.kind,
      coordinate.index,
      coordinate.id,
    );
    const bytes = bindingByPath.get(path);
    if (bytes === undefined) return false;
    try {
      return validateOperatorReceipt({
        receipt: parse0912JsonBytes(bytes),
        operator,
        kind: coordinate.kind,
        id: coordinate.id,
        record: coordinate.record,
        recordedAt: coordinate.recordedAt,
      });
    } catch {
      return false;
    }
  });
}

function verifyReleaseEvidenceTimeline({
  report,
  traceability,
  postgres,
  field,
  hq,
  accessibility,
  manual,
  backup,
  restore,
  operator,
  verifiedAt,
}) {
  const verifiedAtIso = canonicalVerifiedAt(verifiedAt);
  if (verifiedAtIso === null) return false;
  const verifiedAtMs = Date.parse(verifiedAtIso);
  const preOperatorTimestamps = [
    traceability?.generatedAt,
    postgres?.generatedAt,
    field?.generatedAt,
    hq?.generatedAt,
    accessibility?.generatedAt,
    manual?.generatedAt,
    backup?.latest?.capturedAt,
    backup?.generatedAt,
    restore?.generatedAt,
  ];
  const evidenceTimestamps = [
    ...preOperatorTimestamps,
    operator?.generatedAt,
    report?.generatedAt,
  ];
  if (evidenceTimestamps.some((timestamp) => !isCanonicalUtcTimestamp(timestamp))) return false;
  if (evidenceTimestamps.some((timestamp) => {
    const value = Date.parse(timestamp);
    return value > verifiedAtMs + MAX_FUTURE_SKEW_MS
      || verifiedAtMs - value > MAX_EVIDENCE_AGE_MS;
  })) return false;
  const operatorGeneratedAt = Date.parse(operator.generatedAt);
  if (preOperatorTimestamps
    .some((timestamp) => Date.parse(timestamp) > operatorGeneratedAt)) return false;
  const testedAtValues = Array.isArray(manual?.cases)
    ? manual.cases.map((entry) => entry?.testedAt)
    : [];
  if (testedAtValues.some((timestamp) => !isCanonicalUtcTimestamp(timestamp)
    || Date.parse(timestamp) > operatorGeneratedAt)) return false;
  const gateTimestampById = new Map(
    Array.isArray(operator?.gates)
      ? operator.gates.map((gate) => [gate?.id, gate?.executedAt])
      : [],
  );
  const producedBeforeGate = (timestamp, gateId) => {
    const gateTimestamp = gateTimestampById.get(gateId);
    return isCanonicalUtcTimestamp(timestamp)
      && isCanonicalUtcTimestamp(gateTimestamp)
      && Date.parse(timestamp) <= Date.parse(gateTimestamp);
  };
  if (![
    [traceability?.generatedAt, 'traceability-report'],
    [postgres?.generatedAt, 'postgres-p1a-p2a-disposable'],
    [field?.generatedAt, 'field-rehearsal'],
    [hq?.generatedAt, 'hq-field-rehearsal'],
    [accessibility?.generatedAt, 'mod-hq-automated-a11y'],
    [manual?.generatedAt, 'mod-hq-manual-a11y'],
    [backup?.attestation?.signedAt, 'backup'],
    [restore?.attestation?.signedAt, 'restore-isolated'],
  ].every(([timestamp, gateId]) => producedBeforeGate(timestamp, gateId))) return false;
  const manualGateTimestamp = gateTimestampById.get('mod-hq-manual-a11y');
  if (testedAtValues.some((timestamp) => (
    Date.parse(timestamp) > Date.parse(manualGateTimestamp)
  ))) return false;
  return isCanonicalUtcTimestamp(backup?.attestation?.signedAt)
    && isCanonicalUtcTimestamp(restore?.attestation?.signedAt)
    && isCanonicalUtcTimestamp(operator?.attestation?.signedAt)
    && Date.parse(restore.attestation.signedAt) <= operatorGeneratedAt
    && Date.parse(operator.attestation.signedAt) <= Date.parse(report.generatedAt)
    && Date.parse(report.generatedAt) <= verifiedAtMs + MAX_FUTURE_SKEW_MS;
}

function verifyBackupArchiveBytes(path, backup, restore) {
  if (typeof path !== 'string' || path.trim().length === 0) return false;
  let descriptor;
  try {
    const stats = lstatSync(resolve(path), { bigint: true });
    if (stats.isSymbolicLink() || !stats.isFile() || stats.size <= 0n
      || stats.size > BigInt(Number.MAX_SAFE_INTEGER)) return false;
    const expectedSize = backup?.snapshot?.archiveSizeBytes;
    if (!Number.isSafeInteger(expectedSize)
      || expectedSize <= 0
      || expectedSize > MAX_BACKUP_ARCHIVE_BYTES
      || stats.size !== BigInt(expectedSize)
      || restore?.snapshot?.archiveSizeBytes !== expectedSize) return false;
    const hash = createHash('sha256');
    const archiveBytes = Buffer.allocUnsafe(expectedSize);
    descriptor = openSync(resolve(path), 'r');
    const openedStats = fstatSync(descriptor, { bigint: true });
    const identityMatches = (candidate) => candidate.dev === stats.dev
      && candidate.ino === stats.ino
      && candidate.size === stats.size
      && candidate.mtimeNs === stats.mtimeNs
      && candidate.ctimeNs === stats.ctimeNs;
    if (!identityMatches(openedStats)) return false;
    let offset = 0;
    while (offset < expectedSize) {
      const bytesRead = readSync(
        descriptor,
        archiveBytes,
        offset,
        Math.min(1024 * 1024, expectedSize - offset),
        offset,
      );
      if (bytesRead <= 0) return false;
      hash.update(archiveBytes.subarray(offset, offset + bytesRead));
      offset += bytesRead;
    }
    if (!identityMatches(fstatSync(descriptor, { bigint: true }))) return false;
    const digest = hash.digest('hex');
    closeSync(descriptor);
    descriptor = undefined;
    let archive;
    try {
      archive = parse0912JsonBytes(archiveBytes);
    } catch {
      return false;
    }
    const audit = archive?.audit;
    const integrity = audit?.integrity;
    if (!isPlainObject(archive)
      || !hasExactKeys(audit, [
        'schemaVersion',
        'event',
        'exportedAt',
        'repository',
        'runId',
        'commitSha',
        'workflowRef',
        'keyId',
        'snapshotId',
        'integrity',
      ])
      || !hasExactKeys(integrity, ['algorithm', 'target', 'digest'])
      || archive?.platform?.id !== audit.snapshotId
      || archive?.platform?.source !== 'platform'
      || !SHA256_PATTERN.test(integrity.digest ?? '')) return false;
    const normalizedAudit = {
      schemaVersion: audit.schemaVersion,
      event: audit.event,
      exportedAt: audit.exportedAt,
      repository: audit.repository,
      runId: audit.runId,
      commitSha: audit.commitSha,
      workflowRef: audit.workflowRef,
      keyId: audit.keyId,
      snapshotId: audit.snapshotId,
      integrityAlgorithm: integrity.algorithm,
      integrityTarget: integrity.target,
    };
    return digest === backup?.snapshot?.archiveSha256
      && digest === restore?.snapshot?.archiveSha256
      && isDeepStrictEqual(normalizedAudit, backup?.snapshot?.archiveAudit)
      && isDeepStrictEqual(normalizedAudit, restore?.snapshot?.archiveAudit);
  } catch {
    return false;
  } finally {
    if (descriptor !== undefined) {
      try {
        closeSync(descriptor);
      } catch {
        // The primary read/validation error remains the fail-closed result.
      }
    }
  }
}

function backupKstStamp(capturedAt) {
  const kst = new Date(Date.parse(capturedAt) + (9 * 60 * 60 * 1000));
  return kst.toISOString().slice(0, 19).replace('T', '_').replaceAll(':', '');
}

export function verify0912LatestBackupBytes(path, backup) {
  if (typeof path !== 'string' || path.trim().length === 0) return false;
  const bytes = readRegularFileAtPath(resolve(path), MAX_EVIDENCE_FILE_BYTES);
  if (bytes === null
    || createHash('sha256').update(bytes).digest('hex') !== backup?.latest?.checksumSha256) {
    return false;
  }
  try {
    const latest = parse0912JsonBytes(bytes);
    const counts = latest?.counts;
    if (!hasExactKeys(latest, [
      'schema',
      'session',
      'captured_at',
      'captured_at_kst',
      'captured_by',
      'counts',
      'submissions',
      'teams',
      'attendance_summary',
      'checksum',
    ])
      || latest.schema !== 'climate-0829-backup/1'
      || latest.session !== backup?.snapshot?.session
      || !isCanonicalUtcTimestamp(latest.captured_at)
      || latest.captured_at !== backup?.latest?.capturedAt
      || latest.captured_at_kst !== backupKstStamp(latest.captured_at)
      || !isNonEmptyString(latest.captured_by)
      || !hasExactKeys(counts, ['rows', 'items', 'teams_with_items', 'finalized'])
      || !Object.values(counts).every(isNonNegativeInteger)
      || counts.teams_with_items !== backup?.latest?.teamCount
      || counts.items !== backup?.latest?.itemCount
      || counts.finalized !== backup?.latest?.finalizedSubmissionCount
      || !Array.isArray(latest.submissions)
      || !Array.isArray(latest.teams)
      || !Array.isArray(latest.attendance_summary)
      || !/^sha256:[0-9a-f]{64}$/u.test(latest.checksum ?? '')) return false;
    if (!latest.submissions.every(isPlainObject)) return false;
    const submissionsWithItems = latest.submissions.filter(
      (submission) => submission.item_content !== null && submission.item_content !== undefined,
    );
    const computedCounts = {
      rows: latest.submissions.length,
      items: submissionsWithItems.length,
      teams_with_items: new Set(
        submissionsWithItems.map((submission) => submission.team_id),
      ).size,
      finalized: new Set(
        latest.submissions
          .filter((submission) => submission.submission_status === 'final')
          .map((submission) => submission.submission_id),
      ).size,
    };
    if (Object.entries(computedCounts).some(([key, value]) => counts[key] !== value)) {
      return false;
    }
    const unsigned = {
      ...latest,
      captured_at: undefined,
      captured_at_kst: undefined,
      checksum: undefined,
    };
    return latest.checksum === `sha256:${createHash('sha256')
      .update(JSON.stringify(unsigned, null, 0))
      .digest('hex')}`;
  } catch {
    return false;
  }
}

function isNonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0;
}

function isPositiveNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isEmptyArray(value) {
  return Array.isArray(value) && value.length === 0;
}

function isSafeRelativePath(value) {
  return isNonEmptyString(value)
    && !value.includes('\\')
    && !value.startsWith('/')
    && !value.includes(':')
    && value.split('/').every((segment) => segment.length > 0 && segment !== '..');
}

function isLoopbackBaseUrl(value) {
  if (!isNonEmptyString(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'http:'
      && url.hostname === '127.0.0.1'
      && url.port.length > 0
      && url.username === ''
      && url.password === ''
      && url.pathname === '/'
      && url.search === ''
      && url.hash === '';
  } catch {
    return false;
  }
}

function hasExactOrderedPassingChecks(checks, expectedIds, expectedKeys, validateEvidence) {
  if (!Array.isArray(checks) || checks.length !== expectedIds.length) return false;
  const ids = checks.map((check) => check?.id);
  if (JSON.stringify(ids) !== JSON.stringify(expectedIds) || new Set(ids).size !== ids.length) {
    return false;
  }
  return checks.every((check) => hasExactKeys(check, expectedKeys)
    && check.status === 'pass'
    && validateEvidence(check));
}

export function hasPassingTraceabilityEvidence(payload) {
  if (contains0912SensitiveMaterial(payload)) return false;
  return hasExactKeys(payload, [
    'schemaVersion',
    'reportId',
    'generatedAt',
    'sourceCommit',
    'sourceTreeClean',
    'status',
    'safety',
    'summary',
    'checks',
    'errors',
  ])
    && payload.schemaVersion === 1
    && payload.reportId === '0912-13-traceability-verification'
    && isValidGeneratedAt(payload.generatedAt)
    && isFullCommit(payload.sourceCommit)
    && payload.sourceTreeClean === true
    && payload.status === 'pass'
    && hasExactKeys(payload.safety, ['liveDatabaseMutationCount', 'networkRequestCount'])
    && payload.safety.liveDatabaseMutationCount === 0
    && payload.safety.networkRequestCount === 0
    && hasExactKeys(payload.summary, ['requirementCount', 'checkCount', 'passCount', 'failCount'])
    && payload.summary.requirementCount === 14
    && payload.summary.checkCount === TRACEABILITY_CHECK_IDS.length
    && payload.summary.passCount === TRACEABILITY_CHECK_IDS.length
    && payload.summary.failCount === 0
    && hasExactOrderedPassingChecks(
      payload.checks,
      TRACEABILITY_CHECK_IDS,
      ['id', 'status', 'evidence'],
      (check) => isPlainObject(check.evidence) && Object.keys(check.evidence).length > 0,
    )
    && isEmptyArray(payload.errors);
}

const POSTGRES_DRIVER_PATHS = Object.freeze([
  'automation/tests/fixtures/0912-p1a-driver.sql',
  'automation/tests/fixtures/0912-p1a-activation-driver.sql',
  'automation/tests/fixtures/0912-seed-cli-prelude.sql',
]);

/** Recompute the producer's complete target set from the approved source tree. */
export function derive0912PostgresTargetPaths(root = PROJECT_ROOT, sourceCommit) {
  const readSourceText = (path) => sourceCommit === undefined
    ? readFileSync(resolve(root, path), 'utf8')
    : decodeUtf8Strict(readCommittedFile(root, sourceCommit, path));
  const sourcePathExists = (path) => {
    if (sourceCommit === undefined) return existsSync(resolve(root, path));
    try {
      readCommittedFile(root, sourceCommit, path);
      return true;
    } catch {
      return false;
    }
  };
  const scriptText = readSourceText('scripts/verify-0912-postgres.sh');
  const explicitBlock = scriptText.match(/target_files=\(\r?\n(?<body>[\s\S]*?)\r?\n\)/u)?.groups?.body;
  if (typeof explicitBlock !== 'string') {
    throw new Error('postgres_target_manifest_contract_unreadable');
  }
  const paths = [...explicitBlock.matchAll(/^\s*"(?<path>[^"]+)"\s*$/gmu)]
    .map((match) => match.groups?.path)
    .filter((path) => typeof path === 'string');
  if (paths.length === 0) throw new Error('postgres_target_manifest_contract_empty');

  const migrationPaths = sourceCommit === undefined
    ? readdirSync(resolve(root, 'supabase/migrations')).map((name) => `supabase/migrations/${name}`)
    : gitOutput(root, [
      'ls-tree',
      '-r',
      '--name-only',
      sourceCommit,
      '--',
      'supabase/migrations',
    ]).split(/\r?\n/u).filter(Boolean);
  for (const path of migrationPaths) {
    if (/^supabase\/migrations\/platform_p.*\.sql$/u.test(path)) paths.push(path);
  }
  for (const driverPath of POSTGRES_DRIVER_PATHS) {
    const driverText = readSourceText(driverPath);
    for (const match of driverText.matchAll(/^\s*\\i\s+\/tmp\/(?<name>\S+)\s*$/gmu)) {
      const name = match.groups?.name;
      if (typeof name !== 'string') continue;
      const candidates = [
        `supabase/migrations/${name}`,
        `supabase/verify/${name}`,
        `automation/tests/fixtures/${name}`,
      ];
      const candidate = candidates.find((path) => sourcePathExists(path));
      if (candidate !== undefined) paths.push(candidate);
    }
  }
  const normalized = [...new Set(paths.map((path) => path.replaceAll('\\', '/')))].sort();
  if (normalized.some((path) => !isSafeRelativePath(path))) {
    throw new Error('postgres_target_manifest_contract_unsafe');
  }
  return Object.freeze(normalized);
}

export function hasPassingPostgresEvidence(payload, expectedManifestPaths) {
  if (contains0912SensitiveMaterial(payload)) return false;
  const manifest = payload?.targetManifest;
  let canonicalPaths = expectedManifestPaths;
  if (canonicalPaths === undefined) {
    try {
      canonicalPaths = derive0912PostgresTargetPaths();
    } catch {
      return false;
    }
  }
  if (!Array.isArray(canonicalPaths)
    || !Array.isArray(manifest)
    || manifest.length !== canonicalPaths.length) return false;
  const paths = manifest.map((entry) => entry?.path);
  const sortedPaths = [...paths].sort();
  const manifestContractSatisfied = manifest.every((entry) => hasExactKeys(entry, ['path', 'sha256'])
      && isSafeRelativePath(entry.path)
      && SHA256_PATTERN.test(entry.sha256))
    && new Set(paths).size === paths.length
    && JSON.stringify(paths) === JSON.stringify(sortedPaths)
    && JSON.stringify(paths) === JSON.stringify(canonicalPaths)
    && createHash('sha256').update(JSON.stringify(manifest)).digest('hex') === payload?.targetManifestSha256;

  return hasExactKeys(payload, POSTGRES_REPORT_FIELDS)
    && payload.schemaVersion === 1
    && payload.reportId === '0912-p1a-p2a-postgres-verification'
    && isValidGeneratedAt(payload.generatedAt)
    && isFullCommit(payload.sourceCommit)
    && payload.sourceTreeClean === true
    && payload.releaseMode === true
    && payload.status === 'pass'
    && payload.database === 'disposable-postgres-16'
    && payload.checkFunctionBodies === true
    && POSTGRES_PASSED_FIELDS.every((field) => payload[field] === 'passed')
    && payload.rollbackWithActivity === 'refused'
    && payload.seedCliCapabilityValuesLogged === 0
    && payload.seedCliHostTemporaryFileMode === '0600'
    && payload.seedCliHostTemporaryFileRemovedBeforeExecution === true
    && payload.seedCliContainerCopyRemovedWithCreatedContainer === true
    && payload.targetManifestCount === manifest.length
    && SHA256_PATTERN.test(payload.targetManifestSha256)
    && payload.targetManifestVerifiedAtCompletion === true
    && manifestContractSatisfied
    && hasExactKeys(payload.safety, ['productionDatabaseConnectionCount', 'productionMutationCount'])
    && payload.safety.productionDatabaseConnectionCount === 0
    && payload.safety.productionMutationCount === 0
    && isPositiveNumber(payload.elapsedSeconds);
}

function hasSourceBoundArtifactFiles({ postgres, field, hq, readSourceArtifact }) {
  if (typeof readSourceArtifact !== 'function') return false;
  try {
    const sourceSha256 = (path) => createHash('sha256')
      .update(readSourceArtifact(path))
      .digest('hex');
    return postgres.targetManifest.every((entry) => sourceSha256(entry.path) === entry.sha256)
      && sourceSha256(field.fixture) === field.fixtureSha256
      && sourceSha256(hq.fixture) === hq.fixtureSha256;
  } catch {
    return false;
  }
}

function hasSignedRequirementDependencies(report, operatorLogPath, operator) {
  if (!Array.isArray(report?.requirements)
    || !Array.isArray(operator?.gates)
    || !isPlainObject(operator?.controls)) return false;
  const gateById = new Map(operator.gates.map((gate) => [gate?.id, gate]));
  return report.requirements.every((requirement) => {
    const dependencies = REQUIREMENT_SIGNED_DEPENDENCIES[requirement?.id];
    const signedSafetySatisfied = requirement?.id !== 'OPS-ZERO-LIVE-MUTATION'
      || (operator.safety?.unapprovedProductionMutationCount === 0
        && operator.safety?.syntheticRehearsalProductionMutationCount === 0
        && operator.safety?.capabilityValuesLeakedToDraftQueueOrEvidence === false);
    return dependencies !== undefined
      && requirement.status === 'pass'
      && isDeepStrictEqual(requirement.evidence, [operatorLogPath])
      && dependencies.gates.every((id) => gateById.get(id)?.status === 'pass')
      && dependencies.controls.every((name) => operator.controls[name]?.status === 'pass')
      && signedSafetySatisfied;
  });
}

function hasSignedOperatorReportBindings(report, operatorLogPath, operator) {
  return Array.isArray(report?.criticalGates)
    && JSON.stringify(report.criticalGates.map((gate) => gate?.id))
      === JSON.stringify(CANONICAL_0912_GATE_IDS)
    && report.criticalGates.every((gate) => gate.status === 'pass'
      && gate.evidence === operatorLogPath)
    && Array.isArray(report?.productionRollout?.orderedSteps)
    && JSON.stringify(report.productionRollout.orderedSteps.map((step) => step?.id))
      === JSON.stringify(CANONICAL_0912_ROLLOUT_IDS)
    && report.productionRollout.orderedSteps.every((step) => step.status === 'pass'
      && step.evidence === operatorLogPath)
    && Object.keys(REQUIREMENT_SIGNED_DEPENDENCIES).length === report.requirements?.length
    && hasSignedRequirementDependencies(report, operatorLogPath, operator);
}

function recomputeTraceabilityEvidence(root, traceability) {
  const recomputed = verify0912Readiness({
    root,
    generatedAt: new Date(traceability.generatedAt),
    sourceReader: (relativePath) => readCommittedFile(
      root,
      traceability.sourceCommit,
      relativePath,
    ),
    sourceCommit: traceability.sourceCommit,
    sourceTreeClean: true,
  });
  return recomputed.schemaVersion === traceability.schemaVersion
    && recomputed.reportId === traceability.reportId
    && recomputed.sourceCommit === traceability.sourceCommit
    && recomputed.status === traceability.status
    && JSON.stringify(recomputed.safety) === JSON.stringify(traceability.safety)
    && JSON.stringify(recomputed.summary) === JSON.stringify(traceability.summary)
    && JSON.stringify(recomputed.checks) === JSON.stringify(traceability.checks)
    && JSON.stringify(recomputed.errors) === JSON.stringify(traceability.errors);
}

export function hasPassingFieldRehearsalEvidence(payload) {
  if (contains0912SensitiveMaterial(payload)) return false;
  const summary = payload?.summary;
  const safety = payload?.safety;
  const leakScan = safety?.capabilityLeakScan;
  const network = payload?.networkContract;
  const webSocket = network?.webSocket;
  const fixtureIdentity = payload?.fixtureIdentity;

  return hasExactKeys(payload, [
    'schemaVersion',
    'rehearsalId',
    'generatedAt',
    'elapsedMs',
    'sourceCommit',
    'sourceTreeClean',
    'target',
    'fixture',
    'fixtureSha256',
    'fixtureIdentity',
    'observedConfiguration',
    'status',
    'summary',
    'safety',
    'networkContract',
    'checks',
    'findings',
    'screenshots',
  ])
    && payload.schemaVersion === 1
    && payload.rehearsalId === '0912-13-field-rehearsal'
    && isValidGeneratedAt(payload.generatedAt)
    && isPositiveNumber(payload.elapsedMs)
    && isFullCommit(payload.sourceCommit)
    && payload.sourceTreeClean === true
    && hasExactKeys(payload.target, ['baseUrl', 'route'])
    && isLoopbackBaseUrl(payload.target.baseUrl)
    && payload.target.route === '/mod?code=[redacted]'
    && payload.fixture === 'automation/fixtures/0912-rehearsal.json'
    && SHA256_PATTERN.test(payload.fixtureSha256)
    && hasExactKeys(fixtureIdentity, ['schemaVersion', 'fixtureId', 'classification'])
    && fixtureIdentity.schemaVersion === 1
    && fixtureIdentity.fixtureId === '0912-field-rehearsal-v1'
    && fixtureIdentity.classification === 'synthetic-no-pii-no-secrets'
    && hasExactKeys(payload.observedConfiguration, ['fixtureId', 'session', 'team', 'topics', 'rpcAllowlist', 'flow'])
    && payload.observedConfiguration.fixtureId === fixtureIdentity.fixtureId
    && payload.status === 'pass'
    && hasExactKeys(summary, ['checkCount', 'passCount', 'failCount'])
    && summary.checkCount === FIELD_REHEARSAL_CHECK_IDS.length
    && summary.passCount === FIELD_REHEARSAL_CHECK_IDS.length
    && summary.failCount === 0
    && hasExactKeys(safety, [
      'liveNetworkRequestCount',
      'liveDatabaseMutationCount',
      'capabilityValuesLeakedToDraftQueueOrEvidence',
      'capabilityLeakScan',
    ])
    && safety.liveNetworkRequestCount === 0
    && safety.liveDatabaseMutationCount === 0
    && safety.capabilityValuesLeakedToDraftQueueOrEvidence === false
    && hasExactKeys(leakScan, ['draftQueueEntryCount', 'draftQueueMatchCount', 'evidenceMatchCount'])
    && isNonNegativeInteger(leakScan.draftQueueEntryCount)
    && leakScan.draftQueueMatchCount === 0
    && leakScan.evidenceMatchCount === 0
    && hasExactKeys(network, [
      'codeRemovedBeforeExchange',
      'workshopSessionPersisted',
      'codeExchangeCount',
      'tokenResumeCount',
      'legacyJoinCodeRpcCount',
      'tokenContractViolationCount',
      'unexpectedRpcRequestCount',
      'unexpectedRpcNames',
      'fixtureMutationRequestCount',
      'escapedExternalRequestCount',
      'escapedExternalOrigins',
      'queueSchemaVersion',
      'occRequestCount',
      'webSocket',
    ])
    && network.codeRemovedBeforeExchange === true
    && network.workshopSessionPersisted === true
    && network.codeExchangeCount === 1
    && isPositiveNumber(network.tokenResumeCount)
    && network.legacyJoinCodeRpcCount === 0
    && network.tokenContractViolationCount === 0
    && network.unexpectedRpcRequestCount === 0
    && isEmptyArray(network.unexpectedRpcNames)
    && isPositiveNumber(network.fixtureMutationRequestCount)
    && network.escapedExternalRequestCount === 0
    && isEmptyArray(network.escapedExternalOrigins)
    && network.queueSchemaVersion === 2
    && isPositiveNumber(network.occRequestCount)
    && hasExactKeys(webSocket, [
      'stubbed',
      'stubConnectionAttemptCount',
      'actualNetworkConnectionCount',
      'blockedExternalConnectionAttemptCount',
      'blockedExternalOrigins',
    ])
    && webSocket.stubbed === true
    && webSocket.stubConnectionAttemptCount === 0
    && webSocket.actualNetworkConnectionCount === 0
    && webSocket.blockedExternalConnectionAttemptCount === 0
    && isEmptyArray(webSocket.blockedExternalOrigins)
    && hasExactOrderedPassingChecks(
      payload.checks,
      FIELD_REHEARSAL_CHECK_IDS,
      ['id', 'title', 'status', 'expected', 'observed'],
      (check) => isNonEmptyString(check.title)
        && isNonEmptyString(check.expected)
        && isNonEmptyString(check.observed),
    )
    && isEmptyArray(payload.findings)
    && payload.screenshots === '.tmp-verify/rehearsal-*.png';
}

function hasPassingHqRpcContracts(rpcContracts) {
  if (!hasExactKeys(rpcContracts, [
    'hq_submission_category_assign_v3',
    'hq_submission_kind_assign_v3',
    'hq_clear_submissions_v3',
    'workshop_hq_logout_v2',
  ])) return false;

  const assignmentFields = [
    'p_token',
    'p_session_slug',
    'p_submission_id',
    'p_item_ordinal',
  ];
  for (const [rpcName, assignmentField] of [
    ['hq_submission_category_assign_v3', 'p_category'],
    ['hq_submission_kind_assign_v3', 'p_kind'],
  ]) {
    const contract = rpcContracts[rpcName];
    if (!hasExactKeys(contract, [
      'effect',
      'requestFields',
      'responseStatuses',
      'stableIdempotencyForExactRetry',
      'compareAndSetFields',
    ])
      || contract.effect !== 'fixture-mutation'
      || JSON.stringify(contract.requestFields) !== JSON.stringify([
        ...assignmentFields,
        assignmentField,
        'p_expected_submission_updated_at',
        'p_expected_event_id',
        'p_idempotency_key',
      ])
      || JSON.stringify(contract.responseStatuses) !== JSON.stringify(['applied', 'conflict'])
      || contract.stableIdempotencyForExactRetry !== true
      || JSON.stringify(contract.compareAndSetFields)
        !== JSON.stringify(['p_expected_submission_updated_at', 'p_expected_event_id'])) return false;
  }

  const clear = rpcContracts.hq_clear_submissions_v3;
  const logout = rpcContracts.workshop_hq_logout_v2;
  return hasExactKeys(clear, ['effect', 'requestFields', 'responseStatuses', 'exactSetField'])
    && clear.effect === 'fixture-mutation'
    && JSON.stringify(clear.requestFields) === JSON.stringify([
      'p_token',
      'p_session_slug',
      'p_confirm',
      'p_expected_submissions',
      'p_idempotency_key',
    ])
    && JSON.stringify(clear.responseStatuses) === JSON.stringify(['applied', 'conflict'])
    && clear.exactSetField === 'p_expected_submissions'
    && hasExactKeys(logout, ['effect', 'requestFields', 'successResponse', 'failureKeepsLocalCapability'])
    && logout.effect === 'fixture-mutation'
    && JSON.stringify(logout.requestFields) === JSON.stringify(['p_token'])
    && logout.successResponse === 'true'
    && logout.failureKeepsLocalCapability === true;
}

export function hasPassingHqRehearsalEvidence(payload) {
  if (contains0912SensitiveMaterial(payload)) return false;
  const summary = payload?.summary;
  const safety = payload?.safety;
  const webSocket = safety?.webSocket;
  const identity = payload?.fixtureIdentity;
  const boundary = payload?.evidenceBoundary;
  const namedSession = payload?.namedHqSession;
  const observations = payload?.observations;

  return hasExactKeys(payload, [
    'schemaVersion',
    'rehearsalId',
    'generatedAt',
    'elapsedMs',
    'sourceCommit',
    'sourceTreeClean',
    'status',
    'target',
    'fixture',
    'fixtureSha256',
    'fixtureIdentity',
    'evidenceBoundary',
    'summary',
    'safety',
    'namedHqSession',
    'rpcContracts',
    'observations',
    'checks',
    'findings',
  ])
    && payload.schemaVersion === 1
    && payload.rehearsalId === '0912-13-hq-v3-browser-rehearsal'
    && isValidGeneratedAt(payload.generatedAt)
    && isPositiveNumber(payload.elapsedMs)
    && isFullCommit(payload.sourceCommit)
    && payload.sourceTreeClean === true
    && payload.status === 'pass'
    && hasExactKeys(payload.target, ['baseUrl', 'route'])
    && isLoopbackBaseUrl(payload.target.baseUrl)
    && payload.target.route === '/hq?ops=1'
    && payload.fixture === 'automation/fixtures/0912-hq-rehearsal.json'
    && SHA256_PATTERN.test(payload.fixtureSha256)
    && hasExactKeys(identity, ['schemaVersion', 'fixtureId', 'classification'])
    && identity.schemaVersion === 1
    && identity.fixtureId === '0912-hq-v3-rehearsal-v1'
    && identity.classification === 'synthetic-no-pii-no-secrets'
    && hasExactKeys(boundary, [
      'evidenceClass',
      'databaseAuthorizationOrLifecycleEvidence',
      'canonicalDatabaseVerifier',
      'statement',
    ])
    && boundary.evidenceClass === 'ui-fixture-only'
    && boundary.databaseAuthorizationOrLifecycleEvidence === false
    && boundary.canonicalDatabaseVerifier === 'scripts/verify-0912-postgres.sh'
    && isNonEmptyString(boundary.statement)
    && hasExactKeys(summary, ['checkCount', 'passCount', 'failCount'])
    && summary.checkCount === HQ_REHEARSAL_CHECK_IDS.length
    && summary.passCount === HQ_REHEARSAL_CHECK_IDS.length
    && summary.failCount === 0
    && hasExactKeys(safety, [
      'allSupabaseHttpIntercepted',
      'interceptedSupabaseHttpRequestCount',
      'forwardedSupabaseHttpRequestCount',
      'blockedUnexpectedSupabaseHttpRequestCount',
      'blockedUnexpectedSupabaseRpcNames',
      'blockedExternalHttpRequestCount',
      'fixtureReadRequestCount',
      'fixtureMutationRequestCount',
      'productionDatabaseMutationCount',
      'contractViolationCount',
      'contractViolations',
      'webSocket',
      'screenshotsWritten',
      'runtimeCapabilityMaterialDetectedBeforeWrite',
      'runtimeCapabilityMaterialInWrittenReport',
    ])
    && safety.allSupabaseHttpIntercepted === true
    && isPositiveNumber(safety.interceptedSupabaseHttpRequestCount)
    && safety.forwardedSupabaseHttpRequestCount === 0
    && safety.blockedUnexpectedSupabaseHttpRequestCount === 0
    && isEmptyArray(safety.blockedUnexpectedSupabaseRpcNames)
    && safety.blockedExternalHttpRequestCount === 0
    && isPositiveNumber(safety.fixtureReadRequestCount)
    && isPositiveNumber(safety.fixtureMutationRequestCount)
    && safety.productionDatabaseMutationCount === 0
    && safety.contractViolationCount === 0
    && isEmptyArray(safety.contractViolations)
    && hasExactKeys(webSocket, ['stubbed', 'attemptCount', 'actualConnectionCount'])
    && webSocket.stubbed === true
    && webSocket.attemptCount === 0
    && webSocket.actualConnectionCount === 0
    && safety.screenshotsWritten === 0
    && safety.runtimeCapabilityMaterialDetectedBeforeWrite === false
    && safety.runtimeCapabilityMaterialInWrittenReport === false
    && hasExactKeys(namedSession, [
      'injected',
      'actorLabel',
      'capabilitySource',
      'capabilityPersistedAfterLogoutFailure',
      'capabilityClearedAfterLogoutSuccess',
    ])
    && namedSession.injected === true
    && isNonEmptyString(namedSession.actorLabel)
    && namedSession.capabilitySource === 'runtime-generated'
    && namedSession.capabilityPersistedAfterLogoutFailure === true
    && namedSession.capabilityClearedAfterLogoutSuccess === true
    && hasPassingHqRpcContracts(payload.rpcContracts)
    && hasExactKeys(observations, [
      'rpcCallCounts',
      'categoryRetry',
      'kindRetry',
      'staleConflictReloaded',
      'exactSetClearConflictPreservedRows',
      'logoutFailurePreservedCapability',
      'logoutSuccessClearedCapability',
    ])
    && isPlainObject(observations.rpcCallCounts)
    && Object.values(observations.rpcCallCounts).every(isPositiveNumber)
    && observations.categoryRetry?.exactRequestRetried === true
    && observations.categoryRetry?.stableIdempotencyKey === true
    && observations.categoryRetry?.stableExpectedEventId === true
    && observations.categoryRetry?.stableExpectedSubmissionUpdatedAt === true
    && observations.kindRetry?.exactRequestRetried === true
    && observations.kindRetry?.stableIdempotencyKey === true
    && observations.kindRetry?.stableExpectedEventId === true
    && observations.kindRetry?.stableExpectedSubmissionUpdatedAt === true
    && observations.staleConflictReloaded === true
    && observations.exactSetClearConflictPreservedRows === true
    && observations.logoutFailurePreservedCapability === true
    && observations.logoutSuccessClearedCapability === true
    && hasExactOrderedPassingChecks(
      payload.checks,
      HQ_REHEARSAL_CHECK_IDS,
      ['id', 'label', 'status', 'observed'],
      (check) => isNonEmptyString(check.label)
        && isPlainObject(check.observed)
        && Object.keys(check.observed).length > 0,
    )
    && isEmptyArray(payload.findings);
}

export function hasPassingAutomatedAccessibilityEvidence(
  payload,
  expectedRoutePaths = CANONICAL_ACCESSIBILITY_ROUTE_PATHS,
) {
  if (contains0912SensitiveMaterial(payload)) return false;
  const summary = payload?.summary;
  const coverage = payload?.coverage;
  const excluded = payload?.coverage?.excluded;
  const routes = payload?.routes;
  if (!Array.isArray(excluded) || !Array.isArray(routes)) return false;

  const exclusionContractSatisfied = payload?.status === 'pass'
    ? excluded.length === 0
    : payload?.status === 'needs_review'
      && excluded.length === 1
      && excluded[0]?.id === MANUAL_ACCESSIBILITY_EXCLUSION_ID;

  const profileContractSatisfied = Array.isArray(coverage?.profiles)
    && coverage.profiles.length === 2
    && hasExactKeys(coverage.profiles[0], ['id', 'viewport'])
    && coverage.profiles[0].id === 'desktop'
    && hasExactKeys(coverage.profiles[0].viewport, ['width', 'height'])
    && coverage.profiles[0].viewport.width === 1440
    && coverage.profiles[0].viewport.height === 1000
    && hasExactKeys(coverage.profiles[1], ['id', 'viewport', 'minimumContentWidth'])
    && coverage.profiles[1].id === 'mobile'
    && hasExactKeys(coverage.profiles[1].viewport, ['width', 'height'])
    && coverage.profiles[1].viewport.width === 360
    && coverage.profiles[1].viewport.height === 800
    && coverage.profiles[1].minimumContentWidth === 280;
  const audited = coverage?.audited;
  const canonicalRouteIds = isPlainObject(expectedRoutePaths)
    ? Object.keys(expectedRoutePaths)
    : [];
  const canonicalAuditIds = canonicalRouteIds.flatMap((routeId) => (
    CANONICAL_ACCESSIBILITY_PROFILES.map((profile) => `${routeId}:${profile}`)
  ));
  const auditedContractSatisfied = Array.isArray(audited)
    && canonicalRouteIds.length > 0
    && routes.length === canonicalAuditIds.length
    && audited.length === canonicalAuditIds.length
    && new Set(audited).size === audited.length
    && JSON.stringify(audited) === JSON.stringify(canonicalAuditIds)
    && routes.every((route, index) => {
      const fixtureNetwork = route?.fixtureNetwork;
      const fixtureNetworkSafe = route?.fixtureNetworkRequired === false
        ? fixtureNetwork === null
        : route?.fixtureNetworkRequired === true
          && isPlainObject(fixtureNetwork)
          && fixtureNetwork.unexpectedSupabaseRequestCount === 0
          && isEmptyArray(fixtureNetwork.unexpectedSupabasePaths)
          && fixtureNetwork.blockedExternalRequestCount === 0
          && isEmptyArray(fixtureNetwork.blockedExternalOrigins)
          && fixtureNetwork.escapedNetworkRequestCount === 0
          && isEmptyArray(fixtureNetwork.escapedNetworkOrigins)
          && fixtureNetwork.contractViolationCount === 0
          && fixtureNetwork.liveDatabaseMutationCount === 0
          && fixtureNetwork.webSocket?.stubbed === true
          && fixtureNetwork.webSocket?.actualNetworkConnectionCount === 0
          && fixtureNetwork.webSocket?.blockedExternalConnectionAttemptCount === 0
          && isEmptyArray(fixtureNetwork.webSocket?.blockedExternalOrigins);
      return hasExactKeys(route, [
        'id',
        'routeId',
        'profile',
        'viewport',
        'path',
        'url',
        'fixture',
        'fixtureNetworkRequired',
        'fixtureNetwork',
        'readiness',
        'httpStatus',
        'passed',
        'skipLink',
        'keyboardFocusOrder',
        'requiredScrollRegions',
        'layout',
        'violations',
        'incomplete',
        'error',
      ])
        && route.id === audited[index]
        && route.routeId === canonicalRouteIds[Math.floor(index / 2)]
        && route.profile === CANONICAL_ACCESSIBILITY_PROFILES[index % 2]
        && route.path === expectedRoutePaths[route.routeId]
        && route.url === new URL(route.path, payload.baseUrl).toString()
        && JSON.stringify(route.viewport) === JSON.stringify(
          route.profile === 'desktop'
            ? { width: 1440, height: 1000 }
            : { width: 360, height: 800 },
        )
        && (isNonEmptyString(route.fixture)
          || (route.fixture === null && route.fixtureNetworkRequired === false))
        && fixtureNetworkSafe
        && (route.readiness === null || route.readiness?.reached === true)
        && route.httpStatus === 200
        && route.passed === true
        && route.skipLink?.found === true
        && route.skipLink?.focusMoved === true
        && route.keyboardFocusOrder?.passed === true
        && route.keyboardFocusOrder?.focusAppearance?.passed === true
        && Array.isArray(route.requiredScrollRegions)
        && route.requiredScrollRegions.every((region) => region?.found === true
          && region?.scrollable === true
          && region?.focused === true
          && region?.keyboardScrolled === true)
        && route.layout?.horizontalOverflow === false
        && route.layout?.contentWidthSufficient === true
        && isEmptyArray(route.layout?.clippedOutsideScrollRegions)
        && isEmptyArray(route.violations)
        && isEmptyArray(route.incomplete)
        && route.error === null;
    });

  return hasExactKeys(payload, [
    'schemaVersion',
    'generatedAt',
    'sourceCommit',
    'sourceTreeClean',
    'evidenceClassification',
    'releaseEvidence',
    'targetRevision',
    'baseUrl',
    'standard',
    'engine',
    'status',
    'summary',
    'coverage',
    'routes',
  ])
    && payload.schemaVersion === 5
    && isValidGeneratedAt(payload.generatedAt)
    && isFullCommit(payload.sourceCommit)
    && payload.sourceTreeClean === true
    && payload.evidenceClassification === 'release-evidence'
    && payload.releaseEvidence === true
    && hasExactKeys(payload.targetRevision, ['status', 'sourceCommit'])
    && payload.targetRevision.status === 'verified'
    && isFullCommit(payload.targetRevision.sourceCommit)
    && isLoopbackBaseUrl(payload.baseUrl)
    && isNonEmptyString(payload.standard)
    && hasExactKeys(payload.engine, ['name', 'version', 'tags'])
    && payload.engine.name === 'axe-core'
    && /^4\.[0-9]+\.[0-9]+$/u.test(payload.engine.version)
    && JSON.stringify(payload.engine.tags) === JSON.stringify([
      'wcag2a',
      'wcag2aa',
      'wcag21a',
      'wcag21aa',
      'wcag22aa',
    ])
    && hasExactKeys(summary, [
      'routeCount',
      'profileCount',
      'auditCaseCount',
      'passedRoutes',
      'passedCases',
      'violationCount',
      'incompleteCount',
      'excludedSurfaceCount',
    ])
    && hasExactKeys(coverage, ['profiles', 'audited', 'excluded'])
    && exclusionContractSatisfied
    && profileContractSatisfied
    && auditedContractSatisfied
    && summary?.routeCount === canonicalRouteIds.length
    && summary.profileCount === 2
    && summary.auditCaseCount === canonicalAuditIds.length
    && summary.passedRoutes === summary.routeCount
    && summary.passedCases === canonicalAuditIds.length
    && summary.violationCount === 0
    && summary.incompleteCount === 0
    && summary.excludedSurfaceCount === excluded.length;
}

export function verifyReadyArtifactPayloads(root, report, expectedTargetRevision, {
  manualTargetState,
  manualVerifiedAt = new Date(),
  readSourceArtifact,
  expectedPostgresManifestPaths,
  expectedAccessibilityRoutePaths = CANONICAL_ACCESSIBILITY_ROUTE_PATHS,
  trustedEvidencePublicKeys,
  trustPolicy,
  backupArchivePath,
  latestBackupPath,
  operatorEvidenceVerifier,
  traceabilityEvidenceVerifier,
  boundFiles: providedBoundFiles,
  operatorPayload,
} = {}) {
  if (report?.releaseDecision !== 'ready') return false;
  if (!trustedEvidenceKeysMatchPolicy(trustedEvidencePublicKeys, trustPolicy)) return false;
  const artifacts = report.artifacts;
  if (!hasExactKeys(artifacts, Object.keys(CANONICAL_ARTIFACT_PATHS))) return false;
  if (Object.entries(artifacts).some(([key, value]) => value !== CANONICAL_ARTIFACT_PATHS[key])) {
    return false;
  }
  const sourceArtifactReader = readSourceArtifact
    ?? ((path) => readCommittedFile(root, report.sourceCommit, path));

  const boundFiles = providedBoundFiles ?? readCanonicalOperatorBindingFiles(root);
  if (boundFiles === null) return false;
  const traceability = parseBoundArtifactJson(boundFiles, artifacts.traceabilityReport);
  const postgres = parseBoundArtifactJson(boundFiles, artifacts.postgresVerificationReport);
  const field = parseBoundArtifactJson(boundFiles, artifacts.fieldRehearsalReport);
  const hq = parseBoundArtifactJson(boundFiles, artifacts.hqFieldRehearsalReport);
  const accessibility = parseBoundArtifactJson(boundFiles, artifacts.accessibilityReport);
  const manual = parseBoundArtifactJson(boundFiles, artifacts.manualAccessibilityEvidence);
  const backup = parseBoundArtifactJson(boundFiles, artifacts.backupManifest);
  const restore = parseBoundArtifactJson(boundFiles, artifacts.restoreLog);
  const operator = operatorPayload ?? readArtifactJson(root, artifacts.operatorLog);
  const productionResults = Object.fromEntries(
    Object.entries(PRODUCTION_RESULT_CONFIG).map(([rolloutId, config]) => [
      rolloutId,
      parseBoundArtifactJson(boundFiles, config.path),
    ]),
  );
  let canonicalPostgresManifestPaths = expectedPostgresManifestPaths;
  if (canonicalPostgresManifestPaths === undefined) {
    try {
      canonicalPostgresManifestPaths = derive0912PostgresTargetPaths(root, report.sourceCommit);
    } catch {
      return false;
    }
  }
  if ([
    report,
    traceability,
    postgres,
    field,
    hq,
    accessibility,
    manual,
    backup,
    restore,
    operator,
    ...Object.values(productionResults),
  ].some((value) => contains0912SensitiveMaterial(value))) return false;
  let manualEvidenceVerified = false;
  let backupRestoreEvidenceVerified = false;
  let operatorEvidenceVerified = false;
  let operatorValidationResult = null;
  let traceabilityEvidenceRecomputed = false;
  const verifiedAtIso = canonicalVerifiedAt(manualVerifiedAt);
  const expectedProductionEnvironment = trustPolicy?.status === 'configured'
    ? Object.freeze({
      id: trustPolicy.environment.id,
      webOrigin: trustPolicy.environment.webOrigin,
      supabaseProjectRef: trustPolicy.environment.supabaseProjectRef,
      databaseTlsSpkiSha256: trustPolicy.environment.databaseTlsSpkiSha256,
      organizationId: trustPolicy.environment.orgId,
      assemblyId: trustPolicy.environment.assemblyId,
      sessionId: trustPolicy.environment.sessionId,
      sessionSlug: trustPolicy.environment.sessionSlug,
    })
    : null;
  try {
    const manualSummary = evaluateManualAccessibilityEvidence(
      manual,
      { verifiedAt: manualVerifiedAt },
    );
    const targetState = manualTargetState
      ?? readManualAccessibilityTargetState(root, manual.commitSha);
    validateManualAccessibilityTarget(manual, {
      expectedBaseUrl: APPROVED_MANUAL_ACCESSIBILITY_ORIGIN,
      ...targetState,
    });
    manualEvidenceVerified = manualSummary.status === 'pass'
      && manual.commitSha === report.sourceCommit;
  } catch {
    manualEvidenceVerified = false;
  }
  try {
    backupRestoreEvidenceVerified = validate0912BackupRestoreEvidence({
      backup,
      restore,
      expectedSourceCommit: report.sourceCommit,
      expectedReleaseRunId: report.releaseRunId,
      backupKey: trustedEvidencePublicKeys.backup,
      restoreKey: trustedEvidencePublicKeys.restore,
      verifiedAt: verifiedAtIso,
    }).valid === true
      && verifyBackupArchiveBytes(resolve(root, backupArchivePath ?? ''), backup, restore)
      && verify0912LatestBackupBytes(resolve(root, latestBackupPath ?? ''), backup);
  } catch {
    backupRestoreEvidenceVerified = false;
  }
  try {
    const verifyOperator = operatorEvidenceVerifier ?? ((value) => validate0912OperatorEvidence({
      operator: value,
      expectedSourceCommit: report.sourceCommit,
      expectedTargetRevision,
      expectedReleaseRunId: report.releaseRunId,
      expectedProductionEnvironment,
      expectedGateIds: CANONICAL_0912_GATE_IDS,
      expectedRolloutIds: CANONICAL_0912_ROLLOUT_IDS,
      trustedPublicKey: trustedEvidencePublicKeys.operator,
      verifiedAt: verifiedAtIso,
    }));
    operatorValidationResult = verifyOperator(operator);
    operatorEvidenceVerified = operatorValidationResult?.valid === true
      && operator?.releaseRunId === report.releaseRunId
      && operator?.controls?.backupRestore?.details?.snapshotId === backup?.snapshot?.snapshotId
      && operator?.controls?.backupRestore?.details?.archiveSha256 === backup?.snapshot?.archiveSha256
      && operatorValidationResult?.approvedRolloutMutationCount
        === report?.safety?.approvedProductionMutationCount
      && operatorValidationResult?.unapprovedProductionMutationCount
        === report?.safety?.unapprovedProductionMutationCount
      && operatorValidationResult?.syntheticRehearsalProductionMutationCount
        === report?.safety?.syntheticRehearsalProductionMutationCount
      && operatorValidationResult?.capabilityValuesLeakedToDraftQueueOrEvidence
        === report?.safety?.capabilityValuesLeakedToDraftQueueOrEvidence
      && operator?.controls?.rollbackReadiness?.details?.rollbackArtifactSha256
        === createHash('sha256')
          .update(sourceArtifactReader(
            'supabase/rollbacks/platform_p2a_0912_token_only_activation_BEFORE.sql',
          ))
          .digest('hex')
      && verifyOperatorArtifactBindings(operator, boundFiles)
      && hasSignedOperatorReportBindings(report, artifacts.operatorLog, operator);
  } catch {
    operatorEvidenceVerified = false;
  }
  try {
    traceabilityEvidenceRecomputed = traceabilityEvidenceVerifier
      ? traceabilityEvidenceVerifier(traceability) === true
      : recomputeTraceabilityEvidence(root, traceability);
  } catch {
    traceabilityEvidenceRecomputed = false;
  }
  const sourceBoundArtifactFilesVerified = hasPassingPostgresEvidence(
    postgres,
    canonicalPostgresManifestPaths,
  )
    && hasPassingFieldRehearsalEvidence(field)
    && hasPassingHqRehearsalEvidence(hq)
    && hasSourceBoundArtifactFiles({
      postgres,
      field,
      hq,
      readSourceArtifact: sourceArtifactReader,
    });
  const productionRolloutResultsVerified = Object.entries(PRODUCTION_RESULT_CONFIG)
    .every(([rolloutId, config]) => hasPassingProductionRolloutResult({
      result: productionResults[rolloutId],
      config,
      operator,
      sourceArtifactReader,
    }));

  return hasPassingTraceabilityEvidence(traceability)
    && traceability.sourceCommit === report.sourceCommit
    && traceabilityEvidenceRecomputed
    && hasPassingPostgresEvidence(postgres, canonicalPostgresManifestPaths)
    && postgres.sourceCommit === report.sourceCommit
    && hasPassingFieldRehearsalEvidence(field)
    && field.sourceCommit === report.sourceCommit
    && hasPassingHqRehearsalEvidence(hq)
    && hq.sourceCommit === report.sourceCommit
    && sourceBoundArtifactFilesVerified
    && hasPassingAutomatedAccessibilityEvidence(accessibility, expectedAccessibilityRoutePaths)
    && accessibility.sourceCommit === report.sourceCommit
    && accessibility.sourceTreeClean === true
    && accessibility.releaseEvidence === true
    && accessibility.targetRevision?.status === 'verified'
    && accessibility.targetRevision?.sourceCommit === expectedTargetRevision
    && manualEvidenceVerified
    && backupRestoreEvidenceVerified
    && operatorEvidenceVerified
    && productionRolloutResultsVerified
    && verifyReleaseEvidenceTimeline({
      report,
      traceability,
      postgres,
      field,
      hq,
      accessibility,
      manual,
      backup,
      restore,
      operator,
      verifiedAt: manualVerifiedAt,
    });
}

export function verify0912ReleaseReport({
  root = PROJECT_ROOT,
  reportPath,
  expectedCommit,
  expectedTargetRevision,
  expectedReleaseRunId,
  backupArchivePath,
  latestBackupPath,
  trustedEvidencePublicKeys = Object.freeze({
    operator: process.env.P1A_0912_OPERATOR_PUBLIC_KEY_PEM,
    backup: process.env.P1A_0912_BACKUP_PUBLIC_KEY_PEM,
    restore: process.env.P1A_0912_RESTORE_PUBLIC_KEY_PEM,
  }),
} = {}) {
  if (typeof reportPath !== 'string' || reportPath.trim().length === 0) {
    throw new ReleaseReportCliError('report_required');
  }
  if (reportPath !== RELEASE_REPORT_PATH) {
    throw new ReleaseReportCliError('report_path_not_canonical');
  }
  if (!isFullCommit(expectedCommit)) {
    throw new ReleaseReportCliError('expected_commit_required');
  }
  const absoluteRoot = resolve(root);
  validateReleaseSourceBinding({ root: absoluteRoot, expectedCommit });
  const canonical = readCanonicalContract(absoluteRoot, expectedCommit);
  const trustPolicy = readCanonicalEvidenceTrustPolicy(absoluteRoot, expectedCommit);
  const reportBytes = readRegularEvidenceFile(absoluteRoot, reportPath);
  if (reportBytes === null) throw new ReleaseReportValidationError(['report_unreadable']);
  let report;
  try {
    report = parse0912JsonBytes(reportBytes);
  } catch {
    throw new ReleaseReportValidationError(['report_unreadable']);
  }
  if (report?.releaseDecision === 'ready' && !isFullCommit(expectedTargetRevision)) {
    throw new ReleaseReportCliError('expected_target_revision_required');
  }
  if (report?.releaseDecision === 'ready' && !UUID_PATTERN.test(expectedReleaseRunId ?? '')) {
    throw new ReleaseReportCliError('expected_release_run_id_required');
  }
  if (expectedReleaseRunId !== undefined && report?.releaseRunId !== expectedReleaseRunId) {
    throw new ReleaseReportValidationError(['release_run_id_mismatch']);
  }
  const evidencePathExists = createEvidencePathVerifier(absoluteRoot);
  const initialBoundFiles = report.releaseDecision === 'ready'
    ? readCanonicalOperatorBindingFiles(absoluteRoot)
    : null;
  const initialBindingFingerprints = fingerprintOperatorBindingFiles(initialBoundFiles);
  const operatorBytes = report.releaseDecision === 'ready'
    ? readRegularEvidenceFile(absoluteRoot, CANONICAL_ARTIFACT_PATHS.operatorLog)
    : null;
  let operatorPayload = Object.freeze({});
  if (operatorBytes !== null) {
    try {
      operatorPayload = parse0912JsonBytes(operatorBytes);
    } catch {
      operatorPayload = Object.freeze({});
    }
  }
  const artifactPayloadsVerified = verifyReadyArtifactPayloads(
    absoluteRoot,
    report,
    expectedTargetRevision,
    {
      trustedEvidencePublicKeys,
      trustPolicy,
      backupArchivePath,
      latestBackupPath,
      boundFiles: initialBoundFiles,
      operatorPayload,
    },
  );
  const result = validate0912ReleaseReport({
    report,
    canonicalRolloutIds: canonical.rolloutIds,
    canonicalRequirementIds: canonical.requirementIds,
    canonicalArtifactKeys: canonical.artifactKeys,
    canonicalBlockers: canonical.blockers,
    evidencePathExists,
    artifactPayloadsVerified,
    expectedCommit,
    expectedTargetRevision,
  });
  validateReleaseSourceBinding({ root: absoluteRoot, expectedCommit });
  const finalReportBytes = readRegularEvidenceFile(absoluteRoot, reportPath);
  if (finalReportBytes === null || !reportBytes.equals(finalReportBytes)) {
    throw new ReleaseReportValidationError(['evidence_changed_during_verification']);
  }
  if (artifactPayloadsVerified) {
    const finalBoundFiles = readCanonicalOperatorBindingFiles(absoluteRoot);
    const finalBindingFingerprints = fingerprintOperatorBindingFiles(finalBoundFiles);
    const finalOperatorBytes = readRegularEvidenceFile(
      absoluteRoot,
      CANONICAL_ARTIFACT_PATHS.operatorLog,
    );
    if (!bindingFingerprintsMatch(initialBindingFingerprints, finalBindingFingerprints)
      || operatorBytes === null
      || finalOperatorBytes === null
      || !operatorBytes.equals(finalOperatorBytes)) {
      throw new ReleaseReportValidationError(['evidence_changed_during_verification']);
    }
    const finalBackup = parseBoundArtifactJson(
      finalBoundFiles,
      CANONICAL_ARTIFACT_PATHS.backupManifest,
    );
    const finalRestore = parseBoundArtifactJson(
      finalBoundFiles,
      CANONICAL_ARTIFACT_PATHS.restoreLog,
    );
    if (!verifyBackupArchiveBytes(
      resolve(absoluteRoot, backupArchivePath ?? ''),
      finalBackup,
      finalRestore,
    ) || !verify0912LatestBackupBytes(
      resolve(absoluteRoot, latestBackupPath ?? ''),
      finalBackup,
    )) {
      throw new ReleaseReportValidationError(['evidence_changed_during_verification']);
    }
  }
  validateReleaseSourceBinding({ root: absoluteRoot, expectedCommit });
  return Object.freeze({ ...result, sourceBindingVerified: true });
}

function gitOutput(root, args) {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function readCommittedFile(root, commit, relativePath) {
  if (!isFullCommit(commit) || !isSafeRelativePath(relativePath)) {
    throw new Error('committed_source_path_invalid');
  }
  return execFileSync('git', ['show', `${commit}:${relativePath}`], {
    cwd: root,
    encoding: null,
    maxBuffer: MAX_EVIDENCE_FILE_BYTES,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function isEvidenceOnlyPath(path) {
  return ALLOWED_EVIDENCE_PATHS.has(path.replaceAll('\\', '/'));
}

export function validateReleaseSourceBinding({ root, expectedCommit }) {
  if (!isFullCommit(expectedCommit)) {
    throw new ReleaseReportValidationError(['expected_commit_invalid']);
  }
  try {
    gitOutput(root, ['cat-file', '-e', `${expectedCommit}^{commit}`]);
  } catch {
    throw new ReleaseReportValidationError(['expected_commit_not_in_checkout']);
  }
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', expectedCommit, 'HEAD'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch {
    throw new ReleaseReportValidationError(['expected_commit_not_ancestor']);
  }

  const trackedIndexState = gitOutput(root, ['ls-files', '-v']);
  if (trackedIndexState.split(/\r?\n/u).some((line) => line && !line.startsWith('H '))) {
    throw new ReleaseReportValidationError(['source_index_flags_or_state_invalid']);
  }

  const changedPaths = new Set();
  for (const args of [
    ['diff', '--no-renames', '--name-only', `${expectedCommit}..HEAD`],
    ['diff', '--no-renames', '--name-only'],
    ['diff', '--cached', '--no-renames', '--name-only'],
    ['ls-files', '--others', '--exclude-standard'],
    [
      'ls-files',
      '--others',
      '--ignored',
      '--exclude-standard',
      '--',
      'public',
      'src',
    ],
  ]) {
    const output = gitOutput(root, args);
    for (const path of output.split(/\r?\n/u)) {
      if (path) changedPaths.add(path);
    }
  }
  if ([...changedPaths].some((path) => !isEvidenceOnlyPath(path))) {
    throw new ReleaseReportValidationError(['source_changes_after_expected_commit']);
  }
  return Object.freeze({
    expectedCommit,
    evidenceOnlyChangeCount: changedPaths.size,
  });
}

export function parse0912ReleaseReportCliArgs(args) {
  if (!Array.isArray(args)) throw new ReleaseReportCliError('arguments_invalid');
  const supported = new Set([
    '--report',
    '--root',
    '--expected-commit',
    '--expected-target-revision',
    '--expected-release-run-id',
    '--trusted-operator-public-key',
    '--trusted-backup-public-key',
    '--trusted-restore-public-key',
    '--backup-archive',
    '--latest-backup',
  ]);
  const values = new Map();

  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    if (typeof name !== 'string' || !supported.has(name)) {
      throw new ReleaseReportCliError('unsupported_option');
    }
    if (values.has(name)) throw new ReleaseReportCliError('duplicate_option');
    const value = args[index + 1];
    if (typeof value !== 'string' || value.trim().length === 0 || value.startsWith('--')) {
      throw new ReleaseReportCliError('option_value_required');
    }
    values.set(name, value);
  }

  if (!values.has('--report')) throw new ReleaseReportCliError('report_required');
  if (values.get('--report') !== RELEASE_REPORT_PATH) {
    throw new ReleaseReportCliError('report_path_not_canonical');
  }
  for (const name of ['--expected-commit', '--expected-target-revision']) {
    const value = values.get(name);
    if (value !== undefined && !isFullCommit(value)) {
      throw new ReleaseReportCliError('commit_value_invalid');
    }
  }
  if (!values.has('--expected-commit')) throw new ReleaseReportCliError('expected_commit_required');
  const expectedReleaseRunId = values.get('--expected-release-run-id');
  if (expectedReleaseRunId !== undefined && !UUID_PATTERN.test(expectedReleaseRunId)) {
    throw new ReleaseReportCliError('release_run_id_value_invalid');
  }

  return Object.freeze({
    reportPath: values.get('--report'),
    root: values.get('--root'),
    expectedCommit: values.get('--expected-commit'),
    expectedTargetRevision: values.get('--expected-target-revision'),
    expectedReleaseRunId,
    trustedOperatorPublicKeyPath: values.get('--trusted-operator-public-key'),
    trustedBackupPublicKeyPath: values.get('--trusted-backup-public-key'),
    trustedRestorePublicKeyPath: values.get('--trusted-restore-public-key'),
    backupArchivePath: values.get('--backup-archive'),
    latestBackupPath: values.get('--latest-backup'),
  });
}

export function run0912ReleaseReportCli(args) {
  const parsed = parse0912ReleaseReportCliArgs(args);
  const root = parsed.root ?? PROJECT_ROOT;
  const trustedEvidencePublicKeys = {};
  for (const [role, path] of [
    ['operator', parsed.trustedOperatorPublicKeyPath],
    ['backup', parsed.trustedBackupPublicKeyPath],
    ['restore', parsed.trustedRestorePublicKeyPath],
  ]) {
    if (path === undefined) continue;
    try {
      const bytes = readRegularFileAtPath(resolve(root, path), MAX_PUBLIC_KEY_FILE_BYTES);
      if (bytes === null) throw new Error('unreadable_public_key');
      trustedEvidencePublicKeys[role] = decodeUtf8Strict(bytes);
    } catch {
      throw new ReleaseReportCliError(`trusted_${role}_public_key_unreadable`);
    }
  }
  const result = verify0912ReleaseReport({
    root,
    reportPath: parsed.reportPath,
    expectedCommit: parsed.expectedCommit,
    expectedTargetRevision: parsed.expectedTargetRevision,
    expectedReleaseRunId: parsed.expectedReleaseRunId,
    backupArchivePath: parsed.backupArchivePath,
    latestBackupPath: parsed.latestBackupPath,
    trustedEvidencePublicKeys: Object.freeze({
      operator: trustedEvidencePublicKeys.operator
        ?? process.env.P1A_0912_OPERATOR_PUBLIC_KEY_PEM,
      backup: trustedEvidencePublicKeys.backup
        ?? process.env.P1A_0912_BACKUP_PUBLIC_KEY_PEM,
      restore: trustedEvidencePublicKeys.restore
        ?? process.env.P1A_0912_RESTORE_PUBLIC_KEY_PEM,
    }),
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.stdout.write(`${result.releaseReady ? '1 PASS · 0 FAIL (1/1)' : '0 PASS · 1 FAIL (0/1)'}\n`);
  if (!result.releaseReady) process.exitCode = 1;
  return result;
}

const isCli = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  try {
    run0912ReleaseReportCli(process.argv.slice(2));
  } catch (error) {
    const safeMessage = error instanceof ReleaseReportValidationError
      || error instanceof ReleaseReportCliError
      ? error.message
      : '0912 release report verification failed.';
    process.stderr.write(`${safeMessage}\n`);
    process.stderr.write('0 PASS · 1 FAIL (0/1)\n');
    process.exitCode = 1;
  }
}
