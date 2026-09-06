import { chromium } from 'playwright';
import axe from 'axe-core';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyDeploymentRevision } from './verify-deployment-revision.mjs';

export { verifyDeploymentRevision } from './verify-deployment-revision.mjs';

export const AUDITED_SOURCE_PATHS = [
  '.github/workflows/platform-accessibility.yml',
  'astro.config.mjs',
  'package-lock.json',
  'package.json',
  'public/_headers',
  'public/v',
  'scripts/write-deployment-revision.mjs',
  'scripts/write-deployment-revision.test.mjs',
  'tsconfig.json',
  'automation/package-lock.json',
  'automation/package.json',
  'automation/platform-accessibility-audit.mjs',
  'automation/platform-accessibility-kwcag-coverage.mjs',
  'automation/platform-accessibility-manual-evidence.mjs',
  'automation/tests/platform-accessibility-audit.test.mjs',
  'automation/tests/platform-accessibility-kwcag-coverage.test.mjs',
  'automation/tests/platform-accessibility-manual-evidence.test.mjs',
  'automation/tests/verify-platform-design-blueprint.test.mjs',
  'automation/verify-deployment-revision.mjs',
  'automation/verify-platform-design-blueprint.mjs',
  'src/components',
  'src/islands/OntologyReviewConsole.tsx',
  'src/islands/OntologyReviewConsole.test.ts',
  'src/islands/ballot',
  'src/islands/canvas',
  'src/islands/mod',
  'src/islands/platform',
  'src/islands/result',
  'src/layouts',
  'src/lib',
  'src/pages',
  'src/styles',
];

/** Reads tracked and untracked changes that can affect the audited UI or auditor. */
export function readAuditSourceStatus(projectRoot) {
  return execFileSync(
    'git',
    ['status', '--porcelain', '--untracked-files=all', '--', ...AUDITED_SOURCE_PATHS],
    { cwd: projectRoot, encoding: 'utf8' },
  );
}

export const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const UNVERIFIED_TARGET_REVISION = Object.freeze({
  status: 'not_verified',
  sourceCommit: null,
  reason: 'The audited origin does not expose a machine-verifiable deployment revision.',
});
export const DEFAULT_AUDIT_PROFILES = [
  { id: 'desktop', viewport: { width: 1440, height: 1000 } },
  { id: 'mobile', viewport: { width: 360, height: 800 }, minimumContentWidth: 280 },
];

function hasExactFields(value, fields) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.keys(value).length === fields.length
    && fields.every((field) => Object.prototype.hasOwnProperty.call(value, field));
}

function validateTargetRevision(targetRevision, sourceCommit) {
  if (targetRevision?.status === 'verified') {
    if (!hasExactFields(targetRevision, ['status', 'sourceCommit'])
      || targetRevision.sourceCommit !== sourceCommit) {
      throw new Error('Verified deployment revision does not match the accessibility source commit.');
    }
    return;
  }
  if (!hasExactFields(targetRevision, ['status', 'sourceCommit', 'reason'])
    || targetRevision.status !== UNVERIFIED_TARGET_REVISION.status
    || targetRevision.sourceCommit !== null
    || targetRevision.reason !== UNVERIFIED_TARGET_REVISION.reason) {
    throw new Error('Accessibility target revision state is invalid.');
  }
}

const SUPABASE_ORIGIN = 'https://pleyuknjnprsckssxvrh.supabase.co';
const SUPABASE_WEBSOCKET_ORIGIN = SUPABASE_ORIGIN.replace(/^https:/, 'wss:');

async function installFixtureNetworkIsolation({ page, baseOrigin, fixtureState }) {
  const allowedOrigins = new Set([baseOrigin, SUPABASE_ORIGIN]);
  page.on('response', (response) => {
    const responseUrl = new URL(response.url());
    if (!['http:', 'https:'].includes(responseUrl.protocol) || allowedOrigins.has(responseUrl.origin)) return;
    fixtureState.escapedNetworkRequestCount += 1;
    if (!fixtureState.escapedNetworkOrigins.includes(responseUrl.origin)) {
      fixtureState.escapedNetworkOrigins.push(responseUrl.origin);
    }
  });
  // Register this before the Supabase fixture route. Playwright evaluates route
  // handlers in reverse registration order, so the exact RPC fixture runs first
  // and every remaining HTTP(S) request reaches this deny-by-default boundary.
  await page.route('**/*', async (route) => {
    const requestUrl = new URL(route.request().url());
    if (requestUrl.origin === baseOrigin) return route.continue();
    if (requestUrl.origin === SUPABASE_ORIGIN) return route.fallback();
    fixtureState.blockedExternalRequestCount += 1;
    if (!fixtureState.blockedExternalOrigins.includes(requestUrl.origin)) {
      fixtureState.blockedExternalOrigins.push(requestUrl.origin);
    }
    return route.abort('blockedbyclient');
  });
}

export async function installFixtureWebSocketIsolation({ context, fixtureState }) {
  fixtureState.workerWebSocketAttemptCount ??= 0;
  fixtureState.webSocketRoutingInstalled = true;
  await context.exposeBinding('__recordFixtureWorkerWebSocketAttempt', (_source, rawUrl) => {
    const socketUrl = new URL(String(rawUrl));
    fixtureState.workerWebSocketAttemptCount += 1;
    if (socketUrl.origin === SUPABASE_WEBSOCKET_ORIGIN) {
      fixtureState.syntheticWebSocketAttemptCount += 1;
      return;
    }
    fixtureState.blockedExternalWebSocketAttemptCount += 1;
    if (!fixtureState.blockedExternalWebSocketOrigins.includes(socketUrl.origin)) {
      fixtureState.blockedExternalWebSocketOrigins.push(socketUrl.origin);
    }
  });
  await context.addInitScript(({ bindingName, marker }) => {
    if (typeof globalThis.Worker !== 'function' || globalThis.__fixtureWorkerWebSocketIsolationInstalled) return;
    globalThis.__fixtureWorkerWebSocketIsolationInstalled = true;
    const NativeWorker = globalThis.Worker;
    const workerBootstrap = (scriptUrl, moduleWorker) => {
      const webSocketStub = `
        class FixtureWorkerWebSocket extends EventTarget {
          static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3;
          readyState = FixtureWorkerWebSocket.CONNECTING;
          bufferedAmount = 0; extensions = ''; protocol = ''; binaryType = 'blob';
          onopen = null; onmessage = null; onerror = null; onclose = null;
          constructor(url) {
            super();
            this.url = String(url);
            self.postMessage({ ${JSON.stringify(marker)}: true, url: new URL(this.url, self.location.href).href });
            queueMicrotask(() => {
              this.readyState = FixtureWorkerWebSocket.CLOSED;
              const errorEvent = new Event('error');
              this.dispatchEvent(errorEvent); this.onerror?.(errorEvent);
              const closeEvent = new CloseEvent('close', { code: 1008, reason: 'Synthetic accessibility audit WebSocket', wasClean: true });
              this.dispatchEvent(closeEvent); this.onclose?.(closeEvent);
            });
          }
          send() { throw new DOMException('Synthetic accessibility audit WebSocket is closed', 'InvalidStateError'); }
          close() { this.readyState = FixtureWorkerWebSocket.CLOSED; }
        }
        Object.defineProperty(self, 'WebSocket', { configurable: true, value: FixtureWorkerWebSocket });
      `;
      return moduleWorker
        ? `${webSocketStub}\nimport(${JSON.stringify(scriptUrl)}).catch((error) => { console.error('Fixture module worker failed', error); });`
        : `${webSocketStub}\ntry { importScripts(${JSON.stringify(scriptUrl)}); } catch (error) { console.error('Fixture worker failed', error); }`;
    };
    class FixtureIsolatedWorker extends NativeWorker {
      constructor(scriptUrl, options = {}) {
        const absoluteScriptUrl = new URL(String(scriptUrl), globalThis.location.href).href;
        const bootstrapUrl = URL.createObjectURL(new Blob([
          workerBootstrap(absoluteScriptUrl, options.type === 'module'),
        ], { type: 'text/javascript' }));
        super(bootstrapUrl, options);
        URL.revokeObjectURL(bootstrapUrl);
        this.addEventListener('message', (event) => {
          if (!event.data || event.data[marker] !== true || typeof event.data.url !== 'string') return;
          event.stopImmediatePropagation();
          Promise.resolve(globalThis[bindingName](event.data.url)).catch((error) => {
            console.error('Failed to record fixture Worker WebSocket attempt', error);
          });
        }, { capture: true });
      }
    }
    Object.defineProperty(globalThis, 'Worker', { configurable: true, value: FixtureIsolatedWorker });
  }, {
    bindingName: '__recordFixtureWorkerWebSocketAttempt',
    marker: '__fixtureWorkerWebSocketAttempt',
  });
  await context.routeWebSocket(/.*/, async (webSocketRoute) => {
    const socketUrl = new URL(webSocketRoute.url());
    fixtureState.webSocketRouteAttemptCount += 1;
    if (socketUrl.origin === SUPABASE_WEBSOCKET_ORIGIN) {
      fixtureState.syntheticWebSocketAttemptCount += 1;
    } else {
      fixtureState.blockedExternalWebSocketAttemptCount += 1;
      if (!fixtureState.blockedExternalWebSocketOrigins.includes(socketUrl.origin)) {
        fixtureState.blockedExternalWebSocketOrigins.push(socketUrl.origin);
      }
    }
    // Omitting connectToServer is the isolation boundary. Closing the mocked
    // client keeps workers and frames from waiting on a socket that can never
    // become authoritative during this read-only audit.
    await webSocketRoute.close({ code: 1008, reason: 'Synthetic accessibility audit WebSocket' });
  });
}

export function fixtureNetworkPasses(fixtureNetwork) {
  return fixtureNetwork.escapedNetworkRequestCount === 0
    && fixtureNetwork.escapedNetworkOrigins.length === 0
    && fixtureNetwork.blockedExternalRequestCount === 0
    && fixtureNetwork.blockedExternalOrigins.length === 0
    && fixtureNetwork.unexpectedSupabaseRequestCount === 0
    && fixtureNetwork.contractViolationCount === 0
    && fixtureNetwork.mutationRequestCount === 0
    && fixtureNetwork.liveDatabaseMutationCount === 0
    && fixtureNetwork.webSocket?.stubbed === true
    && fixtureNetwork.webSocket?.actualNetworkConnectionCount === 0
    && fixtureNetwork.webSocket?.blockedExternalConnectionAttemptCount === 0
    && fixtureNetwork.webSocket?.blockedExternalOrigins.length === 0;
}

function createFixtureIsolationState(extra = {}) {
  return {
    supabaseHttpRequestCount: 0,
    unexpectedSupabaseRequestCount: 0,
    unexpectedSupabasePaths: [],
    blockedExternalRequestCount: 0,
    blockedExternalOrigins: [],
    escapedNetworkRequestCount: 0,
    escapedNetworkOrigins: [],
    webSocketRoutingInstalled: false,
    webSocketRouteAttemptCount: 0,
    workerWebSocketAttemptCount: 0,
    syntheticWebSocketAttemptCount: 0,
    blockedExternalWebSocketAttemptCount: 0,
    blockedExternalWebSocketOrigins: [],
    contractViolationCount: 0,
    mutationRequestCount: 0,
    simulatedMutationRequestCount: 0,
    ...extra,
  };
}

function fixtureWebSocketEvidence(fixtureState) {
  return {
    stubbed: fixtureState.webSocketRoutingInstalled,
    stubConnectionAttemptCount: fixtureState.webSocketRouteAttemptCount
      + fixtureState.workerWebSocketAttemptCount,
    actualNetworkConnectionCount: 0,
    blockedExternalConnectionAttemptCount: fixtureState.blockedExternalWebSocketAttemptCount,
    blockedExternalOrigins: [...fixtureState.blockedExternalWebSocketOrigins].sort(),
  };
}

async function prepareHqGateFixture({ context, page, baseUrl }) {
  const fixtureState = createFixtureIsolationState();
  const baseOrigin = new URL(baseUrl).origin;
  await context.addInitScript(() => {
    sessionStorage.removeItem('climate_vote_hq_attendance_token');
    sessionStorage.removeItem('climate_vote_hq_gate_actor');
  });
  await installFixtureNetworkIsolation({ page, baseOrigin, fixtureState });
  await installFixtureWebSocketIsolation({ context, fixtureState });
  await page.route(`${SUPABASE_ORIGIN}/**`, async (route) => {
    fixtureState.supabaseHttpRequestCount += 1;
    fixtureState.unexpectedSupabaseRequestCount += 1;
    fixtureState.unexpectedSupabasePaths.push(new URL(route.request().url()).pathname);
    await jsonResponse(route, { message: 'HQ gate fixture does not permit Supabase requests' }, 500);
  });
  return {
    evidence: async () => ({
      ...fixtureState,
      liveDatabaseMutationCount: 0,
      webSocket: fixtureWebSocketEvidence(fixtureState),
    }),
  };
}
const AUTH_STORAGE_KEY = 'sb-pleyuknjnprsckssxvrh-auth-token';
export const FIXTURE_IDS = {
  user: '00000000-0000-4000-8000-000000000001',
  org: '00000000-0000-4000-8000-000000000002',
  assembly: '00000000-0000-4000-8000-000000000003',
  session: '00000000-0000-4000-8000-000000000004',
  topic: '00000000-0000-4000-8000-000000000005',
  topicSecondary: '00000000-0000-4000-8000-000000000006',
  authSession: '00000000-0000-4000-8000-000000000007',
  orgSecondary: '00000000-0000-4000-8000-000000000008',
  publicRound: '00000000-0000-4000-8000-000000000009',
  publicBallot: '00000000-0000-4000-8000-000000000010',
  publicBallotItemOne: '00000000-0000-4000-8000-000000000011',
  publicBallotItemTwo: '00000000-0000-4000-8000-000000000012',
};

function jsonResponse(route, body, status = 200) {
  return route.fulfill({
    status,
    contentType: 'application/json; charset=utf-8',
    headers: { 'access-control-allow-origin': '*' },
    body: JSON.stringify(body),
  });
}

function auditUser() {
  return {
    id: FIXTURE_IDS.user,
    aud: 'authenticated',
    role: 'authenticated',
    email: 'accessibility-audit@example.invalid',
    session_id: FIXTURE_IDS.authSession,
    email_confirmed_at: '2026-08-11T00:00:00.000Z',
    app_metadata: { provider: 'email', providers: ['email'] },
    user_metadata: {},
    identities: [],
    created_at: '2026-08-11T00:00:00.000Z',
  };
}

function auditSession() {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    aud: 'authenticated',
    exp: 4_102_444_800,
    role: 'authenticated',
    sub: FIXTURE_IDS.user,
    email: 'accessibility-audit@example.invalid',
  })).toString('base64url');
  return {
    access_token: `${header}.${payload}.audit-fixture`,
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: 4_102_444_800,
    refresh_token: 'audit-fixture-refresh-token',
    user: auditUser(),
  };
}

export async function prepareAuthenticatedPlatform({ context, page, topics, handleRequest }) {
  const session = auditSession();
  await context.addInitScript(({ key, value }) => {
    localStorage.setItem(key, JSON.stringify(value));
  }, { key: AUTH_STORAGE_KEY, value: session });
  await page.route(`${SUPABASE_ORIGIN}/**`, async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (handleRequest && await handleRequest({ route, path, request: route.request() })) return;
    if (path === '/auth/v1/user') return jsonResponse(route, auditUser());
    if (path === '/auth/v1/token') return jsonResponse(route, session);
    if (path === '/rest/v1/rpc/my_orgs') return jsonResponse(route, [{
      id: FIXTURE_IDS.org,
      name: '내 기관',
      slug: 'audit-org',
      selected: true,
    }]);
    if (path === '/rest/v1/rpc/platform_readiness_check_v2') {
      return jsonResponse(route, {
        ok: true,
        checks: [
          { key: 'topics_open', pass: true, detail: '1개 주제 open' },
          { key: 'teams_active', pass: true, detail: '1개 조 active' },
          { key: 'roster_loaded', pass: true, detail: '12명 배정' },
          { key: 'submissions', pass: true, detail: '1/1 제출 완료' },
        ],
      });
    }
    if (path === '/rest/v1/assembly') {
      return jsonResponse(route, [{
        id: FIXTURE_IDS.assembly,
        slug: 'audit-assembly',
        title: '접근성 감사 공론화',
        archived_at: null,
        org_id: FIXTURE_IDS.org,
      }]);
    }
    if (path === '/rest/v1/session') {
      return jsonResponse(route, [{
        id: FIXTURE_IDS.session,
        slug: 'audit-session',
        ordinal: 1,
        held_on: '2026-08-11',
        assembly_id: FIXTURE_IDS.assembly,
      }]);
    }
    if (path === '/rest/v1/discussion_topic') {
      return jsonResponse(route, topics ?? [{
        id: FIXTURE_IDS.topic,
        ordinal: 1,
        prompt: '접근성 감사 주제',
        session_id: FIXTURE_IDS.session,
        archived_at: null,
      }]);
    }
    return jsonResponse(route, { message: `Unexpected audit fixture request: ${path}` }, 500);
  });
}

async function prepareRejectedPlatformLogin({ page }) {
  await page.route(`${SUPABASE_ORIGIN}/**`, async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/auth/v1/token') {
      await jsonResponse(route, { message: 'Fixture login rejected' }, 400);
      return;
    }
    await jsonResponse(route, { message: `Unexpected login audit fixture request: ${path}` }, 500);
  });
}

async function exerciseRejectedPlatformLogin({ page }) {
  const form = page.getByRole('form', { name: '운영진 로그인' });
  const email = page.getByLabel('이메일');
  const password = page.getByLabel('비밀번호');
  await form.waitFor({ timeout: 10_000 });
  await email.fill('accessibility-audit@example.invalid');
  await password.fill('fixture-password');
  await password.press('Enter');

  const alert = page.locator('#platform-login-error[role="alert"]');
  await alert.waitFor({ state: 'visible', timeout: 10_000 });
  await page.waitForFunction(
    () => document.activeElement?.id === 'platform-password',
    undefined,
    { timeout: 10_000 },
  );
  const alertId = await alert.getAttribute('id');
  const [
    activeId,
    emailDescribedBy,
    passwordDescribedBy,
    emailInvalid,
    passwordInvalid,
    alertAtomic,
    passwordType,
    emailEnabled,
    passwordEnabled,
  ] = await Promise.all([
    page.evaluate(() => document.activeElement?.id ?? null),
    email.getAttribute('aria-describedby'),
    password.getAttribute('aria-describedby'),
    email.getAttribute('aria-invalid'),
    password.getAttribute('aria-invalid'),
    alert.getAttribute('aria-atomic'),
    password.getAttribute('type'),
    email.isEnabled(),
    password.isEnabled(),
  ]);
  const referencesAlert = (value) => Boolean(alertId && value?.split(/\s+/).includes(alertId));
  if (activeId !== 'platform-password'
    || !referencesAlert(emailDescribedBy)
    || !referencesAlert(passwordDescribedBy)
    || emailInvalid !== 'true'
    || passwordInvalid !== 'true'
    || alertAtomic !== 'true'
    || passwordType !== 'password'
    || !emailEnabled
    || !passwordEnabled) {
    throw new Error('Login rejection accessibility state is invalid');
  }
}

async function preparePlatformLoginKeyboardAudit({ page }) {
  await page.getByLabel('이메일').fill('accessibility-audit@example.invalid');
  await page.getByLabel('비밀번호').fill('fixture-password');
}

function publishedResultFixture() {
  return {
    scope: 'session',
    scope_id: FIXTURE_IDS.session,
    title: '접근성 감사 회차 결과',
    published_at: '2026-08-11T00:00:00.000Z',
    hitl_notice: 'AI는 초안을 만들고, 공개 여부와 최종 표현은 운영진이 결정합니다.',
    body: {
      scope: 'session',
      scope_id: FIXTURE_IDS.session,
      title: '접근성 감사 회차 결과',
      generated_at: '2026-08-11T00:00:00.000Z',
      reviewed_count: 1,
      unclassified_count: 0,
      issues: [
        {
          id: 'audit-issue-reviewed',
          label: '대중교통 접근성 확대',
          summary: '참여 조가 대중교통 접근성 확대를 공통 제안했습니다.',
          stance: 'proposal',
          frequency_class: 'consensus',
          review_status: 'reviewed',
          consensus_denominator: 2,
          teams: ['1분과 1조', '1분과 2조'],
          source_references: [{
            reference_key: 'audit-public-source-001',
            team_name: '1분과 1조',
            ordinal: 1,
            kind: 'core',
            excerpt: '대중교통 접근성을 확대해야 합니다.',
            content_sha256: 'a'.repeat(64),
            publication_status: 'reviewed',
            reviewed_at: '2026-08-12T00:00:00.000Z',
            reviewer_role: 'hq',
          }],
          implementation: {
            status: 'in_progress',
            responsible_body: '교통정책 담당기관',
            updated_at: '2026-08-12T00:00:00.000Z',
            summary: '대중교통 접근성 개선 계획을 공개하고 세부 이행을 진행 중입니다.',
            evidence_url: 'https://example.invalid/implementation-evidence',
          },
        },
        {
          id: 'audit-issue-draft',
          label: '지역별 이동 여건 보완',
          summary: '사람이 작성한 초안으로 원문 대조가 필요합니다.',
          stance: 'condition',
          frequency_class: 'majority',
          review_status: 'draft',
          origin: 'human',
          consensus_denominator: 2,
          teams: ['1분과 1조'],
        },
      ],
    },
  };
}

async function preparePublishedResult({ page }) {
  await page.route(`${SUPABASE_ORIGIN}/rest/v1/rpc/result_get`, async (route) => {
    await jsonResponse(route, publishedResultFixture());
  });
}

const PUBLIC_BALLOT_TOKEN = 'accessibility-audit-public-ballot-token';

function publicRoundFixture(status) {
  return {
    id: FIXTURE_IDS.publicRound,
    title: '이동권 개선 우선순위',
    description: '개인정보가 없는 접근성 감사용 합성 질문입니다.',
    type: 'RADIO',
    options: ['대중교통 확대', '보행 환경 개선'],
    status,
    scale_low: null,
    scale_high: null,
    scale_low_label: null,
    scale_high_label: null,
    created_at: '2026-09-12T01:00:00.000Z',
    updated_at: status === 'closed' ? '2026-09-12T01:10:00.000Z' : '2026-09-12T01:00:00.000Z',
  };
}

function publicBallotFixture(status) {
  return {
    id: FIXTURE_IDS.publicBallot,
    title: '기후 행동 우선순위 설문',
    instructions: '각 의제에서 가장 가까운 답을 선택해 주세요.',
    status,
    subgroup: '1분과',
    items: [
      {
        id: FIXTURE_IDS.publicBallotItemOne,
        ordinal: 1,
        statement: '대중교통 접근성을 먼저 개선해야 합니다.',
        description: '합성 설명 문장입니다.',
        scale: 2,
        required: true,
      },
      {
        id: FIXTURE_IDS.publicBallotItemTwo,
        ordinal: 2,
        statement: '보행 환경 개선을 함께 추진해야 합니다.',
        description: null,
        scale: 2,
        required: true,
      },
    ],
  };
}

function publicBallotResultsFixture() {
  return {
    id: FIXTURE_IDS.publicBallot,
    title: '기후 행동 우선순위 설문',
    status: 'published',
    subgroup: '1분과',
    responses: 3,
    items: [
      {
        id: FIXTURE_IDS.publicBallotItemOne,
        ordinal: 1,
        statement: '대중교통 접근성을 먼저 개선해야 합니다.',
        scale: 2,
        n: 3,
        avg: 1.67,
        dist: { 1: 1, 2: 2 },
      },
      {
        id: FIXTURE_IDS.publicBallotItemTwo,
        ordinal: 2,
        statement: '보행 환경 개선을 함께 추진해야 합니다.',
        scale: 2,
        n: 3,
        avg: 2,
        dist: { 2: 3 },
      },
    ],
  };
}

function isUuid(value) {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

async function preparePublicParticipantFixture({ context, page, baseUrl, kind, state }) {
  const expectedRpcCalls = kind === 'round'
    ? { public_round_get_v2: 0, public_round_cast_v2: 0, public_round_votes_v2: 0 }
    : { ballot_get: 0, ballot_submit: 0, ballot_results: 0 };
  const fixtureState = createFixtureIsolationState({
    expectedRpcCalls,
    state,
    kind,
  });
  const baseOrigin = new URL(baseUrl).origin;
  await context.addInitScript(({ ballotId }) => {
    localStorage.removeItem('cv_device');
    localStorage.removeItem('climate_vote_client_id');
    localStorage.removeItem(`cv_ballot_${ballotId}`);
  }, { ballotId: FIXTURE_IDS.publicBallot });
  await installFixtureNetworkIsolation({ page, baseOrigin, fixtureState });
  await installFixtureWebSocketIsolation({ context, fixtureState });

  await page.route(`${SUPABASE_ORIGIN}/**`, async (route) => {
    fixtureState.supabaseHttpRequestCount += 1;
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const rpc = path.split('/').pop() ?? '';
    let body = {};
    try {
      body = request.postDataJSON() ?? {};
    } catch {
      fixtureState.contractViolationCount += 1;
      return jsonResponse(route, { message: 'Invalid public accessibility fixture body' }, 400);
    }
    if (request.method() !== 'POST' || !Object.hasOwn(expectedRpcCalls, rpc)) {
      fixtureState.unexpectedSupabaseRequestCount += 1;
      fixtureState.unexpectedSupabasePaths.push(path);
      return jsonResponse(route, { message: `Unexpected public accessibility fixture request: ${path}` }, 500);
    }
    expectedRpcCalls[rpc] += 1;

    if (kind === 'round') {
      if (body.p_round_id !== FIXTURE_IDS.publicRound) {
        fixtureState.contractViolationCount += 1;
        return jsonResponse(route, { message: 'Synthetic public round id mismatch' }, 400);
      }
      if (rpc === 'public_round_get_v2') {
        if (state === 'error') {
          return jsonResponse(route, { code: 'PGRST500', message: 'Synthetic round read failure' }, 503);
        }
        return jsonResponse(route, [publicRoundFixture(state === 'closed' ? 'closed' : 'active')]);
      }
      if (rpc === 'public_round_cast_v2') {
        fixtureState.simulatedMutationRequestCount += 1;
        if (!isUuid(body.p_client_id) || body.p_choice !== '대중교통 확대') {
          fixtureState.contractViolationCount += 1;
          return jsonResponse(route, { message: 'Synthetic public vote contract mismatch' }, 400);
        }
        return jsonResponse(route, state === 'duplicate' ? 'duplicate' : 'ok');
      }
      if (rpc === 'public_round_votes_v2' && state === 'closed') {
        return jsonResponse(route, [
          { choice: '대중교통 확대', vote_count: 2, total_votes: 3, average_score: null },
          { choice: '보행 환경 개선', vote_count: 1, total_votes: 3, average_score: null },
        ]);
      }
    } else {
      if (body.p_token !== PUBLIC_BALLOT_TOKEN) {
        fixtureState.contractViolationCount += 1;
        return jsonResponse(route, { message: 'Synthetic ballot token mismatch' }, 400);
      }
      if (rpc === 'ballot_get') {
        if (state === 'error') {
          return jsonResponse(route, { code: 'PGRST500', message: 'Synthetic ballot read failure' }, 503);
        }
        const status = state === 'closed' ? 'closed' : state === 'published' ? 'published' : 'open';
        return jsonResponse(route, publicBallotFixture(status));
      }
      if (rpc === 'ballot_submit') {
        fixtureState.simulatedMutationRequestCount += 1;
        const answers = body.p_answers;
        if (!isUuid(body.p_client_id)
          || !hasExactFields(answers, [FIXTURE_IDS.publicBallotItemOne, FIXTURE_IDS.publicBallotItemTwo])
          || answers[FIXTURE_IDS.publicBallotItemOne] !== 1
          || answers[FIXTURE_IDS.publicBallotItemTwo] !== 1) {
          fixtureState.contractViolationCount += 1;
          return jsonResponse(route, { message: 'Synthetic ballot submission contract mismatch' }, 400);
        }
        if (state === 'duplicate') {
          return jsonResponse(route, { code: '23505', message: 'already submitted' }, 409);
        }
        return jsonResponse(route, null);
      }
      if (rpc === 'ballot_results' && state === 'published') {
        return jsonResponse(route, publicBallotResultsFixture());
      }
    }

    fixtureState.contractViolationCount += 1;
    return jsonResponse(route, { message: `RPC ${rpc} is invalid for synthetic state ${state}` }, 409);
  });

  return {
    evidence: async () => ({
      ...fixtureState,
      liveDatabaseMutationCount: 0,
      webSocket: fixtureWebSocketEvidence(fixtureState),
    }),
  };
}

const preparePublicRoundState = (state) => (options) => preparePublicParticipantFixture({
  ...options,
  kind: 'round',
  state,
});

const preparePublicBallotState = (state) => (options) => preparePublicParticipantFixture({
  ...options,
  kind: 'ballot',
  state,
});

async function assertFocused(locator, label) {
  await locator.focus();
  if (!await locator.evaluate((element) => document.activeElement === element)) {
    throw new Error(`${label} did not receive keyboard focus`);
  }
}

async function exercisePublicRoundOpen({ page }) {
  const group = page.getByRole('group', { name: '보기' });
  await group.waitFor({ state: 'visible', timeout: 10_000 });
  const first = group.getByRole('button', { name: /대중교통 확대/ });
  const second = group.getByRole('button', { name: /보행 환경 개선/ });
  await assertFocused(first, 'First public round choice');
  await page.keyboard.press('Tab');
  if (!await second.evaluate((element) => document.activeElement === element)) {
    throw new Error('Public round choices do not follow DOM keyboard order');
  }
}

const exercisePublicRoundSubmission = (expectedHeading) => async ({ page }) => {
  const choice = page.getByRole('button', { name: /대중교통 확대/ });
  await choice.waitFor({ state: 'visible', timeout: 10_000 });
  await assertFocused(choice, 'Public round choice');
  await choice.press('Enter');
  await page.getByRole('heading', { name: expectedHeading }).waitFor({ state: 'visible', timeout: 10_000 });
  await assertFocused(page.getByRole('button', { name: '투표 마감 여부 확인' }), 'Public round refresh');
};

async function exercisePublicBallotOpen({ page }) {
  const first = page.getByRole('group', { name: '의제 1 응답' }).getByRole('button').first();
  const second = page.getByRole('group', { name: '의제 1 응답' }).getByRole('button').nth(1);
  await first.waitFor({ state: 'visible', timeout: 10_000 });
  await assertFocused(first, 'First multi-agenda choice');
  await page.keyboard.press('Tab');
  if (!await second.evaluate((element) => document.activeElement === element)) {
    throw new Error('Multi-agenda choices do not follow DOM keyboard order');
  }
}

async function answerPublicBallot(page) {
  for (const ordinal of [1, 2]) {
    const choice = page.getByRole('group', { name: `의제 ${ordinal} 응답` }).getByRole('button').first();
    await choice.waitFor({ state: 'visible', timeout: 10_000 });
    await choice.focus();
    await choice.press('Enter');
  }
}

const exercisePublicBallotSubmission = (expectedHeading) => async ({ page }) => {
  await answerPublicBallot(page);
  const trigger = page.getByRole('button', { name: '제출하기', exact: true });
  await assertFocused(trigger, 'Multi-agenda submit trigger');
  await trigger.press('Enter');
  const dialog = page.getByRole('dialog', { name: '답변을 제출할까요?' });
  await dialog.waitFor({ state: 'visible', timeout: 10_000 });
  const cancel = dialog.getByRole('button', { name: '다시 살펴보기' });
  const confirm = dialog.getByRole('button', { name: '제출하기', exact: true });
  if (!await cancel.evaluate((element) => document.activeElement === element)) {
    throw new Error('Multi-agenda confirmation did not move focus into the modal');
  }
  await page.keyboard.press('Tab');
  if (!await confirm.evaluate((element) => document.activeElement === element)) {
    throw new Error('Multi-agenda confirmation did not trap forward focus');
  }
  await confirm.press('Enter');
  await page.getByRole('heading', { name: expectedHeading }).waitFor({ state: 'visible', timeout: 10_000 });
  await assertFocused(page.getByRole('button', { name: '결과 공개 여부 확인' }), 'Multi-agenda refresh');
};

const exerciseRetryState = (heading, buttonName) => async ({ page }) => {
  await page.getByRole('heading', { name: heading }).waitFor({ state: 'visible', timeout: 10_000 });
  await assertFocused(page.getByRole('button', { name: buttonName }), `${heading} retry`);
};

async function exercisePublicRoundClosed({ page }) {
  await page.getByRole('heading', { name: '이동권 개선 우선순위' }).waitFor({ state: 'visible', timeout: 10_000 });
  await page.getByText('총 3표', { exact: true }).waitFor({ state: 'visible', timeout: 10_000 });
}

async function exercisePublicBallotClosed({ page }) {
  await page.getByRole('heading', { name: '의견조사가 마감되었습니다' }).waitFor({ state: 'visible', timeout: 10_000 });
  await assertFocused(page.getByRole('button', { name: '결과 공개 여부 확인' }), 'Closed ballot refresh');
}

async function exercisePublicBallotPublished({ page }) {
  await page.getByRole('heading', { name: '기후 행동 우선순위 설문' }).waitFor({ state: 'visible', timeout: 10_000 });
  await page.getByText('기기 응답 3건', { exact: true }).waitFor({ state: 'visible', timeout: 10_000 });
}

async function prepareModeratorConsole({ context, page, baseUrl }) {
  const accessToken = 'a'.repeat(64);
  const expiresAt = '2026-09-13T13:00:00.000Z';
  const deviceId = '00000000-0000-4000-8000-000000000091';
  const team = {
    id: '00000000-0000-4000-8000-000000000092',
    name: '접근성 감사 합성 조',
    subgroup: '합성 분과',
    capacity: 12,
    table_no: 'T-01',
  };
  const session = {
    id: '00000000-0000-4000-8000-000000000093',
    slug: '0912-deliberation',
    title: '접근성 감사 합성 세션',
  };
  const tokenResponse = {
    v: 1,
    accessToken,
    expiresAt,
    deviceId,
    deviceLabel: '합성 기기',
    deviceStatus: 'active',
    sessionId: session.id,
    sessionSlug: session.slug,
    team,
  };
  const topicRows = [{
    id: '00000000-0000-4000-8000-000000000094',
    ordinal: 1,
    block: 'am',
    prompt: '접근성 감사 합성 꼭지',
    guidance: '개인정보 없는 브라우저 fixture',
    status: 'open',
    deadline_at: null,
    server_now: '2026-09-12T01:00:00.000Z',
  }];
  const fixtureState = {
    supabaseHttpRequestCount: 0,
    unexpectedSupabaseRequestCount: 0,
    unexpectedSupabasePaths: [],
    blockedExternalRequestCount: 0,
    blockedExternalOrigins: [],
    escapedNetworkRequestCount: 0,
    escapedNetworkOrigins: [],
    webSocketRoutingInstalled: false,
    webSocketRouteAttemptCount: 0,
    syntheticWebSocketAttemptCount: 0,
    blockedExternalWebSocketAttemptCount: 0,
    blockedExternalWebSocketOrigins: [],
    contractViolationCount: 0,
    mutationRequestCount: 0,
    expectedRpcCalls: {
      mod_exchange_join_code: 0,
      mod_session_get: 0,
      topic_list_v2: 0,
      submission_get_v2: 0,
      mod_rounds_v2: 0,
      mod_session_teams_v2: 0,
      mod_vote_counts_v2: 0,
      mod_votes_v2: 0,
    },
  };
  const baseOrigin = new URL(baseUrl).origin;

  await context.addInitScript(({ supabaseOrigin }) => {
    localStorage.removeItem('climate_vote_mod_session_v1');
    globalThis.__modAccessibilityWebSocket = {
      stubbed: true,
      stubConnectionAttemptCount: 0,
      actualNetworkConnectionCount: 0,
      blockedExternalConnectionAttemptCount: 0,
      blockedExternalOrigins: [],
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
        globalThis.__modAccessibilityWebSocket.stubConnectionAttemptCount += 1;
        const origin = new URL(this.url, globalThis.location.href).origin;
        if (origin !== supabaseOrigin) {
          globalThis.__modAccessibilityWebSocket.blockedExternalConnectionAttemptCount += 1;
          if (!globalThis.__modAccessibilityWebSocket.blockedExternalOrigins.includes(origin)) {
            globalThis.__modAccessibilityWebSocket.blockedExternalOrigins.push(origin);
          }
        }
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
  }, { supabaseOrigin: SUPABASE_ORIGIN });

  await installFixtureNetworkIsolation({ page, baseOrigin, fixtureState });
  await installFixtureWebSocketIsolation({ context, fixtureState });

  await page.route(`${SUPABASE_ORIGIN}/**`, async (route) => {
    fixtureState.supabaseHttpRequestCount += 1;
    const path = new URL(route.request().url()).pathname;
    const rpc = path.split('/').pop() ?? '';
    let body = {};
    try {
      body = route.request().postDataJSON() ?? {};
    } catch {
      fixtureState.contractViolationCount += 1;
      return jsonResponse(route, { message: 'Invalid synthetic moderator RPC body' }, 400);
    }
    if (!Object.hasOwn(fixtureState.expectedRpcCalls, rpc)) {
      fixtureState.unexpectedSupabaseRequestCount += 1;
      fixtureState.unexpectedSupabasePaths.push(path);
      return jsonResponse(route, { message: `Unexpected moderator audit fixture request: ${path}` }, 500);
    }
    fixtureState.expectedRpcCalls[rpc] += 1;
    if (rpc === 'mod_exchange_join_code') {
      const validDeviceId = typeof body.p_device_id === 'string'
        && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.p_device_id);
      if (!/^\d{6}$/.test(body.p_join_code ?? '') || !validDeviceId) {
        fixtureState.contractViolationCount += 1;
        return jsonResponse(route, { message: 'Synthetic moderator exchange contract mismatch' }, 400);
      }
      return jsonResponse(route, tokenResponse);
    }
    if (body.p_token !== accessToken) {
      fixtureState.contractViolationCount += 1;
      return jsonResponse(route, { message: 'Synthetic moderator token contract mismatch' }, 401);
    }
    if (rpc === 'mod_session_get') return jsonResponse(route, tokenResponse);
    if (rpc === 'topic_list_v2') {
      return jsonResponse(route, topicRows);
    }
    if (rpc === 'submission_get_v2') {
      if (body.p_topic_id !== topicRows[0].id) {
        fixtureState.contractViolationCount += 1;
        return jsonResponse(route, { message: 'Synthetic moderator topic contract mismatch' }, 400);
      }
      return jsonResponse(route, { status: 'draft', version: 0, updated_at: null, items: [] });
    }
    if (['mod_rounds_v2', 'mod_session_teams_v2', 'mod_vote_counts_v2', 'mod_votes_v2'].includes(rpc)) {
      return jsonResponse(route, []);
    }
    fixtureState.unexpectedSupabaseRequestCount += 1;
    fixtureState.unexpectedSupabasePaths.push(path);
    return jsonResponse(route, { message: `Unhandled moderator audit fixture request: ${path}` }, 500);
  });

  return {
    evidence: async () => {
      const windowWebSocket = await page.evaluate(() => globalThis.__modAccessibilityWebSocket ?? {
        stubbed: false,
        stubConnectionAttemptCount: 0,
        actualNetworkConnectionCount: 0,
        blockedExternalConnectionAttemptCount: 0,
        blockedExternalOrigins: [],
      });
      return {
        ...fixtureState,
        liveDatabaseMutationCount: 0,
        workshopSessionPersisted: await page.evaluate(() => localStorage.getItem('climate_vote_mod_session_v1') !== null),
        webSocket: {
          stubbed: windowWebSocket.stubbed === true && fixtureState.webSocketRoutingInstalled,
          stubConnectionAttemptCount: windowWebSocket.stubConnectionAttemptCount
            + fixtureState.webSocketRouteAttemptCount
            + fixtureState.workerWebSocketAttemptCount,
          actualNetworkConnectionCount: 0,
          blockedExternalConnectionAttemptCount: windowWebSocket.blockedExternalConnectionAttemptCount
            + fixtureState.blockedExternalWebSocketAttemptCount,
          blockedExternalOrigins: [...new Set([
            ...windowWebSocket.blockedExternalOrigins,
            ...fixtureState.blockedExternalWebSocketOrigins,
          ])].sort(),
        },
      };
    },
  };
}

async function exerciseModeratorTimerTab({ page }) {
  const submissionTab = page.getByRole('tab', { name: '조별 산출물' });
  const timerTab = page.getByRole('tab', { name: '타이머' });
  await submissionTab.waitFor({ state: 'visible', timeout: 10_000 });
  await assertFocused(submissionTab, 'Moderator submission tab');
  await submissionTab.press('End');
  await page.locator('#mod-panel-timer:not([hidden])').waitFor({ state: 'visible', timeout: 10_000 });
  if (await timerTab.getAttribute('aria-selected') !== 'true'
    || !await timerTab.evaluate((element) => document.activeElement === element)) {
    throw new Error('Moderator timer tab did not become the selected keyboard destination');
  }
}

async function prepareWorkshopHqDashboard({ context, page, baseUrl }) {
  const token = 'd'.repeat(64);
  const teamId = '00000000-0000-4000-8000-000000000095';
  const topicId = '00000000-0000-4000-8000-000000000096';
  const fixtureState = {
    supabaseHttpRequestCount: 0,
    unexpectedSupabaseRequestCount: 0,
    unexpectedSupabasePaths: [],
    blockedExternalRequestCount: 0,
    blockedExternalOrigins: [],
    escapedNetworkRequestCount: 0,
    escapedNetworkOrigins: [],
    webSocketRoutingInstalled: false,
    webSocketRouteAttemptCount: 0,
    syntheticWebSocketAttemptCount: 0,
    blockedExternalWebSocketAttemptCount: 0,
    blockedExternalWebSocketOrigins: [],
    contractViolationCount: 0,
    mutationRequestCount: 0,
  };
  const baseOrigin = new URL(baseUrl).origin;
  const readRpcNames = new Set([
    'workshop_hq_status',
    'workshop_hq_devices',
    'attendance_roster_v2',
    'attendance_hq_summary_v2',
    'attendance_hq_audit_v2',
    'hq_submissions_v3',
    'hq_submission_history_v2',
    'hq_submission_categories_v3',
    'hq_submission_kinds_v3',
    'hq_topic_deadlines_v2',
    'hq_teams_v2',
    'hq_rounds_v2',
    'hq_vote_counts_v2',
    'hq_votes_v2',
  ]);
  const mutationRpcNames = new Set([
    'workshop_hq_open_next_topic',
    'workshop_hq_set_topic_status',
    'workshop_hq_revoke_device',
    'workshop_hq_set_deadline',
    'workshop_hq_rotate_join_codes',
    'attendance_set_v2',
    'attendance_bulk_present_v2',
    'attendance_finalize_absent_v2',
    'attendance_member_save_v2',
    'attendance_hq_set_team_pin_v2',
    'attendance_hq_set_table_no_v2',
    'submission_reopen_v2',
    'hq_submission_category_assign_v3',
    'hq_submission_kind_assign_v3',
    'hq_clear_submissions_v3',
  ]);

  await context.addInitScript(({ hqToken, supabaseOrigin }) => {
    sessionStorage.setItem('climate_vote_hq_attendance_token', hqToken);
    sessionStorage.setItem('climate_vote_hq_gate_actor', '접근성 감사자');
    globalThis.__hqAccessibilityWebSocket = {
      stubbed: true,
      stubConnectionAttemptCount: 0,
      actualNetworkConnectionCount: 0,
      blockedExternalConnectionAttemptCount: 0,
      blockedExternalOrigins: [],
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
        globalThis.__hqAccessibilityWebSocket.stubConnectionAttemptCount += 1;
        const origin = new URL(this.url, globalThis.location.href).origin;
        if (origin !== supabaseOrigin) {
          globalThis.__hqAccessibilityWebSocket.blockedExternalConnectionAttemptCount += 1;
          if (!globalThis.__hqAccessibilityWebSocket.blockedExternalOrigins.includes(origin)) {
            globalThis.__hqAccessibilityWebSocket.blockedExternalOrigins.push(origin);
          }
        }
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
  }, { hqToken: token, supabaseOrigin: SUPABASE_ORIGIN });

  // No third-party request is allowed to leave the fixture. Same-origin app assets
  // and the explicitly mocked Supabase origin are the only permitted destinations.
  await installFixtureNetworkIsolation({ page, baseOrigin, fixtureState });
  await installFixtureWebSocketIsolation({ context, fixtureState });

  await page.route(`${SUPABASE_ORIGIN}/**`, async (route) => {
    fixtureState.supabaseHttpRequestCount += 1;
    const path = new URL(route.request().url()).pathname;
    const rpc = path.split('/').pop() ?? '';
    let body = {};
    try {
      body = route.request().postDataJSON() ?? {};
    } catch {
      fixtureState.contractViolationCount += 1;
      return jsonResponse(route, { message: 'Invalid synthetic RPC body' }, 400);
    }
    if (!readRpcNames.has(rpc) && !mutationRpcNames.has(rpc)) {
      fixtureState.unexpectedSupabaseRequestCount += 1;
      fixtureState.unexpectedSupabasePaths.push(path);
      return jsonResponse(route, { message: `Unexpected HQ audit fixture request: ${path}` }, 500);
    }
    if (body.p_token !== token || body.p_session_slug !== '0912-deliberation') {
      fixtureState.contractViolationCount += 1;
      return jsonResponse(route, { message: 'Synthetic HQ token/session contract mismatch' }, 401);
    }
    if (mutationRpcNames.has(rpc)) {
      fixtureState.mutationRequestCount += 1;
      return jsonResponse(route, { message: 'Mutation disabled during accessibility audit' }, 409);
    }
    if (rpc === 'workshop_hq_status') {
      return jsonResponse(route, {
        session_id: FIXTURE_IDS.session,
        session_slug: '0912-deliberation',
        session_title: '접근성 감사 합성 세션',
        org_name: '접근성 감사 합성 기관',
        topic_total: 6,
        topic_open: 1,
        topic_closed: 0,
        next_topic_id: FIXTURE_IDS.topicSecondary,
        next_topic_ordinal: 2,
        next_topic_prompt: '접근성 감사 다음 꼭지',
        teams_total: 15,
        active_devices: 1,
        teams_online: 1,
        submissions_draft: 1,
        submissions_final: 0,
        last_activity_at: '2026-09-12T01:05:00.000Z',
        topics: [
          { id: topicId, ordinal: 1, prompt: '접근성 감사 합성 꼭지', status: 'open', deadline_at: null },
          ...Array.from({ length: 5 }, (_, index) => ({
            id: `00000000-0000-4000-8000-${String(97 + index).padStart(12, '0')}`,
            ordinal: index + 2,
            prompt: `접근성 감사 합성 꼭지 ${index + 2}`,
            status: 'draft',
            deadline_at: null,
          })),
        ],
      });
    }
    if (rpc === 'workshop_hq_devices') {
      return jsonResponse(route, [{
        token_hash: 'e'.repeat(64),
        team_id: teamId,
        team_name: '접근성 감사 합성 조',
        device_id: '00000000-0000-4000-8000-000000000103',
        device_label: '합성 노트북',
        last_seen_at: '2026-09-12T01:05:00.000Z',
        expires_at: '2026-09-13T13:00:00.000Z',
      }]);
    }
    if (rpc === 'attendance_roster_v2') {
      return jsonResponse(route, [{
        assignment_id: '00000000-0000-4000-8000-000000000105',
        member_id: '00000000-0000-4000-8000-000000000106',
        official_id: 'AUDIT-001',
        member_name: '접근성 감사 참가자',
        team_id: teamId,
        team_name: '접근성 감사 합성 조',
        active: true,
        base_status: 'present',
        checked_in_at: '2026-09-12T01:00:00.000Z',
        is_late: false,
        checked_out_at: null,
        is_early_leave: false,
        updated_at: '2026-09-12T01:05:00.000Z',
      }]);
    }
    if (rpc === 'attendance_hq_summary_v2') {
      return jsonResponse(route, [{
        team_id: teamId,
        team_name: '접근성 감사 합성 조',
        subgroup: '합성 분과',
        table_no: 'T-01',
        roster_total: 1,
        current_present: 1,
        late: 0,
        early_leave: 0,
        absent: 0,
        unconfirmed: 0,
      }]);
    }
    if (rpc === 'hq_submissions_v3') {
      return jsonResponse(route, [{
        topic_id: topicId,
        topic_ordinal: 1,
        topic_prompt: '접근성 감사 합성 꼭지',
        topic_status: 'open',
        team_id: teamId,
        team_name: '접근성 감사 합성 조',
        team_subgroup: '합성 분과',
        table_no: 'T-01',
        submission_id: '00000000-0000-4000-8000-000000000104',
        submission_status: 'draft',
        submission_version: 1,
        submission_updated_at: '2026-09-12T01:04:00.000Z',
        submission_finalized_at: null,
        item_ordinal: 1,
        item_id: '00000000-0000-4000-8000-000000000107',
        item_kind: 'core',
        item_content: '개인정보 없는 접근성 감사 합성 문장',
        item_rationale: null,
      }]);
    }
    if (rpc === 'hq_topic_deadlines_v2') {
      return jsonResponse(route, [{ topic_id: topicId, topic_ordinal: 1, deadline_at: null }]);
    }
    return jsonResponse(route, []);
  });

  return {
    evidence: async () => {
      const windowWebSocket = await page.evaluate(() => globalThis.__hqAccessibilityWebSocket ?? {
        stubbed: false,
        stubConnectionAttemptCount: 0,
        actualNetworkConnectionCount: 0,
        blockedExternalConnectionAttemptCount: 0,
        blockedExternalOrigins: [],
      });
      return {
        ...fixtureState,
        liveDatabaseMutationCount: 0,
        webSocket: {
          stubbed: windowWebSocket.stubbed === true && fixtureState.webSocketRoutingInstalled,
          stubConnectionAttemptCount: windowWebSocket.stubConnectionAttemptCount
            + fixtureState.webSocketRouteAttemptCount
            + fixtureState.workerWebSocketAttemptCount,
          actualNetworkConnectionCount: 0,
          blockedExternalConnectionAttemptCount: windowWebSocket.blockedExternalConnectionAttemptCount
            + fixtureState.blockedExternalWebSocketAttemptCount,
          blockedExternalOrigins: [...new Set([
            ...windowWebSocket.blockedExternalOrigins,
            ...fixtureState.blockedExternalWebSocketOrigins,
          ])].sort(),
        },
      };
    },
  };
}

async function exerciseWorkshopHqSubmissions({ page }) {
  await page.locator('#workshop-hq-title').waitFor({ state: 'visible', timeout: 10_000 });
  const devices = page.getByRole('button', { name: /접속 기기 1대 보기/ });
  await devices.click();
  await page.getByRole('region', { name: '접근성 감사 합성 조 접속 기기' })
    .waitFor({ state: 'visible', timeout: 10_000 });
}

async function exerciseWorkshopHqDashboard({ page }) {
  await page.locator('#workshop-hq-title').waitFor({ state: 'visible', timeout: 10_000 });
  const submissionsTab = page.getByRole('tab', { name: '조별 산출물' });
  const gridTab = page.getByRole('tab', { name: '투표·출석 현황' });
  const gridLoaded = page.waitForResponse((response) => (
    new URL(response.url()).pathname.endsWith('/rpc/hq_rounds_v2')
  ));
  await assertFocused(submissionsTab, 'HQ submissions tab');
  await submissionsTab.press('ArrowRight');
  await gridLoaded;
  if (await gridTab.getAttribute('aria-selected') !== 'true'
    || !await gridTab.evaluate((element) => document.activeElement === element)
    || !await page.locator('#hq-console-content[role="tabpanel"] h1', { hasText: '기후시민회의 운영 현황' }).isVisible()) {
    throw new Error('HQ grid tab did not remain mounted and selected after keyboard navigation');
  }
}

export const DEFAULT_AUDIT_ROUTES = [
  {
    id: 'platform-login',
    path: '/platform/',
    skipTarget: 'platform-scope-content',
    fixture: 'ci-login-keyboard-fixture-v1',
    afterNavigation: preparePlatformLoginKeyboardAudit,
    requiredKeyboardFocusOrder: [
      '#platform-email',
      '#platform-password',
      'button[type="submit"]',
      'a[href="/platform/accessibility/"]',
    ],
  },
  {
    id: 'platform-login-error',
    path: '/platform/',
    skipTarget: 'platform-scope-content',
    fixture: 'ci-login-rejection-fixture-v1',
    readySelector: '#platform-login-error[role="alert"]',
    prepare: prepareRejectedPlatformLogin,
    afterNavigation: exerciseRejectedPlatformLogin,
  },
  {
    id: 'authenticated-platform',
    path: '/platform/',
    skipTarget: 'platform-scope-content',
    fixture: 'ci-staff-read-fixture-v1',
    readySelector: 'aside button[aria-current="location"]',
    prepare: prepareAuthenticatedPlatform,
  },
  { id: 'accessibility-statement', path: '/platform/accessibility/', skipTarget: 'main-content' },
  { id: 'public-result-unpublished', path: '/r/_/', skipTarget: 'main-content' },
  {
    id: 'published-result',
    path: '/r/_/',
    skipTarget: 'main-content',
    fixture: 'ci-published-result-read-fixture-v1',
    readySelector: 'main#main-content [data-source-reference-ready="true"]',
    openDetailsBeforeAudit: true,
    requiredMobileScrollRegions: ['조별 쟁점 커버리지 표', '쟁점 분석 데이터 표'],
    prepare: preparePublishedResult,
  },
  {
    id: 'ontology-review',
    path: '/ko/moderator/ontology-review/',
    skipTarget: 'ontology-review-content',
    fixture: 'ci-staff-read-fixture-v1',
    readySelector: 'main[data-ontology-review-ready="true"]',
    prepare: prepareAuthenticatedPlatform,
  },
  {
    id: 'public-vote-open',
    path: `/v?r=${FIXTURE_IDS.publicRound}`,
    skipTarget: 'public-vote-content',
    fixture: 'ci-public-round-open-read-fixture-v1',
    requiresFixtureEvidence: true,
    readySelector: '[role="group"][aria-label="보기"]',
    prepare: preparePublicRoundState('open'),
    afterNavigation: exercisePublicRoundOpen,
  },
  {
    id: 'public-vote-submitted',
    path: `/v?r=${FIXTURE_IDS.publicRound}`,
    skipTarget: 'public-vote-content',
    fixture: 'ci-public-round-submit-fixture-v1',
    requiresFixtureEvidence: true,
    readySelector: 'h1',
    prepare: preparePublicRoundState('submitted'),
    afterNavigation: exercisePublicRoundSubmission('투표가 제출되었습니다'),
  },
  {
    id: 'public-vote-duplicate',
    path: `/v?r=${FIXTURE_IDS.publicRound}`,
    skipTarget: 'public-vote-content',
    fixture: 'ci-public-round-duplicate-fixture-v1',
    requiresFixtureEvidence: true,
    readySelector: 'h1',
    prepare: preparePublicRoundState('duplicate'),
    afterNavigation: exercisePublicRoundSubmission('이미 참여하셨습니다'),
  },
  {
    id: 'public-vote-closed',
    path: `/v?r=${FIXTURE_IDS.publicRound}`,
    skipTarget: 'public-vote-content',
    fixture: 'ci-public-round-closed-read-fixture-v1',
    requiresFixtureEvidence: true,
    readySelector: 'h1',
    prepare: preparePublicRoundState('closed'),
    afterNavigation: exercisePublicRoundClosed,
  },
  {
    id: 'public-vote-error',
    path: `/v?r=${FIXTURE_IDS.publicRound}`,
    skipTarget: 'public-vote-content',
    fixture: 'ci-public-round-read-error-fixture-v1',
    requiresFixtureEvidence: true,
    readySelector: 'h1',
    prepare: preparePublicRoundState('error'),
    afterNavigation: exerciseRetryState('투표 정보를 불러오지 못했습니다', '다시 불러오기'),
  },
  {
    id: 'public-ballot-open',
    path: `/b?t=${PUBLIC_BALLOT_TOKEN}`,
    skipTarget: 'public-ballot-content',
    fixture: 'ci-public-ballot-open-read-fixture-v1',
    requiresFixtureEvidence: true,
    readySelector: '[role="group"][aria-label="의제 1 응답"]',
    prepare: preparePublicBallotState('open'),
    afterNavigation: exercisePublicBallotOpen,
  },
  {
    id: 'public-ballot-submitted',
    path: `/b?t=${PUBLIC_BALLOT_TOKEN}`,
    skipTarget: 'public-ballot-content',
    fixture: 'ci-public-ballot-submit-fixture-v1',
    requiresFixtureEvidence: true,
    readySelector: 'h1',
    prepare: preparePublicBallotState('submitted'),
    afterNavigation: exercisePublicBallotSubmission('의견이 제출되었습니다'),
  },
  {
    id: 'public-ballot-duplicate',
    path: `/b?t=${PUBLIC_BALLOT_TOKEN}`,
    skipTarget: 'public-ballot-content',
    fixture: 'ci-public-ballot-duplicate-fixture-v1',
    requiresFixtureEvidence: true,
    readySelector: 'h1',
    prepare: preparePublicBallotState('duplicate'),
    afterNavigation: exercisePublicBallotSubmission('이미 제출하셨습니다'),
  },
  {
    id: 'public-ballot-closed',
    path: `/b?t=${PUBLIC_BALLOT_TOKEN}`,
    skipTarget: 'public-ballot-content',
    fixture: 'ci-public-ballot-closed-read-fixture-v1',
    requiresFixtureEvidence: true,
    readySelector: 'h1',
    prepare: preparePublicBallotState('closed'),
    afterNavigation: exercisePublicBallotClosed,
  },
  {
    id: 'public-ballot-published',
    path: `/b?t=${PUBLIC_BALLOT_TOKEN}`,
    skipTarget: 'public-ballot-content',
    fixture: 'ci-public-ballot-published-read-fixture-v1',
    requiresFixtureEvidence: true,
    readySelector: 'h1',
    prepare: preparePublicBallotState('published'),
    afterNavigation: exercisePublicBallotPublished,
  },
  {
    id: 'public-ballot-error',
    path: `/b?t=${PUBLIC_BALLOT_TOKEN}`,
    skipTarget: 'public-ballot-content',
    fixture: 'ci-public-ballot-read-error-fixture-v1',
    requiresFixtureEvidence: true,
    readySelector: 'h1',
    prepare: preparePublicBallotState('error'),
    afterNavigation: exerciseRetryState('투표 화면에 연결하지 못했습니다', '다시 불러오기'),
  },
  {
    id: 'moderator-console',
    path: '/mod?code=000000',
    skipTarget: 'mod-console-content',
    fixture: 'ci-0912-synthetic-read-fixture-v1',
    requiresFixtureEvidence: true,
    readySelector: '#mod-console-content [data-testid="workshop-status-rail"]',
    requiredMobileScrollRegions: ['조 작업 상태 가로 목록'],
    prepare: prepareModeratorConsole,
  },
  {
    id: 'moderator-console-timer',
    path: '/mod?code=000000',
    skipTarget: 'mod-console-content',
    fixture: 'ci-0912-synthetic-timer-fixture-v1',
    requiresFixtureEvidence: true,
    readySelector: '#mod-panel-timer:not([hidden])',
    requiredMobileScrollRegions: ['조 작업 상태 가로 목록'],
    prepare: prepareModeratorConsole,
    afterNavigation: exerciseModeratorTimerTab,
  },
  {
    id: 'hq-console-gate',
    path: '/hq',
    skipTarget: 'hq-console-content',
    fixture: 'ci-hq-gate-no-secret-v1',
    requiresFixtureEvidence: true,
    readySelector: '#hq-gate-title',
    prepare: prepareHqGateFixture,
  },
  {
    id: 'hq-console-submissions',
    path: '/hq',
    skipTarget: 'hq-console-content',
    fixture: 'ci-0912-hq-submissions-read-fixture-v1',
    requiresFixtureEvidence: true,
    readySelector: '[aria-label="접근성 감사 합성 조 접속 기기"]',
    prepare: prepareWorkshopHqDashboard,
    afterNavigation: exerciseWorkshopHqSubmissions,
  },
  {
    id: 'hq-console-dashboard',
    path: '/hq?ops=1',
    skipTarget: 'hq-console-content',
    fixture: 'ci-0912-hq-dashboard-read-fixture-v1',
    requiresFixtureEvidence: true,
    readySelector: '#hq-console-content h1',
    prepare: prepareWorkshopHqDashboard,
    afterNavigation: exerciseWorkshopHqDashboard,
  },
];

export const DEFAULT_EXCLUDED_SURFACES = [
  {
    id: 'assistive-technology-manual-evaluation',
    reason: 'Screen reader and mobile assistive-technology evaluation requires manual testing.',
  },
];

function routeUrl(baseUrl, path) {
  return path.startsWith('data:') ? path : new URL(path, baseUrl).toString();
}

function violationEvidence(violation) {
  return {
    id: violation.id,
    impact: violation.impact,
    help: violation.help,
    helpUrl: violation.helpUrl,
    tags: violation.tags,
    nodes: violation.nodes.map((node) => ({
      target: node.target,
      failureSummary: node.failureSummary,
    })),
  };
}

async function inspectSkipLink(page, expectedTarget) {
  const candidates = page.locator('a[href^="#"]');
  let skipLink = null;
  for (let index = 0; index < await candidates.count(); index += 1) {
    const candidate = candidates.nth(index);
    const href = await candidate.getAttribute('href');
    if (href?.startsWith('#') && decodeURIComponent(href.slice(1)) === expectedTarget) {
      skipLink = candidate;
      break;
    }
  }
  if (!skipLink) return { found: false, target: expectedTarget, focusMoved: false };

  await skipLink.focus();
  await skipLink.press('Enter');
  await page.waitForTimeout(50);
  const focusMoved = await page.evaluate(
    (targetId) => document.activeElement?.id === targetId,
    expectedTarget,
  );
  return { found: true, target: expectedTarget, focusMoved };
}

async function inspectRequiredScrollRegions(page, labels) {
  const results = [];
  for (const label of labels) {
    const region = page.getByRole('region', { name: label, exact: true });
    if (await region.count() !== 1) {
      results.push({ label, found: false, scrollable: false, focused: false, keyboardScrolled: false });
      continue;
    }
    const initial = await region.evaluate((element) => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
    }));
    await region.focus();
    const focused = await region.evaluate((element) => document.activeElement === element);
    await region.press('End');
    await page.waitForTimeout(50);
    let scrollLeft = await region.evaluate((element) => element.scrollLeft);
    if (scrollLeft <= 0) {
      for (let attempt = 0; attempt < 4 && scrollLeft <= 0; attempt += 1) {
        await region.press('ArrowRight');
        await page.waitForTimeout(25);
        scrollLeft = await region.evaluate((element) => element.scrollLeft);
      }
    }
    await region.evaluate((element) => { element.scrollLeft = 0; });
    results.push({
      label,
      found: true,
      ...initial,
      scrollable: initial.scrollWidth > initial.clientWidth + 1,
      focused,
      keyboardScrolled: scrollLeft > 0,
    });
  }
  return results;
}

async function inspectRequiredKeyboardFocusOrder(page, expected) {
  const emptyFocusAppearance = {
    required: false,
    minimumOutlineWidthPx: 2,
    minimumContrastRatio: 3,
    indicators: [],
    passed: true,
  };
  if (expected.length === 0) {
    return {
      required: false,
      expected: [],
      availability: [],
      forward: [],
      reverse: [],
      forwardExit: null,
      backwardExit: null,
      escapedForward: false,
      escapedBackward: false,
      focusAppearance: emptyFocusAppearance,
      passed: true,
    };
  }

  const availability = [];
  for (const selector of expected) {
    const locator = page.locator(selector);
    const count = await locator.count();
    availability.push({
      selector,
      found: count === 1,
      visible: count === 1 && await locator.isVisible(),
      enabled: count === 1 && await locator.isEnabled(),
    });
  }

  const fingerprint = () => page.evaluate(() => {
    const element = document.activeElement;
    if (!(element instanceof HTMLElement)) return null;
    const href = element.getAttribute('href');
    return {
      tag: element.tagName.toLowerCase(),
      id: element.id || null,
      type: element.getAttribute('type'),
      role: element.getAttribute('role'),
      hrefPath: href ? new URL(href, document.baseURI).pathname : null,
    };
  });
  const capture = async (expectedSelector) => ({
    expectedSelector,
    matched: await page.evaluate(
      (selector) => document.activeElement instanceof Element && document.activeElement.matches(selector),
      expectedSelector,
    ),
    active: await fingerprint(),
    focusIndicator: await page.evaluate(() => {
      const element = document.activeElement;
      if (!(element instanceof HTMLElement)) {
        return {
          outlineStyle: null,
          outlineWidthPx: null,
          outlineOffsetPx: null,
          outlineColor: null,
          adjacentBackgroundColor: null,
          contrastRatio: null,
          passed: false,
        };
      }

      const parseColor = (value) => {
        const match = value.match(/^rgba?\(\s*([\d.]+)[, ]+\s*([\d.]+)[, ]+\s*([\d.]+)(?:\s*[,/]\s*([\d.]+))?\s*\)$/i);
        if (!match) return null;
        const alpha = match[4] === undefined ? 1 : Number.parseFloat(match[4]);
        if (!Number.isFinite(alpha) || alpha < 1) return null;
        return [Number.parseFloat(match[1]), Number.parseFloat(match[2]), Number.parseFloat(match[3])];
      };
      const luminance = (color) => {
        const components = color.map((component) => {
          const channel = component / 255;
          return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * components[0] + 0.7152 * components[1] + 0.0722 * components[2];
      };
      const contrast = (first, second) => {
        const firstLuminance = luminance(first);
        const secondLuminance = luminance(second);
        return (Math.max(firstLuminance, secondLuminance) + 0.05)
          / (Math.min(firstLuminance, secondLuminance) + 0.05);
      };
      const nearestOpaqueBackground = () => {
        let current = element.parentElement;
        while (current) {
          const color = getComputedStyle(current).backgroundColor;
          if (parseColor(color)) return color;
          current = current.parentElement;
        }
        return 'rgb(255, 255, 255)';
      };

      const style = getComputedStyle(element);
      const outlineWidthPx = Number.parseFloat(style.outlineWidth);
      const outlineOffsetPx = Number.parseFloat(style.outlineOffset);
      const adjacentBackgroundColor = nearestOpaqueBackground();
      const outlineRgb = parseColor(style.outlineColor);
      const backgroundRgb = parseColor(adjacentBackgroundColor);
      const contrastRatio = outlineRgb && backgroundRgb
        ? Number(contrast(outlineRgb, backgroundRgb).toFixed(2))
        : null;
      const passed = !['none', 'hidden'].includes(style.outlineStyle)
        && Number.isFinite(outlineWidthPx)
        && outlineWidthPx >= 2
        && contrastRatio !== null
        && contrastRatio >= 3;
      return {
        outlineStyle: style.outlineStyle,
        outlineWidthPx: Number.isFinite(outlineWidthPx) ? outlineWidthPx : null,
        outlineOffsetPx: Number.isFinite(outlineOffsetPx) ? outlineOffsetPx : null,
        outlineColor: style.outlineColor,
        adjacentBackgroundColor,
        contrastRatio,
        passed,
      };
    }),
  });
  const captureExit = (boundary) => page.evaluate((expectedBoundary) => {
    const element = document.activeElement;
    const href = element instanceof HTMLElement ? element.getAttribute('href') : null;
    const active = element instanceof HTMLElement ? {
      tag: element.tagName.toLowerCase(),
      id: element.id || null,
      type: element.getAttribute('type'),
      role: element.getAttribute('role'),
      hrefPath: href ? new URL(href, document.baseURI).pathname : null,
    } : null;
    const reachedBoundary = element instanceof HTMLElement
      && element.dataset.platformA11yFocusBoundary === expectedBoundary;
    return {
      reachedBoundary,
      active,
      escaped: reachedBoundary,
    };
  }, boundary);

  if (availability.some(({ found, visible, enabled }) => !found || !visible || !enabled)) {
    return {
      required: true,
      expected,
      availability,
      forward: [],
      reverse: [],
      forwardExit: null,
      backwardExit: null,
      escapedForward: false,
      escapedBackward: false,
      focusAppearance: {
        required: true,
        minimumOutlineWidthPx: 2,
        minimumContrastRatio: 3,
        indicators: [],
        passed: false,
      },
      passed: false,
    };
  }

  await page.evaluate(({ firstSelector, lastSelector }) => {
    const first = document.querySelector(firstSelector);
    const last = document.querySelector(lastSelector);
    if (!(first instanceof HTMLElement) || !(last instanceof HTMLElement)) {
      throw new Error('Keyboard focus boundary targets are unavailable');
    }
    const createBoundary = (boundary) => {
      const element = document.createElement('button');
      element.type = 'button';
      element.dataset.platformA11yFocusBoundary = boundary;
      element.setAttribute('aria-label', `Accessibility audit ${boundary} focus boundary`);
      element.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;padding:0;border:0;opacity:0;pointer-events:none;';
      return element;
    };
    first.before(createBoundary('before'));
    last.after(createBoundary('after'));
  }, { firstSelector: expected[0], lastSelector: expected.at(-1) });

  try {
    const forward = [];
    await page.locator(expected[0]).focus();
    forward.push(await capture(expected[0]));
    for (const selector of expected.slice(1)) {
      await page.keyboard.press('Tab');
      forward.push(await capture(selector));
    }
    await page.keyboard.press('Tab');
    const forwardExit = await captureExit('after');
    const escapedForward = forwardExit.escaped;

    const reversedExpected = [...expected].reverse();
    const reverse = [];
    await page.locator(reversedExpected[0]).focus();
    reverse.push(await capture(reversedExpected[0]));
    for (const selector of reversedExpected.slice(1)) {
      await page.keyboard.press('Shift+Tab');
      reverse.push(await capture(selector));
    }
    await page.keyboard.press('Shift+Tab');
    const backwardExit = await captureExit('before');
    const escapedBackward = backwardExit.escaped;
    const matched = [...forward, ...reverse].every((entry) => entry.matched);
    const indicators = forward.map(({ expectedSelector, focusIndicator }) => ({
      expectedSelector,
      ...focusIndicator,
    }));

    return {
      required: true,
      expected,
      availability,
      forward,
      reverse,
      forwardExit,
      backwardExit,
      escapedForward,
      escapedBackward,
      focusAppearance: {
        required: true,
        minimumOutlineWidthPx: 2,
        minimumContrastRatio: 3,
        indicators,
        passed: indicators.every((indicator) => indicator.passed),
      },
      passed: matched && escapedForward && escapedBackward,
    };
  } finally {
    await page.locator('[data-platform-a11y-focus-boundary]').evaluateAll((elements) => {
      for (const element of elements) element.remove();
    });
  }
}

async function auditRoute(browser, baseUrl, route, profile, settleMs) {
  const context = await browser.newContext({ viewport: profile.viewport, serviceWorkers: 'block' });
  const page = await context.newPage();
  let fixtureController = null;
  const readiness = route.readySelector
    ? { selector: route.readySelector, reached: false }
    : null;
  try {
    if (route.prepare) fixtureController = await route.prepare({ context, page, baseUrl }) ?? null;
    const url = routeUrl(baseUrl, route.path);
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    if (route.afterNavigation) {
      await route.afterNavigation({ context, page, baseUrl, fixtureController });
    }
    if (route.readySelector) {
      await page.waitForSelector(route.readySelector, { state: 'attached', timeout: 10_000 });
      readiness.reached = true;
    }
    if (route.openDetailsBeforeAudit) {
      await page.locator('details').evaluateAll((elements) => {
        for (const element of elements) element.open = true;
      });
    }
    if (settleMs > 0) await page.waitForTimeout(settleMs);
    await page.addScriptTag({ content: axe.source });
    const axeResult = await page.evaluate(async (tags) => globalThis.axe.run(document, {
      runOnly: { type: 'tag', values: tags },
      resultTypes: ['violations', 'incomplete'],
    }), WCAG_TAGS);
    const layout = await page.evaluate(({ targetId, minimumContentWidth }) => {
      const viewportWidth = document.documentElement.clientWidth;
      const documentWidth = Math.max(
        document.documentElement.scrollWidth,
        document.body?.scrollWidth ?? 0,
      );
      const contentWidth = document.getElementById(targetId)?.getBoundingClientRect().width ?? 0;
      const clippedOutsideScrollRegions = Array.from(document.body.querySelectorAll('*'))
        .filter((element) => {
          const scrollRegion = element.closest('[role="region"][tabindex="0"]');
          if (scrollRegion && ['auto', 'scroll'].includes(getComputedStyle(scrollRegion).overflowX)) return false;
          const rect = element.getBoundingClientRect();
          return rect.left < -1 || rect.right > viewportWidth + 1;
        })
        .slice(0, 10)
        .map((element) => ({
          tag: element.tagName.toLowerCase(),
          id: element.id || null,
          className: typeof element.className === 'string' ? element.className : null,
        }));
      const rawHorizontalOverflow = documentWidth > viewportWidth + 1;
      return {
        viewportWidth,
        documentWidth,
        rawHorizontalOverflow,
        horizontalOverflow: rawHorizontalOverflow && clippedOutsideScrollRegions.length > 0,
        contentWidth,
        minimumContentWidth,
        contentWidthSufficient: contentWidth >= minimumContentWidth,
        clippedOutsideScrollRegions,
      };
    }, { targetId: route.skipTarget, minimumContentWidth: profile.minimumContentWidth ?? 0 });
    const skipLink = await inspectSkipLink(page, route.skipTarget);
    const requiredScrollRegions = profile.id === 'mobile'
      ? await inspectRequiredScrollRegions(page, route.requiredMobileScrollRegions ?? [])
      : [];
    const keyboardFocusOrder = await inspectRequiredKeyboardFocusOrder(
      page,
      route.requiredKeyboardFocusOrder ?? [],
    );
    const violations = axeResult.violations.map(violationEvidence);
    const incomplete = axeResult.incomplete.map(violationEvidence);
    const httpStatus = response?.status() ?? null;
    const httpOk = httpStatus === null || (httpStatus >= 200 && httpStatus < 400);
    const fixtureNetwork = typeof fixtureController?.evidence === 'function'
      ? await fixtureController.evidence()
      : null;
    const fixtureNetworkRequired = route.requiresFixtureEvidence === true;
    const fixtureNetworkPassed = fixtureNetwork === null
      ? !fixtureNetworkRequired
      : fixtureNetworkPasses(fixtureNetwork);
    const passed = httpOk
      && violations.length === 0
      && incomplete.length === 0
      && skipLink.focusMoved
      && !layout.horizontalOverflow
      && layout.contentWidthSufficient
      && layout.clippedOutsideScrollRegions.length === 0
      && keyboardFocusOrder.passed
      && keyboardFocusOrder.focusAppearance.passed
      && fixtureNetworkPassed
      && requiredScrollRegions.every((region) => region.found && region.scrollable && region.focused && region.keyboardScrolled);
    return {
      id: `${route.id}:${profile.id}`,
      routeId: route.id,
      profile: profile.id,
      viewport: profile.viewport,
      path: route.path,
      url,
      fixture: route.fixture ?? null,
      fixtureNetworkRequired,
      fixtureNetwork,
      readiness,
      httpStatus,
      passed,
      skipLink,
      keyboardFocusOrder,
      requiredScrollRegions,
      layout,
      violations,
      incomplete,
      error: null,
    };
  } catch (error) {
    console.error(`Accessibility audit failed for route ${route.id} profile ${profile.id}`, error);
    return {
      id: `${route.id}:${profile.id}`,
      routeId: route.id,
      profile: profile.id,
      viewport: profile.viewport,
      path: route.path,
      url: routeUrl(baseUrl, route.path),
      fixture: route.fixture ?? null,
      fixtureNetworkRequired: route.requiresFixtureEvidence === true,
      fixtureNetwork: null,
      readiness,
      httpStatus: null,
      passed: false,
      skipLink: { found: false, target: route.skipTarget, focusMoved: false },
      keyboardFocusOrder: {
        required: Array.isArray(route.requiredKeyboardFocusOrder) && route.requiredKeyboardFocusOrder.length > 0,
        expected: Array.isArray(route.requiredKeyboardFocusOrder) ? route.requiredKeyboardFocusOrder : [],
        availability: [],
        forward: [],
        reverse: [],
        forwardExit: null,
        backwardExit: null,
        escapedForward: false,
        escapedBackward: false,
        focusAppearance: {
          required: Array.isArray(route.requiredKeyboardFocusOrder) && route.requiredKeyboardFocusOrder.length > 0,
          minimumOutlineWidthPx: 2,
          minimumContrastRatio: 3,
          indicators: [],
          passed: false,
        },
        passed: false,
      },
      requiredScrollRegions: [],
      layout: null,
      violations: [],
      incomplete: [],
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    await context.close();
  }
}

/** Runs reproducible browser checks and writes one machine-readable evidence artifact. */
export async function auditPlatformAccessibility({
  baseUrl,
  sourceCommit,
  sourceTreeClean,
  draftSourceMeasurement = false,
  routes,
  reportPath,
  generatedAt = new Date(),
  settleMs = 0,
  excludedSurfaces = [],
  profiles = DEFAULT_AUDIT_PROFILES,
  targetRevision = UNVERIFIED_TARGET_REVISION,
}) {
  if (!/^[0-9a-f]{40}$/.test(sourceCommit)) {
    throw new Error('A full source commit is required for accessibility evidence.');
  }
  if (sourceTreeClean !== true && draftSourceMeasurement !== true) {
    throw new Error('Accessibility evidence requires a clean audited source tree.');
  }
  if (draftSourceMeasurement === true && sourceTreeClean !== false) {
    throw new Error('A draft source measurement must record sourceTreeClean as false.');
  }
  validateTargetRevision(targetRevision, sourceCommit);
  if (!Array.isArray(routes) || routes.length === 0) {
    throw new Error('At least one accessibility audit route is required.');
  }
  for (const route of routes) {
    if (!route.skipTarget) throw new Error(`Route ${route.id} requires an expected skip target.`);
    if (route.requiresFixtureEvidence === true
      && (!route.fixture || typeof route.prepare !== 'function')) {
      throw new Error(`Route ${route.id} requires a fixture controller with network evidence.`);
    }
    if (route.requiredKeyboardFocusOrder !== undefined
      && (!Array.isArray(route.requiredKeyboardFocusOrder)
        || route.requiredKeyboardFocusOrder.length < 2
        || route.requiredKeyboardFocusOrder.some((selector) => typeof selector !== 'string' || !selector.trim())
        || new Set(route.requiredKeyboardFocusOrder).size !== route.requiredKeyboardFocusOrder.length)) {
      throw new Error(`Route ${route.id} requires a unique keyboard focus order with at least two selectors.`);
    }
  }
  if (!Array.isArray(profiles) || profiles.length === 0) {
    throw new Error('At least one accessibility audit profile is required.');
  }
  for (const profile of profiles) {
    if (!profile.id || !Number.isSafeInteger(profile.viewport?.width) || !Number.isSafeInteger(profile.viewport?.height)) {
      throw new Error('Accessibility audit profiles require an id and integer viewport dimensions.');
    }
  }

  const browser = await chromium.launch();
  let auditedRoutes;
  try {
    auditedRoutes = [];
    for (const route of routes) {
      for (const profile of profiles) {
        auditedRoutes.push(await auditRoute(browser, baseUrl, route, profile, settleMs));
      }
    }
  } finally {
    await browser.close();
  }

  const violationCount = auditedRoutes.reduce((total, route) => total + route.violations.length, 0);
  const incompleteCount = auditedRoutes.reduce((total, route) => total + route.incomplete.length, 0);
  const passedCases = auditedRoutes.filter((route) => route.passed).length;
  const passedRoutes = routes.filter((route) => (
    auditedRoutes.filter((result) => result.routeId === route.id).every((result) => result.passed)
  )).length;
  const failed = passedCases !== auditedRoutes.length;
  const needsReview = !failed && (
    incompleteCount > 0
    || excludedSurfaces.length > 0
    || draftSourceMeasurement === true
  );
  const report = {
    schemaVersion: 5,
    generatedAt: generatedAt.toISOString(),
    sourceCommit,
    sourceTreeClean,
    evidenceClassification: draftSourceMeasurement === true
      ? 'draft-uncommitted-source-measurement'
      : 'release-evidence',
    releaseEvidence: draftSourceMeasurement !== true,
    targetRevision,
    baseUrl,
    standard: 'WCAG 2.2 AA automated subset + skip-link focus + keyboard focus order and appearance + responsive overflow',
    engine: { name: 'axe-core', version: axe.version, tags: WCAG_TAGS },
    status: failed ? 'fail' : needsReview ? 'needs_review' : 'pass',
    summary: {
      routeCount: routes.length,
      profileCount: profiles.length,
      auditCaseCount: auditedRoutes.length,
      passedRoutes,
      passedCases,
      violationCount,
      incompleteCount,
      excludedSurfaceCount: excludedSurfaces.length,
    },
    coverage: {
      profiles,
      audited: auditedRoutes.map((route) => route.id),
      excluded: excludedSurfaces,
    },
    routes: auditedRoutes,
  };

  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return report;
}

/** Validates that evidence is generated from the exact committed auditor and UI source. */
export function validateAuditSourceState({ sourceCommit, workflowCommit, statusOutput }) {
  if (!/^[0-9a-f]{40}$/.test(sourceCommit)) {
    throw new Error('Accessibility audit checkout does not have a full source commit.');
  }
  if (workflowCommit && workflowCommit !== sourceCommit) {
    throw new Error('Accessibility audit checkout does not match workflow commit.');
  }
  if (statusOutput.trim()) {
    throw new Error('Accessibility audit source paths contain uncommitted changes.');
  }
}

/** Maps the audit report status to the CLI process exit code. */
export function accessibilityAuditExitCode(report) {
  return report.status === 'pass' || report.status === 'needs_review' ? 0 : 1;
}

const isCli = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isCli) {
  const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: projectRoot,
    encoding: 'utf8',
  }).trim();
  const statusOutput = readAuditSourceStatus(projectRoot);
  validateAuditSourceState({
    sourceCommit,
    workflowCommit: process.env.GITHUB_SHA,
    statusOutput,
  });
  const baseUrl = process.env.PLATFORM_A11Y_BASE_URL ?? 'http://127.0.0.1:4321';
  const reportPath = process.env.PLATFORM_A11Y_REPORT
    ? resolve(process.env.PLATFORM_A11Y_REPORT)
    : resolve(projectRoot, 'evaluation', 'platform-accessibility-audit.json');
  const targetRevision = await verifyDeploymentRevision({
    baseUrl,
    expectedSourceCommit: sourceCommit,
  });
  const report = await auditPlatformAccessibility({
    baseUrl,
    sourceCommit,
    sourceTreeClean: true,
    reportPath,
    targetRevision,
    settleMs: 1_500,
    excludedSurfaces: DEFAULT_EXCLUDED_SURFACES,
    routes: DEFAULT_AUDIT_ROUTES,
  });
  console.log(JSON.stringify({ reportPath, status: report.status, summary: report.summary }));
  process.exitCode = accessibilityAuditExitCode(report);
}
