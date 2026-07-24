-- feat(mod-console): climate_vote 팀 스코프 + RPC + 스냅샷 확장
-- project: labor_money (pleyuknjnprsckssxvrh), schema: climate_vote
--
-- WHY: 모더레이터 콘솔(팀 단위 투표 진행·타이머·챗봇 선반영)을 위해
--      team 테이블과 team 스코프 RPC(mod_join/mod_create_round/mod_set_round_status/
--      mod_proxy_vote)가 필요. rounds.team_id NULL = 전체 투표(기존 동작 그대로 유지).
--
-- WHAT: team, timer_log, module_state, chat_message 신규 테이블(모두 RLS enable,
--       team은 anon 직접 SELECT 금지 — join_code 열거 방지, mod_join RPC 경유만 허용).
--       rounds.team_id / rounds.created_by 컬럼 추가(NULL 허용, 기존 행 영향 없음).
--       RPC 5종(mod_join/mod_create_round/mod_set_round_status/mod_proxy_vote/hq_teams)
--       SECURITY DEFINER, anon에 EXECUTE 부여. join_code 조건으로 팀 스코프 강제.
--       cv_snapshot_now payload에 team/timer_log 키 ADDITIVE 추가(기존 키 보존).
--       supabase_realtime publication에 rounds/votes 추가 시도(이미 있으면 no-op).
--
-- SAFETY: 순수 additive. 기존 테이블 컬럼/데이터/정책 삭제 없음. votes/rounds 기존
--         anon INSERT/SELECT 정책(votes_anon_insert, votes_anon_select,
--         rounds_anon_select — 모두 조건 없이 true)은 그대로 유지됨.
--
-- ROLLBACK: supabase/rollbacks/20260724_BEFORE_mod_console.sql 실행.

create table if not exists climate_vote.team (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references climate_vote.session(id),
  name text not null,
  subgroup text,
  join_code text not null unique check (join_code ~ '^[0-9]{6}$'),
  capacity int not null default 20,
  status text not null default 'active' check (status in ('active','disabled')),
  created_at timestamptz not null default now()
);
alter table climate_vote.rounds add column if not exists team_id uuid references climate_vote.team(id);
alter table climate_vote.rounds add column if not exists created_by text;
create index if not exists rounds_team_idx on climate_vote.rounds(team_id);

create table if not exists climate_vote.timer_log (
  id bigint generated always as identity primary key,
  team_id uuid not null references climate_vote.team(id),
  kind text not null check (kind in ('speech','session')),
  duration_s int not null,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  meta jsonb not null default '{}'
);
create table if not exists climate_vote.module_state (
  team_id uuid not null references climate_vote.team(id),
  module_key text not null,
  state jsonb not null default '{}',
  updated_at timestamptz not null default now(),
  primary key (team_id, module_key)
);
create table if not exists climate_vote.chat_message (
  id uuid primary key default gen_random_uuid(),
  team_id uuid references climate_vote.team(id),
  session_id uuid references climate_vote.session(id),
  role text not null check (role in ('user','assistant')),
  content text not null,
  meta jsonb not null default '{}',
  created_at timestamptz not null default now()
);

alter table climate_vote.team enable row level security;
alter table climate_vote.timer_log enable row level security;
alter table climate_vote.module_state enable row level security;
alter table climate_vote.chat_message enable row level security;
-- team: anon 직접 SELECT 금지(코드 열거 방지). 접근은 mod_join RPC로만.
-- rounds/votes 기존 정책은 유지. /hq·/v의 team 조회는 아래 hq_teams 뷰 함수로.

create or replace function climate_vote.mod_join(p_code text)
returns setof climate_vote.team language sql security definer
set search_path = climate_vote, pg_temp as $$
  select * from climate_vote.team where join_code = p_code and status = 'active';
$$;

create or replace function climate_vote.mod_create_round(
  p_code text, p_title text, p_type text, p_options jsonb)
returns climate_vote.rounds language plpgsql security definer
set search_path = climate_vote, pg_temp as $$
declare v_team climate_vote.team; v_row climate_vote.rounds;
begin
  select * into v_team from climate_vote.team where join_code = p_code and status='active';
  if not found then raise exception 'invalid join code'; end if;
  insert into climate_vote.rounds (id, title, type, options, sort_order, status, team_id, created_by)
  values ('m-'||substr(md5(random()::text||clock_timestamp()::text),1,10),
          p_title, p_type, p_options, 0, 'active', v_team.id, 'mod:'||v_team.name)
  returning * into v_row;
  return v_row;
end $$;

create or replace function climate_vote.mod_set_round_status(
  p_code text, p_round_id text, p_status text)
returns climate_vote.rounds language plpgsql security definer
set search_path = climate_vote, pg_temp as $$
declare v_team climate_vote.team; v_row climate_vote.rounds;
begin
  select * into v_team from climate_vote.team where join_code = p_code and status='active';
  if not found then raise exception 'invalid join code'; end if;
  if p_status not in ('active','closed') then raise exception 'invalid status: %', p_status; end if;
  update climate_vote.rounds set status = p_status, updated_at = now()
   where id = p_round_id and team_id = v_team.id
  returning * into v_row;
  if not found then raise exception 'round not in team scope'; end if;
  return v_row;
end $$;

create or replace function climate_vote.mod_proxy_vote(
  p_code text, p_round_id text, p_choice jsonb, p_n int)
returns int language plpgsql security definer
set search_path = climate_vote, pg_temp as $$
declare v_team climate_vote.team; i int;
begin
  select * into v_team from climate_vote.team where join_code = p_code and status='active';
  if not found then raise exception 'invalid join code'; end if;
  if p_n < 1 or p_n > 5 then raise exception 'proxy 1~5 only'; end if;
  perform 1 from climate_vote.rounds where id=p_round_id and team_id=v_team.id and status='active';
  if not found then raise exception 'round not active in team'; end if;
  for i in 1..p_n loop
    insert into climate_vote.votes (round_id, choice, voter_role, client_id)
    values (p_round_id, p_choice, 'proxy', 'proxy-'||v_team.id||'-'||gen_random_uuid());
  end loop;
  return p_n;
end $$;

-- /hq·/v용 읽기 전용: 팀 목록(코드 제외) 노출
create or replace function climate_vote.hq_teams()
returns table(id uuid, name text, subgroup text, capacity int, status text)
language sql security definer set search_path = climate_vote, pg_temp as $$
  select id, name, subgroup, capacity, status from climate_vote.team;
$$;

grant execute on function climate_vote.mod_join, climate_vote.mod_create_round,
  climate_vote.mod_set_round_status, climate_vote.mod_proxy_vote, climate_vote.hq_teams to anon;

-- Realtime: rounds/votes 변경 구독 (이미 등록돼 있으면 no-op 처리)
do $$ begin
  alter publication supabase_realtime add table climate_vote.rounds;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table climate_vote.votes;
exception when duplicate_object then null; end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- Step 5: cv_snapshot_now payload에 team/timer_log 키 ADDITIVE 추가
-- (기존 키 votes/rounds/archive_log/agenda/agenda_link/agenda_vote/tally는 그대로 유지)
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION climate_vote.cv_snapshot_now(p_label text DEFAULT NULL::text, p_source text DEFAULT 'cron'::text)
 RETURNS json
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_id bigint;
  v_votes_count int;
  v_rounds_count int;
  v_archive_log_count int;
  v_payload jsonb;
BEGIN
  SELECT COUNT(*) INTO v_votes_count FROM climate_vote.votes;
  SELECT COUNT(*) INTO v_rounds_count FROM climate_vote.rounds;
  SELECT COUNT(*) INTO v_archive_log_count FROM climate_vote.archive_log;

  v_payload := jsonb_build_object(
    'votes',       COALESCE((SELECT jsonb_agg(to_jsonb(v) ORDER BY id) FROM climate_vote.votes v), '[]'::jsonb),
    'rounds',      COALESCE((SELECT jsonb_agg(to_jsonb(r) ORDER BY sort_order) FROM climate_vote.rounds r), '[]'::jsonb),
    'archive_log', COALESCE((SELECT jsonb_agg(to_jsonb(l) ORDER BY id) FROM climate_vote.archive_log l), '[]'::jsonb),
    'agenda',      COALESCE((SELECT jsonb_agg(to_jsonb(a)  ORDER BY a.id)  FROM climate_vote.agenda a), '[]'::jsonb),
    'agenda_link', COALESCE((SELECT jsonb_agg(to_jsonb(al) ORDER BY al.id) FROM climate_vote.agenda_link al), '[]'::jsonb),
    'agenda_vote', COALESCE((SELECT jsonb_agg(to_jsonb(av) ORDER BY av.id) FROM climate_vote.agenda_vote av), '[]'::jsonb),
    'tally',       COALESCE((SELECT jsonb_agg(to_jsonb(t))                 FROM climate_vote.tally t), '[]'::jsonb),
    -- ADDITIVE (mod-console): 팀 스코프 + 타이머 로그
    'team',        COALESCE((SELECT jsonb_agg(to_jsonb(tm) ORDER BY tm.id) FROM climate_vote.team tm), '[]'::jsonb),
    'timer_log',   COALESCE((SELECT jsonb_agg(to_jsonb(tl) ORDER BY tl.id) FROM climate_vote.timer_log tl), '[]'::jsonb)
  );

  INSERT INTO climate_vote.snapshots (label, source, votes_count, rounds_count, archive_log_count, payload)
  VALUES (p_label, p_source, v_votes_count, v_rounds_count, v_archive_log_count, v_payload)
  RETURNING id INTO v_id;

  RETURN json_build_object(
    'id', v_id,
    'taken_at', NOW(),
    'votes', v_votes_count,
    'rounds', v_rounds_count,
    'archive_log', v_archive_log_count,
    'bytes', length(v_payload::text)
  );
END $function$;
