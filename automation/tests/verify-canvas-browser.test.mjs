import { createServer } from 'node:http';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { verifyCanvasBrowser } from '../verify-canvas-browser.mjs';

const servers = [];
const transcriptFixtureSha256 = createHash('sha256')
  .update(readFileSync(new URL('../fixtures/transcript-ontology-review-candidates.example.json', import.meta.url)), 'utf8')
  .digest('hex');

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
});

async function fixtureServer({
  draggable = false,
  write = false,
  liveDelayedWrite = false,
  liveDelayedError = false,
  reviewReady = true,
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
        <section aria-labelledby="private-transcript-capture-heading">
          <h2 id="private-transcript-capture-heading">R4 로컬 음성·전사 검수</h2>
          <p>녹음은 브라우저 세션 메모리에만 두며 DB·서버·public 경로로 전송하지 않습니다.</p>
          <label><input id="private-consent" type="checkbox">마이크 사용과 로컬 메모리 처리에 동의합니다.</label>
          <label>회차 ID<input id="private-session" type="text"></label>
          <button id="private-start" type="button" disabled>녹음 시작</button>
          <button id="private-stop" type="button" disabled>녹음 정지</button>
          <p id="private-status" role="status" aria-live="polite">동의 후 합성 음성으로 브라우저 녹음 proof of concept를 시작하세요.</p>
          <section id="private-capture" hidden>
            <strong>로컬 녹음 1000ms · 16 bytes</strong>
            <span>audio SHA-256 ${'b'.repeat(64)}</span>
            <label>검수자 역할 ID<input id="private-reviewer" type="text"></label>
            <label>시작 ms<input id="private-start-ms" type="number" value="0"></label>
            <label>종료 ms<input id="private-end-ms" type="number" value="1000"></label>
            <label>화자 가명<input id="private-speaker" type="text" value="speaker-a"></label>
            <label>수동 전사 원문<textarea id="private-source-text"></textarea></label>
            <button id="private-add" type="button">전사 chunk 추가</button>
            <section id="private-chunks" aria-label="전사 chunk 검수 목록"></section>
            <section aria-label="전사 검수 extraction handoff">
              <strong id="private-progress">검수 진행 0/0</strong>
              <button id="private-download" type="button" disabled>검수 완료 전사 batch 다운로드</button>
            </section>
          </section>
        </section>
        <section aria-labelledby="canvas-review-heading">
        <h2 id="canvas-review-heading">Canvas 검수 계획</h2>
        <label>검수 계획 JSON<input type="file"></label>
        <label>Canvas snapshot JSON<input type="file"></label>
        <label>검수자 역할 ID<input type="text"></label>
        <button type="button" id="start-review">로컬 검수 시작</button>
        <p id="review-progress" hidden>진행 0/5</p>
        <section id="review-items" hidden>
          <section aria-labelledby="facilitation-prompt-heading">
            <h2 id="facilitation-prompt-heading">진행 질문</h2>
            <p id="facilitation-prompt-count" role="status" aria-live="polite">현재 규칙으로 확인된 진행 질문 0개</p>
            <ol id="facilitation-prompt-list"></ol>
          </section>
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
        </section>
        <section aria-labelledby="transcript-review-heading">
          <h2 id="transcript-review-heading">합성 전사 후보 검수</h2>
          <p>실제 시민 발언 파일은 이 prototype에 넣지 마세요.</p>
          <label>전사 ontology fixture JSON<input id="transcript-fixture" type="file"></label>
          <label>검수자 역할 ID<input id="transcript-reviewer" type="text"></label>
          <button type="button" id="start-transcript-review" disabled>전사 후보 로컬 검수 시작</button>
          <p id="transcript-progress" hidden>진행 0/3</p>
          <section id="transcript-items" hidden>
            <article aria-label="전사 노드 후보 검수 transcript-node:candidate-issue">
              <p>재생에너지 전환 속도를 높여야 합니다.</p>
              <label>Habermas 발화 역할<select><option>Issue</option></select></label>
              <label>표시 이름<input id="transcript-first-label" type="text"></label>
              <button type="button" data-transcript-decision="first">수정 승인</button>
            </article>
            <article aria-label="전사 노드 후보 검수 transcript-node:candidate-claim">
              <p>재생에너지 전환 속도를 높여야 합니다.</p>
              <label>Habermas 발화 역할<select><option>Claim</option></select></label>
              <label>표시 이름<input id="transcript-second-label" type="text"></label>
              <button type="button" data-transcript-decision="second">반려</button>
            </article>
            <article aria-label="전사 관계 후보 검수 transcript-edge:candidate-relation-1">
              <p>재생에너지 전환 속도를 높여야 합니다.</p>
              <label>논증 관계<select><option>isAbout</option></select></label>
              <button type="button" data-transcript-decision="relation">반려</button>
            </article>
            <button type="button" id="download-transcript-plan" disabled>전사 후보 검수 plan 다운로드</button>
          </section>
        </section>
        <script>
          ${reviewReady ? `setTimeout(() => {
            document.querySelector('#canvas-workbench')?.setAttribute('data-ontology-review-ready', 'true');
          }, 100);` : ''}
          const progress = document.querySelector('#review-progress');
          const reviewItems = document.querySelector('#review-items');
          const downloadButton = document.querySelector('#download-plan');
          const promptCount = document.querySelector('#facilitation-prompt-count');
          const promptList = document.querySelector('#facilitation-prompt-list');
          let decisionCount = 0;
          let activePlan = null;
          let transcriptFixture = null;
          const transcriptFixtureInput = document.querySelector('#transcript-fixture');
          const transcriptReviewerInput = document.querySelector('#transcript-reviewer');
          const transcriptStartButton = document.querySelector('#start-transcript-review');
          const transcriptProgress = document.querySelector('#transcript-progress');
          const transcriptItems = document.querySelector('#transcript-items');
          const transcriptDownloadButton = document.querySelector('#download-transcript-plan');
          const transcriptDecisions = new Set();
          const privateConsent = document.querySelector('#private-consent');
          const privateSession = document.querySelector('#private-session');
          const privateStart = document.querySelector('#private-start');
          const privateStop = document.querySelector('#private-stop');
          const privateCapture = document.querySelector('#private-capture');
          const privateStatus = document.querySelector('#private-status');
          const privateProgress = document.querySelector('#private-progress');
          const privateDownload = document.querySelector('#private-download');
          const refreshPrivateStart = () => {
            privateStart.disabled = !privateConsent.checked || !privateSession.value.trim();
          };
          privateConsent.addEventListener('change', refreshPrivateStart);
          privateSession.addEventListener('input', refreshPrivateStart);
          privateStart.addEventListener('click', () => {
            privateStart.disabled = true;
            privateStop.disabled = false;
            privateSession.disabled = true;
            privateStatus.textContent = '녹음 중입니다. 음성은 서버로 전송되지 않습니다.';
          });
          privateStop.addEventListener('click', () => {
            privateStop.disabled = true;
            privateSession.disabled = false;
            privateCapture.hidden = false;
            privateStatus.textContent = '녹음은 이 브라우저 세션 메모리에만 있습니다. 전사 chunk를 작성하고 전부 검수하세요.';
          });
          document.querySelector('#private-add').addEventListener('click', () => {
            const sourceText = document.querySelector('#private-source-text').value;
            const article = document.createElement('article');
            article.setAttribute('aria-label', '전사 chunk 검수 capture-browser:chunk:1');
            article.innerHTML = '<label>검수 전사<textarea></textarea></label><button type="button">원문 승인</button><button type="button">반려</button>';
            article.querySelector('textarea').value = sourceText;
            const accept = article.querySelector('button');
            article.querySelector('textarea').addEventListener('input', () => {
              accept.textContent = '수정 승인';
              if (!privateDownload.disabled) {
                privateProgress.textContent = '검수 진행 0/1';
                privateDownload.disabled = true;
              }
            });
            accept.addEventListener('click', () => {
              privateProgress.textContent = '검수 진행 1/1';
              privateDownload.disabled = false;
            });
            document.querySelector('#private-chunks').replaceChildren(article);
            privateProgress.textContent = '검수 진행 0/1';
          });
          privateDownload.addEventListener('click', () => {
            const sourceText = document.querySelector('#private-source-text').value;
            const reviewedText = document.querySelector('#private-chunks textarea').value;
            const batch = {
              schemaVersion: 1,
              kind: 'private-transcript-review-batch',
              source: {
                captureId: 'capture-browser', sessionId: privateSession.value,
                audioSha256: '${'b'.repeat(64)}', byteLength: 16, storage: 'browser-memory',
              },
              chunks: [{
                uid: 'capture-browser:chunk:1', sourceText, text: reviewedText,
                reviewStatus: reviewedText === sourceText ? 'accepted' : 'edited',
                reviewer: document.querySelector('#private-reviewer').value,
              }],
              safety: {
                localOnly: true, audioIncluded: false, databaseMutationExecuted: false,
                publicGraphWritten: false, extractionExecuted: false, requiresExtractionReview: true,
              },
            };
            const href = URL.createObjectURL(new Blob([JSON.stringify(batch)], { type: 'application/json' }));
            const anchor = document.createElement('a');
            anchor.href = href;
            anchor.download = 'capture-browser-reviewed-transcript.json';
            anchor.click();
            URL.revokeObjectURL(href);
          });
          const refreshTranscriptStart = () => {
            transcriptStartButton.disabled = !transcriptFixtureInput.files[0]
              || transcriptReviewerInput.value.trim().length < 3;
          };
          transcriptFixtureInput.addEventListener('change', refreshTranscriptStart);
          transcriptReviewerInput.addEventListener('input', refreshTranscriptStart);
          transcriptStartButton.addEventListener('click', async () => {
            transcriptFixture = JSON.parse(await transcriptFixtureInput.files[0].text());
            document.querySelector('#transcript-first-label').value = transcriptFixture.expected.nodes[0].label;
            document.querySelector('#transcript-second-label').value = transcriptFixture.expected.nodes[1].label;
            transcriptDecisions.clear();
            transcriptProgress.textContent = '진행 0/3';
            transcriptProgress.hidden = false;
            transcriptItems.hidden = false;
            transcriptDownloadButton.disabled = true;
          });
          document.querySelectorAll('[data-transcript-decision]').forEach((button) => {
            button.addEventListener('click', () => {
              transcriptDecisions.add(button.dataset.transcriptDecision);
              transcriptProgress.textContent = \`진행 \${transcriptDecisions.size}/3\`;
              transcriptDownloadButton.disabled = transcriptDecisions.size !== 3;
            });
          });
          document.querySelector('#transcript-first-label').addEventListener('input', () => {
            if (!transcriptDecisions.delete('first')) return;
            transcriptProgress.textContent = \`진행 \${transcriptDecisions.size}/3\`;
            transcriptDownloadButton.disabled = true;
          });
          transcriptDownloadButton.addEventListener('click', () => {
            const reviewer = transcriptReviewerInput.value;
            const reviewedAt = '2026-08-29T02:00:00.000Z';
            const first = transcriptFixture.expected.nodes[0];
            const second = transcriptFixture.expected.nodes[1];
            const relation = transcriptFixture.expected.relations[0];
            const plan = {
              schemaVersion: 1,
              kind: 'transcript-ontology-reviewed-plan',
              dryRun: true,
              databaseMutationExecuted: false,
              publicGraphWritten: false,
              requiresPublicationReview: true,
              source: {
                fixtureId: transcriptFixture.fixtureId,
                sessionId: transcriptFixture.sessionId,
                language: transcriptFixture.language,
                reviewedBy: transcriptFixture.reviewedBy,
                reviewedAt: transcriptFixture.reviewedAt,
                fixtureSha256: '${transcriptFixtureSha256}',
              },
              nodes: [
                {
                  id: \`transcript-node:\${first.uid}\`, sourceUid: first.uid,
                  kindCandidate: first.kind, kind: first.kind,
                  sourceLabel: first.label, sourceText: first.text,
                  label: document.querySelector('#transcript-first-label').value,
                  text: first.text, citedUids: first.citedUids,
                  transcript: transcriptFixture.chunks.filter((chunk) => first.citedUids.includes(chunk.uid)),
                  reviewStatus: 'edited', reviewer, reviewedAt,
                },
                {
                  id: \`transcript-node:\${second.uid}\`, sourceUid: second.uid,
                  kindCandidate: second.kind, kind: null,
                  sourceLabel: second.label, sourceText: second.text,
                  label: second.label, text: second.text, citedUids: second.citedUids,
                  transcript: transcriptFixture.chunks.filter((chunk) => second.citedUids.includes(chunk.uid)),
                  reviewStatus: 'rejected', reviewer, reviewedAt,
                },
              ],
              relations: [{
                id: \`transcript-edge:\${relation.uid}\`, sourceUid: relation.uid,
                source: \`transcript-node:\${relation.sourceUid}\`,
                target: \`transcript-node:\${relation.targetUid}\`,
                relationCandidate: relation.relation, relation: null,
                citedUids: relation.citedUids,
                transcript: transcriptFixture.chunks.filter((chunk) => relation.citedUids.includes(chunk.uid)),
                reviewStatus: 'rejected', reviewer, reviewedAt,
              }],
            };
            const href = URL.createObjectURL(new Blob([JSON.stringify(plan)], { type: 'application/json' }));
            const anchor = document.createElement('a');
            anchor.href = href;
            anchor.download = 'transcript-reviewed-plan.json';
            anchor.click();
            URL.revokeObjectURL(href);
          });
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
            promptCount.textContent = '현재 규칙으로 확인된 진행 질문 0개';
            promptList.replaceChildren();
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
              const reviewer = document.querySelector('[aria-labelledby="canvas-review-heading"] input[type="text"]').value;
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
              if (decisionCount === 5 && activePlan.nodes[1].reviewStatus === 'accepted') {
                const item = document.createElement('li');
                const question = document.createElement('strong');
                question.textContent = \`“\${activePlan.nodes[1].label}”을 실행하려면 어떤 조건이 먼저 충족되어야 하나요?\`;
                const provenance = document.createElement('div');
                provenance.textContent = \`출처 세션 \${activePlan.nodes[1].sourceSessionId} · 원 agenda \${activePlan.nodes[1].sourceAgendaId} · 노드 \${activePlan.nodes[1].id}\`;
                const source = document.createElement('div');
                source.textContent = \`원문: \${activePlan.nodes[1].sourceText}\`;
                item.append(question, provenance, source);
                promptList.replaceChildren(item);
                promptCount.textContent = '현재 규칙으로 확인된 진행 질문 1개';
              }
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
    expect(report.checks.transcriptReviewLocalOnlyBoundaryVisible).toBe(true);
    expect(report.checks.transcriptCandidateEvidenceVisible).toBe(true);
    expect(report.checks.transcriptRedecisionGateVerified).toBe(true);
    expect(report.checks.transcriptReviewDownloaded).toBe(true);
    expect(report.checks.privateMediaRecorderAvailable).toBe(true);
    expect(report.checks.privateRecordingMemoryBoundaryVisible).toBe(true);
    expect(report.checks.privateSessionLockedWhileRecording).toBe(true);
    expect(report.checks.privateTranscriptReviewGateVerified).toBe(true);
    expect(report.checks.privateTranscriptRedecisionGateVerified).toBe(true);
    expect(report.checks.privateTranscriptBatchDownloaded).toBe(true);
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
  }, 60_000);

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

  it('fails when review hydration readiness never arrives', async () => {
    const fixture = await fixtureServer({ reviewReady: false });

    await expect(verifyCanvasBrowser({ baseUrl: fixture.baseUrl, timeoutMs: 2_000 }))
      .rejects.toThrow(/Timeout/i);
  }, 10_000);
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
    expect(workflow).toContain('src/islands/canvas/transcript-ontology-review-workspace.test.ts');
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
