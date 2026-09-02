-- rollback for supabase/migrations/20260901_s17_topic_deadline.sql
--
-- 되돌리는 것: topic_set_deadline 제거 · topic_list 를 s1 의 6컬럼 형태로 복원 ·
--             discussion_topic.deadline_at 컬럼 제거.
--
-- ⚠️ deadline_at 을 drop 하면 본부가 걸어 둔 마감 시각이 **전부 사라진다.**
--    행사 중이라면 drop 전에 export 할 것:
--      select id, ordinal, prompt, deadline_at from climate_vote.discussion_topic
--       where deadline_at is not null order by ordinal;
--
-- ★★ 이 파일의 최대 위험도 정방향과 같다 — topic_list 를 drop 한 뒤 **grant 재부여**.
--    아래 마지막 절을 빠뜨리면 롤백이 조 화면을 전면 장애로 만든다.

drop function if exists climate_vote.topic_set_deadline(text, uuid, timestamptz);

-- topic_list 복원 — 20260808_s1_assembly_topic_submission.sql:151-162 그대로.
drop function if exists climate_vote.topic_list(text);

create function climate_vote.topic_list(p_code text)
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

alter table climate_vote.discussion_topic drop column if exists deadline_at;

-- ★ grant 재부여 — s1:306-326 과 같은 처리. 빠뜨리면 조 화면이 죽는다.
revoke execute on function climate_vote.topic_list(text) from public;
grant execute on function climate_vote.topic_list(text) to anon, authenticated;
