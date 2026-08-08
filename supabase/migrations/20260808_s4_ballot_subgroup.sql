-- feat(system-schema S4): 분과별 투표 스코프 — 세 장소 동시 분과 투표(의제·권고안)
-- project: labor_money (pleyuknjnprsckssxvrh), schema: climate_vote
--
-- WHY: 조는 분과(team.subgroup: 1분과·2분과·3분과)에 매핑돼 있고, 최종 단계에서
--      분과별로 별도 장소에서 의제/권고안 투표를 동시에 진행한다.
--      ballot을 분과 단위로 스코프해 분과 QR = 그 분과 투표만 열리게 한다.
--
-- WHAT: ballot.subgroup 컬럼(null=세션 전체 대상).
--       ballot_create 재정의(p_subgroup 추가, 기본 null — 기존 4인자 호출과 호환).
--       ballot_list 재정의(subgroup 반환 컬럼 추가 — OUT 변경이라 drop 후 재생성).
--       ballot_get / ballot_results payload에 subgroup 키 추가.
--
-- SAFETY: additive(컬럼 nullable). 함수 drop→재생성 구간이 있으므로 **파일 통째로
--         한 번에 실행**할 것. 기존 ballot 행은 subgroup null(전체)로 해석 — 동작 불변.
--         drop으로 소실되는 grant를 끝에서 재부여.
--
-- ROLLBACK: supabase/rollbacks/20260808_BEFORE_s4.sql

alter table climate_vote.ballot add column if not exists subgroup text;

-- ── ballot_create: p_subgroup 추가 (null=전체, 값이면 세션 내 실존 분과여야 함) ──

drop function if exists climate_vote.ballot_create(text, text, text, jsonb);

create or replace function climate_vote.ballot_create(
  p_code text, p_title text, p_instructions text, p_items jsonb,
  p_subgroup text default null)
returns jsonb language plpgsql security definer
set search_path = climate_vote, extensions, pg_temp as $fn$
declare v_team climate_vote.team; v_ballot climate_vote.ballot; v_n int;
begin
  select * into v_team from climate_vote.team where join_code = p_code and status = 'active';
  if not found then raise exception 'invalid join code'; end if;
  if jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) < 1 or jsonb_array_length(p_items) > 20 then
    raise exception 'items must be array of 1..20';
  end if;
  if p_subgroup is not null then
    perform 1 from climate_vote.team
     where session_id = v_team.session_id and subgroup = p_subgroup and status = 'active';
    if not found then raise exception 'unknown subgroup: %', p_subgroup; end if;
  end if;

  insert into climate_vote.ballot (session_id, title, instructions, created_by, subgroup)
  values (v_team.session_id, trim(p_title), nullif(trim(coalesce(p_instructions,'')),''),
          'mod:' || v_team.name, p_subgroup)
  returning * into v_ballot;

  insert into climate_vote.ballot_item (ballot_id, ordinal, statement, description, scale, required)
  select v_ballot.id,
         coalesce((e->>'ordinal')::int, rn),
         trim(e->>'statement'),
         nullif(trim(coalesce(e->>'description','')),''),
         coalesce((e->>'scale')::int, 5),
         coalesce((e->>'required')::boolean, true)
  from jsonb_array_elements(p_items) with ordinality as x(e, rn)
  where length(trim(coalesce(e->>'statement',''))) > 0;

  get diagnostics v_n = row_count;
  if v_n = 0 then raise exception 'no valid items'; end if;
  return jsonb_build_object('id', v_ballot.id, 'token', v_ballot.token,
                            'status', v_ballot.status, 'subgroup', v_ballot.subgroup,
                            'items', v_n);
end $fn$;

-- ── ballot_list: subgroup 컬럼 추가 (OUT 변경 → drop 후 재생성) ──────────────

drop function if exists climate_vote.ballot_list(text);

create or replace function climate_vote.ballot_list(p_code text)
returns table(id uuid, title text, status text, token text, subgroup text,
              item_count bigint, response_count bigint, created_at timestamptz)
language sql security definer
set search_path = climate_vote, pg_temp as $fn$
  select b.id, b.title, b.status, b.token, b.subgroup,
         (select count(*) from climate_vote.ballot_item bi where bi.ballot_id = b.id),
         (select count(*) from climate_vote.ballot_response br where br.ballot_id = b.id),
         b.created_at
  from climate_vote.ballot b
  join climate_vote.team t on t.session_id = b.session_id
  where t.join_code = p_code and t.status = 'active' and b.status <> 'archived'
  order by b.created_at desc;
$fn$;

-- ── ballot_get: payload에 subgroup 추가 (jsonb 반환이라 replace만으로 충분) ──

create or replace function climate_vote.ballot_get(p_token text)
returns jsonb language plpgsql security definer
set search_path = climate_vote, pg_temp as $fn$
declare v_ballot climate_vote.ballot; v_items jsonb;
begin
  select * into v_ballot from climate_vote.ballot
   where token = p_token and status in ('open','closed','published');
  if not found then return null; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', bi.id, 'ordinal', bi.ordinal, 'statement', bi.statement,
           'description', bi.description, 'scale', bi.scale, 'required', bi.required)
           order by bi.ordinal), '[]'::jsonb)
    into v_items
  from climate_vote.ballot_item bi where bi.ballot_id = v_ballot.id;
  return jsonb_build_object(
    'id', v_ballot.id, 'title', v_ballot.title,
    'instructions', v_ballot.instructions, 'status', v_ballot.status,
    'subgroup', v_ballot.subgroup,
    'items', v_items);
end $fn$;

-- ── ballot_results: payload에 subgroup 추가 ─────────────────────────────────

create or replace function climate_vote.ballot_results(p_token text, p_code text default null)
returns jsonb language plpgsql security definer
set search_path = climate_vote, pg_temp as $fn$
declare v_ballot climate_vote.ballot; v_is_mod boolean := false; v_out jsonb;
begin
  select * into v_ballot from climate_vote.ballot where token = p_token;
  if not found then return null; end if;
  if p_code is not null then
    select true into v_is_mod from climate_vote.team
     where join_code = p_code and status = 'active' and session_id = v_ballot.session_id;
    v_is_mod := coalesce(v_is_mod, false);
  end if;
  if not v_is_mod and v_ballot.status <> 'published' then return null; end if;

  select jsonb_build_object(
    'id', v_ballot.id, 'title', v_ballot.title, 'status', v_ballot.status,
    'subgroup', v_ballot.subgroup,
    'responses', (select count(*) from climate_vote.ballot_response br
                   where br.ballot_id = v_ballot.id),
    'items', coalesce(jsonb_agg(item_agg order by item_ord), '[]'::jsonb))
  into v_out
  from (
    select bi.ordinal as item_ord,
      jsonb_build_object(
        'id', bi.id, 'ordinal', bi.ordinal, 'statement', bi.statement, 'scale', bi.scale,
        'n', count(v.val),
        'avg', round(avg(v.val)::numeric, 2),
        'dist', (
          select coalesce(jsonb_object_agg(d.k, d.c), '{}'::jsonb) from (
            select (br2.answers->>(bi.id::text))::int as k, count(*) as c
            from climate_vote.ballot_response br2
            where br2.ballot_id = bi.ballot_id
              and (br2.answers->>(bi.id::text)) is not null
            group by 1) d)
      ) as item_agg
    from climate_vote.ballot_item bi
    left join lateral (
      select (br.answers->>(bi.id::text))::int as val
      from climate_vote.ballot_response br
      where br.ballot_id = bi.ballot_id
        and (br.answers->>(bi.id::text)) is not null
    ) v on true
    where bi.ballot_id = v_ballot.id
    group by bi.id, bi.ordinal, bi.statement, bi.scale, bi.ballot_id
  ) agg;
  return v_out;
end $fn$;

-- ── 권한 재부여 (drop으로 소실된 것 포함 전체 재설정) ───────────────────────

revoke execute on function
  climate_vote.ballot_create(text, text, text, jsonb, text),
  climate_vote.ballot_list(text),
  climate_vote.ballot_get(text),
  climate_vote.ballot_results(text, text)
from public;

grant execute on function
  climate_vote.ballot_create(text, text, text, jsonb, text),
  climate_vote.ballot_list(text),
  climate_vote.ballot_get(text),
  climate_vote.ballot_results(text, text)
to anon, authenticated;
