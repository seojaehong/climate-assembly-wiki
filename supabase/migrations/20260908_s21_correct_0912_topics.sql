-- s21: align the 9/12-13 workshop topics with the canonical eight-stage plan.
-- The superseded six-topic s20 migration remains frozen and must not be run.
-- This migration never touches the 8/29 session or existing submissions.

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
    raise exception 's21 refused: active, organization-bound 0912-deliberation session not found';
  end if;

  if exists (
    select 1
      from climate_vote.discussion_topic dt
     where dt.session_id = v_session_id
       and dt.ordinal not between 1 and 8
  ) then
    raise exception 's21 refused: unexpected topic ordinal exists outside 1..8';
  end if;

  with expected(ordinal, block, prompt, guidance) as (
    values
      (1, 'pm', '숙의 주제·범주 확인 및 보완안',
       '9/12(토) 1일차 13:45~14:30 · 제5차 회의 결과를 바탕으로 범주를 확인하고 보완할 내용을 기록합니다.'),
      (2, 'pm', '권고별 배경·문제점',
       '9/12(토) 1일차 14:45~15:45 · 범주별 배경과 해결해야 할 문제점을 출처 표현을 보존해 정리합니다.'),
      (3, 'pm', '권고별 기대효과',
       '9/12(토) 1일차 16:15~17:00 · 권고가 시행될 때 기대하는 변화를 기록합니다.'),
      (4, 'pm', '권고문 한 문장',
       '9/12(토) 1일차 17:00~18:00 · 범주별 권고 내용을 한 문장 초안으로 작성합니다.'),
      (5, 'am', '세부 정책제안',
       '9/13(일) 2일차 09:10~12:00 · 09:10~10:30과 10:45~12:00 두 구간에 걸쳐 권고별 세부 정책제안을 작성합니다.'),
      (6, 'pm', '정책제안 정리·일정·대표 제목·기타 의견',
       '9/13(일) 2일차 13:00~14:15 · 정책제안, 추진 일정, 대표 제목과 기타 의견을 하나의 초안 묶음으로 정리합니다.'),
      (7, 'pm', '5개 원칙 확인·기타 의견·반대 의견',
       '9/13(일) 2일차 14:30~15:30 · 도슨트 방식의 4회 검토 후 5개 원칙과 기타·반대 의견을 빠짐없이 기록합니다.'),
      (8, 'pm', '중복 유형·대표 제목·제8차 이관 메모',
       '9/13(일) 2일차 15:45~16:45 · 조별 공유 결과와 중복 유형 A·B·C·D, 대표 제목, 미완성 초안의 제8차 이관 메모를 남깁니다.')
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
    raise exception 's21 refused: % topic(s) have submissions under superseded wording', v_mismatch_count;
  end if;

  insert into climate_vote.discussion_topic
         (session_id, ordinal, block, prompt, guidance, status, org_id)
  values
    (v_session_id, 1, 'pm', '숙의 주제·범주 확인 및 보완안',
     '9/12(토) 1일차 13:45~14:30 · 제5차 회의 결과를 바탕으로 범주를 확인하고 보완할 내용을 기록합니다.', 'draft', v_org_id),
    (v_session_id, 2, 'pm', '권고별 배경·문제점',
     '9/12(토) 1일차 14:45~15:45 · 범주별 배경과 해결해야 할 문제점을 출처 표현을 보존해 정리합니다.', 'draft', v_org_id),
    (v_session_id, 3, 'pm', '권고별 기대효과',
     '9/12(토) 1일차 16:15~17:00 · 권고가 시행될 때 기대하는 변화를 기록합니다.', 'draft', v_org_id),
    (v_session_id, 4, 'pm', '권고문 한 문장',
     '9/12(토) 1일차 17:00~18:00 · 범주별 권고 내용을 한 문장 초안으로 작성합니다.', 'draft', v_org_id),
    (v_session_id, 5, 'am', '세부 정책제안',
     '9/13(일) 2일차 09:10~12:00 · 09:10~10:30과 10:45~12:00 두 구간에 걸쳐 권고별 세부 정책제안을 작성합니다.', 'draft', v_org_id),
    (v_session_id, 6, 'pm', '정책제안 정리·일정·대표 제목·기타 의견',
     '9/13(일) 2일차 13:00~14:15 · 정책제안, 추진 일정, 대표 제목과 기타 의견을 하나의 초안 묶음으로 정리합니다.', 'draft', v_org_id),
    (v_session_id, 7, 'pm', '5개 원칙 확인·기타 의견·반대 의견',
     '9/13(일) 2일차 14:30~15:30 · 도슨트 방식의 4회 검토 후 5개 원칙과 기타·반대 의견을 빠짐없이 기록합니다.', 'draft', v_org_id),
    (v_session_id, 8, 'pm', '중복 유형·대표 제목·제8차 이관 메모',
     '9/13(일) 2일차 15:45~16:45 · 조별 공유 결과와 중복 유형 A·B·C·D, 대표 제목, 미완성 초안의 제8차 이관 메모를 남깁니다.', 'draft', v_org_id)
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
    raise exception 's21 failed: expected 8 topics, got %', v_topic_count;
  end if;
end
$migration$;

commit;
