"""
build-agenda-sample-15groups.py
Generates a 30-row (15 groups × 2 questions) simulation dataset for the
6.13 워크숍 (국립생태원, 200명, 15 분임조).

Algorithm:
  1. Load agendas-65.json
  2. Round-robin assignment to 15 groups by (domain, id) sort — each group
     gets 4-5 agendas with diverse domains.
  3. Per group: pick top-2 by keyword diversity (heatmap list). Tiebreak = earliest id.
  4. Expert assignment per row:
       감축  → 유종민
       적응  → 김민경
       혼합 / 기후정책 통합·조정 domain → 은재호
       ~10-15% randomly overridden to 공통 (fixed seed for reproducibility)
  5. Schedule: 14:00, +3min each row; 15-min break inserted after row 15.
  6. Regions: cycle across 6 regions (서울·서울미래·대전·대구·광주·부산).
  7. Citizen text: first sentence of current_situation (≤80 chars) + "?"
     Anonymize as (시민A)–(시민E) cycling per every 6 rows.
  8. Columns: 순번,일자,채널,지역,분임,답변자,내용,예정시간,상태

Output:
  public/sample/sample-agenda-15groups.csv
  src/data/sample-agenda-15groups.json

Usage: python scripts/build-agenda-sample-15groups.py
Run from wiki/ directory.
"""

import sys
import json
import csv
import os
import re
import random
from datetime import datetime, timedelta
from collections import defaultdict

sys.stdout.reconfigure(encoding='utf-8')

WIKI_DIR    = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
AGENDAS_PATH = os.path.join(WIKI_DIR, 'src', 'data', 'agendas-65.json')
MATRIX_PATH  = os.path.join(WIKI_DIR, 'src', 'data', 'domain-keyword-matrix.json')
OUT_CSV_DIR  = os.path.join(WIKI_DIR, 'public', 'sample')
OUT_CSV      = os.path.join(OUT_CSV_DIR, 'sample-agenda-15groups.csv')
OUT_JSON     = os.path.join(WIKI_DIR, 'src', 'data', 'sample-agenda-15groups.json')

NUM_GROUPS   = 15
DATE         = '2026-06-13'
CHANNEL      = '유튜브'
REGIONS      = ['서울', '서울미래', '대전', '대구', '광주', '부산']
CITIZEN_LETTERS = ['A', 'B', 'C', 'D', 'E']

# Fixed seed for reproducible 공통 override (~13% of 30 = ~4 rows)
RANDOM_SEED  = 613
COMMON_PROB  = 0.13

EXPERT_MAP = {
    '감축': '유종민',
    '적응': '김민경',
    '혼합': '은재호',
}
# Extra domains that go to 은재호 regardless of big_category
GOV_DOMAINS = {'기후정책 통합·조정', '기후회복사회·민관협력'}


def load_data():
    with open(AGENDAS_PATH, encoding='utf-8') as f:
        agendas = json.load(f)
    with open(MATRIX_PATH, encoding='utf-8') as f:
        matrix_data = json.load(f)
    return agendas, matrix_data['keywords']


def assign_groups(agendas: list[dict]) -> dict[int, list[dict]]:
    """
    Round-robin by (domain, id) so each group gets diverse domains.
    Returns {group_num (1-15): [agenda, ...]}
    """
    sorted_agendas = sorted(agendas, key=lambda a: (a['domain'], a['id']))
    groups: dict[int, list[dict]] = defaultdict(list)
    for i, agenda in enumerate(sorted_agendas):
        group_num = (i % NUM_GROUPS) + 1
        groups[group_num].append(agenda)
    return groups


def keyword_diversity(agenda: dict, keywords: list[str]) -> int:
    combined = ' '.join([
        agenda.get('current_situation', ''),
        agenda.get('proposed_policy', ''),
        agenda.get('expected_effect', ''),
    ])
    return sum(1 for kw in keywords if kw in combined)


def pick_top2(group_agendas: list[dict], keywords: list[str]) -> list[dict]:
    """Pick top-2 by keyword diversity; tiebreak = earliest id."""
    scored = [(keyword_diversity(a, keywords), -a['id'], a) for a in group_agendas]
    scored.sort(reverse=True)
    return [s[2] for s in scored[:2]]


def make_question_text(agenda: dict, letter: str) -> str:
    situation = agenda.get('current_situation', '').strip()
    # Strip leading bullet markers first, then split on sentence boundary
    cleaned = re.sub(r'^[○•·\s]+', '', situation).strip()
    # Split on period or newline (○ is used as list separator — don't split on it)
    parts = re.split(r'[.\n]', cleaned)
    first_sentence = ''
    for part in parts:
        candidate = re.sub(r'^[○•·\s]+', '', part).strip()
        if len(candidate) > 10:
            first_sentence = candidate
            break
    snippet = first_sentence[:75].strip()
    return f'(시민{letter}) {snippet}?'


def assign_expert(agenda: dict) -> str:
    if agenda['domain'] in GOV_DOMAINS:
        return '은재호'
    return EXPERT_MAP.get(agenda['big_category'], '공통')


def build_schedule() -> list[str]:
    """
    30 time slots: rows 1-15 from 14:00 (+3min each),
    then 15-min break, rows 16-30 continue.
    """
    times = []
    t = datetime(2026, 6, 13, 14, 0)
    # First 15 rows
    for _ in range(15):
        times.append(t.strftime('%H:%M'))
        t += timedelta(minutes=3)
    # 15-minute break after row 15
    t += timedelta(minutes=15)
    # Rows 16-30
    for _ in range(15):
        times.append(t.strftime('%H:%M'))
        t += timedelta(minutes=3)
    return times


def main():
    print('=== build-agenda-sample-15groups.py ===')
    agendas, keywords = load_data()
    print(f'Loaded {len(agendas)} agendas, {len(keywords)} heatmap keywords')

    groups = assign_groups(agendas)
    print(f'Assigned to {len(groups)} groups:')
    for g in range(1, NUM_GROUPS + 1):
        domains = [a['domain'][:8] for a in groups[g]]
        print(f'  {g:>2}조: {len(groups[g])} agendas — {domains}')

    # Pick 2 representatives per group — row order: group 1 Q1, group 2 Q1... group 15 Q1,
    # then group 1 Q2 ... group 15 Q2
    # slot_index 0..14 = first question per group (groups 1-15)
    # slot_index 15..29 = second question per group (groups 1-15)
    schedule = build_schedule()
    rng = random.Random(RANDOM_SEED)

    rows = []
    seq = 1
    for wave in range(2):  # wave 0 = 1st question, wave 1 = 2nd question
        for group_num in range(1, NUM_GROUPS + 1):
            slot_idx = wave * 15 + (group_num - 1)
            group_agendas = groups[group_num]
            top2 = pick_top2(group_agendas, keywords)

            if wave < len(top2):
                agenda = top2[wave]
            else:
                # Fallback if group has <2 agendas (shouldn't happen with 65/15)
                agenda = top2[0]

            # Region: cycle by group_num (1-indexed)
            region = REGIONS[(group_num - 1) % len(REGIONS)]

            # Citizen letter: cycle A-E per every 6 rows (slot_idx // 6)
            letter = CITIZEN_LETTERS[(slot_idx // 6) % len(CITIZEN_LETTERS)]

            # Expert assignment
            expert = assign_expert(agenda)
            # Random override to 공통 (~13%)
            if rng.random() < COMMON_PROB:
                expert = '공통'

            question = make_question_text(agenda, letter)
            time_str = schedule[slot_idx]
            group_label = f'{group_num}조'

            row = {
                '순번':    seq,
                '일자':    DATE,
                '채널':    CHANNEL,
                '지역':    region,
                '분임':    group_label,
                '답변자':  expert,
                '내용':    question,
                '예정시간': time_str,
                '상태':    '대기',
                # metadata
                '_agenda_id':    agenda['id'],
                '_agenda_title': agenda['agenda_name'],
                '_big_category': agenda['big_category'],
                '_domain':       agenda['domain'],
                '_wave':         wave + 1,
            }
            rows.append(row)
            seq += 1

    # Write CSV
    os.makedirs(OUT_CSV_DIR, exist_ok=True)
    CSV_COLS = ['순번', '일자', '채널', '지역', '분임', '답변자', '내용', '예정시간', '상태']
    with open(OUT_CSV, 'w', encoding='utf-8-sig', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=CSV_COLS, extrasaction='ignore')
        writer.writeheader()
        writer.writerows(rows)
    print(f'\nWrote CSV ({len(rows)} rows): {OUT_CSV}')

    # Write JSON (JS engine shape)
    json_rows = []
    for row in rows:
        json_rows.append({
            'id':             row['순번'],
            'day':            1,
            'date':           row['일자'],
            'channel':        row['채널'],
            'region':         row['지역'],
            'group':          row['분임'].replace('조', ''),
            'expert':         row['답변자'],
            'content':        row['내용'],
            'scheduled_time': row['예정시간'] + ':00',
            'status':         row['상태'],
            'agenda_id':      row['_agenda_id'],
            'agenda_title':   row['_agenda_title'],
            'big_category':   row['_big_category'],
        })
    with open(OUT_JSON, 'w', encoding='utf-8') as f:
        json.dump(json_rows, f, ensure_ascii=False, indent=2)
    print(f'Wrote JSON ({len(json_rows)} rows): {OUT_JSON}')

    # Summary stats
    from collections import Counter
    expert_dist = Counter(r['답변자'] for r in rows)
    print('\n--- Expert distribution ---')
    for expert, count in sorted(expert_dist.items(), key=lambda x: -x[1]):
        print(f'  {expert}: {count}')

    print('\n--- Domain distribution per group ---')
    for g in range(1, NUM_GROUPS + 1):
        grp_rows = [r for r in rows if r['분임'] == f'{g}조']
        domains = [r['_domain'][:12] for r in grp_rows]
        cats = [r['_big_category'] for r in grp_rows]
        print(f'  {g:>2}조: {cats} | {domains}')

    print('\n--- Schedule preview (first 3, break marker, last 3) ---')
    for r in rows[:3]:
        print(f"  {r['순번']:>2}. {r['예정시간']} | {r['분임']} | {r['답변자']:>4} | {r['내용'][:60]}")
    print(f'  ... [15-min break after row 15, resumes {schedule[15]}] ...')
    for r in rows[27:]:
        print(f"  {r['순번']:>2}. {r['예정시간']} | {r['분임']} | {r['답변자']:>4} | {r['내용'][:60]}")

    print('\n=== Done ===')


if __name__ == '__main__':
    main()
