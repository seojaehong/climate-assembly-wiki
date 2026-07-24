-- fix(mod-console): 최종리뷰 반영 — 마감된 라운드로의 표 삽입 차단.
-- WHY: /v 스테일 탭(브라우저 캐시된 옛 round.id)이나 직접 REST 호출로 이미 closed된
--      라운드에 표를 꽂으면 확정된 결과가 사후에 오염될 수 있다(불변성 위반).
-- WHAT: votes BEFORE INSERT 트리거 — round가 status='active'가 아니면 예외를 던진다.
-- SAFETY: 순수 additive. active 라운드로의 정상 insert 경로는 영향 없음.
create or replace function climate_vote.votes_require_active_round()
returns trigger language plpgsql security definer
set search_path = climate_vote, pg_temp as $$
begin
  if not exists (select 1 from climate_vote.rounds r where r.id = new.round_id and r.status = 'active') then
    raise exception 'round not active';
  end if;
  return new;
end $$;
drop trigger if exists votes_active_round_guard on climate_vote.votes;
create trigger votes_active_round_guard before insert on climate_vote.votes
  for each row execute function climate_vote.votes_require_active_round();
