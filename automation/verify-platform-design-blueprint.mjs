import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import {
  AUDITED_SOURCE_PATHS,
  FIXTURE_IDS,
  prepareAuthenticatedPlatform,
  readAuditSourceStatus,
} from './platform-accessibility-audit.mjs';

const PLATFORM_ENTRY_ROUTE = '/platform/';
const FIXTURE_SUPABASE_ORIGIN = 'https://pleyuknjnprsckssxvrh.supabase.co';
export const DESIGN_BLUEPRINT_ROUTE = `/platform/o/${FIXTURE_IDS.org}/c/audit-assembly/design`;
export const ACCESS_PLAN_ROUTE = `/platform/o/${FIXTURE_IDS.org}/access`;
export const REVIEW_CONSOLE_ROUTE = `/platform/o/${FIXTURE_IDS.org}/c/audit-assembly/s/audit-session/t/${FIXTURE_IDS.topic}/review`;
export const PUBLISH_CONSOLE_ROUTE = `/platform/o/${FIXTURE_IDS.org}/c/audit-assembly/s/audit-session/t/${FIXTURE_IDS.topic}/publish`;
const READ_RPCS = new Set(['/rest/v1/rpc/my_orgs', '/rest/v1/rpc/readiness_check']);

const REVIEW_TOPICS = [
  {
    id: FIXTURE_IDS.topic,
    ordinal: 1,
    prompt: '검수 경합 주제 A',
    session_id: FIXTURE_IDS.session,
    archived_at: null,
  },
  {
    id: FIXTURE_IDS.topicSecondary,
    ordinal: 2,
    prompt: '검수 경합 주제 B',
    session_id: FIXTURE_IDS.session,
    archived_at: null,
  },
];

function reviewList(topicId) {
  return {
    topic_id: topicId,
    issues: topicId === FIXTURE_IDS.topic ? [{
      id: '00000000-0000-4000-8000-000000000101',
      label: '지연 검수 대상 쟁점',
      stance: 'proposal',
      frequency_class: 'majority',
      summary: '지연된 검수 응답이 다른 주제를 덮지 않아야 합니다.',
      origin: 'ai',
      review_status: 'draft',
      reviewed_by: null,
      reviewed_at: null,
      archived_at: null,
      linked_item_count: 1,
      consensus_denominator: 1,
    }] : [],
    unclassified_count: 0,
    reviewed_count: 0,
  };
}

function reviewItems(topicId) {
  return {
    topic_id: topicId,
    items: topicId === FIXTURE_IDS.topic ? [{
      id: '00000000-0000-4000-8000-000000000201',
      content: '검수 경합을 확인하는 시민 원문입니다.',
      rationale: null,
      kind: 'core',
      ordinal: 1,
      team_id: '00000000-0000-4000-8000-000000000301',
      team_name: '검수 fixture 조',
      submission_id: '00000000-0000-4000-8000-000000000401',
      links: [{
        issue_id: '00000000-0000-4000-8000-000000000101',
        cluster_id: null,
        linked_by: 'fixture-reviewer',
      }],
      unclassified: false,
    }] : [],
  };
}

async function fulfillJson(route, body, status = 200) {
  await route.fulfill({
    status,
    contentType: 'application/json; charset=utf-8',
    headers: { 'access-control-allow-origin': '*' },
    body: JSON.stringify(body),
  });
}

function requireRecord(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value;
}

/** Validates the downloaded, non-mutating blueprint contract used by the browser verifier. */
export function validateDownloadedBlueprint(value) {
  const blueprint = requireRecord(value, 'Downloaded blueprint');
  if (
    blueprint.schemaVersion !== 4
    || blueprint.kind !== 'platform-design-blueprint'
    || blueprint.dryRun !== true
    || blueprint.databaseMutationExecuted !== false
    || blueprint.requiresApproval !== true
  ) {
    throw new Error('Downloaded blueprint violates the approval boundary');
  }
  if (!Array.isArray(blueprint.sessions) || blueprint.sessions.length !== 2) {
    throw new Error('Downloaded blueprint must contain the two verified sessions');
  }
  const assembly = requireRecord(blueprint.assembly, 'Downloaded blueprint assembly');
  const projectedHierarchy = blueprint.sessions.map((sessionValue) => {
    const session = requireRecord(sessionValue, 'Downloaded blueprint session');
    if (!Array.isArray(session.topics) || !Array.isArray(session.teams)) {
      throw new Error('Downloaded blueprint hierarchy does not match the verified input');
    }
    return {
      ordinal: session.ordinal,
      title: session.title,
      slug: session.slug,
      heldOn: session.heldOn,
      topics: session.topics.map((topicValue) => {
        const topic = requireRecord(topicValue, 'Downloaded blueprint topic');
        return { ordinal: topic.ordinal, prompt: topic.prompt };
      }),
      teams: session.teams.map((teamValue) => {
        const team = requireRecord(teamValue, 'Downloaded blueprint team');
        return { ordinal: team.ordinal, name: team.name, plannedCapacity: team.plannedCapacity };
      }),
    };
  });
  const expectedHierarchy = [
    { ordinal: 1, title: '감축 숙의', slug: 'mitigation-session', heldOn: '2026-09-12', topics: [{ ordinal: 1, prompt: '감축 경로' }], teams: [{ ordinal: 1, name: '1조', plannedCapacity: 12 }] },
    { ordinal: 2, title: '적응 숙의', slug: 'adaptation-session', heldOn: '2026-09-13', topics: [{ ordinal: 1, prompt: '적응 정책' }], teams: [{ ordinal: 1, name: '1조', plannedCapacity: 10 }] },
  ];
  if (
    assembly.title !== '기후 공론화 2026'
    || assembly.slug !== 'climate-2026'
    || assembly.purpose !== '감축과 적응의 실행 조건을 시민과 함께 검토한다.'
    || assembly.mode !== 'vote'
    || JSON.stringify(assembly.config) !== JSON.stringify({ readiness: ['topics_open', 'teams_active'] })
    || JSON.stringify(projectedHierarchy) !== JSON.stringify(expectedHierarchy)
  ) {
    throw new Error('Downloaded blueprint hierarchy does not match the verified input');
  }
  const stats = requireRecord(blueprint.stats, 'Downloaded blueprint stats');
  const expectedStats = {
    sessionCount: projectedHierarchy.length,
    topicCount: projectedHierarchy.reduce((sum, session) => sum + session.topics.length, 0),
    teamCount: projectedHierarchy.reduce((sum, session) => sum + session.teams.length, 0),
    participantCount: projectedHierarchy.reduce((sum, session) => (
      sum + session.teams.reduce((sessionSum, team) => sessionSum + team.plannedCapacity, 0)
    ), 0),
  };
  for (const [key, expected] of Object.entries(expectedStats)) {
    if (stats[key] !== expected) throw new Error(`Downloaded blueprint has invalid ${key}`);
  }
  return expectedStats;
}

/** Validates the downloaded, non-mutating organization access plan used by the browser verifier. */
export function validateDownloadedAccessPlan(value) {
  const plan = requireRecord(value, 'Downloaded access plan');
  if (
    plan.schemaVersion !== 1
    || plan.kind !== 'platform-organization-access-plan'
    || plan.dryRun !== true
    || plan.authAccountsCreated !== false
    || plan.invitationsSent !== false
    || plan.databaseMutationExecuted !== false
    || plan.requiresApproval !== true
  ) {
    throw new Error('Downloaded access plan violates the approval boundary');
  }
  const organization = requireRecord(plan.organization, 'Downloaded access plan organization');
  if (organization.id !== FIXTURE_IDS.org || organization.label !== '내 기관') {
    throw new Error('Downloaded access plan organization does not match the authenticated fixture');
  }
  if (
    !Array.isArray(plan.invitations)
    || plan.invitations.length !== 1
    || plan.invitations[0]?.email !== 'staff@example.invalid'
    || plan.invitations[0]?.role !== 'org_admin'
  ) {
    throw new Error('Downloaded access plan invitation does not match the verified input');
  }
  if (
    !Array.isArray(plan.memberships)
    || plan.memberships.length !== 1
    || plan.memberships[0]?.userId !== FIXTURE_IDS.user
    || plan.memberships[0]?.role !== 'hq'
  ) {
    throw new Error('Downloaded access plan membership does not match the verified input');
  }
  return { invitationCount: plan.invitations.length, membershipCount: plan.memberships.length };
}

/** Distinguishes read-only fixture RPCs from any REST mutation attempt. */
export function isDatabaseMutationRequest(method, path) {
  if (!path.startsWith('/rest/v1/')) return false;
  const normalizedMethod = method.toUpperCase();
  if (READ_RPCS.has(path) && normalizedMethod === 'POST') return false;
  return !['GET', 'HEAD', 'OPTIONS'].includes(normalizedMethod);
}

function readSourceTreeSha256(projectRoot) {
  const files = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '--', ...AUDITED_SOURCE_PATHS],
    { cwd: projectRoot, encoding: 'utf8' },
  ).split(/\r?\n/).filter(Boolean).sort();
  const hash = createHash('sha256');
  for (const file of files) {
    hash.update(file);
    hash.update('\0');
    hash.update(readFileSync(resolve(projectRoot, file)));
    hash.update('\0');
  }
  return hash.digest('hex');
}

async function readDownloadJson(download) {
  const stream = await download.createReadStream();
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

/** Exercises the production login form's synchronous request lock with a delayed fixture response. */
export async function verifyPlatformAuthLock({ browser, origin, timeoutMs = 60_000 }) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const browserErrors = [];
  const unexpectedRequests = [];
  const loginRequests = [];
  let releaseLogin;
  const loginGate = new Promise((resolveGate) => { releaseLogin = resolveGate; });
  page.on('pageerror', (error) => browserErrors.push(error.message));

  try {
    await page.route(`${FIXTURE_SUPABASE_ORIGIN}/**`, async (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      if (path === '/auth/v1/token') {
        loginRequests.push(request.postDataJSON());
        await loginGate;
        await fulfillJson(route, { message: 'Fixture login rejected' }, 400);
        return;
      }
      unexpectedRequests.push({ method: request.method(), path });
      await fulfillJson(route, { message: 'Unexpected auth lock fixture request' }, 500);
    });

    const response = await page.goto(new URL(PLATFORM_ENTRY_ROUTE, origin).toString(), {
      waitUntil: 'domcontentloaded',
      timeout: timeoutMs,
    });
    if (!response?.ok()) throw new Error(`Platform login page returned HTTP ${response?.status() ?? 'unknown'}`);
    const form = page.getByRole('form', { name: '운영진 로그인' });
    await form.waitFor({ timeout: timeoutMs });
    const email = page.getByLabel('이메일');
    const password = page.getByLabel('비밀번호');
    await email.fill('fixture-operator@example.invalid');
    await password.fill('fixture-password');
    const focusedControlBeforeSubmit = await page.evaluate(() => document.activeElement?.id ?? null);
    await form.evaluate((element) => {
      if (!(element instanceof HTMLFormElement)) throw new Error('Login fixture target is not a form');
      element.requestSubmit();
      element.requestSubmit();
    });
    await page.waitForTimeout(100);
    const inputsLocked = await email.isDisabled() && await password.isDisabled();
    const duplicateLoginBlocked = loginRequests.length === 1;
    releaseLogin();
    const alert = page.getByRole('alert');
    await alert.waitFor({ timeout: timeoutMs });
    await page.waitForFunction(
      (controlId) => document.activeElement?.id === controlId,
      focusedControlBeforeSubmit,
      { timeout: timeoutMs },
    );
    const retryEnabled = await email.isEnabled() && await password.isEnabled();
    const focusRestoredAfterFailure = await page.evaluate(
      (controlId) => document.activeElement?.id === controlId,
      focusedControlBeforeSubmit,
    );
    const errorId = await alert.getAttribute('id');
    const [emailDescribedBy, passwordDescribedBy, emailInvalid, passwordInvalid] = await Promise.all([
      email.getAttribute('aria-describedby'),
      password.getAttribute('aria-describedby'),
      email.getAttribute('aria-invalid'),
      password.getAttribute('aria-invalid'),
    ]);
    const describedByIncludes = (value) => Boolean(errorId && value?.split(/\s+/).includes(errorId));
    const errorLinkedToFields = describedByIncludes(emailDescribedBy)
      && describedByIncludes(passwordDescribedBy)
      && emailInvalid === 'true'
      && passwordInvalid === 'true';
    const alertAtomic = await alert.getAttribute('aria-atomic') === 'true';
    const passwordRemainsMasked = await password.getAttribute('type') === 'password';

    if (!inputsLocked) throw new Error('Platform login inputs were not locked during authentication');
    if (!duplicateLoginBlocked) throw new Error('Platform login sent a duplicate authentication request');
    if (!retryEnabled) throw new Error('Platform login did not release its controls after failure');
    if (!focusRestoredAfterFailure) throw new Error('Platform login did not restore focus after failure');
    if (!errorLinkedToFields) throw new Error('Platform login error was not linked to both fields');
    if (!alertAtomic) throw new Error('Platform login error was not announced atomically');
    if (!passwordRemainsMasked) throw new Error('Platform login password field lost its masked input type');
    if (browserErrors.length > 0) throw new Error('Platform login verification observed a browser error');
    if (unexpectedRequests.length > 0) throw new Error('Platform login verification observed an unexpected fixture request');

    return {
      path: PLATFORM_ENTRY_ROUTE,
      fixture: 'ci-platform-auth-lock-fixture-v1',
      inputsLocked,
      duplicateLoginBlocked,
      loginRequestCount: loginRequests.length,
      retryEnabled,
      focusedControlBeforeSubmit,
      focusRestoredAfterFailure,
      errorLinkedToFields,
      alertAtomic,
      passwordRemainsMasked,
      browserPageErrorCount: browserErrors.length,
      unexpectedRequestCount: unexpectedRequests.length,
    };
  } finally {
    releaseLogin?.();
    await context.close();
  }
}

/** Verifies that a successful sign-out synchronously removes the prior user's shell state and route scope. */
export async function verifyPlatformSessionIsolation({ browser, origin, timeoutMs = 60_000 }) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const browserErrors = [];
  const fixtureFailures = [];
  const logoutRequests = [];
  page.on('pageerror', (error) => browserErrors.push(error.message));
  page.on('response', (response) => {
    if (response.url().includes(FIXTURE_SUPABASE_ORIGIN) && response.status() >= 400) {
      fixtureFailures.push({ status: response.status(), path: new URL(response.url()).pathname });
    }
  });

  try {
    await context.addInitScript(() => {
      sessionStorage.setItem('climate_vote_hq_attendance_token', 'previous-user-sensitive-token');
      sessionStorage.setItem('climate_vote_hq_gate_actor', 'previous-user-actor');
      sessionStorage.setItem('climate_vote_platform_org_context', '00000000-0000-4000-8000-000000000099');
    });
    await prepareAuthenticatedPlatform({
      context,
      page,
      topics: REVIEW_TOPICS,
      handleRequest: async ({ route, path, request }) => {
        if (path !== '/auth/v1/logout') return false;
        logoutRequests.push({ method: request.method(), path });
        await fulfillJson(route, {});
        return true;
      },
    });
    const response = await page.goto(new URL(PLATFORM_ENTRY_ROUTE, origin).toString(), {
      waitUntil: 'domcontentloaded',
      timeout: timeoutMs,
    });
    if (!response?.ok()) throw new Error(`Platform session isolation page returned HTTP ${response?.status() ?? 'unknown'}`);

    await page.getByRole('button', { name: '접근성 감사 공론화', exact: true }).click();
    await page.getByRole('button', { name: '제1차 회의', exact: true }).click();
    await page.getByRole('button', { name: '검수 경합 주제 A', exact: true }).click();
    await page.getByRole('button', { name: '공개', exact: true }).click();
    await page.waitForURL((url) => url.pathname === PUBLISH_CONSOLE_ROUTE, { timeout: timeoutMs });
    const storedCredentialLoaded = await page.getByLabel('HQ 인증 토큰').inputValue() === 'previous-user-sensitive-token';
    await page.getByLabel('공개 결과 제목').fill('이전 사용자 공개 초안');
    await page.getByRole('button', { name: '로그아웃', exact: true }).click();
    await page.getByRole('form', { name: '운영진 로그인' }).waitFor({ timeout: timeoutMs });

    const rootRouteRestored = new URL(page.url()).pathname.replace(/\/+$/, '') === '/platform';
    const priorCredentialRemoved = await page.getByLabel('HQ 인증 토큰').count() === 0;
    const priorDraftRemoved = await page.getByLabel('공개 결과 제목').count() === 0;
    const priorTreeRemoved = await page.getByRole('button', { name: '접근성 감사 공론화', exact: true }).count() === 0;
    const priorConsoleRemoved = await page.getByRole('heading', { name: '검수 결과 발행', exact: true }).count() === 0;
    const storedCredentialsRemoved = await page.evaluate(() => (
      sessionStorage.getItem('climate_vote_hq_attendance_token') === null
      && sessionStorage.getItem('climate_vote_hq_gate_actor') === null
      && sessionStorage.getItem('climate_vote_platform_org_context') === null
    ));

    if (!storedCredentialLoaded) throw new Error('Platform session isolation fixture did not load the stored credential');
    if (!rootRouteRestored) throw new Error('Platform sign-out retained the prior user route scope');
    if (!priorCredentialRemoved || !priorDraftRemoved || !priorTreeRemoved || !priorConsoleRemoved || !storedCredentialsRemoved) {
      throw new Error('Platform sign-out retained prior user shell state');
    }
    if (logoutRequests.length !== 1) throw new Error('Platform sign-out did not issue exactly one auth request');
    if (browserErrors.length > 0) throw new Error('Platform session isolation verification observed a browser error');
    if (fixtureFailures.length > 0) throw new Error('Platform session isolation verification observed an unexpected fixture failure');

    return {
      path: PUBLISH_CONSOLE_ROUTE,
      fixture: 'ci-platform-session-isolation-fixture-v1',
      storedCredentialLoaded,
      rootRouteRestored,
      priorCredentialRemoved,
      priorDraftRemoved,
      priorTreeRemoved,
      priorConsoleRemoved,
      storedCredentialsRemoved,
      logoutRequestCount: logoutRequests.length,
      browserPageErrorCount: browserErrors.length,
      fixtureFailureCount: fixtureFailures.length,
    };
  } finally {
    await context.close();
  }
}

/** Verifies explicit multi-organization selection and tab-scoped request binding. */
export async function verifyPlatformOrganizationSelection({ browser, origin, timeoutMs = 60_000 }) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const browserErrors = [];
  const fixtureFailures = [];
  const selectionRequests = [];
  const contextHeaders = [];
  const contextToken = '00000000-0000-4000-8000-000000000098';
  page.on('pageerror', (error) => browserErrors.push(error.message));
  page.on('response', (response) => {
    if (response.url().includes(FIXTURE_SUPABASE_ORIGIN) && response.status() >= 400) {
      fixtureFailures.push({ status: response.status(), path: new URL(response.url()).pathname });
    }
  });

  try {
    await prepareAuthenticatedPlatform({
      context,
      page,
      topics: REVIEW_TOPICS,
      handleRequest: async ({ route, path, request }) => {
        if (path === '/rest/v1/rpc/my_orgs') {
          const requestToken = request.headers()['x-platform-org-context'] ?? null;
          contextHeaders.push(requestToken);
          await fulfillJson(route, [
            { id: FIXTURE_IDS.org, name: '기관 A', slug: 'audit-org-a', selected: false },
            { id: FIXTURE_IDS.orgSecondary, name: '기관 B', slug: 'audit-org-b', selected: requestToken === contextToken },
          ]);
          return true;
        }
        if (path === '/rest/v1/rpc/org_select') {
          const body = request.postDataJSON();
          selectionRequests.push(body);
          await fulfillJson(route, { org_id: FIXTURE_IDS.orgSecondary, context_token: contextToken });
          return true;
        }
        return false;
      },
    });
    const response = await page.goto(new URL(PLATFORM_ENTRY_ROUTE, origin).toString(), {
      waitUntil: 'domcontentloaded',
      timeout: timeoutMs,
    });
    if (!response?.ok()) throw new Error(`Platform organization selection page returned HTTP ${response?.status() ?? 'unknown'}`);

    const selector = page.getByLabel('사용할 기관');
    await selector.waitFor({ timeout: timeoutMs });
    const treeLockedBeforeSelection = await page.getByRole('status').filter({ hasText: '사용할 기관을 선택' }).count() === 1;
    await selector.evaluate((element, organizationId) => {
      if (!(element instanceof HTMLSelectElement) || typeof organizationId !== 'string') {
        throw new Error('Organization selection fixture is invalid');
      }
      element.value = organizationId;
      element.dispatchEvent(new Event('change', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
    }, FIXTURE_IDS.orgSecondary);
    await page.waitForURL((url) => url.pathname.startsWith(`/platform/o/${FIXTURE_IDS.orgSecondary}`), { timeout: timeoutMs });
    await page.getByRole('button', { name: '접근성 감사 공론화', exact: true }).waitFor({ timeout: timeoutMs });

    const storedToken = await page.evaluate(() => sessionStorage.getItem('climate_vote_platform_org_context'));
    const tokenHiddenFromDocument = !(await page.locator('body').textContent())?.includes(contextToken);
    const selectionBound = selectionRequests.length === 1
      && selectionRequests[0]?.p_org === FIXTURE_IDS.orgSecondary
      && contextHeaders[0] === null
      && contextHeaders.includes(contextToken);

    if (!treeLockedBeforeSelection) throw new Error('Platform organization tree was not locked before selection');
    if (!selectionBound) throw new Error('Platform organization selection was not bound to the request context');
    if (storedToken !== contextToken || !tokenHiddenFromDocument) throw new Error('Platform organization context storage boundary failed');
    if (browserErrors.length > 0) throw new Error('Platform organization selection observed a browser error');
    if (fixtureFailures.length > 0) throw new Error('Platform organization selection observed an unexpected fixture failure');

    return {
      path: `/platform/o/${FIXTURE_IDS.orgSecondary}`,
      fixture: 'ci-platform-multi-org-fixture-v1',
      treeLockedBeforeSelection,
      duplicateSelectionBlocked: selectionRequests.length === 1,
      selectionRequestCount: selectionRequests.length,
      selectedOrganizationId: FIXTURE_IDS.orgSecondary,
      contextHeaderObserved: contextHeaders.includes(contextToken),
      contextStoredInSession: storedToken === contextToken,
      contextHiddenFromDocument: tokenHiddenFromDocument,
      browserPageErrorCount: browserErrors.length,
      fixtureFailureCount: fixtureFailures.length,
    };
  } finally {
    await context.close();
  }
}

/** Exercises duplicate-write and stale-topic guards through the production review console. */
export async function verifyReviewConsoleRace({ browser, origin, timeoutMs = 60_000 }) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const browserErrors = [];
  const fixtureFailures = [];
  const reviewRequests = [];
  const observedRpcPaths = [];
  let releaseReview;
  const reviewGate = new Promise((resolveGate) => {
    releaseReview = resolveGate;
  });
  page.on('pageerror', (error) => browserErrors.push(error.message));
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.hostname === 'pleyuknjnprsckssxvrh.supabase.co' && url.pathname.startsWith('/rest/v1/rpc/')) {
      observedRpcPaths.push(url.pathname);
    }
  });
  page.on('response', (response) => {
    if (response.url().includes('pleyuknjnprsckssxvrh.supabase.co') && response.status() >= 400) {
      fixtureFailures.push({ status: response.status(), path: new URL(response.url()).pathname });
    }
  });

  try {
    await prepareAuthenticatedPlatform({
      context,
      page,
      topics: REVIEW_TOPICS,
      handleRequest: async ({ route, path, request }) => {
        if (path === '/rest/v1/rpc/issue_list' || path === '/rest/v1/rpc/issue_items') {
          const body = request.postDataJSON();
          const topicId = typeof body?.p_topic_id === 'string' ? body.p_topic_id : '';
          await fulfillJson(route, path.endsWith('issue_list') ? reviewList(topicId) : reviewItems(topicId));
          return true;
        }
        if (path === '/rest/v1/rpc/issue_review') {
          reviewRequests.push(request.postDataJSON());
          await reviewGate;
          await fulfillJson(route, {
            id: '00000000-0000-4000-8000-000000000101',
            review_status: 'reviewed',
          });
          return true;
        }
        return false;
      },
    });
    const response = await page.goto(new URL(PLATFORM_ENTRY_ROUTE, origin).toString(), {
      waitUntil: 'domcontentloaded',
      timeout: timeoutMs,
    });
    if (!response?.ok()) throw new Error(`Review console page returned HTTP ${response?.status() ?? 'unknown'}`);
    await page.getByRole('button', { name: '접근성 감사 공론화', exact: true }).click();
    await page.getByRole('button', { name: '제1차 회의', exact: true }).click();
    await page.getByRole('button', { name: '검수 경합 주제 A', exact: true }).click();
    await page.getByRole('button', { name: '검수', exact: true }).click();
    await page.waitForURL((url) => url.pathname === REVIEW_CONSOLE_ROUTE, { timeout: timeoutMs });
    await page.getByRole('heading', { name: /쟁점 검수/ }).waitFor({ timeout: timeoutMs });
    const joinCode = page.getByLabel('조 참여 코드(join_code)');
    await joinCode.fill(' RACE01 ');
    await page.getByRole('button', { name: '불러오기', exact: true }).click();
    const issueChoice = page.getByRole('button', { name: /지연 검수 대상 쟁점/ });
    await issueChoice.waitFor({ timeout: timeoutMs });
    await issueChoice.click();
    const reviewButton = page.getByRole('button', { name: '✓ 검수 완료', exact: true });
    await reviewButton.evaluate((button) => {
      button.click();
      button.click();
    });
    await page.waitForTimeout(100);
    if (!await joinCode.isDisabled()) {
      throw new Error(`Review mutation did not enter the busy state: ${observedRpcPaths.join(', ')}`);
    }
    await page.waitForFunction(() => window.location.pathname.includes('/review'), undefined, { timeout: timeoutMs });
    await page.getByRole('button', { name: '검수 경합 주제 B', exact: true }).click();
    const secondaryPath = `/t/${FIXTURE_IDS.topicSecondary}/review`;
    await page.waitForURL((url) => url.pathname.endsWith(secondaryPath), { timeout: timeoutMs });
    await joinCode.waitFor({ state: 'visible', timeout: timeoutMs });
    await page.waitForFunction(() => {
      const input = document.querySelector('input#review-join-code');
      return input instanceof HTMLInputElement && !input.disabled && input.value === '';
    }, undefined, { timeout: timeoutMs });
    const topicResetBeforeRelease = true;
    const reviewResponse = page.waitForResponse((candidate) => (
      new URL(candidate.url()).pathname === '/rest/v1/rpc/issue_review'
    ), { timeout: timeoutMs });
    releaseReview();
    await reviewResponse;
    await page.waitForTimeout(50);
    const staleCompletionIgnored = await page.getByText('검수 완료로 확정했습니다.', { exact: true }).count() === 0
      && await page.getByText('지연 검수 대상 쟁점', { exact: true }).count() === 0
      && await joinCode.isEnabled()
      && await joinCode.inputValue() === '';
    const duplicateWriteBlocked = reviewRequests.length === 1;
    const requestBoundToLoadedCode = reviewRequests[0]?.p_code === 'RACE01'
      && reviewRequests[0]?.p_issue_id === '00000000-0000-4000-8000-000000000101';

    if (!topicResetBeforeRelease) throw new Error('Review topic change did not reset the in-flight mutation state');
    if (!staleCompletionIgnored) throw new Error('A stale review mutation changed the current topic UI');
    if (!duplicateWriteBlocked) throw new Error('Review console sent a duplicate mutation request');
    if (!requestBoundToLoadedCode) throw new Error('Review mutation was not bound to the loaded join code and issue');
    if (browserErrors.length > 0) throw new Error('Review console verification observed a browser error');
    if (fixtureFailures.length > 0) throw new Error('Review console verification observed an unexpected fixture request');

    return {
      path: REVIEW_CONSOLE_ROUTE,
      fixture: 'ci-review-race-fixture-v1',
      topicResetBeforeRelease,
      staleCompletionIgnored,
      duplicateWriteBlocked,
      requestBoundToLoadedCode,
      reviewMutationRequestCount: reviewRequests.length,
      browserPageErrorCount: browserErrors.length,
      fixtureFailureCount: fixtureFailures.length,
    };
  } finally {
    releaseReview?.();
    await context.close();
  }
}

/** Exercises the production publish console's synchronous mutation lock with fixture-only RPCs. */
export async function verifyPublishConsoleLock({ browser, origin, timeoutMs = 60_000 }) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const browserErrors = [];
  const fixtureFailures = [];
  const publishRequests = [];
  const unpublishRequests = [];
  let published = false;
  let releasePublish;
  let releaseUnpublish;
  const publishGate = new Promise((resolveGate) => { releasePublish = resolveGate; });
  const unpublishGate = new Promise((resolveGate) => { releaseUnpublish = resolveGate; });
  page.on('pageerror', (error) => browserErrors.push(error.message));
  page.on('response', (response) => {
    if (response.url().includes('pleyuknjnprsckssxvrh.supabase.co') && response.status() >= 400) {
      fixtureFailures.push({ status: response.status(), path: new URL(response.url()).pathname });
    }
  });

  try {
    await prepareAuthenticatedPlatform({
      context,
      page,
      handleRequest: async ({ route, path, request }) => {
        if (path === '/rest/v1/rpc/result_publish') {
          publishRequests.push(request.postDataJSON());
          await publishGate;
          published = true;
          await fulfillJson(route, {
            id: '00000000-0000-4000-8000-000000000501',
            token: 'fixture-public-token',
            published_at: '2026-08-13T12:00:00.000Z',
            reviewed_count: 1,
          });
          return true;
        }
        if (path === '/rest/v1/rpc/result_unpublish') {
          unpublishRequests.push(request.postDataJSON());
          await unpublishGate;
          published = false;
          await fulfillJson(route, {
            id: '00000000-0000-4000-8000-000000000501',
            published_at: null,
          });
          return true;
        }
        if (path === '/rest/v1/rpc/result_get') {
          await fulfillJson(route, published ? {
            scope: 'topic',
            scope_id: FIXTURE_IDS.topic,
            title: '검수 경합 공개 결과',
            published_at: '2026-08-13T12:00:00.000Z',
            body: {},
            hitl_notice: 'fixture review notice',
          } : null);
          return true;
        }
        return false;
      },
    });
    const response = await page.goto(new URL(PLATFORM_ENTRY_ROUTE, origin).toString(), {
      waitUntil: 'domcontentloaded',
      timeout: timeoutMs,
    });
    if (!response?.ok()) throw new Error(`Publish console page returned HTTP ${response?.status() ?? 'unknown'}`);
    await page.getByRole('button', { name: '접근성 감사 공론화', exact: true }).click();
    await page.getByRole('button', { name: '제1차 회의', exact: true }).click();
    await page.getByRole('button', { name: '접근성 감사 주제', exact: true }).click();
    await page.getByRole('button', { name: '공개', exact: true }).click();
    await page.waitForURL((url) => url.pathname === PUBLISH_CONSOLE_ROUTE, { timeout: timeoutMs });
    await page.getByRole('heading', { name: '검수 결과 발행' }).waitFor({ timeout: timeoutMs });
    await page.getByLabel('HQ 인증 토큰').fill('fixture-hq-token');
    await page.getByLabel('공개 결과 제목').fill('검수 경합 공개 결과');
    const publishButton = page.getByRole('button', { name: '검수 결과 발행', exact: true });
    await publishButton.evaluate((button) => {
      button.click();
      button.click();
    });
    await page.waitForTimeout(100);
    const publishBusyLocked = await page.getByLabel('HQ 인증 토큰').isDisabled()
      && await page.getByLabel('공개 결과 제목').isDisabled();
    const duplicatePublishBlocked = publishRequests.length === 1;
    releasePublish();
    await page.getByRole('status').filter({ hasText: '공개 완료·재조회 검증 완료' }).waitFor({ timeout: timeoutMs });

    const unpublishButton = page.getByRole('button', { name: '공개 해제', exact: true });
    await unpublishButton.evaluate((button) => {
      button.click();
      button.click();
    });
    await page.waitForTimeout(100);
    const duplicateUnpublishBlocked = unpublishRequests.length === 1;
    const unpublishBusyLocked = await unpublishButton.isDisabled();
    releaseUnpublish();
    await page.getByRole('status').filter({ hasText: '공개 해제·비공개 재조회 검증을 완료했습니다.' }).waitFor({ timeout: timeoutMs });
    const publicationCleared = await page.getByRole('region', { name: '발행된 결과' }).count() === 0;

    if (!publishBusyLocked) throw new Error('Publish inputs were not locked during the mutation');
    if (!duplicatePublishBlocked) throw new Error('Publish console sent a duplicate publish mutation');
    if (!unpublishBusyLocked) throw new Error('Unpublish control was not locked during the mutation');
    if (!duplicateUnpublishBlocked) throw new Error('Publish console sent a duplicate unpublish mutation');
    if (!publicationCleared) throw new Error('Publish console retained a result after verified unpublish');
    if (browserErrors.length > 0) throw new Error('Publish console verification observed a browser error');
    if (fixtureFailures.length > 0) throw new Error('Publish console verification observed an unexpected fixture request');

    return {
      path: PUBLISH_CONSOLE_ROUTE,
      fixture: 'ci-publish-lock-fixture-v1',
      publishBusyLocked,
      duplicatePublishBlocked,
      publishMutationRequestCount: publishRequests.length,
      unpublishBusyLocked,
      duplicateUnpublishBlocked,
      unpublishMutationRequestCount: unpublishRequests.length,
      publicationCleared,
      browserPageErrorCount: browserErrors.length,
      fixtureFailureCount: fixtureFailures.length,
    };
  } finally {
    releasePublish?.();
    releaseUnpublish?.();
    await context.close();
  }
}

/** Exercises the organization-root access plan without sending credentials, email, or database mutations. */
export async function verifyPlatformAccessPlan({ browser, origin, timeoutMs = 60_000 }) {
  const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const browserErrors = [];
  const fixtureFailures = [];
  const mutationAttempts = [];
  page.on('pageerror', (error) => browserErrors.push(error.message));
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.hostname === 'pleyuknjnprsckssxvrh.supabase.co'
      && isDatabaseMutationRequest(request.method(), url.pathname)) {
      mutationAttempts.push({ method: request.method(), path: url.pathname });
    }
  });
  page.on('response', (response) => {
    if (response.url().includes('pleyuknjnprsckssxvrh.supabase.co') && response.status() >= 400) {
      fixtureFailures.push({ status: response.status(), path: new URL(response.url()).pathname });
    }
  });

  try {
    await prepareAuthenticatedPlatform({ context, page });
    const response = await page.goto(new URL(PLATFORM_ENTRY_ROUTE, origin).toString(), {
      waitUntil: 'domcontentloaded',
      timeout: timeoutMs,
    });
    if (!response?.ok()) throw new Error(`Access plan page returned HTTP ${response?.status() ?? 'unknown'}`);
    await page.getByRole('button', { name: '접근 관리', exact: true }).click();
    await page.waitForURL((url) => url.pathname === ACCESS_PLAN_ROUTE, { timeout: timeoutMs });
    await page.getByRole('heading', { name: '기관 역할·초대 계획' }).waitFor({ timeout: timeoutMs });

    const invitationEmail = page.getByLabel('초대 이메일');
    const invitationRole = page.getByLabel('초대 역할');
    const membershipUserId = page.getByLabel('Auth 사용자 UUID');
    const membershipRole = page.getByLabel('membership 역할');
    const validateButton = page.getByRole('button', { name: '계획 검증', exact: true });
    const downloadButton = page.getByRole('button', { name: '검증된 JSON 다운로드', exact: true });

    await invitationEmail.fill('not-an-email');
    await page.getByRole('button', { name: '초대 계획 추가', exact: true }).click();
    await validateButton.click();
    const invalidInputAlert = page.getByRole('alert').filter({ hasText: '초대 이메일과 역할을 확인하세요.' });
    await invalidInputAlert.waitFor({ timeout: timeoutMs });
    const invalidInputRejected = await invalidInputAlert.isVisible() && await downloadButton.isDisabled();
    await page.getByRole('list', { name: '추가한 이메일 초대' }).getByRole('button', { name: '제거' }).click();

    for (let index = 0; index < 2; index += 1) {
      await invitationEmail.fill(' Staff@Example.Invalid ');
      await invitationRole.selectOption('org_admin');
      await page.getByRole('button', { name: '초대 계획 추가', exact: true }).click();
    }
    await validateButton.click();
    const duplicateAlert = page.getByRole('alert').filter({ hasText: '같은 이메일과 역할의 초대가 중복되었습니다.' });
    await duplicateAlert.waitFor({ timeout: timeoutMs });
    const duplicateRejected = await duplicateAlert.isVisible() && await downloadButton.isDisabled();
    const invitationList = page.getByRole('list', { name: '추가한 이메일 초대' });
    await invitationList.getByRole('button', { name: '제거' }).last().click();

    await membershipUserId.fill(FIXTURE_IDS.user);
    await membershipRole.selectOption('hq');
    await page.getByRole('button', { name: 'membership 계획 추가', exact: true }).click();
    await validateButton.click();
    await page.getByRole('heading', { name: '승인 전 접근 계획' }).waitFor({ timeout: timeoutMs });
    const previewReady = await page.getByText('초대 1건 · 기존 계정 역할 부여 1건', { exact: true }).isVisible()
      && await page.getByText('아직 Auth 계정 생성·초대 발송·DB 변경을 수행하지 않았습니다.', { exact: true }).isVisible()
      && !await downloadButton.isDisabled();

    await invitationEmail.fill('temporary@example.invalid');
    const editInvalidated = await page.getByRole('heading', { name: '승인 전 접근 계획' }).count() === 0
      && await downloadButton.isDisabled();
    await invitationEmail.fill('');
    await validateButton.click();
    await page.getByRole('heading', { name: '승인 전 접근 계획' }).waitFor({ timeout: timeoutMs });

    const downloadPromise = page.waitForEvent('download');
    await downloadButton.click();
    const download = await downloadPromise;
    const downloadJson = await readDownloadJson(download);
    const exportedStats = validateDownloadedAccessPlan(downloadJson);
    const filename = download.suggestedFilename();
    const storageBeforeReload = await page.evaluate(() => ({
      local: Object.keys(localStorage).sort(),
      session: Object.keys(sessionStorage).sort(),
    }));

    await page.goto(new URL(PLATFORM_ENTRY_ROUTE, origin).toString(), { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    await page.getByRole('button', { name: '접근 관리', exact: true }).click();
    await page.waitForURL((url) => url.pathname === ACCESS_PLAN_ROUTE, { timeout: timeoutMs });
    await page.getByRole('heading', { name: '기관 역할·초대 계획' }).waitFor({ timeout: timeoutMs });
    const localDraftClearedOnReload = await page.getByLabel('초대 이메일').inputValue() === ''
      && await page.getByLabel('Auth 사용자 UUID').inputValue() === ''
      && await page.getByRole('list', { name: '추가한 이메일 초대' }).count() === 0
      && await page.getByRole('list', { name: '추가한 기존 계정 역할' }).count() === 0;

    const importInput = page.getByLabel('접근 계획 JSON 불러오기');
    await importInput.setInputFiles({
      name: 'wrong-organization-access-plan.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify({
        ...downloadJson,
        organization: { id: '00000000-0000-4000-8000-000000000099', label: '다른 기관' },
      }), 'utf8'),
    });
    const wrongOrganizationAlert = page.getByRole('alert').filter({ hasText: '현재 기관과 다른 접근 계획입니다.' });
    await wrongOrganizationAlert.waitFor({ timeout: timeoutMs });
    const wrongOrganizationRejected = await wrongOrganizationAlert.isVisible()
      && await page.getByRole('list', { name: '추가한 이메일 초대' }).count() === 0
      && await page.getByRole('list', { name: '추가한 기존 계정 역할' }).count() === 0;

    await page.getByLabel('초대 이메일').fill('preserve@example.invalid');
    await importInput.setInputFiles({
      name: 'oversized-access-plan.json',
      mimeType: 'application/json',
      buffer: Buffer.alloc(256 * 1024 + 1, 0x78),
    });
    const invalidImportAlert = page.getByRole('alert').filter({ hasText: '접근 계획 JSON 형식 또는 내용이 올바르지 않습니다.' });
    await invalidImportAlert.waitFor({ timeout: timeoutMs });
    const oversizedImportRejected = await invalidImportAlert.isVisible()
      && await page.getByLabel('초대 이메일').inputValue() === 'preserve@example.invalid'
      && await page.getByRole('list', { name: '추가한 이메일 초대' }).count() === 0
      && await page.getByRole('list', { name: '추가한 기존 계정 역할' }).count() === 0;
    await page.getByLabel('초대 이메일').fill('');

    await page.evaluate(() => {
      const originalText = File.prototype.text;
      File.prototype.text = async function delayedAccessPlanText() {
        if (this.name === 'slow-access-plan.json') {
          await new Promise((resolveDelay) => window.setTimeout(resolveDelay, 150));
        }
        return originalText.call(this);
      };
    });
    await importInput.setInputFiles({
      name: 'slow-access-plan.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(downloadJson), 'utf8'),
    });
    await page.getByLabel('초대 이메일').fill('latest@example.invalid');
    await page.waitForTimeout(250);
    const staleImportIgnored = await page.getByLabel('초대 이메일').inputValue() === 'latest@example.invalid'
      && await page.getByRole('heading', { name: '승인 전 접근 계획' }).count() === 0
      && await page.getByRole('list', { name: '추가한 이메일 초대' }).count() === 0
      && await page.getByRole('list', { name: '추가한 기존 계정 역할' }).count() === 0;
    await page.getByLabel('초대 이메일').fill('');

    await importInput.setInputFiles({
      name: filename,
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(downloadJson), 'utf8'),
    });
    await page.getByRole('status').filter({ hasText: '접근 계획 JSON을 다시 검증해 불러왔습니다.' }).waitFor({ timeout: timeoutMs });
    const importedPlanRestored = await page.getByRole('heading', { name: '승인 전 접근 계획' }).isVisible()
      && await page.getByRole('list', { name: '추가한 이메일 초대' }).getByRole('listitem').filter({ hasText: 'staff@example.invalid · 기관 관리자' }).count() === 1
      && await page.getByRole('list', { name: '추가한 기존 계정 역할' }).getByRole('listitem').filter({ hasText: `${FIXTURE_IDS.user} · 본부` }).count() === 1
      && !await page.getByRole('button', { name: '검증된 JSON 다운로드', exact: true }).isDisabled();
    await page.getByLabel('초대 이메일').fill('changed@example.invalid');
    const importedEditInvalidated = await page.getByRole('heading', { name: '승인 전 접근 계획' }).count() === 0
      && await page.getByRole('button', { name: '검증된 JSON 다운로드', exact: true }).isDisabled();

    await page.goto(new URL(PLATFORM_ENTRY_ROUTE, origin).toString(), { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    await page.getByRole('button', { name: '접근 관리', exact: true }).click();
    await page.waitForURL((url) => url.pathname === ACCESS_PLAN_ROUTE, { timeout: timeoutMs });
    await page.getByRole('heading', { name: '기관 역할·초대 계획' }).waitFor({ timeout: timeoutMs });
    const importedDraftClearedOnReload = await page.getByRole('list', { name: '추가한 이메일 초대' }).count() === 0
      && await page.getByRole('list', { name: '추가한 기존 계정 역할' }).count() === 0;

    if (!invalidInputRejected) throw new Error('Access plan did not reject an invalid invitation email');
    if (!duplicateRejected) throw new Error('Access plan did not reject a duplicate invitation');
    if (!previewReady) throw new Error('Access plan preview did not expose the approval boundary');
    if (!editInvalidated) throw new Error('Editing did not invalidate the access plan preview');
    if (!wrongOrganizationRejected) throw new Error('Access plan import accepted a different organization');
    if (!oversizedImportRejected) throw new Error('Access plan import accepted an oversized file');
    if (!staleImportIgnored) throw new Error('A stale access plan import replaced newer edits');
    if (!importedPlanRestored) throw new Error('Access plan import did not restore the validated plan');
    if (!importedEditInvalidated) throw new Error('Editing did not invalidate the imported access plan');
    if (!importedDraftClearedOnReload) throw new Error('Imported access plan persisted local draft state after reload');
    if (filename !== `내-기관_${FIXTURE_IDS.org}_access-plan.json`) throw new Error('Access plan filename is invalid');
    if (storageBeforeReload.local.length !== 1
      || storageBeforeReload.local[0] !== 'sb-pleyuknjnprsckssxvrh-auth-token'
      || storageBeforeReload.session.length !== 0) {
      throw new Error('Access plan persisted draft data in browser storage');
    }
    if (!localDraftClearedOnReload) throw new Error('Access plan retained local draft state after reload');
    if (browserErrors.length > 0) throw new Error('Access plan verification observed a browser error');
    if (fixtureFailures.length > 0) throw new Error('Access plan verification observed an unexpected fixture request');
    if (mutationAttempts.length > 0) throw new Error('Access plan verification observed a database mutation attempt');

    return {
      path: ACCESS_PLAN_ROUTE,
      fixture: 'ci-staff-read-fixture-v1',
      documentStatus: response.status(),
      invalidInputRejected,
      duplicateRejected,
      previewReady,
      editInvalidated,
      downloadedFilename: filename,
      exportedStats,
      approvalBoundary: {
        dryRun: downloadJson.dryRun,
        authAccountsCreated: downloadJson.authAccountsCreated,
        invitationsSent: downloadJson.invitationsSent,
        databaseMutationExecuted: downloadJson.databaseMutationExecuted,
        requiresApproval: downloadJson.requiresApproval,
      },
      browserStorageKeys: storageBeforeReload,
      localDraftClearedOnReload,
      wrongOrganizationRejected,
      oversizedImportRejected,
      staleImportIgnored,
      importedPlanRestored,
      importedEditInvalidated,
      importedDraftClearedOnReload,
      browserPageErrorCount: browserErrors.length,
      fixtureFailureCount: fixtureFailures.length,
      databaseMutationAttemptCount: mutationAttempts.length,
    };
  } finally {
    await context.close();
  }
}

/** Exercises the authenticated production component while all Supabase traffic is fixture-bound. */
export async function verifyPlatformDesignBlueprint({
  baseUrl,
  reportPath,
  sourceCommit,
  sourceTreeClean,
  sourceTreeSha256,
  timeoutMs = 60_000,
}) {
  const origin = new URL(baseUrl);
  if (!['http:', 'https:'].includes(origin.protocol)) throw new Error('baseUrl must use HTTP or HTTPS');
  const browser = await chromium.launch();
  const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const browserErrors = [];
  const fixtureFailures = [];
  const mutationAttempts = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.hostname === 'pleyuknjnprsckssxvrh.supabase.co'
      && isDatabaseMutationRequest(request.method(), url.pathname)) {
      mutationAttempts.push({ method: request.method(), path: url.pathname });
    }
  });
  page.on('pageerror', (error) => browserErrors.push(error.message));
  page.on('response', (response) => {
    if (response.url().includes('pleyuknjnprsckssxvrh.supabase.co') && response.status() >= 400) {
      fixtureFailures.push({ status: response.status(), path: new URL(response.url()).pathname });
    }
  });

  try {
    await prepareAuthenticatedPlatform({ context, page });
    const pageUrl = new URL(PLATFORM_ENTRY_ROUTE, origin);
    const response = await page.goto(pageUrl.toString(), { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    if (!response?.ok()) throw new Error(`Design blueprint page returned HTTP ${response?.status() ?? 'unknown'}`);
    await page.getByRole('button', { name: '접근성 감사 공론화', exact: true }).click();
    await page.getByRole('button', { name: 'design', exact: true }).click();
    await page.waitForURL((url) => url.pathname === DESIGN_BLUEPRINT_ROUTE, { timeout: timeoutMs });
    await page.getByRole('heading', { name: '설계 청사진' }).waitFor({ timeout: timeoutMs });

    await page.getByLabel('공론화 이름').fill('기후 공론화 2026');
    await page.getByLabel('공론화 slug').fill('climate-2026');
    await page.getByLabel('공론화 목적 (선택)').fill('감축과 적응의 실행 조건을 시민과 함께 검토한다.');
    await page.getByLabel('운영 방식').selectOption('vote');
    await page.getByRole('checkbox', { name: '참여자 배정' }).uncheck();
    await page.getByLabel('회차 이름').fill('감축 숙의');
    await page.getByLabel('회차 slug').fill('mitigation-session');
    await page.getByLabel('회차 날짜').fill('2026-09-12');
    await page.getByLabel('주제 (한 줄에 하나)').fill('감축 경로');
    await page.getByLabel('조 수').fill('1');
    await page.getByLabel('예상 참여자 수').fill('12');
    await page.getByRole('button', { name: '회차 추가' }).click();

    const dates = page.getByLabel('회차 날짜');
    const sessionTitles = page.getByLabel('회차 이름');
    const sessionSlugs = page.getByLabel('회차 slug');
    const topics = page.getByLabel('주제 (한 줄에 하나)');
    const teams = page.getByLabel('조 수');
    const participants = page.getByLabel('예상 참여자 수');
    await sessionTitles.nth(1).fill('적응 숙의');
    await sessionSlugs.nth(1).fill('adaptation-session');
    await dates.nth(1).fill('2026-09-11');
    await topics.nth(1).fill('적응 정책');
    await teams.nth(1).fill('1');
    await participants.nth(1).fill('10');
    await page.getByRole('button', { name: '청사진 검증' }).click();
    const dateError = page.getByText('회차 날짜는 앞 회차보다 이르지 않아야 합니다.', { exact: true });
    await dateError.waitFor({ timeout: timeoutMs });
    const invalidDateRejected = await dateError.isVisible();

    await dates.nth(1).fill('2026-09-13');
    await page.getByRole('button', { name: '청사진 검증' }).click();
    await page.getByRole('heading', { name: '승인 검토용 미리보기' }).waitFor({ timeout: timeoutMs });
    const previewSummary = await page.getByText('회차 2개 · 주제 2개 · 조 2개 · 예상 참여자 22명').isVisible();
    await page.setViewportSize({ width: 360, height: 800 });
    const blueprintTableRegion = page.getByRole('region', { name: '설계 청사진 회차별 구성 표' });
    await blueprintTableRegion.focus();
    const blueprintTableScroll = await blueprintTableRegion.evaluate((region) => ({
      clientWidth: region.clientWidth,
      scrollWidth: region.scrollWidth,
      focused: document.activeElement === region,
    }));
    await blueprintTableRegion.press('End');
    const blueprintTableKeyboardScrolled = await blueprintTableRegion.evaluate((region) => region.scrollLeft > 0);
    await page.setViewportSize({ width: 1440, height: 1000 });

    await topics.nth(1).fill('적응 정책 보완');
    const previewInvalidated = await page.getByRole('heading', { name: '승인 검토용 미리보기' }).count() === 0
      && await page.getByRole('button', { name: 'JSON 내려받기' }).count() === 0;
    await topics.nth(1).fill('적응 정책');
    await page.getByRole('button', { name: '청사진 검증' }).click();
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'JSON 내려받기' }).click();
    const download = await downloadPromise;
    const downloadJson = await readDownloadJson(download);
    const exportedStats = validateDownloadedBlueprint(downloadJson);
    const filename = download.suggestedFilename();

    await page.getByLabel('공론화 이름').fill('임시 변경');
    await topics.nth(1).fill('임시 주제');
    const importInput = page.getByLabel('청사진 JSON 불러오기');
    await importInput.setInputFiles({
      name: 'malformed-blueprint.json',
      mimeType: 'application/json',
      buffer: Buffer.from('{"secret":"unfinished"', 'utf8'),
    });
    const importError = page.getByRole('alert').filter({ hasText: '청사진 JSON 형식 또는 내용이 올바르지 않습니다.' });
    await importError.waitFor({ timeout: timeoutMs });
    const malformedImportRejected = await importError.isVisible();
    const malformedImportPreservedDraft = await page.getByLabel('공론화 이름').inputValue() === '임시 변경'
      && await topics.nth(1).inputValue() === '임시 주제';

    await importInput.setInputFiles({
      name: 'climate-2026_design_blueprint.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(downloadJson), 'utf8'),
    });
    const importStatus = page.getByRole('status').filter({ hasText: '청사진 JSON을 불러왔습니다. 내용을 확인하고 편집을 이어가세요.' });
    await importStatus.waitFor({ timeout: timeoutMs });
    const validImportRestoredHierarchy = await page.getByLabel('공론화 이름').inputValue() === '기후 공론화 2026'
      && await page.getByLabel('공론화 slug').inputValue() === 'climate-2026'
      && await page.getByLabel('공론화 목적 (선택)').inputValue() === '감축과 적응의 실행 조건을 시민과 함께 검토한다.'
      && await page.getByLabel('운영 방식').inputValue() === 'vote'
      && await page.getByRole('checkbox', { name: '공개 주제' }).isChecked()
      && await page.getByRole('checkbox', { name: '활성 조' }).isChecked()
      && !await page.getByRole('checkbox', { name: '참여자 배정' }).isChecked()
      && await sessionTitles.nth(0).inputValue() === '감축 숙의'
      && await sessionSlugs.nth(0).inputValue() === 'mitigation-session'
      && await sessionTitles.nth(1).inputValue() === '적응 숙의'
      && await sessionSlugs.nth(1).inputValue() === 'adaptation-session'
      && await dates.count() === 2
      && await topics.count() === 2
      && await teams.count() === 2
      && await participants.count() === 2
      && await dates.nth(0).inputValue() === '2026-09-12'
      && await dates.nth(1).inputValue() === '2026-09-13'
      && await topics.nth(0).inputValue() === '감축 경로'
      && await topics.nth(1).inputValue() === '적응 정책'
      && await teams.nth(0).inputValue() === '1'
      && await teams.nth(1).inputValue() === '1'
      && await participants.nth(0).inputValue() === '12'
      && await participants.nth(1).inputValue() === '10';
    const importedPreviewReady = await page.getByRole('heading', { name: '승인 검토용 미리보기' }).isVisible()
      && await page.getByRole('button', { name: 'JSON 내려받기' }).isVisible();
    await topics.nth(1).fill('복원 후 편집');
    const importEditInvalidated = await page.getByRole('heading', { name: '승인 검토용 미리보기' }).count() === 0
      && await page.getByRole('button', { name: 'JSON 내려받기' }).count() === 0;
    await page.getByLabel('공론화 이름').fill('큰 파일 전 편집');
    await importInput.setInputFiles({
      name: 'oversized-blueprint.json',
      mimeType: 'application/json',
      buffer: Buffer.alloc(1_000_001, 0x78),
    });
    await importError.waitFor({ timeout: timeoutMs });
    const oversizedImportRejected = await importError.isVisible()
      && await page.getByLabel('공론화 이름').inputValue() === '큰 파일 전 편집';
    await page.evaluate(() => {
      const originalText = File.prototype.text;
      File.prototype.text = async function delayedBlueprintText() {
        if (this.name === 'slow-blueprint.json') {
          await new Promise((resolveDelay) => window.setTimeout(resolveDelay, 150));
        }
        return originalText.call(this);
      };
    });
    await importInput.setInputFiles({
      name: 'slow-blueprint.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(downloadJson), 'utf8'),
    });
    await page.getByLabel('공론화 이름').fill('최신 편집 유지');
    await page.waitForTimeout(250);
    const staleImportIgnored = await page.getByLabel('공론화 이름').inputValue() === '최신 편집 유지'
      && await page.getByRole('heading', { name: '승인 검토용 미리보기' }).count() === 0;

    if (!invalidDateRejected) throw new Error('Design blueprint did not reject reversed session dates');
    if (!previewSummary) throw new Error('Design blueprint preview summary is missing');
    if (blueprintTableScroll.scrollWidth <= blueprintTableScroll.clientWidth
      || !blueprintTableScroll.focused
      || !blueprintTableKeyboardScrolled) {
      throw new Error('Design blueprint table is not keyboard-scrollable on mobile');
    }
    if (!previewInvalidated) throw new Error('Editing did not invalidate the blueprint preview');
    if (filename !== 'climate-2026_design_blueprint.json') throw new Error('Design blueprint filename is invalid');
    if (!malformedImportRejected) throw new Error('Design blueprint did not reject malformed import content');
    if (!malformedImportPreservedDraft) throw new Error('Malformed import replaced the current draft');
    if (!validImportRestoredHierarchy) throw new Error('Valid import did not restore the blueprint hierarchy');
    if (!importedPreviewReady) throw new Error('Valid import did not restore the verified preview');
    if (!importEditInvalidated) throw new Error('Editing the imported blueprint did not invalidate the preview');
    if (!oversizedImportRejected) throw new Error('Oversized import was not rejected without replacing the current draft');
    if (!staleImportIgnored) throw new Error('A stale import replaced newer blueprint edits');
    if (browserErrors.length > 0) throw new Error('Design blueprint verification observed a browser error');
    if (fixtureFailures.length > 0) throw new Error('Design blueprint verification observed an unexpected fixture request');
    if (mutationAttempts.length > 0) throw new Error('Design blueprint verification observed a database mutation attempt');

    const accessPlan = await verifyPlatformAccessPlan({ browser, origin, timeoutMs });
    const authLock = await verifyPlatformAuthLock({ browser, origin, timeoutMs });
    const sessionIsolation = await verifyPlatformSessionIsolation({ browser, origin, timeoutMs });
    const organizationSelection = await verifyPlatformOrganizationSelection({ browser, origin, timeoutMs });
    const reviewRace = await verifyReviewConsoleRace({ browser, origin, timeoutMs });
    const publishLock = await verifyPublishConsoleLock({ browser, origin, timeoutMs });

    const report = {
      schemaVersion: 12,
      generatedAt: new Date().toISOString(),
      baseUrl: origin.origin,
      path: DESIGN_BLUEPRINT_ROUTE,
      sourceCommit,
      sourceTreeClean,
      sourceTreeSha256,
      fixture: 'ci-staff-read-fixture-v1',
      productionDatabaseAccess: false,
      runtime: { node: process.version, chromium: browser.version() },
      status: 'pass',
      checks: {
        documentStatus: response.status(),
        multiSessionInput: true,
        invalidDateRejected,
        previewSummary,
        blueprintTableScroll: {
          ...blueprintTableScroll,
          keyboardScrolled: blueprintTableKeyboardScrolled,
        },
        previewInvalidated,
        downloadedFilename: filename,
        blueprintSchemaVersion: downloadJson.schemaVersion,
        assemblyIntent: {
          purpose: downloadJson.assembly.purpose,
          mode: downloadJson.assembly.mode,
          readiness: downloadJson.assembly.config.readiness,
        },
        sessionIdentities: downloadJson.sessions.map((session) => ({ title: session.title, slug: session.slug })),
        exportedStats,
        malformedImportRejected,
        malformedImportPreservedDraft,
        validImportRestoredHierarchy,
        importedPreviewReady,
        importEditInvalidated,
        oversizedImportRejected,
        staleImportIgnored,
        approvalBoundary: {
          dryRun: downloadJson.dryRun,
          databaseMutationExecuted: downloadJson.databaseMutationExecuted,
          requiresApproval: downloadJson.requiresApproval,
        },
        browserPageErrorCount: browserErrors.length,
        fixtureFailureCount: fixtureFailures.length,
        databaseMutationAttemptCount: mutationAttempts.length,
        accessPlan,
        authLock,
        sessionIsolation,
        organizationSelection,
        reviewRace,
        publishLock,
      },
    };
    if (reportPath) {
      mkdirSync(dirname(reportPath), { recursive: true });
      writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    }
    return report;
  } finally {
    await context.close();
    await browser.close();
  }
}

function optionValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const isCli = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isCli) {
  const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: projectRoot, encoding: 'utf8' }).trim();
  const statusOutput = readAuditSourceStatus(projectRoot);
  const sourceTreeSha256 = readSourceTreeSha256(projectRoot);
  const allowDirtySource = process.argv.includes('--allow-dirty-source');
  if (statusOutput.trim() && !allowDirtySource) throw new Error('Design blueprint verification source tree is dirty');
  const baseUrl = optionValue('--base-url') ?? process.env.PLATFORM_A11Y_BASE_URL ?? 'http://127.0.0.1:4321';
  const reportPath = resolve(
    optionValue('--output-json')
      ?? process.env.PLATFORM_DESIGN_REPORT
      ?? resolve(projectRoot, 'evaluation', '2026-08-11-platform-design-blueprint-browser.json'),
  );
  const report = await verifyPlatformDesignBlueprint({
    baseUrl,
    reportPath,
    sourceCommit,
    sourceTreeClean: !statusOutput.trim(),
    sourceTreeSha256,
  });
  console.log(JSON.stringify({ reportPath, status: report.status, checks: report.checks }));
}
