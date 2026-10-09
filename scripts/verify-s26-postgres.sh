#!/usr/bin/env bash
set -euo pipefail
# s26 분과 준비 상태 계약 시험 — 버림용 postgres:16 컨테이너(Docker)에서만 돈다. 운영 DB 무관.
# 0912 driver 의 BEHAVIOR VERIFICATION 단계는 시드 세션 만료(9/13)로 지금은 실패하므로 그 앞까지만 적용한다.
cd "$(dirname "${BASH_SOURCE[0]}")/.."
mkdir -p .tmp-verify && driver_tmp=".tmp-verify/s26-driver.sql"
sed '/BEHAVIOR VERIFICATION/,$d' automation/tests/fixtures/0912-p1a-driver.sql > "$driver_tmp"
export MSYS_NO_PATHCONV=1
c="s26-verify-$$"
trap 'docker rm -f "$c" >/dev/null 2>&1 || true; rm -f "$driver_tmp"' EXIT
docker run -d --name "$c" -e POSTGRES_PASSWORD=verify -e POSTGRES_DB=verify postgres:16 >/dev/null
for _ in $(seq 1 60); do docker exec "$c" psql -U postgres -d verify -tAc "select 1" >/dev/null 2>&1 && break; sleep 1; done
sleep 2
docker exec "$c" psql -U postgres -d verify -v ON_ERROR_STOP=1 -c \
  "create role anon nologin; create role authenticated nologin; create role service_role nologin; create publication supabase_realtime; alter database verify set search_path=public,extensions,climate_vote;" >/dev/null
docker cp supabase/migrations/. "$c:/tmp/"
docker cp supabase/verify/00_prelude.sql "$c:/tmp/00_prelude.sql"
docker cp supabase/verify/platform_p1a_0912_event_access.sql "$c:/tmp/platform_p1a_0912_event_access.verify.sql"
docker cp supabase/verify/20260912_s23_division_progress_board.sql "$c:/tmp/20260912_s23_division_progress_board.verify.sql"
docker cp supabase/verify/20260912_s24_recommendation_workflow.sql "$c:/tmp/20260912_s24_recommendation_workflow.verify.sql"
docker cp automation/tests/fixtures/0912-p1a-seed.sql "$c:/tmp/0912-p1a-seed.sql"
docker cp "$driver_tmp" "$c:/tmp/0912-p1a-driver.sql"
docker cp supabase/tests/s26_division_prep_state.test.sql "$c:/tmp/s26.test.sql"
echo "== driver"
docker exec "$c" psql -U postgres -d verify -q -v ON_ERROR_STOP=1 -v p1a_throwaway_fixture=on -f /tmp/0912-p1a-driver.sql 2>&1 | grep -E "===|ERROR" | tail -5
echo "== 1005 s24/s25"
for f in 20261005_s24_ballot_status_division_scope.sql 20261005_s25_ballot_create_division_scope.sql; do
  docker exec "$c" psql -U postgres -d verify -q -v ON_ERROR_STOP=1 -c "set check_function_bodies=on" -f "/tmp/$f"
done
echo "== s26 apply x2 (idempotency)"
docker exec "$c" psql -U postgres -d verify -q -v ON_ERROR_STOP=1 -c "set check_function_bodies=on" -f /tmp/20261010_s26_division_prep_state.sql
docker exec "$c" psql -U postgres -d verify -q -v ON_ERROR_STOP=1 -c "set check_function_bodies=on" -f /tmp/20261010_s26_division_prep_state.sql
echo "== s26 test"
docker exec "$c" psql -U postgres -d verify -v ON_ERROR_STOP=1 -f /tmp/s26.test.sql
echo "== post-test leftovers (expect 0 0)"
docker exec "$c" psql -U postgres -d verify -tAc "select (select count(*) from climate_vote.division_prep_state),(select count(*) from climate_vote.division_prep_revision)"
echo "S26_RUN_DONE"
