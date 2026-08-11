import { createServer } from 'node:http';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { verifyCanvasBrowser } from '../verify-canvas-browser.mjs';

const servers = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
});

async function fixtureServer({ draggable = false, write = false } = {}) {
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
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(`<!doctype html><html><body>
      <p>실시간 연결됨</p><h2>진행자 로그인</h2>
      <div class="react-flow__node-agenda${draggable ? ' draggable' : ''}">의제</div>
      <script>
        fetch('/rest/v1/session');fetch('/rest/v1/agenda');fetch('/rest/v1/agenda_link');
        ${write ? "fetch('/write',{method:'POST'}).catch(() => {})" : ''}
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
  });
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
    expect(workflow).toContain("'src/lib/supabase.ts'");
    expect(workflow).toContain("'src/pages/**/moderator/canvas.astro'");
    expect(workflow).toContain('curl --fail --silent --max-time 2');
    expect(workflow).toContain('node automation/verify-canvas-browser.mjs');
    expect(workflow.indexOf('npm ci')).toBeLessThan(workflow.indexOf('node automation/verify-canvas-browser.mjs'));
    const verifier = readFileSync(new URL('../verify-canvas-browser.mjs', import.meta.url), 'utf8');
    expect(verifier).toContain("'package-lock.json'");
    expect(verifier.indexOf('const moderatorLoginBoundary = await')).toBeLessThan(
      verifier.indexOf("if (writeRequests.length > 0)"),
    );
  });
});
