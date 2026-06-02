# Plan: 2026 기후시민회의 모더레이터 활동 아카이빙 + LLM Wiki 다국어 공개 사이트

> 작성일: 2026-05-31
> 작성자: 사용자 + 모더레이션 어시스턴트
> 방법: bkit `/plan-plus` (brainstorming-enhanced PDCA)
> 단계: Plan ✅ → Design → Do → Analyze → Report

---

## Executive Summary (4-Perspective)

| 관점 | 내용 |
|------|------|
| **Problem (문제)** | ① 2026 기후시민회의 모더레이션은 매 회차 산출되는 자료가 분산·1회성이며 사후 활용도 낮음 ② 한국형 기후 거버넌스의 국제적 가시성·인용 가능성 부재 ③ 차기 시민회의 참여자·해외 연구자가 참조할 표준 1차 자료 부재 |
| **Solution (해결책)** | Astro 정적 사이트 + Claude API 빌드타임 번역으로 **5개국어(한·영·일·중·서) 듀얼-청중 위키** 구축. 한국어 마크다운을 SSOT로 두고 GitHub 오픈소스로 영구 보존. **의제 메인 + 회차 타임라인 하이브리드 구조** |
| **Function·UX Effect (기능·체감 효과)** | ① 의제 15개 위키 페이지 — 시민·연구자 누구나 즉시 학습 가능 ② 회차 타임라인 — 본 모더레이터의 활동을 시간순 따라가기 ③ 정적 검색 + 3단계 번역 신뢰도 라벨로 학술 인용 가능 ④ 자료 다운로드 센터로 docx 8종 즉시 배포 ⑤ 모바일·다크모드·CC BY-SA |
| **Core Value (핵심 가치)** | **‘한국형 기후시민의회 모델을 세계 공유하는 디지털 기록보관소’** — 운영비 사실상 0원, 1인 운영 가능, 20년 이상 보존 가능, 정치적 검열 불가 구조 |

---

## 1. User Intent Discovery (Phase 1)

### 1.1 핵심 문제
모더레이션 활동의 일회성 한계를 넘어, 한국형 기후 거버넌스 모델을 ① 국제 사회와 ② 국내 시민에게 동시에 전달할 영구적 디지털 인프라가 필요.

### 1.2 타깃 청중 (듀얼)
- **1차-국제**: 해외 연구자·정책 입안자·국제기구 (OECD·UNFCCC·시민의회 네트워크)
- **1차-국내**: 일반 시민·차기 광역/기초 시민회의 참여자·모더레이터 동료

### 1.3 성공 기준
- 정량: 5개국어 풀세트 출시(M3~M4) / 의제 페이지 15개 / 월 페이지뷰 1,000+ (M6 기준)
- 정성: 학술 논문·정부 보고서에서 1회 이상 인용 / 다른 광역 시민회의가 참조 모델로 채택

### 1.4 제약
- 1인 운영 가능해야 함 (자동화 필수)
- 운영비 월 1만원 이내
- 장기 보존(20년+) — 의존성 최소화
- 정치적 중립성 유지

---

## 2. Alternatives Explored (Phase 2)

### Approach A: Astro 정적 사이트 + LLM 빌드타임 번역 ★ 채택
- **Pros**: 무료 호스팅 / 빠른 속도 / SEO 최강 / 장기 보존 / LLM 비용 최소 / docx 누적 흐름과 호환
- **Cons**: 실시간 협업 편집 제한 / git 흐름 필요
- **Best for**: 1인~소수 운영, 콘텐츠가 문서 단위로 누적되는 본 프로젝트

### Approach B: 헤드리스 CMS (Strapi/Sanity) + Next.js
- **Pros**: 비기술자 편집 가능 / 실시간 업데이트 / 다인 협업
- **Cons**: 월 5~20만원 운영비 / 유지보수 부담
- **결과**: 미채택 (1인 운영 원칙과 충돌)

### Approach C: GitBook / Wiki.js
- **Pros**: 1주일 내 가동
- **Cons**: 다국어 5개+ 제한 / SEO 부족 / 장기 비전 불일치
- **결과**: 미채택

---

## 3. YAGNI Review (Phase 3)

### ✅ MVP에 포함 (9종)
1. 의제 위키 페이지(한·영 우선) — 15개
2. 회차 타임라인
3. 다국어 5개국어 자동 번역 (한·영·일·중·서)
4. 정적 검색 (Pagefind 다국어)
5. 자료 다운로드 센터 (docx)
6. 모바일·다크모드
7. CC BY-SA 4.0 + GitHub 공개
8. 모더레이터 운영 가이드 영역
9. Plausible 익명 통계

### ⏸️ 2차 출시(MVP+1)로 연기 (8종)
- LLM Q&A 챗봇 (RAG)
- 다국어 확장(불·독·아·포·힌디 5개 추가)
- 시민 피드백 게시판 + Decap CMS 부분 도입
- 권고안 진화 인터랙티브 다이어그램
- BibTeX/Zotero 인용 시스템
- 뉴스레터/RSS
- 영문 보고서 PDF 자동 생성
- 글로벌 시민의회 사이트 상호 링크

### ❌ 영구 제외
- 회원가입·로그인 / 결제 / 광고

---

## 4. Architecture (Phase 4-1)

```
소스 콘텐츠(docx + md, ko 원본)
    │
    ▼
GitHub Repo (CC BY-SA, Open Source)
    │
    ├─→ GitHub Actions
    │     ├─ Claude API 5개국어 빌드타임 번역 (hash-diff 캐시)
    │     ├─ Astro 빌드 + MDX
    │     └─ Pagefind 다국어 색인
    │
    └─→ Cloudflare Pages (무료·CDN·자동 SSL)
            │
            └─→ /ko /en /ja /zh /es 다국어 라우팅
```

### 핵심 원칙
- **SSOT**: 한국어 마크다운이 단일 진실의 원천
- **빌드타임 번역**: 콘텐츠 해시 비교로 변경분만 재번역
- **3단계 신뢰도 라벨**: ⚠️ Machine → 🔵 Reviewed → 🟢 Native-verified
- **Git as CMS**: 별도 DB 없음, 모든 변경은 git 이력
- **운영비 $0 목표**: Cloudflare Pages + GitHub Actions 무료 한도

### 예상 비용
- 도메인 연 약 1.5만원
- LLM 번역 초기 1~2만원, 이후 월 2~3천원
- **1년차 총 약 5만원 / 영구 유지**

---

## 5. Content Structure (Phase 4-2)

### Repo Layout
```
climate-assembly-wiki/
├── content/ko/                  # 한국어 SSOT
│   ├── agenda/                  # 의제 15개 (메인)
│   ├── session/                 # 회차 타임라인
│   ├── doc/                     # 보조 문서(브리프·부처별·경기도)
│   └── glossary/                # 용어집
├── translations/                # 자동 생성 + 검수 라벨
│   ├── en/  ja/  zh/  es/
├── assets/downloads/            # docx 다운로드
├── scripts/                     # translate.ts, hash-diff.ts
├── src/pages/[lang]/...         # Astro 라우팅
└── .github/workflows/           # translate.yml, deploy.yml
```

### 의제 페이지 표준 Frontmatter
```yaml
id: 14
slug: climate-dividend
title: 시민 환급형 기후배당
category: 메타-의제
status: proposed | discussed | recommended | final
sessions: [2026-05-28]
related_agendas: [02, 13]
ministries: [기재부, 기후에너지환경부]
international_cases: [Canada, Switzerland]
translations:
  en: { status: verified, translator: Claude-4 → human-checked }
license: CC-BY-SA-4.0
```

### URL 라우팅
- `/ko/agenda/climate-dividend` (한국어 원본)
- `/en/agenda/climate-dividend` (자동 번역+검수 라벨)
- `/ko/session/2026-05-28-lec1-park-chan` (회차)
- `/ko/doc/moderator-brief` (모더레이터 브리프)
- `/ko/search` / `/ko/downloads`

---

## 6. Translation Workflow (Phase 4-3)

### 흐름
1. `ko 원본` 변경 → git push
2. GitHub Actions trigger
3. `scripts/hash-diff.ts` — 변경 파일만 감지(비용 최소화)
4. `scripts/translate.ts` — Claude API + **용어집 강제 적용**
5. `translations/{lang}/...`로 자동 PR 생성
6. 인간 검수자 머지 시 `verified: true` 라벨
7. Astro 빌드 → Cloudflare 배포

### 3단계 신뢰도 라벨
| 라벨 | 의미 |
|------|------|
| ⚠️ Machine translation | 자동 번역, 미검수 |
| 🔵 Human-reviewed | 1차 인간 검수 |
| 🟢 Native-verified | 원어민 검수 |

### 용어집(terms.yaml) — 단일 진실
NDC·CCUS·SSP·기후배당·복합 취약성 등 핵심 용어는 5개국어 통일 표기를 사전 정의하여 LLM 프롬프트에 강제 주입.

### 비용 (Sonnet 4.6 기준)
- 초기 일괄: 약 1~2만원
- 매월 운영: 약 2~3천원
- 1년 누적: 약 5만원

---

## 7. Roadmap & Operations (Phase 4-4)

### 12개월 마일스톤

| M | 시점 | 산출물 |
|---|------|--------|
| M0 | 2026.5 | ✅ docx 8종, 캡처 30장, 빌더 5개 |
| M1 | 2026.6 | docx→md 변환 + Astro 스캐폴드 + Repo 공개 |
| M2 | 2026.7 | 의제 15개 + 다운로드 센터 + 한국어 사이트 가동(로컬) |
| M3 | 2026.8 | **★ MVP 1차 출시** — 한·영 + Pagefind + Cloudflare + 도메인 |
| M4 | 2026.9 | **★ 5개국어 풀세트** — 일·중·서 추가 |
| M5~M6 | 10~11월 | 회차 누적, 시민 Q&A 케이스북 |
| M7~M9 | 12~2027.2 | **MVP+1** — Q&A 챗봇 + 5개국어 추가 |
| M10~M12 | 3~5월 | 종합 회고 보고서 + 영문 PDF + 인쇄본 |

### 운영 모델 3단계
- **1단계 (M0~M3)**: 1인 운영(본인)
- **2단계 (M4~M9)**: + 자원봉사 1~3명 (GitHub PR 기반)
- **3단계 (M10~)**: + 시민단체/연구소 협력 (Open Collective 후원 가능)

### 거버넌스 원칙
- 모든 의제는 찬·반 양측 균형 게재
- CC BY-SA 4.0 라이선스
- 정치 중립 (정당·인물 비판/옹호 금지)
- 권고안의 사후 정부 채택 여부 추적

### 리스크 5종 대응
| 리스크 | 대응 |
|--------|------|
| 1인 운영 번아웃 | 자동화 극대화. 의제 v4까지 이미 시드 완성 |
| 다국어 품질 | 3단계 라벨로 신뢰도 투명 노출 + 자원봉사 검수자 |
| LLM 비용 폭증 | Hash-diff 캐시, 월 한도 모니터링 |
| 정치적 압력 | CC + GitHub 공개로 검열 불가 구조 |
| 시민회의 종료 후 | SSOT 마크다운만 살아남아도 콘텐츠 영원 |

---

## 8. Brainstorming Log (Phase 1~4)

| Q | 결정 |
|---|------|
| Q1 청중 | 국제 연구자·정책 + 국내 시민 (듀얼) |
| Q2 콘텐츠 단위 | 하이브리드 — 의제 메인 + 회차 타임라인 |
| Q3 기술 스택 | Approach A — Astro + Cloudflare + LLM 빌드타임 번역 |
| Q4 MVP 기능 | 9개 (의제·타임라인·번역·검색·다운로드·모바일·CC·운영가이드·통계) |
| Q5 MVP 확정 | 9개 그대로 |
| Q6 아키텍처 | OK (SSOT + 빌드타임 번역 + Cloudflare) |
| Q7 콘텐츠 구조 | OK (4구조 + frontmatter) |
| Q8 번역 워크플로우 | OK (Claude + hash-diff + 3단계 라벨 + 용어집) |
| Q9 로드맵 | 12개월 + 3단계 운영 + 5종 리스크 대응 확정 |

---

## Next Step

```
/pdca design llm-wiki
```

(또는 곧바로 M1 시작 — Repo 생성 + docx→md 변환 스크립트 작성)
