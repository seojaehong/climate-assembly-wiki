---
name: project-climate-wiki
description: 2026 기후시민회의 모더레이터 아카이브 위키 프로젝트 컨텍스트 — Astro scaffold 완료
metadata:
  type: project
---

Astro 5 scaffold completed on branch `feature/astro-scaffold` (commit 537cf4b).

**Why:** PM위임 구현 작업. SCHEMA.md가 단일 진실의 원천. Subagent A(Astro scaffold), B(docx→md), C(번역), D(배포) 협업 구조.

**How to apply:** content/ko/session/**.md YAML의 unquoted date는 native Date object로 파싱됨 — schema에 z.coerce.date().transform() 적용 필수. B 서브에이전트 파일은 01-...md 이후로 시작. 00-dummy.md는 A전용 빌드 검증용.

Key paths:
- Repo: C:/Users/iceam/OneDrive/_30_컨설팅/2026/기후회의모더레이터/wiki/
- Schema config: src/content/config.ts (zod, glob loader from ./content/ko/)
- Content: content/ko/{agenda,session,doc,glossary}/
- GitHub: seojaehong/climate-assembly-wiki
- Site placeholder: https://climate-assembly-wiki.pages.dev
