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
