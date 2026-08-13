import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const ISO_UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const REVIEWER_PATTERN = /^[a-z][a-z0-9-]{2,39}$/;
const RESULT_SCOPES = new Set(['topic', 'session', 'assembly']);
const IMPLEMENTATION_STATES = new Set([
  'under_review',
  'planned',
  'in_progress',
  'implemented',
  'not_pursued',
]);
const EVIDENCE_REQUIRED_STATES = new Set(['implemented', 'not_pursued']);

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

function requireExactKeys(value, allowedKeys, label) {
  if (Object.keys(value).some((key) => !allowedKeys.has(key))) throw new Error(`Unexpected ${label} field`);
}

function requireText(value, label, maxLength = 1000) {
  if (typeof value !== 'string') throw new Error(`Invalid ${label}`);
  const text = value.trim();
  if (text.length === 0 || text.length > maxLength) throw new Error(`Invalid ${label}`);
  return text;
}

function requireUuid(value, label) {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) throw new Error(`Invalid ${label}`);
  return value;
}

function requireTimestamp(value, label) {
  const text = requireText(value, label, 80);
  if (!ISO_UTC_PATTERN.test(text)) throw new Error(`Invalid ${label}`);
  const timestamp = Date.parse(text);
  const normalized = text.includes('.') ? text : text.replace(/Z$/, '.000Z');
  if (Number.isNaN(timestamp) || new Date(timestamp).toISOString() !== normalized) {
    throw new Error(`Invalid ${label}`);
  }
  return { text, timestamp };
}

function requireEvidenceUrl(value, required) {
  if (value == null || value === '') {
    if (required) throw new Error('Implementation evidence is required');
    return null;
  }
  const text = requireText(value, 'implementation evidence URL', 2000);
  try {
    const url = new URL(text);
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error('unsafe');
    return url.toString();
  } catch {
    throw new Error('Invalid implementation evidence URL');
  }
}

function validatePublicImplementation(rawImplementation) {
  if (rawImplementation == null) return;
  const implementation = requireObject(rawImplementation, 'public implementation');
  requireExactKeys(implementation, new Set(['status', 'responsible_body', 'updated_at', 'summary', 'evidence_url']), 'public implementation');
  const status = requireText(implementation.status, 'implementation status', 40);
  if (!IMPLEMENTATION_STATES.has(status)) throw new Error('Invalid implementation status');
  requireText(implementation.responsible_body, 'implementation responsible body', 200);
  requireTimestamp(implementation.updated_at, 'implementation update timestamp');
  requireText(implementation.summary, 'implementation summary', 1000);
  requireEvidenceUrl(implementation.evidence_url, EVIDENCE_REQUIRED_STATES.has(status));
}

function parseResultSnapshot(input) {
  const result = requireObject(input, 'result snapshot');
  const body = requireObject(result.body, 'result body');
  const scope = requireText(result.scope ?? body.scope, 'result scope', 20);
  if (!RESULT_SCOPES.has(scope)) throw new Error('Invalid result scope');
  const scopeId = requireUuid(result.scope_id ?? body.scope_id, 'result scope id');
  if ((result.scope != null && body.scope != null && result.scope !== body.scope)
    || (result.scope_id != null && body.scope_id != null && result.scope_id !== body.scope_id)) {
    throw new Error('Result root and body scope do not match');
  }
  const publishedAt = requireTimestamp(result.published_at, 'result published timestamp');
  const rawIssues = requireArray(body.issues, 'result issues');
  if (rawIssues.length === 0) throw new Error('Result snapshot has no issues');
  const issueIds = new Set();
  const issues = rawIssues.map((rawIssue) => {
    const issue = requireObject(rawIssue, 'result issue');
    const id = requireUuid(issue.id, 'result issue id');
    if (issueIds.has(id)) throw new Error('Duplicate result issue id');
    issueIds.add(id);
    return { id, issue };
  });
  return { result, body, scope, scopeId, publishedAt, issues };
}

function parseImplementationResponses(input, result) {
  const root = requireObject(input, 'implementation responses');
  requireExactKeys(root, new Set(['scope', 'scope_id', 'observed_at', 'responses']), 'implementation response root');
  const scope = requireText(root.scope, 'implementation scope', 20);
  const scopeId = requireUuid(root.scope_id, 'implementation scope id');
  if (scope !== result.scope || scopeId !== result.scopeId) {
    throw new Error('Implementation scope does not match result snapshot');
  }
  const observedAt = requireTimestamp(root.observed_at, 'implementation observation timestamp');
  if (observedAt.timestamp < result.publishedAt.timestamp) {
    throw new Error('Implementation observation predates result publication');
  }
  const knownIssueIds = new Set(result.issues.map(({ id }) => id));
  const responseIssueIds = new Set();
  const rawResponses = requireArray(root.responses, 'implementation response list');
  if (rawResponses.length === 0) throw new Error('Implementation response list is empty');
  const responses = rawResponses.map((rawResponse) => {
    const response = requireObject(rawResponse, 'implementation response');
    requireExactKeys(response, new Set([
      'issue_id', 'status', 'responsible_body', 'updated_at', 'summary', 'evidence_url', 'reviewed_by', 'reviewed_at',
    ]), 'implementation response');
    const issueId = requireUuid(response.issue_id, 'implementation issue id');
    if (!knownIssueIds.has(issueId)) throw new Error('Implementation issue is outside the result snapshot');
    if (responseIssueIds.has(issueId)) throw new Error('Duplicate implementation issue response');
    responseIssueIds.add(issueId);
    const status = requireText(response.status, 'implementation status', 40);
    if (!IMPLEMENTATION_STATES.has(status)) throw new Error('Invalid implementation status');
    const updatedAt = requireTimestamp(response.updated_at, 'implementation update timestamp');
    const reviewedAt = requireTimestamp(response.reviewed_at, 'implementation review timestamp');
    if (updatedAt.timestamp > reviewedAt.timestamp || reviewedAt.timestamp > observedAt.timestamp) {
      throw new Error('Invalid implementation timestamp order');
    }
    const reviewer = requireText(response.reviewed_by, 'implementation reviewer', 40);
    if (!REVIEWER_PATTERN.test(reviewer)) throw new Error('Invalid implementation reviewer');
    return {
      issueId,
      implementation: {
        status,
        responsible_body: requireText(response.responsible_body, 'implementation responsible body', 200),
        updated_at: updatedAt.text,
        summary: requireText(response.summary, 'implementation summary', 1000),
        evidence_url: requireEvidenceUrl(response.evidence_url, EVIDENCE_REQUIRED_STATES.has(status)),
      },
      reviewer,
      reviewedAt: reviewedAt.text,
    };
  });
  return { observedAt: observedAt.text, responses };
}

function unsignedPlan(resultInput, responsesInput) {
  const result = parseResultSnapshot(resultInput);
  const parsedResponses = parseImplementationResponses(responsesInput, result);
  const responsesByIssue = new Map(parsedResponses.responses.map((response) => [response.issueId, response]));
  const nextBody = structuredClone(result.body);
  nextBody.issues = result.issues.map(({ id, issue }) => {
    const response = responsesByIssue.get(id);
    return response ? { ...structuredClone(issue), implementation: response.implementation } : structuredClone(issue);
  });
  nextBody.issues.forEach((issue) => validatePublicImplementation(issue.implementation));
  const patches = parsedResponses.responses
    .map((response) => {
      const current = result.issues.find(({ id }) => id === response.issueId)?.issue.implementation ?? null;
      return {
        issueId: response.issueId,
        beforeImplementationSha256: sha256(canonicalJson(current)),
        afterImplementationSha256: sha256(canonicalJson(response.implementation)),
        reviewer: response.reviewer,
        reviewedAt: response.reviewedAt,
      };
    })
    .sort((left, right) => left.issueId.localeCompare(right.issueId));
  return {
    schemaVersion: 1,
    scope: result.scope,
    scopeId: result.scopeId,
    observedAt: parsedResponses.observedAt,
    dryRun: true,
    databaseMutationExecuted: false,
    publicPayloadWritten: false,
    requiresApproval: true,
    inputSha256: {
      resultSnapshot: sha256(canonicalJson(resultInput)),
      implementationResponses: sha256(canonicalJson(responsesInput)),
    },
    beforeBodySha256: sha256(canonicalJson(result.body)),
    afterBodySha256: sha256(canonicalJson(nextBody)),
    summary: {
      issueCount: result.issues.length,
      changedIssueCount: patches.length,
      retainedIssueCount: result.issues.length - patches.length,
    },
    patches,
    atomicResultBody: nextBody,
  };
}

export function buildPlatformImplementationPlan(resultInput, responsesInput) {
  const plan = unsignedPlan(resultInput, responsesInput);
  return { ...plan, checksumSha256: sha256(canonicalJson(plan)) };
}

export function verifyPlatformImplementationPlan(planInput, resultInput, responsesInput) {
  const plan = requireObject(planInput, 'implementation plan');
  if (plan.schemaVersion !== 1) throw new Error('Unsupported implementation plan schema version');
  if (typeof plan.checksumSha256 !== 'string' || !SHA256_PATTERN.test(plan.checksumSha256)) {
    throw new Error('Invalid implementation plan checksum');
  }
  const { checksumSha256, ...unsigned } = plan;
  if (sha256(canonicalJson(unsigned)) !== checksumSha256) throw new Error('Implementation plan checksum mismatch');
  const expected = buildPlatformImplementationPlan(resultInput, responsesInput);
  if (canonicalJson(plan) !== canonicalJson(expected)) throw new Error('Implementation plan does not match inputs');
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
  const responsesPath = args.get('--responses');
  if (!resultPath || !responsesPath) throw new Error('Both --result and --responses are required');
  const result = readJson(resultPath, 'result snapshot');
  const responses = readJson(responsesPath, 'implementation responses');
  const verifyPath = args.get('--verify-plan');
  if (verifyPath) {
    verifyPlatformImplementationPlan(readJson(verifyPath, 'implementation plan'), result, responses);
    process.stdout.write(`${JSON.stringify({ verified: true, databaseMutationExecuted: false })}\n`);
    return;
  }
  const outputPath = args.get('--output');
  if (!outputPath) throw new Error('--output is required when creating a plan');
  if (existsSync(outputPath)) throw new Error('Output already exists');
  const plan = buildPlatformImplementationPlan(result, responses);
  writeFileSync(outputPath, `${JSON.stringify(plan, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  process.stdout.write(`${JSON.stringify({ created: true, changedIssueCount: plan.summary.changedIssueCount, databaseMutationExecuted: false })}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Implementation plan failed');
    process.exitCode = 1;
  }
}
