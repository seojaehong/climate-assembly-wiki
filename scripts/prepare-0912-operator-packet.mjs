import { createHash, randomBytes } from 'node:crypto';
import {
  closeSync,
  existsSync,
  fstatSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import {
  basename,
  dirname,
  isAbsolute,
  relative,
  resolve,
} from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CANONICAL_0912_OPERATOR_BINDING_PATHS,
  CANONICAL_0912_CONTROL_RECEIPT_IDS,
  CANONICAL_0912_GATE_IDS,
  CANONICAL_0912_RELEASE_ARTIFACT_PATHS,
  CANONICAL_0912_ROLLOUT_IDS,
  canonical0912OperatorReceiptPath,
  contains0912SensitiveMaterial,
  create0912OperatorEvidenceTemplate,
  validate0912UnsignedOperatorEvidence,
} from './0912-operator-evidence.mjs';

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FULL_COMMIT_PATTERN = /^[0-9a-f]{40}$/u;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const ENVIRONMENT_ID_PATTERN = /^[a-z][a-z0-9-]{2,63}$/u;
const SUPABASE_PROJECT_REF_PATTERN = /^[a-z0-9]{20}$/u;
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const MAX_ENVIRONMENT_FILE_BYTES = 64 * 1024;
const MAX_BOUND_ARTIFACT_BYTES = 4 * 1024 * 1024;
const MAX_BOUND_ARTIFACT_TOTAL_BYTES = 32 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
const SIGNED_OPERATOR_EVIDENCE_PATH = 'evaluation/0912-13-operator-log.json';
const CANONICAL_OPERATOR_TEMPLATE_PATH = 'evaluation/0912-13-operator-log.template.json';
const OPERATOR_STAGING_PREFIX = '.tmp-verify/0912-operator/';
const CONTROL_NAMES = Object.freeze([
  'aclInventory',
  'directEdgeProbe',
  'deploymentRevision',
  'backupRestore',
  'onsiteRehearsal',
  'tokenRevocation',
  'rollbackReadiness',
]);
const VALUE_OPTIONS = Object.freeze(new Set([
  '--template-output',
  '--input',
  '--output',
  '--release-run-id',
  '--source-commit',
  '--target-revision',
  '--environment',
]));
const FLAG_OPTIONS = Object.freeze(new Set(['--force', '--help']));
const ENVIRONMENT_FIELDS = Object.freeze([
  'id',
  'webOrigin',
  'supabaseProjectRef',
  'databaseTlsSpkiSha256',
  'organizationId',
  'assemblyId',
  'sessionId',
  'sessionSlug',
]);

export class OperatorPacketPreparationError extends Error {
  constructor(code, detail = '') {
    super(`0912 operator packet preparation failed: ${code}${detail ? ` (${detail})` : ''}`);
    this.name = 'OperatorPacketPreparationError';
    this.code = code;
  }
}

function normalizedPath(value) {
  const absolute = resolve(value);
  return process.platform === 'win32' ? absolute.toLowerCase() : absolute;
}

function checkedWorkspaceRoot(root, label) {
  const absoluteRoot = resolve(root);
  try {
    const stats = lstatSync(absoluteRoot);
    if (stats.isSymbolicLink() || !stats.isDirectory()) {
      throw new OperatorPacketPreparationError(`${label}_path_unsafe`);
    }
    if (normalizedPath(realpathSync(absoluteRoot)) !== normalizedPath(absoluteRoot)) {
      throw new OperatorPacketPreparationError(`${label}_path_unsafe`);
    }
  } catch (error) {
    if (error instanceof OperatorPacketPreparationError) throw error;
    throw new OperatorPacketPreparationError(`${label}_path_unsafe`);
  }
  return absoluteRoot;
}

function safeWorkspacePath(root, value, label, { allowMissing = false } = {}) {
  if (typeof value !== 'string' || value.trim() === '' || isAbsolute(value)) {
    throw new OperatorPacketPreparationError(`${label}_path_invalid`);
  }
  const absoluteRoot = checkedWorkspaceRoot(root, label);
  const absolutePath = resolve(absoluteRoot, value);
  const fromRoot = relative(absoluteRoot, absolutePath);
  if (fromRoot === '' || fromRoot.startsWith('..') || isAbsolute(fromRoot)) {
    throw new OperatorPacketPreparationError(`${label}_path_invalid`);
  }
  const segments = fromRoot.split(/[\\/]/u);
  let cursor = absoluteRoot;
  for (let index = 0; index < segments.length; index += 1) {
    cursor = resolve(cursor, segments[index]);
    try {
      const stats = lstatSync(cursor);
      if (stats.isSymbolicLink()
        || normalizedPath(realpathSync(cursor)) !== normalizedPath(cursor)
        || (index < segments.length - 1 && !stats.isDirectory())) {
        throw new OperatorPacketPreparationError(`${label}_path_unsafe`);
      }
    } catch (error) {
      if (error instanceof OperatorPacketPreparationError) throw error;
      if (allowMissing && error?.code === 'ENOENT') break;
      throw new OperatorPacketPreparationError(`${label}_path_unsafe`);
    }
  }
  return absolutePath;
}

function fileIdentity(stats) {
  return Object.freeze({
    device: stats.dev,
    inode: stats.ino,
    size: stats.size,
    modifiedAtNanoseconds: stats.mtimeNs,
    changedAtNanoseconds: stats.ctimeNs,
  });
}

function fileIdentityMatches(stats, identity) {
  return stats.dev === identity.device
    && stats.ino === identity.inode
    && stats.size === identity.size
    && stats.mtimeNs === identity.modifiedAtNanoseconds
    && stats.ctimeNs === identity.changedAtNanoseconds;
}

function fileObjectAndContentMatches(stats, identity) {
  return stats.dev === identity.device
    && stats.ino === identity.inode
    && stats.size === identity.size
    && stats.mtimeNs === identity.modifiedAtNanoseconds;
}

function capturedIdentityMatches(left, right, allowCtimeDrift) {
  return left.device === right.device
    && left.inode === right.inode
    && left.size === right.size
    && left.modifiedAtNanoseconds === right.modifiedAtNanoseconds
    && (allowCtimeDrift || left.changedAtNanoseconds === right.changedAtNanoseconds);
}

function captureWorkspaceRegularFile(root, path, label, maxBytes) {
  const absolutePath = safeWorkspacePath(root, path, label);
  let descriptor;
  try {
    const pathStats = lstatSync(absolutePath, { bigint: true });
    if (pathStats.isSymbolicLink()
      || !pathStats.isFile()
      || pathStats.size <= 0n
      || pathStats.size > BigInt(maxBytes)
      || normalizedPath(realpathSync(absolutePath)) !== normalizedPath(absolutePath)) {
      throw new OperatorPacketPreparationError(`${label}_not_regular_file`, path);
    }
    const identity = fileIdentity(pathStats);
    descriptor = openSync(absolutePath, 'r');
    if (!fileIdentityMatches(fstatSync(descriptor, { bigint: true }), identity)) {
      throw new OperatorPacketPreparationError(`${label}_changed_during_read`, path);
    }
    const bytes = readFileSync(descriptor);
    if (bytes.byteLength !== Number(identity.size)
      || !fileIdentityMatches(fstatSync(descriptor, { bigint: true }), identity)) {
      throw new OperatorPacketPreparationError(`${label}_changed_during_read`, path);
    }
    return Object.freeze({ bytes, identity });
  } catch (error) {
    if (error instanceof OperatorPacketPreparationError) throw error;
    throw new OperatorPacketPreparationError(`${label}_unreadable`, path);
  } finally {
    if (descriptor !== undefined) {
      try {
        closeSync(descriptor);
      } catch {
        throw new OperatorPacketPreparationError(`${label}_close_failed`, path);
      }
    }
  }
}

function readWorkspaceRegularFile(root, path, label, maxBytes) {
  return captureWorkspaceRegularFile(root, path, label, maxBytes).bytes;
}

function readEnvironment(root, environmentPath) {
  let environment;
  try {
    environment = JSON.parse(readWorkspaceRegularFile(
      root,
      environmentPath,
      'environment',
      MAX_ENVIRONMENT_FILE_BYTES,
    ).toString('utf8'));
  } catch (error) {
    if (error instanceof OperatorPacketPreparationError) throw error;
    throw new OperatorPacketPreparationError(
      'environment_unreadable',
      error instanceof Error ? error.message : String(error),
    );
  }
  if (!isProductionEnvironment(environment)) {
    throw new OperatorPacketPreparationError('environment_schema_or_safety_invalid');
  }
  return environment;
}

function isProductionEnvironment(environment) {
  const keys = environment !== null && typeof environment === 'object' && !Array.isArray(environment)
    ? Object.keys(environment).sort()
    : [];
  if (JSON.stringify(keys) !== JSON.stringify([...ENVIRONMENT_FIELDS].sort())
    || contains0912SensitiveMaterial(environment)) return false;
  let originValid = false;
  try {
    const origin = new URL(environment.webOrigin);
    originValid = origin.protocol === 'https:' && origin.origin === environment.webOrigin;
  } catch {
    originValid = false;
  }
  return ENVIRONMENT_ID_PATTERN.test(environment.id ?? '')
    && originValid
    && SUPABASE_PROJECT_REF_PATTERN.test(environment.supabaseProjectRef ?? '')
    && SHA256_PATTERN.test(environment.databaseTlsSpkiSha256 ?? '')
    && UUID_PATTERN.test(environment.organizationId ?? '')
    && UUID_PATTERN.test(environment.assemblyId ?? '')
    && UUID_PATTERN.test(environment.sessionId ?? '')
    && new Set([
      environment.organizationId,
      environment.assemblyId,
      environment.sessionId,
    ]).size === 3
    && environment.sessionSlug === '0912-deliberation';
}

function artifactSha256(root, path) {
  const bytes = readWorkspaceRegularFile(root, path, 'artifact', MAX_BOUND_ARTIFACT_BYTES);
  return Object.freeze({
    sha256: createHash('sha256').update(bytes).digest('hex'),
    size: bytes.byteLength,
  });
}

function bindPacketArtifacts(root, packet) {
  let totalBytes = 0;
  packet.artifactBindings = CANONICAL_0912_OPERATOR_BINDING_PATHS.map((path) => {
    const artifact = artifactSha256(root, path);
    totalBytes += artifact.size;
    if (totalBytes > MAX_BOUND_ARTIFACT_TOTAL_BYTES) {
      throw new OperatorPacketPreparationError('artifact_total_size_exceeded');
    }
    return { path, sha256: artifact.sha256 };
  });
  return packet;
}

function bindPacketArtifactsWithPreparedBytes(root, packet, preparedBytes) {
  let totalBytes = 0;
  packet.artifactBindings = CANONICAL_0912_OPERATOR_BINDING_PATHS.map((path) => {
    const bytes = preparedBytes.get(path);
    const artifact = bytes === undefined
      ? artifactSha256(root, path)
      : {
          sha256: createHash('sha256').update(bytes).digest('hex'),
          size: bytes.byteLength,
        };
    totalBytes += artifact.size;
    if (totalBytes > MAX_BOUND_ARTIFACT_TOTAL_BYTES) {
      throw new OperatorPacketPreparationError('artifact_total_size_exceeded');
    }
    return { path, sha256: artifact.sha256 };
  });
  return packet;
}

export function prepare0912OperatorPacket({
  root = PROJECT_ROOT,
  releaseRunId,
  sourceCommit,
  targetRevision,
  productionEnvironment,
}) {
  if (!UUID_PATTERN.test(releaseRunId ?? '')) {
    throw new OperatorPacketPreparationError('release_run_id_invalid');
  }
  if (!FULL_COMMIT_PATTERN.test(sourceCommit ?? '')) {
    throw new OperatorPacketPreparationError('source_commit_invalid');
  }
  if (!FULL_COMMIT_PATTERN.test(targetRevision ?? '')) {
    throw new OperatorPacketPreparationError('target_revision_invalid');
  }
  if (!isProductionEnvironment(productionEnvironment)) {
    throw new OperatorPacketPreparationError('production_environment_invalid');
  }
  const packet = create0912OperatorEvidenceTemplate({
    releaseRunId,
    sourceCommit,
    targetRevision,
    productionEnvironment,
  });
  return bindPacketArtifacts(root, packet);
}

function parseArguments(argv) {
  const values = new Map();
  const flags = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (FLAG_OPTIONS.has(argument)) {
      if (flags.has(argument)) {
        throw new OperatorPacketPreparationError('argument_duplicate', argument);
      }
      flags.add(argument);
      continue;
    }
    if (!VALUE_OPTIONS.has(argument)
      || index + 1 >= argv.length
      || argv[index + 1].startsWith('--')) {
      throw new OperatorPacketPreparationError('arguments_invalid', argument);
    }
    if (values.has(argument)) throw new OperatorPacketPreparationError('argument_duplicate', argument);
    values.set(argument, argv[index + 1]);
    index += 1;
  }
  return { values, flags };
}

function ensureSafeOutputParent(root, outputPath) {
  const absoluteRoot = checkedWorkspaceRoot(root, 'output');
  const relativeParent = relative(absoluteRoot, dirname(outputPath));
  let cursor = absoluteRoot;
  for (const segment of relativeParent.split(/[\\/]/u).filter(Boolean)) {
    cursor = resolve(cursor, segment);
    try {
      const stats = lstatSync(cursor);
      if (stats.isSymbolicLink()
        || !stats.isDirectory()
        || normalizedPath(realpathSync(cursor)) !== normalizedPath(cursor)) {
        throw new OperatorPacketPreparationError('output_parent_unsafe');
      }
    } catch (error) {
      if (error instanceof OperatorPacketPreparationError) throw error;
      if (error?.code !== 'ENOENT') {
        throw new OperatorPacketPreparationError('output_parent_unsafe');
      }
      try {
        mkdirSync(cursor, { mode: 0o700 });
        const createdStats = lstatSync(cursor);
        if (createdStats.isSymbolicLink()
          || !createdStats.isDirectory()
          || normalizedPath(realpathSync(cursor)) !== normalizedPath(cursor)) {
          throw new OperatorPacketPreparationError('output_parent_unsafe');
        }
      } catch (createError) {
        if (createError instanceof OperatorPacketPreparationError) throw createError;
        throw new OperatorPacketPreparationError('output_parent_unsafe');
      }
    }
  }
  return cursor;
}

function normalizedWorkspaceRelativePath(root, path) {
  const value = relative(resolve(root), resolve(path)).replaceAll('\\', '/');
  return process.platform === 'win32' ? value.toLowerCase() : value;
}

function sha256Bytes(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function captureTransactionFile(root, path, label) {
  return captureWorkspaceRegularFile(
    root,
    normalizedWorkspaceRelativePath(root, path),
    label,
    MAX_OUTPUT_BYTES,
  );
}

function transactionFileMatches(root, path, identity, sha256, allowCtimeDrift = false) {
  try {
    const captured = captureTransactionFile(root, path, 'transaction_file');
    const identityMatches = capturedIdentityMatches(
      captured.identity,
      identity,
      allowCtimeDrift,
    );
    return identityMatches && sha256Bytes(captured.bytes) === sha256;
  } catch {
    return false;
  }
}

function assertOutputDoesNotOverlapInputs(root, outputPath, inputPaths = []) {
  const absoluteOutput = safeWorkspacePath(root, outputPath, 'output', { allowMissing: true });
  const outputRelative = normalizedWorkspaceRelativePath(root, absoluteOutput);
  const protectedPaths = [
    ...CANONICAL_0912_OPERATOR_BINDING_PATHS,
    SIGNED_OPERATOR_EVIDENCE_PATH,
    ...inputPaths,
  ]
    .map((path) => normalizedWorkspaceRelativePath(root, resolve(root, path)));
  if (protectedPaths.includes(outputRelative)) {
    throw new OperatorPacketPreparationError('output_overlaps_input', outputPath);
  }
}

function assertAllowedCliStagingPath(root, path, label) {
  const absolutePath = safeWorkspacePath(root, path, label, { allowMissing: true });
  const relativePath = normalizedWorkspaceRelativePath(root, absolutePath);
  const normalizedPrefix = process.platform === 'win32'
    ? OPERATOR_STAGING_PREFIX.toLowerCase()
    : OPERATOR_STAGING_PREFIX;
  if (!relativePath.startsWith(normalizedPrefix)
    || relativePath.length <= normalizedPrefix.length
    || !relativePath.endsWith('.json')) {
    throw new OperatorPacketPreparationError(`${label}_path_not_allowed`, path);
  }
}

function assertAllowedTemplateOutput(root, path) {
  const absolutePath = safeWorkspacePath(root, path, 'output', { allowMissing: true });
  const relativePath = normalizedWorkspaceRelativePath(root, absolutePath);
  const canonicalTemplate = process.platform === 'win32'
    ? CANONICAL_OPERATOR_TEMPLATE_PATH.toLowerCase()
    : CANONICAL_OPERATOR_TEMPLATE_PATH;
  if (relativePath !== canonicalTemplate) {
    assertAllowedCliStagingPath(root, path, 'output');
  }
}

function preflightWritableJsonOutput(root, outputPath, force) {
  const requestedPath = safeWorkspacePath(root, outputPath, 'output', { allowMissing: true });
  const parent = ensureSafeOutputParent(root, requestedPath);
  const path = resolve(parent, basename(requestedPath));
  if (!existsSync(path)) return path;
  if (!force) throw new OperatorPacketPreparationError('output_exists', outputPath);
  try {
    const stats = lstatSync(path);
    if (stats.isSymbolicLink()
      || !stats.isFile()
      || normalizedPath(realpathSync(path)) !== normalizedPath(path)) {
      throw new OperatorPacketPreparationError('output_path_unsafe', outputPath);
    }
  } catch (error) {
    if (error instanceof OperatorPacketPreparationError) throw error;
    throw new OperatorPacketPreparationError('output_path_unsafe', outputPath);
  }
  return path;
}

function readOperatorDraft(root, inputPath) {
  let draft;
  try {
    draft = JSON.parse(readWorkspaceRegularFile(
      root,
      inputPath,
      'input',
      MAX_OUTPUT_BYTES,
    ).toString('utf8'));
  } catch (error) {
    if (error instanceof OperatorPacketPreparationError) throw error;
    throw new OperatorPacketPreparationError('input_json_invalid');
  }
  return draft;
}

function operatorReceiptPayloads(operator) {
  const coordinates = [
    ...CANONICAL_0912_GATE_IDS.map((id, index) => ({
      kind: 'gate',
      id,
      index,
      recordedAt: operator.gates?.[index]?.executedAt,
      record: operator.gates?.[index],
    })),
    ...CANONICAL_0912_ROLLOUT_IDS.map((id, index) => ({
      kind: 'rollout',
      id,
      index,
      recordedAt: operator.rolloutSteps?.[index]?.executedAt,
      record: operator.rolloutSteps?.[index],
    })),
    ...CANONICAL_0912_CONTROL_RECEIPT_IDS.map((id, index) => ({
      kind: 'control',
      id,
      index,
      recordedAt: operator.controls?.[CONTROL_NAMES[index]]?.checkedAt,
      record: operator.controls?.[CONTROL_NAMES[index]],
    })),
  ];
  return coordinates.map((coordinate) => ({
    path: canonical0912OperatorReceiptPath(
      coordinate.kind,
      coordinate.index,
      coordinate.id,
    ),
    payload: {
      schemaVersion: 1,
      evidenceType: `0912-${coordinate.kind}-${coordinate.id}-receipt-v1`,
      releaseRunId: operator.releaseRunId,
      sourceCommit: operator.sourceCommit,
      targetRevision: operator.targetRevision,
      productionEnvironmentId: operator.productionEnvironment?.id,
      kind: coordinate.kind,
      id: coordinate.id,
      recordedAt: coordinate.recordedAt,
      record: coordinate.record,
    },
  }));
}

export function finalize0912OperatorPacket({
  root = PROJECT_ROOT,
  draft,
  force = false,
  verifiedAt = new Date().toISOString(),
  outputPath,
}) {
  if (draft === null || typeof draft !== 'object' || Array.isArray(draft)) {
    throw new OperatorPacketPreparationError('input_schema_invalid');
  }
  if (!Array.isArray(draft.artifactBindings)
    || draft.artifactBindings.length !== CANONICAL_0912_OPERATOR_BINDING_PATHS.length
    || draft.artifactBindings.some((binding, index) => (
      binding?.path !== CANONICAL_0912_OPERATOR_BINDING_PATHS[index]
    ))) {
    throw new OperatorPacketPreparationError('input_binding_paths_invalid');
  }
  if (draft.attestation !== null) {
    throw new OperatorPacketPreparationError('input_already_signed');
  }
  const packet = structuredClone(draft);
  packet.artifactBindings = CANONICAL_0912_OPERATOR_BINDING_PATHS.map((path) => ({
    path,
    sha256: '0'.repeat(64),
  }));
  validate0912UnsignedOperatorEvidence({
    operator: packet,
    expectedSourceCommit: packet.sourceCommit,
    expectedTargetRevision: packet.targetRevision,
    expectedReleaseRunId: packet.releaseRunId,
    expectedProductionEnvironment: packet.productionEnvironment,
    expectedGateIds: CANONICAL_0912_GATE_IDS,
    expectedRolloutIds: CANONICAL_0912_ROLLOUT_IDS,
    verifiedAt,
  });

  const receipts = operatorReceiptPayloads(packet);
  const receiptBytes = new Map(receipts.map((receipt) => [
    receipt.path,
    serializeJson(receipt.payload),
  ]));
  for (const path of CANONICAL_0912_RELEASE_ARTIFACT_PATHS) artifactSha256(root, path);
  bindPacketArtifactsWithPreparedBytes(root, packet, receiptBytes);
  validate0912UnsignedOperatorEvidence({
    operator: packet,
    expectedSourceCommit: packet.sourceCommit,
    expectedTargetRevision: packet.targetRevision,
    expectedReleaseRunId: packet.releaseRunId,
    expectedProductionEnvironment: packet.productionEnvironment,
    expectedGateIds: CANONICAL_0912_GATE_IDS,
    expectedRolloutIds: CANONICAL_0912_ROLLOUT_IDS,
    verifiedAt,
  });
  const writes = receipts.map((receipt) => ({ path: receipt.path, payload: receipt.payload }));
  if (outputPath !== undefined) {
    assertOutputDoesNotOverlapInputs(root, outputPath);
    writes.push({ path: outputPath, payload: packet });
  }
  commitJsonTransaction(root, writes, force);
  return packet;
}

function serializeJson(payload) {
  const bytes = Buffer.from(`${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  if (bytes.byteLength <= 0 || bytes.byteLength > MAX_OUTPUT_BYTES) {
    throw new OperatorPacketPreparationError('output_size_invalid');
  }
  return bytes;
}

function writeJson(root, outputPath, payload, force) {
  const requestedPath = safeWorkspacePath(root, outputPath, 'output', { allowMissing: true });
  const parent = ensureSafeOutputParent(root, requestedPath);
  const path = resolve(parent, basename(requestedPath));
  const bytes = serializeJson(payload);

  let existingIdentity = null;
  if (existsSync(path)) {
    if (!force) throw new OperatorPacketPreparationError('output_exists');
    try {
      const stats = lstatSync(path, { bigint: true });
      if (stats.isSymbolicLink()
        || !stats.isFile()
        || normalizedPath(realpathSync(path)) !== normalizedPath(path)) {
        throw new OperatorPacketPreparationError('output_path_unsafe');
      }
      existingIdentity = fileIdentity(stats);
    } catch (error) {
      if (error instanceof OperatorPacketPreparationError) throw error;
      throw new OperatorPacketPreparationError('output_path_unsafe');
    }
  }

  const temporaryPath = resolve(
    parent,
    `.${basename(path)}.${randomBytes(12).toString('hex')}.tmp`,
  );
  let descriptor;
  try {
    descriptor = openSync(temporaryPath, 'wx', 0o600);
    writeFileSync(descriptor, bytes);
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;

    const finalParentStats = lstatSync(parent);
    if (finalParentStats.isSymbolicLink()
      || !finalParentStats.isDirectory()
      || normalizedPath(realpathSync(parent)) !== normalizedPath(parent)) {
      throw new OperatorPacketPreparationError('output_parent_unsafe');
    }

    if (existingIdentity !== null) {
      const currentStats = lstatSync(path, { bigint: true });
      if (currentStats.isSymbolicLink()
        || !currentStats.isFile()
        || !fileIdentityMatches(currentStats, existingIdentity)) {
        throw new OperatorPacketPreparationError('output_changed_before_replace');
      }
      renameSync(temporaryPath, path);
    } else {
      // A hard link is the portable exclusive-create primitive here. Even with
      // --force, a path that did not exist at preflight must never overwrite a
      // file created concurrently after that check.
      linkSync(temporaryPath, path);
      unlinkSync(temporaryPath);
    }
    return path;
  } catch (error) {
    if (error?.code === 'EEXIST') {
      throw new OperatorPacketPreparationError('output_exists');
    }
    if (error instanceof OperatorPacketPreparationError) throw error;
    throw new OperatorPacketPreparationError(
      'output_write_failed',
      error instanceof Error ? error.message : String(error),
    );
  } finally {
    if (descriptor !== undefined) {
      try {
        closeSync(descriptor);
      } catch {
        // A write failure is already reported below; cleanup remains fail-closed.
      }
    }
    try {
      if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
    } catch {
      // The destination was not reported as successful when temporary cleanup fails.
    }
  }
}

function commitJsonTransaction(root, writes, force) {
  const paths = writes.map((write) => normalizedWorkspaceRelativePath(
    root,
    safeWorkspacePath(root, write.path, 'output', { allowMissing: true }),
  ));
  if (new Set(paths).size !== paths.length) {
    throw new OperatorPacketPreparationError('transaction_output_duplicate');
  }
  const targets = writes.map((write) => {
    const target = preflightWritableJsonOutput(root, write.path, force);
    const existed = existsSync(target);
    const initial = existed
      ? captureTransactionFile(root, target, 'transaction_target')
      : null;
    return {
      ...write,
      target,
      existed,
      initialIdentity: initial?.identity ?? null,
      initialSha256: initial ? sha256Bytes(initial.bytes) : null,
    };
  });
  const transactionId = randomBytes(12).toString('hex');
  const staged = [];
  const applied = [];
  try {
    for (const [index, write] of targets.entries()) {
      const stagePath = `${dirname(write.path).replaceAll('\\', '/')}/.${basename(write.path)}.${transactionId}.${index}.stage`;
      writeJson(root, stagePath, write.payload, false);
      const absoluteStagePath = resolve(root, stagePath);
      const stage = captureTransactionFile(root, absoluteStagePath, 'transaction_stage');
      const expectedStageSha256 = sha256Bytes(serializeJson(write.payload));
      if (sha256Bytes(stage.bytes) !== expectedStageSha256) {
        throw new OperatorPacketPreparationError('transaction_stage_content_changed');
      }
      staged.push({
        ...write,
        stagePath: absoluteStagePath,
        stageIdentity: stage.identity,
        stageSha256: expectedStageSha256,
        backupPath: null,
      });
    }
  } catch (error) {
    for (const write of staged) {
      try {
        if (existsSync(write.stagePath)) unlinkSync(write.stagePath);
      } catch {
        // The transaction never touched a target; a stale stage is safe to inspect and remove.
      }
    }
    if (error instanceof OperatorPacketPreparationError) throw error;
    throw new OperatorPacketPreparationError(
      'receipt_transaction_staging_failed',
      error instanceof Error ? error.message : String(error),
    );
  }

  try {
    for (const write of staged) {
      preflightWritableJsonOutput(root, write.path, force);
      const targetExists = existsSync(write.target);
      if (targetExists !== write.existed
        || (targetExists && !transactionFileMatches(
          root,
          write.target,
          write.initialIdentity,
          write.initialSha256,
        ))
        || !transactionFileMatches(
          root,
          write.stagePath,
          write.stageIdentity,
          write.stageSha256,
        )) {
        throw new OperatorPacketPreparationError('transaction_file_changed_before_commit');
      }
      const backupPath = write.existed
        ? resolve(dirname(write.target), `.${basename(write.target)}.${transactionId}.backup`)
        : null;
      const state = {
        ...write,
        backupPath,
        backupIdentity: write.initialIdentity,
        installed: false,
        installedIdentity: null,
      };
      applied.push(state);
      if (backupPath !== null) {
        renameSync(write.target, backupPath);
        const backupStats = lstatSync(backupPath, { bigint: true });
        if (!backupStats.isFile()
          || !fileObjectAndContentMatches(backupStats, write.initialIdentity)
          || !transactionFileMatches(
            root,
            backupPath,
            write.initialIdentity,
            write.initialSha256,
            true,
          )) {
          throw new OperatorPacketPreparationError('transaction_backup_file_changed');
        }
        state.backupIdentity = fileIdentity(backupStats);
      }
      if (write.existed) {
        renameSync(write.stagePath, write.target);
        state.installed = true;
      } else {
        // Preserve a concurrently created target. linkSync fails with EEXIST
        // instead of replacing bytes that were absent during preflight.
        linkSync(write.stagePath, write.target);
        state.installed = true;
        unlinkSync(write.stagePath);
      }
      const installedStats = lstatSync(write.target, { bigint: true });
      if (installedStats.isSymbolicLink()
        || !installedStats.isFile()
        || normalizedPath(realpathSync(write.target)) !== normalizedPath(write.target)
        || !fileObjectAndContentMatches(installedStats, write.stageIdentity)
        || !transactionFileMatches(
          root,
          write.target,
          write.stageIdentity,
          write.stageSha256,
          true,
        )) {
        throw new OperatorPacketPreparationError('transaction_installed_file_changed');
      }
      state.installedIdentity = fileIdentity(installedStats);
    }
  } catch (error) {
    let rollbackFailed = false;
    for (const write of [...applied].reverse()) {
      try {
        if (write.installed && existsSync(write.target)) {
          const current = lstatSync(write.target, { bigint: true });
          const expectedIdentity = write.installedIdentity ?? write.stageIdentity;
          if (current.isSymbolicLink()
            || !current.isFile()
            || normalizedPath(realpathSync(write.target)) !== normalizedPath(write.target)
            || !fileObjectAndContentMatches(current, expectedIdentity)
            || !transactionFileMatches(
              root,
              write.target,
              expectedIdentity,
              write.stageSha256,
              true,
            )) {
            rollbackFailed = true;
            continue;
          }
          unlinkSync(write.target);
        }
        if (write.backupPath !== null && existsSync(write.backupPath)) {
          const backup = lstatSync(write.backupPath, { bigint: true });
          if (backup.isSymbolicLink()
            || !backup.isFile()
            || normalizedPath(realpathSync(write.backupPath)) !== normalizedPath(write.backupPath)
            || !fileObjectAndContentMatches(backup, write.backupIdentity)
            || !transactionFileMatches(
              root,
              write.backupPath,
              write.backupIdentity,
              write.initialSha256,
              true,
            )
            || existsSync(write.target)) {
            rollbackFailed = true;
            continue;
          }
          // Restore with exclusive creation so a concurrent recovery writer is
          // preserved instead of being replaced between the check and commit.
          linkSync(write.backupPath, write.target);
          unlinkSync(write.backupPath);
        }
      } catch {
        rollbackFailed = true;
      }
    }
    for (const write of staged) {
      try {
        if (existsSync(write.stagePath)) unlinkSync(write.stagePath);
      } catch {
        rollbackFailed = true;
      }
    }
    if (rollbackFailed) {
      throw new OperatorPacketPreparationError('receipt_transaction_rollback_failed');
    }
    if (error instanceof OperatorPacketPreparationError) throw error;
    throw new OperatorPacketPreparationError(
      'receipt_transaction_failed',
      error instanceof Error ? error.message : String(error),
    );
  }

  let cleanupFailed = false;
  for (const write of staged) {
    try {
      if (existsSync(write.stagePath)) unlinkSync(write.stagePath);
    } catch {
      cleanupFailed = true;
    }
  }
  for (const write of applied) {
    try {
      if (write.backupPath !== null && existsSync(write.backupPath)) {
        const backup = lstatSync(write.backupPath, { bigint: true });
        if (backup.isSymbolicLink()
          || !backup.isFile()
          || normalizedPath(realpathSync(write.backupPath)) !== normalizedPath(write.backupPath)
          || !fileObjectAndContentMatches(backup, write.backupIdentity)
          || !transactionFileMatches(
            root,
            write.backupPath,
            write.backupIdentity,
            write.initialSha256,
            true,
          )) {
          cleanupFailed = true;
          continue;
        }
        unlinkSync(write.backupPath);
      }
    } catch {
      cleanupFailed = true;
    }
  }
  if (cleanupFailed) {
    console.warn('0912 operator packet transaction committed; temporary backup cleanup is incomplete');
  }
}

function printUsage() {
  console.log([
    'Canonical template:',
    '  node scripts/prepare-0912-operator-packet.mjs --template-output evaluation/0912-13-operator-log.template.json --force',
    '',
    'Prepared unsigned packet (all 68 bound files must already exist):',
    '  node scripts/prepare-0912-operator-packet.mjs --output <relative-json> --release-run-id <uuid> --source-commit <40hex> --target-revision <40hex> --environment <relative-json>',
    '',
    'Finalize a filled draft (creates 56 receipts and binds all 68 files):',
    '  node scripts/prepare-0912-operator-packet.mjs --input <filled-draft-json> --output <final-unsigned-json> [--force]',
  ].join('\n'));
}

export function runPrepare0912OperatorPacketCli(argv = process.argv.slice(2), root = PROJECT_ROOT) {
  const { values, flags } = parseArguments(argv);
  if (flags.has('--help')) {
    if (values.size !== 0 || flags.size !== 1) {
      throw new OperatorPacketPreparationError('help_arguments_invalid');
    }
    printUsage();
    return 0;
  }
  const templateOutput = values.get('--template-output');
  if (templateOutput) {
    if (values.size !== 1) throw new OperatorPacketPreparationError('template_arguments_invalid');
    assertOutputDoesNotOverlapInputs(root, templateOutput);
    assertAllowedTemplateOutput(root, templateOutput);
    const path = writeJson(
      root,
      templateOutput,
      create0912OperatorEvidenceTemplate(),
      flags.has('--force'),
    );
    console.log(`canonical operator template written: ${path}`);
    return 0;
  }
  const input = values.get('--input');
  if (input) {
    if (values.size !== 2 || !values.has('--output')) {
      throw new OperatorPacketPreparationError('finalize_arguments_invalid');
    }
    const inputRelative = normalizedWorkspaceRelativePath(root, resolve(root, input));
    const boundPaths = CANONICAL_0912_OPERATOR_BINDING_PATHS
      .map((path) => normalizedWorkspaceRelativePath(root, resolve(root, path)));
    if (boundPaths.includes(inputRelative)) {
      throw new OperatorPacketPreparationError('input_overlaps_generated_evidence');
    }
    assertAllowedCliStagingPath(root, input, 'input');
    assertOutputDoesNotOverlapInputs(root, values.get('--output'), [input]);
    assertAllowedCliStagingPath(root, values.get('--output'), 'output');
    const packet = finalize0912OperatorPacket({
      root,
      draft: readOperatorDraft(root, input),
      force: flags.has('--force'),
      outputPath: values.get('--output'),
    });
    const path = resolve(root, values.get('--output'));
    console.log(`final unsigned operator packet written: ${path}`);
    console.log(`receipts created: ${CANONICAL_0912_GATE_IDS.length + CANONICAL_0912_ROLLOUT_IDS.length + CANONICAL_0912_CONTROL_RECEIPT_IDS.length}`);
    console.log(`artifact bindings: ${packet.artifactBindings.length}`);
    return 0;
  }
  const expectedOptions = [
    '--output',
    '--release-run-id',
    '--source-commit',
    '--target-revision',
    '--environment',
  ];
  if (values.size !== expectedOptions.length
    || expectedOptions.some((option) => !values.has(option))) {
    throw new OperatorPacketPreparationError('required_arguments_missing');
  }
  assertOutputDoesNotOverlapInputs(root, values.get('--output'), [values.get('--environment')]);
  assertAllowedCliStagingPath(root, values.get('--output'), 'output');
  const packet = prepare0912OperatorPacket({
    root,
    releaseRunId: values.get('--release-run-id'),
    sourceCommit: values.get('--source-commit'),
    targetRevision: values.get('--target-revision'),
    productionEnvironment: readEnvironment(root, values.get('--environment')),
  });
  const path = writeJson(root, values.get('--output'), packet, flags.has('--force'));
  console.log(`unsigned operator packet prepared: ${path}`);
  console.log(`artifact bindings: ${packet.artifactBindings.length}`);
  console.log('operational results remain not_run; fill receipts and approvals before signing');
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = runPrepare0912OperatorPacketCli();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
