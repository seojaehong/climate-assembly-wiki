-- 20260830_s16 — public.cv_* 뷰 4종에서 anon·authenticated 쓰기 권한 회수
--
-- ★ 미적용. 2026-08-30 기준 운영에 아직 반영되지 않았다.
--   적용: supabase db push  또는  MCP apply_migration(name='revoke_anon_dml_on_cv_views')
--
-- 무엇이 문제인가 (2026-08-30 실측)
--   pg_class.relacl 확인 결과 네 뷰 모두 **anon=arwdDxtm** 이다.
--   r(SELECT) 뿐 아니라 a(INSERT)·w(UPDATE)·d(DELETE)·D(TRUNCATE) 까지 열려 있다.
--   뷰는 security_invoker 가 아니면 **소유자(postgres) 권한으로 돌아 기반 테이블의
--   RLS 를 우회한다.** 즉 배포된 번들에 들어 있는 공개 anon 키만으로 투표를 지울 수 있다.
--
--   이건 이론이 아니다 — 2026-06-14 에 투표 약 150건이 리셋으로 영구 손실됐고
--   이 프로젝트는 PITR 이 없다. 그 경로가 바로 이것이다.
--   8.29 행사 내내 열린 채였고, 회수는 그때부터 대기 중이었다.
--
-- 무엇을 남기나 — SELECT 는 남긴다
--   `public/0704-supabase-vote/index.html:161` 이 cv_tally 를 **GET 으로만** 읽어
--   집계를 표시한다(실측 확인). 읽기를 끊으면 그 화면이 죽는다.
--
-- ★ 무엇이 깨지나 — 의도된 것이다
--   cv_votes 를 DELETE 하던 리셋 경로가 막힌다.
--   운영상 리셋이 필요하면 service_role 이나 SECURITY DEFINER RPC 로 해야 하며,
--   그래야 누가 언제 지웠는지 감사 기록이 남는다. anon 키로 지워지는 것이 문제였다.

revoke insert, update, delete, truncate, references, trigger
  on public.cv_rounds, public.cv_tally, public.cv_tally_scale, public.cv_votes
  from anon, authenticated;

grant select
  on public.cv_rounds, public.cv_tally, public.cv_tally_scale, public.cv_votes
  to anon, authenticated;

-- 적용 후 확인 (anon 에 r 만 남아야 한다)
--   select c.relname, array_to_string(c.relacl,' | ')
--     from pg_class c join pg_namespace n on n.oid=c.relnamespace
--    where n.nspname='public' and c.relname like 'cv\_%';
--   기대: anon=r/postgres
--
-- 되돌리기 (ROLLBACK) — 필요할 때만
--   grant all on public.cv_rounds, public.cv_tally, public.cv_tally_scale, public.cv_votes
--     to anon, authenticated;
