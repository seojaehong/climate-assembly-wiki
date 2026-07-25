-- 출석 PIN 경로의 실행 권한 회수 (자격증명 단일화 마무리)
--
-- 20260726_attendance_unlock_by_join_code.sql로 조 코드 단일화를 하면서 PIN 경로를
-- "되돌릴 수 있게" 남겼는데, 실행 권한까지 열어둔 것은 실수였다.
--
-- attendance_team_unlock과 attendance_team_unlock_by_code는 인증 실패 카운터를
-- scope='team' + subject=<조 코드>로 **공유**한다. PIN 경로가 anon에 열려 있으면
-- 누구든 유효한 조 코드에 틀린 PIN으로 5회 호출해 실패행을 심을 수 있고, 그러면
-- 코드 경로까지 15분간 null을 반환한다 — 조 모더레이터가 현장에서 출석부를 못 연다.
-- 조 코드는 규칙(MMDD+순번)으로 추측 가능하므로 사전지식 없이도 가능하다.
--
-- 함수는 지우지 않는다. PIN으로 되돌리려면 아래 grant 한 줄이면 된다:
--   grant execute on function climate_vote.attendance_team_unlock(text,text) to anon;

revoke execute on function climate_vote.attendance_team_unlock(text,text) from anon, public;

-- 검증: anon 키로 호출 시 42501(permission denied)이어야 한다.
-- 코드 경로(attendance_team_unlock_by_code)는 영향 없이 계속 동작해야 한다.
