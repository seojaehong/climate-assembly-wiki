-- s20 적용 후 읽기 전용 검증 — supabase/migrations/20260902_s20_open_0912_topics.sql
--
-- 무엇을 확인하나
--   C1  세션 `0912-deliberation` 이 있다 (선행 = 검토·승인된 session/team seed)
--   C2  그 세션의 discussion_topic 이 **정확히 6행**이고 ordinal 이 1~6 빠짐없이 있다
--   C3  block 배치가 큐시트대로다 — 1·2·3=pm(9/12 오후·저녁) · 4·5=am · 6=pm(9/13)
--       ★ block 은 'am'|'pm' 뿐이라 날짜를 못 담는다. 그래서 C4 가 guidance 안의
--         「9/12(토) 1일차」·「9/13(일) 2일차」를 따로 센다
--   C4  prompt 6개가 큐시트 결과물 칸과 **글자 그대로** 같고, guidance 가 해당 일차·시각을 담는다
--   C5  status 가 스키마가 허용하는 값 안에 있다.
--       ★ **open 인지 draft 인지는 검사하지 않는다.** 이 값은 행사 당일 본부 감사 RPC가
--         하나씩 바꾸는 것이라, 특정 값으로 못박으면 행사 중에 이 검증이 거짓 실패한다
--   C6  ★ **8.29 무접촉** — `0829-deliberation` 의 꼭지가 s6 문안 그대로 3건 open 이다
--       (s6 가 ①배경·문제 인식 ②바라는 변화(기대 효과) ③의제와 관련된 질문 을 open 으로 고정했고
--        s6 자신의 게이트가 `v_open <> 3` 으로 이를 보증한다)
--   C7  활성 조 15개와 서로 다른 6자리 접속코드가 이 세션에 붙어 있다. 보안 migration 뒤
--       코드는 무작위로 교체되므로 과거의 날짜+순번 값 자체를 정답으로 고정하지 않는다
--
-- 이 파일은 DB 객체·데이터를 바꾸지 않는다. 세션 임시표 하나만 쓴다.
-- 마지막에 통과/전체 개수를 N/N 으로 찍고, 하나라도 실패하면 예외로 멈춘다.

\set ON_ERROR_STOP on
set search_path = pg_catalog, climate_vote;

-- ★ on commit drop 을 쓰지 않는다 — psql 은 문장마다 암시적 커밋이라 표가 즉시 사라진다.
drop table if exists s20_check;
create temporary table s20_check(seq int, name text, ok boolean, detail text);

do $verify$
declare
  v_session uuid;
  v_n int;
  v_rows int;   -- 0912 꼭지 실제 행 수. ★ C3·C4 가 「행이 0개라 어긋난 것도 0개」로
                --   공허하게 PASS 하는 것을 막는 데 쓴다(2026-09-02 음성 대조에서 실제로 그랬다).
  v_bad int;
  v_detail text;
  v_expect_block constant text[] := array['pm','pm','pm','am','am','pm'];
  v_expect_prompt constant text[] := array[
    '쟁점·입장 메모',
    '조별 제안정책 초안',
    '권고안 선정기준(조별 발산)',
    '교차 검토표',
    '보완 제안정책안',
    '분과 제안정책(최종 확정)'];
  -- 각 꼭지의 guidance 가 반드시 담아야 하는 「일차·시각」 (block 이 못 담는 정보)
  v_expect_when constant text[] := array[
    '9/12(토) 1일차 13:30~15:30',
    '9/12(토) 1일차 15:50~17:50',
    '9/12(토) 1일차 19:30~20:30',
    '9/13(일) 2일차 09:20~11:20',
    '9/13(일) 2일차 11:20~12:00',
    '9/13(일) 2일차 13:00~15:30'];
  -- s6 가 8.29 에 고정한 문안 (건드리지 않았음을 증명하는 대조군)
  v_0829_prompt constant text[] := array[
    '배경·문제 인식',
    '바라는 변화(기대 효과)',
    '의제와 관련된 질문'];
begin
  -- C1
  select id into v_session from climate_vote.session where slug = '0912-deliberation';
  insert into s20_check values (1, '세션 0912-deliberation 이 있다(선행: 검토된 session/team seed)',
    v_session is not null, coalesce(v_session::text, '(세션 없음 — 시드 미적용)'));

  if v_session is null then
    insert into s20_check values (2, '꼭지 6행 · ordinal 1~6', false, '세션 없음');
    insert into s20_check values (3, 'block = pm,pm,pm,am,am,pm', false, '세션 없음');
    insert into s20_check values (4, 'prompt 6개 큐시트 일치 · guidance 에 일차·시각', false, '세션 없음');
    insert into s20_check values (5, 'status 가 허용 값 안에 있다', false, '세션 없음');
    insert into s20_check values (7, '활성 조 15개와 고유한 6자리 접속코드가 이 세션에 붙어 있다', false, '세션 없음');
  else
    -- C2
    select count(*) into v_rows
      from climate_vote.discussion_topic where session_id = v_session;
    select count(*) into v_bad
      from generate_series(1, 6) g
     where not exists (select 1 from climate_vote.discussion_topic dt
                        where dt.session_id = v_session and dt.ordinal = g);
    insert into s20_check values (2, '꼭지 6행 · ordinal 1~6 빠짐없음',
      v_rows = 6 and v_bad = 0, format('행 %s개 · 빠진 ordinal %s개', v_rows, v_bad));

    -- C3
    select count(*), string_agg(format('#%s=%s(기대 %s)', dt.ordinal,
                                coalesce(dt.block, 'null'), v_expect_block[dt.ordinal]), ' ')
      into v_bad, v_detail
      from climate_vote.discussion_topic dt
     where dt.session_id = v_session and dt.ordinal between 1 and 6
       and coalesce(dt.block, '') is distinct from v_expect_block[dt.ordinal];
    -- ★ `v_rows = 6` 을 함께 본다 — 행이 0개면 「어긋난 것도 0개」라 공허하게 PASS 한다.
    insert into s20_check values (3, 'block = pm,pm,pm,am,am,pm (9/12 셋 · 9/13 am 둘 + pm 하나)',
      v_bad = 0 and v_rows = 6,
      coalesce(v_detail, case when v_rows = 6 then '6/6 일치'
                              else format('검사할 행이 %s개뿐 — 대조 불가', v_rows) end));

    -- C4 — prompt 는 글자 그대로, guidance 는 일차·시각 포함
    select count(*), string_agg(format('#%s %s', dt.ordinal,
             case when dt.prompt is distinct from v_expect_prompt[dt.ordinal]
                  then format('prompt≠「%s」(실제 「%s」)', v_expect_prompt[dt.ordinal], dt.prompt)
                  else format('guidance 에 「%s」 없음', v_expect_when[dt.ordinal]) end), ' / ')
      into v_bad, v_detail
      from climate_vote.discussion_topic dt
     where dt.session_id = v_session and dt.ordinal between 1 and 6
       and (dt.prompt is distinct from v_expect_prompt[dt.ordinal]
            or coalesce(dt.guidance, '') not like '%' || v_expect_when[dt.ordinal] || '%');
    -- ★ C3 과 같은 이유로 `v_rows = 6` 을 함께 본다.
    insert into s20_check values (4, 'prompt 6개 큐시트 결과물 칸과 일치 · guidance 에 일차·시각',
      v_bad = 0 and v_rows = 6,
      coalesce(v_detail, case when v_rows = 6 then '6/6 일치'
                              else format('검사할 행이 %s개뿐 — 대조 불가', v_rows) end));

    -- C5 — 값의 범위만 본다. draft/open 어느 쪽인지는 행사 진행 상황이다.
    select count(*), string_agg(format('#%s=%s', dt.ordinal, dt.status), ' ')
      into v_bad, v_detail
      from climate_vote.discussion_topic dt
     where dt.session_id = v_session and dt.ordinal between 1 and 6
       and dt.status not in ('draft','open','closed');
    select string_agg(format('#%s=%s', dt.ordinal, dt.status), ' ' order by dt.ordinal)
      into v_detail
      from climate_vote.discussion_topic dt
     where dt.session_id = v_session and dt.ordinal between 1 and 6;
    insert into s20_check values (5,
      'status 가 draft|open|closed 안에 있다 (어느 값인지는 행사 진행 상황 — 못박지 않는다)',
      v_bad = 0, coalesce(v_detail, '(행 없음)'));

    -- C7
    select count(*) into v_n
      from climate_vote.team t
     where t.session_id = v_session
       and t.status = 'active';
    select count(distinct t.join_code) into v_bad
      from climate_vote.team t
     where t.session_id = v_session
       and t.status = 'active'
       and t.join_code ~ '^[0-9]{6}$';
    insert into s20_check values (7, '활성 조 15개와 고유한 6자리 접속코드가 이 세션에 붙어 있다',
      v_n = 15 and v_bad = 15, format('활성 조 %s개 · 고유 6자리 코드 %s개', v_n, v_bad));
  end if;

  -- C6 ★ 8.29 무접촉 — s6 문안 3건이 open 그대로인가
  select count(*) into v_n
    from climate_vote.discussion_topic dt
    join climate_vote.session s on s.id = dt.session_id
   where s.slug = '0829-deliberation'
     and dt.status = 'open'
     and dt.ordinal between 1 and 3
     and dt.prompt = v_0829_prompt[dt.ordinal];
  select string_agg(format('#%s[%s]%s', dt.ordinal, dt.status, dt.prompt), ' ' order by dt.ordinal)
    into v_detail
    from climate_vote.discussion_topic dt
    join climate_vote.session s on s.id = dt.session_id
   where s.slug = '0829-deliberation';
  insert into s20_check values (6, '★ 8.29 무접촉 — s6 꼭지 3건이 문안 그대로 open',
    v_n = 3, coalesce(v_detail, '(8.29 꼭지 0건 — s6 미적용?)'));
end
$verify$;

select seq, case when ok then 'PASS' else 'FAIL' end as result, name, detail
  from s20_check order by seq;

select format('s20 verify: %s/%s PASS', count(*) filter (where ok), count(*)) as summary
  from s20_check;

do $gate$
declare v_fail int;
begin
  select count(*) into v_fail from s20_check where not ok;
  if v_fail > 0 then
    raise exception 's20 verification failed: % check(s) did not pass', v_fail;
  end if;
end
$gate$;

drop table if exists s20_check;
