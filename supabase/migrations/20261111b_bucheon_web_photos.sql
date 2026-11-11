-- 부천 100인 공론장 — 세션2 사진을 조 화면(버셀)에서 직접 받는다. 카톡은 예비.
-- 퍼실이 조 코드로 올린 사진은 read_at 이 비어 있고, 노트북의 web_photos.py 가 읽은 뒤 채운다.

alter table public.bucheon_result_photo add column if not exists read_at timestamptz;
alter table public.bucheon_result_photo add column if not exists source text not null default 'kakao';
-- 이미 있는 사진(카톡·직접 올림)은 읽은 것이다
update public.bucheon_result_photo set read_at = coalesce(read_at, created_at) where source = 'kakao';

-- 카톡·직접 올림은 읽은 뒤에 저장하므로 바로 read_at 을 채운다
create or replace function public.bucheon_feed_result_photo(p_key text, p_team_no int, p_kind text, p_image text, p_event text)
returns jsonb language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare v_id bigint;
begin
  perform bucheon__hq_check(p_key);
  if not exists (select 1 from bucheon_team where team_no = p_team_no) then
    raise exception 'invalid team' using errcode = 'P0001';
  end if;
  insert into bucheon_result_photo (team_no, kind, image, src_event, read_at, source)
  values (p_team_no, coalesce(p_kind, 'other'), p_image, p_event, now(), 'kakao')
  on conflict (src_event) do update set team_no = excluded.team_no, kind = excluded.kind
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

-- 퍼실 화면: 조 코드로 사진 1장 올리기(조당 20장까지)
create or replace function public.bucheon_upload_result_photo(p_code text, p_image text)
returns jsonb language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare v_team int := bucheon__team_no(p_code); v_id bigint;
begin
  if p_image is null or p_image not like 'data:image/jpeg;base64,%' or char_length(p_image) > 1500000 then
    raise exception 'invalid image' using errcode = 'P0001';
  end if;
  if (select count(*) from bucheon_result_photo where team_no = v_team) >= 20 then
    raise exception 'too many photos' using errcode = 'P0001';
  end if;
  insert into bucheon_result_photo (team_no, kind, image, src_event, source)
  values (v_team, 'other', p_image, 'web:' || gen_random_uuid(), 'web')
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'team_no', v_team);
end $$;

-- 퍼실 화면: 우리 조가 올린 사진과 진행 상태(사진 본문은 빼고 가볍게)
create or replace function public.bucheon_my_result(p_code text)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_team int := bucheon__team_no(p_code);
begin
  return jsonb_build_object(
    'team_no', v_team,
    'photos', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'created_at', created_at, 'read', read_at is not null,
                                                            'source', source) order by id), '[]'::jsonb)
               from bucheon_result_photo where team_no = v_team),
    'result', (select jsonb_build_object('confirmed', confirmed, 'updated_at', updated_at, 'picks', jsonb_array_length(picks))
               from bucheon_result where team_no = v_team));
end $$;

-- 퍼실 화면: 잘못 올린 사진 지우기(우리 조 것만)
create or replace function public.bucheon_delete_result_photo(p_code text, p_id bigint)
returns jsonb language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare v_team int := bucheon__team_no(p_code);
begin
  delete from bucheon_result_photo where id = p_id and team_no = v_team and source = 'web';
  return jsonb_build_object('ok', found);
end $$;

drop function if exists public.bucheon_pending_photos(text, int);
-- 노트북: 읽을 사진. 한 조가 마지막 사진을 올리고 p_quiet 초가 지나야 그 조 사진을 한꺼번에 넘긴다(두 장을 같이 읽게).
-- p_skip = 지금 읽고 있는 조(여러 조를 동시에 읽을 때 겹치지 않게)
create or replace function public.bucheon_pending_photos(p_key text, p_quiet int, p_skip int[])
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform bucheon__hq_check(p_key);
  return (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'team_no', team_no, 'image', image) order by team_no, id), '[]'::jsonb)
          from bucheon_result_photo ph
          where read_at is null
            and team_no = (select team_no from bucheon_result_photo
                           where read_at is null and team_no <> all(coalesce(p_skip, '{}'::int[]))
                           group by team_no
                           having max(created_at) < now() - make_interval(secs => greatest(p_quiet, 0))
                           order by min(created_at) limit 1));
end $$;

-- 노트북: 읽은 사진에 종류를 적고 읽음 표시
create or replace function public.bucheon_mark_photos(p_key text, p_ids bigint[], p_kinds text[])
returns jsonb language plpgsql volatile security definer set search_path = public, pg_temp as $$
begin
  perform bucheon__hq_check(p_key);
  update bucheon_result_photo ph set read_at = now(),
    kind = case when k.kind in ('priority', 'idea', 'other') then k.kind else ph.kind end
  from unnest(p_ids, p_kinds) as k(id, kind)
  where ph.id = k.id;
  return jsonb_build_object('ok', true);
end $$;

-- 본부: 조별 사진 수·읽는 중 수를 5초 갱신에 넣는다(결과가 아직 없어도 사진이 온 것을 보이게)
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
    'photos',     (select coalesce(jsonb_agg(jsonb_build_object('team_no', team_no, 'n', n, 'unread', u, 'last', l)
                                             order by team_no), '[]'::jsonb)
                   from (select team_no, count(*) n, count(*) filter (where read_at is null) u, max(id) l
                         from bucheon_result_photo group by team_no) x),
    'surveys',    (select coalesce(jsonb_agg(s.answers order by s.id), '[]'::jsonb) from bucheon_survey s),
    'survey_open', (select survey_open from bucheon_config where id = 1)
  );
end $$;

revoke execute on function public.bucheon_upload_result_photo(text, text) from public;
revoke execute on function public.bucheon_my_result(text) from public;
revoke execute on function public.bucheon_delete_result_photo(text, bigint) from public;
revoke execute on function public.bucheon_pending_photos(text, int, int[]) from public;
revoke execute on function public.bucheon_mark_photos(text, bigint[], text[]) from public;
grant execute on function public.bucheon_upload_result_photo(text, text) to anon, authenticated;
grant execute on function public.bucheon_my_result(text) to anon, authenticated;
grant execute on function public.bucheon_delete_result_photo(text, bigint) to anon, authenticated;
grant execute on function public.bucheon_pending_photos(text, int, int[]) to anon, authenticated;
grant execute on function public.bucheon_mark_photos(text, bigint[], text[]) to anon, authenticated;
