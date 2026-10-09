-- s26 division prep state — 계약 시험
--
-- 전제: 버림용 Postgres 에 automation/tests/fixtures/0912-p1a-driver.sql 까지 적용한 뒤
--       20261005_s24·s25 와 20261010_s26_division_prep_state.sql 을 적용한 상태.
--       (0912 시드의 세션 91200000-...-0003, 조 A ...-0011 · 조 B ...-0012 를 쓴다)
-- 실행: psql -v ON_ERROR_STOP=1 -f supabase/tests/s26_division_prep_state.test.sql
-- 끝에서 rollback 하므로 시드 상태를 바꾸지 않는다. 운영 DB 에서 돌리지 않는다.

\set ON_ERROR_STOP on
begin;

do $verify$
declare
  v_session uuid := '91200000-0000-0000-0000-000000000003';
  v_team_a uuid := '91200000-0000-0000-0000-000000000011'; -- 1분과 조
  v_team_b uuid := '91200000-0000-0000-0000-000000000012'; -- 운영팀(분과 칸 빈 조)
  v_div_token text;
  v_ops_token text;
  v_res jsonb;
  v_n int;
  v_audit_before int;
  v_state jsonb := '{"step":"ready","items":[1,2,3]}';
  v_big jsonb;
begin
  -- 시드 세션의 접근 만료(2026-09-13)가 지났으므로 이 트랜잭션 안에서만 늘린다
  update climate_vote.session set access_expires_at=now()+interval '1 day' where id=v_session;
  update climate_vote.team set subgroup='1분과' where id=v_team_a;
  update climate_vote.team set subgroup=null where id=v_team_b;
  v_div_token := climate_vote.attendance_issue_token('team', v_team_a, 's26 verifier 1분과');
  v_ops_token := climate_vote.attendance_issue_token('team', v_team_b, 's26 verifier ops');
  update climate_vote.attendance_auth_session set purpose='workshop'
   where token_hash in (
     encode(extensions.digest(v_div_token,'sha256'),'hex'),
     encode(extensions.digest(v_ops_token,'sha256'),'hex'));

  -- 0. 잘못된 토큰은 team_token_row 가 거부한다
  begin
    perform climate_vote.division_prep_get_v1('not-a-token');
    raise exception 'bad token unexpectedly succeeded';
  exception when others then
    if sqlerrm='bad token unexpectedly succeeded' then raise; end if;
  end;

  -- 1. 분과 조는 자기 분과 한 줄만 읽는다
  v_res := climate_vote.division_prep_get_v1(v_div_token);
  if v_res->>'scope' <> 'division' or v_res->>'team_subgroup' <> '1분과'
     or jsonb_array_length(v_res->'rows') <> 1
     or v_res->'rows'->0->>'subgroup' <> '1분과'
     or (v_res->'rows'->0->>'version')::int <> 0
     or jsonb_typeof(v_res->'rows'->0->'state') <> 'null'
     or v_res->>'server_now' is null then
    raise exception 'division get shape wrong: %', v_res;
  end if;

  -- 2. 운영팀은 세 줄을 1·2·3분과 순서로 읽는다
  v_res := climate_vote.division_prep_get_v1(v_ops_token);
  if v_res->>'scope' <> 'ops' or jsonb_typeof(v_res->'team_subgroup') <> 'null'
     or jsonb_array_length(v_res->'rows') <> 3
     or v_res->'rows'->0->>'subgroup' <> '1분과'
     or v_res->'rows'->1->>'subgroup' <> '2분과'
     or v_res->'rows'->2->>'subgroup' <> '3분과' then
    raise exception 'ops get shape wrong: %', v_res;
  end if;

  -- 3. 분과 조는 다른 분과에 쓰지 못한다 / 없는 분과는 거부
  begin
    perform climate_vote.division_prep_save_v1(v_div_token, '2분과', 0, v_state, 'x');
    raise exception 'cross-division save unexpectedly succeeded';
  exception when others then
    if sqlerrm <> 'division mismatch' then raise; end if;
  end;
  begin
    perform climate_vote.division_prep_save_v1(v_ops_token, '4분과', 0, v_state, 'x');
    raise exception 'unknown division save unexpectedly succeeded';
  exception when others then
    if sqlerrm <> 'invalid division' then raise; end if;
  end;
  begin
    perform climate_vote.division_prep_save_v1(v_ops_token, '1분과', 0, '[1,2]'::jsonb, 'x');
    raise exception 'non-object state unexpectedly succeeded';
  exception when others then
    if sqlerrm <> 'division prep state must be a json object' then raise; end if;
  end;

  -- 4. 첫 저장은 version 1, 이력 1줄, 감사 1줄
  select count(*) into v_audit_before from climate_vote.workshop_audit_event
   where action='division_prep_save';
  v_res := climate_vote.division_prep_save_v1(v_div_token, '1분과', 0, v_state,
    '  1분과 오퍼레이터 ' || repeat('가', 100) || '  ');
  if (v_res->>'ok')::boolean is not true or (v_res->>'version')::int <> 1
     or v_res->>'updated_at' is null then
    raise exception 'first save wrong: %', v_res;
  end if;
  select count(*) into v_n from climate_vote.division_prep_revision
   where session_id=v_session and subgroup='1분과';
  if v_n <> 1 then raise exception 'revision count after first save = %', v_n; end if;
  if (select length(updated_by) from climate_vote.division_prep_state
       where session_id=v_session and subgroup='1분과') <> 80 then
    raise exception 'label was not trimmed/truncated to 80';
  end if;
  if (select count(*) from climate_vote.workshop_audit_event
       where action='division_prep_save') <> v_audit_before+1 then
    raise exception 'audit row missing';
  end if;
  if exists(select 1 from climate_vote.workshop_audit_event
             where action='division_prep_save' and (after_value ? 'state' or before_value ? 'state')) then
    raise exception 'audit must not carry the whole state';
  end if;

  -- 5. 판번호가 어긋나면 conflict JSON, 아무것도 쓰지 않는다
  v_res := climate_vote.division_prep_save_v1(v_ops_token, '1분과', 0,
    '{"step":"stale"}'::jsonb, 'ops');
  if (v_res->>'ok')::boolean is not false or (v_res->>'conflict')::boolean is not true
     or (v_res->'current'->>'version')::int <> 1
     or v_res->'current'->'state' <> v_state
     or v_res->'current'->>'subgroup' <> '1분과' then
    raise exception 'conflict shape wrong: %', v_res;
  end if;
  select count(*) into v_n from climate_vote.division_prep_revision
   where session_id=v_session and subgroup='1분과';
  if v_n <> 1 then raise exception 'conflict wrote a revision'; end if;
  if (select version from climate_vote.division_prep_state
       where session_id=v_session and subgroup='1분과') <> 1 then
    raise exception 'conflict changed the state row';
  end if;

  -- 6. 운영팀이 맞는 판번호로 쓰면 version 2, 이력 2줄. 분과 조가 그 값을 읽는다
  v_res := climate_vote.division_prep_save_v1(v_ops_token, '1분과', 1,
    '{"step":"locked"}'::jsonb, '운영팀');
  if (v_res->>'version')::int <> 2 then raise exception 'second save wrong: %', v_res; end if;
  select count(*) into v_n from climate_vote.division_prep_revision
   where session_id=v_session and subgroup='1분과';
  if v_n <> 2 then raise exception 'revision count after second save = %', v_n; end if;
  v_res := climate_vote.division_prep_get_v1(v_div_token);
  if (v_res->'rows'->0->>'version')::int <> 2
     or v_res->'rows'->0->'state'->>'step' <> 'locked'
     or v_res->'rows'->0->>'updated_by' <> '운영팀' then
    raise exception 'division did not see ops save: %', v_res;
  end if;
  -- 운영팀은 다른 분과에도 쓴다
  v_res := climate_vote.division_prep_save_v1(v_ops_token, '3분과', 0, v_state, '');
  if (v_res->>'version')::int <> 1 then raise exception 'ops 3분과 save wrong: %', v_res; end if;
  if (select updated_by from climate_vote.division_prep_state
       where session_id=v_session and subgroup='3분과') is not null then
    raise exception 'blank label should store null';
  end if;

  -- 7. 512KiB 초과 거부
  v_big := jsonb_build_object('blob', repeat('x', 524288));
  begin
    perform climate_vote.division_prep_save_v1(v_ops_token, '2분과', 0, v_big, 'big');
    raise exception 'oversize state unexpectedly succeeded';
  exception when others then
    if sqlerrm <> 'division prep state too large' then raise; end if;
  end;
  if exists(select 1 from climate_vote.division_prep_state
             where session_id=v_session and subgroup='2분과') then
    raise exception 'oversize state was written';
  end if;

  -- 8. 이력은 수정·삭제·비우기가 안 된다
  begin
    update climate_vote.division_prep_revision set created_by='tamper' where session_id=v_session;
    raise exception 'revision update unexpectedly succeeded';
  exception when others then
    if sqlerrm <> 'division prep history is append-only' then raise; end if;
  end;
  begin
    delete from climate_vote.division_prep_revision where session_id=v_session;
    raise exception 'revision delete unexpectedly succeeded';
  exception when others then
    if sqlerrm <> 'division prep history is append-only' then raise; end if;
  end;
  begin
    truncate climate_vote.division_prep_revision;
    raise exception 'revision truncate unexpectedly succeeded';
  exception when others then
    if sqlerrm <> 'division prep history is append-only' then raise; end if;
  end;

  -- 9. 분과 값이 세 분과 밖인 조는 읽기·쓰기 모두 거부
  update climate_vote.team set subgroup='4분과' where id=v_team_b;
  begin
    perform climate_vote.division_prep_get_v1(v_ops_token);
    raise exception 'unknown team subgroup get unexpectedly succeeded';
  exception when others then
    if sqlerrm <> 'division prep scope unknown for team subgroup' then raise; end if;
  end;
  update climate_vote.team set subgroup=null where id=v_team_b;

  -- 10. 권한: 표는 anon·authenticated 에 닫혀 있고 함수 두 개만 열려 있다
  if has_table_privilege('anon','climate_vote.division_prep_state','select')
     or has_table_privilege('authenticated','climate_vote.division_prep_revision','select')
     or has_function_privilege('anon','climate_vote.division_prep_row_json(uuid,text)','execute')
     or not has_function_privilege('anon','climate_vote.division_prep_get_v1(text)','execute')
     or not has_function_privilege('authenticated',
          'climate_vote.division_prep_save_v1(text,text,int,jsonb,text)','execute') then
    raise exception 's26 grants wrong';
  end if;

  raise notice 's26 division prep state: all checks passed';
end
$verify$;

rollback;
