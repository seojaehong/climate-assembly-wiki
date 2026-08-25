import { fileURLToPath } from 'node:url';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const PLATFORM_PAYLOAD_COLLECTIONS = [
  'submission',
  'submission_item',
  'issue',
  'issue_link',
  'result_page',
  'ballot',
  'ballot_item',
  'ballot_response',
];
const DECLARED_PLATFORM_COUNTS = ['submission', 'issue', 'issue_link', 'result_page', 'ballot'];
const ARCHIVE_RESTORE_ORDER = [
  'submission',
  'submission_item',
  'issue',
  'issue_link',
  'result_page',
  'ballot',
  'ballot_item',
  'ballot_response',
];
const RESTORE_PAYLOAD_FIELDS = new Set([...ARCHIVE_RESTORE_ORDER, 'counts']);
const RESTORE_ROW_FIELDS = {
  submission: new Set([
    'id', 'topic_id', 'team_id', 'status', 'finalized_at', 'finalized_by',
    'archived_at', 'created_at', 'updated_at', 'org_id',
  ]),
  submission_item: new Set([
    'id', 'submission_id', 'ordinal', 'kind', 'content', 'rationale',
    'provenance', 'created_at',
  ]),
  issue: new Set([
    'id', 'topic_id', 'label', 'stance', 'frequency_class', 'summary', 'origin',
    'review_status', 'reviewed_by', 'reviewed_at', 'archived_at', 'org_id', 'created_at',
  ]),
  issue_link: new Set([
    'issue_id', 'item_id', 'cluster_id', 'linked_by', 'created_at',
  ]),
  result_page: new Set([
    'id', 'scope', 'scope_id', 'token', 'title', 'body', 'published_at',
    'published_by', 'archived_at', 'org_id', 'created_at',
  ]),
  ballot: new Set([
    'id', 'session_id', 'title', 'instructions', 'status', 'token', 'created_by',
    'published_at', 'archived_at', 'created_at', 'subgroup', 'org_id',
  ]),
  ballot_item: new Set([
    'id', 'ballot_id', 'ordinal', 'statement', 'description', 'scale', 'required',
  ]),
  ballot_response: new Set([
    'id', 'ballot_id', 'client_id', 'answers', 'submitted_at', 'org_id',
  ]),
};
const RESTORE_IDENTITY_KEYS = {
  submission: ['id'],
  submission_item: ['id'],
  issue: ['id'],
  issue_link: ['issue_id', 'item_id'],
  result_page: ['id'],
  ballot: ['id'],
  ballot_item: ['id'],
  ballot_response: ['id'],
};
const ID_COLLECTIONS = ARCHIVE_RESTORE_ORDER.filter((key) => key !== 'issue_link');
const UNIQUE_KEYS = [
  ['submission', ['topic_id', 'team_id']],
  ['submission_item', ['submission_id', 'ordinal']],
  ['issue_link', ['issue_id', 'item_id']],
  ['result_page', ['token']],
  ['ballot', ['token']],
  ['ballot_item', ['ballot_id', 'ordinal']],
  ['ballot_response', ['ballot_id', 'client_id']],
];
const VALID_BALLOT_SCALES = new Set([2, 4, 5, 7]);
const VALID_BALLOT_STATUSES = new Set(['draft', 'open', 'closed', 'published', 'archived']);
const VALID_SUBMISSION_STATUSES = new Set(['draft', 'final', 'reopened', 'archived']);
const VALID_SUBMISSION_ITEM_KINDS = new Set(['core', 'extra']);
const VALID_ISSUE_STANCES = new Set(['pro', 'con', 'conditional', 'concern', 'proposal', 'neutral']);
const VALID_ISSUE_FREQUENCY_CLASSES = new Set(['consensus', 'majority', 'minority', 'mixed']);
const VALID_ISSUE_ORIGINS = new Set(['ai', 'human']);
const VALID_ISSUE_REVIEW_STATUSES = new Set(['draft', 'reviewed', 'archived']);
const VALID_ISSUE_LINK_AUTHORS = new Set(['ai', 'human']);
const POSTGRES_INTEGER_MIN = -2_147_483_648;
const POSTGRES_INTEGER_MAX = 2_147_483_647;
const CANONICAL_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Maps non-secret GitHub workflow provenance into the export audit manifest. */
export function workflowAuditContext(environment, exportedAt = new Date().toISOString()) {
  return {
    exportedAt,
    repository: environment.GITHUB_REPOSITORY ?? null,
    runId: environment.GITHUB_RUN_ID ?? null,
    commitSha: environment.GITHUB_SHA ?? null,
    workflowRef: environment.GITHUB_WORKFLOW_REF ?? null,
    keyId: environment.SNAPSHOT_AUDIT_KEY_ID ?? null,
  };
}

export async function snapshotRound({
  client,
  roundId,
  label = null,
  maxRetries = 5,
  baseDelayMs = 1000,
  alert = () => {},
  cumulativeFailures = 0
}) {
  return runSnapshotRpc({
    client,
    roundId,
    rpcName: 'cv_snapshot_now',
    rpcArgs: { p_label: label, p_source: 'cron' },
    snapshotKind: 'legacy',
    maxRetries,
    baseDelayMs,
    alert,
    cumulativeFailures,
  });
}

/** Preserves the legacy snapshot and optionally adds the platform data snapshot. */
export async function snapshotArchive({
  client,
  roundId,
  label = null,
  includePlatformSnapshot = false,
  maxRetries = 5,
  baseDelayMs = 1000,
  alert = () => {},
  cumulativeFailures = 0,
  auditContext = {},
  auditKey = '',
}) {
  const shared = { client, roundId, maxRetries, baseDelayMs, alert, cumulativeFailures };
  const legacy = await snapshotRound({ ...shared, label });
  if (!includePlatformSnapshot) return legacy;
  validateAuditConfiguration(auditKey, auditContext);
  const receipt = await runSnapshotRpc({
    ...shared,
    rpcName: 'platform_snapshot_now',
    rpcArgs: { p_label: label },
    snapshotKind: 'platform',
  });
  const platform = await readSnapshotRow({
    ...shared,
    snapshotId: receipt?.id,
  });
  return { legacy, platform, audit: buildSnapshotAudit(platform, auditContext, auditKey) };
}

function validateAuditConfiguration(auditKey, context) {
  const provenance = [
    context.exportedAt,
    context.repository,
    context.runId,
    context.commitSha,
    context.workflowRef,
    context.keyId,
  ];
  if (typeof auditKey !== 'string' || auditKey.length < 32 || provenance.some((value) => typeof value !== 'string' || value.length === 0)) {
    throw new Error('platform snapshot audit configuration is incomplete');
  }
}

function buildSnapshotAudit(platform, context, auditKey) {
  const audit = {
    schemaVersion: 1,
    event: 'platform_snapshot_export',
    exportedAt: context.exportedAt,
    repository: context.repository,
    runId: context.runId,
    commitSha: context.commitSha,
    workflowRef: context.workflowRef,
    keyId: context.keyId,
    snapshotId: platform.id,
  };
  return {
    ...audit,
    integrity: {
      algorithm: 'hmac-sha256',
      target: 'platform+provenance',
      digest: snapshotDigest(platform, audit, auditKey),
    },
  };
}

function snapshotDigest(platform, audit, auditKey) {
  const signedRecord = {
    schemaVersion: audit.schemaVersion,
    event: audit.event,
    exportedAt: audit.exportedAt,
    repository: audit.repository,
    runId: audit.runId,
    commitSha: audit.commitSha,
    workflowRef: audit.workflowRef,
    keyId: audit.keyId,
    snapshotId: audit.snapshotId,
    platform,
  };
  return createHmac('sha256', auditKey).update(JSON.stringify(signedRecord)).digest('hex');
}

/** Verifies that the exported platform row still matches its audit manifest. */
export function verifySnapshotArchiveIntegrity(archive, auditKey) {
  if (!archive?.platform || !archive?.audit) return false;
  if (typeof auditKey !== 'string' || auditKey.length < 32) return false;
  if (archive.audit.schemaVersion !== 1 || archive.audit.event !== 'platform_snapshot_export') return false;
  if (archive.audit.snapshotId !== archive.platform.id) return false;
  if (archive.audit.integrity?.algorithm !== 'hmac-sha256' || archive.audit.integrity?.target !== 'platform+provenance') return false;
  if (!/^[a-f0-9]{64}$/.test(archive.audit.integrity.digest)) return false;
  const expected = Buffer.from(snapshotDigest(archive.platform, archive.audit, auditKey), 'hex');
  const actual = Buffer.from(archive.audit.integrity.digest, 'hex');
  return timingSafeEqual(actual, expected);
}

function readVerifiedSnapshotArchive({ filePath, auditKey }) {
  let archive;
  try {
    archive = JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    throw new Error('snapshot archive JSON is invalid');
  }
  if (!verifySnapshotArchiveIntegrity(archive, auditKey)) {
    throw new Error('snapshot archive integrity verification failed');
  }
  if (archive.platform.source !== 'platform') {
    throw new Error('snapshot archive platform source is invalid');
  }
  const payload = archive.platform?.payload;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('snapshot archive platform payload is missing');
  }
  const counts = {};
  for (const key of PLATFORM_PAYLOAD_COLLECTIONS) {
    if (!Array.isArray(payload[key])) {
      throw new Error(`snapshot archive collection is missing: ${key}`);
    }
    counts[key] = payload[key].length;
  }
  if (!payload.counts || typeof payload.counts !== 'object' || Array.isArray(payload.counts)) {
    throw new Error('snapshot archive declared counts are missing');
  }
  for (const key of DECLARED_PLATFORM_COUNTS) {
    if (payload.counts[key] !== counts[key]) {
      throw new Error(`snapshot archive count mismatch: ${key}`);
    }
  }
  return { archive, payload, counts };
}

/** Verifies a signed archive file and returns metadata plus collection counts only. */
export function verifySnapshotArchiveFile({ filePath, auditKey }) {
  const { archive, counts } = readVerifiedSnapshotArchive({ filePath, auditKey });
  return {
    status: 'verified',
    snapshotId: archive.platform.id,
    source: archive.platform.source,
    keyId: archive.audit.keyId,
    exportedAt: archive.audit.exportedAt,
    repository: archive.audit.repository,
    runId: archive.audit.runId,
    commitSha: archive.audit.commitSha,
    workflowRef: archive.audit.workflowRef,
    counts,
  };
}

function collectionIds(payload, collection) {
  const ids = new Set();
  for (const row of payload[collection]) {
    if (!row || typeof row !== 'object' || Array.isArray(row) || typeof row.id !== 'string' || row.id.length === 0) {
      throw new Error(`snapshot archive row id is missing: ${collection}`);
    }
    assertCanonicalUuid(row.id, `${collection}.id`);
    if (ids.has(row.id)) throw new Error(`snapshot archive duplicate id: ${collection}`);
    ids.add(row.id);
  }
  return ids;
}

function validateRestoreRowFields(payload) {
  if (Object.keys(payload).some((field) => !RESTORE_PAYLOAD_FIELDS.has(field))) {
    throw new Error('snapshot archive payload fields are invalid');
  }
  for (const collection of ARCHIVE_RESTORE_ORDER) {
    const allowedFields = RESTORE_ROW_FIELDS[collection];
    for (const row of payload[collection]) {
      if (!row || typeof row !== 'object' || Array.isArray(row)
        || Object.keys(row).some((field) => !allowedFields.has(field))) {
        throw new Error(`snapshot archive row fields are invalid: ${collection}`);
      }
    }
  }
}

function validateReference(payload, childCollection, field, parentIds) {
  let checked = 0;
  for (const row of payload[childCollection]) {
    assertCanonicalUuid(row?.[field], `${childCollection}.${field}`);
    if (!parentIds.has(row[field])) {
      throw new Error(`snapshot archive broken reference: ${childCollection}.${field}`);
    }
    checked += 1;
  }
  return checked;
}

function validateUniqueKey(payload, collection, fields) {
  const keys = new Set();
  for (const row of payload[collection]) {
    const values = fields.map((field) => row?.[field]);
    if (values.some((value) => value === null || value === undefined || value === '')) {
      throw new Error(`snapshot archive unique key is missing: ${collection}.${fields.join('+')}`);
    }
    const key = JSON.stringify(values);
    if (keys.has(key)) {
      throw new Error(`snapshot archive duplicate key: ${collection}.${fields.join('+')}`);
    }
    keys.add(key);
  }
}

function databaseTrimmedCharacterLength(value) {
  if (typeof value !== 'string') return null;
  return Array.from(value.replace(/^ +| +$/gu, '')).length;
}

function isPostgresInteger(value) {
  return Number.isInteger(value)
    && value >= POSTGRES_INTEGER_MIN
    && value <= POSTGRES_INTEGER_MAX;
}

function assertCanonicalUuid(value, label) {
  if (typeof value !== 'string' || !CANONICAL_UUID_PATTERN.test(value)) {
    throw new Error(`snapshot archive UUID is invalid: ${label}`);
  }
}

function validateSubmissionRows(payload) {
  for (const submission of payload.submission) {
    if (!VALID_SUBMISSION_STATUSES.has(submission.status)) {
      throw new Error('snapshot archive submission status is invalid');
    }
  }
  for (const item of payload.submission_item) {
    if (!isPostgresInteger(item.ordinal)) {
      throw new Error('snapshot archive submission item ordinal is invalid');
    }
    if (!VALID_SUBMISSION_ITEM_KINDS.has(item.kind)) {
      throw new Error('snapshot archive submission item kind is invalid');
    }
    const contentLength = databaseTrimmedCharacterLength(item.content);
    if (contentLength === null || contentLength < 1 || contentLength > 2_000) {
      throw new Error('snapshot archive submission item content is invalid');
    }
    if (item.rationale !== null && item.rationale !== undefined
      && (typeof item.rationale !== 'string' || Array.from(item.rationale).length > 2_000)) {
      throw new Error('snapshot archive submission item rationale is invalid');
    }
  }
}

function isNullableEnumValue(value, allowedValues) {
  return value === null || value === undefined || allowedValues.has(value);
}

function validateAnalysisRows(payload) {
  for (const issue of payload.issue) {
    const labelLength = databaseTrimmedCharacterLength(issue.label);
    if (labelLength === null || labelLength < 1 || labelLength > 200) {
      throw new Error('snapshot archive issue label is invalid');
    }
    if (!isNullableEnumValue(issue.stance, VALID_ISSUE_STANCES)) {
      throw new Error('snapshot archive issue stance is invalid');
    }
    if (!isNullableEnumValue(issue.frequency_class, VALID_ISSUE_FREQUENCY_CLASSES)) {
      throw new Error('snapshot archive issue frequency class is invalid');
    }
    if (!VALID_ISSUE_ORIGINS.has(issue.origin)) {
      throw new Error('snapshot archive issue origin is invalid');
    }
    if (!VALID_ISSUE_REVIEW_STATUSES.has(issue.review_status)) {
      throw new Error('snapshot archive issue review status is invalid');
    }
  }
  for (const link of payload.issue_link) {
    if (link.cluster_id !== null && link.cluster_id !== undefined) {
      assertCanonicalUuid(link.cluster_id, 'issue_link.cluster_id');
    }
    if (!VALID_ISSUE_LINK_AUTHORS.has(link.linked_by)) {
      throw new Error('snapshot archive issue link author is invalid');
    }
  }
  for (const resultPage of payload.result_page) {
    const titleLength = databaseTrimmedCharacterLength(resultPage.title);
    if (titleLength === null || titleLength < 1 || titleLength > 300) {
      throw new Error('snapshot archive result page title is invalid');
    }
  }
}

function validateBallotRows(payload) {
  for (const ballot of payload.ballot) {
    const titleLength = databaseTrimmedCharacterLength(ballot.title);
    if (titleLength === null || titleLength < 1 || titleLength > 200) {
      throw new Error('snapshot archive ballot title is invalid');
    }
    if (!VALID_BALLOT_STATUSES.has(ballot.status)) {
      throw new Error('snapshot archive ballot status is invalid');
    }
  }
  for (const item of payload.ballot_item) {
    if (!isPostgresInteger(item.ordinal)) {
      throw new Error('snapshot archive ballot item ordinal is invalid');
    }
    const statementLength = databaseTrimmedCharacterLength(item.statement);
    if (statementLength === null || statementLength < 1 || statementLength > 300) {
      throw new Error('snapshot archive ballot item statement is invalid');
    }
  }
}

function validateBallotAnswers(payload) {
  const itemsByBallot = new Map();
  const itemsById = new Map();
  for (const item of payload.ballot_item) {
    if (typeof item.required !== 'boolean') {
      throw new Error('snapshot archive ballot item required flag is invalid');
    }
    if (!VALID_BALLOT_SCALES.has(item.scale)) {
      throw new Error('snapshot archive ballot item scale is invalid');
    }
    itemsById.set(item.id, item);
    const items = itemsByBallot.get(item.ballot_id) ?? [];
    items.push(item);
    itemsByBallot.set(item.ballot_id, items);
  }
  let checked = 0;
  for (const response of payload.ballot_response) {
    const clientIdLength = typeof response.client_id === 'string'
      ? Array.from(response.client_id).length
      : 0;
    if (clientIdLength < 8 || clientIdLength > 80) {
      throw new Error('snapshot archive ballot response client id is invalid');
    }
    const answers = response.answers;
    if (!answers || typeof answers !== 'object' || Array.isArray(answers)) {
      throw new Error('snapshot archive ballot answers are invalid');
    }
    for (const itemId of Object.keys(answers)) {
      const item = itemsById.get(itemId);
      if (!item) {
        throw new Error('snapshot archive ballot answer references unknown item');
      }
      if (item.ballot_id !== response.ballot_id) {
        throw new Error('snapshot archive ballot answer belongs to another ballot');
      }
    }
    for (const item of itemsByBallot.get(response.ballot_id) ?? []) {
      const hasAnswer = Object.hasOwn(answers, item.id);
      if (item.required === true && !hasAnswer) {
        throw new Error('snapshot archive required ballot answer is missing');
      }
      if (!hasAnswer) continue;
      const value = answers[item.id];
      if (!Number.isInteger(value) || value < 1 || value > item.scale) {
        throw new Error('snapshot archive ballot answer is out of scale');
      }
      checked += 1;
    }
  }
  return checked;
}

function validateInternalTenantRelationships(payload) {
  const submissionsById = new Map(payload.submission.map((row) => [row.id, row]));
  const itemsById = new Map(payload.submission_item.map((row) => [row.id, row]));
  const issuesById = new Map(payload.issue.map((row) => [row.id, row]));
  const ballotsById = new Map(payload.ballot.map((row) => [row.id, row]));
  let checked = 0;
  for (const link of payload.issue_link) {
    const issue = issuesById.get(link.issue_id);
    const item = itemsById.get(link.item_id);
    const submission = submissionsById.get(item.submission_id);
    if (issue.topic_id !== submission.topic_id) {
      throw new Error('snapshot archive issue link crosses discussion topics');
    }
    if (issue.org_id !== submission.org_id) {
      throw new Error('snapshot archive issue link crosses organizations');
    }
    checked += 1;
  }
  for (const response of payload.ballot_response) {
    if (response.org_id === null || response.org_id === undefined) continue;
    assertCanonicalUuid(response.org_id, 'ballot_response.org_id');
    const ballot = ballotsById.get(response.ballot_id);
    if (response.org_id !== ballot.org_id) {
      throw new Error('snapshot archive ballot response crosses organizations');
    }
    checked += 1;
  }
  return checked;
}

function externalDependencyIds(rows, field, label) {
  const ids = new Set();
  for (const row of rows) {
    const id = row?.[field];
    if (typeof id !== 'string' || id.length === 0) {
      throw new Error(`snapshot archive external reference is missing: ${label}.${field}`);
    }
    assertCanonicalUuid(id, `${label}.${field}`);
    ids.add(id);
  }
  return ids;
}

function externalDependencyCount(rows, field, label) {
  return externalDependencyIds(rows, field, label).size;
}

function optionalExternalDependencyIds(rows, field, label) {
  const ids = new Set();
  for (const row of rows) {
    const id = row?.[field];
    if (id === null || id === undefined) continue;
    assertCanonicalUuid(id, `${label}.${field}`);
    ids.add(id);
  }
  return ids;
}

function resultScopeDependencies(rows) {
  const ids = {
    topic: new Set(),
    session: new Set(),
    assembly: new Set(),
  };
  for (const row of rows) {
    if (!Object.hasOwn(ids, row?.scope)) {
      throw new Error('snapshot archive result page scope is invalid');
    }
    if (typeof row.scope_id !== 'string' || row.scope_id.length === 0) {
      throw new Error('snapshot archive external reference is missing: result_page.scope_id');
    }
    assertCanonicalUuid(row.scope_id, 'result_page.scope_id');
    ids[row.scope].add(row.scope_id);
  }
  return ids;
}

function unionSize(...sets) {
  return new Set(sets.flatMap((set) => [...set])).size;
}

/** Runs a read-only restore preflight without connecting to a database. */
export function rehearseSnapshotArchiveFile({ filePath, auditKey }) {
  const { archive, payload, counts } = readVerifiedSnapshotArchive({ filePath, auditKey });
  validateRestoreRowFields(payload);
  const ids = Object.fromEntries(ID_COLLECTIONS.map((collection) => [collection, collectionIds(payload, collection)]));
  validateSubmissionRows(payload);
  validateAnalysisRows(payload);
  validateBallotRows(payload);
  for (const [collection, fields] of UNIQUE_KEYS) validateUniqueKey(payload, collection, fields);
  const checkedInternalReferences = [
    validateReference(payload, 'submission_item', 'submission_id', ids.submission),
    validateReference(payload, 'issue_link', 'issue_id', ids.issue),
    validateReference(payload, 'issue_link', 'item_id', ids.submission_item),
    validateReference(payload, 'ballot_item', 'ballot_id', ids.ballot),
    validateReference(payload, 'ballot_response', 'ballot_id', ids.ballot),
  ].reduce((total, value) => total + value, 0);
  const checkedTenantRelationships = validateInternalTenantRelationships(payload);
  const topicRows = [...payload.submission, ...payload.issue];
  const resultScopes = resultScopeDependencies(payload.result_page);
  const topicIds = externalDependencyIds(topicRows, 'topic_id', 'submission_or_issue');
  const sessionIds = externalDependencyIds(payload.ballot, 'session_id', 'ballot');
  const orgRows = [...payload.submission, ...payload.issue, ...payload.result_page, ...payload.ballot];
  const requiredOrgIds = externalDependencyIds(orgRows, 'org_id', 'platform_row');
  const responseOrgIds = optionalExternalDependencyIds(payload.ballot_response, 'org_id', 'ballot_response');
  return {
    status: 'preflight_passed',
    snapshotId: archive.platform.id,
    keyId: archive.audit.keyId,
    databaseRestoreExecuted: false,
    archiveRestoreOrder: [...ARCHIVE_RESTORE_ORDER],
    checkedInternalReferences,
    checkedTenantRelationships,
    checkedBallotAnswers: validateBallotAnswers(payload),
    externalDependencies: {
      org: unionSize(requiredOrgIds, responseOrgIds),
      discussion_topic: unionSize(topicIds, resultScopes.topic),
      team: externalDependencyCount(payload.submission, 'team_id', 'submission'),
      session: unionSize(sessionIds, resultScopes.session),
      assembly: resultScopes.assembly.size,
    },
    counts,
  };
}

function sqlJson(value) {
  return `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;
}

function dependencyFixtureRows(payload) {
  const orgIds = [...new Set([
    ...payload.submission.map((row) => row.org_id),
    ...payload.issue.map((row) => row.org_id),
    ...payload.result_page.map((row) => row.org_id),
    ...payload.ballot.map((row) => row.org_id),
    ...payload.ballot_response.map((row) => row.org_id).filter(Boolean),
  ])];
  const topicIds = [...new Set([
    ...payload.submission.map((row) => row.topic_id),
    ...payload.issue.map((row) => row.topic_id),
    ...payload.result_page.filter((row) => row.scope === 'topic').map((row) => row.scope_id),
  ])];
  const teamIds = [...new Set(payload.submission.map((row) => row.team_id))];
  if (teamIds.length > 100_000) {
    throw new Error('snapshot restore rehearsal fixture team limit exceeded');
  }
  const sessionIds = [...new Set([
    ...payload.ballot.map((row) => row.session_id),
    ...payload.result_page.filter((row) => row.scope === 'session').map((row) => row.scope_id),
  ])];
  if ((topicIds.length > 0 || teamIds.length > 0) && sessionIds.length === 0) {
    sessionIds.push('ffffffff-ffff-4fff-8fff-fffffffffff1');
  }
  const assemblyIds = [...new Set(
    payload.result_page.filter((row) => row.scope === 'assembly').map((row) => row.scope_id),
  )];
  const defaultOrgId = orgIds[0] ?? null;
  const defaultSessionId = sessionIds[0] ?? null;
  const orgForTopic = (topicId) => payload.submission.find((row) => row.topic_id === topicId)?.org_id
    ?? payload.issue.find((row) => row.topic_id === topicId)?.org_id
    ?? payload.result_page.find((row) => row.scope === 'topic' && row.scope_id === topicId)?.org_id
    ?? defaultOrgId;
  const orgForTeam = (teamId) => payload.submission.find((row) => row.team_id === teamId)?.org_id
    ?? defaultOrgId;
  return {
    org: orgIds.map((id, index) => ({ id, slug: `restore-org-${index + 1}`, name: `Restore org ${index + 1}` })),
    assembly: assemblyIds.map((id, index) => ({
      id, slug: `restore-assembly-${index + 1}`, title: `Restore assembly ${index + 1}`, org_id: defaultOrgId,
    })),
    session: sessionIds.map((id, index) => ({
      id, slug: `restore-session-${index + 1}`, title: `Restore session ${index + 1}`, org_id: defaultOrgId,
    })),
    discussion_topic: topicIds.map((id, index) => ({
      id,
      session_id: defaultSessionId,
      ordinal: index + 1,
      prompt: `Restore topic ${index + 1}`,
      org_id: orgForTopic(id),
    })),
    team: teamIds.map((id, index) => ({
      id,
      session_id: defaultSessionId,
      name: `Restore team ${index + 1}`,
      join_code: String(900000 + index),
      org_id: orgForTeam(id),
    })),
  };
}

function restoreInsertSql(collection, rows) {
  return `insert into climate_vote.${collection}\nselect * from jsonb_populate_recordset(null::climate_vote.${collection}, ${sqlJson(rows)});`;
}

function restoreRowVerificationSql(collection, rows) {
  const identity = RESTORE_IDENTITY_KEYS[collection]
    .map((field) => `actual.${field} = expected.${field}`)
    .join(' and ');
  return `
  if exists (
    select 1
    from jsonb_populate_recordset(
      null::climate_vote.${collection},
      ${sqlJson(rows)}
    ) expected
    left join climate_vote.${collection} actual on ${identity}
    where actual is distinct from expected
  ) then
    raise exception 'snapshot restore row mismatch: ${collection}';
  end if;`;
}

/** Builds SQL that performs and rolls back a restore in the isolated verify database. */
export function buildSnapshotRestoreRehearsalSql({ filePath, auditKey, databaseName }) {
  if (databaseName !== 'verify') {
    throw new Error('snapshot restore rehearsal requires the verify database');
  }
  const preflight = rehearseSnapshotArchiveFile({ filePath, auditKey });
  if (!Number.isSafeInteger(preflight.snapshotId) || preflight.snapshotId <= 0) {
    throw new Error('snapshot restore rehearsal snapshot id is invalid');
  }
  const { payload } = readVerifiedSnapshotArchive({ filePath, auditKey });
  const fixtures = dependencyFixtureRows(payload);
  const targetTableList = ARCHIVE_RESTORE_ORDER.map((name) => `climate_vote.${name}`).join(', ');
  const targetPresenceQuery = ARCHIVE_RESTORE_ORDER
    .map((name) => `select 1 from climate_vote.${name}`)
    .join(' union all ');
  const expectedCounts = Object.fromEntries(ARCHIVE_RESTORE_ORDER.map((name) => [name, payload[name].length]));
  const countChecks = ARCHIVE_RESTORE_ORDER.map((name) => `
    if (select count(*) from climate_vote.${name}) <> ${expectedCounts[name]} then
      raise exception 'snapshot restore count mismatch: ${name}';
    end if;`).join('');
  const rowChecks = ARCHIVE_RESTORE_ORDER
    .map((name) => restoreRowVerificationSql(name, payload[name]))
    .join('');
  const actualCountPairs = ARCHIVE_RESTORE_ORDER
    .map((name) => `'${name}', (select count(*) from climate_vote.${name})`)
    .join(',\n    ');
  const sql = `\\set ON_ERROR_STOP on
begin;
set local standard_conforming_strings = on;
do $restore_guard$
begin
  if current_database() <> 'verify' then
    raise exception 'snapshot restore rehearsal requires the verify database';
  end if;
  if exists (${targetPresenceQuery}) then
    raise exception 'snapshot restore rehearsal requires empty target tables';
  end if;
  if not exists (
    select 1
    from pg_catalog.pg_trigger
    where tgrelid = 'climate_vote.submission_item'::regclass
      and tgname = 'submission_item_lock_guard'
      and not tgisinternal
      and tgenabled = 'O'
  ) then
    raise exception 'snapshot restore rehearsal requires the enabled submission item lock guard';
  end if;
end
$restore_guard$;

insert into climate_vote.org (id, slug, name)
select id, slug, name
from jsonb_to_recordset(${sqlJson(fixtures.org)}) as x(id uuid, slug text, name text);
insert into climate_vote.assembly (id, slug, title, org_id)
select id, slug, title, org_id
from jsonb_to_recordset(${sqlJson(fixtures.assembly)}) as x(id uuid, slug text, title text, org_id uuid);
insert into climate_vote.session (id, slug, title, org_id)
select id, slug, title, org_id
from jsonb_to_recordset(${sqlJson(fixtures.session)}) as x(id uuid, slug text, title text, org_id uuid);
insert into climate_vote.discussion_topic (id, session_id, ordinal, prompt, org_id)
select id, session_id, ordinal, prompt, org_id
from jsonb_to_recordset(${sqlJson(fixtures.discussion_topic)})
  as x(id uuid, session_id uuid, ordinal integer, prompt text, org_id uuid);
insert into climate_vote.team (id, session_id, name, join_code, org_id)
select id, session_id, name, join_code, org_id
from jsonb_to_recordset(${sqlJson(fixtures.team)})
  as x(id uuid, session_id uuid, name text, join_code text, org_id uuid);

${restoreInsertSql('submission', payload.submission)}
alter table climate_vote.submission_item disable trigger submission_item_lock_guard;
${restoreInsertSql('submission_item', payload.submission_item)}
alter table climate_vote.submission_item enable trigger submission_item_lock_guard;
do $restore_trigger$
begin
  if not exists (
    select 1
    from pg_catalog.pg_trigger
    where tgrelid = 'climate_vote.submission_item'::regclass
      and tgname = 'submission_item_lock_guard'
      and not tgisinternal
      and tgenabled = 'O'
  ) then
    raise exception 'snapshot restore rehearsal did not restore the submission item lock guard';
  end if;
end
$restore_trigger$;
${ARCHIVE_RESTORE_ORDER.slice(2).map((name) => restoreInsertSql(name, payload[name])).join('\n')}

do $restore_counts$
begin${countChecks}${rowChecks}
end
$restore_counts$;

select jsonb_build_object(
  'status', 'restore_rehearsal_passed',
  'snapshotId', ${Number(preflight.snapshotId)},
  'databaseName', current_database(),
  'databaseRestoreExecuted', true,
  'transactionRolledBack', true,
  'businessTriggerRestored', true,
  'archiveRowsVerified', true,
  'counts', jsonb_build_object(
    ${actualCountPairs}
  )
)::text;
rollback;

do $restore_rollback$
begin
  if exists (${targetPresenceQuery}) then
    raise exception 'snapshot restore rehearsal rollback failed';
  end if;
end
$restore_rollback$;
`;
  return {
    sql,
    report: {
      status: 'restore_rehearsal_prepared',
      snapshotId: preflight.snapshotId,
      keyId: preflight.keyId,
      databaseName,
      databaseRestoreExecuted: false,
      transactionRollbackRequired: true,
      targetTables: targetTableList.split(', '),
      counts: expectedCounts,
    },
  };
}

async function readSnapshotRow({
  client,
  roundId,
  snapshotId,
  maxRetries,
  baseDelayMs,
  alert,
  cumulativeFailures,
}) {
  let lastError;
  if (!Number.isSafeInteger(snapshotId) || snapshotId <= 0) {
    lastError = new Error('platform snapshot receipt did not include a valid id');
  } else {
    for (let i = 0; i < maxRetries; i++) {
      try {
        const { data, error } = await client
          .schema('climate_vote')
          .from('snapshots')
          .select('*')
          .eq('id', snapshotId)
          .single();
        if (!error && data) return data;
        lastError = error ?? new Error('snapshot row was empty');
      } catch (error) {
        lastError = error;
      }
      if (i < maxRetries - 1) await sleep(baseDelayMs * 2 ** i);
    }
  }
  const level = cumulativeFailures >= 3 ? 'critical' : 'warning';
  const message = lastError instanceof Error ? lastError.message : lastError?.message;
  alert({ level, message: `platform snapshot export failed: ${message}`, roundId });
  throw new Error(`platform snapshot export persistent failure: ${message}`);
}

async function runSnapshotRpc({
  client,
  roundId,
  rpcName,
  rpcArgs,
  snapshotKind,
  maxRetries,
  baseDelayMs,
  alert,
  cumulativeFailures,
}) {
  let lastError;
  for (let i = 0; i < maxRetries; i++) {
    const { data, error } = await client.schema('climate_vote').rpc(rpcName, rpcArgs);
    if (!error) return data;
    lastError = error;
    if (i < maxRetries - 1) await sleep(baseDelayMs * 2 ** i);
  }
  const level = cumulativeFailures >= 3 ? 'critical' : 'warning';
  alert({ level, message: `${snapshotKind} snapshot failed: ${lastError?.message}`, roundId });
  throw new Error(`${snapshotKind} snapshot persistent failure: ${lastError?.message}`);
}

// CLI mode
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const command = process.argv[2];
  if (command === '--verify' || command === '--rehearse') {
    const filePath = process.argv[3];
    if (!filePath) throw new Error('snapshot archive path is required');
    const inspectArchive = command === '--rehearse'
      ? rehearseSnapshotArchiveFile
      : verifySnapshotArchiveFile;
    const result = inspectArchive({
      filePath,
      auditKey: process.env.SNAPSHOT_AUDIT_HMAC_KEY,
    });
    console.log(JSON.stringify(result));
    process.exit(0);
  }
  if (command === '--prepare-restore-rehearsal') {
    const filePath = process.argv[3];
    const outputPath = process.argv[4];
    if (!filePath) throw new Error('snapshot archive path is required');
    if (!outputPath) throw new Error('snapshot restore rehearsal SQL path is required');
    const result = buildSnapshotRestoreRehearsalSql({
      filePath,
      auditKey: process.env.SNAPSHOT_AUDIT_HMAC_KEY,
      databaseName: process.env.SNAPSHOT_RESTORE_DATABASE,
    });
    writeFileSync(outputPath, result.sql, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    console.log(JSON.stringify({ ...result.report, outputPath }));
    process.exit(0);
  }
  const { createClient } = await import('@supabase/supabase-js');
  const { loadSchedule, findActiveWorkshop } = await import('./lib/schedule.mjs');
  const { mkdirSync } = await import('node:fs');
  const schedule = await loadSchedule();
  const ws = findActiveWorkshop(schedule);
  if (!ws) {
    console.log(JSON.stringify({ skipped: 'not in workshop window' }));
    process.exit(0);
  }
  const client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE);
  const roundId = ws.supabase_round_id;
  const snapshotLabel = `${ws.name ?? ws.date}-r${roundId}`;
  const includePlatformSnapshot = process.env.PLATFORM_SNAPSHOT_ENABLED === 'true';
  const data = await snapshotArchive({
    client,
    roundId,
    label: snapshotLabel,
    includePlatformSnapshot,
    auditContext: workflowAuditContext(process.env),
    auditKey: process.env.SNAPSHOT_AUDIT_HMAC_KEY,
  });
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
  const outDir = `/tmp/${ws.name}/snapshots`;
  mkdirSync(outDir, { recursive: true });
  const outPath = `${outDir}/${ts}.json`;
  writeFileSync(outPath, JSON.stringify(data, null, 2));
  console.log(JSON.stringify({ workshop: ws.name, ts, outPath, includePlatformSnapshot }));
}
