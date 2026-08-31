-- s17 적용 후 읽기 전용 검증 — supabase/migrations/20260901_s17_topic_deadline.sql
--
-- 무엇을 확인하나
--   C1  discussion_topic.deadline_at 이 timestamptz 이고 nullable 이다
--       (not null 이면 기존 행이 죽는다. null = 마감 없음이 화면의 안전 퇴화 경로다)
--   C2  topic_list 가 8컬럼(기존 6 + deadline_at + server_now)을 돌려준다
--   C3  topic_list 가 security definer · language sql · search_path 고정이다
--   C4  ★ topic_list 의 EXECUTE 가 anon·authenticated 에 있고 PUBLIC 에는 없다
--       — drop 후 재부여를 빠뜨리면 조 화면이 전면 장애다. 이 검사가 그것을 잡는다
--   C5  topic_set_deadline(text, uuid, timestamptz) 가 jsonb 를 돌려주는
--       plpgsql · security definer · search_path 고정 함수다
--   C6  topic_set_deadline 의 EXECUTE 도 anon·authenticated 에만 있다
--   C7  함수 소유자가 anon/authenticated/service_role 이 아니다
--       (security definer 함수의 소유자가 곧 실행 권한이다)
--
-- 이 파일은 DB 객체·데이터를 바꾸지 않는다. 세션 임시표 하나만 쓴다.
-- 마지막에 통과/전체 개수를 N/N 으로 찍고, 하나라도 실패하면 예외로 멈춘다.

\set ON_ERROR_STOP on
set search_path = pg_catalog, climate_vote;

-- ★ on commit drop 을 쓰지 않는다 — psql 은 문장마다 암시적 커밋이라 표가 즉시 사라진다.
--   세션이 끝나면 어차피 없어지고, 마지막에 명시적으로 지운다.
drop table if exists s17_check;
create temporary table s17_check(seq int, name text, ok boolean, detail text);

do $verify$
declare
  v_ok boolean;
  v_detail text;
  v_typ text;
  v_notnull boolean;
  v_result text;
  v_secdef boolean;
  v_lang name;
  v_config text[];
  v_owner name;
begin
  -- C1
  select format_type(a.atttypid, a.atttypmod), a.attnotnull
    into v_typ, v_notnull
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'climate_vote' and c.relname = 'discussion_topic'
     and a.attname = 'deadline_at' and a.attnum > 0 and not a.attisdropped;
  v_ok := v_typ = 'timestamp with time zone' and v_notnull is false;
  insert into s17_check values (1, 'deadline_at 컬럼 = timestamptz nullable',
    coalesce(v_ok, false), coalesce(v_typ, '(컬럼 없음)') || case when v_notnull then ' NOT NULL' else ' NULL' end);

  -- C2 / C3 / C7(topic_list)
  if to_regprocedure('climate_vote.topic_list(text)') is null then
    insert into s17_check values (2, 'topic_list 반환 8컬럼', false, '함수 없음');
    insert into s17_check values (3, 'topic_list = security definer · sql · search_path 고정', false, '함수 없음');
  else
    select pg_get_function_result(p.oid), p.prosecdef, l.lanname, p.proconfig, pg_get_userbyid(p.proowner)
      into v_result, v_secdef, v_lang, v_config, v_owner
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      join pg_language l on l.oid = p.prolang
     where p.oid = to_regprocedure('climate_vote.topic_list(text)');

    v_ok := v_result like 'TABLE(%'
        and v_result like '%deadline_at timestamp with time zone%'
        and v_result like '%server_now timestamp with time zone%'
        and (length(v_result) - length(replace(v_result, ',', ''))) = 7;  -- 8컬럼 = 쉼표 7개
    insert into s17_check values (2, 'topic_list 반환 8컬럼(+deadline_at,server_now)', v_ok, v_result);

    v_ok := v_secdef and v_lang = 'sql'
        and 'search_path=climate_vote, pg_temp' = any(coalesce(v_config, '{}'));
    insert into s17_check values (3, 'topic_list = security definer · sql · search_path 고정',
      v_ok, format('secdef=%s lang=%s config=%s', v_secdef, v_lang, coalesce(array_to_string(v_config, '|'), '(없음)')));

    insert into s17_check values (7, 'topic_list 소유자가 anon/authenticated/service_role 이 아니다',
      v_owner not in ('anon','authenticated','service_role'), v_owner);
  end if;

  -- C4 ★ grant 재부여
  if to_regprocedure('climate_vote.topic_list(text)') is null then
    insert into s17_check values (4, '★ topic_list EXECUTE = anon+authenticated, PUBLIC 없음', false, '함수 없음');
  else
    v_ok := has_function_privilege('anon', 'climate_vote.topic_list(text)', 'EXECUTE')
        and has_function_privilege('authenticated', 'climate_vote.topic_list(text)', 'EXECUTE')
        and not has_function_privilege('public', 'climate_vote.topic_list(text)', 'EXECUTE');
    insert into s17_check values (4, '★ topic_list EXECUTE = anon+authenticated, PUBLIC 없음', v_ok,
      format('anon=%s authenticated=%s public=%s',
        has_function_privilege('anon', 'climate_vote.topic_list(text)', 'EXECUTE'),
        has_function_privilege('authenticated', 'climate_vote.topic_list(text)', 'EXECUTE'),
        has_function_privilege('public', 'climate_vote.topic_list(text)', 'EXECUTE')));
  end if;

  -- C5 / C6
  if to_regprocedure('climate_vote.topic_set_deadline(text, uuid, timestamptz)') is null then
    insert into s17_check values (5, 'topic_set_deadline = jsonb · plpgsql · security definer', false, '함수 없음');
    insert into s17_check values (6, 'topic_set_deadline EXECUTE = anon+authenticated, PUBLIC 없음', false, '함수 없음');
  else
    select pg_get_function_result(p.oid), p.prosecdef, l.lanname, p.proconfig
      into v_result, v_secdef, v_lang, v_config
      from pg_proc p
      join pg_language l on l.oid = p.prolang
     where p.oid = to_regprocedure('climate_vote.topic_set_deadline(text, uuid, timestamptz)');

    v_ok := v_result = 'jsonb' and v_secdef and v_lang = 'plpgsql'
        and 'search_path=climate_vote, extensions, pg_temp' = any(coalesce(v_config, '{}'));
    insert into s17_check values (5, 'topic_set_deadline = jsonb · plpgsql · security definer · search_path 고정',
      v_ok, format('result=%s secdef=%s lang=%s config=%s', v_result, v_secdef, v_lang,
                   coalesce(array_to_string(v_config, '|'), '(없음)')));

    v_ok := has_function_privilege('anon', 'climate_vote.topic_set_deadline(text, uuid, timestamptz)', 'EXECUTE')
        and has_function_privilege('authenticated', 'climate_vote.topic_set_deadline(text, uuid, timestamptz)', 'EXECUTE')
        and not has_function_privilege('public', 'climate_vote.topic_set_deadline(text, uuid, timestamptz)', 'EXECUTE');
    insert into s17_check values (6, 'topic_set_deadline EXECUTE = anon+authenticated, PUBLIC 없음', v_ok,
      format('anon=%s authenticated=%s public=%s',
        has_function_privilege('anon', 'climate_vote.topic_set_deadline(text, uuid, timestamptz)', 'EXECUTE'),
        has_function_privilege('authenticated', 'climate_vote.topic_set_deadline(text, uuid, timestamptz)', 'EXECUTE'),
        has_function_privilege('public', 'climate_vote.topic_set_deadline(text, uuid, timestamptz)', 'EXECUTE')));
  end if;
end
$verify$;

select seq, case when ok then 'PASS' else 'FAIL' end as result, name, detail
  from s17_check order by seq;

select format('s17 verify: %s/%s PASS', count(*) filter (where ok), count(*)) as summary
  from s17_check;

do $gate$
declare v_fail int;
begin
  select count(*) into v_fail from s17_check where not ok;
  if v_fail > 0 then
    raise exception 's17 verification failed: % check(s) did not pass', v_fail;
  end if;
end
$gate$;

drop table if exists s17_check;
