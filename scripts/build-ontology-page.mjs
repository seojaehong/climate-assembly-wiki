#!/usr/bin/env node
// build-ontology-page.mjs
// vis-network nodes/edges → Cytoscape elements (cytoscape-fcose 호환)
// + ontology_viz_v2 cytoscape elements 형식과 일치
//
// usage:
//   node scripts/build-ontology-page.mjs <source.json|backup.html> <target_data.json> [variant]
//   variant: workshop (default) | regulation

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const KIND_COLOR = {
  Issue:     '#f08c4b',
  Claim:     '#4dabf7',
  Proposal:  '#51cf66',
  Concern:   '#ffd43b',
  Condition: '#cc5de8',
  Value:     '#22b8cf',
  Evidence:  '#adb5bd',
  Group:     '#ff8787',
  Clause:    '#e9ecef',
  Decision:  '#ffa94d',
};
const KIND_KO = {
  Issue:'쟁점', Claim:'주장', Proposal:'정책대안', Concern:'우려', Condition:'조건',
  Value:'가치', Evidence:'근거', Group:'영향집단', Clause:'조항', Decision:'의결',
};
const REL_KO = {
  raisesIssue:'쟁점제기', supports:'지지', opposes:'반대', modifies:'수정',
  requiresCondition:'조건필요', hasConcern:'우려', hasEvidence:'근거',
  reflectsValue:'가치반영', affectsGroup:'영향집단',
  proposesEditTo:'수정제안', raisesConcernOn:'우려제기', resolves:'확정',
};
const OPPOSING_RELS = new Set(['opposes', 'hasConcern', 'raisesConcernOn']);

function colorToKind(hex) {
  if (!hex) return null;
  const h = hex.toLowerCase();
  for (const [k, v] of Object.entries(KIND_COLOR)) {
    if (v.toLowerCase() === h) return k;
  }
  // vis-network에서 사용한 색상도 매핑 (workshop은 같은 색 팔레트)
  const VIS_PALETTE = {
    '#e8590c':'Issue','#1c7ed6':'Claim','#2f9e44':'Proposal',
    '#9c36b5':'Concern','#f08c00':'Condition','#0c8599':'Value','#868e96':'Evidence',
  };
  return VIS_PALETTE[h] || null;
}

function extractVisData(htmlPath) {
  const html = readFileSync(htmlPath, 'utf8');
  const mNodes = html.match(/var\s+nodes\s*=\s*new\s+vis\.DataSet\s*\((\[[\s\S]*?\])\)\s*;/);
  const mEdges = html.match(/var\s+edges\s*=\s*new\s+vis\.DataSet\s*\((\[[\s\S]*?\])\)\s*;/);
  if (!mNodes || !mEdges) throw new Error('vis DataSet not found in HTML');
  return { nodes: JSON.parse(mNodes[1]), edges: JSON.parse(mEdges[1]) };
}

function visToCytoscape({ nodes, edges }) {
  // vis nodes/edges → cytoscape elements
  // vis 노드 형식: {id, label, title, color, shape}
  // title 안에 [tag] [kind] text 패턴 — kind 추출 가능
  const cyNodes = [];
  for (const n of nodes) {
    if (typeof n.id === 'string' && n.id.startsWith('frame-')) continue;
    const kind = colorToKind(n.color) || 'Claim';
    const tagMatch = (n.title || '').match(/^\[([^\]]+)\]/);
    const session = tagMatch ? tagMatch[1] : (n.id || '').split('__')[0];
    const text = (n.title || '').replace(/^\[[^\]]+\]\s*\[[^\]]+\]\s*/, '').trim();
    cyNodes.push({
      data: {
        id: String(n.id),
        label: n.label || String(n.id),
        kind, kindKo: KIND_KO[kind] || kind,
        text, cited: [], synthesized: false, session,
      },
    });
  }
  // degree 계산
  const deg = {};
  const cyEdges = [];
  for (const e of edges) {
    if (!e.from || !e.to) continue;
    deg[e.from] = (deg[e.from] || 0) + 1;
    deg[e.to] = (deg[e.to] || 0) + 1;
    const rel = e.label || 'supports';
    cyEdges.push({
      data: {
        id: `e_${cyEdges.length}`,
        source: String(e.from), target: String(e.to),
        rel, relKo: REL_KO[rel] || rel,
        opposes: OPPOSING_RELS.has(rel) || undefined,
      },
    });
  }
  // degree + isolated 플래그 적용
  for (const n of cyNodes) {
    n.data.deg = deg[n.data.id] || 0;
    n.data.isolated = (deg[n.data.id] || 0) === 0;
  }
  return { nodes: cyNodes, edges: cyEdges };
}

function rawGraphToCytoscape(g) {
  // 2026-06-23-ontology-output-schema 정합:
  // Graph = { nodes[], edges[], counts, uncited_dropped, advisory_notice, live?, recommendations?, provenance_index? }
  // Node = { node_id, kind, label, text, cited_uids[], meta }
  // Edge = { src, rel, dst, cited_uids[], meta }
  const cyNodes = [];
  const deg = {};
  for (const n of g.nodes || []) {
    const meta = n.meta || {};
    cyNodes.push({
      data: {
        id: n.node_id,
        node_id: n.node_id,                  // schema alias 보존
        label: n.label || n.node_id,
        kind: n.kind,
        kindKo: KIND_KO[n.kind] || n.kind,
        text: n.text || '',
        cited: n.cited_uids || [],
        cited_uids: n.cited_uids || [],      // schema alias 보존
        meta,                                // {evidence_type, session, review_state, ...}
        session: meta.session || n.session || '',
        evidence_type: meta.evidence_type || null,
        review_state: meta.review_state || null,
        is_public: meta.review_state?.is_public !== false,  // default true (모더 미검증도 화면엔 표시, 게이트는 페이지가)
        synthesized: false,
      },
    });
  }
  const cyEdges = [];
  for (const e of g.edges || []) {
    const src = e.src, dst = e.dst;
    if (!src || !dst) continue;
    deg[src] = (deg[src] || 0) + 1;
    deg[dst] = (deg[dst] || 0) + 1;
    cyEdges.push({
      data: {
        id: `e_${cyEdges.length}`,
        source: src, target: dst,
        src, dst,                            // schema alias 보존
        rel: e.rel,
        relKo: REL_KO[e.rel] || e.rel,
        opposes: OPPOSING_RELS.has(e.rel) || undefined,
        cited: e.cited_uids || [],
        cited_uids: e.cited_uids || [],
        meta: e.meta || {},
      },
    });
  }
  for (const n of cyNodes) {
    n.data.deg = deg[n.data.id] || 0;
    n.data.isolated = (deg[n.data.id] || 0) === 0;
  }
  return { nodes: cyNodes, edges: cyEdges };
}

function main() {
  const [, , src, dst, variant = 'workshop'] = process.argv;
  if (!src || !dst) {
    console.error('usage: build-ontology-page.mjs <source> <target> [variant]');
    process.exit(1);
  }
  let elements;
  if (src.endsWith('.html')) {
    const vis = extractVisData(src);
    elements = visToCytoscape(vis);
  } else {
    const g = JSON.parse(readFileSync(src, 'utf8'));
    elements = rawGraphToCytoscape(g);
  }
  // 원본 graph (raw)에서 schema 최상위 필드 통과
  let raw = null;
  if (!src.endsWith('.html')) {
    try { raw = JSON.parse(readFileSync(src, 'utf8')); } catch {}
  }
  const out = {
    elements,
    meta: {
      variant,
      generated_at: new Date().toISOString(),
      counts: raw?.counts || { nodes: elements.nodes.length, edges: elements.edges.length, by_kind: {}, by_rel: {} },
      kinds: Object.fromEntries(
        Object.keys(KIND_COLOR).map(k => [k, elements.nodes.filter(n => n.data.kind === k).length])
      ),
      // 새 스키마 통과 필드 — 렌더러는 read-only로만 소비한다.
      advisory_notice: raw?.advisory_notice || null,
      uncited_dropped: raw?.uncited_dropped ?? null,
      live: raw?.live || false,
      recommendations: raw?.recommendations || null,
      uid_time_index: raw?.uid_time_index || null,
      quality: raw?.meta?.quality || raw?.quality || null,
    },
  };
  writeFileSync(dst, JSON.stringify(out, null, 2));
  console.log(`✓ ${dst}: nodes=${elements.nodes.length} edges=${elements.edges.length}`);
}

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}` || fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
