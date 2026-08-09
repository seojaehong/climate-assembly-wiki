SET check_function_bodies = on;
select id from climate_vote.issue where topic_id='44444444-4444-4444-4444-444444444444' limit 1 \gset
\echo '### 6. issue_review — 검수 완료'
select climate_vote.issue_review('654321', :'id')::text;
\echo '### 7. result_publish — 이제 reviewed 1 → 성공, token 반환'
select climate_vote.result_publish('654321','topic','44444444-4444-4444-4444-444444444444','기후 주제 결과') ->> 'token' as tok \gset
\echo '공개 token=' :'tok'
\echo '### 8. result_get(token) — 공개 read, body 구조'
select jsonb_pretty(climate_vote.result_get(:'tok')) ;
