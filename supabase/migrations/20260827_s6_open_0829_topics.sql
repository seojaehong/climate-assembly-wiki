-- s6: 8/29 조별 입력 꼭지 3건 확정·개방
--
-- 배경 — S3(20260808_s3_seed_0829)가 심은 discussion_topic 2건은 ⑨ 오후 산출물 층위
-- 홀드 때문에 「[확정 전]」 자리표시자 + status='draft'로 남아 있었다. draft는
-- climate_vote.topic_list()가 걸러내므로 조가 082901~082915로 입장해도 입력할 주제가
-- 하나도 보이지 않는다(2026-08-27 anon 실측: topic_list('082901') → []).
--
-- 이 마이그레이션은 그 2건을 정본 문안으로 교체하고 3번째를 신설해 세 꼭지를 open으로 연다.
-- 스키마 변경 없음 — S1의 discussion_topic/submission/submission_item 구조와 RPC를 그대로 쓴다.
--
-- 꼭지 정본 근거
--   ① 배경·문제 인식        — 「양식1. 2026 기후시민회의 권고안」 및 정책권고안(양식 초안) 260811
--                              회의자료 조별 산출물 표 「배경, 문제 인식 (현재 무엇이 문제인가)」
--   ② 바라는 변화(기대 효과) — 회의자료 표 「바라는 변화」. 「기대 효과」는 바라는 변화와 겹쳐
--                              양식에서 삭제된 칸이라 괄호로 병기한다
--   ③ 의제와 관련된 질문     — 회의자료 표 「더 알아야 할 질문」
-- 순서는 회의자료의 숙의 흐름(①이슈 발산 → ②바라는 변화 → 〈질문〉)을 따른다.
--
-- 멱등 — 재실행해도 문안을 같은 값으로 덮어쓸 뿐 제출물에는 손대지 않는다.

do $$
declare
  v_session uuid;
  v_org uuid;
  v_open int;
begin
  select id, org_id into v_session, v_org
    from climate_vote.session where slug = '0829-deliberation';
  if v_session is null then
    raise exception 's6: session 0829-deliberation not found';
  end if;

  -- 세 꼭지를 ordinal 1~3에 확정한다. 기존 draft 2건은 UPDATE로 승계하고 3번은 신설한다.
  -- (ordinal은 (session_id, ordinal) unique 이므로 이 upsert가 곧 자리 고정이다.)
  insert into climate_vote.discussion_topic
         (session_id, ordinal, block, prompt, guidance, status, org_id)
  select v_session, v.ordinal, 'pm', v.prompt, v.guidance, 'open', v_org
  from (values
    (1,
     '배경·문제 인식',
     '현재 무엇이 문제인가 — 조가 확인한 문제를 「우리는 ○○을 확인하였다」 형식의 문장으로 적습니다. 원인·장애요인(왜 그런가, 무엇이 가로막는가)과 영향받는 사람·부담·갈등도 함께 적을 수 있습니다. 개수 제한은 없습니다 — 나온 만큼 모두 적으십시오.'),
    (2,
     '바라는 변화(기대 효과)',
     '이 문제가 제대로 해결되었다면 무엇이 어떻게 달라져 있어야 하는가 — 도달 상태 문형(~된다, ~한 상태가 된다)으로 적습니다. 정책수단이 아니라 상태를 씁니다. 이슈 하나에 바라는 변화 하나 이상으로, 앞 꼭지에서 적은 문제와 짝이 맞는지 확인하십시오.'),
    (3,
     '의제와 관련된 질문',
     '논의 중 나온, 전문가에게 묻거나 다음 숙의 전에 확인해야 할 질문을 적습니다. 추측으로 결론내지 않고 질문으로 남기는 칸입니다.')
  ) as v(ordinal, prompt, guidance)
  on conflict (session_id, ordinal) do update
    set prompt   = excluded.prompt,
        guidance = excluded.guidance,
        block    = excluded.block,
        status   = 'open',
        org_id   = coalesce(discussion_topic.org_id, excluded.org_id);

  select count(*) into v_open
    from climate_vote.discussion_topic
   where session_id = v_session and status = 'open';
  if v_open <> 3 then
    raise exception 's6: expected 3 open topics, got %', v_open;
  end if;
end $$;

-- 확인 — 조 콘솔이 실제로 보게 되는 목록(임의의 조 코드 하나로 검증)
select ordinal, block, status, prompt
from climate_vote.topic_list('082901')
order by ordinal;
