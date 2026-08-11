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
    const currentSurface = request.url?.startsWith('/ko/moderator/live')
      ? 'live'
      : request.url?.startsWith('/ko/moderator/ontology-review') ? 'review' : 'canvas';
    const reviewFixture = currentSurface === 'review' ? `
        <label>검수 계획 JSON<input type="file"></label>
        <label>Canvas snapshot JSON<input type="file"></label>
        <label>검수자 역할 ID<input type="text"></label>
        <button type="button" id="start-review">로컬 검수 시작</button>
        <p id="review-progress" hidden>진행 0/5</p>
        <section id="review-items" hidden>
          <article aria-label="노드 검수 1">
            <label>온톨로지 역할<select><option>Issue</option><option>Proposal</option></select></label>
            <label>표시 이름<input type="text"></label>
            <button type="button" data-decision data-action="accept">원문 승인</button>
            <button type="button" data-decision data-action="reject">반려</button>
          </article>
          <article aria-label="노드 검수 2">
            <label>온톨로지 역할<select><option>Issue</option><option>Proposal</option></select></label>
            <label>표시 이름<input type="text"></label>
            <button type="button" data-decision data-action="accept">원문 승인</button>
            <button type="button" data-decision data-action="reject">반려</button>
          </article>
          <article aria-label="관계 검수 1">
            <label>관계 유형<select><option>supports</option><option>implements</option></select></label>
            <button type="button" data-decision data-action="accept">승인</button>
            <button type="button" data-decision data-action="reject">반려</button>
          </article>
          <article aria-label="관계 검수 2">
            <label>관계 유형<select><option>supports</option><option>implements</option></select></label>
            <button type="button" data-decision data-action="accept">승인</button>
            <button type="button" data-decision data-action="reject">반려</button>
          </article>
          <article aria-label="군집 검수 1">
            <button type="button" data-decision data-action="accept">승인</button>
            <button type="button" data-decision data-action="reject">반려</button>
          </article>
          <button type="button" id="download-plan" disabled>검수 완료 plan 다운로드</button>
        </section>
        <script>
          const progress = document.querySelector('#review-progress');
          const reviewItems = document.querySelector('#review-items');
          const downloadButton = document.querySelector('#download-plan');
          let decisionCount = 0;
          let activePlan = null;
          document.querySelector('#start-review').addEventListener('click', async () => {
            const planFile = document.querySelector('input[type="file"]').files[0];
            activePlan = JSON.parse(await planFile.text());
            document.querySelectorAll('article[aria-label^="노드 검수"] input').forEach((input, index) => {
              input.value = activePlan.nodes[index].label;
            });
            document.querySelectorAll('[data-decision]').forEach((button) => { button.disabled = false; });
            decisionCount = 0;
            progress.textContent = '진행 0/5';
            downloadButton.disabled = true;
            progress.hidden = false;
            reviewItems.hidden = false;
          });
          document.querySelectorAll('[data-decision]').forEach((button) => {
            button.addEventListener('click', () => {
              if (button.disabled) return;
              const article = button.closest('article');
              const articles = [...document.querySelectorAll('#review-items article')];
              const index = articles.indexOf(article);
              article.querySelectorAll('[data-decision]').forEach((candidate) => { candidate.disabled = true; });
              const reviewer = document.querySelector('input[type="text"]').value;
              const reviewedAt = new Date().toISOString();
              const rejected = button.dataset.action === 'reject';
              if (index < 2) {
                const label = article.querySelector('input').value;
                activePlan.nodes[index].kind = rejected ? null : (index === 0 ? 'Issue' : 'Proposal');
                activePlan.nodes[index].label = rejected ? activePlan.nodes[index].sourceText : label;
                activePlan.nodes[index].text = activePlan.nodes[index].sourceText;
                activePlan.nodes[index].reviewStatus = rejected
                  ? 'rejected'
                  : (label === activePlan.nodes[index].sourceText ? 'accepted' : 'edited');
                activePlan.nodes[index].reviewer = reviewer;
                activePlan.nodes[index].reviewedAt = reviewedAt;
              } else if (index < 4) {
                activePlan.relations[index - 2].relation = rejected
                  ? null
                  : (index === 2 ? 'supports' : 'implements');
                activePlan.relations[index - 2].reviewStatus = rejected ? 'rejected' : 'accepted';
                activePlan.relations[index - 2].reviewer = reviewer;
                activePlan.relations[index - 2].reviewedAt = reviewedAt;
              } else {
                activePlan.clusters[0].issueNodeId = rejected ? null : activePlan.nodes[0].id;
                activePlan.clusters[0].reviewStatus = rejected ? 'rejected' : 'accepted';
                activePlan.clusters[0].reviewer = reviewer;
                activePlan.clusters[0].reviewedAt = reviewedAt;
              }
              decisionCount += 1;
              progress.textContent = \`진행 \${decisionCount}/5\`;
              downloadButton.disabled = decisionCount !== 5;
            });
          });
          downloadButton.addEventListener('click', () => {
            const href = URL.createObjectURL(new Blob([JSON.stringify(activePlan)], { type: 'application/json' }));
            const anchor = document.createElement('a');
            anchor.href = href;
            anchor.download = 'reviewed-plan.json';
            anchor.click();
            URL.revokeObjectURL(href);
          });
        </script>` : '';
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(`<!doctype html><html><body style="margin:0"${currentSurface === 'live' ? ' data-moderator-live-ready="true"' : ''}>
      <nav aria-label="숙의 모더레이션 플랫폼">
        <a href="/ko/moderator/live/" ${currentSurface === 'live' ? 'aria-current="page"' : ''}>라이브 입력</a>
        <a href="/ko/moderator/canvas/" ${currentSurface === 'canvas' ? 'aria-current="page"' : ''}>캔버스 작업대</a>
        <a href="/ko/moderator/ontology-review/" ${currentSurface === 'review' ? 'aria-current="page"' : ''}>온톨로지 검수 큐</a>
        <a href="/workshop-graph/">온톨로지 그래프</a>
        <a href="/workshop-graph/guide/">그래프 사용설명서</a>
        <p>시민 발언과 논증 관계를 보존해 숙의·모더레이션을 지원합니다. <strong>회의의 결정을 대신하지 않습니다.</strong></p>
      </nav>
      <main id="canvas-workbench" style="width:1440px;height:800px">
        <h1>Canvas 온톨로지 검수 큐</h1>
        ${reviewFixture}
        <p>DB에 저장하지 않습니다. 공개 그래프에 반영하지 않습니다.</p>
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
    expect(report.checks.platformNavigationLinkCount).toBe(5);
    expect(report.checks.nonDecisionCopyVisible).toBe(true);
    expect(report.checks.livePlatformNavigationConnected).toBe(true);
    expect(report.checks.reviewDocumentStatus).toBe(200);
    expect(report.checks.reviewPlatformNavigationConnected).toBe(true);
    expect(report.checks.reviewLocalOnlyBoundaryVisible).toBe(true);
    expect(report.checks.reviewInteractionCompleted).toBe(true);
    expect(report.checks.reviewMixedDecisionStatesVerified).toBe(true);
    expect(report.checks.reviewReloadIsolationVerified).toBe(true);
    expect(report.checks.reviewedPlanDownloaded).toBe(true);
    expect(report.checks.reviewedPlanDecisionCount).toBe(5);
    expect(report.checks.linkedSurfaceStatuses).toEqual([
      { path: '/workshop-graph/', assetPath: '/workshop-graph/index.html', status: 200 },
      { path: '/workshop-graph/guide/', assetPath: '/workshop-graph/guide/index.html', status: 200 },
    ]);
    expect(report.sourceProvenance).toEqual(sourceProvenance);
    expect(report.runtime.node).toMatch(/^v\d+\./);
    expect(report.checks.supabaseReadResponses).toHaveLength(3);
  }, 30_000);

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
    expect(workflow).toContain('src/islands/OntologyReviewConsole.test.ts');
    expect(workflow).toContain('src/islands/canvas/ontology-review-workspace.test.ts');
    expect(workflow).toContain("'src/lib/supabase.ts'");
    expect(workflow).toContain("'src/components/ModeratorPlatformNav.tsx'");
    expect(workflow).toContain("'src/components/ModeratorPlatformNav.test.ts'");
    expect(workflow).toContain("'src/pages/**/moderator/canvas.astro'");
    expect(workflow).toContain("'src/pages/**/moderator/live.astro'");
    expect(workflow).toContain("'src/pages/**/moderator/ontology-review.astro'");
    expect(workflow).toContain('curl --fail --silent --max-time 2');
    expect(workflow).toContain('node automation/verify-canvas-browser.mjs');
    expect(workflow.indexOf('npm ci')).toBeLessThan(workflow.indexOf('node automation/verify-canvas-browser.mjs'));
    const verifier = readFileSync(new URL('../verify-canvas-browser.mjs', import.meta.url), 'utf8');
    expect(verifier).toContain("'package-lock.json'");
    expect(verifier).toContain("'src/components/ModeratorPlatformNav.tsx'");
    expect(verifier).toContain("'src/components/ModeratorPlatformNav.test.ts'");
    expect(verifier).toContain("'src/pages/[lang]/moderator/live.astro'");
    expect(verifier).toContain("'src/pages/[lang]/moderator/ontology-review.astro'");
    expect(verifier.indexOf('const moderatorLoginBoundary = await')).toBeLessThan(
      verifier.indexOf("if (writeRequests.length > 0)"),
    );
  });
});
