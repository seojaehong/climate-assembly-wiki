import {
  createHash,
  createPublicKey,
  KeyObject,
  verify as verifySignature,
} from 'node:crypto';

const FULL_COMMIT_PATTERN = /^[0-9a-f]{40}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SAFE_IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/;
const CONTAINER_NAME_PATTERN = /^[a-z0-9][a-z0-9_.-]{0,127}$/;
const S3_ARCHIVE_OBJECT_REF_PATTERN = /^s3:\/\/([a-z0-9][a-z0-9.-]{1,61}[a-z0-9])\/([^?#\s]+)\?versionId=((?:[A-Za-z0-9._~+\/=:-]|%[0-9A-Fa-f]{2}){1,512})$/u;
const PUBLIC_SPKI_PEM_PATTERN = /^-----BEGIN PUBLIC KEY-----\r?\n[A-Za-z0-9+/=\r\n]+-----END PUBLIC KEY-----\r?\n?$/;
const MAX_ATTESTATION_AGE_MS = 24 * 60 * 60 * 1000;
const MAX_VERIFICATION_FUTURE_SKEW_MS = 5 * 60 * 1000;

const BACKUP_FIELDS = Object.freeze([
  'schemaVersion',
  'evidenceType',
  'status',
  'releaseRunId',
  'sourceCommit',
  'generatedAt',
  'attestation',
  'producer',
  'workflow',
  'snapshot',
  'latest',
]);
const BACKUP_WORKFLOW_FIELDS = Object.freeze([
  'runId',
  'keyId',
  'executionMode',
  'hmacVerified',
  'browserExecution',
]);
const BACKUP_SNAPSHOT_FIELDS = Object.freeze([
  'snapshotId',
  'session',
  'archiveObjectRef',
  'archiveSizeBytes',
  'archiveSha256',
  'archiveAudit',
  'counts',
]);
const BACKUP_LATEST_FIELDS = Object.freeze([
  'capturedAt',
  'checksumSha256',
  'teamCount',
  'itemCount',
  'finalizedSubmissionCount',
]);
const RESTORE_FIELDS = Object.freeze([
  'schemaVersion',
  'evidenceType',
  'status',
  'releaseRunId',
  'sourceCommit',
  'generatedAt',
  'attestation',
  'producer',
  'snapshot',
  'environment',
  'verification',
]);
const RESTORE_SNAPSHOT_FIELDS = Object.freeze([
  'snapshotId',
  'archiveObjectRef',
  'archiveSizeBytes',
  'archiveSha256',
  'archiveAudit',
]);
const ARCHIVE_AUDIT_FIELDS = Object.freeze([
  'schemaVersion',
  'event',
  'exportedAt',
  'repository',
  'runId',
  'commitSha',
  'workflowRef',
  'keyId',
  'snapshotId',
  'integrityAlgorithm',
  'integrityTarget',
]);
const RESTORE_ENVIRONMENT_FIELDS = Object.freeze([
  'engine',
  'majorVersion',
  'databaseName',
  'networkMode',
  'containerName',
  'containerDisposed',
  'productionDatabaseConnectionCount',
  'productionMutationCount',
]);
const RESTORE_VERIFICATION_FIELDS = Object.freeze([
  'restoreRehearsalPassed',
  'archiveIntegrityVerified',
  'hmacVerified',
  'databaseRestoreExecuted',
  'transactionRolledBack',
  'archiveRowsVerified',
  'businessTriggersEnabledBefore',
  'businessTriggersEnabledDuringRestore',
  'businessTriggersEnabledAfter',
  'constraintsEnabled',
  'secretMaterialDetected',
  'originalCounts',
  'restoredCounts',
]);
const ATTESTATION_FIELDS = Object.freeze([
  'algorithm',
  'keyId',
  'payloadSha256',
  'signatureBase64',
  'signedAt',
]);

export const SNAPSHOT_COUNT_KEYS = Object.freeze([
  'submission',
  'submission_item',
  'issue',
  'issue_link',
  'result_page',
  'ballot',
  'ballot_item',
  'ballot_response',
]);

export class BackupRestoreEvidenceValidationError extends Error {
  constructor(codes) {
    const uniqueCodes = [...new Set(codes)];
    super(`0912 backup/restore evidence rejected: ${uniqueCodes.join(', ')}`);
    this.name = 'BackupRestoreEvidenceValidationError';
    this.codes = uniqueCodes;
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isPositiveSnapshotId(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function hasExactKeys(value, expectedKeys) {
  if (!isPlainObject(value)) return false;
  return JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expectedKeys].sort());
}

function isCanonicalUtcTimestamp(value) {
  if (typeof value !== 'string' || !value.endsWith('Z')) return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value;
}

function validCount(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function validPositiveSize(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function validArchiveObjectRef(value) {
  if (typeof value !== 'string') return false;
  const match = S3_ARCHIVE_OBJECT_REF_PATTERN.exec(value);
  if (!match) return false;
  const [, bucket, objectKey, versionId] = match;
  let decodedVersionId;
  try {
    decodedVersionId = decodeURIComponent(versionId);
  } catch {
    return false;
  }
  return !bucket.includes('..')
    && objectKey.length <= 400
    && objectKey.split('/').every((segment) => segment.length > 0 && segment !== '..')
    && decodedVersionId.length > 0
    && !/^(?:latest|current|null|none)$/iu.test(decodedVersionId);
}

function validateArchiveAudit({
  value,
  prefix,
  sourceCommit,
  snapshotId,
  workflow,
  generatedAt,
  errors,
}) {
  if (!hasExactKeys(value, ARCHIVE_AUDIT_FIELDS)) {
    errors.push(`${prefix}_archive_audit_schema_invalid`);
    return false;
  }
  if (value.schemaVersion !== 2
    || value.event !== 'platform_snapshot_export'
    || !isCanonicalUtcTimestamp(value.exportedAt)
    || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(value.repository ?? '')
    || !SAFE_IDENTIFIER_PATTERN.test(value.runId ?? '')
    || value.commitSha !== sourceCommit
    || typeof value.workflowRef !== 'string'
    || value.workflowRef.length === 0
    || value.workflowRef.length > 300
    || /[\u0000-\u001f\u007f]/u.test(value.workflowRef)
    || !SAFE_IDENTIFIER_PATTERN.test(value.keyId ?? '')
    || value.snapshotId !== snapshotId
    || value.integrityAlgorithm !== 'hmac-sha256'
    || value.integrityTarget !== 'legacy+platform+provenance') {
    errors.push(`${prefix}_archive_audit_invalid`);
    return false;
  }
  if (workflow
    && (value.runId !== workflow.runId || value.keyId !== workflow.keyId)) {
    errors.push(`${prefix}_archive_audit_workflow_mismatch`);
  }
  if (isCanonicalUtcTimestamp(generatedAt)
    && Date.parse(value.exportedAt) > Date.parse(generatedAt)) {
    errors.push(`${prefix}_archive_exported_after_evidence`);
  }
  return true;
}

function validateCounts(value, prefix, errors) {
  if (!hasExactKeys(value, SNAPSHOT_COUNT_KEYS)) {
    errors.push(`${prefix}_schema_invalid`);
    return false;
  }
  if (SNAPSHOT_COUNT_KEYS.some((key) => !validCount(value[key]))) {
    errors.push(`${prefix}_value_invalid`);
    return false;
  }
  return true;
}

function countsEqual(left, right) {
  return SNAPSHOT_COUNT_KEYS.every((key) => left[key] === right[key]);
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
  return `{${Object.keys(value).sort().map((key) => {
    if (value[key] === undefined) throw new TypeError('invalid canonical property');
    return `${JSON.stringify(key)}:${canonicalJson(value[key])}`;
  }).join(',')}}`;
}

function unsignedEvidencePayload(value) {
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'attestation'));
}

function attestationSigningMessage({ evidenceType, keyId, payloadSha256, signedAt }) {
  return Buffer.from(
    `0912-${evidenceType}-v1\n${keyId}\n${payloadSha256}\n${signedAt}`,
    'utf8',
  );
}

function readStrictEd25519PublicKey(trustedPublicKey, prefix, errors) {
  let publicKey;
  if (trustedPublicKey instanceof KeyObject) {
    if (trustedPublicKey.type !== 'public') {
      errors.push(`${prefix}_attestation_trusted_public_key_invalid`);
      return undefined;
    }
    publicKey = trustedPublicKey;
  } else if (typeof trustedPublicKey === 'string'
    && PUBLIC_SPKI_PEM_PATTERN.test(trustedPublicKey)
    && !trustedPublicKey.includes('PRIVATE KEY')) {
    try {
      publicKey = createPublicKey(trustedPublicKey);
    } catch {
      errors.push(`${prefix}_attestation_trusted_public_key_invalid`);
      return undefined;
    }
  } else {
    errors.push(`${prefix}_attestation_trusted_public_key_invalid`);
    return undefined;
  }

  if (publicKey.type !== 'public' || publicKey.asymmetricKeyType !== 'ed25519') {
    errors.push(`${prefix}_attestation_trusted_key_type_invalid`);
    return undefined;
  }
  return publicKey;
}

function validateAttestation(value, trustedPublicKey, prefix, errors) {
  const attestation = value?.attestation;
  if (!hasExactKeys(attestation, ATTESTATION_FIELDS)) {
    errors.push(`${prefix}_attestation_schema_invalid`);
    return;
  }
  if (attestation.algorithm !== 'Ed25519') {
    errors.push(`${prefix}_attestation_algorithm_invalid`);
  }
  if (!isCanonicalUtcTimestamp(attestation.signedAt)) {
    errors.push(`${prefix}_attestation_signed_at_invalid`);
  } else if (isCanonicalUtcTimestamp(value?.generatedAt)
    && Date.parse(attestation.signedAt) < Date.parse(value.generatedAt)) {
    errors.push(`${prefix}_attestation_signed_before_evidence`);
  }
  if (!SHA256_PATTERN.test(attestation.payloadSha256 ?? '')) {
    errors.push(`${prefix}_attestation_payload_sha256_invalid`);
  }

  let calculatedPayloadSha256;
  try {
    calculatedPayloadSha256 = createHash('sha256')
      .update(canonicalJson(unsignedEvidencePayload(value)), 'utf8')
      .digest('hex');
  } catch {
    errors.push(`${prefix}_attestation_payload_not_canonicalizable`);
    return;
  }
  if (attestation.payloadSha256 !== calculatedPayloadSha256) {
    errors.push(`${prefix}_attestation_payload_sha256_mismatch`);
  }

  let signature;
  if (typeof attestation.signatureBase64 !== 'string') {
    errors.push(`${prefix}_attestation_signature_invalid`);
  } else {
    signature = Buffer.from(attestation.signatureBase64, 'base64');
    if (signature.length !== 64 || signature.toString('base64') !== attestation.signatureBase64) {
      errors.push(`${prefix}_attestation_signature_invalid`);
      signature = undefined;
    }
  }

  const publicKey = readStrictEd25519PublicKey(trustedPublicKey, prefix, errors);
  if (!publicKey) return;

  const expectedKeyId = `ed25519-sha256:${createHash('sha256')
    .update(publicKey.export({ type: 'spki', format: 'der' }))
    .digest('hex')}`;
  if (attestation.keyId !== expectedKeyId) {
    errors.push(`${prefix}_attestation_key_id_invalid`);
  }
  if (!signature
    || !isCanonicalUtcTimestamp(attestation.signedAt)
    || !SHA256_PATTERN.test(attestation.payloadSha256 ?? '')) return;
  try {
    if (!verifySignature(
      null,
      attestationSigningMessage({
        evidenceType: value.evidenceType,
        keyId: attestation.keyId,
        payloadSha256: attestation.payloadSha256,
        signedAt: attestation.signedAt,
      }),
      publicKey,
      signature,
    )) errors.push(`${prefix}_attestation_signature_verification_failed`);
  } catch {
    errors.push(`${prefix}_attestation_signature_verification_failed`);
  }
}

function validateSharedEvidenceFields(
  value,
  expectedType,
  expectedProducer,
  expectedSourceCommit,
  expectedReleaseRunId,
  prefix,
  errors,
) {
  if (value?.schemaVersion !== 1) errors.push(`${prefix}_schema_version_invalid`);
  if (value?.evidenceType !== expectedType) errors.push(`${prefix}_evidence_type_invalid`);
  if (value?.status !== 'pass') errors.push(`${prefix}_status_invalid`);
  if (!UUID_PATTERN.test(value?.releaseRunId ?? '')) {
    errors.push(`${prefix}_release_run_id_invalid`);
  } else if (value.releaseRunId !== expectedReleaseRunId) {
    errors.push(`${prefix}_release_run_id_mismatch`);
  }
  if (!FULL_COMMIT_PATTERN.test(value?.sourceCommit ?? '')
    || value.sourceCommit !== expectedSourceCommit) {
    errors.push(`${prefix}_source_commit_invalid`);
  }
  if (!isCanonicalUtcTimestamp(value?.generatedAt)) errors.push(`${prefix}_generated_at_invalid`);
  if (value?.producer !== expectedProducer) errors.push(`${prefix}_producer_invalid`);
}

function throwIfErrors(errors) {
  if (errors.length > 0) throw new BackupRestoreEvidenceValidationError(errors);
}

function captureValidation(action, errors) {
  try {
    return action();
  } catch (error) {
    if (!(error instanceof BackupRestoreEvidenceValidationError)) throw error;
    errors.push(...error.codes);
    return undefined;
  }
}

export function validate0912BackupEvidence({
  backup,
  expectedSourceCommit,
  expectedReleaseRunId,
  backupKey,
} = {}) {
  const errors = [];
  if (!hasExactKeys(backup, BACKUP_FIELDS)) errors.push('backup_schema_invalid');
  if (!FULL_COMMIT_PATTERN.test(expectedSourceCommit ?? '')) {
    errors.push('expected_source_commit_invalid');
  }
  if (!UUID_PATTERN.test(expectedReleaseRunId ?? '')) {
    errors.push('expected_release_run_id_invalid');
  }
  validateSharedEvidenceFields(
    backup,
    '0912-backup-manifest',
    'approved-snapshot-workflow',
    expectedSourceCommit,
    expectedReleaseRunId,
    'backup',
    errors,
  );
  validateAttestation(backup, backupKey, 'backup', errors);

  const workflow = backup?.workflow;
  if (!hasExactKeys(workflow, BACKUP_WORKFLOW_FIELDS)) {
    errors.push('backup_workflow_schema_invalid');
  } else {
    if (!SAFE_IDENTIFIER_PATTERN.test(workflow.runId ?? '')) errors.push('backup_workflow_run_id_invalid');
    if (!SAFE_IDENTIFIER_PATTERN.test(workflow.keyId ?? '')) errors.push('backup_key_id_invalid');
    if (workflow.executionMode !== 'approved-service-role-workflow') {
      errors.push('backup_execution_mode_invalid');
    }
    if (workflow.hmacVerified !== true) errors.push('backup_hmac_not_verified');
    if (workflow.browserExecution !== false) errors.push('backup_browser_execution_invalid');
  }

  const snapshot = backup?.snapshot;
  if (!hasExactKeys(snapshot, BACKUP_SNAPSHOT_FIELDS)) {
    errors.push('backup_snapshot_schema_invalid');
  } else {
    if (!isPositiveSnapshotId(snapshot.snapshotId)) errors.push('backup_snapshot_id_invalid');
    if (snapshot.session !== '0912-deliberation') errors.push('backup_session_invalid');
    if (!validArchiveObjectRef(snapshot.archiveObjectRef)) {
      errors.push('backup_archive_object_ref_invalid');
    }
    if (!validPositiveSize(snapshot.archiveSizeBytes)) {
      errors.push('backup_archive_size_invalid');
    }
    if (!SHA256_PATTERN.test(snapshot.archiveSha256 ?? '')) errors.push('backup_archive_sha256_invalid');
    validateArchiveAudit({
      value: snapshot.archiveAudit,
      prefix: 'backup',
      sourceCommit: expectedSourceCommit,
      snapshotId: snapshot.snapshotId,
      workflow,
      generatedAt: backup?.generatedAt,
      errors,
    });
    validateCounts(snapshot.counts, 'backup_counts', errors);
  }

  const latest = backup?.latest;
  if (!hasExactKeys(latest, BACKUP_LATEST_FIELDS)) {
    errors.push('backup_latest_schema_invalid');
  } else {
    if (!isCanonicalUtcTimestamp(latest.capturedAt)) errors.push('backup_captured_at_invalid');
    if (!SHA256_PATTERN.test(latest.checksumSha256 ?? '')) errors.push('backup_latest_checksum_invalid');
    if (!validCount(latest.teamCount)
      || !validCount(latest.itemCount)
      || !validCount(latest.finalizedSubmissionCount)) {
      errors.push('backup_latest_counts_invalid');
    }
    if (isCanonicalUtcTimestamp(latest.capturedAt)
      && isCanonicalUtcTimestamp(backup?.generatedAt)
      && Date.parse(latest.capturedAt) > Date.parse(backup.generatedAt)) {
      errors.push('backup_captured_after_manifest');
    }
  }

  throwIfErrors(errors);
  return Object.freeze({
    releaseRunId: backup.releaseRunId,
    sourceCommit: backup.sourceCommit,
    capturedAt: backup.latest.capturedAt,
    generatedAt: backup.generatedAt,
    signedAt: backup.attestation.signedAt,
    snapshotId: backup.snapshot.snapshotId,
    archiveObjectRef: backup.snapshot.archiveObjectRef,
    archiveSizeBytes: backup.snapshot.archiveSizeBytes,
    archiveSha256: backup.snapshot.archiveSha256,
    archiveAudit: Object.freeze({ ...backup.snapshot.archiveAudit }),
    counts: Object.freeze({ ...backup.snapshot.counts }),
  });
}

export function validate0912RestoreEvidence({
  restore,
  expectedSourceCommit,
  expectedReleaseRunId,
  restoreKey,
} = {}) {
  const errors = [];
  if (!hasExactKeys(restore, RESTORE_FIELDS)) errors.push('restore_schema_invalid');
  if (!FULL_COMMIT_PATTERN.test(expectedSourceCommit ?? '')) {
    errors.push('expected_source_commit_invalid');
  }
  if (!UUID_PATTERN.test(expectedReleaseRunId ?? '')) {
    errors.push('expected_release_run_id_invalid');
  }
  validateSharedEvidenceFields(
    restore,
    '0912-restore-rehearsal',
    'isolated-postgres-restore-rehearsal',
    expectedSourceCommit,
    expectedReleaseRunId,
    'restore',
    errors,
  );
  validateAttestation(restore, restoreKey, 'restore', errors);

  const snapshot = restore?.snapshot;
  if (!hasExactKeys(snapshot, RESTORE_SNAPSHOT_FIELDS)) {
    errors.push('restore_snapshot_schema_invalid');
  } else {
    if (!isPositiveSnapshotId(snapshot.snapshotId)) errors.push('restore_snapshot_id_invalid');
    if (!validArchiveObjectRef(snapshot.archiveObjectRef)) {
      errors.push('restore_archive_object_ref_invalid');
    }
    if (!validPositiveSize(snapshot.archiveSizeBytes)) {
      errors.push('restore_archive_size_invalid');
    }
    if (!SHA256_PATTERN.test(snapshot.archiveSha256 ?? '')) errors.push('restore_archive_sha256_invalid');
    validateArchiveAudit({
      value: snapshot.archiveAudit,
      prefix: 'restore',
      sourceCommit: expectedSourceCommit,
      snapshotId: snapshot.snapshotId,
      generatedAt: restore?.generatedAt,
      errors,
    });
  }

  const environment = restore?.environment;
  if (!hasExactKeys(environment, RESTORE_ENVIRONMENT_FIELDS)) {
    errors.push('restore_environment_schema_invalid');
  } else {
    if (environment.engine !== 'postgresql' || environment.majorVersion !== 16) {
      errors.push('restore_postgres_version_invalid');
    }
    if (environment.databaseName !== 'verify') errors.push('restore_database_name_invalid');
    if (environment.networkMode !== 'none') errors.push('restore_network_isolation_invalid');
    if (!CONTAINER_NAME_PATTERN.test(environment.containerName ?? '')) {
      errors.push('restore_container_name_invalid');
    }
    if (environment.containerDisposed !== true) errors.push('restore_container_not_disposed');
    if (environment.productionDatabaseConnectionCount !== 0) {
      errors.push('restore_production_connection_detected');
    }
    if (environment.productionMutationCount !== 0) {
      errors.push('restore_production_mutation_detected');
    }
  }

  const verification = restore?.verification;
  if (!hasExactKeys(verification, RESTORE_VERIFICATION_FIELDS)) {
    errors.push('restore_verification_schema_invalid');
  } else {
    for (const [field, code] of [
      ['restoreRehearsalPassed', 'restore_rehearsal_not_passed'],
      ['archiveIntegrityVerified', 'restore_archive_integrity_not_verified'],
      ['hmacVerified', 'restore_hmac_not_verified'],
      ['databaseRestoreExecuted', 'restore_database_not_executed'],
      ['transactionRolledBack', 'restore_transaction_not_rolled_back'],
      ['archiveRowsVerified', 'restore_archive_rows_not_verified'],
      ['businessTriggersEnabledBefore', 'restore_trigger_precondition_invalid'],
      ['businessTriggersEnabledDuringRestore', 'restore_trigger_restore_condition_invalid'],
      ['businessTriggersEnabledAfter', 'restore_trigger_postcondition_invalid'],
      ['constraintsEnabled', 'restore_constraints_disabled'],
    ]) {
      if (verification[field] !== true) errors.push(code);
    }
    if (verification.secretMaterialDetected !== false) errors.push('restore_secret_material_detected');
    validateCounts(verification.originalCounts, 'restore_original_counts', errors);
    validateCounts(verification.restoredCounts, 'restore_restored_counts', errors);
    if (hasExactKeys(verification.originalCounts, SNAPSHOT_COUNT_KEYS)
      && hasExactKeys(verification.restoredCounts, SNAPSHOT_COUNT_KEYS)
      && !countsEqual(verification.originalCounts, verification.restoredCounts)) {
      errors.push('restore_count_mismatch');
    }
  }

  throwIfErrors(errors);
  return Object.freeze({
    releaseRunId: restore.releaseRunId,
    sourceCommit: restore.sourceCommit,
    generatedAt: restore.generatedAt,
    signedAt: restore.attestation.signedAt,
    snapshotId: restore.snapshot.snapshotId,
    archiveObjectRef: restore.snapshot.archiveObjectRef,
    archiveSizeBytes: restore.snapshot.archiveSizeBytes,
    archiveSha256: restore.snapshot.archiveSha256,
    archiveAudit: Object.freeze({ ...restore.snapshot.archiveAudit }),
    counts: Object.freeze({ ...restore.verification.restoredCounts }),
    containerName: restore.environment.containerName,
  });
}

export function validate0912BackupRestoreEvidence({
  backup,
  restore,
  expectedSourceCommit,
  expectedReleaseRunId,
  backupKey,
  restoreKey,
  verifiedAt,
} = {}) {
  const errors = [];
  const backupSummary = captureValidation(
    () => validate0912BackupEvidence({
      backup,
      expectedSourceCommit,
      expectedReleaseRunId,
      backupKey,
    }),
    errors,
  );
  const restoreSummary = captureValidation(
    () => validate0912RestoreEvidence({
      restore,
      expectedSourceCommit,
      expectedReleaseRunId,
      restoreKey,
    }),
    errors,
  );

  if (UUID_PATTERN.test(backup?.releaseRunId ?? '')
    && UUID_PATTERN.test(restore?.releaseRunId ?? '')
    && backup.releaseRunId !== restore.releaseRunId) {
    errors.push('backup_restore_release_run_id_mismatch');
  }
  if (isPositiveSnapshotId(backup?.snapshot?.snapshotId)
    && isPositiveSnapshotId(restore?.snapshot?.snapshotId)
    && backup.snapshot.snapshotId !== restore.snapshot.snapshotId) {
    errors.push('backup_restore_snapshot_id_mismatch');
  }
  if (validArchiveObjectRef(backup?.snapshot?.archiveObjectRef)
    && validArchiveObjectRef(restore?.snapshot?.archiveObjectRef)
    && backup.snapshot.archiveObjectRef !== restore.snapshot.archiveObjectRef) {
    errors.push('backup_restore_archive_object_ref_mismatch');
  }
  if (validPositiveSize(backup?.snapshot?.archiveSizeBytes)
    && validPositiveSize(restore?.snapshot?.archiveSizeBytes)
    && backup.snapshot.archiveSizeBytes !== restore.snapshot.archiveSizeBytes) {
    errors.push('backup_restore_archive_size_mismatch');
  }
  if (SHA256_PATTERN.test(backup?.snapshot?.archiveSha256 ?? '')
    && SHA256_PATTERN.test(restore?.snapshot?.archiveSha256 ?? '')
    && backup.snapshot.archiveSha256 !== restore.snapshot.archiveSha256) {
    errors.push('backup_restore_archive_sha256_mismatch');
  }
  if (hasExactKeys(backup?.snapshot?.archiveAudit, ARCHIVE_AUDIT_FIELDS)
    && hasExactKeys(restore?.snapshot?.archiveAudit, ARCHIVE_AUDIT_FIELDS)
    && !ARCHIVE_AUDIT_FIELDS.every((field) => (
      backup.snapshot.archiveAudit[field] === restore.snapshot.archiveAudit[field]
    ))) {
    errors.push('backup_restore_archive_audit_mismatch');
  }
  if (backupSummary && restoreSummary
    && !countsEqual(backupSummary.counts, restoreSummary.counts)) {
    errors.push('backup_restore_count_mismatch');
  }

  const backupKeyId = backup?.attestation?.keyId;
  const restoreKeyId = restore?.attestation?.keyId;
  if (typeof backupKeyId === 'string'
    && typeof restoreKeyId === 'string'
    && backupKeyId === restoreKeyId) {
    errors.push('backup_restore_attestation_key_reuse');
  }

  if (!isCanonicalUtcTimestamp(verifiedAt)) {
    errors.push('verified_at_invalid');
  } else {
    const verifiedAtMs = Date.parse(verifiedAt);
    for (const [prefix, timestamp] of [
      ['backup_snapshot', backup?.latest?.capturedAt],
      ['backup_archive_export', backup?.snapshot?.archiveAudit?.exportedAt],
      ['backup', backup?.attestation?.signedAt],
      ['restore', restore?.attestation?.signedAt],
    ]) {
      if (!isCanonicalUtcTimestamp(timestamp)) continue;
      const timestampMs = Date.parse(timestamp);
      if (timestampMs < verifiedAtMs - MAX_ATTESTATION_AGE_MS) {
        errors.push(`${prefix}_stale_for_verification`);
      }
      if (timestampMs > verifiedAtMs + MAX_VERIFICATION_FUTURE_SKEW_MS) {
        errors.push(`${prefix}_after_verification_window`);
      }
    }
  }

  if (isCanonicalUtcTimestamp(backup?.attestation?.signedAt)
    && isCanonicalUtcTimestamp(restore?.generatedAt)
    && Date.parse(backup.attestation.signedAt) > Date.parse(restore.generatedAt)) {
    errors.push('restore_generated_before_backup_attestation');
  }

  throwIfErrors(errors);
  return Object.freeze({
    valid: true,
    releaseRunId: expectedReleaseRunId,
    sourceCommit: expectedSourceCommit,
    snapshotId: backupSummary.snapshotId,
    archiveObjectRef: backupSummary.archiveObjectRef,
    archiveSizeBytes: backupSummary.archiveSizeBytes,
    archiveSha256: backupSummary.archiveSha256,
    archiveAudit: backupSummary.archiveAudit,
    counts: backupSummary.counts,
    postgresMajorVersion: 16,
    isolatedRestoreProductionDatabaseConnectionCount: 0,
    isolatedRestoreProductionMutationCount: 0,
    containerDisposed: true,
  });
}
