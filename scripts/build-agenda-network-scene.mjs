/**
 * scripts/build-agenda-network-scene.mjs
 *
 * Builds src/data/agenda-network-scene.json from agenda-similarity.json.
 * Output is a "skeleton" scene — elements without Excalidraw runtime fields
 * (seed, version, etc.). The React island calls convertToExcalidrawElements()
 * on mount to hydrate them into valid Excalidraw elements.
 *
 * Deterministic: same input → same output (no Math.random, stable sort).
 *
 * Coordinate system: pre-computed force layout from agenda-similarity.json
 *   nodes[].x, nodes[].y  — scaled to fit 800×600 canvas
 *   edges_backbone[].source / .target — 44 statistically significant edges
 *
 * Category colors (big_category):
 *   감축 → #3fb950  (green)
 *   적응 → #58a6ff  (blue)
 *   혼합 → #d2a8ff  (purple)
 *
 * Node layout:
 *   rectangle (background + border) + text (id + label truncated)
 *   The text element uses containerId to bind to its rectangle.
 *
 * Edge layout:
 *   arrow type, startBinding + endBinding on rectangle ids
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
// Use "rect-{id}" and "text-{id}" as element IDs.
function rectId(nodeId)  { return `rect-${nodeId}`; }
function textId(nodeId)  { return `text-${nodeId}`; }
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

// 1. Rectangle elements (one per node)
for (const node of nodes) {
  const { cx, cy } = nodePos[node.id];
  const cat = node.big_category || '감축';

  // Short label: ID + first 12 chars of name
  const label = `#${node.id} ${node.name.slice(0, 12)}`;

  // Rectangle (skeleton — Excalidraw will fill required fields via convertToExcalidrawElements)
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
    boundElements: [{ type: 'text', id: textId(node.id) }],
    // Custom metadata (stored in customData for reference)
    customData: {
      agendaId: node.id,
      domain: node.domain,
      big_category: cat,
    },
  });

  // Text element bound to rectangle
  elements.push({
    type: 'text',
    id: textId(node.id),
    x: cx - NODE_W / 2,
    y: cy - NODE_H / 2,
    width: NODE_W,
    height: NODE_H,
    text: label,
    fontSize: 10,
    fontFamily: 1,   // 1 = Virgil (Excalidraw default)
    textAlign: 'center',
    verticalAlign: 'middle',
    strokeColor: CAT_TEXT[cat] || '#f0f6fc',
    containerId: rectId(node.id),
    lineHeight: 1.25,
  });
}

// 2. Arrow elements for backbone edges (44 edges)
for (const edge of edges_backbone) {
  const src = nodePos[edge.source];
  const tgt = nodePos[edge.target];
  if (!src || !tgt) continue;

  // Arrow stroke opacity proportional to weight (0.35–0.63 range in dataset)
  // Map to [0.3, 0.8]
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
    startBinding: {
      elementId: rectId(edge.source),
      focus: 0,
      gap: 4,
    },
    endBinding: {
      elementId: rectId(edge.target),
      focus: 0,
      gap: 4,
    },
    customData: {
      weight: edge.weight,
    },
  });
}

// ── Output ────────────────────────────────────────────────────────────────────
const scene = {
  // Skeleton — convertToExcalidrawElements() in island hydrates these
  elements,
  appState: {
    viewBackgroundColor: '#0d1117',
    theme: 'dark',
    currentItemFontFamily: 1,
    zoom: { value: 0.5 },
  },
  files: {},
  // Metadata (not part of Excalidraw spec — for island reference)
  _meta: {
    nodeCount: nodes.length,
    edgeCount: edges_backbone.length,
    generatedAt: new Date().toISOString().slice(0, 10),
    source: 'src/data/network/agenda-similarity.json',
  },
};

const outPath = join(ROOT, 'src/data/agenda-network-scene.json');
writeFileSync(outPath, JSON.stringify(scene, null, 2), 'utf-8');
console.log(`[build:scene] wrote ${elements.length} elements → ${outPath}`);
console.log(`  nodes: ${nodes.length}  backbone edges: ${edges_backbone.length}`);
