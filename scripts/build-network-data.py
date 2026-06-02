"""
build-network-data.py
Extracts domain×keyword matrix from:
  - 2._기후시민회의_전문가_의제_제안.docx (65 expert agendas)
  - 30_추출데이터/network_pypdf.txt (keyword universe from PDF network analysis)

Outputs:
  - src/data/domain-keyword-matrix.json
  - src/data/agendas-65.json

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
    Returns list of agenda dicts and ordered domain list.
    """
    doc = docx_lib.Document(docx_path)

    # Domain header pattern: "감축 영역 N. 이름" / "적응 영역 N. 이름"
    #                        / "감축·적응 영역 N. 이름"
    domain_re = re.compile(
        r'^(감축(?:·적응)?|적응)\s+영역\s+\d+[.\s]\s*(.+?)$'
    )

    # Walk all body XML children in document order to get paragraphs + tables
    # python-docx exposes doc.element.body children
    from docx.oxml.ns import qn

    agendas = []
    current_domain = None
    current_big_cat = None

    body = doc.element.body

    for child in body:
        tag = child.tag.split('}')[-1] if '}' in child.tag else child.tag

        if tag == 'p':
            # It's a paragraph
            text = ''.join(r.text or '' for r in child.iter(qn('w:t'))).strip()
            m = domain_re.match(text)
            if m:
                raw_cat = m.group(1)  # 감축 / 적응 / 감축·적응
                domain_name = m.group(2).strip()
                if '적응' in raw_cat and '감축' in raw_cat:
                    current_big_cat = '혼합'
                elif raw_cat == '감축':
                    current_big_cat = '감축'
                else:
                    current_big_cat = '적응'
                current_domain = domain_name
                print(f"  [domain] {current_big_cat} / {current_domain}")

        elif tag == 'tbl':
            if current_domain is None:
                continue
            # Parse table: 5 rows × 4 cols
            # Row 0: 의제명 | title | title | title  (merged cols)
            # Row 1: 감축/적응 | cat | 영역 | domain
            # Row 2: 관련 현황 및 의제 필요성 | text...
            # Row 3: 의제 관련 제안 정책 | text...
            # Row 4: 기대효과 | text...
            rows = child.findall('.//' + qn('w:tr'))
            def row_text(row_elem, col_idx=1):
                cells = row_elem.findall('.//' + qn('w:tc'))
                if col_idx < len(cells):
                    return ''.join(
                        t.text or '' for t in cells[col_idx].iter(qn('w:t'))
                    ).strip()
                return ''

            try:
                title_row = rows[0]
                title = row_text(title_row, 1)

                situation = row_text(rows[2], 1) if len(rows) > 2 else ''
                policy = row_text(rows[3], 1) if len(rows) > 3 else ''
                effect = row_text(rows[4], 1) if len(rows) > 4 else ''
            except Exception as e:
                print(f"  [warn] table parse error: {e}")
                continue

            agenda = {
                'id': len(agendas) + 1,
                'big_category': current_big_cat,
                'domain': current_domain,
                'agenda_name': title,
                'current_situation': situation,
                'proposed_policy': policy,
                'expected_effect': effect,
            }
            agendas.append(agenda)

    return agendas

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

# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    print("=== build-network-data.py ===")

    print("\n[1] Extracting keyword universe from PDF text...")
    keywords = extract_keywords(PDF_TEXT_PATH)

    print("\n[2] Parsing 65 agendas from docx...")
    agendas = parse_agendas(DOCX_PATH)
    print(f"  Total agendas parsed: {len(agendas)}")

    print("\n[3] Building domain×keyword matrix...")
    matrix_data = build_matrix(agendas, keywords)

    print("\n[4] Writing output files...")
    os.makedirs(os.path.dirname(OUT_MATRIX), exist_ok=True)

    with open(OUT_MATRIX, 'w', encoding='utf-8') as f:
        json.dump(matrix_data, f, ensure_ascii=False, indent=2)
    print(f"  Wrote: {OUT_MATRIX}")

    with open(OUT_AGENDAS, 'w', encoding='utf-8') as f:
        json.dump(agendas, f, ensure_ascii=False, indent=2)
    print(f"  Wrote: {OUT_AGENDAS}")

    print("\n=== Done ===")

if __name__ == '__main__':
    main()
