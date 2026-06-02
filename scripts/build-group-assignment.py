"""
build-group-assignment.py
Produces deterministic group-assignment for all 65 expert agendas:
  - 15 groups, round-robin by (domain, id) [matches build-agenda-sample-15groups.py]
  - Top-2 representatives per group by keyword diversity (heatmap matrix)
  - Default expert assignment per agenda (감축→유종민 / 적응→김민경 / 혼합 또는 거버넌스→은재호)

Output:
  src/data/network/group-assignment.json
    {
      "groups": [
        {
          "id": 1,
          "members": [agenda_id, ...],
          "representatives": [agenda_id, agenda_id],
          "domains": [domain, ...],     # unique
          "categories": {감축:int, 적응:int, 혼합:int},
          "expert_default": "..."
        }, ...
      ]
    }

Usage: python scripts/build-group-assignment.py
"""

import sys, json, os
from collections import defaultdict, Counter

sys.stdout.reconfigure(encoding='utf-8')

WIKI_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
AGENDAS_PATH = os.path.join(WIKI_DIR, 'src', 'data', 'agendas-65.json')
MATRIX_PATH  = os.path.join(WIKI_DIR, 'src', 'data', 'domain-keyword-matrix.json')
OUT_PATH     = os.path.join(WIKI_DIR, 'src', 'data', 'network', 'group-assignment.json')

NUM_GROUPS = 15
EXPERT_MAP = {'감축': '유종민', '적응': '김민경', '혼합': '은재호'}
GOV_DOMAINS = {'기후정책 통합·조정', '기후회복사회·민관협력'}


def keyword_diversity(agenda: dict, keywords: list[str]) -> int:
    combined = ' '.join([
        agenda.get('current_situation', ''),
        agenda.get('proposed_policy', ''),
        agenda.get('expected_effect', ''),
    ])
    return sum(1 for kw in keywords if kw in combined)


def default_expert(agenda: dict) -> str:
    if agenda['domain'] in GOV_DOMAINS:
        return '은재호'
    return EXPERT_MAP.get(agenda['big_category'], '공통')


def main():
    print('=== build-group-assignment.py ===')
    with open(AGENDAS_PATH, encoding='utf-8') as f:
        agendas = json.load(f)
    with open(MATRIX_PATH, encoding='utf-8') as f:
        keywords = json.load(f)['keywords']

    sorted_agendas = sorted(agendas, key=lambda a: (a['domain'], a['id']))
    groups: dict[int, list[dict]] = defaultdict(list)
    for i, a in enumerate(sorted_agendas):
        g = (i % NUM_GROUPS) + 1
        groups[g].append(a)

    out = {'groups': []}
    for g in range(1, NUM_GROUPS + 1):
        members = groups[g]
        scored = sorted(members, key=lambda a: (-keyword_diversity(a, keywords), a['id']))
        reps = [scored[0]['id'], scored[1]['id'] if len(scored) > 1 else scored[0]['id']]
        cats = Counter(a['big_category'] for a in members)
        domains = sorted({a['domain'] for a in members})
        # expert per group: majority by big_category
        top_cat = cats.most_common(1)[0][0]
        if any(a['domain'] in GOV_DOMAINS for a in members if a['id'] in reps):
            expert = '은재호'
        else:
            expert = EXPERT_MAP.get(top_cat, '공통')

        out['groups'].append({
            'id': g,
            'members': [a['id'] for a in members],
            'representatives': reps,
            'domains': domains,
            'categories': dict(cats),
            'expert_default': expert,
        })
        print(f'  {g:>2}조: {len(members)}건 · reps={reps} · {dict(cats)} · {expert}')

    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
    print(f'\nWrote {OUT_PATH}')


if __name__ == '__main__':
    main()
