-- s32 (제안 · 미적용) — 11/14 전원 투표지의 중복 제출 막기 보강. ★ 에이전트는 파일만 썼다. 적용은 사람이 승인 후.
--
-- WHY: 11/14 의결 투표지 3장은 분과 지정 없이 세션 명단 전원(약 150~200명)이 투표한다(11/10 결정).
--   ① 무기명 경로: ballot_submit 은 실명 수집 중에도 이름 없는 표를 받는다(화면은 명단이 있으면 부르지 않지만
--      토큰만 있으면 직접 부를 수 있다). 내보내기가 「이름 없음」으로 빼지만, 처음부터 받지 않는 편이 낫다.
--   ② 동명이인: ballot_submit_named 는 이름만으로 중복을 본다. 명단이 분과별이던 10/17 에는 분과 안 동명이인 0명이었지만,
--      전원 명단에서는 다른 분과의 같은 이름 두 번째 사람이 「이미 이 이름으로 제출」에 막힌다(28건을 다 누른 뒤).
-- WHAT: 운영 정의(2026-11-10 pg_get_functiondef, 읽기 전용) 본문을 그대로 베끼고 두 곳만 바꿨다.
--   ① ballot_submit: insert 직전에 「collect 켜짐 + 이 범위 명단 있음 → raise 'named voting required'」.
--      화면 src/lib/ballot.ts submitBallot 은 이 문구를 모르므로 일반 오류(「제출에 실패했습니다」)로 보인다 — 화면이
--      명단이 있을 때는 무기명을 부르지 않으므로(anonymousSubmitGate) 정상 경로에는 영향이 없다.
--   ② ballot_submit_named: 이름 중복 검사 — 그 이름이 명단의 2개 이상 조에 있으면 (조, 이름)이 같을 때만 중복.
--      한 조에만 있는 이름은 지금처럼 이름만으로 중복(조를 바꿔 다시 내는 길은 그대로 막힌다).
--   한계: 동명이인 중 한 사람이 다른 사람의 조를 골라 내면 막지 못한다(대리 제출과 같은 등급 — 출석부 대조로 잡는다).
--   함께 고칠 곳(이 파일 밖): ballot_voter_correct_v2 의 이름 중복 검사도 이름만 본다 — 동명이인을 정정하려면 같은 규칙으로.
--   결과 내보내기 scripts/lib/result-v2.mjs 의 「중복」 키도 이름만 본다 — 이 파일을 적용하면 (조, 이름) 규칙으로 맞춘다.
--   넣지 않은 것(사용자 결정 필요): 「명단 밖 이름 거부」. 화면에 「명단에 없어요 — 이름 직접 입력」이 있어 지금은
--      명단 밖 이름도 DB 에 들어가고(voter_in_roster=false) 내보내기가 「명단 밖」으로 뺀다.
-- ★ 적용 전: 운영 pg_get_functiondef 가 rollbacks/20261111_s32_vote_dup_guard_BEFORE.sql 과 같은지 대조.
--   ballot_submit 의 최신 정의는 platform 트랙 파일에 있어 사전순으로 날짜 파일 뒤에 적용된다 — 폴더를 통째로 다시
--   재생하면 ① 가드가 지워진다. 재생 뒤에는 이 파일을 한 번 더 적용한다.
-- 시험(리허설 세션에서 직접 호출): 무기명 제출 → 거부 / 명단 안 이름 → 성공 / 같은 이름 두 번 → 거부 /
--   명단에 두 조로 있는 같은 이름 — 조 A 성공 · 조 B 성공 · 조 A 다시 → 거부 / collect 끔 → 무기명 성공.
-- 되돌리기: supabase/rollbacks/20261111_s32_vote_dup_guard_BEFORE.sql

CREATE OR REPLACE FUNCTION climate_vote.ballot_submit(p_token text, p_client_id text, p_answers jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'climate_vote', 'extensions', 'pg_temp'
AS $function$
declare v_ballot climate_vote.ballot; v_item record; v_value_text text; v_val int;
begin
  if p_token is null or length(p_token)<>32 then
    raise exception 'ballot token required';
  end if;
  if p_client_id is null or length(trim(p_client_id)) not between 8 and 80 then
    raise exception 'ballot client id required';
  end if;
  if p_answers is null or jsonb_typeof(p_answers)<>'object' then
    raise exception 'answers must be object';
  end if;

  select b.* into v_ballot
    from climate_vote.ballot b
    join climate_vote.session s on s.id=b.session_id
      and s.org_id=b.org_id and s.status='active'
      and s.access_expires_at is not null and s.access_expires_at>now()
    join climate_vote.assembly a on a.id=s.assembly_id
      and a.org_id=s.org_id and a.status='active' and a.archived_at is null
    join climate_vote.org o on o.id=s.org_id
      and o.status='active' and o.archived_at is null
   where b.token=p_token and b.status='open' and b.archived_at is null
   for update of b;
  if not found then raise exception 'ballot not open or event unavailable'; end if;

  if exists(
    select 1 from jsonb_object_keys(p_answers) supplied(key)
    where not exists(select 1 from climate_vote.ballot_item bi
      where bi.ballot_id=v_ballot.id and bi.id::text=supplied.key)
  ) then
    raise exception 'answers contain unknown ballot item';
  end if;
  for v_item in
    select id,scale,required from climate_vote.ballot_item
     where ballot_id=v_ballot.id order by ordinal
  loop
    if not (p_answers ? v_item.id::text) then
      if v_item.required then raise exception 'missing answer for item %',v_item.id; end if;
      continue;
    end if;
    if jsonb_typeof(p_answers->(v_item.id::text))<>'number' then
      raise exception 'answer must be an integer for item %',v_item.id;
    end if;
    v_value_text:=p_answers->>(v_item.id::text);
    if v_value_text!~'^[0-9]+$' then
      raise exception 'answer must be an integer for item %',v_item.id;
    end if;
    v_val:=v_value_text::int;
    if v_val<1 or v_val>v_item.scale then
      raise exception 'answer out of scale for item %',v_item.id;
    end if;
  end loop;

  -- s32: 실명 수집 중이고 이 투표 범위에 명단이 있으면 무기명 제출을 받지 않는다(이름 없는 표가 섞이지 않게).
  if coalesce((climate_vote.session_named_vote(v_ballot.session_id)->>'collect')::boolean, true)
     and exists(select 1 from climate_vote.ballot_roster r
       where r.session_id=v_ballot.session_id
         and (nullif(btrim(v_ballot.subgroup),'') is null or r.subgroup=btrim(v_ballot.subgroup))) then
    raise exception 'named voting required';
  end if;

  insert into climate_vote.ballot_response(ballot_id,client_id,answers,org_id)
  values(v_ballot.id,trim(p_client_id),p_answers,v_ballot.org_id);
  return jsonb_build_object('ok',true);
exception when unique_violation then
  raise exception 'already submitted';
end $function$;
grant execute on function climate_vote.ballot_submit(text,text,jsonb) to anon, authenticated;
revoke execute on function climate_vote.ballot_submit(text,text,jsonb) from public;

CREATE OR REPLACE FUNCTION climate_vote.ballot_submit_named(p_token text, p_client_id text, p_answers jsonb, p_voter_team text, p_voter_name text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'climate_vote', 'extensions', 'pg_temp'
AS $function$
declare v_ballot climate_vote.ballot; v_item record; v_value_text text; v_val int;
  v_team text := btrim(coalesce(p_voter_team,''));
  v_name text := btrim(regexp_replace(coalesce(p_voter_name,''), '[[:space:] 　]+', ' ', 'g'));
  v_norm text := climate_vote.voter_name_norm(p_voter_name);
  v_in_roster boolean;
begin
  if p_token is null or length(p_token)<>32 then
    raise exception 'ballot token required';
  end if;
  if p_client_id is null or length(trim(p_client_id)) not between 8 and 80 then
    raise exception 'ballot client id required';
  end if;
  if p_answers is null or jsonb_typeof(p_answers)<>'object' then
    raise exception 'answers must be object';
  end if;

  select b.* into v_ballot
    from climate_vote.ballot b
    join climate_vote.session s on s.id=b.session_id
      and s.org_id=b.org_id and s.status='active'
      and s.access_expires_at is not null and s.access_expires_at>now()
    join climate_vote.assembly a on a.id=s.assembly_id
      and a.org_id=s.org_id and a.status='active' and a.archived_at is null
    join climate_vote.org o on o.id=s.org_id
      and o.status='active' and o.archived_at is null
   where b.token=p_token and b.status='open' and b.archived_at is null
   for update of b;
  if not found then raise exception 'ballot not open or event unavailable'; end if;

  if exists(
    select 1 from jsonb_object_keys(p_answers) supplied(key)
    where not exists(select 1 from climate_vote.ballot_item bi
      where bi.ballot_id=v_ballot.id and bi.id::text=supplied.key)
  ) then
    raise exception 'answers contain unknown ballot item';
  end if;
  for v_item in
    select id,scale,required from climate_vote.ballot_item
     where ballot_id=v_ballot.id order by ordinal
  loop
    if not (p_answers ? v_item.id::text) then
      if v_item.required then raise exception 'missing answer for item %',v_item.id; end if;
      continue;
    end if;
    if jsonb_typeof(p_answers->(v_item.id::text))<>'number' then
      raise exception 'answer must be an integer for item %',v_item.id;
    end if;
    v_value_text:=p_answers->>(v_item.id::text);
    if v_value_text!~'^[0-9]+$' then
      raise exception 'answer must be an integer for item %',v_item.id;
    end if;
    v_val:=v_value_text::int;
    if v_val<1 or v_val>v_item.scale then
      raise exception 'answer out of scale for item %',v_item.id;
    end if;
  end loop;

  -- 실명 검사. 투표 행 잠금(for update of b) 아래라 같은 투표의 제출은 한 줄로 선다 — 이름 중복 검사에 경합이 없다.
  if not coalesce((climate_vote.session_named_vote(v_ballot.session_id)->>'collect')::boolean, true) then
    raise exception 'named voting off';
  end if;
  if not exists(select 1 from climate_vote.ballot_roster r
     where r.session_id=v_ballot.session_id
       and (nullif(btrim(v_ballot.subgroup),'') is null or r.subgroup=btrim(v_ballot.subgroup))) then
    raise exception 'ballot roster not configured';
  end if;
  if not exists(select 1 from climate_vote.ballot_roster r
     where r.session_id=v_ballot.session_id
       and (nullif(btrim(v_ballot.subgroup),'') is null or r.subgroup=btrim(v_ballot.subgroup))
       and r.team_label=v_team) then
    raise exception 'voter team not in roster';
  end if;
  if v_norm='' or length(v_name)>80 then
    raise exception 'voter name required';
  end if;
  -- 같은 기기의 재전송은 이름 중복보다 먼저 「이미 제출」로 알린다.
  if exists(select 1 from climate_vote.ballot_response br
     where br.ballot_id=v_ballot.id and br.client_id=trim(p_client_id)) then
    raise exception 'already submitted';
  end if;
  -- s32: 같은 이름이 이 투표 범위 명단의 여러 조에 있으면(동명이인) 조까지 같아야 중복이다.
  --      그 밖에는 지금처럼 이름만으로 본다(조를 바꿔 같은 이름으로 다시 내는 길을 막는다).
  if exists(select 1 from climate_vote.ballot_response br
     where br.ballot_id=v_ballot.id and br.voter_name_norm=v_norm
       and (br.voter_team=v_team or (
         select count(distinct r.team_label) from climate_vote.ballot_roster r
          where r.session_id=v_ballot.session_id
            and (nullif(btrim(v_ballot.subgroup),'') is null or r.subgroup=btrim(v_ballot.subgroup))
            and r.name_norm=v_norm) < 2)) then
    raise exception 'name already submitted';
  end if;
  v_in_roster := exists(select 1 from climate_vote.ballot_roster r
     where r.session_id=v_ballot.session_id
       and (nullif(btrim(v_ballot.subgroup),'') is null or r.subgroup=btrim(v_ballot.subgroup))
       and r.team_label=v_team and r.name_norm=v_norm);

  insert into climate_vote.ballot_response(ballot_id,client_id,answers,org_id,
    voter_team,voter_name,voter_name_norm,voter_in_roster)
  values(v_ballot.id,trim(p_client_id),p_answers,v_ballot.org_id,
    v_team,v_name,v_norm,v_in_roster);
  return jsonb_build_object('ok',true,'voter_team',v_team,'voter_name',v_name,'in_roster',v_in_roster);
exception when unique_violation then
  raise exception 'already submitted';
end $function$;
grant execute on function climate_vote.ballot_submit_named(text,text,jsonb,text,text) to anon, authenticated;
revoke execute on function climate_vote.ballot_submit_named(text,text,jsonb,text,text) from public;
