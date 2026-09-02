-- s17: 꼭지별 마감 시각(deadline_at) + 본부 설정 RPC + topic_list 서버시각 반환
-- project: labor_money (pleyuknjnprsckssxvrh), schema: climate_vote
--
-- ── 왜 필요한가 ──────────────────────────────────────────────────────
-- 8.29 에 조들이 산출물을 제 시간에 못 올린 원인은 입력 난이도가 아니라 「마감 시각을
-- 조가 몰랐다」는 것이다. 타이머는 timer 탭에 있는데 조의 기본 탭은 submission 이라
-- (mod-tabs.ts:24-28) 조는 그 화면을 켜 본 적이 없다.
-- 마감을 코드가 아니라 **데이터**로 걸어(설계 B-D1) 회차마다 배포하지 않게 한다.
--
-- ── 무엇을 하나 ──────────────────────────────────────────────────────
--   1) discussion_topic.deadline_at timestamptz 추가 (nullable, 순수 additive)
--   2) topic_list 반환에 deadline_at 과 server_now(= now()) 추가
--   3) topic_set_deadline(p_token, p_topic_id, p_deadline_at) — 본부 전용 설정/해제
--
-- server_now 를 함께 주는 이유(설계 B-D3): 조 기기 시계는 못 믿는다. 클라가
-- offset = Date.parse(server_now) - Date.now() 를 잡아 잔여 시간을 계산한다.
-- 몇 분 어긋난 노트북에서 카운트다운이 거짓말을 하면 안 겪던 사고가 생긴다.
--
-- ── SAFETY ───────────────────────────────────────────────────────────
-- deadline_at 은 nullable 추가라 기존 행이 전부 null 이 된다. null 이면 화면은
-- 배너를 아예 그리지 않는다(설계 §2.4) → **DB 적용과 배포 순서에 묶이지 않는다.**
--
-- ★★ 이 파일의 최대 위험 = topic_list 의 grant 재부여다.
--    topic_list 는 returns table(...) 이라 컬럼을 늘리면 반환 타입이 바뀌고,
--    postgres 는 create or replace 로 반환 타입 변경을 거부한다(42P13).
--    그래서 drop 후 create 인데, **drop 하면 grant 도 같이 사라진다.**
--    새로 만든 함수는 PUBLIC EXECUTE 를 기본으로 갖고 anon·authenticated grant 는 없다.
--    재부여를 빠뜨리면 조 화면이 꼭지 목록을 못 불러 **전면 장애**가 난다.
--    아래 6절은 20260808_s1_assembly_topic_submission.sql:306-326 의 처리 그대로다.
--
-- ROLLBACK: supabase/rollbacks/20260901_s17_topic_deadline_BEFORE.sql
-- VERIFY  : supabase/verify/20260901_s17_topic_deadline.sql
--
-- ★ 적용 후 검증(anon 키, Content-Profile: climate_vote 필수):
--   POST /rest/v1/rpc/topic_list {"p_code":"<유효 join_code>"}
--     → 200 이고 각 행에 deadline_at·server_now 키가 있으면 적용됨
--     → 200 인데 키가 6개뿐이면 미적용 (PGRST202 면 함수 자체가 없음 = 사고)

-- ── 1. 컬럼 ──────────────────────────────────────────────────────────

alter table climate_vote.discussion_topic
  add column if not exists deadline_at timestamptz;

comment on column climate_vote.discussion_topic.deadline_at is
  '꼭지 마감 시각. null 이면 마감 없음(조 화면은 배너를 그리지 않는다). 본부가 topic_set_deadline 으로 건다.';

-- ── 2. topic_list 재정의 (DROP 후 CREATE — 반환 타입이 바뀐다) ───────

drop function if exists climate_vote.topic_list(text);

create function climate_vote.topic_list(p_code text)
returns table(id uuid, ordinal int, block text, prompt text,
              guidance text, status text,
              deadline_at timestamptz, server_now timestamptz)
language sql security definer
set search_path = climate_vote, pg_temp as $$
  select dt.id, dt.ordinal, dt.block, dt.prompt, dt.guidance, dt.status,
         dt.deadline_at, now()
  from climate_vote.discussion_topic dt
  join climate_vote.team t on t.session_id = dt.session_id
  where t.join_code = p_code and t.status = 'active'
    and dt.status in ('open','closed')
  order by dt.ordinal;
$$;

-- ── 3. 본부 전용: 마감 걸기 / 지우기 ────────────────────────────────
--
-- p_deadline_at 에 null 을 주면 마감을 **지운다**. 잘못 건 시각을 되돌리는 경로가
-- 이것 하나라 별도 함수를 두지 않는다(설계 §2.6 「지우기」 = null 전송).
-- 권한은 20260827_s7_hq_submissions.sql:25 · 20260828_s14 와 같은 패턴 —
-- attendance_hq_unlock 이 발급한 scope='hq' 토큰만 통과한다. 조 토큰으로는 못 건다.
--
-- 꼭지 status 는 건드리지 않는다. 마감은 「언제까지 쓰라」는 안내이지 잠금이 아니다.
-- 잠그는 것은 기존 submission_finalize·topic status 의 몫이고, 마감이 지났다고
-- 서버가 저장을 막으면 8.29 에 실제로 일어난 일(다 정리했는데 못 올림)이 반복된다.

create or replace function climate_vote.topic_set_deadline(
  p_token text, p_topic_id uuid, p_deadline_at timestamptz)
returns jsonb language plpgsql security definer
set search_path = climate_vote, extensions, pg_temp as $$
declare
  v_auth climate_vote.attendance_auth_session;
begin
  v_auth := climate_vote.attendance_token_row(p_token);
  if v_auth.scope <> 'hq' then
    raise exception 'HQ authorization required';
  end if;

  update climate_vote.discussion_topic
     set deadline_at = p_deadline_at
   where id = p_topic_id;
  if not found then raise exception 'topic not found'; end if;

  return jsonb_build_object('ok', true, 'topic_id', p_topic_id,
                            'deadline_at', p_deadline_at);
end $$;

-- ── 4. 권한: PUBLIC 회수 → anon + authenticated grant ───────────────
--
-- ★ topic_list 는 2절에서 drop 됐으므로 s1 의 grant 가 남아 있지 않다. 여기서
--   다시 걸지 않으면 조 화면이 전면 장애다. s1:306-326 과 같은 순서로 처리한다.

revoke execute on function
  climate_vote.topic_list(text),
  climate_vote.topic_set_deadline(text, uuid, timestamptz)
from public;

grant execute on function
  climate_vote.topic_list(text),
  climate_vote.topic_set_deadline(text, uuid, timestamptz)
to anon, authenticated;
