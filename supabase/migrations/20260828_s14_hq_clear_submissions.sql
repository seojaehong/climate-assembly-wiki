-- s14: 본부에서 조별 산출물 전체 비우기
--
-- ── 왜 필요한가 ──────────────────────────────────────────────────────
-- 8.29 당일 오전에 15개 조가 더미 값을 넣어 화면을 익힌다. 오후 본 숙의는 그 값이
-- 지워진 상태에서 시작해야 한다. 지금은 조가 하나씩 지우거나 SQL Editor를 여는 수밖에
-- 없는데, 15개 조 × 꼭지 3개를 행사 중에 그렇게 치우는 건 불가능하다.
--
-- ── 왜 위험한데도 만드나 ─────────────────────────────────────────────
-- 이건 15개 조의 글을 한 번에 지우는 버튼이다. 그럼에도 두는 이유는, 대안이
-- 「본부가 SQL Editor에서 delete 를 직접 친다」이기 때문이다. 그쪽이 훨씬 위험하다 —
-- where 절 하나 틀리면 되돌릴 수 없고, 누가 언제 했는지도 안 남는다.
--
-- 대신 세 겹으로 막는다.
--   1) 본부 토큰이 있어야 한다(조는 부를 수 없다)
--   2) **확인 문구를 정확히 타이핑**해야 한다 — 잘못 누른 클릭으로는 절대 안 지워진다
--   3) 지운 문장은 s8 아카이브에 그대로 남는다. 되살리는 것은 SQL 한 줄이다
--
-- 그리고 누가 언제 몇 건을 지웠는지 submission_clear_event 에 남긴다.
--
-- ── 무엇을 지우고 무엇을 남기나 ──────────────────────────────────────
-- 지운다  : submission_item (조가 쓴 문장) — 아카이브로 복사된 뒤 사라진다
-- 남긴다  : submission 행 자체, 조·꼭지 구성, 4범주·온톨로지 배정 이력, 잠금 이력
--           → 조는 그대로 들어와 빈 화면에서 다시 쓰면 된다
--
-- 제출 상태는 draft 로 되돌린다. 잠긴 채 비어 있으면 그 조만 잠긴 빈 화면을 본다.

create table if not exists climate_vote.submission_clear_event (
  id bigint generated always as identity primary key,
  session_slug text not null,
  -- 지운 문장 수. 나중에 「그때 몇 건이 있었나」를 되짚는 유일한 단서다.
  cleared_items int not null,
  cleared_submissions int not null,
  actor_label text not null,
  created_at timestamptz not null default now()
);

alter table climate_vote.submission_clear_event enable row level security;
revoke all on climate_vote.submission_clear_event from anon, authenticated;

/**
 * 조별 산출물 전체 비우기.
 *
 * p_confirm 에 아래 문구를 **정확히** 넣어야 지운다. 오타 하나면 아무것도 안 지운다.
 *   전체 비우기
 *
 * 반환: 지운 문장 수·제출물 수. 지우기 전 값이므로 화면이 그대로 보고할 수 있다.
 */
create or replace function climate_vote.hq_clear_submissions(
  p_token text,
  p_session_slug text default '0829-deliberation',
  p_confirm text default null)
returns jsonb
language plpgsql security definer
set search_path = climate_vote, extensions, pg_temp as $clear$
declare
  v_auth climate_vote.attendance_auth_session;
  v_items int;
  v_subs int;
begin
  v_auth := climate_vote.attendance_token_row(p_token);
  if v_auth.scope <> 'hq' then
    raise exception 'HQ authorization required';
  end if;
  -- ★ 확인 문구. 이 검사가 「잘못 눌렀다」와 「정말 지우려 한다」를 가른다.
  if coalesce(trim(p_confirm), '') <> '전체 비우기' then
    raise exception '확인 문구가 맞지 않습니다';
  end if;

  select count(*) into v_items
    from climate_vote.submission_item i
    join climate_vote.submission s on s.id = i.submission_id
    join climate_vote.discussion_topic dt on dt.id = s.topic_id
    join climate_vote.session ses on ses.id = dt.session_id and ses.slug = p_session_slug;

  select count(*) into v_subs
    from climate_vote.submission s
    join climate_vote.discussion_topic dt on dt.id = s.topic_id
    join climate_vote.session ses on ses.id = dt.session_id and ses.slug = p_session_slug;

  -- 잠긴 제출물은 항목을 지울 수 없다(submission_item_lock_guard).
  -- reopened 를 거친다 — 가드가 막는 것은 old='final' 에서 나가는 전이뿐이다.
  update climate_vote.submission s set status = 'reopened'
    from climate_vote.discussion_topic dt, climate_vote.session ses
   where dt.id = s.topic_id and ses.id = dt.session_id and ses.slug = p_session_slug
     and s.status = 'final';

  -- 삭제 트리거(s8)가 문장을 submission_item_archive 로 복사한다 — 유실이 아니다.
  delete from climate_vote.submission_item i
   using climate_vote.submission s, climate_vote.discussion_topic dt, climate_vote.session ses
   where s.id = i.submission_id and dt.id = s.topic_id
     and ses.id = dt.session_id and ses.slug = p_session_slug;

  update climate_vote.submission s set status = 'draft'
    from climate_vote.discussion_topic dt, climate_vote.session ses
   where dt.id = s.topic_id and ses.id = dt.session_id and ses.slug = p_session_slug
     and s.status <> 'draft';

  insert into climate_vote.submission_clear_event
    (session_slug, cleared_items, cleared_submissions, actor_label)
  values (p_session_slug, v_items, v_subs, v_auth.actor_label);

  return jsonb_build_object('cleared_items', v_items, 'cleared_submissions', v_subs);
end $clear$;

grant execute on function climate_vote.hq_clear_submissions(text, text, text) to anon, authenticated;
revoke execute on function climate_vote.hq_clear_submissions(text, text, text) from public;

-- ── 되살리기 (필요할 때 SQL Editor에서) ──────────────────────────────
-- 아카이브에서 마지막 판을 되돌린다. 실수로 비웠을 때 쓴다.
--
--   insert into climate_vote.submission_item (submission_id, ordinal, kind, content, rationale)
--   select a.submission_id, a.ordinal, coalesce(a.kind,'core'), a.content, a.rationale
--     from climate_vote.submission_item_archive a
--     join (select submission_id, ordinal, max(id) as id
--             from climate_vote.submission_item_archive group by 1,2) last
--       on last.id = a.id;
