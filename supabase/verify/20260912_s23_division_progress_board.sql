begin;

do $verify$
declare
  v_session uuid := '91200000-0000-0000-0000-000000000003';
  v_topic uuid := '91200000-0000-0000-0000-000000000021';
  v_team_a uuid := '91200000-0000-0000-0000-000000000011';
  v_team_b uuid := '91200000-0000-0000-0000-000000000012';
  v_agenda uuid := '91210000-0000-4000-8000-000000000001';
  v_hq text;
  v_team_token text;
  v_board jsonb;
  v_request uuid;
begin
  if (select count(*) from climate_vote.agenda_item where session_id=v_session) <> 25
     or (select count(*) from climate_vote.agenda_item where session_id=v_session and subgroup='1분과') <> 9
     or (select count(*) from climate_vote.agenda_item where session_id=v_session and subgroup='2분과') <> 8
     or (select count(*) from climate_vote.agenda_item where session_id=v_session and subgroup='3분과') <> 8 then
    raise exception 'agenda catalog is not 9/8/8';
  end if;

  update climate_vote.team set subgroup='1분과' where id in (v_team_a,v_team_b);
  update climate_vote.discussion_topic set status='open' where id=v_topic;
  v_hq:=climate_vote.attendance_issue_token('hq',null,'Agenda verifier HQ');
  v_team_token:=climate_vote.attendance_issue_token('team',v_team_a,'Agenda verifier team');

  v_board:=climate_vote.agenda_board_v1(v_hq,'0912-deliberation');
  if jsonb_array_length(v_board->'agendas')<>25
     or jsonb_array_length(v_board->'teams')<>2 then
    raise exception 'HQ board must see all agendas and teams';
  end if;

  perform climate_vote.agenda_assignment_set_v1(
    v_hq,'0912-deliberation',v_agenda,v_team_a,true,gen_random_uuid());
  perform climate_vote.agenda_assignment_set_v1(
    v_hq,'0912-deliberation',v_agenda,v_team_b,true,gen_random_uuid());
  if (select count(*) from climate_vote.agenda_assignment_event where agenda_id=v_agenda and assigned)<>2 then
    raise exception 'multi-team assignment failed';
  end if;

  v_board:=climate_vote.agenda_board_v1(v_team_token,'0912-deliberation');
  if jsonb_array_length(v_board->'agendas')<>1
     or jsonb_array_length(v_board->'teams')<>1
     or jsonb_array_length((v_board->'agendas'->0)->'assignments')<>1 then
    raise exception 'team board must expose only its assigned agenda and team';
  end if;

  begin
    perform climate_vote.agenda_assignment_set_v1(
      v_team_token,'0912-deliberation',v_agenda,v_team_a,false,gen_random_uuid());
    raise exception 'team assignment mutation unexpectedly succeeded';
  exception when others then
    if sqlerrm='team assignment mutation unexpectedly succeeded' then raise; end if;
  end;

  foreach v_request in array array[gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid()]
  loop
    perform climate_vote.agenda_progress_write_v1(
      v_team_token,'0912-deliberation',v_topic,v_agenda,v_team_a,
      case (select count(*) from climate_vote.agenda_progress_event where agenda_id=v_agenda and team_id=v_team_a)
        when 0 then 'start' when 1 then 'save' when 2 then 'confirm' else 'submit' end,
      '시민에게 공유할 검증용 문안',null,v_request);
  end loop;
  if (select status from climate_vote.agenda_progress_event where agenda_id=v_agenda and team_id=v_team_a order by id desc limit 1)<>'submitted' then
    raise exception 'five-state team progression failed';
  end if;

  v_request:=gen_random_uuid();
  perform climate_vote.agenda_progress_write_v1(
    v_hq,'0912-deliberation',v_topic,v_agenda,v_team_a,'revision_request',null,
    '근거와 실행 주체를 보완해 주세요.',v_request);
  perform climate_vote.agenda_progress_write_v1(
    v_hq,'0912-deliberation',v_topic,v_agenda,v_team_a,'revision_request',null,
    '중복 호출은 새 행을 만들지 않아야 합니다.',v_request);
  if (select count(*) from climate_vote.agenda_progress_event where request_id=v_request)<>1
     or (select status from climate_vote.agenda_progress_event where request_id=v_request)<>'drafting' then
    raise exception 'revision or idempotency contract failed';
  end if;

  begin
    update climate_vote.agenda_progress_event
       set actor_label='tampered'
     where request_id=v_request;
    raise exception 'progress history update unexpectedly succeeded';
  exception when others then
    if sqlerrm='progress history update unexpectedly succeeded' then raise; end if;
  end;

  begin
    delete from climate_vote.agenda_assignment_event
     where agenda_id=v_agenda and team_id=v_team_b;
    raise exception 'assignment history delete unexpectedly succeeded';
  exception when others then
    if sqlerrm='assignment history delete unexpectedly succeeded' then raise; end if;
  end;
end
$verify$;

rollback;

select '20260912_s23_division_progress_board verification passed' as result;
