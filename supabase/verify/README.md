# 플랫폼 스키마 파싱·계약 검증 하네스 (G1)

2026-08-09 실행. throwaway Postgres 16(Docker)로 P1+P2 SQL을 **실제 파싱 + 함수 본문 검증 + 계약 스모크 테스트**. 프로덕션 무관.

## 결과 (전부 통과)
- **패스1** (`check_function_bodies=off`): prelude→mod_console→attendance→s1→s2→s4→**P1→P2** 전체 clean 로드. DDL·문법 에러 0.
- **패스2** (`check_function_bodies=on`): 동일 로드 clean. **P1/P2 전 함수 본문이 실제 컬럼에 대조 검증** 통과.
- **계약 스모크** (`contract_test2/3`): issue_items(미분류2)→issue_upsert→issue_link_set→issue_list(연결1·미분류1·reviewed0)→**result_publish 거부(reviewed0 게이트)**→issue_review→**result_publish 성공(token)**→result_get(body 구조 = 결과페이지 계약과 일치).
- **negative** (`neg_test`): 무효 join_code 거부 · **타 세션 주제 접근 거부(격리 불변식)** · org_of_code 정확 파생(t) · 잠금 가드(final submission에 item 삽입 차단).

## 발견·정정
- P1 `invitation.token` 기본식의 `gen_random_bytes` 미한정 → `extensions.gen_random_bytes`로 통일(P2 스타일). Supabase는 search_path로 동작했으나 이식성 정정.

## 재현 방법
```bash
docker run -d --name pgverify -e POSTGRES_PASSWORD=verify -e POSTGRES_DB=verify -p 55432:5432 postgres:16
# 롤·publication·auth.uid·search_path (Supabase 모사)
docker exec pgverify psql -U postgres -d verify -c "create role anon nologin; create role authenticated nologin; create role service_role nologin; create publication supabase_realtime; alter database verify set search_path=public,extensions,climate_vote;"
docker cp <migrations>/*.sql pgverify:/tmp/ ; docker cp *.sql pgverify:/tmp/
MSYS_NO_PATHCONV=1 docker exec pgverify psql -U postgres -d verify -v ON_ERROR_STOP=1 -f /tmp/driver_pass1.sql   # 패스1
# 패스2 = driver의 off→on 치환 후 clean DB 재실행
# 계약 = contract_test2.sql → contract_test3.sql → neg_test.sql
```

## 환경 조정 (Supabase 전용, 우리 SQL 버그 아님)
롤 anon/authenticated/service_role · publication supabase_realtime · `auth.uid()` stub · pgcrypto in extensions + search_path · base 테이블 stub(session/votes/rounds/snapshots — 마이그레이션 폴더 밖).

## 남은 게이트
G1 종료. **G2(publish 권한: join_code→HQ/org_admin 상향)·G3(org_id NOT NULL)는 병합 시.** 계약 검증으로 **G2의 실재(한 조 코드가 publish 가능)를 재확인** — 실제로 654321 조 코드로 result_publish가 성공함. HQ 서명 상향 필요.
