import {
  executeDesignProvisioningApprovalLifecycle,
  reconcileDesignProvisioningApprovalLifecycle,
  sealDesignProvisioningExecutionApproval,
  verifyDesignProvisioningExecutionApproval,
  verifyDesignProvisioningExecutionReceipt,
  verifyDesignProvisioningPlan,
} from './platform-design-provisioning-plan.mjs';

const KEY_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{2,79}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const KEY_STATES = Object.freeze(['active', 'verify_only', 'retired']);
const POLICY_REJECTION_MESSAGE = 'Design provisioning key registry policy rejected the request';
const APPROVAL_KEYS = Object.freeze([
  'schemaVersion', 'kind', 'planChecksum', 'sourceBlueprintSha256',
  'sourceBlueprintBytes', 'operationCount', 'approvalId', 'executionId',
  'organizationId', 'targetHost', 'approvedBy', 'approvedRole',
  'approvedAt', 'expiresAt', 'keyId', 'allowDesignProvisioningMutation',
  'allowJoinCodeDisclosure', 'digest',
]);
const APPROVAL_METADATA_KEYS = Object.freeze([
  'approvalId', 'executionId', 'organizationId', 'targetHost', 'approvedBy',
  'approvedRole', 'approvedAt', 'expiresAt', 'keyId',
]);
const RECEIPT_KEYS = Object.freeze([
  'schemaVersion', 'kind', 'status', 'approvedPlanChecksum',
  'executedPlanChecksum', 'sourceBlueprintSha256', 'approvalId',
  'executionId', 'keyId', 'startedAt', 'completedAt', 'summary',
  'operations', 'failureCode', 'rollbackVerified', 'containsSensitiveValues',
  'digest',
]);

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value, expected) {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length
    && actual.every((key, index) => key === sortedExpected[index]);
}

function canonicalUtc(value) {
  if (typeof value !== 'string') return null;
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) return null;
  return parsed;
}

function trustedTime(value) {
  const time = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (!Number.isFinite(time.getTime())) {
    throw new Error('Design provisioning key registry time is invalid');
  }
  return time;
}

function validateKeyRegistry(keyRegistry) {
  const keys = isRecord(keyRegistry) ? Object.keys(keyRegistry).sort() : [];
  if (!isRecord(keyRegistry)
    || (keys.join(',') !== 'readKey' && keys.join(',') !== 'authorizeIssuance,readKey')
    || typeof keyRegistry.readKey !== 'function'
    || ('authorizeIssuance' in keyRegistry
      && typeof keyRegistry.authorizeIssuance !== 'function')) {
    throw new Error('Design provisioning key registry adapter is invalid');
  }
  return keyRegistry;
}

function validateApprovalRegistryEnvelope(approval) {
  if (!isRecord(approval)
    || !exactKeys(approval, APPROVAL_KEYS)
    || approval.schemaVersion !== 1
    || approval.kind !== 'platform_design_provisioning_execution_approval'
    || !KEY_ID_PATTERN.test(approval.keyId ?? '')
    || !canonicalUtc(approval.approvedAt)
    || !canonicalUtc(approval.expiresAt)) {
    throw new Error('Design provisioning key registry request is invalid');
  }
}

function validateApprovalMetadataRegistryEnvelope(metadata) {
  if (!isRecord(metadata)
    || !exactKeys(metadata, APPROVAL_METADATA_KEYS)
    || !KEY_ID_PATTERN.test(metadata.keyId ?? '')
    || !canonicalUtc(metadata.approvedAt)
    || !canonicalUtc(metadata.expiresAt)) {
    throw new Error('Design provisioning key registry request is invalid');
  }
}

function validateReceiptRegistryEnvelope(receipt, expectedKeyId) {
  if (!isRecord(receipt)
    || !exactKeys(receipt, RECEIPT_KEYS)
    || receipt.schemaVersion !== 1
    || receipt.kind !== 'platform_design_provisioning_execution_receipt'
    || receipt.keyId !== expectedKeyId
    || !KEY_ID_PATTERN.test(receipt.keyId ?? '')
    || !canonicalUtc(receipt.startedAt)
    || !canonicalUtc(receipt.completedAt)) {
    throw new Error('Design provisioning key registry request is invalid');
  }
}

function validateRegistryEntry(entry, expectedKeyId) {
  if (!isRecord(entry)
    || !exactKeys(entry, [
      'schemaVersion', 'kind', 'keyId', 'state', 'activatedAt',
      'issuanceDisabledAt', 'verificationEndsAt', 'revision', 'trustedKey',
    ])
    || entry.schemaVersion !== 1
    || entry.kind !== 'platform_design_provisioning_key_registry_entry'
    || entry.keyId !== expectedKeyId
    || !KEY_ID_PATTERN.test(entry.keyId ?? '')
    || !SHA256_PATTERN.test(entry.revision ?? '')
    || !KEY_STATES.includes(entry.state)
    || typeof entry.trustedKey !== 'string'
    || entry.trustedKey.length < 32) {
    throw new Error('Design provisioning key registry response is invalid');
  }
  const activatedAt = canonicalUtc(entry.activatedAt);
  const issuanceDisabledAt = entry.issuanceDisabledAt === null
    ? null
    : canonicalUtc(entry.issuanceDisabledAt);
  const verificationEndsAt = entry.verificationEndsAt === null
    ? null
    : canonicalUtc(entry.verificationEndsAt);
  const issuanceMustBeDisabled = entry.state !== 'active';
  const verificationMustEnd = entry.state !== 'active';
  if (!activatedAt
    || issuanceMustBeDisabled !== Boolean(issuanceDisabledAt)
    || verificationMustEnd !== Boolean(verificationEndsAt)
    || (issuanceDisabledAt && issuanceDisabledAt.getTime() < activatedAt.getTime())
    || (verificationEndsAt && verificationEndsAt.getTime() <= activatedAt.getTime())
    || (issuanceDisabledAt && verificationEndsAt
      && verificationEndsAt.getTime() < issuanceDisabledAt.getTime())) {
    throw new Error('Design provisioning key registry response is invalid');
  }
  return {
    keyId: entry.keyId,
    revision: entry.revision,
    state: entry.state,
    activatedAt,
    issuanceDisabledAt,
    verificationEndsAt,
    trustedKey: entry.trustedKey,
  };
}

async function authorizeRegistryIssuance(registry, entry, metadata) {
  if (typeof registry.authorizeIssuance !== 'function') {
    throw new Error('Design provisioning key registry adapter is invalid');
  }
  const request = {
    schemaVersion: 1,
    kind: 'platform_design_provisioning_key_issuance_request',
    keyId: entry.keyId,
    revision: entry.revision,
    approvedAt: metadata.approvedAt,
    expiresAt: metadata.expiresAt,
  };
  let result;
  try {
    result = await registry.authorizeIssuance(structuredClone(request));
  } catch {
    throw new Error('Design provisioning key registry is unavailable');
  }
  if (!isRecord(result)
    || !exactKeys(result, ['status', 'keyId', 'revision', 'authorizedAt'])
    || !['authorized', 'conflict'].includes(result.status)
    || !KEY_ID_PATTERN.test(result.keyId ?? '')
    || !SHA256_PATTERN.test(result.revision ?? '')
    || (result.status === 'conflict' && result.authorizedAt !== null)
    || (result.status === 'authorized' && !canonicalUtc(result.authorizedAt))) {
    throw new Error('Design provisioning key registry response is invalid');
  }
  const authorizedAt = result.status === 'authorized'
    ? canonicalUtc(result.authorizedAt)
    : null;
  const approvedAt = canonicalUtc(metadata.approvedAt);
  const expiresAt = canonicalUtc(metadata.expiresAt);
  if (result.status !== 'authorized'
    || result.keyId !== entry.keyId
    || result.revision !== entry.revision
    || !authorizedAt
    || !approvedAt
    || !expiresAt
    || authorizedAt.getTime() < approvedAt.getTime()
    || authorizedAt.getTime() > expiresAt.getTime()) {
    throw new Error(POLICY_REJECTION_MESSAGE);
  }
}

async function readRegistryEntry(keyRegistry, keyId) {
  if (!KEY_ID_PATTERN.test(keyId ?? '')) {
    throw new Error('Design provisioning key registry request is invalid');
  }
  const registry = validateKeyRegistry(keyRegistry);
  let entry;
  try {
    entry = await registry.readKey(keyId);
  } catch {
    throw new Error('Design provisioning key registry is unavailable');
  }
  return validateRegistryEntry(entry, keyId);
}

function validateIssuancePolicy(entry, approvedAtValue, expiresAtValue) {
  const approvedAt = canonicalUtc(approvedAtValue);
  const expiresAt = canonicalUtc(expiresAtValue);
  if (!approvedAt
    || !expiresAt
    || entry.state !== 'active'
    || approvedAt.getTime() < entry.activatedAt.getTime()
    || (entry.verificationEndsAt
      && expiresAt.getTime() > entry.verificationEndsAt.getTime())) {
    throw new Error(POLICY_REJECTION_MESSAGE);
  }
}

function validateVerificationPolicy(entry, approval, nowValue) {
  const approvedAt = canonicalUtc(approval?.approvedAt);
  const expiresAt = canonicalUtc(approval?.expiresAt);
  const now = trustedTime(nowValue);
  if (!approvedAt
    || !expiresAt
    || entry.state === 'retired'
    || approvedAt.getTime() < entry.activatedAt.getTime()
    || now.getTime() < entry.activatedAt.getTime()
    || (entry.issuanceDisabledAt
      && approvedAt.getTime() >= entry.issuanceDisabledAt.getTime())
    || (entry.verificationEndsAt
      && (expiresAt.getTime() > entry.verificationEndsAt.getTime()
        || now.getTime() > entry.verificationEndsAt.getTime()))) {
    throw new Error(POLICY_REJECTION_MESSAGE);
  }
  return now;
}

async function registryLifecycleContext({
  approval,
  plan,
  blueprint,
  sourceBytes,
  keyRegistry,
  clock,
}) {
  verifyDesignProvisioningPlan(plan, blueprint, sourceBytes);
  validateApprovalRegistryEnvelope(approval);
  if (typeof clock !== 'function') {
    throw new Error('Design provisioning key registry lifecycle clock is invalid');
  }
  const entry = await readRegistryEntry(keyRegistry, approval.keyId);
  let firstTime;
  try {
    firstTime = trustedTime(clock());
  } catch {
    throw new Error('Design provisioning key registry lifecycle clock is invalid');
  }
  validateVerificationPolicy(entry, approval, firstTime);
  let firstTimePending = true;
  let policyFailure = false;
  const replayingClock = () => {
    if (firstTimePending) {
      firstTimePending = false;
      return new Date(firstTime.getTime());
    }
    const nextTime = clock();
    try {
      validateVerificationPolicy(entry, approval, nextTime);
    } catch (error) {
      if (error instanceof Error
        && error.message === POLICY_REJECTION_MESSAGE) {
        policyFailure = true;
      }
      throw error;
    }
    return nextTime;
  };
  return {
    trustedKey: entry.trustedKey,
    expectedKeyId: approval.keyId,
    clock: replayingClock,
    policyFailed: () => policyFailure,
  };
}

function rejectDirectLifecycleKeyOptions(options) {
  if (!isRecord(options)
    || Object.hasOwn(options, 'trustedKey')
    || Object.hasOwn(options, 'expectedKeyId')) {
    throw new Error('Design provisioning key registry lifecycle options are invalid');
  }
}

export async function sealDesignProvisioningExecutionApprovalWithKeyRegistry({
  plan,
  blueprint,
  sourceBytes,
  metadata,
  keyRegistry,
} = {}) {
  verifyDesignProvisioningPlan(plan, blueprint, sourceBytes);
  validateApprovalMetadataRegistryEnvelope(metadata);
  const registry = validateKeyRegistry(keyRegistry);
  const entry = await readRegistryEntry(registry, metadata?.keyId);
  validateIssuancePolicy(entry, metadata?.approvedAt, metadata?.expiresAt);
  await authorizeRegistryIssuance(registry, entry, metadata);
  return sealDesignProvisioningExecutionApproval(
    plan,
    blueprint,
    sourceBytes,
    metadata,
    entry.trustedKey,
  );
}

export async function verifyDesignProvisioningExecutionReceiptWithKeyRegistry({
  receipt,
  plan,
  blueprint,
  sourceBytes,
  approval,
  keyRegistry,
  now = new Date(),
} = {}) {
  verifyDesignProvisioningPlan(plan, blueprint, sourceBytes);
  validateApprovalRegistryEnvelope(approval);
  validateReceiptRegistryEnvelope(receipt, approval.keyId);
  const entry = await readRegistryEntry(keyRegistry, approval.keyId);
  validateVerificationPolicy(entry, approval, now);
  return verifyDesignProvisioningExecutionReceipt(
    receipt,
    plan,
    blueprint,
    sourceBytes,
    approval,
    {
      trustedKey: entry.trustedKey,
      expectedKeyId: approval.keyId,
    },
  );
}

export async function verifyDesignProvisioningExecutionApprovalWithKeyRegistry({
  approval,
  plan,
  blueprint,
  sourceBytes,
  keyRegistry,
  expectedOrganizationId,
  expectedTargetHost,
  now = new Date(),
  approvalState,
  allowConsumed = false,
} = {}) {
  verifyDesignProvisioningPlan(plan, blueprint, sourceBytes);
  validateApprovalRegistryEnvelope(approval);
  const entry = await readRegistryEntry(keyRegistry, approval?.keyId);
  const trustedNow = validateVerificationPolicy(entry, approval, now);
  return verifyDesignProvisioningExecutionApproval(
    approval,
    plan,
    blueprint,
    sourceBytes,
    {
      trustedKey: entry.trustedKey,
      expectedKeyId: approval.keyId,
      expectedOrganizationId,
      expectedTargetHost,
      now: trustedNow,
      approvalState,
      allowConsumed,
    },
  );
}

export async function executeDesignProvisioningApprovalLifecycleWithKeyRegistry(options = {}) {
  rejectDirectLifecycleKeyOptions(options);
  const {
    keyRegistry,
    clock = () => new Date(),
    ...lifecycleOptions
  } = options;
  const context = await registryLifecycleContext({
    ...lifecycleOptions,
    keyRegistry,
    clock,
  });
  try {
    return await executeDesignProvisioningApprovalLifecycle({
      ...lifecycleOptions,
      trustedKey: context.trustedKey,
      expectedKeyId: context.expectedKeyId,
      clock: context.clock,
    });
  } catch (error) {
    if (context.policyFailed()) {
      throw new Error(POLICY_REJECTION_MESSAGE);
    }
    throw error;
  }
}

export async function reconcileDesignProvisioningApprovalLifecycleWithKeyRegistry(options = {}) {
  rejectDirectLifecycleKeyOptions(options);
  const {
    keyRegistry,
    clock = () => new Date(),
    ...lifecycleOptions
  } = options;
  const context = await registryLifecycleContext({
    ...lifecycleOptions,
    keyRegistry,
    clock,
  });
  try {
    return await reconcileDesignProvisioningApprovalLifecycle({
      ...lifecycleOptions,
      trustedKey: context.trustedKey,
      expectedKeyId: context.expectedKeyId,
      clock: context.clock,
    });
  } catch (error) {
    if (context.policyFailed()) {
      throw new Error(POLICY_REJECTION_MESSAGE);
    }
    throw error;
  }
}

function requireRevisionedLifecycleAuthorization(options) {
  const adapter = options.authorizationAdapter;
  if (!isRecord(adapter)
    || !exactKeys(adapter, [
      'revisionedLiveAuthorization',
      'readSnapshot',
      'claim',
      'finalize',
    ])
    || adapter.revisionedLiveAuthorization !== true
    || typeof adapter.readSnapshot !== 'function'
    || typeof adapter.claim !== 'function'
    || typeof adapter.finalize !== 'function') {
    throw new Error('Design provisioning revisioned authorization adapter is required');
  }
}

function requireRevisionFencedExecution(options) {
  const adapter = options.executionAdapter;
  if (!isRecord(adapter)
    || !exactKeys(adapter, ['revisionFencedExecution', 'execute'])
    || adapter.revisionFencedExecution !== true
    || typeof adapter.execute !== 'function') {
    throw new Error('Design provisioning revision-fenced execution adapter is required');
  }
}

function requireRevisionFencedReconciliation(options) {
  const adapter = options.reconciliationAdapter;
  if (!isRecord(adapter)
    || !exactKeys(adapter, ['revisionFencedReconciliation', 'reconcile'])
    || adapter.revisionFencedReconciliation !== true
    || typeof adapter.reconcile !== 'function') {
    throw new Error('Design provisioning revision-fenced reconciliation adapter is required');
  }
}

export async function executeDesignProvisioningApprovalLifecycleWithKeyRegistryAndRevisionedAuthorization(
  options = {},
) {
  requireRevisionedLifecycleAuthorization(options);
  requireRevisionFencedExecution(options);
  return executeDesignProvisioningApprovalLifecycleWithKeyRegistry(options);
}

export async function reconcileDesignProvisioningApprovalLifecycleWithKeyRegistryAndRevisionedAuthorization(
  options = {},
) {
  requireRevisionedLifecycleAuthorization(options);
  requireRevisionFencedReconciliation(options);
  return reconcileDesignProvisioningApprovalLifecycleWithKeyRegistry(options);
}
