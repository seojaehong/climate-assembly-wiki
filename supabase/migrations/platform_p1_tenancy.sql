-- feat(platform P1): 멀티테넌시 코어 — org·membership·invitation + org 파생 헬퍼 3종 + RLS 테넌트 정책
-- project: labor_money (pleyuknjnprsckssxvrh), schema: climate_vote
--
-- ⚠️ 별개 트랙(feat/deliberation-saas-platform). 8/29 라이브(main)와 무관.
--    이 파일은 설계·검증용이다. **프로덕션 DB에 적용하지 않는다.** 병합은 별도 결정.
--
-- WHY: 한 행사 vertical → 여러 기관·여러 공론화 재사용 플랫폼 전환의 토대.
--      spec: docs/platform/BUILD_SPEC.md §2·§3(P1)
--            10_작업산출물/2026-08-09_공론화플랫폼_아키텍처_플랜.md §2·§3-1~3-4
--      테넌시 모델 = row-level(org_id + RLS). schema/db-per-tenant 기각(플랜 §2-1).
--
-- WHAT:
--   1. 테넌시 코어 신설: org / membership(user×org×role) / invitation.
--   2. org 파생 헬퍼 3종(SECURITY DEFINER): org_of_code / org_of_uid / org_of_token.
--      ★ 격리 불변식(플랜 §2-4): 어떤 RPC도 org_id를 인자로 받지 않는다.
--        서버가 join_code·auth.uid()·토큰에서 이 헬퍼로 파생한다. 클라이언트는 org를 주장할 수 없다.
--   3. 기존 위계·명부·무기명 테이블에 org_id uuid nullable 부착(additive).
--   4. 주요 위계 테이블(assembly·session·topic·submission·ballot)에 staff 세션용 RLS 테넌트 정책.
--
-- SAFETY: 순수 additive. 기존 테이블 컬럼/데이터 변경 없음(신규 nullable 컬럼·신규 테이블·신규 함수만).
--         기존 RPC/트리거/정책은 손대지 않음 → /mod·/b·/hq·출석 경로 동작 불변.
--         org_id 는 전부 nullable(기본값 없음) → 기존 행에 NULL 로 남고 어떤 조회도 깨지지 않음.
--         ★ RLS 테넌트 정책은 **설계상 휴면 상태**다. 기존 테이블은 이미
--           `revoke all from anon, authenticated` 이므로 table-level 권한이 RLS보다 먼저 검사되어
--           authenticated 는 정책 이전에 거부된다. 정책은 오직 §5 하단의 (주석 처리된) 활성화 GRANT
--           가 Supabase Auth staff 로그인과 함께 실행될 때에만 작동한다. 그전까지 아무 행도 노출되지 않는다.
--         backfill(기본 org 생성 + 기존 행 UPDATE)은 §3 주석 블록으로만 둔다 — 실행은 병합 시.
--
-- ROLLBACK: supabase/rollbacks/platform_p1_BEFORE.sql
--
-- ★ 적용 후 검증(anon 키, Content-Profile: climate_vote 필수):
--   POST /rest/v1/rpc/org_of_code {"p_join_code":"<유효 join_code>"} → 200 (org_id 또는 null) = 적용됨
--   PGRST202 + message 에 climate_vote.org_of_code → 미적용
--   RLS 정책은 anon 으로 검증 불가(정책은 staff authenticated 전용·현재 휴면). 활성화는 §5 참조.

-- ── 1. 테넌시 코어 (신설) ─────────────────────────────────────────────

create table if not exists climate_vote.org (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]{3,40}$'),
  name text not null check (length(trim(name)) between 1 and 200),
  status text not null default 'active' check (status in ('active','suspended','archived')),
  archived_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists climate_vote.membership (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references climate_vote.org(id),
  user_id uuid not null,                 -- auth.users(id) — Supabase Auth staff 계정
  role text not null check (role in ('org_admin','operator','hq','facilitator')),
  status text not null default 'active' check (status in ('active','revoked')),
  created_at timestamptz not null default now(),
  unique (org_id, user_id, role)
);
create index if not exists membership_user_idx
  on climate_vote.membership(user_id) where status = 'active';
create index if not exists membership_org_idx on climate_vote.membership(org_id);

create table if not exists climate_vote.invitation (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references climate_vote.org(id),
  email text not null check (length(trim(email)) between 3 and 200),
  role text not null check (role in ('org_admin','operator','hq','facilitator')),
  token text not null unique default encode(extensions.gen_random_bytes(16),'hex'),
  invited_by uuid not null,              -- auth.users(id)
  accepted_at timestamptz,
  expires_at timestamptz not null default (now() + interval '14 days'),
  created_at timestamptz not null default now()
);
create index if not exists invitation_org_idx on climate_vote.invitation(org_id);

alter table climate_vote.org enable row level security;
alter table climate_vote.membership enable row level security;
alter table climate_vote.invitation enable row level security;

-- 코어 테이블 직접 접근 차단 — 조작은 RPC(향후 P2+)·헬퍼(SECURITY DEFINER) 경유만.
revoke all on climate_vote.org, climate_vote.membership, climate_vote.invitation
from anon, authenticated;

-- membership 재귀 방지: 아래 §5 assembly 테넌트 정책은 membership 서브쿼리를 참조한다.
-- membership 자체가 RLS enable + revoke 상태라, staff authenticated 가 자기 소속을 읽지 못하면
-- 서브쿼리가 0행을 돌려 모든 테넌트 정책이 거부된다. 자기 행 read 정책을 미리 둔다(현재 휴면 —
-- authenticated table GRANT 가 §5 활성화 블록에서 실행되기 전엔 사정거리 밖).
create policy membership_self_read on climate_vote.membership
  for select to authenticated
  using (user_id = auth.uid());

-- ── 2. 기존 테이블 org_id 부착 (additive · nullable · 기본값 없음) ────
-- 위계군: assembly 가 org 앵커. session·topic·submission·ballot 은 assembly 상속 파생이 원칙이나,
--         조인 단축을 위해 직접 org_id 컬럼도 부착한다(권위 소스 = assembly.org_id, 아래 헬퍼 참조).
-- submission_item·ballot_item 은 각각 submission·ballot 을 통해 상속 → 직접 컬럼 없음.
alter table climate_vote.assembly         add column if not exists org_id uuid references climate_vote.org(id);
alter table climate_vote.session          add column if not exists org_id uuid references climate_vote.org(id);
alter table climate_vote.discussion_topic add column if not exists org_id uuid references climate_vote.org(id);
alter table climate_vote.submission       add column if not exists org_id uuid references climate_vote.org(id);
alter table climate_vote.ballot           add column if not exists org_id uuid references climate_vote.org(id);
alter table climate_vote.team             add column if not exists org_id uuid references climate_vote.org(id);

-- 로스터/PII군: 직접 org_id.
alter table climate_vote.assembly_member  add column if not exists org_id uuid references climate_vote.org(id);
alter table climate_vote.team_assignment  add column if not exists org_id uuid references climate_vote.org(id);

-- 출석군(5): attendance / attendance_audit_log / attendance_auth_session /
--            attendance_auth_attempt / round_attendance_snapshot.
--   attendance_secret 은 제외 — 현행 HQ 단일 공유 비밀(hq_password) 저장소이며, 본 Phase 에서
--   membership 기반 인증으로 대체 예정(플랜 §0-5·1-2). 테넌트 컬럼을 붙일 대상이 아니라 폐지 대상.
alter table climate_vote.attendance                add column if not exists org_id uuid references climate_vote.org(id);
alter table climate_vote.attendance_audit_log      add column if not exists org_id uuid references climate_vote.org(id);
alter table climate_vote.attendance_auth_session   add column if not exists org_id uuid references climate_vote.org(id);
alter table climate_vote.attendance_auth_attempt   add column if not exists org_id uuid references climate_vote.org(id);
alter table climate_vote.round_attendance_snapshot add column if not exists org_id uuid references climate_vote.org(id);

-- 무기명군: votes·ballot_response. org_id 를 붙이되 ★불변식: 이 컬럼은 테넌트 스코핑 전용이며
--   개인↔응답 연결 통로가 되어선 안 된다. 명부군(assembly_member·team_assignment·attendance)과
--   공유 식별자·FK 를 만들지 말 것(플랜 §2-4 PII 경계). client_id 는 계속 ballot/session 스코프.
alter table climate_vote.votes          add column if not exists org_id uuid references climate_vote.org(id);
alter table climate_vote.ballot_response add column if not exists org_id uuid references climate_vote.org(id);

-- P2 신설 예정 테이블(issue·issue_link·result_page)은 여기서 부착하지 않는다.
-- 해당 테이블은 platform_p2_analysis_review.sql 에서 org_id 를 **생성 시점에** 포함한다.

-- ── 3. Backfill (활성화 = 병합 시 · 지금은 주석) ──────────────────────
-- 원칙 ③ 예외 = UPDATE 1회(s1 backfill 과 동종). 병합 시 아래 주석을 해제해 순서대로 실행:
--
--   insert into climate_vote.org (slug, name)
--     values ('kcrc-climate-2026','기후시민회의')
--     on conflict (slug) do nothing;
--   -- 이후 각 테이블을 기본 org 로 UPDATE (assembly 부터 파생 순):
--   -- update climate_vote.assembly a set org_id = o.id
--   --   from climate_vote.org o where o.slug='kcrc-climate-2026' and a.org_id is null;
--   -- update climate_vote.session s set org_id = a.org_id
--   --   from climate_vote.assembly a where a.id = s.assembly_id and s.org_id is null;
--   -- update climate_vote.discussion_topic dt set org_id = s.org_id
--   --   from climate_vote.session s where s.id = dt.session_id and dt.org_id is null;
--   -- update climate_vote.team t set org_id = s.org_id
--   --   from climate_vote.session s where s.id = t.session_id and t.org_id is null;
--   -- ... submission/ballot/명부군/출석군/무기명군 동일 파생 UPDATE ...
--   -- 종단: Phase 2 종료 시 `alter table ... alter column org_id set not null` 로 전환(플랜 §2-4).
--   --       영구 nullable 은 격리 구멍이므로 backfill 완료 후 NOT NULL 전환이 필수.

-- ── 4. org 파생 헬퍼 3종 (격리 불변식 §2-2 구현 통로) ────────────────
-- 모든 향후 RPC 는 org 를 인자로 받지 않고 이 헬퍼로 파생한다.

-- 4-1. join_code → team → session → assembly.org_id
--   권위 소스 = assembly.org_id. team.org_id(직접 컬럼)로 단축하지 말 것 — backfill 후
--   두 값이 어긋나면 team.org_id 가 조용히 두 번째 진실이 된다. 조인 경로를 유지한다.
create or replace function climate_vote.org_of_code(p_join_code text)
returns uuid language sql security definer
set search_path = climate_vote, pg_temp as $fn$
  select a.org_id
  from climate_vote.team t
  join climate_vote.session s on s.id = t.session_id
  join climate_vote.assembly a on a.id = s.assembly_id
  where t.join_code = p_join_code and t.status = 'active';
$fn$;

-- 4-2. auth.uid() → membership(active) → org_id
--   단일 org: 그 org 반환. 0개: null(호출 RPC 가 자체 도메인 오류를 낸다).
--   다중 org: **명시적으로 예외**. limit 1 로 조용히 고르지 않는다 — org 를 임의 선택하는 순간
--   격리 불변식이 무너진다(클라이언트가 org 를 주장하지 못하게 하는 함수가 스스로 주장하는 꼴).
--   TODO(Phase 2): 다중 org staff 는 요청별 org 클레임(JWT app_metadata 또는 set_config 세션 변수)을
--   두고 별도 org_select RPC 로 해소한다. 그전까지 다중 소속은 오류로 드러낸다.
create or replace function climate_vote.org_of_uid()
returns uuid language plpgsql security definer
set search_path = climate_vote, pg_temp as $fn$
declare v_ids uuid[];
begin
  select array_agg(distinct m.org_id) into v_ids
  from climate_vote.membership m
  where m.user_id = auth.uid() and m.status = 'active';
  if v_ids is null or array_length(v_ids, 1) is null then
    return null;
  elsif array_length(v_ids, 1) > 1 then
    raise exception 'user belongs to multiple orgs — explicit org selection required (Phase 2 org_select)';
  end if;
  return v_ids[1];
end $fn$;

-- 4-3. 토큰 → org
--   우선순위: (a) 향후 staff 토큰이 attendance_auth_session.org_id(§2 신규 컬럼)를 담으면 그 값,
--            (b) team 스코프 토큰이면 team → session → assembly.org_id,
--            (c) 현행 HQ 공유 비밀 토큰(scope='hq', team_id·org_id 모두 null)은 org 바인딩이 없다 →
--                단일 org 환경에서만 그 org 를 반환. 다중 org 면 예외.
--   TODO(Phase 2): HQ 공유 비밀 → membership 인증 전환 후 (a) 경로로 통일하고 (c) 폴백을 제거한다.
create or replace function climate_vote.org_of_token(p_token text)
returns uuid language plpgsql security definer
set search_path = climate_vote, pg_temp as $fn$
declare
  v_auth climate_vote.attendance_auth_session;
  v_org uuid;
  v_ids uuid[];
begin
  -- attendance_token_row 는 토큰 검증(만료·해시) 후 세션 행을 돌려준다(20260725 마이그레이션).
  v_auth := climate_vote.attendance_token_row(p_token);
  if v_auth.org_id is not null then
    return v_auth.org_id;                              -- (a) 향후 staff 토큰
  end if;
  if v_auth.team_id is not null then                   -- (b) team 스코프
    select a.org_id into v_org
    from climate_vote.team t
    join climate_vote.session s on s.id = t.session_id
    join climate_vote.assembly a on a.id = s.assembly_id
    where t.id = v_auth.team_id;
    return v_org;
  end if;
  -- (c) HQ 공유 비밀 토큰 — org 바인딩 없음. 단일 org 폴백.
  select array_agg(id) into v_ids from climate_vote.org where status = 'active';
  if v_ids is null or array_length(v_ids, 1) is null then
    return null;
  elsif array_length(v_ids, 1) > 1 then
    raise exception 'HQ token has no org binding and multiple orgs exist — membership auth required (Phase 2)';
  end if;
  return v_ids[1];
end $fn$;

-- ── 5. RLS 테넌트 정책 (staff 세션 전용 · 현재 휴면) ──────────────────
-- 전제: 무기명·조코드·HQ토큰 경로는 계속 SECURITY DEFINER RPC 가 스코핑한다(정책 사정거리 밖).
--   아래 정책은 auth.uid() 가 있는 Supabase Auth staff 세션에만 의미가 있다.
--   ★ 기존 테이블은 이미 `revoke all from anon, authenticated` → table-level 권한이 RLS 보다 먼저
--     검사되어 authenticated 는 정책 평가 이전에 거부된다. 따라서 이 정책들은 §5 하단 활성화 GRANT 가
--     실행되기 전까지 **아무 행도 노출하지 않는다**(순수 additive·무해).
--   read = 소속 org 의 모든 active staff. write(all) = operator·org_admin 만.

create policy assembly_tenant_read on climate_vote.assembly
  for select to authenticated
  using (org_id in (select m.org_id from climate_vote.membership m
                    where m.user_id = auth.uid() and m.status = 'active'));
create policy assembly_tenant_write on climate_vote.assembly
  for all to authenticated
  using (org_id in (select m.org_id from climate_vote.membership m
                    where m.user_id = auth.uid() and m.role in ('operator','org_admin') and m.status = 'active'))
  with check (org_id in (select m.org_id from climate_vote.membership m
                    where m.user_id = auth.uid() and m.role in ('operator','org_admin') and m.status = 'active'));

create policy session_tenant_read on climate_vote.session
  for select to authenticated
  using (org_id in (select m.org_id from climate_vote.membership m
                    where m.user_id = auth.uid() and m.status = 'active'));
create policy session_tenant_write on climate_vote.session
  for all to authenticated
  using (org_id in (select m.org_id from climate_vote.membership m
                    where m.user_id = auth.uid() and m.role in ('operator','org_admin') and m.status = 'active'))
  with check (org_id in (select m.org_id from climate_vote.membership m
                    where m.user_id = auth.uid() and m.role in ('operator','org_admin') and m.status = 'active'));

create policy topic_tenant_read on climate_vote.discussion_topic
  for select to authenticated
  using (org_id in (select m.org_id from climate_vote.membership m
                    where m.user_id = auth.uid() and m.status = 'active'));
create policy topic_tenant_write on climate_vote.discussion_topic
  for all to authenticated
  using (org_id in (select m.org_id from climate_vote.membership m
                    where m.user_id = auth.uid() and m.role in ('operator','org_admin') and m.status = 'active'))
  with check (org_id in (select m.org_id from climate_vote.membership m
                    where m.user_id = auth.uid() and m.role in ('operator','org_admin') and m.status = 'active'));

create policy submission_tenant_read on climate_vote.submission
  for select to authenticated
  using (org_id in (select m.org_id from climate_vote.membership m
                    where m.user_id = auth.uid() and m.status = 'active'));
create policy submission_tenant_write on climate_vote.submission
  for all to authenticated
  using (org_id in (select m.org_id from climate_vote.membership m
                    where m.user_id = auth.uid() and m.role in ('operator','org_admin') and m.status = 'active'))
  with check (org_id in (select m.org_id from climate_vote.membership m
                    where m.user_id = auth.uid() and m.role in ('operator','org_admin') and m.status = 'active'));

create policy ballot_tenant_read on climate_vote.ballot
  for select to authenticated
  using (org_id in (select m.org_id from climate_vote.membership m
                    where m.user_id = auth.uid() and m.status = 'active'));
create policy ballot_tenant_write on climate_vote.ballot
  for all to authenticated
  using (org_id in (select m.org_id from climate_vote.membership m
                    where m.user_id = auth.uid() and m.role in ('operator','org_admin') and m.status = 'active'))
  with check (org_id in (select m.org_id from climate_vote.membership m
                    where m.user_id = auth.uid() and m.role in ('operator','org_admin') and m.status = 'active'));

-- 활성화 GRANT (활성화 = Supabase Auth staff 로그인 도입 시 · 지금은 주석) ─────
-- 위 정책은 이 GRANT 가 실행돼야 비로소 작동한다. backfill(§3)과 함께 병합 시 해제:
--
--   grant select on climate_vote.membership to authenticated;   -- membership_self_read 활성화
--   grant select, insert, update on
--     climate_vote.assembly, climate_vote.session, climate_vote.discussion_topic,
--     climate_vote.submission, climate_vote.ballot
--   to authenticated;
--   -- (org·invitation 은 org_admin CRUD 전용 RPC 로만 노출 — 직접 GRANT 하지 않는다)

-- ── 6. 권한: 헬퍼 PUBLIC 회수 → anon + authenticated grant (기존 컨벤션) ─
revoke execute on function
  climate_vote.org_of_code(text),
  climate_vote.org_of_uid(),
  climate_vote.org_of_token(text)
from public;

grant execute on function
  climate_vote.org_of_code(text),
  climate_vote.org_of_uid(),
  climate_vote.org_of_token(text)
to anon, authenticated;
