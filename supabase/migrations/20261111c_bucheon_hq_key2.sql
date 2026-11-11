-- 부천 100인 공론장 — 본부 주소 키를 하나 더 둔다(두 번째 운영자용). 키 값은 이 파일에 적지 않는다(운영 DB 에서 난수로 생성).
alter table public.bucheon_config add column if not exists hq_key2 text;
update public.bucheon_config set hq_key2 = replace(gen_random_uuid()::text, '-', '') where id = 1 and hq_key2 is null;

create or replace function public.bucheon__hq_check(p_key text)
returns void language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if p_key is null or not exists (select 1 from bucheon_config where id = 1 and (hq_key = p_key or hq_key2 = p_key)) then
    raise exception 'invalid hq key' using errcode = 'P0001';
  end if;
end $$;

revoke execute on function public.bucheon__hq_check(text) from public, anon, authenticated;
