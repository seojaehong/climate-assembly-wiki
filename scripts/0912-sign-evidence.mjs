import {
  constants as fsConstants,
  link,
  lstat,
  open,
  realpath,
  unlink,
} from 'node:fs/promises';
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  randomUUID,
  sign as signPayload,
} from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  CANONICAL_0912_GATE_IDS,
  CANONICAL_0912_ROLLOUT_IDS,
  contains0912SensitiveMaterial,
  validate0912OperatorEvidence,
} from './0912-operator-evidence.mjs';
import {
  validate0912BackupEvidence,
  validate0912RestoreEvidence,
} from './0912-backup-restore-evidence.mjs';

const MAX_INPUT_BYTES = 5 * 1024 * 1024;
const CANONICAL_UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const ALLOWED_TYPES = new Set(['operator', 'backup', 'restore']);
const REQUIRED_OPTIONS = Object.freeze(['--type', '--input', '--output', '--private-key']);
const OPTIONAL_OPTIONS = Object.freeze(['--signed-at']);
const ALLOWED_OPTIONS = new Set([...REQUIRED_OPTIONS, ...OPTIONAL_OPTIONS]);
// Release verification must pin a distinct approved SPKI fingerprint for every scope.
// These domains prevent a valid signature from one producer being replayed as another.
export const EVIDENCE_SIGNING_DOMAINS = Object.freeze({
  operator: '0912-operator-evidence-v1',
  backup: '0912-0912-backup-manifest-v1',
  restore: '0912-0912-restore-rehearsal-v1',
});

export class EvidenceSigningError extends Error {
  constructor(code) {
    super(`0912 evidence signing failed: ${code}`);
    this.name = 'EvidenceSigningError';
    this.code = code;
  }
}

function fail(code) {
  throw new EvidenceSigningError(code);
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isCanonicalUtcTimestamp(value) {
  if (typeof value !== 'string' || !CANONICAL_UTC_PATTERN.test(value)) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function canonicalJson(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || Object.is(value, -0)) fail('input_not_canonicalizable');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalJson(entry)).join(',')}]`;
  if (!isPlainObject(value)) fail('input_not_canonicalizable');
  return `{${Object.keys(value).sort().map((key) => {
    if (value[key] === undefined) fail('input_not_canonicalizable');
    return `${JSON.stringify(key)}:${canonicalJson(value[key])}`;
  }).join(',')}}`;
}

function unsignedPayload(value) {
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'attestation'));
}

function normalizedPathForComparison(value) {
  const absolute = resolve(value);
  return process.platform === 'win32' ? absolute.toLowerCase() : absolute;
}

function fileIdentityMatches(stats, expectedIdentity) {
  return stats.dev === expectedIdentity.device
    && stats.ino === expectedIdentity.inode
    && stats.size === expectedIdentity.size
    && stats.mtimeNs === expectedIdentity.modifiedAtNanoseconds
    && stats.ctimeNs === expectedIdentity.changedAtNanoseconds;
}

async function closeFileOrFail(file, errorCode) {
  if (!file) return;
  try {
    await file.close();
  } catch {
    fail(errorCode);
  }
}

async function assertRegularNonSymlinkFile(path, errorCode) {
  try {
    const stats = await lstat(path, { bigint: true });
    if (stats.isSymbolicLink() || !stats.isFile()) fail(errorCode);
    const canonicalPath = await realpath(path);
    if (normalizedPathForComparison(canonicalPath) !== normalizedPathForComparison(path)) {
      fail(errorCode);
    }
    return Object.freeze({
      device: stats.dev,
      inode: stats.ino,
      size: stats.size,
      modifiedAtNanoseconds: stats.mtimeNs,
      changedAtNanoseconds: stats.ctimeNs,
    });
  } catch (error) {
    if (error instanceof EvidenceSigningError) throw error;
    fail(errorCode);
  }
}

async function assertOutputAvailable(path) {
  try {
    await lstat(path);
    fail('output_exists');
  } catch (error) {
    if (error instanceof EvidenceSigningError) throw error;
    if (error?.code !== 'ENOENT') fail('output_path_invalid');
  }

  try {
    const parentPath = dirname(path);
    const parentStats = await lstat(parentPath);
    if (parentStats.isSymbolicLink() || !parentStats.isDirectory()) fail('output_parent_invalid');
    const canonicalParentPath = await realpath(parentPath);
    if (normalizedPathForComparison(canonicalParentPath)
      !== normalizedPathForComparison(parentPath)) {
      fail('output_parent_invalid');
    }
  } catch (error) {
    if (error instanceof EvidenceSigningError) throw error;
    fail('output_parent_invalid');
  }
}

export function parseSigningArguments(argv) {
  if (!Array.isArray(argv) || argv.length === 0 || argv.length % 2 !== 0) {
    fail('arguments_invalid');
  }
  const parsed = Object.create(null);
  for (let index = 0; index < argv.length; index += 2) {
    const option = argv[index];
    const value = argv[index + 1];
    if (!ALLOWED_OPTIONS.has(option)
      || Object.hasOwn(parsed, option)
      || typeof value !== 'string'
      || value.length === 0
      || value.startsWith('--')) {
      fail('arguments_invalid');
    }
    parsed[option] = value;
  }
  if (REQUIRED_OPTIONS.some((option) => !Object.hasOwn(parsed, option))) {
    fail('arguments_invalid');
  }
  if (!ALLOWED_TYPES.has(parsed['--type'])) fail('type_invalid');
  return Object.freeze({
    type: parsed['--type'],
    inputPath: resolve(parsed['--input']),
    outputPath: resolve(parsed['--output']),
    privateKeyPath: resolve(parsed['--private-key']),
    signedAt: parsed['--signed-at'],
  });
}

function signingMessage(type, evidenceType, keyId, payloadSha256, signedAt) {
  const prefix = type === 'operator' ? EVIDENCE_SIGNING_DOMAINS.operator : `0912-${evidenceType}-v1`;
  if (prefix !== EVIDENCE_SIGNING_DOMAINS[type]) fail('evidence_signing_domain_invalid');
  return Buffer.from(`${prefix}\n${keyId}\n${payloadSha256}\n${signedAt}`, 'utf8');
}

function validateTemporalBounds(payload, signedAt, nowMs) {
  if (!isCanonicalUtcTimestamp(signedAt)) fail('signed_at_invalid');
  if (!isCanonicalUtcTimestamp(payload.generatedAt)) fail('input_validation_failed');
  const signedAtMs = Date.parse(signedAt);
  if (signedAtMs < Date.parse(payload.generatedAt)) fail('signed_at_before_evidence');
  if (signedAtMs > nowMs) fail('signed_at_in_future');
}

function validateSignedPayload(type, payload, publicKey, verifiedAt) {
  try {
    if (type === 'operator') {
      validate0912OperatorEvidence({
        operator: payload,
        expectedSourceCommit: payload.sourceCommit,
        expectedTargetRevision: payload.targetRevision,
        expectedReleaseRunId: payload.releaseRunId,
        expectedProductionEnvironment: payload.productionEnvironment,
        expectedGateIds: CANONICAL_0912_GATE_IDS,
        expectedRolloutIds: CANONICAL_0912_ROLLOUT_IDS,
        trustedPublicKey: publicKey,
        verifiedAt,
      });
      return;
    }
    if (type === 'backup') {
      validate0912BackupEvidence({
        backup: payload,
        expectedSourceCommit: payload.sourceCommit,
        expectedReleaseRunId: payload.releaseRunId,
        backupKey: publicKey,
      });
      return;
    }
    validate0912RestoreEvidence({
      restore: payload,
      expectedSourceCommit: payload.sourceCommit,
      expectedReleaseRunId: payload.releaseRunId,
      restoreKey: publicKey,
    });
  } catch {
    fail('input_validation_failed');
  }
}

async function readJsonInput(path, expectedIdentity) {
  let file;
  try {
    file = await open(path, fsConstants.O_RDONLY);
    const stats = await file.stat({ bigint: true });
    if (!fileIdentityMatches(stats, expectedIdentity)) {
      fail('input_file_changed');
    }
    if (!stats.isFile() || stats.size <= 0n || stats.size > BigInt(MAX_INPUT_BYTES)) {
      fail('input_file_invalid');
    }
    const raw = await file.readFile({ encoding: 'utf8' });
    if (!fileIdentityMatches(await file.stat({ bigint: true }), expectedIdentity)) {
      fail('input_file_changed');
    }
    const parsed = JSON.parse(raw);
    if (!isPlainObject(parsed)) fail('input_json_invalid');
    return parsed;
  } catch (error) {
    if (error instanceof EvidenceSigningError) throw error;
    fail('input_json_invalid');
  } finally {
    await closeFileOrFail(file, 'input_file_close_failed');
  }
}

async function readEd25519PrivateKey(path, expectedIdentity) {
  let file;
  try {
    file = await open(path, fsConstants.O_RDONLY);
    const stats = await file.stat({ bigint: true });
    if (!fileIdentityMatches(stats, expectedIdentity)) {
      fail('private_key_changed');
    }
    if (!stats.isFile() || stats.size <= 0n || stats.size > BigInt(64 * 1024)) {
      fail('private_key_invalid');
    }
    const pem = await file.readFile();
    if (!fileIdentityMatches(await file.stat({ bigint: true }), expectedIdentity)) {
      pem.fill(0);
      fail('private_key_changed');
    }
    let privateKey;
    try {
      privateKey = createPrivateKey(pem);
    } finally {
      pem.fill(0);
    }
    if (privateKey.type !== 'private' || privateKey.asymmetricKeyType !== 'ed25519') {
      fail('private_key_type_invalid');
    }
    return privateKey;
  } catch (error) {
    if (error instanceof EvidenceSigningError) throw error;
    fail('private_key_invalid');
  } finally {
    await closeFileOrFail(file, 'private_key_close_failed');
  }
}

async function writeAtomicExclusive(path, contents) {
  const tempPath = resolve(dirname(path), `.0912-sign-${process.pid}-${randomUUID()}.tmp`);
  let tempCreated = false;
  let file;
  try {
    file = await open(tempPath, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY, 0o600);
    tempCreated = true;
    await file.writeFile(contents, { encoding: 'utf8' });
    await file.sync();
    await file.close();
    file = undefined;
    await link(tempPath, path);
  } catch (error) {
    if (error?.code === 'EEXIST') fail('output_exists');
    if (error instanceof EvidenceSigningError) throw error;
    fail('output_write_failed');
  } finally {
    await closeFileOrFail(file, 'output_file_close_failed');
    if (tempCreated) {
      try {
        await unlink(tempPath);
      } catch {
        fail('output_cleanup_failed');
      }
    }
  }
}

export async function sign0912Evidence({
  type,
  inputPath,
  outputPath,
  privateKeyPath,
  signedAt: requestedSignedAt,
  now = new Date(),
}) {
  if (!ALLOWED_TYPES.has(type)) fail('type_invalid');
  const absoluteInputPath = resolve(inputPath);
  const absoluteOutputPath = resolve(outputPath);
  const absolutePrivateKeyPath = resolve(privateKeyPath);
  if (normalizedPathForComparison(absoluteInputPath)
    === normalizedPathForComparison(absoluteOutputPath)) {
    fail('input_output_same');
  }
  const inputIdentity = await assertRegularNonSymlinkFile(
    absoluteInputPath,
    'input_file_invalid',
  );
  const privateKeyIdentity = await assertRegularNonSymlinkFile(
    absolutePrivateKeyPath,
    'private_key_invalid',
  );
  await assertOutputAvailable(absoluteOutputPath);

  const payload = await readJsonInput(absoluteInputPath, inputIdentity);
  if (!Object.hasOwn(payload, 'attestation') || payload.attestation !== null) {
    fail('attestation_must_be_null');
  }
  if (contains0912SensitiveMaterial(payload)) fail('sensitive_material_detected');

  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs)) fail('clock_invalid');
  const signedAt = requestedSignedAt ?? new Date(nowMs).toISOString();
  validateTemporalBounds(payload, signedAt, nowMs);

  const privateKey = await readEd25519PrivateKey(absolutePrivateKeyPath, privateKeyIdentity);
  const publicKey = createPublicKey(privateKey);
  const keyId = `ed25519-sha256:${createHash('sha256')
    .update(publicKey.export({ type: 'spki', format: 'der' }))
    .digest('hex')}`;
  const payloadSha256 = createHash('sha256')
    .update(canonicalJson(unsignedPayload(payload)), 'utf8')
    .digest('hex');
  const signatureBase64 = signPayload(
    null,
    signingMessage(type, payload.evidenceType, keyId, payloadSha256, signedAt),
    privateKey,
  ).toString('base64');
  const signedPayload = {
    ...payload,
    attestation: {
      algorithm: 'Ed25519',
      keyId,
      payloadSha256,
      signatureBase64,
      signedAt,
    },
  };

  validateSignedPayload(type, signedPayload, publicKey, new Date(nowMs).toISOString());
  await writeAtomicExclusive(absoluteOutputPath, `${JSON.stringify(signedPayload, null, 2)}\n`);
  return Object.freeze({ valid: true, type });
}

export async function main(argv = process.argv.slice(2)) {
  try {
    const options = parseSigningArguments(argv);
    await sign0912Evidence(options);
    process.stdout.write('0912 evidence signed\n');
  } catch (error) {
    const code = error instanceof EvidenceSigningError ? error.code : 'unexpected_error';
    process.stderr.write(`0912 evidence signing failed: ${code}\n`);
    process.exitCode = 1;
  }
}

const isDirectExecution = process.argv[1]
  && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isDirectExecution) await main();
