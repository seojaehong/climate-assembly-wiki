/**
 * 9.12~13 본부 v3 통합 브라우저 리허설.
 *
 * 프로덕션 빌드의 `/hq?ops=1`을 열지만 Supabase HTTP는 단 한 요청도 전달하지 않는다.
 * 허용한 RPC만 상태를 가진 합성 응답으로 처리하고, 그 밖의 Supabase HTTP는 차단한다.
 * WebSocket도 페이지 코드보다 먼저 무동작 구현으로 바꾼다.
 *
 * 이 검사는 UI 요청 형식과 사용자가 보는 복구 흐름의 증거다. DB 권한·트랜잭션·수명주기
 * 증거는 `scripts/verify-0912-postgres.sh`가 담당한다.
 */
import { createHash, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(HERE, '..');
const DEFAULT_FIXTURE_PATH = resolve(PROJECT_ROOT, 'automation/fixtures/0912-hq-rehearsal.json');
const DEFAULT_REPORT_PATH = resolve(PROJECT_ROOT, 'evaluation/0912-13-hq-rehearsal.json');
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const CATEGORY_VALUES = new Set(['common', 'difference', 'conflict', 'question']);
const KIND_VALUES = new Set(['Issue', 'Claim', 'Proposal', 'Concern', 'Condition', 'Value', 'Evidence']);
const VALUE_OPTIONS = new Set(['--base', '--report', '--fixture', '--timeout-ms']);
const FLAG_OPTIONS = new Set(['--headed', '--validate-fixture-only']);

const REQUIRED_RPC_CONTRACTS = Object.freeze({
  hq_submission_category_assign_v3: {
    requestFields: [
      'p_token',
      'p_session_slug',
      'p_submission_id',
      'p_item_ordinal',
      'p_category',
      'p_expected_submission_updated_at',
      'p_expected_event_id',
      'p_idempotency_key',
    ],
    responseStatuses: ['applied', 'conflict'],
    compareAndSetFields: ['p_expected_submission_updated_at', 'p_expected_event_id'],
  },
  hq_submission_kind_assign_v3: {
    requestFields: [
      'p_token',
      'p_session_slug',
      'p_submission_id',
      'p_item_ordinal',
      'p_kind',
      'p_expected_submission_updated_at',
      'p_expected_event_id',
      'p_idempotency_key',
    ],
    responseStatuses: ['applied', 'conflict'],
    compareAndSetFields: ['p_expected_submission_updated_at', 'p_expected_event_id'],
  },
  hq_clear_submissions_v3: {
    requestFields: [
      'p_token',
      'p_session_slug',
      'p_confirm',
      'p_expected_submissions',
      'p_idempotency_key',
    ],
    responseStatuses: ['applied', 'conflict'],
    exactSetField: 'p_expected_submissions',
  },
  workshop_hq_logout_v2: {
    requestFields: ['p_token'],
    successResponse: 'null',
  },
});

function fail(message) {
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requiredRecord(value, path) {
  assert(isRecord(value), `${path} must be an object`);
  return value;
}

function requiredString(value, path) {
  assert(typeof value === 'string' && value.trim().length > 0, `${path} must be a non-empty string`);
  return value;
}

function requiredUuid(value, path) {
  const candidate = requiredString(value, path);
  assert(UUID_PATTERN.test(candidate), `${path} must be a UUID`);
  return candidate;
}

function requiredInstant(value, path) {
  const candidate = requiredString(value, path);
  assert(ISO_PATTERN.test(candidate) && Number.isFinite(Date.parse(candidate)), `${path} must be a UTC ISO instant`);
  return candidate;
}

function sortedStrings(value) {
  return [...value].sort((left, right) => left.localeCompare(right));
}

function assertExactStrings(actual, expected, path) {
  assert(Array.isArray(actual) && actual.every((entry) => typeof entry === 'string'), `${path} must be a string array`);
  assert(
    JSON.stringify(sortedStrings(actual)) === JSON.stringify(sortedStrings(expected)),
    `${path} must equal ${expected.join(', ')}`,
  );
}

function inspectForSensitiveFixtureMaterial(value, path = 'root') {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => inspectForSensitiveFixtureMaterial(entry, `${path}[${index}]`));
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, entry] of Object.entries(value)) {
    const normalized = key.toLowerCase();
    assert(!['token', 'password', 'secret'].includes(normalized), `${path}.${key} must not store capability material`);
    inspectForSensitiveFixtureMaterial(entry, `${path}.${key}`);
  }
}

export function parseHqRehearsalCli(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    if (FLAG_OPTIONS.has(name)) {
      assert(!Object.hasOwn(parsed, name), `Duplicate option: ${name}`);
      parsed[name] = true;
      continue;
    }
    assert(VALUE_OPTIONS.has(name), `Unsupported option: ${String(name)}`);
    assert(!Object.hasOwn(parsed, name), `Duplicate option: ${name}`);
    const value = argv[index + 1];
    assert(typeof value === 'string' && value.trim() !== '' && !value.startsWith('--'), `${name} requires a value`);
    parsed[name] = value;
    index += 1;
  }

  const baseInput = parsed['--base'] ?? 'http://localhost:4331';
  let baseUrl;
  try {
    baseUrl = new URL(baseInput);
  } catch {
    fail('--base must be a valid HTTP(S) origin');
  }
  assert(['http:', 'https:'].includes(baseUrl.protocol), '--base must use HTTP or HTTPS');
  assert(baseUrl.username === '' && baseUrl.password === '', '--base must not contain credentials');
  assert(baseUrl.pathname === '/' && baseUrl.search === '' && baseUrl.hash === '', '--base must be an origin without path, query, or fragment');

  const timeoutMs = Number(parsed['--timeout-ms'] ?? 60_000);
  assert(Number.isSafeInteger(timeoutMs) && timeoutMs >= 5_000 && timeoutMs <= 120_000, '--timeout-ms must be an integer from 5000 through 120000');

  const fixturePath = resolve(parsed['--fixture'] ?? DEFAULT_FIXTURE_PATH);
  const reportPath = resolve(parsed['--report'] ?? DEFAULT_REPORT_PATH);
  assert(fixturePath !== reportPath, '--fixture and --report must be different files');
  assert(reportPath.toLowerCase().endsWith('.json'), '--report must end with .json');

  return {
    baseUrl: baseUrl.origin,
    fixturePath,
    reportPath,
    timeoutMs,
    headed: parsed['--headed'] === true,
    validateFixtureOnly: parsed['--validate-fixture-only'] === true,
    reportWasExplicit: Object.hasOwn(parsed, '--report'),
  };
}

export function validateHqRehearsalFixture(fixture) {
  requiredRecord(fixture, 'root');
  assert(fixture.schemaVersion === 1, 'schemaVersion must equal 1');
  requiredString(fixture.fixtureId, 'fixtureId');
  assert(fixture.classification === 'synthetic-no-pii-no-secrets', 'classification must be synthetic-no-pii-no-secrets');
  inspectForSensitiveFixtureMaterial(fixture);
  const serialized = JSON.stringify(fixture);
  assert(!/@|010[- ]?\d{3,4}[- ]?\d{4}/.test(serialized), 'fixture must not contain email or phone-like personal data');
  assert(!/eyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}/.test(serialized), 'fixture must not contain JWT material');
  assert(!/(?:sk|sbp)_[A-Za-z0-9_-]{16,}/.test(serialized), 'fixture must not contain secret-like material');

  const evidence = requiredRecord(fixture.evidence, 'evidence');
  assert(evidence.evidenceClass === 'ui-fixture-only', 'evidence.evidenceClass must be ui-fixture-only');
  assert(evidence.databaseAuthorizationOrLifecycleEvidence === false, 'fixture must disclaim DB authorization and lifecycle evidence');
  assert(evidence.productionDatabaseMutationRequiresExplicitApproval === true, 'fixture must preserve the production mutation approval gate');
  assert(evidence.screenshotsAllowed === false, 'HQ capability rehearsal must disable screenshots');

  let supabaseUrl;
  try {
    supabaseUrl = new URL(requiredString(fixture.supabaseOrigin, 'supabaseOrigin'));
  } catch {
    fail('supabaseOrigin must be a valid URL');
  }
  assert(supabaseUrl.protocol === 'https:' && supabaseUrl.origin === fixture.supabaseOrigin, 'supabaseOrigin must be an exact HTTPS origin');
  assert(supabaseUrl.hostname.endsWith('.supabase.co'), 'supabaseOrigin must identify a Supabase host');

  const session = requiredRecord(fixture.session, 'session');
  requiredUuid(session.id, 'session.id');
  requiredString(session.slug, 'session.slug');
  requiredString(session.title, 'session.title');
  requiredString(session.organizationName, 'session.organizationName');
  requiredString(session.operatorActorLabel, 'session.operatorActorLabel');

  const storage = requiredRecord(fixture.storage, 'storage');
  assert(storage.capabilityStorageKey === 'climate_vote_hq_attendance_token', 'storage.capabilityStorageKey is unexpected');
  assert(storage.actorStorageKey === 'climate_vote_hq_gate_actor', 'storage.actorStorageKey is unexpected');
  assert(storage.capabilitySource === 'runtime-generated', 'storage.capabilitySource must be runtime-generated');

  assert(Array.isArray(fixture.boardRows) && fixture.boardRows.length >= 2, 'boardRows must contain at least two synthetic submissions');
  const submissionVersions = new Map();
  const noteKeys = new Set();
  for (const [index, rawRow] of fixture.boardRows.entries()) {
    const row = requiredRecord(rawRow, `boardRows[${index}]`);
    requiredUuid(row.topic_id, `boardRows[${index}].topic_id`);
    assert(Number.isSafeInteger(row.topic_ordinal) && row.topic_ordinal > 0, `boardRows[${index}].topic_ordinal must be positive`);
    requiredString(row.topic_prompt, `boardRows[${index}].topic_prompt`);
    assert(['open', 'closed'].includes(row.topic_status), `boardRows[${index}].topic_status is unsupported`);
    requiredUuid(row.team_id, `boardRows[${index}].team_id`);
    requiredString(row.team_name, `boardRows[${index}].team_name`);
    requiredUuid(row.submission_id, `boardRows[${index}].submission_id`);
    assert(Number.isSafeInteger(row.submission_version) && row.submission_version >= 0, `boardRows[${index}].submission_version must be a non-negative integer`);
    requiredInstant(row.submission_updated_at, `boardRows[${index}].submission_updated_at`);
    assert(Number.isSafeInteger(row.item_ordinal) && row.item_ordinal > 0, `boardRows[${index}].item_ordinal must be positive`);
    requiredUuid(row.item_id, `boardRows[${index}].item_id`);
    requiredString(row.item_content, `boardRows[${index}].item_content`);
    const previousVersion = submissionVersions.get(row.submission_id);
    assert(previousVersion === undefined || previousVersion === row.submission_version, `submission ${row.submission_id} has contradictory versions`);
    submissionVersions.set(row.submission_id, row.submission_version);
    const noteKey = `${row.submission_id}:${row.item_ordinal}`;
    assert(!noteKeys.has(noteKey), `duplicate note generation ${noteKey}`);
    noteKeys.add(noteKey);
  }
  assert(submissionVersions.size >= 2, 'boardRows must cover at least two distinct submissions for exact-set clear');

  const validateAssignmentRows = (rows, valueKey, allowedValues, label) => {
    assert(Array.isArray(rows) && rows.length > 0, `${label} must be a non-empty array`);
    for (const [index, rawRow] of rows.entries()) {
      const row = requiredRecord(rawRow, `${label}[${index}]`);
      requiredUuid(row.topic_id, `${label}[${index}].topic_id`);
      requiredUuid(row.team_id, `${label}[${index}].team_id`);
      requiredUuid(row.submission_id, `${label}[${index}].submission_id`);
      assert(noteKeys.has(`${row.submission_id}:${row.item_ordinal}`), `${label}[${index}] must reference a fixture note`);
      assert(Number.isSafeInteger(row.event_id) && row.event_id > 0, `${label}[${index}].event_id must be positive`);
      requiredUuid(row.source_item_id, `${label}[${index}].source_item_id`);
      assert(row[valueKey] === null || allowedValues.has(row[valueKey]), `${label}[${index}].${valueKey} is unsupported`);
      requiredInstant(row.assigned_at, `${label}[${index}].assigned_at`);
    }
  };
  validateAssignmentRows(fixture.categoryAssignments, 'category', CATEGORY_VALUES, 'categoryAssignments');
  validateAssignmentRows(fixture.kindAssignments, 'kind', KIND_VALUES, 'kindAssignments');

  const status = requiredRecord(fixture.workshopStatus, 'workshopStatus');
  assert(status.session_id === session.id && status.session_slug === session.slug, 'workshopStatus must use the fixture session');
  assert(Array.isArray(status.topics) && status.topics.length > 0, 'workshopStatus.topics must be non-empty');

  const scenario = requiredRecord(fixture.scenario, 'scenario');
  requiredUuid(scenario.primarySubmissionId, 'scenario.primarySubmissionId');
  assert(noteKeys.has(`${scenario.primarySubmissionId}:${scenario.primaryItemOrdinal}`), 'scenario primary note is absent from boardRows');
  assert(CATEGORY_VALUES.has(scenario.categoryRetryValue), 'scenario.categoryRetryValue is unsupported');
  assert(CATEGORY_VALUES.has(scenario.categoryConflictValue), 'scenario.categoryConflictValue is unsupported');
  assert(CATEGORY_VALUES.has(scenario.categoryConcurrentValue), 'scenario.categoryConcurrentValue is unsupported');
  assert(KIND_VALUES.has(scenario.kindRetryValue), 'scenario.kindRetryValue is unsupported');
  for (const key of ['categoryAppliedEventId', 'categoryConcurrentEventId', 'kindAppliedEventId', 'kindConcurrentEventId']) {
    assert(Number.isSafeInteger(scenario[key]) && scenario[key] > 0, `scenario.${key} must be a positive integer`);
  }
  requiredUuid(scenario.concurrentSourceItemId, 'scenario.concurrentSourceItemId');
  requiredInstant(scenario.concurrentSubmissionUpdatedAt, 'scenario.concurrentSubmissionUpdatedAt');
  requiredString(scenario.syntheticTransportErrorCode, 'scenario.syntheticTransportErrorCode');

  const contracts = requiredRecord(fixture.rpcContracts, 'rpcContracts');
  assertExactStrings(Object.keys(contracts), Object.keys(REQUIRED_RPC_CONTRACTS), 'rpcContracts names');
  for (const [rpc, expected] of Object.entries(REQUIRED_RPC_CONTRACTS)) {
    const contract = requiredRecord(contracts[rpc], `rpcContracts.${rpc}`);
    assert(contract.effect === 'fixture-mutation', `rpcContracts.${rpc}.effect must be fixture-mutation`);
    assertExactStrings(contract.requestFields, expected.requestFields, `rpcContracts.${rpc}.requestFields`);
    if (expected.responseStatuses) {
      assertExactStrings(contract.responseStatuses, expected.responseStatuses, `rpcContracts.${rpc}.responseStatuses`);
    }
    if (expected.compareAndSetFields) {
      assertExactStrings(contract.compareAndSetFields, expected.compareAndSetFields, `rpcContracts.${rpc}.compareAndSetFields`);
      assert(contract.stableIdempotencyForExactRetry === true, `rpcContracts.${rpc} must require stable idempotency`);
    }
    if (expected.exactSetField) {
      assert(contract.exactSetField === expected.exactSetField, `rpcContracts.${rpc}.exactSetField is unexpected`);
    }
    if (expected.successResponse) {
      assert(contract.successResponse === expected.successResponse, `rpcContracts.${rpc}.successResponse is unexpected`);
      assert(contract.failureKeepsLocalCapability === true, `rpcContracts.${rpc} must keep the local capability on failure`);
    }
  }
  return fixture;
}

function displayPath(path) {
  const rel = relative(PROJECT_ROOT, path);
  return rel.startsWith('..') || isAbsolute(rel) ? path.replaceAll('\\', '/') : rel.replaceAll('\\', '/');
}

function sourceState() {
  try {
    const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: PROJECT_ROOT, encoding: 'utf8' }).trim();
    const sourceTreeClean = execFileSync('git', ['status', '--porcelain'], { cwd: PROJECT_ROOT, encoding: 'utf8' }).trim() === '';
    return { sourceCommit, sourceTreeClean };
  } catch {
    return { sourceCommit: 'unknown', sourceTreeClean: false };
  }
}

function loadValidatedFixture(path) {
  const text = readFileSync(path, 'utf8');
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    fail(`Invalid HQ rehearsal fixture JSON at ${path}: ${error instanceof Error ? error.message : 'parse failed'}`);
  }
  return {
    fixture: validateHqRehearsalFixture(parsed),
    text,
    sha256: createHash('sha256').update(text, 'utf8').digest('hex'),
  };
}

function fixtureValidationReport(fixture, fixturePath, fixtureSha256) {
  return {
    schemaVersion: 1,
    rehearsalId: '0912-13-hq-v3-fixture-validation',
    generatedAt: new Date().toISOString(),
    validationOnly: true,
    fixture: displayPath(fixturePath),
    fixtureSha256,
    fixtureIdentity: {
      schemaVersion: fixture.schemaVersion,
      fixtureId: fixture.fixtureId,
      classification: fixture.classification,
    },
    evidenceBoundary: {
      evidenceClass: fixture.evidence.evidenceClass,
      databaseAuthorizationOrLifecycleEvidence: false,
      canonicalDatabaseVerifier: fixture.evidence.canonicalDatabaseVerifier,
    },
    rpcContracts: fixture.rpcContracts,
    status: 'fixture_valid',
    summary: { checkCount: 1, passCount: 1, failCount: 0 },
    checks: [{ id: 'fixture-schema-and-semantics', status: 'pass', observed: `sha256:${fixtureSha256}` }],
  };
}

function clone(value) {
  return structuredClone(value);
}

function bodyRecord(request) {
  try {
    const value = request.postDataJSON();
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
}

function sameValue(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sortedExpectedSubmissions(rows) {
  const versions = new Map();
  for (const row of rows) versions.set(row.submission_id, row.submission_version);
  return [...versions.entries()]
    .map(([id, version]) => ({ id, version }))
    .sort((left, right) => left.id.localeCompare(right.id));
}

function requestFingerprintWithoutCapability(body) {
  const copy = { ...body };
  delete copy.p_token;
  return copy;
}

function safeMessage(error, sensitiveValues) {
  let message = error instanceof Error ? error.message : String(error);
  for (const value of sensitiveValues) message = message.replaceAll(value, '[redacted-runtime-capability]');
  return message;
}

async function waitFor(predicate, timeoutMs, label) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 40));
  }
  fail(`${label} did not complete within ${timeoutMs}ms`);
}

async function runBrowserRehearsal(options, fixture, fixturePath, fixtureSha256) {
  // Playwright is deliberately loaded only after strict CLI and fixture validation.
  const { chromium } = await import('../automation/node_modules/playwright/index.mjs');
  const startedAt = Date.now();
  const runtimeCapability = randomBytes(32).toString('hex');
  const sensitiveValues = [runtimeCapability];
  const url = `${options.baseUrl}/hq?ops=1`;
  const checks = [];
  const findings = [];
  const pageErrors = [];
  const network = {
    supabaseHttpRequestCount: 0,
    forwardedSupabaseHttpRequestCount: 0,
    blockedUnexpectedSupabaseHttpRequestCount: 0,
    blockedUnexpectedSupabaseRpcNames: new Set(),
    blockedExternalHttpRequestCount: 0,
    preflightRequestCount: 0,
    fixtureReadRequestCount: 0,
    fixtureMutationRequestCount: 0,
    contractViolations: [],
  };
  const calls = new Map();
  const mutationBodies = {
    hq_submission_category_assign_v3: [],
    hq_submission_kind_assign_v3: [],
    hq_clear_submissions_v3: [],
    workshop_hq_logout_v2: [],
  };
  const server = {
    rows: clone(fixture.boardRows),
    categories: clone(fixture.categoryAssignments),
    kinds: clone(fixture.kindAssignments),
    deletedItemCount: 0,
  };
  const scenario = fixture.scenario;
  const primaryRow = fixture.boardRows.find((row) => (
    row.submission_id === scenario.primarySubmissionId && row.item_ordinal === scenario.primaryItemOrdinal
  ));
  assert(primaryRow, 'fixture primary row disappeared after validation');
  const noteId = `${primaryRow.topic_id}:${primaryRow.team_id}:${primaryRow.item_ordinal}`;
  const initialUpdatedAt = primaryRow.submission_updated_at;
  const initialCategoryEventId = fixture.categoryAssignments.find((row) => (
    row.submission_id === scenario.primarySubmissionId && row.item_ordinal === scenario.primaryItemOrdinal
  ))?.event_id;
  const initialKindEventId = fixture.kindAssignments.find((row) => (
    row.submission_id === scenario.primarySubmissionId && row.item_ordinal === scenario.primaryItemOrdinal
  ))?.event_id;
  assert(Number.isSafeInteger(initialCategoryEventId), 'primary category event is absent');
  assert(Number.isSafeInteger(initialKindEventId), 'primary kind event is absent');

  const increment = (rpc) => {
    const next = (calls.get(rpc) ?? 0) + 1;
    calls.set(rpc, next);
    return next;
  };
  const readCount = (rpc) => calls.get(rpc) ?? 0;
  const check = async (id, label, operation) => {
    try {
      const observed = await operation();
      checks.push({ id, label, status: 'pass', observed });
      console.log(`  PASS  ${label}`);
    } catch (error) {
      const message = safeMessage(error, sensitiveValues);
      checks.push({ id, label, status: 'fail', observed: message });
      findings.push(`${id}: ${message}`);
      console.log(`  FAIL  ${label} — ${message}`);
    }
  };

  const json = (route, value, status = 200) => route.fulfill({
    status,
    contentType: 'application/json',
    headers: {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'authorization, apikey, content-profile, x-client-info',
      'access-control-allow-methods': 'GET, POST, OPTIONS',
      'access-control-expose-headers': 'content-profile',
      'content-profile': 'climate_vote',
    },
    body: JSON.stringify(value),
  });

  const validateScopedRead = (rpc, body) => {
    if (!body || body.p_token !== runtimeCapability || body.p_session_slug !== fixture.session.slug) {
      network.contractViolations.push({ rpc, reason: 'scoped-read-arguments' });
      return false;
    }
    return true;
  };
  const validateMutation = (rpc, body) => {
    const expectedFields = fixture.rpcContracts[rpc].requestFields;
    if (!body || !sameValue(sortedStrings(Object.keys(body)), sortedStrings(expectedFields))) {
      network.contractViolations.push({
        rpc,
        reason: 'request-fields',
        observedFields: body ? sortedStrings(Object.keys(body)) : [],
      });
      return false;
    }
    if (body.p_token !== runtimeCapability) {
      network.contractViolations.push({ rpc, reason: 'runtime-capability' });
      return false;
    }
    if (rpc !== 'workshop_hq_logout_v2' && body.p_session_slug !== fixture.session.slug) {
      network.contractViolations.push({ rpc, reason: 'session-scope' });
      return false;
    }
    if (rpc !== 'workshop_hq_logout_v2' && !UUID_PATTERN.test(body.p_idempotency_key ?? '')) {
      network.contractViolations.push({ rpc, reason: 'idempotency-key' });
      return false;
    }
    return true;
  };

  const handleRpc = async (route, rpc) => {
    const request = route.request();
    const body = bodyRecord(request);
    const attempt = increment(rpc);
    const readResponses = {
      workshop_hq_status: () => clone(fixture.workshopStatus),
      workshop_hq_devices: () => [],
      hq_submissions_v3: () => clone(server.rows),
      hq_submission_categories_v3: () => clone(server.categories),
      hq_submission_kinds_v3: () => clone(server.kinds),
      hq_topic_deadlines_v2: () => fixture.workshopStatus.topics.map((topic) => ({
        topic_id: topic.id,
        topic_ordinal: topic.ordinal,
        deadline_at: topic.deadline_at,
      })),
    };
    if (Object.hasOwn(readResponses, rpc)) {
      network.fixtureReadRequestCount += 1;
      if (!validateScopedRead(rpc, body)) {
        return json(route, { code: 'SYNTHETIC_CONTRACT_REJECTED', message: 'fixture read contract rejected' }, 400);
      }
      return json(route, readResponses[rpc]());
    }

    if (!Object.hasOwn(mutationBodies, rpc)) {
      network.blockedUnexpectedSupabaseHttpRequestCount += 1;
      network.blockedUnexpectedSupabaseRpcNames.add(rpc);
      return route.abort('blockedbyclient');
    }
    network.fixtureMutationRequestCount += 1;
    mutationBodies[rpc].push(body);
    if (!validateMutation(rpc, body)) {
      return json(route, { code: 'SYNTHETIC_CONTRACT_REJECTED', message: 'fixture mutation contract rejected' }, 400);
    }

    if (rpc === 'hq_submission_category_assign_v3') {
      if (attempt === 1) {
        return json(route, { code: scenario.syntheticTransportErrorCode, message: 'synthetic category transport failure' }, 503);
      }
      if (attempt === 2) {
        const next = {
          ...server.categories[0],
          category: scenario.categoryRetryValue,
          event_id: scenario.categoryAppliedEventId,
          assigned_at: '2026-09-12T01:03:00.000Z',
        };
        server.categories = [next];
        return json(route, {
          status: 'applied',
          submission_id: scenario.primarySubmissionId,
          item_ordinal: scenario.primaryItemOrdinal,
          source_item_id: next.source_item_id,
          submission_updated_at: initialUpdatedAt,
          event_id: scenario.categoryAppliedEventId,
          category: scenario.categoryRetryValue,
        });
      }

      server.rows = server.rows.map((row) => row.submission_id === scenario.primarySubmissionId
        ? {
            ...row,
            submission_version: row.submission_version + 1,
            submission_updated_at: scenario.concurrentSubmissionUpdatedAt,
            item_id: scenario.concurrentSourceItemId,
            item_content: '합성 카드 하나 — 다른 운영자가 갱신한 최신 문장.',
          }
        : row);
      server.categories = [{
        ...server.categories[0],
        category: scenario.categoryConcurrentValue,
        event_id: scenario.categoryConcurrentEventId,
        source_item_id: scenario.concurrentSourceItemId,
        assigned_at: '2026-09-12T01:05:01.000Z',
      }];
      server.kinds = [{
        ...server.kinds[0],
        kind: null,
        event_id: scenario.kindConcurrentEventId,
        source_item_id: scenario.concurrentSourceItemId,
        assigned_at: '2026-09-12T01:05:02.000Z',
      }];
      return json(route, {
        status: 'conflict',
        submission_id: scenario.primarySubmissionId,
        current_submission_updated_at: scenario.concurrentSubmissionUpdatedAt,
        current_event_id: scenario.categoryConcurrentEventId,
      });
    }

    if (rpc === 'hq_submission_kind_assign_v3') {
      if (attempt === 1) {
        return json(route, { code: scenario.syntheticTransportErrorCode, message: 'synthetic kind transport failure' }, 503);
      }
      const next = {
        ...server.kinds[0],
        kind: scenario.kindRetryValue,
        event_id: scenario.kindAppliedEventId,
        assigned_at: '2026-09-12T01:04:00.000Z',
      };
      server.kinds = [next];
      return json(route, {
        status: 'applied',
        submission_id: scenario.primarySubmissionId,
        item_ordinal: scenario.primaryItemOrdinal,
        source_item_id: next.source_item_id,
        submission_updated_at: initialUpdatedAt,
        event_id: scenario.kindAppliedEventId,
        kind: scenario.kindRetryValue,
      });
    }

    if (rpc === 'hq_clear_submissions_v3') {
      const expected = body.p_expected_submissions;
      const current = clone(expected);
      const primary = current.find((entry) => entry.id === scenario.primarySubmissionId);
      if (primary) primary.version += 1;
      server.rows = server.rows.map((row) => row.submission_id === scenario.primarySubmissionId
        ? { ...row, submission_version: row.submission_version + 1 }
        : row);
      return json(route, {
        status: 'conflict',
        current_submissions: current,
        expected_submissions: expected,
      });
    }

    return json(route, { code: scenario.syntheticTransportErrorCode, message: 'synthetic logout transport failure' }, 503);
  };

  let browser;
  let context;
  let page;
  let observedWebSocketAttemptCount = 0;
  try {
    browser = await chromium.launch({ headless: !options.headed });
    context = await browser.newContext({
      viewport: { width: 1440, height: 1100 },
      serviceWorkers: 'block',
      acceptDownloads: false,
    });
    await context.addInitScript(({ capabilityKey, actorKey, capability, actor }) => {
      sessionStorage.setItem(capabilityKey, capability);
      sessionStorage.setItem(actorKey, actor);
      const attempts = [];
      class BlockedWebSocket {
        static CONNECTING = 0;
        static OPEN = 1;
        static CLOSING = 2;
        static CLOSED = 3;
        constructor(urlValue) {
          attempts.push(String(urlValue));
          this.url = String(urlValue);
          this.readyState = BlockedWebSocket.CONNECTING;
          this.bufferedAmount = 0;
          this.extensions = '';
          this.protocol = '';
          this.binaryType = 'blob';
          this.onopen = null;
          this.onclose = null;
          this.onerror = null;
          this.onmessage = null;
        }
        send() {}
        close() { this.readyState = BlockedWebSocket.CLOSED; }
        addEventListener() {}
        removeEventListener() {}
        dispatchEvent() { return false; }
      }
      Object.defineProperty(window, '__hqRehearsalWebSocketAttempts', {
        configurable: false,
        enumerable: false,
        writable: false,
        value: attempts,
      });
      window.WebSocket = BlockedWebSocket;
    }, {
      capabilityKey: fixture.storage.capabilityStorageKey,
      actorKey: fixture.storage.actorStorageKey,
      capability: runtimeCapability,
      actor: fixture.session.operatorActorLabel,
    });

    await context.route('**/*', async (route) => {
      const request = route.request();
      const requestUrl = new URL(request.url());
      if (requestUrl.origin === options.baseUrl) return route.continue();
      if (requestUrl.origin === fixture.supabaseOrigin) {
        network.supabaseHttpRequestCount += 1;
        if (request.method() === 'OPTIONS') {
          network.preflightRequestCount += 1;
          return route.fulfill({
            status: 204,
            headers: {
              'access-control-allow-origin': '*',
              'access-control-allow-headers': 'authorization, apikey, content-profile, x-client-info',
              'access-control-allow-methods': 'GET, POST, OPTIONS',
            },
            body: '',
          });
        }
        const match = /^\/rest\/v1\/rpc\/([a-z0-9_]+)$/.exec(requestUrl.pathname);
        if (!match || request.method() !== 'POST') {
          network.blockedUnexpectedSupabaseHttpRequestCount += 1;
          return route.abort('blockedbyclient');
        }
        return handleRpc(route, match[1]);
      }
      if (requestUrl.protocol === 'http:' || requestUrl.protocol === 'https:') {
        network.blockedExternalHttpRequestCount += 1;
        return route.abort('blockedbyclient');
      }
      return route.continue();
    });

    page = await context.newPage();
    page.on('pageerror', (error) => pageErrors.push(safeMessage(error, sensitiveValues)));
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: options.timeoutMs });
    const card = page.locator(`article[data-note-id="${noteId}"]`).first();
    await card.waitFor({ state: 'visible', timeout: options.timeoutMs });
    await waitFor(
      () => readCount('hq_submission_categories_v3') > 0 && readCount('hq_submission_kinds_v3') > 0,
      options.timeoutMs,
      'initial assignment reads',
    );

    await check('named-hq-session', '이름이 있는 본부 세션을 주입하고 v3 범위 읽기로 화면을 연다', async () => {
      const storageState = await page.evaluate(({ capabilityKey, actorKey, expectedCapability }) => ({
        capabilityMatches: sessionStorage.getItem(capabilityKey) === expectedCapability,
        actor: sessionStorage.getItem(actorKey),
      }), {
        capabilityKey: fixture.storage.capabilityStorageKey,
        actorKey: fixture.storage.actorStorageKey,
        expectedCapability: runtimeCapability,
      });
      assert(storageState.capabilityMatches, 'named HQ capability was not stored in sessionStorage');
      assert(storageState.actor === fixture.session.operatorActorLabel, 'named HQ actor was not stored');
      await page.getByText(`본부 로그인됨 · ${fixture.session.operatorActorLabel}`, { exact: true }).waitFor();
      assert(readCount('hq_submissions_v3') > 0, 'hq_submissions_v3 was not called');
      return {
        actorLabel: fixture.session.operatorActorLabel,
        capabilitySource: 'runtime-generated',
        scopedReadRpcNames: [
          'workshop_hq_status',
          'workshop_hq_devices',
          'hq_submissions_v3',
          'hq_submission_categories_v3',
          'hq_submission_kinds_v3',
          'hq_topic_deadlines_v2',
        ],
      };
    });

    await check('category-stable-retry', '범주 v3 전송 재시도는 idempotency와 두 CAS 값을 그대로 재사용한다', async () => {
      const categoryGroup = card.locator('[data-testid="category-buttons"]');
      await categoryGroup.locator(`button[data-category="${scenario.categoryRetryValue}"]`).click();
      const retry = card.getByRole('button', { name: '범주 저장 다시 시도', exact: true });
      await retry.waitFor({ state: 'visible', timeout: options.timeoutMs });
      await retry.click();
      await card.locator(`[data-testid="category-badge"][data-category="${scenario.categoryRetryValue}"]`).waitFor({ timeout: options.timeoutMs });
      await waitFor(() => mutationBodies.hq_submission_category_assign_v3.length >= 2, options.timeoutMs, 'category retry requests');
      const [first, second] = mutationBodies.hq_submission_category_assign_v3;
      assert(first.p_idempotency_key === second.p_idempotency_key, 'category retry changed its idempotency key');
      assert(first.p_expected_event_id === initialCategoryEventId && second.p_expected_event_id === initialCategoryEventId, 'category retry changed event CAS');
      assert(first.p_expected_submission_updated_at === initialUpdatedAt && second.p_expected_submission_updated_at === initialUpdatedAt, 'category retry changed submission generation CAS');
      assert(sameValue(requestFingerprintWithoutCapability(first), requestFingerprintWithoutCapability(second)), 'category retry changed the request payload');
      return {
        requestCount: 2,
        firstResponse: { httpStatus: 503, code: scenario.syntheticTransportErrorCode },
        secondResponse: { status: 'applied', eventId: scenario.categoryAppliedEventId },
        stableIdempotencyKey: true,
        stableExpectedEventId: true,
        stableExpectedSubmissionUpdatedAt: true,
      };
    });

    await check('kind-stable-retry', '종류 v3 전송 재시도도 idempotency와 두 CAS 값을 그대로 재사용한다', async () => {
      await page.locator('[data-testid="ontology-view-toggle"]').click();
      const kindGroup = card.locator('[data-testid="ontology-kind-buttons"]');
      await kindGroup.locator(`button[data-kind="${scenario.kindRetryValue}"]`).click();
      const retry = card.getByRole('button', { name: '종류 저장 다시 시도', exact: true });
      await retry.waitFor({ state: 'visible', timeout: options.timeoutMs });
      await retry.click();
      await card.locator(`[data-testid="ontology-kind-badge"][data-kind="${scenario.kindRetryValue}"]`).waitFor({ timeout: options.timeoutMs });
      await waitFor(() => mutationBodies.hq_submission_kind_assign_v3.length >= 2, options.timeoutMs, 'kind retry requests');
      const [first, second] = mutationBodies.hq_submission_kind_assign_v3;
      assert(first.p_idempotency_key === second.p_idempotency_key, 'kind retry changed its idempotency key');
      assert(first.p_expected_event_id === initialKindEventId && second.p_expected_event_id === initialKindEventId, 'kind retry changed event CAS');
      assert(first.p_expected_submission_updated_at === initialUpdatedAt && second.p_expected_submission_updated_at === initialUpdatedAt, 'kind retry changed submission generation CAS');
      assert(sameValue(requestFingerprintWithoutCapability(first), requestFingerprintWithoutCapability(second)), 'kind retry changed the request payload');
      return {
        requestCount: 2,
        firstResponse: { httpStatus: 503, code: scenario.syntheticTransportErrorCode },
        secondResponse: { status: 'applied', eventId: scenario.kindAppliedEventId },
        stableIdempotencyKey: true,
        stableExpectedEventId: true,
        stableExpectedSubmissionUpdatedAt: true,
      };
    });

    await check('stale-conflict-recovery', 'stale 범주 CAS 충돌은 최신 원문과 배정을 다시 읽고 눈에 보이게 안내한다', async () => {
      const submissionsBefore = readCount('hq_submissions_v3');
      const categoriesBefore = readCount('hq_submission_categories_v3');
      const firstIntent = mutationBodies.hq_submission_category_assign_v3[0].p_idempotency_key;
      await card.locator(`[data-testid="category-buttons"] button[data-category="${scenario.categoryConflictValue}"]`).click();
      await page.getByRole('alert').filter({ hasText: '원문이 변경됨' }).first().waitFor({ timeout: options.timeoutMs });
      await page.getByText('합성 카드 하나 — 다른 운영자가 갱신한 최신 문장.', { exact: true }).first().waitFor({ timeout: options.timeoutMs });
      const latestCard = page.locator(`article[data-note-id="${noteId}"]`).first();
      await latestCard.locator(`[data-testid="category-badge"][data-category="${scenario.categoryConcurrentValue}"]`).waitFor({ timeout: options.timeoutMs });
      assert(await latestCard.locator(`[data-testid="ontology-kind-badge"][data-kind="${scenario.kindRetryValue}"]`).count() === 0, 'old kind assignment was grafted onto the replaced source item');
      assert(readCount('hq_submissions_v3') > submissionsBefore, 'conflict did not reload submissions');
      assert(readCount('hq_submission_categories_v3') > categoriesBefore, 'conflict did not reload category events');
      const stale = mutationBodies.hq_submission_category_assign_v3[2];
      assert(stale.p_expected_event_id === scenario.categoryAppliedEventId, 'stale request did not CAS against the applied category event');
      assert(stale.p_expected_submission_updated_at === initialUpdatedAt, 'stale request did not CAS against the visible submission generation');
      assert(stale.p_idempotency_key !== firstIntent, 'a changed category intent reused an old idempotency key');
      return {
        request: {
          expectedEventId: scenario.categoryAppliedEventId,
          expectedSubmissionUpdatedAt: initialUpdatedAt,
          changedIntentUsesNewIdempotencyKey: true,
        },
        response: {
          status: 'conflict',
          currentEventId: scenario.categoryConcurrentEventId,
          currentSubmissionUpdatedAt: scenario.concurrentSubmissionUpdatedAt,
        },
        authoritativeReload: true,
        visibleAlert: true,
        replacedSourceDoesNotKeepOldKind: true,
      };
    });

    await check('clear-exact-set-conflict', '전체 비우기 v3는 정확한 제출물 세대 집합을 보내고 충돌 시 아무것도 지우지 않는다', async () => {
      const expectedSet = sortedExpectedSubmissions(server.rows);
      const cardCountBefore = await page.locator('article[data-note-id]').count();
      const panel = page.locator('[data-testid="clear-all-panel"]');
      await panel.getByRole('button', { name: '열기', exact: true }).click();
      await panel.getByLabel('확인 문구').fill('전체 비우기');
      await panel.getByRole('button', { name: '전체 비우기', exact: true }).click();
      await panel.getByRole('alert').filter({ hasText: '제출물이 변경되어 아무것도 비우지 않았습니다' }).waitFor({ timeout: options.timeoutMs });
      const body = mutationBodies.hq_clear_submissions_v3[0];
      assert(sameValue(body.p_expected_submissions, expectedSet), 'clear v3 did not send the exact sorted submission generation set');
      assert(body.p_confirm === '전체 비우기', 'clear v3 confirmation phrase changed');
      assert(server.deletedItemCount === 0, 'fixture server deleted items on a clear conflict');
      assert(await page.locator('article[data-note-id]').count() === cardCountBefore, 'cards disappeared after a clear conflict');
      return {
        exactSet: true,
        expectedSubmissionCount: expectedSet.length,
        duplicateSubmissionCount: expectedSet.length - new Set(expectedSet.map((entry) => entry.id)).size,
        response: { status: 'conflict' },
        deletedItemCount: 0,
        visibleAlert: true,
      };
    });

    await check('logout-failure-retains-capability', '서버 로그아웃 실패는 본부 토큰을 지우지 않고 재시도를 안내한다', async () => {
      await page.getByRole('button', { name: '로그아웃', exact: true }).click();
      await page.getByRole('alert').filter({ hasText: '서버 로그아웃을 완료하지 못했습니다' }).waitFor({ timeout: options.timeoutMs });
      const retained = await page.evaluate(({ key, expected }) => sessionStorage.getItem(key) === expected, {
        key: fixture.storage.capabilityStorageKey,
        expected: runtimeCapability,
      });
      assert(retained, 'logout failure removed the local HQ capability');
      await page.getByText(`본부 로그인됨 · ${fixture.session.operatorActorLabel}`, { exact: true }).waitFor();
      assert(mutationBodies.workshop_hq_logout_v2.length === 1, 'logout RPC request count was not one');
      return {
        requestCount: 1,
        response: { httpStatus: 503, code: scenario.syntheticTransportErrorCode },
        localCapabilityRetained: true,
        visibleRetryGuidance: true,
      };
    });

    await check('deny-by-default-network', 'Supabase HTTP와 WebSocket을 deny-by-default로 격리해 운영 DB mutation 0을 유지한다', async () => {
      const webSocketAttemptCount = await page.evaluate(() => window.__hqRehearsalWebSocketAttempts?.length ?? 0);
      observedWebSocketAttemptCount = webSocketAttemptCount;
      assert(network.forwardedSupabaseHttpRequestCount === 0, 'a Supabase HTTP request was forwarded');
      assert(network.blockedUnexpectedSupabaseHttpRequestCount === 0, 'an unexpected Supabase request was attempted');
      assert(network.contractViolations.length === 0, 'a fixture RPC request violated its exact contract');
      assert(webSocketAttemptCount === 0, 'the HQ route attempted a WebSocket connection');
      assert(pageErrors.length === 0, `page errors were observed: ${pageErrors.join(' | ')}`);
      return {
        interceptedSupabaseHttpRequestCount: network.supabaseHttpRequestCount,
        forwardedSupabaseHttpRequestCount: 0,
        blockedUnexpectedSupabaseHttpRequestCount: 0,
        fixtureMutationRequestCount: network.fixtureMutationRequestCount,
        productionDatabaseMutationCount: 0,
        webSocketAttemptCount,
        actualWebSocketConnectionCount: 0,
      };
    });
  } catch (error) {
    const message = safeMessage(error, sensitiveValues);
    findings.push(`browser-rehearsal-fatal: ${message}`);
    checks.push({ id: 'browser-rehearsal-fatal', label: '브라우저 리허설 실행', status: 'fail', observed: message });
  } finally {
    if (page && !page.isClosed()) {
      observedWebSocketAttemptCount = await page
        .evaluate(() => window.__hqRehearsalWebSocketAttempts?.length ?? 0)
        .catch(() => observedWebSocketAttemptCount);
    }
    if (context) await context.close();
    if (browser) await browser.close();
  }

  const webSocketAttemptCount = observedWebSocketAttemptCount;
  const failed = checks.filter((entry) => entry.status === 'fail').length;
  const passed = checks.length - failed;
  const source = sourceState();
  const categoryBodies = mutationBodies.hq_submission_category_assign_v3;
  const kindBodies = mutationBodies.hq_submission_kind_assign_v3;
  const report = {
    schemaVersion: 1,
    rehearsalId: '0912-13-hq-v3-browser-rehearsal',
    generatedAt: new Date().toISOString(),
    elapsedMs: Date.now() - startedAt,
    ...source,
    status: failed === 0 && passed > 0 ? 'pass' : 'fail',
    target: { baseUrl: options.baseUrl, route: '/hq?ops=1' },
    fixture: displayPath(fixturePath),
    fixtureSha256,
    fixtureIdentity: {
      schemaVersion: fixture.schemaVersion,
      fixtureId: fixture.fixtureId,
      classification: fixture.classification,
    },
    evidenceBoundary: {
      evidenceClass: 'ui-fixture-only',
      databaseAuthorizationOrLifecycleEvidence: false,
      canonicalDatabaseVerifier: fixture.evidence.canonicalDatabaseVerifier,
      statement: '브라우저 합성 fixture는 요청 형식과 사용자에게 보이는 복구 흐름만 검증하며 DB 권한, 동시성 또는 수명주기의 증거가 아닙니다.',
    },
    summary: { checkCount: checks.length, passCount: passed, failCount: failed },
    safety: {
      allSupabaseHttpIntercepted: network.forwardedSupabaseHttpRequestCount === 0,
      interceptedSupabaseHttpRequestCount: network.supabaseHttpRequestCount,
      forwardedSupabaseHttpRequestCount: network.forwardedSupabaseHttpRequestCount,
      blockedUnexpectedSupabaseHttpRequestCount: network.blockedUnexpectedSupabaseHttpRequestCount,
      blockedUnexpectedSupabaseRpcNames: [...network.blockedUnexpectedSupabaseRpcNames].sort(),
      blockedExternalHttpRequestCount: network.blockedExternalHttpRequestCount,
      fixtureReadRequestCount: network.fixtureReadRequestCount,
      fixtureMutationRequestCount: network.fixtureMutationRequestCount,
      productionDatabaseMutationCount: 0,
      contractViolationCount: network.contractViolations.length,
      contractViolations: network.contractViolations,
      webSocket: { stubbed: true, attemptCount: webSocketAttemptCount, actualConnectionCount: 0 },
      screenshotsWritten: 0,
      runtimeCapabilityMaterialDetectedBeforeWrite: null,
      runtimeCapabilityMaterialInWrittenReport: null,
    },
    namedHqSession: {
      injected: checks.some((entry) => entry.id === 'named-hq-session' && entry.status === 'pass'),
      actorLabel: fixture.session.operatorActorLabel,
      capabilitySource: 'runtime-generated',
      capabilityPersistedAfterLogoutFailure: checks.some((entry) => entry.id === 'logout-failure-retains-capability' && entry.status === 'pass'),
    },
    rpcContracts: fixture.rpcContracts,
    observations: {
      rpcCallCounts: Object.fromEntries([...calls.entries()].sort(([left], [right]) => left.localeCompare(right))),
      categoryRetry: categoryBodies.length >= 2 ? {
        exactRequestRetried: sameValue(requestFingerprintWithoutCapability(categoryBodies[0]), requestFingerprintWithoutCapability(categoryBodies[1])),
        stableIdempotencyKey: categoryBodies[0].p_idempotency_key === categoryBodies[1].p_idempotency_key,
        stableExpectedEventId: categoryBodies[0].p_expected_event_id === categoryBodies[1].p_expected_event_id,
        stableExpectedSubmissionUpdatedAt: categoryBodies[0].p_expected_submission_updated_at === categoryBodies[1].p_expected_submission_updated_at,
      } : null,
      kindRetry: kindBodies.length >= 2 ? {
        exactRequestRetried: sameValue(requestFingerprintWithoutCapability(kindBodies[0]), requestFingerprintWithoutCapability(kindBodies[1])),
        stableIdempotencyKey: kindBodies[0].p_idempotency_key === kindBodies[1].p_idempotency_key,
        stableExpectedEventId: kindBodies[0].p_expected_event_id === kindBodies[1].p_expected_event_id,
        stableExpectedSubmissionUpdatedAt: kindBodies[0].p_expected_submission_updated_at === kindBodies[1].p_expected_submission_updated_at,
      } : null,
      staleConflictReloaded: checks.some((entry) => entry.id === 'stale-conflict-recovery' && entry.status === 'pass'),
      exactSetClearConflictPreservedRows: checks.some((entry) => entry.id === 'clear-exact-set-conflict' && entry.status === 'pass'),
      logoutFailurePreservedCapability: checks.some((entry) => entry.id === 'logout-failure-retains-capability' && entry.status === 'pass'),
    },
    checks,
    findings,
  };

  let reportText = JSON.stringify(report, null, 2);
  const runtimeCapabilityMaterialDetectedBeforeWrite = sensitiveValues.some((value) => reportText.includes(value));
  report.safety.runtimeCapabilityMaterialDetectedBeforeWrite = runtimeCapabilityMaterialDetectedBeforeWrite;
  if (runtimeCapabilityMaterialDetectedBeforeWrite) {
    report.status = 'fail';
    report.summary.failCount += 1;
    report.summary.checkCount += 1;
    report.checks.push({
      id: 'capability-evidence-leak',
      label: '보고서 권한값 비노출',
      status: 'fail',
      observed: 'runtime capability material was redacted before writing',
    });
  }
  report.safety.runtimeCapabilityMaterialInWrittenReport = false;
  reportText = JSON.stringify(report, null, 2);
  for (const value of sensitiveValues) reportText = reportText.replaceAll(value, '[redacted-runtime-capability]');
  assert(!sensitiveValues.some((value) => reportText.includes(value)), 'runtime capability remained in the report after redaction');
  mkdirSync(dirname(options.reportPath), { recursive: true });
  writeFileSync(options.reportPath, `${reportText}\n`, 'utf8');
  console.log(`\n  ${report.summary.passCount} PASS · ${report.summary.failCount} FAIL (${report.summary.passCount}/${report.summary.checkCount})`);
  console.log(`  JSON evidence: ${displayPath(options.reportPath)}`);
  console.log('  Production DB mutations: 0 · screenshots: 0\n');
  return report.status === 'pass' ? 0 : 1;
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseHqRehearsalCli(argv);
  const { fixture, sha256 } = loadValidatedFixture(options.fixturePath);
  if (options.validateFixtureOnly) {
    const report = fixtureValidationReport(fixture, options.fixturePath, sha256);
    if (options.reportWasExplicit) {
      mkdirSync(dirname(options.reportPath), { recursive: true });
      writeFileSync(options.reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    }
    console.log(JSON.stringify(report));
    return 0;
  }
  return runBrowserRehearsal(options, fixture, options.fixturePath, sha256);
}

const isDirectExecution = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href === import.meta.url
  : false;
if (isDirectExecution) {
  main().then((code) => {
    process.exitCode = code;
  }).catch((error) => {
    console.error(`FAIL: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
