-- rollback for 20260808_s2_ballot_multi_agenda.sql
-- ⚠️ ballot_response 데이터가 이미 쌓였다면 drop 전에 export 할 것.

drop function if exists climate_vote.ballot_results(text, text);
drop function if exists climate_vote.ballot_submit(text, text, jsonb);
drop function if exists climate_vote.ballot_get(text);
drop function if exists climate_vote.ballot_list(text);
drop function if exists climate_vote.ballot_set_status(text, uuid, text);
drop function if exists climate_vote.ballot_create(text, text, text, jsonb);

drop table if exists climate_vote.ballot_response;
drop table if exists climate_vote.ballot_item;
drop table if exists climate_vote.ballot;
