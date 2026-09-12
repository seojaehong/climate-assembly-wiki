begin;

do $verify$
declare
  v_session uuid := '91200000-0000-0000-0000-000000000003';
  v_team_a uuid := '91200000-0000-0000-0000-000000000011';
  v_team_b uuid := '91200000-0000-0000-0000-000000000012';
  v_topic uuid := '91200000-0000-0000-0000-000000000021';
  v_other_topic uuid;
  v_agenda_two uuid := '91220000-0000-4000-8000-000000000001';
  v_hq text;
  v_team_a_token text;
  v_team_b_token text;
  v_expired_team_token text;
  v_agenda uuid;
  v_rec_a uuid;
  v_rec_b uuid;
  v_request uuid;
  v_board jsonb;
  v_result jsonb;
  v_recommendation_json jsonb;
  v_definition text;
  v_lock_check record;
  v_request_pos int;
  v_agenda_pos int;
  v_recommendation_pos int;
  v_rpc oid;
  v_rpc_signature text;
begin
  if (select count(*) from climate_vote.agenda_item where session_id=v_session)<>25 then
    raise exception 's24 must preserve the s23 agenda catalog';
  end if;
  update climate_vote.team set subgroup='1분과' where id in (v_team_a,v_team_b);
  update climate_vote.discussion_topic
     set status='draft'
   where session_id=v_session and status<>'archived';
  update climate_vote.discussion_topic set status='open' where id=v_topic;
  select id into v_other_topic from climate_vote.discussion_topic
   where session_id=v_session and id<>v_topic and status<>'archived'
   order by ordinal limit 1;
  if v_other_topic is null then
    v_other_topic:=gen_random_uuid();
    insert into climate_vote.discussion_topic(
      id,session_id,ordinal,block,prompt,guidance,status,org_id
    )
    select v_other_topic,v_session,
      (select coalesce(max(ordinal),0)+1 from climate_vote.discussion_topic where session_id=v_session),
      'pm','Synthetic second workflow stage','Concurrency-free verifier stage',
      'draft',s.org_id
      from climate_vote.session s where s.id=v_session;
  end if;
  insert into climate_vote.hq_operator(name,default_subgroup,active,must_change_password)
  values('Recommendation verifier HQ','1분과',true,false)
  on conflict(name) do update set active=true,must_change_password=false;
  v_hq:=climate_vote.attendance_issue_token('hq',null,'Recommendation verifier HQ');
  v_team_a_token:=climate_vote.attendance_issue_token('team',v_team_a,'Recommendation verifier team A');
  v_team_b_token:=climate_vote.attendance_issue_token('team',v_team_b,'Recommendation verifier team B');
  update climate_vote.attendance_auth_session
     set purpose='workshop'
   where token_hash in (
     encode(extensions.digest(v_team_a_token,'sha256'),'hex'),
     encode(extensions.digest(v_team_b_token,'sha256'),'hex')
   );

  v_expired_team_token:=climate_vote.attendance_issue_token(
    'team',v_team_a,'Recommendation verifier expired team'
  );
  update climate_vote.attendance_auth_session
     set purpose='workshop',expires_at=now()-interval '1 minute'
   where token_hash=encode(extensions.digest(v_expired_team_token,'sha256'),'hex');
  begin
    perform climate_vote.agenda_board_v2(v_expired_team_token,'0912-deliberation');
    raise exception 'expired team token unexpectedly succeeded';
  exception when others then
    if sqlerrm='expired team token unexpectedly succeeded' then raise; end if;
  end;

  update climate_vote.hq_operator set active=false where name='Recommendation verifier HQ';
  begin
    perform climate_vote.agenda_board_v2(v_hq,'0912-deliberation');
    raise exception 'inactive HQ operator unexpectedly succeeded';
  exception when others then
    if sqlerrm='inactive HQ operator unexpectedly succeeded' then raise; end if;
  end;
  update climate_vote.hq_operator set active=true where name='Recommendation verifier HQ';

  v_board:=climate_vote.agenda_board_v2(v_hq,'0912-deliberation');
  if (v_board->'activeStage'->>'id')::uuid<>v_topic
     or climate_vote.recommendation_topic_id(v_session,null)<>v_topic then
    raise exception 'board and server-default workflow stage diverged';
  end if;
  begin
    perform climate_vote.recommendation_topic_id(v_session,v_other_topic);
    raise exception 'explicit draft workflow stage unexpectedly succeeded';
  exception when others then
    if sqlerrm='explicit draft workflow stage unexpectedly succeeded' then raise; end if;
    if sqlerrm<>'workflow stage must be the single open stage' then raise; end if;
  end;
  update climate_vote.discussion_topic set status='closed' where id=v_other_topic;
  begin
    perform climate_vote.recommendation_topic_id(v_session,v_other_topic);
    raise exception 'explicit closed workflow stage unexpectedly succeeded';
  exception when others then
    if sqlerrm='explicit closed workflow stage unexpectedly succeeded' then raise; end if;
    if sqlerrm<>'workflow stage must be the single open stage' then raise; end if;
  end;
  update climate_vote.discussion_topic set status='draft' where id=v_other_topic;
  update climate_vote.discussion_topic set status='draft' where id=v_topic;
  v_board:=climate_vote.agenda_board_v2(v_hq,'0912-deliberation');
  if v_board->'activeStage'<>'null'::jsonb
     or (v_board->'stageIntegrity'->>'openStageCount')::int<>0
     or (v_board->'stageIntegrity'->>'writable')::boolean then
    raise exception 'board did not expose a readable no-open-stage state';
  end if;
  begin
    perform climate_vote.recommendation_topic_id(v_session,v_topic);
    raise exception 'explicit topic unexpectedly accepted zero open stages';
  exception when others then
    if sqlerrm='explicit topic unexpectedly accepted zero open stages' then raise; end if;
    if sqlerrm<>'exactly one open workflow stage required' then raise; end if;
  end;
  update climate_vote.discussion_topic set status='open' where id in (v_topic,v_other_topic);
  begin
    perform climate_vote.recommendation_topic_id(v_session,null);
    raise exception 'default topic unexpectedly accepted multiple open stages';
  exception when others then
    if sqlerrm='default topic unexpectedly accepted multiple open stages' then raise; end if;
    if sqlerrm<>'exactly one open workflow stage required' then raise; end if;
  end;
  begin
    perform climate_vote.recommendation_topic_id(v_session,v_topic);
    raise exception 'explicit topic unexpectedly accepted multiple open stages';
  exception when others then
    if sqlerrm='explicit topic unexpectedly accepted multiple open stages' then raise; end if;
    if sqlerrm<>'exactly one open workflow stage required' then raise; end if;
  end;
  begin
    perform climate_vote.agenda_board_v2(v_hq,'0912-deliberation');
    raise exception 'board unexpectedly accepted multiple open stages';
  exception when others then
    if sqlerrm='board unexpectedly accepted multiple open stages' then raise; end if;
    if sqlerrm<>'multiple open workflow stages' then raise; end if;
  end;
  update climate_vote.discussion_topic set status='draft' where id=v_other_topic;

  for v_lock_check in
    select * from (values
      ('climate_vote.agenda_archive_v2(text,text,uuid,text,uuid)'::regprocedure,'agenda-archive:',false),
      ('climate_vote.agenda_assignment_set_v2(text,text,uuid,uuid,boolean,uuid)'::regprocedure,'agenda-assignment:',false),
      ('climate_vote.recommendation_create_v2(text,text,uuid,uuid,text,text,text,text,uuid,uuid)'::regprocedure,'recommendation-create:',false),
      ('climate_vote.recommendation_revise_v2(text,text,uuid,text,text,text,text,int,uuid,uuid)'::regprocedure,'recommendation-revise:',true),
      ('climate_vote.recommendation_archive_v2(text,text,uuid,text,uuid)'::regprocedure,'recommendation-archive:',true),
      ('climate_vote.recommendation_progress_v2(text,text,uuid,text,text,uuid,uuid)'::regprocedure,'recommendation-progress:',true)
    ) locks(function_id,request_marker,needs_recommendation_lock)
  loop
    v_definition:=pg_get_functiondef(v_lock_check.function_id);
    v_request_pos:=position(v_lock_check.request_marker in v_definition);
    v_agenda_pos:=position('agenda:''||' in v_definition);
    v_recommendation_pos:=position('recommendation:''||' in v_definition);
    if v_request_pos=0 or v_agenda_pos<=v_request_pos
       or (v_lock_check.needs_recommendation_lock
           and v_recommendation_pos<=v_agenda_pos) then
      raise exception 'mutation advisory lock order is not request-agenda-recommendation: %',
        v_lock_check.function_id;
    end if;
  end loop;

  if to_regprocedure('climate_vote.recommendation_revise_v2(text,text,uuid,text,text,text,text,uuid)') is not null
     or to_regprocedure('climate_vote.recommendation_revise_v2(text,text,uuid,text,text,text,text,uuid,uuid)') is not null then
    raise exception 'pre-OCC recommendation revise signature remains callable';
  end if;
  foreach v_rpc_signature in array array[
    'climate_vote.recommendation_revise_v2(text,text,uuid,text,text,text,text,integer,uuid)',
    'climate_vote.recommendation_revise_v2(text,text,uuid,text,text,text,text,integer,uuid,uuid)'
  ] loop
    v_rpc:=to_regprocedure(v_rpc_signature)::oid;
    if v_rpc is null
       or not has_function_privilege('anon',v_rpc,'execute')
       or not has_function_privilege('authenticated',v_rpc,'execute')
       or exists(
         select 1
           from pg_proc p
           cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
          where p.oid=v_rpc and acl.grantee=0 and acl.privilege_type='EXECUTE'
       ) then
      raise exception 'OCC revise RPC grant contract failed: %',v_rpc_signature;
    end if;
  end loop;

  if (
    select count(*)
      from pg_class c
     where c.oid=any(array[
       'climate_vote.agenda_lifecycle_event'::regclass,
       'climate_vote.agenda_recommendation'::regclass,
       'climate_vote.agenda_recommendation_revision'::regclass,
       'climate_vote.agenda_recommendation_archive_event'::regclass,
       'climate_vote.agenda_recommendation_progress_event'::regclass
     ]) and c.relreplident='f'
  )<>5 then
    raise exception 'recommendation realtime tables require replica identity full';
  end if;
  if (
    select count(*)
      from pg_publication_tables p
     where p.pubname='supabase_realtime' and p.schemaname='climate_vote'
       and p.tablename=any(array[
         'agenda_lifecycle_event',
         'agenda_recommendation',
         'agenda_recommendation_revision',
         'agenda_recommendation_archive_event',
         'agenda_recommendation_progress_event'
       ])
  )<>5 then
    raise exception 'recommendation realtime publication membership incomplete';
  end if;

  v_request:=gen_random_uuid();
  v_result:=climate_vote.agenda_create_v2(
    v_team_a_token,'0912-deliberation','1분과','동적 의제 검증',
    '시민이 제안한 동적 의제의 연결 원문',v_request
  );
  v_agenda:=(v_result->>'id')::uuid;
  if coalesce((v_result->>'replayed')::boolean,true) then
    raise exception 'first agenda create must not be a replay';
  end if;
  v_result:=climate_vote.agenda_create_v2(
    v_team_a_token,'0912-deliberation','1분과','동적 의제 검증',
    '시민이 제안한 동적 의제의 연결 원문',v_request
  );
  if not (v_result->>'replayed')::boolean
     or (select count(*) from climate_vote.agenda_item where id=v_agenda)<>1
     or (select count(*) from climate_vote.agenda_lifecycle_event where request_id=v_request)<>1
     or (select count(*) from climate_vote.agenda_source_utterance where agenda_id=v_agenda and ordinal=1)<>1
     or v_result->'sourceUtterances'<>jsonb_build_array('시민이 제안한 동적 의제의 연결 원문') then
    raise exception 'agenda create idempotency failed';
  end if;
  if true is distinct from (
    select assigned from climate_vote.agenda_assignment_event
     where agenda_id=v_agenda and team_id=v_team_a order by id desc limit 1
  ) then
    raise exception 'team-created agenda was not assigned to its authoring team';
  end if;

  begin
    perform climate_vote.agenda_create_v2(
      v_team_a_token,'0912-deliberation','2분과','다른 분과 의제',
      '다른 분과 시민 원문',gen_random_uuid()
    );
    raise exception 'cross-division team agenda create unexpectedly succeeded';
  exception when others then
    if sqlerrm='cross-division team agenda create unexpectedly succeeded' then raise; end if;
  end;

  perform climate_vote.agenda_assignment_set_v2(
    v_hq,'0912-deliberation',v_agenda,v_team_b,true,gen_random_uuid()
  );
  if (select count(*) from (
    select distinct on (team_id) team_id,assigned
      from climate_vote.agenda_assignment_event
     where agenda_id=v_agenda order by team_id,id desc
  ) x where assigned)<>2 then
    raise exception 'multi-team agenda assignment failed';
  end if;
  begin
    perform climate_vote.agenda_assignment_set_v2(
      v_hq,'0912-deliberation',v_agenda_two,v_team_a,true,gen_random_uuid()
    );
    raise exception 'cross-division assignment unexpectedly succeeded';
  exception when others then
    if sqlerrm='cross-division assignment unexpectedly succeeded' then raise; end if;
  end;

  v_request:=gen_random_uuid();
  v_result:=climate_vote.recommendation_create_v2(
    v_team_a_token,'0912-deliberation',v_agenda,v_team_a,
    '첫 번째 권고안','초기 배경','초기 권고 내용','보존할 기대효과',v_request
  );
  v_rec_a:=(v_result->>'id')::uuid;
  if (v_result->>'topicId')::uuid<>v_topic
     or (select topic_id from climate_vote.agenda_recommendation_revision where recommendation_id=v_rec_a and version=1)<>v_topic then
    raise exception 'server-default create topic attribution failed';
  end if;
  v_result:=climate_vote.recommendation_create_v2(
    v_team_a_token,'0912-deliberation',v_agenda,v_team_a,
    '첫 번째 권고안','초기 배경','초기 권고 내용','보존할 기대효과',v_request
  );
  if not (v_result->>'replayed')::boolean
     or (select count(*) from climate_vote.agenda_recommendation where created_request_id=v_request)<>1
     or (select count(*) from climate_vote.agenda_recommendation_revision where request_id=v_request)<>1 then
    raise exception 'recommendation create idempotency failed';
  end if;
  v_result:=climate_vote.recommendation_create_v2(
    v_team_b_token,'0912-deliberation',v_agenda,v_team_b,
    '두 번째 권고안','다른 조의 배경','다른 조의 권고 내용',null,gen_random_uuid()
  );
  v_rec_b:=(v_result->>'id')::uuid;
  if v_rec_a=v_rec_b then raise exception 'multiple recommendations were not created independently'; end if;

  begin
    perform climate_vote.recommendation_revise_v2(
      v_team_b_token,'0912-deliberation',v_rec_b,
      '대기 상태 건너뛰기','대기 상태 배경','대기 상태 권고 내용',null,1,gen_random_uuid()
    );
    raise exception 'waiting recommendation revise unexpectedly succeeded';
  exception when others then
    if sqlerrm='waiting recommendation revise unexpectedly succeeded' then raise; end if;
    if sqlerrm<>'recommendation must be discussing before save' then raise; end if;
  end;

  begin
    perform climate_vote.recommendation_progress_v2(
      v_team_b_token,'0912-deliberation',v_rec_b,'start',null,gen_random_uuid(),gen_random_uuid()
    );
    raise exception 'foreign-session workflow stage unexpectedly succeeded';
  exception when others then
    if sqlerrm='foreign-session workflow stage unexpectedly succeeded' then raise; end if;
  end;

  perform climate_vote.recommendation_progress_v2(
    v_team_a_token,'0912-deliberation',v_rec_a,'start',null,gen_random_uuid(),v_topic
  );
  if (select status from climate_vote.agenda_recommendation_progress_event
       where recommendation_id=v_rec_a order by id desc limit 1)<>'discussing' then
    raise exception 'start did not move waiting recommendation to discussing';
  end if;
  v_request:=gen_random_uuid();
  v_result:=climate_vote.recommendation_revise_v2(
    v_team_a_token,'0912-deliberation',v_rec_a,
    '첫 번째 권고안 수정','수정한 배경과 문제인식','수정한 권고 내용','수정한 기대효과',1,v_request,v_topic
  );
  if (v_result->>'version')::int<>2 or coalesce((v_result->>'replayed')::boolean,true) then
    raise exception 'latest expected revision version did not advance exactly once';
  end if;
  begin
    perform climate_vote.recommendation_revise_v2(
      v_team_a_token,'0912-deliberation',v_rec_a,
      '충돌한 오래된 수정','오래된 배경','오래된 권고 내용',null,1,gen_random_uuid(),v_topic
    );
    raise exception 'stale recommendation revise unexpectedly succeeded';
  exception when others then
    if sqlerrm='stale recommendation revise unexpectedly succeeded' then raise; end if;
    if sqlerrm<>'stale recommendation revision: expected 1, current 2' then raise; end if;
  end;
  perform climate_vote.recommendation_revise_v2(
    v_team_a_token,'0912-deliberation',v_rec_a,
    '첫 번째 권고안 수정','수정한 배경과 문제인식','수정한 권고 내용','수정한 기대효과',1,v_request,v_topic
  );
  if (select count(*) from climate_vote.agenda_recommendation_revision where recommendation_id=v_rec_a)<>2
     or (select count(*) from climate_vote.agenda_recommendation_progress_event where recommendation_id=v_rec_a and action='save')<>1
     or (select status from climate_vote.agenda_recommendation_progress_event
          where recommendation_id=v_rec_a order by id desc limit 1)<>'drafting' then
    raise exception 'revision append or idempotent save linkage failed';
  end if;
  if (select expected_effect from climate_vote.agenda_recommendation_revision where recommendation_id=v_rec_a and version=1)<>'보존할 기대효과' then
    raise exception 'prior expected effect was not preserved';
  end if;
  if exists(
    select 1
      from climate_vote.agenda_recommendation_revision r
      join climate_vote.agenda_recommendation ar on ar.id=r.recommendation_id
      join climate_vote.discussion_topic dt on dt.id=r.topic_id
     where ar.id=v_rec_a and dt.session_id<>ar.session_id
  ) or exists(
    select 1
      from climate_vote.agenda_recommendation_progress_event p
      join climate_vote.agenda_recommendation ar on ar.id=p.recommendation_id
      join climate_vote.discussion_topic dt on dt.id=p.topic_id
     where ar.id=v_rec_a and dt.session_id<>ar.session_id
  ) then
    raise exception 'recommendation history escaped its session workflow stage';
  end if;
  perform climate_vote.recommendation_progress_v2(
    v_team_a_token,'0912-deliberation',v_rec_a,'confirm',null,gen_random_uuid()
  );
  perform climate_vote.recommendation_progress_v2(
    v_team_a_token,'0912-deliberation',v_rec_a,'submit',null,gen_random_uuid()
  );
  if (select status from climate_vote.agenda_recommendation_progress_event where recommendation_id=v_rec_a order by id desc limit 1)<>'submitted' then
    raise exception 'recommendation five-state progression failed';
  end if;

  v_request:=gen_random_uuid();
  perform climate_vote.recommendation_progress_v2(
    v_hq,'0912-deliberation',v_rec_a,'revision_request','근거를 구체화해 주세요.',v_request
  );
  perform climate_vote.recommendation_progress_v2(
    v_hq,'0912-deliberation',v_rec_a,'revision_request','근거를 구체화해 주세요.',v_request
  );
  if (select count(*) from climate_vote.agenda_recommendation_progress_event where request_id=v_request)<>1
     or (select status from climate_vote.agenda_recommendation_progress_event where request_id=v_request)<>'drafting' then
    raise exception 'HQ revision request or idempotency failed';
  end if;

  v_request:=gen_random_uuid();
  perform climate_vote.recommendation_revise_v2(
    v_hq,'0912-deliberation',v_rec_a,
    'HQ가 다듬은 첫 번째 권고안','HQ가 구체화한 배경과 문제인식',
    'HQ가 구체화한 권고 내용','HQ 수정에서도 보존하는 기대효과',2,v_request
  );
  if (select actor_scope from climate_vote.agenda_recommendation_revision where request_id=v_request)<>'hq'
     or (select actor_team_id from climate_vote.agenda_recommendation_revision where request_id=v_request) is not null
     or (select author_team_id from climate_vote.agenda_recommendation where id=v_rec_a)<>v_team_a
     or (select version from climate_vote.agenda_recommendation_revision where request_id=v_request)<>3 then
    raise exception 'HQ revision history or authoring-team preservation failed';
  end if;

  begin
    perform climate_vote.recommendation_revise_v2(
      v_team_b_token,'0912-deliberation',v_rec_a,
      '침범 수정','침범','침범',null,3,gen_random_uuid()
    );
    raise exception 'cross-team recommendation edit unexpectedly succeeded';
  exception when others then
    if sqlerrm='cross-team recommendation edit unexpectedly succeeded' then raise; end if;
  end;

  v_board:=climate_vote.agenda_board_v2(v_hq,'0912-deliberation');
  if (v_board->>'version')::int<>3
     or jsonb_array_length(v_board->'agendas')<>26
     or jsonb_array_length((select a->'recommendations' from jsonb_array_elements(v_board->'agendas') a where a->>'id'=v_agenda::text))<>2 then
    raise exception 'HQ recommendation board shape failed';
  end if;
  select r into v_recommendation_json
    from jsonb_array_elements(v_board->'agendas') a
    cross join lateral jsonb_array_elements(a->'recommendations') r
   where a->>'id'=v_agenda::text and r->>'id'=v_rec_a::text;
  if v_recommendation_json is null
     or jsonb_typeof(v_recommendation_json->'revisionVersion')<>'number'
     or (v_recommendation_json->>'revisionVersion')::int<>3
     or jsonb_typeof(v_recommendation_json->'revisionCount')<>'number'
     or (v_recommendation_json->>'revisionCount')::int<>3
     or jsonb_typeof(v_recommendation_json->'progressCount')<>'number'
     or (v_recommendation_json->>'progressCount')::int<>6
     or v_recommendation_json ? 'revisions'
     or v_recommendation_json ? 'progress' then
    raise exception 'board recommendation payload is not bounded or typed as contract v3';
  end if;
  v_board:=climate_vote.agenda_board_v2(v_team_a_token,'0912-deliberation');
  if jsonb_array_length(v_board->'teams')<>1
     or jsonb_array_length((select a->'recommendations' from jsonb_array_elements(v_board->'agendas') a where a->>'id'=v_agenda::text))<>1 then
    raise exception 'team board leaked another team recommendation';
  end if;

  v_request:=gen_random_uuid();
  perform climate_vote.recommendation_archive_v2(
    v_team_b_token,'0912-deliberation',v_rec_b,'중복 권고안 보관',v_request
  );
  perform climate_vote.recommendation_archive_v2(
    v_team_b_token,'0912-deliberation',v_rec_b,'중복 권고안 보관',v_request
  );
  if (select count(*) from climate_vote.agenda_recommendation_archive_event where recommendation_id=v_rec_b)<>1 then
    raise exception 'recommendation archive idempotency failed';
  end if;
  v_board:=climate_vote.agenda_board_v2(v_team_b_token,'0912-deliberation');
  if jsonb_array_length((select a->'recommendations' from jsonb_array_elements(v_board->'agendas') a where a->>'id'=v_agenda::text))<>0 then
    raise exception 'archived recommendation remained in team board';
  end if;

  perform climate_vote.agenda_archive_v2(
    v_hq,'0912-deliberation',v_agenda,'검증 후 보관',gen_random_uuid()
  );
  v_board:=climate_vote.agenda_board_v2(v_team_a_token,'0912-deliberation');
  if exists(select 1 from jsonb_array_elements(v_board->'agendas') a where a->>'id'=v_agenda::text) then
    raise exception 'archived agenda remained in team board';
  end if;
  v_board:=climate_vote.agenda_board_v2(v_hq,'0912-deliberation');
  if not coalesce((select (a->>'archived')::boolean from jsonb_array_elements(v_board->'agendas') a where a->>'id'=v_agenda::text),false) then
    raise exception 'HQ board did not preserve archived agenda';
  end if;
  v_result:=climate_vote.recommendation_archive_v2(
    v_team_b_token,'0912-deliberation',v_rec_b,'중복 권고안 보관',v_request
  );
  if not coalesce((v_result->>'replayed')::boolean,false) then
    raise exception 'archive replay under archived parent lost idempotency';
  end if;

  begin
    perform climate_vote.recommendation_create_v2(
      v_team_a_token,'0912-deliberation',v_agenda,v_team_a,
      '보관 의제 하위 신규 권고안','배경','권고 내용',null,gen_random_uuid()
    );
    raise exception 'archived parent recommendation create unexpectedly succeeded';
  exception when others then
    if sqlerrm='archived parent recommendation create unexpectedly succeeded' then raise; end if;
    if sqlerrm<>'archived agenda cannot accept recommendations' then raise; end if;
  end;
  begin
    perform climate_vote.recommendation_revise_v2(
      v_team_a_token,'0912-deliberation',v_rec_a,
      '보관 의제 하위 수정','수정 배경','수정 권고 내용',null,3,gen_random_uuid()
    );
    raise exception 'archived parent recommendation revise unexpectedly succeeded';
  exception when others then
    if sqlerrm='archived parent recommendation revise unexpectedly succeeded' then raise; end if;
    if sqlerrm<>'parent agenda is archived' then raise; end if;
  end;
  begin
    perform climate_vote.recommendation_progress_v2(
      v_team_a_token,'0912-deliberation',v_rec_a,'confirm',null,gen_random_uuid()
    );
    raise exception 'archived parent recommendation progress unexpectedly succeeded';
  exception when others then
    if sqlerrm='archived parent recommendation progress unexpectedly succeeded' then raise; end if;
    if sqlerrm<>'parent agenda is archived' then raise; end if;
  end;
  begin
    perform climate_vote.recommendation_archive_v2(
      v_team_a_token,'0912-deliberation',v_rec_a,'상위 의제 보관 후 하위 보관',gen_random_uuid()
    );
    raise exception 'archived parent recommendation archive unexpectedly succeeded';
  exception when others then
    if sqlerrm='archived parent recommendation archive unexpectedly succeeded' then raise; end if;
    if sqlerrm<>'parent agenda is archived' then raise; end if;
  end;

  begin
    update climate_vote.agenda_recommendation_revision set title='tampered' where recommendation_id=v_rec_a;
    raise exception 'revision history update unexpectedly succeeded';
  exception when others then
    if sqlerrm='revision history update unexpectedly succeeded' then raise; end if;
  end;
  begin
    delete from climate_vote.agenda_recommendation_progress_event where recommendation_id=v_rec_a;
    raise exception 'progress history delete unexpectedly succeeded';
  exception when others then
    if sqlerrm='progress history delete unexpectedly succeeded' then raise; end if;
  end;
end
$verify$;

rollback;

select '20260912_s24_recommendation_workflow verification passed' as result;
