-- s22: align the 9/12-13 workshop topics with the final ADR plan received on 2026-09-10.
-- Canonical source: 0. 기후시민회의 제6-7차 회의 추진계획안_취합_ADR수정.hwpx
-- SHA-256: 9cff7cf7e8e7520290f35abb4d31b3854ed0905f2f1fe21557b089f96c451608
-- This migration never touches the 8/29 session, roster assignments, attendance, or existing submissions.

begin;

do $migration$
declare
  v_session_id uuid;
  v_org_id uuid;
  v_topic_count integer;
  v_mismatch_count integer;
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
    raise exception 's22 refused: active, organization-bound 0912-deliberation session not found';
  end if;

  if exists (
    select 1
      from climate_vote.discussion_topic dt
     where dt.session_id = v_session_id
       and dt.ordinal not between 1 and 8
  ) then
    raise exception 's22 refused: unexpected topic ordinal exists outside 1..8';
  end if;

  with expected(ordinal, block, prompt, guidance) as (
    values
      (1, 'pm', '5차 논의 확인 및 주요 범주 점검',
       '9/12(토) 1일차 13:45~14:30 · 운영팀 통합 범주를 출발점으로 우리 조의 5차 원문을 재점검하고 빠진 것, 다르게 묶을 것, 새 범주를 보완합니다.'),
      (2, 'pm', '조별 배경·문제인식 작성',
       '9/12(토) 1일차 14:45~15:45 · 우리 조 범주를 확정한 뒤 현재 문제점과 근거 데이터를 5차 참여자 원문에 맞춰 정리합니다.'),
      (3, 'pm', '조별 기대효과 작성',
       '9/12(토) 1일차 16:15~17:00 · 예상 감축 효과와 사회적 편익을 확인 가능한 상태로 쓰고 배경·문제인식과의 정합성을 확인합니다.'),
      (4, 'pm', '권고 내용 초안 검토 ① 권고제목',
       '9/12(토) 1일차 17:00~18:00 · 권고안마다 무엇을 권고할지 한 문장 초안을 만들고 파킹한 정책 아이디어를 재료로 사용합니다.'),
      (5, 'am', '권고 내용 초안 토론 ②',
       '9/13(일) 2일차 09:10~12:00 · 전날 쓴 요구사항 문장을 확인하고 09:10~10:30과 10:45~12:00 두 구간에 걸쳐 구체적인 정책 제안을 도출합니다.'),
      (6, 'pm', '권고 내용 정리 및 이행 일정',
       '9/13(일) 2일차 13:00~14:00 · 정책 제안의 순서를 정리하고 단기·중기·장기 이행 일정을 표시한 뒤 배경·문제인식 및 기대효과와의 정합성을 확인합니다.'),
      (7, 'pm', '조별 권고안 공유 및 점검',
       '9/13(일) 2일차 14:00~15:00 · 게시물을 4회 순회하며 보완점과 중복을 표시하고 수용·불수용 및 기타 의견을 반영해 조 최종안을 확정합니다.'),
      (8, 'pm', '분과 권고안 통합 및 분과 초안 토론',
       '9/13(일) 2일차 15:15~16:15 · 중복 집계표의 묶음을 확인하고 당사자 조가 통합 여부와 대표 제목을 협의해 분과 권고안 초안 목록을 정리합니다.')
  )
  select count(*)
    into v_mismatch_count
    from climate_vote.discussion_topic dt
    join expected e on e.ordinal = dt.ordinal
   where dt.session_id = v_session_id
     and (dt.block, dt.prompt, coalesce(dt.guidance, ''))
         is distinct from (e.block, e.prompt, e.guidance)
     and exists (
       select 1
         from climate_vote.submission s
        where s.topic_id = dt.id
     );

  if v_mismatch_count > 0 then
    raise exception 's22 refused: % topic(s) have submissions under superseded wording', v_mismatch_count;
  end if;

  insert into climate_vote.discussion_topic
         (session_id, ordinal, block, prompt, guidance, status, org_id)
  select v_session_id, e.ordinal, e.block, e.prompt, e.guidance, 'draft', v_org_id
    from (values
      (1, 'pm', '5차 논의 확인 및 주요 범주 점검', '9/12(토) 1일차 13:45~14:30 · 운영팀 통합 범주를 출발점으로 우리 조의 5차 원문을 재점검하고 빠진 것, 다르게 묶을 것, 새 범주를 보완합니다.'),
      (2, 'pm', '조별 배경·문제인식 작성', '9/12(토) 1일차 14:45~15:45 · 우리 조 범주를 확정한 뒤 현재 문제점과 근거 데이터를 5차 참여자 원문에 맞춰 정리합니다.'),
      (3, 'pm', '조별 기대효과 작성', '9/12(토) 1일차 16:15~17:00 · 예상 감축 효과와 사회적 편익을 확인 가능한 상태로 쓰고 배경·문제인식과의 정합성을 확인합니다.'),
      (4, 'pm', '권고 내용 초안 검토 ① 권고제목', '9/12(토) 1일차 17:00~18:00 · 권고안마다 무엇을 권고할지 한 문장 초안을 만들고 파킹한 정책 아이디어를 재료로 사용합니다.'),
      (5, 'am', '권고 내용 초안 토론 ②', '9/13(일) 2일차 09:10~12:00 · 전날 쓴 요구사항 문장을 확인하고 09:10~10:30과 10:45~12:00 두 구간에 걸쳐 구체적인 정책 제안을 도출합니다.'),
      (6, 'pm', '권고 내용 정리 및 이행 일정', '9/13(일) 2일차 13:00~14:00 · 정책 제안의 순서를 정리하고 단기·중기·장기 이행 일정을 표시한 뒤 배경·문제인식 및 기대효과와의 정합성을 확인합니다.'),
      (7, 'pm', '조별 권고안 공유 및 점검', '9/13(일) 2일차 14:00~15:00 · 게시물을 4회 순회하며 보완점과 중복을 표시하고 수용·불수용 및 기타 의견을 반영해 조 최종안을 확정합니다.'),
      (8, 'pm', '분과 권고안 통합 및 분과 초안 토론', '9/13(일) 2일차 15:15~16:15 · 중복 집계표의 묶음을 확인하고 당사자 조가 통합 여부와 대표 제목을 협의해 분과 권고안 초안 목록을 정리합니다.')
    ) as e(ordinal, block, prompt, guidance)
  on conflict (session_id, ordinal) do update
    set block = excluded.block,
        prompt = excluded.prompt,
        guidance = excluded.guidance,
        org_id = excluded.org_id;

  select count(*)
    into v_topic_count
    from climate_vote.discussion_topic dt
   where dt.session_id = v_session_id;

  if v_topic_count <> 8 then
    raise exception 's22 failed: expected 8 topics, got %', v_topic_count;
  end if;
end
$migration$;

commit;
