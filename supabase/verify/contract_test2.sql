SET check_function_bodies = on;
-- submission draft로 생성 → 항목 삽입 → final (잠금 가드 순서 준수)
insert into climate_vote.submission(id,topic_id,team_id,status) values ('66666666-6666-6666-6666-666666666666','44444444-4444-4444-4444-444444444444','55555555-5555-5555-5555-555555555555','draft');
insert into climate_vote.submission_item(id,submission_id,ordinal,kind,content) values
  ('77777777-7777-7777-7777-777777777777','66666666-6666-6666-6666-666666666666',1,'core','감축목표 상향 필요'),
  ('88888888-8888-8888-8888-888888888888','66666666-6666-6666-6666-666666666666',2,'core','청년 일자리 우려');
update climate_vote.submission set status='final' where id='66666666-6666-6666-6666-666666666666';

\echo '### 1. issue_items — 미분류 2건 나와야'
select climate_vote.issue_items('654321','44444444-4444-4444-4444-444444444444')->'items' as items;
\echo '### 2. issue_upsert — 쟁점 생성'
select climate_vote.issue_upsert('654321','44444444-4444-4444-4444-444444444444','{"label":"감축목표 상향","stance":"pro","frequency_class":"majority","summary":"상향 필요"}'::jsonb) ->> 'id' as issue_id \gset
\echo '생성 issue_id=' :'issue_id'
\echo '### 3. issue_link_set — 원문 1건 연결'
select climate_vote.issue_link_set('654321', :'issue_id', array['77777777-7777-7777-7777-777777777777']::uuid[], null);
\echo '### 4. issue_list — 연결1·미분류1·reviewed0'
select climate_vote.issue_list('654321','44444444-4444-4444-4444-444444444444')::text;
\echo '### 5. result_publish 시도 (reviewed 0 → 거부돼야 = 게이트)'
select climate_vote.result_publish('654321','topic','44444444-4444-4444-4444-444444444444','테스트 결과');
