import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { REQUIRED_0912_CRITICAL_GATES } from './verify-0912-readiness.mjs';

const FULL_COMMIT_PATTERN = /^[0-9a-f]{40}$/;
const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPORT_ID = '0912-13-readiness';
const TEMPLATE_PATH = 'evaluation/0912-13-readiness-report.template.json';
const ITEM_STATUSES = new Set(['pass', 'fail', 'blocked', 'stopped', 'not_run']);
const REPORT_FIELDS = [
  'schemaVersion',
  'reportId',
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
  operatorLog: 'evaluation/0912-13-operator-log.md',
});
const ALLOWED_EVIDENCE_PATHS = new Set([
  ...Object.values(CANONICAL_ARTIFACT_PATHS),
  'evaluation/0912-13-readiness-report.json',
  'evaluation/0912-13-security-diff-review.md',
  'evaluation/0912-13-implementation-verification.md',
]);
const REPORT_STATUS_DECISIONS = new Map([
  ['needs_review', 'not_ready'],
  ['fail', 'not_ready'],
  ['stopped', 'stopped'],
  ['pass', 'ready'],
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

function readJsonSafely(path, errorCode) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    throw new ReleaseReportValidationError([errorCode]);
  }
}

function readCanonicalContract(root, expectedCommit) {
  let template;
  try {
    template = expectedCommit
      ? JSON.parse(gitOutput(root, ['show', `${expectedCommit}:${TEMPLATE_PATH}`]))
      : readJsonSafely(resolve(root, TEMPLATE_PATH), 'canonical_template_unreadable');
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
    'liveDatabaseMutationCount',
    'capabilityValuesLeakedToDraftQueueOrEvidence',
  ])
    || safety.fixtureClassification !== 'synthetic-no-pii-no-secrets'
    || !Number.isInteger(safety.liveDatabaseMutationCount)
    || safety.liveDatabaseMutationCount < 0
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
  const liveDatabaseUntouched = safety?.liveDatabaseMutationCount === 0;
  const readyConditions = allCriticalGatesPassed
    && rolloutPassed
    && allRequirementsPassed
    && artifactsComplete
    && artifactPayloadsVerified
    && report.sourceTreeClean === true
    && target.verified
    && target.bound
    && capabilityLeakAbsent
    && liveDatabaseUntouched;

  if (report.releaseDecision === 'ready') {
    if (!allCriticalGatesPassed) errors.push('ready_critical_gates_incomplete');
    if (!rolloutPassed) errors.push('ready_rollout_incomplete');
    if (!allRequirementsPassed) errors.push('ready_requirements_incomplete');
    if (!artifactsComplete) errors.push('ready_artifacts_incomplete');
    if (!artifactPayloadsVerified) errors.push('ready_artifact_payloads_unverified');
    if (report.sourceTreeClean !== true) errors.push('ready_source_tree_dirty');
    if (!target.verified || !target.bound) errors.push('ready_target_revision_unverified');
    if (!capabilityLeakAbsent) errors.push('ready_capability_leak_state_invalid');
    if (!liveDatabaseUntouched) errors.push('ready_live_database_mutation_detected');
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
    || safety?.liveDatabaseMutationCount > 0
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

function createEvidencePathVerifier(root) {
  const absoluteRoot = resolve(root);
  return (relativePath) => {
    if (!ALLOWED_EVIDENCE_PATHS.has(relativePath)) return false;
    const absolutePath = resolve(absoluteRoot, relativePath);
    const rootPrefix = `${absoluteRoot.replaceAll('\\', '/').replace(/\/$/u, '')}/`;
    if (!absolutePath.replaceAll('\\', '/').startsWith(rootPrefix)) return false;
    try {
      return existsSync(absolutePath) && statSync(absolutePath).isFile() && statSync(absolutePath).size > 0;
    } catch {
      return false;
    }
  };
}

function readArtifactJson(root, relativePath) {
  try {
    return JSON.parse(readFileSync(resolve(root, relativePath), 'utf8'));
  } catch {
    return null;
  }
}

function hasPassingSummary(payload) {
  return payload?.status === 'pass'
    && Number.isInteger(payload?.summary?.failCount)
    && payload.summary.failCount === 0;
}

function verifyReadyArtifactPayloads(root, report, expectedTargetRevision) {
  if (report?.releaseDecision !== 'ready') return false;
  const artifacts = report.artifacts;
  if (!hasExactKeys(artifacts, Object.keys(CANONICAL_ARTIFACT_PATHS))) return false;
  if (Object.entries(artifacts).some(([key, value]) => value !== CANONICAL_ARTIFACT_PATHS[key])) {
    return false;
  }

  const traceability = readArtifactJson(root, artifacts.traceabilityReport);
  const postgres = readArtifactJson(root, artifacts.postgresVerificationReport);
  const field = readArtifactJson(root, artifacts.fieldRehearsalReport);
  const hq = readArtifactJson(root, artifacts.hqFieldRehearsalReport);
  const accessibility = readArtifactJson(root, artifacts.accessibilityReport);
  const manual = readArtifactJson(root, artifacts.manualAccessibilityEvidence);
  const backup = readArtifactJson(root, artifacts.backupManifest);
  const restore = readArtifactJson(root, artifacts.restoreLog);

  return traceability?.reportId === '0912-13-traceability-verification'
    && hasPassingSummary(traceability)
    && traceability.sourceCommit === report.sourceCommit
    && traceability.sourceTreeClean === true
    && postgres?.reportId === '0912-p1a-p2a-postgres-verification'
    && postgres.status === 'pass'
    && postgres.sourceCommit === report.sourceCommit
    && postgres.sourceTreeClean === true
    && postgres.releaseMode === true
    && postgres.database === 'disposable-postgres-16'
    && postgres.targetManifestVerifiedAtCompletion === true
    && postgres.safety?.productionDatabaseConnectionCount === 0
    && postgres.safety?.productionMutationCount === 0
    && hasPassingSummary(field)
    && field.rehearsalId === '0912-13-field-rehearsal'
    && field.sourceCommit === report.sourceCommit
    && field.sourceTreeClean === true
    && field.safety?.liveNetworkRequestCount === 0
    && field.safety?.liveDatabaseMutationCount === 0
    && field.safety?.capabilityValuesLeakedToDraftQueueOrEvidence === false
    && field.networkContract?.escapedExternalRequestCount === 0
    && hasPassingSummary(hq)
    && hq.rehearsalId === '0912-13-hq-v3-browser-rehearsal'
    && hq.sourceCommit === report.sourceCommit
    && hq.sourceTreeClean === true
    && hq.safety?.forwardedSupabaseHttpRequestCount === 0
    && hq.safety?.blockedUnexpectedSupabaseHttpRequestCount === 0
    && hq.safety?.productionDatabaseMutationCount === 0
    && hq.safety?.runtimeCapabilityMaterialInWrittenReport === false
    && accessibility?.status === 'pass'
    && accessibility.summary?.violationCount === 0
    && accessibility.summary?.incompleteCount === 0
    && accessibility.sourceCommit === report.sourceCommit
    && accessibility.sourceTreeClean === true
    && accessibility.releaseEvidence === true
    && accessibility.targetRevision?.status === 'verified'
    && accessibility.targetRevision?.sourceCommit === expectedTargetRevision
    && manual?.status === 'pass'
    && manual.commitSha === report.sourceCommit
    && manual.certificationClaimed === false
    && backup?.status === 'pass'
    && backup.sourceCommit === report.sourceCommit
    && restore?.status === 'pass'
    && restore.sourceCommit === report.sourceCommit;
}

export function verify0912ReleaseReport({
  root = PROJECT_ROOT,
  reportPath,
  expectedCommit,
  expectedTargetRevision,
} = {}) {
  if (typeof reportPath !== 'string' || reportPath.trim().length === 0) {
    throw new ReleaseReportCliError('report_required');
  }
  if (!isFullCommit(expectedCommit)) {
    throw new ReleaseReportCliError('expected_commit_required');
  }
  const absoluteRoot = resolve(root);
  validateReleaseSourceBinding({ root: absoluteRoot, expectedCommit });
  const canonical = readCanonicalContract(absoluteRoot, expectedCommit);
  const report = readJsonSafely(resolve(absoluteRoot, reportPath), 'report_unreadable');
  if (report?.releaseDecision === 'ready' && !isFullCommit(expectedTargetRevision)) {
    throw new ReleaseReportCliError('expected_target_revision_required');
  }
  const evidencePathExists = createEvidencePathVerifier(absoluteRoot);
  const artifactPayloadsVerified = verifyReadyArtifactPayloads(
    absoluteRoot,
    report,
    expectedTargetRevision,
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
  return Object.freeze({ ...result, sourceBindingVerified: true });
}

function gitOutput(root, args) {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
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

  const changedPaths = new Set();
  for (const args of [
    ['diff', '--name-only', `${expectedCommit}..HEAD`],
    ['diff', '--name-only'],
    ['diff', '--cached', '--name-only'],
    ['ls-files', '--others', '--exclude-standard'],
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
  for (const name of ['--expected-commit', '--expected-target-revision']) {
    const value = values.get(name);
    if (value !== undefined && !isFullCommit(value)) {
      throw new ReleaseReportCliError('commit_value_invalid');
    }
  }
  if (!values.has('--expected-commit')) throw new ReleaseReportCliError('expected_commit_required');

  return Object.freeze({
    reportPath: values.get('--report'),
    root: values.get('--root'),
    expectedCommit: values.get('--expected-commit'),
    expectedTargetRevision: values.get('--expected-target-revision'),
  });
}

export function run0912ReleaseReportCli(args) {
  const parsed = parse0912ReleaseReportCliArgs(args);
  const result = verify0912ReleaseReport({
    root: parsed.root ?? PROJECT_ROOT,
    reportPath: parsed.reportPath,
    expectedCommit: parsed.expectedCommit,
    expectedTargetRevision: parsed.expectedTargetRevision,
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
