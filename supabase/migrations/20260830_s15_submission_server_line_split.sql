-- 20260830_s15 — 조 산출물 저장 시 **서버에서** 줄을 나눈다
--
-- 왜 서버인가
--   2026-08-29 행사에서 15개 조 중 6건이 통짜로 들어왔다(1,296~2,870자가 한 칸에).
--   우리는 조에게 「통째로 한 칸에 붙여넣으세요」라고 안내했고, 화면의 줄 분해가
--   그걸 받아 주기로 되어 있었다. 그런데 최종 저장(16:09~16:41)은 전부 줄 분해
--   배포(14:50) 이후인데도 안 먹었다. 유력 원인은 **조가 오후 초입에 열어 둔 탭이
--   옛 번들을 돌고 있었던 것**이다(근거등급 B — 그날 어느 번들이 돌았는지는 클라이언트
--   기록이 없어 사후 확인 불가). 드래그앤드롭 투입·비표준 붙여넣기 경로도 배제하지
--   못했다.
--   ★ 이 셋의 공통점 — **전부 클라이언트 상태에 달렸다.** 서버는 우리가 통제한다.
--   그래서 분해를 저장 경로(RPC) 안으로 옮긴다. 화면이 무슨 코드를 돌든 저장되는
--   순간 한 줄이 한 항목이 된다.
--
-- 「한 줄」의 정의 — 화면(`submission-panel-logic.ts` splitSubmissionLines)과 같은 규칙
--   1) `\r?\n` 으로 자른다 (한글·워드 클립보드가 CRLF 를 실어 보낸다)
--   2) 각 조각의 앞뒤 공백을 없앤다
--   3) 빈 조각은 버린다
--   4) 남은 줄이 **2개 이상일 때만** 나눈다. 1개면 원문을 **손대지 않는다**
--      (= 트림도 하지 않는다. 나누지 않는 항목의 글자는 한 자도 바뀌지 않는다)
--   ★ 이 규칙이 화면과 갈리면 같은 글이 경로에 따라 다르게 저장된다. 두 곳을 함께 고칠 것.
--
-- 멱등 — 화면이 이미 나눠 보낸 경우 각 항목은 한 줄짜리라 3)에서 걸러져 아무 일도
--   일어나지 않는다. 클라이언트 분해와 서버 분해가 이중으로 걸려도 결과는 같다.
--
-- ★ 상한(200)을 넘으면 — **조용히 잘라내지 않는다**
--   나눈 결과가 200을 넘으면 **나누기를 포기하고 받은 그대로 저장한다.**
--   고른 이유:
--     · 예외로 막으면 행사 한복판에 조의 저장이 통째로 실패한다. 통짜로 들어오는
--       것보다 나쁘다.
--     · 넘친 줄을 잘라내면 조가 쓴 문장이 사라진다 — 이 프로젝트가 가장 두려워하는 유실.
--     · 넘친 줄을 마지막 항목에 이어 붙이면 원문에 없던 짜깁기 항목이 생긴다.
--     · 포기하면 **글자는 한 자도 잃지 않고**, 남은 덩어리는 화면의 300자 경고가
--       다음 열람 때 잡아 준다.
--   반환값에 `split_skipped_over_cap: true` 를 실어 보내 조용히 지나가지 않게 한다.
--   (입력 배열 자체가 200을 넘으면 기존대로 예외 — 그 검사는 그대로 둔다.)
--
-- ★ 저장소–운영 드리프트 메모
--   8.29 현장에서 상한을 30 → 200 으로 올릴 때 마이그레이션을 **파일 없이** 적용했다
--   (운영 DB 이름 `raise_submission_item_cap_30_to_200`). 그래서
--   `20260808_s1_*.sql` 은 아직 30 이라고 적혀 있고 운영은 200 이다.
--   이 파일은 **운영의 현재 정의(200)** 를 기준으로 다시 쓴다 — 적용하면 그 드리프트도
--   함께 메워진다.
--
-- 적용 순서 · 무엇을 건드리나
--   climate_vote.submission_lines(text)            신규 (helper)
--   climate_vote.submission_split_items(jsonb)     신규 (helper)
--   climate_vote.submission_save(text,uuid,jsonb)  교체 (시그니처 동일 → create or replace)
--   climate_vote.submission_save_v2(...)           교체 (동일)
--   표·열은 건드리지 않는다.

-- ── 1. 한 항목 안의 「줄」 ─────────────────────────────────────
-- ★ 패턴은 작은따옴표 그대로다. E'\r?\n' 로 쓰면 진짜 CR·LF 문자가 박혀
--   「CR 을 0~1개」라는 엉뚱한 정규식이 된다.
create or replace function climate_vote.submission_lines(p_text text)
returns text[] language sql immutable
set search_path = pg_catalog, pg_temp as $$
  select coalesce(
    array(
      select trim(u.l)
      from unnest(regexp_split_to_array(coalesce(p_text, ''), '\r?\n')) with ordinality as u(l, i)
      where length(trim(u.l)) > 0
      order by u.i
    ),
    array[]::text[]);
$$;

comment on function climate_vote.submission_lines(text) is
  '조 산출물 한 칸 안의 줄 목록. 화면 splitSubmissionLines 와 같은 규칙(\r?\n · trim · 빈 줄 제거).';

-- ── 2. p_items 정규화 — 여러 줄 항목을 항목 여러 개로 ─────────────
-- ordinal 은 **전체를 1부터 다시 매긴다.** 화면도 저장할 때 1..N 으로 다시 매겨 보내므로
-- (toSaveItems) 같은 규칙이다.
-- rationale 은 **나뉜 첫 조각에만** 남긴다 — N 벌로 복제하면 원문에 없던 근거가 늘어난다.
-- kind 는 그대로 물려준다.
create or replace function climate_vote.submission_split_items(p_items jsonb)
returns jsonb language sql immutable
set search_path = climate_vote, pg_catalog, pg_temp as $$
  with src as (
    select rn::int as rn, e
    from jsonb_array_elements(p_items) with ordinality as x(e, rn)
  ),
  parts as (
    select s.rn, s.e,
           case
             when cardinality(climate_vote.submission_lines(s.e->>'content')) >= 2
               then climate_vote.submission_lines(s.e->>'content')
             -- 나누지 않는 항목은 원문 그대로 — trim 도 하지 않는다.
             else array[s.e->>'content']
           end as ps
    from src s
  ),
  flat as (
    select p.rn, p.e, t.part, t.i
    from parts p, unnest(p.ps) with ordinality as t(part, i)
  ),
  numbered as (
    select row_number() over (order by f.rn, f.i) as ord, f.e, f.part, f.i
    from flat f
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'ordinal', n.ord,
        'kind', coalesce(nullif(n.e->>'kind', ''), 'core'),
        'content', n.part,
        'rationale', case when n.i = 1 then nullif(n.e->>'rationale', '') else null end)
      order by n.ord),
    '[]'::jsonb)
  from numbered n;
$$;

comment on function climate_vote.submission_split_items(jsonb) is
  'submission_save p_items 정규화 — 한 항목에 줄이 2개 이상이면 항목을 나누고 ordinal 을 1부터 다시 매긴다. 한 줄짜리는 원문 그대로.';

-- ── 3. submission_save (s1) — 정규화만 얹는다 ────────────────────
-- 나머지 본문(조 코드 검증 · 꼭지 open 검증 · final 잠금 · delete 후 insert)은
-- 운영의 현재 정의 그대로다.
create or replace function climate_vote.submission_save(
  p_code text, p_topic_id uuid, p_items jsonb)
returns jsonb language plpgsql security definer
set search_path = climate_vote, pg_temp as $$
declare
  v_team climate_vote.team; v_sub climate_vote.submission; v_n int;
  v_items jsonb; v_in int; v_out int; v_skipped boolean := false;
begin
  select * into v_team from climate_vote.team where join_code = p_code and status = 'active';
  if not found then raise exception 'invalid join code'; end if;
  perform 1 from climate_vote.discussion_topic
   where id = p_topic_id and status = 'open' and session_id = v_team.session_id;
  if not found then raise exception 'topic not open in this session'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 200 then
    raise exception 'items must be array (max 200)';
  end if;

  -- ★ 서버 줄 분해. 화면이 무슨 코드를 돌든 여기서 한 줄이 한 항목이 된다.
  v_in := jsonb_array_length(p_items);
  v_items := climate_vote.submission_split_items(p_items);
  v_out := jsonb_array_length(v_items);
  if v_out > 200 then
    -- 상한 초과 — 나누기를 포기하고 받은 그대로 저장한다(글자는 하나도 잃지 않는다).
    -- 파일 머리말 「★ 상한(200)을 넘으면」 참조.
    v_items := p_items;
    v_out := v_in;
    v_skipped := true;
  end if;

  insert into climate_vote.submission (topic_id, team_id)
  values (p_topic_id, v_team.id)
  on conflict (topic_id, team_id) do update set updated_at = now()
  returning * into v_sub;

  if v_sub.status = 'final' then
    raise exception 'submission is finalized — reopen required (hq)';
  end if;

  delete from climate_vote.submission_item where submission_id = v_sub.id;
  insert into climate_vote.submission_item (submission_id, ordinal, kind, content, rationale)
  select v_sub.id,
         coalesce((e->>'ordinal')::int, rn),
         coalesce(nullif(e->>'kind',''), 'core'),
         e->>'content',
         nullif(e->>'rationale','')
  from jsonb_array_elements(v_items) with ordinality as x(e, rn)
  where length(trim(coalesce(e->>'content',''))) > 0;

  get diagnostics v_n = row_count;
  return jsonb_build_object(
    'id', v_sub.id, 'status', v_sub.status, 'saved', v_n,
    -- 서버가 늘린 줄 수. 0이면 아무것도 나누지 않았다(화면이 이미 나눠 보냈거나 한 줄씩이거나).
    'split', greatest(v_out - v_in, 0),
    'split_skipped_over_cap', v_skipped);
end $$;

-- ── 4. submission_save_v2 (platform_p2) — 같은 정규화 ────────────
-- ★ v2 는 ordinal 을 안정 키로 쓴다(upsert). 서버가 나누면 ordinal 이 밀리면서
--   같은 ordinal 에 다른 문장이 들어앉는다 → content 변경 AFTER UPDATE 트리거가
--   연결된 issue 를 draft 로 되돌린다. **의도한 동작이다** — 원문이 실제로 달라졌으므로
--   그 원문에 붙어 있던 검수 결과는 다시 봐야 한다.
create or replace function climate_vote.submission_save_v2(
  p_code text, p_topic_id uuid, p_items jsonb)
returns jsonb language plpgsql security definer
set search_path = climate_vote, pg_temp as $$
declare
  v_team climate_vote.team; v_sub climate_vote.submission; v_ords int[]; v_n int;
  v_items jsonb; v_in int; v_out int; v_skipped boolean := false;
begin
  select * into v_team from climate_vote.team where join_code = p_code and status = 'active';
  if not found then raise exception 'invalid join code'; end if;
  perform 1 from climate_vote.discussion_topic
   where id = p_topic_id and status = 'open' and session_id = v_team.session_id;
  if not found then raise exception 'topic not open in this session'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 200 then
    raise exception 'items must be array (max 200)';
  end if;

  v_in := jsonb_array_length(p_items);
  v_items := climate_vote.submission_split_items(p_items);
  v_out := jsonb_array_length(v_items);
  if v_out > 200 then
    v_items := p_items;
    v_out := v_in;
    v_skipped := true;
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
  from jsonb_array_elements(v_items) with ordinality as x(e, rn)
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
  from jsonb_array_elements(v_items) with ordinality as x(e, rn)
  where length(trim(coalesce(e->>'content',''))) > 0
  on conflict (submission_id, ordinal) do update
    set kind = excluded.kind, content = excluded.content, rationale = excluded.rationale;

  select count(*) into v_n from climate_vote.submission_item where submission_id = v_sub.id;
  return jsonb_build_object(
    'id', v_sub.id, 'status', v_sub.status, 'items', v_n,
    'split', greatest(v_out - v_in, 0),
    'split_skipped_over_cap', v_skipped);
end $$;

-- ── 5. 권한 ─────────────────────────────────────────────────────
-- create or replace 는 기존 grant 를 그대로 두지만, AGENTS.md 의 「4·5 는 항상 짝」을
-- 지켜 다시 못 박는다. PUBLIC 을 남기면 anon 만 회수해도 안 닫힌다.
revoke execute on function
  climate_vote.submission_save(text, uuid, jsonb),
  climate_vote.submission_save_v2(text, uuid, jsonb)
from public;

grant execute on function
  climate_vote.submission_save(text, uuid, jsonb),
  climate_vote.submission_save_v2(text, uuid, jsonb)
to anon, authenticated;

-- helper 2종은 **클라이언트가 부를 것이 아니다.** SECURITY DEFINER 본문에서만 쓰이고
-- 그 본문은 소유자 권한으로 돌므로 anon/authenticated grant 가 필요 없다.
-- 기본값으로 PUBLIC 에 붙는 EXECUTE 만 걷어낸다.
revoke execute on function
  climate_vote.submission_lines(text),
  climate_vote.submission_split_items(jsonb)
from public;

-- ══════════════════════════════════════════════════════════════════
-- ------------------------------------------------------------------
-- submission_finalize_hq — 본부가 조를 대신해 잠근다
--
-- 왜 필요한가: 기존 submission_finalize(p_code, p_topic_id) 는 조 코드로만
-- 돌고 감사기록에 actor_scope='team' · finalized_by='mod:<조>' 를 남긴다.
-- 본부가 행사 뒤 일괄로 잠글 때 그걸 쓰면 17건이 「조가 스스로 최종 제출했다」로
-- 기록된다. 공론화 감사기록에 거짓이 남는다.
-- 인증·감사 패턴은 submission_reopen(hq) 을 그대로 따른다.
-- ------------------------------------------------------------------
create or replace function climate_vote.submission_finalize_hq(
  p_token text, p_submission_id uuid, p_reason text
) returns jsonb
language plpgsql security definer
set search_path to 'climate_vote', 'extensions', 'pg_temp'
as $fn$
declare v_auth climate_vote.attendance_auth_session; v_sub climate_vote.submission; v_cnt int;
begin
  v_auth := climate_vote.attendance_token_row(p_token);
  if v_auth.scope <> 'hq' then raise exception 'hq authorization required'; end if;
  if length(trim(coalesce(p_reason,''))) < 2 then raise exception 'reason required'; end if;
  select * into v_sub from climate_vote.submission where id = p_submission_id;
  if not found then raise exception 'submission not found'; end if;
  if v_sub.status = 'final' then raise exception 'already finalized'; end if;
  select count(*) into v_cnt from climate_vote.submission_item where submission_id = v_sub.id;
  if v_cnt = 0 then raise exception 'cannot finalize empty submission'; end if;

  update climate_vote.submission
     set status = 'final', finalized_at = now(), finalized_by = 'hq:' || v_auth.actor_label
   where id = v_sub.id;
  insert into climate_vote.submission_lock_event
    (submission_id, action, actor_scope, actor_label, reason)
  values (v_sub.id, 'finalize', 'hq', v_auth.actor_label, trim(p_reason));
  return jsonb_build_object('id', v_sub.id, 'status', 'final', 'items', v_cnt);
end $fn$;

revoke all on function climate_vote.submission_finalize_hq(text, uuid, text) from public;
grant execute on function climate_vote.submission_finalize_hq(text, uuid, text) to anon, authenticated;

-- 되돌리기 (ROLLBACK)
--   drop function if exists climate_vote.submission_finalize_hq(text, uuid, text); — 적용한 뒤에 되돌려야 할 때만 쓴다
--
-- ★ **s1(`20260808_s1_*.sql`)을 다시 돌리면 안 된다.** 그 파일의 submission_save 는
--   상한이 아직 **30** 이다 — 8.29에 두 조가 걸렸던 바로 그 값이다. 되돌리려다
--   그 결함을 되살리게 된다.
--
-- 아래는 **2026-08-30 운영 DB 의 s15 적용 직전 정의를 pg_get_functiondef 로 그대로
-- 떠 온 것**이다(상한 200, 서버 분해 없음). 이 블록의 주석을 풀어 실행하면 그 상태로
-- 정확히 돌아간다. helper 2종은 남아도 아무 데서도 불리지 않지만, 깨끗이 지우려면
-- 맨 아래 drop 두 줄도 함께 푼다.
--
-- 적용 전이라면 이 블록이 필요 없다 — 파일을 지우거나 커밋을 되돌리면 끝이다.
-- ══════════════════════════════════════════════════════════════════
--
-- CREATE OR REPLACE FUNCTION climate_vote.submission_save(p_code text, p_topic_id uuid, p_items jsonb)
--  RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
--  SET search_path TO 'climate_vote', 'pg_temp'
-- AS $function$
-- declare v_team climate_vote.team; v_sub climate_vote.submission; v_n int;
-- begin
--   select * into v_team from climate_vote.team where join_code = p_code and status = 'active';
--   if not found then raise exception 'invalid join code'; end if;
--   perform 1 from climate_vote.discussion_topic
--    where id = p_topic_id and status = 'open' and session_id = v_team.session_id;
--   if not found then raise exception 'topic not open in this session'; end if;
--   if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 200 then
--     raise exception 'items must be array (max 200)';
--   end if;
--
--   insert into climate_vote.submission (topic_id, team_id)
--   values (p_topic_id, v_team.id)
--   on conflict (topic_id, team_id) do update set updated_at = now()
--   returning * into v_sub;
--
--   if v_sub.status = 'final' then
--     raise exception 'submission is finalized — reopen required (hq)';
--   end if;
--
--   delete from climate_vote.submission_item where submission_id = v_sub.id;
--   insert into climate_vote.submission_item (submission_id, ordinal, kind, content, rationale)
--   select v_sub.id,
--          coalesce((e->>'ordinal')::int, rn),
--          coalesce(nullif(e->>'kind',''), 'core'),
--          e->>'content',
--          nullif(e->>'rationale','')
--   from jsonb_array_elements(p_items) with ordinality as x(e, rn)
--   where length(trim(coalesce(e->>'content',''))) > 0;
--
--   get diagnostics v_n = row_count;
--   return jsonb_build_object('id', v_sub.id, 'status', v_sub.status, 'saved', v_n);
-- end $function$;
--
-- CREATE OR REPLACE FUNCTION climate_vote.submission_save_v2(p_code text, p_topic_id uuid, p_items jsonb)
--  RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
--  SET search_path TO 'climate_vote', 'pg_temp'
-- AS $function$
-- declare v_team climate_vote.team; v_sub climate_vote.submission; v_ords int[]; v_n int;
-- begin
--   select * into v_team from climate_vote.team where join_code = p_code and status = 'active';
--   if not found then raise exception 'invalid join code'; end if;
--   perform 1 from climate_vote.discussion_topic
--    where id = p_topic_id and status = 'open' and session_id = v_team.session_id;
--   if not found then raise exception 'topic not open in this session'; end if;
--   if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 200 then
--     raise exception 'items must be array (max 200)';
--   end if;
--
--   insert into climate_vote.submission (topic_id, team_id)
--   values (p_topic_id, v_team.id)
--   on conflict (topic_id, team_id) do update set updated_at = now()
--   returning * into v_sub;
--
--   if v_sub.status = 'final' then
--     raise exception 'submission is finalized — reopen required (hq)';
--   end if;
--
--   select coalesce(array_agg(coalesce((e->>'ordinal')::int, rn)), array[]::int[])
--     into v_ords
--   from jsonb_array_elements(p_items) with ordinality as x(e, rn)
--   where length(trim(coalesce(e->>'content',''))) > 0;
--
--   update climate_vote.issue i
--      set review_status = 'draft', reviewed_by = null, reviewed_at = null
--    where i.review_status = 'reviewed'
--      and i.id in (
--        select il.issue_id from climate_vote.issue_link il
--        join climate_vote.submission_item si on si.id = il.item_id
--        where si.submission_id = v_sub.id and not (si.ordinal = any(v_ords)));
--   delete from climate_vote.issue_link il
--    using climate_vote.submission_item si
--    where il.item_id = si.id and si.submission_id = v_sub.id
--      and not (si.ordinal = any(v_ords));
--   delete from climate_vote.submission_item
--    where submission_id = v_sub.id and not (ordinal = any(v_ords));
--
--   insert into climate_vote.submission_item (submission_id, ordinal, kind, content, rationale)
--   select v_sub.id,
--          coalesce((e->>'ordinal')::int, rn),
--          coalesce(nullif(e->>'kind',''), 'core'),
--          e->>'content',
--          nullif(e->>'rationale','')
--   from jsonb_array_elements(p_items) with ordinality as x(e, rn)
--   where length(trim(coalesce(e->>'content',''))) > 0
--   on conflict (submission_id, ordinal) do update
--     set kind = excluded.kind, content = excluded.content, rationale = excluded.rationale;
--
--   select count(*) into v_n from climate_vote.submission_item where submission_id = v_sub.id;
--   return jsonb_build_object('id', v_sub.id, 'status', v_sub.status, 'items', v_n);
-- end $function$;
--
-- drop function if exists climate_vote.submission_split_items(jsonb);
-- drop function if exists climate_vote.submission_lines(text);
