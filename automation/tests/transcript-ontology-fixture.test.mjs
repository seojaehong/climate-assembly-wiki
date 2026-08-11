import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import {
  buildReviewedTranscriptGraph,
  verifyReviewedTranscriptGraph,
} from '../transcript-ontology-fixture.mjs';
import { createWorkshopGraphSourceAdapter } from '../../public/workshop-graph/graph-source-adapter.js';

const FIXTURE = JSON.parse(readFileSync(
  fileURLToPath(new URL('../fixtures/transcript-ontology-reviewed.example.json', import.meta.url)),
  'utf8',
));

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
