-- s11: 본부 운영자 비밀번호 변경
--
-- 배경 — 5인의 비밀번호를 운영자가 임시로 같은 값으로 심어 두었다. 같은 값을 쓰는 동안은
-- s10이 만든 「이름이 증명된다」는 성질이 성립하지 않는다(누구든 남의 이름으로 들어간다).
-- 각자 자기 화면에서 바꿀 수 있어야 하고, 아직 안 바꾼 사람이 눈에 보여야 한다.
--
-- ── 왜 토큰만으로는 부족한가 ─────────────────────────────────────────
-- 토큰은 로그인했다는 증거이지 지금 그 사람이 앞에 있다는 증거가 아니다. 본부 노트북은
-- 행사장에서 열어둔 채 자리를 비우기 쉽다. 그래서 **현재 비밀번호를 다시 묻는다.**
--
-- 비밀번호는 이 파일에 없다. 해시만 저장하며(crypt/bf) 조회 함수도 두지 않는다.

alter table climate_vote.hq_operator
  add column if not exists must_change_password boolean not null default false;

/**
 * 자기 비밀번호 변경. 본부 토큰 + 현재 비밀번호를 둘 다 요구한다.
 *
 * 남의 비밀번호는 바꿀 수 없다 — 대상은 토큰에 실린 이름(actor_label)으로 고정이고
 * 인자로 받지 않는다.
 */
create or replace function climate_vote.hq_change_password(
  p_token text, p_current_password text, p_new_password text)
returns jsonb
language plpgsql security definer
set search_path = climate_vote, extensions, pg_temp as $chg$
declare
  v_auth climate_vote.attendance_auth_session;
  v_name text;
  v_hash text;
  v_failures int;
begin
  v_auth := climate_vote.attendance_token_row(p_token);
  if v_auth.scope <> 'hq' then
    raise exception 'HQ authorization required';
  end if;
  v_name := trim(v_auth.actor_label);

  if not exists (select 1 from climate_vote.hq_operator o where o.name = v_name and o.active) then
    -- 공유 비밀번호로 들어온 사람은 바꿀 개인 비밀번호가 없다.
    raise exception '등록된 운영자만 비밀번호를 바꿀 수 있습니다';
  end if;

  -- 현재 비밀번호 오입력도 잠금 대상으로 센다(사람별).
  select count(*) into v_failures
  from climate_vote.attendance_auth_attempt
  where scope = 'hq' and subject = v_name and not succeeded
    and attempted_at > now() - interval '15 minutes';
  if v_failures >= 5 then
    raise exception '시도가 많아 잠겼습니다. 15분 뒤에 다시 해 주세요';
  end if;

  select secret_hash into v_hash
  from climate_vote.attendance_secret where secret_key = 'hq:' || v_name;
  if v_hash is null or crypt(p_current_password, v_hash) <> v_hash then
    insert into climate_vote.attendance_auth_attempt(scope, subject, succeeded)
    values ('hq', v_name, false);
    raise exception '현재 비밀번호가 맞지 않습니다';
  end if;

  if length(coalesce(p_new_password, '')) < 8 then
    raise exception '새 비밀번호는 8자 이상이어야 합니다';
  end if;
  if p_new_password = p_current_password then
    raise exception '지금과 다른 비밀번호를 정해 주세요';
  end if;

  update climate_vote.attendance_secret
     set secret_hash = crypt(p_new_password, gen_salt('bf', 10)), updated_at = now()
   where secret_key = 'hq:' || v_name;

  update climate_vote.hq_operator
     set must_change_password = false
   where name = v_name;

  insert into climate_vote.attendance_auth_attempt(scope, subject, succeeded)
  values ('hq', v_name, true);

  return jsonb_build_object('name', v_name, 'changed', true);
end $chg$;

grant execute on function climate_vote.hq_change_password(text, text, text) to anon, authenticated;
revoke execute on function climate_vote.hq_change_password(text, text, text) from public;

-- 지금은 다섯 명이 같은 임시 비밀번호를 쓰고 있다 — 전원에게 변경 표시를 건다.
-- 각자 한 번 바꾸면 표시가 내려간다.
update climate_vote.hq_operator set must_change_password = true where active;
