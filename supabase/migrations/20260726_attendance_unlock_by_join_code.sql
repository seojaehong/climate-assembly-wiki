-- 조 접속코드만으로 출석부 토큰 발급 (출석 PIN 2단 제거)
--
-- 배경: 모더레이터는 /mod 입장에서 이미 6자리 조 접속코드를 입력한다. 그 뒤 출석부를 열 때
-- 조 출석 PIN을 한 번 더 요구했는데, 운영상 두 값이 같아 2단이 실질 1단이었다.
-- 감사로그의 actor_label도 PIN이 아니라 team 행에서 파생되므로(`'조 모더레이터 · ' || name`)
-- PIN을 제거해도 "누가 했는지"의 해상도는 줄지 않는다 — 원래도 조 단위였다.
--
-- 이 마이그레이션은 **추가만** 한다. team.attendance_pin_hash 컬럼과
-- attendance_team_unlock(PIN 경로), attendance_hq_set_team_pin은 그대로 남긴다.
-- PIN을 다시 켜려면 클라이언트를 PIN 경로로 되돌리기만 하면 되고 DB 롤백은 필요 없다.
--
-- 권한 범위는 바뀌지 않는다. 발급되는 토큰은 기존 PIN 경로와 동일한 scope='team' 토큰이며,
-- 조 밖의 배정에는 여전히 접근할 수 없다(attendance_* 함수의 team 스코프 검사 그대로).
--
-- 실패 카운터에 대하여(정정): 이 경로만 보면 유효 코드가 항상 성공하므로 실패행이 쌓이지
-- 않는다. 그러나 카운터는 scope='team' + subject=<조 코드>로 **PIN 경로와 공유**된다.
-- 기존 attendance_team_unlock이 anon에 grant된 채로 남아 있으면, 누구든 유효한 조 코드에
-- 틀린 PIN으로 5회 호출해 실패행을 심을 수 있고 그러면 이 함수도 15분간 null을 반환한다.
-- 즉 PIN 경로를 열어둔 채로는 DoS가 사라지지 않는다 — 20260726_revoke_pin_unlock.sql에서
-- PIN 경로의 anon/PUBLIC 실행 권한을 회수해 닫는다(함수 자체는 남기므로 되돌리기는 재-grant 한 줄).

create or replace function climate_vote.attendance_team_unlock_by_code(p_join_code text)
returns text
language plpgsql security definer
set search_path = climate_vote, extensions, pg_temp as $$
declare
  v_team climate_vote.team;
  v_failures int;
begin
  if p_join_code !~ '^\d{6,10}$' then
    raise exception 'invalid join code';
  end if;

  -- 존재하지 않는 코드에 대한 무차별 탐색 억제. 유효 코드는 성공하므로 여기 걸리지 않는다.
  select count(*) into v_failures
  from climate_vote.attendance_auth_attempt
  where scope = 'team' and subject = p_join_code and not succeeded
    and attempted_at > now() - interval '15 minutes';
  if v_failures >= 5 then return null; end if;

  select * into v_team from climate_vote.team where join_code = p_join_code and status = 'active';
  if not found then
    insert into climate_vote.attendance_auth_attempt(scope, subject, succeeded)
    values ('team', p_join_code, false);
    return null;
  end if;

  insert into climate_vote.attendance_auth_attempt(scope, subject, succeeded)
  values ('team', p_join_code, true);

  return climate_vote.attendance_issue_token('team', v_team.id, '조 모더레이터 · ' || v_team.name);
end
$$;

grant execute on function climate_vote.attendance_team_unlock_by_code(text) to anon;

-- 20260726_revoke_public_execute_attendance.sql과 동일한 이유로 PUBLIC 기본 부여를 회수한다.
-- (이 함수는 anon이 직접 호출해야 하므로 위에서 명시적으로 grant했다. 아래는 중복 방지가 아니라
--  향후 이 파일을 참고해 만들 내부 함수가 같은 함정을 밟지 않도록 남기는 패턴 표시다.)
revoke execute on function climate_vote.attendance_team_unlock_by_code(text) from public;
grant execute on function climate_vote.attendance_team_unlock_by_code(text) to anon;

-- 검증
-- 1) 유효 코드: 토큰 문자열 반환
-- select climate_vote.attendance_team_unlock_by_code('082901') is not null;
-- 2) 없는 코드: null 반환 + 실패 1행
-- select climate_vote.attendance_team_unlock_by_code('999999') is null;
-- 3) 형식 위반: 예외
-- select climate_vote.attendance_team_unlock_by_code('abc');
