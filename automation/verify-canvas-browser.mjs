import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const DEFAULT_PATH = '/ko/moderator/canvas/';
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const EXPECTED_READ_PATHS = ['/rest/v1/session', '/rest/v1/agenda', '/rest/v1/agenda_link'];
const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const VERIFIER_PATH = fileURLToPath(import.meta.url);
const AUDITED_SOURCE_PATHS = [
  'automation/package.json',
  'automation/package-lock.json',
  'automation/verify-canvas-browser.mjs',
  'astro.config.mjs',
  'package.json',
  'src/islands/CanvasBoard.tsx',
  'src/islands/canvas',
  'src/pages/[lang]/moderator/canvas.astro',
  'src/pages/[lang]/moderator/insights/groups.astro',
  'src/pages/[lang]/moderator/insights/heatmap.astro',
  'src/styles/global.css',
];

function requireHttpUrl(value, label) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error(`${label} must use HTTP or HTTPS`);
  }
  return url;
}

/** Binds CLI evidence to a committed, clean verifier and Canvas source tree. */
export function readCanvasSourceProvenance() {
  const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: REPOSITORY_ROOT,
    encoding: 'utf8',
  }).trim();
  const dirty = execFileSync(
    'git',
    ['status', '--porcelain', '--untracked-files=all', '--', ...AUDITED_SOURCE_PATHS],
    { cwd: REPOSITORY_ROOT, encoding: 'utf8' },
  ).trim();
  if (dirty) throw new Error('Canvas verification source tree is dirty');
  return {
    sourceCommit,
    sourceTreeClean: true,
    verifierSha256: createHash('sha256').update(readFileSync(VERIFIER_PATH)).digest('hex'),
  };
}

/** Verifies the development CanvasBoard without authenticating or mutating data. */
export async function verifyCanvasBrowser({
  baseUrl,
  path = DEFAULT_PATH,
  outputJson,
  screenshot,
  timeoutMs = 30_000,
  sourceProvenance = null,
}) {
  const origin = requireHttpUrl(baseUrl, 'baseUrl');
  const pageUrl = new URL(path, origin);
  const viteUrl = new URL('/@vite/client', origin);
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const writeRequests = [];
  const readResponses = [];
  const browserErrors = [];

  await page.route('**/*', async (route) => {
    const request = route.request();
    if (!WRITE_METHODS.has(request.method())) {
      await route.continue();
      return;
    }
    writeRequests.push({ method: request.method(), url: request.url() });
    await route.abort('blockedbyclient');
  });
  page.on('response', (response) => {
    const request = response.request();
    if (request.method() === 'GET' && response.url().includes('/rest/v1/')) {
      readResponses.push({ status: response.status(), url: new URL(response.url()).pathname });
    }
  });
  page.on('pageerror', (error) => browserErrors.push(error.message));

  try {
    const viteResponse = await context.request.get(viteUrl.toString(), { timeout: timeoutMs });
    if (!viteResponse.ok()) {
      throw new Error(`Vite client returned HTTP ${viteResponse.status()}`);
    }

    const documentResponse = await page.goto(pageUrl.toString(), {
      timeout: timeoutMs,
      waitUntil: 'domcontentloaded',
    });
    if (!documentResponse?.ok()) {
      throw new Error(`Canvas document returned HTTP ${documentResponse?.status() ?? 'unknown'}`);
    }

    await page.getByText('실시간 연결됨', { exact: true }).waitFor({ timeout: timeoutMs });
    await page.getByRole('heading', { name: '진행자 로그인' }).waitFor({ timeout: timeoutMs });
    const nodes = page.locator('.react-flow__node-agenda');
    await nodes.first().waitFor({ timeout: timeoutMs });

    const nodeCount = await nodes.count();
    const firstNodeClasses = (await nodes.first().getAttribute('class')) ?? '';
    const draggable = firstNodeClasses.split(/\s+/).includes('draggable');
    await page.waitForTimeout(500);
    const readPathStatuses = new Map(readResponses.map(({ status, url }) => [url, status]));
    const missingReads = EXPECTED_READ_PATHS.filter((readPath) => {
      const status = readPathStatuses.get(readPath);
      return status === undefined || status < 200 || status >= 300;
    });
    if (draggable) throw new Error('Unauthenticated agenda node is draggable');
    if (writeRequests.length > 0) throw new Error('Canvas verification attempted a blocked write request');
    if (browserErrors.length > 0) throw new Error('Canvas verification observed a browser page error');
    if (missingReads.length > 0) throw new Error('Canvas verification did not complete all expected reads');

    if (screenshot) {
      mkdirSync(dirname(screenshot), { recursive: true });
      await page.screenshot({ path: screenshot, fullPage: true });
    }

    const report = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      baseUrl: origin.origin,
      path: pageUrl.pathname,
      readOnly: true,
      sourceProvenance,
      runtime: {
        node: process.version,
        chromium: browser.version(),
      },
      checks: {
        viteClientStatus: viteResponse.status(),
        documentStatus: documentResponse.status(),
        realtimeReady: readPathStatuses.has('/rest/v1/agenda'),
        moderatorLoginBoundary: await page.getByRole('heading', { name: '진행자 로그인' }).isVisible(),
        canvasHydrated: nodeCount > 0,
        agendaNodeCount: nodeCount,
        unauthenticatedNodeDraggable: draggable,
        blockedWriteRequestCount: writeRequests.length,
        browserPageErrorCount: browserErrors.length,
        supabaseReadResponses: readResponses,
      },
      screenshot: screenshot
        ? relative(REPOSITORY_ROOT, resolve(screenshot)).replaceAll('\\', '/')
        : null,
      status: 'pass',
    };

    if (outputJson) {
      mkdirSync(dirname(outputJson), { recursive: true });
      writeFileSync(outputJson, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
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

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const baseUrl = optionValue('--base-url');
  if (!baseUrl) throw new Error('--base-url is required');
  const report = await verifyCanvasBrowser({
    baseUrl,
    path: optionValue('--path') ?? DEFAULT_PATH,
    outputJson: optionValue('--output-json'),
    screenshot: optionValue('--screenshot'),
    sourceProvenance: readCanvasSourceProvenance(),
  });
  console.log(JSON.stringify(report));
}
