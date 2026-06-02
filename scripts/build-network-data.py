"""
build-network-data.py
Extracts domain×keyword matrix and cluster data from:
  - 2._기후시민회의_전문가_의제_제안.docx (65 expert agendas)
  - 30_추출데이터/network_pypdf.txt (keyword universe + cluster definitions)

Outputs:
  - src/data/domain-keyword-matrix.json   (18 domains × 63 keywords)
  - src/data/agendas-65.json              (65 agenda records)
  - src/data/network/clusters.json        (6 networks × clusters × top keywords)
  - src/data/network/cluster-to-agendas.json  (cluster → agenda id list)

Usage: python3 scripts/build-network-data.py
Run from the wiki/ directory.
"""

import sys
import json
import re
import os

sys.stdout.reconfigure(encoding='utf-8')

# ── Paths ──────────────────────────────────────────────────────────────────────
WIKI_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DOCX_PATH = os.path.join(
    WIKI_DIR, '..', '2._기후시민회의_전문가_의제_제안.docx'
)
PDF_TEXT_PATH = os.path.join(
    WIKI_DIR, '..', '30_추출데이터', 'network_pypdf.txt'
)
OUT_MATRIX = os.path.join(WIKI_DIR, 'src', 'data', 'domain-keyword-matrix.json')
OUT_AGENDAS = os.path.join(WIKI_DIR, 'src', 'data', 'agendas-65.json')
OUT_NETWORK_DIR = os.path.join(WIKI_DIR, 'src', 'data', 'network')
OUT_CLUSTERS = os.path.join(OUT_NETWORK_DIR, 'clusters.json')
OUT_CLUSTER_AGENDAS = os.path.join(OUT_NETWORK_DIR, 'cluster-to-agendas.json')

# ── Step 1: Extract keyword universe from PDF text ────────────────────────────

# Pages in network_pypdf.txt that contain the scatter-plot keyword lists:
# Page 3  → 감축:현황 (top25)
# Page 6  → 감축:제안정책 (top25)
# Page 9  → 감축:기대효과 (top25)
# Page 13 → 적응:현황 (top25)
# Page 16 → 적응:제안정책 (top25)
# Page 19 → 적응:기대효과 (top25)
KEYWORD_PAGES = {3, 6, 9, 13, 16, 19}

# Lines to skip inside keyword pages
SKIP_PATTERNS = re.compile(
    r'^(감축|적응|혼합|Top\s*25|Betweeness|Frequency|=== PAGE|\d[\d.\s]*$)'
    r'|[A-Za-z]',
    re.IGNORECASE
)

def is_pure_hangul_token(s: str) -> bool:
    """True if string is composed entirely of hangul characters (2-8 chars)."""
    s = s.strip()
    if not (2 <= len(s) <= 8):
        return False
    return bool(re.match(r'^[가-힣]+$', s))

def extract_keywords(pdf_text_path: str) -> list[str]:
    """Parse the pre-extracted PDF text and return unique keyword list."""
    current_page = None
    collecting = False
    raw_keywords: list[str] = []

    with open(pdf_text_path, encoding='utf-8') as f:
        for line in f:
            line = line.rstrip()
            page_match = re.match(r'=== PAGE (\d+) ===', line)
            if page_match:
                current_page = int(page_match.group(1))
                collecting = (current_page in KEYWORD_PAGES)
                continue

            if not collecting:
                continue

            # Each line in keyword pages may be one token or a glued pair
            # Split on hangul word boundaries at obvious glue points
            # We keep glued tokens as-is and report them to the user
            candidates = re.findall(r'[가-힣]+', line)
            for c in candidates:
                # Filter axis labels that sneak in as hangul (e.g. single chars)
                if len(c) >= 2:
                    raw_keywords.append(c)

    # Dedup while preserving first-seen order
    seen: set[str] = set()
    keywords: list[str] = []
    glued: list[str] = []

    for kw in raw_keywords:
        if kw in seen:
            continue
        seen.add(kw)
        # Flag suspiciously long tokens (likely glued)
        if len(kw) > 5:
            glued.append(kw)
        keywords.append(kw)

    print(f"[keywords] Raw extracted: {len(raw_keywords)}, unique: {len(keywords)}")
    if glued:
        print(f"[keywords] Possible glued tokens ({len(glued)}): {glued}")

    return keywords

# ── Step 2: Parse docx 65 agendas ────────────────────────────────────────────

import docx as docx_lib

def parse_agendas(docx_path: str):
    """
    Walk docx paragraphs (domain headers) and tables (one per agenda).

    Two-pass approach:
      Pass 1: Collect ALL 20 domain headers in order (some may have 0 agendas).
      Pass 2: Assign each agenda table to the most-recently-seen domain header.

    Domain identity is (big_category, domain_name) — NOT domain_name alone.
    Two domains share the name '기후정책 통합·조정' but differ in big_category
    (감축 vs 혼합). They must remain as distinct rows.
    """
    doc = docx_lib.Document(docx_path)

    domain_re = re.compile(
        r'^(감축(?:·적응)?|적응)\s+영역\s+\d+[.\s]\s*(.+?)$'
    )

    from docx.oxml.ns import qn

    body = doc.element.body

    # ── Pass 1: collect ordered domain headers ────────────────────────────────
    # Each entry: (big_category, domain_name)
    domain_order: list[tuple[str, str]] = []
    seen_domain_keys: set[tuple[str, str]] = set()

    for child in body:
        tag = child.tag.split('}')[-1] if '}' in child.tag else child.tag
        if tag != 'p':
            continue
        text = ''.join(r.text or '' for r in child.iter(qn('w:t'))).strip()
        m = domain_re.match(text)
        if not m:
            continue
        raw_cat = m.group(1)
        domain_name = m.group(2).strip()
        if '적응' in raw_cat and '감축' in raw_cat:
            big_cat = '혼합'
        elif raw_cat == '감축':
            big_cat = '감축'
        else:
            big_cat = '적응'
        key = (big_cat, domain_name)
        if key not in seen_domain_keys:
            domain_order.append(key)
            seen_domain_keys.add(key)
            print(f"  [domain] {big_cat} / {domain_name}")

    print(f"  Total domain headers found: {len(domain_order)}")

    # ── Pass 2: assign tables to domains ─────────────────────────────────────
    agendas: list[dict] = []
    current_key: tuple[str, str] | None = None

    def row_text(row_elem, col_idx: int = 1) -> str:
        cells = row_elem.findall('.//' + qn('w:tc'))
        if col_idx < len(cells):
            return ''.join(
                t.text or '' for t in cells[col_idx].iter(qn('w:t'))
            ).strip()
        return ''

    for child in body:
        tag = child.tag.split('}')[-1] if '}' in child.tag else child.tag

        if tag == 'p':
            text = ''.join(r.text or '' for r in child.iter(qn('w:t'))).strip()
            m = domain_re.match(text)
            if m:
                raw_cat = m.group(1)
                domain_name = m.group(2).strip()
                if '적응' in raw_cat and '감축' in raw_cat:
                    big_cat = '혼합'
                elif raw_cat == '감축':
                    big_cat = '감축'
                else:
                    big_cat = '적응'
                current_key = (big_cat, domain_name)

        elif tag == 'tbl':
            if current_key is None:
                continue
            rows = child.findall('.//' + qn('w:tr'))
            try:
                title = row_text(rows[0], 1)
                situation = row_text(rows[2], 1) if len(rows) > 2 else ''
                policy = row_text(rows[3], 1) if len(rows) > 3 else ''
                effect = row_text(rows[4], 1) if len(rows) > 4 else ''
            except Exception as e:
                print(f"  [warn] table parse error: {e}")
                continue

            big_cat, domain_name = current_key
            agenda = {
                'id': len(agendas) + 1,
                'big_category': big_cat,
                'domain': domain_name,
                'agenda_name': title,
                'current_situation': situation,
                'proposed_policy': policy,
                'expected_effect': effect,
            }
            agendas.append(agenda)

    return agendas, domain_order

# ── Step 3: Build domain×keyword frequency matrix ─────────────────────────────

def build_matrix(agendas: list[dict], keywords: list[str]):
    """
    Rows = domains (ordered: 감축 8 → 적응 10 → 혼합 2).
    Cols = keywords sorted by total frequency descending.
    Cell = substring count of keyword in concat(current_situation + proposed_policy + expected_effect).
    """

    # Ordered domain list: 감축 first, then 적응, then 혼합
    감축_domains = []
    적응_domains = []
    혼합_domains = []
    seen_domains: set[str] = set()

    for ag in agendas:
        d = ag['domain']
        if d in seen_domains:
            continue
        seen_domains.add(d)
        if ag['big_category'] == '감축':
            감축_domains.append((d, ag['big_category']))
        elif ag['big_category'] == '적응':
            적응_domains.append((d, ag['big_category']))
        else:
            혼합_domains.append((d, ag['big_category']))

    ordered_domains = 감축_domains + 적응_domains + 혼합_domains
    domain_names = [d for d, _ in ordered_domains]
    domain_cats = {d: cat for d, cat in ordered_domains}

    # Build per-domain text corpus
    domain_texts: dict[str, str] = {d: '' for d in domain_names}
    for ag in agendas:
        d = ag['domain']
        combined = ' '.join([
            ag.get('current_situation', ''),
            ag.get('proposed_policy', ''),
            ag.get('expected_effect', ''),
        ])
        domain_texts[d] = domain_texts.get(d, '') + ' ' + combined

    # Compute raw frequency matrix (domain × keyword)
    raw_matrix: list[list[int]] = []
    for d in domain_names:
        text = domain_texts[d]
        row = [text.count(kw) for kw in keywords]
        raw_matrix.append(row)

    # Sort keywords by total frequency descending
    col_totals = [sum(raw_matrix[r][c] for r in range(len(domain_names)))
                  for c in range(len(keywords))]
    sorted_indices = sorted(range(len(keywords)), key=lambda c: -col_totals[c])

    # Filter keywords with total=0
    sorted_indices = [i for i in sorted_indices if col_totals[i] > 0]

    sorted_keywords = [keywords[i] for i in sorted_indices]
    sorted_matrix = [
        [raw_matrix[r][i] for i in sorted_indices]
        for r in range(len(domain_names))
    ]

    print(f"[matrix] Domains: {len(domain_names)}, Keywords (non-zero): {len(sorted_keywords)}")
    print(f"[matrix] Top 10 keywords by total freq:")
    for i in range(min(10, len(sorted_indices))):
        orig_i = sorted_indices[i]
        print(f"  {i+1}. {keywords[orig_i]}: {col_totals[orig_i]}")

    return {
        'domains': domain_names,
        'domain_categories': domain_cats,
        'keywords': sorted_keywords,
        'matrix': sorted_matrix,
    }

# ── Step 4: Parse clusters from PDF text ─────────────────────────────────────
#
# Network layout in network_pypdf.txt:
#   감축·현황       → keyword scatter p3, cluster names p4, narratives p5
#   감축·정책       → keyword scatter p6, cluster names p7, narratives p8
#   감축·기대효과   → keyword scatter p9, cluster names p10, narratives p11
#   적응·현황       → keyword scatter p13, cluster names p14, narratives p15
#   적응·정책       → keyword scatter p16, cluster names p17, narratives p18
#   적응·기대효과   → keyword scatter p19, cluster names p20, narratives p21
#
# Rule: PDF Row N = docx agenda id N (1-indexed), i.e. agendas[N-1]
#

NETWORKS = [
    {'id': '감축-현황',   'label': '감축 · 현황',   'name_page': 4,  'narr_page': 5},
    {'id': '감축-정책',   'label': '감축 · 제안정책', 'name_page': 7,  'narr_page': 8},
    {'id': '감축-효과',   'label': '감축 · 기대효과', 'name_page': 10, 'narr_page': 11},
    {'id': '적응-현황',   'label': '적응 · 현황',   'name_page': 14, 'narr_page': 15},
    {'id': '적응-정책',   'label': '적응 · 제안정책', 'name_page': 17, 'narr_page': 18},
    {'id': '적응-효과',   'label': '적응 · 기대효과', 'name_page': 20, 'narr_page': 21},
]

# Color palette for clusters (up to 4 per network)
CLUSTER_COLORS = ['#58a6ff', '#3fb950', '#e3b341', '#f85149']


def parse_clusters(pdf_text_path: str) -> tuple[list, dict]:
    """
    Returns:
      clusters: list of network records, each with cluster list.
      cluster_rows: dict mapping (network_id, cluster_idx) -> set of Row numbers
    """
    # Parse pages into a dict
    pages: dict[int, list[str]] = {}
    current_page = None

    with open(pdf_text_path, encoding='utf-8') as f:
        for line in f:
            line = line.rstrip()
            page_match = re.match(r'=== PAGE (\d+) ===', line)
            if page_match:
                current_page = int(page_match.group(1))
                pages[current_page] = []
                continue
            if current_page is not None:
                pages[current_page].append(line)

    # Extract cluster names from name pages (numbered list "1. ...\n2. ...\n...")
    # Also handle inline concatenation like "2. A 3. B" on the same line.
    name_pattern = re.compile(r'^\d+\.\s+(.+)$')

    # Extract Row references from narrative pages
    row_pattern = re.compile(r'\(Row\s+(\d+)\)')

    # Extract quoted text (using Korean curly quotes)
    # quote_pattern = re.compile(r'["“](.*?)["”]', re.DOTALL)

    clusters_out = []
    cluster_to_rows: dict[str, list[int]] = {}  # "network_id:cluster_idx" -> row ids

    for net in NETWORKS:
        name_lines = pages.get(net['name_page'], [])
        narr_lines = pages.get(net['narr_page'], [])

        # --- Extract cluster names ---
        # First, join all lines from the name page and split on "N. " patterns
        # This handles PDF artifacts where multiple items appear on one line.
        raw_name_text = ' '.join(name_lines)
        # Split on numbered pattern like "1. " "2. " etc.
        inline_split = re.split(r'\d+\.\s+', raw_name_text)
        inline_split = [s.strip() for s in inline_split if s.strip()]
        # Filter out items that are purely page footers (start with "감축:" or "적응:")
        footer_pat = re.compile(r'^(감축|적응)[:\s·]')
        # Strip trailing footer fragments — only if the pattern looks like a page header
        # Footer pattern: "감축: 관련 현황..." or "적응: 의제관련..." at word boundary
        trailing_footer = re.compile(r'\s+(감축|적응):\s+(관련|의제관련|제안\s*정책\s*시행).+$')
        cleaned = []
        for s in inline_split:
            if footer_pat.match(s):
                continue
            if len(s) <= 2:
                continue
            # Strip trailing footer text
            s = trailing_footer.sub('', s).strip()
            if s:
                cleaned.append(s)
        cluster_names = cleaned

        if not cluster_names:
            print(f"  [warn] No cluster names found for {net['id']} (page {net['name_page']})")
            cluster_names = ['클러스터 1', '클러스터 2', '클러스터 3']

        # --- Extract Row references from narrative page ---
        narr_text = '\n'.join(narr_lines)
        all_rows = [int(r) for r in row_pattern.findall(narr_text)]

        # --- Split narrative by cluster name occurrences ---
        # Strategy: find each cluster name occurrence in narr_text, split there
        cluster_segments: list[str] = []
        split_positions: list[int] = [0]
        for cname in cluster_names:
            # Find first occurrence of the cluster name in narrative
            pos = narr_text.find(cname)
            if pos > 0:
                split_positions.append(pos)
        split_positions.sort()
        split_positions.append(len(narr_text))

        for i in range(len(split_positions) - 1):
            seg = narr_text[split_positions[i]:split_positions[i + 1]].strip()
            cluster_segments.append(seg)

        # Align segments to cluster count
        while len(cluster_segments) < len(cluster_names):
            cluster_segments.append('')
        cluster_segments = cluster_segments[:len(cluster_names)]

        # --- Build cluster records ---
        net_clusters = []
        for ci, (cname, seg) in enumerate(zip(cluster_names, cluster_segments)):
            # Row references in this segment
            rows_in_seg = [int(r) for r in row_pattern.findall(seg)]
            # If we couldn't segment well, distribute all rows evenly
            if not rows_in_seg and all_rows:
                chunk_size = max(1, len(all_rows) // len(cluster_names))
                chunk_start = ci * chunk_size
                rows_in_seg = all_rows[chunk_start:chunk_start + chunk_size]

            # Extract a brief narrative (first 120 chars after cluster name)
            brief = ''
            cname_pos = seg.find(cname)
            if cname_pos >= 0:
                after = seg[cname_pos + len(cname):].strip()
                brief = after[:200].replace('\n', ' ')
            elif seg:
                brief = seg[:200].replace('\n', ' ')

            key = f"{net['id']}:{ci}"
            cluster_to_rows[key] = sorted(set(rows_in_seg))

            net_clusters.append({
                'idx': ci,
                'name': cname,
                'color': CLUSTER_COLORS[ci % len(CLUSTER_COLORS)],
                'row_refs': sorted(set(rows_in_seg)),
                'narrative': brief,
            })

        clusters_out.append({
            'id': net['id'],
            'label': net['label'],
            'clusters': net_clusters,
        })

        total_rows = sum(len(c['row_refs']) for c in net_clusters)
        print(f"  [{net['id']}] {len(net_clusters)} clusters, {total_rows} Row refs")

    return clusters_out, cluster_to_rows


def build_cluster_to_agendas(cluster_to_rows: dict, total_agendas: int) -> dict:
    """
    Maps cluster key -> list of agenda ids using PDF Row N = agenda id N.
    cluster_to_rows: { "network_id:cluster_idx": [row_nums, ...] }
    Returns: same shape but with agenda_ids list instead of row_refs.
    """
    result = {}
    for key, rows in cluster_to_rows.items():
        # Row N = agenda id N (1-indexed). Clamp to valid range.
        agenda_ids = [r for r in rows if 1 <= r <= total_agendas]
        result[key] = agenda_ids
    return result


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    print("=== build-network-data.py ===")

    print("\n[1] Extracting keyword universe from PDF text...")
    keywords = extract_keywords(PDF_TEXT_PATH)

    print("\n[2] Parsing 65 agendas from docx...")
    agendas, _domain_order = parse_agendas(DOCX_PATH)
    print(f"  Total agendas parsed: {len(agendas)}")

    print("\n[3] Building domain×keyword matrix...")
    matrix_data = build_matrix(agendas, keywords)

    print("\n[4] Parsing cluster definitions from PDF text...")
    clusters, cluster_to_rows = parse_clusters(PDF_TEXT_PATH)
    total_clusters = sum(len(n['clusters']) for n in clusters)
    print(f"  Total clusters: {total_clusters} across {len(clusters)} networks")

    print("\n[5] Building cluster→agenda mapping...")
    cluster_agenda_map = build_cluster_to_agendas(cluster_to_rows, len(agendas))
    total_mappings = sum(len(v) for v in cluster_agenda_map.values())
    print(f"  Total cluster→agenda mappings: {total_mappings}")

    print("\n[6] Writing output files...")
    os.makedirs(os.path.dirname(OUT_MATRIX), exist_ok=True)
    os.makedirs(OUT_NETWORK_DIR, exist_ok=True)

    with open(OUT_MATRIX, 'w', encoding='utf-8') as f:
        json.dump(matrix_data, f, ensure_ascii=False, indent=2)
    print(f"  Wrote: {OUT_MATRIX}")

    with open(OUT_AGENDAS, 'w', encoding='utf-8') as f:
        json.dump(agendas, f, ensure_ascii=False, indent=2)
    print(f"  Wrote: {OUT_AGENDAS}")

    with open(OUT_CLUSTERS, 'w', encoding='utf-8') as f:
        json.dump(clusters, f, ensure_ascii=False, indent=2)
    print(f"  Wrote: {OUT_CLUSTERS}")

    with open(OUT_CLUSTER_AGENDAS, 'w', encoding='utf-8') as f:
        json.dump(cluster_agenda_map, f, ensure_ascii=False, indent=2)
    print(f"  Wrote: {OUT_CLUSTER_AGENDAS}")

    # Summary
    print("\n=== Row counts ===")
    print(f"  agendas-65.json: {len(agendas)} agendas")
    print(f"  domain-keyword-matrix.json: {len(matrix_data['domains'])} domains × {len(matrix_data['keywords'])} keywords ({len(matrix_data['domains']) * len(matrix_data['keywords'])} cells)")
    print(f"  clusters.json: {len(clusters)} networks, {total_clusters} clusters")
    print(f"  cluster-to-agendas.json: {len(cluster_agenda_map)} cluster keys, {total_mappings} total mappings")
    print("\n=== Done ===")

if __name__ == '__main__':
    main()
