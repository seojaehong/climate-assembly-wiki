# SCHEMA — Single Source of Truth for All Subagents

> **This file is the binding interface contract between subagents A (Astro), B (docx→md), C (Translation), D (Deployment).**
> Any subagent producing or consuming content MUST conform to the schemas below. PM (main session) enforces this.
> Last updated: 2026-05-31

---

## 1. Frontmatter Schemas (YAML)

All Markdown files under `content/ko/` MUST start with a YAML frontmatter block between `---` markers.

### 1.1 Agenda — `content/ko/agenda/{NN}-{slug}.md`

```yaml
---
id: 14                               # integer, required, unique 1..N
slug: climate-dividend               # string, required, kebab-case ASCII
title: 시민 환급형 기후배당            # string, required (Korean)
category: 메타-의제                   # enum: 일반-의제 | 메타-의제 | 실행-의제
status: proposed                     # enum: proposed | discussed | recommended | final
sessions: [2026-05-28]               # array of date strings YYYY-MM-DD
related_agendas: [2, 13]             # array of integers (agenda ids)
ministries: [기재부, 기후에너지환경부]  # array of strings (Korean ministry names)
international_cases: [Canada, Switzerland]  # array of strings
license: CC-BY-SA-4.0                # constant
last_updated: 2026-05-31             # date YYYY-MM-DD
translations:
  en: { status: machine, translator: "Claude-sonnet-4-6", translated_at: 2026-05-31 }
  ja: { status: machine, translator: "Claude-sonnet-4-6", translated_at: 2026-05-31 }
  zh: { status: machine, translator: "Claude-sonnet-4-6", translated_at: 2026-05-31 }
  es: { status: machine, translator: "Claude-sonnet-4-6", translated_at: 2026-05-31 }
---
```

- `translations.{lang}.status` enum: `machine` | `reviewed` | `native` | `author-verified`
- **Project policy (2026-05-31 update)**: This project uses **author-time multilingual generation** (not build-time machine translation). The author writes Korean and generates the 5 languages together with an LLM assistant in the same session, reviewing before commit. Default status is therefore `author-verified` (🟢) for ko/en and `reviewed` (🔵) for ja/zh/es (author-assisted but not native).
- Translated files (under `translations/{lang}/agenda/...`) MUST keep the **same** frontmatter, with `title` translated.

### 1.2 Session — `content/ko/session/{YYYY-MM-DD}-{slug}.md`

```yaml
---
date: 2026-05-28                     # date, required
slug: 2026-05-28-lec1-park-chan      # string, required
title: 1교시 — 박찬 교수 (서울시립대) 정부의 기후위기 대응정책
session_type: lecture                # enum: kickoff | lecture | discussion | recommendation | event | closing
speaker: 박찬                         # string, optional (lecture/discussion only)
affiliation: 서울시립대학교            # string, optional
agendas_discussed: [14, 15]          # array of agenda ids
license: CC-BY-SA-4.0
last_updated: 2026-05-31
translations: { en: {...}, ja: {...}, zh: {...}, es: {...} }
---
```

### 1.3 Doc — `content/ko/doc/{slug}.md`

```yaml
---
slug: moderator-brief
title: 모더레이터 준비 브리프
doc_type: brief                      # enum: brief | reference | guide | report | analysis
order: 1                             # integer for sidebar ordering
license: CC-BY-SA-4.0
last_updated: 2026-05-31
translations: { en: {...}, ja: {...}, zh: {...}, es: {...} }
---
```

### 1.4 Glossary — `content/ko/glossary/terms.yaml` (single file, list)

```yaml
- key: NDC
  ko: 국가 온실가스 감축 목표(NDC)
  en: Nationally Determined Contribution (NDC)
  ja: 国家自主貢献(NDC)
  zh: 国家自主贡献(NDC)
  es: Contribución Determinada a Nivel Nacional (NDC)

- key: CCUS
  ko: 탄소 포집·활용·저장(CCUS)
  en: Carbon Capture, Utilization and Storage (CCUS)
  ja: 二酸化炭素回収・利用・貯留(CCUS)
  zh: 碳捕集、利用与封存(CCUS)
  es: Captura, Utilización y Almacenamiento de Carbono (CCUS)
```

---

## 2. Translation Rules — DO NOT TRANSLATE

Subagent **C** (translation workflow) MUST preserve the following verbatim:

| Element | Rule |
|---------|------|
| Frontmatter `---` block | Translate **only** human-readable string values (`title`, `category` etc.); keep all keys, enum values (e.g. `proposed`), numbers, dates, slugs as-is. |
| `[[wiki-link]]` syntax | Never translate the slug inside `[[...]]`. Routing depends on it. |
| `![alt](path)` images | Keep path. Translate `alt` text only if helpful. |
| ` ```code fences``` ` | Never translate code. |
| `` `inline code` `` | Never translate. |
| URLs (`https://...`) | Never translate. |
| Numbers, units, dates | `1.5℃`, `2030`, `GW`, `TWh`, `40%`, `2018년 대비` — keep digits & units exact. |
| Acronyms with glossary entry | Use the `terms.yaml` mapping for that language. Acronym itself (NDC, CCUS, SSP, RE100) stays as-is in all languages. |
| Person/organization names | Keep romanization or original (박찬 → "Park Chan" in en; keep 박찬 in ja/zh if context allows). |

---

## 3. File Naming Conventions

- Slugs: lowercase, ASCII, hyphen-separated. No spaces. No Korean.
- Agenda files: `{NN:02d}-{slug}.md` (e.g., `01-nuclear-vs-renewable.md`, `14-climate-dividend.md`)
- Session files: `{YYYY-MM-DD}-{slug}.md`
- Doc files: `{slug}.md`

---

## 4. Acceptance Criteria (PM checklist)

Before any subagent's PR is merged, PM verifies:

- [ ] Frontmatter parses as valid YAML (`yq` or Astro content schema)
- [ ] All required fields present
- [ ] `id` uniqueness across agenda
- [ ] `slug` matches filename
- [ ] No DO-NOT-TRANSLATE rule violated in translation output
- [ ] `last_updated` is today's date

---

## 5. Authoritative Lists (PM-Maintained)

### 5.1 Categories (Agenda)
- `일반-의제` — general topical agenda (#1~#10 in current v4)
- `메타-의제` — process/governance agenda (#9, #10, #13)
- `실행-의제` — implementation-level (#14, #15)

### 5.2 Status Lifecycle
`proposed` → `discussed` (after a session) → `recommended` (after vote) → `final` (after government acceptance verdict)

### 5.3 Session Types
`kickoff` | `lecture` | `discussion` | `recommendation` | `event` | `closing`

### 5.4 Doc Types
`brief` | `reference` | `guide` | `report` | `analysis`
