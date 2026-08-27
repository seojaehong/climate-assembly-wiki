-- s7: 본부(HQ) 조별 산출물 실시간 취합
--
-- 배경 — 조 산출물을 읽는 경로는 submission_get(p_code, p_topic_id) 하나뿐이고 조 코드를
-- 요구한다. 본부가 15개 조를 한 화면에 모아 보려면 코드 15개를 들고 45번 호출해야 한다.
-- 본부 토큰 하나로 세션 전체를 한 번에 읽는 함수를 둔다.
--
-- 권한 — attendance_hq_unlock이 발급한 scope='hq' 토큰만 통과한다(attendance_hq_audit과
-- 같은 방식). 조 토큰으로는 남의 조를 볼 수 없다.
--
-- 읽기 전용이다. 본부가 산출물을 고치는 경로는 기존 submission_reopen(재오픈)뿐이며
-- 이 함수는 아무것도 쓰지 않는다.

create or replace function climate_vote.hq_submissions(
  p_token text, p_session_slug text default '0829-deliberation')
returns table(
  topic_id uuid, topic_ordinal int, topic_prompt text, topic_status text,
  team_id uuid, team_name text, team_subgroup text, table_no text,
  submission_status text, submission_updated_at timestamptz,
  item_ordinal int, item_kind text, item_content text, item_rationale text)
language plpgsql security definer
set search_path = climate_vote, extensions, pg_temp as $$
declare
  v_auth climate_vote.attendance_auth_session;
begin
  v_auth := climate_vote.attendance_token_row(p_token);
  if v_auth.scope <> 'hq' then
    raise exception 'HQ authorization required';
  end if;

  return query
  select dt.id, dt.ordinal, dt.prompt, dt.status,
         t.id, t.name, t.subgroup, t.table_no,
         s.status, s.updated_at,
         si.ordinal, si.kind, si.content, si.rationale
  from climate_vote.discussion_topic dt
  join climate_vote.session ses on ses.id = dt.session_id and ses.slug = p_session_slug
  -- 아직 아무것도 안 쓴 조도 빈 자리로 보여야 한다(누가 안 냈는지가 본부의 관심사다)
  -- → team을 dt에 cross join하고 submission/item은 좌결합한다.
  join climate_vote.team t on t.session_id = ses.id and t.status = 'active'
  left join climate_vote.submission s
         on s.topic_id = dt.id and s.team_id = t.id and s.archived_at is null
  left join climate_vote.submission_item si on si.submission_id = s.id
  where dt.status in ('open', 'closed')
  order by dt.ordinal, t.name, si.ordinal nulls first;
end $$;

grant execute on function climate_vote.hq_submissions(text, text) to anon, authenticated;

-- PUBLIC 회수 — 이 리포의 다른 attendance_*/mod_* 함수와 같은 처리다.
-- (PUBLIC을 남겨두면 anon만 revoke해도 닫히지 않는다.)
revoke execute on function climate_vote.hq_submissions(text, text) from public;

-- Realtime — 조가 저장하는 즉시 본부 화면이 갱신되도록 항목 표를 발행에 올린다.
-- 이미 올라가 있으면 no-op으로 넘긴다.
do $$ begin
  alter publication supabase_realtime add table climate_vote.submission_item;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table climate_vote.submission;
exception when duplicate_object then null; end $$;
alter table climate_vote.submission_item replica identity full;
alter table climate_vote.submission replica identity full;
