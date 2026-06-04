/**
 * scripts/build-agenda-network-scene.mjs
 *
 * Builds src/data/agenda-network-scene.json from agenda-similarity.json.
 * Output is a "skeleton" scene compatible with convertToExcalidrawElements().
 *
 * Skeleton format (required by convertToExcalidrawElements):
 *   - Rectangle: { type, id, x, y, width, height, label: { text, strokeColor }, ... }
 *     No separate text elements — label is embedded in the rectangle.
 *   - Arrow: { type, id, ..., start: { id: rectId }, end: { id: rectId } }
 *     No startBinding/endBinding objects — use start/end with element id.
 *
 * Deterministic: same input → same output (no Math.random, stable sort).
 *
 * Category colors (big_category):
 *   감축 → #3fb950  (green)
 *   적응 → #58a6ff  (blue)
 *   혼합 → #d2a8ff  (purple)
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT  = join(__dir, '..');

// ── Input ─────────────────────────────────────────────────────────────────────
const raw = JSON.parse(readFileSync(join(ROOT, 'src/data/network/agenda-similarity.json'), 'utf-8'));
const { nodes, edges_backbone } = raw;

// ── Constants ─────────────────────────────────────────────────────────────────
const NODE_W  = 100;
const NODE_H  = 40;
const PAD     = 30;   // canvas margin

// Coordinate scaling: map pre-computed layout (min→max) into a generous canvas
const xs = nodes.map(n => n.x);
const ys = nodes.map(n => n.y);
const xMin = Math.min(...xs), xMax = Math.max(...xs);
const yMin = Math.min(...ys), yMax = Math.max(...ys);

const CANVAS_W = 2400;
const CANVAS_H = 1800;
const rangeX = xMax - xMin || 1;
const rangeY = yMax - yMin || 1;

function scaleX(x) {
  return PAD + NODE_W / 2 + ((x - xMin) / rangeX) * (CANVAS_W - NODE_W - PAD * 2);
}
function scaleY(y) {
  return PAD + NODE_H / 2 + ((y - yMin) / rangeY) * (CANVAS_H - NODE_H - PAD * 2);
}

// ── Category styling ───────────────────────────────────────────────────────────
const CAT_BG = {
  '감축': '#0d2b12',
  '적응': '#0d1f2b',
  '혼합': '#1e0d2b',
};
const CAT_STROKE = {
  '감축': '#3fb950',
  '적응': '#58a6ff',
  '혼합': '#d2a8ff',
};
const CAT_TEXT = {
  '감축': '#3fb950',
  '적응': '#58a6ff',
  '혼합': '#d2a8ff',
};

// ── ID generation (stable, deterministic) ─────────────────────────────────────
function rectId(nodeId)  { return `rect-${nodeId}`; }
function arrowId(s, t)   { return `arrow-${s}-${t}`; }

// ── Build elements ─────────────────────────────────────────────────────────────
const elements = [];

// Build a lookup for node positions (after scaling)
const nodePos = {};
for (const node of nodes) {
  nodePos[node.id] = {
    cx: scaleX(node.x),
    cy: scaleY(node.y),
  };
}

// 1. Rectangle elements with embedded label (convertToExcalidrawElements format)
//    No separate text elements — label.text is bound inside the rect.
for (const node of nodes) {
  const { cx, cy } = nodePos[node.id];
  const cat = node.big_category || '감축';

  // Short label: ID + first 12 chars of name
  const labelText = `#${node.id} ${node.name.slice(0, 12)}`;

  elements.push({
    type: 'rectangle',
    id: rectId(node.id),
    x: cx - NODE_W / 2,
    y: cy - NODE_H / 2,
    width: NODE_W,
    height: NODE_H,
    backgroundColor: CAT_BG[cat] || '#1a1a2a',
    strokeColor: CAT_STROKE[cat] || '#8b949e',
    strokeWidth: 1.5,
    fillStyle: 'solid',
    roughness: 0,
    roundness: { type: 3, value: 4 },
    // Embedded label — convertToExcalidrawElements creates the text element internally
    label: {
      text: labelText,
      fontSize: 10,
      fontFamily: 1,
      textAlign: 'center',
      verticalAlign: 'middle',
      strokeColor: CAT_TEXT[cat] || '#f0f6fc',
    },
    // Custom metadata (stored in customData for reference)
    customData: {
      agendaId: node.id,
      domain: node.domain,
      big_category: cat,
    },
  });
}

// 2. Arrow elements for backbone edges (44 edges)
//    Use start/end with element id — convertToExcalidrawElements resolves bindings.
for (const edge of edges_backbone) {
  const src = nodePos[edge.source];
  const tgt = nodePos[edge.target];
  if (!src || !tgt) continue;

  // Arrow opacity proportional to weight (0.35–0.63 range in dataset → 30–80)
  const opacity = Math.round(30 + ((edge.weight - 0.35) / 0.28) * 50);

  elements.push({
    type: 'arrow',
    id: arrowId(edge.source, edge.target),
    x: src.cx,
    y: src.cy,
    width: tgt.cx - src.cx,
    height: tgt.cy - src.cy,
    points: [
      [0, 0],
      [tgt.cx - src.cx, tgt.cy - src.cy],
    ],
    strokeColor: '#58a6ff',
    strokeWidth: 1,
    fillStyle: 'solid',
    roughness: 0,
    opacity,
    startArrowhead: null,
    endArrowhead: null,   // no arrowheads — undirected graph
    // start/end format for convertToExcalidrawElements
    start: { id: rectId(edge.source) },
    end:   { id: rectId(edge.target) },
    customData: {
      weight: edge.weight,
    },
  });
}

// ── Output ────────────────────────────────────────────────────────────────────
const scene = {
  elements,
  appState: {
    viewBackgroundColor: '#0d1117',
    theme: 'dark',
    currentItemFontFamily: 1,
    zoom: { value: 0.5 },
  },
  files: {},
  _meta: {
    nodeCount: nodes.length,
    edgeCount: edges_backbone.length,
    generatedAt: new Date().toISOString().slice(0, 10),
    source: 'src/data/network/agenda-similarity.json',
    skeletonFormat: 'convertToExcalidrawElements-compatible',
  },
};

const outPath = join(ROOT, 'src/data/agenda-network-scene.json');
writeFileSync(outPath, JSON.stringify(scene, null, 2), 'utf-8');
console.log(`[build:scene] wrote ${elements.length} elements → ${outPath}`);
console.log(`  nodes: ${nodes.length}  backbone edges: ${edges_backbone.length}`);
console.log(`  format: label-embedded rects + start/end arrows`);
