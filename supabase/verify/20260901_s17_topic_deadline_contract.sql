-- s17 계약 스모크 — supabase/migrations/20260901_s17_topic_deadline.sql
--
-- ⚠️ **버려도 되는 DB 에서만 돌린다.** 이 파일은 세션·조·꼭지·토큰을 실제로 만든다.
--    전부 하나의 트랜잭션 안에 있고 마지막에 rollback 하지만, 운영 DB 에서 돌리지 말 것.
--    재현 환경은 supabase/verify/README.md 의 throwaway Postgres 16 레시피 그대로다.
--
-- 무엇을 확인하나 — 「함수가 존재한다」가 아니라 「조와 본부가 실제로 쓸 수 있다」
--   K1  anon 롤로 topic_list 가 돌아간다  ★ drop 후 grant 재부여의 진짜 증명
--       (권한 표만 보면 통과인데 실행이 막히는 경우가 있다)
--   K2  topic_list 가 draft 꼭지를 빼고 open 만 돌려준다 (s1 필터가 안 깨졌다)
--   K3  server_now 가 실제 서버 시각이다 (조 기기 시계 보정의 근거)
--   K4  본부 토큰으로 마감을 걸면 topic_list 에 그 시각이 그대로 실려 온다
--   K5  null 을 주면 마감이 지워진다 (본부 「지우기」 경로)
--   K6  조 토큰(scope='team')으로는 못 건다 — 'HQ authorization required'
--   K7  없는 꼭지 id 면 'topic not found'
--   K8  마감을 걸어도 꼭지 status 가 안 바뀐다 — 마감은 안내이지 잠금이 아니다

\set ON_ERROR_STOP on
set search_path = pg_catalog, climate_vote;

begin;

-- 환경 조정 (Supabase 전용 — 우리 SQL 의 버그가 아니다).
-- 운영에서는 climate_vote 가 「노출 스키마」라 anon 이 USAGE 를 이미 갖고 있고,
-- 그 grant 는 어느 마이그레이션에도 없다(플랫폼 설정). throwaway DB 에는 없으므로 여기서 준다.
-- 이 트랜잭션은 rollback 으로 끝나므로 남지 않는다.
grant usage on schema climate_vote to anon;

create temporary table s17_contract(seq int, name text, ok boolean, detail text);

do $contract$
declare
  v_session uuid;
  v_team    uuid;
  v_open    uuid;
  v_draft   uuid;
  v_hq      text;
  v_tok     text;
  v_rows    int;
  v_dead    timestamptz;
  v_srv     timestamptz;
  v_status  text;
  v_msg     text;
  v_target  constant timestamptz := timestamptz '2026-09-12 15:30:00+09';
begin
  -- 씨앗
  insert into climate_vote.session (slug, title, status)
       values ('s17-contract', 's17 계약 스모크', 'active') returning id into v_session;
  insert into climate_vote.team (session_id, name, join_code, status)
       values (v_session, '1조', '917001', 'active') returning id into v_team;
  insert into climate_vote.discussion_topic (session_id, ordinal, prompt, status)
       values (v_session, 1, '꼭지① 계약 스모크', 'open') returning id into v_open;
  insert into climate_vote.discussion_topic (session_id, ordinal, prompt, status)
       values (v_session, 2, '꼭지② 아직 안 열림', 'draft') returning id into v_draft;

  v_hq  := climate_vote.attendance_issue_token('hq', null, '본부');
  v_tok := climate_vote.attendance_issue_token('team', v_team, '1조');

  -- K1 · K2 · K3 — anon 롤로 실행.
  -- ★ anon 인 동안에는 임시표에 못 쓴다(권한 없음). 값만 변수에 담고 롤을 되돌린 뒤 기록한다.
  set local role anon;
  select count(*) into v_rows from climate_vote.topic_list('917001');
  select t.deadline_at, t.server_now into v_dead, v_srv
    from climate_vote.topic_list('917001') t where t.id = v_open;
  reset role;

  -- 여기까지 예외 없이 왔다는 사실 자체가 K1 이다.
  -- grant 를 빠뜨렸다면 위 두 줄이 'permission denied for function topic_list' 로 죽는다.
  insert into s17_contract values (1, 'anon 롤로 topic_list 실행 성공 ★grant 재부여 실증', true,
    format('%s행 반환', v_rows));
  insert into s17_contract values (2, 'draft 꼭지 제외 — open 1건만', v_rows = 1,
    format('기대 1 / 실제 %s', v_rows));
  insert into s17_contract values (3, 'server_now 가 서버 시각(±10초) · 첫 deadline_at 은 null',
    v_dead is null and abs(extract(epoch from (v_srv - clock_timestamp()))) < 10,
    format('deadline_at=%s server_now=%s', coalesce(v_dead::text, 'null'), v_srv));

  -- K4 — 본부가 마감을 건다
  perform climate_vote.topic_set_deadline(v_hq, v_open, v_target);
  select t.deadline_at into v_dead from climate_vote.topic_list('917001') t where t.id = v_open;
  insert into s17_contract values (4, '본부가 건 마감이 topic_list 에 그대로 실린다',
    v_dead = v_target, format('기대 %s / 실제 %s', v_target, coalesce(v_dead::text, 'null')));

  -- K8 — 마감은 잠금이 아니다
  select status into v_status from climate_vote.discussion_topic where id = v_open;
  insert into s17_contract values (8, '마감을 걸어도 꼭지 status 가 안 바뀐다(잠금 아님)',
    v_status = 'open', format('status=%s', v_status));

  -- K5 — null 로 지우기
  perform climate_vote.topic_set_deadline(v_hq, v_open, null);
  select t.deadline_at into v_dead from climate_vote.topic_list('917001') t where t.id = v_open;
  insert into s17_contract values (5, 'null 을 주면 마감이 지워진다(본부 「지우기」)',
    v_dead is null, format('deadline_at=%s', coalesce(v_dead::text, 'null')));

  -- K6 — 조 토큰 거부
  begin
    perform climate_vote.topic_set_deadline(v_tok, v_open, v_target);
    insert into s17_contract values (6, '조 토큰(scope=team)은 마감을 못 건다', false, '거부되지 않았다 ★');
  exception when others then
    get stacked diagnostics v_msg = message_text;
    insert into s17_contract values (6, '조 토큰(scope=team)은 마감을 못 건다',
      v_msg = 'HQ authorization required', v_msg);
  end;

  -- K7 — 없는 꼭지
  begin
    perform climate_vote.topic_set_deadline(v_hq, '00000000-0000-0000-0000-000000000000'::uuid, v_target);
    insert into s17_contract values (7, '없는 꼭지 id 는 topic not found', false, '거부되지 않았다 ★');
  exception when others then
    get stacked diagnostics v_msg = message_text;
    insert into s17_contract values (7, '없는 꼭지 id 는 topic not found',
      v_msg = 'topic not found', v_msg);
  end;
end
$contract$;

select seq, case when ok then 'PASS' else 'FAIL' end as result, name, detail
  from s17_contract order by seq;

select format('s17 contract: %s/%s PASS', count(*) filter (where ok), count(*)) as summary
  from s17_contract;

do $gate$
declare v_fail int;
begin
  select count(*) into v_fail from s17_contract where not ok;
  if v_fail > 0 then
    raise exception 's17 contract failed: % check(s) did not pass', v_fail;
  end if;
end
$gate$;

-- 씨앗은 남기지 않는다.
rollback;
