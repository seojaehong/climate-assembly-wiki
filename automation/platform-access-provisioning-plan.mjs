import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import {
  existsSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = realpathSync.native(fileURLToPath(new URL('..', import.meta.url)));
const CONTRACT_PATH = new URL('../src/islands/platform/access/access-plan-contract.json', import.meta.url);
const MAX_PROVISIONING_PLAN_BYTES = 1024 * 1024;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const KEY_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{2,79}$/;
const AUTH_REVIEWER_PATTERN = /^auth-user:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const EXECUTION_APPROVAL_WINDOW_MS = 15 * 60 * 1000;

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === 'object') {
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

function canonicalUtc(value) {
  if (typeof value !== 'string') return null;
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) return null;
  return parsed;
}

function safeDigestEqual(left, right) {
  if (!SHA256_PATTERN.test(left) || !SHA256_PATTERN.test(right)) return false;
  return timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
}

function exactKeys(value, expected) {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length
    && actual.every((key, index) => key === sortedExpected[index]);
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function loadAccessPlanContract() {
  let contract;
  try {
    contract = JSON.parse(readFileSync(CONTRACT_PATH, 'utf8'));
  } catch {
    throw new Error('Unable to read the organization access plan contract');
  }
  if (!isRecord(contract)
    || !exactKeys(contract, ['schemaVersion', 'kind', 'roles', 'maxBytes', 'boundaries'])
    || contract.schemaVersion !== 1
    || contract.kind !== 'platform-organization-access-plan'
    || !Array.isArray(contract.roles)
    || contract.roles.length === 0
    || new Set(contract.roles).size !== contract.roles.length
    || contract.roles.some((role) => typeof role !== 'string' || !/^[a-z][a-z_]{1,39}$/.test(role))
    || !Number.isInteger(contract.maxBytes)
    || contract.maxBytes <= 0
    || contract.maxBytes > 1024 * 1024
    || !isRecord(contract.boundaries)
    || !exactKeys(contract.boundaries, [
      'dryRun', 'authAccountsCreated', 'invitationsSent', 'databaseMutationExecuted', 'requiresApproval',
    ])
    || contract.boundaries.dryRun !== true
    || contract.boundaries.authAccountsCreated !== false
    || contract.boundaries.invitationsSent !== false
    || contract.boundaries.databaseMutationExecuted !== false
    || contract.boundaries.requiresApproval !== true) {
    throw new Error('Organization access plan contract is invalid');
  }
  return Object.freeze({
    ...contract,
    roles: Object.freeze([...contract.roles]),
    boundaries: Object.freeze({ ...contract.boundaries }),
  });
}

export const ORGANIZATION_ACCESS_PLAN_CONTRACT = loadAccessPlanContract();
export const ORGANIZATION_ACCESS_PLAN_CONTRACT_IDENTITY = Object.freeze({
  schemaVersion: ORGANIZATION_ACCESS_PLAN_CONTRACT.schemaVersion,
  canonicalSha256: sha256(canonicalJson(ORGANIZATION_ACCESS_PLAN_CONTRACT)),
});

function canonicalEmail(value) {
  if (typeof value !== 'string') throw new Error('Organization access plan is invalid');
  const email = value.trim().toLowerCase();
  if (email !== value || email.length < 3 || email.length > 200 || !EMAIL_PATTERN.test(email)) {
    throw new Error('Organization access plan is invalid');
  }
  return email;
}

function canonicalUuid(value) {
  if (typeof value !== 'string') throw new Error('Organization access plan is invalid');
  const uuid = value.trim().toLowerCase();
  if (uuid !== value || !UUID_PATTERN.test(uuid)) throw new Error('Organization access plan is invalid');
  return uuid;
}

function requireRole(value) {
  if (typeof value !== 'string' || !ORGANIZATION_ACCESS_PLAN_CONTRACT.roles.includes(value)) {
    throw new Error('Organization access plan is invalid');
  }
  return value;
}

export function validateOrganizationAccessPlan(value) {
  const contract = ORGANIZATION_ACCESS_PLAN_CONTRACT;
  if (!isRecord(value)
    || !exactKeys(value, [
      'schemaVersion', 'kind', 'organization', 'invitations', 'memberships',
      'dryRun', 'authAccountsCreated', 'invitationsSent', 'databaseMutationExecuted', 'requiresApproval',
    ])
    || value.schemaVersion !== contract.schemaVersion
    || value.kind !== contract.kind
    || value.dryRun !== contract.boundaries.dryRun
    || value.authAccountsCreated !== contract.boundaries.authAccountsCreated
    || value.invitationsSent !== contract.boundaries.invitationsSent
    || value.databaseMutationExecuted !== contract.boundaries.databaseMutationExecuted
    || value.requiresApproval !== contract.boundaries.requiresApproval
    || !isRecord(value.organization)
    || !exactKeys(value.organization, ['id', 'label'])
    || !Array.isArray(value.invitations)
    || !Array.isArray(value.memberships)) {
    throw new Error('Organization access plan is invalid');
  }
  const organizationId = canonicalUuid(value.organization.id);
  if (typeof value.organization.label !== 'string'
    || value.organization.label.length === 0
    || value.organization.label.trim() !== value.organization.label) {
    throw new Error('Organization access plan is invalid');
  }
  const invitationKeys = new Set();
  const invitations = value.invitations.map((item) => {
    if (!isRecord(item) || !exactKeys(item, ['email', 'role'])) {
      throw new Error('Organization access plan is invalid');
    }
    const email = canonicalEmail(item.email);
    const role = requireRole(item.role);
    const key = `${email}:${role}`;
    if (invitationKeys.has(key)) throw new Error('Organization access plan is invalid');
    invitationKeys.add(key);
    return { email, role };
  });
  const membershipKeys = new Set();
  const memberships = value.memberships.map((item) => {
    if (!isRecord(item) || !exactKeys(item, ['userId', 'role'])) {
      throw new Error('Organization access plan is invalid');
    }
    const userId = canonicalUuid(item.userId);
    const role = requireRole(item.role);
    const key = `${userId}:${role}`;
    if (membershipKeys.has(key)) throw new Error('Organization access plan is invalid');
    membershipKeys.add(key);
    return { userId, role };
  });
  if (invitations.length + memberships.length === 0) throw new Error('Organization access plan is invalid');
  return {
    schemaVersion: contract.schemaVersion,
    kind: contract.kind,
    organization: { id: organizationId, label: value.organization.label },
    invitations,
    memberships,
    ...contract.boundaries,
  };
}

function operationId(operation) {
  return sha256(canonicalJson(operation));
}

export function provisioningPlanChecksum(plan) {
  const { checksum: _checksum, ...unsigned } = plan;
  return sha256(canonicalJson(unsigned));
}

function approvalDigest(approval, key) {
  const { digest: _digest, ...unsigned } = approval;
  return createHmac('sha256', key).update(canonicalJson(unsigned)).digest('hex');
}

function executionReceiptDigest(receipt, key) {
  const { digest: _digest, ...unsigned } = receipt;
  return createHmac('sha256', key).update(canonicalJson(unsigned)).digest('hex');
}

function validateApprovalMetadata(metadata) {
  if (!isRecord(metadata)
    || !exactKeys(metadata, ['approvalId', 'approvedBy', 'approvedAt', 'expiresAt', 'keyId'])
    || !UUID_PATTERN.test(metadata.approvalId ?? '')
    || !AUTH_REVIEWER_PATTERN.test(metadata.approvedBy ?? '')
    || !KEY_ID_PATTERN.test(metadata.keyId ?? '')) {
    throw new Error('Organization access provisioning approval metadata is invalid');
  }
  const approvedAt = canonicalUtc(metadata.approvedAt);
  const expiresAt = canonicalUtc(metadata.expiresAt);
  if (!approvedAt || !expiresAt
    || expiresAt.getTime() <= approvedAt.getTime()
    || expiresAt.getTime() - approvedAt.getTime() > EXECUTION_APPROVAL_WINDOW_MS) {
    throw new Error('Organization access provisioning approval time is invalid');
  }
  return { approvedAt, expiresAt };
}

function requireTrustedApprovalKey(key) {
  if (typeof key !== 'string' || key.length < 32) {
    throw new Error('Organization access provisioning approval key is invalid');
  }
  return key;
}

export function sealOrganizationAccessProvisioningApproval(plan, metadata, key) {
  if (!isRecord(plan) || !SHA256_PATTERN.test(plan.checksum ?? '')) {
    throw new Error('Organization access provisioning plan is invalid');
  }
  validateApprovalMetadata(metadata);
  const trustedKey = requireTrustedApprovalKey(key);
  const unsigned = {
    schemaVersion: 1,
    kind: 'platform_access_provisioning_approval',
    planChecksum: plan.checksum,
    approvalId: metadata.approvalId,
    approvedBy: metadata.approvedBy,
    approvedAt: metadata.approvedAt,
    expiresAt: metadata.expiresAt,
    keyId: metadata.keyId,
    allowAuthMutation: true,
    allowInvitationDelivery: true,
    allowDatabaseMutation: true,
  };
  return { ...unsigned, digest: approvalDigest(unsigned, trustedKey) };
}

export function verifyOrganizationAccessProvisioningApproval(
  approval,
  plan,
  { trustedKey, expectedKeyId, now = new Date() },
) {
  if (!isRecord(approval)
    || !exactKeys(approval, [
      'schemaVersion', 'kind', 'planChecksum', 'approvalId', 'approvedBy', 'approvedAt',
      'expiresAt', 'keyId', 'allowAuthMutation', 'allowInvitationDelivery',
      'allowDatabaseMutation', 'digest',
    ])
    || approval.schemaVersion !== 1
    || approval.kind !== 'platform_access_provisioning_approval'
    || approval.planChecksum !== plan.checksum
    || approval.allowAuthMutation !== true
    || approval.allowInvitationDelivery !== true
    || approval.allowDatabaseMutation !== true
    || approval.keyId !== expectedKeyId
    || !SHA256_PATTERN.test(approval.digest ?? '')) {
    throw new Error('Organization access provisioning approval is invalid');
  }
  const { approvedAt, expiresAt } = validateApprovalMetadata({
    approvalId: approval.approvalId,
    approvedBy: approval.approvedBy,
    approvedAt: approval.approvedAt,
    expiresAt: approval.expiresAt,
    keyId: approval.keyId,
  });
  const trustedNow = now instanceof Date ? now : new Date(now);
  if (!Number.isFinite(trustedNow.getTime())
    || trustedNow.getTime() < approvedAt.getTime()
    || trustedNow.getTime() > expiresAt.getTime()) {
    throw new Error('Organization access provisioning approval is expired or not yet valid');
  }
  const expectedDigest = approvalDigest(approval, requireTrustedApprovalKey(trustedKey));
  if (!safeDigestEqual(approval.digest, expectedDigest)) {
    throw new Error('Organization access provisioning approval integrity verification failed');
  }
  return {
    approvalId: approval.approvalId,
    keyId: approval.keyId,
    planChecksum: approval.planChecksum,
  };
}

export function verifyOrganizationAccessProvisioningExecutionReceipt(
  receipt,
  { trustedKey, expectedKeyId, expectedPlanChecksum },
) {
  if (!isRecord(receipt)
    || !exactKeys(receipt, [
      'schemaVersion', 'kind', 'status', 'planChecksum', 'approvalId', 'keyId', 'runId',
      'startedAt', 'completedAt', 'clockRollbackDetected', 'summary', 'operations',
      'containsSensitiveValues', 'digest',
    ])
    || receipt.schemaVersion !== 1
    || receipt.kind !== 'platform_access_provisioning_execution_receipt'
    || !['completed', 'failed'].includes(receipt.status)
    || receipt.planChecksum !== expectedPlanChecksum
    || receipt.keyId !== expectedKeyId
    || !UUID_PATTERN.test(receipt.approvalId ?? '')
    || !UUID_PATTERN.test(receipt.runId ?? '')
    || typeof receipt.clockRollbackDetected !== 'boolean'
    || receipt.containsSensitiveValues !== false
    || !SHA256_PATTERN.test(receipt.digest ?? '')
    || !Array.isArray(receipt.operations)
    || receipt.operations.length === 0
    || !isRecord(receipt.summary)
    || !exactKeys(receipt.summary, [
      'operationCount', 'appliedCount', 'alreadyAppliedCount', 'reconciledCount',
      'failedCount', 'pendingCount', 'mutationAttemptedCount',
    ])) {
    throw new Error('Organization access provisioning execution receipt is invalid');
  }
  const startedAt = canonicalUtc(receipt.startedAt);
  const completedAt = canonicalUtc(receipt.completedAt);
  if (!startedAt || !completedAt
    || completedAt.getTime() < startedAt.getTime()
    || (receipt.clockRollbackDetected && completedAt.getTime() !== startedAt.getTime())) {
    throw new Error('Organization access provisioning execution receipt time is invalid');
  }
  const statuses = ['applied', 'already_applied', 'reconciled', 'failed', 'pending'];
  const operationIds = new Set();
  for (const operation of receipt.operations) {
    if (!isRecord(operation)
      || !exactKeys(operation, ['operationId', 'type', 'status', 'reason', 'mutationAttempted'])
      || !SHA256_PATTERN.test(operation.operationId ?? '')
      || operationIds.has(operation.operationId)
      || !['invite_and_assign_role', 'assign_existing_user_role'].includes(operation.type)
      || !statuses.includes(operation.status)
      || typeof operation.mutationAttempted !== 'boolean'
      || (['applied', 'already_applied', 'reconciled'].includes(operation.status) && operation.reason !== null)
      || (operation.status === 'pending' && operation.reason !== 'stopped_after_failure')
      || (operation.status === 'failed' && ![
        'lookup_failed', 'operation_conflict', 'apply_outcome_unresolved', 'reconciliation_failed',
      ].includes(operation.reason))) {
      throw new Error('Organization access provisioning execution receipt is invalid');
    }
    operationIds.add(operation.operationId);
  }
  const countFor = (status) => receipt.operations.filter((operation) => operation.status === status).length;
  const expectedSummary = {
    operationCount: receipt.operations.length,
    appliedCount: countFor('applied'),
    alreadyAppliedCount: countFor('already_applied'),
    reconciledCount: countFor('reconciled'),
    failedCount: countFor('failed'),
    pendingCount: countFor('pending'),
    mutationAttemptedCount: receipt.operations.filter((operation) => operation.mutationAttempted).length,
  };
  if (canonicalJson(receipt.summary) !== canonicalJson(expectedSummary)
    || receipt.status !== (expectedSummary.failedCount > 0 ? 'failed' : 'completed')) {
    throw new Error('Organization access provisioning execution receipt summary is invalid');
  }
  const expectedDigest = executionReceiptDigest(receipt, requireTrustedApprovalKey(trustedKey));
  if (!safeDigestEqual(receipt.digest, expectedDigest)) {
    throw new Error('Organization access provisioning execution receipt integrity verification failed');
  }
  return {
    status: 'verified',
    executionStatus: receipt.status,
    planChecksum: receipt.planChecksum,
    approvalId: receipt.approvalId,
    runId: receipt.runId,
    operationCount: receipt.summary.operationCount,
  };
}

export function buildOrganizationAccessProvisioningPlan(accessPlan, sourceBytes) {
  const source = validateOrganizationAccessPlan(accessPlan);
  if (!Buffer.isBuffer(sourceBytes) || sourceBytes.length === 0
    || sourceBytes.length > ORGANIZATION_ACCESS_PLAN_CONTRACT.maxBytes) {
    throw new Error('Organization access plan source bytes are invalid');
  }
  const operations = [
    ...source.invitations.map(({ email, role }) => {
      const operation = {
        type: 'invite_and_assign_role',
        organizationId: source.organization.id,
        email,
        role,
      };
      return { operationId: operationId(operation), ...operation };
    }),
    ...source.memberships.map(({ userId, role }) => {
      const operation = {
        type: 'assign_existing_user_role',
        organizationId: source.organization.id,
        userId,
        role,
      };
      return { operationId: operationId(operation), ...operation };
    }),
  ];
  const unsigned = {
    schemaVersion: 2,
    planKind: 'platform_access_provisioning_plan',
    accessPlanContract: ORGANIZATION_ACCESS_PLAN_CONTRACT_IDENTITY,
    sourcePlan: { sha256: sha256(sourceBytes), bytes: sourceBytes.length },
    organization: source.organization,
    operations,
    summary: {
      invitationCount: source.invitations.length,
      membershipCount: source.memberships.length,
      operationCount: operations.length,
    },
    executionPolicy: {
      stableOperationIdsRequired: true,
      lookupBeforeMutationRequired: true,
      stopOnFailure: true,
      auditReceiptRequired: true,
      partialSuccessRequiresReconciliation: true,
      signedApprovalRequired: true,
      approvalMaxAgeSeconds: EXECUTION_APPROVAL_WINDOW_MS / 1000,
      nonSensitiveReceiptRequired: true,
      automaticMutationRetryAllowed: false,
    },
    dryRun: true,
    authAccountsCreated: false,
    invitationsSent: false,
    databaseMutationExecuted: false,
    requiresApproval: true,
  };
  return { ...unsigned, checksum: provisioningPlanChecksum(unsigned) };
}

export function verifyOrganizationAccessProvisioningPlan(plan, accessPlan, sourceBytes) {
  if (!isRecord(plan)
    || plan.schemaVersion !== 2
    || plan.planKind !== 'platform_access_provisioning_plan'
    || plan.dryRun !== true
    || plan.authAccountsCreated !== false
    || plan.invitationsSent !== false
    || plan.databaseMutationExecuted !== false
    || plan.requiresApproval !== true
    || !SHA256_PATTERN.test(plan.checksum ?? '')) {
    throw new Error('Organization access provisioning plan is invalid');
  }
  if (provisioningPlanChecksum(plan) !== plan.checksum) {
    throw new Error('Organization access provisioning plan checksum verification failed');
  }
  const expected = buildOrganizationAccessProvisioningPlan(accessPlan, sourceBytes);
  if (canonicalJson(plan) !== canonicalJson(expected)) {
    throw new Error('Organization access provisioning plan does not match its source');
  }
  return {
    status: 'verified',
    checksum: plan.checksum,
    invitationCount: plan.summary.invitationCount,
    membershipCount: plan.summary.membershipCount,
    operationCount: plan.summary.operationCount,
    databaseMutationExecuted: false,
  };
}

function requireExecutionAdapter(adapter) {
  if (!isRecord(adapter)
    || !isRecord(adapter.capabilities)
    || !exactKeys(adapter.capabilities, [
      'stableOperationLookup', 'idempotentApply', 'automaticMutationRetry', 'receiptPersistence',
    ])
    || adapter.capabilities.stableOperationLookup !== true
    || adapter.capabilities.idempotentApply !== true
    || adapter.capabilities.automaticMutationRetry !== false
    || adapter.capabilities.receiptPersistence !== true
    || typeof adapter.lookupOperation !== 'function'
    || typeof adapter.applyOperation !== 'function'
    || typeof adapter.persistReceipt !== 'function') {
    throw new Error('Organization access provisioning execution adapter is unsafe');
  }
  return adapter;
}

function validateLookupResult(result, operationId) {
  if (!isRecord(result)
    || !exactKeys(result, ['status', 'operationId'])
    || !['absent', 'applied', 'conflict'].includes(result.status)
    || result.operationId !== operationId) {
    throw new Error('Organization access provisioning lookup result is invalid');
  }
  return result.status;
}

function validateApplyResult(result, operationId) {
  if (!isRecord(result)
    || !exactKeys(result, ['status', 'operationId'])
    || result.status !== 'applied'
    || result.operationId !== operationId) {
    throw new Error('Organization access provisioning apply result is invalid');
  }
}

function executionTime(clock) {
  const value = typeof clock === 'function' ? clock() : new Date();
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new Error('Organization access provisioning execution time is invalid');
  }
  return date;
}

async function operationExecutionResult(operation, adapter) {
  let initialStatus;
  try {
    initialStatus = validateLookupResult(
      await adapter.lookupOperation(operation),
      operation.operationId,
    );
  } catch {
    return { status: 'failed', reason: 'lookup_failed', mutationAttempted: false };
  }
  if (initialStatus === 'applied') {
    return { status: 'already_applied', reason: null, mutationAttempted: false };
  }
  if (initialStatus === 'conflict') {
    return { status: 'failed', reason: 'operation_conflict', mutationAttempted: false };
  }
  try {
    validateApplyResult(await adapter.applyOperation(operation), operation.operationId);
    return { status: 'applied', reason: null, mutationAttempted: true };
  } catch {
    try {
      const reconciled = validateLookupResult(
        await adapter.lookupOperation(operation),
        operation.operationId,
      );
      if (reconciled === 'applied') {
        return { status: 'reconciled', reason: null, mutationAttempted: true };
      }
      return {
        status: 'failed',
        reason: reconciled === 'conflict' ? 'operation_conflict' : 'apply_outcome_unresolved',
        mutationAttempted: true,
      };
    } catch {
      return { status: 'failed', reason: 'reconciliation_failed', mutationAttempted: true };
    }
  }
}

export async function executeOrganizationAccessProvisioningPlan({
  plan,
  accessPlan,
  sourceBytes,
  approval,
  trustedKey,
  expectedKeyId,
  runId,
  adapter,
  clock = () => new Date(),
}) {
  verifyOrganizationAccessProvisioningPlan(plan, accessPlan, sourceBytes);
  if (!UUID_PATTERN.test(runId ?? '')) {
    throw new Error('Organization access provisioning execution run ID is invalid');
  }
  const startedAt = executionTime(clock);
  const authorization = verifyOrganizationAccessProvisioningApproval(approval, plan, {
    trustedKey,
    expectedKeyId,
    now: startedAt,
  });
  const executionAdapter = requireExecutionAdapter(adapter);
  const operationReceipts = [];
  let stopped = false;
  for (const operation of plan.operations) {
    if (stopped) {
      operationReceipts.push({
        operationId: operation.operationId,
        type: operation.type,
        status: 'pending',
        reason: 'stopped_after_failure',
        mutationAttempted: false,
      });
      continue;
    }
    const result = await operationExecutionResult(operation, executionAdapter);
    operationReceipts.push({
      operationId: operation.operationId,
      type: operation.type,
      ...result,
    });
    if (result.status === 'failed') stopped = true;
  }
  const counts = Object.fromEntries(
    ['applied', 'already_applied', 'reconciled', 'failed', 'pending'].map((status) => [
      status,
      operationReceipts.filter((receipt) => receipt.status === status).length,
    ]),
  );
  const observedCompletedAt = executionTime(clock);
  const clockRollbackDetected = observedCompletedAt.getTime() < startedAt.getTime();
  const completedAt = clockRollbackDetected ? startedAt : observedCompletedAt;
  const unsignedReceipt = {
    schemaVersion: 1,
    kind: 'platform_access_provisioning_execution_receipt',
    status: counts.failed > 0 ? 'failed' : 'completed',
    planChecksum: plan.checksum,
    approvalId: authorization.approvalId,
    keyId: authorization.keyId,
    runId,
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    clockRollbackDetected,
    summary: {
      operationCount: operationReceipts.length,
      appliedCount: counts.applied,
      alreadyAppliedCount: counts.already_applied,
      reconciledCount: counts.reconciled,
      failedCount: counts.failed,
      pendingCount: counts.pending,
      mutationAttemptedCount: operationReceipts.filter((receipt) => receipt.mutationAttempted).length,
    },
    operations: operationReceipts,
    containsSensitiveValues: false,
  };
  const receipt = {
    ...unsignedReceipt,
    digest: executionReceiptDigest(unsignedReceipt, requireTrustedApprovalKey(trustedKey)),
  };
  try {
    await executionAdapter.persistReceipt(receipt);
  } catch {
    throw new Error('Organization access provisioning execution receipt could not be persisted');
  }
  return receipt;
}

function readJsonFile(path, label, maxBytes) {
  let bytes;
  try {
    bytes = readFileSync(path);
  } catch {
    throw new Error(`Unable to read ${label}`);
  }
  if (bytes.length === 0 || bytes.length > maxBytes) {
    throw new Error(`${label} violates the size boundary`);
  }
  try {
    return { bytes, value: JSON.parse(bytes.toString('utf8')) };
  } catch {
    throw new Error(`${label} is malformed`);
  }
}

function isWithin(parent, candidate) {
  const path = relative(parent, candidate);
  return path === '' || (!path.startsWith('..') && !isAbsolute(path));
}

function requireExternalPath(path, { forWrite = false } = {}) {
  const absolutePath = resolve(path);
  let resolvedTarget;
  try {
    resolvedTarget = existsSync(absolutePath)
      ? realpathSync.native(absolutePath)
      : resolve(realpathSync.native(dirname(absolutePath)), absolutePath.split(/[\\/]/).at(-1));
  } catch {
    throw new Error(forWrite ? 'Provisioning plan output directory is unavailable' : 'Provisioning plan path is unavailable');
  }
  if (isWithin(REPO_ROOT, resolvedTarget)) {
    throw new Error('Organization access provisioning files must remain outside the repository');
  }
  return absolutePath;
}

function valueAfter(args, option) {
  const index = args.indexOf(option);
  if (index < 0 || index + 1 >= args.length) return null;
  return args[index + 1];
}

export function runOrganizationAccessProvisioningCli(args) {
  const sourceArgument = valueAfter(args, '--source');
  const verifyArgument = valueAfter(args, '--verify');
  const outputArgument = valueAfter(args, '--output');
  const force = args.includes('--force');
  if (!sourceArgument) throw new Error('Use --source <path> with an organization access plan');
  const sourcePath = requireExternalPath(sourceArgument);
  const source = readJsonFile(
    sourcePath,
    'organization access plan',
    ORGANIZATION_ACCESS_PLAN_CONTRACT.maxBytes,
  );
  if (verifyArgument) {
    if (outputArgument || force || args.length !== 4) {
      throw new Error('Invalid organization access provisioning verification arguments');
    }
    const planPath = requireExternalPath(verifyArgument);
    const plan = readJsonFile(
      planPath,
      'organization access provisioning plan',
      MAX_PROVISIONING_PLAN_BYTES,
    );
    return verifyOrganizationAccessProvisioningPlan(plan.value, source.value, source.bytes);
  }
  if (!outputArgument || args.length !== 4 + Number(force)) {
    throw new Error('Use --output <path> to create an organization access provisioning plan');
  }
  const outputPath = requireExternalPath(outputArgument, { forWrite: true });
  const plan = buildOrganizationAccessProvisioningPlan(source.value, source.bytes);
  try {
    writeFileSync(outputPath, `${JSON.stringify(plan, null, 2)}\n`, {
      encoding: 'utf8',
      flag: force ? 'w' : 'wx',
      mode: 0o600,
    });
  } catch (error) {
    if (!force && isRecord(error) && error.code === 'EEXIST') {
      throw new Error('Organization access provisioning plan already exists; use --force to replace it');
    }
    throw new Error('Unable to write the organization access provisioning plan');
  }
  return {
    status: 'written',
    checksum: plan.checksum,
    invitationCount: plan.summary.invitationCount,
    membershipCount: plan.summary.membershipCount,
    operationCount: plan.summary.operationCount,
    databaseMutationExecuted: false,
  };
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (invokedPath === import.meta.url) {
  try {
    process.stdout.write(`${JSON.stringify(runOrganizationAccessProvisioningCli(process.argv.slice(2)))}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown failure';
    console.error(`organization access provisioning plan failed: ${message}`);
    process.exitCode = 1;
  }
}
