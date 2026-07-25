-- 출석 내부 함수의 PUBLIC 기본 EXECUTE 회수
--
-- 배경: PostgreSQL은 함수 생성 시 EXECUTE를 PUBLIC에 기본 부여한다.
-- 20260725_attendance_roster_hq.sql:538은 `from anon, authenticated`만 회수했는데,
-- PUBLIC 경유 권한은 명명된 롤에서 회수해도 제거되지 않는다. 그 결과
-- attendance_issue_token이 anon에게 여전히 호출 가능한 상태로 남았다.
--
-- 영향: 토큰 발급 함수가 인증 게이트 밖에 노출되어, 출석 스코프 인증(HQ 공유 비밀번호·
-- 조 PIN·15분 5회 제한)을 우회한 상태로 출석 관련 RPC에 도달할 수 있었다.
-- 실명 명부 조회와 명부 쓰기가 모두 이 게이트 뒤에 있으므로 개인정보·무결성 양쪽에 영향한다.
--
-- 범위 한정: 아래 3개는 다른 SECURITY DEFINER 함수 내부에서만 호출되는 내부 함수이며,
-- 클라이언트가 직접 호출해야 하는 함수(attendance_* 11종, mod_* 5종, hq_teams,
-- mod_log_timer)는 각 마이그레이션에서 anon에 **명시적으로** grant되어 있으므로
-- 이 회수의 영향을 받지 않는다. definer 함수 내부 호출은 소유자 권한으로 실행되어
-- 호출자 EXECUTE 권한을 요구하지 않는다.

revoke execute on function climate_vote.attendance_token_row(text),
  climate_vote.attendance_issue_token(text,uuid,text),
  climate_vote.capture_round_attendance()
from public;

-- 검증: 아래 두 쿼리는 각각 0행이어야 한다.
--
-- 1) PUBLIC/anon/authenticated에 남은 EXECUTE가 없는지
-- select p.proname, a.grantee
-- from pg_proc p
-- join pg_namespace n on n.oid = p.pronamespace
-- cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
-- where n.nspname = 'climate_vote'
--   and p.proname in ('attendance_token_row','attendance_issue_token','capture_round_attendance')
--   and a.privilege_type = 'EXECUTE'
--   and (a.grantee = 0 or a.grantee::regrole::text in ('anon','authenticated'));
--
-- 2) 반대로 클라이언트가 쓰는 함수의 anon EXECUTE는 살아 있는지 (11 + 5 + 1 + 1 = 18행이어야 함)
-- select p.proname
-- from pg_proc p
-- join pg_namespace n on n.oid = p.pronamespace
-- cross join lateral aclexplode(p.proacl) a
-- where n.nspname = 'climate_vote' and a.privilege_type = 'EXECUTE'
--   and a.grantee::regrole::text = 'anon'
-- order by 1;
