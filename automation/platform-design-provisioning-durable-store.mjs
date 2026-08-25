import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { link, open, readFile, readdir, unlink } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = realpathSync.native(fileURLToPath(new URL('..', import.meta.url)));
const STORE_MARKER = '.platform-design-provisioning-rehearsal-store.json';
const AUTHORIZATION_DIRECTORY = 'authorization';
const RECEIPT_DIRECTORY = 'receipts';
const MAX_RECORD_BYTES = 1024 * 1024;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const KEY_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{2,79}$/;
const AUTH_USER_PATTERN = /^auth-user:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const JOURNAL_FILE_PATTERN = /^(\d{12})\.json$/;
const FAILURE_CODES = Object.freeze([
  'design_auth_required',
  'design_join_code_exhausted',
  'design_operation_conflict',
  'design_operation_invalid',
  'design_parent_conflict',
  'design_plan_checksum_mismatch',
  'design_plan_invalid',
  'design_provision_failed',
  'design_resource_conflict',
  'design_role_forbidden',
  'design_source_mismatch',
  'design_summary_mismatch',
]);
const MARKER = Object.freeze({
  schemaVersion: 1,
  kind: 'platform_design_provisioning_local_rehearsal_store',
  authorizationCas: 'immutable_hard_link_v1',
  localRehearsalOnly: true,
  productionAdapter: false,
  productionCredentialAccessed: false,
  databaseMutationExecuted: false,
  rpcMutationExecuted: false,
});

export const LOCAL_DESIGN_PROVISIONING_STORE_BOUNDARIES = Object.freeze({
  authorizationCas: 'immutable_hard_link_v1',
  localRehearsalOnly: true,
  productionAdapter: false,
  productionCredentialAccessed: false,
  databaseMutationExecuted: false,
  rpcMutationExecuted: false,
});

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value, expected) {
  if (!isRecord(value)) return false;
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length
    && actual.every((key, index) => key === wanted[index]);
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

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function isInside(parent, candidate) {
  const pathFromParent = relative(parent, candidate);
  return pathFromParent === ''
    || (!pathFromParent.startsWith('..') && !isAbsolute(pathFromParent));
}

function resolveStoreRoot(directory, { markerRequired = false } = {}) {
  if (typeof directory !== 'string' || !isAbsolute(directory)) {
    throw new Error('Local design provisioning store directory must be absolute');
  }
  let root;
  try {
    root = realpathSync.native(directory);
  } catch {
    throw new Error('Local design provisioning store directory is unavailable');
  }
  if (!lstatSync(root).isDirectory()) {
    throw new Error('Local design provisioning store directory is invalid');
  }
  if (isInside(REPO_ROOT, root)) {
    throw new Error('Local design provisioning store must remain outside the repository');
  }
  if (markerRequired) verifyMarker(root);
  return root;
}

function markerPath(root) {
  return resolve(root, STORE_MARKER);
}

function verifyMarker(root) {
  const path = markerPath(root);
  if (!existsSync(path)
    || lstatSync(path).isSymbolicLink()
    || !lstatSync(path).isFile()
    || realpathSync.native(path) !== path) {
    throw new Error('Local design provisioning store marker is invalid');
  }
  let value;
  try {
    value = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    throw new Error('Local design provisioning store marker is invalid');
  }
  if (canonicalJson(value) !== canonicalJson(MARKER)) {
    throw new Error('Local design provisioning store marker is invalid');
  }
}

function ensureOwnedChild(root, name) {
  const expected = resolve(root, name);
  mkdirSync(expected, { recursive: true, mode: 0o700 });
  if (lstatSync(expected).isSymbolicLink() || !lstatSync(expected).isDirectory()) {
    throw new Error('Local design provisioning store layout is invalid');
  }
  const actual = realpathSync.native(expected);
  if (actual !== expected || !isInside(root, actual)) {
    throw new Error('Local design provisioning store layout is invalid');
  }
  return actual;
}

function validateOwnedFile(directory, path, label) {
  if (!isInside(directory, path)
    || !existsSync(path)
    || lstatSync(path).isSymbolicLink()
    || !lstatSync(path).isFile()
    || realpathSync.native(path) !== path) {
    throw new Error(`${label} path is invalid`);
  }
  return path;
}

function validateContext(context) {
  if (!exactKeys(context, [
    'userId', 'role', 'organizationId', 'targetHost',
    'membershipActive', 'organizationActive',
  ])
    || !AUTH_USER_PATTERN.test(context.userId ?? '')
    || !['org_admin', 'hq'].includes(context.role)
    || !UUID_PATTERN.test(context.organizationId ?? '')
    || !KEY_ID_PATTERN.test(context.targetHost ?? '')
    || typeof context.membershipActive !== 'boolean'
    || typeof context.organizationActive !== 'boolean') {
    throw new Error('Local design provisioning authorization context is invalid');
  }
  return structuredClone(context);
}

function validateClaim(claim, approvalId) {
  const baseKeys = [
    'approvalId', 'executionId', 'organizationId', 'targetHost', 'claimedBy',
    'claimedRole', 'planChecksum', 'status', 'claimedAt',
  ];
  const terminal = ['completed', 'failed'].includes(claim?.status);
  if (!exactKeys(claim, terminal ? [...baseKeys, 'finalizedAt'] : baseKeys)
    || claim.approvalId !== approvalId
    || !UUID_PATTERN.test(claim.executionId ?? '')
    || !UUID_PATTERN.test(claim.organizationId ?? '')
    || !KEY_ID_PATTERN.test(claim.targetHost ?? '')
    || !AUTH_USER_PATTERN.test(claim.claimedBy ?? '')
    || !['org_admin', 'hq'].includes(claim.claimedRole)
    || !SHA256_PATTERN.test(claim.planChecksum ?? '')
    || !['claimed', 'completed', 'failed'].includes(claim.status)
    || new Date(claim.claimedAt).toISOString() !== claim.claimedAt
    || (terminal && new Date(claim.finalizedAt).toISOString() !== claim.finalizedAt)) {
    throw new Error('Local design provisioning authorization claim is invalid');
  }
  return structuredClone(claim);
}

function validateState(state, approvalId) {
  if (!exactKeys(state, ['approvalId', 'revokedAt', 'claim'])
    || state.approvalId !== approvalId
    || (state.revokedAt !== null && new Date(state.revokedAt).toISOString() !== state.revokedAt)
    || (state.claim !== null && !isRecord(state.claim))) {
    throw new Error('Local design provisioning authorization state is invalid');
  }
  if (state.claim !== null) validateClaim(state.claim, approvalId);
  return structuredClone(state);
}

function authorizationRecord({ sequence, previousRecordSha256, state, context }) {
  const unsigned = {
    schemaVersion: 1,
    kind: 'platform_design_provisioning_local_authorization_record',
    sequence,
    previousRecordSha256,
    state: structuredClone(state),
    context: structuredClone(context),
    boundaries: LOCAL_DESIGN_PROVISIONING_STORE_BOUNDARIES,
  };
  return { ...unsigned, recordSha256: sha256(canonicalJson(unsigned)) };
}

function validateAuthorizationRecord(value, approvalId, sequence, previousRecordSha256) {
  if (!exactKeys(value, [
    'schemaVersion', 'kind', 'sequence', 'previousRecordSha256', 'state', 'context',
    'boundaries', 'recordSha256',
  ])
    || value.schemaVersion !== 1
    || value.kind !== 'platform_design_provisioning_local_authorization_record'
    || value.sequence !== sequence
    || value.previousRecordSha256 !== previousRecordSha256
    || canonicalJson(value.boundaries) !== canonicalJson(LOCAL_DESIGN_PROVISIONING_STORE_BOUNDARIES)
    || !SHA256_PATTERN.test(value.recordSha256 ?? '')) {
    throw new Error('Local design provisioning authorization journal is invalid');
  }
  validateState(value.state, approvalId);
  validateContext(value.context);
  const { recordSha256, ...unsigned } = value;
  if (sha256(canonicalJson(unsigned)) !== recordSha256) {
    throw new Error('Local design provisioning authorization journal integrity failed');
  }
  return value;
}

function readBoundedJsonSync(path, label) {
  let bytes;
  try {
    bytes = readFileSync(path);
  } catch {
    throw new Error(`${label} is unavailable`);
  }
  if (bytes.length === 0 || bytes.length > MAX_RECORD_BYTES) {
    throw new Error(`${label} violates the size boundary`);
  }
  try {
    return JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new Error(`${label} is malformed`);
  }
}

async function readBoundedJson(path, label) {
  let bytes;
  try {
    bytes = await readFile(path);
  } catch {
    throw new Error(`${label} is unavailable`);
  }
  if (bytes.length === 0 || bytes.length > MAX_RECORD_BYTES) {
    throw new Error(`${label} violates the size boundary`);
  }
  try {
    return JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new Error(`${label} is malformed`);
  }
}

async function publishImmutableJson(directory, filename, value) {
  const finalPath = resolve(directory, filename);
  const temporaryPath = resolve(directory, `.tmp-${process.pid}-${randomUUID()}`);
  const handle = await open(temporaryPath, 'wx', 0o600);
  try {
    await handle.writeFile(`${canonicalJson(value)}\n`, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await link(temporaryPath, finalPath);
    return true;
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'EEXIST') return false;
    throw error;
  } finally {
    try {
      await unlink(temporaryPath);
    } catch (error) {
      if (!error || typeof error !== 'object' || error.code !== 'ENOENT') throw error;
    }
  }
}

function approvalDirectory(root, approvalId) {
  if (!UUID_PATTERN.test(approvalId ?? '')) {
    throw new Error('Local design provisioning approval ID is invalid');
  }
  const authorizationRoot = ensureOwnedChild(root, AUTHORIZATION_DIRECTORY);
  const expected = resolve(authorizationRoot, approvalId);
  if (existsSync(expected)) {
    if (lstatSync(expected).isSymbolicLink()
      || !lstatSync(expected).isDirectory()
      || realpathSync.native(expected) !== expected
      || !isInside(authorizationRoot, expected)) {
      throw new Error('Local design provisioning authorization directory is invalid');
    }
  }
  return expected;
}

async function readAuthorizationJournal(root, approvalId) {
  const directory = approvalDirectory(root, approvalId);
  let names;
  try {
    names = await readdir(directory);
  } catch {
    throw new Error('Local design provisioning authorization state is unavailable');
  }
  const records = names
    .map((name) => ({ name, match: JOURNAL_FILE_PATTERN.exec(name) }))
    .filter(({ match }) => match)
    .sort((left, right) => left.name.localeCompare(right.name));
  if (names.some((name) => !JOURNAL_FILE_PATTERN.test(name)
    && !/^\.tmp-[0-9]+-[0-9a-f-]{36}$/.test(name))) {
    throw new Error('Local design provisioning authorization journal contains an unexpected entry');
  }
  if (records.length === 0) {
    throw new Error('Local design provisioning authorization state is unavailable');
  }
  let previousRecordSha256 = null;
  let latest = null;
  for (const [index, { name, match }] of records.entries()) {
    if (Number(match[1]) !== index) {
      throw new Error('Local design provisioning authorization journal is not contiguous');
    }
    latest = validateAuthorizationRecord(
      await readBoundedJson(
        validateOwnedFile(
          directory,
          resolve(directory, name),
          'Local design provisioning authorization record',
        ),
        'Local design provisioning authorization record',
      ),
      approvalId,
      index,
      previousRecordSha256,
    );
    previousRecordSha256 = latest.recordSha256;
  }
  return latest;
}

async function compareAndAppendAuthorization(root, expectedSnapshot, operation, transition) {
  if (!exactKeys(expectedSnapshot, ['state', 'context']) || !isRecord(expectedSnapshot.state)) {
    throw new Error(`Local design provisioning authorization ${operation} is invalid`);
  }
  const approvalId = expectedSnapshot.state.approvalId;
  validateState(expectedSnapshot.state, approvalId);
  validateContext(expectedSnapshot.context);
  const directory = approvalDirectory(root, approvalId);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  approvalDirectory(root, approvalId);
  const current = await readAuthorizationJournal(root, approvalId);
  const snapshot = {
    state: structuredClone(current.state),
    context: structuredClone(current.context),
  };
  if (canonicalJson(snapshot) !== canonicalJson(expectedSnapshot)) {
    return { status: 'conflict', ...snapshot };
  }
  const nextSnapshot = transition(structuredClone(snapshot));
  if (nextSnapshot === null) return { status: 'conflict', ...snapshot };
  if (!exactKeys(nextSnapshot, ['state', 'context'])) {
    throw new Error(`Local design provisioning authorization ${operation} is invalid`);
  }
  validateState(nextSnapshot.state, approvalId);
  validateContext(nextSnapshot.context);
  if (canonicalJson(nextSnapshot) === canonicalJson(snapshot)) {
    return { status: 'conflict', ...snapshot };
  }
  const nextRecord = authorizationRecord({
    sequence: current.sequence + 1,
    previousRecordSha256: current.recordSha256,
    state: nextSnapshot.state,
    context: nextSnapshot.context,
  });
  const published = await publishImmutableJson(
    directory,
    `${String(nextRecord.sequence).padStart(12, '0')}.json`,
    nextRecord,
  );
  if (!published) {
    const latest = await readAuthorizationJournal(root, approvalId);
    return {
      status: 'conflict',
      state: structuredClone(latest.state),
      context: structuredClone(latest.context),
    };
  }
  return {
    status: 'updated',
    state: structuredClone(nextSnapshot.state),
    context: structuredClone(nextSnapshot.context),
  };
}

async function mutateAuthorization(root, expectedSnapshot, nextClaim, operation) {
  const approvalId = expectedSnapshot?.state?.approvalId;
  const validatedClaim = validateClaim(nextClaim, approvalId);
  const result = await compareAndAppendAuthorization(
    root,
    expectedSnapshot,
    operation,
    (snapshot) => {
      if (snapshot.state.revokedAt !== null) return null;
      let allowed = false;
      if (operation === 'claim') {
        allowed = snapshot.state.claim === null && validatedClaim.status === 'claimed';
      } else {
        const { status: terminalStatus, finalizedAt: _finalizedAt, ...terminalIdentity } = validatedClaim;
        allowed = snapshot.state.claim?.status === 'claimed'
          && ['completed', 'failed'].includes(terminalStatus)
          && canonicalJson(snapshot.state.claim) === canonicalJson({
            ...terminalIdentity,
            status: 'claimed',
          });
      }
      if (!allowed) return null;
      return {
        state: { ...snapshot.state, claim: validatedClaim },
        context: snapshot.context,
      };
    },
  );
  if (result.status === 'conflict') return result;
  return {
    ...result,
    status: operation === 'claim' ? 'claimed' : 'finalized',
  };
}

function canonicalTransitionTimestamp(value, label) {
  if (typeof value !== 'string') {
    throw new Error(`Local design provisioning authorization ${label} is invalid`);
  }
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new Error(`Local design provisioning authorization ${label} is invalid`);
  }
  return value;
}

async function initializeStore(root, authorization) {
  if (!exactKeys(authorization, ['approvalId', 'context'])
    || !UUID_PATTERN.test(authorization.approvalId ?? '')) {
    throw new Error('Local design provisioning authorization seed is invalid');
  }
  const context = validateContext(authorization.context);
  const marker = markerPath(root);
  if (!existsSync(marker)) {
    if (readdirSync(root).length !== 0) {
      throw new Error('Local design provisioning store directory must be empty');
    }
    const descriptor = openSync(marker, 'wx', 0o600);
    try {
      writeFileSync(descriptor, `${canonicalJson(MARKER)}\n`, 'utf8');
    } finally {
      closeSync(descriptor);
    }
  } else {
    verifyMarker(root);
  }
  ensureOwnedChild(root, AUTHORIZATION_DIRECTORY);
  ensureOwnedChild(root, RECEIPT_DIRECTORY);
  const directory = approvalDirectory(root, authorization.approvalId);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  approvalDirectory(root, authorization.approvalId);
  const state = { approvalId: authorization.approvalId, revokedAt: null, claim: null };
  const initial = authorizationRecord({
    sequence: 0,
    previousRecordSha256: null,
    state,
    context,
  });
  const published = await publishImmutableJson(directory, '000000000000.json', initial);
  if (!published) {
    const existing = await readAuthorizationJournal(root, authorization.approvalId);
    if (canonicalJson(existing) !== canonicalJson(initial)) {
      throw new Error('Local design provisioning authorization seed conflicts');
    }
    return { status: 'existing', approvalId: authorization.approvalId, ...LOCAL_DESIGN_PROVISIONING_STORE_BOUNDARIES };
  }
  return { status: 'initialized', approvalId: authorization.approvalId, ...LOCAL_DESIGN_PROVISIONING_STORE_BOUNDARIES };
}

export function initializeLocalDesignProvisioningRehearsalStore({ directory, authorization } = {}) {
  const root = resolveStoreRoot(directory);
  return initializeStore(root, authorization);
}

export function createLocalDesignProvisioningAuthorizationAdapter({ directory } = {}) {
  const root = resolveStoreRoot(directory, { markerRequired: true });
  ensureOwnedChild(root, AUTHORIZATION_DIRECTORY);
  return Object.freeze({
    async readSnapshot(approvalId) {
      const current = await readAuthorizationJournal(root, approvalId);
      return {
        state: structuredClone(current.state),
        context: structuredClone(current.context),
      };
    },
    async claim(expectedSnapshot, claim) {
      return mutateAuthorization(root, expectedSnapshot, claim, 'claim');
    },
    async finalize(expectedSnapshot, terminalClaim) {
      return mutateAuthorization(root, expectedSnapshot, terminalClaim, 'finalization');
    },
  });
}

export function revokeLocalDesignProvisioningAuthorization({
  directory,
  expectedSnapshot,
  revokedAt: revokedAtValue,
} = {}) {
  const root = resolveStoreRoot(directory, { markerRequired: true });
  const revokedAt = canonicalTransitionTimestamp(revokedAtValue, 'revocation');
  return compareAndAppendAuthorization(
    root,
    expectedSnapshot,
    'revocation',
    (snapshot) => {
      if (snapshot.state.revokedAt !== null || snapshot.state.claim !== null) return null;
      return {
        state: { ...snapshot.state, revokedAt },
        context: snapshot.context,
      };
    },
  );
}

export function replaceLocalDesignProvisioningAuthorizationContext({
  directory,
  expectedSnapshot,
  context: contextValue,
} = {}) {
  const root = resolveStoreRoot(directory, { markerRequired: true });
  const context = validateContext(contextValue);
  return compareAndAppendAuthorization(
    root,
    expectedSnapshot,
    'context transition',
    (snapshot) => {
      const current = snapshot.context;
      const sameIdentity = ['userId', 'role', 'organizationId', 'targetHost']
        .every((key) => current[key] === context[key]);
      const reactivates = (!current.membershipActive && context.membershipActive)
        || (!current.organizationActive && context.organizationActive);
      const deactivates = (current.membershipActive && !context.membershipActive)
        || (current.organizationActive && !context.organizationActive);
      if (!sameIdentity || reactivates || !deactivates) return null;
      return { state: snapshot.state, context };
    },
  );
}

function validateReceipt(receipt) {
  if (!exactKeys(receipt, [
    'schemaVersion', 'kind', 'status', 'approvedPlanChecksum', 'executedPlanChecksum',
    'sourceBlueprintSha256', 'approvalId', 'executionId', 'keyId', 'startedAt',
    'completedAt', 'summary', 'operations', 'failureCode', 'rollbackVerified',
    'containsSensitiveValues', 'digest',
  ])
    || receipt.schemaVersion !== 1
    || receipt.kind !== 'platform_design_provisioning_execution_receipt'
    || !['completed', 'failed'].includes(receipt.status)
    || !UUID_PATTERN.test(receipt.approvalId ?? '')
    || !UUID_PATTERN.test(receipt.executionId ?? '')
    || !SHA256_PATTERN.test(receipt.digest ?? '')
    || !SHA256_PATTERN.test(receipt.approvedPlanChecksum ?? '')
    || !SHA256_PATTERN.test(receipt.executedPlanChecksum ?? '')
    || !SHA256_PATTERN.test(receipt.sourceBlueprintSha256 ?? '')
    || !KEY_ID_PATTERN.test(receipt.keyId ?? '')
    || new Date(receipt.startedAt).toISOString() !== receipt.startedAt
    || new Date(receipt.completedAt).toISOString() !== receipt.completedAt
    || receipt.completedAt < receipt.startedAt
    || !exactKeys(receipt.summary, [
      'plannedOperationCount', 'observedOperationCount', 'appliedCount', 'replayedCount',
    ])
    || ['plannedOperationCount', 'observedOperationCount', 'appliedCount', 'replayedCount']
      .some((key) => !Number.isSafeInteger(receipt.summary[key]) || receipt.summary[key] < 0)
    || !Array.isArray(receipt.operations)
    || receipt.operations.some((operation) => !exactKeys(operation, ['operationId', 'type', 'status'])
      || !SHA256_PATTERN.test(operation.operationId ?? '')
      || !['create_assembly', 'create_session', 'create_topic', 'create_team'].includes(operation.type)
      || !['applied', 'replayed'].includes(operation.status))
    || new Set(receipt.operations.map(({ operationId }) => operationId)).size !== receipt.operations.length
    || receipt.summary.observedOperationCount !== receipt.operations.length
    || receipt.summary.appliedCount
      !== receipt.operations.filter(({ status }) => status === 'applied').length
    || receipt.summary.replayedCount
      !== receipt.operations.filter(({ status }) => status === 'replayed').length
    || receipt.containsSensitiveValues !== false
    || (receipt.status === 'completed'
      && (receipt.failureCode !== null
        || receipt.rollbackVerified !== false
        || receipt.summary.plannedOperationCount !== receipt.operations.length))
    || (receipt.status === 'failed'
      && (!FAILURE_CODES.includes(receipt.failureCode)
        || receipt.rollbackVerified !== true
        || receipt.operations.length !== 0
        || receipt.summary.plannedOperationCount <= 0))) {
    throw new Error('Local design provisioning execution receipt is invalid');
  }
  return structuredClone(receipt);
}

export function createLocalDesignProvisioningReceiptAdapter({ directory } = {}) {
  const root = resolveStoreRoot(directory, { markerRequired: true });
  const receipts = ensureOwnedChild(root, RECEIPT_DIRECTORY);
  return Object.freeze({
    async read(executionId) {
      if (!UUID_PATTERN.test(executionId ?? '')) {
        throw new Error('Local design provisioning execution receipt lookup is invalid');
      }
      const path = resolve(receipts, `${executionId}.json`);
      if (!existsSync(path)) return null;
      return validateReceipt(await readBoundedJson(
        validateOwnedFile(receipts, path, 'Local design provisioning execution receipt'),
        'Local design provisioning execution receipt',
      ));
    },
    async append(receiptValue) {
      const receipt = validateReceipt(receiptValue);
      const filename = `${receipt.executionId}.json`;
      const published = await publishImmutableJson(receipts, filename, receipt);
      if (published) return { status: 'appended', receipt: structuredClone(receipt) };
      const existing = validateReceipt(readBoundedJsonSync(
        validateOwnedFile(
          receipts,
          resolve(receipts, filename),
          'Local design provisioning execution receipt',
        ),
        'Local design provisioning execution receipt',
      ));
      return {
        status: canonicalJson(existing) === canonicalJson(receipt) ? 'existing' : 'conflict',
        receipt: structuredClone(existing),
      };
    },
  });
}
