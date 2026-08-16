import { createHash } from 'node:crypto';
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
    schemaVersion: 1,
    planKind: 'platform_access_provisioning_plan',
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
    || plan.schemaVersion !== 1
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
