-- 2026-11-18 부천 「일하는 시민 100인 공론장」 — 조별 질문·우선순위·만족도 설문
-- 기후시민회의(climate_vote)와 무관한 독립 객체. public 스키마 + bucheon_ 접두사.
-- 테이블은 RLS 만 켜고 정책을 두지 않는다 → 접근은 아래 SECURITY DEFINER RPC 로만.
-- 조 코드·hq_key 는 이 파일에 적지 않는다(운영 DB 에서 난수로 생성).

create table if not exists public.bucheon_config (
  id          int primary key default 1 check (id = 1),
  hq_key      text not null,
  survey_open boolean not null default true
);

create table if not exists public.bucheon_team (
  code    text primary key,
  team_no int  not null unique check (team_no between 1 and 30)
);

create table if not exists public.bucheon_policy (
  id     int primary key,
  ord    int not null,
  title  text not null check (char_length(title) between 1 and 200),
  active boolean not null default true
);

create table if not exists public.bucheon_question (
  team_no    int primary key references public.bucheon_team(team_no) on delete cascade,
  q1         text not null,
  q2         text not null,
  note       text,
  updated_at timestamptz not null default now()
);

create table if not exists public.bucheon_priority (
  team_no     int primary key references public.bucheon_team(team_no) on delete cascade,
  terms       jsonb  not null,          -- {"<policy_id>": "S"|"M"|"LI"|"LR"}
  ranking     int[]  not null,          -- policy id, 1순위부터
  reason_top  text   not null,
  reason_long text,
  split       text,
  updated_at  timestamptz not null default now()
);

create table if not exists public.bucheon_survey (
  id         bigserial primary key,
  answers    jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.bucheon_config   enable row level security;
alter table public.bucheon_team     enable row level security;
alter table public.bucheon_policy   enable row level security;
alter table public.bucheon_question enable row level security;
alter table public.bucheon_priority enable row level security;
alter table public.bucheon_survey   enable row level security;

revoke all on public.bucheon_config, public.bucheon_team, public.bucheon_policy,
              public.bucheon_question, public.bucheon_priority, public.bucheon_survey
  from anon, authenticated;
revoke all on sequence public.bucheon_survey_id_seq from anon, authenticated;

-- 정책과제 자리표시자 15개 (확정되면 title 만 바꾸거나 active=false 로 줄인다)
insert into public.bucheon_policy (id, ord, title)
select g, g, '정책과제 ' || lpad(g::text, 2, '0') from generate_series(1, 15) g
on conflict (id) do nothing;

-- ───────────────────────── 내부 도우미 ─────────────────────────
create or replace function public.bucheon__team_no(p_code text)
returns int language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v int;
begin
  select team_no into v from bucheon_team where code = upper(trim(coalesce(p_code, '')));
  if v is null then raise exception 'invalid team code' using errcode = 'P0001'; end if;
  return v;
end $$;

create or replace function public.bucheon__clean(p text, p_max int, p_required boolean, p_label text)
returns text language plpgsql immutable set search_path = public, pg_temp as $$
declare v text := nullif(trim(coalesce(p, '')), '');
begin
  if p_required and v is null then raise exception '% is required', p_label using errcode = 'P0001'; end if;
  if v is not null and char_length(v) > p_max then
    raise exception '% is too long (max %)', p_label, p_max using errcode = 'P0001';
  end if;
  return v;
end $$;

create or replace function public.bucheon__policies()
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'ord', ord, 'title', title) order by ord, id), '[]'::jsonb)
  from bucheon_policy where active
$$;

-- ───────────────────────── 조(퍼실리테이터) ─────────────────────────
create or replace function public.bucheon_join(p_code text)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_team int := bucheon__team_no(p_code);
begin
  return jsonb_build_object(
    'team_no',  v_team,
    'policies', bucheon__policies(),
    'question', (select to_jsonb(q) - 'team_no' from bucheon_question q where q.team_no = v_team),
    'priority', (select to_jsonb(p) - 'team_no' from bucheon_priority p where p.team_no = v_team)
  );
end $$;

create or replace function public.bucheon_submit_questions(p_code text, p_q1 text, p_q2 text, p_note text default null)
returns jsonb language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_team int := bucheon__team_no(p_code);
  v_q1 text := bucheon__clean(p_q1, 500, true, 'q1');
  v_q2 text := bucheon__clean(p_q2, 500, true, 'q2');
  v_note text := bucheon__clean(p_note, 1000, false, 'note');
  v_at timestamptz;
begin
  insert into bucheon_question (team_no, q1, q2, note, updated_at)
  values (v_team, v_q1, v_q2, v_note, now())
  on conflict (team_no) do update set q1 = excluded.q1, q2 = excluded.q2, note = excluded.note, updated_at = now()
  returning updated_at into v_at;
  return jsonb_build_object('ok', true, 'team_no', v_team, 'updated_at', v_at);
end $$;

create or replace function public.bucheon_submit_priority(
  p_code text, p_terms jsonb, p_ranking int[],
  p_reason_top text, p_reason_long text default null, p_split text default null)
returns jsonb language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_team int := bucheon__team_no(p_code);
  v_ids int[];
  v_n int;
  v_top text := bucheon__clean(p_reason_top, 2000, true, 'reason_top');
  v_long text := bucheon__clean(p_reason_long, 2000, false, 'reason_long');
  v_split text := bucheon__clean(p_split, 2000, false, 'split');
  v_at timestamptz;
begin
  select array_agg(id order by id) into v_ids from bucheon_policy where active;
  v_n := coalesce(array_length(v_ids, 1), 0);

  if p_terms is null or jsonb_typeof(p_terms) <> 'object' then
    raise exception 'terms must be an object' using errcode = 'P0001';
  end if;
  if (select count(*) from jsonb_object_keys(p_terms)) <> v_n
     or exists (select 1 from jsonb_each_text(p_terms) e
                where e.value not in ('S', 'M', 'LI', 'LR')
                   or e.key !~ '^[0-9]+$'
                   or not (e.key::int = any (v_ids))) then
    raise exception 'terms must cover every policy exactly once' using errcode = 'P0001';
  end if;

  if coalesce(array_length(p_ranking, 1), 0) <> v_n
     or (select count(distinct r) from unnest(p_ranking) r) <> v_n
     or exists (select 1 from unnest(p_ranking) r where r is null or not (r = any (v_ids))) then
    raise exception 'ranking must list every policy exactly once' using errcode = 'P0001';
  end if;

  insert into bucheon_priority (team_no, terms, ranking, reason_top, reason_long, split, updated_at)
  values (v_team, p_terms, p_ranking, v_top, v_long, v_split, now())
  on conflict (team_no) do update set terms = excluded.terms, ranking = excluded.ranking,
    reason_top = excluded.reason_top, reason_long = excluded.reason_long, split = excluded.split, updated_at = now()
  returning updated_at into v_at;
  return jsonb_build_object('ok', true, 'team_no', v_team, 'updated_at', v_at);
end $$;

-- ───────────────────────── 시민 만족도 설문 ─────────────────────────
create or replace function public.bucheon_submit_survey(p_answers jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public, pg_temp as $$
begin
  if not (select survey_open from bucheon_config where id = 1) then
    raise exception 'survey is closed' using errcode = 'P0001';
  end if;
  if p_answers is null or jsonb_typeof(p_answers) <> 'object'
     or (select count(*) from jsonb_object_keys(p_answers)) = 0
     or (select count(*) from jsonb_object_keys(p_answers)) > 30
     or char_length(p_answers::text) > 6000 then
    raise exception 'invalid answers' using errcode = 'P0001';
  end if;
  insert into bucheon_survey (answers) values (p_answers);
  return jsonb_build_object('ok', true);
end $$;

-- ───────────────────────── 본부(대형 화면) ─────────────────────────
create or replace function public.bucheon_hq(p_key text)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if p_key is null or not exists (select 1 from bucheon_config where id = 1 and hq_key = p_key) then
    raise exception 'invalid hq key' using errcode = 'P0001';
  end if;
  return jsonb_build_object(
    'now',       now(),
    'teams',     (select coalesce(jsonb_agg(team_no order by team_no), '[]'::jsonb) from bucheon_team),
    'policies',  bucheon__policies(),
    'questions', (select coalesce(jsonb_agg(to_jsonb(q) order by q.team_no), '[]'::jsonb) from bucheon_question q),
    'priorities',(select coalesce(jsonb_agg(to_jsonb(p) order by p.team_no), '[]'::jsonb) from bucheon_priority p),
    'surveys',   (select coalesce(jsonb_agg(s.answers order by s.id), '[]'::jsonb) from bucheon_survey s),
    'survey_open', (select survey_open from bucheon_config where id = 1)
  );
end $$;

-- ───────────────────────── 권한 ─────────────────────────
-- PUBLIC 기본 EXECUTE 를 먼저 회수하고, 화면이 쓰는 것만 anon·authenticated 둘 다에 준다.
revoke execute on function public.bucheon__team_no(text) from public, anon, authenticated;
revoke execute on function public.bucheon__clean(text, int, boolean, text) from public, anon, authenticated;
revoke execute on function public.bucheon__policies() from public, anon, authenticated;

revoke execute on function public.bucheon_join(text) from public;
revoke execute on function public.bucheon_submit_questions(text, text, text, text) from public;
revoke execute on function public.bucheon_submit_priority(text, jsonb, int[], text, text, text) from public;
revoke execute on function public.bucheon_submit_survey(jsonb) from public;
revoke execute on function public.bucheon_hq(text) from public;

grant execute on function public.bucheon_join(text) to anon, authenticated;
grant execute on function public.bucheon_submit_questions(text, text, text, text) to anon, authenticated;
grant execute on function public.bucheon_submit_priority(text, jsonb, int[], text, text, text) to anon, authenticated;
grant execute on function public.bucheon_submit_survey(jsonb) to anon, authenticated;
grant execute on function public.bucheon_hq(text) to anon, authenticated;
