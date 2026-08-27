-- s9: L3 4범주 배정 영속화 (공통·차이·갈등·질문)
--
-- 총괄모더레이터 3인이 각자 기기에서 배정하므로 배정이 서버에 남아야 한다.
-- 회의자료 260811이 「조별 결과 임의 통합」·「좋은 의견 선정」·「소수의견 삭제」를
-- 금지하므로 이 마이그레이션은 **원문을 한 글자도 건드리지 않는다.**
--   · submission / submission_item / submission_item_archive 에 대한
--     alter · update · delete 구문이 이 파일에 하나도 없다.
--   · 배정은 원문 옆에 붙는 별도 표이고, 카드를 지우거나 합치지 않는다.
--   · 「잠정」 구조화다 — 시민 검토 전에는 확정이 아니다(설계문서 §4).
--
-- ── 왜 append-only 인가 ──────────────────────────────────────────────
-- 설계문서 §4가 「누가·언제 묶었는지」와 「되돌릴 수 있어야 하고 책임이 남아야 한다」를
-- 함께 요구한다. 현재 배정만 덮어쓰는 표를 두면 되돌린 순간 앞 배정이 사라져
-- 두 요구가 서로를 잡아먹는다. 그래서 배정을 **사건**으로 쌓고 현재 상태는
-- 「항목별 마지막 사건」으로 읽는다. 되돌리기는 category = null 사건 한 줄이다.
--
-- ── 왜 항목 uuid 가 아니라 (submission_id, item_ordinal) 인가 ────────
-- submission_save 는 항목을 통째로 갈아끼운다(delete 후 insert, s8 재오픈 마이그레이션
-- 주석 참조). submission_item.id 는 조가 한 줄 고칠 때마다 바뀌므로 배정이 매번 끊긴다.
-- 게다가 hq_submissions 는 항목 uuid 를 내주지도 않는다.
-- (submission_id, item_ordinal) 은 본부 보드의 카드 id `topic:team:ordinal` 과 정확히
-- 같은 것을 가리킨다 — submission 이 (topic_id, team_id) 로 유일하기 때문이다.
--
-- ★ submission_item 으로 가는 외래키는 **일부러 걸지 않았다.**
--   · on delete cascade 로 걸면 조가 다시 저장하는 순간 배정 이력이 조용히 지워진다.
--   · cascade 없이 걸면 본부가 배정했다는 이유로 조의 저장이 실패한다
--     — 원문 표의 동작을 바꾸는 것이라 금지에 걸린다.
--   submission(id) 로만 건다. 제출물은 archived_at 으로 보관될 뿐 삭제되지 않는다.

create table if not exists climate_vote.submission_category_event (
  id bigint generated always as identity primary key,
  submission_id uuid not null references climate_vote.submission(id),
  item_ordinal int not null check (item_ordinal >= 1),
  -- null = 배정 해제. 네 문자열은 src/islands/mod/four-category.ts 의 FOUR_CATEGORIES 와
  -- 같아야 한다(한국어 라벨은 화면에만 있고 DB 에 들어오지 않는다).
  category text check (category is null or category in ('common','difference','conflict','question')),
  actor_scope text not null default 'hq' check (actor_scope in ('hq')),
  actor_label text not null,
  created_at timestamptz not null default now()
);

-- 「항목별 마지막 사건」 조회용. id desc 로 뽑는다(같은 초에 두 번 눌리면 시각은 동점이 된다).
create index if not exists submission_category_event_item_idx
  on climate_vote.submission_category_event(submission_id, item_ordinal, id desc);

alter table climate_vote.submission_category_event enable row level security;
-- 직접 접근은 막는다. 읽기·쓰기는 아래 RPC 두 개로만.
revoke all on climate_vote.submission_category_event from anon, authenticated;

-- ── 쓰기 — 본부 토큰만 ──────────────────────────────────────────────
-- attendance_hq_unlock 이 발급한 scope='hq' 토큰만 통과한다(s7 hq_submissions 와 같은 방식).
-- 조 토큰으로는 배정할 수 없다.

create or replace function climate_vote.hq_submission_category_assign(
  p_token text,
  p_submission_id uuid,
  p_item_ordinal int,
  p_category text)
returns void
language plpgsql security definer
set search_path = climate_vote, extensions, pg_temp as $assign$
declare
  v_auth climate_vote.attendance_auth_session;
begin
  v_auth := climate_vote.attendance_token_row(p_token);
  if v_auth.scope <> 'hq' then
    raise exception 'HQ authorization required';
  end if;

  if p_category is not null
     and p_category not in ('common','difference','conflict','question') then
    raise exception 'unknown category: %', p_category;
  end if;

  insert into climate_vote.submission_category_event
    (submission_id, item_ordinal, category, actor_scope, actor_label)
  values (p_submission_id, p_item_ordinal, p_category, 'hq', v_auth.actor_label);
end $assign$;

grant execute on function climate_vote.hq_submission_category_assign(text, uuid, int, text)
  to anon, authenticated;
-- PUBLIC 회수 — 이 리포의 다른 attendance_*/hq_* 함수와 같은 처리다.
-- (PUBLIC 을 남겨두면 anon 만 revoke 해도 닫히지 않는다.)
revoke execute on function climate_vote.hq_submission_category_assign(text, uuid, int, text)
  from public;

-- ── 읽기 — 항목별 마지막 배정 ───────────────────────────────────────
-- 「한 사람이 배정한 것을 다른 사람이 본다」가 이 story 의 목적이므로 읽기 경로가 있어야 한다.
--
-- ★ null 을 먼저 걸러내면 안 된다. 배정 → 해제 순으로 눌린 항목에서
--   where category is not null 을 distinct on 앞에 두면 **해제 직전 배정이 되살아난다.**
--   마지막 사건을 먼저 뽑고, 해제(null)는 그대로 내보내 화면이 판단하게 한다.
--
-- 보드 카드 id 와 잇도록 topic_id · team_id 를 함께 낸다
-- (카드 id 규격 = `${topic_id}:${team_id}:${item_ordinal}`).

create or replace function climate_vote.hq_submission_categories(
  p_token text, p_session_slug text default '0829-deliberation')
returns table(
  topic_id uuid, team_id uuid, submission_id uuid, item_ordinal int,
  category text, actor_label text, assigned_at timestamptz)
language plpgsql security definer
set search_path = climate_vote, extensions, pg_temp as $cats$
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
           e.submission_id, e.item_ordinal, e.category, e.actor_label, e.created_at
    from climate_vote.submission_category_event e
    join climate_vote.submission s on s.id = e.submission_id
    join climate_vote.discussion_topic dt on dt.id = s.topic_id
    join climate_vote.session ses on ses.id = dt.session_id and ses.slug = p_session_slug
    order by e.submission_id, e.item_ordinal, e.id desc
  )
  select s.topic_id, s.team_id, l.submission_id, l.item_ordinal,
         l.category, l.actor_label, l.created_at
  from latest l
  join climate_vote.submission s on s.id = l.submission_id
  order by s.topic_id, s.team_id, l.item_ordinal;
end $cats$;

grant execute on function climate_vote.hq_submission_categories(text, text) to anon, authenticated;
revoke execute on function climate_vote.hq_submission_categories(text, text) from public;
