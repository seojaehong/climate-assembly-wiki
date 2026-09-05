import {
  createHash,
  generateKeyPairSync,
  sign as signPayload,
} from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  BackupRestoreEvidenceValidationError,
  SNAPSHOT_COUNT_KEYS,
  validate0912BackupEvidence,
  validate0912BackupRestoreEvidence,
  validate0912RestoreEvidence,
} from './0912-backup-restore-evidence.mjs';

const SOURCE_COMMIT = 'a'.repeat(40);
const RELEASE_RUN_ID = '123e4567-e89b-42d3-a456-426614174000';
const ARCHIVE_SHA256 = 'b'.repeat(64);
const ARCHIVE_OBJECT_REF = 's3://assembly-backups/0912/snapshot-77.dump?versionId=v-20260912-090000';
const ARCHIVE_SIZE_BYTES = 4096;
const LATEST_SHA256 = 'c'.repeat(64);
const VERIFIED_AT = '2026-09-12T09:17:00.000Z';
const BACKUP_KEYS = generateKeyPairSync('ed25519');
const RESTORE_KEYS = generateKeyPairSync('ed25519');

function attestationKeyId(publicKey) {
  return `ed25519-sha256:${createHash('sha256')
    .update(publicKey.export({ type: 'spki', format: 'der' }))
    .digest('hex')}`;
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

function attest(value, signedAt, keys) {
  const keyId = attestationKeyId(keys.publicKey);
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
    signatureBase64: signPayload(null, signingMessage, keys.privateKey).toString('base64'),
    signedAt,
  };
}

function counts(overrides = {}) {
  return {
    submission: 15,
    submission_item: 45,
    issue: 8,
    issue_link: 12,
    result_page: 1,
    ballot: 2,
    ballot_item: 6,
    ballot_response: 30,
    ...overrides,
  };
}

function archiveAudit(overrides = {}) {
  return {
    schemaVersion: 2,
    event: 'platform_snapshot_export',
    exportedAt: '2026-09-12T09:00:00.000Z',
    repository: 'seojaehong/climate-assembly-wiki',
    runId: 'github-actions:12345/1',
    commitSha: SOURCE_COMMIT,
    workflowRef: '.github/workflows/snapshot.yml@refs/heads/main',
    keyId: 'snapshot-hmac-v3',
    snapshotId: 77,
    integrityAlgorithm: 'hmac-sha256',
    integrityTarget: 'legacy+platform+provenance',
    ...overrides,
  };
}

function backupFixture(overrides = {}) {
  const value = {
    schemaVersion: 1,
    evidenceType: '0912-backup-manifest',
    status: 'pass',
    releaseRunId: RELEASE_RUN_ID,
    sourceCommit: SOURCE_COMMIT,
    generatedAt: '2026-09-12T09:01:00.000Z',
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
      archiveAudit: archiveAudit(),
      counts: counts(),
    },
    latest: {
      capturedAt: '2026-09-12T09:00:00.000Z',
      checksumSha256: LATEST_SHA256,
      teamCount: 15,
      itemCount: 45,
      finalizedSubmissionCount: 15,
    },
    ...overrides,
  };
  value.attestation = attest(value, '2026-09-12T09:02:00.000Z', BACKUP_KEYS);
  return value;
}

function restoreFixture(overrides = {}) {
  const value = {
    schemaVersion: 1,
    evidenceType: '0912-restore-rehearsal',
    status: 'pass',
    releaseRunId: RELEASE_RUN_ID,
    sourceCommit: SOURCE_COMMIT,
    generatedAt: '2026-09-12T09:15:00.000Z',
    attestation: null,
    producer: 'isolated-postgres-restore-rehearsal',
    snapshot: {
      snapshotId: 77,
      archiveObjectRef: ARCHIVE_OBJECT_REF,
      archiveSizeBytes: ARCHIVE_SIZE_BYTES,
      archiveSha256: ARCHIVE_SHA256,
      archiveAudit: archiveAudit(),
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
    ...overrides,
  };
  value.attestation = attest(value, '2026-09-12T09:16:00.000Z', RESTORE_KEYS);
  return value;
}

function validateBackup(backup, options = {}) {
  return validate0912BackupEvidence({
    backup,
    expectedSourceCommit: options.expectedSourceCommit ?? SOURCE_COMMIT,
    expectedReleaseRunId: options.expectedReleaseRunId ?? RELEASE_RUN_ID,
    backupKey: options.backupKey ?? BACKUP_KEYS.publicKey,
  });
}

function validateRestore(restore, options = {}) {
  return validate0912RestoreEvidence({
    restore,
    expectedSourceCommit: options.expectedSourceCommit ?? SOURCE_COMMIT,
    expectedReleaseRunId: options.expectedReleaseRunId ?? RELEASE_RUN_ID,
    restoreKey: options.restoreKey ?? RESTORE_KEYS.publicKey,
  });
}

function validatePair(backup, restore, options = {}) {
  return validate0912BackupRestoreEvidence({
    backup,
    restore,
    expectedSourceCommit: options.expectedSourceCommit ?? SOURCE_COMMIT,
    expectedReleaseRunId: options.expectedReleaseRunId ?? RELEASE_RUN_ID,
    backupKey: options.backupKey ?? BACKUP_KEYS.publicKey,
    restoreKey: options.restoreKey ?? RESTORE_KEYS.publicKey,
    verifiedAt: options.verifiedAt ?? VERIFIED_AT,
  });
}

function expectCodes(action, expectedCodes) {
  try {
    action();
    throw new Error('expected validation to fail');
  } catch (error) {
    expect(error).toBeInstanceOf(BackupRestoreEvidenceValidationError);
    expect(error.codes).toEqual(expect.arrayContaining(expectedCodes));
  }
}

describe('9/12 backup and isolated restore evidence', () => {
  it('accepts the strict canonical pair and returns no secret-bearing fields', () => {
    const result = validate0912BackupRestoreEvidence({
      backup: backupFixture(),
      restore: restoreFixture(),
      expectedSourceCommit: SOURCE_COMMIT,
      expectedReleaseRunId: RELEASE_RUN_ID,
      backupKey: BACKUP_KEYS.publicKey,
      restoreKey: RESTORE_KEYS.publicKey,
      verifiedAt: VERIFIED_AT,
    });

    expect(result).toEqual({
      valid: true,
      releaseRunId: RELEASE_RUN_ID,
      sourceCommit: SOURCE_COMMIT,
      snapshotId: 77,
      archiveObjectRef: ARCHIVE_OBJECT_REF,
      archiveSizeBytes: ARCHIVE_SIZE_BYTES,
      archiveSha256: ARCHIVE_SHA256,
      archiveAudit: archiveAudit(),
      counts: counts(),
      postgresMajorVersion: 16,
      isolatedRestoreProductionDatabaseConnectionCount: 0,
      isolatedRestoreProductionMutationCount: 0,
      containerDisposed: true,
    });
    expect(JSON.stringify(result)).not.toContain('signatureBase64');
    expect(SNAPSHOT_COUNT_KEYS).toHaveLength(8);
  });

  it('accepts an immutable S3 reference with a percent-encoded opaque version id', () => {
    const archiveObjectRef = 's3://assembly-backups/0912/snapshot-77.dump?versionId=3%2FL4kqtJlcpXroDTDmJ%2BrmSpXd3dIbrHY%2BMTRCxf3vjEs24AqfArw%3D%3D';
    const backup = backupFixture();
    backup.snapshot.archiveObjectRef = archiveObjectRef;
    backup.attestation = attest(backup, '2026-09-12T09:02:00.000Z', BACKUP_KEYS);
    const restore = restoreFixture();
    restore.snapshot.archiveObjectRef = archiveObjectRef;
    restore.attestation = attest(restore, '2026-09-12T09:16:00.000Z', RESTORE_KEYS);

    expect(validate0912BackupRestoreEvidence({
      backup,
      restore,
      expectedSourceCommit: SOURCE_COMMIT,
      expectedReleaseRunId: RELEASE_RUN_ID,
      backupKey: BACKUP_KEYS.publicKey,
      restoreKey: RESTORE_KEYS.publicKey,
      verifiedAt: VERIFIED_AT,
    }).archiveObjectRef).toBe(archiveObjectRef);
  });

  it('compares table counts by canonical key rather than JSON property order', () => {
    const restore = restoreFixture();
    restore.verification.originalCounts = Object.fromEntries(
      Object.entries(restore.verification.originalCounts).reverse(),
    );
    restore.verification.restoredCounts = Object.fromEntries(
      Object.entries(restore.verification.restoredCounts).sort(([left], [right]) => left.localeCompare(right)),
    );

    expect(() => validate0912BackupRestoreEvidence({
      backup: backupFixture(),
      restore,
      expectedSourceCommit: SOURCE_COMMIT,
      expectedReleaseRunId: RELEASE_RUN_ID,
      backupKey: BACKUP_KEYS.publicKey,
      restoreKey: RESTORE_KEYS.publicKey,
      verifiedAt: VERIFIED_AT,
    })).not.toThrow();
  });

  it.each([
    ['extra backup field', () => backupFixture({ secret: 'do-not-echo' }), ['backup_schema_invalid']],
    ['missing backup field', () => {
      const value = backupFixture();
      delete value.latest;
      return value;
    }, ['backup_schema_invalid', 'backup_latest_schema_invalid']],
    ['extra workflow field', () => {
      const value = backupFixture();
      value.workflow.password = 'do-not-echo';
      return value;
    }, ['backup_workflow_schema_invalid']],
    ['missing workflow field', () => {
      const value = backupFixture();
      delete value.workflow.runId;
      return value;
    }, ['backup_workflow_schema_invalid']],
    ['invalid release run UUID', () => backupFixture({ releaseRunId: 'release-0912' }), [
      'backup_release_run_id_invalid',
    ]],
    ['wrong session', () => {
      const value = backupFixture();
      value.snapshot.session = '0829-deliberation';
      return value;
    }, ['backup_session_invalid']],
    ['string snapshot id from a mismatched producer contract', () => {
      const value = backupFixture();
      value.snapshot.snapshotId = '77';
      return value;
    }, ['backup_snapshot_id_invalid']],
    ['mutable archive object reference', () => {
      const value = backupFixture();
      value.snapshot.archiveObjectRef = 's3://assembly-backups/0912/snapshot-77.dump';
      return value;
    }, ['backup_archive_object_ref_invalid']],
    ['secret-bearing archive object reference', () => {
      const value = backupFixture();
      value.snapshot.archiveObjectRef = 's3://assembly-backups/0912/snapshot-77.dump?versionId=v1&X-Amz-Signature=secret';
      return value;
    }, ['backup_archive_object_ref_invalid']],
    ['non-immutable latest object version', () => {
      const value = backupFixture();
      value.snapshot.archiveObjectRef = 's3://assembly-backups/0912/snapshot-77.dump?versionId=latest';
      return value;
    }, ['backup_archive_object_ref_invalid']],
    ['fragment-only fake version', () => {
      const value = backupFixture();
      value.snapshot.archiveObjectRef = 's3://assembly-backups/latest#version=v-20260912-090000';
      return value;
    }, ['backup_archive_object_ref_invalid']],
    ['extra query parameters', () => {
      const value = backupFixture();
      value.snapshot.archiveObjectRef = `${ARCHIVE_OBJECT_REF}&download=1`;
      return value;
    }, ['backup_archive_object_ref_invalid']],
    ['zero archive size', () => {
      const value = backupFixture();
      value.snapshot.archiveSizeBytes = 0;
      return value;
    }, ['backup_archive_size_invalid']],
    ['unsafe archive size', () => {
      const value = backupFixture();
      value.snapshot.archiveSizeBytes = Number.MAX_SAFE_INTEGER + 1;
      return value;
    }, ['backup_archive_size_invalid']],
    ['browser execution', () => {
      const value = backupFixture();
      value.workflow.browserExecution = true;
      return value;
    }, ['backup_browser_execution_invalid']],
    ['unverified HMAC', () => {
      const value = backupFixture();
      value.workflow.hmacVerified = false;
      return value;
    }, ['backup_hmac_not_verified']],
    ['future capture relative to manifest', () => {
      const value = backupFixture();
      value.latest.capturedAt = '2026-09-12T09:02:00.000Z';
      return value;
    }, ['backup_captured_after_manifest']],
  ])('rejects %s', (_label, makeBackup, expectedCodes) => {
    expectCodes(
      () => validateBackup(makeBackup()),
      expectedCodes,
    );
  });

  it.each([
    ['extra restore field', () => restoreFixture({ hmacKey: 'do-not-echo' }), ['restore_schema_invalid']],
    ['missing restore field', () => {
      const value = restoreFixture();
      delete value.verification;
      return value;
    }, ['restore_schema_invalid', 'restore_verification_schema_invalid']],
    ['extra environment field', () => {
      const value = restoreFixture();
      value.environment.host = 'production.example.test';
      return value;
    }, ['restore_environment_schema_invalid']],
    ['PostgreSQL 15', () => {
      const value = restoreFixture();
      value.environment.majorVersion = 15;
      return value;
    }, ['restore_postgres_version_invalid']],
    ['non-isolated network', () => {
      const value = restoreFixture();
      value.environment.networkMode = 'bridge';
      return value;
    }, ['restore_network_isolation_invalid']],
    ['mutable archive object reference', () => {
      const value = restoreFixture();
      value.snapshot.archiveObjectRef = 's3://assembly-backups/0912/snapshot-77.dump';
      return value;
    }, ['restore_archive_object_ref_invalid']],
    ['negative archive size', () => {
      const value = restoreFixture();
      value.snapshot.archiveSizeBytes = -1;
      return value;
    }, ['restore_archive_size_invalid']],
    ['production connection', () => {
      const value = restoreFixture();
      value.environment.productionDatabaseConnectionCount = 1;
      return value;
    }, ['restore_production_connection_detected']],
    ['production mutation', () => {
      const value = restoreFixture();
      value.environment.productionMutationCount = 1;
      return value;
    }, ['restore_production_mutation_detected']],
    ['live container', () => {
      const value = restoreFixture();
      value.environment.containerDisposed = false;
      return value;
    }, ['restore_container_not_disposed']],
    ['disabled trigger before restore', () => {
      const value = restoreFixture();
      value.verification.businessTriggersEnabledBefore = false;
      return value;
    }, ['restore_trigger_precondition_invalid']],
    ['disabled trigger after restore', () => {
      const value = restoreFixture();
      value.verification.businessTriggersEnabledAfter = false;
      return value;
    }, ['restore_trigger_postcondition_invalid']],
    ['disabled trigger during restore', () => {
      const value = restoreFixture();
      value.verification.businessTriggersEnabledDuringRestore = false;
      return value;
    }, ['restore_trigger_restore_condition_invalid']],
    ['disabled constraints', () => {
      const value = restoreFixture();
      value.verification.constraintsEnabled = false;
      return value;
    }, ['restore_constraints_disabled']],
    ['string snapshot id from a mismatched producer contract', () => {
      const value = restoreFixture();
      value.snapshot.snapshotId = '77';
      return value;
    }, ['restore_snapshot_id_invalid']],
    ['row count drift', () => {
      const value = restoreFixture();
      value.verification.restoredCounts.submission_item = 44;
      return value;
    }, ['restore_count_mismatch']],
    ['secret material', () => {
      const value = restoreFixture();
      value.verification.secretMaterialDetected = true;
      return value;
    }, ['restore_secret_material_detected']],
  ])('rejects %s', (_label, makeRestore, expectedCodes) => {
    expectCodes(
      () => validateRestore(makeRestore()),
      expectedCodes,
    );
  });

  it.each([
    ['release run id drift', () => restoreFixture({
      releaseRunId: '123e4567-e89b-42d3-a456-426614174001',
    }), ['restore_release_run_id_mismatch', 'backup_restore_release_run_id_mismatch']],
    ['snapshot id drift', () => {
      const value = restoreFixture();
      value.snapshot.snapshotId = 78;
      return value;
    }, ['backup_restore_snapshot_id_mismatch']],
    ['archive object reference drift', () => {
      const value = restoreFixture();
      value.snapshot.archiveObjectRef = 's3://assembly-backups/0912/snapshot-77.dump?versionId=v-20260912-090001';
      return value;
    }, ['backup_restore_archive_object_ref_mismatch']],
    ['archive size drift', () => {
      const value = restoreFixture();
      value.snapshot.archiveSizeBytes = ARCHIVE_SIZE_BYTES + 1;
      return value;
    }, ['backup_restore_archive_size_mismatch']],
    ['archive checksum drift', () => {
      const value = restoreFixture();
      value.snapshot.archiveSha256 = 'd'.repeat(64);
      return value;
    }, ['backup_restore_archive_sha256_mismatch']],
    ['backup count drift', () => {
      const value = restoreFixture();
      value.verification.originalCounts.submission = 14;
      value.verification.restoredCounts.submission = 14;
      return value;
    }, ['backup_restore_count_mismatch']],
    ['restore timestamp before backup', () => {
      const value = restoreFixture();
      value.generatedAt = '2026-09-12T08:59:00.000Z';
      return value;
    }, ['restore_generated_before_backup_attestation']],
  ])('rejects cross-evidence %s', (_label, makeRestore, expectedCodes) => {
    const restore = makeRestore();
    restore.attestation = attest(restore, '2026-09-12T09:16:00.000Z', RESTORE_KEYS);
    expectCodes(() => validatePair(backupFixture(), restore), expectedCodes);
  });

  it('requires the expected canonical release run UUID in individual validators', () => {
    expectCodes(
      () => validateBackup(backupFixture(), { expectedReleaseRunId: 'not-a-uuid' }),
      ['expected_release_run_id_invalid', 'backup_release_run_id_mismatch'],
    );
    expectCodes(
      () => validateRestore(restoreFixture(), {
        expectedReleaseRunId: '123e4567-e89b-42d3-a456-426614174001',
      }),
      ['restore_release_run_id_mismatch'],
    );
  });

  it('enforces the complete evidence timeline and 24-hour freshness window', () => {
    expectCodes(
      () => validatePair(
        backupFixture(),
        restoreFixture(),
        { verifiedAt: '2026-09-13T09:17:00.001Z' },
      ),
      [
        'backup_stale_for_verification',
        'restore_stale_for_verification',
      ],
    );

    const futureRestore = restoreFixture({ generatedAt: '2026-09-12T09:21:00.000Z' });
    futureRestore.attestation = attest(
      futureRestore,
      '2026-09-12T09:23:00.000Z',
      RESTORE_KEYS,
    );
    expectCodes(
      () => validatePair(backupFixture(), futureRestore),
      ['restore_after_verification_window'],
    );

    const outOfOrderRestore = restoreFixture({ generatedAt: '2026-09-12T09:01:30.000Z' });
    outOfOrderRestore.attestation = attest(
      outOfOrderRestore,
      '2026-09-12T09:16:00.000Z',
      RESTORE_KEYS,
    );
    expectCodes(
      () => validatePair(backupFixture(), outOfOrderRestore),
      ['restore_generated_before_backup_attestation'],
    );

    expectCodes(
      () => validatePair(backupFixture(), restoreFixture(), { verifiedAt: 'invalid' }),
      ['verified_at_invalid'],
    );

    const staleSnapshot = backupFixture();
    staleSnapshot.latest.capturedAt = '2026-09-11T09:16:59.999Z';
    staleSnapshot.attestation = attest(
      staleSnapshot,
      '2026-09-12T09:02:00.000Z',
      BACKUP_KEYS,
    );
    expectCodes(
      () => validatePair(staleSnapshot, restoreFixture()),
      ['backup_snapshot_stale_for_verification'],
    );
  });

  it('rejects reuse of one attestation key for backup and restore', () => {
    const restore = restoreFixture();
    restore.attestation = attest(restore, '2026-09-12T09:16:00.000Z', BACKUP_KEYS);
    expectCodes(
      () => validatePair(backupFixture(), restore, { restoreKey: BACKUP_KEYS.publicKey }),
      ['backup_restore_attestation_key_reuse'],
    );
  });

  it('rejects malformed count schemas and values', () => {
    const missing = backupFixture();
    delete missing.snapshot.counts.ballot_response;
    expectCodes(
      () => validateBackup(missing),
      ['backup_counts_schema_invalid'],
    );

    const extra = restoreFixture();
    extra.verification.originalCounts.team = 15;
    expectCodes(
      () => validateRestore(extra),
      ['restore_original_counts_schema_invalid'],
    );

    const negative = restoreFixture();
    negative.verification.restoredCounts.issue = -1;
    expectCodes(
      () => validateRestore(negative),
      ['restore_restored_counts_value_invalid'],
    );
  });

  it('rejects source commit and timestamp substitution', () => {
    const backup = backupFixture({ sourceCommit: 'e'.repeat(40) });
    const restore = restoreFixture({ generatedAt: '2026-09-12 09:15:00Z' });
    expectCodes(
      () => validateBackup(backup),
      ['backup_source_commit_invalid'],
    );
    expectCodes(
      () => validateRestore(restore),
      ['restore_generated_at_invalid'],
    );
  });

  it('requires a trusted Ed25519 signature for both artifacts', () => {
    const unsigned = backupFixture();
    delete unsigned.attestation;
    expectCodes(
      () => validateBackup(unsigned),
      ['backup_schema_invalid', 'backup_attestation_schema_invalid'],
    );

    const { publicKey: wrongPublicKey } = generateKeyPairSync('ed25519');
    expectCodes(
      () => validateRestore(restoreFixture(), { restoreKey: wrongPublicKey }),
      ['restore_attestation_key_id_invalid', 'restore_attestation_signature_verification_failed'],
    );
    expectCodes(
      () => validate0912RestoreEvidence({
        restore: restoreFixture(),
        expectedSourceCommit: SOURCE_COMMIT,
        expectedReleaseRunId: RELEASE_RUN_ID,
      }),
      ['restore_attestation_trusted_public_key_invalid'],
    );
  });

  it('accepts only public SPKI PEM strings or public KeyObjects', () => {
    const backupPublicPem = BACKUP_KEYS.publicKey.export({ type: 'spki', format: 'pem' });
    const restorePublicPem = RESTORE_KEYS.publicKey.export({ type: 'spki', format: 'pem' });
    expect(() => validatePair(backupFixture(), restoreFixture(), {
      backupKey: backupPublicPem,
      restoreKey: restorePublicPem,
    })).not.toThrow();

    const privatePem = BACKUP_KEYS.privateKey.export({ type: 'pkcs8', format: 'pem' });
    expectCodes(
      () => validateBackup(backupFixture(), { backupKey: privatePem }),
      ['backup_attestation_trusted_public_key_invalid'],
    );
    expectCodes(
      () => validateBackup(backupFixture(), { backupKey: BACKUP_KEYS.privateKey }),
      ['backup_attestation_trusted_public_key_invalid'],
    );
  });

  it('never echoes rejected credential-like values', () => {
    const backup = backupFixture();
    backup.workflow.password = 'super-secret-password';
    try {
      validateBackup(backup);
      throw new Error('expected validation to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(BackupRestoreEvidenceValidationError);
      expect(error.message).not.toContain('super-secret-password');
      expect(JSON.stringify(error.codes)).not.toContain('super-secret-password');
    }
  });
});
