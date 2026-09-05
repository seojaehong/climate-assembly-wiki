/**
 * 9.12 현장 리허설 드라이런 — **A·B 기능을 이어 붙인 단일 흐름**.
 *
 *   (터미널 1) npm.cmd exec -- astro preview --port 4331     ← 프로덕션 빌드
 *   (터미널 2) node scripts/verify-field-rehearsal.mjs --base http://localhost:4331
 *
 * 왜 또 하나 만드는가
 *   지금까지의 검증은 전부 **기능별 조각**이다 — 초안 보관(US-003), 재전송 큐(US-005),
 *   저장 배지(US-006), 마감 배너(US-010), 내려받기. 조각마다 매번 새 탭·새 컨텍스트로
 *   시작하므로 **앞 단계가 남긴 상태 위에서 다음 단계가 도는 경우는 한 번도 안 쟀다.**
 *   9.12 경주에서 조가 겪는 것은 조각이 아니라 한 줄기다 —
 *   치고 → 끊기고 → 저장 눌러 실패하고 → 탭이 죽고 → 다시 열고 → 연결이 돌아오고 →
 *   마감이 다가오고 → 받아 간다. 이 스크립트는 그 한 줄기를 **한 페이지에서** 재현한다.
 *
 * ★ 라우트를 왜 /mod 로 하는가 (지시와 다른 점 · 이 스크립트가 찾은 결함 #1)
 *   과업 지시는 픽스처 라우트(`/ko/moderator/insights/submission-panel-lab`)였다.
 *   그런데 **그 라우트에는 마감 배너가 아예 없다** — `DeadlineBanner` 는 `ModConsole.tsx`
 *   에서만 마운트되고, 픽스처 라우트는 `SubmissionPanel` 만 띄운다. 배너가 픽스처용으로
 *   받아 두는 `fixtureTopics` prop 은 **부르는 곳이 하나도 없는 죽은 인자**다(실측).
 *   게다가 그 라우트는 SSG 라 `deadline_at` 을 넣어도 **빌드 시각에 굳어** 구간 전환을
 *   잴 수 없다. 그래서 6단계(마감 임박)를 픽스처 라우트에서는 잴 방법이 없다.
 *   `verify-deadline-banner.mjs` 가 같은 이유로 이미 `/mod` 를 쓴다 — 그 선례를 따른다.
 *
 * 운영 DB 무접촉
 *   `**\/rest/v1/**` 을 **전부 가로챈다.** 통과시키는 경로가 하나도 없다.
 *   최초 `mod_exchange_join_code`부터 토큰 전용 v2/v3 RPC까지 지어낸 응답으로 답하고,
 *   구형 join-code RPC는 실패시키며 rest/v1 밖(auth·realtime)으로 새는 길도 막아
 *   마지막에 「새어 나간 요청 0건」을 증명한다.
 *
 * ★ 가로챈 서버는 **상태를 가진다.** `submission_save` 가 받은 items 를 그대로 담아 두고
 *   `submission_get` 이 그것을 돌려준다. 그래야 마지막 내려받기가 「내가 친 글이 실제로
 *   서버에 올라갔는가」를 재게 된다 — 빈 응답만 주면 ZIP 이 비어도 통과한다.
 */
import { createHash, randomBytes } from 'node:crypto';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, statSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { inflateRawSync } from 'node:zlib';
import { chromium } from '../automation/node_modules/playwright/index.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(HERE, '..');
const SHOTS = resolve(HERE, '../.tmp-verify');
const OUT = resolve(HERE, '../.tmp-verify/downloads');
const argv = process.argv.slice(2);
const valueOptions = new Set(['--base', '--code', '--fixture', '--report']);
const flagOptions = new Set(['--headed', '--validate-fixture-only']);
const cliOptions = {};
for (let index = 0; index < argv.length; index += 1) {
  const name = argv[index];
  if (flagOptions.has(name)) {
    if (Object.hasOwn(cliOptions, name)) throw new Error(`Duplicate option: ${name}`);
    cliOptions[name] = true;
    continue;
  }
  if (!valueOptions.has(name)) throw new Error(`Unsupported option: ${String(name)}`);
  if (Object.hasOwn(cliOptions, name)) throw new Error(`Duplicate option: ${name}`);
  const value = argv[index + 1];
  if (typeof value !== 'string' || value.trim() === '' || value.startsWith('--')) {
    throw new Error(`${name} requires a value`);
  }
  cliOptions[name] = value;
  index += 1;
}
const BASE = cliOptions['--base'] ?? 'http://localhost:4331';
const BASE_ORIGIN = new URL(BASE).origin;
const CODE = cliOptions['--code'] ?? '734821';
const TEAM_TOKEN = randomBytes(32).toString('hex');
const URL_MOD = `${BASE}/mod?code=${CODE}`;
const HEADED = cliOptions['--headed'] === true;
const REPORT = resolve(cliOptions['--report'] ?? resolve(HERE, '../evaluation/0912-13-field-rehearsal.json'));

const DEFAULT_FIXTURE_PATH = resolve(PROJECT_ROOT, 'automation/fixtures/0912-rehearsal.json');
const FIXTURE_PATH = resolve(cliOptions['--fixture'] ?? DEFAULT_FIXTURE_PATH);
const FIXTURE_TEXT = readFileSync(FIXTURE_PATH, 'utf8');
const FIXTURE_SHA256 = createHash('sha256').update(FIXTURE_TEXT, 'utf8').digest('hex');

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const fixtureAssert = (condition, message) => {
  if (!condition) throw new Error(`Invalid field rehearsal fixture: ${message}`);
};
const requiredString = (value, path) => {
  fixtureAssert(typeof value === 'string' && value.trim().length > 0, `${path} must be a non-empty string`);
  return value;
};
const uniqueStrings = (value, path) => {
  fixtureAssert(Array.isArray(value) && value.length > 0, `${path} must be a non-empty array`);
  const strings = value.map((entry, index) => requiredString(entry, `${path}[${index}]`));
  fixtureAssert(new Set(strings).size === strings.length, `${path} must not contain duplicates`);
  return strings;
};
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RPC_NAME_PATTERN = /^[a-z][a-z0-9_]*$/;
const ISO_INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

const validateUuid = (value, path) => {
  const uuid = requiredString(value, path);
  fixtureAssert(UUID_PATTERN.test(uuid), `${path} must be a UUID`);
  return uuid;
};
const validateInstant = (value, path) => {
  const instant = requiredString(value, path);
  fixtureAssert(ISO_INSTANT_PATTERN.test(instant) && Number.isFinite(Date.parse(instant)), `${path} must be a UTC ISO instant`);
  return instant;
};

const ALLOWED_RPC_RESPONSES = new Set([
  'join-exchange',
  'session-resume',
  'topic-list',
  'submission-get',
  'submission-save',
  'empty-list',
  'ballot-results',
  'status-object',
  'scalar',
]);
const READ_RPC_RESPONSES = new Set(['session-resume', 'topic-list', 'submission-get', 'empty-list', 'ballot-results']);
const MUTATION_RPC_RESPONSES = new Set(['join-exchange', 'submission-save', 'status-object', 'scalar']);

function validateFieldRehearsalFixture(fixture) {
  fixtureAssert(isRecord(fixture), 'root must be an object');
  fixtureAssert(fixture.schemaVersion === 1, 'schemaVersion must equal 1');
  requiredString(fixture.fixtureId, 'fixtureId');
  fixtureAssert(fixture.classification === 'synthetic-no-pii-no-secrets', 'classification must be synthetic-no-pii-no-secrets');
  fixtureAssert(isRecord(fixture.authorization), 'authorization must be an object');
  fixtureAssert(fixture.authorization.capabilityValuesStoredInFixture === false,
    'authorization.capabilityValuesStoredInFixture must be false');
  fixtureAssert(Number.isSafeInteger(fixture.authorization.maxActiveDevicesPerTeam)
    && fixture.authorization.maxActiveDevicesPerTeam >= 1,
  'authorization.maxActiveDevicesPerTeam must be a positive integer');
  const tokenExpiresAt = validateInstant(fixture.authorization.tokenExpiresAt, 'authorization.tokenExpiresAt');

  fixtureAssert(isRecord(fixture.session), 'session must be an object');
  validateUuid(fixture.session.id, 'session.id');
  requiredString(fixture.session.slug, 'session.slug');
  requiredString(fixture.session.title, 'session.title');
  const startsAt = validateInstant(fixture.session.startsAt, 'session.startsAt');
  const endsAt = validateInstant(fixture.session.endsAt, 'session.endsAt');
  const graceEndsAt = validateInstant(fixture.session.graceEndsAt, 'session.graceEndsAt');
  fixtureAssert(Date.parse(startsAt) < Date.parse(endsAt), 'session.startsAt must precede session.endsAt');
  fixtureAssert(Date.parse(endsAt) <= Date.parse(graceEndsAt), 'session.endsAt must not follow session.graceEndsAt');
  fixtureAssert(tokenExpiresAt === graceEndsAt,
    'authorization.tokenExpiresAt must equal session.graceEndsAt for the rehearsal session');

  fixtureAssert(isRecord(fixture.team), 'team must be an object');
  validateUuid(fixture.team.id, 'team.id');
  requiredString(fixture.team.name, 'team.name');
  requiredString(fixture.team.tableNo, 'team.tableNo');
  fixtureAssert(fixture.team.subgroup === null || typeof fixture.team.subgroup === 'string',
    'team.subgroup must be a string or null');
  fixtureAssert(Number.isSafeInteger(fixture.team.capacity) && fixture.team.capacity > 0,
    'team.capacity must be a positive integer');

  fixtureAssert(Array.isArray(fixture.devices)
    && fixture.devices.length >= fixture.authorization.maxActiveDevicesPerTeam,
  'devices must cover maxActiveDevicesPerTeam');
  const deviceIds = fixture.devices.map((device, index) => {
    fixtureAssert(isRecord(device), `devices[${index}] must be an object`);
    requiredString(device.label, `devices[${index}].label`);
    return validateUuid(device.id, `devices[${index}].id`);
  });
  fixtureAssert(new Set(deviceIds).size === deviceIds.length, 'device IDs must be unique');

  fixtureAssert(Array.isArray(fixture.topics) && fixture.topics.length >= 2, 'topics must contain at least two entries');
  const topicIds = new Set();
  const topicOrdinals = new Set();
  for (const [index, topic] of fixture.topics.entries()) {
    fixtureAssert(isRecord(topic), `topics[${index}] must be an object`);
    const topicId = validateUuid(topic.id, `topics[${index}].id`);
    fixtureAssert(!topicIds.has(topicId), 'topic IDs must be unique');
    topicIds.add(topicId);
    fixtureAssert(Number.isSafeInteger(topic.ordinal) && topic.ordinal > 0, `topics[${index}].ordinal must be a positive integer`);
    fixtureAssert(!topicOrdinals.has(topic.ordinal), 'topic ordinals must be unique');
    topicOrdinals.add(topic.ordinal);
    requiredString(topic.block, `topics[${index}].block`);
    requiredString(topic.prompt, `topics[${index}].prompt`);
    fixtureAssert(topic.guidance === null || typeof topic.guidance === 'string', `topics[${index}].guidance must be a string or null`);
    fixtureAssert(['draft', 'open', 'closed'].includes(topic.status), `topics[${index}].status is unsupported`);
    if (topic.deadlineAt !== null) validateInstant(topic.deadlineAt, `topics[${index}].deadlineAt`);
  }
  const orderedOrdinals = [...topicOrdinals].sort((left, right) => left - right);
  fixtureAssert(orderedOrdinals.every((ordinal, index) => ordinal === index + 1), 'topic ordinals must be contiguous from 1');

  const expectedRpcContracts = uniqueStrings(fixture.expectedRpcContracts, 'expectedRpcContracts');
  fixtureAssert(expectedRpcContracts.every((rpc) => RPC_NAME_PATTERN.test(rpc)), 'expectedRpcContracts contains an invalid RPC name');
  const expectedRpcSet = new Set(expectedRpcContracts);
  fixtureAssert(isRecord(fixture.fieldRehearsal), 'fieldRehearsal must be an object');
  const field = fixture.fieldRehearsal;
  const supabaseOrigin = requiredString(field.supabaseOrigin, 'fieldRehearsal.supabaseOrigin');
  let parsedSupabaseOrigin;
  try {
    parsedSupabaseOrigin = new URL(supabaseOrigin);
  } catch {
    fixtureAssert(false, 'fieldRehearsal.supabaseOrigin must be a valid URL');
  }
  fixtureAssert(parsedSupabaseOrigin.protocol === 'https:'
    && parsedSupabaseOrigin.origin === supabaseOrigin
    && parsedSupabaseOrigin.pathname === '/',
  'fieldRehearsal.supabaseOrigin must be an exact HTTPS origin');
  fixtureAssert(isRecord(field.rpcBehaviors) && Object.keys(field.rpcBehaviors).length > 0,
    'fieldRehearsal.rpcBehaviors must be a non-empty object');
  for (const [rpc, behavior] of Object.entries(field.rpcBehaviors)) {
    fixtureAssert(RPC_NAME_PATTERN.test(rpc), `fieldRehearsal.rpcBehaviors has invalid RPC name ${rpc}`);
    fixtureAssert(expectedRpcSet.has(rpc), `field RPC ${rpc} is absent from expectedRpcContracts`);
    fixtureAssert(isRecord(behavior), `fieldRehearsal.rpcBehaviors.${rpc} must be an object`);
    fixtureAssert(['read', 'mutation'].includes(behavior.effect), `${rpc}.effect must be read or mutation`);
    fixtureAssert(ALLOWED_RPC_RESPONSES.has(behavior.response), `${rpc}.response is unsupported`);
    fixtureAssert((behavior.effect === 'read' ? READ_RPC_RESPONSES : MUTATION_RPC_RESPONSES).has(behavior.response),
      `${rpc}.response is incompatible with its effect`);
    fixtureAssert(typeof behavior.requiresTeamToken === 'boolean', `${rpc}.requiresTeamToken must be boolean`);
    fixtureAssert(typeof behavior.requiresIdempotencyKey === 'boolean', `${rpc}.requiresIdempotencyKey must be boolean`);
    fixtureAssert(rpc === 'mod_exchange_join_code' || behavior.requiresTeamToken === true,
      `${rpc} must require a team token`);
    if (behavior.status !== undefined) requiredString(behavior.status, `${rpc}.status`);
    if (behavior.statusFromArgument !== undefined) requiredString(behavior.statusFromArgument, `${rpc}.statusFromArgument`);
    if (behavior.response === 'status-object') {
      fixtureAssert((typeof behavior.status === 'string') !== (typeof behavior.statusFromArgument === 'string'),
        `${rpc} status-object must define exactly one of status or statusFromArgument`);
    }
    if (behavior.response === 'scalar' || behavior.response === 'ballot-results') {
      fixtureAssert(Object.hasOwn(behavior, 'responseBody'), `${rpc}.responseBody is required`);
    }
  }
  const legacyRejectedRpcNames = uniqueStrings(field.legacyRejectedRpcNames, 'fieldRehearsal.legacyRejectedRpcNames');
  fixtureAssert(legacyRejectedRpcNames.every((rpc) => RPC_NAME_PATTERN.test(rpc)),
    'fieldRehearsal.legacyRejectedRpcNames contains an invalid RPC name');
  fixtureAssert(legacyRejectedRpcNames.every((rpc) => !Object.hasOwn(field.rpcBehaviors, rpc)),
    'legacy rejected RPCs must not also be allowed');
  fixtureAssert(legacyRejectedRpcNames.every((rpc) => !expectedRpcSet.has(rpc)),
    'legacy rejected RPCs must not appear in expectedRpcContracts');
  for (const requiredLegacyRpc of ['mod_join', 'topic_list', 'submission_save', 'submission_get']) {
    fixtureAssert(legacyRejectedRpcNames.includes(requiredLegacyRpc), `required legacy rejection ${requiredLegacyRpc} is missing`);
  }

  const requiredRpcBehavior = (rpc, effect, response, requiresTeamToken) => {
    const behavior = field.rpcBehaviors[rpc];
    fixtureAssert(isRecord(behavior), `required field RPC ${rpc} is missing`);
    fixtureAssert(behavior.effect === effect && behavior.response === response
      && behavior.requiresTeamToken === requiresTeamToken,
    `required field RPC ${rpc} has the wrong fixture effect or response behavior`);
  };
  requiredRpcBehavior('mod_exchange_join_code', 'mutation', 'join-exchange', false);
  requiredRpcBehavior('mod_session_get', 'read', 'session-resume', true);
  requiredRpcBehavior('topic_list_v2', 'read', 'topic-list', true);
  requiredRpcBehavior('submission_get_v2', 'read', 'submission-get', true);
  requiredRpcBehavior('submission_save_v3', 'mutation', 'submission-save', true);
  fixtureAssert(field.rpcBehaviors.submission_save_v3.requiresIdempotencyKey === true,
    'submission_save_v3 must require an idempotency key');

  fixtureAssert(isRecord(field.flow), 'fieldRehearsal.flow must be an object');
  const flow = field.flow;
  fixtureAssert(Number.isSafeInteger(flow.initialVisibleTopicOrdinal), 'flow.initialVisibleTopicOrdinal must be an integer');
  fixtureAssert(Number.isSafeInteger(flow.nextVisibleTopicOrdinal), 'flow.nextVisibleTopicOrdinal must be an integer');
  fixtureAssert(flow.initialVisibleTopicOrdinal !== flow.nextVisibleTopicOrdinal,
    'initial and next topic ordinals must differ');
  fixtureAssert(topicOrdinals.has(flow.initialVisibleTopicOrdinal), 'initial topic ordinal is absent from topics');
  fixtureAssert(topicOrdinals.has(flow.nextVisibleTopicOrdinal), 'next topic ordinal is absent from topics');
  fixtureAssert(fixture.topics.find((topic) => topic.ordinal === flow.initialVisibleTopicOrdinal)?.status === 'open',
    'initial visible topic must be open');
  fixtureAssert(fixture.topics.find((topic) => topic.ordinal === flow.nextVisibleTopicOrdinal)?.status === 'draft',
    'next visible topic must begin as draft');
  for (const key of ['initialDeadlineOffsetMinutes', 'warningDeadlineOffsetMinutes']) {
    fixtureAssert(Number.isSafeInteger(flow[key]) && flow[key] > 0, `flow.${key} must be a positive integer`);
  }
  fixtureAssert(flow.warningDeadlineOffsetMinutes < flow.initialDeadlineOffsetMinutes,
    'warning deadline offset must be less than the initial offset');
  fixtureAssert(flow.initialDeadlineOffsetMinutes > 5,
    'initial deadline offset must begin outside the five-minute notice window');
  fixtureAssert(flow.warningDeadlineOffsetMinutes <= 3,
    'warning deadline offset must be inside the three-minute warning window');
  const pastedLines = uniqueStrings(flow.pastedLines, 'fieldRehearsal.flow.pastedLines');
  fixtureAssert(pastedLines[0].includes('{{timestamp}}'), 'the first pasted line must contain {{timestamp}}');
  requiredString(flow.offlineLine, 'fieldRehearsal.flow.offlineLine');
  requiredString(flow.deadlineLine, 'fieldRehearsal.flow.deadlineLine');

  const serialized = JSON.stringify(fixture);
  fixtureAssert(!/@|010[- ]?\d{3,4}[- ]?\d{4}/.test(serialized), 'fixture must not contain email or phone-like personal data');
  return fixture;
}

let FIXTURE;
try {
  FIXTURE = validateFieldRehearsalFixture(JSON.parse(FIXTURE_TEXT));
} catch (error) {
  if (error instanceof SyntaxError) {
    throw new Error(`Invalid field rehearsal fixture JSON at ${FIXTURE_PATH}: ${error.message}`);
  }
  throw error;
}

const FIELD_CONFIG = FIXTURE.fieldRehearsal;
const FLOW = FIELD_CONFIG.flow;
const FIXTURE_SUPABASE_ORIGIN = FIELD_CONFIG.supabaseOrigin;
const fixtureRelative = relative(PROJECT_ROOT, FIXTURE_PATH);
const FIXTURE_DISPLAY_PATH = fixtureRelative.startsWith('..') || isAbsolute(fixtureRelative)
  ? FIXTURE_PATH.replaceAll('\\', '/')
  : fixtureRelative.replaceAll('\\', '/');
const rpcBehaviorEntries = Object.entries(FIELD_CONFIG.rpcBehaviors);
const observedFixtureConfiguration = () => ({
  fixtureId: FIXTURE.fixtureId,
  session: {
    id: FIXTURE.session.id,
    slug: FIXTURE.session.slug,
    title: FIXTURE.session.title,
  },
  team: {
    id: FIXTURE.team.id,
    name: FIXTURE.team.name,
    tableNo: FIXTURE.team.tableNo,
  },
  topics: [...FIXTURE.topics]
    .sort((left, right) => left.ordinal - right.ordinal)
    .map(({ id, ordinal, prompt, status }) => ({ id, ordinal, prompt, status })),
  rpcAllowlist: {
    read: rpcBehaviorEntries.filter(([, behavior]) => behavior.effect === 'read').map(([rpc]) => rpc),
    mutation: rpcBehaviorEntries.filter(([, behavior]) => behavior.effect === 'mutation').map(([rpc]) => rpc),
    legacyRejected: [...FIELD_CONFIG.legacyRejectedRpcNames],
  },
  flow: {
    initialVisibleTopicOrdinal: FLOW.initialVisibleTopicOrdinal,
    nextVisibleTopicOrdinal: FLOW.nextVisibleTopicOrdinal,
    initialDeadlineOffsetMinutes: FLOW.initialDeadlineOffsetMinutes,
    warningDeadlineOffsetMinutes: FLOW.warningDeadlineOffsetMinutes,
  },
});

if (cliOptions['--validate-fixture-only'] === true) {
  const validationReport = {
    schemaVersion: 1,
    rehearsalId: '0912-13-field-rehearsal-fixture-validation',
    generatedAt: new Date().toISOString(),
    validationOnly: true,
    fixture: FIXTURE_DISPLAY_PATH,
    fixtureSha256: FIXTURE_SHA256,
    fixtureIdentity: {
      schemaVersion: FIXTURE.schemaVersion,
      fixtureId: FIXTURE.fixtureId,
      classification: FIXTURE.classification,
    },
    observedConfiguration: observedFixtureConfiguration(),
    status: 'fixture_valid',
    summary: { checkCount: 1, passCount: 1, failCount: 0 },
    checks: [{
      id: 'fixture-schema-and-semantics',
      status: 'pass',
      observed: `sha256:${FIXTURE_SHA256}`,
    }],
  };
  if (Object.hasOwn(cliOptions, '--report')) {
    mkdirSync(dirname(REPORT), { recursive: true });
    writeFileSync(REPORT, `${JSON.stringify(validationReport, null, 2)}\n`, 'utf8');
  }
  console.log(JSON.stringify(validationReport));
  process.exit(0);
}

const initialTopicFixture = FIXTURE.topics.find((topic) => topic.ordinal === FLOW.initialVisibleTopicOrdinal);
const nextTopicFixture = FIXTURE.topics.find((topic) => topic.ordinal === FLOW.nextVisibleTopicOrdinal);
const TOPIC1 = initialTopicFixture.id;
const TOPIC2 = nextTopicFixture.id;
const TEAM_ID = FIXTURE.team.id;
const DRAFT1 = `climate_vote_draft:${TEAM_ID}:${TOPIC1}`;
const QUEUE1 = `climate_vote_queue:${TEAM_ID}:${TOPIC1}`;
const SESSION_KEY = 'climate_vote_mod_session_v1';
const DEVICE_KEY = 'climate_vote_mod_device_id';

/** 서버가 처음 들고 있는 updated_at. 초안 봉투·큐의 baseUpdatedAt 이 이 값을 딛는다. */
const T0 = FIXTURE.session.startsAt;

const STAMP = new Date().toISOString().slice(11, 19);
/** ① 붙여넣기로 한 번에 들어가는 줄 — 조가 실제로 하는 동작이다(8.29 실측 93%). */
const PASTED = FLOW.pastedLines.map((line) => line.replace('{{timestamp}}', STAMP));
/** ② 연결이 끊긴 뒤에 더 친 줄. 이것이 사라지면 8.29 사고 그대로다. */
const OFFLINE_LINE = FLOW.offlineLine;
/** ③ 마감이 임박한 시점의 미저장 줄. 배너에 저장 안내를 띄우는 근거다. */
const DEADLINE_LINE = FLOW.deadlineLine;
const SAVED_LINES = [...PASTED, OFFLINE_LINE]; // 서버까지 올라가야 하는 것
const ALL_LINES = [...SAVED_LINES, DEADLINE_LINE]; // 화면에 끝까지 남아야 하는 것

let pass = 0;
let fail = 0;
const findings = [];
const checks = [];
const startedAt = new Date();
/** 단계 하나 = 한 줄. **무엇을 기대했고 무엇을 봤는지**를 그 한 줄에 함께 적는다. */
const step = async (n, title, expected, fn) => {
  try {
    const seen = await fn();
    pass += 1;
    checks.push({ id: String(n), title, status: 'pass', expected, observed: seen });
    console.log(`  PASS  [${n}] ${title} — 기대: ${expected} / 본 것: ${seen}`);
  } catch (e) {
    fail += 1;
    const observed = String(e.message).split('\n')[0];
    checks.push({ id: String(n), title, status: 'fail', expected, observed });
    console.log(`  FAIL  [${n}] ${title} — 기대: ${expected} / 본 것: ${observed}`);
  }
};
const must = (c, m) => {
  if (!c) throw new Error(m);
};

// ── 가로챈 서버 ─────────────────────────────────────────────────────────
const MIN = 60_000;
/**
 * 가로챈 서버가 들고 있는 꼭지. `deadlineAt` 은 **절대 시각**이다.
 *
 * ★ 여기가 함정이었다(실측). 마감을 「지금부터 4분 뒤」로 두고 응답을 만들 때마다
 *   다시 계산하면, 배너가 30초마다 새로 읽을 때마다 마감이 4분 뒤로 **밀린다** —
 *   잔여가 04:00 → 03:40 → 04:00 을 오가며 영영 warn 에 닿지 않는다. 화면은 멀쩡한데
 *   픽스처가 시간을 되감고 있었다. 마감시각은 정할 때 한 번만 굳힌다.
 */
const server = { topics: [], saveMode: 'ok' };
/** 지금부터 `ms` 뒤의 절대 시각. 마감을 정하는 순간에 **한 번만** 부른다. */
const deadlineFromNow = (ms) => new Date(Date.now() + ms).toISOString();
/** 꼭지별 서버 보관분. submission_save 가 쓰고 submission_get 이 읽는다. */
const store = Object.fromEntries(FIXTURE.topics.map((topic) => [
  topic.id,
  { status: null, version: 0, updated_at: null, items: [] },
]));
let saveSeq = 0;
let issuedDeviceId = FIXTURE.devices[0].id;
let issuedDeviceLabel = FIXTURE.devices[0].label;
let exchangeUrlRedacted = false;
const tokenContractViolations = [];
const saveRequests = [];
const inspectedDraftQueuePayloads = new Map();
const escapedExternalOrigins = new Set();
const unexpectedRpcNames = new Set();
let draftQueueCapabilityLeakCount = null;
let workshopSessionPersisted = false;
let webSocketStubConnectionAttemptCount = 0;
let webSocketRouteConnectionAttemptCount = 0;
let blockedExternalWebSocketAttemptCount = 0;
const blockedExternalWebSocketOrigins = new Set();
let webSocketEvidence = {
  stubbed: false,
  stubConnectionAttemptCount: 0,
  actualNetworkConnectionCount: 0,
  blockedExternalConnectionAttemptCount: 0,
  blockedExternalOrigins: [],
};
const calls = {
  code_exchange: 0,
  session_resume: 0,
  topic_list: 0,
  submission_get: 0,
  submission_save: 0,
  legacy_rpc: 0,
  other: 0,
  escaped: 0,
  unexpected_rpc: 0,
  fixture_mutation: 0,
  live_database_mutation: 0,
};

const fixtureReadRpcNames = new Set([
  ...rpcBehaviorEntries.filter(([, behavior]) => behavior.effect === 'read').map(([rpc]) => rpc),
]);
const fixtureMutationRpcNames = new Set([
  ...rpcBehaviorEntries.filter(([, behavior]) => behavior.effect === 'mutation').map(([rpc]) => rpc),
]);
const legacyRpcNames = new Set(FIELD_CONFIG.legacyRejectedRpcNames);

const requireTeamToken = (rpc, body) => {
  if (body.p_token === TEAM_TOKEN) return true;
  tokenContractViolations.push(`${rpc}:p_token`);
  return false;
};

const workshopSessionResponse = () => ({
  v: 1,
  accessToken: TEAM_TOKEN,
  expiresAt: FIXTURE.authorization.tokenExpiresAt,
  deviceId: issuedDeviceId,
  deviceLabel: issuedDeviceLabel,
  sessionId: FIXTURE.session.id,
  sessionSlug: FIXTURE.session.slug,
  team: {
    id: TEAM_ID,
    name: FIXTURE.team.name,
    subgroup: FIXTURE.team.subgroup,
    capacity: FIXTURE.team.capacity,
    table_no: FIXTURE.team.tableNo,
  },
});

const isoAt = (msFromNow) => new Date(Date.now() + msFromNow).toISOString();
const topicRows = () => {
  const now = isoAt(0);
  return server.topics.map((t) => ({
    id: t.id,
    ordinal: t.ordinal,
    block: t.block,
    prompt: t.prompt,
    guidance: t.guidance ?? null,
    status: t.status,
    deadline_at: t.deadlineAt ?? null,
    server_now: now,
  }));
};

mkdirSync(SHOTS, { recursive: true });
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ headless: !HEADED });
/**
 * 컨텍스트는 **하나뿐이고 끝까지 산다** — 탭을 닫아도 localStorage 가 살아 있어야
 * 4단계(재접속)가 성립한다. `acceptDownloads` 는 7단계(ZIP)가 쓴다.
 */
const context = await browser.newContext({
  viewport: { width: 1280, height: 1100 },
  acceptDownloads: true,
  serviceWorkers: 'block',
});
await context.routeWebSocket(/.*/, async (webSocketRoute) => {
  const socketOrigin = new URL(webSocketRoute.url()).origin;
  webSocketRouteConnectionAttemptCount += 1;
  if (socketOrigin !== FIXTURE_SUPABASE_ORIGIN) {
    blockedExternalWebSocketAttemptCount += 1;
    blockedExternalWebSocketOrigins.add(socketOrigin);
    calls.escaped += 1;
    escapedExternalOrigins.add(socketOrigin);
  }
  await webSocketRoute.close({ code: 1008, reason: 'Synthetic field rehearsal WebSocket' });
});
await context.exposeBinding('__recordFieldRehearsalWebSocketAttempt', (_source, socketUrl) => {
  webSocketStubConnectionAttemptCount += 1;
  const socketOrigin = new URL(String(socketUrl), BASE).origin;
  if (socketOrigin !== FIXTURE_SUPABASE_ORIGIN) {
    blockedExternalWebSocketAttemptCount += 1;
    blockedExternalWebSocketOrigins.add(socketOrigin);
    calls.escaped += 1;
    escapedExternalOrigins.add(socketOrigin);
  }
});
await context.addInitScript(() => {
  globalThis.__fieldRehearsalWebSocket = {
    stubbed: true,
    actualNetworkConnectionCount: 0,
  };
  class FixtureWebSocket extends EventTarget {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;
    readyState = FixtureWebSocket.CONNECTING;
    bufferedAmount = 0;
    extensions = '';
    protocol = '';
    binaryType = 'blob';
    onopen = null;
    onmessage = null;
    onerror = null;
    onclose = null;

      constructor(url) {
      super();
      this.url = String(url);
        void globalThis.__recordFieldRehearsalWebSocketAttempt?.(this.url);
      queueMicrotask(() => {
        this.readyState = FixtureWebSocket.OPEN;
        const event = new Event('open');
        this.dispatchEvent(event);
        this.onopen?.(event);
      });
    }

    send() {}

    close(code = 1000, reason = '') {
      this.readyState = FixtureWebSocket.CLOSED;
      const event = new CloseEvent('close', { code, reason, wasClean: true });
      this.dispatchEvent(event);
      this.onclose?.(event);
    }
  }
  Object.defineProperty(globalThis, 'WebSocket', { configurable: true, value: FixtureWebSocket });
});

const json = (route, body, status = 200) =>
  route.fulfill({
    status,
    contentType: 'application/json',
    headers: { 'access-control-allow-origin': '*' },
    body: JSON.stringify(body),
  });

await context.route('**/rest/v1/**', async (route) => {
  const url = route.request().url();
  const rpc = new URL(url).pathname.split('/').pop() ?? '';
  let body = {};
  try {
    body = route.request().postDataJSON() ?? {};
  } catch (error) {
    console.error(`[field rehearsal] invalid JSON body for ${rpc}`, error);
    tokenContractViolations.push(`${rpc || 'unknown'}:invalid_json`);
    return json(route, { message: 'invalid synthetic RPC body' }, 400);
  }
  if (legacyRpcNames.has(rpc)) {
    calls.legacy_rpc += 1;
    return json(route, { message: 'legacy RPC is disabled in rehearsal' }, 410);
  }
  const rpcBehavior = FIELD_CONFIG.rpcBehaviors[rpc];
  if (!rpcBehavior) {
    calls.unexpected_rpc += 1;
    unexpectedRpcNames.add(rpc || '(missing RPC name)');
    console.error(`[field rehearsal] unexpected RPC rejected: ${rpc || '(missing RPC name)'}`);
    return json(route, { message: `unexpected synthetic RPC: ${rpc || '(missing RPC name)'}` }, 500);
  }
  if (rpcBehavior.requiresTeamToken && !requireTeamToken(rpc, body)) {
    return json(route, { message: 'team token required' }, 401);
  }
  if (rpcBehavior.requiresIdempotencyKey
      && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
        .test(body.p_idempotency_key ?? '')) {
    tokenContractViolations.push(`${rpc}:p_idempotency_key`);
    return json(route, { message: 'UUID idempotency key required' }, 400);
  }
  if (rpc === 'mod_exchange_join_code') {
    calls.code_exchange += 1;
    calls.fixture_mutation += 1;
    exchangeUrlRedacted = !/[?&](?:code|c)=/i.test(route.request().frame().url());
    if (body.p_join_code !== CODE || !/^\d{6}$/.test(CODE)
        || /^0912(?:0[1-9]|1[0-5])$/.test(CODE)
        || typeof body.p_device_id !== 'string') {
      return json(route, { message: 'invalid synthetic exchange request' }, 400);
    }
    issuedDeviceId = body.p_device_id;
    issuedDeviceLabel = typeof body.p_device_label === 'string' && body.p_device_label.trim().length > 0
      ? body.p_device_label
      : FIXTURE.devices[0].label;
    return json(route, workshopSessionResponse());
  }
  if (rpc === 'mod_session_get') {
    calls.session_resume += 1;
    return json(route, workshopSessionResponse());
  }
  if (rpc === 'topic_list_v2') {
    calls.topic_list += 1;
    return json(route, topicRows());
  }
  if (rpc === 'submission_save_v3') {
    calls.submission_save += 1;
    calls.fixture_mutation += 1;
    saveRequests.push({
      topicId: body.p_topic_id,
      expectedVersion: body.p_expected_version,
      requestId: body.p_idempotency_key,
      force: body.p_force,
    });
    if (server.saveMode === 'abort') return route.abort('internetdisconnected');
    const topicId = body.p_topic_id;
    const items = (body.p_items ?? []).map((it, i) => ({
      ordinal: it.ordinal ?? i + 1,
      kind: it.kind ?? 'core',
      content: it.content,
      rationale: it.rationale ?? null,
    }));
    saveSeq += 1;
    store[topicId] = {
      status: 'draft',
      version: saveSeq,
      // 저장할 때마다 앞으로 나아가는 시각. 큐의 baseUpdatedAt 대조가 실제로 의미를 갖는다.
      updated_at: new Date(Date.parse(T0) + saveSeq * 1000).toISOString(),
      items,
    };
    return json(route, {
      id: 'rehearsal-sub',
      status: 'draft',
      saved: items.length,
      split: 0,
      version: saveSeq,
      updated_at: store[topicId].updated_at,
      items,
    });
  }
  if (rpc === 'submission_get_v2') {
    calls.submission_get += 1;
    const got = store[body.p_topic_id] ?? { status: null, version: 0, items: [] };
    return json(route, got);
  }
  if (fixtureReadRpcNames.has(rpc) || fixtureMutationRpcNames.has(rpc)) {
    calls.other += 1;
    if (fixtureMutationRpcNames.has(rpc)) calls.fixture_mutation += 1;
    if (rpcBehavior.response === 'empty-list') return json(route, []);
    if (rpcBehavior.response === 'ballot-results' || rpcBehavior.response === 'scalar') {
      return json(route, rpcBehavior.responseBody);
    }
    if (rpcBehavior.response === 'status-object') {
      const status = typeof rpcBehavior.statusFromArgument === 'string'
        ? body[rpcBehavior.statusFromArgument]
        : rpcBehavior.status;
      return json(route, { id: `${rpc}-rehearsal`, status });
    }
    throw new Error(`Unhandled validated fixture response behavior: ${rpcBehavior.response}`);
  }
  throw new Error(`Validated field RPC was not classified as read or mutation: ${rpc}`);
});
/**
 * rest/v1 밖(auth·realtime)으로 새는 길도 막는다.
 * ★ Playwright 는 **나중에 등록한 route 를 먼저** 본다. 이 포괄 규칙이 위 규칙을 가려
 *   버리므로 rest/v1 은 `fallback()` 으로 넘긴다(verify-deadline-banner 에서 실측된 함정).
 */
await context.route(`${FIXTURE_SUPABASE_ORIGIN}/**`, async (route) => {
  if (route.request().url().includes('/rest/v1/')) return route.fallback();
  calls.escaped += 1;
  escapedExternalOrigins.add(new URL(route.request().url()).origin);
  return route.abort();
});

/**
 * Catch every other request as the outermost route. Playwright evaluates the
 * latest registered handler first, so approved Supabase fixture traffic falls
 * through to the two handlers above while the preview origin is the only
 * request allowed onto the network. This also catches CSS font imports and
 * future analytics/CDN additions instead of proving only a Supabase subset.
 */
await context.route('**/*', async (route) => {
  const requestUrl = new URL(route.request().url());
  if (requestUrl.origin === BASE_ORIGIN) return route.continue();
  if (requestUrl.origin === FIXTURE_SUPABASE_ORIGIN) {
    return route.fallback();
  }
  calls.escaped += 1;
  escapedExternalOrigins.add(requestUrl.origin);
  return route.abort();
});

// ── 화면 손잡이 ─────────────────────────────────────────────────────────
/** 입력 칸을 가진 구역만이 꼭지다 — 안내·내려받기·개발 툴바까지 세면 안 된다. */
const topicSection = (page, n) =>
  page.locator('section').filter({ has: page.locator('textarea') }).nth(n - 1);
const boxes = (page, n) => topicSection(page, n).locator('textarea');
const badge = (page, n) => topicSection(page, n).locator('[data-save-status]').first();
const badgeState = (page, n) => badge(page, n).getAttribute('data-save-status');
const badgeText = async (page, n) => (await badge(page, n).innerText()).replace(/\s+/g, ' ').trim();
const saveButton = (page, n) => topicSection(page, n).getByRole('button', { name: '저장', exact: true });
const addRowButton = (page, n) => topicSection(page, n).getByRole('button', { name: /한 줄 더/ });
const values = (page, n) => boxes(page, n).evaluateAll((els) => els.map((e) => e.value));
const readKey = (page, key) => page.evaluate((k) => localStorage.getItem(k), key);

const banner = (page) => page.locator('[data-deadline-banner]');
const bannerTier = (page) => banner(page).getAttribute('data-deadline-banner');
const bannerMessage = async (page) => {
  const m = page.locator('[data-deadline-message]');
  return (await m.count()) === 0 ? '' : (await m.innerText()).replace(/\s+/g, ' ').trim();
};

/**
 * 조 콘솔 열기.
 * ★ `networkidle` 을 기다리면 안 된다 — 조 콘솔은 라운드를 계속 폴링해 「조용해지는 순간」이
 *   오지 않는다. 탭 바와 입력 칸이 뜬 것을 신호로 쓴다.
 */
const openMod = async ({ includeJoinCode = false } = {}) => {
  const page = await context.newPage();
  await page.goto(includeJoinCode ? URL_MOD : `${BASE}/mod`, {
    waitUntil: 'domcontentloaded',
    timeout: 60_000,
  });
  await page.waitForSelector('[role="tablist"]', { timeout: 60_000 });
  await page.waitForSelector('textarea', { timeout: 60_000 });
  await page.waitForTimeout(900);
  return page;
};

/**
 * 고정 시간으로 재지 않는다 — 「몇 초 만에 그렇게 됐나」를 세는 편이 사실에 가깝고 재현된다.
 *
 * ★ `describe` 는 **함수**로 받는다. 문자열로 받으면 호출하는 자리에서 미리 계산돼
 *   기다리기 **전**의 화면이 실패 메시지에 박힌다 — 실제로 그 탓에 「120초를 기다려도
 *   calm」이라는 거짓 관찰이 나왔다(진짜 구간은 notice 였다).
 */
const waitUntil = async (page, fn, timeoutMs, describe) => {
  const t0 = Date.now();
  for (;;) {
    if (await fn()) return Math.round((Date.now() - t0) / 100) / 10;
    if (Date.now() - t0 > timeoutMs) {
      const what = typeof describe === 'function' ? await describe() : describe;
      throw new Error(`${timeoutMs / 1000}초를 기다려도 ${what}`);
    }
    await page.waitForTimeout(400);
  }
};

/** 실제 붙여넣기 이벤트. 타이핑이 아니라 clipboard 경로여야 「나눠 담기」가 돈다. */
const paste = (locator, text) =>
  locator.evaluate((el, t) => {
    const dt = new DataTransfer();
    dt.setData('text/plain', t);
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, text);

// ── ZIP 읽기 (verify-team-download.mjs 와 같은 구현) ──────────────────────
const u16 = (b, o) => b[o] | (b[o + 1] << 8);
const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
function unzip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i -= 1)
    if (u32(buf, i) === 0x06054b50) {
      eocd = i;
      break;
    }
  if (eocd < 0) throw new Error('ZIP 이 아니다 — EOCD 서명을 못 찾았다');
  const count = u16(buf, eocd + 10);
  let p = u32(buf, eocd + 16);
  const out = [];
  for (let i = 0; i < count; i += 1) {
    if (u32(buf, p) !== 0x02014b50) throw new Error('중앙 디렉터리 서명이 깨졌다');
    const method = u16(buf, p + 10);
    const compressed = u32(buf, p + 20);
    const nameLen = u16(buf, p + 28);
    const extraLen = u16(buf, p + 30);
    const cmtLen = u16(buf, p + 32);
    const off = u32(buf, p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    const start = off + 30 + u16(buf, off + 26) + u16(buf, off + 28);
    const raw = buf.subarray(start, start + compressed);
    out.push({ name, method, data: method === 8 ? inflateRawSync(raw) : Buffer.from(raw) });
    p += 46 + nameLen + extraLen + cmtLen;
  }
  return out;
}

// ── 리허설 ──────────────────────────────────────────────────────────────
try {
  console.log(`\n9.12 현장 리허설 · ${URL_MOD} · 운영 DB 무접촉(전부 가로챔)`);
  console.log(`  ※ 픽스처 라우트에는 마감 배너가 없어(DeadlineBanner 미마운트) /mod 로 돈다 — 보고 참조\n`);

  // fixture가 정한 여유 구간으로 시작한다. 배너가 1단계부터 흐름 안에 있어야 한다.
  server.topics = [
    {
      ...initialTopicFixture,
      status: 'open',
      deadlineAt: deadlineFromNow(FLOW.initialDeadlineOffsetMinutes * MIN),
    },
  ];

  // 저장소는 코드 교환 **전에 한 번만** 비운다. 교환 뒤 지우면 URL에서 코드가 이미
  // 제거된 상태라 새로고침 때 복원할 토큰도 함께 사라진다.
  const cleanupPage = await context.newPage();
  await cleanupPage.goto(`${BASE}/mod`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await cleanupPage.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await cleanupPage.close();
  for (const name of Object.keys(calls)) calls[name] = 0;

  let page = await openMod({ includeJoinCode: true });

  // ── [0] 코드 1회 교환 → URL 제거 → 토큰 재개 ────────────────────────
  await step(
    0,
    '접속 권한 — 코드 1회 교환 뒤 토큰으로 재개',
    '코드는 요청 전에 URL·저장소에서 사라지고 새로고침은 mod_session_get으로 복원된다',
    async () => {
      must(exchangeUrlRedacted, '코드 교환 요청 시점에도 주소에 code/c가 남아 있었다');
      must(!/[?&](?:code|c)=/i.test(page.url()), `교환 뒤 주소가 ${page.url()} 다`);
      must(calls.code_exchange === 1, `코드 교환이 ${calls.code_exchange}회다`);
      const stored = await page.evaluate(({ sessionKey, deviceKey, joinCode, expectedToken }) => {
        const raw = localStorage.getItem(sessionKey);
        const parsed = raw ? JSON.parse(raw) : null;
        const entries = Array.from({ length: localStorage.length }, (_, index) => {
          const key = localStorage.key(index) ?? '';
          return [key, localStorage.getItem(key) ?? ''];
        });
        return {
          sessionValid: parsed?.v === 1 && parsed?.accessToken === expectedToken,
          expiresAt: parsed?.expiresAt ?? null,
          teamId: parsed?.team?.id ?? null,
          deviceStored: Boolean(localStorage.getItem(deviceKey)),
          joinCodePersisted: entries.some(([key, value]) => key.includes(joinCode) || value.includes(joinCode)),
        };
      }, { sessionKey: SESSION_KEY, deviceKey: DEVICE_KEY, joinCode: CODE, expectedToken: TEAM_TOKEN });
      must(stored.sessionValid, '불투명 workshop session이 저장되지 않았다');
      workshopSessionPersisted = stored.sessionValid;
      must(stored.expiresAt === FIXTURE.authorization.tokenExpiresAt, `만료가 ${stored.expiresAt} 다`);
      must(stored.teamId === TEAM_ID, `저장 scope 팀이 ${stored.teamId} 다`);
      must(stored.deviceStored, '기기 UUID가 저장되지 않았다');
      must(!stored.joinCodePersisted, '재사용 가능한 접속코드가 브라우저 저장소에 남았다');
      must(tokenContractViolations.length === 0, `토큰 RPC 인자 오류: ${tokenContractViolations.join(', ')}`);

      const resumeBefore = calls.session_resume;
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForSelector('textarea', { timeout: 60_000 });
      await page.waitForTimeout(900);
      must(calls.code_exchange === 1, '새로고침이 접속코드를 다시 교환했다');
      must(calls.session_resume === resumeBefore + 1, '새로고침이 mod_session_get으로 복원하지 않았다');
      must(!/[?&](?:code|c)=/i.test(page.url()), '새로고침 뒤 코드가 주소에 되살아났다');
      must(calls.legacy_rpc === 0, `구형 코드 RPC를 ${calls.legacy_rpc}회 호출했다`);
      return `교환 1회 · 토큰 재개 ${calls.session_resume}회 · URL/저장소 코드 0건 · 만료 ${stored.expiresAt}`;
    },
  );

  // ── [1] 입력 ──────────────────────────────────────────────────────────
  await step(
    1,
    '입력 — 꼭지①에 여러 줄',
    `${PASTED.length}줄이 칸마다 나뉘고 배지가 「저장 안 함」으로 뒤집힌다`,
    async () => {
      const before = await boxes(page, 1).count();
      must(before === 1, `시작 칸이 ${before}개다 — 빈 꼭지여야 한다`);
      const first = await badgeState(page, 1);
      must(first === 'saved', `첫 배지가 ${first} 다`);
      await boxes(page, 1).first().click();
      await paste(boxes(page, 1).first(), PASTED.join('\r\n'));
      await page.waitForTimeout(900);
      const v = await values(page, 1);
      must(v.length === PASTED.length, `칸이 ${v.length}개다 (${PASTED.length}개여야 한다)`);
      for (const line of PASTED) must(v.includes(line), `「${line.slice(0, 20)}…」이 제 칸에 없다`);
      const state = await badgeState(page, 1);
      must(state === 'unsaved', `배지가 ${state} 다`);
      const t = await badgeText(page, 1);
      must(t.includes('저장 안 함'), `배지 문구가 "${t}" 다`);
      const tier = (await banner(page).count()) ? await bannerTier(page) : '(없음)';
      await badge(page, 1).scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${SHOTS}/rehearsal-1-typed.png` });
      return `칸 1→${v.length}개 · 배지 "${t}" · 마감 배너 ${tier}`;
    },
  );

  // ── [1b] 순차 꼭지 개방 ─────────────────────────────────────────────
  // 첫 꼭지의 textarea DOM·포커스·스크롤을 그대로 둔 채 서버 목록에 꼭지②를 추가한다.
  // 전체 화면을 갈아끼우면 입력값만 localStorage에서 살아도 포커스와 읽던 위치가 날아간다.
  await step(
    '1b',
    '순차 꼭지 개방 — 기존 작업 맥락 보존',
    '꼭지②와 알림만 추가되고 꼭지① 입력·포커스·스크롤은 그대로다',
    async () => {
      const firstBox = boxes(page, 1).first();
      const beforeValues = await values(page, 1);
      await firstBox.evaluate((element) => element.focus({ preventScroll: true }));
      const scrollBefore = await page.evaluate(async () => {
        const maximum = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
        window.scrollTo({ top: Math.min(240, maximum), behavior: 'instant' });
        await new Promise((resolveFrame) => requestAnimationFrame(() => requestAnimationFrame(resolveFrame)));
        return window.scrollY;
      });
      await page.screenshot({ path: `${SHOTS}/rehearsal-1b-before.png` });

      server.topics = [
        ...server.topics,
        { ...nextTopicFixture, status: 'open', deadlineAt: null },
      ];
      await waitUntil(
        page,
        async () => (await page.locator('section').filter({ has: page.locator('textarea') }).count()) >= 2,
        15_000,
        '꼭지② 입력 구역이 추가되지 않았다',
      );
      const alert = page.locator('[data-testid="workshop-new-topic-alert"]');
      await alert.waitFor({ state: 'visible', timeout: 5_000 });
      const afterValues = await values(page, 1);
      const contextState = await firstBox.evaluate((element, expectedScroll) => ({
        expectedScroll,
        focused: document.activeElement === element,
        scrollY: window.scrollY,
        scrollDelta: Math.abs(window.scrollY - expectedScroll),
      }), scrollBefore);
      await page.screenshot({ path: `${SHOTS}/rehearsal-1b-after.png` });
      must(JSON.stringify(afterValues) === JSON.stringify(beforeValues), '꼭지① 입력값이 바뀌었다');
      must(contextState.focused, '새 꼭지가 열리며 기존 입력 포커스가 이동했다');
      must(
        contextState.scrollDelta <= 2,
        `스크롤이 ${contextState.expectedScroll}px→${contextState.scrollY}px (${contextState.scrollDelta}px) 이동했다`,
      );
      const alertText = (await alert.innerText()).replace(/\s+/g, ' ').trim();
      must(alertText.includes('새 꼭지'), `새 꼭지 알림이 "${alertText}"다`);
      return `꼭지 1→2개 · 입력 ${afterValues.length}줄 유지 · 포커스 유지 · 스크롤 변화 ${contextState.scrollDelta}px · "${alertText}"`;
    },
  );

  // ── [2] 오프라인 전환 ────────────────────────────────────────────────
  await step(
    2,
    '오프라인 전환 — 계속 타이핑',
    '연결이 끊긴 뒤에도 앞 글이 그대로 있고 새 줄이 더 들어간다',
    async () => {
      server.saveMode = 'abort';
      await context.setOffline(true);
      await page.waitForTimeout(600);
      const off = await page.evaluate(() => navigator.onLine);
      must(off === false, 'navigator.onLine 이 아직 true 다 — 오프라인 전환이 안 먹었다');
      await addRowButton(page, 1).click();
      await page.waitForTimeout(300);
      const v0 = await boxes(page, 1).count();
      must(v0 === PASTED.length + 1, `「한 줄 더」 뒤 칸이 ${v0}개다`);
      await boxes(page, 1).nth(v0 - 1).fill(OFFLINE_LINE);
      await page.waitForTimeout(900);
      const v = await values(page, 1);
      for (const line of SAVED_LINES) must(v.includes(line), `오프라인에서 「${line.slice(0, 16)}…」이 사라졌다`);
      const draft = await readKey(page, DRAFT1);
      must(draft, `${DRAFT1} 가 없다 — 초안이 기기에 안 남았다`);
      inspectedDraftQueuePayloads.set(DRAFT1, draft);
      must(draft.includes(OFFLINE_LINE), '초안에 오프라인에서 친 줄이 없다');
      await boxes(page, 1).nth(v0 - 1).scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${SHOTS}/rehearsal-2-offline.png` });
      return `onLine=false · 칸 ${v.length}개 전부 유지 · 초안에 오프라인 줄 포함`;
    },
  );

  // ── [3] 오프라인 저장 시도 ───────────────────────────────────────────
  await step(
    3,
    '오프라인 저장 시도 — 「저장」',
    '배지 「대기 중 · 1번째 시도」 + 본문에 대기 안내',
    async () => {
      await saveButton(page, 1).click();
      await page.waitForTimeout(1_800);
      const raw = await readKey(page, QUEUE1);
      must(raw, `${QUEUE1} 이 없다 — 실패한 저장이 큐에 안 얹혔다`);
      inspectedDraftQueuePayloads.set(QUEUE1, raw);
      const q = JSON.parse(raw);
      must(q.v === 2 && q.attempts === 1, `큐 v${q.v}, attempts=${q.attempts}다`);
      must(q.baseVersion === 0, `baseVersion이 ${q.baseVersion}다 (서버 0)`);
      must(typeof q.requestId === 'string' && q.requestId.length > 0, 'requestId가 없다');
      must(!('p_code' in q) && !('code' in q) && !('accessToken' in q), '큐에 코드 또는 토큰이 들어갔다');
      must(q.items.length === SAVED_LINES.length, `큐에 담긴 줄이 ${q.items.length}개다`);
      for (const line of SAVED_LINES)
        must(q.items.some((i) => i.content.includes(line)), `큐에 「${line.slice(0, 16)}…」이 없다`);
      const state = await badgeState(page, 1);
      must(state === 'queued', `배지가 ${state} 다`);
      const t = await badgeText(page, 1);
      must(t.includes('대기 중 · 1번째 시도'), `배지 문구가 "${t}" 다`);
      const body = await topicSection(page, 1).innerText();
      must(body.includes('저장하지 못한 내용이 대기 중입니다'), '본문에 대기 안내가 없다');
      must(body.includes('지금 다시 시도'), '「지금 다시 시도」 버튼이 없다');
      await badge(page, 1).scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${SHOTS}/rehearsal-3-queued.png` });
      return `큐 v2 · ${q.items.length}줄(baseVersion=0, requestId 보존) · 배지 "${t}" · 비밀값 0건`;
    },
  );

  // ── [4] 탭 종료 → 재접속 ─────────────────────────────────────────────
  //
  // ★ 순서에 함정이 있다. `setOffline(true)` 는 **문서 요청까지** 끊으므로 오프라인인 채로는
  //   새 탭을 열 수 없다(localhost 도 못 받는다). 그래서 「닫는다 → 연결을 되돌린다 →
  //   새 탭을 연다」 순서로 간다. 이때 **열려 있는 페이지가 없어 `online` 이벤트가 어디에도
  //   도달하지 않는다** — 재접속한 탭은 큐를 들고 온라인이지만 `online` 이벤트를 못 받은
  //   상태다. 조각 검증(verify-queue-resend)이 재던 것은 「큐를 얹은 그 페이지가 online
  //   이벤트를 받는」 경로뿐이라, 여기서 재는 것은 **한 번도 안 재 본 이어 붙인 경로**다.
  await step(
    4,
    '탭 종료 → 재접속',
    `새 탭에서 친 글 ${SAVED_LINES.length}줄이 전부 복원된다`,
    async () => {
      const resumeBeforeReconnect = calls.session_resume;
      await page.close();
      server.saveMode = 'ok';
      await context.setOffline(false); // 열린 페이지가 없다 = online 이벤트가 안 간다
      page = await openMod();
      must(calls.code_exchange === 1, '재접속이 접속코드를 다시 교환했다');
      must(calls.session_resume === resumeBeforeReconnect + 1, '재접속이 mod_session_get으로 복원되지 않았다');
      must(!/[?&](?:code|c)=/i.test(page.url()), '재접속 URL에 접속코드가 다시 붙었다');
      const v = await values(page, 1);
      for (const line of SAVED_LINES) must(v.includes(line), `재접속 뒤 「${line.slice(0, 16)}…」이 사라졌다`);
      must(
        v.filter((s) => s.trim().length > 0).length === SAVED_LINES.length,
        `내용 있는 칸이 ${v.filter((s) => s.trim().length > 0).length}개다 (${SAVED_LINES.length}개여야 한다)`,
      );
      // 사진에 **복원된 글이 실제로 찍혀야** 증거가 된다 — 페이지 맨 위를 찍으면 안 보인다.
      await boxes(page, 1).last().scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${SHOTS}/rehearsal-4-reopened.png` });
      return `새 탭 · ${SAVED_LINES.length}줄 전부 복원 (붙여넣기 4줄 + 오프라인 1줄)`;
    },
  );

  // ── [5] 온라인 복귀 — 큐 자동 재전송 ─────────────────────────────────
  await step(
    5,
    '온라인 복귀 — 큐 자동 재전송',
    '재접속한 탭이 스스로 큐를 비우고 배지가 「저장됨」으로 돌아온다',
    async () => {
      const beforeSave = calls.submission_save;
      let secs;
      try {
        secs = await waitUntil(page, async () => (await readKey(page, QUEUE1)) === null, 25_000, '큐가 안 비었다');
      } catch (e) {
        // 진단 — 실제 online 이벤트를 한 번 일으켜 보고 그때는 나가는지 본다.
        await context.setOffline(true);
        await page.waitForTimeout(400);
        await context.setOffline(false);
        let recovered = false;
        try {
          await waitUntil(page, async () => (await readKey(page, QUEUE1)) === null, 15_000, '');
          recovered = true;
        } catch {
          /* 그래도 안 나갔다 */
        }
        findings.push(
          `[5] 재접속한 탭이 스스로 큐를 비우지 않았다. 실제 online 이벤트를 일으키니 ${
            recovered ? '그때는 나갔다 — 마운트 경로만 비어 있다' : '그래도 안 나갔다'
          }`,
        );
        throw new Error(`${e.message} — 마운트 시 큐 워커가 안 돌았다(진단: online 이벤트 ${recovered ? '뒤엔 전송됨' : '뒤에도 미전송'})`);
      }
      must(calls.submission_save > beforeSave, 'submission_save 가 안 나갔다');
      const failedRequest = saveRequests.at(-2);
      const retriedRequest = saveRequests.at(-1);
      must(Boolean(failedRequest && retriedRequest), '저장 요청 이력을 두 번 관찰하지 못했다');
      must(failedRequest.requestId === retriedRequest.requestId, '재전송 때 requestId가 바뀌었다');
      must(failedRequest.expectedVersion === retriedRequest.expectedVersion, '재전송 때 baseVersion이 바뀌었다');
      must(retriedRequest.expectedVersion === 0, `재전송 expectedVersion이 ${retriedRequest.expectedVersion}다`);
      must(store[TOPIC1].items.length === SAVED_LINES.length, `서버에 ${store[TOPIC1].items.length}줄만 올라갔다`);
      for (const line of SAVED_LINES)
        must(store[TOPIC1].items.some((i) => i.content.includes(line)), `서버에 「${line.slice(0, 16)}…」이 없다`);
      must((await readKey(page, DRAFT1)) === null, '전송했는데 초안이 안 지워졌다');
      await waitUntil(page, async () => (await badgeState(page, 1)) === 'saved', 10_000, '배지가 saved 로 안 돌아왔다');
      const t = await badgeText(page, 1);
      await badge(page, 1).scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${SHOTS}/rehearsal-5-resent.png` });
      return `${secs}초 만에 큐 비움 · requestId/baseVersion 동일 · 서버 v${store[TOPIC1].version} ${store[TOPIC1].items.length}줄 · 배지 "${t}"`;
    },
  );

  // ── [6] 마감 임박 ────────────────────────────────────────────────────
  await step(
    6,
    '마감 임박 — 배너 warn + 저장 안내',
    'warn(주황) 구간으로 가고 미저장이 있으면 저장 안내가 함께 뜬다',
    async () => {
      // 먼저 **새 미저장**을 만든다. 5단계에서 전부 올라가 미저장이 0이 된 상태다.
      await addRowButton(page, 1).click();
      await page.waitForTimeout(300);
      const n = await boxes(page, 1).count();
      await boxes(page, 1).nth(n - 1).fill(DEADLINE_LINE);
      await page.waitForTimeout(700);
      const state = await badgeState(page, 1);
      must(state === 'unsaved', `미저장을 만들었는데 배지가 ${state} 다`);

      // 픽스처의 마감시각을 2분 뒤로 당긴다(절대 시각으로 굳힌다). 공통 5초 폴러가
      // 다시 읽으면 곧바로 warn(3분 이하)에 들어간다. tier 경계 자체는 좁은 단위 테스트가 맡는다.
      const fixedAt = deadlineFromNow(FLOW.warningDeadlineOffsetMinutes * MIN);
      server.topics = server.topics.map((t) => (t.id === TOPIC1 ? { ...t, deadlineAt: fixedAt } : t));
      const secs = await waitUntil(
        page,
        async () => (await bannerTier(page)) === 'warn',
        30_000,
        async () => `구간이 ${await bannerTier(page)} 다 (잔여 ${(await page.locator('[data-deadline-countdown]').innerText()).trim()})`,
      );
      const msg = await bannerMessage(page);
      must(msg.includes('지금 저장하세요'), `문구가 "${msg}" 다`);
      must(msg.includes('저장하지 않은 내용이 있습니다'), `미저장인데 저장 안내가 없다 — "${msg}"`);
      const cd = (await page.locator('[data-deadline-countdown]').innerText()).trim();
      must(/^0[0-3]:\d{2}$/.test(cd), `잔여가 ${cd} 다 — 3분 이하여야 warn 이다`);
      // 배너는 탭 바 **바깥**이라 어느 탭에서도 보인다는 것이 이 기능의 요점이다.
      const outside = await page.evaluate(() => {
        const b = document.querySelector('[data-deadline-banner]');
        const tabs = document.querySelector('[role="tablist"]');
        return b && tabs ? !tabs.contains(b) && Boolean(b.compareDocumentPosition(tabs) & 4) : false;
      });
      must(outside, '배너가 탭 바 안에 있다');
      await page.screenshot({ path: `${SHOTS}/rehearsal-6-warn.png` });
      return `${secs}초 만에 새 마감 반영+warn · 잔여 ${cd} · "${msg}"`;
    },
  );

  // ── [7] 내려받기 ─────────────────────────────────────────────────────
  // ⚠️ 「전부 받기」 버튼의 접근성 이름에 부제 「워드·엑셀·줄글…」이 들어가므로
  //    `/워드/` 로 고르면 ZIP 버튼이 먼저 잡힌다. testid 로 고정한다.
  await step(
    7,
    '내려받기 — 「전부 받기 (.zip)」 한 번',
    'ZIP 하나가 떨어지고 안에 워드·엑셀·줄글 3개 · 저장한 줄이 그대로 담긴다',
    async () => {
      await page.getByRole('button', { name: /내려받기/ }).first().click();
      await page.locator('[data-testid="team-download-zip"]').scrollIntoViewIfNeeded();
      const [dl] = await Promise.all([
        page.waitForEvent('download', { timeout: 30_000 }),
        page.locator('[data-testid="team-download-zip"]').click(),
      ]);
      const p = `${OUT}/rehearsal-bundle.zip`;
      await dl.saveAs(p);
      const size = statSync(p).size;
      must(dl.suggestedFilename().endsWith('.zip'), `확장자가 ${dl.suggestedFilename()} 다`);
      must(size > 1000, `파일이 ${size}바이트다`);
      const entries = unzip(readFileSync(p));
      must(entries.length === 3, `ZIP 안에 ${entries.length}개다`);
      const exts = entries.map((e) => e.name.split('.').pop());
      must(exts.join() === 'docx,csv,txt', `확장자·순서가 ${exts.join(' · ')} 다`);
      const csv = entries.find((e) => e.name.endsWith('.csv')).data.toString('utf8');
      const txt = entries.find((e) => e.name.endsWith('.txt')).data.toString('utf8');
      // 저장한 줄은 전부 들어 있고, **아직 저장 안 한 줄은 안 들어 있어야** 한다
      // (화면이 「아직 저장하지 않은 글은 담기지 않습니다」라고 약속한 그대로다).
      for (const line of SAVED_LINES) must(csv.includes(line), `ZIP 의 CSV 에 「${line.slice(0, 16)}…」이 없다`);
      must(!csv.includes(DEADLINE_LINE), '★ 저장하지 않은 줄이 내려받기에 섞여 들어갔다');
      must(txt.includes(SAVED_LINES[0]), '줄글에 첫 줄이 없다');
      await page.screenshot({ path: `${SHOTS}/rehearsal-7-download.png` });
      return `${dl.suggestedFilename()} · ${size}B · ${entries.length}개(${exts.join('/')}) · 저장분 ${SAVED_LINES.length}줄 담김 · 미저장 1줄 제외`;
    },
  );

  // ── [8] 불변식 ───────────────────────────────────────────────────────
  await step(
    8,
    '불변식 — 글자가 사라지지 않았다',
    `처음부터 친 ${ALL_LINES.length}줄이 순서 그대로 화면에 남아 있다`,
    async () => {
      const v = (await values(page, 1)).filter((s) => s.trim().length > 0);
      must(
        v.length === ALL_LINES.length,
        `친 줄은 ${ALL_LINES.length}개인데 남은 줄이 ${v.length}개다 — ${ALL_LINES.filter((l) => !v.includes(l)).join(' / ') || '순서만 어긋났다'}`,
      );
      for (let i = 0; i < ALL_LINES.length; i += 1)
        must(v[i] === ALL_LINES[i], `${i + 1}번째 줄이 "${v[i]}" 다 (기대 "${ALL_LINES[i]}")`);
      const blob = v.find((s) => s.includes('\n'));
      must(!blob, '한 칸에 줄바꿈째로 뭉친 값이 있다 — 붙여넣기 분해가 되돌아갔다');
      await page.screenshot({ path: `${SHOTS}/rehearsal-8-final.png`, fullPage: true });
      return `${v.length}/${ALL_LINES.length}줄 · 순서 일치 · 뭉친 칸 0개`;
    },
  );

  // ── 운영 DB 무접촉 ───────────────────────────────────────────────────
  await step(
    9,
    '운영 DB 무접촉',
    '가로채기 밖 요청·구형 코드 RPC·토큰 계약 오류가 모두 0건',
    async () => {
      const persistedDraftQueueEntries = await page.evaluate(() => Array.from(
        { length: localStorage.length },
        (_, index) => {
          const key = localStorage.key(index) ?? '';
          return [key, localStorage.getItem(key) ?? ''];
        },
      ).filter(([key]) => key.startsWith('climate_vote_draft:') || key.startsWith('climate_vote_queue:')));
      for (const [key, value] of persistedDraftQueueEntries) {
        inspectedDraftQueuePayloads.set(key, value);
      }
      draftQueueCapabilityLeakCount = [...inspectedDraftQueuePayloads.entries()].filter(([key, value]) => (
        [CODE, TEAM_TOKEN].some((capability) => key.includes(capability) || value.includes(capability))
      )).length;
      const browserWebSocketEvidence = await page.evaluate(() => globalThis.__fieldRehearsalWebSocket ?? {
        stubbed: false,
        actualNetworkConnectionCount: 0,
      });
      webSocketEvidence = {
        stubbed: browserWebSocketEvidence.stubbed === true,
        stubConnectionAttemptCount: webSocketStubConnectionAttemptCount + webSocketRouteConnectionAttemptCount,
        actualNetworkConnectionCount: browserWebSocketEvidence.actualNetworkConnectionCount ?? 0,
        blockedExternalConnectionAttemptCount: blockedExternalWebSocketAttemptCount,
        blockedExternalOrigins: [...blockedExternalWebSocketOrigins].sort(),
      };
      must(calls.escaped === 0,
        `합성 fixture 밖 외부 요청 ${calls.escaped}건 (${[...escapedExternalOrigins].join(', ') || 'origin 없음'})`);
      must(webSocketEvidence.stubbed, 'WebSocket 합성 stub이 설치되지 않았다');
      must(webSocketEvidence.actualNetworkConnectionCount === 0,
        `실제 WebSocket 연결 ${webSocketEvidence.actualNetworkConnectionCount}건`);
      must(webSocketEvidence.blockedExternalConnectionAttemptCount === 0,
        `외부 WebSocket 연결 시도 ${webSocketEvidence.blockedExternalConnectionAttemptCount}건 (${webSocketEvidence.blockedExternalOrigins.join(', ') || 'origin 없음'})`);
      must(calls.legacy_rpc === 0, `구형 join-code RPC ${calls.legacy_rpc}건`);
      must(calls.unexpected_rpc === 0,
        `미등록 RPC ${calls.unexpected_rpc}건 (${[...unexpectedRpcNames].join(', ') || '이름 없음'})`);
      must(calls.live_database_mutation === 0, `운영 DB 변경 ${calls.live_database_mutation}건`);
      must(tokenContractViolations.length === 0, `p_token 누락 ${tokenContractViolations.join(', ')}`);
      must(draftQueueCapabilityLeakCount === 0, `draft/queue에 접속코드 또는 토큰이 ${draftQueueCapabilityLeakCount}건 남았다`);
      must(saveRequests.every((request) => Number.isSafeInteger(request.expectedVersion)
        && typeof request.requestId === 'string' && request.requestId.length > 0), 'v3 OCC 요청 계약이 깨졌다');
      return `exchange ${calls.code_exchange} · resume ${calls.session_resume} · topic_v2 ${calls.topic_list} · submission_get_v2 ${calls.submission_get} · save_v3 ${calls.submission_save} · WebSocket stub ${webSocketEvidence.stubConnectionAttemptCount}회/실제 0건 · 구형/외부 요청 0건`;
    },
  );
} finally {
  await context.close();
  await browser.close();
}

console.log(`\n  ${pass} PASS / ${fail} FAIL  (${pass}/${pass + fail})`);
if (findings.length) {
  console.log('\n  찾은 결함');
  for (const f of findings) console.log(`   · ${f}`);
}
console.log(`\n  사진: ${SHOTS}/rehearsal-*.png\n`);
const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
  cwd: resolve(HERE, '..'),
  encoding: 'utf8',
}).trim();
const sourceTreeClean = execFileSync('git', ['status', '--porcelain'], {
  cwd: resolve(HERE, '..'),
  encoding: 'utf8',
}).trim() === '';
const report = {
  schemaVersion: 1,
  rehearsalId: '0912-13-field-rehearsal',
  generatedAt: new Date().toISOString(),
  elapsedMs: Date.now() - startedAt.getTime(),
  sourceCommit,
  sourceTreeClean,
  target: { baseUrl: BASE, route: '/mod?code=[redacted]' },
  fixture: FIXTURE_DISPLAY_PATH,
  fixtureSha256: FIXTURE_SHA256,
  fixtureIdentity: {
    schemaVersion: FIXTURE.schemaVersion,
    fixtureId: FIXTURE.fixtureId,
    classification: FIXTURE.classification,
  },
  observedConfiguration: observedFixtureConfiguration(),
  status: fail === 0 && pass > 0 ? 'pass' : 'fail',
  summary: { checkCount: pass + fail, passCount: pass, failCount: fail },
  safety: {
    liveNetworkRequestCount: calls.escaped + webSocketEvidence.actualNetworkConnectionCount,
    liveDatabaseMutationCount: calls.live_database_mutation,
    capabilityValuesLeakedToDraftQueueOrEvidence: null,
    capabilityLeakScan: {
      draftQueueEntryCount: inspectedDraftQueuePayloads.size,
      draftQueueMatchCount: draftQueueCapabilityLeakCount,
      evidenceMatchCount: null,
    },
  },
  networkContract: {
    codeRemovedBeforeExchange: exchangeUrlRedacted,
    workshopSessionPersisted,
    codeExchangeCount: calls.code_exchange,
    tokenResumeCount: calls.session_resume,
    legacyJoinCodeRpcCount: calls.legacy_rpc,
    tokenContractViolationCount: tokenContractViolations.length,
    unexpectedRpcRequestCount: calls.unexpected_rpc,
    unexpectedRpcNames: [...unexpectedRpcNames].sort(),
    fixtureMutationRequestCount: calls.fixture_mutation,
    escapedExternalRequestCount: calls.escaped,
    escapedExternalOrigins: [...escapedExternalOrigins].sort(),
    queueSchemaVersion: 2,
    occRequestCount: saveRequests.length,
    webSocket: webSocketEvidence,
  },
  checks,
  findings,
  screenshots: '.tmp-verify/rehearsal-*.png',
};
const evidenceWithoutCapabilityValues = JSON.stringify(report);
const evidenceCapabilityLeakCount = [CODE, TEAM_TOKEN].filter((capability) => (
  evidenceWithoutCapabilityValues.includes(capability)
)).length;
report.safety.capabilityLeakScan.evidenceMatchCount = evidenceCapabilityLeakCount;
report.safety.capabilityValuesLeakedToDraftQueueOrEvidence = draftQueueCapabilityLeakCount === null
  ? null
  : draftQueueCapabilityLeakCount + evidenceCapabilityLeakCount > 0;
if (evidenceCapabilityLeakCount > 0) {
  const safetyCheck = checks.find((check) => check.id === '9' && check.status === 'pass');
  if (safetyCheck) {
    safetyCheck.status = 'fail';
    safetyCheck.observed = `리허설 JSON에 권한값 ${evidenceCapabilityLeakCount}건이 포함됐다`;
    pass -= 1;
    fail += 1;
  }
  findings.push(`리허설 JSON 권한값 누출 ${evidenceCapabilityLeakCount}건`);
}
report.status = fail === 0 && pass > 0 ? 'pass' : 'fail';
report.summary = { checkCount: pass + fail, passCount: pass, failCount: fail };
mkdirSync(dirname(REPORT), { recursive: true });
writeFileSync(REPORT, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(`  JSON 증거: ${REPORT}\n`);
// ★ 검사를 한 건도 못 돌았으면 실패다 — 「0 PASS · 0 FAIL」로 조용히 exit 0 이 되면
//   아무것도 안 잰 것을 통과로 읽게 된다.
if (pass + fail === 0) {
  console.error(`  FAIL: 검사를 한 건도 돌지 못했다 — ${URL_MOD} 이 뜨는지 확인하라(npm.cmd exec -- astro preview --port 4331).\n`);
  process.exit(1);
}
process.exit(fail === 0 ? 0 : 1);
