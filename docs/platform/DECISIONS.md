# 플랫폼 트랙 — 결정·divergence 로그

병합(8/29 라이브와 합치기) 결정 시 반드시 재확인할 항목. 스펙: `BUILD_SPEC.md`.

## 확정된 격리 원칙
- 프로덕션(main·climate_vote) **미적용** — 병합 전까지. 8/29는 현 상태 그대로.
- 스키마는 순수 additive이나, P1이 기존 15테이블에 `org_id` nullable 추가(비파괴적이나 구조 변경)이므로 **적용 자체를 병합까지 보류**.
- 라이브 검증(psql/supabase CLI·전용 DB) 미수행 — 코드·문법 자체점검만. **실 적용 검증은 DB 프로비저닝/병합 시점**.

## P1(테넌시) 미결
- `org_of_uid` 다중 org → raise (org 선택 RPC 미구현, Phase 2 TODO)
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
- **격리 불변식**: RPC는 org_id 인자 안 받음. `org_of_code/uid/token`으로만 서버 파생.
- **stable-id 비대칭**: `issue_link.item_id`=NO ACTION → s1 delete-all이 링크 원문 삭제 시 조용히 파괴 않고 FK 실패. 안정 경로=`submission_save_v2`.
- **cluster 분모**: `count(distinct coalesce(cluster_id, item_id))` — gongron R2 분모팽창 해결.
- **무기명↔명부 비연결**: 공유 FK 금지 불변식.
