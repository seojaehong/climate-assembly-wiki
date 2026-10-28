-- 10/28 권고 문구 검토 화면 — 분과 대표 15명 + 모더레이터가 카드 항목별로 의견을 남긴다.
-- 화면 = public/r-1028-*/ (서버 Basic 잠금). 테이블은 RPC 로만 읽고 쓴다(직접 접근 없음).
-- 암호 원문은 저장소에 없다. rv_config 에 SHA-256 만 둔다(값은 SQL 편집기에서 따로 넣는다).

create table if not exists public.rv_config (
  key text primary key,
  sha256 text not null
);

create table if not exists public.rv_member (
  name text primary key,
  division int not null,          -- 1·2·3, 모더레이터는 0
  role text not null check (role in ('citizen', 'moderator')),
  sort int not null default 0
);

create table if not exists public.rv_note (
  id bigint generated always as identity primary key,
  card_no text not null,
  field text not null check (field in ('title', 'background', 'content', 'effect', 'schedule', 'general')),
  kind text not null check (kind in ('proposal', 'opinion')),   -- proposal = 수정제안(모더레이터), opinion = 검토의견(시민대표)
  author text not null references public.rv_member(name),
  body text not null check (length(body) between 1 and 20000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists rv_note_card on public.rv_note(card_no);

alter table public.rv_config enable row level security;
alter table public.rv_member enable row level security;
alter table public.rv_note enable row level security;
revoke all on public.rv_config, public.rv_member, public.rv_note from public, anon, authenticated;

-- 암호 확인: 'member' = 참여 암호, 'moderator' = 모더레이터 암호
create or replace function public.rv_check(p_pass text, p_key text) returns boolean
language sql security definer set search_path = public, extensions stable as $$
  select exists (select 1 from rv_config
                 where key = p_key and sha256 = encode(extensions.digest(coalesce(p_pass, ''), 'sha256'), 'hex'));
$$;
revoke all on function public.rv_check(text, text) from public, anon, authenticated;

create or replace function public.rv_load(p_pass text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not rv_check(p_pass, 'member') then raise exception 'bad passcode' using errcode = 'P0001'; end if;
  return jsonb_build_object(
    'members', (select coalesce(jsonb_agg(jsonb_build_object('name', name, 'division', division, 'role', role) order by sort, name), '[]') from rv_member),
    'notes', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'card_no', card_no, 'field', field, 'kind', kind,
                'author', author, 'body', body, 'created_at', created_at, 'updated_at', updated_at) order by id), '[]')
              from rv_note where deleted_at is null));
end $$;

-- 쓰기·고치기: p_id 가 null 이면 새 글. 모더레이터 수정제안은 모더레이터 암호가 있어야 한다.
create or replace function public.rv_save(p_pass text, p_mod_pass text, p_id bigint, p_card text, p_field text,
                                          p_kind text, p_author text, p_body text) returns bigint
language plpgsql security definer set search_path = public as $$
declare v_role text; v_id bigint;
begin
  if not rv_check(p_pass, 'member') then raise exception 'bad passcode' using errcode = 'P0001'; end if;
  select role into v_role from rv_member where name = p_author;
  if v_role is null then raise exception 'unknown author' using errcode = 'P0001'; end if;
  if (p_kind = 'proposal' or v_role = 'moderator') and not rv_check(p_mod_pass, 'moderator') then
    raise exception 'moderator passcode required' using errcode = 'P0001';
  end if;
  if p_id is null then
    insert into rv_note(card_no, field, kind, author, body)
    values (p_card, p_field, p_kind, p_author, btrim(p_body)) returning id into v_id;
  else
    update rv_note set body = btrim(p_body), updated_at = now()
     where id = p_id and author = p_author and deleted_at is null returning id into v_id;
    if v_id is null then raise exception 'not your note' using errcode = 'P0001'; end if;
  end if;
  return v_id;
end $$;

create or replace function public.rv_delete(p_pass text, p_mod_pass text, p_id bigint, p_author text) returns void
language plpgsql security definer set search_path = public as $$
declare v_role text;
begin
  if not rv_check(p_pass, 'member') then raise exception 'bad passcode' using errcode = 'P0001'; end if;
  select role into v_role from rv_member where name = p_author;
  if v_role = 'moderator' and not rv_check(p_mod_pass, 'moderator') then
    raise exception 'moderator passcode required' using errcode = 'P0001';
  end if;
  update rv_note set deleted_at = now() where id = p_id and author = p_author and deleted_at is null;
  if not found then raise exception 'not your note' using errcode = 'P0001'; end if;
end $$;

-- 모더레이터 암호 확인용(화면에서 모더레이터 칸을 열 때)
create or replace function public.rv_mod_ok(p_mod_pass text) returns boolean
language sql security definer set search_path = public stable as $$ select rv_check(p_mod_pass, 'moderator'); $$;

revoke all on function public.rv_load(text), public.rv_save(text, text, bigint, text, text, text, text, text),
  public.rv_delete(text, text, bigint, text), public.rv_mod_ok(text) from public;
grant execute on function public.rv_load(text), public.rv_save(text, text, bigint, text, text, text, text, text),
  public.rv_delete(text, text, bigint, text), public.rv_mod_ok(text) to anon, authenticated;
