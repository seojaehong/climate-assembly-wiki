#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
docx_to_md.py — Convert source docx files into Astro-compatible Korean seed
markdown that conforms to wiki/SCHEMA.md.

Re-run from repo root:
    python3 wiki/scripts/docx_to_md.py

The script is idempotent: it overwrites generated files but leaves untouched
files (e.g. 00-dummy.md from subagent A) alone.
"""

from __future__ import annotations

import os
import re
import shutil
import sys
from datetime import date
from pathlib import Path

import docx  # python-docx

sys.stdout.reconfigure(encoding="utf-8")

# ---------------------------------------------------------------------------
# paths
# ---------------------------------------------------------------------------
ROOT = Path(__file__).resolve().parents[2]  # 기후회의모더레이터/
WIKI = ROOT / "wiki"
KO = WIKI / "content" / "ko"
DOWNLOADS = WIKI / "assets" / "downloads"

TODAY = "2026-05-31"

for d in [KO / "agenda", KO / "session", KO / "doc", KO / "glossary", DOWNLOADS]:
    d.mkdir(parents=True, exist_ok=True)


# ---------------------------------------------------------------------------
# frontmatter helpers
# ---------------------------------------------------------------------------
TRANSLATIONS_BLOCK = (
    "translations:\n"
    "  en: { status: machine, translator: \"Claude-sonnet-4-6\", translated_at: 2026-05-31 }\n"
    "  ja: { status: machine, translator: \"Claude-sonnet-4-6\", translated_at: 2026-05-31 }\n"
    "  zh: { status: machine, translator: \"Claude-sonnet-4-6\", translated_at: 2026-05-31 }\n"
    "  es: { status: machine, translator: \"Claude-sonnet-4-6\", translated_at: 2026-05-31 }\n"
)


def yaml_list(items):
    if not items:
        return "[]"
    return "[" + ", ".join(str(x) for x in items) + "]"


def yaml_str_list(items):
    if not items:
        return "[]"
    return "[" + ", ".join(items) + "]"


def write_md(path: Path, frontmatter: str, body: str) -> None:
    content = "---\n" + frontmatter.rstrip() + "\n---\n\n" + body.strip() + "\n"
    path.write_text(content, encoding="utf-8")
    print(f"  wrote {path.relative_to(WIKI)}")


# ---------------------------------------------------------------------------
# docx paragraph extraction
# ---------------------------------------------------------------------------
def docx_paragraphs(path: Path):
    d = docx.Document(str(path))
    out = []
    for p in d.paragraphs:
        text = p.text
        if not text.strip():
            continue
        out.append((p.style.name, text))
    return out


def paras_to_markdown(paras, demote=False):
    """Convert (style, text) tuples into markdown body.

    demote=True shifts Heading 1 → ##, Heading 2 → ###, etc. so the doc title
    can be the H1 from frontmatter context.
    """
    md = []
    for style, text in paras:
        if style.startswith("Heading 1"):
            md.append(("## " if demote else "# ") + text)
        elif style.startswith("Heading 2"):
            md.append(("### " if demote else "## ") + text)
        elif style.startswith("Heading 3"):
            md.append(("#### " if demote else "### ") + text)
        elif style.startswith("Title"):
            md.append(("## " if demote else "# ") + text)
        else:
            md.append(text)
    return "\n\n".join(md)


# ---------------------------------------------------------------------------
# Agendas
# ---------------------------------------------------------------------------
# circled digit → (id, slug, category)
CIRCLED = {
    "①": 1, "②": 2, "③": 3, "④": 4, "⑤": 5, "⑥": 6, "⑦": 7, "⑧": 8,
    "⑨": 9, "⑩": 10, "⑪": 11, "⑫": 12, "⑬": 13, "⑭": 14, "⑮": 15,
}

AGENDA_META = {
    1:  ("nuclear-vs-renewable",      "전력믹스 — 원전인가, 재생에너지인가?",                    "일반-의제", []),
    2:  ("electricity-price",         "전기요금 인상 — 받아들일 수 있는가?",                     "일반-의제", []),
    3:  ("seoul-metro-gap",           "수도권 vs 비수도권 — 에너지 부담의 불균형",                 "일반-의제", []),
    4:  ("ice-vehicle-phaseout",      "내연차 판매금지 시점 — 한국은 언제?",                     "일반-의제", []),
    5:  ("climate-injustice",         "기후재난의 사회적 불평등",                                "일반-의제", []),
    6:  ("lifestyle-regulation",      "개인 라이프스타일에 대한 정책 개입의 경계",                 "일반-의제", []),
    7:  ("developing-country-support","개도국 지원 vs 국내 우선 — 기후금융의 분배",               "일반-의제", []),
    8:  ("esg-re100",                 "기후공시·ESG 의무화의 속도 조절",                         "일반-의제", []),
    9:  ("implementation-monitoring", "[메타-의제] 권고안 사후 이행 점검권",                      "메타-의제", []),
    10: ("national-to-local",         "[메타-의제] 국가 권고를 17개 광역으로 어떻게 내려보낼 것인가","메타-의제", []),
    11: ("ai-datacenter",             "AI·데이터센터 — 기후 게임체인저인가, 새로운 위기인가",      "일반-의제", []),
    12: ("developing-9vars",          "개도국 성장 9대 변수 — 한국은 어디부터 지원할 것인가",     "일반-의제", [7]),
    13: ("renewable-zerosum",         "[메타-의제] 한정된 재생에너지 — 전기차 vs 데이터센터 vs 산업, 누가 먼저?", "메타-의제", [1, 4, 8, 11]),
    14: ("climate-dividend",          "시민 환급형 기후배당(Climate Dividend) 도입",              "실행-의제", [2]),
    15: ("compound-vulnerability",    "복합 취약성(Compound Vulnerability) 정의·보호",            "실행-의제", [5]),
}

AGENDA_MINISTRIES = {
    1:  ["산업통상자원부", "기후에너지환경부"],
    2:  ["산업통상자원부", "기획재정부"],
    3:  ["산업통상자원부", "국토교통부"],
    4:  ["환경부", "산업통상자원부", "국토교통부"],
    5:  ["행정안전부", "보건복지부", "국토교통부"],
    6:  ["환경부", "농림축산식품부"],
    7:  ["외교부", "기획재정부"],
    8:  ["금융위원회", "산업통상자원부"],
    9:  ["국무조정실", "기후에너지환경부"],
    10: ["행정안전부", "기후에너지환경부"],
    11: ["과학기술정보통신부", "산업통상자원부"],
    12: ["외교부", "산업통상자원부"],
    13: ["산업통상자원부", "과학기술정보통신부"],
    14: ["기획재정부", "기후에너지환경부"],
    15: ["행정안전부", "보건복지부", "고용노동부"],
}

AGENDA_CASES = {
    1:  ["프랑스 (원전 비중 70%)", "독일 (탈원전)", "RE100"],
    2:  ["EU (367원/kWh 평균)", "영국 (609원/kWh)"],
    3:  ["영국 (지역별 차등 전기요금)", "독일 (지역별 차등 전기요금)"],
    4:  ["노르웨이 (2025)", "영국 (2035)", "EU (2035 e-fuel 예외)"],
    5:  ["2022 서울 반지하 침수", "2023 오송 지하차도", "2024 장기 폭염"],
    6:  [],
    7:  ["파리협정 6조 국제탄소시장"],
    8:  ["RE100", "TCFD"],
    9:  ["프랑스 시민기후협약", "영국 의회 6개 위원회 보고 의무", "아일랜드 기후행동계획"],
    10: ["경기도 기후도민총회 (광역 120명 → 6개 권역 → 31개 시군)"],
    11: ["IEA Energy and AI (2024)", "ACM FAccT 2025 Jevons Paradox", "DeepMind GNoME"],
    12: ["인도 (SSP1 vs SSP5 1인당 CO₂ 4배차)", "YOLK 솔라카우 (케냐)"],
    13: ["IEA 2024 (재생E vs 다부문 수요 충돌)"],
    14: ["Canada (2019~)", "Switzerland", "Austria"],
    15: ["2022 서울 반지하 침수 (단일 변수 사각지대)"],
}


def split_agenda_blocks(paras):
    """Return dict id → list of (style, text) for the agenda section (Part 2).

    Each agenda starts at a Heading 2 containing a circled digit.
    """
    # Locate Part 2 start (Heading 1 starting with "Part 2") and Part 3 start.
    start = end = None
    for i, (style, text) in enumerate(paras):
        if style.startswith("Heading 1") and "Part 2" in text:
            start = i
        elif style.startswith("Heading 1") and "Part 3" in text:
            end = i
            break
    if start is None:
        raise RuntimeError("Could not locate Part 2 in v4 docx")
    if end is None:
        end = len(paras)
    section = paras[start + 1 : end]

    blocks = {}
    current_id = None
    for style, text in section:
        if style.startswith("Heading 2"):
            # Find which circled digit (if any) appears in the heading
            m = None
            for c, idn in CIRCLED.items():
                if c in text:
                    m = idn
                    break
            if m is not None:
                current_id = m
                blocks[current_id] = {"title_raw": text, "paras": []}
                continue
        if current_id is not None:
            blocks[current_id]["paras"].append((style, text))
    return blocks


def build_agenda_body(block):
    """Render agenda body. The docx uses 3 sub-labels in Normal text:
    '교안 배경', '핵심 질문', '모더레이션 팁'. Convert those into H2 sections.
    """
    paras = block["paras"]
    sections = {"교안 배경": [], "핵심 질문": [], "모더레이션 팁": []}
    current = None
    for style, text in paras:
        t = text.strip()
        if t in sections:
            current = t
            continue
        if current is None:
            # Pre-amble text before first label — attach to 교안 배경
            current = "교안 배경"
        sections[current].append(text)

    md_parts = []
    for label in ["교안 배경", "핵심 질문", "모더레이션 팁"]:
        if sections[label]:
            md_parts.append(f"## {label}\n\n" + "\n\n".join(sections[label]))
    return "\n\n".join(md_parts)


def write_agendas(v4_paras):
    blocks = split_agenda_blocks(v4_paras)
    missing = [i for i in range(1, 16) if i not in blocks]
    if missing:
        print(f"  WARN: missing agendas in docx: {missing}")
    print(f"Writing {len(blocks)} agenda files...")
    for idn in sorted(blocks.keys()):
        slug, title, category, related = AGENDA_META[idn]
        sessions = [TODAY[:10]] if idn in (14, 15) else []
        # Override session date — task says 1교시 was 2026-05-28
        sessions = ["2026-05-28"] if idn in (14, 15) else []
        ministries = AGENDA_MINISTRIES.get(idn, [])
        cases = AGENDA_CASES.get(idn, [])

        # Quote title to be safe against YAML special chars (e.g. leading '[')
        safe_title = '"' + title.replace('\\', '\\\\').replace('"', '\\"') + '"'
        fm = (
            f"id: {idn}\n"
            f"slug: {slug}\n"
            f"title: {safe_title}\n"
            f"category: {category}\n"
            f"status: proposed\n"
            f"sessions: {yaml_list(sessions)}\n"
            f"related_agendas: {yaml_list(related)}\n"
            f"ministries: {yaml_str_list(ministries)}\n"
            f"international_cases: {yaml_str_list(cases)}\n"
            f"license: CC-BY-SA-4.0\n"
            f"last_updated: {TODAY}\n"
            + TRANSLATIONS_BLOCK
        )
        body = build_agenda_body(blocks[idn])
        out = KO / "agenda" / f"{idn:02d}-{slug}.md"
        write_md(out, fm, body)


# ---------------------------------------------------------------------------
# Docs
# ---------------------------------------------------------------------------
def write_doc(slug, title, doc_type, order, source_docx=None, body_override=None, demote=True):
    if body_override is not None:
        body = body_override
    else:
        paras = docx_paragraphs(ROOT / source_docx)
        body = paras_to_markdown(paras, demote=demote)
    safe_title = '"' + title.replace('"', '\\"') + '"'
    fm = (
        f"slug: {slug}\n"
        f"title: {safe_title}\n"
        f"doc_type: {doc_type}\n"
        f"order: {order}\n"
        f"license: CC-BY-SA-4.0\n"
        f"last_updated: {TODAY}\n"
        + TRANSLATIONS_BLOCK
    )
    out = KO / "doc" / f"{slug}.md"
    write_md(out, fm, body)


def build_ssp_beyond(v4_paras):
    # Extract Part 3 section
    start = end = None
    for i, (style, text) in enumerate(v4_paras):
        if style.startswith("Heading 1") and "Part 3" in text:
            start = i
        elif style.startswith("Heading 1") and start is not None and i > start:
            end = i
            break
    if start is None:
        return "# SSP 너머 — 프레임의 한계\n\n(content not found)"
    section = v4_paras[start : end if end else len(v4_paras)]
    return paras_to_markdown(section, demote=True)


def write_docs(v4_paras):
    print("Writing 5 doc files...")
    write_doc("moderator-brief", "모더레이터 준비 브리프", "brief", 1,
              source_docx="기후시민회의_모더레이터_준비브리프_v2.docx")
    write_doc("gyeonggi-case", "경기도 기후도민총회 심층분석", "analysis", 2,
              source_docx="경기도_기후도민총회_심층분석.docx")
    write_doc("ministry-roles", "부처별 탄소중립·기후적응 역할", "reference", 3,
              source_docx="부처별_탄소중립_기후적응_역할.docx")
    write_doc("textbook-errata", "기후시민회의 교안 오탈자 정리 v4", "report", 4,
              source_docx="기후시민회의_교안_오탈자_정리_v4.docx")
    ssp_body = build_ssp_beyond(v4_paras)
    write_doc("ssp-beyond", "SSP 너머 — 프레임의 한계", "analysis", 5,
              body_override=ssp_body)


# ---------------------------------------------------------------------------
# Sessions
# ---------------------------------------------------------------------------
def write_lecture1():
    print("Writing 1 lecture session...")
    paras = docx_paragraphs(ROOT / "1교시_박찬교수_강의안_정리.docx")
    body = paras_to_markdown(paras, demote=True)
    slug = "2026-05-28-lec1-park-chan"
    fm = (
        f"date: 2026-05-28\n"
        f"slug: {slug}\n"
        f"title: 1교시 — 박찬 교수 (서울시립대) 정부의 기후위기 대응정책\n"
        f"session_type: lecture\n"
        f"speaker: 박찬\n"
        f"affiliation: 서울시립대학교\n"
        f"agendas_discussed: [14, 15]\n"
        f"license: CC-BY-SA-4.0\n"
        f"last_updated: {TODAY}\n"
        + TRANSLATIONS_BLOCK
    )
    write_md(KO / "session" / f"{slug}.md", fm, body)


def write_kickoff():
    print("Writing 1 kickoff session...")
    slug = "2026-05-16-kickoff"
    body = (
        "## 개요\n\n"
        "2026년 5월 16일, 대한민국 국가 기후시민회의 발대식이 개최되었다. "
        "전국에서 무작위 추출된 시민참여단 200명(기획참여단 20명 + 숙의참여단 180명)이 참석했다.\n\n"
        "## 핵심 사실\n\n"
        "- 시민참여단 구성: 200명 — 기획참여단 20명(의제 선정·운영규범 채택, 의사결정 비포함) + 숙의참여단 180명(전국 17개 광역 비례 표집, 성·연령·지역 인구통계 가중). 외부자문단 10명 별도.\n"
        "- 운영 구조: 본회의 + 6개 분과(에너지전환·수송·산업·적응·금융·거버넌스)\n"
        "- 산출물 모델: 경기도 기후도민총회의 5층 분리 산출물 모델(검토의견서·정책건의·도민실천약속·기후헌장·이행점검방안) 참고\n"
        "- 운영 기간: 2026년 5월~11월(약 6개월), 총 6회 본회의 + 분과 워크숍\n"
        "- 결과 보고 대상: 대통령 직속 2050 탄소중립녹색성장위원회 및 국회 환경노동위원회\n"
    )
    fm = (
        f"date: 2026-05-16\n"
        f"slug: {slug}\n"
        f"title: 국가 기후시민회의 발대식\n"
        f"session_type: kickoff\n"
        f"agendas_discussed: []\n"
        f"license: CC-BY-SA-4.0\n"
        f"last_updated: {TODAY}\n"
        + TRANSLATIONS_BLOCK
    )
    write_md(KO / "session" / f"{slug}.md", fm, body)


# ---------------------------------------------------------------------------
# Glossary
# ---------------------------------------------------------------------------
GLOSSARY = [
    {"key": "NDC",
     "ko": "국가 온실가스 감축 목표(NDC)",
     "en": "Nationally Determined Contribution (NDC)",
     "ja": "国家自主貢献(NDC)",
     "zh": "国家自主贡献(NDC)",
     "es": "Contribución Determinada a Nivel Nacional (NDC)"},
    {"key": "CCUS",
     "ko": "탄소 포집·활용·저장(CCUS)",
     "en": "Carbon Capture, Utilization and Storage (CCUS)",
     "ja": "二酸化炭素回収・利用・貯留(CCUS)",
     "zh": "碳捕集、利用与封存(CCUS)",
     "es": "Captura, Utilización y Almacenamiento de Carbono (CCUS)"},
    {"key": "SSP",
     "ko": "공통 사회경제 경로(SSP)",
     "en": "Shared Socioeconomic Pathways (SSP)",
     "ja": "共有社会経済経路(SSP)",
     "zh": "共享社会经济路径(SSP)",
     "es": "Trayectorias Socioeconómicas Compartidas (SSP)"},
    {"key": "RE100",
     "ko": "재생에너지 100% (RE100)",
     "en": "100% Renewable Electricity (RE100)",
     "ja": "100%再生可能エネルギー(RE100)",
     "zh": "100%可再生能源(RE100)",
     "es": "100% Energía Renovable (RE100)"},
    {"key": "IPCC",
     "ko": "기후변화에 관한 정부간 협의체(IPCC)",
     "en": "Intergovernmental Panel on Climate Change (IPCC)",
     "ja": "気候変動に関する政府間パネル(IPCC)",
     "zh": "政府间气候变化专门委员会(IPCC)",
     "es": "Grupo Intergubernamental de Expertos sobre el Cambio Climático (IPCC)"},
    {"key": "GW",
     "ko": "기가와트(GW) — 전력 용량 단위, 1 GW = 1,000 MW",
     "en": "Gigawatt (GW) — unit of power, 1 GW = 1,000 MW",
     "ja": "ギガワット(GW) — 電力容量の単位、1 GW = 1,000 MW",
     "zh": "吉瓦(GW) — 电力容量单位,1 GW = 1,000 MW",
     "es": "Gigavatio (GW) — unidad de potencia, 1 GW = 1.000 MW"},
    {"key": "TWh",
     "ko": "테라와트시(TWh) — 전력량 단위, 1 TWh = 10억 kWh",
     "en": "Terawatt-hour (TWh) — unit of energy, 1 TWh = 1 billion kWh",
     "ja": "テラワット時(TWh) — 電力量の単位、1 TWh = 10億 kWh",
     "zh": "太瓦时(TWh) — 电量单位,1 TWh = 10亿 kWh",
     "es": "Teravatio-hora (TWh) — unidad de energía, 1 TWh = mil millones kWh"},
    {"key": "AR6",
     "ko": "IPCC 제6차 평가보고서(AR6, 2021~2023)",
     "en": "IPCC Sixth Assessment Report (AR6, 2021–2023)",
     "ja": "IPCC第6次評価報告書(AR6, 2021~2023)",
     "zh": "IPCC第六次评估报告(AR6, 2021–2023)",
     "es": "Sexto Informe de Evaluación del IPCC (AR6, 2021–2023)"},
    {"key": "AR7",
     "ko": "IPCC 제7차 평가보고서(AR7, 2027~2030 예정)",
     "en": "IPCC Seventh Assessment Report (AR7, expected 2027–2030)",
     "ja": "IPCC第7次評価報告書(AR7, 2027~2030予定)",
     "zh": "IPCC第七次评估报告(AR7, 预计 2027–2030)",
     "es": "Séptimo Informe de Evaluación del IPCC (AR7, previsto 2027–2030)"},
    {"key": "기후배당",
     "ko": "시민 환급형 기후배당(Climate Dividend)",
     "en": "Climate Dividend (carbon-tax citizen rebate)",
     "ja": "気候配当(Climate Dividend) — 炭素税の市民還付",
     "zh": "气候红利(Climate Dividend) — 碳税返还公民",
     "es": "Dividendo Climático (devolución ciudadana del impuesto al carbono)"},
    {"key": "복합 취약성",
     "ko": "복합 취약성(Compound Vulnerability) — 주거·건강·이동·고립 4축 결합",
     "en": "Compound Vulnerability — combined housing, health, mobility, and social-isolation risks",
     "ja": "複合脆弱性(Compound Vulnerability)",
     "zh": "复合脆弱性(Compound Vulnerability)",
     "es": "Vulnerabilidad Compuesta (Compound Vulnerability)"},
    {"key": "풍선효과",
     "ko": "풍선효과(balloon effect) — 한 부문의 배출 감축이 다른 부문 증가로 이전되는 현상",
     "en": "Balloon effect — emission reductions in one sector shifting to increases in another",
     "ja": "風船効果(balloon effect) — 一部門の排出削減が他部門の増加に転嫁される現象",
     "zh": "气球效应(balloon effect) — 一个部门的减排转移到另一部门的增加",
     "es": "Efecto globo (balloon effect) — reducciones de emisiones en un sector que se trasladan a aumentos en otro"},
]


def write_glossary():
    print("Writing glossary...")
    out = KO / "glossary" / "terms.yaml"
    lines = []
    for term in GLOSSARY:
        lines.append(f"- key: {term['key']}")
        for lang in ("ko", "en", "ja", "zh", "es"):
            val = term[lang]
            # YAML-safe quote if needed
            if any(c in val for c in [":", "#"]):
                val_out = '"' + val.replace('"', '\\"') + '"'
            else:
                val_out = val
            lines.append(f"  {lang}: {val_out}")
        lines.append("")
    out.write_text("\n".join(lines).rstrip() + "\n", encoding="utf-8")
    print(f"  wrote {out.relative_to(WIKI)}")


# ---------------------------------------------------------------------------
# Downloads — copy 8 sources to wiki/assets/downloads/
# ---------------------------------------------------------------------------
DOWNLOAD_FILES = [
    "기후시민회의_의제및이해보완_v4.docx",
    "기후시민회의_모더레이터_준비브리프_v2.docx",
    "경기도_기후도민총회_심층분석.docx",
    "부처별_탄소중립_기후적응_역할.docx",
    "1교시_박찬교수_강의안_정리.docx",
    "기후시민회의_교안_오탈자_정리_v4.docx",
    "Plan_LLM_Wiki_프로젝트.md",
    "[강의교안]_시민이 여는 기후 공론장.pdf",
]


def copy_downloads():
    print("Copying 8 downloads...")
    for fn in DOWNLOAD_FILES:
        src = ROOT / fn
        dst = DOWNLOADS / fn
        if src.exists():
            shutil.copy2(src, dst)
            print(f"  copied {fn}")
        else:
            print(f"  MISSING source: {fn}")


# ---------------------------------------------------------------------------
# Plan_LLM_Wiki_프로젝트.md → wiki/content/ko/doc/plan-wiki.md? Task says copy as-is into doc.
# Spec: "Plan_LLM_Wiki_프로젝트.md (이건 이미 .md, 그대로 wiki/doc로 복사)"
# We treat it as a 6th doc (no slot in the 5-doc table). Instead place it under
# doc/ with frontmatter wrapped around it, to satisfy SCHEMA.
# Re-reading the spec: 5 doc files for B, and the Plan file copy is item 7 of
# the 8-input list (downloads). We'll copy the raw .md into downloads only.
# ---------------------------------------------------------------------------


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------
def main():
    print(f"docx_to_md.py — root={ROOT}")
    v4 = ROOT / "기후시민회의_의제및이해보완_v4.docx"
    if not v4.exists():
        print(f"FATAL: missing {v4}", file=sys.stderr)
        sys.exit(1)
    v4_paras = docx_paragraphs(v4)

    write_agendas(v4_paras)
    write_docs(v4_paras)
    write_lecture1()
    write_kickoff()
    write_glossary()
    copy_downloads()
    print("DONE.")


if __name__ == "__main__":
    main()
