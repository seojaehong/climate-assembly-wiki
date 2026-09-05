#!/usr/bin/env bash
set -euo pipefail

release_mode=false
if [[ "${1:-}" == "--release" ]]; then
  release_mode=true
  shift
fi
if [[ "$#" -ne 0 ]]; then
  echo "usage: $0 [--release]" >&2
  exit 2
fi

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"
started_seconds=$SECONDS
# The verifier is commonly launched from WSL against a worktree checked out by
# Windows Git. Use the checkout's CRLF normalization semantics explicitly so a
# release run still rejects content changes without treating every text file as
# dirty solely because WSL has a separate global Git configuration.
git_autocrlf="${P1A_GIT_AUTOCRLF:-true}"
git_repo() {
  git -c "core.autocrlf=$git_autocrlf" "$@"
}
source_commit="$(git_repo rev-parse HEAD)"
node_bin="${P1A_NODE_BIN:-node}"
if ! command -v "$node_bin" >/dev/null 2>&1 && [[ "$node_bin" == "node" ]]; then
  for candidate in "/mnt/c/Program Files/nodejs/node.exe" "/c/Program Files/nodejs/node.exe"; do
    if [[ -x "$candidate" ]]; then
      node_bin="$candidate"
      break
    fi
  done
fi
if ! "$node_bin" --version >/dev/null 2>&1; then
  echo "Node.js runtime not found; set P1A_NODE_BIN to an executable path" >&2
  exit 1
fi

# Bind every SQL input and browser contract exercised by this run to an exact
# SHA-256 manifest. This makes a dirty-tree development pass reproducible;
# release evidence additionally refuses any dirty target before Docker starts.
target_files=(
  "supabase/migrations/platform_p1a_0912_event_access.sql"
  "supabase/migrations/platform_p2a_0912_token_only_activation.sql"
  "supabase/rollbacks/platform_p1_BEFORE.sql"
  "supabase/rollbacks/platform_p1a_0912_event_access_BEFORE.sql"
  "supabase/rollbacks/platform_p2a_0912_token_only_activation_BEFORE.sql"
  "supabase/verify/platform_p1a_0912_event_access.sql"
  "supabase/verify/platform_p2a_0912_token_only_activation.sql"
  "supabase/verify/platform_p2a_0912_token_only_activation_rollback.sql"
  "supabase/verify/design_provisioning_post_apply.sql"
  "supabase/verify/platform_audit_history_snapshot.sql"
  "supabase/verify/platform_audit_post_apply.sql"
  "supabase/verify/platform_audit_test.sql"
  "supabase/verify/driver_pass1.sql"
  "automation/tests/fixtures/0912-p1a-driver.sql"
  "automation/tests/fixtures/0912-p1a-activation-driver.sql"
  "automation/tests/fixtures/0912-p1a-seed.sql"
  "automation/tests/fixtures/0912-seed-cli-prelude.sql"
  "scripts/verify-workshop-access-contract.mjs"
  "scripts/verify-0912-postgres.sh"
  "scripts/loadtest-mod-console.mjs"
  "automation/0912-rpc-contract.mjs"
  "automation/tests/0912-rpc-contract.test.mjs"
  "src/lib/workshop-access.ts"
  "src/lib/mod-console.ts"
  "src/lib/deliberation.ts"
  "src/lib/workshop-hq.ts"
  "src/lib/attendance.ts"
  "src/lib/hq-submissions.ts"
  "src/lib/platform.ts"
  "src/islands/CanvasBoard.tsx"
  "src/islands/mod/ModConsole.tsx"
  "src/islands/mod/mod-console-accessibility.test.ts"
  "src/islands/mod/HqSubmissionBoard.tsx"
  "src/islands/mod/hq-submission-board-logic.ts"
  "src/islands/mod/VoteCard.tsx"
  "src/islands/platform/publish/ImplementationConsole.tsx"
  "src/pages/v.astro"
  "public/v/vote-form.js"
  "public/v/index.html"
  "docs/operations/0912-13-runbook.md"
  "docs/platform/platform-compliance-catalog.json"
)
# The static contract verifier also derives migration ordering from the whole
# platform_p* namespace, so bind that directory view rather than only today's
# known filenames.
for platform_sql in supabase/migrations/platform_p*.sql; do
  target_files+=("$platform_sql")
done
for driver in \
  automation/tests/fixtures/0912-p1a-driver.sql \
  automation/tests/fixtures/0912-p1a-activation-driver.sql \
  automation/tests/fixtures/0912-seed-cli-prelude.sql; do
  while IFS= read -r sql_name; do
    for candidate in \
      "supabase/migrations/$sql_name" \
      "supabase/verify/$sql_name" \
      "automation/tests/fixtures/$sql_name"; do
      if [[ -f "$candidate" ]]; then
        target_files+=("$candidate")
        break
      fi
    done
  done < <(sed -n 's#^[[:space:]]*\\i[[:space:]]\+/tmp/##p' "$driver")
done
mapfile -t target_files < <(printf '%s\n' "${target_files[@]}" | LC_ALL=C sort -u)
target_manifest_count="${#target_files[@]}"
test "$target_manifest_count" -gt 0
for target_file in "${target_files[@]}"; do
  if [[ ! -f "$target_file" ]]; then
    echo "manifest target missing: $target_file" >&2
    exit 1
  fi
done
target_dirty="$(git_repo status --porcelain -- "${target_files[@]}")"
if [[ "$release_mode" == "true" && -n "$target_dirty" ]]; then
  echo "release verification refused: target manifest contains dirty files" >&2
  printf '%s\n' "$target_dirty" >&2
  exit 1
fi
compute_target_manifest() {
  "$node_bin" -e '
    const crypto = require("node:crypto");
    const fs = require("node:fs");
    const entries = process.argv.slice(1).map((path) => ({
      path: path.replaceAll("\\\\", "/"),
      sha256: crypto.createHash("sha256").update(fs.readFileSync(path)).digest("hex"),
    }));
    process.stdout.write(JSON.stringify(entries));
  ' "${target_files[@]}"
}
target_manifest="$(compute_target_manifest)"
target_manifest_sha256="$(printf '%s' "$target_manifest" | sha256sum | cut -d' ' -f1)"
"$node_bin" scripts/verify-workshop-access-contract.mjs >/dev/null
echo "target_manifest_count=$target_manifest_count target_manifest_sha256=$target_manifest_sha256 release_mode=$release_mode"
if [[ -z "$(git_repo status --porcelain)" ]]; then
  source_tree_clean=true
else
  source_tree_clean=false
fi

container="${P1A_CONTAINER_NAME:-p1a-0912-${RANDOM}-$$}"
container_id=""
seed_sql_path=""
concurrency_dir=""
cleanup() {
  if [[ -n "$container_id" ]]; then
    docker rm -f "$container_id" >/dev/null 2>&1 || true
  fi
  if [[ -n "$seed_sql_path" && -f "$seed_sql_path" ]]; then
    rm -f -- "$seed_sql_path"
  fi
  if [[ -n "$concurrency_dir" && -d "$concurrency_dir" ]]; then
    rm -rf -- "$concurrency_dir"
  fi
}
trap cleanup EXIT

echo "verification_scope=disposable-postgres-16 production_mutations=0"
container_id="$(docker run -d --name "$container" \
  -e POSTGRES_PASSWORD=verify \
  -e POSTGRES_DB=verify \
  postgres:16)"
for _ in $(seq 1 60); do
  if docker exec "$container" psql -U postgres -d verify \
    -v ON_ERROR_STOP=1 -tAc "select 1" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
docker exec "$container" psql -U postgres -d verify \
  -v ON_ERROR_STOP=1 -tAc "select 1" >/dev/null
docker exec "$container" psql -U postgres -d verify \
  -v ON_ERROR_STOP=1 -c \
  "create role anon nologin; create role authenticated nologin; create role service_role nologin; create publication supabase_realtime; alter database verify set search_path=public,extensions,climate_vote;"

docker cp supabase/migrations/. "${container}:/tmp/"
docker cp supabase/rollbacks/platform_p1_BEFORE.sql \
  "${container}:/tmp/platform_p1_BEFORE.sql"
docker cp supabase/rollbacks/platform_p1a_0912_event_access_BEFORE.sql \
  "${container}:/tmp/platform_p1a_0912_event_access_BEFORE.sql"
docker cp supabase/verify/00_prelude.sql "${container}:/tmp/00_prelude.sql"
docker cp supabase/verify/driver_pass1.sql "${container}:/tmp/driver_pass1.sql"
docker cp supabase/verify/platform_p1a_0912_event_access.sql \
  "${container}:/tmp/platform_p1a_0912_event_access.verify.sql"
docker cp automation/tests/fixtures/0912-p1a-seed.sql \
  "${container}:/tmp/0912-p1a-seed.sql"
docker cp automation/tests/fixtures/0912-p1a-driver.sql \
  "${container}:/tmp/0912-p1a-driver.sql"
docker cp supabase/rollbacks/platform_p2a_0912_token_only_activation_BEFORE.sql \
  "${container}:/tmp/platform_p2a_0912_token_only_activation_BEFORE.sql"
docker cp supabase/verify/platform_p2a_0912_token_only_activation.sql \
  "${container}:/tmp/platform_p2a_0912_token_only_activation.verify.sql"
docker cp supabase/verify/platform_p2a_0912_token_only_activation_rollback.sql \
  "${container}:/tmp/platform_p2a_0912_token_only_activation.rollback.verify.sql"
docker cp supabase/verify/design_provisioning_post_apply.sql \
  "${container}:/tmp/design_provisioning_post_apply.sql"
docker cp supabase/verify/platform_audit_history_snapshot.sql \
  "${container}:/tmp/platform_audit_history_snapshot.sql"
docker cp supabase/verify/platform_audit_post_apply.sql \
  "${container}:/tmp/platform_audit_post_apply.sql"
docker cp supabase/verify/platform_audit_test.sql \
  "${container}:/tmp/platform_audit_test.sql"
docker cp automation/tests/fixtures/0912-p1a-activation-driver.sql \
  "${container}:/tmp/0912-p1a-activation-driver.sql"
docker cp automation/tests/fixtures/0912-seed-cli-prelude.sql \
  "${container}:/tmp/0912-seed-cli-prelude.sql"

docker exec "$container" psql -U postgres -d verify \
  -v ON_ERROR_STOP=1 -v p1a_throwaway_fixture=on \
  -f /tmp/0912-p1a-driver.sql

# Six simultaneous failures in one source/device bucket must serialize: five
# are recorded and the sixth observes the device limit instead of racing past it.
join_rate_pids=()
for _ in $(seq 1 6); do
  docker exec "$container" psql -U postgres -d verify -v ON_ERROR_STOP=1 -Atq -c \
    "select set_config('request.headers','{\"x-forwarded-for\":\"198.51.100.99\"}',false);
     select climate_vote.mod_exchange_join_code('999999',
       '91200000-0000-0000-0000-000000000099','concurrent-negative');" \
    >/dev/null &
  join_rate_pids+=("$!")
done
for pid in "${join_rate_pids[@]}"; do wait "$pid"; done
concurrent_join_failures="$(docker exec "$container" psql -U postgres -d verify \
  -v ON_ERROR_STOP=1 -Atq -c \
  "select count(*) from climate_vote.workshop_join_exchange_attempt
    where device_id='91200000-0000-0000-0000-000000000099' and not succeeded;")"
test "$concurrent_join_failures" = "5"
docker exec "$container" psql -U postgres -d verify -v ON_ERROR_STOP=1 -Atq -c \
  "delete from climate_vote.workshop_join_exchange_attempt
    where device_id='91200000-0000-0000-0000-000000000099';" >/dev/null
echo "concurrent_join_rate_limit=pass recorded_failures=5"

# Clone the quiet P1a state and prove the complete rollback path restores the
# exact legacy global constraint before removing org_id. The primary database
# remains available for the independent P1a rollback/race checks below.
docker exec "$container" createdb -U postgres --template=verify verify_p1_rollback
docker exec "$container" psql -U postgres -d verify_p1_rollback \
  -v ON_ERROR_STOP=1 -f /tmp/platform_p1a_0912_event_access_BEFORE.sql >/dev/null
docker exec "$container" psql -U postgres -d verify_p1_rollback \
  -v ON_ERROR_STOP=1 -f /tmp/platform_p1_BEFORE.sql >/dev/null
p1_rollback_clean_state="$(docker exec "$container" psql -U postgres \
  -d verify_p1_rollback -v ON_ERROR_STOP=1 -Atq -c \
  "select case when
      not exists(select 1 from information_schema.columns
        where table_schema='climate_vote' and table_name='assembly_member'
          and column_name='org_id')
      and to_regclass('climate_vote.org') is null
      and to_regclass('climate_vote.assembly_member_org_official_id_uniq') is null
      and exists(
        select 1
          from pg_constraint c
          join pg_index i on i.indexrelid=c.conindid
          join pg_attribute a
            on a.attrelid=c.conrelid and a.attname='official_id' and not a.attisdropped
         where c.conrelid='climate_vote.assembly_member'::regclass
           and c.conname='assembly_member_official_id_key'
           and c.contype='u' and c.convalidated
           and c.conkey=array[a.attnum]::smallint[]
           and i.indisunique and i.indisvalid and i.indisready)
    then 1 else 0 end;")"
test "$p1_rollback_clean_state" = "1"
docker exec "$container" dropdb -U postgres --force verify_p1_rollback
echo "p1_rollback_clean_path=pass global_unique=restored"

# With no persisted event activity, the reviewed rollback must be complete.
docker exec "$container" psql -U postgres -d verify \
  -v ON_ERROR_STOP=1 \
  -f /tmp/platform_p1a_0912_event_access_BEFORE.sql
dropped_rpc_count="$(docker exec "$container" psql -U postgres -d verify \
  -v ON_ERROR_STOP=1 -Atq -c \
  "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='climate_vote' and p.proname in ('mod_exchange_join_code','submission_save_v3','workshop_hq_status');")"
test "$dropped_rpc_count" = "0"

# Reapply, create a session-bound Canvas round, and prove its relational scope
# alone makes rollback refuse before any audit event is written.
docker exec "$container" psql -U postgres -d verify \
  -v ON_ERROR_STOP=1 -c "set check_function_bodies=on" \
  -f /tmp/platform_p1a_0912_event_access.sql >/dev/null
docker exec "$container" psql -U postgres -d verify \
  -v ON_ERROR_STOP=1 -c \
  "insert into climate_vote.rounds(id,title,type,options,status,team_id,session_id,org_id,created_by)
   values('rollback-canvas-scope-guard','Rollback Canvas guard','SCALE_MULTI','[\"A\"]','pending',null,
     '91200000-0000-0000-0000-000000000003','91200000-0000-0000-0000-000000000001','verify');" >/dev/null
if canvas_rollback_output="$(docker exec "$container" psql -U postgres -d verify \
  -v ON_ERROR_STOP=1 \
  -f /tmp/platform_p1a_0912_event_access_BEFORE.sql 2>&1)"; then
  echo "P1a rollback unexpectedly erased a session-bound Canvas round" >&2
  exit 1
fi
grep -q "P1a rollback refused: workshop activity exists" <<<"$canvas_rollback_output"
docker exec "$container" psql -U postgres -d verify \
  -v ON_ERROR_STOP=1 -c \
  "delete from climate_vote.rounds where id='rollback-canvas-scope-guard';" >/dev/null

# A synthetic audit event independently preserves the original activity guard.
docker exec "$container" psql -U postgres -d verify \
  -v ON_ERROR_STOP=1 -c \
  "insert into climate_vote.workshop_audit_event(org_id,session_id,action,actor_scope,actor_label) values ('91200000-0000-0000-0000-000000000001','91200000-0000-0000-0000-000000000003','rollback_guard_fixture','hq','synthetic verifier');" >/dev/null
if rollback_output="$(docker exec "$container" psql -U postgres -d verify \
  -v ON_ERROR_STOP=1 \
  -f /tmp/platform_p1a_0912_event_access_BEFORE.sql 2>&1)"; then
  echo "P1a rollback unexpectedly erased synthetic event activity" >&2
  exit 1
fi
printf '%s\n' "$rollback_output"
grep -q "P1a rollback refused: workshop activity exists" <<<"$rollback_output"

# The activation rehearsal starts from a second empty database in the same
# disposable PostgreSQL container. P1a's synthetic audit row must never be
# mistaken for a production-ready activation precondition.
docker exec "$container" dropdb -U postgres --force verify
docker exec "$container" createdb -U postgres verify
docker exec "$container" psql -U postgres -d verify \
  -v ON_ERROR_STOP=1 -c \
  "create publication supabase_realtime; alter database verify set search_path=public,extensions,climate_vote;"
if activation_rollback_guard_output="$(docker exec "$container" psql -U postgres -d verify \
  -v ON_ERROR_STOP=1 \
  -f /tmp/platform_p2a_0912_token_only_activation_BEFORE.sql 2>&1)"; then
  echo "P2a activation rollback unexpectedly ran without an incident acknowledgement" >&2
  exit 1
fi
grep -q "explicit legacy-access acknowledgement required" <<<"$activation_rollback_guard_output"
echo "activation_rollback_guard=pass unacknowledged_execution=blocked"
docker exec "$container" psql -U postgres -d verify \
  -v ON_ERROR_STOP=1 -v p1a_throwaway_fixture=on \
  -f /tmp/0912-p1a-activation-driver.sql

# The activation driver runs the read-only P3/P4 post-apply checks immediately
# after their migrations and before the post-P4 legacy-access negative check.
echo "p3_p4_read_only_post_apply=pass production_mutations=0"

# Exercise P4's mutating behavior suite in an independent disposable database
# with the A6 fixture it was designed for. The full activation database remains
# untouched for the P1a/P2a concurrency and rollback checks that follow.
docker exec "$container" createdb -U postgres verify_p4_behavior
docker exec "$container" psql -U postgres -d verify_p4_behavior \
  -v ON_ERROR_STOP=1 -c \
  "create publication supabase_realtime; alter database verify_p4_behavior set search_path=public,extensions,climate_vote;" >/dev/null
docker exec "$container" psql -U postgres -d verify_p4_behavior \
  -v ON_ERROR_STOP=1 -v verify_function_bodies=on -f /tmp/driver_pass1.sql >/dev/null
docker exec "$container" psql -U postgres -d verify_p4_behavior \
  -v ON_ERROR_STOP=1 -f /tmp/platform_p3_design_provisioning.sql >/dev/null
docker exec "$container" psql -U postgres -d verify_p4_behavior \
  -v ON_ERROR_STOP=1 -f /tmp/platform_p4_audit_log.sql >/dev/null
docker exec "$container" psql -U postgres -d verify_p4_behavior \
  -v ON_ERROR_STOP=1 -f /tmp/platform_audit_test.sql >/dev/null
docker exec "$container" dropdb -U postgres --force verify_p4_behavior
echo "p4_behavior_verification=pass database=disposable-clone"

# The activation verifier itself is transactional. Exercise the remaining
# multi-connection invariants against the final reapplied P2a state before this
# disposable database is discarded. Capability values stay in mode-700 temp
# files and are never printed.
concurrency_dir="$(mktemp -d)"
chmod 700 "$concurrency_dir"

# Three distinct devices race on one valid code. The team-row FOR UPDATE lock
# must admit exactly two live workshop tokens and reject the third.
docker exec "$container" psql -U postgres -d verify -v ON_ERROR_STOP=1 -Atq -c \
  "update climate_vote.session set status='active',access_expires_at=now()+interval '2 hours'
     where id='91200000-0000-0000-0000-000000000003';
   update climate_vote.team set join_code='731245'
     where id='91200000-0000-0000-0000-000000000011';
   update climate_vote.attendance_auth_session set revoked_at=now()
     where team_id='91200000-0000-0000-0000-000000000011'
       and scope='team' and purpose='workshop' and revoked_at is null;" >/dev/null
team_exchange_pids=()
for suffix in 1 2 3; do
  device_id="91200000-0000-0000-0000-00000000050${suffix}"
  (
    docker exec "$container" psql -U postgres -d verify -v ON_ERROR_STOP=1 -Atq -c \
      "select climate_vote.mod_exchange_join_code('731245',
        '${device_id}','Concurrent device ${suffix}');" \
      >"$concurrency_dir/team-${suffix}.out" 2>&1 || true
  ) &
  team_exchange_pids+=("$!")
done
for pid in "${team_exchange_pids[@]}"; do wait "$pid"; done
team_exchange_successes=0
for result_file in "$concurrency_dir"/team-*.out; do
  if grep -q 'accessToken' "$result_file"; then
    ((team_exchange_successes+=1))
  fi
done
active_team_devices="$(docker exec "$container" psql -U postgres -d verify \
  -v ON_ERROR_STOP=1 -Atq -c \
  "select count(distinct device_id) from climate_vote.attendance_auth_session
    where team_id='91200000-0000-0000-0000-000000000011'
      and session_id='91200000-0000-0000-0000-000000000003'
      and scope='team' and purpose='workshop' and revoked_at is null
      and expires_at>now();")"
test "$team_exchange_successes" = "2"
test "$active_team_devices" = "2"
echo "concurrent_team_device_limit=pass successes=2 active_devices=2"

# Distinct request ids from two moderator devices race to open an active round.
# The team lock and partial unique index must commit exactly one round; the
# loser returns the durable winner id instead of creating a second active row.
docker exec "$container" psql -U postgres -d verify -v ON_ERROR_STOP=1 -Atq -c \
  "update climate_vote.attendance_auth_session set revoked_at=now()
     where team_id='91200000-0000-0000-0000-000000000011'
       and scope='team' and purpose='workshop' and revoked_at is null;
   update climate_vote.rounds set status='closed'
     where team_id='91200000-0000-0000-0000-000000000011' and status='active';" >/dev/null
round_team_token="$(docker exec "$container" psql -U postgres -d verify \
  -v ON_ERROR_STOP=1 -Atq -c \
  "select climate_vote.mod_exchange_join_code('731245',
    '91200000-0000-0000-0000-000000000510','Concurrent round device')->>'accessToken';")"
if [[ "${#round_team_token}" -ne 64 ]]; then
  echo "concurrent active-round setup failed to mint a workshop token" >&2
  exit 1
fi
round_create_pids=()
for suffix in 1 2; do
  (
    docker exec "$container" psql -U postgres -d verify -v ON_ERROR_STOP=1 -Atq -c \
      "select (climate_vote.mod_create_round_v3('${round_team_token}',
        'Concurrent active ${suffix}','RADIO',jsonb_build_array('yes','no'),
        '91200000-0000-0000-0000-00000000052${suffix}')).id;" \
      >"$concurrency_dir/round-${suffix}.out" 2>&1 || true
  ) &
  round_create_pids+=("$!")
done
for pid in "${round_create_pids[@]}"; do wait "$pid"; done
round_create_successes=0
round_create_conflicts=0
for result_file in "$concurrency_dir"/round-*.out; do
  if grep -q '^m-' "$result_file"; then ((round_create_successes+=1)); fi
  if grep -q 'active round conflict: existing round' "$result_file"; then
    ((round_create_conflicts+=1))
  fi
done
active_round_id="$(docker exec "$container" psql -U postgres -d verify \
  -v ON_ERROR_STOP=1 -Atq -c \
  "select id from climate_vote.rounds
    where team_id='91200000-0000-0000-0000-000000000011' and status='active';")"
active_round_count="$(docker exec "$container" psql -U postgres -d verify \
  -v ON_ERROR_STOP=1 -Atq -c \
  "select count(*) from climate_vote.rounds
    where team_id='91200000-0000-0000-0000-000000000011' and status='active';")"
active_round_audits="$(docker exec "$container" psql -U postgres -d verify \
  -v ON_ERROR_STOP=1 -Atq -c \
  "select count(*) from climate_vote.workshop_audit_event
    where action='round_created'
      and team_id='91200000-0000-0000-0000-000000000011'
      and request_id in ('91200000-0000-0000-0000-000000000521',
        '91200000-0000-0000-0000-000000000522');")"
echo "concurrent_active_round_observed successes=${round_create_successes} conflicts=${round_create_conflicts} active_rounds=${active_round_count} audits=${active_round_audits}"
if [[ "$round_create_conflicts" -ne 1 ]]; then
  for result_file in "$concurrency_dir"/round-*.out; do
    grep '^ERROR:' "$result_file" >&2 || true
  done
fi
test "$round_create_successes" = "1"
test "$round_create_conflicts" = "1"
test "$active_round_count" = "1"
test "$active_round_audits" = "1"
test -n "$active_round_id"
grep -q "existing round ${active_round_id}" "$concurrency_dir"/round-*.out
echo "concurrent_active_round_creation=pass successes=1 conflicts=1 active_rounds=1"
docker exec "$container" psql -U postgres -d verify -v ON_ERROR_STOP=1 -Atq -c \
  "update climate_vote.rounds set status='closed' where id='${active_round_id}';" >/dev/null

# Shared HQ password failures use one subject lock. Five failures are retained,
# the sixth is throttled, and no token is minted.
docker exec "$container" psql -U postgres -d verify -v ON_ERROR_STOP=1 -Atq -c \
  "insert into climate_vote.attendance_secret(secret_key,secret_hash)
     values('hq_password',extensions.crypt('Concurrent shared password',extensions.gen_salt('bf',4)))
     on conflict(secret_key) do update set secret_hash=excluded.secret_hash;
   delete from climate_vote.attendance_auth_attempt where scope='hq' and subject='hq';" >/dev/null
shared_token_count_before="$(docker exec "$container" psql -U postgres -d verify \
  -v ON_ERROR_STOP=1 -Atq -c "select count(*) from climate_vote.attendance_auth_session;")"
shared_hq_pids=()
for suffix in $(seq 1 6); do
  (
    docker exec "$container" psql -U postgres -d verify -v ON_ERROR_STOP=1 -Atq -c \
      "select climate_vote.attendance_hq_unlock('wrong shared password',
        'Concurrent shared ${suffix}');" \
      >"$concurrency_dir/shared-hq-${suffix}.out" 2>&1 || true
  ) &
  shared_hq_pids+=("$!")
done
for pid in "${shared_hq_pids[@]}"; do wait "$pid"; done
shared_hq_failures="$(docker exec "$container" psql -U postgres -d verify \
  -v ON_ERROR_STOP=1 -Atq -c \
  "select count(*) from climate_vote.attendance_auth_attempt
    where scope='hq' and subject='hq' and not succeeded;")"
shared_token_count_after="$(docker exec "$container" psql -U postgres -d verify \
  -v ON_ERROR_STOP=1 -Atq -c "select count(*) from climate_vote.attendance_auth_session;")"
test "$shared_hq_failures" = "5"
test "$shared_token_count_after" = "$shared_token_count_before"
echo "concurrent_shared_hq_throttle=pass recorded_failures=5 minted_tokens=0"

# Public failures against a known account name cannot block a correct login.
# Once authenticated, concurrent wrong-current-password attempts share a
# separate actor budget. The correct credential remains blocked until that
# private budget expires, then rotates the secret and revokes every bearer.
docker exec "$container" psql -U postgres -d verify -v ON_ERROR_STOP=1 -Atq -c \
  "insert into climate_vote.attendance_secret(secret_key,secret_hash)
     values('hq:Concurrent rate operator',extensions.crypt('Concurrent named password',extensions.gen_salt('bf',4)))
     on conflict(secret_key) do update set secret_hash=excluded.secret_hash;
   insert into climate_vote.hq_operator(name,default_subgroup,active,must_change_password)
     values('Concurrent rate operator','synthetic',true,true)
     on conflict(name) do update set active=true,must_change_password=true;
   delete from climate_vote.attendance_auth_attempt
     where scope='hq' and subject in (
       'Concurrent rate operator','password-change:Concurrent rate operator');
   insert into climate_vote.attendance_auth_attempt(scope,subject,succeeded,source_hash)
     select 'hq','Concurrent rate operator',false,repeat('c',64)
       from generate_series(1,5);" >/dev/null
named_hq_token="$(docker exec "$container" psql -U postgres -d verify -v ON_ERROR_STOP=1 -Atq -c \
  "select climate_vote.attendance_hq_unlock_named(
      'Concurrent rate operator','Concurrent named password')
    from (select set_config('request.headers',
      '{\"x-forwarded-for\":\"198.51.100.43\"}',true) as configured) source
    where source.configured is not null;")"
test "${#named_hq_token}" = "64"
named_token_count_before="$(docker exec "$container" psql -U postgres -d verify \
  -v ON_ERROR_STOP=1 -Atq -c "select count(*) from climate_vote.attendance_auth_session;")"
named_audit_count_before="$(docker exec "$container" psql -U postgres -d verify \
  -v ON_ERROR_STOP=1 -Atq -c "select count(*) from climate_vote.attendance_audit_log;")"
named_workshop_audit_before="$(docker exec "$container" psql -U postgres -d verify \
  -v ON_ERROR_STOP=1 -Atq -c \
  "select count(*) from climate_vote.workshop_audit_event
    where action='hq_password_changed' and actor_label='Concurrent rate operator';")"
named_hq_pids=()
for suffix in $(seq 1 6); do
  (
    docker exec "$container" psql -U postgres -d verify -v ON_ERROR_STOP=1 -Atq -c \
      "select climate_vote.hq_change_password('${named_hq_token}',
        'wrong named password','Concurrent replacement password');" \
      >"$concurrency_dir/named-hq-${suffix}.out" 2>&1 || true
  ) &
  named_hq_pids+=("$!")
done
for pid in "${named_hq_pids[@]}"; do wait "$pid"; done
named_incorrect_results=0
named_rate_limited_results=0
for result_file in "$concurrency_dir"/named-hq-*.out; do
  if grep -q 'current_password_incorrect' "$result_file"; then
    ((named_incorrect_results+=1))
  fi
  if grep -q 'rate_limited' "$result_file"; then
    ((named_rate_limited_results+=1))
  fi
done
named_password_failures="$(docker exec "$container" psql -U postgres -d verify \
  -v ON_ERROR_STOP=1 -Atq -c \
  "select count(*) from climate_vote.attendance_auth_attempt
    where scope='hq' and subject='password-change:Concurrent rate operator'
      and not succeeded
      and source_hash is null;")"
named_blocked_recovery_result="$(docker exec "$container" psql -U postgres -d verify \
  -v ON_ERROR_STOP=1 -Atq -c \
  "select climate_vote.hq_change_password('${named_hq_token}',
    'Concurrent named password','Concurrent replacement password');")"
grep -q '"error": "rate_limited"' <<<"$named_blocked_recovery_result"
named_blocked_state_ok="$(docker exec "$container" psql -U postgres -d verify \
  -v ON_ERROR_STOP=1 -Atq -c \
  "select case when
      (select extensions.crypt('Concurrent named password',secret_hash)=secret_hash
         from climate_vote.attendance_secret where secret_key='hq:Concurrent rate operator')
      and (select revoked_at is null from climate_vote.attendance_auth_session
        where token_hash=encode(extensions.digest('${named_hq_token}','sha256'),'hex'))
    then 1 else 0 end;")"
test "$named_blocked_state_ok" = "1"
docker exec "$container" psql -U postgres -d verify -v ON_ERROR_STOP=1 -Atq -c \
  "update climate_vote.attendance_auth_attempt
      set attempted_at=now()-interval '16 minutes'
    where scope='hq' and subject='password-change:Concurrent rate operator'
      and not succeeded;" >/dev/null
named_recovery_result="$(docker exec "$container" psql -U postgres -d verify \
  -v ON_ERROR_STOP=1 -Atq -c \
  "select climate_vote.hq_change_password('${named_hq_token}',
    'Concurrent named password','Concurrent replacement password');")"
grep -q '"changed": true' <<<"$named_recovery_result"
named_state_ok="$(docker exec "$container" psql -U postgres -d verify \
  -v ON_ERROR_STOP=1 -Atq -c \
  "select case when
      (select extensions.crypt('Concurrent replacement password',secret_hash)=secret_hash
         from climate_vote.attendance_secret where secret_key='hq:Concurrent rate operator')
      and not (select must_change_password from climate_vote.hq_operator
         where name='Concurrent rate operator')
      and (select count(*) from climate_vote.attendance_auth_session)=${named_token_count_before}
      and (select count(*) from climate_vote.attendance_audit_log)=${named_audit_count_before}
      and (select count(*) from climate_vote.workshop_audit_event
        where action='hq_password_changed' and actor_label='Concurrent rate operator')
          =${named_workshop_audit_before}+1
    then 1 else 0 end;")"
test "$named_incorrect_results" = "5"
test "$named_rate_limited_results" = "1"
test "$named_password_failures" = "5"
test "$named_state_ok" = "1"
if docker exec "$container" psql -U postgres -d verify -v ON_ERROR_STOP=1 -Atq -c \
  "select climate_vote.attendance_token_row('${named_hq_token}');" \
  >"$concurrency_dir/named-old-token.out" 2>&1; then
  echo "password recovery left old named HQ bearer usable" >&2
  exit 1
fi
grep -q 'expired or revoked' "$concurrency_dir/named-old-token.out"
echo "concurrent_named_password_recovery=pass account_poison_failures=5 incorrect=5 rate_limited=1 recovery_after_window=true old_bearer_revoked=true"

# A staff close that owns the ballot row lock must win over a concurrent public
# submit. The submit waits, rechecks the committed status, and writes no row.
docker exec "$container" psql -U postgres -d verify -v ON_ERROR_STOP=1 -Atq -c \
  "update climate_vote.attendance_auth_session set revoked_at=now()
     where team_id='91200000-0000-0000-0000-000000000011'
       and scope='team' and purpose='workshop' and revoked_at is null;
   insert into climate_vote.ballot(id,session_id,title,status,token,created_by,org_id)
     values('91200000-0000-0000-0000-000000000991',
       '91200000-0000-0000-0000-000000000003','Ballot close race','open',
       '91200000000000000000000000000999','verify',
       '91200000-0000-0000-0000-000000000001');
   insert into climate_vote.ballot_item(id,ballot_id,ordinal,statement,scale,required)
     values('91200000-0000-0000-0000-000000000992',
       '91200000-0000-0000-0000-000000000991',1,'Race item',5,true);" >/dev/null
ballot_staff_token="$(docker exec "$container" psql -U postgres -d verify -v ON_ERROR_STOP=1 -Atq -c \
  "select climate_vote.attendance_issue_token('team',
     '91200000-0000-0000-0000-000000000011','Ballot race closer');")"
test "${#ballot_staff_token}" = "64"
docker exec "$container" psql -U postgres -d verify -v ON_ERROR_STOP=1 -Atq -c \
  "update climate_vote.attendance_auth_session
      set purpose='workshop',device_id='91200000-0000-0000-0000-000000000993'
    where token_hash=encode(extensions.digest('${ballot_staff_token}','sha256'),'hex');" \
  >/dev/null
(
  docker exec "$container" psql -U postgres -d verify -v ON_ERROR_STOP=1 -Atq -c \
    "begin;
     select climate_vote.ballot_set_status_v2('${ballot_staff_token}',
       '91200000-0000-0000-0000-000000000991','closed');
     select pg_advisory_xact_lock(9120912);
     select pg_sleep(3);
     commit;" >"$concurrency_dir/ballot-close.out" 2>&1
) &
ballot_close_pid="$!"
ballot_close_ready=false
for _ in $(seq 1 30); do
  if [[ "$(docker exec "$container" psql -U postgres -d verify -Atq -c \
    'select pg_try_advisory_lock(9120912);')" == "f" ]]; then
    ballot_close_ready=true
    break
  fi
  sleep 0.1
done
test "$ballot_close_ready" = "true"
if docker exec "$container" psql -U postgres -d verify -v ON_ERROR_STOP=1 -Atq -c \
  "select climate_vote.ballot_submit('91200000000000000000000000000999',
    'ballot-close-race-client',
    jsonb_build_object('91200000-0000-0000-0000-000000000992',5));" \
  >"$concurrency_dir/ballot-submit.out" 2>&1; then
  echo "ballot submit unexpectedly beat committed close" >&2
  exit 1
fi
wait "$ballot_close_pid"
grep -q 'ballot not open or event unavailable' "$concurrency_dir/ballot-submit.out"
ballot_race_state="$(docker exec "$container" psql -U postgres -d verify \
  -v ON_ERROR_STOP=1 -Atq -c \
  "select case when
      (select status from climate_vote.ballot
        where id='91200000-0000-0000-0000-000000000991')='closed'
      and (select count(*) from climate_vote.ballot_response
        where ballot_id='91200000-0000-0000-0000-000000000991')=0
    then 1 else 0 end;")"
test "$ballot_race_state" = "1"
echo "ballot_close_race=pass close_wins=true responses=0"

# P1 rollback must refuse before changing any schema when tenant-scoped rows
# cannot satisfy the legacy global official_id invariant. Exercise this after
# P1b removed the global constraint and before the CLI-only database reset.
docker exec "$container" psql -U postgres -d verify -v ON_ERROR_STOP=1 -Atq -c \
  "insert into climate_vote.org(id,slug,name,status)
     values('91200000-0000-0000-0000-000000000901','p1-rollback-org',
       'P1 rollback verifier','active');
   insert into climate_vote.assembly_member(id,official_id,name,active,source_hash,org_id)
     values
       ('91200000-0000-0000-0000-000000000902','P1-ROLLBACK-DUPLICATE',
        'P1 rollback member A',true,'verify','91200000-0000-0000-0000-000000000001'),
       ('91200000-0000-0000-0000-000000000903','P1-ROLLBACK-DUPLICATE',
        'P1 rollback member B',true,'verify','91200000-0000-0000-0000-000000000901');" >/dev/null
if p1_rollback_output="$(docker exec "$container" psql -U postgres -d verify \
  -v ON_ERROR_STOP=1 -f /tmp/platform_p1_BEFORE.sql 2>&1)"; then
  echo "P1 rollback unexpectedly removed tenant boundaries with global duplicates" >&2
  exit 1
fi
grep -q "P1 rollback refused: assembly member official ids are not globally unique" \
  <<<"$p1_rollback_output"
p1_rollback_state="$(docker exec "$container" psql -U postgres -d verify \
  -v ON_ERROR_STOP=1 -Atq -c \
  "select case when
      exists(select 1 from information_schema.columns
        where table_schema='climate_vote' and table_name='assembly_member'
          and column_name='org_id')
      and to_regclass('climate_vote.assembly_member_org_official_id_uniq') is not null
      and to_regclass('climate_vote.org') is not null
      and (select count(*) from climate_vote.assembly_member
        where official_id='P1-ROLLBACK-DUPLICATE')=2
    then 1 else 0 end;")"
test "$p1_rollback_state" = "1"
echo "p1_rollback_duplicate_guard=pass schema_state=preserved"

# Execute the actual operational CLI output in a third empty database. The
# generated capability values stay in a private temporary file and are never
# printed to stdout, the report, or the repository.
echo "=== CLI-GENERATED 0912 SEED SQL IN DISPOSABLE POSTGRESQL ==="
docker exec "$container" dropdb -U postgres --force verify
docker exec "$container" createdb -U postgres verify
docker exec "$container" psql -U postgres -d verify \
  -v ON_ERROR_STOP=1 -c \
  "create publication supabase_realtime; alter database verify set search_path=public,extensions,climate_vote;"
docker exec "$container" psql -U postgres -d verify \
  -v ON_ERROR_STOP=1 -v seed_cli_throwaway_fixture=on \
  -f /tmp/0912-seed-cli-prelude.sql >/dev/null

seed_sql_path="$(mktemp)"
chmod 600 "$seed_sql_path"
seed_sql_mode="0$(stat -c '%a' "$seed_sql_path")"
test "$seed_sql_mode" = "0600"
"$node_bin" scripts/seed-0829-teams.mjs --print-seed-sql >"$seed_sql_path"
test -s "$seed_sql_path"
docker cp "$seed_sql_path" "${container}:/tmp/0912-seed-cli-generated.sql" >/dev/null
rm -f -- "$seed_sql_path"
seed_sql_path=""
docker exec "$container" psql -U postgres -d verify \
  -v ON_ERROR_STOP=1 -f /tmp/0912-seed-cli-generated.sql >/dev/null

seed_success="$(docker exec "$container" psql -U postgres -d verify -Atq -v ON_ERROR_STOP=1 -c \
  "select case when
      (select count(*) from climate_vote.session where slug='0912-deliberation'
        and org_id='89200000-0000-4000-8000-000000000001'
        and assembly_id='89200000-0000-4000-8000-000000000002'
        and held_on=date '2026-09-12')=1
      and (select count(*) from climate_vote.team t join climate_vote.session s on s.id=t.session_id
        where s.slug='0912-deliberation' and t.status='active' and t.org_id=s.org_id)=15
      and (select count(distinct join_code) from climate_vote.team t join climate_vote.session s on s.id=t.session_id
        where s.slug='0912-deliberation' and join_code ~ '^[0-9]{6}$')=15
    then 1 else 0 end;")"
test "$seed_success" = "1"

seed_code_digest_before="$(docker exec "$container" psql -U postgres -d verify -Atq -v ON_ERROR_STOP=1 -c \
  "select md5(string_agg(t.join_code,',' order by t.name)) from climate_vote.team t
    join climate_vote.session s on s.id=t.session_id where s.slug='0912-deliberation';")"
docker exec "$container" psql -U postgres -d verify -v ON_ERROR_STOP=1 -c \
  "insert into climate_vote.org(id,slug,name,status) values
     ('89200000-0000-4000-8000-000000000004','seed-cli-mismatch-org','Seed CLI mismatch organization','active');
   update climate_vote.team set org_id='89200000-0000-4000-8000-000000000004'
   where id=(select t.id from climate_vote.team t join climate_vote.session s on s.id=t.session_id
     where s.slug='0912-deliberation' order by t.name limit 1);" >/dev/null
if seed_partial_output="$(docker exec "$container" psql -U postgres -d verify \
  -v ON_ERROR_STOP=1 -f /tmp/0912-seed-cli-generated.sql 2>&1)"; then
  echo "CLI seed unexpectedly accepted a partial cross-organization roster" >&2
  exit 1
fi
grep -q "existing team tenancy mismatch: 0912-deliberation" <<<"$seed_partial_output"
seed_code_digest_after="$(docker exec "$container" psql -U postgres -d verify -Atq -v ON_ERROR_STOP=1 -c \
  "select md5(string_agg(t.join_code,',' order by t.name)) from climate_vote.team t
    join climate_vote.session s on s.id=t.session_id where s.slug='0912-deliberation';")"
test "$seed_code_digest_before" = "$seed_code_digest_after"
echo "seed_cli_sql=syntax-and-success-pass partial_tenancy=fail-closed capability_values_logged=0"

generated_at="$("$node_bin" -p 'new Date().toISOString()')"
elapsed_seconds=$((SECONDS - started_seconds))
target_manifest_after="$(compute_target_manifest)"
if [[ "$target_manifest_after" != "$target_manifest" ]]; then
  echo "verification refused: a manifest target changed during execution" >&2
  exit 1
fi
report="$(printf '{"schemaVersion":1,"reportId":"0912-p1a-p2a-postgres-verification","generatedAt":"%s","sourceCommit":"%s","sourceTreeClean":%s,"releaseMode":%s,"status":"pass","database":"disposable-postgres-16","checkFunctionBodies":true,"staticContractVerification":"passed","migrationOrderVerification":"passed","behaviorVerification":"passed","concurrentJoinRateLimitVerification":"passed","concurrentTeamDeviceLimitVerification":"passed","concurrentActiveRoundCreationVerification":"passed","concurrentSharedHqThrottleVerification":"passed","concurrentNamedPasswordRecoveryVerification":"passed","ballotCloseRaceVerification":"passed","rollbackWithoutActivity":"passed","rollbackWithActivity":"refused","canvasScopeRollbackGuardVerification":"passed","tokenOnlyActivationVerification":"passed","legacyPermissionNegativeVerification":"passed","legacyCrossSessionDeadlineNegativeVerification":"passed","predictableJoinCodeExclusionVerification":"passed","postP4LegacyNegativeVerification":"passed","p3ReadOnlyPostApplyVerification":"passed","p4ReadOnlyPostApplyVerification":"passed","p4LegacyHistoryPreservationVerification":"passed","p4BehaviorVerification":"passed","activationRollbackGuardVerification":"passed","activationRollbackExerciseVerification":"passed","activationReapplyVerification":"passed","seedCliSqlSyntaxAndSuccessVerification":"passed","seedCliPartialTenancyFailClosedVerification":"passed","seedCliCapabilityValuesLogged":0,"seedCliHostTemporaryFileMode":"%s","seedCliHostTemporaryFileRemovedBeforeExecution":true,"seedCliContainerCopyRemovedWithCreatedContainer":true,"targetManifestCount":%d,"targetManifestSha256":"%s","targetManifestVerifiedAtCompletion":true,"targetManifest":%s,"safety":{"productionDatabaseConnectionCount":0,"productionMutationCount":0},"elapsedSeconds":%d}' \
  "$generated_at" "$source_commit" "$source_tree_clean" "$release_mode" "$seed_sql_mode" \
  "$target_manifest_count" "$target_manifest_sha256" "$target_manifest" "$elapsed_seconds")"
echo "$report"
if [[ -n "${P1A_REPORT_PATH:-}" ]]; then
  mkdir -p "$(dirname "$P1A_REPORT_PATH")"
  printf '%s\n' "$report" >"$P1A_REPORT_PATH"
  echo "report_path=$P1A_REPORT_PATH"
fi
