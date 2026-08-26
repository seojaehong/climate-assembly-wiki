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
const CONTRACT_PATH = new URL('../src/islands/platform/design/design-blueprint-contract.json', import.meta.url);
const MAX_PROVISIONING_PLAN_BYTES = 16 * 1024 * 1024;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const KEY_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{2,79}$/;
const AUTH_REVIEWER_PATTERN = /^auth-user:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const DESIGN_APPROVAL_ROLES = Object.freeze(['org_admin', 'hq']);
const DESIGN_PROVISIONING_FAILURE_CODES = Object.freeze([
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
const EXECUTION_APPROVAL_WINDOW_MS = 15 * 60 * 1000;

export const DESIGN_PROVISIONING_BLOCKERS = Object.freeze([
  'approval.production_apply_not_granted',
  'schema.design_provisioning_migration_not_applied',
  'server.design_provisioning_rpc_not_activated',
  'server.idempotent_operation_ledger_not_activated',
  'team.join_code_generation_not_activated',
]);

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

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value, expected) {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length
    && actual.every((key, index) => key === sortedExpected[index]);
}

function loadDesignBlueprintContract() {
  let contract;
  try {
    contract = JSON.parse(readFileSync(CONTRACT_PATH, 'utf8'));
  } catch {
    throw new Error('Unable to read the design blueprint contract');
  }
  const limitKeys = [
    'assemblyTitleChars', 'assemblyPurposeChars', 'sessionTitleChars', 'sessions',
    'topicsPerSession', 'topicChars', 'topicsTextChars', 'teamsPerSession',
    'participantsPerSession', 'generatedItems', 'importChars', 'importBytes',
  ];
  if (!isRecord(contract)
    || !exactKeys(contract, [
      'schemaVersion', 'kind', 'assemblyModes', 'readinessChecks', 'slugPattern', 'limits', 'boundaries',
    ])
    || contract.schemaVersion !== 4
    || contract.kind !== 'platform-design-blueprint'
    || canonicalJson(contract.assemblyModes) !== canonicalJson(['consensus', 'vote'])
    || canonicalJson(contract.readinessChecks) !== canonicalJson(['topics_open', 'teams_active', 'roster_loaded'])
    || contract.slugPattern !== '^[a-z0-9-]{3,40}$'
    || !isRecord(contract.limits)
    || !exactKeys(contract.limits, limitKeys)
    || limitKeys.some((key) => !Number.isSafeInteger(contract.limits[key]) || contract.limits[key] <= 0)
    || !isRecord(contract.boundaries)
    || !exactKeys(contract.boundaries, ['dryRun', 'databaseMutationExecuted', 'requiresApproval'])
    || contract.boundaries.dryRun !== true
    || contract.boundaries.databaseMutationExecuted !== false
    || contract.boundaries.requiresApproval !== true) {
    throw new Error('Design blueprint contract is invalid');
  }
  return Object.freeze({
    ...contract,
    assemblyModes: Object.freeze([...contract.assemblyModes]),
    readinessChecks: Object.freeze([...contract.readinessChecks]),
    limits: Object.freeze({ ...contract.limits }),
    boundaries: Object.freeze({ ...contract.boundaries }),
  });
}

export const DESIGN_BLUEPRINT_CONTRACT = loadDesignBlueprintContract();

function isCalendarDate(value) {
  if (typeof value !== 'string') return false;
  const match = DATE_PATTERN.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

function canonicalText(value, maximum, { nullable = false } = {}) {
  if (nullable && value === null) return null;
  if (typeof value !== 'string'
    || value.length === 0
    || value.length > maximum
    || value.trim() !== value) {
    throw new Error('Design blueprint is invalid');
  }
  return value;
}

function canonicalSlug(value) {
  if (typeof value !== 'string'
    || value.trim() !== value
    || !(new RegExp(DESIGN_BLUEPRINT_CONTRACT.slugPattern)).test(value)) {
    throw new Error('Design blueprint is invalid');
  }
  return value;
}

export function validateDesignBlueprint(value) {
  const contract = DESIGN_BLUEPRINT_CONTRACT;
  if (!isRecord(value)
    || !exactKeys(value, [
      'schemaVersion', 'kind', 'dryRun', 'databaseMutationExecuted', 'requiresApproval',
      'assembly', 'sessions', 'stats',
    ])
    || value.schemaVersion !== contract.schemaVersion
    || value.kind !== contract.kind
    || value.dryRun !== contract.boundaries.dryRun
    || value.databaseMutationExecuted !== contract.boundaries.databaseMutationExecuted
    || value.requiresApproval !== contract.boundaries.requiresApproval
    || !isRecord(value.assembly)
    || !exactKeys(value.assembly, ['title', 'slug', 'purpose', 'mode', 'config'])
    || !isRecord(value.assembly.config)
    || !exactKeys(value.assembly.config, ['readiness'])
    || !Array.isArray(value.assembly.config.readiness)
    || !Array.isArray(value.sessions)
    || value.sessions.length === 0
    || value.sessions.length > contract.limits.sessions
    || !isRecord(value.stats)
    || !exactKeys(value.stats, ['sessionCount', 'topicCount', 'teamCount', 'participantCount'])) {
    throw new Error('Design blueprint is invalid');
  }
  const assembly = {
    title: canonicalText(value.assembly.title, contract.limits.assemblyTitleChars),
    slug: canonicalSlug(value.assembly.slug),
    purpose: canonicalText(value.assembly.purpose, contract.limits.assemblyPurposeChars, { nullable: true }),
    mode: value.assembly.mode,
    config: { readiness: [...value.assembly.config.readiness] },
  };
  if (!contract.assemblyModes.includes(assembly.mode)) throw new Error('Design blueprint is invalid');
  const readinessSet = new Set(assembly.config.readiness);
  const canonicalReadiness = contract.readinessChecks.filter((key) => readinessSet.has(key));
  if (assembly.config.readiness.length === 0
    || readinessSet.size !== assembly.config.readiness.length
    || assembly.config.readiness.some((key) => !contract.readinessChecks.includes(key))
    || canonicalJson(assembly.config.readiness) !== canonicalJson(canonicalReadiness)) {
    throw new Error('Design blueprint is invalid');
  }

  const sessionSlugs = new Set();
  let previousDate = null;
  let topicCount = 0;
  let teamCount = 0;
  let participantCount = 0;
  const sessions = value.sessions.map((session, sessionIndex) => {
    if (!isRecord(session)
      || !exactKeys(session, ['ordinal', 'title', 'slug', 'heldOn', 'topics', 'teams'])
      || session.ordinal !== sessionIndex + 1
      || !isCalendarDate(session.heldOn)
      || (previousDate !== null && session.heldOn < previousDate)
      || !Array.isArray(session.topics)
      || session.topics.length === 0
      || session.topics.length > contract.limits.topicsPerSession
      || !Array.isArray(session.teams)
      || session.teams.length === 0
      || session.teams.length > contract.limits.teamsPerSession) {
      throw new Error('Design blueprint is invalid');
    }
    previousDate = session.heldOn;
    const slug = canonicalSlug(session.slug);
    if (sessionSlugs.has(slug)) throw new Error('Design blueprint is invalid');
    sessionSlugs.add(slug);
    const topicPrompts = new Set();
    const topics = session.topics.map((topic, topicIndex) => {
      if (!isRecord(topic)
        || !exactKeys(topic, ['ordinal', 'prompt'])
        || topic.ordinal !== topicIndex + 1) {
        throw new Error('Design blueprint is invalid');
      }
      const prompt = canonicalText(topic.prompt, contract.limits.topicChars);
      if (topicPrompts.has(prompt)) throw new Error('Design blueprint is invalid');
      topicPrompts.add(prompt);
      return { ordinal: topic.ordinal, prompt };
    });
    let sessionCapacity = 0;
    const teams = session.teams.map((team, teamIndex) => {
      if (!isRecord(team)
        || !exactKeys(team, ['ordinal', 'name', 'plannedCapacity'])
        || team.ordinal !== teamIndex + 1
        || team.name !== `${team.ordinal}조`
        || !Number.isSafeInteger(team.plannedCapacity)
        || team.plannedCapacity < 1) {
        throw new Error('Design blueprint is invalid');
      }
      sessionCapacity += team.plannedCapacity;
      if (!Number.isSafeInteger(sessionCapacity)
        || sessionCapacity > contract.limits.participantsPerSession) {
        throw new Error('Design blueprint is invalid');
      }
      return { ordinal: team.ordinal, name: team.name, plannedCapacity: team.plannedCapacity };
    });
    topicCount += topics.length;
    teamCount += teams.length;
    participantCount += sessionCapacity;
    if (!Number.isSafeInteger(participantCount)) throw new Error('Design blueprint is invalid');
    return {
      ordinal: session.ordinal,
      title: canonicalText(session.title, contract.limits.sessionTitleChars),
      slug,
      heldOn: session.heldOn,
      topics,
      teams,
    };
  });
  if (topicCount + teamCount > contract.limits.generatedItems
    || value.stats.sessionCount !== sessions.length
    || value.stats.topicCount !== topicCount
    || value.stats.teamCount !== teamCount
    || value.stats.participantCount !== participantCount) {
    throw new Error('Design blueprint is invalid');
  }
  return {
    schemaVersion: contract.schemaVersion,
    kind: contract.kind,
    ...contract.boundaries,
    assembly,
    sessions,
    stats: { sessionCount: sessions.length, topicCount, teamCount, participantCount },
  };
}

function operationId(operation) {
  return sha256(canonicalJson(operation));
}

function withOperationId(operation) {
  return { operationId: operationId(operation), ...operation };
}

export function designProvisioningPlanChecksum(plan) {
  const { checksum: _checksum, ...unsigned } = plan;
  return sha256(canonicalJson(unsigned));
}

export function buildDesignProvisioningPlan(blueprint, sourceBytes) {
  const source = validateDesignBlueprint(blueprint);
  if (!Buffer.isBuffer(sourceBytes)
    || sourceBytes.length === 0
    || sourceBytes.length > DESIGN_BLUEPRINT_CONTRACT.limits.importBytes) {
    throw new Error('Design blueprint source bytes are invalid');
  }
  const assemblyRef = `assembly:${source.assembly.slug}`;
  const operations = [withOperationId({
    type: 'create_assembly',
    ref: assemblyRef,
    parentRef: null,
    ordinal: null,
    payload: source.assembly,
  })];
  for (const session of source.sessions) {
    const sessionRef = `${assemblyRef}/session:${session.slug}`;
    operations.push(withOperationId({
      type: 'create_session',
      ref: sessionRef,
      parentRef: assemblyRef,
      ordinal: session.ordinal,
      payload: {
        title: session.title,
        slug: session.slug,
        heldOn: session.heldOn,
      },
    }));
    for (const topic of session.topics) {
      operations.push(withOperationId({
        type: 'create_topic',
        ref: `${sessionRef}/topic:${topic.ordinal}`,
        parentRef: sessionRef,
        ordinal: topic.ordinal,
        payload: { prompt: topic.prompt },
      }));
    }
    for (const team of session.teams) {
      operations.push(withOperationId({
        type: 'create_team',
        ref: `${sessionRef}/team:${team.ordinal}`,
        parentRef: sessionRef,
        ordinal: team.ordinal,
        payload: { name: team.name, plannedCapacity: team.plannedCapacity },
      }));
    }
  }
  const unsigned = {
    schemaVersion: 2,
    planKind: 'platform_design_provisioning_plan',
    sourceBlueprint: {
      sha256: sha256(sourceBytes),
      bytes: sourceBytes.length,
      schemaVersion: source.schemaVersion,
    },
    assembly: { title: source.assembly.title, slug: source.assembly.slug },
    operations,
    summary: {
      assemblyCount: 1,
      sessionCount: source.stats.sessionCount,
      topicCount: source.stats.topicCount,
      teamCount: source.stats.teamCount,
      participantCount: source.stats.participantCount,
      operationCount: operations.length,
    },
    executionPolicy: {
      stableOperationIdsRequired: true,
      parentBeforeChildRequired: true,
      lookupBeforeMutationRequired: true,
      idempotentServerContractRequired: true,
      stopOnFailure: true,
      auditReceiptRequired: true,
    },
    blockers: [...DESIGN_PROVISIONING_BLOCKERS],
    readyForExecution: false,
    serverContractImplemented: false,
    dryRun: true,
    databaseMutationExecuted: false,
    requiresApproval: true,
  };
  return { ...unsigned, checksum: designProvisioningPlanChecksum(unsigned) };
}

export function verifyDesignProvisioningPlan(plan, blueprint, sourceBytes) {
  if (!isRecord(plan)
    || !exactKeys(plan, [
      'schemaVersion', 'planKind', 'sourceBlueprint', 'assembly', 'operations', 'summary',
      'executionPolicy', 'blockers', 'readyForExecution', 'serverContractImplemented',
      'dryRun', 'databaseMutationExecuted', 'requiresApproval', 'checksum',
    ])
    || plan.schemaVersion !== 2
    || plan.planKind !== 'platform_design_provisioning_plan'
    || plan.readyForExecution !== false
    || plan.serverContractImplemented !== false
    || plan.dryRun !== true
    || plan.databaseMutationExecuted !== false
    || plan.requiresApproval !== true
    || !SHA256_PATTERN.test(plan.checksum ?? '')
    || designProvisioningPlanChecksum(plan) !== plan.checksum) {
    throw new Error('Design provisioning plan checksum verification failed');
  }
  const expected = buildDesignProvisioningPlan(blueprint, sourceBytes);
  if (canonicalJson(plan) !== canonicalJson(expected)) {
    throw new Error('Design provisioning plan does not match its source blueprint');
  }
  return {
    status: 'verified',
    checksum: plan.checksum,
    operationCount: plan.summary.operationCount,
    blockerCount: plan.blockers.length,
    readyForExecution: false,
    databaseMutationExecuted: false,
  };
}

function approvalDigest(approval, key) {
  const { digest: _digest, ...unsigned } = approval;
  return createHmac('sha256', key).update(canonicalJson(unsigned)).digest('hex');
}

function executionReceiptDigest(receipt, key) {
  const { digest: _digest, ...unsigned } = receipt;
  return createHmac('sha256', key).update(canonicalJson(unsigned)).digest('hex');
}

function requireTrustedApprovalKey(key) {
  if (typeof key !== 'string' || key.length < 32) {
    throw new Error('Design provisioning execution approval key is invalid');
  }
  return key;
}

function validateExecutionApprovalMetadata(metadata) {
  if (!isRecord(metadata)
    || !exactKeys(metadata, [
      'approvalId', 'executionId', 'organizationId', 'targetHost', 'approvedBy', 'approvedRole',
      'approvedAt', 'expiresAt', 'keyId',
    ])
    || !UUID_PATTERN.test(metadata.approvalId ?? '')
    || !UUID_PATTERN.test(metadata.executionId ?? '')
    || !UUID_PATTERN.test(metadata.organizationId ?? '')
    || !KEY_ID_PATTERN.test(metadata.targetHost ?? '')
    || !AUTH_REVIEWER_PATTERN.test(metadata.approvedBy ?? '')
    || !DESIGN_APPROVAL_ROLES.includes(metadata.approvedRole)
    || !KEY_ID_PATTERN.test(metadata.keyId ?? '')) {
    throw new Error('Design provisioning execution approval metadata is invalid');
  }
  const approvedAt = canonicalUtc(metadata.approvedAt);
  const expiresAt = canonicalUtc(metadata.expiresAt);
  if (!approvedAt || !expiresAt
    || expiresAt.getTime() <= approvedAt.getTime()
    || expiresAt.getTime() - approvedAt.getTime() > EXECUTION_APPROVAL_WINDOW_MS) {
    throw new Error('Design provisioning execution approval time is invalid');
  }
  return { approvedAt, expiresAt };
}

function validateExecutionApprovalState(approvalState, { approvedAt, expiresAt, now }) {
  if (!isRecord(approvalState)
    || !exactKeys(approvalState, ['approvalId', 'revokedAt', 'claim'])
    || !UUID_PATTERN.test(approvalState.approvalId ?? '')) {
    throw new Error('Design provisioning execution approval state is invalid');
  }
  let revokedAt = null;
  if (approvalState.revokedAt !== null) {
    revokedAt = canonicalUtc(approvalState.revokedAt);
    if (!revokedAt
      || revokedAt.getTime() < approvedAt.getTime()
      || revokedAt.getTime() > now.getTime()) {
      throw new Error('Design provisioning execution approval state is invalid');
    }
  }
  const claim = approvalState.claim;
  if (claim !== null) {
    const baseClaimKeys = [
      'approvalId', 'executionId', 'organizationId', 'targetHost',
      'claimedBy', 'claimedRole', 'planChecksum', 'status', 'claimedAt',
    ];
    const revisionedClaim = Object.prototype.hasOwnProperty.call(
      claim ?? {},
      'authorizationRevision',
    );
    const claimKeys = revisionedClaim
      ? [...baseClaimKeys, 'authorizationRevision']
      : baseClaimKeys;
    const terminalClaim = ['completed', 'failed'].includes(claim?.status);
    if (!isRecord(claim)
      || !exactKeys(claim, terminalClaim ? [...claimKeys, 'finalizedAt'] : claimKeys)
      || !UUID_PATTERN.test(claim.approvalId ?? '')
      || !UUID_PATTERN.test(claim.executionId ?? '')
      || !UUID_PATTERN.test(claim.organizationId ?? '')
      || !KEY_ID_PATTERN.test(claim.targetHost ?? '')
      || !AUTH_REVIEWER_PATTERN.test(claim.claimedBy ?? '')
      || !DESIGN_APPROVAL_ROLES.includes(claim.claimedRole)
      || !SHA256_PATTERN.test(claim.planChecksum ?? '')
      || (revisionedClaim && !SHA256_PATTERN.test(claim.authorizationRevision ?? ''))
      || !['claimed', 'completed', 'failed'].includes(claim.status)) {
      throw new Error('Design provisioning execution approval state is invalid');
    }
    const claimedAt = canonicalUtc(claim.claimedAt);
    if (!claimedAt
      || claimedAt.getTime() < approvedAt.getTime()
      || claimedAt.getTime() > expiresAt.getTime()
      || claimedAt.getTime() > now.getTime()) {
      throw new Error('Design provisioning execution approval state is invalid');
    }
    if (terminalClaim) {
      const finalizedAt = canonicalUtc(claim.finalizedAt);
      if (!finalizedAt
        || finalizedAt.getTime() < claimedAt.getTime()
        || finalizedAt.getTime() > now.getTime()) {
        throw new Error('Design provisioning execution approval state is invalid');
      }
    }
  }
  return { approvalId: approvalState.approvalId, revokedAt, claim };
}

export function sealDesignProvisioningExecutionApproval(
  plan,
  blueprint,
  sourceBytes,
  metadata,
  key,
) {
  verifyDesignProvisioningPlan(plan, blueprint, sourceBytes);
  validateExecutionApprovalMetadata(metadata);
  const trustedKey = requireTrustedApprovalKey(key);
  const unsigned = {
    schemaVersion: 1,
    kind: 'platform_design_provisioning_execution_approval',
    planChecksum: plan.checksum,
    sourceBlueprintSha256: plan.sourceBlueprint.sha256,
    sourceBlueprintBytes: plan.sourceBlueprint.bytes,
    operationCount: plan.summary.operationCount,
    approvalId: metadata.approvalId,
    executionId: metadata.executionId,
    organizationId: metadata.organizationId,
    targetHost: metadata.targetHost,
    approvedBy: metadata.approvedBy,
    approvedRole: metadata.approvedRole,
    approvedAt: metadata.approvedAt,
    expiresAt: metadata.expiresAt,
    keyId: metadata.keyId,
    allowDesignProvisioningMutation: true,
    allowJoinCodeDisclosure: true,
  };
  return { ...unsigned, digest: approvalDigest(unsigned, trustedKey) };
}

export function verifyDesignProvisioningExecutionApproval(
  approval,
  plan,
  blueprint,
  sourceBytes,
  {
    trustedKey,
    expectedKeyId,
    expectedOrganizationId,
    expectedTargetHost,
    now = new Date(),
    approvalState,
    allowConsumed = false,
  },
) {
  verifyDesignProvisioningPlan(plan, blueprint, sourceBytes);
  if (!isRecord(approval)
    || !exactKeys(approval, [
      'schemaVersion', 'kind', 'planChecksum', 'sourceBlueprintSha256',
      'sourceBlueprintBytes', 'operationCount', 'approvalId', 'executionId',
      'organizationId', 'targetHost', 'approvedBy', 'approvedRole',
      'approvedAt', 'expiresAt', 'keyId',
      'allowDesignProvisioningMutation', 'allowJoinCodeDisclosure', 'digest',
    ])
    || approval.schemaVersion !== 1
    || approval.kind !== 'platform_design_provisioning_execution_approval'
    || approval.planChecksum !== plan.checksum
    || approval.sourceBlueprintSha256 !== plan.sourceBlueprint.sha256
    || approval.sourceBlueprintBytes !== plan.sourceBlueprint.bytes
    || approval.operationCount !== plan.summary.operationCount
    || approval.keyId !== expectedKeyId
    || approval.organizationId !== expectedOrganizationId
    || approval.targetHost !== expectedTargetHost
    || !UUID_PATTERN.test(expectedOrganizationId ?? '')
    || !KEY_ID_PATTERN.test(expectedTargetHost ?? '')
    || approval.allowDesignProvisioningMutation !== true
    || approval.allowJoinCodeDisclosure !== true
    || !SHA256_PATTERN.test(approval.digest ?? '')) {
    throw new Error('Design provisioning execution approval is invalid');
  }
  const { approvedAt, expiresAt } = validateExecutionApprovalMetadata({
    approvalId: approval.approvalId,
    executionId: approval.executionId,
    organizationId: approval.organizationId,
    targetHost: approval.targetHost,
    approvedBy: approval.approvedBy,
    approvedRole: approval.approvedRole,
    approvedAt: approval.approvedAt,
    expiresAt: approval.expiresAt,
    keyId: approval.keyId,
  });
  const trustedNow = now instanceof Date ? now : new Date(now);
  const finalizingExistingClaim = allowConsumed === true
    && isRecord(approvalState)
    && isRecord(approvalState.claim);
  if (!Number.isFinite(trustedNow.getTime())
    || trustedNow.getTime() < approvedAt.getTime()
    || (trustedNow.getTime() > expiresAt.getTime() && !finalizingExistingClaim)) {
    throw new Error('Design provisioning execution approval is expired or not yet valid');
  }
  const expectedDigest = approvalDigest(approval, requireTrustedApprovalKey(trustedKey));
  if (!safeDigestEqual(approval.digest, expectedDigest)) {
    throw new Error('Design provisioning execution approval integrity verification failed');
  }
  const state = validateExecutionApprovalState(approvalState, {
    approvedAt,
    expiresAt,
    now: trustedNow,
  });
  if (state.approvalId !== approval.approvalId) {
    throw new Error('Design provisioning execution approval state is invalid');
  }
  if (state.revokedAt) {
    throw new Error('Design provisioning execution approval has been revoked');
  }
  const existingClaim = state.claim;
  let claimAction = 'claim_required';
  if (existingClaim) {
    if (existingClaim.approvalId !== approval.approvalId) {
      throw new Error('Design provisioning execution approval state is invalid');
    }
    if (existingClaim.executionId !== approval.executionId
      || existingClaim.organizationId !== approval.organizationId
      || existingClaim.targetHost !== approval.targetHost
      || existingClaim.claimedBy !== approval.approvedBy
      || existingClaim.claimedRole !== approval.approvedRole
      || existingClaim.planChecksum !== approval.planChecksum) {
      throw new Error('Design provisioning execution approval has already been claimed');
    }
    if (existingClaim.status === 'claimed') {
      claimAction = 'resume_existing_claim';
    } else if (allowConsumed === true) {
      claimAction = existingClaim.status === 'completed'
        ? 'completion_recorded'
        : 'failure_recorded';
    } else {
      throw new Error('Design provisioning execution approval has already been consumed');
    }
  }
  return {
    status: 'verified',
    approvalId: approval.approvalId,
    executionId: approval.executionId,
    organizationId: approval.organizationId,
    targetHost: approval.targetHost,
    approvedRole: approval.approvedRole,
    planChecksum: approval.planChecksum,
    claimAction,
    databaseMutationExecuted: false,
  };
}

function validateExecutionReceiptTimes(startedAtValue, completedAtValue) {
  const startedAt = canonicalUtc(startedAtValue);
  const completedAt = canonicalUtc(completedAtValue);
  if (!startedAt || !completedAt || completedAt.getTime() < startedAt.getTime()) {
    throw new Error('Design provisioning execution receipt time is invalid');
  }
  return { startedAt, completedAt };
}

function designProvisioningExecutionCandidate(plan) {
  const { checksum: _checksum, ...reviewPlan } = structuredClone(plan);
  const unsigned = {
    ...reviewPlan,
    blockers: [],
    readyForExecution: true,
    serverContractImplemented: true,
    dryRun: false,
    requiresApproval: false,
  };
  return { ...unsigned, checksum: designProvisioningPlanChecksum(unsigned) };
}

function designProvisioningReconciliationQuery(approval, plan) {
  const executionPlan = designProvisioningExecutionCandidate(plan);
  return {
    schemaVersion: 1,
    kind: 'platform_design_provisioning_reconciliation_query',
    approvalId: approval.approvalId,
    executionId: approval.executionId,
    approvedPlanChecksum: plan.checksum,
    executedPlanChecksum: executionPlan.checksum,
    sourceBlueprintSha256: plan.sourceBlueprint.sha256,
    sourceBlueprintBytes: plan.sourceBlueprint.bytes,
    operationCount: plan.operations.length,
    operations: plan.operations.map(({ operationId, type }) => ({ operationId, type })),
    containsSensitiveValues: false,
  };
}

function completedExecutionResult(executionPlan, executionResult) {
  if (!isRecord(executionResult)
    || !exactKeys(executionResult, ['status', 'response'])
    || executionResult.status !== 'completed'
    || !isRecord(executionResult.response)) {
    throw new Error('Design provisioning execution result is invalid');
  }
  const response = executionResult.response;
  if (!exactKeys(response, ['schemaVersion', 'planChecksum', 'operationCount', 'operations'])
    || response.schemaVersion !== 1
    || response.planChecksum !== executionPlan.checksum
    || response.operationCount !== executionPlan.operations.length
    || !Array.isArray(response.operations)
    || response.operations.length !== executionPlan.operations.length) {
    throw new Error('Design provisioning RPC response is invalid');
  }
  return response.operations.map((result, index) => {
    const operation = executionPlan.operations[index];
    const teamOperation = operation.type === 'create_team';
    const expectedKeys = teamOperation
      ? ['operationId', 'resourceId', 'status', 'joinCode']
      : ['operationId', 'resourceId', 'status'];
    if (!isRecord(result)
      || !exactKeys(result, expectedKeys)
      || result.operationId !== operation.operationId
      || !UUID_PATTERN.test(result.resourceId ?? '')
      || !['applied', 'replayed'].includes(result.status)
      || (teamOperation && !/^[0-9]{6}$/.test(result.joinCode ?? ''))) {
      throw new Error('Design provisioning RPC response is invalid');
    }
    return {
      operationId: operation.operationId,
      type: operation.type,
      status: result.status,
    };
  });
}

function normalizedExecutionReceiptOutcome(executionPlan, executionResult) {
  if (isRecord(executionResult) && executionResult.status === 'completed') {
    return {
      status: 'completed',
      operations: completedExecutionResult(executionPlan, executionResult),
      failureCode: null,
      rollbackVerified: false,
    };
  }
  if (!isRecord(executionResult)
    || !exactKeys(executionResult, ['status', 'failureCode', 'rollbackVerified'])
    || executionResult.status !== 'failed'
    || !DESIGN_PROVISIONING_FAILURE_CODES.includes(executionResult.failureCode)
    || executionResult.rollbackVerified !== true) {
    throw new Error('Design provisioning execution result is invalid');
  }
  return {
    status: 'failed',
    operations: [],
    failureCode: executionResult.failureCode,
    rollbackVerified: true,
  };
}

function receiptSummary(plan, operations) {
  return {
    plannedOperationCount: plan.operations.length,
    observedOperationCount: operations.length,
    appliedCount: operations.filter(({ status }) => status === 'applied').length,
    replayedCount: operations.filter(({ status }) => status === 'replayed').length,
  };
}

function verifyReceiptApprovalEnvelope(approval, plan, blueprint, sourceBytes, {
  trustedKey,
  expectedKeyId,
  startedAt,
}) {
  return verifyDesignProvisioningExecutionApproval(
    approval,
    plan,
    blueprint,
    sourceBytes,
    {
      trustedKey,
      expectedKeyId,
      expectedOrganizationId: approval?.organizationId,
      expectedTargetHost: approval?.targetHost,
      now: startedAt,
      approvalState: {
        approvalId: approval?.approvalId,
        revokedAt: null,
        claim: null,
      },
    },
  );
}

export function sealDesignProvisioningExecutionReceipt({
  plan,
  blueprint,
  sourceBytes,
  approval,
  approvalState,
  executionResult,
  startedAt: startedAtValue,
  completedAt: completedAtValue,
  authorizationRevision,
  trustedKey,
  expectedKeyId,
}) {
  const { startedAt, completedAt } = validateExecutionReceiptTimes(startedAtValue, completedAtValue);
  const authorization = verifyDesignProvisioningExecutionApproval(
    approval,
    plan,
    blueprint,
    sourceBytes,
    {
      trustedKey,
      expectedKeyId,
      expectedOrganizationId: approval?.organizationId,
      expectedTargetHost: approval?.targetHost,
      now: startedAt,
      approvalState,
    },
  );
  if (authorization.claimAction !== 'resume_existing_claim') {
    throw new Error('Design provisioning execution receipt requires an active claim');
  }
  if (authorizationRevision !== undefined
    && (!SHA256_PATTERN.test(authorizationRevision ?? '')
      || approvalState?.claim?.authorizationRevision !== authorizationRevision)) {
    throw new Error('Design provisioning execution receipt authorization revision is invalid');
  }
  const executionPlan = designProvisioningExecutionCandidate(plan);
  const outcome = normalizedExecutionReceiptOutcome(executionPlan, executionResult);
  const unsigned = {
    schemaVersion: 1,
    kind: 'platform_design_provisioning_execution_receipt',
    status: outcome.status,
    approvedPlanChecksum: plan.checksum,
    executedPlanChecksum: executionPlan.checksum,
    sourceBlueprintSha256: plan.sourceBlueprint.sha256,
    approvalId: approval.approvalId,
    executionId: approval.executionId,
    keyId: approval.keyId,
    ...(authorizationRevision !== undefined ? { authorizationRevision } : {}),
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    summary: receiptSummary(plan, outcome.operations),
    operations: outcome.operations,
    failureCode: outcome.failureCode,
    rollbackVerified: outcome.rollbackVerified,
    containsSensitiveValues: false,
  };
  return {
    ...unsigned,
    digest: executionReceiptDigest(unsigned, requireTrustedApprovalKey(trustedKey)),
  };
}

export function verifyDesignProvisioningExecutionReceipt(
  receipt,
  plan,
  blueprint,
  sourceBytes,
  approval,
  { trustedKey, expectedKeyId, expectedAuthorizationRevision },
) {
  verifyDesignProvisioningPlan(plan, blueprint, sourceBytes);
  const executionPlan = designProvisioningExecutionCandidate(plan);
  const revisionBound = isRecord(receipt)
    && Object.prototype.hasOwnProperty.call(receipt, 'authorizationRevision');
  if (expectedAuthorizationRevision !== undefined
    && (!SHA256_PATTERN.test(expectedAuthorizationRevision ?? '')
      || !revisionBound
      || receipt.authorizationRevision !== expectedAuthorizationRevision)) {
    throw new Error('Design provisioning execution receipt authorization revision is invalid');
  }
  const receiptKeys = [
    'schemaVersion', 'kind', 'status', 'approvedPlanChecksum', 'executedPlanChecksum',
    'sourceBlueprintSha256',
    'approvalId', 'executionId', 'keyId', 'startedAt', 'completedAt', 'summary',
    'operations', 'failureCode', 'rollbackVerified', 'containsSensitiveValues', 'digest',
  ];
  if (!isRecord(receipt)
    || !exactKeys(receipt, revisionBound
      ? [...receiptKeys, 'authorizationRevision']
      : receiptKeys)
    || receipt.schemaVersion !== 1
    || receipt.kind !== 'platform_design_provisioning_execution_receipt'
    || !['completed', 'failed'].includes(receipt.status)
    || receipt.approvedPlanChecksum !== plan.checksum
    || receipt.executedPlanChecksum !== executionPlan.checksum
    || receipt.sourceBlueprintSha256 !== plan.sourceBlueprint.sha256
    || receipt.approvalId !== approval?.approvalId
    || receipt.executionId !== approval?.executionId
    || receipt.keyId !== expectedKeyId
    || receipt.keyId !== approval?.keyId
    || (revisionBound && !SHA256_PATTERN.test(receipt.authorizationRevision ?? ''))
    || receipt.containsSensitiveValues !== false
    || !SHA256_PATTERN.test(receipt.digest ?? '')
    || !isRecord(receipt.summary)
    || !exactKeys(receipt.summary, [
      'plannedOperationCount', 'observedOperationCount', 'appliedCount', 'replayedCount',
    ])
    || !Array.isArray(receipt.operations)) {
    throw new Error('Design provisioning execution receipt is invalid');
  }
  const { startedAt } = validateExecutionReceiptTimes(receipt.startedAt, receipt.completedAt);
  verifyReceiptApprovalEnvelope(approval, plan, blueprint, sourceBytes, {
    trustedKey,
    expectedKeyId,
    startedAt,
  });
  if (receipt.status === 'completed') {
    if (receipt.failureCode !== null
      || receipt.rollbackVerified !== false
      || receipt.operations.length !== plan.operations.length) {
      throw new Error('Design provisioning execution receipt is invalid');
    }
    for (const [index, operationReceipt] of receipt.operations.entries()) {
      const planOperation = plan.operations[index];
      if (!isRecord(operationReceipt)
        || !exactKeys(operationReceipt, ['operationId', 'type', 'status'])
        || operationReceipt.operationId !== planOperation.operationId
        || operationReceipt.type !== planOperation.type
        || !['applied', 'replayed'].includes(operationReceipt.status)) {
        throw new Error('Design provisioning execution receipt is invalid');
      }
    }
  } else if (!DESIGN_PROVISIONING_FAILURE_CODES.includes(receipt.failureCode)
    || receipt.rollbackVerified !== true
    || receipt.operations.length !== 0) {
    throw new Error('Design provisioning execution receipt is invalid');
  }
  if (canonicalJson(receipt.summary) !== canonicalJson(receiptSummary(plan, receipt.operations))) {
    throw new Error('Design provisioning execution receipt summary is invalid');
  }
  const expectedDigest = executionReceiptDigest(receipt, requireTrustedApprovalKey(trustedKey));
  if (!safeDigestEqual(receipt.digest, expectedDigest)) {
    throw new Error('Design provisioning execution receipt integrity verification failed');
  }
  return {
    status: 'verified',
    executionStatus: receipt.status,
    approvalId: receipt.approvalId,
    executionId: receipt.executionId,
    planChecksum: receipt.approvedPlanChecksum,
    executedPlanChecksum: receipt.executedPlanChecksum,
    operationCount: receipt.summary.plannedOperationCount,
    containsSensitiveValues: false,
  };
}

function validateReceiptAdapter(adapter) {
  if (!isRecord(adapter)
    || !exactKeys(adapter, ['read', 'append'])
    || typeof adapter.read !== 'function'
    || typeof adapter.append !== 'function') {
    throw new Error('Design provisioning execution receipt adapter is invalid');
  }
  return adapter;
}

function validateExecutionAdapter(adapter) {
  const revisionFenced = adapter?.revisionFencedExecution === true;
  const expectedKeys = revisionFenced
    ? ['revisionFencedExecution', 'execute']
    : ['execute'];
  if (!isRecord(adapter)
    || !exactKeys(adapter, expectedKeys)
    || typeof adapter.execute !== 'function') {
    throw new Error('Design provisioning execution adapter is invalid');
  }
  return adapter;
}

function validateReconciliationAdapter(adapter) {
  const revisionFenced = adapter?.revisionFencedReconciliation === true;
  const expectedKeys = revisionFenced
    ? ['revisionFencedReconciliation', 'reconcile']
    : ['reconcile'];
  if (!isRecord(adapter)
    || !exactKeys(adapter, expectedKeys)
    || typeof adapter.reconcile !== 'function') {
    throw new Error('Design provisioning execution reconciliation adapter is invalid');
  }
  return adapter;
}

function designProvisioningAuthorizationFence(approval, snapshot) {
  const authorizationRevision = snapshot?.revision;
  if (!SHA256_PATTERN.test(authorizationRevision ?? '')
    || snapshot.state?.claim?.authorizationRevision !== authorizationRevision) {
    throw new Error('Design provisioning authorization fence is invalid');
  }
  return {
    schemaVersion: 1,
    kind: 'platform_design_provisioning_authorization_fence',
    approvalId: approval.approvalId,
    executionId: approval.executionId,
    authorizationRevision,
  };
}

function assertRevisionFencedApprovalIdentity(approval) {
  if (!isRecord(approval)
    || !UUID_V4_PATTERN.test(approval.approvalId ?? '')
    || !UUID_V4_PATTERN.test(approval.executionId ?? '')) {
    throw new Error('Design provisioning revision-fenced identity is invalid');
  }
}

function verifiedRevisionFencedResult(result, expectedRevision, label) {
  if (!isRecord(result)
    || !Object.prototype.hasOwnProperty.call(result, 'authorizationRevision')
    || result.authorizationRevision !== expectedRevision) {
    throw new Error(`Design provisioning ${label} authorization fence is invalid`);
  }
  const { authorizationRevision: _authorizationRevision, ...unfencedResult } = result;
  return unfencedResult;
}

function validateReceiptAdapterResult(result) {
  if (!isRecord(result)
    || !exactKeys(result, ['status', 'receipt'])
    || !['appended', 'existing', 'conflict'].includes(result.status)
    || !isRecord(result.receipt)) {
    throw new Error('Design provisioning execution receipt append result is invalid');
  }
  return result;
}

function validateStoredReceiptIdentity(receipt) {
  if (!isRecord(receipt)
    || receipt.kind !== 'platform_design_provisioning_execution_receipt'
    || !UUID_PATTERN.test(receipt.approvalId ?? '')
    || !UUID_PATTERN.test(receipt.executionId ?? '')
    || !SHA256_PATTERN.test(receipt.digest ?? '')) {
    throw new Error('In-memory design provisioning execution receipt is invalid');
  }
  return receipt;
}

function lifecycleTime(clock) {
  let value;
  try {
    value = clock();
  } catch {
    throw new Error('Design provisioning execution lifecycle clock failed');
  }
  const time = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (!Number.isFinite(time.getTime())) {
    throw new Error('Design provisioning execution lifecycle time is invalid');
  }
  return time;
}

async function readExecutionReceipt(adapter, executionId) {
  let receipt;
  try {
    receipt = await adapter.read(executionId);
  } catch {
    throw new Error('Design provisioning execution receipt lookup failed');
  }
  if (receipt !== null && !isRecord(receipt)) {
    throw new Error('Design provisioning execution receipt lookup result is invalid');
  }
  return receipt;
}

export function createInMemoryDesignProvisioningReceiptAdapter() {
  const receipts = new Map();
  return Object.freeze({
    async read(executionId) {
      if (!UUID_PATTERN.test(executionId ?? '')) {
        throw new Error('In-memory design provisioning execution receipt lookup is invalid');
      }
      const receipt = receipts.get(executionId);
      return receipt ? structuredClone(receipt) : null;
    },
    async append(receipt) {
      validateStoredReceiptIdentity(receipt);
      const existing = receipts.get(receipt.executionId);
      if (existing) {
        return {
          status: canonicalJson(existing) === canonicalJson(receipt) ? 'existing' : 'conflict',
          receipt: structuredClone(existing),
        };
      }
      receipts.set(receipt.executionId, structuredClone(receipt));
      return { status: 'appended', receipt: structuredClone(receipt) };
    },
  });
}

function validateLiveAuthorizationContextShape(context) {
  if (!isRecord(context)
    || !exactKeys(context, [
      'userId', 'role', 'organizationId', 'targetHost',
      'membershipActive', 'organizationActive',
    ])
    || !AUTH_REVIEWER_PATTERN.test(context.userId ?? '')
    || !DESIGN_APPROVAL_ROLES.includes(context.role)
    || !UUID_PATTERN.test(context.organizationId ?? '')
    || !KEY_ID_PATTERN.test(context.targetHost ?? '')
    || typeof context.membershipActive !== 'boolean'
    || typeof context.organizationActive !== 'boolean') {
    throw new Error('Design provisioning live authorization context is invalid');
  }
  return context;
}

function validateLiveAuthorizationContext(context, approval) {
  validateLiveAuthorizationContextShape(context);
  if (context.membershipActive !== true
    || context.organizationActive !== true
    || context.userId !== approval.approvedBy
    || context.role !== approval.approvedRole
    || context.organizationId !== approval.organizationId
    || context.targetHost !== approval.targetHost) {
    throw new Error('Design provisioning live authorization context is invalid');
  }
  return context;
}

function validateAuthorizationAdapter(adapter, { requireFinalize = false } = {}) {
  const revisioned = adapter?.revisionedLiveAuthorization === true;
  const claimOnlyKeys = revisioned
    ? ['revisionedLiveAuthorization', 'readSnapshot', 'claim']
    : ['readSnapshot', 'claim'];
  const finalizationKeys = revisioned
    ? ['revisionedLiveAuthorization', 'readSnapshot', 'claim', 'finalize']
    : ['readSnapshot', 'claim', 'finalize'];
  const claimOnlyShape = isRecord(adapter) && exactKeys(adapter, claimOnlyKeys);
  const finalizationShape = isRecord(adapter) && exactKeys(adapter, finalizationKeys);
  if (!isRecord(adapter)
    || (requireFinalize ? !finalizationShape : (!claimOnlyShape && !finalizationShape))
    || typeof adapter.readSnapshot !== 'function'
    || typeof adapter.claim !== 'function'
    || (requireFinalize && typeof adapter.finalize !== 'function')) {
    throw new Error('Design provisioning authorization adapter is invalid');
  }
  return adapter;
}

function validateAuthorizationSnapshot(snapshot, { requireRevision = false } = {}) {
  const revisioned = isRecord(snapshot)
    && Object.prototype.hasOwnProperty.call(snapshot, 'revision');
  const expectedKeys = revisioned ? ['state', 'context', 'revision'] : ['state', 'context'];
  if (!isRecord(snapshot)
    || !exactKeys(snapshot, expectedKeys)
    || (requireRevision && !revisioned)
    || (revisioned && !SHA256_PATTERN.test(snapshot.revision ?? ''))) {
    throw new Error('Design provisioning authorization snapshot is invalid');
  }
  validateLiveAuthorizationContextShape(snapshot.context);
  return snapshot;
}

function validateClaimAdapterResult(result, { requireRevision = false } = {}) {
  const revisioned = isRecord(result)
    && Object.prototype.hasOwnProperty.call(result, 'revision');
  const expectedKeys = revisioned
    ? ['status', 'state', 'context', 'revision']
    : ['status', 'state', 'context'];
  if (!isRecord(result)
    || !exactKeys(result, expectedKeys)
    || !['claimed', 'conflict'].includes(result.status)
    || (requireRevision && !revisioned)
    || (revisioned && !SHA256_PATTERN.test(result.revision ?? ''))) {
    throw new Error('Design provisioning authorization claim result is invalid');
  }
  validateLiveAuthorizationContextShape(result.context);
  return result;
}

function validateFinalizationAdapterResult(result, { requireRevision = false } = {}) {
  const revisioned = isRecord(result)
    && Object.prototype.hasOwnProperty.call(result, 'revision');
  const expectedKeys = revisioned
    ? ['status', 'state', 'context', 'revision']
    : ['status', 'state', 'context'];
  if (!isRecord(result)
    || !exactKeys(result, expectedKeys)
    || !['finalized', 'conflict'].includes(result.status)
    || (requireRevision && !revisioned)
    || (revisioned && !SHA256_PATTERN.test(result.revision ?? ''))) {
    throw new Error('Design provisioning authorization finalization result is invalid');
  }
  validateLiveAuthorizationContextShape(result.context);
  return result;
}

function assertClaimActor(state, context, authorizationRevision) {
  if (!state.claim
    || state.claim.claimedBy !== context.userId
    || state.claim.claimedRole !== context.role
    || state.claim.organizationId !== context.organizationId
    || state.claim.targetHost !== context.targetHost) {
    throw new Error('Design provisioning authorization claim actor is invalid');
  }
  const claimRevision = state.claim.authorizationRevision;
  if ((authorizationRevision !== undefined || claimRevision !== undefined)
    && (!SHA256_PATTERN.test(authorizationRevision ?? '')
      || claimRevision !== authorizationRevision)) {
    throw new Error('Design provisioning authorization claim authorization revision is invalid');
  }
}

function claimedApprovalResult(approval, disposition) {
  return {
    status: 'approval_claimed',
    approvalId: approval.approvalId,
    executionId: approval.executionId,
    organizationId: approval.organizationId,
    targetHost: approval.targetHost,
    claimedBy: approval.approvedBy,
    claimedRole: approval.approvedRole,
    claimDisposition: disposition,
    approvalGateVerified: true,
    readyForExecution: false,
    rpcMutationExecuted: false,
    databaseMutationExecuted: false,
  };
}

function finalizedApprovalResult(approval, outcome, disposition) {
  return {
    status: outcome === 'completed' ? 'approval_completed' : 'approval_failed',
    approvalId: approval.approvalId,
    executionId: approval.executionId,
    organizationId: approval.organizationId,
    targetHost: approval.targetHost,
    finalizedBy: approval.approvedBy,
    finalizedRole: approval.approvedRole,
    finalizationDisposition: disposition,
    approvalGateVerified: true,
    readyForExecution: false,
    rpcMutationExecuted: false,
    databaseMutationExecuted: false,
  };
}

export function createInMemoryDesignProvisioningAuthorizationAdapter(context) {
  validateLiveAuthorizationContextShape(context);
  const liveContext = structuredClone(context);
  const states = new Map();
  const stateFor = (approvalId) => states.get(approvalId) ?? {
    approvalId,
    revokedAt: null,
    claim: null,
  };
  return Object.freeze({
    async readSnapshot(approvalId) {
      if (!UUID_PATTERN.test(approvalId ?? '')) {
        throw new Error('In-memory design provisioning authorization lookup is invalid');
      }
      return {
        state: structuredClone(stateFor(approvalId)),
        context: structuredClone(liveContext),
      };
    },
    async claim(expectedSnapshot, claim) {
      if (!isRecord(expectedSnapshot)
        || !exactKeys(expectedSnapshot, ['state', 'context'])
        || !isRecord(expectedSnapshot.state)
        || !UUID_PATTERN.test(expectedSnapshot.state.approvalId ?? '')
        || !isRecord(claim)
        || claim.approvalId !== expectedSnapshot.state.approvalId) {
        throw new Error('In-memory design provisioning authorization claim is invalid');
      }
      const current = {
        state: structuredClone(stateFor(claim.approvalId)),
        context: structuredClone(liveContext),
      };
      if (canonicalJson(current) !== canonicalJson(expectedSnapshot)
        || current.state.revokedAt !== null
        || current.state.claim !== null) {
        return { status: 'conflict', ...current };
      }
      const nextState = { ...current.state, claim: structuredClone(claim) };
      states.set(claim.approvalId, nextState);
      return {
        status: 'claimed',
        state: structuredClone(nextState),
        context: structuredClone(liveContext),
      };
    },
    async finalize(expectedSnapshot, terminalClaim) {
      if (!isRecord(expectedSnapshot)
        || !exactKeys(expectedSnapshot, ['state', 'context'])
        || !isRecord(expectedSnapshot.state)
        || !UUID_PATTERN.test(expectedSnapshot.state.approvalId ?? '')
        || !isRecord(terminalClaim)
        || terminalClaim.approvalId !== expectedSnapshot.state.approvalId) {
        throw new Error('In-memory design provisioning authorization finalization is invalid');
      }
      const current = {
        state: structuredClone(stateFor(terminalClaim.approvalId)),
        context: structuredClone(liveContext),
      };
      const { status, finalizedAt, ...terminalIdentity } = terminalClaim;
      if (canonicalJson(current) !== canonicalJson(expectedSnapshot)
        || current.state.revokedAt !== null
        || current.state.claim?.status !== 'claimed'
        || !['completed', 'failed'].includes(status)
        || typeof finalizedAt !== 'string'
        || canonicalJson(current.state.claim) !== canonicalJson({
          ...terminalIdentity,
          status: 'claimed',
        })) {
        return { status: 'conflict', ...current };
      }
      const nextState = { ...current.state, claim: structuredClone(terminalClaim) };
      states.set(terminalClaim.approvalId, nextState);
      return {
        status: 'finalized',
        state: structuredClone(nextState),
        context: structuredClone(liveContext),
      };
    },
  });
}

export function createInMemoryRevisionedDesignProvisioningAuthorizationProvider(context) {
  validateLiveAuthorizationContextShape(context);
  let liveContext = structuredClone(context);
  let contextGeneration = 0;
  const states = new Map();
  const stateFor = (approvalId) => states.get(approvalId) ?? {
    approvalId,
    revokedAt: null,
    claim: null,
  };
  const revision = () => sha256(canonicalJson({
    domain: 'platform_design_provisioning_live_authorization_revision_v1',
    contextGeneration,
    context: liveContext,
  }));
  const snapshotFor = (approvalId) => ({
    state: structuredClone(stateFor(approvalId)),
    context: structuredClone(liveContext),
    revision: revision(),
  });
  const authorizationAdapter = Object.freeze({
    revisionedLiveAuthorization: true,
    async readSnapshot(approvalId) {
      if (!UUID_PATTERN.test(approvalId ?? '')) {
        throw new Error('In-memory revisioned authorization lookup is invalid');
      }
      return snapshotFor(approvalId);
    },
    async claim(expectedSnapshotValue, claim) {
      const expectedSnapshot = validateAuthorizationSnapshot(
        expectedSnapshotValue,
        { requireRevision: true },
      );
      if (!isRecord(claim)
        || claim.approvalId !== expectedSnapshot.state?.approvalId
        || claim.authorizationRevision !== expectedSnapshot.revision) {
        throw new Error('In-memory revisioned authorization claim is invalid');
      }
      const current = snapshotFor(claim.approvalId);
      if (canonicalJson(current) !== canonicalJson(expectedSnapshot)
        || current.state.revokedAt !== null
        || current.state.claim !== null) {
        return { status: 'conflict', ...current };
      }
      const nextState = { ...current.state, claim: structuredClone(claim) };
      states.set(claim.approvalId, nextState);
      return { status: 'claimed', ...snapshotFor(claim.approvalId) };
    },
    async finalize(expectedSnapshotValue, terminalClaim) {
      const expectedSnapshot = validateAuthorizationSnapshot(
        expectedSnapshotValue,
        { requireRevision: true },
      );
      if (!isRecord(terminalClaim)
        || terminalClaim.approvalId !== expectedSnapshot.state?.approvalId
        || terminalClaim.authorizationRevision !== expectedSnapshot.revision) {
        throw new Error('In-memory revisioned authorization finalization is invalid');
      }
      const current = snapshotFor(terminalClaim.approvalId);
      const { status, finalizedAt, ...terminalIdentity } = terminalClaim;
      if (canonicalJson(current) !== canonicalJson(expectedSnapshot)
        || current.state.revokedAt !== null
        || current.state.claim?.status !== 'claimed'
        || !['completed', 'failed'].includes(status)
        || typeof finalizedAt !== 'string'
        || canonicalJson(current.state.claim) !== canonicalJson({
          ...terminalIdentity,
          status: 'claimed',
        })) {
        return { status: 'conflict', ...current };
      }
      const nextState = { ...current.state, claim: structuredClone(terminalClaim) };
      states.set(terminalClaim.approvalId, nextState);
      return { status: 'finalized', ...snapshotFor(terminalClaim.approvalId) };
    },
  });
  return Object.freeze({
    authorizationAdapter,
    async transitionContext({ approvalId, expectedRevision, context: nextContextValue } = {}) {
      if (!UUID_PATTERN.test(approvalId ?? '')
        || !SHA256_PATTERN.test(expectedRevision ?? '')) {
        throw new Error('In-memory revisioned authorization context transition is invalid');
      }
      const nextContext = structuredClone(
        validateLiveAuthorizationContextShape(nextContextValue),
      );
      const current = snapshotFor(approvalId);
      if (current.revision !== expectedRevision) {
        return {
          status: 'conflict',
          context: current.context,
          revision: current.revision,
        };
      }
      liveContext = nextContext;
      contextGeneration += 1;
      return {
        status: 'updated',
        context: structuredClone(liveContext),
        revision: revision(),
      };
    },
  });
}

export async function claimDesignProvisioningExecutionApproval({
  approval,
  plan,
  blueprint,
  sourceBytes,
  authorizationAdapter,
  trustedKey,
  expectedKeyId,
  now = new Date(),
}) {
  const adapter = validateAuthorizationAdapter(authorizationAdapter);
  const revisionRequired = adapter.revisionedLiveAuthorization === true;
  if (!isRecord(approval) || !UUID_PATTERN.test(approval.approvalId ?? '')) {
    throw new Error('Design provisioning execution approval is invalid');
  }
  const initialSnapshot = validateAuthorizationSnapshot(
    await adapter.readSnapshot(approval?.approvalId),
    { requireRevision: revisionRequired },
  );
  validateLiveAuthorizationContext(initialSnapshot.context, approval);
  const initialAuthorization = verifyDesignProvisioningExecutionApproval(
    approval,
    plan,
    blueprint,
    sourceBytes,
    {
      trustedKey,
      expectedKeyId,
      expectedOrganizationId: initialSnapshot.context.organizationId,
      expectedTargetHost: initialSnapshot.context.targetHost,
      now,
      approvalState: initialSnapshot.state,
    },
  );
  if (initialAuthorization.claimAction === 'resume_existing_claim') {
    assertClaimActor(
      initialSnapshot.state,
      initialSnapshot.context,
      initialSnapshot.revision,
    );
    return claimedApprovalResult(approval, 'existing');
  }
  const trustedNow = now instanceof Date ? new Date(now.getTime()) : new Date(now);
  if (!Number.isFinite(trustedNow.getTime())) {
    throw new Error('Design provisioning execution approval time is invalid');
  }
  const claim = {
    approvalId: approval.approvalId,
    executionId: approval.executionId,
    organizationId: approval.organizationId,
    targetHost: approval.targetHost,
    claimedBy: initialSnapshot.context.userId,
    claimedRole: initialSnapshot.context.role,
    planChecksum: approval.planChecksum,
    status: 'claimed',
    claimedAt: trustedNow.toISOString(),
    ...(revisionRequired ? { authorizationRevision: initialSnapshot.revision } : {}),
  };
  const claimResult = validateClaimAdapterResult(
    await adapter.claim(structuredClone(initialSnapshot), claim),
    { requireRevision: revisionRequired },
  );
  if (revisionRequired && claimResult.revision !== initialSnapshot.revision) {
    throw new Error('Design provisioning authorization claim authorization revision is invalid');
  }
  validateLiveAuthorizationContext(claimResult.context, approval);
  const claimedAuthorization = verifyDesignProvisioningExecutionApproval(
    approval,
    plan,
    blueprint,
    sourceBytes,
    {
      trustedKey,
      expectedKeyId,
      expectedOrganizationId: claimResult.context.organizationId,
      expectedTargetHost: claimResult.context.targetHost,
      now: trustedNow,
      approvalState: claimResult.state,
    },
  );
  if (claimedAuthorization.claimAction !== 'resume_existing_claim') {
    throw new Error('Design provisioning authorization claim result is invalid');
  }
  assertClaimActor(claimResult.state, claimResult.context, claimResult.revision);
  return claimedApprovalResult(approval, claimResult.status === 'claimed' ? 'new' : 'reconciled');
}

export async function finalizeDesignProvisioningExecutionApproval({
  approval,
  plan,
  blueprint,
  sourceBytes,
  authorizationAdapter,
  trustedKey,
  expectedKeyId,
  outcome,
  now = new Date(),
}) {
  if (!['completed', 'failed'].includes(outcome)) {
    throw new Error('Design provisioning execution approval terminal outcome is invalid');
  }
  const adapter = validateAuthorizationAdapter(authorizationAdapter, { requireFinalize: true });
  const revisionRequired = adapter.revisionedLiveAuthorization === true;
  if (!isRecord(approval) || !UUID_PATTERN.test(approval.approvalId ?? '')) {
    throw new Error('Design provisioning execution approval is invalid');
  }
  const initialSnapshot = validateAuthorizationSnapshot(
    await adapter.readSnapshot(approval.approvalId),
    { requireRevision: revisionRequired },
  );
  validateLiveAuthorizationContext(initialSnapshot.context, approval);
  const verificationOptions = {
    trustedKey,
    expectedKeyId,
    expectedOrganizationId: initialSnapshot.context.organizationId,
    expectedTargetHost: initialSnapshot.context.targetHost,
    now,
    approvalState: initialSnapshot.state,
    allowConsumed: true,
  };
  const initialAuthorization = verifyDesignProvisioningExecutionApproval(
    approval,
    plan,
    blueprint,
    sourceBytes,
    verificationOptions,
  );
  if (!initialSnapshot.state.claim) {
    throw new Error('Design provisioning authorization finalization requires an active claim');
  }
  assertClaimActor(
    initialSnapshot.state,
    initialSnapshot.context,
    initialSnapshot.revision,
  );
  const expectedAction = outcome === 'completed' ? 'completion_recorded' : 'failure_recorded';
  if (['completion_recorded', 'failure_recorded'].includes(initialAuthorization.claimAction)) {
    if (initialAuthorization.claimAction !== expectedAction) {
      throw new Error('Design provisioning authorization terminal outcome conflicts');
    }
    return finalizedApprovalResult(approval, outcome, 'existing');
  }
  if (initialAuthorization.claimAction !== 'resume_existing_claim') {
    throw new Error('Design provisioning authorization finalization requires an active claim');
  }
  const trustedNow = now instanceof Date ? new Date(now.getTime()) : new Date(now);
  if (!Number.isFinite(trustedNow.getTime())) {
    throw new Error('Design provisioning execution approval time is invalid');
  }
  const terminalClaim = {
    ...structuredClone(initialSnapshot.state.claim),
    status: outcome,
    finalizedAt: trustedNow.toISOString(),
  };
  const finalizationResult = validateFinalizationAdapterResult(
    await adapter.finalize(structuredClone(initialSnapshot), terminalClaim),
    { requireRevision: revisionRequired },
  );
  if (revisionRequired && finalizationResult.revision !== initialSnapshot.revision) {
    throw new Error('Design provisioning authorization claim authorization revision is invalid');
  }
  if (finalizationResult.status === 'finalized'
    && canonicalJson(finalizationResult.state?.claim) !== canonicalJson(terminalClaim)) {
    throw new Error('Design provisioning authorization finalization result is invalid');
  }
  validateLiveAuthorizationContext(finalizationResult.context, approval);
  const finalizedAuthorization = verifyDesignProvisioningExecutionApproval(
    approval,
    plan,
    blueprint,
    sourceBytes,
    {
      ...verificationOptions,
      expectedOrganizationId: finalizationResult.context.organizationId,
      expectedTargetHost: finalizationResult.context.targetHost,
      approvalState: finalizationResult.state,
    },
  );
  if (finalizedAuthorization.claimAction !== expectedAction) {
    if (['completion_recorded', 'failure_recorded'].includes(finalizedAuthorization.claimAction)) {
      throw new Error('Design provisioning authorization terminal outcome conflicts');
    }
    throw new Error('Design provisioning authorization finalization result is invalid');
  }
  assertClaimActor(
    finalizationResult.state,
    finalizationResult.context,
    finalizationResult.revision,
  );
  return finalizedApprovalResult(
    approval,
    outcome,
    finalizationResult.status === 'finalized' ? 'new' : 'reconciled',
  );
}

function lifecycleResult(receipt, verification, finalization, {
  executionDisposition,
  receiptDisposition,
}) {
  return {
    status: receipt.status === 'completed' ? 'execution_completed' : 'execution_failed',
    approvalId: receipt.approvalId,
    executionId: receipt.executionId,
    planChecksum: verification.planChecksum,
    executedPlanChecksum: verification.executedPlanChecksum,
    operationCount: verification.operationCount,
    executionDisposition,
    receiptDisposition,
    finalizationDisposition: finalization.finalizationDisposition,
    failureCode: receipt.failureCode,
    rollbackVerified: receipt.rollbackVerified,
    containsSensitiveValues: false,
  };
}

async function finalizeStoredExecutionReceipt({
  receipt,
  approval,
  plan,
  blueprint,
  sourceBytes,
  authorizationAdapter,
  trustedKey,
  expectedKeyId,
  clock,
  executionDisposition,
  receiptDisposition,
  requireRevisionBoundReceipt = false,
}) {
  let expectedAuthorizationRevision;
  if (requireRevisionBoundReceipt) {
    const snapshot = validateAuthorizationSnapshot(
      await authorizationAdapter.readSnapshot(approval.approvalId),
      { requireRevision: true },
    );
    validateLiveAuthorizationContext(snapshot.context, approval);
    assertClaimActor(snapshot.state, snapshot.context, snapshot.revision);
    expectedAuthorizationRevision = snapshot.revision;
  }
  const verification = verifyDesignProvisioningExecutionReceipt(
    receipt,
    plan,
    blueprint,
    sourceBytes,
    approval,
    { trustedKey, expectedKeyId, expectedAuthorizationRevision },
  );
  const finalizationAt = lifecycleTime(clock);
  const receiptCompletedAt = canonicalUtc(receipt.completedAt);
  if (!receiptCompletedAt || finalizationAt.getTime() < receiptCompletedAt.getTime()) {
    throw new Error('Design provisioning execution receipt finalization time is invalid');
  }
  const finalization = await finalizeDesignProvisioningExecutionApproval({
    approval,
    plan,
    blueprint,
    sourceBytes,
    authorizationAdapter,
    trustedKey,
    expectedKeyId,
    outcome: receipt.status,
    now: finalizationAt,
  });
  return lifecycleResult(receipt, verification, finalization, {
    executionDisposition,
    receiptDisposition,
  });
}

async function persistExecutionReceiptAndFinalize({
  executionResult,
  startedAt,
  completedAt,
  approval,
  plan,
  blueprint,
  sourceBytes,
  authorizationAdapter,
  receiptAdapter,
  trustedKey,
  expectedKeyId,
  clock,
  executionDisposition,
  authorizationRevision,
  requireRevisionBoundReceipt = false,
}) {
  const claimedSnapshot = validateAuthorizationSnapshot(
    await authorizationAdapter.readSnapshot(approval.approvalId),
    { requireRevision: authorizationAdapter.revisionedLiveAuthorization === true },
  );
  validateLiveAuthorizationContext(claimedSnapshot.context, approval);
  assertClaimActor(
    claimedSnapshot.state,
    claimedSnapshot.context,
    claimedSnapshot.revision,
  );
  const candidateReceipt = sealDesignProvisioningExecutionReceipt({
    plan,
    blueprint,
    sourceBytes,
    approval,
    approvalState: claimedSnapshot.state,
    executionResult,
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    authorizationRevision,
    trustedKey,
    expectedKeyId,
  });

  let appendResult;
  try {
    appendResult = validateReceiptAdapterResult(await receiptAdapter.append(candidateReceipt));
  } catch (error) {
    if (error instanceof Error
      && error.message === 'Design provisioning execution receipt append result is invalid') {
      throw error;
    }
    throw new Error('Design provisioning execution receipt append failed');
  }
  if (appendResult.status === 'appended'
    && canonicalJson(appendResult.receipt) !== canonicalJson(candidateReceipt)) {
    throw new Error('Design provisioning execution receipt append result is invalid');
  }
  const persistedReceipt = await readExecutionReceipt(receiptAdapter, approval.executionId);
  if (!persistedReceipt) {
    throw new Error('Design provisioning execution receipt persistence is not observable');
  }
  if (canonicalJson(persistedReceipt) !== canonicalJson(appendResult.receipt)) {
    throw new Error('Design provisioning execution receipt append result is invalid');
  }
  return finalizeStoredExecutionReceipt({
    receipt: persistedReceipt,
    approval,
    plan,
    blueprint,
    sourceBytes,
    authorizationAdapter,
    trustedKey,
    expectedKeyId,
    clock,
    executionDisposition,
    receiptDisposition: appendResult.status === 'appended' ? 'appended' : 'reconciled',
    requireRevisionBoundReceipt,
  });
}

export async function executeDesignProvisioningApprovalLifecycle({
  approval,
  plan,
  blueprint,
  sourceBytes,
  authorizationAdapter,
  receiptAdapter: receiptAdapterValue,
  executionAdapter: executionAdapterValue,
  trustedKey,
  expectedKeyId,
  clock = () => new Date(),
  requireRevisionBoundReceipt = false,
}) {
  const authorization = validateAuthorizationAdapter(
    authorizationAdapter,
    { requireFinalize: true },
  );
  const receipts = validateReceiptAdapter(receiptAdapterValue);
  const execution = validateExecutionAdapter(executionAdapterValue);
  if (typeof requireRevisionBoundReceipt !== 'boolean') {
    throw new Error('Design provisioning revision-bound receipt requirement is invalid');
  }
  if (requireRevisionBoundReceipt
    && (authorization.revisionedLiveAuthorization !== true
      || execution.revisionFencedExecution !== true)) {
    throw new Error('Design provisioning revision-bound receipt adapters are required');
  }
  if (execution.revisionFencedExecution === true
    && authorization.revisionedLiveAuthorization !== true) {
    throw new Error('Design provisioning revision-fenced execution requires revisioned authorization');
  }
  if (typeof clock !== 'function') {
    throw new Error('Design provisioning execution lifecycle clock is invalid');
  }
  if (execution.revisionFencedExecution === true) {
    assertRevisionFencedApprovalIdentity(approval);
  }

  const existingReceipt = await readExecutionReceipt(receipts, approval?.executionId);
  if (existingReceipt) {
    return finalizeStoredExecutionReceipt({
      receipt: existingReceipt,
      approval,
      plan,
      blueprint,
      sourceBytes,
      authorizationAdapter: authorization,
      trustedKey,
      expectedKeyId,
      clock,
      executionDisposition: 'existing_receipt',
      receiptDisposition: 'existing',
      requireRevisionBoundReceipt,
    });
  }

  const startedAt = lifecycleTime(clock);
  const claimResult = await claimDesignProvisioningExecutionApproval({
    approval,
    plan,
    blueprint,
    sourceBytes,
    authorizationAdapter: authorization,
    trustedKey,
    expectedKeyId,
    now: startedAt,
  });

  const receiptAfterClaim = await readExecutionReceipt(receipts, approval.executionId);
  if (receiptAfterClaim) {
    return finalizeStoredExecutionReceipt({
      receipt: receiptAfterClaim,
      approval,
      plan,
      blueprint,
      sourceBytes,
      authorizationAdapter: authorization,
      trustedKey,
      expectedKeyId,
      clock,
      executionDisposition: 'existing_receipt',
      receiptDisposition: 'existing',
      requireRevisionBoundReceipt,
    });
  }

  if (claimResult.claimDisposition !== 'new') {
    throw new Error('Design provisioning existing claim requires receipt reconciliation');
  }

  const executionAuthorizationSnapshot = validateAuthorizationSnapshot(
    await authorization.readSnapshot(approval.approvalId),
    { requireRevision: authorization.revisionedLiveAuthorization === true },
  );
  validateLiveAuthorizationContext(executionAuthorizationSnapshot.context, approval);
  const executionAuthorization = verifyDesignProvisioningExecutionApproval(
    approval,
    plan,
    blueprint,
    sourceBytes,
    {
      trustedKey,
      expectedKeyId,
      expectedOrganizationId: executionAuthorizationSnapshot.context.organizationId,
      expectedTargetHost: executionAuthorizationSnapshot.context.targetHost,
      now: startedAt,
      approvalState: executionAuthorizationSnapshot.state,
    },
  );
  if (executionAuthorization.claimAction !== 'resume_existing_claim') {
    throw new Error('Design provisioning execution authorization is no longer active');
  }
  assertClaimActor(
    executionAuthorizationSnapshot.state,
    executionAuthorizationSnapshot.context,
    executionAuthorizationSnapshot.revision,
  );

  const executionPlan = designProvisioningExecutionCandidate(plan);
  const authorizationFence = execution.revisionFencedExecution === true
    ? designProvisioningAuthorizationFence(approval, executionAuthorizationSnapshot)
    : null;
  let executionResult;
  try {
    executionResult = await execution.execute({
      plan: structuredClone(executionPlan),
      sourceBytes: Buffer.from(sourceBytes),
      ...(authorizationFence
        ? { authorizationFence: structuredClone(authorizationFence) }
        : {}),
    });
  } catch {
    throw new Error('Design provisioning execution adapter failed');
  }
  if (authorizationFence) {
    executionResult = verifiedRevisionFencedResult(
      executionResult,
      authorizationFence.authorizationRevision,
      'execution result',
    );
  }
  const completedAt = lifecycleTime(clock);
  return persistExecutionReceiptAndFinalize({
    executionResult,
    startedAt,
    completedAt,
    approval,
    plan,
    blueprint,
    sourceBytes,
    authorizationAdapter: authorization,
    receiptAdapter: receipts,
    trustedKey,
    expectedKeyId,
    clock,
    executionDisposition: 'executed',
    authorizationRevision: authorizationFence?.authorizationRevision,
    requireRevisionBoundReceipt,
  });
}

export async function reconcileDesignProvisioningApprovalLifecycle({
  approval,
  plan,
  blueprint,
  sourceBytes,
  authorizationAdapter,
  receiptAdapter: receiptAdapterValue,
  reconciliationAdapter: reconciliationAdapterValue,
  trustedKey,
  expectedKeyId,
  clock = () => new Date(),
  requireRevisionBoundReceipt = false,
}) {
  const authorization = validateAuthorizationAdapter(
    authorizationAdapter,
    { requireFinalize: true },
  );
  const receipts = validateReceiptAdapter(receiptAdapterValue);
  const reconciliation = validateReconciliationAdapter(reconciliationAdapterValue);
  if (typeof requireRevisionBoundReceipt !== 'boolean') {
    throw new Error('Design provisioning revision-bound receipt requirement is invalid');
  }
  if (requireRevisionBoundReceipt
    && (authorization.revisionedLiveAuthorization !== true
      || reconciliation.revisionFencedReconciliation !== true)) {
    throw new Error('Design provisioning revision-bound receipt adapters are required');
  }
  if (reconciliation.revisionFencedReconciliation === true
    && authorization.revisionedLiveAuthorization !== true) {
    throw new Error(
      'Design provisioning revision-fenced reconciliation requires revisioned authorization',
    );
  }
  if (typeof clock !== 'function') {
    throw new Error('Design provisioning execution lifecycle clock is invalid');
  }
  if (reconciliation.revisionFencedReconciliation === true) {
    assertRevisionFencedApprovalIdentity(approval);
  }

  const existingReceipt = await readExecutionReceipt(receipts, approval?.executionId);
  if (existingReceipt) {
    return finalizeStoredExecutionReceipt({
      receipt: existingReceipt,
      approval,
      plan,
      blueprint,
      sourceBytes,
      authorizationAdapter: authorization,
      trustedKey,
      expectedKeyId,
      clock,
      executionDisposition: 'existing_receipt',
      receiptDisposition: 'existing',
      requireRevisionBoundReceipt,
    });
  }

  const reconciliationAt = lifecycleTime(clock);
  const initialSnapshot = validateAuthorizationSnapshot(
    await authorization.readSnapshot(approval?.approvalId),
    { requireRevision: authorization.revisionedLiveAuthorization === true },
  );
  validateLiveAuthorizationContext(initialSnapshot.context, approval);
  const initialAuthorization = verifyDesignProvisioningExecutionApproval(
    approval,
    plan,
    blueprint,
    sourceBytes,
    {
      trustedKey,
      expectedKeyId,
      expectedOrganizationId: initialSnapshot.context.organizationId,
      expectedTargetHost: initialSnapshot.context.targetHost,
      now: reconciliationAt,
      approvalState: initialSnapshot.state,
      allowConsumed: true,
    },
  );
  if (initialAuthorization.claimAction !== 'resume_existing_claim') {
    throw new Error('Design provisioning execution reconciliation requires an active claim');
  }
  assertClaimActor(
    initialSnapshot.state,
    initialSnapshot.context,
    initialSnapshot.revision,
  );
  const startedAt = canonicalUtc(initialSnapshot.state.claim?.claimedAt);
  if (!startedAt) {
    throw new Error('Design provisioning execution reconciliation claim is invalid');
  }

  const receiptAfterClaim = await readExecutionReceipt(receipts, approval.executionId);
  if (receiptAfterClaim) {
    return finalizeStoredExecutionReceipt({
      receipt: receiptAfterClaim,
      approval,
      plan,
      blueprint,
      sourceBytes,
      authorizationAdapter: authorization,
      trustedKey,
      expectedKeyId,
      clock,
      executionDisposition: 'existing_receipt',
      receiptDisposition: 'existing',
      requireRevisionBoundReceipt,
    });
  }

  const reconciliationQuery = designProvisioningReconciliationQuery(approval, plan);
  const authorizationFence = reconciliation.revisionFencedReconciliation === true
    ? designProvisioningAuthorizationFence(approval, initialSnapshot)
    : null;
  let reconciliationResult;
  try {
    reconciliationResult = await reconciliation.reconcile({
      query: structuredClone(reconciliationQuery),
      ...(authorizationFence
        ? { authorizationFence: structuredClone(authorizationFence) }
        : {}),
    });
  } catch {
    throw new Error('Design provisioning execution reconciliation adapter failed');
  }
  if (authorizationFence) {
    reconciliationResult = verifiedRevisionFencedResult(
      reconciliationResult,
      authorizationFence.authorizationRevision,
      'reconciliation result',
    );
  }

  const receiptAfterReconciliation = await readExecutionReceipt(receipts, approval.executionId);
  if (receiptAfterReconciliation) {
    return finalizeStoredExecutionReceipt({
      receipt: receiptAfterReconciliation,
      approval,
      plan,
      blueprint,
      sourceBytes,
      authorizationAdapter: authorization,
      trustedKey,
      expectedKeyId,
      clock,
      executionDisposition: 'existing_receipt',
      receiptDisposition: 'existing',
      requireRevisionBoundReceipt,
    });
  }

  if (isRecord(reconciliationResult)
    && exactKeys(reconciliationResult, ['status'])
    && reconciliationResult.status === 'pending') {
    throw new Error('Design provisioning execution reconciliation remains pending');
  }

  return persistExecutionReceiptAndFinalize({
    executionResult: reconciliationResult,
    startedAt,
    completedAt: lifecycleTime(clock),
    approval,
    plan,
    blueprint,
    sourceBytes,
    authorizationAdapter: authorization,
    receiptAdapter: receipts,
    trustedKey,
    expectedKeyId,
    clock,
    executionDisposition: 'reconciled',
    authorizationRevision: authorizationFence?.authorizationRevision,
    requireRevisionBoundReceipt,
  });
}

function requireRevisionedAuthorizationAdapter(adapterValue) {
  const adapter = validateAuthorizationAdapter(
    adapterValue,
    { requireFinalize: true },
  );
  if (adapter.revisionedLiveAuthorization !== true) {
    throw new Error('Design provisioning revisioned authorization adapter is required');
  }
  return adapter;
}

function requireRevisionFencedExecutionAdapter(adapterValue) {
  const adapter = validateExecutionAdapter(adapterValue);
  if (adapter.revisionFencedExecution !== true) {
    throw new Error('Design provisioning revision-fenced execution adapter is required');
  }
  return adapter;
}

function requireRevisionFencedReconciliationAdapter(adapterValue) {
  const adapter = validateReconciliationAdapter(adapterValue);
  if (adapter.revisionFencedReconciliation !== true) {
    throw new Error('Design provisioning revision-fenced reconciliation adapter is required');
  }
  return adapter;
}

export async function executeDesignProvisioningApprovalLifecycleWithRevisionedAuthorization(
  options = {},
) {
  const authorizationAdapter = requireRevisionedAuthorizationAdapter(
    options.authorizationAdapter,
  );
  const executionAdapter = requireRevisionFencedExecutionAdapter(
    options.executionAdapter,
  );
  return executeDesignProvisioningApprovalLifecycle({
    ...options,
    authorizationAdapter,
    executionAdapter,
    requireRevisionBoundReceipt: true,
  });
}

export async function reconcileDesignProvisioningApprovalLifecycleWithRevisionedAuthorization(
  options = {},
) {
  const authorizationAdapter = requireRevisionedAuthorizationAdapter(
    options.authorizationAdapter,
  );
  const reconciliationAdapter = requireRevisionFencedReconciliationAdapter(
    options.reconciliationAdapter,
  );
  return reconcileDesignProvisioningApprovalLifecycle({
    ...options,
    authorizationAdapter,
    reconciliationAdapter,
    requireRevisionBoundReceipt: true,
  });
}

function readJsonFile(path, label, maximumBytes) {
  let bytes;
  try {
    bytes = readFileSync(path);
  } catch {
    throw new Error(`Unable to read ${label}`);
  }
  if (bytes.length === 0 || bytes.length > maximumBytes) {
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
    throw new Error(forWrite ? 'Design provisioning output directory is unavailable' : 'Design provisioning path is unavailable');
  }
  if (isWithin(REPO_ROOT, resolvedTarget)) {
    throw new Error('Design provisioning files must remain outside the repository');
  }
  return absolutePath;
}

function valueAfter(args, option) {
  const index = args.indexOf(option);
  if (index < 0 || index + 1 >= args.length) return null;
  return args[index + 1];
}

export function runDesignProvisioningCli(args) {
  const sourceArgument = valueAfter(args, '--source');
  const verifyArgument = valueAfter(args, '--verify');
  const outputArgument = valueAfter(args, '--output');
  const force = args.includes('--force');
  if (!sourceArgument) throw new Error('Use --source <path> with a design blueprint');
  const sourcePath = requireExternalPath(sourceArgument);
  const source = readJsonFile(
    sourcePath,
    'design blueprint',
    DESIGN_BLUEPRINT_CONTRACT.limits.importBytes,
  );
  if (verifyArgument) {
    if (outputArgument || force || args.length !== 4) {
      throw new Error('Invalid design provisioning verification arguments');
    }
    const planPath = requireExternalPath(verifyArgument);
    const plan = readJsonFile(planPath, 'design provisioning plan', MAX_PROVISIONING_PLAN_BYTES);
    return verifyDesignProvisioningPlan(plan.value, source.value, source.bytes);
  }
  if (!outputArgument || args.length !== 4 + Number(force)) {
    throw new Error('Use --output <path> to create a design provisioning plan');
  }
  const outputPath = requireExternalPath(outputArgument, { forWrite: true });
  const plan = buildDesignProvisioningPlan(source.value, source.bytes);
  try {
    writeFileSync(outputPath, `${JSON.stringify(plan, null, 2)}\n`, {
      encoding: 'utf8',
      flag: force ? 'w' : 'wx',
      mode: 0o600,
    });
  } catch (error) {
    if (!force && isRecord(error) && error.code === 'EEXIST') {
      throw new Error('Design provisioning plan already exists; use --force to replace it');
    }
    throw new Error('Unable to write the design provisioning plan');
  }
  return {
    status: 'written',
    checksum: plan.checksum,
    operationCount: plan.summary.operationCount,
    blockerCount: plan.blockers.length,
    readyForExecution: false,
    databaseMutationExecuted: false,
  };
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (invokedPath === import.meta.url) {
  try {
    process.stdout.write(`${JSON.stringify(runDesignProvisioningCli(process.argv.slice(2)))}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown failure';
    console.error(`design provisioning plan failed: ${message}`);
    process.exitCode = 1;
  }
}
