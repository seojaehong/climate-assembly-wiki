-- s34 진행 기록 계약 시험 — scripts/verify-s34-postgres.sh 가 버림용 postgres:16 에서만 돌린다. 운영 DB 무관.
-- 양쪽 표본: 명단 안/밖 · 제출/미제출 · 진행만/응답만 · 유령(다른 이름으로 제출한 기기) · 범위 밖 문항 · 마감 투표지.
\set ON_ERROR_STOP 1

-- ── 준비(postgres) ──
grant usage on schema climate_vote to anon, authenticated;  -- 운영은 Supabase 노출 스키마 설정이 준다(AGENTS.md)
update climate_vote.session set access_expires_at = now() + interval '1 day'
 where id = '91200000-0000-0000-0000-000000000003';
insert into climate_vote.ballot (id, session_id, org_id, title, status, token)
values ('34000000-0000-0000-0000-000000000001', '91200000-0000-0000-0000-000000000003',
        '91200000-0000-0000-0000-000000000001', '의제2 의결 시험', 'open', repeat('c', 32));
insert into climate_vote.ballot_item (id, ballot_id, ordinal, statement, scale, required) values
 ('34000000-0000-0000-0000-0000000000a1', '34000000-0000-0000-0000-000000000001', 1, '권고안 하나 — 마흔 자를 넘는 아주 긴 제목이 앞 마흔 자만 나가는지 보는 문장입니다 끝', 2, true),
 ('34000000-0000-0000-0000-0000000000a2', '34000000-0000-0000-0000-000000000001', 2, '권고안 둘', 2, true),
 ('34000000-0000-0000-0000-0000000000a3', '34000000-0000-0000-0000-000000000001', 3, '권고안 셋', 2, true);
insert into climate_vote.ballot_roster (session_id, subgroup, team_label, no, name) values
 ('91200000-0000-0000-0000-000000000003', '전체', '1조', 1, '가나다'),
 ('91200000-0000-0000-0000-000000000003', '전체', '1조', 2, '라마바'),
 ('91200000-0000-0000-0000-000000000003', '전체', '2조', 1, '사아자'),
 ('91200000-0000-0000-0000-000000000003', '전체', '2조', 2, '차카타');
-- 운영 접속 토큰(조 workshop 범위) — 'a'*64
insert into climate_vote.attendance_auth_session
  (token_hash, scope, purpose, team_id, session_id, org_id, device_id, actor_label, expires_at)
values (encode(extensions.digest(repeat('a', 64), 'sha256'), 'hex'), 'team', 'workshop',
        '91200000-0000-0000-0000-000000000011', '91200000-0000-0000-0000-000000000003',
        '91200000-0000-0000-0000-000000000001', extensions.gen_random_uuid(), 's34 verify', now() + interval '1 day');

-- ── 참가자(anon) 쓰기 ──
set role anon;
do $t$
declare r jsonb;
begin
  -- 가나다: 1 · 3 · 1(다시) · 이름 공백 변형
  perform climate_vote.ballot_progress_named(repeat('c',32), 'dev-ganada-01', '1조', '가나다', 1);
  perform climate_vote.ballot_progress_named(repeat('c',32), 'dev-ganada-01', '1조', '가나다', 3);
  perform climate_vote.ballot_progress_named(repeat('c',32), 'dev-ganada-01', '1조', ' 가 나다 ', 1);
  -- 범위 밖 문항 · 토큰 형식 · 이름 없음 → 거부
  begin
    perform climate_vote.ballot_progress_named(repeat('c',32), 'dev-ganada-01', '1조', '가나다', 9);
    raise exception 'FAIL: ordinal 9 accepted';
  exception when others then
    if sqlerrm not like '%ordinal out of range%' then raise exception 'FAIL: ordinal 9 wrong error %', sqlerrm; end if;
  end;
  begin
    perform climate_vote.ballot_progress_named('short', 'dev-ganada-01', '1조', '가나다', 1);
    raise exception 'FAIL: bad token accepted';
  exception when others then
    if sqlerrm not like '%ballot token required%' then raise exception 'FAIL: bad token wrong error %', sqlerrm; end if;
  end;
  begin
    perform climate_vote.ballot_progress_named(repeat('c',32), 'dev-ganada-01', '1조', '  ', 1);
    raise exception 'FAIL: blank name accepted';
  exception when others then
    if sqlerrm not like '%voter name required%' then raise exception 'FAIL: blank name wrong error %', sqlerrm; end if;
  end;
  -- 명단 밖 손님(미제출, 진행만)
  perform climate_vote.ballot_progress_named(repeat('c',32), 'dev-guest-001', '3조', '손님', 2);
  -- 유령: 명단 밖 이름으로 누른 기기가 뒤에 사아자로 제출(아래 postgres 삽입)
  perform climate_vote.ballot_progress_named(repeat('c',32), 'dev-ghost-001', '3조', '외부인', 2);
  perform climate_vote.ballot_start_named(repeat('c',32), 'dev-ghost-001', '3조', '외부인');
  -- 차카타: 시작만(진행 없음)
  perform climate_vote.ballot_start_named(repeat('c',32), 'dev-chakata1', '2조', '차카타');
  raise notice 'PASS writes';
end $t$;
reset role;

-- 진행 표: 가나다 {1,3} · 마지막 1
do $t$
declare v int[]; l int; n int;
begin
  select answered, last_ordinal into v, l from climate_vote.ballot_progress
   where ballot_id='34000000-0000-0000-0000-000000000001' and voter_team='1조' and voter_name_norm=climate_vote.voter_name_norm('가나다');
  if v is distinct from array[1,3] or l <> 1 then raise exception 'FAIL: ganada answered % last %', v, l; end if;
  select count(*) into n from climate_vote.ballot_progress where ballot_id='34000000-0000-0000-0000-000000000001';
  if n <> 3 then raise exception 'FAIL: progress rows % (expect 3)', n; end if;
  -- 표에 찬반 값 칸이 없다
  if exists(select 1 from information_schema.columns where table_schema='climate_vote' and table_name='ballot_progress'
            and column_name in ('answers','value','choice')) then raise exception 'FAIL: value column exists'; end if;
  raise notice 'PASS progress table';
end $t$;

-- 제출(응답만): 라마바(명단 안, 진행 기록 없음) · 사아자(유령 기기 dev-ghost-001 로)
insert into climate_vote.ballot_response (ballot_id, client_id, answers, org_id, voter_team, voter_name, voter_name_norm, voter_in_roster) values
 ('34000000-0000-0000-0000-000000000001', 'dev-ramaba-01',
  '{"34000000-0000-0000-0000-0000000000a1":2,"34000000-0000-0000-0000-0000000000a2":1,"34000000-0000-0000-0000-0000000000a3":2}',
  '91200000-0000-0000-0000-000000000001', '1조', '라마바', climate_vote.voter_name_norm('라마바'), true),
 ('34000000-0000-0000-0000-000000000001', 'dev-ghost-001',
  '{"34000000-0000-0000-0000-0000000000a1":1,"34000000-0000-0000-0000-0000000000a2":2,"34000000-0000-0000-0000-0000000000a3":1}',
  '91200000-0000-0000-0000-000000000001', '2조', '사아자', climate_vote.voter_name_norm('사아자'), true);

set role anon;
do $t$
declare r jsonb; b jsonb; it jsonb; vs jsonb; x jsonb;
begin
  -- 제출한 사람 · 제출한 기기 → 무시(ok)
  r := climate_vote.ballot_progress_named(repeat('c',32), 'dev-ramaba-01', '1조', '라마바', 2);
  if r->>'ignored' <> 'submitted' then raise exception 'FAIL: submitted voter not ignored %', r; end if;
  r := climate_vote.ballot_progress_named(repeat('c',32), 'dev-ghost-001', '9조', '딴이름', 1);
  if r->>'ignored' <> 'submitted' then raise exception 'FAIL: submitted device not ignored %', r; end if;

  b := climate_vote.ballot_progress_board(repeat('a',64), '34000000-0000-0000-0000-000000000001');
  raise notice 'BOARD %', b;
  if b::text like '%"answers"%' then raise exception 'FAIL: board exposes answers'; end if;
  if (b->>'item_count')::int <> 3 or (b->>'roster_count')::int <> 4 then raise exception 'FAIL: counts %', b; end if;
  if (b->>'submitted')::int <> 2 then raise exception 'FAIL: submitted %', b->>'submitted'; end if;
  -- started: 가나다 · 손님 · 차카타 · 라마바 · 사아자 = 5 (외부인 = 유령 제외)
  if (b->>'started')::int <> 5 then raise exception 'FAIL: started %', b->>'started'; end if;
  it := b->'items';
  -- 1: 가나다 · 라마바 · 사아자 = 3 / 2: 손님 · 라마바 · 사아자 = 3 (외부인 제외) / 3: 가나다 · 라마바 · 사아자 = 3
  if (it->0->>'answered')::int <> 3 or (it->1->>'answered')::int <> 3 or (it->2->>'answered')::int <> 3 then
    raise exception 'FAIL: per-item %', it; end if;
  if char_length(it->0->>'statement_head') <> 40 then raise exception 'FAIL: statement_head length'; end if;
  vs := b->'voters';
  -- 명단 4 + 손님 1 = 5 (외부인 유령 제외)
  if jsonb_array_length(vs) <> 5 then raise exception 'FAIL: voters %', vs; end if;
  if exists(select 1 from jsonb_array_elements(vs) e where e->>'name'='외부인') then raise exception 'FAIL: ghost listed'; end if;
  select e into x from jsonb_array_elements(vs) e where e->>'name'='가나다';
  if (x->>'answered_count')::int <> 2 or (x->>'submitted')::boolean or not (x->>'in_roster')::boolean
     or (x->>'last_ordinal')::int <> 1 then raise exception 'FAIL: ganada %', x; end if;
  select e into x from jsonb_array_elements(vs) e where e->>'name'='라마바';
  if (x->>'answered_count')::int <> 3 or not (x->>'submitted')::boolean or x->>'submitted_at' is null then raise exception 'FAIL: ramaba %', x; end if;
  select e into x from jsonb_array_elements(vs) e where e->>'name'='차카타';
  if (x->>'answered_count')::int <> 0 or x->>'started_at' is null or (x->>'submitted')::boolean then raise exception 'FAIL: chakata %', x; end if;
  select e into x from jsonb_array_elements(vs) e where e->>'name'='손님';
  if (x->>'in_roster')::boolean or (x->>'answered_count')::int <> 1 then raise exception 'FAIL: guest %', x; end if;
  -- 인가: 다른 토큰 → 거부
  begin
    perform climate_vote.ballot_progress_board(repeat('b',64), '34000000-0000-0000-0000-000000000001');
    raise exception 'FAIL: bad operator token accepted';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  -- 표 직접 읽기 → 거부
  begin
    perform 1 from climate_vote.ballot_progress;
    raise exception 'FAIL: anon read table';
  exception when insufficient_privilege then null;
  end;
  raise notice 'PASS board';
end $t$;
reset role;

-- 진행 ∪ 응답이 같은 사람(11/14 제출자 전원의 꼴): 가나다 진행 {1,3} 뒤 제출 → 두 번 세지 않는다
insert into climate_vote.ballot_response (ballot_id, client_id, answers, org_id, voter_team, voter_name, voter_name_norm, voter_in_roster) values
 ('34000000-0000-0000-0000-000000000001', 'dev-ganada-01',
  '{"34000000-0000-0000-0000-0000000000a1":2,"34000000-0000-0000-0000-0000000000a2":2,"34000000-0000-0000-0000-0000000000a3":1}',
  '91200000-0000-0000-0000-000000000001', '1조', '가나다', climate_vote.voter_name_norm('가나다'), true);
set role anon;
do $t$
declare b jsonb; it jsonb; x jsonb;
begin
  b := climate_vote.ballot_progress_board(repeat('a',64), '34000000-0000-0000-0000-000000000001');
  it := b->'items';
  -- 1: 가나다·라마바·사아자 3 / 2: 손님·라마바·사아자·가나다 4 / 3: 가나다·라마바·사아자 3
  if (it->0->>'answered')::int <> 3 or (it->1->>'answered')::int <> 4 or (it->2->>'answered')::int <> 3 then
    raise exception 'FAIL: overlap per-item %', it; end if;
  select e into x from jsonb_array_elements(b->'voters') e where e->>'name'='가나다';
  if (x->>'answered_count')::int <> 3 or not (x->>'submitted')::boolean then raise exception 'FAIL: overlap ganada %', x; end if;
  if (b->>'started')::int <> 5 or (b->>'submitted')::int <> 3 then raise exception 'FAIL: overlap started/submitted %/%', b->>'started', b->>'submitted'; end if;
  raise notice 'PASS overlap';
end $t$;
reset role;

-- 실명 수집 꺼짐 → 이름을 남기지 않는다(무시 ok)
update climate_vote.session set config = jsonb_set(coalesce(config,'{}'::jsonb), '{named_vote}', '{"collect": false}')
 where id = '91200000-0000-0000-0000-000000000003';
set role anon;
do $t$
declare r jsonb;
begin
  r := climate_vote.ballot_progress_named(repeat('c',32), 'dev-chakata1', '2조', '차카타', 1);
  if r->>'ignored' is distinct from 'named_off' then raise exception 'FAIL: named off not ignored %', r; end if;
  raise notice 'PASS named_off';
end $t$;
reset role;
do $t$
begin
  if exists(select 1 from climate_vote.ballot_progress where voter_name='차카타') then raise exception 'FAIL: named off row written'; end if;
end $t$;
update climate_vote.session set config = config - 'named_vote' where id = '91200000-0000-0000-0000-000000000003';

-- 마감 투표지 → 기록 안 함
update climate_vote.ballot set status='closed' where id='34000000-0000-0000-0000-000000000001';
set role anon;
do $t$
begin
  begin
    perform climate_vote.ballot_progress_named(repeat('c',32), 'dev-chakata1', '2조', '차카타', 1);
    raise exception 'FAIL: closed ballot accepted';
  exception when others then
    if sqlerrm not like '%ballot not open%' then raise exception 'FAIL: closed wrong error %', sqlerrm; end if;
  end;
  raise notice 'PASS closed';
end $t$;
reset role;

-- 권한: PUBLIC 회수 + anon·authenticated 부여
do $t$
declare f text;
begin
  foreach f in array array['climate_vote.ballot_progress_named(text,text,text,text,int)', 'climate_vote.ballot_progress_board(text,uuid)'] loop
    if not has_function_privilege('anon', f, 'execute') or not has_function_privilege('authenticated', f, 'execute') then
      raise exception 'FAIL: grant missing %', f; end if;
    if exists(select 1 from pg_proc p cross join lateral aclexplode(p.proacl) a
               where p.oid = f::regprocedure and a.grantee = 0 and a.privilege_type='EXECUTE') then
      raise exception 'FAIL: PUBLIC execute remains %', f; end if;
  end loop;
  if has_table_privilege('anon', 'climate_vote.ballot_progress', 'select') then raise exception 'FAIL: anon table select'; end if;
  raise notice 'PASS grants';
end $t$;

-- 규모: 명단 200 · 문항 28 · 진행 150 · 제출 50 에서 보드 1회 시간(3~5초 폴링 대상)
insert into climate_vote.ballot (id, session_id, org_id, title, status, token)
values ('34000000-0000-0000-0000-000000000002', '91200000-0000-0000-0000-000000000003',
        '91200000-0000-0000-0000-000000000001', '규모 시험', 'open', repeat('d', 32));
insert into climate_vote.ballot_item (ballot_id, ordinal, statement, scale, required)
select '34000000-0000-0000-0000-000000000002', g, '규모 권고안 ' || g, 2, true from generate_series(1,28) g;
insert into climate_vote.ballot_roster (session_id, subgroup, team_label, no, name)
select '91200000-0000-0000-0000-000000000003', '전체', ((g-1)/10+1) || '조규모', g, '규모사람' || g from generate_series(1,200) g;
insert into climate_vote.ballot_progress (ballot_id, client_id, voter_team, voter_name, voter_name_norm, answered, last_ordinal)
select '34000000-0000-0000-0000-000000000002', 'dev-scale-' || lpad(g::text,4,'0'), ((g-1)/10+1) || '조규모', '규모사람' || g,
       climate_vote.voter_name_norm('규모사람' || g), array(select generate_series(1, 1 + g % 28)), 1 + g % 28
  from generate_series(1,150) g;
insert into climate_vote.ballot_response (ballot_id, client_id, answers, org_id, voter_team, voter_name, voter_name_norm, voter_in_roster)
select '34000000-0000-0000-0000-000000000002', 'dev-scale-' || lpad(g::text,4,'0'),
       (select jsonb_object_agg(bi.id::text, 2) from climate_vote.ballot_item bi where bi.ballot_id='34000000-0000-0000-0000-000000000002'),
       '91200000-0000-0000-0000-000000000001', ((g-1)/10+1) || '조규모', '규모사람' || g, climate_vote.voter_name_norm('규모사람' || g), true
  from generate_series(101,150) g;
do $t$
declare t0 timestamptz; b jsonb; ms numeric; i int;
begin
  perform climate_vote.ballot_progress_board(repeat('a',64), '34000000-0000-0000-0000-000000000002');
  t0 := clock_timestamp();
  for i in 1..5 loop
    b := climate_vote.ballot_progress_board(repeat('a',64), '34000000-0000-0000-0000-000000000002');
  end loop;
  ms := extract(epoch from clock_timestamp() - t0) * 1000 / 5;
  raise notice 'SCALE board avg % ms · voters % · submitted % · roster %', round(ms,1),
    jsonb_array_length(b->'voters'), b->>'submitted', b->>'roster_count';
  if (b->>'submitted')::int <> 50 or (b->'items'->27->>'answered')::int < 50 then raise exception 'FAIL: scale counts %', b->'items'->27; end if;
end $t$;

-- 정리
delete from climate_vote.ballot_progress where ballot_id in ('34000000-0000-0000-0000-000000000001','34000000-0000-0000-0000-000000000002');
\echo S34_TEST_DONE
