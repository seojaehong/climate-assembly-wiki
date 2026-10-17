-- s30 (2026-10-17): /b 명단 조회(ballot_roster_get)를 「지금 받는 투표」로만 좁힌다(검토 지적 MED).
-- s28 은 마감·공개된 투표에도, 세션·회의·기관이 꺼졌거나 접속 기한이 지난 뒤에도 명단을 내줬다.
-- 이제 ballot_submit_named 와 같은 조건(투표 open · 보관 안 됨 · 세션 active · access_expires_at>now() ·
-- 회의 active · 기관 active)일 때만 명단을 주고, 그 밖에는 빈 명단(roster [])을 준다. 함수 모양(인자·반환 키)은 그대로.
-- 화면(/b)은 명단을 투표 중(open)일 때만 쓴다 — 마감·공개 화면은 명단이 필요 없다.
-- 되돌리기: supabase/rollbacks/20261017_s30_roster_get_open_only_BEFORE.sql (s28 정의로 되돌림)

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
  -- 받는 중인 투표가 아니면(마감·공개, 또는 행사 접속이 끝남) 명단을 주지 않는다.
  perform 1
    from climate_vote.ballot b
    join climate_vote.session s on s.id=b.session_id
      and s.org_id=b.org_id and s.status='active'
      and s.access_expires_at is not null and s.access_expires_at>now()
    join climate_vote.assembly a on a.id=s.assembly_id
      and a.org_id=s.org_id and a.status='active' and a.archived_at is null
    join climate_vote.org o on o.id=s.org_id
      and o.status='active' and o.archived_at is null
   where b.id=v_ballot.id and b.status='open' and b.archived_at is null;
  if not found then
    return jsonb_build_object('ballot_id', v_ballot.id, 'subgroup', v_ballot.subgroup, 'roster', '[]'::jsonb);
  end if;
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
-- create or replace 라 기존 grant 가 남지만, 짝을 다시 적어 둔다.
grant execute on function climate_vote.ballot_roster_get(text) to anon, authenticated;
revoke execute on function climate_vote.ballot_roster_get(text) from public;
