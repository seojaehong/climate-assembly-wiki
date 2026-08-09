-- 격리/capability negative 검증
\echo '### N1. 무효 join_code → invalid join code'
do $$ begin perform climate_vote.issue_list('000000','44444444-4444-4444-4444-444444444444'); exception when others then raise notice 'REJECTED: %', sqlerrm; end $$;
\echo '### N2. 타 세션 주제 접근 → topic not in your session'
-- 다른 세션+팀 생성
insert into climate_vote.session(id,slug,title,status) values ('99999999-9999-9999-9999-999999999999','other','타회차','active');
insert into climate_vote.team(id,session_id,name,join_code,status) values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','99999999-9999-9999-9999-999999999999','타조','111222','active');
do $$ begin perform climate_vote.issue_list('111222','44444444-4444-4444-4444-444444444444'); exception when others then raise notice 'REJECTED: %', sqlerrm; end $$;
\echo '### N3. org_of_code — 654321 → test-org 파생 확인'
select climate_vote.org_of_code('654321') = '11111111-1111-1111-1111-111111111111' as org_derived_ok;
\echo '### N4. 이미 공개된 결과 재공개 시도 (idempotent/중복 처리)'
select climate_vote.result_get('9979ee76b9bd73122052aaeb6839d022') is not null as still_published;
