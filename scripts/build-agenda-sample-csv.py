"""
build-agenda-sample-csv.py
Generates a 5-row sample CSV + JSON from the 65 expert agendas.

Rules:
  - Split 65 agendas into 5 groups by id sequence:
      1조: ids 1-13, 2조: 14-26, 3조: 27-39, 4조: 40-52, 5조: 53-65
  - Pick 1 representative per group: highest keyword diversity
    (count of distinct heatmap-listed keywords in current_situation + proposed_policy + expected_effect)
    Tiebreaker: earliest id.
  - Generate Korean citizen question text from current_situation first 80 chars + "?"
  - Emit sample-agenda-questions.csv to public/sample/
  - Emit sample-agenda-questions.json to src/data/ (for offline fallback)

Column schema (matches live dashboard engine):
  순번, 일자, 채널, 지역, 분임, 답변자, 내용, 예정시간, 상태
  → JS keys: id, date, channel, region, group, expert, content, scheduled_time, status
  day is synthesised as 1 (workshop day 1)

Usage: python3 scripts/build-agenda-sample-csv.py
Run from wiki/ directory.
"""

import sys
import json
import csv
import os
import re

sys.stdout.reconfigure(encoding='utf-8')

WIKI_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
AGENDAS_PATH = os.path.join(WIKI_DIR, 'src', 'data', 'agendas-65.json')
MATRIX_PATH  = os.path.join(WIKI_DIR, 'src', 'data', 'domain-keyword-matrix.json')
OUT_CSV_DIR  = os.path.join(WIKI_DIR, 'public', 'sample')
OUT_CSV      = os.path.join(OUT_CSV_DIR, 'sample-agenda-questions.csv')
OUT_JSON     = os.path.join(WIKI_DIR, 'src', 'data', 'sample-agenda-questions.json')

# Fixed field values
DATE        = '2026-06-13'
CHANNEL     = '유튜브'
REGIONS     = ['서울', '대전', '대구', '광주', '부산']
EXPERT      = '공통'
TIMES       = ['14:00', '14:10', '14:20', '14:30', '14:40']
DEFAULT_STATUS = '대기'

# Group boundaries (1-indexed id ranges, inclusive)
GROUPS = [
    ('1조', range(1,  14)),   # ids 1-13
    ('2조', range(14, 27)),   # ids 14-26
    ('3조', range(27, 40)),   # ids 27-39
    ('4조', range(40, 53)),   # ids 40-52
    ('5조', range(53, 66)),   # ids 53-65
]


def load_data():
    with open(AGENDAS_PATH, encoding='utf-8') as f:
        agendas = json.load(f)
    with open(MATRIX_PATH, encoding='utf-8') as f:
        matrix_data = json.load(f)
    return agendas, matrix_data['keywords']


def keyword_diversity(agenda: dict, keywords: list[str]) -> int:
    """Count distinct keywords from heatmap list that appear in the 3 text fields."""
    combined = ' '.join([
        agenda.get('current_situation', ''),
        agenda.get('proposed_policy', ''),
        agenda.get('expected_effect', ''),
    ])
    return sum(1 for kw in keywords if kw in combined)


def pick_representative(group_agendas: list[dict], keywords: list[str]) -> dict:
    """Pick agenda with highest keyword diversity; tiebreak = earliest id."""
    scored = [(keyword_diversity(a, keywords), -a['id'], a) for a in group_agendas]
    scored.sort(reverse=True)
    return scored[0][2]


def make_question_text(agenda: dict) -> str:
    """Generate citizen question from current_situation first 80 chars."""
    situation = agenda.get('current_situation', '').strip()
    # Take first sentence (up to first period/newline) or 80 chars
    first_sentence = re.split(r'[\.\n]', situation)[0].strip()
    snippet = first_sentence[:80].strip()
    return f'(시민A) {snippet}?'


def main():
    print('=== build-agenda-sample-csv.py ===')

    agendas, keywords = load_data()
    agenda_by_id = {a['id']: a for a in agendas}

    print(f'Loaded {len(agendas)} agendas, {len(keywords)} heatmap keywords')

    rows = []
    for seq_num, (group_name, id_range) in enumerate(GROUPS, start=1):
        group_agendas = [agenda_by_id[i] for i in id_range if i in agenda_by_id]
        rep = pick_representative(group_agendas, keywords)
        diversity = keyword_diversity(rep, keywords)
        question = make_question_text(rep)

        row = {
            # CSV columns (Korean headers)
            '순번':   seq_num,
            '일자':   DATE,
            '채널':   CHANNEL,
            '지역':   REGIONS[seq_num - 1],
            '분임':   group_name,
            '답변자': EXPERT,
            '내용':   question,
            '예정시간': TIMES[seq_num - 1],
            '상태':   DEFAULT_STATUS,
            # Extended fields for JSON (JS engine keys)
            '_agenda_id':    rep['id'],
            '_agenda_title': rep['agenda_name'],
            '_diversity':    diversity,
            '_big_category': rep['big_category'],
        }
        rows.append(row)
        print(f'  {group_name}: agenda #{rep["id"]} ({rep["big_category"]}) '
              f'diversity={diversity} | {rep["agenda_name"][:40]}')

    # Write CSV (Korean headers, 5 data rows)
    os.makedirs(OUT_CSV_DIR, exist_ok=True)
    CSV_COLS = ['순번', '일자', '채널', '지역', '분임', '답변자', '내용', '예정시간', '상태']
    with open(OUT_CSV, 'w', encoding='utf-8-sig', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=CSV_COLS, extrasaction='ignore')
        writer.writeheader()
        writer.writerows(rows)
    print(f'Wrote CSV: {OUT_CSV}')

    # Write JSON (JS engine shape: id, day, channel, region, group, expert, content, scheduled_time, status)
    json_rows = []
    for row in rows:
        json_rows.append({
            'id':             row['순번'],
            'day':            1,                   # synthetic workshop day
            'date':           row['일자'],
            'channel':        row['채널'],
            'region':         row['지역'],
            'group':          row['분임'].replace('조', ''),  # "1" … "5"
            'expert':         row['답변자'],
            'content':        row['내용'],
            'scheduled_time': row['예정시간'] + ':00',  # HH:MM:SS for formatTime()
            'status':         row['상태'],
            # Metadata (non-engine, for reference)
            'agenda_id':      row['_agenda_id'],
            'agenda_title':   row['_agenda_title'],
            'big_category':   row['_big_category'],
        })

    with open(OUT_JSON, 'w', encoding='utf-8') as f:
        json.dump(json_rows, f, ensure_ascii=False, indent=2)
    print(f'Wrote JSON: {OUT_JSON}')

    print('\n=== 5-row preview ===')
    print(f'{'순번':>4} | {'지역':>4} | {'분임':>4} | {'의제':>40} | 질문내용[:50]')
    print('-' * 100)
    for row in rows:
        title = row['_agenda_title'][:40]
        q = row['내용'][:50]
        print(f"{row['순번']:>4} | {row['지역']:>4} | {row['분임']:>4} | {title:<40} | {q}")

    print('\n=== Done ===')


if __name__ == '__main__':
    main()
