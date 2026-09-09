-- Read-only verification for 20260908_s21_correct_0912_topics.sql.

\set ON_ERROR_STOP on
set search_path = pg_catalog, climate_vote;

do $verify$
declare
  v_session_id uuid;
  v_org_id uuid;
  v_count integer;
  v_bad integer;
begin
  select s.id, s.org_id
    into v_session_id, v_org_id
    from climate_vote.session s
    join climate_vote.assembly a
      on a.id = s.assembly_id
     and a.org_id = s.org_id
   where s.slug = '0912-deliberation'
     and s.status = 'active';

  if v_session_id is null or v_org_id is null then
    raise exception 's21 verify failed: active, organization-bound session missing';
  end if;

  select count(*)
    into v_count
    from climate_vote.discussion_topic dt
   where dt.session_id = v_session_id;
  if v_count <> 8 then
    raise exception 's21 verify failed: expected 8 topics, got %', v_count;
  end if;

  with expected(ordinal, block, prompt, guidance) as (
    values
      (1, 'pm', '숙의 주제·범주 확인 및 보완안', '9/12(토) 1일차 13:45~14:30 · 제5차 회의 결과를 바탕으로 범주를 확인하고 보완할 내용을 기록합니다.'),
      (2, 'pm', '권고별 배경·문제점', '9/12(토) 1일차 14:45~15:45 · 범주별 배경과 해결해야 할 문제점을 출처 표현을 보존해 정리합니다.'),
      (3, 'pm', '권고별 기대효과', '9/12(토) 1일차 16:15~17:00 · 권고가 시행될 때 기대하는 변화를 기록합니다.'),
      (4, 'pm', '권고문 한 문장', '9/12(토) 1일차 17:00~18:00 · 범주별 권고 내용을 한 문장 초안으로 작성합니다.'),
      (5, 'am', '세부 정책제안', '9/13(일) 2일차 09:10~12:00 · 09:10~10:30과 10:45~12:00 두 구간에 걸쳐 권고별 세부 정책제안을 작성합니다.'),
      (6, 'pm', '정책제안 정리·이행 일정', '9/13(일) 2일차 13:00~14:15 · 정책제안의 순서를 정리하고 단기·중기·장기 이행 일정을 표시해 조별 권고안 초안을 준비합니다.'),
      (7, 'pm', '조별 권고안 공유·점검·기타 의견', '9/13(일) 2일차 14:30~15:30 · 게시물을 4회 순회하며 보완점과 중복 표시를 확인하고, 수용·불수용 및 기타 의견을 반영해 조 최종안을 확정합니다.'),
      (8, 'pm', '중복 묶음 확인·대표 제목·분과 초안', '9/13(일) 2일차 15:45~16:45 · 표시된 중복 집계대로 묶음을 확인하고 통합 여부와 대표 제목을 협의해 분과 권고안 초안 목록을 정리합니다.')
  )
  select count(*)
    into v_bad
    from expected e
    left join climate_vote.discussion_topic dt
      on dt.session_id = v_session_id
     and dt.ordinal = e.ordinal
   where dt.id is null
      or (dt.block, dt.prompt, coalesce(dt.guidance, ''), dt.org_id)
         is distinct from (e.block, e.prompt, e.guidance, v_org_id)
      or dt.status not in ('draft', 'open', 'closed');
  if v_bad <> 0 then
    raise exception 's21 verify failed: % topic contract mismatch(es)', v_bad;
  end if;

  select count(*)
    into v_bad
    from climate_vote.discussion_topic dt
   where dt.session_id = v_session_id
     and dt.prompt in (
       '쟁점·입장 메모',
       '조별 제안정책 초안',
       '권고안 선정기준(조별 발산)',
       '교차 검토표',
       '보완 제안정책안',
       '분과 제안정책(최종 확정)'
     );
  if v_bad <> 0 then
    raise exception 's21 verify failed: superseded six-topic wording remains';
  end if;

  select count(*)
    into v_count
    from climate_vote.team t
   where t.session_id = v_session_id
     and t.status = 'active';
  select count(*)
    into v_bad
    from (
      select t.join_code
        from climate_vote.team t
       where t.session_id = v_session_id
         and t.status = 'active'
         and t.join_code ~ '^[0-9]{6}$'
       group by t.join_code
      having count(*) = 1
    ) codes;
  if v_count <> 15 or v_bad <> 15 then
    raise exception 's21 verify failed: expected 15 active teams with unique six-digit codes';
  end if;

  select count(*)
    into v_bad
    from climate_vote.discussion_topic dt
    join climate_vote.session s on s.id = dt.session_id
   where s.slug = '0829-deliberation'
     and dt.ordinal between 1 and 3
     and dt.status = 'open'
     and dt.prompt = (array[
       '배경·문제 인식',
       '바라는 변화(기대 효과)',
       '의제와 관련된 질문'
     ])[dt.ordinal];
  if v_bad <> 3 then
    raise exception 's21 verify failed: 8/29 control session no longer matches its baseline';
  end if;

  raise notice 's21 verify passed: 8 topics, 15 teams, 8/29 baseline preserved';
end
$verify$;
