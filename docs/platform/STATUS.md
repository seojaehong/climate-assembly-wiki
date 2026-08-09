# 플랫폼 트랙 — 상태·병합 전 게이트

- 갱신: 2026-08-09
- 브랜치: `feat/deliberation-saas-platform` (워크트리 `C:/Users/iceam/dev/climate-saas-platform`)
- 8/29 라이브(main)와 **완전 격리**. 프로덕션 DB 미적용.

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

**누적 검증:** vitest 59, astro check 0, Node20 빌드 7911페이지. 격리 불변식(RPC org_id 미전달) 관철.

## ★★★ 병합 전 하드 게이트 (반드시)

### G1. SQL 라이브 파싱 미검증 — 최우선
P1+P2(~1400줄, 다수 함수)는 **아직 Postgres로 파싱된 적이 없다.** 로컬에 psql/supabase CLI 없고, 스펙상 프로덕션 미적용이라 미검증. 정적 점검(dollar-quote·paren 균형·컬럼 교차참조)만 통과.
- **조치**: 병합 결정 시 **전용 스크래치 DB 또는 climate_vote에 additive 적용**해 파싱 확인 → anon RPC로 계약 검증(`result_get`→200 null=적용됨). 그 전엔 어떤 라이브 주장도 금물.

### G2. publish 권한 상향 — 보안 구멍
`result_publish(p_code, p_scope, p_scope_id, p_title)`가 **운영자 join_code 서명**이다. `p_scope='assembly'`면 **한 조의 조 코드가 공론화 전체 결과를 공개**할 수 있다(권한 격상). 플랜 §2-3은 publish=HQ/org_admin 전용.
- **조치**: Phase 2 HQ 토큰→membership 전환 시 `result_publish`를 HQ/org_admin 서명으로 교체. **병합 전 반드시 상향.** (현재 플랫폼 미가동이라 실피해 없음)

### G3. org_id NOT NULL 전환
P1이 15테이블에 org_id nullable 부착. **영구 nullable = 격리 구멍**(정책이 NULL 행을 조용히 포함/누락). backfill(기본 org 생성 후 UPDATE) → NOT NULL 전환 필요.

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

## 다음 액션 (권장 순서)
1. G1 파싱 검증(스크래치 DB) — 이후 UI 라이브 E2E 가능
2. §5 결정 1·2·3·6 — Phase 2 진입 여부
3. (진행 시) G2·G3 반영 + Phase 2 활성화 GRANT + backfill
4. 분석코어 어댑터 → 8/29 산출물로 검수 콘솔 첫 실전
