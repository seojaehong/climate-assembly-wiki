import { randomUUID } from 'node:crypto';
import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { link } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyOrganizationAccessProvisioningExecutionReceipt } from './platform-access-provisioning-plan.mjs';

const REPO_ROOT = realpathSync.native(fileURLToPath(new URL('..', import.meta.url)));
const STORE_MARKER = '.platform-access-provisioning-rehearsal-store.json';
const RECEIPT_DIRECTORY = 'receipts';
const MAX_RECEIPT_BYTES = 1024 * 1024;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const KEY_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{2,79}$/;
const MARKER = Object.freeze({
  schemaVersion: 1,
  kind: 'platform_access_provisioning_local_receipt_store',
  receiptPublication: 'immutable_hard_link_v1',
  localRehearsalOnly: true,
  productionAdapter: false,
  databaseMutationExecuted: false,
  authMutationExecuted: false,
  invitationDeliveryExecuted: false,
});

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (isRecord(value)) {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalValue(value[key])]));
  }
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(canonicalValue(value));
}

function isInside(parent, candidate) {
  const pathFromParent = relative(parent, candidate);
  return pathFromParent === ''
    || (!pathFromParent.startsWith('..') && !isAbsolute(pathFromParent));
}

function markerPath(root) {
  return resolve(root, STORE_MARKER);
}

function validateOwnedFile(directory, path, label) {
  if (!isInside(directory, path) || !existsSync(path)) throw new Error(`${label} is invalid`);
  let metadata;
  let actual;
  try {
    metadata = lstatSync(path);
    actual = realpathSync.native(path);
  } catch {
    throw new Error(`${label} is invalid`);
  }
  if (metadata.isSymbolicLink() || !metadata.isFile() || actual !== path) {
    throw new Error(`${label} is invalid`);
  }
  return path;
}

function validateMarker(root) {
  const path = validateOwnedFile(root, markerPath(root), 'Local access provisioning store marker');
  let marker;
  try {
    marker = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    throw new Error('Local access provisioning store marker is invalid');
  }
  if (canonicalJson(marker) !== canonicalJson(MARKER)) {
    throw new Error('Local access provisioning store marker is invalid');
  }
}

function resolveStoreRoot(directory, { markerRequired = false } = {}) {
  if (typeof directory !== 'string' || !isAbsolute(directory)) {
    throw new Error('Local access provisioning store directory must be absolute');
  }
  let root;
  try {
    root = realpathSync.native(directory);
  } catch {
    throw new Error('Local access provisioning store directory is unavailable');
  }
  let metadata;
  try {
    metadata = lstatSync(root);
  } catch {
    throw new Error('Local access provisioning store directory is unavailable');
  }
  if (!metadata.isDirectory()) {
    throw new Error('Local access provisioning store directory is invalid');
  }
  if (isInside(REPO_ROOT, root)) {
    throw new Error('Local access provisioning store must remain outside the repository');
  }
  if (markerRequired) validateMarker(root);
  return root;
}

function validateReceiptDirectory(root) {
  const path = resolve(root, RECEIPT_DIRECTORY);
  if (!isInside(root, path) || !existsSync(path)) {
    throw new Error('Local access provisioning receipt directory is invalid');
  }
  let metadata;
  let actual;
  try {
    metadata = lstatSync(path);
    actual = realpathSync.native(path);
  } catch {
    throw new Error('Local access provisioning receipt directory is invalid');
  }
  if (metadata.isSymbolicLink() || !metadata.isDirectory()
    || actual !== path || !isInside(root, actual)) {
    throw new Error('Local access provisioning receipt directory is invalid');
  }
  return path;
}

function writeExclusiveFile(path, text) {
  const descriptor = openSync(path, 'wx', 0o600);
  try {
    writeFileSync(descriptor, text, 'utf8');
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function validateAdapterOptions({ trustedKey, expectedKeyId, expectedPlanChecksum }) {
  if (typeof trustedKey !== 'string' || trustedKey.length < 32
    || !KEY_ID_PATTERN.test(expectedKeyId ?? '')
    || !SHA256_PATTERN.test(expectedPlanChecksum ?? '')) {
    throw new Error('Local access provisioning receipt adapter options are invalid');
  }
}

function receiptPath(directory, runId) {
  if (!UUID_PATTERN.test(runId ?? '')) {
    throw new Error('Local access provisioning receipt run ID is invalid');
  }
  const path = resolve(directory, `${runId}.json`);
  if (!isInside(directory, path)) {
    throw new Error('Local access provisioning receipt path is invalid');
  }
  return path;
}

function verifyReceipt(receipt, { trustedKey, expectedKeyId, expectedPlanChecksum, runId }) {
  let copy;
  try {
    copy = structuredClone(receipt);
    verifyOrganizationAccessProvisioningExecutionReceipt(copy, {
      trustedKey,
      expectedKeyId,
      expectedPlanChecksum,
    });
  } catch {
    throw new Error('Local access provisioning receipt is invalid');
  }
  if (copy.runId !== runId) throw new Error('Local access provisioning receipt is invalid');
  return copy;
}

function readReceiptFile(directory, runId, options) {
  const path = receiptPath(directory, runId);
  if (!existsSync(path)) return null;
  validateOwnedFile(directory, path, 'Local access provisioning receipt path');
  let bytes;
  try {
    bytes = readFileSync(path);
  } catch {
    throw new Error('Local access provisioning receipt could not be read');
  }
  if (bytes.length === 0 || bytes.length > MAX_RECEIPT_BYTES) {
    throw new Error('Local access provisioning receipt is invalid');
  }
  let receipt;
  try {
    receipt = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new Error('Local access provisioning receipt is invalid');
  }
  return verifyReceipt(receipt, { ...options, runId });
}

export function initializeLocalAccessProvisioningReceiptStore({ directory } = {}) {
  const root = resolveStoreRoot(directory);
  if (readdirSync(root).length !== 0) {
    throw new Error('Local access provisioning store directory must be empty');
  }
  const receipts = resolve(root, RECEIPT_DIRECTORY);
  mkdirSync(receipts, { mode: 0o700 });
  writeExclusiveFile(markerPath(root), `${JSON.stringify(MARKER, null, 2)}\n`);
  return {
    status: 'initialized',
    receiptPublication: MARKER.receiptPublication,
    localRehearsalOnly: true,
    productionAdapter: false,
    databaseMutationExecuted: false,
  };
}

export function createLocalAccessProvisioningReceiptAdapter({
  directory,
  trustedKey,
  expectedKeyId,
  expectedPlanChecksum,
} = {}) {
  validateAdapterOptions({ trustedKey, expectedKeyId, expectedPlanChecksum });
  const root = resolveStoreRoot(directory, { markerRequired: true });
  validateReceiptDirectory(root);
  const options = { trustedKey, expectedKeyId, expectedPlanChecksum };

  const readReceipt = async (runId) => {
    const currentRoot = resolveStoreRoot(directory, { markerRequired: true });
    const receipts = validateReceiptDirectory(currentRoot);
    return readReceiptFile(receipts, runId, options);
  };

  const appendReceipt = async (receipt) => {
    const runId = receipt?.runId;
    const verified = verifyReceipt(receipt, { ...options, runId });
    const currentRoot = resolveStoreRoot(directory, { markerRequired: true });
    const receipts = validateReceiptDirectory(currentRoot);
    const destination = receiptPath(receipts, runId);
    const existing = readReceiptFile(receipts, runId, options);
    if (existing) {
      return {
        status: canonicalJson(existing) === canonicalJson(verified) ? 'existing' : 'conflict',
        runId,
      };
    }

    const text = `${JSON.stringify(verified, null, 2)}\n`;
    if (Buffer.byteLength(text, 'utf8') > MAX_RECEIPT_BYTES) {
      throw new Error('Local access provisioning receipt is invalid');
    }
    const temporary = resolve(receipts, `.tmp-${process.pid}-${randomUUID()}`);
    try {
      writeExclusiveFile(temporary, text);
      try {
        await link(temporary, destination);
      } catch (error) {
        if (!error || typeof error !== 'object' || error.code !== 'EEXIST') {
          throw new Error('Local access provisioning receipt could not be published');
        }
      }
    } finally {
      if (existsSync(temporary)) unlinkSync(temporary);
    }
    const published = readReceiptFile(receipts, runId, options);
    if (!published) throw new Error('Local access provisioning receipt could not be published');
    return {
      status: canonicalJson(published) === canonicalJson(verified) ? 'written' : 'conflict',
      runId,
    };
  };

  return Object.freeze({ readReceipt, appendReceipt });
}
