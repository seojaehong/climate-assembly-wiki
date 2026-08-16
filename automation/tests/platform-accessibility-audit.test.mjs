import { afterAll, beforeAll, expect, test } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_AUDIT_ROUTES,
  DEFAULT_EXCLUDED_SURFACES,
  AUDITED_SOURCE_PATHS,
  accessibilityAuditExitCode,
  auditPlatformAccessibility,
  readAuditSourceStatus,
  validateAuditSourceState,
} from '../platform-accessibility-audit.mjs';

let outDir;
let server;
let baseUrl;
const TEST_SOURCE_COMMIT = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const BROWSER_TEST_TIMEOUT_MS = 60_000;

const validPage = `<!doctype html>
  <html lang="ko"><head><title>접근성 테스트</title></head><body>
    <a href="#main-content">본문 바로가기</a>
    <main id="main-content" tabindex="-1">
      <h1>접근성 테스트</h1>
      <label for="query">검색</label><input id="query" autocomplete="off">
    </main>
  </body></html>`;

const invalidPage =
  '<!doctype html><html><head></head><body><main><h1>결함 화면</h1><img src="missing.png"><input></main></body></html>';
const wrongSkipPage = `<!doctype html><html lang="ko"><head><title>잘못된 링크</title></head><body>
  <a href="#details">세부 내용</a><main id="main-content" tabindex="-1"><h1>본문</h1>
  <section id="details" tabindex="-1"><h2>세부 내용</h2></section></main></body></html>`;
const incompletePage = `<!doctype html><html lang="ko"><head><title>수동 확인</title></head><body>
  <a href="#main-content">본문 바로가기</a><main id="main-content" tabindex="-1"><h1>수동 확인</h1>
  <div style="background:linear-gradient(90deg,#fff,#000)"><span style="color:#777">배경 대비 확인</span></div>
  </main></body></html>`;
const overflowPage = `<!doctype html><html lang="ko"><head><title>모바일 넘침</title></head><body>
  <a href="#main-content">본문 바로가기</a><main id="main-content" tabindex="-1"><h1>모바일 넘침</h1>
  <div style="width:500px">고정 폭 콘텐츠</div></main></body></html>`;
const scrollRegionPage = `<!doctype html><html lang="ko"><head><title>스크롤 영역</title></head><body>
  <a href="#main-content">본문 바로가기</a><main id="main-content" tabindex="-1">
  <div role="region" aria-label="넓은 표" tabindex="0" style="width:300px;overflow-x:auto"
    onkeydown="if(event.key==='End'){this.scrollLeft=this.scrollWidth;event.preventDefault()}">
  <div style="width:500px">가로 스크롤 콘텐츠</div></div></main></body></html>`;
const preparedPage = `<!doctype html><html lang="ko"><head><title>Fixture 준비</title></head><body>
  <a href="#main-content">본문 바로가기</a><main id="main-content" tabindex="-1">
  <h1>불러오는 중</h1></main><script>
  fetch('/fixture-data').then((response) => response.json()).then((data) => {
    document.querySelector('h1').textContent = data.title;
    document.querySelector('main').dataset.ready = 'true';
  });
  </script></body></html>`;

beforeAll(async () => {
  outDir = mkdtempSync(join(tmpdir(), 'platform-a11y-'));
  server = createServer((request, response) => {
    response.writeHead(request.url === '/missing' ? 404 : 200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(
      request.url === '/invalid'
        ? invalidPage
        : request.url === '/wrong-skip'
          ? wrongSkipPage
          : request.url === '/incomplete'
            ? incompletePage
            : request.url === '/overflow'
              ? overflowPage
            : request.url === '/scroll-region'
              ? scrollRegionPage
            : request.url === '/prepared'
              ? preparedPage
            : validPage,
    );
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  rmSync(outDir, { recursive: true, force: true });
});

test('audits WCAG 2.2 AA and skip-link focus through a real browser', async () => {
  const reportPath = join(outDir, 'report.json');

  const report = await auditPlatformAccessibility({
    baseUrl,
    sourceCommit: TEST_SOURCE_COMMIT,
    sourceTreeClean: true,
    routes: [{ id: 'valid', path: '/valid', skipTarget: 'main-content' }],
    reportPath,
    generatedAt: new Date('2026-08-11T00:00:00.000Z'),
  });

  expect(report.status).toBe('pass');
  expect(report.schemaVersion).toBe(3);
  expect(report.sourceCommit).toBe(TEST_SOURCE_COMMIT);
  expect(report.sourceTreeClean).toBe(true);
  expect(report.targetRevision).toEqual({
    status: 'not_verified',
    sourceCommit: null,
    reason: 'The audited origin does not expose a machine-verifiable deployment revision.',
  });
  expect(report.summary).toEqual({
    routeCount: 1,
    profileCount: 2,
    auditCaseCount: 2,
    passedRoutes: 1,
    passedCases: 2,
    violationCount: 0,
    incompleteCount: 0,
    excludedSurfaceCount: 0,
  });
  expect(report.routes[0].skipLink).toMatchObject({ target: 'main-content', focusMoved: true });
  expect(report.routes[0].violations).toEqual([]);
  expect(report.routes[0].incomplete).toEqual([]);
  expect(existsSync(reportPath)).toBe(true);
  expect(JSON.parse(readFileSync(reportPath, 'utf8'))).toEqual(report);
}, BROWSER_TEST_TIMEOUT_MS);

test('waits for a fixture-backed production surface before auditing it', async () => {
  const report = await auditPlatformAccessibility({
    baseUrl,
    sourceCommit: TEST_SOURCE_COMMIT,
    sourceTreeClean: true,
    routes: [{
      id: 'prepared',
      path: '/prepared',
      skipTarget: 'main-content',
      fixture: 'read-only-browser-fixture',
      readySelector: 'main[data-ready="true"]',
      prepare: async ({ page }) => {
        await page.route('**/fixture-data', async (route) => {
          await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ title: '준비 완료' }) });
        });
      },
    }],
    reportPath: join(outDir, 'prepared.json'),
  });

  expect(report.status).toBe('pass');
  expect(report.routes[0]).toMatchObject({
    id: 'prepared:desktop',
    routeId: 'prepared',
    profile: 'desktop',
    passed: true,
    fixture: 'read-only-browser-fixture',
    readiness: { selector: 'main[data-ready="true"]', reached: true },
  });
}, BROWSER_TEST_TIMEOUT_MS);

test('preserves actionable violation evidence for a failing route', async () => {
  const report = await auditPlatformAccessibility({
    baseUrl,
    sourceCommit: TEST_SOURCE_COMMIT,
    sourceTreeClean: true,
    routes: [{ id: 'invalid', path: '/invalid', skipTarget: 'main-content' }],
    reportPath: join(outDir, 'invalid.json'),
    generatedAt: new Date('2026-08-11T00:00:00.000Z'),
  });

  expect(report.status).toBe('fail');
  expect(report.summary.violationCount).toBeGreaterThan(0);
  expect(report.routes[0].violations).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: 'document-title', impact: 'serious' }),
    expect.objectContaining({ id: 'html-has-lang' }),
    expect.objectContaining({ id: 'image-alt' }),
    expect.objectContaining({ id: 'label' }),
  ]));
  expect(report.routes[0].skipLink).toMatchObject({ focusMoved: false });
}, BROWSER_TEST_TIMEOUT_MS);

test('fails an accessible error document when the route itself is unavailable', async () => {
  const report = await auditPlatformAccessibility({
    baseUrl,
    sourceCommit: TEST_SOURCE_COMMIT,
    sourceTreeClean: true,
    routes: [{ id: 'missing', path: '/missing', skipTarget: 'main-content' }],
    reportPath: join(outDir, 'missing.json'),
  });

  expect(report.status).toBe('fail');
  expect(report.routes[0]).toMatchObject({ httpStatus: 404, passed: false, violations: [] });
}, BROWSER_TEST_TIMEOUT_MS);

test('distinguishes passing checks from unaudited product surfaces', async () => {
  const report = await auditPlatformAccessibility({
    baseUrl,
    sourceCommit: TEST_SOURCE_COMMIT,
    sourceTreeClean: true,
    routes: [{ id: 'valid', path: '/valid', skipTarget: 'main-content' }],
    excludedSurfaces: [{ id: 'authenticated-platform', reason: 'fixture unavailable' }],
    reportPath: join(outDir, 'needs-review.json'),
  });

  expect(report.status).toBe('needs_review');
  expect(report.summary).toMatchObject({ incompleteCount: 0, excludedSurfaceCount: 1 });
  expect(report.coverage.excluded).toEqual([
    { id: 'authenticated-platform', reason: 'fixture unavailable' },
  ]);
}, BROWSER_TEST_TIMEOUT_MS);

test('does not mistake another same-page link for the expected skip link', async () => {
  const report = await auditPlatformAccessibility({
    baseUrl,
    sourceCommit: TEST_SOURCE_COMMIT,
    sourceTreeClean: true,
    routes: [{ id: 'wrong-skip', path: '/wrong-skip', skipTarget: 'main-content' }],
    reportPath: join(outDir, 'wrong-skip.json'),
  });

  expect(report.status).toBe('fail');
  expect(report.routes[0].skipLink).toEqual({
    found: false,
    target: 'main-content',
    focusMoved: false,
  });
}, BROWSER_TEST_TIMEOUT_MS);

test('preserves axe incomplete evidence and fails the automated audit', async () => {
  const reportPath = join(outDir, 'incomplete.json');
  const report = await auditPlatformAccessibility({
    baseUrl,
    sourceCommit: TEST_SOURCE_COMMIT,
    sourceTreeClean: true,
    routes: [{ id: 'incomplete', path: '/incomplete', skipTarget: 'main-content' }],
    reportPath,
  });

  expect(report.status).toBe('fail');
  expect(report.summary).toMatchObject({ violationCount: 0, incompleteCount: 2, passedCases: 0 });
  expect(accessibilityAuditExitCode(report)).toBe(1);
  expect(accessibilityAuditExitCode({ status: 'unexpected' })).toBe(1);
  expect(report.routes[0].incomplete).toEqual([
    expect.objectContaining({
      id: 'color-contrast',
      impact: 'serious',
      nodes: [expect.objectContaining({ target: ['span'] })],
    }),
  ]);
  expect(JSON.parse(readFileSync(reportPath, 'utf8')).routes).toEqual([
    expect.objectContaining({ profile: 'desktop', incomplete: [expect.objectContaining({ id: 'color-contrast' })] }),
    expect.objectContaining({ profile: 'mobile', incomplete: [expect.objectContaining({ id: 'color-contrast' })] }),
  ]);
}, BROWSER_TEST_TIMEOUT_MS);

test('fails a mobile audit case when the document has horizontal overflow', async () => {
  const report = await auditPlatformAccessibility({
    baseUrl,
    sourceCommit: TEST_SOURCE_COMMIT,
    sourceTreeClean: true,
    routes: [{ id: 'overflow', path: '/overflow', skipTarget: 'main-content' }],
    profiles: [{ id: 'mobile', viewport: { width: 360, height: 800 } }],
    reportPath: join(outDir, 'mobile-overflow.json'),
  });

  expect(report.status).toBe('fail');
  expect(report.summary).toMatchObject({ routeCount: 1, profileCount: 1, auditCaseCount: 1, passedCases: 0 });
  expect(report.routes[0]).toMatchObject({
    routeId: 'overflow',
    profile: 'mobile',
    viewport: { width: 360, height: 800 },
    passed: false,
    layout: {
      viewportWidth: 360,
      rawHorizontalOverflow: true,
      horizontalOverflow: true,
    },
  });
  expect(report.routes[0].layout.documentWidth).toBeGreaterThan(360);
}, BROWSER_TEST_TIMEOUT_MS);

test('fails a mobile audit case when the target content is compressed', async () => {
  const report = await auditPlatformAccessibility({
    baseUrl,
    sourceCommit: TEST_SOURCE_COMMIT,
    sourceTreeClean: true,
    routes: [{ id: 'compressed', path: '/', skipTarget: 'main-content' }],
    profiles: [{ id: 'mobile', viewport: { width: 360, height: 800 }, minimumContentWidth: 400 }],
    reportPath: join(outDir, 'mobile-compressed.json'),
  });

  expect(report.status).toBe('fail');
  expect(report.routes[0]).toMatchObject({
    passed: false,
    layout: {
      horizontalOverflow: false,
      minimumContentWidth: 400,
      contentWidthSufficient: false,
    },
  });
  expect(report.routes[0].layout.contentWidth).toBeLessThan(400);
}, BROWSER_TEST_TIMEOUT_MS);

test('verifies keyboard scrolling without treating region content as document clipping', async () => {
  const report = await auditPlatformAccessibility({
    baseUrl,
    sourceCommit: TEST_SOURCE_COMMIT,
    sourceTreeClean: true,
    routes: [{
      id: 'scroll-region',
      path: '/scroll-region',
      skipTarget: 'main-content',
      requiredMobileScrollRegions: ['넓은 표'],
    }],
    profiles: [{ id: 'mobile', viewport: { width: 360, height: 800 }, minimumContentWidth: 280 }],
    reportPath: join(outDir, 'mobile-scroll-region.json'),
  });

  expect(report.status).toBe('pass');
  expect(report.routes[0].requiredScrollRegions).toEqual([
    expect.objectContaining({
      label: '넓은 표',
      found: true,
      scrollable: true,
      focused: true,
      keyboardScrolled: true,
    }),
  ]);
  expect(report.routes[0].layout.clippedOutsideScrollRegions).toEqual([]);
  expect(report.routes[0].layout).toMatchObject({ rawHorizontalOverflow: false, horizontalOverflow: false });
}, BROWSER_TEST_TIMEOUT_MS);

test('installs root dependencies without requiring an ignored lockfile', () => {
  const workflow = readFileSync(
    new URL('../../.github/workflows/platform-accessibility.yml', import.meta.url),
    'utf8',
  );

  expect(workflow).toContain('cache-dependency-path: automation/package-lock.json');
  expect(workflow).toContain('run: npm install --no-package-lock');
  expect(workflow).toContain('working-directory: automation\n        run: npm ci');
  expect(workflow).not.toContain('run: npm ci\n      - name: Install audit dependencies');
});

test('refuses to audit when the workflow commit differs from the checkout', () => {
  const modulePath = fileURLToPath(new URL('../platform-accessibility-audit.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [modulePath], {
    cwd: fileURLToPath(new URL('../..', import.meta.url)),
    env: { ...process.env, GITHUB_SHA: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' },
    encoding: 'utf8',
  });

  expect(result.status).toBe(1);
  expect(result.stderr).toContain('Accessibility audit checkout does not match workflow commit.');
});

test('refuses evidence when audited source paths have uncommitted changes', () => {
  expect(() => validateAuditSourceState({
    sourceCommit: TEST_SOURCE_COMMIT,
    workflowCommit: TEST_SOURCE_COMMIT,
    statusOutput: ' M src/islands/result/ResultView.tsx\n',
  })).toThrow('Accessibility audit source paths contain uncommitted changes.');
});

test('detects untracked audited source and includes build and auditor dependencies', () => {
  const repoDir = mkdtempSync(join(tmpdir(), 'platform-a11y-git-'));
  try {
    execFileSync('git', ['init'], { cwd: repoDir, stdio: 'ignore' });
    mkdirSync(join(repoDir, 'src', 'layouts'), { recursive: true });
    writeFileSync(join(repoDir, 'src', 'layouts', 'NewLayout.astro'), '<main />');

    expect(readAuditSourceStatus(repoDir)).toContain('?? src/layouts/NewLayout.astro');
    expect(AUDITED_SOURCE_PATHS).toEqual(expect.arrayContaining([
      '.github/workflows/platform-accessibility.yml',
      'astro.config.mjs',
      'package-lock.json',
      'automation/package-lock.json',
      'src/islands/OntologyReviewConsole.tsx',
      'src/islands/canvas',
      'src/layouts',
      'src/pages',
    ]));
  } finally {
    rmSync(repoDir, { recursive: true, force: true });
  }
});

test('covers authenticated and published production surfaces with read-only browser fixtures', () => {
  expect(DEFAULT_AUDIT_ROUTES.map((route) => route.id)).toEqual([
    'platform-login',
    'authenticated-platform',
    'accessibility-statement',
    'public-result-unpublished',
    'published-result',
    'ontology-review',
  ]);
  expect(DEFAULT_AUDIT_ROUTES.find((route) => route.id === 'authenticated-platform')).toMatchObject({
    path: '/platform/',
    fixture: 'ci-staff-read-fixture-v1',
    readySelector: 'aside button[aria-current="location"]',
  });
  expect(DEFAULT_AUDIT_ROUTES.find((route) => route.id === 'published-result')).toMatchObject({
    path: '/r/_/',
    fixture: 'ci-published-result-read-fixture-v1',
    readySelector: 'main#main-content [data-implementation-tracking-ready="true"]',
    openDetailsBeforeAudit: true,
    requiredMobileScrollRegions: ['조별 쟁점 커버리지 표', '쟁점 분석 데이터 표'],
  });
  expect(DEFAULT_AUDIT_ROUTES.find((route) => route.id === 'ontology-review')).toMatchObject({
    path: '/ko/moderator/ontology-review/',
    skipTarget: 'ontology-review-content',
    fixture: 'ci-staff-read-fixture-v1',
    readySelector: 'main[data-ontology-review-ready="true"]',
    prepare: expect.any(Function),
  });
  expect(DEFAULT_EXCLUDED_SURFACES).toEqual([
    expect.objectContaining({ id: 'assistive-technology-manual-evaluation' }),
  ]);
});
