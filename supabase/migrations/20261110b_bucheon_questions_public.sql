-- 부천 100인 공론장 — 전문가(연구진)·참가자 보기용 공개 질문 목록 (2026-11-10)
-- 재홍님 결정: 질문 내용은 공개돼도 된다. 숨긴 질문·출처·시각 등 운영 칸은 내보내지 않는다.

create or replace function public.bucheon_questions_public()
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'now', now(),
    'teams', (select count(*) from bucheon_team),
    'questions', coalesce((
      select jsonb_agg(jsonb_build_object('team_no', q.team_no, 'q1', q.q1, 'q2', q.q2,
                                          'group_lead', q.group_lead, 'hidden', false) order by q.team_no)
      from bucheon_question q where not q.hidden), '[]'::jsonb)
  );
$$;

revoke execute on function public.bucheon_questions_public() from public;
grant execute on function public.bucheon_questions_public() to anon, authenticated;
