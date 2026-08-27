-- s10: 본부 운영자별 로그인 (총괄모더레이터 3인)
--
-- ── 무엇이 문제였나 ──────────────────────────────────────────────────
-- 지금 본부 로그인은 **공유 비밀번호 + 각자 이름 입력**이다. 이름은 토큰에 실려
-- 재오픈 사유·4범주 배정·감사 로그에 그대로 남는데, 비밀번호를 아는 사람은
-- 누구 이름으로든 들어갈 수 있다. 즉 「누가 했는가」가 기록은 되지만 증명은 안 된다.
--
-- 회의자료 260811이 총괄모더레이터에게 「조별 결과 임의 통합 금지」·「좋은 의견 선정 금지」를
-- 걸어 두었으므로, 그 선을 넘었는지 따질 수 있으려면 행위자가 특정돼야 한다.
--
-- ── 무엇을 바꾸나 ────────────────────────────────────────────────────
-- attendance_secret 에 사람별 비밀번호를 `hq:홍길동` 키로 둔다(표는 그대로 쓴다).
-- 새 함수는 그 사람의 비밀번호로만 그 사람 이름의 토큰을 낸다.
--
-- ★ 기존 공유 비밀번호 경로(attendance_hq_unlock)는 **건드리지 않는다.**
--   개인 비밀번호가 아직 없는 사람은 그대로 들어올 수 있어야 한다 — 행사 전날에
--   로그인 경로를 끊는 변경은 하지 않는다. 화면이 개인 로그인을 먼저 시도하고
--   실패하면 공유 경로로 넘어간다.
--
-- ★ 접근 범위는 나누지 않는다. 세 사람 모두 15개 조를 다 본다.
--   16:25 분과 공유와 PM 마무리가 세 분과를 가로질러 보는 자리이기 때문이다.
--   분과는 화면 필터로 고르는 것이고 권한 경계가 아니다.
--
-- ── 비밀번호는 이 파일에 없다 ────────────────────────────────────────
-- 운영자별 비밀번호는 각자가 직접 넣는다. 아래 §등록 SQL 참고.

-- 운영자 명부. 비밀번호 자체는 attendance_secret 에만 있고 여기엔 없다.
create table if not exists climate_vote.hq_operator (
  -- 로그인 화면에 뜨는 이름. 토큰 actor_label 로 그대로 실린다.
  name text primary key check (length(trim(name)) between 2 and 80),
  -- 「1분과」 같은 담당 분과. 화면 기본 필터일 뿐 접근 제한이 아니다. 없으면 전체로 연다.
  default_subgroup text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table climate_vote.hq_operator enable row level security;
-- 이름 목록은 로그인 화면이 보여줘야 하므로 읽기만 연다. 비밀번호는 여기 없다.
grant select on climate_vote.hq_operator to anon, authenticated;
drop policy if exists hq_operator_read on climate_vote.hq_operator;
create policy hq_operator_read on climate_vote.hq_operator
  for select using (active);

/**
 * 운영자별 로그인. 그 사람의 비밀번호를 알아야 그 사람 이름의 토큰이 나온다.
 *
 * 실패 기록은 subject 를 사람 이름으로 남긴다 — 한 사람이 5회 틀려도 다른 두 사람은
 * 계속 들어올 수 있어야 한다(공유 경로는 subject='hq' 하나라 셋이 서로를 잠근다).
 */
create or replace function climate_vote.attendance_hq_unlock_named(
  p_operator text, p_password text)
returns text
language plpgsql security definer
set search_path = climate_vote, extensions, pg_temp as $named$
declare
  v_name text := trim(p_operator);
  v_hash text;
  v_failures int;
begin
  if length(v_name) < 2 or length(v_name) > 80 then
    raise exception 'operator name required';
  end if;
  if not exists (select 1 from climate_vote.hq_operator o where o.name = v_name and o.active) then
    return null;
  end if;

  select count(*) into v_failures
  from climate_vote.attendance_auth_attempt
  where scope = 'hq' and subject = v_name and not succeeded
    and attempted_at > now() - interval '15 minutes';
  if v_failures >= 5 then return null; end if;

  select secret_hash into v_hash
  from climate_vote.attendance_secret where secret_key = 'hq:' || v_name;
  if v_hash is null or crypt(p_password, v_hash) <> v_hash then
    insert into climate_vote.attendance_auth_attempt(scope, subject, succeeded)
    values ('hq', v_name, false);
    return null;
  end if;

  insert into climate_vote.attendance_auth_attempt(scope, subject, succeeded)
  values ('hq', v_name, true);
  return climate_vote.attendance_issue_token('hq', null, v_name);
end $named$;

grant execute on function climate_vote.attendance_hq_unlock_named(text, text) to anon, authenticated;
revoke execute on function climate_vote.attendance_hq_unlock_named(text, text) from public;

-- ═══════════════════════════════════════════════════════════════════
-- 등록 SQL — 이 아래는 **직접 채워 실행**한다. 이 파일에 비밀번호를 적지 말 것.
-- ═══════════════════════════════════════════════════════════════════
--
-- 1) 운영자 3인을 넣는다(이름·담당 분과를 실제 값으로 바꾼다).
--
--   insert into climate_vote.hq_operator (name, default_subgroup) values
--     ('이름1', '1분과'), ('이름2', '2분과'), ('이름3', '3분과')
--   on conflict (name) do update set default_subgroup = excluded.default_subgroup, active = true;
--
-- 2) 각자 자기 비밀번호를 넣는다. 한 사람이 한 줄씩, 본인이 직접 실행하는 것이 가장 좋다.
--    ⚠️ 비밀번호를 남에게 보내지 말 것. 실행 뒤 SQL Editor 탭을 닫으면 남지 않는다.
--
--   insert into climate_vote.attendance_secret (secret_key, secret_hash)
--   values ('hq:이름1', extensions.crypt('여기에_비밀번호', extensions.gen_salt('bf', 10)))
--   on conflict (secret_key) do update set secret_hash = excluded.secret_hash, updated_at = now();
--
-- 3) 확인 — 비밀번호는 보이지 않고 등록 여부만 나온다.
--
--   select o.name, o.default_subgroup, o.active,
--          (s.secret_key is not null) as 비밀번호_설정됨
--   from climate_vote.hq_operator o
--   left join climate_vote.attendance_secret s on s.secret_key = 'hq:' || o.name
--   order by o.name;
