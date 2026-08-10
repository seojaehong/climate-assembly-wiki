import { chromium } from 'playwright';
import axe from 'axe-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

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

async function auditRoute(browser, baseUrl, route, settleMs) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  try {
    const url = routeUrl(baseUrl, route.path);
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    if (settleMs > 0) await page.waitForTimeout(settleMs);
    await page.addScriptTag({ content: axe.source });
    const axeResult = await page.evaluate(async (tags) => globalThis.axe.run(document, {
      runOnly: { type: 'tag', values: tags },
      resultTypes: ['violations', 'incomplete'],
    }), WCAG_TAGS);
    const skipLink = await inspectSkipLink(page, route.skipTarget);
    const violations = axeResult.violations.map(violationEvidence);
    const incomplete = axeResult.incomplete.map(violationEvidence);
    const httpStatus = response?.status() ?? null;
    const httpOk = httpStatus === null || (httpStatus >= 200 && httpStatus < 400);
    const passed = httpOk && violations.length === 0 && skipLink.focusMoved;
    return {
      id: route.id,
      path: route.path,
      url,
      httpStatus,
      passed,
      skipLink,
      violations,
      incomplete,
      error: null,
    };
  } catch (error) {
    console.error(`Accessibility audit failed for route ${route.id}`, error);
    return {
      id: route.id,
      path: route.path,
      url: routeUrl(baseUrl, route.path),
      httpStatus: null,
      passed: false,
      skipLink: { found: false, target: route.skipTarget, focusMoved: false },
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
}) {
  if (!Array.isArray(routes) || routes.length === 0) {
    throw new Error('At least one accessibility audit route is required.');
  }
  for (const route of routes) {
    if (!route.skipTarget) throw new Error(`Route ${route.id} requires an expected skip target.`);
  }

  const browser = await chromium.launch();
  let auditedRoutes;
  try {
    auditedRoutes = [];
    for (const route of routes) {
      auditedRoutes.push(await auditRoute(browser, baseUrl, route, settleMs));
    }
  } finally {
    await browser.close();
  }

  const violationCount = auditedRoutes.reduce((total, route) => total + route.violations.length, 0);
  const incompleteCount = auditedRoutes.reduce((total, route) => total + route.incomplete.length, 0);
  const passedRoutes = auditedRoutes.filter((route) => route.passed).length;
  const failed = passedRoutes !== auditedRoutes.length;
  const needsReview = !failed && (incompleteCount > 0 || excludedSurfaces.length > 0);
  const report = {
    schemaVersion: 1,
    generatedAt: generatedAt.toISOString(),
    baseUrl,
    standard: 'WCAG 2.2 AA automated subset + skip-link focus',
    engine: { name: 'axe-core', version: axe.version, tags: WCAG_TAGS },
    status: failed ? 'fail' : needsReview ? 'needs_review' : 'pass',
    summary: {
      routeCount: auditedRoutes.length,
      passedRoutes,
      violationCount,
      incompleteCount,
      excludedSurfaceCount: excludedSurfaces.length,
    },
    coverage: {
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
    excludedSurfaces: [
      {
        id: 'authenticated-platform',
        reason: 'A CI-safe authenticated staff fixture is not provisioned.',
      },
      {
        id: 'published-result',
        reason: 'A stable public result fixture is not provisioned without exposing a result token.',
      },
    ],
    routes: [
      { id: 'platform-login', path: '/platform/', skipTarget: 'platform-scope-content' },
      { id: 'accessibility-statement', path: '/platform/accessibility/', skipTarget: 'main-content' },
      { id: 'public-result-unpublished', path: '/r/_/', skipTarget: 'main-content' },
    ],
  });
  console.log(JSON.stringify({ reportPath, status: report.status, summary: report.summary }));
  if (report.status === 'fail') process.exitCode = 1;
}
