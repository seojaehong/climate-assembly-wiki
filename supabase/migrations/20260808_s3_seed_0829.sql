-- seed(system-schema): 2026 기후시민회의 assembly + 8/29 세션 backfill + 토론 주제 시드
-- S1 적용 후 실행. 멱등(재실행 무해).
--
-- 검증 근거(2026-08-08 anon 실측): climate_vote.session에
--   slug='0829-deliberation' (id a3703275-a8f9-4ab5-aa43-dda4816da0cc, active) 존재.
--   slug='7.4' 세션은 과거 회차 — ordinal만 부여.

-- 1. assembly
insert into climate_vote.assembly (slug, title, purpose, mode, status, config)
values (
  'climate-2026',
  '2026 기후시민회의',
  '탄소중립·녹색성장 기본법 §19의2에 따른 기후시민회의 — 9회차 숙의로 권고안 도출(의결 10/17, 공표 11/14)',
  'consensus',
  'active',
  jsonb_build_object(
    'readiness', jsonb_build_array('topics_open','teams_active','roster_loaded'),
    'hitl_notice', 'AI는 초안을 만들고, 공개 여부와 최종 표현은 운영진이 결정합니다')
)
on conflict (slug) do nothing;

-- 2. 세션 backfill (권위표: project_operating_schedule_9rounds)
update climate_vote.session s
   set assembly_id = a.id, ordinal = 4, held_on = date '2026-07-04'
  from climate_vote.assembly a
 where a.slug = 'climate-2026' and s.slug = '7.4' and s.assembly_id is null;

update climate_vote.session s
   set assembly_id = a.id, ordinal = 5, held_on = date '2026-08-29'
  from climate_vote.assembly a
 where a.slug = 'climate-2026' and s.slug = '0829-deliberation' and s.assembly_id is null;

-- 3. 8/29 토론 주제 시드 — ★ status='draft'로 심는다.
--    문안은 세부실행계획 확정본으로 UPDATE 후 status='open' 전환해야 조 콘솔에 노출됨.
--    (⑨ 오후 산출물 층위 홀드 중 — 2026-08-08 기준)
insert into climate_vote.discussion_topic (session_id, ordinal, block, prompt, guidance, status)
select s.id, v.ordinal, v.block, v.prompt, v.guidance, 'draft'
from climate_vote.session s
cross join (values
  (1, 'am', '[확정 전] 오전 조별 숙의 — 권고안 초안 토론 질문', '세부실행계획 양식1 확정 후 문안 교체', null),
  (2, 'pm', '[확정 전] 오후 조별 숙의 — 산출물 층위 확정 후 입력', '⑨ 오후 산출물 층위 홀드 해제 후 문안 교체', null)
) as v(ordinal, block, prompt, guidance, extra)
where s.slug = '0829-deliberation'
  and not exists (
    select 1 from climate_vote.discussion_topic dt
    where dt.session_id = s.id and dt.ordinal = v.ordinal);

-- 4. 확인
select a.slug, s.slug as session_slug, s.ordinal, s.held_on, count(dt.id) as topics
from climate_vote.assembly a
left join climate_vote.session s on s.assembly_id = a.id
left join climate_vote.discussion_topic dt on dt.session_id = s.id
group by a.slug, s.slug, s.ordinal, s.held_on
order by s.ordinal;
