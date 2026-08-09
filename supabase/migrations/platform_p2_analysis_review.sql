-- feat(platform P2): 분석·검수·공개 스키마 (issue·issue_link·result_page + 검수/공개 게이트 RPC)
-- project: labor_money (pleyuknjnprsckssxvrh), schema: climate_vote
-- 트랙: feat/deliberation-saas-platform (8/29 라이브와 별개, 병합 전까지 프로덕션 미적용)
--
-- WHY: 플랫폼 아키텍처 플랜 Phase 1 = 「기록→분석→검수→공개」 완결. gongron 벤치마킹
--      B4(빈도4×방향6 코딩) · B5(원문↔쟁점 M:N + cluster_id 분모 보정) · B7(공개 수동 게이트)
--      · B9(HITL 카피) · B10(조×쟁점 매트릭스) · B11(미분류 고지)을 스키마로 이식한다.
--      spec: 2026-08-08_숙의운영시스템_스키마_spec.md §3-3·§3-5
--            2026-08-09_공론화플랫폼_아키텍처_플랜.md §3-3 / docs/platform/BUILD_SPEC.md §1·§3(P2)
--
-- WHAT: issue, issue_link(cluster_id), result_page 신설.
--       issue·result_page에 org_id(nullable) 부착 — assembly에서 서버 파생(P1이 FK·backfill 추가).
--       검수 RPC 5종: issue_list / issue_upsert / issue_link_set / issue_merge / issue_review
--       공개 게이트 RPC 3종: result_publish(≥1 reviewed) / result_unpublish / result_get(공개 read)
--       submission_save_v2 — s1 submission_save의 delete-all을 대체하는 stable-id upsert 경로
--         (issue_link FK 파괴 방지). s1 submission_save는 미변경.
--       트리거 issue_invalidate_guard — submission_item 변경 시 연결 issue를 draft로 되돌림(재검수 강제).
--       platform_snapshot_now() — issue·issue_link·result_page·submission·ballot 포함 신규 스냅샷.
--       헬퍼 platform_org_of_code / platform_scope_belongs (org 인자 금지 불변식 구현).
--
-- SAFETY: 순수 additive. 기존 테이블 컬럼/데이터/정책/함수/트리거 변경 없음.
--   · 신설 테이블 전부 RLS enable + anon/authenticated 직접 접근 revoke — RPC 경유만.
--     service_role는 revoke 대상 아님 → 분석코어(기계) 직접 적재 경로 유지(run별 org 고정 규율).
--   · 함수는 PUBLIC EXECUTE 회수 후 anon+authenticated grant(공개/검수 RPC).
--     platform_snapshot_now는 전량 덤프이므로 service_role에만 grant(SECURITY INVOKER, anon/authenticated 금지).
--   · ★ issue_link.item_id FK = NO ACTION(의도적). s1 submission_save(delete-all)가 링크된
--     원문을 지우려 하면 조용히 파괴하지 않고 큰 소리로 실패한다. 안정 경로는 submission_save_v2뿐.
--     issue_link.issue_id FK = CASCADE(issue 삭제 시 링크 정리).
--   · cv_snapshot_now·s1·s2의 어떤 객체도 건드리지 않음.
--
-- DIVERGENCE(작업지시 서명 우선 — 병합 시 재확인):
--   · result_publish(p_code,...) — join_code(운영자) 서명. 플랜 §2-3은 publish=HQ/org_admin.
--     6자리 코드가 assembly 전체를 공개할 수 있다 → 위험/미결로 보고. HQ 토큰 전환은 Phase 2.
--   · 미분류는 body에 count로 적재(작업지시). spec B11은 본문까지 공개 — count로 축약함(보고).
--   · 공개 게이트 = 스코프 내 reviewed ≥1(BUILD_SPEC advisor 반영). spec §3-5의 "전부 reviewed"는
--     BUILD_SPEC이 ≥1(0이면 예외=공허참 방지)로 상위 확정. ≥1로 구현.
--
-- ROLLBACK: supabase/rollbacks/platform_p2_BEFORE.sql
--
-- ★ 적용 후 검증(anon 키, Content-Profile: climate_vote 필수):
--   POST /rest/v1/rpc/result_get {"p_token":"deadbeef..."} → 200 null = 적용됨
--   POST /rest/v1/rpc/issue_list {"p_code":"<유효 join_code>","p_topic_id":"<uuid>"} → 200 {...}
--   PGRST202 + climate_vote.result_get → 미적용

-- ── 1. 테이블 ────────────────────────────────────────────────────────

-- 1-1. issue (B4: 빈도4 × 방향6 코딩 스킴 + HITL 검수 상태)
create table if not exists climate_vote.issue (
  id uuid primary key default gen_random_uuid(),
  topic_id uuid not null references climate_vote.discussion_topic(id),
  label text not null check (length(trim(label)) between 1 and 200),
  stance text check (stance in ('pro','con','conditional','concern','proposal','neutral')),
  frequency_class text check (frequency_class in ('consensus','majority','minority','mixed')),
  summary text,
  origin text not null default 'ai' check (origin in ('ai','human')),
  review_status text not null default 'draft'
    check (review_status in ('draft','reviewed','archived')),
  reviewed_by text,
  reviewed_at timestamptz,
  archived_at timestamptz,
  -- org_id: assembly에서 서버 파생(nullable). P1(platform_p1_tenancy)이 org FK·backfill 부착.
  org_id uuid,
  created_at timestamptz not null default now()
);

-- 1-2. issue_link (B5: 원문↔쟁점 M:N + cluster_id 분모 보정)
--   cluster_id: 같은 원문 군집 식별자. nullable.
--   합의도 분모 = cluster_id 있으면 cluster 기준, 없으면 distinct item-set(원문 자체).
--   → count(distinct coalesce(cluster_id, item_id)). gongron R2 분모 팽창 해결.
create table if not exists climate_vote.issue_link (
  issue_id uuid not null references climate_vote.issue(id) on delete cascade,
  item_id uuid not null references climate_vote.submission_item(id),  -- NO ACTION: 링크 있으면 원문 삭제 실패
  cluster_id uuid,
  linked_by text not null default 'ai' check (linked_by in ('ai','human')),
  created_at timestamptz not null default now(),
  primary key (issue_id, item_id)
);

-- 1-3. result_page (B7·B8·B9: 토큰 공개 페이지 + 수동 게이트 + HITL)
create table if not exists climate_vote.result_page (
  id uuid primary key default gen_random_uuid(),
  scope text not null check (scope in ('topic','session','assembly')),
  scope_id uuid not null,                 -- 다형(FK 없음): topic/session/assembly id
  token text not null unique default encode(extensions.gen_random_bytes(16), 'hex'),  -- /r/<32hex>
  title text not null check (length(trim(title)) between 1 and 300),
  body jsonb not null default '{}',       -- 검수 스냅샷(issue·조×쟁점·미분류 count·규칙·HITL)
  published_at timestamptz,               -- null = 비공개
  published_by text,
  archived_at timestamptz,
  org_id uuid,                            -- assembly 파생(nullable). P1이 FK·backfill.
  created_at timestamptz not null default now()
);

create index if not exists issue_topic_idx on climate_vote.issue(topic_id);
create index if not exists issue_review_idx on climate_vote.issue(topic_id, review_status);
create index if not exists issue_link_item_idx on climate_vote.issue_link(item_id);
create index if not exists result_page_scope_idx on climate_vote.result_page(scope, scope_id);

-- ── 2. RLS + 직접 접근 차단 (RPC 경유만; service_role은 비회수) ──────

alter table climate_vote.issue enable row level security;
alter table climate_vote.issue_link enable row level security;
alter table climate_vote.result_page enable row level security;

revoke all on climate_vote.issue, climate_vote.issue_link, climate_vote.result_page
from anon, authenticated;

-- ── 3. org 파생 헬퍼 (불변식: 어떤 RPC도 org_id를 인자로 받지 않는다) ─
-- to_jsonb(a)->>'org_id' — assembly에 org_id 컬럼이 없어도(P1 미적용) NULL 반환(정적 컬럼 참조 회피).
-- join_code 유효성 검증은 각 RPC에서 별도 쿼리로 수행(assembly_id NULL이 코드를 무효로 만들지 않게).
create or replace function climate_vote.platform_org_of_code(p_code text)
returns uuid language plpgsql security definer
set search_path = climate_vote, pg_temp as $fn$
declare v_org uuid;
begin
  select (to_jsonb(a)->>'org_id')::uuid into v_org
  from climate_vote.team t
  join climate_vote.session s on s.id = t.session_id
  join climate_vote.assembly a on a.id = s.assembly_id
  where t.join_code = p_code and t.status = 'active';
  return v_org;
end $fn$;

-- 스코프가 이 세션(팀 capability)에 속하는지 판정 — publish/unpublish 인가.
create or replace function climate_vote.platform_scope_belongs(
  p_scope text, p_scope_id uuid, p_session_id uuid)
returns boolean language sql security definer
set search_path = climate_vote, pg_temp as $fn$
  select case p_scope
    when 'topic' then exists(
      select 1 from climate_vote.discussion_topic dt
      where dt.id = p_scope_id and dt.session_id = p_session_id)
    when 'session' then p_scope_id = p_session_id
    when 'assembly' then exists(
      select 1 from climate_vote.session s
      where s.id = p_session_id and s.assembly_id = p_scope_id)
    else false end;
$fn$;

-- ── 4. issue 무효화 트리거 (submission_item 변경 → 연결 issue를 draft로) ─
-- SECURITY INVOKER(s1 가드와 동종): submission_item 쓰기 경로는 DEFINER RPC 또는 service_role뿐.
-- AFTER 타이밍: s1 submission_item_lock_guard(BEFORE)가 final 잠금을 먼저 판정 → 잠긴 경우 이 트리거 도달 전 롤백.
create or replace function climate_vote.issue_invalidate_guard()
returns trigger language plpgsql
set search_path = climate_vote, pg_temp as $fn$
begin
  -- 실질 변경(content/rationale/kind)이 없으면 무효화 생략
  if tg_op = 'UPDATE'
     and new.content   is not distinct from old.content
     and new.rationale is not distinct from old.rationale
     and new.kind      is not distinct from old.kind then
    return new;
  end if;
  update climate_vote.issue i
     set review_status = 'draft', reviewed_by = null, reviewed_at = null
   where i.review_status = 'reviewed'
     and i.id in (select il.issue_id from climate_vote.issue_link il where il.item_id = old.id);
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $fn$;

drop trigger if exists issue_invalidate_guard on climate_vote.submission_item;
create trigger issue_invalidate_guard
  after update or delete on climate_vote.submission_item
  for each row execute function climate_vote.issue_invalidate_guard();

-- issue.org_id 파생 트리거 (테이블 속성화 — 기계 경로 service_role 적재도 커버).
-- to_jsonb(a)->>'org_id': assembly에 org_id 컬럼이 없어도(P1 미적용) NULL(정적 컬럼 참조 회피).
-- org_id를 명시 전달하면(issue_upsert) 그대로 유지, NULL이면 topic→session→assembly로 파생.
create or replace function climate_vote.issue_org_derive()
returns trigger language plpgsql security definer
set search_path = climate_vote, pg_temp as $fn$
begin
  if new.org_id is null then
    select (to_jsonb(a)->>'org_id')::uuid into new.org_id
    from climate_vote.discussion_topic dt
    join climate_vote.session s on s.id = dt.session_id
    join climate_vote.assembly a on a.id = s.assembly_id
    where dt.id = new.topic_id;
  end if;
  return new;
end $fn$;

drop trigger if exists issue_org_derive on climate_vote.issue;
create trigger issue_org_derive
  before insert on climate_vote.issue
  for each row execute function climate_vote.issue_org_derive();

-- ── 5. submission_save_v2 (stable item-id 경로 — s1 미변경, 신규) ─────
-- delete-all 대신 (submission_id, ordinal) upsert로 item id를 보존 → issue_link FK 안정.
-- 제거되는 item은: ① 연결 issue를 draft로 되돌리고 ② 링크를 지운 뒤 ③ item 삭제(순서 필수 — NO ACTION FK).
-- p_items: [{"ordinal":1,"kind":"core","content":"...","rationale":"..."}]
create or replace function climate_vote.submission_save_v2(
  p_code text, p_topic_id uuid, p_items jsonb)
returns jsonb language plpgsql security definer
set search_path = climate_vote, pg_temp as $fn$
declare v_team climate_vote.team; v_sub climate_vote.submission; v_ords int[]; v_n int;
begin
  select * into v_team from climate_vote.team where join_code = p_code and status = 'active';
  if not found then raise exception 'invalid join code'; end if;
  perform 1 from climate_vote.discussion_topic
   where id = p_topic_id and status = 'open' and session_id = v_team.session_id;
  if not found then raise exception 'topic not open in this session'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 30 then
    raise exception 'items must be array (max 30)';
  end if;

  insert into climate_vote.submission (topic_id, team_id)
  values (p_topic_id, v_team.id)
  on conflict (topic_id, team_id) do update set updated_at = now()
  returning * into v_sub;

  if v_sub.status = 'final' then
    raise exception 'submission is finalized — reopen required (hq)';
  end if;

  -- 유지할 ordinal 집합 (content 있는 항목만)
  select coalesce(array_agg(coalesce((e->>'ordinal')::int, rn)), array[]::int[])
    into v_ords
  from jsonb_array_elements(p_items) with ordinality as x(e, rn)
  where length(trim(coalesce(e->>'content',''))) > 0;

  -- 제거 대상 item: ① 연결 reviewed issue → draft
  update climate_vote.issue i
     set review_status = 'draft', reviewed_by = null, reviewed_at = null
   where i.review_status = 'reviewed'
     and i.id in (
       select il.issue_id from climate_vote.issue_link il
       join climate_vote.submission_item si on si.id = il.item_id
       where si.submission_id = v_sub.id and not (si.ordinal = any(v_ords)));
  -- ② 제거 대상 item의 링크 삭제
  delete from climate_vote.issue_link il
   using climate_vote.submission_item si
   where il.item_id = si.id and si.submission_id = v_sub.id
     and not (si.ordinal = any(v_ords));
  -- ③ 제거 대상 item 삭제
  delete from climate_vote.submission_item
   where submission_id = v_sub.id and not (ordinal = any(v_ords));

  -- 잔존/신규 item upsert (id 보존). content 변경 시 AFTER UPDATE 트리거가 연결 issue 무효화.
  insert into climate_vote.submission_item (submission_id, ordinal, kind, content, rationale)
  select v_sub.id,
         coalesce((e->>'ordinal')::int, rn),
         coalesce(nullif(e->>'kind',''), 'core'),
         e->>'content',
         nullif(e->>'rationale','')
  from jsonb_array_elements(p_items) with ordinality as x(e, rn)
  where length(trim(coalesce(e->>'content',''))) > 0
  on conflict (submission_id, ordinal) do update
    set kind = excluded.kind, content = excluded.content, rationale = excluded.rationale;

  select count(*) into v_n from climate_vote.submission_item where submission_id = v_sub.id;
  return jsonb_build_object('id', v_sub.id, 'status', v_sub.status, 'items', v_n);
end $fn$;

-- ── 6. 검수 RPC (operator — join_code capability, org는 서버 파생) ────

-- 6-1. 주제의 issue 목록 + 연결 원문 수 + cluster 분모 + 미분류 카운트
create or replace function climate_vote.issue_list(p_code text, p_topic_id uuid)
returns jsonb language plpgsql security definer
set search_path = climate_vote, pg_temp as $fn$
declare v_team climate_vote.team; v_issues jsonb; v_unclassified int; v_reviewed int;
begin
  select * into v_team from climate_vote.team where join_code = p_code and status = 'active';
  if not found then raise exception 'invalid join code'; end if;
  perform 1 from climate_vote.discussion_topic
   where id = p_topic_id and session_id = v_team.session_id;
  if not found then raise exception 'topic not in your session'; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', i.id, 'label', i.label, 'stance', i.stance,
           'frequency_class', i.frequency_class, 'summary', i.summary,
           'origin', i.origin, 'review_status', i.review_status,
           'reviewed_by', i.reviewed_by, 'reviewed_at', i.reviewed_at,
           'archived_at', i.archived_at,
           'linked_item_count',
             (select count(*) from climate_vote.issue_link il where il.issue_id = i.id),
           'consensus_denominator',
             (select count(distinct coalesce(il.cluster_id, il.item_id))
                from climate_vote.issue_link il where il.issue_id = i.id))
           order by i.created_at), '[]'::jsonb)
    into v_issues
  from climate_vote.issue i
  where i.topic_id = p_topic_id and i.archived_at is null;

  -- 미분류 = 이 주제의 submission_item 중 issue_link 없는 것 (B11 — count로 고지)
  select count(*) into v_unclassified
  from climate_vote.submission_item si
  join climate_vote.submission su on su.id = si.submission_id
  where su.topic_id = p_topic_id
    and not exists (select 1 from climate_vote.issue_link il where il.item_id = si.id);

  select count(*) into v_reviewed
  from climate_vote.issue i
  where i.topic_id = p_topic_id and i.review_status = 'reviewed' and i.archived_at is null;

  return jsonb_build_object(
    'topic_id', p_topic_id, 'issues', v_issues,
    'unclassified_count', v_unclassified, 'reviewed_count', v_reviewed);
end $fn$;

-- 6-2. issue 생성/수정 (label·stance·frequency·summary). id 있으면 수정, 없으면 생성.
--   수정 시 review_status를 draft로 되돌림(사람이 확정문 편집 = 재검수 필요).
create or replace function climate_vote.issue_upsert(p_code text, p_topic_id uuid, p_issue jsonb)
returns jsonb language plpgsql security definer
set search_path = climate_vote, pg_temp as $fn$
declare
  v_team climate_vote.team; v_id uuid; v_existing climate_vote.issue;
  v_label text; v_stance text; v_freq text; v_summary text;
begin
  select * into v_team from climate_vote.team where join_code = p_code and status = 'active';
  if not found then raise exception 'invalid join code'; end if;
  perform 1 from climate_vote.discussion_topic
   where id = p_topic_id and session_id = v_team.session_id;
  if not found then raise exception 'topic not in your session'; end if;

  v_label   := trim(coalesce(p_issue->>'label',''));
  v_stance  := nullif(p_issue->>'stance','');
  v_freq    := coalesce(nullif(p_issue->>'frequency',''), nullif(p_issue->>'frequency_class',''));
  v_summary := nullif(p_issue->>'summary','');
  if length(v_label) = 0 then raise exception 'label required'; end if;

  v_id := nullif(p_issue->>'id','')::uuid;
  if v_id is not null then
    -- archived issue(예: issue_merge로 흡수된 src)는 부활 금지 → not found로 거부
    select * into v_existing from climate_vote.issue
     where id = v_id and topic_id = p_topic_id and archived_at is null;
    if not found then raise exception 'issue not found in this topic'; end if;
    update climate_vote.issue
       set label = v_label, stance = v_stance, frequency_class = v_freq, summary = v_summary,
           review_status = 'draft', reviewed_by = null, reviewed_at = null
     where id = v_id;
    return jsonb_build_object('id', v_id, 'created', false);
  end if;

  insert into climate_vote.issue
    (topic_id, label, stance, frequency_class, summary, origin, review_status, org_id)
  values
    (p_topic_id, v_label, v_stance, v_freq, v_summary, 'human', 'draft',
     climate_vote.platform_org_of_code(p_code))
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'created', true);
end $fn$;

-- 6-3. 원문 연결/재분류 — issue의 링크를 p_item_ids로 교체(cluster_id·linked_by='human').
--   item은 issue와 같은 topic이어야 함. 링크 변경 시 issue를 draft로 되돌림.
create or replace function climate_vote.issue_link_set(
  p_code text, p_issue_id uuid, p_item_ids uuid[], p_cluster_id uuid)
returns jsonb language plpgsql security definer
set search_path = climate_vote, pg_temp as $fn$
declare v_team climate_vote.team; v_topic uuid; v_bad int; v_n int;
begin
  select * into v_team from climate_vote.team where join_code = p_code and status = 'active';
  if not found then raise exception 'invalid join code'; end if;
  select i.topic_id into v_topic
  from climate_vote.issue i
  join climate_vote.discussion_topic dt on dt.id = i.topic_id
  where i.id = p_issue_id and dt.session_id = v_team.session_id;
  if v_topic is null then raise exception 'issue not in your session'; end if;

  -- 모든 item이 같은 topic 소속인지 검증
  select count(*) into v_bad
  from unnest(coalesce(p_item_ids, array[]::uuid[])) as x(item_id)
  where not exists (
    select 1 from climate_vote.submission_item si
    join climate_vote.submission su on su.id = si.submission_id
    where si.id = x.item_id and su.topic_id = v_topic);
  if v_bad > 0 then raise exception '% item(s) not in this topic', v_bad; end if;

  delete from climate_vote.issue_link where issue_id = p_issue_id;
  insert into climate_vote.issue_link (issue_id, item_id, cluster_id, linked_by)
  select p_issue_id, x.item_id, p_cluster_id, 'human'
  from unnest(coalesce(p_item_ids, array[]::uuid[])) as x(item_id);
  get diagnostics v_n = row_count;

  update climate_vote.issue
     set review_status = 'draft', reviewed_by = null, reviewed_at = null
   where id = p_issue_id and review_status = 'reviewed';
  return jsonb_build_object('issue_id', p_issue_id, 'linked', v_n);
end $fn$;

-- 6-4. issue 병합 — src의 링크를 dst로 이전 후 src archive. 같은 topic만, src<>dst.
create or replace function climate_vote.issue_merge(
  p_code text, p_src_issue_id uuid, p_dst_issue_id uuid)
returns jsonb language plpgsql security definer
set search_path = climate_vote, pg_temp as $fn$
declare v_team climate_vote.team; v_src climate_vote.issue; v_dst climate_vote.issue; v_moved int;
begin
  if p_src_issue_id = p_dst_issue_id then raise exception 'cannot merge issue into itself'; end if;
  select * into v_team from climate_vote.team where join_code = p_code and status = 'active';
  if not found then raise exception 'invalid join code'; end if;
  select i.* into v_src from climate_vote.issue i
   join climate_vote.discussion_topic dt on dt.id = i.topic_id
   where i.id = p_src_issue_id and dt.session_id = v_team.session_id;
  if not found then raise exception 'src issue not in your session'; end if;
  select i.* into v_dst from climate_vote.issue i
   join climate_vote.discussion_topic dt on dt.id = i.topic_id
   where i.id = p_dst_issue_id and dt.session_id = v_team.session_id;
  if not found then raise exception 'dst issue not in your session'; end if;
  if v_src.topic_id <> v_dst.topic_id then raise exception 'cannot merge across topics'; end if;

  insert into climate_vote.issue_link (issue_id, item_id, cluster_id, linked_by, created_at)
  select p_dst_issue_id, il.item_id, il.cluster_id, il.linked_by, il.created_at
  from climate_vote.issue_link il where il.issue_id = p_src_issue_id
  on conflict (issue_id, item_id) do nothing;
  get diagnostics v_moved = row_count;

  delete from climate_vote.issue_link where issue_id = p_src_issue_id;
  update climate_vote.issue
     set review_status = 'archived', archived_at = now()
   where id = p_src_issue_id;
  -- 증거 기반이 바뀐 dst는 재검수 필요
  update climate_vote.issue
     set review_status = 'draft', reviewed_by = null, reviewed_at = null
   where id = p_dst_issue_id and review_status = 'reviewed';
  return jsonb_build_object('src', p_src_issue_id, 'dst', p_dst_issue_id, 'moved', v_moved);
end $fn$;

-- 6-5. 검수 확정 — draft → reviewed (+ reviewed_by/at)
create or replace function climate_vote.issue_review(p_code text, p_issue_id uuid)
returns jsonb language plpgsql security definer
set search_path = climate_vote, pg_temp as $fn$
declare v_team climate_vote.team; v_status text;
begin
  select * into v_team from climate_vote.team where join_code = p_code and status = 'active';
  if not found then raise exception 'invalid join code'; end if;
  select i.review_status into v_status
  from climate_vote.issue i
  join climate_vote.discussion_topic dt on dt.id = i.topic_id
  where i.id = p_issue_id and dt.session_id = v_team.session_id;
  if v_status is null then raise exception 'issue not in your session'; end if;
  if v_status <> 'draft' then raise exception 'only draft issues can be reviewed (current: %)', v_status; end if;

  update climate_vote.issue
     set review_status = 'reviewed', reviewed_by = 'mod:' || v_team.name, reviewed_at = now()
   where id = p_issue_id;
  return jsonb_build_object('id', p_issue_id, 'review_status', 'reviewed');
end $fn$;

-- ── 7. 공개 게이트 RPC ──────────────────────────────────────────────

-- 7-1. 공개 — 스코프 내 reviewed issue ≥1 필수(0이면 예외=공허참 방지).
--   body에 검수 스냅샷(issue·조×쟁점 매트릭스·미분류 count·분모 규칙·HITL) 적재. token 반환.
--   스코프당 live(비archive) result_page 1행 upsert(select for update 후 분기).
-- ★ G2 (2026-08-09): publish 권한 = HQ 토큰 서명(조 코드 아님).
-- 이전엔 임의의 조 join_code가 scope='assembly'로 공론화 전체를 공개할 수 있었다(권한 격상).
-- 이제 submission_reopen과 동일하게 attendance HQ 토큰(scope='hq')을 요구한다.
-- 공개는 결과를 대외 노출하는 고권한 행위 → HQ/org_admin(플랜 §2-3). 조 코드로는 실패.
-- (Phase 2: HQ 공유비밀 → membership 인증 + org_of_token으로 org 일치 검사 추가)
create or replace function climate_vote.result_publish(
  p_token text, p_scope text, p_scope_id uuid, p_title text)
returns jsonb language plpgsql security definer
set search_path = climate_vote, extensions, pg_temp as $fn$
declare
  v_auth climate_vote.attendance_auth_session; v_org uuid; v_title text; v_actor text;
  v_exists boolean;
  v_topic_ids uuid[]; v_issues jsonb; v_unclassified int; v_reviewed int;
  v_body jsonb; v_page climate_vote.result_page;
begin
  v_auth := climate_vote.attendance_token_row(p_token);
  if v_auth.scope <> 'hq' then raise exception 'hq authorization required to publish'; end if;
  v_actor := coalesce(v_auth.actor_label, 'hq');
  if p_scope not in ('topic','session','assembly') then raise exception 'invalid scope: %', p_scope; end if;
  -- scope_id 실재 확인(Phase 2: org 일치까지). 존재하지 않으면 거부.
  if p_scope = 'topic' then
    select exists(select 1 from climate_vote.discussion_topic where id = p_scope_id) into v_exists;
  elsif p_scope = 'session' then
    select exists(select 1 from climate_vote.session where id = p_scope_id) into v_exists;
  else
    select exists(select 1 from climate_vote.assembly where id = p_scope_id) into v_exists;
  end if;
  if not v_exists then raise exception 'scope target not found'; end if;
  v_org := v_auth.org_id;   -- Phase 2 이후 non-null. 현재 레거시 HQ 토큰은 null 가능
  v_title := nullif(trim(coalesce(p_title,'')),'');
  if v_title is null then raise exception 'title required'; end if;

  -- 스코프 → topic 집합
  if p_scope = 'topic' then
    v_topic_ids := array[p_scope_id];
  elsif p_scope = 'session' then
    select coalesce(array_agg(id), array[]::uuid[]) into v_topic_ids
    from climate_vote.discussion_topic where session_id = p_scope_id;
  else
    select coalesce(array_agg(dt.id), array[]::uuid[]) into v_topic_ids
    from climate_vote.discussion_topic dt
    join climate_vote.session s on s.id = dt.session_id
    where s.assembly_id = p_scope_id;
  end if;

  select count(*) into v_reviewed
  from climate_vote.issue i
  where i.topic_id = any(v_topic_ids) and i.review_status = 'reviewed' and i.archived_at is null;
  if v_reviewed = 0 then
    raise exception 'no reviewed issue in scope — cannot publish (empty-true guard)';
  end if;

  -- issue + 조×쟁점 매트릭스(teams) + cluster 분모
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', i.id, 'label', i.label, 'stance', i.stance,
           'frequency_class', i.frequency_class, 'summary', i.summary,
           'review_status', i.review_status, 'topic_id', i.topic_id,
           'consensus_denominator',
             (select count(distinct coalesce(il.cluster_id, il.item_id))
                from climate_vote.issue_link il where il.issue_id = i.id),
           'teams',
             (select coalesce(jsonb_agg(distinct tm.name), '[]'::jsonb)
                from climate_vote.issue_link il
                join climate_vote.submission_item si on si.id = il.item_id
                join climate_vote.submission su on su.id = si.submission_id
                join climate_vote.team tm on tm.id = su.team_id
                where il.issue_id = i.id))
           order by i.created_at), '[]'::jsonb)
    into v_issues
  from climate_vote.issue i
  where i.topic_id = any(v_topic_ids) and i.archived_at is null;

  select count(*) into v_unclassified
  from climate_vote.submission_item si
  join climate_vote.submission su on su.id = si.submission_id
  where su.topic_id = any(v_topic_ids)
    and not exists (select 1 from climate_vote.issue_link il where il.item_id = si.id);

  v_body := jsonb_build_object(
    'scope', p_scope, 'scope_id', p_scope_id, 'title', v_title,
    'hitl_notice', 'AI는 초안을 만들고, 공개 여부와 최종 표현은 운영진이 결정합니다.',
    'consensus_rule', '합의도 분모 = 연결 원문의 cluster 기준(cluster_id 있으면 cluster, 없으면 distinct item). gongron R2 분모 팽창 보정.',
    'issues', v_issues,
    'reviewed_count', v_reviewed,
    'unclassified_count', v_unclassified,
    'generated_at', now());

  select * into v_page from climate_vote.result_page
   where scope = p_scope and scope_id = p_scope_id and archived_at is null
   for update;
  if found then
    update climate_vote.result_page
       set title = v_title, body = v_body, published_at = now(),
           published_by = 'hq:' || v_actor, org_id = coalesce(org_id, v_org)
     where id = v_page.id
     returning * into v_page;
  else
    insert into climate_vote.result_page
      (scope, scope_id, title, body, published_at, published_by, org_id)
    values
      (p_scope, p_scope_id, v_title, v_body, now(), 'hq:' || v_actor, v_org)
    returning * into v_page;
  end if;
  return jsonb_build_object('id', v_page.id, 'token', v_page.token,
                            'published_at', v_page.published_at, 'reviewed_count', v_reviewed);
end $fn$;

-- 7-2. 공개 해제 — published_at = null
-- 공개 해제도 HQ 토큰 서명(G2 — publish와 동일 권한)
create or replace function climate_vote.result_unpublish(p_token text, p_result_id uuid)
returns jsonb language plpgsql security definer
set search_path = climate_vote, extensions, pg_temp as $fn$
declare v_auth climate_vote.attendance_auth_session; v_page climate_vote.result_page;
begin
  v_auth := climate_vote.attendance_token_row(p_token);
  if v_auth.scope <> 'hq' then raise exception 'hq authorization required to unpublish'; end if;
  select * into v_page from climate_vote.result_page where id = p_result_id for update;
  if not found then raise exception 'result page not found'; end if;
  update climate_vote.result_page set published_at = null where id = p_result_id;
  return jsonb_build_object('id', p_result_id, 'published_at', null);
end $fn$;

-- 7-3. 공개 read (token) — published_at not null & 비archive만. HITL 문구 포함.
create or replace function climate_vote.result_get(p_token text)
returns jsonb language plpgsql security definer
set search_path = climate_vote, pg_temp as $fn$
declare v_page climate_vote.result_page;
begin
  select * into v_page from climate_vote.result_page
   where token = p_token and published_at is not null and archived_at is null;
  if not found then return null; end if;
  return jsonb_build_object(
    'scope', v_page.scope, 'scope_id', v_page.scope_id,
    'title', v_page.title, 'published_at', v_page.published_at,
    'body', v_page.body,
    'hitl_notice', 'AI는 초안을 만들고, 공개 여부와 최종 표현은 운영진이 결정합니다.');
end $fn$;

-- ── 8. 플랫폼 스냅샷 (신규 — cv_snapshot_now 미변경) ────────────────
-- SECURITY INVOKER(cv_snapshot_now와 동종). 전량 덤프 → service_role에만 grant.
-- votes/rounds/archive_log_count는 export-snapshots-onedrive.mjs 호환 위해 실측 유지.
-- 플랫폼 카운트는 payload.counts에 별도 적재.
create or replace function climate_vote.platform_snapshot_now(p_label text default null)
returns json language plpgsql
set search_path = climate_vote, pg_temp as $fn$
declare v_id bigint; v_payload jsonb;
begin
  v_payload := jsonb_build_object(
    'submission',      coalesce((select jsonb_agg(to_jsonb(s)  order by s.id)  from climate_vote.submission s), '[]'::jsonb),
    'submission_item', coalesce((select jsonb_agg(to_jsonb(si) order by si.id) from climate_vote.submission_item si), '[]'::jsonb),
    'issue',           coalesce((select jsonb_agg(to_jsonb(i)  order by i.id)  from climate_vote.issue i), '[]'::jsonb),
    'issue_link',      coalesce((select jsonb_agg(to_jsonb(il))                from climate_vote.issue_link il), '[]'::jsonb),
    'result_page',     coalesce((select jsonb_agg(to_jsonb(rp) order by rp.id) from climate_vote.result_page rp), '[]'::jsonb),
    'ballot',          coalesce((select jsonb_agg(to_jsonb(b)  order by b.id)  from climate_vote.ballot b), '[]'::jsonb),
    'ballot_item',     coalesce((select jsonb_agg(to_jsonb(bi) order by bi.id) from climate_vote.ballot_item bi), '[]'::jsonb),
    'ballot_response', coalesce((select jsonb_agg(to_jsonb(br) order by br.id) from climate_vote.ballot_response br), '[]'::jsonb),
    'counts', jsonb_build_object(
      'issue',       (select count(*) from climate_vote.issue),
      'issue_link',  (select count(*) from climate_vote.issue_link),
      'result_page', (select count(*) from climate_vote.result_page),
      'submission',  (select count(*) from climate_vote.submission),
      'ballot',      (select count(*) from climate_vote.ballot)));

  insert into climate_vote.snapshots (label, source, votes_count, rounds_count, archive_log_count, payload)
  values (
    coalesce(p_label, 'platform_' || extract(epoch from now())::bigint),
    'platform',
    (select count(*) from climate_vote.votes),
    (select count(*) from climate_vote.rounds),
    (select count(*) from climate_vote.archive_log),
    v_payload)
  returning id into v_id;

  return json_build_object('id', v_id, 'taken_at', now(), 'source', 'platform',
                           'bytes', length(v_payload::text));
end $fn$;

-- ── 8b. 검수용 주제 횡단 원문 조회 (검수 콘솔 미분류함·재분류의 데이터 소스) ──
-- issue_list는 카운트만 준다. 검수 콘솔의 미분류함 본문 노출(B11 전수 역추적)과
-- 원문 재분류(issue_link_set)는 주제의 전 submission_item 본문 + 현재 링크가 필요하다.
-- operator join_code capability로 org/session 파생(org_id 인자 금지 불변식 유지).
create or replace function climate_vote.issue_items(p_code text, p_topic_id uuid)
returns jsonb language plpgsql security definer
set search_path = climate_vote, pg_temp as $fn$
declare v_team climate_vote.team; v_items jsonb;
begin
  select * into v_team from climate_vote.team where join_code = p_code and status = 'active';
  if not found then raise exception 'invalid join code'; end if;
  perform 1 from climate_vote.discussion_topic
   where id = p_topic_id and session_id = v_team.session_id;
  if not found then raise exception 'topic not in your session'; end if;

  -- 주제의 전 조 submission_item + 팀명 + 현재 issue_link(issue_id·cluster_id).
  -- 한 item이 복수 issue에 링크될 수 있으므로(multi-label) links 배열로 반환.
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', si.id, 'content', si.content, 'rationale', si.rationale,
           'kind', si.kind, 'ordinal', si.ordinal,
           'team_id', su.team_id, 'team_name', tm.name,
           'submission_id', su.id,
           'links', (select coalesce(jsonb_agg(jsonb_build_object(
                        'issue_id', il.issue_id, 'cluster_id', il.cluster_id,
                        'linked_by', il.linked_by)), '[]'::jsonb)
                     from climate_vote.issue_link il where il.item_id = si.id),
           'unclassified', not exists
             (select 1 from climate_vote.issue_link il where il.item_id = si.id))
           order by tm.name, su.id, si.ordinal), '[]'::jsonb)
    into v_items
  from climate_vote.submission_item si
  join climate_vote.submission su on su.id = si.submission_id
  left join climate_vote.team tm on tm.id = su.team_id
  where su.topic_id = p_topic_id;

  return jsonb_build_object('topic_id', p_topic_id, 'items', v_items);
end $fn$;

-- ── 9. 권한: PUBLIC 회수 → 대상 role grant ─────────────────────────

revoke execute on function
  climate_vote.platform_org_of_code(text),
  climate_vote.platform_scope_belongs(text, uuid, uuid),
  climate_vote.issue_invalidate_guard(),
  climate_vote.issue_org_derive(),
  climate_vote.submission_save_v2(text, uuid, jsonb),
  climate_vote.issue_items(text, uuid),
  climate_vote.issue_list(text, uuid),
  climate_vote.issue_upsert(text, uuid, jsonb),
  climate_vote.issue_link_set(text, uuid, uuid[], uuid),
  climate_vote.issue_merge(text, uuid, uuid),
  climate_vote.issue_review(text, uuid),
  climate_vote.result_publish(text, text, uuid, text),
  climate_vote.result_unpublish(text, uuid),
  climate_vote.result_get(text),
  climate_vote.platform_snapshot_now(text)
from public;

-- 공개/검수 RPC — anon + authenticated (capability는 함수 본문에서 강제)
grant execute on function
  climate_vote.submission_save_v2(text, uuid, jsonb),
  climate_vote.issue_items(text, uuid),
  climate_vote.issue_list(text, uuid),
  climate_vote.issue_upsert(text, uuid, jsonb),
  climate_vote.issue_link_set(text, uuid, uuid[], uuid),
  climate_vote.issue_merge(text, uuid, uuid),
  climate_vote.issue_review(text, uuid),
  climate_vote.result_publish(text, text, uuid, text),
  climate_vote.result_unpublish(text, uuid),
  climate_vote.result_get(text)
to anon, authenticated;

-- 전량 스냅샷 — service_role 전용(anon/authenticated 금지)
grant execute on function climate_vote.platform_snapshot_now(text) to service_role;

-- platform_org_of_code / platform_scope_belongs / issue_invalidate_guard 는
-- DEFINER RPC·트리거 내부에서만 호출되므로 별도 role grant 없음(소유자 권한으로 실행).
