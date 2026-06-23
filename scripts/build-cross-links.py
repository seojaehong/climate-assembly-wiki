# -*- coding: utf-8 -*-
"""워크숍↔운영규정 cross-link JSON 빌더 (v1, 키워드 overlap).

input:
  public/workshop-graph/data/workshop-2026-06-13.json
  public/workshop-graph/data/regulation-2026-06-13.json
output:
  public/workshop-graph/data/cross-links.json

method (v1 draft):
  - 한국어 명사 후보 = 2글자 이상 한글 토큰 (정규식)
  - 워크숍 node text + label → 토큰 set
  - 운영규정 Clause text + label → 토큰 set
  - Jaccard ≥ 0.05 또는 공통 토큰 ≥ 3 → 링크
  - score = jaccard
  - 워크숍당 상위 3개 Clause만 보존

향후: gte-small 임베딩 코사인으로 교체 (kb_chunks 인프라 재활용 가능).
"""
import json
import os
import re
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")

HERE = Path(__file__).resolve().parent
WIKI = HERE.parent
DATA = WIKI / "public" / "workshop-graph" / "data"

WORKSHOP = DATA / "workshop-2026-06-13.json"
REGULATION = DATA / "regulation-2026-06-13.json"
OUT = DATA / "cross-links.json"

TOKEN_RE = re.compile(r"[가-힣]{2,}")
STOP = {
    "그리고", "그러나", "하지만", "이다", "있다", "없다", "이런", "저런", "이것", "저것",
    "우리", "이번", "에서", "통해", "위해", "대한", "관한", "있는", "없는", "또한", "때문",
    "수도", "정도", "경우", "사람", "사람들", "필요", "생각",
}


def tokens(text: str) -> set:
    return {t for t in TOKEN_RE.findall(text or "") if t not in STOP}


def main():
    w = json.loads(WORKSHOP.read_text(encoding="utf-8"))
    r = json.loads(REGULATION.read_text(encoding="utf-8"))

    clauses = []
    for n in r["elements"]["nodes"]:
        d = n["data"]
        if d.get("kind") != "Clause":
            continue
        toks = tokens((d.get("label") or "") + " " + (d.get("text") or ""))
        clauses.append({
            "id": d["id"],
            "art_ref": (d.get("meta") or {}).get("art_ref"),
            "label": d.get("label"),
            "tokens": toks,
        })

    links = []
    for n in w["elements"]["nodes"]:
        d = n["data"]
        if d.get("kind") not in ("Claim", "Proposal", "Decision", "Issue"):
            continue
        wtoks = tokens((d.get("label") or "") + " " + (d.get("text") or ""))
        if not wtoks:
            continue
        scored = []
        for c in clauses:
            inter = wtoks & c["tokens"]
            if len(inter) < 3 and (not c["tokens"] or not wtoks):
                continue
            union = wtoks | c["tokens"]
            jacc = len(inter) / max(len(union), 1)
            if jacc < 0.05 and len(inter) < 3:
                continue
            scored.append({"to": c["id"], "art_ref": c["art_ref"],
                            "label": c["label"], "score": round(jacc, 3),
                            "shared": sorted(inter)[:8]})
        scored.sort(key=lambda x: x["score"], reverse=True)
        if scored:
            links.append({"from": d["id"], "from_label": d.get("label"),
                          "from_kind": d.get("kind"), "session": d.get("session"),
                          "matches": scored[:3]})

    out = {
        "version": "v1-keyword-jaccard",
        "source_workshop": "workshop-2026-06-13",
        "source_regulation": "regulation-2026-06-13",
        "stats": {
            "workshop_linked": len(links),
            "total_matches": sum(len(l["matches"]) for l in links),
            "clauses": len(clauses),
        },
        "links": links,
    }
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"✓ {OUT.relative_to(WIKI)}")
    print(f"  워크숍 {len(links)}개 노드 → 운영규정 클로즈 매칭 (avg {out['stats']['total_matches']/max(len(links),1):.1f} match/node)")


if __name__ == "__main__":
    main()
