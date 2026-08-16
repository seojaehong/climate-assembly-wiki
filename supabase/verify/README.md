# 플랫폼 스키마 파싱·계약 검증 하네스 (G1)

2026-08-09 실행. throwaway Postgres 16(Docker)로 P1+P2 SQL을 **실제 파싱 + 함수 본문 검증 + 계약 스모크 테스트**. 2026-08-16에 P1C 다중 기관 선택·RLS·rollback rehearsal을 추가했다. 프로덕션 무관.

## 결과 (전부 통과)
- **패스1** (`check_function_bodies=off`): prelude→mod_console→attendance→s1→s2→s4→**P1→P1C→P2** 전체 clean 로드. DDL·문법 에러 0.
- **패스2** (`check_function_bodies=on`): 동일 로드 clean. **P1/P1C/P2 전 함수 본문이 실제 컬럼에 대조 검증** 통과.
- **계약 스모크** (`contract_test2/3`): issue_items(미분류2)→issue_upsert→issue_link_set→issue_list(연결1·미분류1·reviewed0)→**result_publish 거부(reviewed0 게이트)**→issue_review→**result_publish 성공(token)**→result_get(body 구조 = 결과페이지 계약과 일치).
- **negative** (`neg_test`): 무효 join_code 거부 · **타 세션 주제 접근 거부(격리 불변식)** · org_of_code 정확 파생(t) · 잠금 가드(final submission에 item 삽입 차단).
- **P1C 기관 선택** (`org_selection_test.sql`): 다중 membership에서 미선택 거부 → `org_select` token 발급 → Auth user·JWT session·header token 결속 → assembly/session/topic/submission/ballot 5개 staff table의 선택 org 단일 노출 → operator의 선택 org 내부 쓰기와 교차 org 차단·facilitator 쓰기 차단 → session/user/token 상충 및 만료 token 차단 → 다음 선택 시 만료 context 정리 → rollback 후 기존 다중 org 거부·membership-wide 휴면 policy 복원.
- **P1C 적용 후 읽기 전용 검증** (`org_selection_post_apply.sql`): migration 직후 staff GRANT 휴면 상태(`expect_staff_grants=off`)와 별도 승인 GRANT 이후 활성 상태(`on`)에서 테이블·제약·인덱스·RLS·정책·함수·권한을 fail-closed 확인한다. SQL은 DB 객체나 데이터를 변경하지 않는다.

## 발견·정정
- P1 `invitation.token` 기본식의 `gen_random_bytes` 미한정 → `extensions.gen_random_bytes`로 통일(P2 스타일). Supabase는 search_path로 동작했으나 이식성 정정.
- P1의 `session_tenant_*` policy는 존재했지만 legacy `session` table에 RLS enable이 없었다. P1C가 5개 staff table의 RLS를 activation grant 전에 명시적으로 재활성화하고, 실제 5-table visibility test가 이를 고정한다.

## 재현 방법
```bash
docker run -d --name pgverify -e POSTGRES_PASSWORD=verify -e POSTGRES_DB=verify -p 55432:5432 postgres:16
# 롤·publication·auth.uid·search_path (Supabase 모사)
docker exec pgverify psql -U postgres -d verify -c "create role anon nologin; create role authenticated nologin; create role service_role nologin; create publication supabase_realtime; alter database verify set search_path=public,extensions,climate_vote;"
docker cp <migrations>/*.sql pgverify:/tmp/ ; docker cp *.sql pgverify:/tmp/
MSYS_NO_PATHCONV=1 docker exec pgverify psql -U postgres -d verify -v ON_ERROR_STOP=1 -v verify_function_bodies=off -f /tmp/driver_pass1.sql
# 패스2 = clean DB에서 `-v verify_function_bodies=on`으로 동일 driver 재실행
# 계약 = contract_test2.sql → contract_test3.sql → neg_test.sql
# P1C 계약 = org_selection_test.sql (rollback까지 포함하므로 별도 clean DB에서 실행)
# P1C 적용 직후 = psql ... -v expect_staff_grants=off -f /tmp/org_selection_post_apply.sql
# 별도 승인 staff GRANT 이후 = psql ... -v expect_staff_grants=on -f /tmp/org_selection_post_apply.sql
```

## 환경 조정 (Supabase 전용, 우리 SQL 버그 아님)
롤 anon/authenticated/service_role · publication supabase_realtime · `auth.uid()` stub · pgcrypto in extensions + search_path · base 테이블 stub(session/votes/rounds/snapshots — 마이그레이션 폴더 밖).

## 남은 게이트
G1 종료. **G2(publish 권한: join_code→HQ/org_admin 상향)·G3(org_id NOT NULL)는 병합 시.** 계약 검증으로 **G2의 실재(한 조 코드가 publish 가능)를 재확인** — 실제로 654321 조 코드로 result_publish가 성공함. HQ 서명 상향 필요.
