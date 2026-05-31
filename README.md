# Climate Assembly Wiki

한국 기후시민회의 모더레이터 활동 아카이브 + 다국어 LLM 위키
Korea Climate Citizens' Assembly — Moderator Archive & Multilingual LLM Wiki

> 본 저장소는 **개인 모더레이터의 활동 아카이브**이며, 한국 정부 또는 기후시민회의 사무국의 공식 출판물이 아닙니다.
> This repository is a **personal moderator's archive** and is **not** an official publication of the Korean government or the Climate Citizens' Assembly secretariat.

License: **CC BY-SA 4.0** — 자유롭게 공유·변형 가능, 출처 표시 및 동일 라이선스 적용 필수.

배포: Cloudflare Pages (M3 출시 전까지 비공개 프리뷰). 절차는 [DEPLOY.md](./DEPLOY.md) 참고.

---

## 한국어

### 프로젝트 개요
2026년 5월 16일 발대한 한국 기후시민회의(시민참여단 220명)의 분임 모더레이터 활동을, 1년 이상 누적되는 자료(의제·회차·교안·정책 브리프)와 함께 **5개국어 정적 위키 사이트**로 영구 보존하는 오픈소스 프로젝트입니다.

### MVP 9개 기능
1. 의제 위키 페이지(한·영 우선) — 15개
2. 회차 타임라인
3. 다국어 5개국어 자동 번역 (한·영·일·중·서)
4. 정적 검색 (Pagefind 다국어)
5. 자료 다운로드 센터 (docx)
6. 모바일·다크모드
7. CC BY-SA 4.0 + GitHub 공개
8. 모더레이터 운영 가이드 영역
9. Plausible 익명 통계

### 다국어
한국어 마크다운(`content/ko/`)이 단일 진실의 원천(SSOT)이며, Claude API 빌드타임 번역으로 다음 5개국어를 제공합니다.

- 한국어 (ko, 원본)
- English (en)
- 日本語 (ja)
- 中文 (zh)
- Español (es)

번역 신뢰도 라벨 3단계:

| 라벨 | 의미 |
|------|------|
| ⚠️ Machine | 자동 번역, 미검수 |
| 🔵 Reviewed | 1차 인간 검수 |
| 🟢 Native-verified | 원어민 검수 |

### 로드맵 (M0~M12)

| 마일스톤 | 시점 | 산출물 |
|---|---|---|
| M0 | 2026.5 | docx 8종, 캡처 30장, 빌더 스크립트 |
| M1 | 2026.6 | docx→md 변환 + Astro 스캐폴드 + Repo 공개 |
| M2 | 2026.7 | 의제 15개 + 다운로드 센터 + 한국어 사이트(로컬) |
| M3 | 2026.8 | MVP 1차 출시 — 한·영 + Pagefind + Cloudflare + 도메인 |
| M4 | 2026.9 | 5개국어 풀세트 — 일·중·서 추가 |
| M5~M6 | 10~11월 | 회차 누적, 시민 Q&A 케이스북 |
| M7~M9 | 12~2027.2 | MVP+1 — Q&A 챗봇 + 5개국어 추가 |
| M10~M12 | 3~5월 | 종합 회고 보고서 + 영문 PDF + 인쇄본 |

### 기술 스택
Astro 정적 사이트 + Claude API 빌드타임 번역 + Cloudflare Pages 호스팅.
SSOT 마크다운, hash-diff 캐시 번역, GitHub Actions CI, Pagefind 다국어 색인.

### 기여
[CONTRIBUTING.md](./CONTRIBUTING.md) 참고. 번역 검수자 환영합니다.

---

## English

### Project Overview
A personal moderator's archive of the **2026 Korea Climate Citizens' Assembly** (220 citizen participants, launched 16 May 2026), accumulating one year of materials (agendas, sessions, lecture notes, policy briefs) into a **multilingual static wiki in five languages**, preserved as open source.

### MVP — 9 Features
1. Agenda wiki pages (Korean and English first) — 15 items
2. Session timeline
3. Automated 5-language translation (KO / EN / JA / ZH / ES)
4. Static multilingual search (Pagefind)
5. Document download center (docx)
6. Mobile and dark mode
7. CC BY-SA 4.0 with public GitHub repository
8. Moderator operations guide section
9. Plausible anonymous analytics

### Languages
Korean markdown (`content/ko/`) is the single source of truth. Claude API performs build-time translation into:

- Korean (ko, source)
- English (en)
- Japanese (ja)
- Chinese (zh)
- Spanish (es)

Translation confidence labels:

| Label | Meaning |
|---|---|
| ⚠️ Machine | Automated, unreviewed |
| 🔵 Reviewed | Human-reviewed |
| 🟢 Native-verified | Verified by a native speaker |

### Roadmap (M0–M12)

| Milestone | Timing | Deliverable |
|---|---|---|
| M0 | May 2026 | 8 docx files, 30 screenshots, builder scripts |
| M1 | Jun 2026 | docx→md conversion + Astro scaffold + public repo |
| M2 | Jul 2026 | 15 agenda pages + download center + local KO site |
| M3 | Aug 2026 | MVP launch — KO/EN + Pagefind + Cloudflare + domain |
| M4 | Sep 2026 | Full 5-language set — JA/ZH/ES added |
| M5–M6 | Oct–Nov | Session accumulation, citizens' Q&A casebook |
| M7–M9 | Dec–Feb 2027 | MVP+1 — Q&A chatbot + 5 more languages |
| M10–M12 | Mar–May | Final retrospective report + English PDF + print edition |

### Stack
Astro static site + Claude API build-time translation + Cloudflare Pages.
SSOT markdown, hash-diff translation cache, GitHub Actions CI, Pagefind multilingual index.

### Contributing
See [CONTRIBUTING.md](./CONTRIBUTING.md). Translation reviewers are welcome.

---

## License

This work is licensed under the **Creative Commons Attribution-ShareAlike 4.0 International License (CC BY-SA 4.0)**.
You are free to share and adapt the material for any purpose, even commercially, under the same license and with appropriate attribution.

See [LICENSE](./LICENSE) for the full text.
