#!/usr/bin/env bash
set -euo pipefail
# s34 진행 기록 계약 시험 — 버림용 postgres:16 컨테이너(Docker)에서만 돈다. 운영 DB 무관.
# verify-s26-postgres.sh 와 같은 바탕(0912 driver 앞부분) 위에 1005~1111 투표 파일을 사전순으로 얹고 s34 를 두 번 적용한다.
cd "$(dirname "${BASH_SOURCE[0]}")/.."
mkdir -p .tmp-verify && driver_tmp=".tmp-verify/s34-driver.sql"
sed '/BEHAVIOR VERIFICATION/,$d' automation/tests/fixtures/0912-p1a-driver.sql > "$driver_tmp"
export MSYS_NO_PATHCONV=1
c="s34-verify-$$"
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
docker cp supabase/tests/s34_ballot_progress.test.sql "$c:/tmp/s34.test.sql"
echo "== driver"
docker exec "$c" psql -U postgres -d verify -q -v ON_ERROR_STOP=1 -v p1a_throwaway_fixture=on -f /tmp/0912-p1a-driver.sql 2>&1 | grep -E "===|ERROR" | tail -5
echo "== ballot track 1005..1111"
for f in 20261005_s24_ballot_status_division_scope.sql 20261005_s25_ballot_create_division_scope.sql \
         20261017_s28_named_ballot.sql 20261017_s29_session_roster_read.sql 20261017_s30_roster_get_open_only.sql \
         20261110_s31_ballot_limit_30.sql 20261111_s32_vote_dup_guard.sql 20261111_s33_ballot_limit_80.sql \
         20261111_s33_ballot_start.sql; do
  echo "-- $f"
  docker exec "$c" psql -U postgres -d verify -q -v ON_ERROR_STOP=1 -c "set check_function_bodies=on" -f "/tmp/$f"
done
echo "== s34 apply x2 (idempotency)"
docker exec "$c" psql -U postgres -d verify -q -v ON_ERROR_STOP=1 -c "set check_function_bodies=on" -f /tmp/20261112_s34_ballot_progress.sql
docker exec "$c" psql -U postgres -d verify -q -v ON_ERROR_STOP=1 -c "set check_function_bodies=on" -f /tmp/20261112_s34_ballot_progress.sql
echo "== s34 test"
docker exec "$c" psql -U postgres -d verify -v ON_ERROR_STOP=1 -f /tmp/s34.test.sql
echo "== rollback then re-apply"
docker cp supabase/rollbacks/20261112_s34_ballot_progress_BEFORE.sql "$c:/tmp/s34_rollback.sql"
docker exec "$c" psql -U postgres -d verify -q -v ON_ERROR_STOP=1 -f /tmp/s34_rollback.sql
docker exec "$c" psql -U postgres -d verify -tAc "select to_regclass('climate_vote.ballot_progress') is null, to_regprocedure('climate_vote.ballot_progress_board(text,uuid)') is null"
docker exec "$c" psql -U postgres -d verify -q -v ON_ERROR_STOP=1 -f /tmp/20261112_s34_ballot_progress.sql
echo "S34_RUN_DONE"
