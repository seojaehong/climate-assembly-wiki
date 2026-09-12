-- s24: recommendation-level authoring workflow for the 9/12-13 workshop.
--
-- Additive to s23. The original 25 agenda rows and every s23 event remain intact.
-- Dynamic agendas reuse agenda_item, while lifecycle, recommendation revisions,
-- recommendation progress, and archive actions are append-only event history.

begin;

-- s23's emergency catalog allowed at most 20 rows per division. Dynamic agendas
-- need a larger, still bounded ordinal space.
alter table climate_vote.agenda_item
  drop constraint if exists agenda_item_ordinal_check;

do $constraint$
begin
  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'climate_vote.agenda_item'::regclass
       and conname = 'agenda_item_ordinal_s24_check'
  ) then
    alter table climate_vote.agenda_item
      add constraint agenda_item_ordinal_s24_check
      check (ordinal between 1 and 999);
  end if;
end
$constraint$;

create table if not exists climate_vote.agenda_lifecycle_event (
  id bigint generated always as identity primary key,
  session_id uuid not null references climate_vote.session(id),
  agenda_id uuid not null references climate_vote.agenda_item(id),
  action text not null check (action in ('create','archive')),
  reason text check (reason is null or length(trim(reason)) between 2 and 500),
  actor_scope text not null check (actor_scope in ('team','hq')),
  actor_team_id uuid references climate_vote.team(id),
  actor_label text not null check (length(trim(actor_label)) between 1 and 80),
  request_id uuid not null unique,
  created_at timestamptz not null default now(),
  check (
    (actor_scope='team' and actor_team_id is not null)
    or (actor_scope='hq' and actor_team_id is null)
  )
);

create index if not exists agenda_lifecycle_latest_idx
  on climate_vote.agenda_lifecycle_event(session_id, agenda_id, id desc);

create table if not exists climate_vote.agenda_recommendation (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references climate_vote.session(id),
  agenda_id uuid not null references climate_vote.agenda_item(id),
  author_team_id uuid not null references climate_vote.team(id),
  sort_order int not null check (sort_order between 1 and 999),
  created_scope text not null check (created_scope in ('team','hq')),
  created_by text not null check (length(trim(created_by)) between 1 and 80),
  created_request_id uuid not null unique,
  created_at timestamptz not null default now(),
  unique (agenda_id, author_team_id, sort_order)
);

create index if not exists agenda_recommendation_agenda_idx
  on climate_vote.agenda_recommendation(session_id, agenda_id, author_team_id, sort_order);

create table if not exists climate_vote.agenda_recommendation_revision (
  id bigint generated always as identity primary key,
  recommendation_id uuid not null references climate_vote.agenda_recommendation(id),
  topic_id uuid not null references climate_vote.discussion_topic(id),
  version int not null check (version between 1 and 10000),
  title text not null check (length(trim(title)) between 1 and 300),
  problem_recognition text not null default '' check (length(problem_recognition) <= 8000),
  recommendation_content text not null default '' check (length(recommendation_content) <= 12000),
  expected_effect text check (expected_effect is null or length(expected_effect) <= 8000),
  -- Reserved canonical-template fields. They are deliberately absent from the
  -- current write RPCs and UI, but keeping them in revision snapshots prevents
  -- a later rollout from rewriting history.
  implementation_schedule text,
  core_principle text,
  other_opinion text,
  division_vote_result jsonb,
  actor_scope text not null check (actor_scope in ('team','hq')),
  actor_team_id uuid references climate_vote.team(id),
  actor_label text not null check (length(trim(actor_label)) between 1 and 80),
  request_id uuid not null unique,
  created_at timestamptz not null default now(),
  unique (recommendation_id, version),
  check (
    (actor_scope='team' and actor_team_id is not null)
    or (actor_scope='hq' and actor_team_id is null)
  )
);

create index if not exists agenda_recommendation_revision_latest_idx
  on climate_vote.agenda_recommendation_revision(recommendation_id, version desc);

create table if not exists climate_vote.agenda_recommendation_archive_event (
  id bigint generated always as identity primary key,
  session_id uuid not null references climate_vote.session(id),
  recommendation_id uuid not null references climate_vote.agenda_recommendation(id),
  reason text not null check (length(trim(reason)) between 2 and 500),
  actor_scope text not null check (actor_scope in ('team','hq')),
  actor_team_id uuid references climate_vote.team(id),
  actor_label text not null check (length(trim(actor_label)) between 1 and 80),
  request_id uuid not null unique,
  created_at timestamptz not null default now(),
  check (
    (actor_scope='team' and actor_team_id is not null)
    or (actor_scope='hq' and actor_team_id is null)
  )
);

create index if not exists agenda_recommendation_archive_idx
  on climate_vote.agenda_recommendation_archive_event(session_id, recommendation_id, id desc);

create table if not exists climate_vote.agenda_recommendation_progress_event (
  id bigint generated always as identity primary key,
  session_id uuid not null references climate_vote.session(id),
  recommendation_id uuid not null references climate_vote.agenda_recommendation(id),
  topic_id uuid not null references climate_vote.discussion_topic(id),
  action text not null check (action in (
    'start','save','confirm','submit','revision_request','reopen'
  )),
  status text not null check (status in (
    'waiting','discussing','drafting','team_confirmed','submitted'
  )),
  feedback text check (feedback is null or length(feedback) <= 1000),
  actor_scope text not null check (actor_scope in ('team','hq')),
  actor_team_id uuid references climate_vote.team(id),
  actor_label text not null check (length(trim(actor_label)) between 1 and 80),
  request_id uuid not null unique,
  created_at timestamptz not null default now(),
  check (
    (actor_scope='team' and actor_team_id is not null)
    or (actor_scope='hq' and actor_team_id is null)
  )
);

create index if not exists agenda_recommendation_progress_latest_idx
  on climate_vote.agenda_recommendation_progress_event(
    session_id, recommendation_id, id desc
  );

-- Upgrade a previously applied early s24 draft without discarding its history.
-- Existing append-only triggers are removed only for this one deterministic
-- backfill and are recreated immediately below in the same transaction.
drop trigger if exists agenda_recommendation_revision_append_only
  on climate_vote.agenda_recommendation_revision;
drop trigger if exists agenda_recommendation_progress_event_append_only
  on climate_vote.agenda_recommendation_progress_event;

alter table climate_vote.agenda_recommendation_revision
  add column if not exists topic_id uuid references climate_vote.discussion_topic(id);
alter table climate_vote.agenda_recommendation_progress_event
  add column if not exists topic_id uuid references climate_vote.discussion_topic(id);

update climate_vote.agenda_recommendation_revision r
   set topic_id=chosen.id
  from climate_vote.agenda_recommendation ar
  cross join lateral (
    select dt.id
      from climate_vote.discussion_topic dt
     where dt.session_id=ar.session_id and dt.status<>'archived'
     order by (dt.status='open') desc,dt.ordinal
     limit 1
  ) chosen
 where r.recommendation_id=ar.id and r.topic_id is null;

update climate_vote.agenda_recommendation_progress_event p
   set topic_id=chosen.id
  from climate_vote.agenda_recommendation ar
  cross join lateral (
    select dt.id
      from climate_vote.discussion_topic dt
     where dt.session_id=ar.session_id and dt.status<>'archived'
     order by (dt.status='open') desc,dt.ordinal
     limit 1
  ) chosen
 where p.recommendation_id=ar.id and p.topic_id is null;

do $topic_backfill$
begin
  if exists(select 1 from climate_vote.agenda_recommendation_revision where topic_id is null)
     or exists(select 1 from climate_vote.agenda_recommendation_progress_event where topic_id is null) then
    raise exception 's24 topic backfill requires a non-archived discussion topic';
  end if;
end
$topic_backfill$;

alter table climate_vote.agenda_recommendation_revision
  alter column topic_id set not null;
alter table climate_vote.agenda_recommendation_progress_event
  alter column topic_id set not null;

create or replace function climate_vote.recommendation_append_only_guard()
returns trigger
language plpgsql
set search_path = climate_vote, pg_temp as $fn$
begin
  raise exception 'recommendation workflow history is append-only';
end
$fn$;

revoke all on function climate_vote.recommendation_append_only_guard()
  from public, anon, authenticated;

create or replace function climate_vote.recommendation_topic_scope_guard()
returns trigger
language plpgsql
set search_path = climate_vote, pg_temp as $fn$
declare v_recommendation_session uuid; v_topic_session uuid;
begin
  select session_id into v_recommendation_session
    from climate_vote.agenda_recommendation where id=new.recommendation_id;
  select session_id into v_topic_session
    from climate_vote.discussion_topic where id=new.topic_id;
  if v_recommendation_session is null or v_topic_session is null
     or v_recommendation_session<>v_topic_session
     or (tg_table_name='agenda_recommendation_progress_event'
         and (to_jsonb(new)->>'session_id')::uuid<>v_recommendation_session) then
    raise exception 'recommendation workflow stage session mismatch';
  end if;
  return new;
end
$fn$;

revoke all on function climate_vote.recommendation_topic_scope_guard()
  from public, anon, authenticated;

do $triggers$
declare
  v_table text;
begin
  foreach v_table in array array[
    'agenda_lifecycle_event',
    'agenda_recommendation',
    'agenda_recommendation_revision',
    'agenda_recommendation_archive_event',
    'agenda_recommendation_progress_event'
  ] loop
    execute format('drop trigger if exists %I on climate_vote.%I', v_table||'_append_only', v_table);
    execute format(
      'create trigger %I before update or delete on climate_vote.%I for each row execute function climate_vote.recommendation_append_only_guard()',
      v_table||'_append_only', v_table
    );
    execute format('drop trigger if exists %I on climate_vote.%I', v_table||'_no_truncate', v_table);
    execute format(
      'create trigger %I before truncate on climate_vote.%I for each statement execute function climate_vote.recommendation_append_only_guard()',
      v_table||'_no_truncate', v_table
    );
  end loop;
end
$triggers$;

drop trigger if exists agenda_recommendation_revision_topic_scope
  on climate_vote.agenda_recommendation_revision;
create trigger agenda_recommendation_revision_topic_scope
before insert on climate_vote.agenda_recommendation_revision
for each row execute function climate_vote.recommendation_topic_scope_guard();

drop trigger if exists agenda_recommendation_progress_topic_scope
  on climate_vote.agenda_recommendation_progress_event;
create trigger agenda_recommendation_progress_topic_scope
before insert on climate_vote.agenda_recommendation_progress_event
for each row execute function climate_vote.recommendation_topic_scope_guard();

alter table climate_vote.agenda_lifecycle_event enable row level security;
alter table climate_vote.agenda_recommendation enable row level security;
alter table climate_vote.agenda_recommendation_revision enable row level security;
alter table climate_vote.agenda_recommendation_archive_event enable row level security;
alter table climate_vote.agenda_recommendation_progress_event enable row level security;

revoke all on
  climate_vote.agenda_lifecycle_event,
  climate_vote.agenda_recommendation,
  climate_vote.agenda_recommendation_revision,
  climate_vote.agenda_recommendation_archive_event,
  climate_vote.agenda_recommendation_progress_event
from public, anon, authenticated;

-- Every public v2 RPC enters through this boundary. attendance_scope_session_row
-- delegates HQ validation to workshop_hq_session_row and team_token_row enforces
-- the current workshop-purpose/device/session window. The explicit operator
-- check also keeps this migration fail-closed if it is rehearsed before P2a.
create or replace function climate_vote.recommendation_scope_row_v2(
  p_token text, p_session_slug text
)
returns climate_vote.attendance_auth_session
language plpgsql security definer
set search_path = climate_vote, extensions, pg_temp as $fn$
declare
  v_session climate_vote.session;
  v_auth climate_vote.attendance_auth_session;
  v_team climate_vote.team;
begin
  if p_session_slug is distinct from '0912-deliberation' then
    raise exception 'recommendation workflow session mismatch';
  end if;
  v_session:=climate_vote.attendance_scope_session_row(p_token,p_session_slug);
  select s.* into v_auth
    from climate_vote.attendance_auth_session s
   where s.token_hash=encode(digest(lower(p_token),'sha256'),'hex')
     and s.session_id=v_session.id and s.org_id=v_session.org_id
     and s.revoked_at is null and s.expires_at>now();
  if not found then raise exception 'recommendation workflow authorization required'; end if;
  if v_auth.scope='team' then
    v_team:=climate_vote.team_token_row(p_token);
    if v_team.id is distinct from v_auth.team_id
       or v_team.session_id is distinct from v_session.id then
      raise exception 'recommendation team scope mismatch';
    end if;
  elsif v_auth.scope='hq' then
    if not exists(
      select 1 from climate_vote.hq_operator op
       where op.name=v_auth.actor_label and op.active
    ) then
      raise exception 'active named HQ authorization required';
    end if;
  else
    raise exception 'recommendation workflow authorization required';
  end if;
  return v_auth;
end
$fn$;

create or replace function climate_vote.recommendation_topic_id(
  p_session_id uuid, p_topic_id uuid default null
)
returns uuid
language plpgsql stable security definer
set search_path = climate_vote, pg_temp as $fn$
declare v_topic_id uuid; v_open_count int;
begin
  select count(*)::int into v_open_count
    from climate_vote.discussion_topic
   where session_id=p_session_id and status='open';
  if v_open_count<>1 then
    raise exception 'exactly one open workflow stage required';
  end if;
  select id into v_topic_id from climate_vote.discussion_topic
   where session_id=p_session_id and status='open';
  if p_topic_id is not null and p_topic_id is distinct from v_topic_id then
    raise exception 'workflow stage must be the single open stage';
  end if;
  return v_topic_id;
end
$fn$;

revoke all on function climate_vote.recommendation_scope_row_v2(text,text),
  climate_vote.recommendation_topic_id(uuid,uuid)
from public, anon, authenticated;

create or replace function climate_vote.agenda_board_v2(
  p_token text, p_session_slug text
)
returns jsonb
language plpgsql security definer
set search_path = climate_vote, extensions, pg_temp as $fn$
declare
  v_auth climate_vote.attendance_auth_session;
  v_session_id uuid;
  v_team_subgroup text;
  v_active_topic_id uuid;
  v_open_topic_count int;
begin
  v_auth:=climate_vote.recommendation_scope_row_v2(p_token,p_session_slug);
  v_session_id:=v_auth.session_id;
  if v_auth.scope='team' then
    select subgroup into v_team_subgroup
      from climate_vote.team
     where id=v_auth.team_id and session_id=v_session_id and status='active';
    if v_team_subgroup is null then raise exception 'team outside recommendation session'; end if;
  elsif v_auth.scope<>'hq' then
    raise exception 'recommendation board authorization required';
  end if;

  select count(*)::int into v_open_topic_count
    from climate_vote.discussion_topic
   where session_id=v_session_id and status='open';
  if v_open_topic_count>1 then
    raise exception 'multiple open workflow stages';
  elsif v_open_topic_count=1 then
    select id into v_active_topic_id from climate_vote.discussion_topic
     where session_id=v_session_id and status='open';
  else
    v_active_topic_id:=null;
  end if;

  return jsonb_build_object(
    'version',3,
    'sessionSlug',p_session_slug,
    'scope',v_auth.scope,
    'teamId',v_auth.team_id,
    'teamSubgroup',v_team_subgroup,
    'stageIntegrity',jsonb_build_object(
      'openStageCount',v_open_topic_count,
      'writable',v_open_topic_count=1
    ),
    'activeStage',(
      select jsonb_build_object(
        'id',dt.id,'ordinal',dt.ordinal,'prompt',dt.prompt,'status',dt.status
      )
        from climate_vote.discussion_topic dt where dt.id=v_active_topic_id
    ),
    'stages',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',dt.id,'ordinal',dt.ordinal,'prompt',dt.prompt,'status',dt.status
      ) order by dt.ordinal)
        from climate_vote.discussion_topic dt
       where dt.session_id=v_session_id and dt.status<>'archived'
    ),'[]'::jsonb),
    'teams',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',t.id,'name',t.name,'subgroup',t.subgroup,'tableNo',t.table_no
      ) order by t.subgroup,t.name)
        from climate_vote.team t
       where t.session_id=v_session_id and t.status='active'
         and (v_auth.scope='hq' or t.id=v_auth.team_id)
    ),'[]'::jsonb),
    'agendas',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',ai.id,
        'subgroup',ai.subgroup,
        'ordinal',ai.ordinal,
        'title',ai.title,
        'archived',exists(
          select 1 from climate_vote.agenda_lifecycle_event ale
           where ale.agenda_id=ai.id and ale.action='archive'
        ),
        'createdAt',ai.created_at,
        'sourceUtterances',coalesce((
          select jsonb_agg(su.content order by su.ordinal)
            from climate_vote.agenda_source_utterance su
           where su.agenda_id=ai.id
        ),'[]'::jsonb),
        'assignments',coalesce((
          select jsonb_agg(jsonb_build_object(
            'teamId',latest.team_id,
            'teamName',t.name,
            'assignedAt',latest.created_at
          ) order by t.name)
            from (
              select distinct on (e.team_id) e.team_id,e.assigned,e.created_at
                from climate_vote.agenda_assignment_event e
               where e.session_id=v_session_id and e.agenda_id=ai.id
               order by e.team_id,e.id desc
            ) latest
            join climate_vote.team t on t.id=latest.team_id
           where latest.assigned
             and (v_auth.scope='hq' or latest.team_id=v_auth.team_id)
        ),'[]'::jsonb),
        'recommendations',coalesce((
          select jsonb_agg(jsonb_build_object(
            'id',ar.id,
            'authorTeamId',ar.author_team_id,
            'authorTeamName',rt.name,
            'sortOrder',ar.sort_order,
            'title',rr.title,
            'problemRecognition',rr.problem_recognition,
            'recommendationContent',rr.recommendation_content,
            'expectedEffect',rr.expected_effect,
            'revisionVersion',rr.version,
            'status',coalesce(rp.status,'waiting'),
            'feedback',rp.feedback,
            'updatedAt',greatest(ar.created_at,rr.created_at,coalesce(rp.created_at,ar.created_at)),
            'archived',exists(
              select 1 from climate_vote.agenda_recommendation_archive_event rae
               where rae.recommendation_id=ar.id
            ),
            'revisionCount',(
              select count(*)::int
                from climate_vote.agenda_recommendation_revision rrc
               where rrc.recommendation_id=ar.id
            ),
            'progressCount',(
              select count(*)::int
                from climate_vote.agenda_recommendation_progress_event rpc
               where rpc.recommendation_id=ar.id
            )
          ) order by rt.name,ar.sort_order)
            from climate_vote.agenda_recommendation ar
            join climate_vote.team rt on rt.id=ar.author_team_id
            join lateral (
              select r.* from climate_vote.agenda_recommendation_revision r
               where r.recommendation_id=ar.id order by r.version desc limit 1
            ) rr on true
            left join lateral (
              select p.* from climate_vote.agenda_recommendation_progress_event p
               where p.recommendation_id=ar.id order by p.id desc limit 1
            ) rp on true
           where ar.agenda_id=ai.id
             and (v_auth.scope='hq' or ar.author_team_id=v_auth.team_id)
             and (
               v_auth.scope='hq'
               or not exists(
                 select 1 from climate_vote.agenda_recommendation_archive_event rae
                  where rae.recommendation_id=ar.id
               )
             )
        ),'[]'::jsonb)
      ) order by ai.subgroup,ai.ordinal)
        from climate_vote.agenda_item ai
       where ai.session_id=v_session_id
         and (
           v_auth.scope='hq'
           or (
             ai.subgroup=v_team_subgroup
             and not exists(
               select 1 from climate_vote.agenda_lifecycle_event ale
                where ale.agenda_id=ai.id and ale.action='archive'
             )
             and true=(
               select e.assigned
                 from climate_vote.agenda_assignment_event e
                where e.session_id=v_session_id and e.agenda_id=ai.id
                  and e.team_id=v_auth.team_id
                order by e.id desc limit 1
             )
           )
         )
    ),'[]'::jsonb)
  );
end
$fn$;

comment on function climate_vote.agenda_board_v2(text,text) is
  'Response contract v3: each recommendation contains only its latest revision fields, revisionVersion:int, current status/feedback, revisionCount:int, and progressCount:int. Full revision and progress arrays are intentionally excluded from the polling payload.';

create or replace function climate_vote.agenda_create_v2(
  p_token text, p_session_slug text, p_subgroup text, p_title text,
  p_source_utterance text, p_request_id uuid
)
returns jsonb
language plpgsql security definer
set search_path = climate_vote, extensions, pg_temp as $fn$
declare
  v_auth climate_vote.attendance_auth_session;
  v_session_id uuid;
  v_team_subgroup text;
  v_title text := trim(coalesce(p_title,''));
  v_source_utterance text := trim(coalesce(p_source_utterance,''));
  v_agenda climate_vote.agenda_item;
  v_prior climate_vote.agenda_lifecycle_event;
  v_ordinal int;
  v_similar jsonb;
begin
  v_auth:=climate_vote.recommendation_scope_row_v2(p_token,p_session_slug);
  v_session_id:=v_auth.session_id;
  if p_request_id is null then raise exception 'idempotency key required'; end if;
  if p_subgroup not in ('1분과','2분과','3분과') then raise exception 'invalid division'; end if;
  if length(v_title) not between 1 and 300 then raise exception 'agenda title required'; end if;
  if length(v_source_utterance) not between 1 and 2000 then raise exception 'source utterance required'; end if;
  perform pg_advisory_xact_lock(hashtextextended('agenda-create:'||p_request_id::text,0));
  select * into v_prior from climate_vote.agenda_lifecycle_event where request_id=p_request_id;
  if found then
    select * into v_agenda from climate_vote.agenda_item where id=v_prior.agenda_id;
    if v_prior.action<>'create' or v_agenda.session_id<>v_session_id
       or v_agenda.subgroup<>p_subgroup or v_agenda.title<>v_title
       or not exists(
         select 1 from climate_vote.agenda_source_utterance su
          where su.agenda_id=v_agenda.id and su.ordinal=1
            and su.content=v_source_utterance
       )
       or (v_auth.scope='team' and v_prior.actor_team_id is distinct from v_auth.team_id)
       or (v_auth.scope='hq' and v_prior.actor_scope<>'hq') then
      raise exception 'idempotency key reused with different agenda payload';
    end if;
    return jsonb_build_object(
      'id',v_agenda.id,'subgroup',v_agenda.subgroup,'ordinal',v_agenda.ordinal,
      'title',v_agenda.title,'createdAt',v_prior.created_at,
      'sourceUtterances',jsonb_build_array(v_source_utterance),
      'similarAgendas','[]'::jsonb,'replayed',true
    );
  end if;
  if v_auth.scope='team' then
    select subgroup into v_team_subgroup from climate_vote.team
     where id=v_auth.team_id and session_id=v_session_id and status='active';
    if v_team_subgroup is distinct from p_subgroup then
      raise exception 'team may create agenda only in its division';
    end if;
  elsif v_auth.scope<>'hq' then
    raise exception 'agenda create authorization required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('agenda-ordinal:'||v_session_id::text||':'||p_subgroup,0));
  select coalesce(max(ordinal),0)+1 into v_ordinal from climate_vote.agenda_item
   where session_id=v_session_id and subgroup=p_subgroup;
  if v_ordinal>999 then raise exception 'agenda ordinal capacity exceeded'; end if;
  insert into climate_vote.agenda_item(
    id,session_id,subgroup,ordinal,title,suggested_team_numbers,source_sha256
  ) values(
    gen_random_uuid(),v_session_id,p_subgroup,v_ordinal,v_title,'{}',
    upper(encode(digest('dynamic-agenda:'||v_session_id::text||':'||p_request_id::text||':'||v_title,'sha256'),'hex'))
  ) returning * into v_agenda;
  insert into climate_vote.agenda_lifecycle_event(
    session_id,agenda_id,action,actor_scope,actor_team_id,actor_label,request_id
  ) values(
    v_session_id,v_agenda.id,'create',v_auth.scope,v_auth.team_id,v_auth.actor_label,p_request_id
  ) returning * into v_prior;
  insert into climate_vote.agenda_source_utterance(agenda_id,ordinal,content)
  values(v_agenda.id,1,v_source_utterance);
  if v_auth.scope='team' then
    insert into climate_vote.agenda_assignment_event(
      session_id,agenda_id,team_id,assigned,actor_scope,actor_label,request_id
    ) values(
      v_session_id,v_agenda.id,v_auth.team_id,true,'hq',
      '자동 배정 · '||v_auth.actor_label,p_request_id
    );
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',ai.id,'title',ai.title)),'[]'::jsonb)
    into v_similar
    from climate_vote.agenda_item ai
   where ai.session_id=v_session_id and ai.subgroup=p_subgroup and ai.id<>v_agenda.id
     and (
       lower(regexp_replace(ai.title,'\s','','g'))=lower(regexp_replace(v_title,'\s','','g'))
       or position(lower(regexp_replace(v_title,'\s','','g')) in lower(regexp_replace(ai.title,'\s','','g')))>0
       or position(lower(regexp_replace(ai.title,'\s','','g')) in lower(regexp_replace(v_title,'\s','','g')))>0
     );
  return jsonb_build_object(
    'id',v_agenda.id,'subgroup',v_agenda.subgroup,'ordinal',v_agenda.ordinal,
    'title',v_agenda.title,'createdAt',v_prior.created_at,
    'sourceUtterances',jsonb_build_array(v_source_utterance),
    'similarAgendas',v_similar,'replayed',false
  );
end
$fn$;

create or replace function climate_vote.agenda_archive_v2(
  p_token text, p_session_slug text, p_agenda_id uuid, p_reason text,
  p_request_id uuid
)
returns jsonb
language plpgsql security definer
set search_path = climate_vote, extensions, pg_temp as $fn$
declare
  v_auth climate_vote.attendance_auth_session;
  v_session_id uuid;
  v_reason text := trim(p_reason);
  v_prior climate_vote.agenda_lifecycle_event;
begin
  v_auth:=climate_vote.recommendation_scope_row_v2(p_token,p_session_slug);
  v_session_id:=v_auth.session_id;
  if v_auth.scope<>'hq' then raise exception 'HQ authorization required'; end if;
  if p_request_id is null then raise exception 'idempotency key required'; end if;
  if length(v_reason) not between 2 and 500 then raise exception 'archive reason required'; end if;
  perform pg_advisory_xact_lock(hashtextextended('agenda-archive:'||p_request_id::text,0));
  select * into v_prior from climate_vote.agenda_lifecycle_event where request_id=p_request_id;
  if found then
    if v_prior.action<>'archive' or v_prior.agenda_id<>p_agenda_id or v_prior.reason<>v_reason then
      raise exception 'idempotency key reused with different archive payload';
    end if;
    return jsonb_build_object('id',v_prior.id,'agendaId',p_agenda_id,'archivedAt',v_prior.created_at,'replayed',true);
  end if;
  perform pg_advisory_xact_lock(hashtextextended('agenda:'||p_agenda_id::text,0));
  if not exists(select 1 from climate_vote.agenda_item where id=p_agenda_id and session_id=v_session_id) then
    raise exception 'agenda outside selected session';
  end if;
  if exists(select 1 from climate_vote.agenda_lifecycle_event where agenda_id=p_agenda_id and action='archive') then
    raise exception 'agenda already archived';
  end if;
  insert into climate_vote.agenda_lifecycle_event(
    session_id,agenda_id,action,reason,actor_scope,actor_label,request_id
  ) values(v_session_id,p_agenda_id,'archive',v_reason,'hq',v_auth.actor_label,p_request_id)
  returning * into v_prior;
  return jsonb_build_object('id',v_prior.id,'agendaId',p_agenda_id,'archivedAt',v_prior.created_at,'replayed',false);
end
$fn$;

create or replace function climate_vote.agenda_assignment_set_v2(
  p_token text, p_session_slug text, p_agenda_id uuid, p_team_id uuid,
  p_assigned boolean, p_request_id uuid
)
returns jsonb
language plpgsql security definer
set search_path = climate_vote, extensions, pg_temp as $fn$
declare
  v_auth climate_vote.attendance_auth_session;
  v_session_id uuid;
  v_subgroup text;
  v_team_subgroup text;
  v_prior climate_vote.agenda_assignment_event;
begin
  v_auth:=climate_vote.recommendation_scope_row_v2(p_token,p_session_slug);
  v_session_id:=v_auth.session_id;
  if v_auth.scope<>'hq' then raise exception 'HQ authorization required'; end if;
  if p_request_id is null then raise exception 'idempotency key required'; end if;
  perform pg_advisory_xact_lock(hashtextextended('agenda-assignment:'||p_request_id::text,0));
  select * into v_prior from climate_vote.agenda_assignment_event where request_id=p_request_id;
  if found then
    if v_prior.session_id<>v_session_id or v_prior.agenda_id<>p_agenda_id
       or v_prior.team_id<>p_team_id or v_prior.assigned<>p_assigned then
      raise exception 'idempotency key reused with different assignment payload';
    end if;
    return jsonb_build_object('id',v_prior.id,'assigned',v_prior.assigned,'replayed',true);
  end if;
  perform pg_advisory_xact_lock(hashtextextended('agenda:'||p_agenda_id::text,0));
  select subgroup into v_subgroup from climate_vote.agenda_item
   where id=p_agenda_id and session_id=v_session_id;
  select subgroup into v_team_subgroup from climate_vote.team
   where id=p_team_id and session_id=v_session_id and status='active';
  if v_subgroup is null or v_team_subgroup is null then raise exception 'agenda or team outside selected session'; end if;
  if exists(select 1 from climate_vote.agenda_lifecycle_event where agenda_id=p_agenda_id and action='archive') then
    raise exception 'archived agenda cannot be assigned';
  end if;
  if v_subgroup<>v_team_subgroup then raise exception 'cross-division assignment denied'; end if;
  insert into climate_vote.agenda_assignment_event(
    session_id,agenda_id,team_id,assigned,actor_scope,actor_label,request_id
  ) values(v_session_id,p_agenda_id,p_team_id,p_assigned,'hq',v_auth.actor_label,p_request_id)
  returning * into v_prior;
  return jsonb_build_object('id',v_prior.id,'assigned',v_prior.assigned,'replayed',false);
end
$fn$;

create or replace function climate_vote.recommendation_create_v2(
  p_token text, p_session_slug text, p_agenda_id uuid, p_team_id uuid,
  p_title text, p_problem_recognition text, p_recommendation_content text,
  p_expected_effect text, p_request_id uuid, p_topic_id uuid
)
returns jsonb
language plpgsql security definer
set search_path = climate_vote, extensions, pg_temp as $fn$
declare
  v_auth climate_vote.attendance_auth_session;
  v_session_id uuid;
  v_agenda_subgroup text;
  v_team_subgroup text;
  v_assigned boolean;
  v_title text:=trim(p_title);
  v_problem text:=trim(coalesce(p_problem_recognition,''));
  v_content text:=trim(coalesce(p_recommendation_content,''));
  v_effect text:=nullif(trim(coalesce(p_expected_effect,'')),'');
  v_sort int;
  v_topic_id uuid;
  v_rec climate_vote.agenda_recommendation;
begin
  v_auth:=climate_vote.recommendation_scope_row_v2(p_token,p_session_slug);
  v_session_id:=v_auth.session_id;
  if p_request_id is null then raise exception 'idempotency key required'; end if;
  if length(v_title) not between 1 and 300 then raise exception 'recommendation title required'; end if;
  if length(v_problem)>8000 or length(v_content)>12000 or length(coalesce(v_effect,''))>8000 then
    raise exception 'recommendation field too long';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('recommendation-create:'||p_request_id::text,0));
  select * into v_rec from climate_vote.agenda_recommendation where created_request_id=p_request_id;
  if found then
    if v_rec.session_id<>v_session_id or v_rec.agenda_id<>p_agenda_id or v_rec.author_team_id<>p_team_id
       or (v_auth.scope='team' and v_auth.team_id is distinct from v_rec.author_team_id)
       or v_auth.scope not in ('team','hq')
       or not exists(
         select 1 from climate_vote.agenda_recommendation_revision r
          where r.recommendation_id=v_rec.id and r.version=1 and r.title=v_title
            and r.problem_recognition=v_problem and r.recommendation_content=v_content
            and r.expected_effect is not distinct from v_effect
            and (p_topic_id is null or r.topic_id=p_topic_id)
       ) then
      raise exception 'idempotency key reused with different recommendation payload';
    end if;
    select topic_id into v_topic_id from climate_vote.agenda_recommendation_revision
     where recommendation_id=v_rec.id and version=1;
    return jsonb_build_object('id',v_rec.id,'agendaId',v_rec.agenda_id,'teamId',v_rec.author_team_id,'sortOrder',v_rec.sort_order,'topicId',v_topic_id,'status','waiting','replayed',true);
  end if;
  perform pg_advisory_xact_lock(hashtextextended('agenda:'||p_agenda_id::text,0));
  select subgroup into v_agenda_subgroup from climate_vote.agenda_item
   where id=p_agenda_id and session_id=v_session_id;
  select subgroup into v_team_subgroup from climate_vote.team
   where id=p_team_id and session_id=v_session_id and status='active';
  if v_agenda_subgroup is null or v_team_subgroup is null then raise exception 'agenda or team outside selected session'; end if;
  if v_agenda_subgroup<>v_team_subgroup then raise exception 'cross-division recommendation denied'; end if;
  if exists(select 1 from climate_vote.agenda_lifecycle_event where agenda_id=p_agenda_id and action='archive') then
    raise exception 'archived agenda cannot accept recommendations';
  end if;
  if v_auth.scope='team' and v_auth.team_id is distinct from p_team_id then
    raise exception 'team may create only its own recommendation';
  elsif v_auth.scope not in ('team','hq') then
    raise exception 'recommendation create authorization required';
  end if;
  select assigned into v_assigned from climate_vote.agenda_assignment_event
   where session_id=v_session_id and agenda_id=p_agenda_id and team_id=p_team_id
   order by id desc limit 1;
  if not coalesce(v_assigned,false) then raise exception 'agenda is not assigned to authoring team'; end if;

  v_topic_id:=climate_vote.recommendation_topic_id(v_session_id,p_topic_id);

  perform pg_advisory_xact_lock(hashtextextended('recommendation-sort:'||p_agenda_id::text||':'||p_team_id::text,0));
  select coalesce(max(sort_order),0)+1 into v_sort from climate_vote.agenda_recommendation
   where agenda_id=p_agenda_id and author_team_id=p_team_id;
  if v_sort>999 then raise exception 'recommendation capacity exceeded'; end if;
  insert into climate_vote.agenda_recommendation(
    session_id,agenda_id,author_team_id,sort_order,created_scope,created_by,created_request_id
  ) values(v_session_id,p_agenda_id,p_team_id,v_sort,v_auth.scope,v_auth.actor_label,p_request_id)
  returning * into v_rec;
  insert into climate_vote.agenda_recommendation_revision(
    recommendation_id,topic_id,version,title,problem_recognition,recommendation_content,
    expected_effect,actor_scope,actor_team_id,actor_label,request_id
  ) values(
    v_rec.id,v_topic_id,1,v_title,v_problem,v_content,v_effect,v_auth.scope,v_auth.team_id,
    v_auth.actor_label,p_request_id
  );
  return jsonb_build_object('id',v_rec.id,'agendaId',v_rec.agenda_id,'teamId',v_rec.author_team_id,'sortOrder',v_rec.sort_order,'topicId',v_topic_id,'status','waiting','replayed',false);
end
$fn$;

create or replace function climate_vote.recommendation_create_v2(
  p_token text, p_session_slug text, p_agenda_id uuid, p_team_id uuid,
  p_title text, p_problem_recognition text, p_recommendation_content text,
  p_expected_effect text, p_request_id uuid
)
returns jsonb
language sql security definer
set search_path = climate_vote, pg_temp as $fn$
  select climate_vote.recommendation_create_v2(
    p_token,p_session_slug,p_agenda_id,p_team_id,p_title,p_problem_recognition,
    p_recommendation_content,p_expected_effect,p_request_id,null
  );
$fn$;

-- Remove the pre-OCC public entry points when upgrading an already rehearsed
-- s24 database. Keeping either overload would let callers bypass the required
-- expected-version comparison.
drop function if exists climate_vote.recommendation_revise_v2(
  text,text,uuid,text,text,text,text,uuid
);
drop function if exists climate_vote.recommendation_revise_v2(
  text,text,uuid,text,text,text,text,uuid,uuid
);

create or replace function climate_vote.recommendation_revise_v2(
  p_token text, p_session_slug text, p_recommendation_id uuid,
  p_title text, p_problem_recognition text, p_recommendation_content text,
  p_expected_effect text, p_expected_version int, p_request_id uuid,
  p_topic_id uuid
)
returns jsonb
language plpgsql security definer
set search_path = climate_vote, extensions, pg_temp as $fn$
declare
  v_auth climate_vote.attendance_auth_session;
  v_session_id uuid;
  v_rec climate_vote.agenda_recommendation;
  v_title text:=trim(p_title);
  v_problem text:=trim(coalesce(p_problem_recognition,''));
  v_content text:=trim(coalesce(p_recommendation_content,''));
  v_effect text:=nullif(trim(coalesce(p_expected_effect,'')),'');
  v_status text:='waiting';
  v_version int;
  v_current_version int;
  v_topic_id uuid;
  v_prior climate_vote.agenda_recommendation_revision;
begin
  v_auth:=climate_vote.recommendation_scope_row_v2(p_token,p_session_slug);
  v_session_id:=v_auth.session_id;
  if p_request_id is null then raise exception 'idempotency key required'; end if;
  if p_expected_version is null or p_expected_version not between 1 and 9999 then
    raise exception 'expected revision version required';
  end if;
  if length(v_title) not between 1 and 300 then raise exception 'recommendation title required'; end if;
  if length(v_problem)>8000 or length(v_content)>12000 or length(coalesce(v_effect,''))>8000 then raise exception 'recommendation field too long'; end if;
  select * into v_rec from climate_vote.agenda_recommendation
   where id=p_recommendation_id and session_id=v_session_id;
  if not found then raise exception 'recommendation outside selected session'; end if;
  if v_auth.scope='team' and v_auth.team_id is distinct from v_rec.author_team_id then
    raise exception 'team may revise only its own recommendation';
  elsif v_auth.scope not in ('team','hq') then
    raise exception 'recommendation revise authorization required';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('recommendation-revise:'||p_request_id::text,0));
  select * into v_prior from climate_vote.agenda_recommendation_revision where request_id=p_request_id;
  if found then
    if v_prior.recommendation_id<>v_rec.id or v_prior.title<>v_title
       or v_prior.problem_recognition<>v_problem or v_prior.recommendation_content<>v_content
       or v_prior.expected_effect is distinct from v_effect
       or v_prior.version<>p_expected_version+1
       or (p_topic_id is not null and v_prior.topic_id<>p_topic_id) then
      raise exception 'idempotency key reused with different revision payload';
    end if;
    return jsonb_build_object('id',v_rec.id,'revisionId',v_prior.id,'version',v_prior.version,'topicId',v_prior.topic_id,'status','drafting','updatedAt',v_prior.created_at,'replayed',true);
  end if;
  perform pg_advisory_xact_lock(hashtextextended('agenda:'||v_rec.agenda_id::text,0));
  perform pg_advisory_xact_lock(hashtextextended('recommendation:'||v_rec.id::text,0));
  if exists(
    select 1 from climate_vote.agenda_lifecycle_event
     where agenda_id=v_rec.agenda_id and action='archive'
  ) then raise exception 'parent agenda is archived'; end if;
  if exists(select 1 from climate_vote.agenda_recommendation_archive_event where recommendation_id=v_rec.id) then raise exception 'archived recommendation cannot be revised'; end if;
  select max(version) into v_current_version
    from climate_vote.agenda_recommendation_revision
   where recommendation_id=v_rec.id;
  if v_current_version is distinct from p_expected_version then
    raise exception 'stale recommendation revision: expected %, current %',
      p_expected_version,v_current_version;
  end if;
  select status into v_status from climate_vote.agenda_recommendation_progress_event
   where recommendation_id=v_rec.id order by id desc limit 1;
  if not found then v_status:='waiting'; end if;
  if v_status in ('team_confirmed','submitted') then
    raise exception 'confirmed recommendation requires HQ revision request';
  end if;
  if v_status not in ('discussing','drafting') then
    raise exception 'recommendation must be discussing before save';
  end if;
  v_topic_id:=climate_vote.recommendation_topic_id(v_session_id,p_topic_id);
  v_version:=v_current_version+1;
  insert into climate_vote.agenda_recommendation_revision(
    recommendation_id,topic_id,version,title,problem_recognition,recommendation_content,
    expected_effect,actor_scope,actor_team_id,actor_label,request_id
  ) values(
    v_rec.id,v_topic_id,v_version,v_title,v_problem,v_content,v_effect,v_auth.scope,
    v_auth.team_id,v_auth.actor_label,p_request_id
  )
  returning * into v_prior;
  insert into climate_vote.agenda_recommendation_progress_event(
    session_id,recommendation_id,topic_id,action,status,actor_scope,actor_team_id,actor_label,request_id
  ) values(
    v_session_id,v_rec.id,v_topic_id,'save','drafting',v_auth.scope,v_auth.team_id,
    v_auth.actor_label,p_request_id
  );
  return jsonb_build_object('id',v_rec.id,'revisionId',v_prior.id,'version',v_prior.version,'topicId',v_topic_id,'status','drafting','updatedAt',v_prior.created_at,'replayed',false);
end
$fn$;

create or replace function climate_vote.recommendation_revise_v2(
  p_token text, p_session_slug text, p_recommendation_id uuid,
  p_title text, p_problem_recognition text, p_recommendation_content text,
  p_expected_effect text, p_expected_version int, p_request_id uuid
)
returns jsonb
language sql security definer
set search_path = climate_vote, pg_temp as $fn$
  select climate_vote.recommendation_revise_v2(
    p_token,p_session_slug,p_recommendation_id,p_title,p_problem_recognition,
    p_recommendation_content,p_expected_effect,p_expected_version,p_request_id,null
  );
$fn$;

comment on function climate_vote.recommendation_revise_v2(
  text,text,uuid,text,text,text,text,int,uuid,uuid
) is 'Request contract: expected_version is the latest revisionVersion read by the client. Response contract: {id:uuid,revisionId:bigint,version:int,topicId:uuid,status:string,updatedAt:timestamptz,replayed:boolean}.';
comment on function climate_vote.recommendation_revise_v2(
  text,text,uuid,text,text,text,text,int,uuid
) is 'Same OCC response contract as the explicit-topic overload; the server resolves the single open workflow stage.';

create or replace function climate_vote.recommendation_archive_v2(
  p_token text, p_session_slug text, p_recommendation_id uuid, p_reason text,
  p_request_id uuid
)
returns jsonb
language plpgsql security definer
set search_path = climate_vote, extensions, pg_temp as $fn$
declare
  v_auth climate_vote.attendance_auth_session;
  v_session_id uuid;
  v_rec climate_vote.agenda_recommendation;
  v_reason text:=trim(p_reason);
  v_prior climate_vote.agenda_recommendation_archive_event;
begin
  v_auth:=climate_vote.recommendation_scope_row_v2(p_token,p_session_slug);
  v_session_id:=v_auth.session_id;
  if p_request_id is null then raise exception 'idempotency key required'; end if;
  if length(v_reason) not between 2 and 500 then raise exception 'archive reason required'; end if;
  select * into v_rec from climate_vote.agenda_recommendation where id=p_recommendation_id and session_id=v_session_id;
  if not found then raise exception 'recommendation outside selected session'; end if;
  if v_auth.scope='team' and v_auth.team_id is distinct from v_rec.author_team_id then raise exception 'team may archive only its own recommendation';
  elsif v_auth.scope not in ('team','hq') then raise exception 'recommendation archive authorization required'; end if;
  perform pg_advisory_xact_lock(hashtextextended('recommendation-archive:'||p_request_id::text,0));
  select * into v_prior from climate_vote.agenda_recommendation_archive_event where request_id=p_request_id;
  if found then
    if v_prior.recommendation_id<>v_rec.id or v_prior.reason<>v_reason then raise exception 'idempotency key reused with different archive payload'; end if;
    return jsonb_build_object('id',v_prior.id,'recommendationId',v_rec.id,'archivedAt',v_prior.created_at,'replayed',true);
  end if;
  perform pg_advisory_xact_lock(hashtextextended('agenda:'||v_rec.agenda_id::text,0));
  perform pg_advisory_xact_lock(hashtextextended('recommendation:'||v_rec.id::text,0));
  if exists(
    select 1 from climate_vote.agenda_lifecycle_event
     where agenda_id=v_rec.agenda_id and action='archive'
  ) then raise exception 'parent agenda is archived'; end if;
  if exists(select 1 from climate_vote.agenda_recommendation_archive_event where recommendation_id=v_rec.id) then raise exception 'recommendation already archived'; end if;
  insert into climate_vote.agenda_recommendation_archive_event(
    session_id,recommendation_id,reason,actor_scope,actor_team_id,actor_label,request_id
  ) values(v_session_id,v_rec.id,v_reason,v_auth.scope,v_auth.team_id,v_auth.actor_label,p_request_id)
  returning * into v_prior;
  return jsonb_build_object('id',v_prior.id,'recommendationId',v_rec.id,'archivedAt',v_prior.created_at,'replayed',false);
end
$fn$;

create or replace function climate_vote.recommendation_progress_v2(
  p_token text, p_session_slug text, p_recommendation_id uuid,
  p_action text, p_feedback text, p_request_id uuid, p_topic_id uuid
)
returns jsonb
language plpgsql security definer
set search_path = climate_vote, extensions, pg_temp as $fn$
declare
  v_auth climate_vote.attendance_auth_session;
  v_session_id uuid;
  v_rec climate_vote.agenda_recommendation;
  v_current text:='waiting';
  v_next text;
  v_feedback text:=nullif(trim(coalesce(p_feedback,'')),'');
  v_topic_id uuid;
  v_latest climate_vote.agenda_recommendation_revision;
  v_prior climate_vote.agenda_recommendation_progress_event;
begin
  v_auth:=climate_vote.recommendation_scope_row_v2(p_token,p_session_slug);
  v_session_id:=v_auth.session_id;
  if p_request_id is null then raise exception 'idempotency key required'; end if;
  select * into v_rec from climate_vote.agenda_recommendation where id=p_recommendation_id and session_id=v_session_id;
  if not found then raise exception 'recommendation outside selected session'; end if;
  if v_auth.scope='team' and v_auth.team_id is distinct from v_rec.author_team_id then raise exception 'team may progress only its own recommendation';
  elsif v_auth.scope='hq' and p_action not in ('revision_request','reopen') then raise exception 'HQ may only request revision or reopen';
  elsif v_auth.scope='team' and p_action not in ('start','confirm','submit') then raise exception 'team progress action denied';
  elsif v_auth.scope not in ('team','hq') then raise exception 'recommendation progress authorization required'; end if;
  perform pg_advisory_xact_lock(hashtextextended('recommendation-progress:'||p_request_id::text,0));
  select * into v_prior from climate_vote.agenda_recommendation_progress_event where request_id=p_request_id;
  if found then
    if v_prior.recommendation_id<>v_rec.id or v_prior.action<>p_action
       or v_prior.feedback is distinct from v_feedback
       or (p_topic_id is not null and v_prior.topic_id<>p_topic_id) then raise exception 'idempotency key reused with different progress payload'; end if;
    return jsonb_build_object('id',v_prior.id,'recommendationId',v_rec.id,'topicId',v_prior.topic_id,'status',v_prior.status,'updatedAt',v_prior.created_at,'replayed',true);
  end if;
  perform pg_advisory_xact_lock(hashtextextended('agenda:'||v_rec.agenda_id::text,0));
  perform pg_advisory_xact_lock(hashtextextended('recommendation:'||v_rec.id::text,0));
  if exists(
    select 1 from climate_vote.agenda_lifecycle_event
     where agenda_id=v_rec.agenda_id and action='archive'
  ) then raise exception 'parent agenda is archived'; end if;
  if exists(select 1 from climate_vote.agenda_recommendation_archive_event where recommendation_id=v_rec.id) then raise exception 'archived recommendation cannot change status'; end if;
  select * into v_prior from climate_vote.agenda_recommendation_progress_event
   where recommendation_id=v_rec.id order by id desc limit 1;
  if found then v_current:=v_prior.status; end if;
  select * into v_latest from climate_vote.agenda_recommendation_revision
   where recommendation_id=v_rec.id order by version desc limit 1;
  v_topic_id:=climate_vote.recommendation_topic_id(v_session_id,p_topic_id);
  case p_action
    when 'start' then
      if v_current not in ('waiting','discussing') then raise exception 'invalid start transition'; end if;
      v_next:='discussing'; v_feedback:=null;
    when 'confirm' then
      if v_current<>'drafting' then raise exception 'draft required before team confirmation'; end if;
      if length(trim(v_latest.title))=0 or length(trim(v_latest.problem_recognition))=0
         or length(trim(v_latest.recommendation_content))=0 then
        raise exception 'title, problem recognition, and recommendation content are required before confirmation';
      end if;
      v_next:='team_confirmed'; v_feedback:=null;
    when 'submit' then
      if v_current<>'team_confirmed' then raise exception 'team confirmation required before submit'; end if;
      v_next:='submitted'; v_feedback:=null;
    when 'revision_request' then
      if v_current not in ('team_confirmed','submitted') then raise exception 'confirmed recommendation required for revision'; end if;
      if length(coalesce(v_feedback,''))<2 then raise exception 'revision feedback required'; end if;
      v_next:='drafting';
    when 'reopen' then
      if v_current not in ('team_confirmed','submitted') then raise exception 'confirmed recommendation required to reopen'; end if;
      v_next:='drafting'; v_feedback:=null;
    else raise exception 'unknown recommendation progress action';
  end case;
  insert into climate_vote.agenda_recommendation_progress_event(
    session_id,recommendation_id,topic_id,action,status,feedback,actor_scope,actor_team_id,
    actor_label,request_id
  ) values(
    v_session_id,v_rec.id,v_topic_id,p_action,v_next,v_feedback,v_auth.scope,v_auth.team_id,
    v_auth.actor_label,p_request_id
  ) returning * into v_prior;
  return jsonb_build_object('id',v_prior.id,'recommendationId',v_rec.id,'topicId',v_topic_id,'status',v_prior.status,'updatedAt',v_prior.created_at,'replayed',false);
end
$fn$;

create or replace function climate_vote.recommendation_progress_v2(
  p_token text, p_session_slug text, p_recommendation_id uuid,
  p_action text, p_feedback text, p_request_id uuid
)
returns jsonb
language sql security definer
set search_path = climate_vote, pg_temp as $fn$
  select climate_vote.recommendation_progress_v2(
    p_token,p_session_slug,p_recommendation_id,p_action,p_feedback,p_request_id,null
  );
$fn$;

grant execute on function climate_vote.agenda_board_v2(text,text) to anon, authenticated;
grant execute on function climate_vote.agenda_create_v2(text,text,text,text,text,uuid) to anon, authenticated;
grant execute on function climate_vote.agenda_archive_v2(text,text,uuid,text,uuid) to anon, authenticated;
grant execute on function climate_vote.agenda_assignment_set_v2(text,text,uuid,uuid,boolean,uuid) to anon, authenticated;
grant execute on function climate_vote.recommendation_create_v2(text,text,uuid,uuid,text,text,text,text,uuid) to anon, authenticated;
grant execute on function climate_vote.recommendation_create_v2(text,text,uuid,uuid,text,text,text,text,uuid,uuid) to anon, authenticated;
grant execute on function climate_vote.recommendation_revise_v2(text,text,uuid,text,text,text,text,int,uuid) to anon, authenticated;
grant execute on function climate_vote.recommendation_revise_v2(text,text,uuid,text,text,text,text,int,uuid,uuid) to anon, authenticated;
grant execute on function climate_vote.recommendation_archive_v2(text,text,uuid,text,uuid) to anon, authenticated;
grant execute on function climate_vote.recommendation_progress_v2(text,text,uuid,text,text,uuid) to anon, authenticated;
grant execute on function climate_vote.recommendation_progress_v2(text,text,uuid,text,text,uuid,uuid) to anon, authenticated;

revoke execute on function climate_vote.agenda_board_v2(text,text) from public;
revoke execute on function climate_vote.agenda_create_v2(text,text,text,text,text,uuid) from public;
revoke execute on function climate_vote.agenda_archive_v2(text,text,uuid,text,uuid) from public;
revoke execute on function climate_vote.agenda_assignment_set_v2(text,text,uuid,uuid,boolean,uuid) from public;
revoke execute on function climate_vote.recommendation_create_v2(text,text,uuid,uuid,text,text,text,text,uuid) from public;
revoke execute on function climate_vote.recommendation_create_v2(text,text,uuid,uuid,text,text,text,text,uuid,uuid) from public;
revoke execute on function climate_vote.recommendation_revise_v2(text,text,uuid,text,text,text,text,int,uuid) from public;
revoke execute on function climate_vote.recommendation_revise_v2(text,text,uuid,text,text,text,text,int,uuid,uuid) from public;
revoke execute on function climate_vote.recommendation_archive_v2(text,text,uuid,text,uuid) from public;
revoke execute on function climate_vote.recommendation_progress_v2(text,text,uuid,text,text,uuid) from public;
revoke execute on function climate_vote.recommendation_progress_v2(text,text,uuid,text,text,uuid,uuid) from public;

-- These five tables are published for insert-oriented realtime consumers. FULL
-- identity keeps any future UPDATE/DELETE payloads unambiguous even though the
-- current application contract enforces append-only history.
alter table climate_vote.agenda_lifecycle_event replica identity full;
alter table climate_vote.agenda_recommendation replica identity full;
alter table climate_vote.agenda_recommendation_revision replica identity full;
alter table climate_vote.agenda_recommendation_archive_event replica identity full;
alter table climate_vote.agenda_recommendation_progress_event replica identity full;

do $realtime$
begin
  begin
    alter publication supabase_realtime add table climate_vote.agenda_lifecycle_event;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table climate_vote.agenda_recommendation;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table climate_vote.agenda_recommendation_revision;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table climate_vote.agenda_recommendation_archive_event;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table climate_vote.agenda_recommendation_progress_event;
  exception when duplicate_object then null;
  end;
end
$realtime$;

commit;
