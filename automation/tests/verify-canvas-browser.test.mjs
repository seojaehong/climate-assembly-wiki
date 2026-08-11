import { createServer } from 'node:http';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { verifyCanvasBrowser } from '../verify-canvas-browser.mjs';

const servers = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
});

async function fixtureServer({
  draggable = false,
  write = false,
  liveDelayedWrite = false,
  liveDelayedError = false,
} = {}) {
  let receivedWriteCount = 0;
  const server = createServer((request, response) => {
    if (request.url === '/@vite/client') {
      response.writeHead(200, { 'content-type': 'application/javascript' });
      response.end('export {};');
      return;
    }
    if (request.url?.startsWith('/rest/v1/')) {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end('[]');
      return;
    }
    if (request.url === '/write') {
      receivedWriteCount += 1;
      response.writeHead(204);
      response.end();
      return;
    }
    const currentSurface = request.url?.startsWith('/ko/moderator/live') ? 'live' : 'canvas';
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(`<!doctype html><html><body style="margin:0"${currentSurface === 'live' ? ' data-moderator-live-ready="true"' : ''}>
      <nav aria-label="숙의 모더레이션 플랫폼">
        <a href="/ko/moderator/live/" ${currentSurface === 'live' ? 'aria-current="page"' : ''}>라이브 입력</a>
        <a href="/ko/moderator/canvas/" ${currentSurface === 'canvas' ? 'aria-current="page"' : ''}>캔버스 작업대</a>
        <a href="/workshop-graph/">온톨로지 그래프</a>
        <a href="/workshop-graph/guide/">그래프 사용설명서</a>
        <p>시민 발언과 논증 관계를 보존해 숙의·모더레이션을 지원합니다. <strong>회의의 결정을 대신하지 않습니다.</strong></p>
      </nav>
      <main id="canvas-workbench" style="width:1440px;height:800px">
        <p>실시간 연결됨</p><h2>진행자 로그인</h2>
        <div class="react-flow__node-agenda${draggable ? ' draggable' : ''}">의제</div>
      </main>
      <script>
        fetch('/rest/v1/session');fetch('/rest/v1/agenda');fetch('/rest/v1/agenda_link');
        ${write ? "fetch('/write',{method:'POST'}).catch(() => {})" : ''}
        ${currentSurface === 'live' && liveDelayedWrite ? "setTimeout(() => fetch('/write',{method:'POST'}).catch(() => {}), 100)" : ''}
        ${currentSurface === 'live' && liveDelayedError ? "setTimeout(() => { throw new Error('delayed live failure'); }, 100)" : ''}
      </script>
    </body></html>`);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  servers.push(server);
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Fixture server did not bind to TCP');
  return { baseUrl: `http://127.0.0.1:${address.port}`, receivedWriteCount: () => receivedWriteCount };
}

describe('verifyCanvasBrowser', () => {
  it('records a read-only hydrated canvas contract', async () => {
    const fixture = await fixtureServer();
    const sourceProvenance = {
      sourceCommit: 'a'.repeat(40),
      sourceTreeClean: true,
      verifierSha256: 'b'.repeat(64),
    };
    const report = await verifyCanvasBrowser({ baseUrl: fixture.baseUrl, sourceProvenance });

    expect(report.status).toBe('pass');
    expect(report.checks.viteClientStatus).toBe(200);
    expect(report.checks.agendaNodeCount).toBe(1);
    expect(report.checks.blockedWriteRequestCount).toBe(0);
    expect(report.checks.canvasHydrated).toBe(true);
    expect(report.checks.canvasWorkbenchUsable).toBe(true);
    expect(report.checks.canvasWorkbenchSize).toEqual({ width: 1440, height: 800 });
    expect(report.checks.platformNavigationConnected).toBe(true);
    expect(report.checks.platformNavigationLinkCount).toBe(4);
    expect(report.checks.nonDecisionCopyVisible).toBe(true);
    expect(report.checks.livePlatformNavigationConnected).toBe(true);
    expect(report.checks.linkedSurfaceStatuses).toEqual([
      { path: '/workshop-graph/', assetPath: '/workshop-graph/index.html', status: 200 },
      { path: '/workshop-graph/guide/', assetPath: '/workshop-graph/guide/index.html', status: 200 },
    ]);
    expect(report.sourceProvenance).toEqual(sourceProvenance);
    expect(report.runtime.node).toMatch(/^v\d+\./);
    expect(report.checks.supabaseReadResponses).toHaveLength(3);
  });

  it('fails when the unauthenticated canvas can drag or write', async () => {
    const draggableFixture = await fixtureServer({ draggable: true });
    await expect(verifyCanvasBrowser({ baseUrl: draggableFixture.baseUrl }))
      .rejects.toThrow('Unauthenticated agenda node is draggable');
    const writeFixture = await fixtureServer({ write: true });
    await expect(verifyCanvasBrowser({ baseUrl: writeFixture.baseUrl }))
      .rejects.toThrow('Canvas verification attempted a blocked write request');
    expect(writeFixture.receivedWriteCount()).toBe(0);
    const delayedLiveWriteFixture = await fixtureServer({ liveDelayedWrite: true });
    await expect(verifyCanvasBrowser({ baseUrl: delayedLiveWriteFixture.baseUrl }))
      .rejects.toThrow('Moderator platform verification attempted a blocked write request');
    expect(delayedLiveWriteFixture.receivedWriteCount()).toBe(0);
    const delayedLiveErrorFixture = await fixtureServer({ liveDelayedError: true });
    await expect(verifyCanvasBrowser({ baseUrl: delayedLiveErrorFixture.baseUrl }))
      .rejects.toThrow('Moderator platform verification observed a browser page error');
  }, 15_000);
});

describe('Canvas browser CI contract', () => {
  it('installs the reproducible root runtime before the cold browser gate', () => {
    const workflow = readFileSync(new URL('../../.github/workflows/test.yml', import.meta.url), 'utf8');
    const gitignore = readFileSync(new URL('../../.gitignore', import.meta.url), 'utf8');

    expect(gitignore.split(/\r?\n/)).not.toContain('package-lock.json');
    expect(workflow).toContain("'package-lock.json'");
    expect(workflow).toContain("- '.gitignore'");
    expect(workflow).toContain('working-directory: .');
    expect(workflow).toContain('npm ci');
    expect(workflow).toContain('npm exec vitest -- run src/components/ModeratorPlatformNav.test.ts src/islands/CanvasBoard.test.ts');
    expect(workflow).toContain("'src/lib/supabase.ts'");
    expect(workflow).toContain("'src/components/ModeratorPlatformNav.tsx'");
    expect(workflow).toContain("'src/components/ModeratorPlatformNav.test.ts'");
    expect(workflow).toContain("'src/pages/**/moderator/canvas.astro'");
    expect(workflow).toContain("'src/pages/**/moderator/live.astro'");
    expect(workflow).toContain('curl --fail --silent --max-time 2');
    expect(workflow).toContain('node automation/verify-canvas-browser.mjs');
    expect(workflow.indexOf('npm ci')).toBeLessThan(workflow.indexOf('node automation/verify-canvas-browser.mjs'));
    const verifier = readFileSync(new URL('../verify-canvas-browser.mjs', import.meta.url), 'utf8');
    expect(verifier).toContain("'package-lock.json'");
    expect(verifier).toContain("'src/components/ModeratorPlatformNav.tsx'");
    expect(verifier).toContain("'src/components/ModeratorPlatformNav.test.ts'");
    expect(verifier).toContain("'src/pages/[lang]/moderator/live.astro'");
    expect(verifier.indexOf('const moderatorLoginBoundary = await')).toBeLessThan(
      verifier.indexOf("if (writeRequests.length > 0)"),
    );
  });
});
