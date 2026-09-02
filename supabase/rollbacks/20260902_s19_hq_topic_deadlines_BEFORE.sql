-- rollback for supabase/migrations/20260902_s19_hq_topic_deadlines.sql
--
-- 되돌리는 것: hq_topic_deadlines 제거. 그것뿐이다.
--
-- s19 는 순수 additive 라 되돌릴 것이 함수 하나뿐이다 — 표도 컬럼도 기존 함수의 권한도
-- 건드리지 않았다. 그래서 s17 처럼 「drop 뒤 grant 재부여」를 챙길 대상이 없다.
--
-- ⚠️ **마감 시각 데이터는 이 롤백으로 사라지지 않는다.** deadline_at 컬럼은 s17 의 것이고
--    여기서는 읽는 함수만 지운다. 조 화면 배너(topic_list)도 그대로 돈다.
--
-- 이걸 되돌리면 본부 /hq 화면은 **s19 이전 동작으로 조용히 퇴화한다** —
-- 서버의 현재 마감을 「모름」으로 표시하고 「이 화면이 방금 건 값」만 되비춘다.
-- 마감 걸기·지우기(topic_set_deadline)는 계속 동작한다.

drop function if exists climate_vote.hq_topic_deadlines(text, text);
