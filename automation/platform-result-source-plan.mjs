import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const RESULT_SCOPES = new Set(['topic', 'session', 'assembly']);
const SOURCE_KINDS = new Set(['core', 'extra']);
const SOURCE_LINK_ACTORS = new Set(['ai', 'human']);

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
        ordinal: requireInteger(item.ordinal, 'source item ordinal'),
        teamName: requireText(item.team_name, 'source team name'),
        kind,
        contentSha256: sha256(requireText(item.content, 'source item content')),
        links,
      };
    });
    return { topicId, items };
  });
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
        const target = referencesByIssue.get(link.issueId);
        if (!target) throw new Error('Source link target is unavailable');
        target.push(sourceReference(item, link));
      }
    }
  }
  if (unclassifiedCount !== parsedResult.unclassifiedCount) {
    throw new Error('Result unclassified count does not match source snapshot');
  }

  const issues = parsedResult.issues.map((issue) => {
    const references = referencesByIssue.get(issue.id) ?? [];
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
    schemaVersion: 1,
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
  if (candidate.schemaVersion !== 1) throw new Error('Unsupported source plan schema version');
  if (typeof candidate.checksumSha256 !== 'string' || !SHA256_PATTERN.test(candidate.checksumSha256)) {
    throw new Error('Invalid source plan checksum');
  }
  const { checksumSha256, ...unsigned } = candidate;
  if (sha256(canonicalJson(unsigned)) !== checksumSha256) throw new Error('Source plan checksum mismatch');
  const expected = buildPlatformResultSourcePlan(result, sourceSnapshot);
  if (canonicalJson(candidate) !== canonicalJson(expected)) throw new Error('Source plan does not match inputs');
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

function main(argv) {
  const args = parseArgs(argv);
  const resultPath = args.get('--result');
  const sourcePath = args.get('--issue-items');
  if (!resultPath || !sourcePath) throw new Error('Both --result and --issue-items are required');
  const result = readJson(resultPath, 'result snapshot');
  const sourceSnapshot = readJson(sourcePath, 'source snapshot');
  const verifyPath = args.get('--verify-plan');
  if (verifyPath) {
    verifyPlatformResultSourcePlan(readJson(verifyPath, 'source plan'), result, sourceSnapshot);
    process.stdout.write(`${JSON.stringify({ verified: true, databaseMutationExecuted: false })}\n`);
    return;
  }
  const outputPath = args.get('--output');
  if (!outputPath) throw new Error('--output is required when creating a plan');
  if (existsSync(outputPath)) throw new Error('Output already exists');
  const plan = buildPlatformResultSourcePlan(result, sourceSnapshot);
  writeFileSync(outputPath, `${JSON.stringify(plan, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  process.stdout.write(`${JSON.stringify({ created: true, issueCount: plan.summary.issueCount, databaseMutationExecuted: false })}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Source plan failed');
    process.exitCode = 1;
  }
}
