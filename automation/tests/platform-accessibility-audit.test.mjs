import { afterAll, beforeAll, expect, test } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import {
  DEFAULT_AUDIT_ROUTES,
  DEFAULT_EXCLUDED_SURFACES,
  AUDITED_SOURCE_PATHS,
  accessibilityAuditExitCode,
  auditPlatformAccessibility,
  fixtureNetworkPasses,
  installFixtureWebSocketIsolation,
  readAuditSourceStatus,
  validateAuditSourceState,
  verifyDeploymentRevision,
} from '../platform-accessibility-audit.mjs';

const BROWSER_TEST_TIMEOUT_MS = 60_000;

const safeFixtureNetwork = {
  escapedNetworkRequestCount: 0,
  escapedNetworkOrigins: [],
  blockedExternalRequestCount: 0,
  blockedExternalOrigins: [],
  unexpectedSupabaseRequestCount: 0,
  contractViolationCount: 0,
  mutationRequestCount: 0,
  liveDatabaseMutationCount: 0,
  webSocket: {
    stubbed: true,
    actualNetworkConnectionCount: 0,
    blockedExternalConnectionAttemptCount: 0,
    blockedExternalOrigins: [],
  },
};

test('fails fixture isolation on blocked attempts or an observed escaped response', () => {
  expect(fixtureNetworkPasses(safeFixtureNetwork)).toBe(true);
  expect(fixtureNetworkPasses({
    ...safeFixtureNetwork,
    blockedExternalRequestCount: 1,
    blockedExternalOrigins: ['http://127.0.0.1:65534'],
  })).toBe(false);
  expect(fixtureNetworkPasses({
    ...safeFixtureNetwork,
    escapedNetworkRequestCount: 1,
    escapedNetworkOrigins: ['https://example.invalid'],
  })).toBe(false);
  expect(fixtureNetworkPasses({
    ...safeFixtureNetwork,
    webSocket: {
      ...safeFixtureNetwork.webSocket,
      blockedExternalConnectionAttemptCount: 1,
      blockedExternalOrigins: ['ws://127.0.0.1:65534'],
    },
  })).toBe(false);
});

test('uses one deny-by-default HTTP route after exact local and Supabase checks', () => {
  const source = readFileSync(new URL('../platform-accessibility-audit.mjs', import.meta.url), 'utf8');
  expect(source).toContain("page.route('**/*'");
  expect(source).not.toContain("page.route('https://**/*'");
  expect(source).toContain('requestUrl.origin === baseOrigin');
  expect(source).toContain('requestUrl.origin === SUPABASE_ORIGIN');
  expect(source).toContain('fixtureNetwork.blockedExternalRequestCount === 0');
  expect(source).toContain("serviceWorkers: 'block'");
  expect(source).toContain('context.routeWebSocket(/.*/');
  expect(source).toContain('fixtureNetwork.webSocket?.blockedExternalConnectionAttemptCount === 0');
  expect(source).not.toContain('connectToServer()');
});

test('intercepts a real Worker WebSocket before any loopback upgrade reaches the server', async () => {
  let nativeUpgradeCount = 0;
  const socketServer = createServer((_request, response) => {
    response.writeHead(426).end();
  });
  socketServer.on('upgrade', (_request, socket) => {
    nativeUpgradeCount += 1;
    socket.destroy();
  });
  await new Promise((resolve) => socketServer.listen(0, '127.0.0.1', resolve));
  const address = socketServer.address();
  if (!address || typeof address === 'string') throw new Error('Loopback WebSocket server did not bind');
  const socketOrigin = `ws://127.0.0.1:${address.port}`;
  const fixtureState = {
    webSocketRoutingInstalled: false,
    webSocketRouteAttemptCount: 0,
    syntheticWebSocketAttemptCount: 0,
    blockedExternalWebSocketAttemptCount: 0,
    blockedExternalWebSocketOrigins: [],
  };
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ serviceWorkers: 'block' });
    try {
      await installFixtureWebSocketIsolation({ context, fixtureState });
      const page = await context.newPage();
      await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
      await page.evaluate(async (socketUrls) => {
        const source = `self.onmessage = (event) => {
          const socket = new WebSocket(event.data);
          let finished = false;
          const finish = () => {
            if (finished) return;
            finished = true;
            self.postMessage('intercepted');
          };
          socket.addEventListener('close', finish, { once: true });
          socket.addEventListener('error', finish, { once: true });
        };`;
        const worker = new Worker(URL.createObjectURL(new Blob([source], { type: 'text/javascript' })));
        for (const socketUrl of socketUrls) {
          await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('Worker WebSocket interception timed out')), 5_000);
            worker.addEventListener('message', () => {
              clearTimeout(timeout);
              resolve();
            }, { once: true });
            worker.postMessage(socketUrl);
          });
        }
        worker.terminate();
      }, [
        `${socketOrigin}/native-upgrade-must-not-run`,
        'wss://pleyuknjnprsckssxvrh.supabase.co/realtime/v1/websocket',
      ]);
      await page.waitForTimeout(50);
    } finally {
      await context.close();
    }
  } finally {
    await browser.close();
    await new Promise((resolve, reject) => socketServer.close((error) => error ? reject(error) : resolve()));
  }

  expect(nativeUpgradeCount).toBe(0);
  expect(fixtureState).toMatchObject({
    webSocketRoutingInstalled: true,
    webSocketRouteAttemptCount: 0,
    workerWebSocketAttemptCount: 2,
    syntheticWebSocketAttemptCount: 1,
    blockedExternalWebSocketAttemptCount: 1,
    blockedExternalWebSocketOrigins: [socketOrigin],
  });
}, BROWSER_TEST_TIMEOUT_MS);

let outDir;
let server;
let baseUrl;
const TEST_SOURCE_COMMIT = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

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
const exercisedPage = `<!doctype html><html lang="ko"><head><title>상태 전환</title></head><body>
  <a href="#main-content" style="display:inline-flex;align-items:center;min-height:24px">본문 바로가기</a><main id="main-content" tabindex="-1">
  <button type="button" style="min-width:44px;min-height:44px" onclick="document.querySelector('p').hidden=false">오류 표시</button>
  <p role="alert" hidden>입력 오류</p></main></body></html>`;
const focusOrderPage = `<!doctype html><html lang="ko"><head><title>키보드 순서</title><style>
  :focus-visible { outline: 2px solid #00637a; outline-offset: 3px; }
  </style></head><body>
  <a href="#main-content" style="display:inline-flex;align-items:center;min-height:24px">본문 바로가기</a><main id="main-content" tabindex="-1">
  <form aria-label="로그인" style="display:grid;gap:8px"><label for="email">이메일</label><input id="email" type="email" style="min-height:44px">
  <label for="password">비밀번호</label><input id="password" type="password" style="min-height:44px">
  <button type="submit" style="min-height:44px">로그인</button><a id="help" href="/help" style="display:inline-flex;align-items:center;min-height:44px">도움말</a></form></main></body></html>`;
const trappedFocusOrderPage = focusOrderPage.replace('</body>', `<script>
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Tab') return;
    if (!event.shiftKey && document.activeElement?.id === 'help') {
      event.preventDefault(); document.querySelector('#email').focus();
    } else if (event.shiftKey && document.activeElement?.id === 'email') {
      event.preventDefault(); document.querySelector('#help').focus();
    }
  });
  </script></body>`);
const hiddenFocusAppearancePage = focusOrderPage.replace(
  '</head>',
  '<style>:focus-visible { outline: none !important; }</style></head>',
);
const lowContrastFocusAppearancePage = focusOrderPage.replace(
  '</head>',
  '<style>:focus-visible { outline: 2px solid #c0c0c0 !important; }</style></head>',
);

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
            : request.url === '/exercised'
              ? exercisedPage
            : request.url === '/focus-order'
              ? focusOrderPage
            : request.url === '/trapped-focus-order'
              ? trappedFocusOrderPage
            : request.url === '/hidden-focus-appearance'
              ? hiddenFocusAppearancePage
            : request.url === '/low-contrast-focus-appearance'
              ? lowContrastFocusAppearancePage
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
    targetRevision: { status: 'verified', sourceCommit: TEST_SOURCE_COMMIT },
    routes: [{ id: 'valid', path: '/valid', skipTarget: 'main-content' }],
    reportPath,
    generatedAt: new Date('2026-08-11T00:00:00.000Z'),
  });

  expect(report.status).toBe('pass');
  expect(report.schemaVersion).toBe(5);
  expect(report.sourceCommit).toBe(TEST_SOURCE_COMMIT);
  expect(report.sourceTreeClean).toBe(true);
  expect(report.evidenceClassification).toBe('release-evidence');
  expect(report.releaseEvidence).toBe(true);
  expect(report.targetRevision).toEqual({
    status: 'verified',
    sourceCommit: TEST_SOURCE_COMMIT,
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

test('labels an explicitly requested dirty-tree browser run as draft rather than release evidence', async () => {
  const report = await auditPlatformAccessibility({
    baseUrl,
    sourceCommit: TEST_SOURCE_COMMIT,
    sourceTreeClean: false,
    draftSourceMeasurement: true,
    routes: [{ id: 'draft-valid', path: '/valid', skipTarget: 'main-content' }],
    profiles: [{ id: 'desktop', viewport: { width: 1280, height: 800 } }],
    reportPath: join(outDir, 'draft-report.json'),
  });

  expect(report.status).toBe('needs_review');
  expect(report.sourceTreeClean).toBe(false);
  expect(report.evidenceClassification).toBe('draft-uncommitted-source-measurement');
  expect(report.releaseEvidence).toBe(false);
  expect(report.summary.passedCases).toBe(1);
}, BROWSER_TEST_TIMEOUT_MS);

test('keeps dirty source out of release evidence and requires truthful draft classification', async () => {
  const baseArguments = {
    baseUrl,
    sourceCommit: TEST_SOURCE_COMMIT,
    routes: [{ id: 'source-state', path: '/valid', skipTarget: 'main-content' }],
    reportPath: join(outDir, 'source-state.json'),
  };
  await expect(auditPlatformAccessibility({
    ...baseArguments,
    sourceTreeClean: false,
  })).rejects.toThrow('requires a clean audited source tree');
  await expect(auditPlatformAccessibility({
    ...baseArguments,
    sourceTreeClean: true,
    draftSourceMeasurement: true,
  })).rejects.toThrow('must record sourceTreeClean as false');
});

test('records exact forward and reverse keyboard focus order in browser evidence', async () => {
  const expectedOrder = ['#email', '#password', 'button[type="submit"]', '#help'];
  const report = await auditPlatformAccessibility({
    baseUrl,
    sourceCommit: TEST_SOURCE_COMMIT,
    sourceTreeClean: true,
    routes: [{
      id: 'focus-order',
      path: '/focus-order',
      skipTarget: 'main-content',
      requiredKeyboardFocusOrder: expectedOrder,
    }],
    reportPath: join(outDir, 'focus-order.json'),
  });

  expect(report.status, JSON.stringify(report.routes, null, 2)).toBe('pass');
  expect(report.routes[0].keyboardFocusOrder).toMatchObject({
    required: true,
    expected: expectedOrder,
    passed: true,
    escapedForward: true,
    escapedBackward: true,
    forwardExit: { reachedBoundary: true },
    backwardExit: { reachedBoundary: true },
    focusAppearance: {
      required: true,
      minimumOutlineWidthPx: 2,
      minimumContrastRatio: 3,
      passed: true,
    },
  });
  expect(report.routes[0].keyboardFocusOrder.forward).toEqual(
    expectedOrder.map((expectedSelector) => expect.objectContaining({ expectedSelector, matched: true })),
  );
  expect(report.routes[0].keyboardFocusOrder.reverse).toEqual(
    [...expectedOrder].reverse().map((expectedSelector) => expect.objectContaining({ expectedSelector, matched: true })),
  );
  expect(report.routes[0].keyboardFocusOrder.focusAppearance.indicators).toEqual(
    expectedOrder.map((expectedSelector) => expect.objectContaining({
      expectedSelector,
      outlineStyle: 'solid',
      outlineWidthPx: 2,
      outlineOffsetPx: 3,
      outlineColor: 'rgb(0, 99, 122)',
      adjacentBackgroundColor: 'rgb(255, 255, 255)',
      passed: true,
    })),
  );
}, BROWSER_TEST_TIMEOUT_MS);

test('fails a route when keyboard focus has no visible indicator', async () => {
  const report = await auditPlatformAccessibility({
    baseUrl,
    sourceCommit: TEST_SOURCE_COMMIT,
    sourceTreeClean: true,
    routes: [{
      id: 'hidden-focus-appearance',
      path: '/hidden-focus-appearance',
      skipTarget: 'main-content',
      requiredKeyboardFocusOrder: ['#email', '#password', 'button[type="submit"]', '#help'],
    }],
    reportPath: join(outDir, 'hidden-focus-appearance.json'),
  });

  expect(report.status).toBe('fail');
  expect(report.routes[0]).toMatchObject({
    passed: false,
    keyboardFocusOrder: {
      passed: true,
      focusAppearance: { required: true, passed: false },
    },
  });
  expect(report.routes[0].keyboardFocusOrder.focusAppearance.indicators)
    .toEqual(expect.arrayContaining([expect.objectContaining({
      outlineStyle: 'none',
      passed: false,
    })]));
}, BROWSER_TEST_TIMEOUT_MS);

test('fails a visible keyboard focus outline with insufficient adjacent contrast', async () => {
  const report = await auditPlatformAccessibility({
    baseUrl,
    sourceCommit: TEST_SOURCE_COMMIT,
    sourceTreeClean: true,
    routes: [{
      id: 'low-contrast-focus-appearance',
      path: '/low-contrast-focus-appearance',
      skipTarget: 'main-content',
      requiredKeyboardFocusOrder: ['#email', '#password', 'button[type="submit"]', '#help'],
    }],
    reportPath: join(outDir, 'low-contrast-focus-appearance.json'),
  });

  expect(report.status).toBe('fail');
  expect(report.routes[0].keyboardFocusOrder).toMatchObject({
    passed: true,
    focusAppearance: { required: true, minimumContrastRatio: 3, passed: false },
  });
  expect(report.routes[0].keyboardFocusOrder.focusAppearance.indicators)
    .toEqual(expect.arrayContaining([expect.objectContaining({
      outlineStyle: 'solid',
      outlineWidthPx: 2,
      outlineColor: 'rgb(192, 192, 192)',
      adjacentBackgroundColor: 'rgb(255, 255, 255)',
      contrastRatio: 1.82,
      passed: false,
    })]));
}, BROWSER_TEST_TIMEOUT_MS);

test('fails a route when its required keyboard focus order does not match the page', async () => {
  const report = await auditPlatformAccessibility({
    baseUrl,
    sourceCommit: TEST_SOURCE_COMMIT,
    sourceTreeClean: true,
    routes: [{
      id: 'wrong-focus-order',
      path: '/focus-order',
      skipTarget: 'main-content',
      requiredKeyboardFocusOrder: ['#email', 'button[type="submit"]', '#password', '#help'],
    }],
    reportPath: join(outDir, 'wrong-focus-order.json'),
  });

  expect(report.status).toBe('fail');
  expect(report.routes[0]).toMatchObject({
    passed: false,
    keyboardFocusOrder: { required: true, passed: false },
  });
  expect(report.routes[0].keyboardFocusOrder.forward).toEqual(expect.arrayContaining([
    expect.objectContaining({ expectedSelector: 'button[type="submit"]', matched: false }),
  ]));
}, BROWSER_TEST_TIMEOUT_MS);

test('fails a focus cycle that never escapes the required controls', async () => {
  const report = await auditPlatformAccessibility({
    baseUrl,
    sourceCommit: TEST_SOURCE_COMMIT,
    sourceTreeClean: true,
    routes: [{
      id: 'trapped-focus-order',
      path: '/trapped-focus-order',
      skipTarget: 'main-content',
      requiredKeyboardFocusOrder: ['#email', '#password', 'button[type="submit"]', '#help'],
    }],
    reportPath: join(outDir, 'trapped-focus-order.json'),
  });

  expect(report.status).toBe('fail');
  expect(report.routes[0].keyboardFocusOrder).toMatchObject({
    passed: false,
    escapedForward: false,
    escapedBackward: false,
    forwardExit: { reachedBoundary: false },
    backwardExit: { reachedBoundary: false },
  });
}, BROWSER_TEST_TIMEOUT_MS);

test('rejects malformed keyboard focus contracts before launching the audit', async () => {
  const audit = (requiredKeyboardFocusOrder) => auditPlatformAccessibility({
    baseUrl,
    sourceCommit: TEST_SOURCE_COMMIT,
    sourceTreeClean: true,
    routes: [{
      id: 'malformed-focus-order',
      path: '/focus-order',
      skipTarget: 'main-content',
      requiredKeyboardFocusOrder,
    }],
    reportPath: join(outDir, 'malformed-focus-order.json'),
  });

  await expect(audit(['#email'])).rejects.toThrow('unique keyboard focus order');
  await expect(audit(['#email', '#email'])).rejects.toThrow('unique keyboard focus order');
  await expect(audit(['#email', ''])).rejects.toThrow('unique keyboard focus order');
  await expect(audit('not-an-array')).rejects.toThrow('unique keyboard focus order');
});

test('verifies the exact same-origin deployment revision manifest', async () => {
  const manifestUrl = `${baseUrl}/deployment-revision.json`;
  const result = await verifyDeploymentRevision({
    baseUrl,
    expectedSourceCommit: TEST_SOURCE_COMMIT,
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      url: manifestUrl,
      headers: new Headers({ 'content-type': 'application/json; charset=utf-8' }),
      text: async () => JSON.stringify({ schemaVersion: 1, sourceCommit: TEST_SOURCE_COMMIT }),
    }),
  });

  expect(result).toEqual({ status: 'verified', sourceCommit: TEST_SOURCE_COMMIT });
});

test('rejects deployment revision mismatch, schema drift, redirects, and non-JSON responses', async () => {
  const manifestUrl = `${baseUrl}/deployment-revision.json`;
  const verify = (response) => verifyDeploymentRevision({
    baseUrl,
    expectedSourceCommit: TEST_SOURCE_COMMIT,
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      url: manifestUrl,
      headers: new Headers({ 'content-type': 'application/json' }),
      ...response,
    }),
  });

  await expect(verify({
    text: async () => JSON.stringify({ schemaVersion: 1, sourceCommit: 'b'.repeat(40) }),
  })).rejects.toThrow('does not match');
  await expect(verify({
    text: async () => JSON.stringify({ schemaVersion: 1, sourceCommit: TEST_SOURCE_COMMIT, note: 'drift' }),
  })).rejects.toThrow('manifest is invalid');
  await expect(verify({
    url: `${baseUrl}/redirected.json`,
    text: async () => JSON.stringify({ schemaVersion: 1, sourceCommit: TEST_SOURCE_COMMIT }),
  })).rejects.toThrow('response is invalid');
  await expect(verify({
    headers: new Headers({ 'content-type': 'text/html' }),
    text: async () => '<html></html>',
  })).rejects.toThrow('response is invalid');
});

test('rejects forged verified and unverified target revision states before browser audit', async () => {
  const audit = (targetRevision) => auditPlatformAccessibility({
    baseUrl,
    sourceCommit: TEST_SOURCE_COMMIT,
    sourceTreeClean: true,
    targetRevision,
    routes: [{ id: 'valid', path: '/valid', skipTarget: 'main-content' }],
    reportPath: join(outDir, 'forged-target-revision.json'),
  });

  await expect(audit({ status: 'verified', sourceCommit: 'b'.repeat(40) }))
    .rejects.toThrow('does not match');
  await expect(audit({ status: 'not_verified', sourceCommit: null, reason: 'attacker-controlled' }))
    .rejects.toThrow('state is invalid');
});

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

test('fails closed when a route that requires fixture evidence returns no controller', async () => {
  const report = await auditPlatformAccessibility({
    baseUrl,
    sourceCommit: TEST_SOURCE_COMMIT,
    sourceTreeClean: true,
    routes: [{
      id: 'missing-required-evidence',
      path: '/valid',
      skipTarget: 'main-content',
      fixture: 'required-network-fixture',
      requiresFixtureEvidence: true,
      prepare: async () => null,
    }],
    profiles: [{ id: 'desktop', viewport: { width: 1280, height: 800 } }],
    reportPath: join(outDir, 'missing-required-evidence.json'),
  });

  expect(report.status).toBe('fail');
  expect(report.routes[0]).toMatchObject({
    fixtureNetworkRequired: true,
    fixtureNetwork: null,
    passed: false,
  });
  await expect(auditPlatformAccessibility({
    baseUrl,
    sourceCommit: TEST_SOURCE_COMMIT,
    sourceTreeClean: true,
    routes: [{
      id: 'missing-required-controller',
      path: '/valid',
      skipTarget: 'main-content',
      fixture: 'required-network-fixture',
      requiresFixtureEvidence: true,
    }],
    reportPath: join(outDir, 'missing-required-controller.json'),
  })).rejects.toThrow('requires a fixture controller with network evidence');
}, BROWSER_TEST_TIMEOUT_MS);

test('audits the exercised interaction state instead of only the initial page', async () => {
  const report = await auditPlatformAccessibility({
    baseUrl,
    sourceCommit: TEST_SOURCE_COMMIT,
    sourceTreeClean: true,
    routes: [{
      id: 'exercised',
      path: '/exercised',
      skipTarget: 'main-content',
      fixture: 'interaction-fixture',
      readySelector: 'p[role="alert"]:not([hidden])',
      afterNavigation: async ({ page }) => {
        await page.getByRole('button', { name: '오류 표시' }).click();
      },
    }],
    reportPath: join(outDir, 'exercised.json'),
  });

  expect(report.routes[0].violations, JSON.stringify(report.routes[0], null, 2)).toEqual([]);
  expect(report.status).toBe('pass');
  expect(report.routes[0]).toMatchObject({
    routeId: 'exercised',
    fixture: 'interaction-fixture',
    readiness: { selector: 'p[role="alert"]:not([hidden])', reached: true },
    passed: true,
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

test('installs root and audit dependencies from their tracked lockfiles', () => {
  const workflow = readFileSync(
    new URL('../../.github/workflows/platform-accessibility.yml', import.meta.url),
    'utf8',
  );

  expect(workflow).toContain('cache-dependency-path: |\n            package-lock.json\n            automation/package-lock.json');
  expect(workflow).toContain('name: Install site dependencies\n        run: npm ci');
  expect(workflow).toContain('working-directory: automation\n        run: npm ci');
  expect(workflow).not.toContain('npm install --no-package-lock');
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
      'public/v',
      'src/islands/OntologyReviewConsole.tsx',
      'src/islands/ballot',
      'src/islands/canvas',
      'src/islands/mod',
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
    'platform-login-error',
    'authenticated-platform',
    'accessibility-statement',
    'public-result-unpublished',
    'published-result',
    'ontology-review',
    'public-vote-open',
    'public-vote-submitted',
    'public-vote-duplicate',
    'public-vote-closed',
    'public-vote-error',
    'public-ballot-open',
    'public-ballot-submitted',
    'public-ballot-duplicate',
    'public-ballot-closed',
    'public-ballot-published',
    'public-ballot-error',
    'moderator-console',
    'moderator-console-timer',
    'hq-console-gate',
    'hq-console-submissions',
    'hq-console-dashboard',
  ]);
  expect(DEFAULT_AUDIT_ROUTES.find((route) => route.id === 'platform-login')).toMatchObject({
    path: '/platform/',
    fixture: 'ci-login-keyboard-fixture-v1',
    afterNavigation: expect.any(Function),
    requiredKeyboardFocusOrder: [
      '#platform-email',
      '#platform-password',
      'button[type="submit"]',
      'a[href="/platform/accessibility/"]',
    ],
  });
  expect(DEFAULT_AUDIT_ROUTES.find((route) => route.id === 'platform-login-error')).toMatchObject({
    path: '/platform/',
    fixture: 'ci-login-rejection-fixture-v1',
    readySelector: '#platform-login-error[role="alert"]',
    prepare: expect.any(Function),
    afterNavigation: expect.any(Function),
  });
  expect(DEFAULT_AUDIT_ROUTES.find((route) => route.id === 'authenticated-platform')).toMatchObject({
    path: '/platform/',
    fixture: 'ci-staff-read-fixture-v1',
    readySelector: 'aside button[aria-current="location"]',
  });
  expect(DEFAULT_AUDIT_ROUTES.find((route) => route.id === 'published-result')).toMatchObject({
    path: '/r/_/',
    fixture: 'ci-published-result-read-fixture-v1',
    readySelector: 'main#main-content [data-source-reference-ready="true"]',
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
  expect(DEFAULT_AUDIT_ROUTES.find((route) => route.id === 'moderator-console')).toMatchObject({
    path: '/mod?code=000000',
    skipTarget: 'mod-console-content',
    fixture: 'ci-0912-synthetic-read-fixture-v1',
    requiresFixtureEvidence: true,
    readySelector: '#mod-console-content [data-testid="workshop-status-rail"]',
    requiredMobileScrollRegions: ['조 작업 상태 가로 목록'],
    prepare: expect.any(Function),
  });
  expect(DEFAULT_AUDIT_ROUTES.find((route) => route.id === 'hq-console-gate')).toMatchObject({
    path: '/hq',
    skipTarget: 'hq-console-content',
    fixture: 'ci-hq-gate-no-secret-v1',
    requiresFixtureEvidence: true,
    readySelector: '#hq-gate-title',
    prepare: expect.any(Function),
  });
  expect(DEFAULT_AUDIT_ROUTES.find((route) => route.id === 'hq-console-dashboard')).toMatchObject({
    path: '/hq?ops=1',
    skipTarget: 'hq-console-content',
    fixture: 'ci-0912-hq-dashboard-read-fixture-v1',
    requiresFixtureEvidence: true,
    readySelector: '#hq-console-content h1',
    prepare: expect.any(Function),
    afterNavigation: expect.any(Function),
  });
  expect(DEFAULT_AUDIT_ROUTES.find((route) => route.id === 'hq-console-submissions')).toMatchObject({
    readySelector: '[aria-label="접근성 감사 합성 조 접속 기기"]',
    afterNavigation: expect.any(Function),
  });
  for (const id of [
    'public-vote-open',
    'public-vote-submitted',
    'public-vote-duplicate',
    'public-vote-closed',
    'public-vote-error',
  ]) {
    expect(DEFAULT_AUDIT_ROUTES.find((route) => route.id === id)).toMatchObject({
      path: expect.stringMatching(/^\/v\?r=/),
      skipTarget: 'public-vote-content',
      requiresFixtureEvidence: true,
      prepare: expect.any(Function),
      afterNavigation: expect.any(Function),
    });
  }
  for (const id of [
    'public-ballot-open',
    'public-ballot-submitted',
    'public-ballot-duplicate',
    'public-ballot-closed',
    'public-ballot-published',
    'public-ballot-error',
  ]) {
    expect(DEFAULT_AUDIT_ROUTES.find((route) => route.id === id)).toMatchObject({
      path: expect.stringMatching(/^\/b\?t=/),
      skipTarget: 'public-ballot-content',
      requiresFixtureEvidence: true,
      prepare: expect.any(Function),
      afterNavigation: expect.any(Function),
    });
  }
  expect(DEFAULT_EXCLUDED_SURFACES).toEqual([
    expect.objectContaining({ id: 'assistive-technology-manual-evaluation' }),
  ]);
});
