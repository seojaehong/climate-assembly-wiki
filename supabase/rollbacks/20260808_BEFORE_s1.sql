-- rollback for 20260808_s1_assembly_topic_submission.sql
-- 신설 객체 전부 제거 + session 추가 컬럼 제거. 기존 데이터에는 영향 없음.
-- ⚠️ submission 데이터가 이미 쌓였다면 drop 전에 export 할 것.

drop function if exists climate_vote.readiness_check(uuid);
drop function if exists climate_vote.submission_reopen(text, uuid, text);
drop function if exists climate_vote.submission_finalize(text, uuid);
drop function if exists climate_vote.submission_save(text, uuid, jsonb);
drop function if exists climate_vote.submission_get(text, uuid);
drop function if exists climate_vote.topic_list(text);

drop trigger if exists submission_lock_guard on climate_vote.submission;
drop trigger if exists submission_item_lock_guard on climate_vote.submission_item;
drop function if exists climate_vote.submission_lock_guard();
drop function if exists climate_vote.submission_item_lock_guard();

drop table if exists climate_vote.submission_lock_event;
drop table if exists climate_vote.submission_item;
drop table if exists climate_vote.submission;
drop table if exists climate_vote.discussion_topic;

alter table climate_vote.session drop column if exists held_on;
alter table climate_vote.session drop column if exists ordinal;
alter table climate_vote.session drop column if exists assembly_id;

drop table if exists climate_vote.assembly;
