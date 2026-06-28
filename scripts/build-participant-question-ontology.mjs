#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WIKI_ROOT = resolve(__dirname, '..');
const DEFAULT_OUT = join(WIKI_ROOT, 'public', 'workshop-graph-0628-test', 'data', 'participant-open-questions.json');
const SOURCES_PATH = join(WIKI_ROOT, 'public', 'workshop-graph-0628-test', 'sources.json');

const QUESTION_COLUMNS = [
  {
    key: 'operation',
    kindKo: '운영',
    hubId: 'Question_operation',
    hubLabel: '기후시민회의 운영 관련 질문',
    candidates: [
      '기후시민회의 운영 관련 질문',
      '운영 관련 질문',
      '운영 질문',
      'q_operation',
      'operation',
    ],
  },
  {
    key: 'mitigation',
    kindKo: '감축',
    hubId: 'Question_mitigation',
    hubLabel: '감축의제 질문',
    candidates: [
      '감축의제 질문',
      '감축 의제 질문',
      '감축 관련 질문',
      '감축 질문',
      'q_mitigation',
      'mitigation',
    ],
  },
];

const GROUP_COLUMNS = ['조', '우리 조', '테이블', '분임', 'group'];
const TIMESTAMP_COLUMNS = ['타임스탬프', 'timestamp', 'Timestamp', '제출시간'];
const STOPWORDS = new Set([
  '그리고', '그러면', '그래서', '하지만', '또는', '또한', '대한', '관련', '위한', '위해',
  '있는', '있나요', '있을까요', '있습니까', '어떻게', '무엇', '어떤', '이번', '오늘',
  '기후', '시민', '회의', '질문', '의제', '운영', '감축', '관련해서', '부분', '생각',
  '합니다', '해주세요', '궁금합니다', '필요', '가능', '정책', '방안',
]);

const DOMAIN_TERMS = [
  '기획참여단', '숙의참여단', '모더레이터', '소수의견', '회의록', '권고안', '현장토론',
  '온라인', '절차', '의제수정', '역할', '최종판단', '재생에너지', '전기요금',
  '대중교통', '온실가스', '건물에너지', '소상공인', '중소기업', '농어촌', '도시',
  '부담', '지원', '규제', '전환', '효율', '폐기물', '일회용품',
];

function parseArgs(argv) {
  const args = {
    csv: null,
    csvUrl: null,
    out: DEFAULT_OUT,
    sourceId: 'participant-open-questions',
    label: '참여단 주관식 질문 — 운영/감축',
    threshold: 0.08,
    updateSources: false,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--csv') args.csv = argv[++i];
    else if (a === '--csv-url') args.csvUrl = argv[++i];
    else if (a === '--out') args.out = resolve(argv[++i]);
    else if (a === '--source-id') args.sourceId = argv[++i];
    else if (a === '--label') args.label = argv[++i];
    else if (a === '--threshold') args.threshold = Number(argv[++i]);
    else if (a === '--update-sources') args.updateSources = true;
    else if (a === '--no-update-sources') args.updateSources = false;
    else if (a === '--help') {
      console.log(`Usage:
  node scripts/build-participant-question-ontology.mjs --csv <responses.csv>
  node scripts/build-participant-question-ontology.mjs --csv-url <google_sheet_csv_url>

Expected columns:
  타임스탬프, 조, 기후시민회의 운영 관련 질문, 감축의제 질문`);
      process.exit(0);
    }
  }
  return args;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (c === '"') {
        inQuotes = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (c !== '\r') {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((v) => String(v).trim() !== ''));
}

function csvToObjects(text) {
  const rows = parseCsv(text);
  if (rows.length < 2) return [];
  const header = rows[0].map((h) => String(h || '').trim());
  return rows.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])));
}

async function readCsv(args) {
  if (args.csvUrl) {
    const res = await fetch(args.csvUrl);
    if (!res.ok) throw new Error(`CSV URL failed: ${res.status} ${res.statusText}`);
    return await res.text();
  }
  if (!args.csv) throw new Error('Provide --csv or --csv-url');
  return readFileSync(resolve(args.csv), 'utf8');
}

function pickColumn(row, candidates) {
  for (const key of candidates) {
    if (Object.prototype.hasOwnProperty.call(row, key)) return row[key];
  }
  const normalized = Object.fromEntries(Object.keys(row).map((k) => [k.replace(/\s+/g, '').toLowerCase(), k]));
  for (const key of candidates) {
    const hit = normalized[key.replace(/\s+/g, '').toLowerCase()];
    if (hit) return row[hit];
  }
  return '';
}

function normalizeGroup(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return raw.endsWith('조') ? raw : `${raw}조`;
}

function tokenize(text) {
  const compactText = String(text || '').replace(/\s+/g, '');
  const rawTokens = String(text || '')
    .toLowerCase()
    .replace(/[^\p{Script=Hangul}a-z0-9\s]/gu, ' ')
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean);
  const tokens = rawTokens
    .map((t) => t.replace(/(은|는|이|가|을|를|과|와|도|만|에서|으로|에게|인가요|하나요|할까요|되나요|있나요)$/u, ''))
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t));
  for (const term of DOMAIN_TERMS) {
    if (compactText.includes(term)) tokens.push(term);
  }
  const compact = rawTokens.join('');
  const grams = [];
  for (let i = 0; i < compact.length - 1; i += 1) grams.push(compact.slice(i, i + 2));
  for (let i = 0; i < compact.length - 2; i += 1) grams.push(compact.slice(i, i + 3));
  return [...new Set([...tokens, ...grams.filter((g) => !STOPWORDS.has(g))])];
}

function jaccard(a, b) {
  const A = new Set(a);
  const B = new Set(b);
  const union = new Set([...A, ...B]);
  if (!union.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter += 1;
  return inter / union.size;
}

function topTerms(responses, limit = 24) {
  const freq = new Map();
  for (const r of responses) {
    for (const t of r.tokens) freq.set(t, (freq.get(t) || 0) + 1);
  }
  return [...freq.entries()]
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ko'))
    .slice(0, limit)
    .map(([term, count]) => ({ term, count }));
}

function buildSimilarityEdges(responses, threshold) {
  const edges = [];
  for (let i = 0; i < responses.length; i += 1) {
    for (let j = i + 1; j < responses.length; j += 1) {
      if (responses[i].questionKey !== responses[j].questionKey) continue;
      const sim = jaccard(responses[i].tokens, responses[j].tokens);
      if (sim >= threshold) edges.push({ source: responses[i].id, target: responses[j].id, weight: sim });
    }
  }
  return edges.sort((a, b) => b.weight - a.weight);
}

function buildMetricEdges(responses, simEdges, terms) {
  const metricEdges = new Map();
  const topTermSet = new Set(terms.map((t) => t.term));
  const keyFor = (a, b) => [a, b].sort().join('::');
  for (const e of simEdges) {
    metricEdges.set(keyFor(e.source, e.target), { source: e.source, target: e.target, weight: e.weight });
  }
  for (let i = 0; i < responses.length; i += 1) {
    for (let j = i + 1; j < responses.length; j += 1) {
      if (responses[i].questionKey !== responses[j].questionKey) continue;
      const sharedTerms = responses[i].tokens.filter((t) => topTermSet.has(t) && responses[j].tokens.includes(t));
      if (!sharedTerms.length) continue;
      const key = keyFor(responses[i].id, responses[j].id);
      const existing = metricEdges.get(key);
      const weight = Math.min(1, (existing?.weight || 0) + sharedTerms.length * 0.08);
      metricEdges.set(key, { source: responses[i].id, target: responses[j].id, weight });
    }
  }
  return [...metricEdges.values()];
}

function centrality(nodes, edges) {
  const ids = nodes.map((n) => n.id);
  const adj = Object.fromEntries(ids.map((id) => [id, []]));
  for (const e of edges) {
    adj[e.source]?.push({ id: e.target, weight: e.weight });
    adj[e.target]?.push({ id: e.source, weight: e.weight });
  }

  const degree = {};
  for (const id of ids) {
    degree[id] = adj[id].reduce((sum, e) => sum + e.weight, 0);
  }
  const maxDegree = Math.max(1, ...Object.values(degree));
  const degreeCentrality = Object.fromEntries(ids.map((id) => [id, degree[id] / maxDegree]));

  const betweenness = Object.fromEntries(ids.map((id) => [id, 0]));
  const closeness = Object.fromEntries(ids.map((id) => [id, 0]));
  for (const s of ids) {
    const stack = [];
    const pred = Object.fromEntries(ids.map((id) => [id, []]));
    const sigma = Object.fromEntries(ids.map((id) => [id, 0]));
    const dist = Object.fromEntries(ids.map((id) => [id, -1]));
    sigma[s] = 1;
    dist[s] = 0;
    const queue = [s];
    while (queue.length) {
      const v = queue.shift();
      stack.push(v);
      for (const { id: w } of adj[v]) {
        if (dist[w] < 0) {
          queue.push(w);
          dist[w] = dist[v] + 1;
        }
        if (dist[w] === dist[v] + 1) {
          sigma[w] += sigma[v];
          pred[w].push(v);
        }
      }
    }
    const reachable = ids.filter((id) => id !== s && dist[id] > 0);
    if (reachable.length) {
      const sumDist = reachable.reduce((sum, id) => sum + dist[id], 0);
      closeness[s] = sumDist ? reachable.length / sumDist : 0;
    }
    const delta = Object.fromEntries(ids.map((id) => [id, 0]));
    while (stack.length) {
      const w = stack.pop();
      for (const v of pred[w]) {
        delta[v] += (sigma[v] / sigma[w]) * (1 + delta[w]);
      }
      if (w !== s) betweenness[w] += delta[w];
    }
  }
  const maxBetweenness = Math.max(1, ...Object.values(betweenness));
  const maxCloseness = Math.max(1, ...Object.values(closeness));
  return {
    degree: degreeCentrality,
    betweenness: Object.fromEntries(ids.map((id) => [id, betweenness[id] / maxBetweenness])),
    closeness: Object.fromEntries(ids.map((id) => [id, closeness[id] / maxCloseness])),
  };
}

function responseLabel(text) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (clean.length <= 28) return clean;
  return `${clean.slice(0, 27)}…`;
}

function buildGraph(rows, args) {
  const responses = [];
  rows.forEach((row, rowIndex) => {
    const group = normalizeGroup(pickColumn(row, GROUP_COLUMNS));
    const timestamp = String(pickColumn(row, TIMESTAMP_COLUMNS) || '').trim();
    QUESTION_COLUMNS.forEach((q) => {
      const answer = String(pickColumn(row, q.candidates) || '').trim();
      if (!answer) return;
      responses.push({
        id: `resp_${q.key}_${responses.length + 1}`,
        rowIndex: rowIndex + 1,
        questionKey: q.key,
        questionLabel: q.hubLabel,
        group,
        timestamp,
        text: answer,
        tokens: tokenize(answer),
      });
    });
  });

  const simEdges = buildSimilarityEdges(responses, args.threshold);
  const terms = topTerms(responses);
  const metricEdges = buildMetricEdges(responses, simEdges, terms);
  const metrics = centrality(responses, metricEdges);
  const termById = new Map(terms.map((t, i) => [t.term, `term_${i + 1}`]));
  const now = new Date().toISOString();

  const nodes = [];
  for (const q of QUESTION_COLUMNS) {
    nodes.push({
      data: {
        id: q.hubId,
        label: q.hubLabel,
        kind: 'Group',
        kindKo: '문항',
        text: q.hubLabel,
        session: 'participant-test',
        deg: responses.filter((r) => r.questionKey === q.key).length,
        isolated: false,
        meta: { question_key: q.key },
      },
    });
  }
  for (const r of responses) {
    nodes.push({
      data: {
        id: r.id,
        node_id: r.id,
        label: responseLabel(r.text),
        kind: r.questionKey === 'operation' ? 'Issue' : 'Proposal',
        kindKo: r.questionKey === 'operation' ? '운영질문' : '감축질문',
        text: r.text,
        session: r.group || '참여단',
        cited: [r.id],
        cited_uids: [r.id],
        deg: simEdges.filter((e) => e.source === r.id || e.target === r.id).length + 1,
        isolated: false,
        meta: {
          row_index: r.rowIndex,
          question_key: r.questionKey,
          question_label: r.questionLabel,
          group: r.group,
          timestamp: r.timestamp,
          tokens: r.tokens,
          centrality: {
            degree: Number(metrics.degree[r.id]?.toFixed(4) || 0),
            betweenness: Number(metrics.betweenness[r.id]?.toFixed(4) || 0),
            closeness: Number(metrics.closeness[r.id]?.toFixed(4) || 0),
          },
        },
      },
    });
  }
  for (const t of terms) {
    nodes.push({
      data: {
        id: termById.get(t.term),
        label: t.term,
        kind: 'Value',
        kindKo: '공통키워드',
        text: `${t.term} (${t.count})`,
        session: 'keyword',
        deg: t.count,
        isolated: false,
        meta: { count: t.count },
      },
    });
  }

  const edges = [];
  for (const r of responses) {
    const hub = QUESTION_COLUMNS.find((q) => q.key === r.questionKey).hubId;
    edges.push({
      data: {
        id: `q_${edges.length + 1}`,
        source: hub,
        target: r.id,
        rel: 'raisesIssue',
        relKo: '응답',
        weight: 1,
        meta: { question_key: r.questionKey },
      },
    });
    for (const token of r.tokens) {
      const termId = termById.get(token);
      if (!termId) continue;
      edges.push({
        data: {
          id: `kw_${edges.length + 1}`,
          source: r.id,
          target: termId,
          rel: 'hasKeyword',
          relKo: '키워드',
          weight: 0.4,
          meta: { token },
        },
      });
    }
  }
  simEdges.forEach((e, i) => {
    edges.push({
      data: {
        id: `sim_${i + 1}`,
        source: e.source,
        target: e.target,
        rel: 'similarTo',
        relKo: '유사',
        weight: Number(e.weight.toFixed(4)),
        meta: { similarity: Number(e.weight.toFixed(4)) },
      },
    });
  });

  const responseById = Object.fromEntries(responses.map((r) => [r.id, r]));
  const topBy = (metric) => responses
    .map((r) => ({ id: r.id, label: responseLabel(r.text), group: r.group, question_key: r.questionKey, value: Number(metrics[metric][r.id]?.toFixed(4) || 0) }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 10);

  return {
    elements: { nodes, edges },
    meta: {
      variant: 'participant-open-questions',
      generated_at: now,
      source: args.csvUrl ? 'google-sheet-csv' : 'local-csv',
      threshold: args.threshold,
      counts: {
        rows: rows.length,
        responses: responses.length,
        operation_responses: responses.filter((r) => r.questionKey === 'operation').length,
        mitigation_responses: responses.filter((r) => r.questionKey === 'mitigation').length,
        nodes: nodes.length,
        edges: edges.length,
        similarity_edges: simEdges.length,
        keyword_nodes: terms.length,
      },
      centrality: {
        degree_top: topBy('degree'),
        betweenness_top: topBy('betweenness'),
        closeness_top: topBy('closeness'),
      },
      similarity_edges: simEdges.slice(0, 20).map((e) => ({
        source: e.source,
        source_label: responseLabel(responseById[e.source]?.text),
        target: e.target,
        target_label: responseLabel(responseById[e.target]?.text),
        similarity: Number(e.weight.toFixed(4)),
      })),
      advisory_notice: '참여단 주관식 응답을 현장 검토용으로 구조화한 임시 온톨로지입니다. 최종 해석이나 합의가 아닙니다.',
    },
  };
}

function updateSources(args) {
  const dataFile = args.out.startsWith(join(WIKI_ROOT, 'public', 'workshop-graph', 'data'))
    ? args.out.slice(join(WIKI_ROOT, 'public', 'workshop-graph').length + 1).replace(/\\/g, '/')
    : `data/${args.sourceId}.json`;
  const sources = JSON.parse(readFileSync(SOURCES_PATH, 'utf8'));
  sources.categories = {
    ...(sources.categories || {}),
    participant: '참여단 테스트',
  };
  const entry = {
    id: args.sourceId,
    category: 'participant',
    label: args.label,
    data: dataFile,
    supportsView: ['2d'],
  };
  const idx = sources.sources.findIndex((s) => s.id === args.sourceId);
  if (idx >= 0) sources.sources[idx] = entry;
  else sources.sources.push(entry);
  const formatted = JSON.stringify(sources, null, 2)
    .replace(/"supportsView": \[\n\s+"2d",\n\s+"3d"\n\s+\]/g, '"supportsView": ["2d", "3d"]')
    .replace(/"supportsView": \[\n\s+"2d"\n\s+\]/g, '"supportsView": ["2d"]');
  writeFileSync(SOURCES_PATH, `${formatted}\n`);
}

async function main() {
  const args = parseArgs(process.argv);
  const csv = await readCsv(args);
  const rows = csvToObjects(csv);
  const graph = buildGraph(rows, args);
  mkdirSync(dirname(args.out), { recursive: true });
  writeFileSync(args.out, `${JSON.stringify(graph, null, 2)}\n`);
  if (args.updateSources) updateSources(args);
  console.log(`[participant-ontology] rows=${graph.meta.counts.rows} responses=${graph.meta.counts.responses} nodes=${graph.meta.counts.nodes} edges=${graph.meta.counts.edges}`);
  console.log(`[participant-ontology] out=${args.out}`);
}

main().catch((err) => {
  console.error(`[participant-ontology] ${err.message}`);
  process.exit(1);
});
