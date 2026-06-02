"""
build-agenda-similarity.py
Builds agenda-similarity.json for the /ko/moderator/insights/agenda-network page.

Pipeline:
  1. Load agendas-65.json + domain-keyword-matrix.json keywords
  2. Build keyword set per agenda from 3 text fields (same tokenizer as build-network-data.py)
  3. Compute pairwise Jaccard similarity (C(65,2) = 2,080 pairs)
  4. Keep edges with similarity >= threshold (tuned to give 100-300 edges)
  5. Community detection: connected-components after thresholding, then greedy label propagation
  6. Fruchterman-Reingold force layout (200 iterations, pure Python, no networkx)
  7. Output src/data/network/agenda-similarity.json

Usage: python3 scripts/build-agenda-similarity.py
Run from wiki/ directory.
"""

import sys
import json
import os
import re
import math
import random

sys.stdout.reconfigure(encoding='utf-8')

WIKI_DIR     = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
AGENDAS_PATH = os.path.join(WIKI_DIR, 'src', 'data', 'agendas-65.json')
MATRIX_PATH  = os.path.join(WIKI_DIR, 'src', 'data', 'domain-keyword-matrix.json')
OUT_PATH     = os.path.join(WIKI_DIR, 'src', 'data', 'network', 'agenda-similarity.json')

# Korean stopwords (same as heatmap/cluster pipeline spirit)
STOPWORDS = {
    '및', '또는', '위한', '위해', '통해', '대한', '관련', '등의', '등을',
    '있는', '있어', '있음', '있고', '있다', '이를', '이에', '이와', '그리고',
    '하는', '하여', '하고', '하기', '하며', '이는', '으로', '에서', '에는',
    '에게', '으로서', '가능', '필요', '중요', '주요', '추진', '마련', '강화',
    '도입', '지원', '확대', '활성', '구축', '개선', '운영', '방안', '정책',
}

# Threshold tuning targets 100-300 edges
CANDIDATE_THRESHOLDS = [0.25, 0.30, 0.35, 0.40, 0.45, 0.50, 0.55]
TARGET_MIN_EDGES = 100
TARGET_MAX_EDGES = 300


def load_data():
    with open(AGENDAS_PATH, encoding='utf-8') as f:
        agendas = json.load(f)
    with open(MATRIX_PATH, encoding='utf-8') as f:
        matrix_data = json.load(f)
    return agendas, matrix_data['keywords']


def extract_keywords_from_text(text: str, keyword_universe: list[str]) -> set[str]:
    """
    Extract keywords appearing in text that are in the heatmap keyword universe.
    Uses ONLY heatmap keywords for discriminating Jaccard similarity.
    (Full Korean token extraction inflates set sizes to ~150 tokens,
    making all pairs look similar and yielding only 43 edges at threshold 0.10.)
    """
    found = set()
    for kw in keyword_universe:
        if kw in text:
            found.add(kw)
    return found


def jaccard(a: set, b: set) -> float:
    if not a and not b:
        return 0.0
    union = len(a | b)
    if union == 0:
        return 0.0
    return len(a & b) / union


def pick_threshold(edges_by_threshold: dict[float, list]) -> float:
    """Pick the highest threshold that still gives >= TARGET_MIN_EDGES."""
    chosen = CANDIDATE_THRESHOLDS[0]
    for t in CANDIDATE_THRESHOLDS:
        cnt = len(edges_by_threshold.get(t, []))
        print(f'  threshold={t:.2f}: {cnt} edges')
        if TARGET_MIN_EDGES <= cnt <= TARGET_MAX_EDGES:
            chosen = t
    return chosen


def find_communities(nodes: list[int], edges: list[tuple]) -> dict[int, int]:
    """
    Greedy label propagation: assign each node to the community of its
    most-frequent neighbor. 10 iterations, random tie-break.
    Returns: {node_id: community_id}
    """
    # Build adjacency
    adj: dict[int, list[int]] = {n: [] for n in nodes}
    for src, tgt, _ in edges:
        adj[src].append(tgt)
        adj[tgt].append(src)

    # Init: each node is its own community
    labels = {n: n for n in nodes}

    random.seed(42)
    for _ in range(10):
        order = list(nodes)
        random.shuffle(order)
        for node in order:
            nbrs = adj[node]
            if not nbrs:
                continue
            # Count neighbor labels
            counts: dict[int, int] = {}
            for nb in nbrs:
                lb = labels[nb]
                counts[lb] = counts.get(lb, 0) + 1
            max_count = max(counts.values())
            best = [lb for lb, c in counts.items() if c == max_count]
            labels[node] = random.choice(best)

    # Canonicalise community ids to 0-indexed integers
    unique_labels = sorted(set(labels.values()))
    label_map = {lb: i for i, lb in enumerate(unique_labels)}
    return {n: label_map[labels[n]] for n in nodes}


def fruchterman_reingold(
    nodes: list[int],
    edges: list[tuple],
    width: float = 800,
    height: float = 600,
    iterations: int = 200,
) -> dict[int, tuple[float, float]]:
    """
    Pure-Python Fruchterman-Reingold force-directed layout.
    Returns {node_id: (x, y)} normalised to [0, width] x [0, height].
    """
    n = len(nodes)
    if n == 0:
        return {}

    # Initial positions: random in unit square
    random.seed(0)
    pos = {node: (random.uniform(0.1, 0.9) * width, random.uniform(0.1, 0.9) * height)
           for node in nodes}

    # Build adjacency set for O(1) lookup
    adj_set: set[tuple[int, int]] = set()
    for src, tgt, _ in edges:
        adj_set.add((src, tgt))
        adj_set.add((tgt, src))

    area = width * height
    k = math.sqrt(area / max(n, 1))  # ideal spring length

    def f_attract(d: float) -> float:
        return d * d / k

    def f_repel(d: float) -> float:
        return k * k / max(d, 0.001)

    t = width / 10  # initial temperature
    dt = t / (iterations + 1)

    for _ in range(iterations):
        disp: dict[int, list[float]] = {node: [0.0, 0.0] for node in nodes}

        # Repulsive forces (all pairs)
        for i, u in enumerate(nodes):
            for v in nodes[i + 1:]:
                dx = pos[u][0] - pos[v][0]
                dy = pos[u][1] - pos[v][1]
                dist = math.sqrt(dx * dx + dy * dy) or 0.001
                f = f_repel(dist) / dist
                disp[u][0] += dx * f
                disp[u][1] += dy * f
                disp[v][0] -= dx * f
                disp[v][1] -= dy * f

        # Attractive forces (edges only)
        for src, tgt, _ in edges:
            dx = pos[src][0] - pos[tgt][0]
            dy = pos[src][1] - pos[tgt][1]
            dist = math.sqrt(dx * dx + dy * dy) or 0.001
            f = f_attract(dist) / dist
            disp[src][0] -= dx * f
            disp[src][1] -= dy * f
            disp[tgt][0] += dx * f
            disp[tgt][1] += dy * f

        # Apply displacements with temperature clamping
        for node in nodes:
            dx, dy = disp[node]
            mag = math.sqrt(dx * dx + dy * dy) or 0.001
            scale = min(mag, t) / mag
            x = pos[node][0] + dx * scale
            y = pos[node][1] + dy * scale
            # Clamp to canvas
            x = max(20.0, min(width - 20.0, x))
            y = max(20.0, min(height - 20.0, y))
            pos[node] = (x, y)

        t -= dt

    return pos


def main():
    print('=== build-agenda-similarity.py ===')

    print('\n[1] Loading data...')
    agendas, keywords = load_data()
    print(f'  Agendas: {len(agendas)}, Keywords: {len(keywords)}')

    print('\n[2] Building keyword sets per agenda...')
    kw_sets: dict[int, set[str]] = {}
    for ag in agendas:
        text = ' '.join([
            ag.get('current_situation', ''),
            ag.get('proposed_policy', ''),
            ag.get('expected_effect', ''),
        ])
        kw_sets[ag['id']] = extract_keywords_from_text(text, keywords)

    print(f'  Keyword set sizes: min={min(len(s) for s in kw_sets.values())}, '
          f'max={max(len(s) for s in kw_sets.values())}, '
          f'avg={sum(len(s) for s in kw_sets.values()) / len(kw_sets):.1f}')

    print('\n[3] Computing pairwise Jaccard similarity (C(65,2) = 2,080 pairs)...')
    ids = [ag['id'] for ag in agendas]
    all_edges: list[tuple[int, int, float]] = []
    edges_by_threshold: dict[float, list] = {t: [] for t in CANDIDATE_THRESHOLDS}

    for i in range(len(ids)):
        for j in range(i + 1, len(ids)):
            u, v = ids[i], ids[j]
            sim = jaccard(kw_sets[u], kw_sets[v])
            for t in CANDIDATE_THRESHOLDS:
                if sim >= t:
                    edges_by_threshold[t].append((u, v, round(sim, 4)))

    print('\n[4] Threshold selection:')
    threshold = pick_threshold(edges_by_threshold)
    edges = edges_by_threshold[threshold]
    print(f'  Selected threshold: {threshold} → {len(edges)} edges')

    # If still no good threshold found, pick the one closest to [100,300]
    if not (TARGET_MIN_EDGES <= len(edges) <= TARGET_MAX_EDGES):
        best_t = min(CANDIDATE_THRESHOLDS,
                     key=lambda t: abs(len(edges_by_threshold[t]) - (TARGET_MIN_EDGES + TARGET_MAX_EDGES) / 2))
        threshold = best_t
        edges = edges_by_threshold[threshold]
        print(f'  Adjusted to threshold={threshold}: {len(edges)} edges')

    print('\n[5] Computing node degrees...')
    degree: dict[int, int] = {aid: 0 for aid in ids}
    for src, tgt, _ in edges:
        degree[src] += 1
        degree[tgt] += 1

    print('\n[6] Community detection...')
    communities_map = find_communities(ids, edges)
    num_communities = max(communities_map.values()) + 1 if communities_map else 0
    print(f'  Found {num_communities} communities')

    # Summarise communities
    comm_members: dict[int, list[int]] = {}
    for node, comm in communities_map.items():
        comm_members.setdefault(comm, []).append(node)

    comm_records = []
    for comm_id, members in sorted(comm_members.items(), key=lambda x: -len(x[1])):
        # Top keywords: most frequent across member keyword sets
        kw_counts: dict[str, int] = {}
        for m in members:
            for kw in kw_sets.get(m, set()):
                if kw in keywords:  # only heatmap keywords for interpretability
                    kw_counts[kw] = kw_counts.get(kw, 0) + 1
        top_kws = sorted(kw_counts.items(), key=lambda x: -x[1])[:5]
        comm_records.append({
            'id': comm_id,
            'members': members,
            'top_keywords': [kw for kw, _ in top_kws],
        })
        if len(comm_records) <= 3:
            print(f'  Community {comm_id}: {len(members)} members, '
                  f'top_kws={[kw for kw, _ in top_kws[:3]]}')

    print('\n[7] Computing force-directed layout...')
    pos = fruchterman_reingold(ids, edges, width=800, height=600, iterations=200)

    print('\n[8] Building output JSON...')
    agenda_by_id = {ag['id']: ag for ag in agendas}

    nodes_out = []
    for ag in agendas:
        aid = ag['id']
        x, y = pos.get(aid, (400.0, 300.0))
        nodes_out.append({
            'id':           aid,
            'name':         ag['agenda_name'],
            'domain':       ag['domain'],
            'big_category': ag['big_category'],
            'degree':       degree[aid],
            'community':    communities_map.get(aid, 0),
            'x':            round(x, 2),
            'y':            round(y, 2),
        })

    edges_out = [
        {'source': src, 'target': tgt, 'weight': w}
        for src, tgt, w in edges
    ]

    output = {
        'threshold': threshold,
        'nodes': nodes_out,
        'edges': edges_out,
        'communities': comm_records,
    }

    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, 'w', encoding='utf-8') as f:
        json.dump(output, f, ensure_ascii=False, indent=2)
    print(f'Wrote: {OUT_PATH}')

    print('\n=== Summary ===')
    print(f'  Nodes: {len(nodes_out)}')
    print(f'  Edges: {len(edges_out)} (threshold={threshold})')
    print(f'  Communities: {num_communities}')
    print(f'  Top 3 communities by size:')
    for cr in comm_records[:3]:
        print(f'    Community {cr["id"]}: {len(cr["members"])} members, kws={cr["top_keywords"][:3]}')
    print('\n=== Done ===')


if __name__ == '__main__':
    main()
