# 공론화 SaaS 플랫폼 — 빌드 스펙 v1

- 작성: 2026-08-09
- 브랜치: `feat/deliberation-saas-platform` (워크트리 `C:/Users/iceam/dev/climate-saas-platform`)
- 상위 근거: `10_작업산출물/2026-08-09_공론화플랫폼_아키텍처_플랜.md`
- **격리 원칙**: 8/29 라이브(main: `/mod`·`/b`·`/hq`)는 **현 상태 그대로 사용**. 본 트랙은 별개로 진행하고 추후 합병 여부는 별도 결정. **프로덕션 DB의 기존 RPC/테이블 동작을 바꾸지 않는다**(순수 additive만, 그마저도 병합 전까지 미적용).

---

## 0. 설계 대전제 — "메뉴 연결"이 아니라 "데이터 연결"

현행 `/mod` 콘솔은 기능 패널을 나열한 구조다(투표·타이머·산출물·출석이 한 화면에 병렬). 플랫폼은 그 반대다:

> **화면 구조가 도메인 데이터 관계(FK)를 그대로 반영한다.** 네비게이션은 하드코딩된 메뉴가 아니라 `org → 공론화 → 회차 → 세션 → 주제 → [산출물·투표·분석·검수·공개]` 트리를 DB에서 읽어 렌더한다. 한 노드를 고르면 그 스코프의 자식·산출물만 보인다(gongron의 "범위를 좁힌다" 모델과 동형, 단 데이터 주도).

이 한 문장이 UI·라우팅·권한의 하중을 지탱한다. 라우트도 데이터 경로를 따른다:
`/platform/o/<org>/c/<campaign>/f/<forum>/s/<session>/t/<topic>/{record|vote|analyze|review|publish}`

---

## 1. 연결 도메인 모델 (스파인)

```
org (기관)  ─┬─ membership (user × org × role)
             └─ invitation
   │ org_id
   ▼
assembly (공론화/사업)
   │ assembly_id
   ▼
session (회차, ordinal·held_on)
   │ session_id
   ├──────────────┐
   ▼              ▼
discussion_topic  ballot (회차 단위 투표)
   │ topic_id      │ ballot_id
   ├──────────┐    ├── ballot_item ── ballot_response(무기명)
   ▼          ▼    
submission    issue ── issue_link ─→ submission_item
(조별산출물)  (쟁점)   (cluster_id)
   │            │
   └ item       └─ (분석코어 적재 · 사람 검수)
                
result_page (scope: topic|session|assembly, token) ─ 공개 게이트: review_status='reviewed'

team ── team_assignment ── assembly_member  (조·명부·출석, 일부 PII)
attendance_*  (무기명 응답과 구조적 조인 불가)
```

- **투표축(ballot, session 단위) ↔ 분석축(submission·issue, topic 단위) 분리.** gongron 동형.
- **모든 위계 테이블에 `org_id`** — 직접 컬럼 또는 assembly 상속. 격리는 §3 불변식으로 강제.
- **무기명군(ballot_response·votes)과 명부군(assembly_member·attendance)은 공유 식별자·FK 금지** — 개인↔응답 연결 통로가 존재해선 안 된다.

---

## 2. 멀티테넌시

### 2-1. 모델 = row-level (`org_id` + RLS), 플랜 §2-1 권장 채택
schema/database-per-tenant 기각. 근거: additive 경로·단일 RPC 자산·크로스 분석.

### 2-2. 격리 불변식 (플랜 §2-4, 이 트랙의 최상위 규칙)
> **어떤 RPC도 `org_id`를 인자로 받지 않는다.** 서버가 파생한다:
> - `org_of_code(join_code)` — 조 코드 → team → session → assembly → org
> - `org_of_token(hq_token)` — HQ/staff 토큰 → membership → org
> - `org_of_uid()` — `auth.uid()` → membership → org
> 클라이언트는 org를 주장할 수 없다.

- **RLS의 사정거리**: 기존 테이블은 `revoke all from anon, authenticated` 상태 → RLS 정책은 **Supabase Auth staff 세션에만** 작동. 무기명 경로는 계속 RPC 내부 스코핑.
- 신규 staff 경로(운영자·기관관리자·본부)는 **Supabase Auth 계정 + membership**. 이 트랙에서 처음 도입.

### 2-3. 권한 매트릭스 (역할 6종)
플랜 §2-3 그대로 채택. 참여자·진행자=무기명/조코드, 운영자·본부·기관관리자=Auth+membership, 분석기계=service_role(run별 org 고정).

---

## 3. 스키마 슬라이스 (마이그레이션)

> 파일 prefix `platform_` — 프로덕션 s1~s5와 네임스페이스 구분. **병합 전까지 프로덕션 미적용.** 별도 검증 DB 또는 climate_vote에 additive(기존 미영향)로만.

| 슬라이스 | 파일 | 내용 |
|---|---|---|
| **P1 테넌시 코어** | `platform_p1_tenancy.sql` | org·membership·invitation + org 파생 헬퍼 3종 + RLS 정책(assembly 등 read/write) + org_id nullable 부착·기본org backfill |
| **P2 분석·검수·공개** | `platform_p2_analysis_review.sql` | issue·issue_link(cluster_id)·result_page + 검수 RPC(issue_list/upsert/link/merge/review) + 공개 게이트(result_publish: ≥1 reviewed) + result_get(token 공개) + service_role 적재 경로 |
| **P3 설계 셀프서비스 지원** | `platform_p3_design.sql` | assembly 스코프 `readiness_check` 변형 + assembly/session/topic CRUD RPC(staff, org 파생) |

**advisor 반영(별도 트랙이라 프로덕션 미변경이지만 신규 경로에 선반영):**
- submission 신규 경로는 **stable item id**(upsert by submission_id+ordinal, delete-all 금지) — issue_link FK 안정.
- issue 무효화: submission_item 변경 시 연결 issue를 `review_status='draft'`로 되돌림(재검수 강제).
- cluster_id: nullable. **합의도 분모 = distinct 연결 item-set**(cluster_id 있으면 cluster, 없으면 item 집합). result_get에 명시.
- 공개 게이트: 스코프 내 `reviewed` issue **≥1** 필수(0이면 거부 — 공허 참 방지).
- 스냅샷: 플랫폼 스냅샷 함수는 issue·issue_link·result_page·submission·ballot 포함.

---

## 4. 앱 구조 (데이터 주도)

### 4-1. 라우트 (데이터 경로 = URL 경로)
```
/platform                     로그인(Supabase Auth) → org 선택
/platform/o/<org>             org 대시보드: 공론화 목록(데이터)
  .../c/<campaign>            공론화: 회차·설계 준비도
  .../f/<forum>               회차: 세션·투표
  .../s/<session>/t/<topic>   주제: 산출물·분석·검수
  .../review                  검수 콘솔(issue 4×6·링크·병합·cluster)
  .../publish → /r/<token>    공개 결과 페이지(읽기전용, HITL)
```

### 4-2. 네비게이션 = DB 트리
좌측 트리는 `org_of_uid()` 스코프에서 assembly→session→topic을 재귀 조회해 렌더. **메뉴 하드코딩 없음.** 노드 선택 = 스코프 좁히기(브레드크럼 = 데이터 경로).

### 4-3. 기술 스택
기존 wiki(Astro+React islands)를 그대로 쓰되 `/platform/*`는 **인증 필요 SSR/CSR 경계**. 정적 wiki와 라우트 네임스페이스로 분리. Supabase Auth 세션. 기존 mod-console 컴포넌트(VoteCard·결과 렌더)는 재사용 가능한 것만 발췌.

---

## 5. 빌드 순서 (이 트랙)

1. **P1 스키마** (테넌시 코어) — 헬퍼·RLS·backfill
2. **P2 스키마** (분석·검수·공개) — issue·result_page·게이트
3. **앱 스켈레톤** — Auth 진입 + org 선택 + 데이터 트리 네비 (빈 스코프 화면)
4. **검수 콘솔** — issue CRUD·링크·4×6·병합·cluster·review
5. **결과 페이지** `/r/<token>` — 공개 게이트·매트릭스·HITL
6. **설계 마법사** (P3) — assembly/session/topic 생성 + 준비도 게이트
7. **분석코어 어댑터** — consensus/DQI 산출 → 검수 전용 issue import plan(dry-run)까지 구현. 실제 issue 적재(service_role)는 8/29 산출물 확보와 별도 승인 후 수행

1~2는 병행, 3 이후 UI는 스키마 검증 후 착수. 각 슬라이스 vitest + Node20 빌드 게이트.

---

## 6. 8/29 합병 경로 (추후)

- 8/29 라이브 데이터(단일 assembly)를 기본 org에 backfill하면 그대로 플랫폼에 편입.
- 기존 `/mod`·`/b`·`/hq`는 유지하거나 플랫폼 라우트로 점진 이관.
- **합병은 별도 결정** — 본 트랙은 그때까지 독립 브랜치.

---

## 7. 미결정 (플랜 §5에서 승계)
테넌시 모델(A 권장)·Auth 범위·HQ 비밀 전환 시점·셀프서비스 범위·호스팅·플랫폼화 착수 자체. 구현은 A(row-level)·staff Auth 도입 전제로 진행하되, 이 6건은 병합 결정 시 재확인.
