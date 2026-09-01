-- s19 계약 스모크 — supabase/migrations/20260902_s19_hq_topic_deadlines.sql
--
-- ⚠️ **버려도 되는 DB 에서만 돌린다.** 이 파일은 세션·조·꼭지·토큰을 실제로 만든다.
--    전부 하나의 트랜잭션 안에 있고 마지막에 rollback 하지만, 운영 DB 에서 돌리지 말 것.
--    재현 환경은 supabase/verify/README.md 의 throwaway Postgres 16 레시피 그대로다.
--
-- 무엇을 확인하나 — 「함수가 존재한다」가 아니라 「본부가 실제로 되읽을 수 있다」
--   K1  anon 롤로 hq_topic_deadlines 가 돌아간다 ★grant 실증
--       (권한 표만 보면 통과인데 실행이 막히는 경우가 있다)
--   K2  세션의 open·closed 꼭지를 ordinal 순으로 준다 — draft 는 뺀다
--       (본부 보드 hq_submissions:43 와 같은 집합이어야 화면이 「모름」과 「마감 없음」을
--        헷갈리지 않는다)
--   K3  ★ 되읽기 왕복 — s17 topic_set_deadline 으로 건 시각이 그대로 돌아온다.
--       **이것이 이 story 의 결함 그 자체다**(본부가 새로고침하면 자기가 뭘 걸었는지 몰랐다)
--   K4  null 로 지우면 되읽기도 null 이 된다
--   K5  ★ 조 토큰(scope='team')은 거부 — 'HQ authorization required'
--   K6  다른 세션의 꼭지는 안 섞인다(p_session_slug 로 갈린다)
--   K7  읽기 전용 — 부르고 나도 deadline_at 이 그대로다(아무것도 안 쓴다)

\set ON_ERROR_STOP on
set search_path = pg_catalog, climate_vote;

begin;

-- 환경 조정 (Supabase 전용 — 우리 SQL 의 버그가 아니다).
-- 운영에서는 climate_vote 가 「노출 스키마」라 anon 이 USAGE 를 이미 갖고 있고,
-- 그 grant 는 어느 마이그레이션에도 없다(플랫폼 설정). throwaway DB 에는 없으므로 여기서 준다.
grant usage on schema climate_vote to anon;

create temporary table s19_contract(seq int, name text, ok boolean, detail text);

do $contract$
declare
  v_session  uuid;
  v_other    uuid;
  v_team     uuid;
  v_open     uuid;
  v_closed   uuid;
  v_draft    uuid;
  v_hq       text;
  v_tok      text;
  v_rows     int;
  v_ords     int[];
  v_dead     timestamptz;
  v_before   timestamptz;
  v_msg      text;
  v_target   constant timestamptz := timestamptz '2026-09-12 15:30:00+09';
  v_slug     constant text := 's19-contract';
begin
  -- 씨앗
  insert into climate_vote.session (slug, title, status)
       values (v_slug, 's19 계약 스모크', 'active') returning id into v_session;
  insert into climate_vote.session (slug, title, status)
       values ('s19-contract-other', 's19 남의 세션', 'active') returning id into v_other;
  insert into climate_vote.team (session_id, name, join_code, status)
       values (v_session, '1분과 1조', '919001', 'active') returning id into v_team;
  insert into climate_vote.discussion_topic (session_id, ordinal, prompt, status)
       values (v_session, 1, '꼭지① 계약 스모크', 'open') returning id into v_open;
  insert into climate_vote.discussion_topic (session_id, ordinal, prompt, status)
       values (v_session, 2, '꼭지② 닫힌 것도 보인다', 'closed') returning id into v_closed;
  insert into climate_vote.discussion_topic (session_id, ordinal, prompt, status)
       values (v_session, 3, '꼭지③ 아직 안 열림', 'draft') returning id into v_draft;
  insert into climate_vote.discussion_topic (session_id, ordinal, prompt, status)
       values (v_other, 1, '남의 세션 꼭지', 'open');

  v_hq  := climate_vote.attendance_issue_token('hq', null, '본부');
  v_tok := climate_vote.attendance_issue_token('team', v_team, '1분과 1조');

  -- K1 · K2 — anon 롤로 실행.
  -- ★ anon 인 동안에는 임시표에 못 쓴다(권한 없음). 값만 변수에 담고 롤을 되돌린 뒤 기록한다.
  set local role anon;
  select count(*), array_agg(d.topic_ordinal order by d.topic_ordinal)
    into v_rows, v_ords
    from climate_vote.hq_topic_deadlines(v_hq, v_slug) d;
  reset role;

  -- 여기까지 예외 없이 왔다는 사실 자체가 K1 이다.
  -- grant 를 빠뜨렸다면 위 두 줄이 'permission denied for function hq_topic_deadlines' 로 죽는다.
  insert into s19_contract values (1, 'anon 롤로 hq_topic_deadlines 실행 성공 ★grant 실증', true,
    format('%s행 반환', v_rows));
  insert into s19_contract values (2, 'draft 제외 — open+closed 2건이 ordinal 순',
    v_rows = 2 and v_ords = array[1, 2],
    format('기대 2행 {1,2} / 실제 %s행 %s', v_rows, v_ords));

  -- K3 ★ 되읽기 왕복 — 이 story 의 결함 그 자체
  perform climate_vote.topic_set_deadline(v_hq, v_open, v_target);
  select d.deadline_at into v_dead
    from climate_vote.hq_topic_deadlines(v_hq, v_slug) d where d.topic_id = v_open;
  insert into s19_contract values (3, '★ 본부가 건 마감을 본부가 그대로 되읽는다',
    v_dead = v_target, format('기대 %s / 실제 %s', v_target, coalesce(v_dead::text, 'null')));

  -- K7 — 읽기 전용(부른 뒤에도 값이 그대로)
  select dt.deadline_at into v_before from climate_vote.discussion_topic dt where dt.id = v_open;
  perform * from climate_vote.hq_topic_deadlines(v_hq, v_slug);
  select dt.deadline_at into v_dead from climate_vote.discussion_topic dt where dt.id = v_open;
  insert into s19_contract values (7, '읽기 전용 — 불러도 deadline_at 이 안 바뀐다',
    v_dead is not distinct from v_before,
    format('전 %s / 후 %s', coalesce(v_before::text, 'null'), coalesce(v_dead::text, 'null')));

  -- K4 — 지우기가 되읽기에도 보인다
  perform climate_vote.topic_set_deadline(v_hq, v_open, null);
  select d.deadline_at into v_dead
    from climate_vote.hq_topic_deadlines(v_hq, v_slug) d where d.topic_id = v_open;
  insert into s19_contract values (4, 'null 로 지우면 되읽기도 null 이다',
    v_dead is null, format('deadline_at=%s', coalesce(v_dead::text, 'null')));

  -- K5 ★ 조 토큰 거부
  begin
    perform * from climate_vote.hq_topic_deadlines(v_tok, v_slug);
    insert into s19_contract values (5, '★ 조 토큰(scope=team)은 못 읽는다', false, '거부되지 않았다 ★');
  exception when others then
    get stacked diagnostics v_msg = message_text;
    insert into s19_contract values (5, '★ 조 토큰(scope=team)은 못 읽는다',
      v_msg = 'HQ authorization required', v_msg);
  end;

  -- K6 — 세션이 갈린다
  select count(*) into v_rows from climate_vote.hq_topic_deadlines(v_hq, 's19-contract-other');
  insert into s19_contract values (6, '다른 세션 slug 는 그 세션 꼭지만 준다',
    v_rows = 1, format('기대 1행 / 실제 %s행', v_rows));
end
$contract$;

select seq, case when ok then 'PASS' else 'FAIL' end as result, name, detail
  from s19_contract order by seq;

select format('s19 contract: %s/%s PASS', count(*) filter (where ok), count(*)) as summary
  from s19_contract;

do $gate$
declare v_fail int;
begin
  select count(*) into v_fail from s19_contract where not ok;
  if v_fail > 0 then
    raise exception 's19 contract failed: % check(s) did not pass', v_fail;
  end if;
end
$gate$;

-- 씨앗은 남기지 않는다.
rollback;
