-- rollback for migrations/platform_p1_tenancy.sql
-- 신설 헬퍼·정책·테이블 제거 + 기존 테이블 org_id 컬럼 제거. 기존 데이터에는 영향 없음.
-- ⚠️ backfill(§3)을 이미 실행해 org/membership/invitation 에 행이 쌓였다면 drop 전에 export 할 것.
-- ⚠️ backfill 로 org_id 를 채운 뒤라면 아래 `drop column org_id` 는 그 값들을 소실시킨다 —
--    NOT NULL 전환까지 마친 상태라면 롤백 대신 별도 다운 마이그레이션을 설계하라.

begin;

-- org_id를 지우기 전에 기관간 official_id 중복을 먼저 검사한다. 중복이
-- 있는데 테넌트 경계를 없애면 이전 스키마의 전역 고유성을 복원할 수
-- 없으므로, 어떤 DDL도 남기기 전에 전체 롤백을 거부한다.
do $official_id_rollback_guard$
begin
  if exists (
    select 1
      from climate_vote.assembly_member
     group by official_id
    having count(*) > 1
  ) then
    raise exception 'P1 rollback refused: assembly member official ids are not globally unique';
  end if;
end $official_id_rollback_guard$;

-- P1b가 전역 constraint를 제거한 상태에서 롤백하더라도 이전 스키마의
-- 무결성을 먼저 복원한다. 중복 행이 있거나 constraint 생성이 실패하면
-- 같은 트랜잭션의 후속 DROP도 모두 취소된다.
do $official_id_global_unique$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid='climate_vote.assembly_member'::regclass
       and conname='assembly_member_official_id_key'
       and contype='u'
  ) then
    alter table climate_vote.assembly_member
      add constraint assembly_member_official_id_key unique (official_id);
  end if;
end $official_id_global_unique$;

do $official_id_global_unique_guard$
begin
  if not exists (
    select 1
      from pg_constraint c
      join pg_index i on i.indexrelid=c.conindid
      join pg_attribute a
        on a.attrelid=c.conrelid and a.attname='official_id' and not a.attisdropped
     where c.conrelid='climate_vote.assembly_member'::regclass
       and c.conname='assembly_member_official_id_key'
       and c.contype='u' and c.convalidated
       and c.conkey=array[a.attnum]::smallint[]
       and i.indisunique and i.indisvalid and i.indisready
  ) then
    raise exception 'P1 rollback refused: global official id constraint was not restored';
  end if;
end $official_id_global_unique_guard$;

-- 6·4. 헬퍼 함수 제거
drop function if exists climate_vote.org_of_token(text);
drop function if exists climate_vote.org_of_uid();
drop function if exists climate_vote.org_of_code(text);

-- 5. RLS 테넌트 정책 제거
drop policy if exists ballot_tenant_write on climate_vote.ballot;
drop policy if exists ballot_tenant_read on climate_vote.ballot;
drop policy if exists submission_tenant_write on climate_vote.submission;
drop policy if exists submission_tenant_read on climate_vote.submission;
drop policy if exists topic_tenant_write on climate_vote.discussion_topic;
drop policy if exists topic_tenant_read on climate_vote.discussion_topic;
drop policy if exists session_tenant_write on climate_vote.session;
drop policy if exists session_tenant_read on climate_vote.session;
drop policy if exists assembly_tenant_write on climate_vote.assembly;
drop policy if exists assembly_tenant_read on climate_vote.assembly;
drop policy if exists membership_self_read on climate_vote.membership;

-- 2. 기존 테이블 org_id 컬럼 제거 (부착 역순)
alter table climate_vote.ballot_response           drop column if exists org_id;
alter table climate_vote.votes                     drop column if exists org_id;
alter table climate_vote.round_attendance_snapshot drop column if exists org_id;
alter table climate_vote.attendance_auth_attempt   drop column if exists org_id;
alter table climate_vote.attendance_auth_session   drop column if exists org_id;
alter table climate_vote.attendance_audit_log      drop column if exists org_id;
alter table climate_vote.attendance                drop column if exists org_id;
alter table climate_vote.team_assignment           drop column if exists org_id;
alter table climate_vote.assembly_member           drop column if exists org_id;
alter table climate_vote.team                      drop column if exists org_id;
alter table climate_vote.ballot                    drop column if exists org_id;
alter table climate_vote.submission                drop column if exists org_id;
alter table climate_vote.discussion_topic          drop column if exists org_id;
alter table climate_vote.session                   drop column if exists org_id;
alter table climate_vote.assembly                  drop column if exists org_id;

-- 1. 테넌시 코어 테이블 제거 (FK 역순: invitation·membership → org)
drop table if exists climate_vote.invitation;
drop table if exists climate_vote.membership;
drop table if exists climate_vote.org;

commit;
