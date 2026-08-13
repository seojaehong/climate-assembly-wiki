import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import {
  buildCanvasOntologyReviewPlan,
  sealCanvasOntologyReviewPlan,
} from './canvas-ontology-bridge.mjs';

const DEFAULT_PATH = '/ko/moderator/canvas/';
const DEFAULT_LIVE_PATH = '/ko/moderator/live/';
const DEFAULT_REVIEW_PATH = '/ko/moderator/ontology-review/';
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const EXPECTED_READ_PATHS = ['/rest/v1/session', '/rest/v1/agenda', '/rest/v1/agenda_link'];
const EXPECTED_PLATFORM_PATHS = [
  '/ko/moderator/live/',
  '/ko/moderator/canvas/',
  '/ko/moderator/ontology-review/',
  '/workshop-graph/',
  '/workshop-graph/guide/',
];
const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const VERIFIER_PATH = fileURLToPath(import.meta.url);
const AUDITED_SOURCE_PATHS = [
  '.github/workflows/test.yml',
  '.gitignore',
  'automation/package.json',
  'automation/package-lock.json',
  'automation/tests/verify-canvas-browser.test.mjs',
  'automation/verify-canvas-browser.mjs',
  'automation/canvas-ontology-bridge.mjs',
  'automation/ontology-review-queue.mjs',
  'astro.config.mjs',
  'package.json',
  'package-lock.json',
  'src/components/ModeratorPlatformNav.tsx',
  'src/components/ModeratorPlatformNav.test.ts',
  'src/islands/CanvasBoard.tsx',
  'src/islands/OntologyReviewConsole.tsx',
  'src/islands/OntologyReviewConsole.test.ts',
  'src/islands/canvas',
  'src/lib/supabase.ts',
  'src/pages/[lang]/moderator/canvas.astro',
  'src/pages/[lang]/moderator/live.astro',
  'src/pages/[lang]/moderator/ontology-review.astro',
  'src/pages/[lang]/moderator/insights/groups.astro',
  'src/pages/[lang]/moderator/insights/heatmap.astro',
  'src/styles/global.css',
];

const REVIEW_SNAPSHOT = {
  id: 42,
  source: 'browser-verifier-fixture',
  taken_at: '2026-08-29T00:00:00.000Z',
  payload: {
    agenda: [
      {
        id: 'agenda-1', session_id: 'session-1', text: '지역 에너지 자립을 논의한다.',
        jo: 'A조', zone: '감축', status: 'active', kind: 'agenda', group_id: 'group-1',
        parent_id: null, x: 10, y: 20,
      },
      {
        id: 'action-1', session_id: 'session-1', text: '공공건물 태양광을 확대한다.',
        jo: 'A조', zone: '감축', status: 'active', kind: 'action', group_id: 'group-1',
        parent_id: 'agenda-1', x: 30, y: 40,
      },
    ],
    agenda_link: [
      { id: 'link-1', session_id: 'session-1', source_id: 'agenda-1', target_id: 'action-1' },
    ],
  },
};

const REVIEW_RELOAD_SNAPSHOT = {
  ...structuredClone(REVIEW_SNAPSHOT),
  id: 43,
};
REVIEW_RELOAD_SNAPSHOT.payload.agenda[0].text = '지역 에너지 자립의 실행 조건을 다시 논의한다.';
REVIEW_RELOAD_SNAPSHOT.payload.agenda[1].text = '공공건물 태양광 확대 순서를 다시 검토한다.';

const TRANSCRIPT_REVIEW_FIXTURE_TEXT = readFileSync(resolve(
  REPOSITORY_ROOT,
  'automation/fixtures/transcript-ontology-review-candidates.example.json',
), 'utf8');
const TRANSCRIPT_REVIEW_FIXTURE_SHA256 = createHash('sha256')
  .update(TRANSCRIPT_REVIEW_FIXTURE_TEXT, 'utf8')
  .digest('hex');

function reviewUploadPayloads(snapshot = REVIEW_SNAPSHOT) {
  const snapshotText = JSON.stringify(snapshot);
  const plan = sealCanvasOntologyReviewPlan({
    plan: buildCanvasOntologyReviewPlan(snapshot),
    snapshotSource: snapshotText,
  });
  return {
    plan: { name: 'canvas-review-plan.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(plan)) },
    snapshot: { name: 'canvas-snapshot.json', mimeType: 'application/json', buffer: Buffer.from(snapshotText) },
  };
}

function transcriptReviewUploadPayload() {
  return {
    name: 'transcript-ontology-review-candidates.example.json',
    mimeType: 'application/json',
    buffer: Buffer.from(TRANSCRIPT_REVIEW_FIXTURE_TEXT),
  };
}

async function downloadText(download) {
  const stream = await download.createReadStream();
  if (!stream) throw new Error('Ontology reviewed plan download stream is unavailable');
  const chunks = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

async function waitForReviewProgress(page, progressText, timeoutMs) {
  const progress = page.getByText(progressText, { exact: true });
  const alert = page.getByRole('alert');
  await progress.or(alert).first().waitFor({ timeout: timeoutMs });
  if (await alert.isVisible()) {
    throw new Error(`Ontology review load failed: ${await alert.innerText()}`);
  }
}

function requireHttpUrl(value, label) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error(`${label} must use HTTP or HTTPS`);
  }
  return url;
}

async function platformNavigationEvidence(page, expectedPath, timeoutMs) {
  const navigation = page.getByRole('navigation', { name: '숙의 모더레이션 플랫폼' });
  await navigation.waitFor({ timeout: timeoutMs });
  const paths = await navigation.locator('a').evaluateAll((links) => links.map((link) => {
    const href = link.getAttribute('href');
    return href ? new URL(href, window.location.href).pathname : null;
  }));
  const connected = EXPECTED_PLATFORM_PATHS.every((path) => paths.includes(path));
  const currentPath = await navigation.locator('[aria-current="page"]').evaluate((link) => (
    new URL(link.getAttribute('href') ?? '', window.location.href).pathname
  ));
  const nonDecisionCopyVisible = await navigation
    .getByText('회의의 결정을 대신하지 않습니다.', { exact: true })
    .isVisible();
  return {
    connected,
    currentPath,
    expectedPath,
    linkCount: paths.length,
    nonDecisionCopyVisible,
  };
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
  livePath = DEFAULT_LIVE_PATH,
  reviewPath = DEFAULT_REVIEW_PATH,
  outputJson,
  screenshot,
  timeoutMs = 60_000,
  sourceProvenance = null,
}) {
  const origin = requireHttpUrl(baseUrl, 'baseUrl');
  const pageUrl = new URL(path, origin);
  const liveUrl = new URL(livePath, origin);
  const reviewUrl = new URL(reviewPath, origin);
  const viteUrl = new URL('/@vite/client', origin);
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addInitScript(() => {
    class MemoryMediaRecorder extends EventTarget {
      state = 'inactive';
      mimeType = 'audio/webm;codecs=opus';

      constructor() {
        super();
        if (window.__failPrivateRecorderConstruction) {
          window.__failPrivateRecorderConstruction = false;
          throw new Error('synthetic recorder construction failure');
        }
      }

      start() {
        this.state = 'recording';
      }

      stop() {
        this.state = 'inactive';
        const dataEvent = new Event('dataavailable');
        Object.defineProperty(dataEvent, 'data', {
          value: new Blob(['synthetic-browser-audio'], { type: this.mimeType }),
        });
        this.dispatchEvent(dataEvent);
        this.dispatchEvent(new Event('stop'));
      }
    }
    Object.defineProperty(window, 'MediaRecorder', { configurable: true, value: MemoryMediaRecorder });
    window.__privateGetUserMediaCount = 0;
    window.__privateMediaTrackStopCount = 0;
    window.__failPrivateRecorderConstruction = false;
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: async () => {
          window.__privateGetUserMediaCount += 1;
          return {
            getTracks: () => [{
              stop: () => { window.__privateMediaTrackStopCount += 1; },
            }],
          };
        },
      },
    });
  });
  const page = await context.newPage();
  const writeRequests = [];
  const readResponses = [];
  const browserErrors = [];

  await context.route('**/*', async (route) => {
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
    const canvasNavigation = await platformNavigationEvidence(page, pageUrl.pathname, timeoutMs);
    const canvasWorkbenchSize = await page.locator('#canvas-workbench').evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      return { width: Math.round(bounds.width), height: Math.round(bounds.height) };
    });
    const canvasWorkbenchUsable = canvasWorkbenchSize.width >= 1_000
      && canvasWorkbenchSize.height >= 600;
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
    if (screenshot) {
      mkdirSync(dirname(screenshot), { recursive: true });
      await page.screenshot({ path: screenshot, fullPage: true });
    }
    const moderatorLoginBoundary = await page
      .getByRole('heading', { name: '진행자 로그인' })
      .isVisible();

    if (draggable) throw new Error('Unauthenticated agenda node is draggable');
    if (!moderatorLoginBoundary) throw new Error('Moderator login boundary is not visible');
    if (!canvasNavigation.connected || canvasNavigation.currentPath !== pageUrl.pathname) {
      throw new Error('Canvas platform navigation is incomplete or has the wrong current page');
    }
    if (!canvasNavigation.nonDecisionCopyVisible) throw new Error('Canvas non-decision explanation is not visible');
    if (!canvasWorkbenchUsable) throw new Error('Canvas workbench is too small for the operator surface');
    if (writeRequests.length > 0) throw new Error('Canvas verification attempted a blocked write request');
    if (browserErrors.length > 0) throw new Error('Canvas verification observed a browser page error');
    if (missingReads.length > 0) throw new Error('Canvas verification did not complete all expected reads');

    const livePage = await context.newPage();
    livePage.on('pageerror', (error) => browserErrors.push(error.message));
    const liveDocumentResponse = await livePage.goto(liveUrl.toString(), {
      timeout: timeoutMs,
      waitUntil: 'domcontentloaded',
    });
    if (!liveDocumentResponse?.ok()) {
      throw new Error(`Moderator live document returned HTTP ${liveDocumentResponse?.status() ?? 'unknown'}`);
    }
    const liveNavigation = await platformNavigationEvidence(livePage, liveUrl.pathname, timeoutMs);
    await livePage.locator('body[data-moderator-live-ready="true"]').waitFor({ timeout: timeoutMs });
    await livePage.waitForTimeout(500);
    if (!liveNavigation.connected || liveNavigation.currentPath !== liveUrl.pathname) {
      throw new Error('Moderator live platform navigation is incomplete or has the wrong current page');
    }
    if (!liveNavigation.nonDecisionCopyVisible) {
      throw new Error('Moderator live non-decision explanation is not visible');
    }
    if (writeRequests.length > 0) throw new Error('Moderator platform verification attempted a blocked write request');
    if (browserErrors.length > 0) throw new Error('Moderator platform verification observed a browser page error');
    await livePage.close();

    const reviewPage = await context.newPage();
    reviewPage.on('pageerror', (error) => browserErrors.push(error.message));
    const reviewDocumentResponse = await reviewPage.goto(reviewUrl.toString(), {
      timeout: timeoutMs,
      waitUntil: 'domcontentloaded',
    });
    if (!reviewDocumentResponse?.ok()) {
      throw new Error(`Ontology review document returned HTTP ${reviewDocumentResponse?.status() ?? 'unknown'}`);
    }
    const reviewNavigation = await platformNavigationEvidence(reviewPage, reviewUrl.pathname, timeoutMs);
    await reviewPage.getByRole('heading', { name: 'Canvas 온톨로지 검수 큐' }).waitFor({ timeout: timeoutMs });
    await reviewPage.locator('main[data-ontology-review-ready="true"]').waitFor({ timeout: timeoutMs });
    await reviewPage.getByLabel('검수 계획 JSON').waitFor({ timeout: timeoutMs });
    await reviewPage.getByLabel('Canvas snapshot JSON').waitFor({ timeout: timeoutMs });
    const reviewLocalOnlyBoundaryVisible = await reviewPage
      .getByText('DB에 저장하지 않습니다.', { exact: false })
      .isVisible();
    const privateCapturePanel = reviewPage.getByRole('region', { name: 'R4 로컬 음성·전사 검수' });
    await privateCapturePanel.waitFor({ timeout: timeoutMs });
    const privateMediaRecorderAvailable = await reviewPage.evaluate(() => (
      typeof MediaRecorder !== 'undefined' && typeof navigator.mediaDevices?.getUserMedia === 'function'
    ));
    const privateRecordingMemoryBoundaryVisible = await privateCapturePanel
      .getByText('브라우저 세션 메모리에만', { exact: false })
      .isVisible()
      && await privateCapturePanel.getByText('DB·서버·public 경로로 전송하지 않습니다.', { exact: false }).isVisible();
    await privateCapturePanel.getByLabel('마이크 사용과 로컬 메모리 처리에 동의합니다.').check();
    await privateCapturePanel.getByLabel('회차 ID').fill('session-browser-r4');
    await reviewPage.evaluate(() => { window.__failPrivateRecorderConstruction = true; });
    await privateCapturePanel.getByRole('button', { name: '녹음 시작' }).click();
    await privateCapturePanel.getByRole('alert')
      .filter({ hasText: 'synthetic recorder construction failure' })
      .waitFor({ timeout: timeoutMs });
    const privateRecorderConstructionFailureRecovered = await reviewPage.evaluate(() => (
      window.__privateMediaTrackStopCount === 1
    )) && await privateCapturePanel.getByRole('button', { name: '녹음 시작' }).isEnabled();
    await privateCapturePanel.getByRole('button', { name: '녹음 시작' }).evaluate((button) => {
      if (!(button instanceof HTMLButtonElement)) throw new Error('Private recording start control is not a button');
      button.click();
      button.click();
    });
    const privateSessionLockedWhileRecording = await privateCapturePanel.getByLabel('회차 ID').isDisabled();
    await privateCapturePanel.getByText('녹음 중입니다. 음성은 서버로 전송되지 않습니다.', { exact: true })
      .waitFor({ timeout: timeoutMs });
    const privateDuplicateRecordingStartBlocked = await reviewPage.evaluate(() => (
      window.__privateGetUserMediaCount === 2
    ));
    await reviewPage.waitForTimeout(25);
    await privateCapturePanel.getByRole('button', { name: '녹음 정지' }).click();
    await privateCapturePanel.getByText(/audio SHA-256 [a-f0-9]{64}/).waitFor({ timeout: timeoutMs });
    await privateCapturePanel.getByLabel('검수자 역할 ID').fill('browser-r4-reviewer');
    await privateCapturePanel.getByLabel('수동 전사 원문').fill('합성 음성 전사 원문입니다.');
    await privateCapturePanel.getByRole('button', { name: '전사 chunk 추가' }).click();
    const privateChunkCard = privateCapturePanel.locator('article[aria-label^="전사 chunk 검수"]');
    await privateChunkCard.waitFor({ timeout: timeoutMs });
    const privateBatchDownloadButton = privateCapturePanel
      .getByRole('button', { name: '검수 완료 전사 batch 다운로드' });
    const privateTranscriptReviewGateVerified = await privateBatchDownloadButton.isDisabled();
    await privateChunkCard.getByLabel('검수 전사').fill('합성 음성의 검수된 전사입니다.');
    await privateChunkCard.getByRole('button', { name: '수정 승인' }).click();
    await privateCapturePanel.getByText('검수 진행 1/1', { exact: true }).waitFor({ timeout: timeoutMs });
    await privateChunkCard.getByLabel('검수 전사').fill('합성 음성의 최종 검수 전사입니다.');
    await privateCapturePanel.getByText('검수 진행 0/1', { exact: true }).waitFor({ timeout: timeoutMs });
    const privateTranscriptRedecisionGateVerified = await privateBatchDownloadButton.isDisabled();
    await privateChunkCard.getByRole('button', { name: '수정 승인' }).click();
    await privateCapturePanel.getByText('검수 진행 1/1', { exact: true }).waitFor({ timeout: timeoutMs });
    const privateDownloadPromise = reviewPage.waitForEvent('download', { timeout: timeoutMs });
    await privateBatchDownloadButton.click();
    const privateTranscriptBatch = JSON.parse(await downloadText(await privateDownloadPromise));
    const privateTranscriptBatchDownloaded = privateTranscriptBatch.kind === 'private-transcript-review-batch'
      && privateTranscriptBatch.source?.sessionId === 'session-browser-r4'
      && privateTranscriptBatch.source?.storage === 'browser-memory'
      && /^[a-f0-9]{64}$/.test(privateTranscriptBatch.source?.audioSha256 ?? '')
      && privateTranscriptBatch.chunks?.[0]?.reviewStatus === 'edited'
      && privateTranscriptBatch.chunks?.[0]?.text === '합성 음성의 최종 검수 전사입니다.'
      && privateTranscriptBatch.safety?.localOnly === true
      && privateTranscriptBatch.safety?.audioIncluded === false
      && privateTranscriptBatch.safety?.extractionExecuted === false
      && !JSON.stringify(privateTranscriptBatch).includes('synthetic-browser-audio');
    if (!privateMediaRecorderAvailable || !privateRecordingMemoryBoundaryVisible
      || !privateRecorderConstructionFailureRecovered || !privateSessionLockedWhileRecording
      || !privateDuplicateRecordingStartBlocked
      || !privateTranscriptReviewGateVerified || !privateTranscriptRedecisionGateVerified
      || !privateTranscriptBatchDownloaded) {
      throw new Error('Private MediaRecorder transcript review contract is incomplete');
    }
    const transcriptReviewPanel = reviewPage.getByRole('region', { name: '합성 전사 후보 검수' });
    await transcriptReviewPanel.waitFor({ timeout: timeoutMs });
    const transcriptLocalOnlyBoundaryVisible = await transcriptReviewPanel
      .getByText('실제 시민 발언 파일은 이 prototype에 넣지 마세요.', { exact: false })
      .isVisible();
    await transcriptReviewPanel.getByLabel('전사 ontology fixture JSON')
      .setInputFiles(transcriptReviewUploadPayload());
    await transcriptReviewPanel.getByLabel('검수자 역할 ID').fill('browser-verifier-role');
    const startTranscriptReview = transcriptReviewPanel.getByRole('button', { name: '전사 후보 로컬 검수 시작' });
    await startTranscriptReview.waitFor({ state: 'visible', timeout: timeoutMs });
    await reviewPage.waitForFunction(() => {
      const button = [...document.querySelectorAll('button')]
        .find((candidate) => candidate.textContent?.trim() === '전사 후보 로컬 검수 시작');
      return button instanceof HTMLButtonElement && !button.disabled;
    }, undefined, { timeout: timeoutMs });
    await startTranscriptReview.click();
    await transcriptReviewPanel.getByText('진행 0/3', { exact: true }).waitFor({ timeout: timeoutMs });
    const transcriptNodeCards = transcriptReviewPanel.locator('article[aria-label^="전사 노드 후보 검수"]');
    const transcriptRelationCards = transcriptReviewPanel.locator('article[aria-label^="전사 관계 후보 검수"]');
    const transcriptCandidateEvidenceVisible = await transcriptNodeCards.nth(0)
      .getByText('재생에너지 전환 속도를 높여야 합니다.', { exact: true }).isVisible()
      && await transcriptNodeCards.nth(0).getByLabel('Habermas 발화 역할').inputValue() === 'Issue'
      && await transcriptRelationCards.nth(0).getByLabel('논증 관계').inputValue() === 'isAbout';
    await transcriptNodeCards.nth(0).getByLabel('표시 이름').fill('재생에너지 전환의 속도와 조건');
    await transcriptNodeCards.nth(0).getByRole('button', { name: '수정 승인' }).click();
    await transcriptNodeCards.nth(1).getByRole('button', { name: '반려' }).click();
    await transcriptRelationCards.nth(0).getByRole('button', { name: '반려' }).click();
    await transcriptReviewPanel.getByText('진행 3/3', { exact: true }).waitFor({ timeout: timeoutMs });
    const transcriptDownloadButton = transcriptReviewPanel
      .getByRole('button', { name: '전사 후보 검수 plan 다운로드' });
    await transcriptNodeCards.nth(0).getByLabel('표시 이름').fill('재생에너지 전환의 최종 속도와 조건');
    await transcriptReviewPanel.getByText('진행 2/3', { exact: true }).waitFor({ timeout: timeoutMs });
    const transcriptRedecisionGateVerified = await transcriptDownloadButton.isDisabled();
    await transcriptNodeCards.nth(0).getByRole('button', { name: '수정 승인' }).click();
    await transcriptReviewPanel.getByText('진행 3/3', { exact: true }).waitFor({ timeout: timeoutMs });
    const transcriptDownloadPromise = reviewPage.waitForEvent('download', { timeout: timeoutMs });
    await transcriptDownloadButton.click();
    const transcriptReviewedPlan = JSON.parse(await downloadText(await transcriptDownloadPromise));
    const transcriptReviewDownloaded = transcriptReviewedPlan.kind === 'transcript-ontology-reviewed-plan'
      && transcriptReviewedPlan.databaseMutationExecuted === false
      && transcriptReviewedPlan.publicGraphWritten === false
      && transcriptReviewedPlan.requiresPublicationReview === true
      && transcriptReviewedPlan.dryRun === true
      && transcriptReviewedPlan.source?.fixtureSha256 === TRANSCRIPT_REVIEW_FIXTURE_SHA256
      && transcriptReviewedPlan.nodes?.[0]?.reviewStatus === 'edited'
      && transcriptReviewedPlan.nodes?.[0]?.kind === 'Issue'
      && transcriptReviewedPlan.nodes?.[0]?.label === '재생에너지 전환의 최종 속도와 조건'
      && transcriptReviewedPlan.nodes?.[0]?.reviewer === 'browser-verifier-role'
      && transcriptReviewedPlan.nodes?.[0]?.citedUids?.join(',') === 'chunk-001,chunk-002'
      && transcriptReviewedPlan.nodes?.[0]?.transcript?.[0]?.text === '재생에너지 전환 속도를 높여야 합니다.'
      && transcriptReviewedPlan.nodes?.[1]?.reviewStatus === 'rejected'
      && transcriptReviewedPlan.nodes?.[1]?.kind === null
      && transcriptReviewedPlan.relations?.[0]?.reviewStatus === 'rejected'
      && transcriptReviewedPlan.relations?.[0]?.relation === null;
    if (!transcriptLocalOnlyBoundaryVisible || !transcriptCandidateEvidenceVisible
      || !transcriptRedecisionGateVerified || !transcriptReviewDownloaded) {
      throw new Error('Transcript ontology review browser contract is incomplete');
    }
    const canvasReviewPanel = reviewPage.getByRole('region', { name: 'Canvas 검수 계획' });
    const reviewFiles = reviewUploadPayloads();
    await canvasReviewPanel.getByLabel('검수 계획 JSON').setInputFiles(reviewFiles.plan);
    await canvasReviewPanel.getByLabel('Canvas snapshot JSON').setInputFiles(reviewFiles.snapshot);
    await canvasReviewPanel.getByLabel('검수자 역할 ID').fill('browser-verifier-role');
    const startReviewButton = canvasReviewPanel.getByRole('button', { name: '로컬 검수 시작' });
    await startReviewButton.waitFor({ state: 'visible', timeout: timeoutMs });
    await reviewPage.waitForFunction(() => {
      const button = [...document.querySelectorAll('button')]
        .find((candidate) => candidate.textContent?.trim() === '로컬 검수 시작');
      return button instanceof HTMLButtonElement && !button.disabled;
    }, undefined, { timeout: timeoutMs });
    await startReviewButton.click();
    await waitForReviewProgress(reviewPage, '진행 0/5', timeoutMs);

    let nodeCards = reviewPage.locator('article[aria-label^="노드 검수"]');
    await nodeCards.nth(0).getByLabel('표시 이름').fill('이전 plan의 임시 입력');
    await nodeCards.nth(0).getByRole('button', { name: /승인/ }).click();
    await nodeCards.nth(1).getByRole('button', { name: '반려' }).click();
    let relationCards = reviewPage.locator('article[aria-label^="관계 검수"]');
    await relationCards.nth(0).getByRole('button', { name: '반려' }).click();
    await relationCards.nth(1).getByRole('button', { name: '반려' }).click();
    await reviewPage.locator('article[aria-label^="군집 검수"]')
      .getByRole('button', { name: '반려' }).click();
    await reviewPage.getByText('진행 5/5', { exact: true }).waitFor({ timeout: timeoutMs });
    const mixedDownloadPromise = reviewPage.waitForEvent('download', { timeout: timeoutMs });
    await reviewPage.getByRole('button', { name: '검수 완료 plan 다운로드' }).click();
    const mixedReviewedPlan = JSON.parse(await downloadText(await mixedDownloadPromise));
    const mixedReviewedItems = [
      ...(Array.isArray(mixedReviewedPlan.nodes) ? mixedReviewedPlan.nodes : []),
      ...(Array.isArray(mixedReviewedPlan.relations) ? mixedReviewedPlan.relations : []),
      ...(Array.isArray(mixedReviewedPlan.clusters) ? mixedReviewedPlan.clusters : []),
    ];
    const validReviewAudit = (item, expectedStatus) => item.reviewStatus === expectedStatus
      && item.reviewer === 'browser-verifier-role'
      && typeof item.reviewedAt === 'string'
      && new Date(item.reviewedAt).toISOString() === item.reviewedAt;
    const reviewMixedDecisionStatesVerified = mixedReviewedItems.length === 5
      && validReviewAudit(mixedReviewedPlan.nodes?.[0], 'edited')
      && mixedReviewedPlan.nodes?.[0]?.label === '이전 plan의 임시 입력'
      && validReviewAudit(mixedReviewedPlan.nodes?.[1], 'rejected')
      && mixedReviewedPlan.nodes?.[1]?.kind === null
      && mixedReviewedPlan.nodes?.[1]?.label === mixedReviewedPlan.nodes?.[1]?.sourceText
      && mixedReviewedPlan.nodes?.[1]?.text === mixedReviewedPlan.nodes?.[1]?.sourceText
      && mixedReviewedPlan.relations?.every((relation) => (
        validReviewAudit(relation, 'rejected') && relation.relation === null
      ))
      && validReviewAudit(mixedReviewedPlan.clusters?.[0], 'rejected')
      && mixedReviewedPlan.clusters?.[0]?.issueNodeId === null;
    if (!reviewMixedDecisionStatesVerified) {
      throw new Error('Ontology review mixed decision serialization contract is invalid');
    }

    const reloadFiles = reviewUploadPayloads(REVIEW_RELOAD_SNAPSHOT);
    await canvasReviewPanel.getByLabel('검수 계획 JSON').setInputFiles(reloadFiles.plan);
    await canvasReviewPanel.getByLabel('Canvas snapshot JSON').setInputFiles(reloadFiles.snapshot);
    await canvasReviewPanel.getByRole('button', { name: '로컬 검수 시작' }).click();
    await waitForReviewProgress(reviewPage, '진행 0/5', timeoutMs);
    await reviewPage.waitForFunction((expectedLabel) => (
      document.querySelector('article[aria-label^="노드 검수"] input')?.value === expectedLabel
    ), REVIEW_RELOAD_SNAPSHOT.payload.agenda[0].text, { timeout: timeoutMs });
    nodeCards = reviewPage.locator('article[aria-label^="노드 검수"]');
    const reviewReloadIsolationVerified = await nodeCards.nth(0).getByLabel('표시 이름').inputValue()
      === REVIEW_RELOAD_SNAPSHOT.payload.agenda[0].text;
    if (!reviewReloadIsolationVerified) throw new Error('Ontology review retained input from a previous plan');

    await nodeCards.nth(0).getByLabel('온톨로지 역할').selectOption('Issue');
    await nodeCards.nth(0).getByRole('button', { name: '원문 승인' }).click();
    await nodeCards.nth(1).getByLabel('온톨로지 역할').selectOption('Proposal');
    await nodeCards.nth(1).getByRole('button', { name: '원문 승인' }).click();
    relationCards = reviewPage.locator('article[aria-label^="관계 검수"]');
    await relationCards.nth(0).getByLabel('관계 유형').selectOption('supports');
    await relationCards.nth(0).getByRole('button', { name: '승인' }).click();
    await relationCards.nth(1).getByLabel('관계 유형').selectOption('implements');
    await relationCards.nth(1).getByRole('button', { name: '승인' }).click();
    await reviewPage.locator('article[aria-label^="군집 검수"]')
      .getByRole('button', { name: '승인' }).click();
    await reviewPage.getByText('진행 5/5', { exact: true }).waitFor({ timeout: timeoutMs });
    const reviewFacilitationPromptCount = await reviewPage
      .getByRole('region', { name: '진행 질문' })
      .getByRole('listitem')
      .count();
    const reviewFacilitationPromptVerified = reviewFacilitationPromptCount === 1
      && await reviewPage.getByText(
        `“${REVIEW_RELOAD_SNAPSHOT.payload.agenda[1].text}”을 실행하려면 어떤 조건이 먼저 충족되어야 하나요?`,
        { exact: true },
      ).isVisible();
    const reviewFacilitationLiveCountVerified = await reviewPage
      .getByRole('region', { name: '진행 질문' })
      .getByRole('status')
      .getByText('현재 규칙으로 확인된 진행 질문 1개', { exact: true })
      .isVisible();
    await reviewPage.getByText('적용 중인 질문 규칙 5개', { exact: true }).click();
    const reviewFacilitationRuleCatalogVerified = await reviewPage
      .getByRole('list', { name: 'R5 진행 질문 규칙' })
      .getByRole('listitem')
      .count() === 5
      && await reviewPage.getByText('근거가 연결되지 않은 주장', { exact: true }).isVisible()
      && await reviewPage.getByText('이름 붙이지 않은 가치 긴장', { exact: true }).isVisible();
    const reviewFacilitationProvenanceVerified = await reviewPage.getByText(
      '출처 세션 session-1 · 원 agenda action-1 · 노드 canvas-agenda:action-1',
      { exact: true },
    ).isVisible() && await reviewPage.getByText(
      `원문: ${REVIEW_RELOAD_SNAPSHOT.payload.agenda[1].text}`,
      { exact: true },
    ).isVisible();
    await reviewPage.getByRole('link', { name: '출처 노드 보기', exact: true }).click();
    const reviewFacilitationSourceFocusVerified = await reviewPage.evaluate(() => (
      document.activeElement?.getAttribute('aria-label') === '노드 검수 canvas-agenda:action-1'
    ));
    if (!reviewFacilitationPromptVerified) {
      throw new Error('Ontology review facilitation prompt contract is invalid');
    }
    if (!reviewFacilitationLiveCountVerified || !reviewFacilitationRuleCatalogVerified
      || !reviewFacilitationProvenanceVerified || !reviewFacilitationSourceFocusVerified) {
      throw new Error('Ontology review facilitation prompt evidence is incomplete');
    }
    if (screenshot) await reviewPage.screenshot({ path: screenshot, fullPage: true });
    const downloadPromise = reviewPage.waitForEvent('download', { timeout: timeoutMs });
    await reviewPage.getByRole('button', { name: '검수 완료 plan 다운로드' }).click();
    const reviewedPlan = JSON.parse(await downloadText(await downloadPromise));
    const reviewedItems = [
      ...(Array.isArray(reviewedPlan.nodes) ? reviewedPlan.nodes : []),
      ...(Array.isArray(reviewedPlan.relations) ? reviewedPlan.relations : []),
      ...(Array.isArray(reviewedPlan.clusters) ? reviewedPlan.clusters : []),
    ];
    const reviewedPlanDecisionCount = reviewedItems.filter((item) => item.reviewStatus === 'accepted').length;
    const reviewedPlanAuditFieldsValid = reviewedItems.every((item) => (
      item.reviewStatus === 'accepted'
      && item.reviewer === 'browser-verifier-role'
      && typeof item.reviewedAt === 'string'
      && new Date(item.reviewedAt).toISOString() === item.reviewedAt
    ));
    const expectedReloadPlan = JSON.parse(reloadFiles.plan.buffer.toString('utf8'));
    const reviewedPlanDownloaded = reviewedPlanDecisionCount === 5
      && reviewedPlan.databaseMutationExecuted === false
      && reviewedPlan.publicGraphWritten === false
      && reviewedPlanAuditFieldsValid
      && reviewedPlan.source?.snapshotId === REVIEW_RELOAD_SNAPSHOT.id
      && reviewedPlan.integrity?.snapshotSha256 === expectedReloadPlan.integrity.snapshotSha256
      && reviewedPlan.nodes?.[0]?.kind === 'Issue'
      && reviewedPlan.nodes?.[0]?.sourceText === REVIEW_RELOAD_SNAPSHOT.payload.agenda[0].text
      && reviewedPlan.nodes?.[0]?.label === REVIEW_RELOAD_SNAPSHOT.payload.agenda[0].text
      && reviewedPlan.nodes?.[1]?.kind === 'Proposal'
      && reviewedPlan.nodes?.every((node) => node.reviewer === 'browser-verifier-role')
      && reviewedPlan.relations?.[0]?.relation === 'supports'
      && reviewedPlan.relations?.[1]?.relation === 'implements'
      && reviewedPlan.relations?.every((relation) => relation.reviewer === 'browser-verifier-role')
      && reviewedPlan.clusters?.[0]?.issueNodeId === 'canvas-agenda:agenda-1'
      && reviewedPlan.clusters?.[0]?.reviewer === 'browser-verifier-role';
    await reviewPage.waitForTimeout(500);
    if (!reviewNavigation.connected || reviewNavigation.currentPath !== reviewUrl.pathname) {
      throw new Error('Ontology review platform navigation is incomplete or has the wrong current page');
    }
    if (!reviewLocalOnlyBoundaryVisible) throw new Error('Ontology review local-only boundary is not visible');
    if (!reviewedPlanDownloaded) throw new Error('Ontology reviewed plan download contract is invalid');
    if (writeRequests.length > 0) throw new Error('Ontology review verification attempted a blocked write request');
    if (browserErrors.length > 0) throw new Error('Ontology review verification observed a browser page error');
    await reviewPage.close();

    const linkedSurfaceStatuses = [];
    for (const linkedPath of ['/workshop-graph/', '/workshop-graph/guide/']) {
      const assetPath = `${linkedPath}index.html`;
      const linkedUrl = new URL(assetPath, origin);
      const linkedResponse = await context.request.get(linkedUrl.toString(), { timeout: timeoutMs });
      const finalPath = new URL(linkedResponse.url()).pathname;
      if (!linkedResponse.ok() || finalPath !== assetPath) {
        throw new Error(`Moderator platform linked surface is unavailable: ${linkedPath}`);
      }
      linkedSurfaceStatuses.push({ path: linkedPath, assetPath, status: linkedResponse.status() });
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
        moderatorLoginBoundary,
        canvasHydrated: nodeCount > 0,
        canvasWorkbenchUsable,
        canvasWorkbenchSize,
        platformNavigationConnected: canvasNavigation.connected,
        platformNavigationLinkCount: canvasNavigation.linkCount,
        nonDecisionCopyVisible: canvasNavigation.nonDecisionCopyVisible,
        liveDocumentStatus: liveDocumentResponse.status(),
        livePlatformNavigationConnected: liveNavigation.connected,
        reviewDocumentStatus: reviewDocumentResponse.status(),
        reviewPlatformNavigationConnected: reviewNavigation.connected,
        reviewLocalOnlyBoundaryVisible,
        transcriptReviewLocalOnlyBoundaryVisible: transcriptLocalOnlyBoundaryVisible,
        transcriptCandidateEvidenceVisible,
        transcriptRedecisionGateVerified,
        transcriptReviewDownloaded,
        privateMediaRecorderAvailable,
        privateRecordingMemoryBoundaryVisible,
        privateRecorderConstructionFailureRecovered,
        privateDuplicateRecordingStartBlocked,
        privateSessionLockedWhileRecording,
        privateTranscriptReviewGateVerified,
        privateTranscriptRedecisionGateVerified,
        privateTranscriptBatchDownloaded,
        reviewInteractionCompleted: reviewedPlanDecisionCount === 5,
        reviewMixedDecisionStatesVerified,
        reviewReloadIsolationVerified,
        reviewFacilitationPromptVerified,
        reviewFacilitationPromptCount,
        reviewFacilitationLiveCountVerified,
        reviewFacilitationRuleCatalogVerified,
        reviewFacilitationProvenanceVerified,
        reviewFacilitationSourceFocusVerified,
        reviewedPlanDownloaded,
        reviewedPlanDecisionCount,
        linkedSurfaceStatuses,
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
