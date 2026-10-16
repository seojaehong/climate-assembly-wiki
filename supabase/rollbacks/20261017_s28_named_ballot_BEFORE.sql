-- s28 되돌리기: 실명 투표에서 더한 것만 걷어낸다(기존 ballot_submit·ballot_get 등은 s28 이 바꾸지 않았다).
-- ★ ballot_response 의 voter_* 칸을 지우면 실명 기록이 사라진다. 지우기 전에 반드시 내보낼 것:
--   select b.title, br.voter_team, br.voter_name, br.answers, br.submitted_at
--     from climate_vote.ballot_response br join climate_vote.ballot b on b.id=br.ballot_id
--    where br.voter_name is not null order by b.created_at, br.submitted_at;
-- 화면을 먼저 이전 배포로 돌린 뒤 적용한다(새 화면이 PGRST202 로 실명 제출을 못 하게 되므로).

drop function if exists climate_vote.ballot_voter_correct_v2(text,uuid,uuid,text,text);
drop function if exists climate_vote.ballot_named_responses_v2(text,uuid);
drop function if exists climate_vote.ballot_submit_named(text,text,jsonb,text,text);
drop function if exists climate_vote.ballot_roster_get(text);

drop index if exists climate_vote.ballot_response_voter_name_idx;
alter table climate_vote.ballot_response
  drop column if exists voter_in_roster,
  drop column if exists voter_name_norm,
  drop column if exists voter_name,
  drop column if exists voter_team;

drop table if exists climate_vote.ballot_roster;
drop function if exists climate_vote.voter_name_norm(text);
