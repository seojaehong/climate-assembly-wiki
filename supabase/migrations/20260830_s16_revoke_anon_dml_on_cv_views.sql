-- 20260830_s16 — public.cv_* 뷰에서 anon·authenticated 의 **파괴적** 권한만 회수
--
-- ★ 2026-08-31 재작성. 초판은 INSERT 까지 회수했는데 **그러면 투표가 죽는다.**
--   `public/v/vote-form.js:183` 이 `cv_votes` 에 anon 키로 POST 한다 — 시민이
--   투표하는 바로 그 동작이다. 9.12~13 합숙에서 조별·분과별 투표가 예정돼 있어
--   적용 직전에 잡았다. 되돌릴 수 없는 종류의 실수였다.
--
-- 무엇이 문제인가 (2026-08-30 실측)
--   네 뷰 모두 **anon=arwdDxtm** 이다. 뷰는 security_invoker 가 아니면 소유자
--   (postgres) 권한으로 돌아 **기반 테이블의 RLS 를 우회한다.** 배포 번들에 들어
--   있는 공개 anon 키만으로 투표를 **지우거나 고칠 수 있다.**
--   2026-06-14 에 투표 약 150건이 리셋으로 영구 손실됐고 이 프로젝트는 PITR 이 없다.
--
-- 무엇을 남기나 — 투표가 계속 돌아야 한다
--   cv_votes  : SELECT(중복 확인 `vote-form.js:160`) + **INSERT(투표 제출 :183)**
--   cv_tally · cv_tally_scale · cv_rounds : SELECT 만 (:208 :210 :334, 전부 GET)
--
-- 무엇을 막나 — 아무도 필요로 하지 않는 것들
--   UPDATE  : 남의 표를 고치는 길. 정상 경로에 없다
--   DELETE  : 6.14 에 150건을 날린 그 길
--   TRUNCATE: 한 번에 전부
--   집계·라운드 뷰(cv_tally·cv_tally_scale·cv_rounds)의 INSERT 도 막는다 — 읽기 전용이다
--
-- 남는 약점 (이 마이그레이션의 범위 밖 — 별도 판단 필요)
--   중복 투표 방지가 **클라이언트 검사**(vote-form.js:160)뿐이라, INSERT 권한이 있는
--   한 anon 이 같은 라운드에 여러 번 넣을 수 있다. 막으려면 기반 테이블에
--   (round_id, client_id) 유니크 제약이나 SECURITY DEFINER RPC 로 감싸야 한다.
--   지금 고치면 투표 경로를 바꾸는 것이라 행사 직전에 손대지 않는다.

-- 1) 표 투입 뷰 — 읽기와 쓰기는 남기고 파괴적 권한만 회수
revoke update, delete, truncate, references, trigger
  on public.cv_votes
  from anon, authenticated;
grant select, insert on public.cv_votes to anon, authenticated;

-- 2) 집계·라운드 뷰 — 읽기 전용
revoke insert, update, delete, truncate, references, trigger
  on public.cv_rounds, public.cv_tally, public.cv_tally_scale
  from anon, authenticated;
grant select
  on public.cv_rounds, public.cv_tally, public.cv_tally_scale
  to anon, authenticated;

-- 적용 후 확인
--   select c.relname, array_to_string(c.relacl,' | ')
--     from pg_class c join pg_namespace n on n.oid=c.relnamespace
--    where n.nspname='public' and c.relname like 'cv\_%' order by 1;
--   기대: cv_votes 는 anon=ar/postgres · 나머지 셋은 anon=r/postgres
--
-- ★ 적용 후 반드시 실화면에서 투표를 한 번 넣어 볼 것. 권한 회수는
--   「테스트 통과」로 확인되지 않는다 — 실제 POST 가 200 인지 봐야 한다.
--
-- 되돌리기 (ROLLBACK)
--   grant all on public.cv_rounds, public.cv_tally, public.cv_tally_scale, public.cv_votes
--     to anon, authenticated;
