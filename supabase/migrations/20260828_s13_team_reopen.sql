-- s13: 조가 스스로 최종 제출을 다시 연다
--
-- ── 왜 승인을 없애나 ────────────────────────────────────────────────
-- 지금은 조가 「최종 제출」을 잘못 누르면 본부만 풀 수 있다(s1 submission_reopen).
-- 8.29에는 15개 조가 동시에 돌고 본부 5인은 각자 분과 진행에 매여 있다. 재오픈을
-- 본부가 일일이 받으면 조가 그동안 멈춘다 — 조별 숙의는 분 단위로 짜여 있어
-- 몇 분의 대기가 그 조의 산출을 통째로 날린다.
--
-- 위험이 낮은 이유
--   · 조는 **자기 제출물만** 연다(조 코드로 스코프가 잠긴다)
--   · 연다고 내용이 사라지지 않는다 — 잠금만 풀린다
--   · 누가 언제 열었는지 submission_lock_event 에 남는다(본부가 나중에 본다)
--   · 조가 저장하며 교체한 문장은 s8 아카이브에 그대로 있다
--
-- 본부 경로(submission_reopen)는 그대로 둔다 — 조가 자리를 떴을 때 본부가 열어야 한다.
--
-- ★ 사유를 요구하지 않는다. 행사 중에 사유를 입력하게 하면 그 자체가 병목이 된다.
--   대신 actor_scope='team' 으로 남겨 본부 재오픈과 구분되게 한다.

create or replace function climate_vote.submission_reopen_by_team(
  p_code text, p_topic_id uuid)
returns jsonb
language plpgsql security definer
set search_path = climate_vote, pg_temp as $tr$
declare
  v_team climate_vote.team;
  v_sub climate_vote.submission;
begin
  select * into v_team from climate_vote.team
   where join_code = p_code and status = 'active';
  if not found then raise exception 'invalid join code'; end if;

  select * into v_sub from climate_vote.submission
   where topic_id = p_topic_id and team_id = v_team.id;
  if not found then raise exception 'nothing to reopen'; end if;
  if v_sub.status <> 'final' then
    raise exception 'only finalized submission can be reopened';
  end if;

  update climate_vote.submission
     set status = 'reopened'
   where id = v_sub.id;

  insert into climate_vote.submission_lock_event
    (submission_id, action, actor_scope, actor_label, reason)
  values (v_sub.id, 'reopen', 'team', 'mod:' || v_team.name, '조가 직접 다시 엶');

  return jsonb_build_object('id', v_sub.id, 'status', 'reopened');
end $tr$;

grant execute on function climate_vote.submission_reopen_by_team(text, uuid) to anon, authenticated;
revoke execute on function climate_vote.submission_reopen_by_team(text, uuid) from public;
