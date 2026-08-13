const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_RETRY_DELAY_MS = 250;
const GRAPH_NODE_KINDS = new Set([
  'Issue', 'Claim', 'Proposal', 'Concern', 'Condition',
  'Value', 'Evidence', 'Group', 'Clause', 'Decision',
]);
const REVIEWED_ITEM_STATES = new Set(['accepted', 'edited']);
const LIVE_PUBLICATION_MODES = new Map([
  ['synthetic_reviewed_demo', 'synthetic-reviewed-demo'],
  ['reviewed_snapshot', 'reviewed-snapshot'],
]);

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function delay(milliseconds) {
  if (milliseconds <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function fetchJson({ fetchImpl, url, attempts, timeoutMs, retryDelayMs }) {
  let lastError = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetchImpl(url, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) throw new Error('Graph source request failed');
      return await response.json();
    } catch (error) {
      lastError = error;
      if (attempt + 1 < attempts) await delay(retryDelayMs);
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Graph source request failed');
}

function validateStaticManifest(value) {
  if (!isRecord(value) || typeof value.default !== 'string' || !isRecord(value.categories) || !Array.isArray(value.sources)) {
    throw new Error('Invalid static graph source manifest');
  }
  const sourceIds = new Set();
  for (const source of value.sources) {
    if (!isRecord(source)) throw new Error('Invalid static graph source');
    const sourceId = nonemptyString(source.id, 'static graph source id');
    const category = nonemptyString(source.category, 'static graph source category');
    if (sourceIds.has(sourceId)) throw new Error('Duplicate static graph source id');
    sourceIds.add(sourceId);
    if (!Object.hasOwn(value.categories, category)) throw new Error('Unknown static graph source category');
    const isLiveSource = sourceId.startsWith('live-') || category === 'live';
    if (isLiveSource && (category !== 'live' || source.publicationMode !== 'reviewed_snapshot')) {
      throw new Error('Live graph source must declare reviewed snapshot publication');
    }
  }
  if (!sourceIds.has(value.default)) throw new Error('Default static graph source is missing');
  return value;
}

function nonemptyString(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`Invalid ${label}`);
  return value;
}

function canonicalInstant(value, label) {
  const instant = nonemptyString(value, label);
  const parsed = new Date(instant);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString() !== instant) throw new Error(`Invalid ${label}`);
  return instant;
}

function reviewedLivePublicationMode(meta) {
  if (!isRecord(meta) || meta.live !== true || meta.source_review_status !== 'reviewed'
    || meta.requires_publication_review !== false) return null;
  const expectedPublicationMode = LIVE_PUBLICATION_MODES.get(meta.publication_status);
  if (!expectedPublicationMode || !isRecord(meta.publication)
    || meta.publication.mode !== expectedPublicationMode) return null;
  return expectedPublicationMode;
}

export function liveGraphStatusPresentation(meta) {
  const reviewed = reviewedLivePublicationMode(meta) !== null;
  if (!reviewed) {
    return {
      reviewed: false,
      advisoryFallback: '🔴 LIVE 미검증 초안 · 시민 비노출',
      footerSummary: 'LIVE 미검증 초안 · 시민 비노출',
      pillText: 'LIVE · 미검수',
    };
  }
  const synthetic = meta.publication_status === 'synthetic_reviewed_demo';
  const summary = synthetic
    ? '합성 전사 검수 데모 · 실제 시민 발언 아님'
    : '사람 검수 완료 스냅샷';
  return {
    reviewed: true,
    advisoryFallback: summary,
    footerSummary: summary,
    pillText: 'LIVE · 검수 완료',
  };
}

function validateGraphSnapshot(value) {
  if (!isRecord(value) || !isRecord(value.elements) || !Array.isArray(value.elements.nodes)
    || !Array.isArray(value.elements.edges) || !isRecord(value.meta)) {
    throw new Error('Invalid graph snapshot');
  }
  const nodeIds = new Set();
  for (const node of value.elements.nodes) {
    const id = nonemptyString(node?.data?.id, 'graph node id');
    const kind = nonemptyString(node?.data?.kind, 'graph node kind');
    if (!GRAPH_NODE_KINDS.has(kind)) throw new Error('Invalid graph node kind');
    nonemptyString(node?.data?.label, 'graph node label');
    if (nodeIds.has(id)) throw new Error('Duplicate graph node id');
    nodeIds.add(id);
  }
  const edgeIds = new Set();
  for (const edge of value.elements.edges) {
    const id = nonemptyString(edge?.data?.id, 'graph edge id');
    nonemptyString(edge?.data?.rel, 'graph edge relation');
    if (edgeIds.has(id)) throw new Error('Duplicate graph edge id');
    edgeIds.add(id);
    if (!nodeIds.has(edge?.data?.source) || !nodeIds.has(edge?.data?.target)) {
      throw new Error('Graph edge references a missing node');
    }
  }
  return value;
}

function validatePublishedDatabaseSnapshot(value) {
  const snapshot = validateGraphSnapshot(value);
  for (const item of [...snapshot.elements.nodes, ...snapshot.elements.edges]) {
    if (item.data.is_public !== true) throw new Error('Database graph item is not public');
    if (!REVIEWED_ITEM_STATES.has(item.data.review_state)) {
      throw new Error('Database graph item is not reviewed');
    }
  }
  return snapshot;
}

function validatePublishedLiveSnapshot(value, source) {
  const snapshot = validateGraphSnapshot(value);
  for (const item of [...snapshot.elements.nodes, ...snapshot.elements.edges]) {
    if (item.data.is_public !== true) throw new Error('Live graph item is not public');
    if (!REVIEWED_ITEM_STATES.has(item.data.review_state)) {
      throw new Error('Live graph item is not reviewed');
    }
  }
  if (reviewedLivePublicationMode(snapshot.meta) === null) {
    throw new Error('Live graph snapshot is not publication-ready');
  }
  nonemptyString(snapshot.meta.publication.approved_identity_kind, 'live graph approval identity kind');
  canonicalInstant(snapshot.meta.publication.approved_at, 'live graph approval time');
  if (!isRecord(snapshot.meta.source) || snapshot.meta.source.source_id !== source.id) {
    throw new Error('Live graph source identity does not match the manifest');
  }
  if (!isRecord(snapshot.meta.counts)
    || snapshot.meta.counts.nodes !== snapshot.elements.nodes.length
    || snapshot.meta.counts.edges !== snapshot.elements.edges.length) {
    throw new Error('Live graph snapshot counts do not match its elements');
  }
  return snapshot;
}

function graphDiagnostics(payload, origin, rowCount) {
  const missingCitedNodeIds = payload.elements.nodes
    .filter((node) => {
      const citations = [...(Array.isArray(node.data?.cited) ? node.data.cited : []),
        ...(Array.isArray(node.data?.cited_uids) ? node.data.cited_uids : [])];
      return !citations.some((citation) => typeof citation === 'string' && citation.trim().length > 0);
    })
    .map((node) => node.data.id);
  return {
    origin,
    rowCount,
    nodeCount: payload.elements.nodes.length,
    edgeCount: payload.elements.edges.length,
    missingCitedNodeIds,
  };
}

function validateDatabaseCatalog(value) {
  if (!isRecord(value) || !Array.isArray(value.sources)) throw new Error('Invalid database graph source catalog');
  return value;
}

function validateDatabaseEndpoint(value) {
  const endpoint = nonemptyString(value, 'database graph endpoint');
  const parsed = new URL(endpoint, 'https://graph-adapter.invalid');
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('Invalid database graph endpoint');
  }
  return endpoint;
}

/** Creates a read-only graph source loader with a required static fallback. */
export function createWorkshopGraphSourceAdapter({
  fetchImpl = globalThis.fetch,
  onError = console.error,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  retryDelayMs = DEFAULT_RETRY_DELAY_MS,
  now = Date.now,
} = {}) {
  if (typeof fetchImpl !== 'function' || typeof onError !== 'function' || typeof now !== 'function') {
    throw new Error('Invalid graph source adapter dependencies');
  }
  const databaseSnapshots = new Map();

  async function loadCatalog(staticManifestUrl) {
    databaseSnapshots.clear();
    const manifest = validateStaticManifest(await fetchJson({
      fetchImpl,
      url: staticManifestUrl,
      attempts: 1,
      timeoutMs,
      retryDelayMs,
    }));
    const databaseEndpointValue = manifest.database?.endpoint;
    if (databaseEndpointValue === undefined) {
      return { manifest, databaseAvailable: false };
    }
    try {
      const databaseEndpoint = validateDatabaseEndpoint(databaseEndpointValue);
      const databaseCatalog = validateDatabaseCatalog(await fetchJson({
        fetchImpl,
        url: databaseEndpoint,
        attempts: 2,
        timeoutMs,
        retryDelayMs,
      }));
      const databaseSources = [];
      const pendingSnapshots = new Map();
      const sourceIds = new Set(manifest.sources.map((source) => source.id));
      for (const row of databaseCatalog.sources) {
        if (!isRecord(row) || row.review_state !== 'approved' || row.is_public !== true) continue;
        const sourceId = `db:${nonemptyString(row.id, 'database graph source id')}`;
        if (sourceIds.has(sourceId)) throw new Error('Duplicate database graph source id');
        sourceIds.add(sourceId);
        const snapshot = validatePublishedDatabaseSnapshot(row.snapshot);
        if (!Number.isInteger(row.row_count) || row.row_count <= 0) {
          throw new Error('Invalid database graph row count');
        }
        const rowCount = row.row_count;
        pendingSnapshots.set(sourceId, { snapshot, rowCount });
        databaseSources.push({
          id: sourceId,
          category: 'database',
          label: nonemptyString(row.label, 'database graph source label'),
          adapter: 'database',
          supportsView: ['2d'],
        });
      }
      if (databaseSources.length > 0) {
        for (const [sourceId, snapshot] of pendingSnapshots) databaseSnapshots.set(sourceId, snapshot);
        return {
          manifest: {
            ...manifest,
            categories: { ...manifest.categories, database: '승인된 DB 스냅샷' },
            sources: [...manifest.sources, ...databaseSources],
          },
          databaseAvailable: true,
        };
      }
    } catch (error) {
      databaseSnapshots.clear();
      onError('Approved database graph sources are unavailable; using static fallback.', error);
    }
    return { manifest, databaseAvailable: false };
  }

  async function loadSource(source) {
    if (!isRecord(source)) throw new Error('Invalid graph source');
    if (source.adapter === 'database') {
      const stored = databaseSnapshots.get(source.id);
      if (!stored) throw new Error('Database graph source is not available');
      return {
        payload: stored.snapshot,
        diagnostics: graphDiagnostics(stored.snapshot, 'database', stored.rowCount),
      };
    }
    const dataPath = nonemptyString(source.data, 'static graph source path');
    const separator = dataPath.includes('?') ? '&' : '?';
    const fetched = await fetchJson({
      fetchImpl,
      url: `${dataPath}${separator}_=${now()}`,
      attempts: 2,
      timeoutMs,
      retryDelayMs,
    });
    const payload = source.category === 'live'
      ? validatePublishedLiveSnapshot(fetched, source)
      : validateGraphSnapshot(fetched);
    return { payload, diagnostics: graphDiagnostics(payload, 'static', null) };
  }

  return { loadCatalog, loadSource };
}
