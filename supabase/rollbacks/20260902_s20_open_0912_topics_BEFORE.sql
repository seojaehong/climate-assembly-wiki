-- rollback for supabase/migrations/20260902_s20_open_0912_topics.sql
--
-- 되돌리는 것: 세션 `0912-deliberation` 의 `discussion_topic` 6행(ordinal 1~6) 삭제.
--
-- 스키마는 건드리지 않는다 — s20 은 표·함수·권한을 하나도 만들지 않았다(순수 데이터).
-- 8.29 도 건드리지 않는다. `0829-deliberation` 이라는 문자열이 이 파일에 없다.
--
-- ⚠️ **조가 이미 쓴 뒤라면 이 파일은 일부러 실패한다.**
--    `submission.topic_id` 가 `discussion_topic(id)` 를 참조하는 외래키다(s1:59).
--    조가 한 줄이라도 저장한 꼭지는 참조가 걸려 delete 가 23503 으로 거부된다.
--    **그것이 보호장치다.** 억지로 지우지 말 것 — 지우려면 조 산출물부터 지워야 하고,
--    그것은 `supabase/migrations/AGENTS.md` 「조 산출물을 건드릴 때 — 금지선」이
--    금지하는 일이다(원문 표를 고치거나 지우는 구문을 쓰지 않는다).
--
--    되돌리는 목적이 「조에게 안 보이게」 하는 것이라면 삭제가 아니라 **status 를 되돌린다**:
--      update climate_vote.discussion_topic dt set status = 'draft'
--        from climate_vote.session s
--       where s.id = dt.session_id and s.slug = '0912-deliberation';
--    문안만 되돌리는 것이라면 s20 을 고쳐 다시 적용한다(멱등이라 덮어쓴다).
--
-- ⚠️ 지우기 전에 무엇이 지워지는지 먼저 볼 것:
--      select dt.ordinal, dt.status, dt.prompt,
--             (select count(*) from climate_vote.submission sb where sb.topic_id = dt.id) as 제출물
--        from climate_vote.discussion_topic dt
--        join climate_vote.session s on s.id = dt.session_id
--       where s.slug = '0912-deliberation'
--       order by dt.ordinal;
--    제출물 칸이 전부 0 일 때만 아래를 돌린다.

delete from climate_vote.discussion_topic dt
 using climate_vote.session s
 where s.id = dt.session_id
   and s.slug = '0912-deliberation'
   and dt.ordinal between 1 and 6;

-- 확인 — 0912 는 0행, 세션·조 15개와 8.29 는 그대로여야 한다.
select s.slug, count(dt.id) as topics
from climate_vote.session s
left join climate_vote.discussion_topic dt on dt.session_id = s.id
group by s.slug
order by s.slug;
