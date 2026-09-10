-- Read-only verification for 20260910_s22_align_0912_final_plan.sql.

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
    raise exception 's22 verify failed: active, organization-bound session missing';
  end if;

  select count(*) into v_count
    from climate_vote.discussion_topic dt
   where dt.session_id = v_session_id;
  if v_count <> 8 then
    raise exception 's22 verify failed: expected 8 topics, got %', v_count;
  end if;

  with expected(ordinal, block, prompt, guidance) as (
    values
      (1, 'pm', '5차 논의 확인 및 주요 범주 점검', '9/12(토) 1일차 13:45~14:30 · 운영팀 통합 범주를 출발점으로 우리 조의 5차 원문을 재점검하고 빠진 것, 다르게 묶을 것, 새 범주를 보완합니다.'),
      (2, 'pm', '조별 배경·문제인식 작성', '9/12(토) 1일차 14:45~15:45 · 우리 조 범주를 확정한 뒤 현재 문제점과 근거 데이터를 5차 참여자 원문에 맞춰 정리합니다.'),
      (3, 'pm', '조별 기대효과 작성', '9/12(토) 1일차 16:15~17:00 · 예상 감축 효과와 사회적 편익을 확인 가능한 상태로 쓰고 배경·문제인식과의 정합성을 확인합니다.'),
      (4, 'pm', '권고 내용 초안 검토 ① 권고제목', '9/12(토) 1일차 17:00~18:00 · 권고안마다 무엇을 권고할지 한 문장 초안을 만들고 파킹한 정책 아이디어를 재료로 사용합니다.'),
      (5, 'am', '권고 내용 초안 토론 ②', '9/13(일) 2일차 09:10~12:00 · 전날 쓴 요구사항 문장을 확인하고 09:10~10:30과 10:45~12:00 두 구간에 걸쳐 구체적인 정책 제안을 도출합니다.'),
      (6, 'pm', '권고 내용 정리 및 이행 일정', '9/13(일) 2일차 13:00~14:00 · 정책 제안의 순서를 정리하고 단기·중기·장기 이행 일정을 표시한 뒤 배경·문제인식 및 기대효과와의 정합성을 확인합니다.'),
      (7, 'pm', '조별 권고안 공유 및 점검', '9/13(일) 2일차 14:00~15:00 · 게시물을 4회 순회하며 보완점과 중복을 표시하고 수용·불수용 및 기타 의견을 반영해 조 최종안을 확정합니다.'),
      (8, 'pm', '분과 권고안 통합 및 분과 초안 토론', '9/13(일) 2일차 15:15~16:15 · 중복 집계표의 묶음을 확인하고 당사자 조가 통합 여부와 대표 제목을 협의해 분과 권고안 초안 목록을 정리합니다.')
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
    raise exception 's22 verify failed: % topic contract mismatch(es)', v_bad;
  end if;

  select count(*) into v_count
    from climate_vote.team t
   where t.session_id = v_session_id
     and t.status = 'active';
  select count(*) into v_bad
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
    raise exception 's22 verify failed: expected 15 active teams with unique six-digit codes';
  end if;

  select count(*) into v_bad
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
    raise exception 's22 verify failed: 8/29 control session no longer matches its baseline';
  end if;

  raise notice 's22 verify passed: final-plan topics, 15 teams, 8/29 baseline preserved';
end
$verify$;
