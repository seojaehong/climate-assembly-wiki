-- s8: 본부 재오픈 + 저장·제출 이력 보존
--
-- 세 가지를 한다.
--   ① 저장할 때 지워지는 항목을 그대로 남긴다 (지금은 사라진다)
--   ② 본부 화면이 재오픈을 부를 수 있게 submission_id·finalized_at을 넘긴다
--   ③ 본부가 조별 저장·제출·재오픈 이력을 읽는 함수를 둔다
--
-- ── ① 왜 이력이 필요한가 ────────────────────────────────────────────
-- submission_save는 항목을 통째로 갈아끼운다(delete 후 insert). 조가 한 줄 고칠
-- 때마다 직전 판이 흔적 없이 사라진다. 회의자료 260811은 기록 모더레이터에게
-- 「원 발언과 결과물 추적 가능하게 기록」을 요구하고 「임의 변경, 소수의견 삭제」를
-- 금지한다. 지워진 문장을 되살릴 수 없으면 그 요구를 지킬 수 없다.
--
-- 이력 표는 append-only다. 트리거가 지워지는 행을 그대로 복사할 뿐,
-- 아무도 지우지 않는다. RPC도 읽기만 제공한다.

create table if not exists climate_vote.submission_item_archive (
  id bigint generated always as identity primary key,
  submission_id uuid not null references climate_vote.submission(id),
  ordinal int not null,
  kind text,
  content text not null,
  rationale text,
  -- 원래 행이 언제 만들어졌는지. 몇 번째 저장이었는지를 되짚는 실마리다.
  created_at timestamptz,
  archived_at timestamptz not null default now()
);

create index if not exists submission_item_archive_sub_idx
  on climate_vote.submission_item_archive(submission_id, archived_at);

alter table climate_vote.submission_item_archive enable row level security;
-- 직접 접근은 막는다. 읽기는 아래 hq_submission_history RPC로만.
revoke all on climate_vote.submission_item_archive from anon, authenticated;

create or replace function climate_vote.submission_item_archive_trigger()
returns trigger language plpgsql security definer
set search_path = climate_vote, pg_temp as $arch$
begin
  -- 내용이 빈 행은 남길 것이 없다.
  if length(trim(coalesce(old.content, ''))) > 0 then
    insert into climate_vote.submission_item_archive
      (submission_id, ordinal, kind, content, rationale, created_at)
    values (old.submission_id, old.ordinal, old.kind, old.content, old.rationale, old.created_at);
  end if;
  return old;
end $arch$;

-- AFTER DELETE — 실제로 지워진 행만 남긴다.
-- (BEFORE에 걸면 잠금 가드가 막은 삭제까지 이력에 들어간다.)
drop trigger if exists submission_item_archive_trigger on climate_vote.submission_item;
create trigger submission_item_archive_trigger
  after delete on climate_vote.submission_item
  for each row execute function climate_vote.submission_item_archive_trigger();

-- ── ② hq_submissions에 submission_id·finalized_at 추가 ──────────────
-- 반환 타입이 바뀌므로 drop 후 재생성한다(create or replace로는 컬럼 추가가 안 된다).

drop function if exists climate_vote.hq_submissions(text, text);

create or replace function climate_vote.hq_submissions(
  p_token text, p_session_slug text default '0829-deliberation')
returns table(
  topic_id uuid, topic_ordinal int, topic_prompt text, topic_status text,
  team_id uuid, team_name text, team_subgroup text, table_no text,
  submission_id uuid, submission_status text, submission_updated_at timestamptz,
  submission_finalized_at timestamptz,
  item_ordinal int, item_kind text, item_content text, item_rationale text)
language plpgsql security definer
set search_path = climate_vote, extensions, pg_temp as $fn$
declare
  v_auth climate_vote.attendance_auth_session;
begin
  v_auth := climate_vote.attendance_token_row(p_token);
  if v_auth.scope <> 'hq' then raise exception 'HQ authorization required'; end if;

  return query
  select dt.id, dt.ordinal, dt.prompt, dt.status,
         t.id, t.name, t.subgroup, t.table_no,
         s.id, s.status, s.updated_at, s.finalized_at,
         si.ordinal, si.kind, si.content, si.rationale
  from climate_vote.discussion_topic dt
  join climate_vote.session ses on ses.id = dt.session_id and ses.slug = p_session_slug
  join climate_vote.team t on t.session_id = ses.id and t.status = 'active'
  left join climate_vote.submission s
         on s.topic_id = dt.id and s.team_id = t.id and s.archived_at is null
  left join climate_vote.submission_item si on si.submission_id = s.id
  where dt.status in ('open', 'closed')
  order by dt.ordinal, t.name, si.ordinal nulls first;
end $fn$;

grant execute on function climate_vote.hq_submissions(text, text) to anon, authenticated;
revoke execute on function climate_vote.hq_submissions(text, text) from public;

-- ── ③ 조별 이력 읽기 ────────────────────────────────────────────────
-- 최종 제출·재오픈(submission_lock_event)과 지워진 항목(archive)을 한 목록으로 낸다.
-- 읽기 전용이며 본부 토큰만 통과한다.

create or replace function climate_vote.hq_submission_history(
  p_token text, p_session_slug text default '0829-deliberation')
returns table(
  team_name text, topic_ordinal int, topic_prompt text,
  event_at timestamptz, kind text, actor_label text, detail text)
language plpgsql security definer
set search_path = climate_vote, extensions, pg_temp as $hist$
declare
  v_auth climate_vote.attendance_auth_session;
begin
  v_auth := climate_vote.attendance_token_row(p_token);
  if v_auth.scope <> 'hq' then raise exception 'HQ authorization required'; end if;

  return query
  select t.name, dt.ordinal, dt.prompt,
         e.created_at, e.action, e.actor_label, e.reason
  from climate_vote.submission_lock_event e
  join climate_vote.submission s on s.id = e.submission_id
  join climate_vote.discussion_topic dt on dt.id = s.topic_id
  join climate_vote.session ses on ses.id = dt.session_id and ses.slug = p_session_slug
  join climate_vote.team t on t.id = s.team_id
  union all
  select t.name, dt.ordinal, dt.prompt,
         a.archived_at, 'replaced', '조 저장으로 교체됨', a.content
  from climate_vote.submission_item_archive a
  join climate_vote.submission s on s.id = a.submission_id
  join climate_vote.discussion_topic dt on dt.id = s.topic_id
  join climate_vote.session ses on ses.id = dt.session_id and ses.slug = p_session_slug
  join climate_vote.team t on t.id = s.team_id
  order by 4 desc;
end $hist$;

grant execute on function climate_vote.hq_submission_history(text, text) to anon, authenticated;
revoke execute on function climate_vote.hq_submission_history(text, text) from public;
