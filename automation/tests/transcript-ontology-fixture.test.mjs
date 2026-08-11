import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import { chromium } from 'playwright';
import {
  buildLiveTranscriptGraph,
  buildReviewedTranscriptGraph,
  verifyLiveTranscriptGraph,
  verifyReviewedTranscriptGraph,
} from '../transcript-ontology-fixture.mjs';
import { createWorkshopGraphSourceAdapter } from '../../public/workshop-graph/graph-source-adapter.js';

const FIXTURE = JSON.parse(readFileSync(
  fileURLToPath(new URL('../fixtures/transcript-ontology-reviewed.example.json', import.meta.url)),
  'utf8',
));

const LIVE_FIXTURE = {
  ...structuredClone(FIXTURE),
  publication: {
    mode: 'synthetic-reviewed-demo',
    approvedBy: 'reviewer-test',
    approvedAt: '2026-08-29T01:05:00.000Z',
  },
};

test('exports only explicitly approved synthetic fixtures as a public live graph', () => {
  const graph = buildLiveTranscriptGraph(LIVE_FIXTURE);

  expect(graph.elements.nodes.every((node) => (
    node.data.is_public === true && node.data.review_state === 'accepted'
  ))).toBe(true);
  expect(graph.elements.edges.every((edge) => (
    edge.data.is_public === true && edge.data.review_state === 'accepted'
  ))).toBe(true);
  expect(graph.meta).toMatchObject({
    variant: 'transcript-live-reviewed-fixture',
    live: true,
    publication_status: 'synthetic_reviewed_demo',
    requires_publication_review: false,
    publication: {
      mode: 'synthetic-reviewed-demo',
      approved_by: 'reviewer-test',
      approved_at: '2026-08-29T01:05:00.000Z',
    },
  });
  expect(JSON.stringify(graph)).not.toContain('speakerLabelPseudonym');
  expect(JSON.stringify(graph)).not.toContain('startMs');
  expect(JSON.stringify(graph)).not.toContain('endMs');
  expect(verifyLiveTranscriptGraph({ fixture: LIVE_FIXTURE, graph })).toMatchObject({
    nodeCount: 2,
    edgeCount: 1,
    publicGraphVerified: true,
    databaseMutationExecuted: false,
  });
});

test('maps reviewed transcript candidates to stable graph ids and preserves cited chunk uids', () => {
  const graph = buildReviewedTranscriptGraph(FIXTURE);

  expect(graph.elements.nodes.map((node) => node.data.id)).toEqual([
    'transcript-node:candidate-issue',
    'transcript-node:candidate-claim',
  ]);
  expect(graph.elements.nodes[0].data).toMatchObject({
    kind: 'Issue',
    cited: ['chunk-001', 'chunk-002'],
    cited_uids: ['chunk-001', 'chunk-002'],
    session: 'session-1',
    review_state: 'reviewed',
    is_public: false,
  });
  expect(graph.elements.edges[0].data).toMatchObject({
    id: 'transcript-edge:candidate-relation-1',
    source: 'transcript-node:candidate-claim',
    target: 'transcript-node:candidate-issue',
    rel: 'isAbout',
    cited: ['chunk-001'],
    cited_uids: ['chunk-001'],
  });
  expect(graph.meta).toMatchObject({
    variant: 'transcript-reviewed-fixture',
    publication_status: 'internal_reviewed_fixture',
    requires_publication_review: true,
    fixture_reviewed_at: '2026-08-29T01:00:00.000Z',
    source: {
      fixture_id: 'session-1-run-1',
      session_id: 'session-1',
      chunk_count: 2,
      fixture_checksum_sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    },
  });
});

test('round-trips through the current workshop graph source adapter', async () => {
  const graph = buildReviewedTranscriptGraph(FIXTURE);
  const adapter = createWorkshopGraphSourceAdapter({
    fetchImpl: async () => new Response(JSON.stringify(graph), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
    now: () => 1,
  });

  const loaded = await adapter.loadSource({ data: 'fixture.json' });
  expect(loaded.payload).toEqual(graph);
  expect(loaded.diagnostics).toEqual({
    origin: 'static',
    rowCount: null,
    nodeCount: 2,
    edgeCount: 1,
    missingCitedNodeIds: [],
  });
});

test('loads the tracked live source repeatedly without exposing raw transcript tables', async () => {
  const manifest = JSON.parse(readFileSync(
    fileURLToPath(new URL('../../public/workshop-graph/sources.json', import.meta.url)),
    'utf8',
  ));
  const liveGraph = JSON.parse(readFileSync(
    fileURLToPath(new URL('../../public/workshop-graph/data/live-transcript-reviewed-fixture.json', import.meta.url)),
    'utf8',
  ));
  const requested = [];
  let clock = 100;
  const adapter = createWorkshopGraphSourceAdapter({
    fetchImpl: async (url) => {
      requested.push(String(url));
      const body = url === 'sources.json' ? manifest : liveGraph;
      return new Response(JSON.stringify(body), { status: 200 });
    },
    now: () => clock++,
  });

  const catalog = await adapter.loadCatalog('sources.json');
  const source = catalog.manifest.sources.find((item) => item.id === 'live-transcript-reviewed-fixture');
  const first = await adapter.loadSource(source);
  const second = await adapter.loadSource(source);

  expect(source).toMatchObject({ category: 'live', polling_default_sec: 15 });
  expect(requested.slice(-2)).toEqual([
    'data/live-transcript-reviewed-fixture.json?_=100',
    'data/live-transcript-reviewed-fixture.json?_=101',
  ]);
  expect(first.payload).toEqual(second.payload);
  expect(first.diagnostics).toMatchObject({ nodeCount: 2, edgeCount: 1, missingCitedNodeIds: [] });
  expect(first.payload.elements.nodes[0].data.cited_uids).toEqual(['chunk-001', 'chunk-002']);
  expect(JSON.stringify(first.payload)).not.toContain('speakerLabelPseudonym');
  expect(JSON.stringify(first.payload)).not.toContain('startMs');
});

test('binds the tracked live graph to its approved fixture', () => {
  const fixture = JSON.parse(readFileSync(
    fileURLToPath(new URL('../fixtures/transcript-ontology-live-reviewed.example.json', import.meta.url)),
    'utf8',
  ));
  const graph = JSON.parse(readFileSync(
    fileURLToPath(new URL('../../public/workshop-graph/data/live-transcript-reviewed-fixture.json', import.meta.url)),
    'utf8',
  ));

  expect(verifyLiveTranscriptGraph({ fixture, graph })).toMatchObject({
    publicGraphVerified: true,
    nodeCount: 2,
    edgeCount: 1,
  });
});

test('polls the production live graph surface and applies the next payload', async () => {
  const publicRoot = fileURLToPath(new URL('../../public/', import.meta.url));
  const trackedGraph = JSON.parse(readFileSync(join(
    publicRoot,
    'workshop-graph',
    'data',
    'live-transcript-reviewed-fixture.json',
  ), 'utf8'));
  let graphRequestCount = 0;
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    try {
      let body;
      let contentType = 'application/octet-stream';
      if (url.pathname === '/workshop-graph/data/live-transcript-reviewed-fixture.json') {
        graphRequestCount += 1;
        const graph = structuredClone(trackedGraph);
        if (graphRequestCount > 1) graph.meta.advisory_notice = '합성 전사 검수 데모 · polling 갱신 확인';
        body = JSON.stringify(graph);
        contentType = 'application/json';
      } else {
        const relativePath = url.pathname === '/workshop-graph/'
          ? 'workshop-graph/index.html'
          : url.pathname.replace(/^\//, '');
        body = readFileSync(join(publicRoot, relativePath));
        contentType = relativePath.endsWith('.js') ? 'application/javascript'
          : relativePath.endsWith('.json') ? 'application/json'
            : relativePath.endsWith('.css') ? 'text/css' : 'text/html';
      }
      response.writeHead(200, { 'content-type': contentType });
      response.end(body);
    } catch (error) {
      console.error('Live graph browser fixture request failed', error);
      response.writeHead(404);
      response.end();
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Live graph browser fixture did not bind');
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    const localScript = (path) => readFileSync(fileURLToPath(new URL(`../../${path}`, import.meta.url)), 'utf8');
    await page.route('https://unpkg.com/**', async (route) => {
      const url = route.request().url();
      const body = url.includes('cytoscape@') ? localScript('node_modules/cytoscape/dist/cytoscape.min.js')
        : url.includes('layout-base@') ? localScript('node_modules/layout-base/layout-base.js')
          : url.includes('cose-base@') ? localScript('node_modules/cose-base/cose-base.js')
            : url.includes('cytoscape-fcose@') ? localScript('node_modules/cytoscape-fcose/cytoscape-fcose.js')
              : '';
      await route.fulfill({ status: 200, contentType: 'application/javascript', body });
    });
    await page.route('https://fonts.googleapis.com/**', (route) => route.abort());
    await page.route('https://cdn.jsdelivr.net/**', (route) => route.abort());
    await page.goto(
      `http://127.0.0.1:${address.port}/workshop-graph/?source=live-transcript-reviewed-fixture`,
      { waitUntil: 'domcontentloaded' },
    );
    await page.waitForFunction(() => document.querySelector('#og-stat')?.textContent?.includes('노드 2'));
    expect(await page.locator('#og-footer-note').textContent()).toContain('합성 전사 검수 데모 · 실제 시민 발언 아님');
    await page.evaluate(() => {
      const select = document.querySelector('#og-poll-interval');
      if (!(select instanceof HTMLSelectElement)) throw new Error('Polling interval control is unavailable');
      select.append(new Option('1초', '1'));
      select.value = '1';
      select.dispatchEvent(new Event('change'));
    });
    await page.waitForFunction(() => document.querySelector('#og-advisory')?.textContent?.includes('polling 갱신 확인'));
    expect(graphRequestCount).toBeGreaterThanOrEqual(2);
    expect(pageErrors).toEqual([]);
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('rejects transcript chunks with an invalid time range before graph export', () => {
  const fixture = structuredClone(FIXTURE);
  fixture.chunks[0].endMs = fixture.chunks[0].startMs;

  expect(() => buildReviewedTranscriptGraph(fixture)).toThrow('Invalid transcript chunk time range');
});

test('verifies the entire graph against the reviewed fixture and rejects changed provenance', () => {
  const graph = buildReviewedTranscriptGraph(FIXTURE);

  expect(verifyReviewedTranscriptGraph({ fixture: FIXTURE, graph })).toEqual({
    nodeCount: 2,
    edgeCount: 1,
    databaseMutationExecuted: false,
  });

  graph.elements.nodes[0].data.cited_uids = ['chunk-001'];
  expect(() => verifyReviewedTranscriptGraph({ fixture: FIXTURE, graph }))
    .toThrow('Transcript ontology graph does not match its reviewed fixture');
});

test('binds graph provenance to the complete time-coded transcript fixture', () => {
  const graph = buildReviewedTranscriptGraph(FIXTURE);
  const changedFixture = structuredClone(FIXTURE);
  changedFixture.chunks[0].text = '변조된 전사 내용';

  expect(() => verifyReviewedTranscriptGraph({ fixture: changedFixture, graph }))
    .toThrow('Transcript ontology graph does not match its reviewed fixture');
});

test('requires a pseudonymous speaker label for every transcript chunk', () => {
  const fixture = structuredClone(FIXTURE);
  delete fixture.chunks[0].speakerLabelPseudonym;

  expect(() => buildReviewedTranscriptGraph(fixture)).toThrow('Invalid transcript speaker pseudonym');
});

test('rejects unknown citations and relation endpoints before graph export', () => {
  const unknownCitation = structuredClone(FIXTURE);
  unknownCitation.expected.nodes[0].citedUids = ['chunk-missing'];
  expect(() => buildReviewedTranscriptGraph(unknownCitation))
    .toThrow('ontology node cites an unknown transcript chunk');

  const unknownEndpoint = structuredClone(FIXTURE);
  unknownEndpoint.expected.relations[0].targetUid = 'candidate-missing';
  expect(() => buildReviewedTranscriptGraph(unknownEndpoint))
    .toThrow('Ontology relation references an unknown node candidate');
});

test('uses the transcript extraction relation vocabulary exactly', () => {
  const impacts = structuredClone(FIXTURE);
  impacts.expected.relations[0].relation = 'impacts';
  expect(buildReviewedTranscriptGraph(impacts).elements.edges[0].data.rel).toBe('impacts');

  const outOfContract = structuredClone(FIXTURE);
  outOfContract.expected.relations[0].relation = 'implements';
  expect(() => buildReviewedTranscriptGraph(outOfContract)).toThrow('Invalid ontology relation candidate');
});

test('requires canonical review metadata and an opaque reviewer alias', () => {
  const invalidTimestamp = structuredClone(FIXTURE);
  invalidTimestamp.reviewedAt = '2026-08-29 01:00:00';
  expect(() => buildReviewedTranscriptGraph(invalidTimestamp)).toThrow('Invalid fixture reviewedAt');

  const identifyingReviewer = structuredClone(FIXTURE);
  identifyingReviewer.reviewedBy = '홍길동';
  expect(() => buildReviewedTranscriptGraph(identifyingReviewer)).toThrow('Invalid fixture reviewer alias');
});

test('creates and verifies a graph through the read-only CLI without overwriting evidence', () => {
  const directory = mkdtempSync(join(tmpdir(), 'transcript-ontology-'));
  const fixturePath = join(directory, 'fixture.json');
  const graphPath = join(directory, 'graph.json');
  const modulePath = fileURLToPath(new URL('../transcript-ontology-fixture.mjs', import.meta.url));
  try {
    writeFileSync(fixturePath, JSON.stringify(FIXTURE));
    const created = spawnSync(process.execPath, [modulePath, '--fixture', fixturePath, '--output-graph', graphPath], {
      encoding: 'utf8',
    });
    expect(created.status).toBe(0);
    expect(JSON.parse(readFileSync(graphPath, 'utf8')).meta.publication_status).toBe('internal_reviewed_fixture');

    const verified = spawnSync(process.execPath, [modulePath, '--fixture', fixturePath, '--verify-graph', graphPath], {
      encoding: 'utf8',
    });
    expect(verified.status).toBe(0);
    expect(JSON.parse(verified.stdout)).toMatchObject({ nodeCount: 2, edgeCount: 1, databaseMutationExecuted: false });

    const overwrite = spawnSync(process.execPath, [modulePath, '--fixture', fixturePath, '--output-graph', graphPath], {
      encoding: 'utf8',
    });
    expect(overwrite.status).toBe(1);
    expect(overwrite.stderr).toContain('Output already exists');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('publishes and verifies an approved synthetic live graph through the CLI', () => {
  const directory = mkdtempSync(join(tmpdir(), 'transcript-ontology-live-'));
  const fixturePath = join(directory, 'fixture.json');
  const modulePath = fileURLToPath(new URL('../transcript-ontology-fixture.mjs', import.meta.url));
  const livePath = fileURLToPath(new URL(
    `../../public/workshop-graph/data/live-r1-test-${process.pid}.json`,
    import.meta.url,
  ));
  try {
    writeFileSync(fixturePath, JSON.stringify(LIVE_FIXTURE));
    const published = spawnSync(process.execPath, [
      modulePath,
      '--fixture', fixturePath,
      '--output-live-graph', livePath,
    ], { encoding: 'utf8' });
    expect(published.status).toBe(0);
    expect(JSON.parse(published.stdout)).toMatchObject({
      nodeCount: 2,
      edgeCount: 1,
      publicGraphWritten: true,
      databaseMutationExecuted: false,
    });
    expect(JSON.parse(readFileSync(livePath, 'utf8')).meta.live).toBe(true);

    const verified = spawnSync(process.execPath, [
      modulePath,
      '--fixture', fixturePath,
      '--verify-live-graph', livePath,
    ], { encoding: 'utf8' });
    expect(verified.status).toBe(0);
    expect(JSON.parse(verified.stdout)).toMatchObject({ publicGraphVerified: true });
  } finally {
    try {
      unlinkSync(livePath);
    } catch (error) {
      if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw error;
    }
    rmSync(directory, { recursive: true, force: true });
  }
});

test('refuses public live export without explicit synthetic publication approval', () => {
  expect(() => buildLiveTranscriptGraph(FIXTURE)).toThrow('publication approval is required');

  const early = structuredClone(LIVE_FIXTURE);
  early.publication.approvedAt = LIVE_FIXTURE.reviewedAt;
  expect(() => buildLiveTranscriptGraph(early)).toThrow('must follow fixture review');
});

test('refuses live output outside the exact public graph data contract', () => {
  const directory = mkdtempSync(join(tmpdir(), 'transcript-ontology-live-path-'));
  const fixturePath = join(directory, 'fixture.json');
  const outputPath = join(directory, 'live-outside.json');
  const modulePath = fileURLToPath(new URL('../transcript-ontology-fixture.mjs', import.meta.url));
  try {
    writeFileSync(fixturePath, JSON.stringify(LIVE_FIXTURE));
    const result = spawnSync(process.execPath, [
      modulePath,
      '--fixture', fixturePath,
      '--output-live-graph', outputPath,
    ], { encoding: 'utf8' });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('public/workshop-graph/data');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('refuses to write reviewed transcript fixtures into the public graph tree', () => {
  const directory = mkdtempSync(join(tmpdir(), 'transcript-ontology-public-'));
  const fixturePath = join(directory, 'fixture.json');
  const modulePath = fileURLToPath(new URL('../transcript-ontology-fixture.mjs', import.meta.url));
  const publicPath = fileURLToPath(new URL(`../../public/r0-transcript-${process.pid}.json`, import.meta.url));
  try {
    writeFileSync(fixturePath, JSON.stringify(FIXTURE));
    const result = spawnSync(process.execPath, [modulePath, '--fixture', fixturePath, '--output-graph', publicPath], {
      encoding: 'utf8',
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('must not be written under public');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('refuses a junction that resolves into the public graph tree', () => {
  const directory = mkdtempSync(join(tmpdir(), 'transcript-ontology-junction-'));
  const fixturePath = join(directory, 'fixture.json');
  const junctionPath = join(directory, 'public-junction');
  const modulePath = fileURLToPath(new URL('../transcript-ontology-fixture.mjs', import.meta.url));
  const publicRoot = fileURLToPath(new URL('../../public/', import.meta.url));
  try {
    writeFileSync(fixturePath, JSON.stringify(FIXTURE));
    symlinkSync(publicRoot, junctionPath, 'junction');
    const result = spawnSync(process.execPath, [
      modulePath,
      '--fixture', fixturePath,
      '--output-graph', join(junctionPath, `r0-transcript-${process.pid}.json`),
    ], { encoding: 'utf8' });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('must not be written under public');
  } finally {
    if (junctionPath) {
      try {
        unlinkSync(junctionPath);
      } catch (error) {
        if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw error;
      }
    }
    rmSync(directory, { recursive: true, force: true });
  }
});
