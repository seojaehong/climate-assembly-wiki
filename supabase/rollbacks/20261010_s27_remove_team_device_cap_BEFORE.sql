-- s27 되돌리기: 기기 두 대 제한이 있던 운영 정의(2026-10-10 적용 직전 pg_get_functiondef)

CREATE OR REPLACE FUNCTION climate_vote.mod_exchange_join_code(p_join_code text, p_device_id uuid, p_device_label text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'climate_vote', 'extensions', 'pg_temp'
AS $function$
declare
  v_team climate_vote.team; v_session climate_vote.session;
  v_device_failures int; v_source_failures int; v_source_hour_failures int;
  v_devices int; v_token text; v_expiry timestamptz;
  v_source_hash text:=climate_vote.workshop_request_source_hash();
  v_label text := left(coalesce(nullif(trim(p_device_label),''),'기기'), 80);
begin
  if p_device_id is null then raise exception 'device id required'; end if;
  -- Count, decision, and failure recording must be one serialized bucket
  -- operation. Otherwise parallel invalid requests can all observe a count
  -- below the limit before any of them records its failure.
  perform pg_advisory_xact_lock(hashtextextended(
    'workshop-join:'||coalesce(v_source_hash,'device:'||p_device_id::text),0));
  select count(*) into v_device_failures
    from climate_vote.workshop_join_exchange_attempt
   where device_id=p_device_id and not succeeded
     and attempted_at > now() - interval '15 minutes';
  if v_device_failures >= 5 then return null; end if;
  if v_source_hash is not null then
    select count(*) into v_source_failures
      from climate_vote.workshop_join_exchange_attempt
     where source_hash=v_source_hash and not succeeded
       and attempted_at > now() - interval '15 minutes';
    select count(*) into v_source_hour_failures
      from climate_vote.workshop_join_exchange_attempt
     where source_hash=v_source_hash and not succeeded
       and attempted_at > now() - interval '1 hour';
    -- Venue NATs may legitimately bootstrap 15 teams x two devices. Successful
    -- exchanges never consume these failure budgets; five global failures would
    -- let one typo-prone device deny the whole room.
    if v_source_failures >= 60 or v_source_hour_failures >= 180 then return null; end if;
  end if;

  if p_join_code is null or p_join_code !~ '^[0-9]{6}$' then
    insert into climate_vote.workshop_join_exchange_attempt
      (device_id,source_hash,succeeded)
    values (p_device_id,v_source_hash,false);
    return null;
  end if;

  -- The team row lock serializes device revoke/count/insert across concurrent
  -- source and device buckets until this transaction ends.
  select t.* into v_team from climate_vote.team t
    join climate_vote.session s on s.id=t.session_id
    join climate_vote.assembly a on a.id=s.assembly_id
    join climate_vote.org o on o.id=a.org_id
   where t.join_code=p_join_code and t.status='active'
     and t.org_id=s.org_id and s.org_id=a.org_id and a.org_id=o.id
     and o.status='active' and o.archived_at is null
     and a.status='active' and a.archived_at is null and s.status='active'
     and s.access_expires_at is not null and s.access_expires_at>now()
   for update of t;
  if not found then
    insert into climate_vote.workshop_join_exchange_attempt
      (device_id,source_hash,succeeded)
    values (p_device_id,v_source_hash,false);
    return null;
  end if;
  select * into v_session from climate_vote.session s where s.id=v_team.session_id;
  if v_team.org_id is null or v_session.org_id is null or v_team.org_id <> v_session.org_id then
    raise exception 'team session/org is not provisioned';
  end if;
  perform 1 from climate_vote.assembly a
   where a.id=v_session.assembly_id and a.org_id=v_team.org_id;
  if not found then raise exception 'team assembly/org is not provisioned'; end if;
  v_expiry:=v_session.access_expires_at;
  if v_expiry is null or v_expiry<=now() then
    raise exception 'workshop access window is not configured or has ended';
  end if;
  if v_session.held_on is not null
     and p_join_code ~ ('^'||to_char(v_session.held_on,'MMDD')||'(0[1-9]|1[0-5])$') then
    raise exception 'workshop join codes must be rotated before token exchange';
  end if;

  -- Reissuing on the same browser rotates its token without consuming another slot.
  update climate_vote.attendance_auth_session
     set revoked_at=now()
   where scope='team' and purpose='workshop'
     and team_id=v_team.id and session_id=v_session.id
     and device_id=p_device_id and revoked_at is null;
  select count(distinct device_id) into v_devices
    from climate_vote.attendance_auth_session
   where scope='team' and purpose='workshop'
     and team_id=v_team.id and session_id=v_session.id
     and revoked_at is null and expires_at > now() and device_id is not null;
  if v_devices >= 2 then raise exception 'this team already has two active devices'; end if;

  v_token := encode(gen_random_bytes(32), 'hex');
  insert into climate_vote.attendance_auth_session
    (token_hash, scope, team_id, actor_label, expires_at, org_id, session_id,
     device_id, device_label, purpose, last_seen_at)
  values
    (encode(digest(v_token,'sha256'),'hex'), 'team', v_team.id,
     '조 모더레이터 · '||v_team.name, v_expiry, v_team.org_id, v_session.id,
     p_device_id, v_label, 'workshop', now());
  insert into climate_vote.workshop_join_exchange_attempt
    (device_id,source_hash,succeeded,org_id,session_id,team_id)
  values (p_device_id,v_source_hash,true,v_team.org_id,v_session.id,v_team.id);

  perform climate_vote.workshop_audit(
    v_team.org_id, v_session.id, v_team.id,
    (select id from climate_vote.attendance_auth_session
      where token_hash=encode(digest(v_token,'sha256'),'hex')),
    null, 'device_authorized', 'team', '조 모더레이터 · '||v_team.name,
    null, jsonb_build_object('device_label',v_label,'expires_at',v_expiry));

  return jsonb_build_object(
    'v',1, 'accessToken',v_token, 'expiresAt',v_expiry,
    'deviceId',p_device_id, 'deviceLabel',v_label,
    'sessionId',v_session.id, 'sessionSlug',v_session.slug,
    'team',jsonb_build_object('id',v_team.id,'name',v_team.name,
      'subgroup',v_team.subgroup,'capacity',v_team.capacity,'table_no',v_team.table_no));
end $function$
;
