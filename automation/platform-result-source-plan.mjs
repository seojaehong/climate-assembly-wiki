import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const RESULT_SCOPES = new Set(['topic', 'session', 'assembly']);
const SOURCE_KINDS = new Set(['core', 'extra']);
const SOURCE_LINK_ACTORS = new Set(['ai', 'human']);
const AUTH_REVIEWER_PATTERN = /^auth-user:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PUBLICATION_STATUSES = new Set(['reviewed', 'withheld']);
const REPO_ROOT = realpathSync(fileURLToPath(new URL('..', import.meta.url)));
const sourceReferenceContract = JSON.parse(readFileSync(
  new URL('../src/islands/result/source-reference-contract.json', import.meta.url),
  'utf8',
));
validateSourceReferenceContract(sourceReferenceContract);
const publicRecordContract = requireObject(sourceReferenceContract.record, 'source reference contract');
const SOURCE_REVIEWER_ROLES = new Set(requireArray(publicRecordContract.reviewerRoles, 'source reviewer roles'));
const REFERENCE_KEY_PATTERN = new RegExp(requireText(publicRecordContract.referenceKeyPattern, 'reference key pattern'));
const SOURCE_TIMESTAMP_PATTERN = new RegExp(requireText(publicRecordContract.timestampPattern, 'timestamp pattern'));
const MAX_TEAM_NAME_LENGTH = requireInteger(publicRecordContract.teamNameMaxLength, 'team name max length');
const MAX_EXCERPT_LENGTH = requireInteger(publicRecordContract.excerptMaxLength, 'excerpt max length');
const MAX_SOURCE_ORDINAL = requireInteger(publicRecordContract.maximumOrdinal, 'maximum source ordinal');
const PUBLIC_RECORD_KEYS = requireArray(publicRecordContract.requiredKeys, 'public source reference keys');
const SOURCE_REFERENCE_CONTRACT_IDENTITY = Object.freeze({
  schemaVersion: sourceReferenceContract.schemaVersion,
  canonicalSha256: sha256(canonicalJson(sourceReferenceContract)),
});

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

function requireObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Invalid ${label}`);
  return value;
}

function requireArray(value, label) {
  if (!Array.isArray(value)) throw new Error(`Invalid ${label}`);
  return value;
}

function requireUuid(value, label) {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) throw new Error(`Invalid ${label}`);
  return value;
}

function requireText(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`Invalid ${label}`);
  return value.trim();
}

function requireInteger(value, label) {
  if (!Number.isInteger(value) || value < 0) throw new Error(`Invalid ${label}`);
  return value;
}

function requirePositiveInteger(value, label) {
  if (!Number.isInteger(value) || value < 1) throw new Error(`Invalid ${label}`);
  return value;
}

function requireExactKeys(value, expected, label) {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (canonicalJson(actual) !== canonicalJson(wanted)) throw new Error(`Unexpected ${label} field`);
}

export function validateSourceReferenceContract(contract) {
  const candidate = requireObject(contract, 'source reference contract');
  requireExactKeys(candidate, ['schemaVersion', 'record'], 'source reference contract');
  if (candidate.schemaVersion !== 1) throw new Error('Unsupported source reference contract schema version');
  const record = requireObject(candidate.record, 'source reference contract record');
  const recordKeys = [
    'requiredKeys',
    'referenceKeyPattern',
    'teamNameMaxLength',
    'excerptMaxLength',
    'contentSha256Pattern',
    'timestampMaxLength',
    'timestampPattern',
    'maximumOrdinal',
    'kinds',
    'publicationStatus',
    'reviewerRoles',
  ];
  requireExactKeys(record, recordKeys, 'source reference contract record');
  const requiredKeys = requireArray(record.requiredKeys, 'public source reference keys');
  const expectedPublicKeys = [
    'reference_key',
    'team_name',
    'ordinal',
    'kind',
    'excerpt',
    'content_sha256',
    'publication_status',
    'reviewed_at',
    'reviewer_role',
  ];
  if (canonicalJson(requiredKeys) !== canonicalJson(expectedPublicKeys)
    || canonicalJson(record.kinds) !== canonicalJson(['core', 'extra'])
    || record.publicationStatus !== 'reviewed'
    || canonicalJson(record.reviewerRoles) !== canonicalJson(['org_admin', 'hq'])) {
    throw new Error('Source reference contract vocabulary is invalid');
  }
  for (const [value, label] of [
    [record.teamNameMaxLength, 'team name max length'],
    [record.excerptMaxLength, 'excerpt max length'],
    [record.timestampMaxLength, 'timestamp max length'],
    [record.maximumOrdinal, 'maximum source ordinal'],
  ]) requirePositiveInteger(value, label);
  for (const [value, label] of [
    [record.referenceKeyPattern, 'reference key pattern'],
    [record.contentSha256Pattern, 'content digest pattern'],
    [record.timestampPattern, 'timestamp pattern'],
  ]) requireText(value, label);
}

function requireCanonicalTimestamp(value, label) {
  const timestamp = requireText(value, label);
  if (!SOURCE_TIMESTAMP_PATTERN.test(timestamp)) throw new Error(`Invalid ${label}`);
  const milliseconds = Date.parse(timestamp);
  const normalized = timestamp.includes('.') ? timestamp : timestamp.replace(/Z$/, '.000Z');
  if (Number.isNaN(milliseconds) || new Date(milliseconds).toISOString() !== normalized) throw new Error(`Invalid ${label}`);
  return { text: timestamp, milliseconds };
}

function requireCanonicalSourceContent(value) {
  if (typeof value !== 'string' || value.length === 0 || value !== value.trim()) {
    throw new Error('Invalid canonical source content');
  }
  if (value.length > MAX_EXCERPT_LENGTH) throw new Error('Invalid canonical source content');
  return value;
}

function requireReviewer(value) {
  if (typeof value !== 'string' || !AUTH_REVIEWER_PATTERN.test(value)) throw new Error('Invalid reviewer');
  return value.toLowerCase();
}

function decisionKey(issueId, itemId) {
  return `${issueId}:${itemId}`;
}

function normalizedTeams(value) {
  const teams = requireArray(value, 'result issue teams').map((team) => requireText(team, 'result issue team'));
  if (new Set(teams).size !== teams.length) throw new Error('Duplicate result issue team');
  return [...teams].sort((a, b) => a.localeCompare(b, 'ko'));
}

function parseResult(result) {
  const root = requireObject(result, 'result snapshot');
  const body = requireObject(root.body, 'result body');
  const rawIssues = requireArray(body.issues, 'result issues');
  if (rawIssues.length === 0) throw new Error('Result snapshot has no issues');
  const issueIds = new Set();
  const issues = rawIssues.map((rawIssue) => {
    const issue = requireObject(rawIssue, 'result issue');
    const id = requireUuid(issue.id, 'result issue id');
    if (issueIds.has(id)) throw new Error('Duplicate result issue id');
    issueIds.add(id);
    return {
      id,
      topicId: requireUuid(issue.topic_id, 'result issue topic id'),
      label: requireText(issue.label, 'result issue label'),
      reviewStatus: issue.review_status ?? null,
      teams: normalizedTeams(issue.teams),
      consensusDenominator: requireInteger(issue.consensus_denominator, 'result issue denominator'),
    };
  });
  return {
    scope: (() => {
      const scope = requireText(root.scope ?? body.scope, 'result scope');
      if (!RESULT_SCOPES.has(scope)) throw new Error('Invalid result scope');
      return scope;
    })(),
    scopeId: requireUuid(root.scope_id ?? body.scope_id, 'result scope id'),
    publishedAt: requireText(root.published_at, 'result published timestamp'),
    unclassifiedCount: requireInteger(body.unclassified_count, 'result unclassified count'),
    issues,
  };
}

function parseSourceSnapshot(sourceSnapshot) {
  const root = requireObject(sourceSnapshot, 'source snapshot');
  const topics = requireArray(root.topics, 'source topics');
  if (topics.length === 0) throw new Error('Source snapshot has no topics');
  const topicIds = new Set();
  const itemIds = new Set();
  return topics.map((rawTopic) => {
    const topic = requireObject(rawTopic, 'source topic');
    const topicId = requireUuid(topic.topic_id, 'source topic id');
    if (topicIds.has(topicId)) throw new Error('Duplicate source topic id');
    topicIds.add(topicId);
    const items = requireArray(topic.items, 'source items').map((rawItem) => {
      const item = requireObject(rawItem, 'source item');
      const itemId = requireUuid(item.id, 'source item id');
      if (itemIds.has(itemId)) throw new Error('Duplicate source item id');
      itemIds.add(itemId);
      const links = requireArray(item.links, 'source item links').map((rawLink) => {
        const link = requireObject(rawLink, 'source item link');
        return {
          issueId: requireUuid(link.issue_id, 'source link issue id'),
          clusterId: link.cluster_id == null ? null : requireUuid(link.cluster_id, 'source link cluster id'),
          linkedBy: (() => {
            const linkedBy = requireText(link.linked_by, 'source link actor');
            if (!SOURCE_LINK_ACTORS.has(linkedBy)) throw new Error('Invalid source link actor');
            return linkedBy;
          })(),
        };
      });
      const linkKeys = links.map((link) => link.issueId);
      if (new Set(linkKeys).size !== linkKeys.length) throw new Error('Duplicate source item link');
      const kind = requireText(item.kind, 'source item kind');
      if (!SOURCE_KINDS.has(kind)) throw new Error('Invalid source item kind');
      return {
        itemId,
        submissionId: requireUuid(item.submission_id, 'source submission id'),
        ordinal: (() => {
          const ordinal = requirePositiveInteger(item.ordinal, 'source item ordinal');
          if (ordinal > MAX_SOURCE_ORDINAL) throw new Error('Invalid source item ordinal');
          return ordinal;
        })(),
        teamName: (() => {
          const teamName = requireText(item.team_name, 'source team name');
          if (teamName.length > MAX_TEAM_NAME_LENGTH) throw new Error('Invalid source team name');
          return teamName;
        })(),
        kind,
        content: requireCanonicalSourceContent(item.content),
        contentSha256: sha256(requireCanonicalSourceContent(item.content)),
        links,
      };
    });
    return { topicId, items };
  });
}

function parsedInputs(result, sourceSnapshot) {
  const parsedResult = parseResult(result);
  const topics = parseSourceSnapshot(sourceSnapshot);
  const resultTopicIds = new Set(parsedResult.issues.map((issue) => issue.topicId));
  const sourceTopicIds = new Set(topics.map((topic) => topic.topicId));
  if (resultTopicIds.size !== sourceTopicIds.size
    || [...resultTopicIds].some((topicId) => !sourceTopicIds.has(topicId))) {
    throw new Error('Result and source topic sets do not match');
  }

  const resultIssueIds = new Set(parsedResult.issues.map((issue) => issue.id));
  const resultIssueTopics = new Map(parsedResult.issues.map((issue) => [issue.id, issue.topicId]));
  const referencesByIssue = new Map(parsedResult.issues.map((issue) => [issue.id, []]));
  let unclassifiedCount = 0;
  for (const topic of topics) {
    for (const item of topic.items) {
      if (item.links.length === 0) unclassifiedCount += 1;
      for (const link of item.links) {
        if (!resultIssueIds.has(link.issueId)) continue;
        if (resultIssueTopics.get(link.issueId) !== topic.topicId) {
          throw new Error('Source link topic does not match result issue');
        }
        referencesByIssue.get(link.issueId)?.push({ item, link });
      }
    }
  }
  if (unclassifiedCount !== parsedResult.unclassifiedCount) {
    throw new Error('Result unclassified count does not match source snapshot');
  }
  return { parsedResult, referencesByIssue, unclassifiedCount };
}

function sourceReference(item, link) {
  return {
    itemId: item.itemId,
    submissionId: item.submissionId,
    ordinal: item.ordinal,
    teamName: item.teamName,
    kind: item.kind,
    clusterId: link.clusterId,
    linkedBy: link.linkedBy,
    contentSha256: item.contentSha256,
  };
}

function unsignedPlan(result, sourceSnapshot) {
  const { parsedResult, referencesByIssue, unclassifiedCount } = parsedInputs(result, sourceSnapshot);

  const issues = parsedResult.issues.map((issue) => {
    const references = (referencesByIssue.get(issue.id) ?? [])
      .map(({ item, link }) => sourceReference(item, link));
    const teams = [...new Set(references.map((reference) => reference.teamName))]
      .sort((a, b) => a.localeCompare(b, 'ko'));
    const denominator = new Set(references.map((reference) => reference.clusterId ?? reference.itemId)).size;
    if (canonicalJson(teams) !== canonicalJson(issue.teams)) {
      throw new Error('Result issue teams do not match source snapshot');
    }
    if (denominator !== issue.consensusDenominator) {
      throw new Error('Result issue denominator does not match source snapshot');
    }
    return {
      issueId: issue.id,
      topicId: issue.topicId,
      label: issue.label,
      sourceReferenceCount: references.length,
      sourceReferences: references.sort((a, b) => a.itemId.localeCompare(b.itemId)),
    };
  });

  return {
    schemaVersion: 2,
    sourceReferenceContract: SOURCE_REFERENCE_CONTRACT_IDENTITY,
    scope: parsedResult.scope,
    scopeId: parsedResult.scopeId,
    publishedAt: parsedResult.publishedAt,
    dryRun: true,
    databaseMutationExecuted: false,
    publicPayloadWritten: false,
    requiresApproval: true,
    inputSha256: {
      result: sha256(canonicalJson(result)),
      sourceSnapshot: sha256(canonicalJson(sourceSnapshot)),
    },
    summary: {
      issueCount: issues.length,
      sourceReferenceCount: issues.reduce((sum, issue) => sum + issue.sourceReferenceCount, 0),
      unclassifiedCount,
    },
    issues,
  };
}

export function buildPlatformResultSourcePlan(result, sourceSnapshot) {
  const plan = unsignedPlan(result, sourceSnapshot);
  return { ...plan, checksumSha256: sha256(canonicalJson(plan)) };
}

export function verifyPlatformResultSourcePlan(plan, result, sourceSnapshot) {
  const candidate = requireObject(plan, 'source plan');
  if (candidate.schemaVersion !== 2) throw new Error('Unsupported source plan schema version');
  if (typeof candidate.checksumSha256 !== 'string' || !SHA256_PATTERN.test(candidate.checksumSha256)) {
    throw new Error('Invalid source plan checksum');
  }
  const { checksumSha256, ...unsigned } = candidate;
  if (sha256(canonicalJson(unsigned)) !== checksumSha256) throw new Error('Source plan checksum mismatch');
  const expected = buildPlatformResultSourcePlan(result, sourceSnapshot);
  if (canonicalJson(candidate) !== canonicalJson(expected)) throw new Error('Source plan does not match inputs');
  return true;
}

function publicReferenceKey(issueId, itemId, contentSha256) {
  const key = `source-${sha256(`${issueId}:${itemId}:${contentSha256}`).slice(0, 24)}`;
  if (!REFERENCE_KEY_PATTERN.test(key)) throw new Error('Invalid generated reference key');
  return key;
}

function parsePublicationReviews(reviews, parsedResult, referencesByIssue) {
  const root = requireObject(reviews, 'source publication reviews');
  requireExactKeys(root, ['schema_version', 'mode', 'scope', 'scope_id', 'observed_at', 'decisions'], 'publication review');
  if (root.schema_version !== 1) throw new Error('Unsupported publication review schema version');
  if (root.mode !== 'replace_all') throw new Error('Invalid publication review mode');
  if (root.scope !== parsedResult.scope || root.scope_id !== parsedResult.scopeId) {
    throw new Error('Publication review scope does not match result');
  }
  const observedAt = requireCanonicalTimestamp(root.observed_at, 'publication observation timestamp');
  const publishedAt = requireCanonicalTimestamp(parsedResult.publishedAt, 'result published timestamp');
  const linked = new Map();
  for (const issue of parsedResult.issues) {
    for (const reference of referencesByIssue.get(issue.id) ?? []) {
      linked.set(decisionKey(issue.id, reference.item.itemId), { issue, ...reference });
    }
  }

  const decisions = requireArray(root.decisions, 'publication decisions').map((rawDecision) => {
    const decision = requireObject(rawDecision, 'publication decision');
    requireExactKeys(decision, [
      'issue_id', 'item_id', 'publication_status', 'excerpt',
      'reviewed_by', 'reviewer_role', 'reviewed_at',
    ], 'publication decision');
    const issueId = requireUuid(decision.issue_id, 'publication issue id');
    const itemId = requireUuid(decision.item_id, 'publication item id');
    const publicationStatus = requireText(decision.publication_status, 'publication status');
    if (!PUBLICATION_STATUSES.has(publicationStatus)) throw new Error('Invalid publication status');
    const reviewer = requireReviewer(decision.reviewed_by);
    const reviewerRole = requireText(decision.reviewer_role, 'publication reviewer role');
    if (!SOURCE_REVIEWER_ROLES.has(reviewerRole)) throw new Error('Invalid publication reviewer role');
    const reviewedAt = requireCanonicalTimestamp(decision.reviewed_at, 'publication review timestamp');
    if (reviewedAt.milliseconds < publishedAt.milliseconds) throw new Error('Publication review predates result');
    if (reviewedAt.milliseconds > observedAt.milliseconds) throw new Error('Publication review follows observation');
    const target = linked.get(decisionKey(issueId, itemId));
    if (publicationStatus === 'reviewed') {
      if (target && target.issue.reviewStatus !== 'reviewed') throw new Error('Target issue is not reviewed');
      if (target && decision.excerpt !== target.item.content) throw new Error('Reviewed excerpt must match exact source content');
      requireCanonicalSourceContent(decision.excerpt);
    } else if (decision.excerpt !== null) {
      throw new Error('Invalid withheld excerpt');
    }
    return {
      issueId,
      itemId,
      publicationStatus,
      excerpt: decision.excerpt,
      reviewer,
      reviewerRole,
      reviewedAt: reviewedAt.text,
    };
  });

  const decisionKeys = decisions.map((decision) => decisionKey(decision.issueId, decision.itemId));
  if (new Set(decisionKeys).size !== decisionKeys.length) throw new Error('Duplicate publication decision');
  const linkedKeys = [...linked.keys()].sort();
  if (canonicalJson([...decisionKeys].sort()) !== canonicalJson(linkedKeys)) {
    throw new Error('Publication decision set does not match linked source references');
  }
  return { observedAt: observedAt.text, decisions, linked };
}

function unsignedPublicationPlan(result, sourceSnapshot, reviews) {
  unsignedPlan(result, sourceSnapshot);
  const { parsedResult, referencesByIssue } = parsedInputs(result, sourceSnapshot);
  const { observedAt, decisions, linked } = parsePublicationReviews(reviews, parsedResult, referencesByIssue);
  const decisionsByIssue = new Map(parsedResult.issues.map((issue) => [issue.id, []]));
  const patches = [];
  for (const decision of decisions) {
    const target = linked.get(decisionKey(decision.issueId, decision.itemId));
    if (!target) throw new Error('Publication decision set does not match linked source references');
    patches.push({
      issueId: decision.issueId,
      itemId: decision.itemId,
      publicationStatus: decision.publicationStatus,
      contentSha256: target.item.contentSha256,
      reviewer: decision.reviewer,
      reviewerRole: decision.reviewerRole,
      reviewedAt: decision.reviewedAt,
    });
    if (decision.publicationStatus !== 'reviewed') continue;
    const publicRecord = {
      reference_key: publicReferenceKey(decision.issueId, decision.itemId, target.item.contentSha256),
      team_name: target.item.teamName,
      ordinal: target.item.ordinal,
      kind: target.item.kind,
      excerpt: decision.excerpt,
      content_sha256: target.item.contentSha256,
      publication_status: decision.publicationStatus,
      reviewed_at: decision.reviewedAt,
      reviewer_role: decision.reviewerRole,
    };
    requireExactKeys(publicRecord, PUBLIC_RECORD_KEYS, 'public source reference');
    decisionsByIssue.get(decision.issueId)?.push(publicRecord);
  }

  const sourceResult = requireObject(result, 'result snapshot');
  const atomicResultBody = structuredClone(requireObject(sourceResult.body, 'result body'));
  atomicResultBody.issues = requireArray(atomicResultBody.issues, 'result issues').map((issue) => ({
    ...issue,
    source_references: (decisionsByIssue.get(issue.id) ?? []).sort((left, right) => (
      left.team_name.localeCompare(right.team_name, 'ko')
      || left.ordinal - right.ordinal
      || left.reference_key.localeCompare(right.reference_key)
    )),
  }));
  patches.sort((left, right) => left.issueId.localeCompare(right.issueId) || left.itemId.localeCompare(right.itemId));
  const reviewedReferenceCount = decisions.filter((decision) => decision.publicationStatus === 'reviewed').length;
  const withheldReferenceCount = decisions.length - reviewedReferenceCount;
  return {
    schemaVersion: 2,
    planKind: 'source_publication',
    mode: 'replace_all',
    sourceReferenceContract: SOURCE_REFERENCE_CONTRACT_IDENTITY,
    scope: parsedResult.scope,
    scopeId: parsedResult.scopeId,
    observedAt,
    dryRun: true,
    databaseMutationExecuted: false,
    publicPayloadWritten: false,
    requiresApproval: true,
    inputSha256: {
      result: sha256(canonicalJson(result)),
      sourceSnapshot: sha256(canonicalJson(sourceSnapshot)),
      publicationReviews: sha256(canonicalJson(reviews)),
    },
    beforeBodySha256: sha256(canonicalJson(sourceResult.body)),
    afterBodySha256: sha256(canonicalJson(atomicResultBody)),
    summary: {
      issueCount: parsedResult.issues.length,
      linkedReferenceCount: decisions.length,
      reviewedReferenceCount,
      withheldReferenceCount,
    },
    patches,
    atomicResultBody,
  };
}

export function buildPlatformResultSourcePublicationPlan(result, sourceSnapshot, reviews) {
  const plan = unsignedPublicationPlan(result, sourceSnapshot, reviews);
  return { ...plan, checksumSha256: sha256(canonicalJson(plan)) };
}

export function verifyPlatformResultSourcePublicationPlan(plan, result, sourceSnapshot, reviews) {
  const candidate = requireObject(plan, 'source publication plan');
  if (candidate.schemaVersion !== 2 || candidate.planKind !== 'source_publication') {
    throw new Error('Unsupported source publication plan');
  }
  if (typeof candidate.checksumSha256 !== 'string' || !SHA256_PATTERN.test(candidate.checksumSha256)) {
    throw new Error('Invalid source publication plan checksum');
  }
  const { checksumSha256, ...unsigned } = candidate;
  if (sha256(canonicalJson(unsigned)) !== checksumSha256) throw new Error('Source publication plan checksum mismatch');
  const expected = buildPlatformResultSourcePublicationPlan(result, sourceSnapshot, reviews);
  if (canonicalJson(candidate) !== canonicalJson(expected)) throw new Error('Source publication plan does not match inputs');
  return true;
}

function parseArgs(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith('--') || !value) throw new Error('Invalid CLI arguments');
    values.set(key, value);
  }
  return values;
}

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    throw new Error(`Unable to read ${label}`);
  }
}

function isWithinRepository(path) {
  const pathRelativeToRoot = relative(REPO_ROOT, path);
  return pathRelativeToRoot === ''
    || (!pathRelativeToRoot.startsWith('..') && !isAbsolute(pathRelativeToRoot));
}

export function validatePlatformResultSourcePublicationOutputPath(path) {
  const absolutePath = resolve(path);
  let resolvedPath;
  try {
    resolvedPath = existsSync(absolutePath)
      ? realpathSync.native(absolutePath)
      : resolve(realpathSync.native(dirname(absolutePath)), absolutePath.split(/[\\/]/).at(-1));
  } catch {
    throw new Error('Source publication plan path is unavailable');
  }
  if (isWithinRepository(resolvedPath)) {
    throw new Error('Source publication plan must be stored outside the repository');
  }
  return absolutePath;
}

export function validatePlatformResultSourcePrivateInputPath(path, label) {
  const absolutePath = resolve(path);
  let resolvedPath;
  try {
    resolvedPath = realpathSync.native(absolutePath);
    if (!statSync(resolvedPath).isFile()) throw new Error('not a file');
  } catch {
    throw new Error(`Result source ${label} input is unavailable`);
  }
  if (isWithinRepository(resolvedPath)) {
    throw new Error(`Result source ${label} input must remain outside the repository`);
  }
  return resolvedPath;
}

function main(argv) {
  const args = parseArgs(argv);
  const resultPath = args.get('--result');
  const sourcePath = args.get('--issue-items');
  if (!resultPath || !sourcePath) throw new Error('Both --result and --issue-items are required');
  const reviewsPath = args.get('--reviews');
  const externalSourcePath = validatePlatformResultSourcePrivateInputPath(sourcePath, 'issue-items');
  const externalReviewsPath = reviewsPath
    ? validatePlatformResultSourcePrivateInputPath(reviewsPath, 'review decisions')
    : null;
  const result = readJson(resultPath, 'result snapshot');
  const sourceSnapshot = readJson(externalSourcePath, 'source snapshot');
  const reviews = externalReviewsPath ? readJson(externalReviewsPath, 'source publication reviews') : null;
  const verifyPath = args.get('--verify-plan');
  if (verifyPath) {
    if (reviews) {
      const externalVerifyPath = validatePlatformResultSourcePublicationOutputPath(verifyPath);
      verifyPlatformResultSourcePublicationPlan(
        readJson(externalVerifyPath, 'source publication plan'),
        result,
        sourceSnapshot,
        reviews,
      );
      process.stdout.write(`${JSON.stringify({
        verified: true,
        planKind: 'source_publication',
        databaseMutationExecuted: false,
        publicPayloadWritten: false,
      })}\n`);
      return;
    }
    verifyPlatformResultSourcePlan(readJson(verifyPath, 'source plan'), result, sourceSnapshot);
    process.stdout.write(`${JSON.stringify({ verified: true, databaseMutationExecuted: false })}\n`);
    return;
  }
  const outputPath = args.get('--output');
  if (!outputPath) throw new Error('--output is required when creating a plan');
  if (reviews) {
    const externalOutputPath = validatePlatformResultSourcePublicationOutputPath(outputPath);
    if (existsSync(externalOutputPath)) throw new Error('Output already exists');
    const plan = buildPlatformResultSourcePublicationPlan(result, sourceSnapshot, reviews);
    writeFileSync(externalOutputPath, `${JSON.stringify(plan, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    });
    process.stdout.write(`${JSON.stringify({
      created: true,
      planKind: 'source_publication',
      reviewedReferenceCount: plan.summary.reviewedReferenceCount,
      databaseMutationExecuted: false,
      publicPayloadWritten: false,
    })}\n`);
    return;
  }
  if (existsSync(outputPath)) throw new Error('Output already exists');
  const plan = buildPlatformResultSourcePlan(result, sourceSnapshot);
  writeFileSync(outputPath, `${JSON.stringify(plan, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  process.stdout.write(`${JSON.stringify({ created: true, issueCount: plan.summary.issueCount, databaseMutationExecuted: false })}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Source plan failed');
    process.exitCode = 1;
  }
}
