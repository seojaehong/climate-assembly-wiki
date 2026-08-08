-- feat(system-schema S1): 위계(assembly·discussion_topic) + 조별 산출물(submission) + 최종제출 잠금
-- project: labor_money (pleyuknjnprsckssxvrh), schema: climate_vote
--
-- WHY: gongron 벤치마킹(2026-08-08) 후 확정 — 우리 스택을 시스템 레벨로 승격.
--      spec: 10_작업산출물/2026-08-08_숙의운영시스템_스키마_spec.md
--      B1 3층 위계 / B2 최종제출 잠금+HQ 재오픈 / B3 준비도 게이트 / B12 lifecycle(archived_at)
--
-- WHAT: assembly, discussion_topic, submission, submission_item, submission_lock_event 신설.
--       session에 assembly_id·ordinal·held_on 컬럼 추가(nullable, 기존 행 무해).
--       RPC 6종: topic_list / submission_get / submission_save / submission_finalize
--                / submission_reopen(HQ 토큰) / readiness_check
--       잠금 트리거 2종(final 상태에서 item·submission 변조 차단, SECURITY DEFINER RPC 경유도 차단).
--
-- SAFETY: 순수 additive. 기존 테이블 컬럼/데이터/정책/함수 변경 없음.
--         신설 테이블 전부 RLS enable + anon/authenticated 직접 접근 revoke — RPC 경유만.
--         함수는 PUBLIC EXECUTE 회수 후 anon+authenticated에만 grant
--         (PUBLIC grant 함정·7/26 authenticated 403 장애 재발 방지).
--
-- ROLLBACK: supabase/rollbacks/20260808_BEFORE_s1.sql
--
-- ★ 적용 후 검증(anon 키, Content-Profile: climate_vote 필수):
--   POST /rest/v1/rpc/topic_list {"p_code":"<유효 join_code>"} → 200 [] (시드 전) = 적용됨
--   PGRST202 + message에 climate_vote.topic_list → 미적용

-- ── 1. 위계 ──────────────────────────────────────────────────────────

create table if not exists climate_vote.assembly (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]{3,40}$'),
  title text not null check (length(trim(title)) between 1 and 200),
  purpose text,
  mode text not null default 'consensus' check (mode in ('consensus','vote')),
  config jsonb not null default '{}',
  status text not null default 'draft' check (status in ('draft','active','closed','archived')),
  archived_at timestamptz,
  created_at timestamptz not null default now()
);

alter table climate_vote.session add column if not exists assembly_id uuid references climate_vote.assembly(id);
alter table climate_vote.session add column if not exists ordinal int;
alter table climate_vote.session add column if not exists held_on date;

create table if not exists climate_vote.discussion_topic (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references climate_vote.session(id),
  ordinal int not null,
  block text check (block in ('am','pm')),
  prompt text not null check (length(trim(prompt)) between 1 and 500),
  guidance text,
  status text not null default 'draft' check (status in ('draft','open','closed','archived')),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  unique (session_id, ordinal)
);

-- ── 2. 조별 산출물 + 잠금 ────────────────────────────────────────────

create table if not exists climate_vote.submission (
  id uuid primary key default gen_random_uuid(),
  topic_id uuid not null references climate_vote.discussion_topic(id),
  team_id uuid not null references climate_vote.team(id),
  status text not null default 'draft'
    check (status in ('draft','final','reopened','archived')),
  finalized_at timestamptz,
  finalized_by text,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (topic_id, team_id)
);

create table if not exists climate_vote.submission_item (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references climate_vote.submission(id) on delete cascade,
  ordinal int not null,
  kind text not null default 'core' check (kind in ('core','extra')),
  content text not null check (length(trim(content)) between 1 and 2000),
  rationale text check (rationale is null or length(rationale) <= 2000),
  provenance jsonb not null default '{}',
  created_at timestamptz not null default now(),
  unique (submission_id, ordinal)
);

create table if not exists climate_vote.submission_lock_event (
  id bigint generated always as identity primary key,
  submission_id uuid not null references climate_vote.submission(id),
  action text not null check (action in ('finalize','reopen')),
  actor_scope text not null check (actor_scope in ('team','hq')),
  actor_label text not null,
  reason text,
  created_at timestamptz not null default now()
);

create index if not exists submission_topic_idx on climate_vote.submission(topic_id);
create index if not exists submission_team_idx on climate_vote.submission(team_id);
create index if not exists submission_item_sub_idx on climate_vote.submission_item(submission_id);
create index if not exists topic_session_idx on climate_vote.discussion_topic(session_id);

-- ── 3. RLS + 직접 접근 차단 ──────────────────────────────────────────

alter table climate_vote.assembly enable row level security;
alter table climate_vote.discussion_topic enable row level security;
alter table climate_vote.submission enable row level security;
alter table climate_vote.submission_item enable row level security;
alter table climate_vote.submission_lock_event enable row level security;

revoke all on climate_vote.assembly, climate_vote.discussion_topic,
  climate_vote.submission, climate_vote.submission_item,
  climate_vote.submission_lock_event
from anon, authenticated;

-- ── 4. 잠금 트리거 (final 상태 변조 차단 — RPC 우회 방어선) ──────────

create or replace function climate_vote.submission_item_lock_guard()
returns trigger language plpgsql as $$
declare v_status text;
begin
  select status into v_status from climate_vote.submission
   where id = coalesce(new.submission_id, old.submission_id);
  if v_status = 'final' then
    raise exception 'submission is finalized — reopen required (hq)';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

drop trigger if exists submission_item_lock_guard on climate_vote.submission_item;
create trigger submission_item_lock_guard
  before insert or update or delete on climate_vote.submission_item
  for each row execute function climate_vote.submission_item_lock_guard();

create or replace function climate_vote.submission_lock_guard()
returns trigger language plpgsql as $$
begin
  -- final → 허용되는 전이는 reopen(RPC가 reopened로 변경)뿐.
  if old.status = 'final' and new.status not in ('final','reopened') then
    raise exception 'finalized submission: only reopen allowed';
  end if;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists submission_lock_guard on climate_vote.submission;
create trigger submission_lock_guard
  before update on climate_vote.submission
  for each row execute function climate_vote.submission_lock_guard();

-- ── 5. RPC ───────────────────────────────────────────────────────────

-- 5-1. 조 콘솔: 내 세션의 토론 주제 목록 (draft·archived 제외)
create or replace function climate_vote.topic_list(p_code text)
returns table(id uuid, ordinal int, block text, prompt text, guidance text, status text)
language sql security definer
set search_path = climate_vote, pg_temp as $$
  select dt.id, dt.ordinal, dt.block, dt.prompt, dt.guidance, dt.status
  from climate_vote.discussion_topic dt
  join climate_vote.team t on t.session_id = dt.session_id
  where t.join_code = p_code and t.status = 'active'
    and dt.status in ('open','closed')
  order by dt.ordinal;
$$;

-- 5-2. 조 콘솔: 주제별 내 조 제출물 + 항목
create or replace function climate_vote.submission_get(p_code text, p_topic_id uuid)
returns jsonb language plpgsql security definer
set search_path = climate_vote, pg_temp as $$
declare v_team climate_vote.team; v_sub climate_vote.submission; v_items jsonb;
begin
  select * into v_team from climate_vote.team where join_code = p_code and status = 'active';
  if not found then raise exception 'invalid join code'; end if;
  select * into v_sub from climate_vote.submission
   where topic_id = p_topic_id and team_id = v_team.id;
  if not found then
    return jsonb_build_object('status', null, 'items', '[]'::jsonb);
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'ordinal', si.ordinal, 'kind', si.kind,
           'content', si.content, 'rationale', si.rationale)
           order by si.ordinal), '[]'::jsonb)
    into v_items
  from climate_vote.submission_item si where si.submission_id = v_sub.id;
  return jsonb_build_object(
    'id', v_sub.id, 'status', v_sub.status,
    'finalized_at', v_sub.finalized_at, 'updated_at', v_sub.updated_at,
    'items', v_items);
end $$;

-- 5-3. 조 콘솔: 저장(중간 보관) — draft/reopened에서만. items 전체 교체.
--      p_items: [{"ordinal":1,"kind":"core","content":"...","rationale":"..."}]
create or replace function climate_vote.submission_save(
  p_code text, p_topic_id uuid, p_items jsonb)
returns jsonb language plpgsql security definer
set search_path = climate_vote, pg_temp as $$
declare v_team climate_vote.team; v_sub climate_vote.submission; v_n int;
begin
  select * into v_team from climate_vote.team where join_code = p_code and status = 'active';
  if not found then raise exception 'invalid join code'; end if;
  perform 1 from climate_vote.discussion_topic
   where id = p_topic_id and status = 'open' and session_id = v_team.session_id;
  if not found then raise exception 'topic not open in this session'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 30 then
    raise exception 'items must be array (max 30)';
  end if;

  insert into climate_vote.submission (topic_id, team_id)
  values (p_topic_id, v_team.id)
  on conflict (topic_id, team_id) do update set updated_at = now()
  returning * into v_sub;

  if v_sub.status = 'final' then
    raise exception 'submission is finalized — reopen required (hq)';
  end if;

  delete from climate_vote.submission_item where submission_id = v_sub.id;
  insert into climate_vote.submission_item (submission_id, ordinal, kind, content, rationale)
  select v_sub.id,
         coalesce((e->>'ordinal')::int, rn),
         coalesce(nullif(e->>'kind',''), 'core'),
         e->>'content',
         nullif(e->>'rationale','')
  from jsonb_array_elements(p_items) with ordinality as x(e, rn)
  where length(trim(coalesce(e->>'content',''))) > 0;

  get diagnostics v_n = row_count;
  return jsonb_build_object('id', v_sub.id, 'status', v_sub.status, 'saved', v_n);
end $$;

-- 5-4. 조 콘솔: 최종 제출(잠금)
create or replace function climate_vote.submission_finalize(p_code text, p_topic_id uuid)
returns jsonb language plpgsql security definer
set search_path = climate_vote, pg_temp as $$
declare v_team climate_vote.team; v_sub climate_vote.submission; v_cnt int;
begin
  select * into v_team from climate_vote.team where join_code = p_code and status = 'active';
  if not found then raise exception 'invalid join code'; end if;
  select * into v_sub from climate_vote.submission
   where topic_id = p_topic_id and team_id = v_team.id;
  if not found then raise exception 'nothing to finalize'; end if;
  if v_sub.status = 'final' then raise exception 'already finalized'; end if;
  select count(*) into v_cnt from climate_vote.submission_item where submission_id = v_sub.id;
  if v_cnt = 0 then raise exception 'cannot finalize empty submission'; end if;

  update climate_vote.submission
     set status = 'final', finalized_at = now(), finalized_by = 'mod:' || v_team.name
   where id = v_sub.id;
  insert into climate_vote.submission_lock_event
    (submission_id, action, actor_scope, actor_label)
  values (v_sub.id, 'finalize', 'team', 'mod:' || v_team.name);
  return jsonb_build_object('id', v_sub.id, 'status', 'final');
end $$;

-- 5-5. HQ 전용: 재오픈 (attendance HQ 토큰 재사용, reason 필수)
create or replace function climate_vote.submission_reopen(
  p_token text, p_submission_id uuid, p_reason text)
returns jsonb language plpgsql security definer
set search_path = climate_vote, extensions, pg_temp as $$
declare v_auth climate_vote.attendance_auth_session; v_sub climate_vote.submission;
begin
  v_auth := climate_vote.attendance_token_row(p_token);
  if v_auth.scope <> 'hq' then raise exception 'hq authorization required'; end if;
  if length(trim(coalesce(p_reason,''))) < 2 then raise exception 'reason required'; end if;
  select * into v_sub from climate_vote.submission where id = p_submission_id;
  if not found then raise exception 'submission not found'; end if;
  if v_sub.status <> 'final' then raise exception 'only finalized submission can be reopened'; end if;

  update climate_vote.submission set status = 'reopened' where id = p_submission_id;
  insert into climate_vote.submission_lock_event
    (submission_id, action, actor_scope, actor_label, reason)
  values (p_submission_id, 'reopen', 'hq', v_auth.actor_label, trim(p_reason));
  return jsonb_build_object('id', p_submission_id, 'status', 'reopened');
end $$;

-- 5-6. 준비도 게이트 (PII 없음 — anon 허용)
--      assembly.config->'readiness'가 있으면 그 키만, 없으면 기본 4종 평가
create or replace function climate_vote.readiness_check(p_session uuid)
returns jsonb language plpgsql security definer
set search_path = climate_vote, pg_temp as $$
declare
  v_topics int; v_teams int; v_roster int; v_final int; v_total int;
  v_checks jsonb;
begin
  select count(*) into v_topics from climate_vote.discussion_topic
   where session_id = p_session and status = 'open';
  select count(*) into v_teams from climate_vote.team
   where session_id = p_session and status = 'active';
  select count(*) into v_roster from climate_vote.team_assignment ta
   join climate_vote.team t on t.id = ta.team_id
   where t.session_id = p_session and ta.active;
  select count(*) filter (where s.status = 'final'), count(*)
    into v_final, v_total
  from climate_vote.submission s
  join climate_vote.discussion_topic dt on dt.id = s.topic_id
  where dt.session_id = p_session;

  v_checks := jsonb_build_array(
    jsonb_build_object('key','topics_open',  'pass', v_topics > 0, 'detail', v_topics || '개 주제 open'),
    jsonb_build_object('key','teams_active', 'pass', v_teams > 0,  'detail', v_teams || '개 조 active'),
    jsonb_build_object('key','roster_loaded','pass', v_roster > 0, 'detail', v_roster || '명 배정'),
    jsonb_build_object('key','submissions',  'pass', true,
      'detail', v_final || '/' || v_total || ' 최종 제출'));
  return jsonb_build_object(
    'ok', v_topics > 0 and v_teams > 0 and v_roster > 0,
    'checks', v_checks);
end $$;

-- ── 6. 권한: PUBLIC 회수 → anon + authenticated grant ───────────────

revoke execute on function
  climate_vote.topic_list(text),
  climate_vote.submission_get(text, uuid),
  climate_vote.submission_save(text, uuid, jsonb),
  climate_vote.submission_finalize(text, uuid),
  climate_vote.submission_reopen(text, uuid, text),
  climate_vote.readiness_check(uuid),
  climate_vote.submission_item_lock_guard(),
  climate_vote.submission_lock_guard()
from public;

grant execute on function
  climate_vote.topic_list(text),
  climate_vote.submission_get(text, uuid),
  climate_vote.submission_save(text, uuid, jsonb),
  climate_vote.submission_finalize(text, uuid),
  climate_vote.submission_reopen(text, uuid, text),
  climate_vote.readiness_check(uuid)
to anon, authenticated;
