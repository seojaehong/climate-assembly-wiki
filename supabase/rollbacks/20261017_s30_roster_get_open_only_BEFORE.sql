-- s30 되돌리기: ballot_roster_get 을 s28 정의(마감·공개 투표에도 명단을 줌)로 돌린다.

create or replace function climate_vote.ballot_roster_get(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = climate_vote, extensions, pg_temp
as $function$
declare v_ballot climate_vote.ballot; v_rows jsonb;
begin
  if p_token is null or length(p_token)<>32 then return null; end if;
  select * into v_ballot from climate_vote.ballot
   where token = p_token and status in ('open','closed','published') and archived_at is null;
  if not found then return null; end if;
  -- 실명 수집이 꺼져 있으면 빈 명단 = /b 는 지금과 같은 무기명.
  if not coalesce((climate_vote.session_named_vote(v_ballot.session_id)->>'collect')::boolean, true) then
    return jsonb_build_object('ballot_id', v_ballot.id, 'subgroup', v_ballot.subgroup, 'roster', '[]'::jsonb);
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'team', r.team_label, 'no', r.no, 'name', r.name)
           order by r.team_label, r.no nulls last, r.name), '[]'::jsonb)
    into v_rows
    from climate_vote.ballot_roster r
   where r.session_id = v_ballot.session_id
     and (nullif(btrim(v_ballot.subgroup),'') is null or r.subgroup = btrim(v_ballot.subgroup));
  return jsonb_build_object('ballot_id', v_ballot.id, 'subgroup', v_ballot.subgroup, 'roster', v_rows);
end $function$;
grant execute on function climate_vote.ballot_roster_get(text) to anon, authenticated;
revoke execute on function climate_vote.ballot_roster_get(text) from public;
