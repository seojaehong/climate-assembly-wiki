-- feat(integrity): service_role에 climate_vote.snapshots 읽기 권한 부여
-- project: labor_money (pleyuknjnprsckssxvrh), schema: climate_vote
--
-- WHY: export-snapshots-onedrive.mjs 로컬 export 스크립트가 SUPABASE_SERVICE_ROLE_KEY로
--      climate_vote.snapshots를 SELECT해야 한다. 현재 service_role에 climate_vote USAGE
--      grant가 없어 42501 오류 발생 (anon/authenticated/postgres만 USAGE 보유).
--
-- WHAT: service_role에 두 가지 최소 권한만 추가:
--       (1) USAGE on schema climate_vote
--       (2) SELECT on table climate_vote.snapshots  ← export 대상 단일 테이블
--       다른 테이블(votes, rounds, agenda 등)은 미변경 — PII 최소 노출 원칙.
--
-- SAFETY: GRANT ONLY — 기존 RLS/정책/데이터/트리거 무변경. 순수 additive.
--         service_role은 supabase-js 서버 측 클라이언트 전용(브라우저 미노출).
--         export 스크립트는 SELECT만 사용하므로 INSERT/UPDATE/DELETE 권한 미부여.
--
-- ROLLBACK:
--   REVOKE SELECT ON TABLE climate_vote.snapshots FROM service_role;
--   REVOKE USAGE ON SCHEMA climate_vote FROM service_role;

GRANT USAGE ON SCHEMA climate_vote TO service_role;
GRANT SELECT ON TABLE climate_vote.snapshots TO service_role;
