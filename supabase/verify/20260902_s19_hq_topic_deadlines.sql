-- s19 적용 후 읽기 전용 검증 — supabase/migrations/20260902_s19_hq_topic_deadlines.sql
--
-- 무엇을 확인하나
--   C1  hq_topic_deadlines(text, text) 가 존재하고 3컬럼 TABLE 을 돌려준다
--       (topic_id uuid · topic_ordinal int · deadline_at timestamptz)
--   C2  plpgsql · security definer · search_path 고정 (migrations/AGENTS.md 5종 세트 1·2)
--   C3  ★ EXECUTE 가 anon·authenticated 에 있고 **PUBLIC 에는 없다**
--       — grant 누락은 증상이 없어 눈으로 못 잡는다. `has_function_privilege('public', …)`
--         가 false 인지까지 봐야 뜻이 있다(2026-09-01 실측: 빠뜨리면 anon=t public=t 로
--         조용히 PUBLIC 에 얹히고, 나중에 누가 위생 정리로 public 만 회수하면 그 순간
--         anon·authenticated 가 **동시에** 권한을 잃는다 — 2026-07-26 라이브 장애와 같은 구조)
--   C4  함수 소유자가 anon/authenticated/service_role 이 아니다
--       (security definer 함수의 소유자가 곧 실행 권한이다)
--   C5  p_session_slug 에 기본값이 없다 — 호출부가 세션을 반드시 명시하게 둔 것이
--       파일에만 적힌 다짐이 아니라 **함수 시그니처로** 지켜지는지 본다
--   C6  선행 조건 — discussion_topic.deadline_at(s17) 이 있다.
--       없으면 이 함수는 생성은 되고 **호출할 때** 42703 으로 죽는다(조용한 실패)
--
-- 이 파일은 DB 객체·데이터를 바꾸지 않는다. 세션 임시표 하나만 쓴다.
-- 마지막에 통과/전체 개수를 N/N 으로 찍고, 하나라도 실패하면 예외로 멈춘다.

\set ON_ERROR_STOP on
set search_path = pg_catalog, climate_vote;

-- ★ on commit drop 을 쓰지 않는다 — psql 은 문장마다 암시적 커밋이라 표가 즉시 사라진다.
drop table if exists s19_check;
create temporary table s19_check(seq int, name text, ok boolean, detail text);

do $verify$
declare
  v_ok boolean;
  v_result text;
  v_secdef boolean;
  v_lang name;
  v_config text[];
  v_owner name;
  v_ndefaults int;
  v_typ text;
  v_fn constant text := 'climate_vote.hq_topic_deadlines(text, text)';
begin
  if to_regprocedure(v_fn) is null then
    insert into s19_check values (1, 'hq_topic_deadlines 반환 3컬럼', false, '함수 없음');
    insert into s19_check values (2, 'plpgsql · security definer · search_path 고정', false, '함수 없음');
    insert into s19_check values (3, '★ EXECUTE = anon+authenticated, PUBLIC 없음', false, '함수 없음');
    insert into s19_check values (4, '소유자가 anon/authenticated/service_role 이 아니다', false, '함수 없음');
    insert into s19_check values (5, 'p_session_slug 에 기본값이 없다', false, '함수 없음');
  else
    select pg_get_function_result(p.oid), p.prosecdef, l.lanname, p.proconfig,
           pg_get_userbyid(p.proowner), p.pronargdefaults
      into v_result, v_secdef, v_lang, v_config, v_owner, v_ndefaults
      from pg_proc p
      join pg_language l on l.oid = p.prolang
     where p.oid = to_regprocedure(v_fn);

    -- C1 — 3컬럼 = 쉼표 2개
    v_ok := v_result like 'TABLE(%'
        and v_result like '%topic_id uuid%'
        and v_result like '%topic_ordinal integer%'
        and v_result like '%deadline_at timestamp with time zone%'
        and (length(v_result) - length(replace(v_result, ',', ''))) = 2;
    insert into s19_check values (1, 'hq_topic_deadlines 반환 3컬럼(topic_id·topic_ordinal·deadline_at)',
      v_ok, v_result);

    -- C2
    v_ok := v_secdef and v_lang = 'plpgsql'
        and 'search_path=climate_vote, extensions, pg_temp' = any(coalesce(v_config, '{}'));
    insert into s19_check values (2, 'plpgsql · security definer · search_path 고정', v_ok,
      format('secdef=%s lang=%s config=%s', v_secdef, v_lang,
             coalesce(array_to_string(v_config, '|'), '(없음)')));

    -- C3 ★ 권한 — public=false 를 반드시 함께 본다
    v_ok := has_function_privilege('anon', v_fn, 'EXECUTE')
        and has_function_privilege('authenticated', v_fn, 'EXECUTE')
        and has_function_privilege('public', v_fn, 'EXECUTE') = false;
    insert into s19_check values (3, '★ EXECUTE = anon+authenticated, PUBLIC 없음', v_ok,
      format('anon=%s authenticated=%s public=%s',
        has_function_privilege('anon', v_fn, 'EXECUTE'),
        has_function_privilege('authenticated', v_fn, 'EXECUTE'),
        has_function_privilege('public', v_fn, 'EXECUTE')));

    -- C4
    insert into s19_check values (4, '소유자가 anon/authenticated/service_role 이 아니다',
      v_owner not in ('anon','authenticated','service_role'), v_owner);

    -- C5
    insert into s19_check values (5, 'p_session_slug 에 기본값이 없다(세션 명시 강제)',
      v_ndefaults = 0, format('기본값 인자 %s개', v_ndefaults));
  end if;

  -- C6 선행 조건 (s17)
  select format_type(a.atttypid, a.atttypmod)
    into v_typ
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'climate_vote' and c.relname = 'discussion_topic'
     and a.attname = 'deadline_at' and a.attnum > 0 and not a.attisdropped;
  insert into s19_check values (6, '선행 s17 — discussion_topic.deadline_at 이 있다',
    v_typ = 'timestamp with time zone', coalesce(v_typ, '(컬럼 없음 — s17 미적용)'));
end
$verify$;

select seq, case when ok then 'PASS' else 'FAIL' end as result, name, detail
  from s19_check order by seq;

select format('s19 verify: %s/%s PASS', count(*) filter (where ok), count(*)) as summary
  from s19_check;

do $gate$
declare v_fail int;
begin
  select count(*) into v_fail from s19_check where not ok;
  if v_fail > 0 then
    raise exception 's19 verification failed: % check(s) did not pass', v_fail;
  end if;
end
$gate$;

drop table if exists s19_check;
