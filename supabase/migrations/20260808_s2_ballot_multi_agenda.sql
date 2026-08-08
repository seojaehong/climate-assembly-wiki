-- feat(system-schema S2): 다의제 1회 제출 투표 (ballot)
-- project: labor_money (pleyuknjnprsckssxvrh), schema: climate_vote
--
-- WHY: gongron 벤치마킹 B6·B7 채택 — 한 투표에 여러 의제(척도 2/4/5/7 혼용),
--      참여자는 전 문항 1회 제출. QR 재스캔 시간 절약(8/29 폐회 일괄투표).
--      단 조-번호 배정 ID는 불채택 — 무기명 디바이스 토큰(cv_device) 유지.
--      결과는 closed → published 수동 게이트 후에만 공개(B7).
--      spec: 10_작업산출물/2026-08-08_숙의운영시스템_스키마_spec.md
--
-- WHAT: ballot, ballot_item, ballot_response 신설 (기존 rounds/votes는 손대지 않음 —
--       단일 문항 라이브 투표는 기존 경로 그대로).
--       RPC 6종: ballot_create / ballot_set_status / ballot_list /
--                ballot_get(토큰, 참여자) / ballot_submit(참여자) / ballot_results
--
-- SAFETY: 순수 additive. 신설 테이블 RLS enable + 직접 접근 revoke, RPC 경유만.
--         PUBLIC EXECUTE 회수 후 anon+authenticated grant.
--
-- ROLLBACK: supabase/rollbacks/20260808_BEFORE_s2.sql
--
-- ★ 적용 후 검증(anon 키, Content-Profile: climate_vote):
--   POST /rest/v1/rpc/ballot_get {"p_token":"0000...00"} → 200 null = 적용됨
--   PGRST202 + climate_vote.ballot_get → 미적용

-- ── 1. 테이블 ────────────────────────────────────────────────────────

create table if not exists climate_vote.ballot (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references climate_vote.session(id),
  title text not null check (length(trim(title)) between 1 and 200),
  instructions text,
  status text not null default 'draft'
    check (status in ('draft','open','closed','published','archived')),
  token text not null unique default encode(extensions.gen_random_bytes(16), 'hex'),
  created_by text,
  published_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists climate_vote.ballot_item (
  id uuid primary key default gen_random_uuid(),
  ballot_id uuid not null references climate_vote.ballot(id) on delete cascade,
  ordinal int not null,
  statement text not null check (length(trim(statement)) between 1 and 300),
  description text,
  scale int not null check (scale in (2, 4, 5, 7)),
  required boolean not null default true,
  unique (ballot_id, ordinal)
);

create table if not exists climate_vote.ballot_response (
  id uuid primary key default gen_random_uuid(),
  ballot_id uuid not null references climate_vote.ballot(id),
  client_id text not null check (length(client_id) between 8 and 80),
  answers jsonb not null,
  submitted_at timestamptz not null default now(),
  unique (ballot_id, client_id)
);

create index if not exists ballot_session_idx on climate_vote.ballot(session_id);
create index if not exists ballot_response_ballot_idx on climate_vote.ballot_response(ballot_id);

alter table climate_vote.ballot enable row level security;
alter table climate_vote.ballot_item enable row level security;
alter table climate_vote.ballot_response enable row level security;

revoke all on climate_vote.ballot, climate_vote.ballot_item,
  climate_vote.ballot_response
from anon, authenticated;

-- ── 2. 운영 RPC (join_code capability — mod_create_round와 동일 규약) ─

-- 2-1. 생성. p_items: [{"ordinal":1,"statement":"...","description":null,"scale":5,"required":true}]
create or replace function climate_vote.ballot_create(
  p_code text, p_title text, p_instructions text, p_items jsonb)
returns jsonb language plpgsql security definer
set search_path = climate_vote, extensions, pg_temp as $$
declare v_team climate_vote.team; v_ballot climate_vote.ballot; v_n int;
begin
  select * into v_team from climate_vote.team where join_code = p_code and status = 'active';
  if not found then raise exception 'invalid join code'; end if;
  if jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) < 1 or jsonb_array_length(p_items) > 20 then
    raise exception 'items must be array of 1..20';
  end if;

  insert into climate_vote.ballot (session_id, title, instructions, created_by)
  values (v_team.session_id, trim(p_title), nullif(trim(coalesce(p_instructions,'')),''),
          'mod:' || v_team.name)
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
                            'status', v_ballot.status, 'items', v_n);
end $$;

-- 2-2. 상태 전이: draft→open→closed→published (→archived). 역행 금지.
create or replace function climate_vote.ballot_set_status(
  p_code text, p_ballot_id uuid, p_status text)
returns jsonb language plpgsql security definer
set search_path = climate_vote, pg_temp as $$
declare v_team climate_vote.team; v_ballot climate_vote.ballot;
  v_order jsonb := '{"draft":0,"open":1,"closed":2,"published":3,"archived":4}';
begin
  select * into v_team from climate_vote.team where join_code = p_code and status = 'active';
  if not found then raise exception 'invalid join code'; end if;
  select * into v_ballot from climate_vote.ballot
   where id = p_ballot_id and session_id = v_team.session_id;
  if not found then raise exception 'ballot not in session scope'; end if;
  if p_status not in ('open','closed','published','archived') then
    raise exception 'invalid status: %', p_status;
  end if;
  if (v_order->>p_status)::int <= (v_order->>v_ballot.status)::int then
    raise exception 'invalid transition % -> %', v_ballot.status, p_status;
  end if;

  update climate_vote.ballot
     set status = p_status,
         published_at = case when p_status = 'published' then now() else published_at end,
         archived_at  = case when p_status = 'archived'  then now() else archived_at end
   where id = p_ballot_id;
  return jsonb_build_object('id', p_ballot_id, 'status', p_status);
end $$;

-- 2-3. 세션의 투표 목록 + 제출 수 (운영 콘솔)
create or replace function climate_vote.ballot_list(p_code text)
returns table(id uuid, title text, status text, token text,
              item_count bigint, response_count bigint, created_at timestamptz)
language sql security definer
set search_path = climate_vote, pg_temp as $$
  select b.id, b.title, b.status, b.token,
         (select count(*) from climate_vote.ballot_item bi where bi.ballot_id = b.id),
         (select count(*) from climate_vote.ballot_response br where br.ballot_id = b.id),
         b.created_at
  from climate_vote.ballot b
  join climate_vote.team t on t.session_id = b.session_id
  where t.join_code = p_code and t.status = 'active' and b.status <> 'archived'
  order by b.created_at desc;
$$;

-- ── 3. 참여자 RPC (토큰 진입 — /b/<token>) ──────────────────────────

-- 3-1. 투표 정의 조회. draft·archived는 없는 것처럼(null). 결과는 포함하지 않는다.
create or replace function climate_vote.ballot_get(p_token text)
returns jsonb language plpgsql security definer
set search_path = climate_vote, pg_temp as $$
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
    'items', v_items);
end $$;

-- 3-2. 제출: open에서만, 전 필수 문항 응답, 1디바이스 1회.
--      p_answers: {"<item_id>": 3, ...} (값 = 1..scale)
create or replace function climate_vote.ballot_submit(
  p_token text, p_client_id text, p_answers jsonb)
returns jsonb language plpgsql security definer
set search_path = climate_vote, pg_temp as $$
declare v_ballot climate_vote.ballot; v_item record; v_val int;
begin
  select * into v_ballot from climate_vote.ballot where token = p_token;
  if not found then raise exception 'ballot not found'; end if;
  if v_ballot.status <> 'open' then raise exception 'ballot not open'; end if;
  if jsonb_typeof(p_answers) <> 'object' then raise exception 'answers must be object'; end if;

  for v_item in
    select id, scale, required from climate_vote.ballot_item where ballot_id = v_ballot.id
  loop
    v_val := (p_answers->>(v_item.id::text))::int;
    if v_val is null then
      if v_item.required then raise exception 'missing answer for item %', v_item.id; end if;
    elsif v_val < 1 or v_val > v_item.scale then
      raise exception 'answer out of scale for item %', v_item.id;
    end if;
  end loop;

  insert into climate_vote.ballot_response (ballot_id, client_id, answers)
  values (v_ballot.id, p_client_id, p_answers);
  return jsonb_build_object('ok', true);
exception when unique_violation then
  raise exception 'already submitted';
end $$;

-- ── 4. 결과 RPC ─────────────────────────────────────────────────────
-- 운영진(잠정, join_code) 또는 공개(published + 토큰) 두 경로.
-- p_code가 유효하면 상태 무관 잠정 집계, 아니면 published일 때만 반환(B7 게이트).
create or replace function climate_vote.ballot_results(p_token text, p_code text default null)
returns jsonb language plpgsql security definer
set search_path = climate_vote, pg_temp as $$
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
end $$;

-- ── 5. 권한 ─────────────────────────────────────────────────────────

revoke execute on function
  climate_vote.ballot_create(text, text, text, jsonb),
  climate_vote.ballot_set_status(text, uuid, text),
  climate_vote.ballot_list(text),
  climate_vote.ballot_get(text),
  climate_vote.ballot_submit(text, text, jsonb),
  climate_vote.ballot_results(text, text)
from public;

grant execute on function
  climate_vote.ballot_create(text, text, text, jsonb),
  climate_vote.ballot_set_status(text, uuid, text),
  climate_vote.ballot_list(text),
  climate_vote.ballot_get(text),
  climate_vote.ballot_submit(text, text, jsonb),
  climate_vote.ballot_results(text, text)
to anon, authenticated;
