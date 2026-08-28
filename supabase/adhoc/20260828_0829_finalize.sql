-- ═══════════════════════════════════════════════════════════════════
-- 8.29 마무리 SQL — Supabase SQL Editor 에 통째로 붙여 Run
--   1) s12 온톨로지 종류 저장   2) s13 조 자체 재오픈
--   3) 테스트로 남은 줄 2개 정리 (내용은 아카이브에 그대로 남는다)
-- ★ 「RLS 없이 테이블 생성」 경고가 뜨면 [Run without RLS] 를 고르세요.
-- ═══════════════════════════════════════════════════════════════════

-- ───────── 1) s12 ─────────
-- s12: 온톨로지 종류(쟁점·주장·제안·우려·조건·가치·근거) 배정 영속화
--
-- 배경 — US-013이 만든 「온톨로지」 관점은 화면 상태(useState)뿐이라 새로고침하면 전부
-- 날아갔다. 총괄모더레이터 여럿이 각자 기기에서 붙이는데 서로 보이지도 않았다.
-- 4범주(s9)와 같은 방식으로 서버에 남긴다.
--
-- ── 왜 append-only 인가 (s9와 같은 이유) ────────────────────────────
-- 「누가·언제 붙였는지」와 「되돌릴 수 있어야 한다」를 함께 지키려면, 현재 값만 덮어쓰는
-- 표로는 안 된다. 되돌린 순간 앞 배정이 사라지기 때문이다. 배정을 **사건**으로 쌓고
-- 현재 상태는 「항목별 마지막 사건」으로 읽는다. 해제는 kind = null 사건 한 줄이다.
--
-- ── 왜 (submission_id, item_ordinal) 인가 (s9와 같은 이유) ──────────
-- submission_save 가 항목을 통째로 갈아끼우므로 submission_item.id 는 조가 한 줄 고칠
-- 때마다 바뀐다. uuid 로 걸면 배정이 매번 끊긴다. 원문 표로 가는 외래키도 일부러 걸지
-- 않는다 — cascade 면 조가 저장할 때 이력이 조용히 지워지고, cascade 없이 걸면 본부가
-- 배정했다는 이유로 조의 저장이 실패한다. 둘 다 원문 표의 동작을 바꾸는 일이다.
--
-- ★ 이 마이그레이션은 원문을 한 글자도 건드리지 않는다.
--   submission / submission_item / submission_item_archive 에 대한 alter·update·delete 없음.

create table if not exists climate_vote.submission_kind_event (
  id bigint generated always as identity primary key,
  submission_id uuid not null references climate_vote.submission(id),
  item_ordinal int not null check (item_ordinal >= 1),
  -- null = 해제. 일곱 값은 src/islands/mod/ontology-kind.ts 및
  -- automation/canvas-ontology-bridge.mjs 의 CANVAS_ONTOLOGY_NODE_KINDS 와 같아야 한다.
  kind text check (kind is null or kind in
    ('Issue','Claim','Proposal','Concern','Condition','Value','Evidence')),
  actor_scope text not null default 'hq' check (actor_scope in ('hq')),
  actor_label text not null,
  created_at timestamptz not null default now()
);

create index if not exists submission_kind_event_item_idx
  on climate_vote.submission_kind_event(submission_id, item_ordinal, id desc);

alter table climate_vote.submission_kind_event enable row level security;
revoke all on climate_vote.submission_kind_event from anon, authenticated;

create or replace function climate_vote.hq_submission_kind_assign(
  p_token text, p_submission_id uuid, p_item_ordinal int, p_kind text)
returns void
language plpgsql security definer
set search_path = climate_vote, extensions, pg_temp as $ka$
declare
  v_auth climate_vote.attendance_auth_session;
begin
  v_auth := climate_vote.attendance_token_row(p_token);
  if v_auth.scope <> 'hq' then
    raise exception 'HQ authorization required';
  end if;
  if p_kind is not null and p_kind not in
     ('Issue','Claim','Proposal','Concern','Condition','Value','Evidence') then
    raise exception 'unknown kind: %', p_kind;
  end if;
  insert into climate_vote.submission_kind_event
    (submission_id, item_ordinal, kind, actor_scope, actor_label)
  values (p_submission_id, p_item_ordinal, p_kind, 'hq', v_auth.actor_label);
end $ka$;

grant execute on function climate_vote.hq_submission_kind_assign(text, uuid, int, text)
  to anon, authenticated;
revoke execute on function climate_vote.hq_submission_kind_assign(text, uuid, int, text)
  from public;

create or replace function climate_vote.hq_submission_kinds(
  p_token text, p_session_slug text default '0829-deliberation')
returns table(
  topic_id uuid, team_id uuid, submission_id uuid, item_ordinal int,
  kind text, actor_label text, assigned_at timestamptz)
language plpgsql security definer
set search_path = climate_vote, extensions, pg_temp as $ks$
declare
  v_auth climate_vote.attendance_auth_session;
begin
  v_auth := climate_vote.attendance_token_row(p_token);
  if v_auth.scope <> 'hq' then
    raise exception 'HQ authorization required';
  end if;
  return query
  with latest as (
    select distinct on (e.submission_id, e.item_ordinal)
           e.submission_id, e.item_ordinal, e.kind, e.actor_label, e.created_at
    from climate_vote.submission_kind_event e
    join climate_vote.submission s on s.id = e.submission_id
    join climate_vote.discussion_topic dt on dt.id = s.topic_id
    join climate_vote.session ses on ses.id = dt.session_id and ses.slug = p_session_slug
    order by e.submission_id, e.item_ordinal, e.id desc
  )
  select s.topic_id, s.team_id, l.submission_id, l.item_ordinal,
         l.kind, l.actor_label, l.created_at
  from latest l
  join climate_vote.submission s on s.id = l.submission_id
  order by s.topic_id, s.team_id, l.item_ordinal;
end $ks$;

grant execute on function climate_vote.hq_submission_kinds(text, text) to anon, authenticated;
revoke execute on function climate_vote.hq_submission_kinds(text, text) from public;

-- ───────── 2) s13 ─────────
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

-- ───────── 3) 테스트로 남은 줄 정리 ─────────
-- 잠긴 제출물은 바로 못 고친다(final → draft 를 막는 가드). 재오픈을 거쳐 지우고
-- 원래 상태로 되돌린다. 지운 문장은 s8 아카이브에 자동으로 남으므로 유실이 아니다.
do $cleanup$
declare
  v_item record;
  v_prev text;
begin
  for v_item in
    select i.id as item_id, s.id as sub_id, s.status as sub_status,
           t.name as team_name, tp.prompt, i.content
      from climate_vote.submission_item i
      join climate_vote.submission s on s.id = i.submission_id
      join climate_vote.team t on t.id = s.team_id
      join climate_vote.topic tp on tp.id = s.topic_id
     where i.content like '[TEST]%' or i.content like '[검증]%'
  loop
    v_prev := v_item.sub_status;
    if v_prev = 'final' then
      update climate_vote.submission set status = 'reopened' where id = v_item.sub_id;
      insert into climate_vote.submission_lock_event
        (submission_id, action, actor_scope, actor_label, reason)
      values (v_item.sub_id, 'reopen', 'hq', 'sql:정리', '테스트 문장 제거');
    end if;

    delete from climate_vote.submission_item where id = v_item.item_id;

    -- 지우기 전 상태로 되돌린다. 테스트 줄 하나 지우자고 제출 상태를 바꾸지 않는다.
    if v_prev = 'final' then
      update climate_vote.submission set status = 'final' where id = v_item.sub_id;
    end if;

    raise notice '지움: % / % / %', v_item.team_name, v_item.prompt, v_item.content;
  end loop;
end $cleanup$;

-- 결과 확인 — 테스트 줄이 0건이어야 하고, 아카이브에는 남아 있어야 한다.
select
  (select count(*) from climate_vote.submission_item
    where content like '[TEST]%' or content like '[검증]%')            as 남은_테스트줄,
  (select count(*) from climate_vote.submission_item_archive
    where content like '[TEST]%' or content like '[검증]%')            as 아카이브_보존,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'climate_vote'
      and p.proname in ('hq_submission_kind_assign','hq_submission_kinds',
                        'submission_reopen_by_team'))                  as 새_함수_3개;
