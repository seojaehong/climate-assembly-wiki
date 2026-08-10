import { chromium } from 'playwright';
import axe from 'axe-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
export const DEFAULT_AUDIT_PROFILES = [
  { id: 'desktop', viewport: { width: 1440, height: 1000 } },
  { id: 'mobile', viewport: { width: 360, height: 800 }, minimumContentWidth: 280 },
];

const SUPABASE_ORIGIN = 'https://pleyuknjnprsckssxvrh.supabase.co';
const AUTH_STORAGE_KEY = 'sb-pleyuknjnprsckssxvrh-auth-token';
const FIXTURE_IDS = {
  user: '00000000-0000-4000-8000-000000000001',
  org: '00000000-0000-4000-8000-000000000002',
  assembly: '00000000-0000-4000-8000-000000000003',
  session: '00000000-0000-4000-8000-000000000004',
  topic: '00000000-0000-4000-8000-000000000005',
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

async function prepareAuthenticatedPlatform({ context, page }) {
  const session = auditSession();
  await context.addInitScript(({ key, value }) => {
    localStorage.setItem(key, JSON.stringify(value));
  }, { key: AUTH_STORAGE_KEY, value: session });
  await page.route(`${SUPABASE_ORIGIN}/**`, async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/auth/v1/user') return jsonResponse(route, auditUser());
    if (path === '/auth/v1/token') return jsonResponse(route, session);
    if (path === '/rest/v1/rpc/org_of_uid') return jsonResponse(route, FIXTURE_IDS.org);
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
      return jsonResponse(route, [{
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

export const DEFAULT_AUDIT_ROUTES = [
  { id: 'platform-login', path: '/platform/', skipTarget: 'platform-scope-content' },
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
    readySelector: 'main#main-content header h1',
    openDetailsBeforeAudit: true,
    requiredMobileScrollRegions: ['조별 쟁점 커버리지 표', '쟁점 분석 데이터 표'],
    prepare: preparePublishedResult,
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
    const scrollLeft = await region.evaluate((element) => element.scrollLeft);
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

async function auditRoute(browser, baseUrl, route, profile, settleMs) {
  const context = await browser.newContext({ viewport: profile.viewport });
  const page = await context.newPage();
  const readiness = route.readySelector
    ? { selector: route.readySelector, reached: false }
    : null;
  try {
    if (route.prepare) await route.prepare({ context, page, baseUrl });
    const url = routeUrl(baseUrl, route.path);
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
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
    const violations = axeResult.violations.map(violationEvidence);
    const incomplete = axeResult.incomplete.map(violationEvidence);
    const httpStatus = response?.status() ?? null;
    const httpOk = httpStatus === null || (httpStatus >= 200 && httpStatus < 400);
    const passed = httpOk
      && violations.length === 0
      && skipLink.focusMoved
      && !layout.horizontalOverflow
      && layout.contentWidthSufficient
      && layout.clippedOutsideScrollRegions.length === 0
      && requiredScrollRegions.every((region) => region.found && region.scrollable && region.focused && region.keyboardScrolled);
    return {
      id: `${route.id}:${profile.id}`,
      routeId: route.id,
      profile: profile.id,
      viewport: profile.viewport,
      path: route.path,
      url,
      fixture: route.fixture ?? null,
      readiness,
      httpStatus,
      passed,
      skipLink,
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
      readiness,
      httpStatus: null,
      passed: false,
      skipLink: { found: false, target: route.skipTarget, focusMoved: false },
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
  routes,
  reportPath,
  generatedAt = new Date(),
  settleMs = 0,
  excludedSurfaces = [],
  profiles = DEFAULT_AUDIT_PROFILES,
}) {
  if (!Array.isArray(routes) || routes.length === 0) {
    throw new Error('At least one accessibility audit route is required.');
  }
  for (const route of routes) {
    if (!route.skipTarget) throw new Error(`Route ${route.id} requires an expected skip target.`);
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
  const needsReview = !failed && (incompleteCount > 0 || excludedSurfaces.length > 0);
  const report = {
    schemaVersion: 2,
    generatedAt: generatedAt.toISOString(),
    baseUrl,
    standard: 'WCAG 2.2 AA automated subset + skip-link focus + responsive overflow',
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

const isCli = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isCli) {
  const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const baseUrl = process.env.PLATFORM_A11Y_BASE_URL ?? 'http://127.0.0.1:4321';
  const reportPath = process.env.PLATFORM_A11Y_REPORT
    ? resolve(process.env.PLATFORM_A11Y_REPORT)
    : resolve(projectRoot, 'evaluation', 'platform-accessibility-audit.json');
  const report = await auditPlatformAccessibility({
    baseUrl,
    reportPath,
    settleMs: 1_500,
    excludedSurfaces: DEFAULT_EXCLUDED_SURFACES,
    routes: DEFAULT_AUDIT_ROUTES,
  });
  console.log(JSON.stringify({ reportPath, status: report.status, summary: report.summary }));
  if (report.status === 'fail') process.exitCode = 1;
}
