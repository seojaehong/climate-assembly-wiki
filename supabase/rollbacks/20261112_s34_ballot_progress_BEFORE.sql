-- s34 되돌리기 — s34 는 새 표 1개와 새 함수 2개만 만든다(기존 함수·표·권한 무변경). 없애면 s34 이전 상태다.
-- ★ 표를 지우면 진행 기록(누른 문항 번호)도 사라진다. 찬반 값은 원래 이 표에 없다 — 제출 응답(ballot_response)은 그대로다.
drop function if exists climate_vote.ballot_progress_board(text,uuid);
drop function if exists climate_vote.ballot_progress_named(text,text,text,text,int);
drop table if exists climate_vote.ballot_progress;
