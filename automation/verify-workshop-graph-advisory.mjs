import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';

const OUTPUT_PATH = 'evaluation/2026-08-14-workshop-graph-reviewed-snapshot-browser.json';
const SCREENSHOT_PATH = 'evaluation/2026-08-14-workshop-graph-reviewed-snapshot-browser.png';
const BASE_URL = 'http://127.0.0.1:4323';
const SOURCE_A = 'workshop-2026-06-13';
const SOURCE_B = 'regulation-2026-06-13';
const SOURCE_INVALID = 'source-coverage-2026-06-13';
const SOURCE_REVIEWED = 'live-transcript-r2-reviewed';
const SOURCE_REVIEWED_STANDARD = 'live-reviewed-snapshot-ui-fixture';
const SOURCE_FILES = [
  'public/workshop-graph/index.html',
  'public/workshop-graph/graph-advisory-assets.js',
  'public/workshop-graph/graph-source-adapter.js',
  'public/workshop-graph/sources.json',
  'public/workshop-graph/data/live-transcript-r2-reviewed.json',
  'automation/verify-workshop-graph-advisory.mjs',
];

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function graphFixture(name, advisory) {
  const graph = JSON.parse(readFileSync(`public/workshop-graph/data/${name}.json`, 'utf8'));
  graph.meta = { ...graph.meta, ...advisory };
  return graph;
}

function advisoryFixture(prefix, title) {
  return {
    recommendations: [{
      kind: 'recommendation_candidate', review_status: 'draft', rec_id: `${prefix}-rec`, title,
      summary: '사람 검수 전 숙의 보조 후보입니다.', was_derived_from: [`${prefix}-source`],
      transcript_chunk_ids: [`${prefix}-chunk`], cited_uids: [`${prefix}-citation`],
      minority: [{
        minority_id: `${prefix}-minority`, title: '소수 우려',
        text: '비용과 실행 조건을 함께 검토해야 합니다.', cited_uids: [`${prefix}-minority-citation`],
      }],
    }],
    quality: {
      validity_label: 'review-signal', reliability: false,
      limitations_notice: '사람이 원문 맥락과 출처를 다시 확인해야 합니다.',
      cited_uids: [`${prefix}-quality`],
    },
  };
}

const catalog = JSON.parse(readFileSync('public/workshop-graph/sources.json', 'utf8'));
catalog.default = SOURCE_A;
catalog.sources.push({
  id: SOURCE_REVIEWED_STANDARD,
  category: 'live',
  label: '검수 완료 snapshot UI fixture',
  data: `data/${SOURCE_REVIEWED_STANDARD}.json`,
  publicationMode: 'reviewed_snapshot',
  supportsView: ['2d'],
  polling_default_sec: 15,
});
for (const source of catalog.sources) {
  if ([SOURCE_A, SOURCE_B, SOURCE_INVALID].includes(source.id)) source.menu = true;
}
const fixtures = new Map([
  [`${SOURCE_A}.json`, graphFixture(SOURCE_A, advisoryFixture('candidate-a', '첫 번째 권고 후보'))],
  [`${SOURCE_B}.json`, graphFixture(SOURCE_B, advisoryFixture('candidate-b', '두 번째 권고 후보'))],
  [`${SOURCE_INVALID}.json`, graphFixture(SOURCE_INVALID, { quality: { conclusion: 'legacy quality note' } })],
]);
const reviewedStandardGraph = JSON.parse(readFileSync('public/workshop-graph/data/live-transcript-r2-reviewed.json', 'utf8'));
reviewedStandardGraph.meta.publication_status = 'reviewed_snapshot';
reviewedStandardGraph.meta.publication.mode = 'reviewed-snapshot';
reviewedStandardGraph.meta.source.source_id = SOURCE_REVIEWED_STANDARD;
delete reviewedStandardGraph.meta.advisory_notice;
fixtures.set(`${SOURCE_REVIEWED_STANDARD}.json`, reviewedStandardGraph);

const browser = await chromium.launch({ headless: true });
const chromiumVersion = browser.version();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const pageErrors = [];
const consoleErrors = [];
page.on('pageerror', error => pageErrors.push(error.message));
page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
await page.route('**/workshop-graph/sources.json', route => route.fulfill({ json: catalog }));
await page.route(/\/workshop-graph\/data\/.*\.json(?:\?.*)?$/, route => {
  const filename = new URL(route.request().url()).pathname.split('/').pop();
  const fixture = fixtures.get(filename);
  return fixture ? route.fulfill({ json: fixture }) : route.continue();
});

try {
  await page.goto(`${BASE_URL}/workshop-graph/?mode=normal`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__ontologyGraphDebug?.getCy()?.nodes().length > 0);
  const liveCategoryLabel = await page.locator(`#og-source option[value="${SOURCE_REVIEWED_STANDARD}"]`)
    .evaluate(option => option.parentElement?.label || '');
  await page.locator('#og-assets-btn').click();
  const side = page.locator('#og-side');
  const firstPanel = await side.textContent();
  const firstMetadata = await page.locator('#og-stat').textContent();

  await page.locator('#og-source').selectOption(SOURCE_B);
  await page.waitForFunction(source => window.__ontologyGraphDebug?.getState().curSource === source, SOURCE_B);
  await page.waitForFunction(() => document.querySelector('#og-side')?.textContent?.includes('두 번째 권고 후보'));
  const secondPanel = await side.textContent();
  const secondPanelOpen = !(await side.evaluate(element => element.classList.contains('collapsed')));
  await page.locator('#og-source').selectOption(SOURCE_INVALID);
  await page.waitForFunction(source => window.__ontologyGraphDebug?.getState().curSource === source, SOURCE_INVALID);
  await page.waitForFunction(() => document.querySelector('#og-assets-btn')?.style.display === 'none');
  const invalidAdvisory = await page.locator('#og-advisory').textContent();
  const invalidPanel = await side.textContent();
  const invalidPanelState = await side.evaluate(element => ({
    content: element.dataset.content, collapsed: element.classList.contains('collapsed'),
  }));
  const stalePanelCleared = invalidPanelState.content === 'overview'
    && !invalidPanelState.collapsed
    && invalidPanel.includes('숙의 온톨로지 개요');

  const fixedNodeLabel = await page.evaluate(() => {
    const debug = window.__ontologyGraphDebug;
    const node = debug.getCy().nodes().filter(candidate => !candidate.data('isGroup'))[0];
    node.emit('tap');
    return debug.buildNodeContext(node.id()).node.label;
  });
  await page.locator('#og-source').selectOption(SOURCE_A);
  await page.waitForFunction(source => window.__ontologyGraphDebug?.getState().curSource === source, SOURCE_A);
  await page.waitForFunction(() => document.querySelector('#og-assets-btn')?.textContent?.includes('권고 후보'));
  const nodePanelPreserved = await side.evaluate((element, label) => (
    element.dataset.content === 'node' && !element.classList.contains('collapsed') && element.textContent.includes(label)
  ), fixedNodeLabel);

  await page.locator('#og-source').selectOption(SOURCE_REVIEWED_STANDARD);
  await page.waitForFunction(source => window.__ontologyGraphDebug?.getState().curSource === source, SOURCE_REVIEWED_STANDARD);
  await page.waitForFunction(() => document.querySelector('#og-footer-note')?.textContent?.includes('사람 검수 완료 스냅샷'));
  const standardReviewedPresentation = await page.evaluate(() => ({
    footer: document.querySelector('#og-footer-note')?.textContent || '',
    advisory: document.querySelector('#og-advisory')?.textContent || '',
    pill: document.querySelector('.og-pill')?.textContent || '',
  }));

  await page.locator('#og-source').selectOption(SOURCE_REVIEWED);
  await page.waitForFunction(source => window.__ontologyGraphDebug?.getState().curSource === source, SOURCE_REVIEWED);
  await page.waitForFunction(() => document.querySelector('#og-footer-note')?.textContent?.includes('합성 전사 검수 데모'));
  const reviewedSnapshot = await page.evaluate(() => {
    const cy = window.__ontologyGraphDebug.getCy();
    const nodes = cy.nodes().filter(node => !node.data('isGroup')).map(node => node.data());
    const edges = cy.edges().map(edge => edge.data());
    return {
      nodeCount: nodes.length,
      edgeCount: edges.length,
      allItemsPublic: [...nodes, ...edges].every(item => item.is_public === true),
      allItemsReviewed: [...nodes, ...edges].every(item => ['accepted', 'edited'].includes(item.review_state)),
      footer: document.querySelector('#og-footer-note')?.textContent || '',
      advisory: document.querySelector('#og-advisory')?.textContent || '',
    };
  });
  const reviewedSource = catalog.sources.find(source => source.id === SOURCE_REVIEWED);
  await page.screenshot({ path: SCREENSHOT_PATH, fullPage: true });

  const localHashes = Object.fromEntries(SOURCE_FILES.map(path => [path, sha256(readFileSync(path))]));
  const servedPaths = SOURCE_FILES.filter(path => path.startsWith('public/workshop-graph/'));
  const servedHashes = Object.fromEntries(await Promise.all(servedPaths.map(async path => {
    const publicPath = path.replace(/^public/, '');
    const body = await (await page.request.get(`${BASE_URL}${publicPath}`)).body();
    return [path, sha256(body)];
  })));
  const servedHashesMatch = servedPaths.every(path => servedHashes[path] === localHashes[path]);
  const result = {
    checkedAt: new Date().toISOString(), url: page.url(), verifier: 'automation/verify-workshop-graph-advisory.mjs',
    sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    chromiumVersion, sourceHashes: localHashes, servedHashesMatch,
    fixtures: { sourceA: SOURCE_A, candidateA: 'candidate-a-rec', sourceB: SOURCE_B, candidateB: 'candidate-b-rec', invalidSource: SOURCE_INVALID },
    reviewedPublicSnapshot: {
      sourceId: SOURCE_REVIEWED,
      manifestPublicationMode: reviewedSource?.publicationMode || null,
      ...reviewedSnapshot,
    },
    standardReviewedPresentation,
    liveCategoryLabel,
    validCandidate: {
      metadata: firstMetadata, humanReviewRequired: firstPanel.includes('사람 검수 필요'),
      recommendationCandidateVisible: firstPanel.includes('첫 번째 권고 후보'), qualitySignalVisible: firstPanel.includes('품질 신호'),
      minorityConcernVisible: firstPanel.includes('소수 우려'), sourceUidVisible: firstPanel.includes('출처 UID'),
      transcriptChunkIdVisible: firstPanel.includes('전사 chunk ID'), citedUidVisible: firstPanel.includes('인용 UID'),
      qualityProvenanceVisible: firstPanel.includes('candidate-a-quality'), decisionClaimAbsent: !firstPanel.includes('합의·권고'),
    },
    validToValidTransition: {
      panelRemainedOpen: secondPanelOpen, candidateBVisible: secondPanel.includes('두 번째 권고 후보'),
      candidateAAbsent: !secondPanel.includes('첫 번째 권고 후보'),
    },
    invalidAssetTransition: {
      advisory: invalidAdvisory, formatErrorVisible: invalidAdvisory.includes('형식 오류'),
      advisoryContentAbsent: !invalidPanel.includes('두 번째 권고 후보'), overviewRestored: stalePanelCleared,
    },
    unrelatedNodePanel: { label: fixedNodeLabel, preservedAcrossSourceChange: nodePanelPreserved },
    pageErrors, consoleErrors, consoleErrorCount: consoleErrors.length,
  };
  result.passed = Object.values(result.validCandidate).every(Boolean)
    && Object.values(result.validToValidTransition).every(Boolean)
    && result.invalidAssetTransition.formatErrorVisible && result.invalidAssetTransition.advisoryContentAbsent
    && result.invalidAssetTransition.overviewRestored && result.unrelatedNodePanel.preservedAcrossSourceChange
    && result.reviewedPublicSnapshot.manifestPublicationMode === 'reviewed_snapshot'
    && result.reviewedPublicSnapshot.nodeCount > 0 && result.reviewedPublicSnapshot.edgeCount > 0
    && result.reviewedPublicSnapshot.allItemsPublic && result.reviewedPublicSnapshot.allItemsReviewed
    && result.reviewedPublicSnapshot.footer.includes('합성 전사 검수 데모')
    && result.standardReviewedPresentation.footer.includes('사람 검수 완료 스냅샷')
    && result.standardReviewedPresentation.advisory.includes('사람 검수 완료 스냅샷')
    && result.standardReviewedPresentation.pill.includes('LIVE · 검수 완료')
    && result.liveCategoryLabel === '검수 완료 스냅샷'
    && result.servedHashesMatch && result.pageErrors.length === 0 && result.consoleErrorCount === 1;
  writeFileSync(OUTPUT_PATH, `${JSON.stringify(result, null, 2)}\n`);
  if (!result.passed) throw new Error('Workshop graph advisory browser verification failed');
} finally {
  await browser.close();
}
