-- rollback for 20260808_s4_ballot_subgroup.sql
-- S2 원판(4인자 ballot_create, subgroup 없는 ballot_list/get/results)으로 되돌린다.
-- 실행 방법: 이 파일 실행 후, 20260808_s2_ballot_multi_agenda.sql의
--            "-- ── 2. 운영 RPC" 섹션부터 끝까지를 다시 실행하면 S2 상태 복원.

drop function if exists climate_vote.ballot_create(text, text, text, jsonb, text);
drop function if exists climate_vote.ballot_list(text);
-- ballot_get / ballot_results 는 S2 재실행으로 원판 덮어쓰기

alter table climate_vote.ballot drop column if exists subgroup;
