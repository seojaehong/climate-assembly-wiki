-- authenticated 롤에도 EXECUTE를 부여한다 (2026-07-26 라이브 장애 수정)
--
-- 증상: 배포 직후 /hq가 백지 + "조 현황을 갱신하지 못했습니다". 서버·설정·CORS·anon 키는
-- 전부 정상이었고, 같은 브라우저에서 anon 키로 부르면 200, 세션 토큰으로 부르면
-- 403 `42501 permission denied for function hq_teams`가 났다.
--
-- 원인: supabase-js는 localStorage에 세션(sb-<ref>-auth-token)이 있으면 anon 키 대신
-- 그 JWT를 Bearer로 보낸다. 그러면 PostgREST가 `authenticated` 롤로 실행한다.
-- 20260726_team_table_no.sql / 20260726_attendance_unlock_by_join_code.sql이
-- `revoke execute from public` 뒤에 `grant execute to anon`만 했기 때문에,
-- 그때까지 PUBLIC 기본 부여에 얹혀 있던 `authenticated`가 권한을 잃었다.
--
-- 왜 grant가 안전한가: 이 함수들은 이미 `anon`(= 로그인하지 않은 전원)에게 열려 있다.
-- `authenticated`는 그 부분집합이므로 노출이 조금도 넓어지지 않는다.
-- PUBLIC 회수는 그대로 유지한다 — postgres 등 다른 내부 롤까지 여는 것이 회수의 목적이었다.
--
-- 8/29 영향: hq_teams는 /hq 백지, attendance_team_unlock_by_code는 모더레이터가
-- 조 접속코드로 출석부를 못 여는 증상으로 나타난다(현장에서 원인 추적 사실상 불가).

grant execute on function climate_vote.hq_teams() to authenticated;
grant execute on function climate_vote.attendance_team_unlock_by_code(text) to authenticated;
grant execute on function climate_vote.attendance_hq_set_table_no(text,uuid,text) to authenticated;

-- 검증 1) 브라우저에서 세션 토큰으로 hq_teams가 200이 되는지 (403 → 200)
-- 검증 2) 같은 함정이 남아 있는 함수 전수 조사 —
--         anon에는 있고 authenticated에는 없는 climate_vote 함수를 찾는다.
--
-- select p.proname, pg_get_function_identity_arguments(p.oid) as args
-- from pg_proc p join pg_namespace n on n.oid = p.pronamespace
-- where n.nspname = 'climate_vote'
--   and has_function_privilege('anon', p.oid, 'EXECUTE')
--   and not has_function_privilege('authenticated', p.oid, 'EXECUTE')
-- order by 1;
--
-- 위 쿼리가 0행이면 같은 원인의 지뢰가 더 없다는 뜻이다.
