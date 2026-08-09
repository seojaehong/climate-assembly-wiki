# 플랫폼 라이브 HTTP E2E (PostgREST + JWT + RLS) — 2026-08-09

플랫폼 UI가 쓰는 실제 전송(supabase-js → PostgREST HTTP → 롤 스위칭 → RLS/RPC)을
throwaway 스택으로 그대로 재현. psql 파싱검증(G1)을 넘어 **실 전송에서 동작 증명**.

## 스택 (Docker, plat 네트워크)
- `plat-pg` postgres:16 — app DB. app_prelude(롤 anon/authenticated/service_role/authenticator,
  auth.uid()=request.jwt.claims->>'sub', base 테이블) + 전 마이그레이션 + P1/P2 로드 + 활성화 GRANT + 시드
- `plat-rest` postgrest:v12.2.3 — DB_SCHEMAS=climate_vote, ANON_ROLE=anon, JWT_SECRET 공유
- JWT는 같은 secret으로 HS256 서명(anon / authenticated sub=membership.user_id)

## 결과 (전부 통과)
| # | 호출 | 결과 |
|---|---|---|
| 1 | POST /rpc/issue_upsert (조코드 capability) | 201 `{id, created:true}` |
| 2 | POST /rpc/issue_items | 미분류 원문 본문 반환 |
| 3 | **GET /assembly (authenticated JWT)** | **자기 org(test-org) assembly만** — 타 org 미노출. RLS 테넌트 격리 실증 |
| 3b | GET /assembly (anon) | **401** (revoke — staff 테이블 접근 차단) |
| 4 | POST /rpc/issue_link_set | `{linked:1}` |
| 5 | POST /rpc/issue_review | `{review_status:reviewed}` |
| 6 | **POST /rpc/result_publish (조코드)** | **P0001 "attendance authorization required"** — G2 차단 |
| 7 | **POST /rpc/result_publish (HQ 토큰)** | **성공** `{token, published_at, reviewed_count:1}` |
| 8 | POST /rpc/result_get(token) | `{title:본부공개, reviewed:1, teams:["1조"], hitl_notice}` = ResultView 계약 일치 |

## 의미
- 멀티테넌시(row-level org_id + RLS)가 실 HTTP+JWT에서 **테넌트 간 격리** 작동.
- 검수→공개 파이프라인이 실 전송에서 완결.
- G2(publish=HQ 권한)가 실 전송에서 강제.
- 격리 불변식(RPC org_id 미전달, 서버 파생)이 HTTP 계약에서 유지.

## 남은 것(프로덕션 런칭)
실제 Supabase 프로젝트(사용자 계정) + Auth(GoTrue) + 배포. = 배포 행위이지 구현 갭 아님.
런북: `docs/platform/PROVISIONING.md`.

## 실제 프론트엔드 라이브 구동 (2026-08-09)
스택에 nginx 게이트웨이(`/rest/v1/`→PostgREST) + 정적 서버(SPA fallback)를 붙이고,
**실제 빌드된 프론트엔드**(PUBLIC_SUPABASE_URL=localhost 게이트웨이, anon=서명 JWT)를
브라우저로 열어 `/r/<token>` 결과 페이지를 구동.
- supabase-js → `/rest/v1/rpc/result_get` → PostgREST → RLS → 실 데이터 렌더 확인.
- 렌더된 것: 제목("2026 기후시민회의·고령자 계속고용 결과")·검수완료 1/1·HITL 카피·
  쟁점 랭킹(4×6 배지 다수의견/찬성/검수완료)·쟁점 요약·**원문 군집 1건(cluster 분모)**·
  함께확인/더논의/다음단계·접근성 표대체본.
- = React 프론트엔드 + supabase-js + PostgREST + RLS + RPC + Postgres **전 스택 실제 구동**.
- 데모 임시변경(getStaticPaths 1경로·로컬 .env)은 스크린샷 후 원복. 프로덕션은 SSR/rewrite.
