# 플랫폼 트랙 — 상태·병합 전 게이트

- 갱신: 2026-08-11
- 브랜치: `main`
- **백엔드 스키마와 프론트엔드는 2026-08-10 사용자 승인으로 프로덕션에 배포됨.** 기존 `/mod`·`/b`·`/hq`·`/v` 경로는 유지한다.

## ✅ 프로덕션 배포 (2026-08-10) — labor_money, 8/29 무영향
사용자 명시 승인 후 Management API 적용. P1·P2 적용(HTTP 201). anon 검증: result_get→200 null·issue_list/items→invalid join code·result_publish→hq 인증 요구(G2). 신규 테이블(org·membership·invitation·issue·issue_link·result_page)·RPC 존재 확인.
- **8/29 무영향 보장**: 순수 additive(신규 테이블·함수·nullable 컬럼, 기존 s1~s5 무변경) · P1 RLS 휴면(활성화 GRANT 미실행) · **issue_invalidate_guard 트리거는 submission_item에 부착 제외**(검수 단계 시작 시 부착) · p1b backfill/NOT NULL 미적용 · 기존 mod_join·ballot_list 정상 · 테스트 데이터 0건.
- 후속: (검수 시작 시) issue_invalidate_guard 트리거 부착 + 필요시 p1b backfill.

## ✅ 프론트엔드 라이브 배포 (2026-08-10) — climate-assembly.org
사용자 승인("지금 배포") 후 feat/deliberation-saas-platform → main fast-forward 머지(8034e0c..62aef0b)·push·배포 워크플로. 라이브 검증:
- **/platform → 200** (PlatformShell 아일랜드 로드), **/platform/o/... 딥링크 → 200**, **/r/* → 200** (SPA fallback: public/_redirects `/platform/*`·`/r/*` → 호스트 200 rewrite, 404 앞 배치).
- **★ 8/29 라우트 무영향**: /mod·/b·/hq·/v·/mod-help 전부 200.
- 프론트는 supabase.ts fallback=labor_money(커밋 .env 없음) → 방금 적용한 프로덕션 백엔드에 연결.
- /r SPA 호스트: getStaticPaths가 `/r/_/` 1개만 emit(실토큰 미열거). 클라이언트가 window.location에서 토큰 파싱.

## 런칭 상태 = 백엔드+프론트 프로덕션 배포·검증 완료
운영 온보딩(다음): Supabase Auth 운영자 계정 + membership 행 생성해야 /platform 콘솔 staff 경로 사용 가능(참여자·공개 결과는 무기명/토큰이라 즉시). 검수 단계 시작 시 issue_invalidate_guard 트리거 부착.

## 구현 완료 (코드 완성 · 빌드/테스트 통과)

플랜 **Phase 1(분석·검수·공개 파이프라인)** + Phase 2 스키마 토대까지:

| 슬라이스 | 산출물 | 커밋 |
|---|---|---|
| 빌드 스펙 | `docs/platform/BUILD_SPEC.md` (데이터 연결 대전제) | 6d5283b |
| P1 멀티테넌시 스키마 | org·membership·invitation + org 파생 헬퍼 + RLS | b020c84 |
| P2 분석·검수·공개 스키마 | issue·issue_link·result_page + 검수/공개 RPC + issue_items | 8b82150·62aabfc |
| 앱 스켈레톤 | 데이터 트리 네비(하드코딩 메뉴 없음)·Auth 경계·스코프 라우팅 | 2af1ce2 |
| 공개 결과 페이지 | `/r/<token>` 매트릭스·랭킹·4×6·표대체본·HITL | 2af1ce2 |
| 검수 콘솔 | 4×6 코딩·재분류·병합·미분류함 본문·게이트 | 62aabfc |

**최근 검증(2026-08-11):** src Vitest 734건·automation Vitest 70건, Astro check 오류 0, Node20 정적 빌드 통과. 커밋 `5e5406d`의 수동 Cloudflare Pages 배포([run 31427305710](https://github.com/seojaehong/climate-assembly-wiki/actions/runs/31427305710))에서 강제 자산 업로드와 사용자 도메인 ResultView JS 자산 12회 검증이 통과했다. 배포 후 `https://climate-assembly.org` 자동감사 대상 5경로도 모두 통과했고 위반·미완료 판정은 0건이다. 스크린리더·모바일 보조기기 수동평가는 남아 전체 상태는 `needs_review`다. 격리 불변식(RPC org_id 미전달)은 유지한다.

### Phase A 점진 구현 (2026-08-11)

- **A5 자동 감사 기반**: `automation/platform-accessibility-audit.mjs`가 실제 Chromium에서 axe-core WCAG 2.2 AA 태그와 건너뛰기 링크 포커스를 검사한다. 플랫폼 로그인·인증 후 셸·접근성 성명·미공개/공개 결과 5경로의 증거는 `evaluation/platform-accessibility-audit.json`에 저장하며, `.github/workflows/platform-accessibility.yml`이 관련 변경마다 같은 검사를 재실행한다.
- 인증 셸과 공개 결과는 실제 production 컴포넌트에 CI 전용 읽기 응답을 주입하고 readiness selector 도달을 필수로 한다. fixture 이름·준비 상태·axe `incomplete`를 JSON에 보존한다. 스크린리더·모바일 보조기기 전수 수동평가와 공식 품질인증은 완료로 간주하지 않는다.

## 병합 전 게이트

### ✅ G1. SQL 파싱·계약 검증 — 종료 (2026-08-09)
throwaway Postgres16(Docker)로 **실제 파싱 + 함수 본문 검증 + 계약 스모크 + negative** 전부 통과. 재현 하네스 `supabase/verify/`. 발견된 이식성 이슈 1건(P1 gen_random_bytes 미한정) 정정. 상세 `supabase/verify/README.md`.
- 남은 라이브 확인: 실제 Supabase(전용 DB/병합)에 적용 시 anon RPC 계약 재확인(`result_get`→200 null=적용됨).

### ✅ G2. publish 권한 상향 — 종료 (2026-08-09)
`result_publish`/`result_unpublish`를 조 join_code → **HQ 토큰(attendance scope='hq') 서명**으로 상향. 조 코드 publish 차단(컨테이너 검증: "attendance authorization required"), HQ 토큰만 성공(`published_by=hq:actor`). 플랜 §2-3 부합.
- Phase 2: HQ 공유비밀 → membership 인증 + `org_of_token` org 일치 검사 추가(현재 레거시 HQ 토큰은 org null 가능).

### ✅ 라이브 HTTP E2E — 통과 (2026-08-09)
PostgREST+JWT+RLS throwaway 스택으로 **플랫폼 UI 실 전송(supabase-js→PostgREST→RLS/RPC)** 재현. issue_upsert/items/link/review·**RLS 테넌트 격리(자기 org만)**·anon 401·**G2 조코드 거부/HQ토큰 성공**·result_get body(ResultView 계약 일치) 전부 통과. 상세 `supabase/verify/e2e_http.md`. **= "빌드된다"를 넘어 "실 HTTP로 돌아간다" 증명.**

### G3. org_id NOT NULL 전환 — 마이그레이션 작성됨
`platform_p1b_backfill.sql`(기본 org + backfill + NOT NULL). 단일 테넌트 가정. **데이터 있는 실 프로젝트 적용 시 실행**(빈 상태에선 NOT NULL만).

### 프로덕션 런칭 = 배포 행위 (구현 갭 아님)
전용 Supabase 프로젝트(사용자 계정) + Auth + Cloudflare SPA rewrite. **턴키 런북 `docs/platform/PROVISIONING.md`.** 스키마·RLS·파이프라인·보안은 검증 완료.

## Phase 2 진입 전 사용자 결정 (플랜 §5)

1. **테넌시 모델** — A row-level(권장) / B schema / C db-per-tenant (데이터 소재지 요건 시 C)
2. **Supabase Auth 범위** — 운영자·기관관리자만 vs 진행자까지 (참여자 무기명은 불변)
3. **HQ 공유비밀(`climate2026`) → membership 전환 시점** — Phase 2 선행조건(G2와 연동)
4. **셀프서비스 범위** — 완전 마법사(gongron급) vs 설계는 SQL·게이트만 UI (= 설계 마법사 Phase 3 착수 여부)
5. **호스팅·격리** — 단일 Supabase vs 기관별 분리
6. **플랫폼화 착수 자체** — Phase 1까지(vertical 완성) vs Phase 2+ 진행. 재사용 수요 확인 전제

## 보류 중 (결정 대기)

- **설계 마법사(Phase 3)**: assembly/session/topic 생성 UI + assembly 스코프 준비도. 플랜상 Phase 2(tenancy) 이후. §5-4 결정 필요.
- **분석코어 어댑터**: consensus/DQI Python 산출 → issue 적재(service_role). issue_org_derive 트리거로 org 파생 준비됨. 8/29 산출물 확보 후 첫 실전.
- **라이브 프로비저닝**: 전용 DB + Supabase Auth + Cloudflare Pages SPA fallback rewrite(딥링크). 병합 결정 시.
- **A6 자동 export 훅**: 행사일 snapshot workflow에 승인 게이트와 off-DB Drive payload export 경로를 구현했다. repository variable `PLATFORM_SNAPSHOT_ENABLED`는 기본 `false`라 현재 동작과 Drive JSON 형상은 기존 `cv_snapshot_now` 그대로다. 승인 후 정확히 `true`로 켜면 기존 snapshot을 먼저 보존하고 `platform_snapshot_now` 행의 실제 payload를 재조회해 같은 Drive JSON에 담는다. 활성 export에는 GitHub run·commit·snapshot ID·key ID와 platform 행을 외부 secret 기반 HMAC-SHA256으로 결속한 audit manifest가 붙으며, 키·key ID·필수 provenance 누락 시 platform RPC 전에 실패한다. 과거 archive 검증을 위한 키 외부 백업·회전·폐기 절차도 RUNBOOK에 고정했다. 실행당 DB 행이 1개에서 2개로 늘기 때문에 secret 구성과 활성화는 계속 사용자 승인 대상이다. PITR/WAL 설정과 사용자 행위용 별도 운영 감사로그는 아직 미구현이며, 기록 화면 CSV도 이를 대체하지 않는다.

## 다음 액션 (권장 순서)
1. Supabase Auth 운영자 계정과 membership을 승인된 운영 절차로 프로비저닝
2. §5 결정 1·2·3·4·6 — A1~A4 활성화 범위 확정
3. (승인 시) G3·RLS 활성화 GRANT·HQ membership 전환·자동 export 연결
4. 스크린리더·모바일 보조기기 수동 접근성 평가
5. 분석코어 어댑터 → 8/29 산출물로 검수 콘솔 첫 실전
