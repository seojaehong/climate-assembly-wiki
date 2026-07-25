-- 조 테이블 번호 (현장 좌석 번호)
--
-- 배경: 현장 좌석은 1~15번 테이블로 배치되고 분과·조 번호와 일치하지 않는다.
-- 7/4에는 "15번 테이블 = 3분과 4조" 같은 대조를 단톡방에서 사람이 했고,
-- 행사 직전 청소년조를 앞으로 옮기며 2·3분과의 1조와 5조가 서로 뒤바뀌기도 했다.
-- 조 이름만으로는 현장에서 조를 찾지 못한다.
--
-- 테이블 번호는 당일에야 확정되므로 시드가 아니라 본부가 현장에서 입력한다.
-- 숫자가 아닐 수 있어(예: 'A-3') text로 둔다.

alter table climate_vote.team add column if not exists table_no text;

-- hq_teams()는 반환 타입이 바뀌므로 drop 후 재생성해야 한다.
drop function if exists climate_vote.hq_teams();

create or replace function climate_vote.hq_teams()
returns table(id uuid, name text, subgroup text, capacity int, status text, table_no text)
language sql security definer set search_path = climate_vote, pg_temp as $$
  select t.id, t.name, t.subgroup,
    coalesce(nullif(count(ta.id) filter (where ta.active and m.active), 0), t.capacity)::int,
    t.status, t.table_no
  from climate_vote.team t
  left join climate_vote.team_assignment ta on ta.team_id = t.id
  left join climate_vote.assembly_member m on m.id = ta.member_id
  group by t.id, t.name, t.subgroup, t.capacity, t.status, t.table_no;
$$;

revoke execute on function climate_vote.hq_teams() from public;
grant execute on function climate_vote.hq_teams() to anon;

-- 본부만 수정한다. 조 모더레이터가 자기 조 번호를 바꾸면 좌석표와 어긋나기 때문이다.
create or replace function climate_vote.attendance_hq_set_table_no(
  p_token text, p_team_id uuid, p_table_no text)
returns void
language plpgsql security definer
set search_path = climate_vote, extensions, pg_temp as $$
declare
  v_auth climate_vote.attendance_auth_session;
  v_team climate_vote.team;
  v_value text := nullif(btrim(coalesce(p_table_no, '')), '');
begin
  v_auth := climate_vote.attendance_token_row(p_token);
  if v_auth.scope <> 'hq' then
    raise exception 'hq authorization required';
  end if;
  if v_value is not null and length(v_value) > 20 then
    raise exception 'table number too long';
  end if;

  select * into v_team from climate_vote.team where id = p_team_id;
  if not found then raise exception 'team not found'; end if;

  update climate_vote.team set table_no = v_value where id = p_team_id;

  insert into climate_vote.attendance_audit_log
    (session_id, team_id, assignment_id, action, before_value, after_value, actor_scope, actor_label)
  values (v_team.session_id, v_team.id, null, 'team.table_no',
    jsonb_build_object('table_no', v_team.table_no),
    jsonb_build_object('table_no', v_value),
    v_auth.scope, v_auth.actor_label);
end
$$;

revoke execute on function climate_vote.attendance_hq_set_table_no(text,uuid,text) from public;
grant execute on function climate_vote.attendance_hq_set_table_no(text,uuid,text) to anon;

-- 검증
-- 1) 컬럼 존재: select table_no from climate_vote.team limit 1;
-- 2) hq_teams가 6개 열을 반환: select * from climate_vote.hq_teams() limit 1;
-- 3) 권한: anon은 hq_teams 실행 가능, attendance_hq_set_table_no는 hq 토큰 없이는 예외
