import { readFileSync } from 'node:fs';
import { describe, expect, test, vi } from 'vitest';
import {
  createWorkshopGraphSourceAdapter,
  liveGraphStatusPresentation,
} from '../public/workshop-graph/graph-source-adapter.js';

const STATIC_MANIFEST = {
  default: 'static-final',
  categories: { final: '최종 결과' },
  sources: [{
    id: 'static-final',
    category: 'final',
    label: '정적 최종 결과',
    data: 'data/static-final.json',
    supportsView: ['2d'],
  }],
  database: { endpoint: '/rest/v1/rpc/approved_graph_snapshots' },
};

const REVIEWED_LIVE_SOURCE = {
  id: 'live-reviewed',
  category: 'live',
  label: '검수 완료 live graph',
  data: 'data/live-reviewed.json',
  publicationMode: 'reviewed_snapshot',
  supportsView: ['2d'],
  polling_default_sec: 15,
};

function reviewedLiveSnapshot() {
  return {
    elements: {
      nodes: [{ data: {
        id: 'issue-1', kind: 'Issue', label: '검수 완료 쟁점', cited_uids: ['chunk-1'],
        review_state: 'accepted', is_public: true,
      } }],
      edges: [],
    },
    meta: {
      live: true,
      publication_status: 'synthetic_reviewed_demo',
      source_review_status: 'reviewed',
      requires_publication_review: false,
      counts: { nodes: 1, edges: 0 },
      source: { source_id: REVIEWED_LIVE_SOURCE.id },
      publication: {
        mode: 'synthetic-reviewed-demo',
        approved_identity_kind: 'synthetic_fixture',
        approved_at: '2026-08-14T01:00:00.000Z',
      },
    },
  };
}

function jsonResponse(data, ok = true) {
  return { ok, status: ok ? 200 : 503, json: async () => data };
}

describe('workshop graph source adapter', () => {
  test('keeps the static catalog when the optional database catalog fails', async () => {
    const onError = vi.fn();
    const fetchImpl = vi.fn(async (url) => {
      if (url === 'sources.json') return jsonResponse(STATIC_MANIFEST);
      return jsonResponse({ message: 'unavailable' }, false);
    });
    const adapter = createWorkshopGraphSourceAdapter({ fetchImpl, onError, retryDelayMs: 0 });

    const catalog = await adapter.loadCatalog('sources.json');

    expect(catalog.manifest.default).toBe('static-final');
    expect(catalog.manifest.sources).toEqual(STATIC_MANIFEST.sources);
    expect(catalog.databaseAvailable).toBe(false);
    expect(onError).toHaveBeenCalledOnce();
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  test('adds only approved public database snapshots and reports graph provenance gaps', async () => {
    const approvedSnapshot = {
      elements: {
        nodes: [
          { data: {
            id: 'issue-1', kind: 'Issue', label: '검수된 쟁점', cited_uids: ['item-1'],
            review_state: 'accepted', is_public: true,
          } },
          { data: {
            id: 'claim-1', kind: 'Claim', label: '출처 확인이 필요한 주장', cited_uids: ['   '],
            review_state: 'edited', is_public: true,
          } },
        ],
        edges: [{ data: {
          id: 'edge-1', source: 'claim-1', target: 'issue-1', rel: 'isAbout',
          review_state: 'accepted', is_public: true,
        } }],
      },
      meta: { advisory_notice: '사람 검수 완료 snapshot' },
    };
    const databaseCatalog = {
      sources: [
        {
          id: 'approved-1', label: 'DB 승인 snapshot', review_state: 'approved', is_public: true,
          row_count: 1, snapshot: approvedSnapshot,
        },
        {
          id: 'draft-1', label: 'DB 초안', review_state: 'proposed', is_public: false,
          row_count: 1, snapshot: approvedSnapshot,
        },
      ],
    };
    const fetchImpl = vi.fn(async (url) => {
      if (url === 'sources.json') return jsonResponse(STATIC_MANIFEST);
      if (url === '/rest/v1/rpc/approved_graph_snapshots') return jsonResponse(databaseCatalog);
      throw new Error('Unexpected request');
    });
    const adapter = createWorkshopGraphSourceAdapter({ fetchImpl, retryDelayMs: 0 });

    const catalog = await adapter.loadCatalog('sources.json');
    const dbSource = catalog.manifest.sources.find((source) => source.id === 'db:approved-1');
    const loaded = await adapter.loadSource(dbSource);

    expect(catalog.databaseAvailable).toBe(true);
    expect(catalog.manifest.categories.database).toBe('승인된 DB 스냅샷');
    expect(catalog.manifest.sources.map((source) => source.id)).toEqual(['static-final', 'db:approved-1']);
    expect(dbSource).toEqual({
      id: 'db:approved-1',
      category: 'database',
      label: 'DB 승인 snapshot',
      adapter: 'database',
      supportsView: ['2d'],
    });
    expect(loaded.payload).toEqual(approvedSnapshot);
    expect(loaded.diagnostics).toEqual({
      origin: 'database',
      rowCount: 1,
      nodeCount: 2,
      edgeCount: 1,
      missingCitedNodeIds: ['claim-1'],
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  test('loads the static graph fallback with the same diagnostics contract', async () => {
    const manifest = { ...STATIC_MANIFEST };
    delete manifest.database;
    const staticSnapshot = {
      elements: {
        nodes: [{ data: { id: 'static-node', kind: 'Issue', label: '정적 노드', cited: ['source-1'] } }],
        edges: [],
      },
      meta: { counts: { nodes: 1, edges: 0 } },
    };
    const fetchImpl = vi.fn(async (url) => {
      if (url === 'sources.json') return jsonResponse(manifest);
      if (url === 'data/static-final.json?_=1234') return jsonResponse(staticSnapshot);
      throw new Error('Unexpected request');
    });
    const adapter = createWorkshopGraphSourceAdapter({ fetchImpl, now: () => 1234, retryDelayMs: 0 });

    const catalog = await adapter.loadCatalog('sources.json');
    const loaded = await adapter.loadSource(catalog.manifest.sources[0]);

    expect(catalog.databaseAvailable).toBe(false);
    expect(loaded).toEqual({
      payload: staticSnapshot,
      diagnostics: {
        origin: 'static',
        rowCount: null,
        nodeCount: 1,
        edgeCount: 0,
        missingCitedNodeIds: [],
      },
    });
  });

  test('wires catalog fallback, actual counts, and provenance warnings into the production graph surface', () => {
    const html = readFileSync('public/workshop-graph/index.html', 'utf8');
    const chrome = readFileSync('public/_ontology-chrome/chrome.js', 'utf8');

    expect(html).toContain("import { createWorkshopGraphSourceAdapter, liveGraphStatusPresentation } from './graph-source-adapter.js';");
    expect(html).toContain("await graphSourceAdapter.loadCatalog('sources.json')");
    expect(html).toContain('await graphSourceAdapter.loadSource(meta)');
    expect(html).toContain('safelyLoadSource(curSource)');
    expect(html).toContain('reportGraphLoadFailure');
    expect(html).toContain('새 source 로드 실패');
    expect(html).toContain('sourceLoadGeneration += 1');
    expect(html).toContain('() => sourceLoadGeneration === generation');
    expect(html).toContain('if (!isCurrent()) return false');
    expect(html).toContain('function stopPolling()');
    expect(html).toContain('pollTimer = setTimeout(async () =>');
    expect(html).toContain('await safelyLoadSource(meta.id)');
    expect(html).toContain("if (restoredMeta?.category === 'live') setupPolling(restoredMeta, false)");
    expect(html).toContain('const liveStatus = isLive ? liveGraphStatusPresentation(mt) : null');
    expect(html).toContain('displayedSourceState = captureSourceState()');
    expect(html).toContain('restoreSourceState(displayedSourceState)');
    expect(html).toContain('diagnostics.rowCount');
    expect(html).toContain('diagnostics.nodeCount');
    expect(html).toContain('diagnostics.edgeCount');
    expect(html).toContain('diagnostics.missingCitedNodeIds.length');
    expect(html).toContain("s.adapter === 'database'");
    expect(chrome).toContain('id="og-stat" role="status" aria-live="polite" aria-atomic="true"');
    expect(chrome).toContain('id="og-advisory" role="status" aria-live="polite" aria-atomic="true"');
  });

  test('loads every current static graph source through the fallback contract', async () => {
    const manifest = JSON.parse(readFileSync('public/workshop-graph/sources.json', 'utf8'));
    const fetchImpl = vi.fn(async (url) => {
      if (url === 'sources.json') return jsonResponse(manifest);
      const path = String(url).replace(/\?_=[0-9]+$/, '');
      return jsonResponse(JSON.parse(readFileSync(`public/workshop-graph/${path}`, 'utf8')));
    });
    const adapter = createWorkshopGraphSourceAdapter({ fetchImpl, now: () => 1234, retryDelayMs: 0 });
    const catalog = await adapter.loadCatalog('sources.json');

    const loaded = await Promise.all(catalog.manifest.sources.map((source) => adapter.loadSource(source)));

    expect(loaded).toHaveLength(manifest.sources.length);
    for (const result of loaded) {
      expect(result.diagnostics.origin).toBe('static');
      expect(result.diagnostics.nodeCount).toBeGreaterThan(0);
      expect(result.diagnostics.edgeCount).toBeGreaterThanOrEqual(0);
    }
  });

  test('loads a manifest-declared reviewed live snapshot', async () => {
    const manifest = {
      default: REVIEWED_LIVE_SOURCE.id,
      categories: { live: '실시간' },
      sources: [REVIEWED_LIVE_SOURCE],
    };
    const snapshot = reviewedLiveSnapshot();
    const fetchImpl = vi.fn(async (url) => {
      if (url === 'sources.json') return jsonResponse(manifest);
      if (url === 'data/live-reviewed.json?_=1234') return jsonResponse(snapshot);
      throw new Error('Unexpected request');
    });
    const adapter = createWorkshopGraphSourceAdapter({ fetchImpl, now: () => 1234, retryDelayMs: 0 });

    const catalog = await adapter.loadCatalog('sources.json');
    const loaded = await adapter.loadSource(catalog.manifest.sources[0]);

    expect(loaded.payload).toEqual(snapshot);
    expect(loaded.diagnostics).toEqual({
      origin: 'static', rowCount: null, nodeCount: 1, edgeCount: 0, missingCitedNodeIds: [],
    });
  });

  test('rejects a live source without an explicit reviewed-snapshot manifest contract', async () => {
    const source = { ...REVIEWED_LIVE_SOURCE };
    delete source.publicationMode;
    const manifest = {
      default: source.id,
      categories: { live: '실시간' },
      sources: [source],
    };
    const fetchImpl = vi.fn(async () => jsonResponse(manifest));
    const adapter = createWorkshopGraphSourceAdapter({ fetchImpl, retryDelayMs: 0 });

    await expect(adapter.loadCatalog('sources.json')).rejects.toThrow(
      'Live graph source must declare reviewed snapshot publication',
    );
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  test.each([
    ['external data URL', (source) => { source.data = 'https://example.com/live.json'; }, 'Invalid static graph source path'],
    ['parent data path', (source) => { source.data = '../private/transcript.json'; }, 'Invalid static graph source path'],
    ['mismatched live filename', (source) => { source.data = 'data/live-other.json'; }, 'Invalid live graph source contract'],
    ['missing 2d view', (source) => { source.supportsView = ['3d']; }, 'Invalid static graph source views'],
    ['duplicate view', (source) => { source.supportsView = ['2d', '2d']; }, 'Invalid static graph source views'],
    ['unsupported view', (source) => { source.supportsView = ['2d', 'table']; }, 'Invalid static graph source views'],
    ['zero poll interval', (source) => { source.polling_default_sec = 0; }, 'Invalid live graph source contract'],
    ['nonboolean menu state', (source) => { source.menu = 'true'; }, 'Invalid static graph source menu state'],
  ])('rejects a live manifest with %s', async (_caseName, mutate, message) => {
    const source = { ...REVIEWED_LIVE_SOURCE, polling_default_sec: 15 };
    mutate(source);
    const manifest = {
      default: source.id,
      categories: { live: '검수 완료 스냅샷' },
      sources: [source],
    };
    const fetchImpl = vi.fn(async () => jsonResponse(manifest));
    const adapter = createWorkshopGraphSourceAdapter({ fetchImpl, retryDelayMs: 0 });

    await expect(adapter.loadCatalog('sources.json')).rejects.toThrow(message);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  test('uses a neutral reviewed-snapshot category for synthetic and ordinary live sources', () => {
    const manifest = JSON.parse(readFileSync('public/workshop-graph/sources.json', 'utf8'));
    const liveSources = manifest.sources.filter((source) => source.category === 'live');

    expect(manifest.categories.live).toBe('검수 완료 스냅샷');
    expect(liveSources.length).toBeGreaterThan(0);
    expect(liveSources.every((source) => source.publicationMode === 'reviewed_snapshot')).toBe(true);
  });

  test('distinguishes synthetic and ordinary reviewed snapshot presentation states', () => {
    const synthetic = reviewedLiveSnapshot().meta;
    const reviewed = structuredClone(synthetic);
    reviewed.publication_status = 'reviewed_snapshot';
    reviewed.publication.mode = 'reviewed-snapshot';
    const draft = structuredClone(reviewed);
    draft.source_review_status = 'draft';

    expect(liveGraphStatusPresentation(synthetic)).toEqual({
      reviewed: true,
      advisoryFallback: '합성 전사 검수 데모 · 실제 시민 발언 아님',
      footerSummary: '합성 전사 검수 데모 · 실제 시민 발언 아님',
      pillText: 'LIVE · 검수 완료',
    });
    expect(liveGraphStatusPresentation(reviewed)).toEqual({
      reviewed: true,
      advisoryFallback: '사람 검수 완료 스냅샷',
      footerSummary: '사람 검수 완료 스냅샷',
      pillText: 'LIVE · 검수 완료',
    });
    expect(liveGraphStatusPresentation(draft)).toMatchObject({
      reviewed: false,
      advisoryFallback: '🔴 LIVE 미검증 초안 · 시민 비노출',
      pillText: 'LIVE · 미검수',
    });
  });

  test.each([
    ['private node', (snapshot) => { snapshot.elements.nodes[0].data.is_public = false; }],
    ['unreviewed node', (snapshot) => { snapshot.elements.nodes[0].data.review_state = 'proposed'; }],
    ['private edge', (snapshot) => {
      snapshot.elements.nodes.push({ data: {
        id: 'claim-1', kind: 'Claim', label: '주장', review_state: 'accepted', is_public: true,
      } });
      snapshot.elements.edges.push({ data: {
        id: 'edge-1', source: 'claim-1', target: 'issue-1', rel: 'isAbout',
        review_state: 'accepted', is_public: false,
      } });
      snapshot.meta.counts = { nodes: 2, edges: 1 };
    }],
    ['unreviewed edge', (snapshot) => {
      snapshot.elements.nodes.push({ data: {
        id: 'claim-1', kind: 'Claim', label: '주장', review_state: 'accepted', is_public: true,
      } });
      snapshot.elements.edges.push({ data: {
        id: 'edge-1', source: 'claim-1', target: 'issue-1', rel: 'isAbout',
        review_state: 'proposed', is_public: true,
      } });
      snapshot.meta.counts = { nodes: 2, edges: 1 };
    }],
    ['draft source status', (snapshot) => { snapshot.meta.source_review_status = 'draft'; }],
    ['pending publication review', (snapshot) => { snapshot.meta.requires_publication_review = true; }],
    ['mismatched publication mode', (snapshot) => { snapshot.meta.publication.mode = 'reviewed-snapshot'; }],
    ['noncanonical approval time', (snapshot) => { snapshot.meta.publication.approved_at = '2026-08-14T01:00:00Z'; }],
    ['mismatched source identity', (snapshot) => { snapshot.meta.source.source_id = 'live-other'; }],
    ['mismatched element counts', (snapshot) => { snapshot.meta.counts.nodes = 2; }],
    ['missing node provenance', (snapshot) => { snapshot.elements.nodes[0].data.cited_uids = []; }],
    ['blank node provenance', (snapshot) => { snapshot.elements.nodes[0].data.cited_uids = ['   ']; }],
    ['noncanonical node provenance', (snapshot) => { snapshot.elements.nodes[0].data.cited_uids = [' chunk-1']; }],
    ['duplicate node provenance', (snapshot) => { snapshot.elements.nodes[0].data.cited_uids = ['chunk-1', 'chunk-1']; }],
    ['invalid moderator-created marker', (snapshot) => { snapshot.elements.nodes[0].data.moderator_created = 'true'; }],
    ['missing edge provenance', (snapshot) => {
      snapshot.elements.nodes.push({ data: {
        id: 'claim-1', kind: 'Claim', label: '주장', cited_uids: ['chunk-1'],
        review_state: 'accepted', is_public: true,
      } });
      snapshot.elements.edges.push({ data: {
        id: 'edge-1', source: 'claim-1', target: 'issue-1', rel: 'isAbout',
        review_state: 'accepted', is_public: true,
      } });
      snapshot.meta.counts = { nodes: 2, edges: 1 };
    }],
  ])('rejects a live graph snapshot with %s', async (_caseName, mutate) => {
    const manifest = {
      default: REVIEWED_LIVE_SOURCE.id,
      categories: { live: '실시간' },
      sources: [REVIEWED_LIVE_SOURCE],
    };
    const snapshot = reviewedLiveSnapshot();
    mutate(snapshot);
    const fetchImpl = vi.fn(async (url) => (
      url === 'sources.json' ? jsonResponse(manifest) : jsonResponse(snapshot)
    ));
    const adapter = createWorkshopGraphSourceAdapter({ fetchImpl, now: () => 1234, retryDelayMs: 0 });

    const catalog = await adapter.loadCatalog('sources.json');

    await expect(adapter.loadSource(catalog.manifest.sources[0])).rejects.toThrow();
  });

  test('accepts an explicitly moderator-created live item without transcript citations', async () => {
    const manifest = {
      default: REVIEWED_LIVE_SOURCE.id,
      categories: { live: '검수 완료 스냅샷' },
      sources: [REVIEWED_LIVE_SOURCE],
    };
    const snapshot = reviewedLiveSnapshot();
    snapshot.elements.nodes[0].data.cited_uids = [];
    snapshot.elements.nodes[0].data.moderator_created = true;
    const fetchImpl = vi.fn(async (url) => (
      url === 'sources.json' ? jsonResponse(manifest) : jsonResponse(snapshot)
    ));
    const adapter = createWorkshopGraphSourceAdapter({ fetchImpl, now: () => 1234, retryDelayMs: 0 });

    const catalog = await adapter.loadCatalog('sources.json');
    const loaded = await adapter.loadSource(catalog.manifest.sources[0]);

    expect(loaded.payload.elements.nodes[0].data.moderator_created).toBe(true);
    expect(loaded.diagnostics.missingCitedNodeIds).toEqual([]);
  });

  test('fails the optional database catalog closed when an approved snapshot is malformed', async () => {
    const onError = vi.fn();
    const malformedCatalog = {
      sources: [{
        id: 'broken', label: '깨진 승인 snapshot', review_state: 'approved', is_public: true,
        row_count: 1,
        snapshot: {
          elements: {
            nodes: [{ data: {
              id: 'node-1', kind: 'Issue', label: '쟁점', cited_uids: ['item-1'],
              review_state: 'accepted', is_public: true,
            } }],
            edges: [{ data: { id: 'edge-1', source: 'node-1', target: 'missing-node', rel: 'isAbout' } }],
          },
          meta: {},
        },
      }],
    };
    const fetchImpl = vi.fn(async (url) => (
      url === 'sources.json' ? jsonResponse(STATIC_MANIFEST) : jsonResponse(malformedCatalog)
    ));
    const adapter = createWorkshopGraphSourceAdapter({ fetchImpl, onError, retryDelayMs: 0 });

    const catalog = await adapter.loadCatalog('sources.json');

    expect(catalog.databaseAvailable).toBe(false);
    expect(catalog.manifest.sources).toEqual(STATIC_MANIFEST.sources);
    expect(onError).toHaveBeenCalledWith(
      'Approved database graph sources are unavailable; using static fallback.',
      expect.objectContaining({ message: 'Graph edge references a missing node' }),
    );
  });

  test.each([
    ['missing row count', undefined, { id: 'node-1', kind: 'Issue', label: '쟁점', review_state: 'accepted', is_public: true }, null],
    ['zero row count', 0, { id: 'node-1', kind: 'Issue', label: '쟁점', review_state: 'accepted', is_public: true }, null],
    ['string row count', '1', { id: 'node-1', kind: 'Issue', label: '쟁점', review_state: 'accepted', is_public: true }, null],
    ['unknown node kind', 1, { id: 'node-1', kind: 'Unknown', label: '쟁점', review_state: 'accepted', is_public: true }, null],
    ['blank node label', 1, { id: 'node-1', kind: 'Issue', label: '   ', review_state: 'accepted', is_public: true }, null],
    ['private node', 1, { id: 'node-1', kind: 'Issue', label: '쟁점', review_state: 'accepted', is_public: false }, null],
    ['unreviewed node', 1, { id: 'node-1', kind: 'Issue', label: '쟁점', review_state: 'proposed', is_public: true }, null],
    ['private edge', 1, { id: 'node-1', kind: 'Issue', label: '쟁점', review_state: 'accepted', is_public: true }, {
      id: 'edge-1', source: 'node-1', target: 'node-1', rel: 'isAbout', review_state: 'accepted', is_public: false,
    }],
    ['unreviewed edge', 1, { id: 'node-1', kind: 'Issue', label: '쟁점', review_state: 'accepted', is_public: true }, {
      id: 'edge-1', source: 'node-1', target: 'node-1', rel: 'isAbout', review_state: 'proposed', is_public: true,
    }],
    ['blank edge relation', 1, { id: 'node-1', kind: 'Issue', label: '쟁점', review_state: 'accepted', is_public: true }, {
      id: 'edge-1', source: 'node-1', target: 'node-1', rel: '   ',
    }],
  ])('fails the optional database catalog closed for %s', async (_caseName, rowCount, nodeData, edgeData) => {
    const onError = vi.fn();
    const row = {
      id: 'invalid', label: '잘못된 승인 snapshot', review_state: 'approved', is_public: true,
      snapshot: {
        elements: {
          nodes: [{ data: nodeData }],
          edges: edgeData ? [{ data: edgeData }] : [],
        },
        meta: {},
      },
    };
    if (rowCount !== undefined) row.row_count = rowCount;
    const fetchImpl = vi.fn(async (url) => (
      url === 'sources.json' ? jsonResponse(STATIC_MANIFEST) : jsonResponse({ sources: [row] })
    ));
    const adapter = createWorkshopGraphSourceAdapter({ fetchImpl, onError, retryDelayMs: 0 });

    const catalog = await adapter.loadCatalog('sources.json');

    expect(catalog.databaseAvailable).toBe(false);
    expect(catalog.manifest.sources).toEqual(STATIC_MANIFEST.sources);
    expect(onError).toHaveBeenCalledOnce();
  });

  test.each([
    'https://approved.example/graph?apikey=secret',
    'http://approved.example/graph',
  ])('rejects unsafe database endpoint %s before a network request', async (endpoint) => {
    const onError = vi.fn();
    const manifest = {
      ...STATIC_MANIFEST,
      database: { endpoint },
    };
    const fetchImpl = vi.fn(async () => jsonResponse(manifest));
    const adapter = createWorkshopGraphSourceAdapter({ fetchImpl, onError, retryDelayMs: 0 });

    const catalog = await adapter.loadCatalog('sources.json');

    expect(catalog.databaseAvailable).toBe(false);
    expect(catalog.manifest.sources).toEqual(STATIC_MANIFEST.sources);
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledWith(
      'Approved database graph sources are unavailable; using static fallback.',
      expect.objectContaining({ message: 'Invalid database graph endpoint' }),
    );
  });
});
