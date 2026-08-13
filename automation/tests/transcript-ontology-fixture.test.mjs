import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
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
  buildPublishedTranscriptReviewGraph,
  buildReviewedTranscriptBundleReport,
  buildReviewedTranscriptGraph,
  reviewedTranscriptPlanSha256,
  verifyLiveTranscriptGraph,
  verifyPublishedTranscriptReviewGraph,
  verifyReviewedTranscriptBundleReport,
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

const R2_FIXTURE_TEXT = readFileSync(
  fileURLToPath(new URL('../fixtures/transcript-ontology-review-candidates.example.json', import.meta.url)),
  'utf8',
);
const R2_FIXTURE = JSON.parse(R2_FIXTURE_TEXT);

function reviewedR2Plan() {
  const fixtureSha256 = createHash('sha256').update(R2_FIXTURE_TEXT, 'utf8').digest('hex');
  return {
    schemaVersion: 1,
    kind: 'transcript-ontology-reviewed-plan',
    dryRun: true,
    databaseMutationExecuted: false,
    publicGraphWritten: false,
    requiresPublicationReview: true,
    source: {
      fixtureId: R2_FIXTURE.fixtureId,
      sessionId: R2_FIXTURE.sessionId,
      language: R2_FIXTURE.language,
      reviewedBy: R2_FIXTURE.reviewedBy,
      reviewedAt: R2_FIXTURE.reviewedAt,
      fixtureSha256,
    },
    nodes: R2_FIXTURE.expected.nodes.map((node, index) => ({
      id: `transcript-node:${node.uid}`,
      sourceUid: node.uid,
      kindCandidate: node.kind,
      kind: node.kind,
      sourceLabel: node.label,
      sourceText: node.text,
      label: index === 0 ? `${node.label} 검수본` : node.label,
      text: node.text,
      citedUids: node.citedUids,
      transcript: node.citedUids.map((uid) => R2_FIXTURE.chunks.find((chunk) => chunk.uid === uid)),
      reviewStatus: index === 0 ? 'edited' : 'accepted',
      reviewer: 'moderator-r2-test',
      reviewedAt: '2026-08-01T01:10:00.000Z',
    })),
    relations: R2_FIXTURE.expected.relations.map((relation) => ({
      id: `transcript-edge:${relation.uid}`,
      sourceUid: relation.uid,
      source: `transcript-node:${relation.sourceUid}`,
      target: `transcript-node:${relation.targetUid}`,
      relationCandidate: relation.relation,
      relation: relation.relation,
      citedUids: relation.citedUids,
      transcript: relation.citedUids.map((uid) => R2_FIXTURE.chunks.find((chunk) => chunk.uid === uid)),
      reviewStatus: 'accepted',
      reviewer: 'moderator-r2-test',
      reviewedAt: '2026-08-01T01:11:00.000Z',
    })),
  };
}

test('publishes only accepted R2 review items with reviewed state and cited chunk details', () => {
  const plan = reviewedR2Plan();
  plan.nodes[1].reviewStatus = 'rejected';
  plan.nodes[1].kind = null;
  plan.nodes[1].reviewer = 'moderator-r2-test';
  plan.relations[0].reviewStatus = 'rejected';
  plan.relations[0].relation = null;
  const graph = buildPublishedTranscriptReviewGraph({
    fixtureText: R2_FIXTURE_TEXT,
    reviewedPlan: plan,
    publication: {
      schemaVersion: 1,
      kind: 'transcript-ontology-publication-approval',
      mode: 'synthetic-reviewed-demo',
      sourceId: 'live-transcript-r2-reviewed',
      reviewedPlanSha256: reviewedTranscriptPlanSha256(plan),
      approvedBy: 'reviewer-test',
      approvedAt: '2026-08-01T01:20:00.000Z',
    },
  });

  expect(graph.elements.nodes).toHaveLength(1);
  expect(graph.elements.edges).toHaveLength(0);
  expect(graph.elements.nodes[0].data).toMatchObject({
    id: 'transcript-node:candidate-issue',
    label: '재생에너지 전환 속도 검수본',
    review_state: 'edited',
    is_public: true,
    cited_uids: ['chunk-001', 'chunk-002'],
    meta: { review_identity_kind: 'synthetic_fixture' },
  });
  expect(graph.meta).toMatchObject({
    variant: 'transcript-live-reviewed-plan',
    publication_status: 'synthetic_reviewed_demo',
    source_review_status: 'reviewed',
    dropped: { rejected_nodes: 1, rejected_edges: 1, uncited_candidates: 0 },
  });
  expect(JSON.stringify(graph)).not.toContain('speakerLabelPseudonym');
  expect(JSON.stringify(graph)).not.toContain('startMs');
});

test('keeps an authenticated reviewer ID in the private plan but redacts it from the public graph', () => {
  const plan = reviewedR2Plan();
  const reviewer = 'auth-user:00000000-0000-4000-8000-000000000091';
  for (const item of [...plan.nodes, ...plan.relations]) item.reviewer = reviewer;
  const graph = buildPublishedTranscriptReviewGraph({
    fixtureText: R2_FIXTURE_TEXT,
    reviewedPlan: plan,
    publication: {
      schemaVersion: 1,
      kind: 'transcript-ontology-publication-approval',
      mode: 'synthetic-reviewed-demo',
      sourceId: 'live-transcript-r2-reviewed',
      reviewedPlanSha256: reviewedTranscriptPlanSha256(plan),
      approvedBy: 'reviewer-test',
      approvedAt: '2026-08-01T01:20:00.000Z',
    },
  });

  expect(JSON.stringify(plan)).toContain(reviewer);
  expect(JSON.stringify(graph)).not.toContain(reviewer);
  expect(graph.elements.nodes.every((node) => (
    node.data.meta.review_identity_kind === 'authenticated_user'
  ))).toBe(true);
  expect(graph.elements.edges.every((edge) => (
    edge.data.meta.review_identity_kind === 'authenticated_user'
  ))).toBe(true);
});

test('accepts an authenticated publication approver but redacts the UUID from the public graph', () => {
  const plan = reviewedR2Plan();
  const approvedBy = 'auth-user:00000000-0000-4000-8000-000000000092';
  const graph = buildPublishedTranscriptReviewGraph({
    fixtureText: R2_FIXTURE_TEXT,
    reviewedPlan: plan,
    publication: {
      schemaVersion: 1,
      kind: 'transcript-ontology-publication-approval',
      mode: 'synthetic-reviewed-demo',
      sourceId: 'live-transcript-r2-reviewed',
      reviewedPlanSha256: reviewedTranscriptPlanSha256(plan),
      approvedBy,
      approvedAt: '2026-08-01T01:20:00.000Z',
    },
  });

  expect(JSON.stringify(graph)).not.toContain(approvedBy);
  expect(graph.meta.publication.approved_identity_kind).toBe('authenticated_user');
  expect(graph.elements.nodes.every((node) => (
    node.data.meta.publication_identity_kind === 'authenticated_user'
  ))).toBe(true);
  expect(graph.elements.edges.every((edge) => (
    edge.data.meta.publication_identity_kind === 'authenticated_user'
  ))).toBe(true);
});

test('rejects an arbitrary publication approver identity', () => {
  const plan = reviewedR2Plan();
  expect(() => buildPublishedTranscriptReviewGraph({
    fixtureText: R2_FIXTURE_TEXT,
    reviewedPlan: plan,
    publication: {
      schemaVersion: 1,
      kind: 'transcript-ontology-publication-approval',
      mode: 'synthetic-reviewed-demo',
      sourceId: 'live-transcript-r2-reviewed',
      reviewedPlanSha256: reviewedTranscriptPlanSha256(plan),
      approvedBy: 'release-manager-1',
      approvedAt: '2026-08-01T01:20:00.000Z',
    },
  })).toThrow('Invalid publication reviewer identity');
});

test('rejects an R2 plan changed after publication approval', () => {
  const plan = reviewedR2Plan();
  const publication = {
    schemaVersion: 1,
    kind: 'transcript-ontology-publication-approval',
    mode: 'synthetic-reviewed-demo',
    sourceId: 'live-transcript-r2-reviewed',
    reviewedPlanSha256: reviewedTranscriptPlanSha256(plan),
    approvedBy: 'reviewer-test',
    approvedAt: '2026-08-01T01:20:00.000Z',
  };
  plan.nodes[0].label = '승인 뒤 바뀐 표시명';

  expect(() => buildPublishedTranscriptReviewGraph({
    fixtureText: R2_FIXTURE_TEXT,
    reviewedPlan: plan,
    publication,
  })).toThrow('Publication approval does not match the reviewed plan');
});

test('rejects a reviewed plan that duplicates one item while omitting another', () => {
  const plan = reviewedR2Plan();
  plan.nodes[1] = structuredClone(plan.nodes[0]);
  const publication = {
    schemaVersion: 1,
    kind: 'transcript-ontology-publication-approval',
    mode: 'synthetic-reviewed-demo',
    sourceId: 'live-transcript-r2-reviewed',
    reviewedPlanSha256: reviewedTranscriptPlanSha256(plan),
    approvedBy: 'reviewer-test',
    approvedAt: '2026-08-01T01:20:00.000Z',
  };

  expect(() => buildPublishedTranscriptReviewGraph({
    fixtureText: R2_FIXTURE_TEXT,
    reviewedPlan: plan,
    publication,
  })).toThrow('Reviewed plan item set does not match its transcript fixture');
});

test('rejects arbitrary reviewed plan identities while retaining the explicit synthetic alias', () => {
  const plan = reviewedR2Plan();
  const publication = {
    schemaVersion: 1,
    kind: 'transcript-ontology-publication-approval',
    mode: 'synthetic-reviewed-demo',
    sourceId: 'live-transcript-r2-reviewed',
    approvedBy: 'reviewer-test',
    approvedAt: '2026-08-01T01:20:00.000Z',
  };
  plan.nodes[0].reviewer = 'moderator-role-1';
  publication.reviewedPlanSha256 = reviewedTranscriptPlanSha256(plan);

  expect(() => buildPublishedTranscriptReviewGraph({
    fixtureText: R2_FIXTURE_TEXT,
    reviewedPlan: plan,
    publication,
  })).toThrow('Invalid reviewed plan reviewer');
});

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
      approved_identity_kind: 'synthetic_fixture',
      approved_at: '2026-08-29T01:05:00.000Z',
    },
  });
  expect(JSON.stringify(graph)).not.toContain('speakerLabelPseudonym');
  expect(JSON.stringify(graph)).not.toContain('startMs');
  expect(JSON.stringify(graph)).not.toContain('endMs');
  expect(JSON.stringify(graph)).not.toContain(FIXTURE.reviewedBy);
  expect(graph.elements.nodes.every((node) => (
    node.data.meta.review_identity_kind === 'synthetic_fixture'
  ))).toBe(true);
  expect(verifyLiveTranscriptGraph({ fixture: LIVE_FIXTURE, graph })).toMatchObject({
    nodeCount: 2,
    edgeCount: 1,
    publicGraphVerified: true,
    databaseMutationExecuted: false,
  });
});

test('redacts an authenticated approver from the direct live fixture graph', () => {
  const approvedBy = 'auth-user:00000000-0000-4000-8000-000000000092';
  const graph = buildLiveTranscriptGraph({
    ...structuredClone(LIVE_FIXTURE),
    publication: { ...LIVE_FIXTURE.publication, approvedBy },
  });

  expect(JSON.stringify(graph)).not.toContain(approvedBy);
  expect(graph.meta.publication.approved_identity_kind).toBe('authenticated_user');
  expect(graph.elements.nodes.every((node) => (
    node.data.meta.publication_identity_kind === 'authenticated_user'
  ))).toBe(true);
  expect(graph.elements.edges.every((edge) => (
    edge.data.meta.publication_identity_kind === 'authenticated_user'
  ))).toBe(true);
});

test('rejects an arbitrary approver from the direct live fixture graph', () => {
  expect(() => buildLiveTranscriptGraph({
    ...structuredClone(LIVE_FIXTURE),
    publication: { ...LIVE_FIXTURE.publication, approvedBy: 'release-manager-1' },
  })).toThrow('Invalid publication reviewer identity');
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

test('binds the tracked R2 live graph to its exact fixture, reviewed plan, and approval', () => {
  const manifest = JSON.parse(readFileSync(
    fileURLToPath(new URL('../../public/workshop-graph/sources.json', import.meta.url)),
    'utf8',
  ));
  const reviewedPlan = JSON.parse(readFileSync(
    fileURLToPath(new URL('../fixtures/transcript-ontology-reviewed-plan.example.json', import.meta.url)),
    'utf8',
  ));
  const publication = JSON.parse(readFileSync(
    fileURLToPath(new URL('../fixtures/transcript-ontology-publication-approval.example.json', import.meta.url)),
    'utf8',
  ));
  const graph = JSON.parse(readFileSync(
    fileURLToPath(new URL('../../public/workshop-graph/data/live-transcript-r2-reviewed.json', import.meta.url)),
    'utf8',
  ));

  expect(verifyPublishedTranscriptReviewGraph({
    fixtureText: R2_FIXTURE_TEXT,
    reviewedPlan,
    publication,
    graph,
  })).toMatchObject({
    publicGraphVerified: true,
    nodeCount: 2,
    edgeCount: 1,
    dropped: { rejected_nodes: 0, rejected_edges: 0, uncited_candidates: 0 },
  });
  expect(manifest.sources.find((source) => source.id === 'live-transcript-r2-reviewed')).toMatchObject({
    category: 'live',
    label: '합성 전사 R2 사람 검수 결과 (실제 회의 아님)',
    data: 'data/live-transcript-r2-reviewed.json',
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
    await page.goto(
      `http://127.0.0.1:${address.port}/workshop-graph/?source=live-transcript-r2-reviewed`,
      { waitUntil: 'domcontentloaded' },
    );
    await page.waitForFunction(() => document.querySelector('#og-stat')?.textContent?.includes('노드 2'));
    expect(await page.locator('#og-source').inputValue()).toBe('live-transcript-r2-reviewed');
    expect(await page.locator('#og-source option:checked').textContent()).toContain('사람 검수 결과');
    await page.locator('[data-node-id="transcript-node:candidate-issue"]').first().click();
    await expect.poll(() => page.locator('#og-side').textContent()).toContain('chunk-001');
    expect(await page.locator('#og-side').textContent()).toContain('chunk-002');
    expect(await page.locator('#og-advisory').textContent()).toContain('합성 전사 사람 검수 결과');
    expect(pageErrors).toEqual([]);
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}, 15_000);

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
  expect(() => buildReviewedTranscriptGraph(identifyingReviewer)).toThrow('Invalid fixture reviewer identity');
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

test('publishes and verifies an approved R2 reviewed plan through the CLI', () => {
  const directory = mkdtempSync(join(tmpdir(), 'transcript-ontology-r3-'));
  const fixturePath = join(directory, 'fixture.json');
  const planPath = join(directory, 'plan.json');
  const publicationPath = join(directory, 'publication.json');
  const modulePath = fileURLToPath(new URL('../transcript-ontology-fixture.mjs', import.meta.url));
  const sourceId = `live-r3-test-${process.pid}`;
  const livePath = fileURLToPath(new URL(`../../public/workshop-graph/data/${sourceId}.json`, import.meta.url));
  const publicPreviewPath = fileURLToPath(new URL(
    `../../public/workshop-graph/data/${sourceId}.preview.json`,
    import.meta.url,
  ));
  const previewPath = join(directory, `${sourceId}.preview.json`);
  const plan = reviewedR2Plan();
  const publication = {
    schemaVersion: 1,
    kind: 'transcript-ontology-publication-approval',
    mode: 'synthetic-reviewed-demo',
    sourceId,
    reviewedPlanSha256: reviewedTranscriptPlanSha256(plan),
    approvedBy: 'reviewer-test',
    approvedAt: '2026-08-01T01:20:00.000Z',
  };
  try {
    writeFileSync(fixturePath, R2_FIXTURE_TEXT);
    writeFileSync(planPath, JSON.stringify(plan));
    writeFileSync(publicationPath, JSON.stringify(publication));
    const common = [
      modulePath,
      '--fixture', fixturePath,
      '--reviewed-plan', planPath,
      '--publication', publicationPath,
    ];
    const previewed = spawnSync(process.execPath, [
      ...common,
      '--output-reviewed-preview', previewPath,
    ], { encoding: 'utf8' });
    expect(previewed.status).toBe(0);
    expect(JSON.parse(previewed.stdout)).toMatchObject({
      nodeCount: 2,
      edgeCount: 1,
      publicGraphWritten: false,
      previewWritten: true,
      databaseMutationExecuted: false,
    });
    expect(JSON.parse(readFileSync(previewPath, 'utf8')).meta.source.source_id).toBe(sourceId);

    const previewVerified = spawnSync(process.execPath, [
      ...common,
      '--verify-reviewed-preview', previewPath,
    ], { encoding: 'utf8' });
    expect(previewVerified.status).toBe(0);
    expect(JSON.parse(previewVerified.stdout)).toMatchObject({
      publicGraphVerified: true,
      publicGraphWritten: false,
      previewVerified: true,
    });

    const previewOverwrite = spawnSync(process.execPath, [
      ...common,
      '--output-reviewed-preview', previewPath,
    ], { encoding: 'utf8' });
    expect(previewOverwrite.status).toBe(1);
    expect(previewOverwrite.stderr).toContain('Output already exists');

    const publicPreview = spawnSync(process.execPath, [
      ...common,
      '--output-reviewed-preview', publicPreviewPath,
    ], { encoding: 'utf8' });
    expect(publicPreview.status).toBe(1);
    expect(publicPreview.stderr).toContain('must not be written or verified under public');

    const bypassedPreview = spawnSync(process.execPath, [
      ...common,
      '--output-reviewed-live-graph', livePath,
    ], { encoding: 'utf8' });
    expect(bypassedPreview.status).toBe(1);
    expect(bypassedPreview.stderr).toContain('requires exactly one --reviewed-preview input');

    const published = spawnSync(process.execPath, [
      ...common,
      '--reviewed-preview', previewPath,
      '--output-reviewed-live-graph', livePath,
    ], { encoding: 'utf8' });
    expect(published.status).toBe(0);
    expect(JSON.parse(published.stdout)).toMatchObject({
      nodeCount: 2,
      edgeCount: 1,
      publicGraphWritten: true,
      previewVerified: true,
      databaseMutationExecuted: false,
    });

    const verified = spawnSync(process.execPath, [
      ...common,
      '--verify-reviewed-live-graph', livePath,
    ], { encoding: 'utf8' });
    expect(verified.status).toBe(0);
    expect(JSON.parse(verified.stdout)).toMatchObject({ publicGraphVerified: true });

    const changedPreview = JSON.parse(readFileSync(previewPath, 'utf8'));
    changedPreview.elements.nodes[0].data.label = 'changed preview label';
    writeFileSync(previewPath, JSON.stringify(changedPreview));
    const changedPreviewVerification = spawnSync(process.execPath, [
      ...common,
      '--verify-reviewed-preview', previewPath,
    ], { encoding: 'utf8' });
    expect(changedPreviewVerification.status).toBe(1);
    expect(changedPreviewVerification.stderr).toContain('does not match its approved plan');
    const changedPreviewPromotion = spawnSync(process.execPath, [
      ...common,
      '--reviewed-preview', previewPath,
      '--output-reviewed-live-graph', livePath,
    ], { encoding: 'utf8' });
    expect(changedPreviewPromotion.status).toBe(1);
    expect(changedPreviewPromotion.stderr).toContain('does not match its approved plan');
  } finally {
    try {
      unlinkSync(livePath);
    } catch (error) {
      if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw error;
    }
    try {
      unlinkSync(publicPreviewPath);
    } catch (error) {
      if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw error;
    }
    rmSync(directory, { recursive: true, force: true });
  }
});

test('writes and re-verifies a non-identifying report for an exact R4-to-R3 artifact bundle', () => {
  const directory = mkdtempSync(join(tmpdir(), 'transcript-ontology-bundle-'));
  const fixturePath = join(directory, 'handoff-fixture.json');
  const planPath = join(directory, 'reviewed-plan.json');
  const publicationPath = join(directory, 'publication.json');
  const reportPath = join(directory, 'bundle-report.json');
  const modulePath = fileURLToPath(new URL('../transcript-ontology-fixture.mjs', import.meta.url));
  const fixture = structuredClone(R2_FIXTURE);
  fixture.source = {
    kind: 'private-transcript-extraction-handoff',
    reviewBatchSha256: 'a'.repeat(64),
    captureId: 'capture-bundle-1',
    audioSha256: 'b'.repeat(64),
    candidateSetId: 'candidate-set-bundle-1',
  };
  const fixtureText = `${JSON.stringify(fixture, null, 2)}\n`;
  const plan = reviewedR2Plan();
  plan.source.fixtureSha256 = createHash('sha256').update(fixtureText, 'utf8').digest('hex');
  plan.source.handoff = fixture.source;
  const planText = `${JSON.stringify(plan, null, 2)}\n`;
  const publication = {
    schemaVersion: 1,
    kind: 'transcript-ontology-publication-approval',
    mode: 'synthetic-reviewed-demo',
    sourceId: 'live-r4-r3-bundle-test',
    reviewedPlanSha256: reviewedTranscriptPlanSha256(plan),
    approvedBy: 'reviewer-test',
    approvedAt: '2026-08-01T01:20:00.000Z',
  };
  const publicationText = `${JSON.stringify(publication, null, 2)}\n`;
  const publicReportPath = fileURLToPath(new URL(
    `../../public/workshop-graph/data/${publication.sourceId}.bundle-report.json`,
    import.meta.url,
  ));
  const reportInput = { fixtureText, reviewedPlanText: planText, publicationText };
  try {
    const report = buildReviewedTranscriptBundleReport(reportInput);
    expect(report).toMatchObject({
      kind: 'transcript-ontology-reviewed-bundle-report',
      binding: {
        sourceId: 'live-r4-r3-bundle-test',
        reviewBatchSha256: 'a'.repeat(64),
        candidateSetId: 'candidate-set-bundle-1',
      },
      counts: { nodes: 2, edges: 1 },
      safety: {
        databaseMutationExecuted: false,
        publicGraphWritten: false,
        bundleVerified: true,
      },
    });
    expect(JSON.stringify(report)).not.toContain(fixture.reviewedBy);
    expect(verifyReviewedTranscriptBundleReport({ ...reportInput, report })).toMatchObject({
      sourceId: 'live-r4-r3-bundle-test',
      bundleReportVerified: true,
      publicGraphWritten: false,
    });

    writeFileSync(fixturePath, fixtureText);
    writeFileSync(planPath, planText);
    writeFileSync(publicationPath, publicationText);
    const common = [
      modulePath,
      '--fixture', fixturePath,
      '--reviewed-plan', planPath,
      '--publication', publicationPath,
    ];
    const written = spawnSync(process.execPath, [
      ...common,
      '--output-reviewed-bundle-report', reportPath,
    ], { encoding: 'utf8' });
    expect(written.status).toBe(0);
    expect(JSON.parse(written.stdout)).toMatchObject({
      sourceId: 'live-r4-r3-bundle-test',
      nodeCount: 2,
      edgeCount: 1,
      bundleReportWritten: true,
      databaseMutationExecuted: false,
      publicGraphWritten: false,
    });
    const overwrite = spawnSync(process.execPath, [
      ...common,
      '--output-reviewed-bundle-report', reportPath,
    ], { encoding: 'utf8' });
    expect(overwrite.status).toBe(1);
    expect(overwrite.stderr).toContain('Output already exists');
    const publicReport = spawnSync(process.execPath, [
      ...common,
      '--output-reviewed-bundle-report', publicReportPath,
    ], { encoding: 'utf8' });
    expect(publicReport.status).toBe(1);
    expect(publicReport.stderr).toContain('bundle report must remain outside public');
    const verified = spawnSync(process.execPath, [
      ...common,
      '--verify-reviewed-bundle-report', reportPath,
    ], { encoding: 'utf8' });
    expect(verified.status).toBe(0);
    expect(JSON.parse(verified.stdout)).toMatchObject({
      sourceId: 'live-r4-r3-bundle-test',
      bundleReportVerified: true,
    });

    const changedReport = JSON.parse(readFileSync(reportPath, 'utf8'));
    changedReport.binding.reviewBatchSha256 = 'c'.repeat(64);
    writeFileSync(reportPath, JSON.stringify(changedReport));
    const changed = spawnSync(process.execPath, [
      ...common,
      '--verify-reviewed-bundle-report', reportPath,
    ], { encoding: 'utf8' });
    expect(changed.status).toBe(1);
    expect(changed.stderr).toContain('bundle report does not match its artifacts');
  } finally {
    try {
      unlinkSync(publicReportPath);
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
