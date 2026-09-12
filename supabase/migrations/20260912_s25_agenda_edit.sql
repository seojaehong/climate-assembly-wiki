-- Append-only audit trail and HQ-only editing for dynamic agenda topics.
begin;

create table if not exists climate_vote.agenda_edit_event (
  id bigint generated always as identity primary key,
  session_id uuid not null references climate_vote.session(id),
  agenda_id uuid not null references climate_vote.agenda_item(id),
  previous_title text not null,
  previous_source_utterance text not null,
  next_title text not null,
  next_source_utterance text not null,
  actor_scope text not null check (actor_scope='hq'),
  actor_label text not null check (length(trim(actor_label)) between 1 and 80),
  request_id uuid not null unique,
  created_at timestamptz not null default now(),
  check (length(trim(previous_title)) between 1 and 300),
  check (length(trim(next_title)) between 1 and 300),
  check (length(trim(previous_source_utterance)) between 1 and 2000),
  check (length(trim(next_source_utterance)) between 1 and 2000)
);

create index if not exists agenda_edit_event_latest_idx
  on climate_vote.agenda_edit_event(session_id, agenda_id, id desc);

create or replace function climate_vote.agenda_update_v2(
  p_token text, p_session_slug text, p_agenda_id uuid, p_title text,
  p_source_utterance text, p_request_id uuid
)
returns jsonb
language plpgsql security definer
set search_path = climate_vote, extensions, pg_temp as $fn$
declare
  v_auth climate_vote.attendance_auth_session;
  v_session_id uuid;
  v_title text := trim(coalesce(p_title,''));
  v_source_utterance text := trim(coalesce(p_source_utterance,''));
  v_agenda climate_vote.agenda_item;
  v_source text;
  v_prior climate_vote.agenda_edit_event;
begin
  v_auth:=climate_vote.recommendation_scope_row_v2(p_token,p_session_slug);
  v_session_id:=v_auth.session_id;
  if v_auth.scope<>'hq' then raise exception 'HQ authorization required'; end if;
  if p_request_id is null then raise exception 'idempotency key required'; end if;
  if length(v_title) not between 1 and 300 then raise exception 'agenda title required'; end if;
  if length(v_source_utterance) not between 1 and 2000 then raise exception 'source utterance required'; end if;
  perform pg_advisory_xact_lock(hashtextextended('agenda-update:'||p_request_id::text,0));
  select * into v_prior from climate_vote.agenda_edit_event where request_id=p_request_id;
  if found then
    if v_prior.session_id<>v_session_id or v_prior.agenda_id<>p_agenda_id
       or v_prior.next_title<>v_title or v_prior.next_source_utterance<>v_source_utterance then
      raise exception 'idempotency key reused with different agenda update payload';
    end if;
    return jsonb_build_object('id',v_prior.id,'agendaId',p_agenda_id,'updatedAt',v_prior.created_at,'replayed',true);
  end if;
  perform pg_advisory_xact_lock(hashtextextended('agenda:'||p_agenda_id::text,0));
  select * into v_agenda from climate_vote.agenda_item where id=p_agenda_id and session_id=v_session_id;
  if not found then raise exception 'agenda outside selected session'; end if;
  if exists(select 1 from climate_vote.agenda_lifecycle_event where agenda_id=p_agenda_id and action='archive') then
    raise exception 'archived agenda cannot be edited';
  end if;
  select su.content into v_source
    from climate_vote.agenda_source_utterance su
   where su.agenda_id=p_agenda_id and su.ordinal=1;
  if v_source is null then raise exception 'agenda source utterance missing'; end if;
  insert into climate_vote.agenda_edit_event(
    session_id,agenda_id,previous_title,previous_source_utterance,
    next_title,next_source_utterance,actor_scope,actor_label,request_id
  ) values(
    v_session_id,p_agenda_id,v_agenda.title,v_source,
    v_title,v_source_utterance,'hq',v_auth.actor_label,p_request_id
  ) returning * into v_prior;
  update climate_vote.agenda_item set title=v_title where id=p_agenda_id;
  update climate_vote.agenda_source_utterance
     set content=v_source_utterance
   where agenda_id=p_agenda_id and ordinal=1;
  return jsonb_build_object(
    'id',v_prior.id,'agendaId',p_agenda_id,'title',v_title,
    'sourceUtterance',v_source_utterance,'updatedAt',v_prior.created_at,'replayed',false
  );
end
$fn$;

grant execute on function climate_vote.agenda_update_v2(text,text,uuid,text,text,uuid) to anon, authenticated;
revoke execute on function climate_vote.agenda_update_v2(text,text,uuid,text,text,uuid) from public;

commit;
