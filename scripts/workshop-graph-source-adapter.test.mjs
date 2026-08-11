import { readFileSync } from 'node:fs';
import { describe, expect, test, vi } from 'vitest';
import { createWorkshopGraphSourceAdapter } from '../public/workshop-graph/graph-source-adapter.js';

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
        edges: [{ data: { id: 'edge-1', source: 'claim-1', target: 'issue-1', rel: 'isAbout' } }],
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

    expect(html).toContain("import { createWorkshopGraphSourceAdapter } from './graph-source-adapter.js';");
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
    expect(html).toContain("mt.publication_status === 'synthetic_reviewed_demo'");
    expect(html).toContain("mt.requires_publication_review === false");
    expect(html).toContain('합성 전사 검수 데모 · 실제 시민 발언 아님');
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
