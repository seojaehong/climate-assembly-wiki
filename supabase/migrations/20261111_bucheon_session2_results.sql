-- 2026-11-18 부천 100인 공론장 — 세션2 분임 결과(템플릿 사진 → 글자 읽기 → 본부 확인 → 송출)
-- 진행계획 4.0: 분임마다 전략 1개(5개 세부과제)를 맡아 우선순위 과제를 고르고 사업화 아이디어를 낸다.
-- 결과는 퍼실이 찍은 템플릿 사진에서 읽는다(사람이 입력하지 않는다). 본부가 확인한 조만 스크린에 나간다.
-- 추가형 마이그레이션: 기존 bucheon_priority·조 화면 세션2 입력은 그대로 둔다(쓰지 않음).

create table if not exists public.bucheon_strategy (
  id    int primary key check (id between 1 and 9),
  name  text not null,
  goal  text not null
);

create table if not exists public.bucheon_task (
  code     text primary key check (code ~ '^[1-9]-[1-9]$'),
  strategy int  not null references public.bucheon_strategy(id),
  ord      int  not null,
  title    text not null
);

alter table public.bucheon_team add column if not exists strategy int references public.bucheon_strategy(id);
alter table public.bucheon_team add column if not exists label text;

create table if not exists public.bucheon_result (
  team_no    int primary key references public.bucheon_team(team_no) on delete cascade,
  votes      jsonb not null default '{}'::jsonb,   -- {"2-1": 7, ...} 우선순위 템플릿의 스티커 수(읽은 값, 모르면 없음)
  picks      jsonb not null default '[]'::jsonb,   -- [{"code":"2-1","ideas":["…","…"]}] 선정 과제와 아이디어
  note       text,                                 -- 글자 읽기에서 확실하지 않았던 부분
  confirmed  boolean not null default false,       -- 본부가 확인해야 스크린에 나간다
  source     text not null default 'ocr' check (source in ('ocr', 'hq')),
  updated_at timestamptz not null default now()
);

create table if not exists public.bucheon_result_photo (
  id         bigserial primary key,
  team_no    int  not null references public.bucheon_team(team_no) on delete cascade,
  kind       text not null check (kind in ('priority', 'idea', 'other')),
  src_event  text unique,
  image      text not null check (image like 'data:image/jpeg;base64,%' and char_length(image) <= 1500000),
  created_at timestamptz not null default now()
);

alter table public.bucheon_strategy     enable row level security;
alter table public.bucheon_task         enable row level security;
alter table public.bucheon_result       enable row level security;
alter table public.bucheon_result_photo enable row level security;

insert into public.bucheon_strategy (id, name, goal) values
  (1, '노동존중', '일하는 모든 시민의 노동기본권 보장'),
  (2, '안전일터', '안전하고 건강한 일터 조성'),
  (3, '지역상생', '산업전환 대응 및 지속가능한 좋은 일자리'),
  (4, '포용복지', '취약노동자 보호 및 노동복지 격차 완화'),
  (5, '협력연대', '시민참여 정책설계·실행 고도화')
on conflict (id) do update set name = excluded.name, goal = excluded.goal;

insert into public.bucheon_task (code, strategy, ord, title) values
  ('1-1', 1, 1, '찾아가는 노동상담 및 권리구제 확대'),
  ('1-2', 1, 2, '생활임금 민간확산 및 노동존중기업 지원'),
  ('1-3', 1, 3, '영세사업장 노동관계법 준수 지원'),
  ('1-4', 1, 4, '미조직·플랫폼·프리랜서 노동자 권익보호'),
  ('1-5', 1, 5, '노동인권교육 및 노동존중 문화 확산'),
  ('2-1', 2, 1, '소규모 사업장 산업안전 예방지원'),
  ('2-2', 2, 2, '노동안전지킴이 및 안전보건 협력체계 강화'),
  ('2-3', 2, 3, '취약노동자 건강권 및 유급병가 지원'),
  ('2-4', 2, 4, '고위험 업종 건강권 보호 및 모니터링체계 구축'),
  ('2-5', 2, 5, '기후위기 대응 노동자 건강보호'),
  ('3-1', 3, 1, '산업전환 및 고용위기 조기대응체계 구축'),
  ('3-2', 3, 2, 'AI·디지털 전환 대응 직무훈련 확대'),
  ('3-3', 3, 3, '중장년·고령노동자 전직 및 재취업 지원'),
  ('3-4', 3, 4, '청년 좋은 일자리 및 지역정착 지원'),
  ('3-5', 3, 5, '중소기업 고용유지 및 공동훈련 지원'),
  ('4-1', 4, 1, '이주노동자 노동권 및 정착지원'),
  ('4-2', 4, 2, '플랫폼·이동노동자 쉼터 및 복지 확대'),
  ('4-3', 4, 3, '돌봄·필수노동자 처우 및 노동환경 개선'),
  ('4-4', 4, 4, '영세사업장 사회보험 지원 확대'),
  ('4-5', 4, 5, '원·하청 및 중소기업 공동근로복지기금 활성화'),
  ('5-1', 5, 1, '일하는 시민 참여 정책 플랫폼 구축'),
  ('5-2', 5, 2, '고용노동 지원기관 기능 및 전달체계 개선'),
  ('5-3', 5, 3, '노사민정협의회 및 현장중심 노동 거버넌스 활성화'),
  ('5-4', 5, 4, '노동관련 조례 및 제도 정비'),
  ('5-5', 5, 5, '노동실태조사 정례화 및 노동공시 목표제')
on conflict (code) do update set strategy = excluded.strategy, ord = excluded.ord, title = excluded.title;

-- 분임 배정(진행계획 4.0 표) — 협력연대(5)는 공통논의라 맡은 조가 없다
update public.bucheon_team t set strategy = v.s, label = v.l
from (values (1, 2, '산업안전'), (2, 2, '산업안전'), (3, 3, '일자리·고용'), (4, 3, '일자리·고용'),
             (5, 1, '작은사업장'), (6, 1, '작은사업장'), (7, 3, '청년'),
             (8, 4, '노동권보호'), (9, 4, '노동권보호'), (10, 4, '노동권보호')) as v(n, s, l)
where t.team_no = v.n;

-- picks 검사: 배열, 과제 최대 5개, 과제 코드는 bucheon_task 에 있어야 하고 아이디어는 글 12개·200자 이내
create or replace function public.bucheon__picks(p jsonb)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_out jsonb := '[]'::jsonb;
  v_item jsonb;
  v_ideas jsonb;
  v_idea text;
  v_clean jsonb;
begin
  if p is null then return '[]'::jsonb; end if;
  if jsonb_typeof(p) <> 'array' or jsonb_array_length(p) > 5 then
    raise exception 'invalid picks' using errcode = 'P0001';
  end if;
  for v_item in select * from jsonb_array_elements(p) loop
    if not exists (select 1 from bucheon_task where code = v_item->>'code') then
      raise exception 'invalid task %', v_item->>'code' using errcode = 'P0001';
    end if;
    v_ideas := coalesce(v_item->'ideas', '[]'::jsonb);
    if jsonb_typeof(v_ideas) <> 'array' or jsonb_array_length(v_ideas) > 12 then
      raise exception 'invalid ideas' using errcode = 'P0001';
    end if;
    v_clean := '[]'::jsonb;
    for v_idea in select btrim(x) from jsonb_array_elements_text(v_ideas) x loop
      if v_idea <> '' then v_clean := v_clean || to_jsonb(left(v_idea, 200)); end if;
    end loop;
    v_out := v_out || jsonb_build_object('code', v_item->>'code', 'ideas', v_clean);
  end loop;
  return v_out;
end $$;

create or replace function public.bucheon__votes(p jsonb)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_out jsonb := '{}'::jsonb;
  r record;
begin
  if p is null then return '{}'::jsonb; end if;
  if jsonb_typeof(p) <> 'object' then raise exception 'invalid votes' using errcode = 'P0001'; end if;
  for r in select key, value from jsonb_each(p) loop
    if not exists (select 1 from bucheon_task where code = r.key) then
      raise exception 'invalid task %', r.key using errcode = 'P0001';
    end if;
    if jsonb_typeof(r.value) = 'number' and (r.value::text)::numeric between 0 and 999 then
      v_out := v_out || jsonb_build_object(r.key, (r.value::text)::int);
    end if;
  end loop;
  return v_out;
end $$;

-- 브리지(글자 읽기 결과). p_votes·p_picks 중 null 이 아닌 쪽만 바꾼다(사진 두 장이 따로 올 수 있다).
-- 새로 읽으면 확인을 다시 받아야 한다(confirmed = false).
create or replace function public.bucheon_feed_result(p_key text, p_team_no int, p_votes jsonb, p_picks jsonb, p_note text)
returns jsonb language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_votes jsonb := case when p_votes is null then null else bucheon__votes(p_votes) end;
  v_picks jsonb := case when p_picks is null then null else bucheon__picks(p_picks) end;
begin
  perform bucheon__hq_check(p_key);
  if not exists (select 1 from bucheon_team where team_no = p_team_no) then
    raise exception 'invalid team' using errcode = 'P0001';
  end if;
  insert into bucheon_result (team_no, votes, picks, note, confirmed, source, updated_at)
  values (p_team_no, coalesce(v_votes, '{}'::jsonb), coalesce(v_picks, '[]'::jsonb), left(p_note, 1000), false, 'ocr', now())
  on conflict (team_no) do update set
    votes = coalesce(v_votes, bucheon_result.votes),
    picks = coalesce(v_picks, bucheon_result.picks),
    note = left(nullif(concat_ws(' / ', nullif(p_note, ''),
             case when bucheon_result.note is distinct from p_note then bucheon_result.note end), ''), 1000),
    confirmed = false, source = 'ocr', updated_at = now();
  return jsonb_build_object('ok', true, 'team_no', p_team_no);
end $$;

-- 본부 확인·수정. 전체를 덮어쓴다.
create or replace function public.bucheon_result_edit(p_key text, p_team_no int, p_votes jsonb, p_picks jsonb, p_confirmed boolean)
returns jsonb language plpgsql volatile security definer set search_path = public, pg_temp as $$
begin
  perform bucheon__hq_check(p_key);
  if not exists (select 1 from bucheon_team where team_no = p_team_no) then
    raise exception 'invalid team' using errcode = 'P0001';
  end if;
  -- 빈 조가 스크린에 나가지 않게
  if coalesce(p_confirmed, false) and jsonb_array_length(bucheon__picks(p_picks)) = 0 then
    raise exception 'no picks to show' using errcode = 'P0001';
  end if;
  insert into bucheon_result (team_no, votes, picks, confirmed, source, updated_at)
  values (p_team_no, bucheon__votes(p_votes), bucheon__picks(p_picks), coalesce(p_confirmed, false), 'hq', now())
  on conflict (team_no) do update set votes = excluded.votes, picks = excluded.picks,
    confirmed = excluded.confirmed, source = 'hq', updated_at = now();
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.bucheon_feed_result_photo(p_key text, p_team_no int, p_kind text, p_image text, p_event text)
returns jsonb language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare v_id bigint;
begin
  perform bucheon__hq_check(p_key);
  if not exists (select 1 from bucheon_team where team_no = p_team_no) then
    raise exception 'invalid team' using errcode = 'P0001';
  end if;
  insert into bucheon_result_photo (team_no, kind, image, src_event)
  values (p_team_no, coalesce(p_kind, 'other'), p_image, p_event)
  on conflict (src_event) do update set team_no = excluded.team_no, kind = excluded.kind
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

-- 사진은 무거워서 5초 갱신(bucheon_hq)에 넣지 않고 확인할 때만 받는다
create or replace function public.bucheon_result_photos(p_key text, p_team_no int)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform bucheon__hq_check(p_key);
  return (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'kind', kind, 'image', image, 'created_at', created_at)
                                    order by id desc), '[]'::jsonb)
          from bucheon_result_photo where team_no = p_team_no);
end $$;

create or replace function public.bucheon_hq(p_key text)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform bucheon__hq_check(p_key);
  return jsonb_build_object(
    'now',        now(),
    'teams',      (select coalesce(jsonb_agg(team_no order by team_no), '[]'::jsonb) from bucheon_team),
    'team_info',  (select coalesce(jsonb_agg(jsonb_build_object('team_no', team_no, 'strategy', strategy, 'label', label)
                                             order by team_no), '[]'::jsonb) from bucheon_team),
    'strategies', (select coalesce(jsonb_agg(to_jsonb(s) order by s.id), '[]'::jsonb) from bucheon_strategy s),
    'tasks',      (select coalesce(jsonb_agg(to_jsonb(t) order by t.code), '[]'::jsonb) from bucheon_task t),
    'policies',   bucheon__policies(),
    'questions',  (select coalesce(jsonb_agg(to_jsonb(q) order by q.team_no), '[]'::jsonb) from bucheon_question q),
    'priorities', (select coalesce(jsonb_agg(to_jsonb(p) order by p.team_no), '[]'::jsonb) from bucheon_priority p),
    'results',    (select coalesce(jsonb_agg(to_jsonb(r) || jsonb_build_object(
                     'photos', (select count(*) from bucheon_result_photo ph where ph.team_no = r.team_no))
                     order by r.team_no), '[]'::jsonb) from bucheon_result r),
    'surveys',    (select coalesce(jsonb_agg(s.answers order by s.id), '[]'::jsonb) from bucheon_survey s),
    'survey_open', (select survey_open from bucheon_config where id = 1)
  );
end $$;

revoke execute on function public.bucheon__picks(jsonb) from public, anon, authenticated;
revoke execute on function public.bucheon__votes(jsonb) from public, anon, authenticated;
revoke execute on function public.bucheon_feed_result(text, int, jsonb, jsonb, text) from public;
revoke execute on function public.bucheon_result_edit(text, int, jsonb, jsonb, boolean) from public;
revoke execute on function public.bucheon_feed_result_photo(text, int, text, text, text) from public;
revoke execute on function public.bucheon_result_photos(text, int) from public;
revoke execute on function public.bucheon_hq(text) from public;
grant execute on function public.bucheon_feed_result(text, int, jsonb, jsonb, text) to anon, authenticated;
grant execute on function public.bucheon_result_edit(text, int, jsonb, jsonb, boolean) to anon, authenticated;
grant execute on function public.bucheon_feed_result_photo(text, int, text, text, text) to anon, authenticated;
grant execute on function public.bucheon_result_photos(text, int) to anon, authenticated;
grant execute on function public.bucheon_hq(text) to anon, authenticated;
