-- 20261111_s32_vote_dup_guard 되돌리기 = 2026-11-10 운영 pg_get_functiondef 원문(읽기 전용 조회).
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
  if exists(select 1 from climate_vote.ballot_response br
     where br.ballot_id=v_ballot.id and br.voter_name_norm=v_norm) then
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

