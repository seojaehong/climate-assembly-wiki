-- s19: 본부가 꼭지 마감 시각을 **되읽는** RPC (hq_topic_deadlines)
-- project: labor_money (pleyuknjnprsckssxvrh), schema: climate_vote
--
-- ── 왜 필요한가 ──────────────────────────────────────────────────────
-- s17 이 본부에 「마감 걸기」(topic_set_deadline)를 줬지만 **읽는 경로를 주지 않았다.**
--   · hq_submissions 는 deadline_at 컬럼을 반환에 넣지 않는다(s7)
--   · topic_list 는 조 접속코드(p_code)를 요구한다 — 본부는 토큰만 갖는다(s17)
-- 그래서 /hq 화면은 「이 화면이 방금 건 값」만 되비출 수 있었고, **새로고침하면 본부가
-- 자기가 무엇을 걸었는지 모른다.** 9.12 운영에서 잘못 건 시각을 못 잡는다.
--
-- ── 왜 additive 인가 (hq_submissions 를 안 고친 이유) ────────────────
-- hq_submissions 에 deadline_at 을 얹으려면 반환 타입이 바뀌므로 `create or replace`
-- 가 안 되고 **drop 후 create** 여야 한다. 그런데 그것은
--   ① 운영 중인 핫 함수(본부 보드가 5초마다 부른다)를 스왑하는 것이고
--   ② drop 은 ACL 을 날린다 — 새 함수는 PUBLIC EXECUTE 를 기본으로 갖고
--      명시 grant 는 사라진다(2026-09-01 실측, migrations/AGENTS.md 참조).
-- 되읽기 하나를 얻자고 감수할 위험이 아니다. 그래서 **작은 함수를 새로 하나 더 둔다.**
-- 반환 3컬럼짜리 신규 함수라 `create or replace` 로 충분하고 기존 것을 아무것도 안 건드린다.
--
-- ── 선행 조건 ────────────────────────────────────────────────────────
-- ★ **s17(20260901_s17_topic_deadline.sql)이 먼저 적용돼 있어야 한다.**
--   discussion_topic.deadline_at 이 s17 에서 생긴다. plpgsql 함수 본문은 create 시점에
--   컬럼 존재를 검사하지 않으므로(check_function_bodies 가 켜져 있어도 SQL 문 안의
--   컬럼까지는 안 본다) **s17 없이 이 파일을 적용해도 조용히 성공하고 호출할 때 42703 으로
--   죽는다.** 파일명이 사전순으로 s17 뒤라 정상 적용 순서에서는 문제가 없다.
--
-- ── SAFETY ───────────────────────────────────────────────────────────
-- 순수 additive 다. 새 함수 하나만 만들고 표·기존 함수·권한을 하나도 건드리지 않는다.
-- 읽기 전용 — 아무것도 쓰지 않는다(마감을 거는 것은 s17 topic_set_deadline 의 몫).
-- 미적용 상태에서 화면이 이 함수를 부르면 PostgREST 가 PGRST202 를 낸다. 화면은 그때
-- **조용히 「모름」으로 퇴화**하고 마감 걸기·지우기는 그대로 동작한다(US-009 와 같은 방침).
--
-- ROLLBACK: supabase/rollbacks/20260902_s19_hq_topic_deadlines_BEFORE.sql
-- VERIFY  : supabase/verify/20260902_s19_hq_topic_deadlines.sql
--           supabase/verify/20260902_s19_hq_topic_deadlines_contract.sql
--
-- ★ 적용 후 검증(anon 키, Content-Profile: climate_vote 필수):
--   POST /rest/v1/rpc/hq_topic_deadlines {"p_token":"<본부 토큰>","p_session_slug":"0829-deliberation"}
--     → 200 + [{topic_id, topic_ordinal, deadline_at}] 이면 적용됨
--     → PGRST202 면 미적용 (조 토큰으로 부르면 'HQ authorization required')

-- ── 1. 본부 전용: 꼭지별 현재 마감 읽기 ─────────────────────────────
--
-- 권한 검사는 20260827_s7_hq_submissions.sql:25-28 · 20260901_s17:84-87 과 같은 패턴 —
-- attendance_hq_unlock 이 발급한 scope='hq' 토큰만 통과한다. 조 토큰으로는 못 읽는다.
--
-- ★ p_session_slug 에 기본값을 두지 않는다. hq_submissions 는 기본값을 갖고 있었고
--   2026-08-30 점검에서 그 기본값이 여섯 함수에 숨어 「9.12 에 새 세션을 열어도 본부
--   화면 전체가 8.29 를 가리키는」 사고 직전까지 갔다(src/lib/hq-submissions.ts:41-50).
--   호출부가 세션을 반드시 명시하게 둔다.
--
-- ★ 본문의 컬럼을 전부 dt. 로 한정한다 — topic_id·topic_ordinal·deadline_at 은 OUT
--   파라미터라 한정하지 않으면 이름이 가려진다(생성은 되고 **호출할 때** 42702 로 죽는다).

create or replace function climate_vote.hq_topic_deadlines(
  p_token text, p_session_slug text)
returns table(topic_id uuid, topic_ordinal int, deadline_at timestamptz)
language plpgsql security definer
set search_path = climate_vote, extensions, pg_temp as $$
declare
  v_auth climate_vote.attendance_auth_session;
begin
  v_auth := climate_vote.attendance_token_row(p_token);
  if v_auth.scope <> 'hq' then
    raise exception 'HQ authorization required';
  end if;

  return query
  select dt.id, dt.ordinal, dt.deadline_at
  from climate_vote.discussion_topic dt
  join climate_vote.session ses on ses.id = dt.session_id and ses.slug = p_session_slug
  -- hq_submissions(s7:43) 와 같은 필터 — 본부 보드에 뜨는 꼭지와 같은 집합이어야
  -- 화면이 「이 꼭지는 서버 값을 모른다」와 「마감이 없다」를 헷갈리지 않는다.
  where dt.status in ('open', 'closed')
  order by dt.ordinal;
end $$;

comment on function climate_vote.hq_topic_deadlines(text, text) is
  '본부 토큰으로 세션의 꼭지별 현재 마감(deadline_at)을 읽는다. 읽기 전용. s17 의 되읽기 짝.';

-- ── 2. 권한: PUBLIC 회수 → anon + authenticated grant ───────────────
--
-- ★ 순서를 지킨다 — revoke 먼저, grant 나중. anon 에게만 주면 **로그인 사용자가 403** 이
--   된다(2026-07-26 실제 장애, 20260726_grant_authenticated_execute.sql 머리말).
--   `create or replace` 는 기존 ACL 을 보존하므로 재적용해도 이 짝이 유지된다.

revoke execute on function
  climate_vote.hq_topic_deadlines(text, text)
from public;

grant execute on function
  climate_vote.hq_topic_deadlines(text, text)
to anon, authenticated;
