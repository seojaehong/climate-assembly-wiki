# 플랫폼 트랙 — 결정·divergence 로그

병합(8/29 라이브와 합치기) 결정 시 반드시 재확인할 항목. 스펙: `BUILD_SPEC.md`.

## 확정된 격리 원칙
- 프로덕션(main·climate_vote) **미적용** — 병합 전까지. 8/29는 현 상태 그대로.
- 스키마는 순수 additive이나, P1이 기존 15테이블에 `org_id` nullable 추가(비파괴적이나 구조 변경)이므로 **적용 자체를 병합까지 보류**.
- 라이브 검증(psql/supabase CLI·전용 DB) 미수행 — 코드·문법 자체점검만. **실 적용 검증은 DB 프로비저닝/병합 시점**.

## P1(테넌시) 미결
- `platform_p1c_org_selection.sql` 초안은 다중 소속 사용자의 명시적 기관 선택을 추가했다. 탭별 opaque 토큰을 `sessionStorage`와 `x-platform-org-context` 요청 헤더로 전달하고, 서버가 `auth.uid()`·JWT `session_id`·활성 membership·활성 org를 매 요청 다시 대조한다. 토큰 원문은 DB에 저장하지 않고 SHA-256만 저장한다.
- `org_select(p_org)`는 기관 ID를 받는 유일한 예외 RPC다. 도메인 데이터를 읽거나 쓰는 RPC는 계속 org ID를 인자로 받지 않으며 `org_of_uid()`에서 검증된 선택을 파생한다.
- **2026-08-17 사용자 승인:** `platform_p1c_org_selection.sql` 초안과 대응 rollback·UI·정적 계약 테스트를 승인했다. 이 승인은 설계 초안의 저장소 채택만 뜻하며, 실제 Supabase 적용, count-only preflight RPC 설치, backfill, NOT NULL, staff table GRANT, Auth 계정·membership 생성은 포함하지 않는다. 각 production 변경은 별도 승인 전까지 금지한다.
- A3는 UI 접근 계획과 공용 schema를 쓰는 저장소 외부 dry-run provisioning plan 및 adapter-independent executor core까지만 허용한다. core는 HMAC 승인·안정 lookup·응답 유실 reconciliation·비식별 receipt를 강제하지만 production Supabase/Auth adapter는 invitation 멱등 저장 계약 승인 전까지 연결하지 않으며, 현재 plan을 직접 SQL/API 실행 목록으로 해석하지 않는다.
- **2026-08-25 사용자 승인:** A4 migration 초안 작성과 저장소 채택을 승인했다. team identity는 `(session_id, ordinal)`, session slug는 기존 전역 unique, plan 전체 단일 transaction, join code는 승인된 staff의 현재 성공 응답에서만 표시, 기존 행 backfill은 별도 승인으로 확정한다. SQL 초안·rollback·read-only preflight·post-apply verifier·격리 PostgreSQL rehearsal·hash bundle까지만 허용하며 production 적용, backfill·NOT NULL, Auth·membership, staff GRANT, 실제 traffic, executor 연결은 승인하지 않았다. 따라서 dry-run plan은 계속 `readyForExecution:false`다.
- `org_of_token` 레거시 HQ 단일-org fallback → 2번째 org 생기는 순간 raise. **HQ 공유비밀→membership 전환이 Phase 2 선행조건**(플랜 §0-5 동일)
- org_id 영구 nullable = 격리 구멍 → backfill 후 NOT NULL 전환 필수(병합 시)
- RLS 정책 11종은 `revoke all` 때문에 휴면 — 활성화 GRANT(+Supabase Auth)까지 무동작(의도적)

## P2(분석·검수·공개) divergence
1. **✅ publish 권한 (G2 종료 2026-08-09)**: `result_publish`/`unpublish`를 HQ 토큰(attendance scope='hq') 서명으로 상향 완료. 조 코드 publish 차단. Phase 2에서 HQ 공유비밀→membership 인증 + org 일치 검사만 남음.
2. **미분류 원문**: body에 count만 적재. spec B11은 본문까지 공개 원함 → 축약. (전수 역추적 원칙과 절충 재확인)
3. **공개 게이트 임계**: ≥1 reviewed(BUILD_SPEC advisor 확정). spec §3-5 "전부 reviewed"보다 완화.
4. **result_page 동시성**: (scope,scope_id) 유니크 없음, select-for-update만 → 동시 publish 2건 가능. 단일 운영자 트랙 허용 범위.
5. **provenance 잔존**: `submission_save_v2` upsert가 provenance 미갱신 → content 교체 시 utterance_uids 구 텍스트 지시 가능. issue draft 복귀로 완화하나 감사추적 일시 부정확.

## 방어 설계(유지할 것)
- **격리 불변식**: 도메인 RPC는 org_id 인자를 받지 않는다. 기관 선택 전용 `org_select`만 요청 기관을 받아 membership을 검증하고, 이후 `org_of_uid()`가 요청 컨텍스트에서 파생한다.
- **stable-id 비대칭**: `issue_link.item_id`=NO ACTION → s1 delete-all이 링크 원문 삭제 시 조용히 파괴 않고 FK 실패. 안정 경로=`submission_save_v2`.
- **cluster 분모**: `count(distinct coalesce(cluster_id, item_id))` — gongron R2 분모팽창 해결.
- **무기명↔명부 비연결**: 공유 FK 금지 불변식.
