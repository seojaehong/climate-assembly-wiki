-- 부천 100인 공론장 — 세션1 질문을 카톡 단체방에서 받는다 (2026-11-10, 진행계획 4.0)
-- 조당 질문 1개(q2 선택), 본부가 묶기(group_lead)·숨기기(hidden) 지정, 브리지가 본부 키로 올린다.
-- 추가형 변경만 한다: 기존 행·기존 함수 서명은 그대로 둔다.

alter table public.bucheon_question alter column q2 drop not null;
alter table public.bucheon_question add column if not exists group_lead int;
alter table public.bucheon_question add column if not exists hidden boolean not null default false;
alter table public.bucheon_question add column if not exists source text not null default 'form';
alter table public.bucheon_question add column if not exists src_event text;
alter table public.bucheon_question add column if not exists sent_at timestamptz;

-- 조 화면(비상 입력): 질문 2는 이제 선택
create or replace function public.bucheon_submit_questions(p_code text, p_q1 text, p_q2 text, p_note text default null)
returns jsonb language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_team int := bucheon__team_no(p_code);
  v_q1 text := bucheon__clean(p_q1, 500, true, 'q1');
  v_q2 text := bucheon__clean(p_q2, 500, false, 'q2');
  v_note text := bucheon__clean(p_note, 1000, false, 'note');
  v_at timestamptz;
begin
  insert into bucheon_question (team_no, q1, q2, note, source, updated_at)
  values (v_team, v_q1, v_q2, v_note, 'form', now())
  on conflict (team_no) do update set q1 = excluded.q1, q2 = excluded.q2, note = excluded.note,
    source = 'form', src_event = null, sent_at = null, updated_at = now()
  returning updated_at into v_at;
  return jsonb_build_object('ok', true, 'team_no', v_team, 'updated_at', v_at);
end $$;

create or replace function public.bucheon__hq_check(p_key text)
returns void language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if p_key is null or not exists (select 1 from bucheon_config where id = 1 and hq_key = p_key) then
    raise exception 'invalid hq key' using errcode = 'P0001';
  end if;
end $$;

-- 브리지: 카톡에서 읽은 조별 질문. 같은 조는 더 늦게 보낸 글만 덮어쓴다(묶기·숨기기는 유지).
create or replace function public.bucheon_feed_question(p_key text, p_team_no int, p_q text, p_event text, p_sent_at timestamptz)
returns jsonb language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_q text := bucheon__clean(p_q, 500, true, 'q1');
  v_changed boolean;
begin
  perform bucheon__hq_check(p_key);
  if not exists (select 1 from bucheon_team where team_no = p_team_no) then
    raise exception 'invalid team' using errcode = 'P0001';
  end if;
  if p_event is null or p_sent_at is null then
    raise exception 'event is required' using errcode = 'P0001';
  end if;
  insert into bucheon_question (team_no, q1, q2, note, source, src_event, sent_at, updated_at)
  values (p_team_no, v_q, null, null, 'kakao', p_event, p_sent_at, now())
  on conflict (team_no) do update set q1 = excluded.q1, q2 = null, source = 'kakao',
    src_event = excluded.src_event, sent_at = excluded.sent_at, updated_at = now()
  where bucheon_question.sent_at is null or bucheon_question.sent_at < excluded.sent_at
     or (bucheon_question.src_event = excluded.src_event and bucheon_question.q1 <> excluded.q1);
  get diagnostics v_changed = row_count;
  return jsonb_build_object('ok', true, 'team_no', p_team_no, 'changed', v_changed);
end $$;

-- 본부: 묶기(대표 조 번호, null = 풀기)·숨기기
create or replace function public.bucheon_question_edit(p_key text, p_team_no int, p_group_lead int, p_hidden boolean)
returns jsonb language plpgsql volatile security definer set search_path = public, pg_temp as $$
begin
  perform bucheon__hq_check(p_key);
  if p_group_lead is not null and (p_group_lead = p_team_no or not exists (select 1 from bucheon_team where team_no = p_group_lead)) then
    raise exception 'invalid group' using errcode = 'P0001';
  end if;
  update bucheon_question set group_lead = p_group_lead, hidden = coalesce(p_hidden, false) where team_no = p_team_no;
  if not found then raise exception 'no question' using errcode = 'P0001'; end if;
  return jsonb_build_object('ok', true);
end $$;

revoke execute on function public.bucheon__hq_check(text) from public, anon, authenticated;
revoke execute on function public.bucheon_feed_question(text, int, text, text, timestamptz) from public;
revoke execute on function public.bucheon_question_edit(text, int, int, boolean) from public;
grant execute on function public.bucheon_feed_question(text, int, text, text, timestamptz) to anon, authenticated;
grant execute on function public.bucheon_question_edit(text, int, int, boolean) to anon, authenticated;
