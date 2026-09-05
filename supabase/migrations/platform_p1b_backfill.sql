-- platform G3: 기본 org 생성 + org_id backfill + NOT NULL 전환
-- project: climate_vote 스키마. P1(platform_p1_tenancy)과
-- platform_p2_analysis_review 적용 후 실행.
--
-- WHY: P1이 15테이블에 org_id를 nullable로 부착했다. 영구 nullable = 격리 구멍
--      (정책이 NULL 행을 조용히 포함/누락). 데이터를 기본 org로 backfill한 뒤
--      NOT NULL로 전환해 구멍을 닫는다(플랜 §2-4).
--
-- WHAT: 기본 org 1행(kcrc-climate-2026) → 파생 순서대로 org_id UPDATE →
--       위계·명부군 NOT NULL 전환. 무기명군(votes·ballot_response)은 org_id를
--       유지하되 NOT NULL은 보류(개인 연결 금지 불변식 — 나중 정책 재확인).
--
-- SAFETY: 멱등(기본 org on conflict do nothing, UPDATE는 org_id is null만).
--         NOT NULL 전환은 backfill 후 NULL 잔존이 없을 때만 성공(잔존 시 에러로 드러남 = 안전).
--         ★ 단일 테넌트(기본 org) 가정. 다중 org 도입은 Phase 2에서 org별 재배치.
--
-- ROLLBACK: NOT NULL 되돌리기 = alter column drop not null (org_id 컬럼·데이터는 유지).

begin;

-- 1. 기본 org
insert into climate_vote.org (slug, name, status)
values ('kcrc-climate-2026', '한국갈등해결센터 기후시민회의', 'active')
on conflict (slug) do nothing;

-- 2. backfill (파생 순서: assembly 앵커 → 하위 → 명부/무기명)
do $$
declare v_org uuid;
begin
  select id into v_org from climate_vote.org where slug = 'kcrc-climate-2026';

  update climate_vote.assembly          set org_id = v_org where org_id is null;
  -- session·topic·submission·ballot·issue·result_page: assembly 파생 or 직접
  update climate_vote.session s         set org_id = coalesce(
    (select a.org_id from climate_vote.assembly a where a.id = s.assembly_id), v_org)
    where s.org_id is null;
  update climate_vote.discussion_topic dt set org_id = coalesce(
    (select s.org_id from climate_vote.session s where s.id = dt.session_id), v_org)
    where dt.org_id is null;
  update climate_vote.submission su      set org_id = coalesce(
    (select dt.org_id from climate_vote.discussion_topic dt where dt.id = su.topic_id), v_org)
    where su.org_id is null;
  update climate_vote.ballot b           set org_id = coalesce(
    (select s.org_id from climate_vote.session s where s.id = b.session_id), v_org)
    where b.org_id is null;
  update climate_vote.team tm            set org_id = coalesce(
    (select s.org_id from climate_vote.session s where s.id = tm.session_id), v_org)
    where tm.org_id is null;
  -- issue·result_page: P2가 트리거/생성 시 org 파생. 잔존분만
  update climate_vote.issue i            set org_id = coalesce(
    (select dt.org_id from climate_vote.discussion_topic dt where dt.id = i.topic_id), v_org)
    where i.org_id is null;
  update climate_vote.result_page rp     set org_id = v_org where rp.org_id is null;
  -- 명부/PII군
  update climate_vote.assembly_member    set org_id = v_org where org_id is null;
  update climate_vote.team_assignment    set org_id = v_org where org_id is null;
  update climate_vote.attendance         set org_id = v_org where org_id is null;
  update climate_vote.attendance_audit_log   set org_id = v_org where org_id is null;
  update climate_vote.attendance_auth_session set org_id = v_org where org_id is null;
  update climate_vote.attendance_auth_attempt set org_id = v_org where org_id is null;
  update climate_vote.round_attendance_snapshot set org_id = v_org where org_id is null;
  -- 무기명군: org_id는 채우되 NOT NULL 보류
  update climate_vote.votes              set org_id = v_org where org_id is null;
  update climate_vote.ballot_response    set org_id = v_org where org_id is null;
end $$;

-- 3. NOT NULL 전환 (위계·명부군만. 무기명군 보류)
alter table climate_vote.assembly            alter column org_id set not null;
alter table climate_vote.session             alter column org_id set not null;
alter table climate_vote.discussion_topic    alter column org_id set not null;
alter table climate_vote.submission          alter column org_id set not null;
alter table climate_vote.ballot              alter column org_id set not null;
alter table climate_vote.team                alter column org_id set not null;
alter table climate_vote.assembly_member     alter column org_id set not null;
alter table climate_vote.team_assignment     alter column org_id set not null;
-- issue·result_page: 트리거로 항상 채워지므로 NOT NULL 안전
alter table climate_vote.issue               alter column org_id set not null;
alter table climate_vote.result_page         alter column org_id set not null;
-- attendance_* : NOT NULL (명부 스코프)
alter table climate_vote.attendance              alter column org_id set not null;
alter table climate_vote.attendance_auth_session alter column org_id set not null;

-- P1에서 미리 생성한 org-scoped UNIQUE가 백필 결과 전체를 실제로
-- 보호하는지 확인한 뒤에만 legacy 전역 UNIQUE를 해제한다. 이 순서면
-- 인덱스 생성/검증 실패 시 트랜잭션 전체가 rollback되어 기존 보호가 남는다.
create unique index if not exists assembly_member_org_official_id_uniq
  on climate_vote.assembly_member(org_id, official_id)
  where org_id is not null;
do $official_id_cutover$
begin
  if not exists (
    select 1
      from pg_index i
      join pg_class c on c.oid=i.indexrelid
      join pg_namespace n on n.oid=c.relnamespace
      join pg_am am on am.oid=c.relam
     where n.nspname='climate_vote'
       and c.relname='assembly_member_org_official_id_uniq'
       and i.indrelid='climate_vote.assembly_member'::regclass
       and i.indisunique and i.indisvalid and i.indisready
       and am.amname='btree' and i.indnkeyatts=2 and i.indnatts=2
       and pg_get_indexdef(i.indexrelid,1,true)='org_id'
       and pg_get_indexdef(i.indexrelid,2,true)='official_id'
       and regexp_replace(
         lower(pg_get_expr(i.indpred,i.indrelid,false)),
         '[[:space:]]+',' ','g')='(org_id is not null)'
  ) then
    raise exception 'P1b cutover refused: organization-scoped official id index is not valid';
  end if;
end $official_id_cutover$;
alter table climate_vote.assembly_member
  drop constraint if exists assembly_member_official_id_key;

-- 확인
select 'assembly' t, count(*) filter (where org_id is null) null_org from climate_vote.assembly
union all select 'session', count(*) filter (where org_id is null) from climate_vote.session
union all select 'issue', count(*) filter (where org_id is null) from climate_vote.issue
union all select 'result_page', count(*) filter (where org_id is null) from climate_vote.result_page;

commit;
