# Group E — Content Seed Verification Log (2026-05-31)

PM session execution log for PDCA Design v1.1 Group E (M1 W03).

## E1. 220 → 200 잔존분 일괄 점검 (Blocker 3)

### 사전 확인 (3개 지정 파일)
| File | Status |
|---|---|
| `wiki/SHOWCASE_STYLE.md` Principle 1 | 이미 정정됨 — line 8: "200 deliberating citizens — 20 planning + 180 deliberating-only" |
| `wiki/translations/en/agenda/15-compound-vulnerability.md` line 19 | 이미 정정됨 — "200 deliberating citizens — 20 planning + 180 deliberating-only" |
| `wiki/tools/en-roads/en/index.md` | 정정 완료 (sub13에서 처리, "220" 잔존 없음) |

### 추가 grep 결과 — 2건 발견·정정
`grep -rn "220" wiki/ --include="*.md"`:

1. **`wiki/README.md` line 73** — 우리 본문 (English Project Overview)
   - Before: `(220 citizen participants, launched 16 May 2026)`
   - After: `(200 members — 20 planning + 180 deliberating, launched 16 May 2026)`

2. **`wiki/translations/en/doc/about.md` line 14** — 우리 본문
   - Before: `a body of 220 randomly-selected citizens convened to learn`
   - After: `a body of 200 members (20 planning + 180 deliberating) convened to learn`

### 외부 인용 / 보존
- `wiki/content/`, `wiki/translations/`, `wiki/tools/` 내 `*.md`에서 "220" 추가 출현 없음
- 빌드 산출물(`dist/`, `node_modules/`)은 검사 대상에서 제외

**E1 결과**: 추가 정정 2건. SHOWCASE_STYLE/EN agenda 15/en-roads index 모두 사전 정정 확인.

---

## E2. 9차 일정 dates 일관성 검증

`content/ko/session/` frontmatter 검증 결과 — 9개 공식 세션 + 1개 lecture, 모두 일치.

| order | 차수 | 공식 일자 | frontmatter date | 파일명 | 일치 |
|---|---|---|---|---|---|
| 1 | 발대식 | 2026-05-16 | 2026-05-16 | `2026-05-16-kickoff.md` | ✓ |
| 2 | 1차 의제 워크숍 Day 1 | 2026-06-13 | 2026-06-13 | `2026-06-13-agenda-workshop-1a.md` | ✓ |
| 3 | 1차 의제 워크숍 Day 2 | 2026-06-14 | 2026-06-14 | `2026-06-14-agenda-workshop-1b.md` | ✓ |
| 4 | 전체회의 1 | 2026-07-04 | 2026-07-04 | `2026-07-04-plenary-1.md` | ✓ |
| 5 | 2차 의제 워크숍 | 2026-08-29 | 2026-08-29 | `2026-08-29-agenda-workshop-2.md` | ✓ |
| 6 | 숙의참여단 워크숍 Day 1 | 2026-09-12 | 2026-09-12 | `2026-09-12-deliberation-workshop-a.md` | ✓ |
| 7 | 숙의참여단 워크숍 Day 2 | 2026-09-13 | 2026-09-13 | `2026-09-13-deliberation-workshop-b.md` | ✓ |
| 8 | 전체회의 2 | 2026-10-17 | 2026-10-17 | `2026-10-17-plenary-2.md` | ✓ |
| 9 | 최종보고회 | 2026-11-14 | 2026-11-14 | `2026-11-14-final-report.md` | ✓ |
| — | 1교시 강의 (박찬) | 2026-05-28 | 2026-05-28 | `2026-05-28-lec1-park-chan.md` | ✓ (lecture, no `order`) |

**E2 결과**: 9차 일정 date·order·title 모두 공식 일정과 정합. 변경 없음.

---

## E3. 의제 ⑮ 한국어 시드 검증

`wiki/content/ko/agenda/15-compound-vulnerability.md` — SCHEMA.md §1.1 (Agenda) 컨벤션 대비:

| 필수 필드 | 값 | 검증 |
|---|---|---|
| `id` | 15 | ✓ (unique) |
| `slug` | compound-vulnerability | ✓ (kebab-case ASCII, matches filename) |
| `title` | "복합 취약성(Compound Vulnerability) 정의·보호" | ✓ (Korean) |
| `category` | 실행-의제 | ✓ (enum) |
| `status` | proposed | ✓ (enum) |
| `sessions` | [2026-05-28] | ✓ (lec1 박찬 교수 강의 일자) |
| `related_agendas` | [5] | ✓ |
| `ministries` | [행정안전부, 보건복지부, 고용노동부] | ✓ |
| `international_cases` | [Canada IPCC AR6 Loss & Damage, EU Just Transition] | ✓ |
| `license` | CC-BY-SA-4.0 | ✓ |
| `last_updated` | 2026-05-31 | ✓ |
| `translations.en/ja/zh/es` | author-verified/machine | ✓ (enum 합법) |

본문 품질:
- D1 EN 쇼케이스의 `source_korean: /ko/agenda/compound-vulnerability` 가 본 파일을 가리킴 — 참조 일관.
- 박찬 교수 1교시 강의(2026-05-28) 연결 명시, 의제 ⑤와 메타-의제→실행-의제 업그레이드 서사 명확.
- 4축(주거·건강·이동·고립) 일관 사용, 2022 반지하·2024 폭염 한국 앵커 충족 (SHOWCASE_STYLE Principle 2).

**E3 결과**: KO 시드 schema·본문 정합. 변경 없음.

---

## E4. 의제 ⑮ 영문 쇼케이스 frontmatter 검증

`wiki/translations/en/agenda/15-compound-vulnerability.md` — Design D1 컨벤션 대비:

D1 명시 (Design line 36): translations/en/agenda/ frontmatter 필드 = `id, slug, title (English), category (English string), status, source_korean, translation_status, license, last_updated`.

현재 frontmatter:
| 필드 | 값 | D1 대비 |
|---|---|---|
| `id` | 15 | ✓ |
| `slug` | compound-vulnerability | ✓ |
| `title` | "Compound Vulnerability: Redefining Climate-at-Risk Populations" | ✓ (English) |
| `category` | implementation-agenda | ✓ (English string per D1) |
| `status` | proposed | ✓ |
| `sessions` | [2026-05-28] | (보존) — D1 informational-only, Zod 미검증 |
| `related_agendas` | [5] | (보존) — informational |
| `ministries` | [Ministry of the Interior and Safety, ...] | (보존, EN화) — informational |
| `international_cases` | [IPCC AR6 risk framework, EU Just Transition, Canadian Adaptation Strategy 2023] | (보존) — informational |
| `license` | CC-BY-SA-4.0 | ✓ |
| `last_updated` | 2026-05-31 | ✓ |
| `source_korean` | /ko/agenda/compound-vulnerability | ✓ (D1 필수) |
| `translation_status` | author-verified | ✓ (enum 합법) |

D1 line 39 명시: *"The wiki/translations/en/agenda/15-compound-vulnerability.md file is already valid under this policy and requires no changes."*

추가 informational 필드(`sessions/related_agendas/ministries/international_cases`)는 D1이 "informational only and not validated by Zod"로 허용. 제거 강제 없음.

**E4 결과**: D1 컨벤션 정합. 변경 없음.

---

## 빌드 검증

```
cd wiki && npx astro check
Result (41 files):
- 0 errors
- 0 warnings
- 2 hints (기존, BaseLayout/DocLayout — Group E 무관)
```

✓ astro check 0 errors 유지.

---

## 변경 파일 요약

| 파일 | 변경 |
|---|---|
| `wiki/README.md` | line 73: "220 citizen participants" → "200 members — 20 planning + 180 deliberating" |
| `wiki/translations/en/doc/about.md` | line 14: "220 randomly-selected citizens" → "200 members (20 planning + 180 deliberating)" |

총 변경: 2개 파일, 2개 라인 (모두 E1 220→200 잔존분).
