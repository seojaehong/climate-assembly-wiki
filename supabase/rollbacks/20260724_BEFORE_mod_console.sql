-- ROLLBACK REFERENCE (BEFORE state) — captured 2026-07-24 via pg_get_functiondef
-- project: labor_money (pleyuknjnprsckssxvrh), schema: climate_vote
--
-- Part A restores cv_snapshot_now to its EXACT definition BEFORE the additive
-- team/timer_log keys added in migrations/20260724_mod_console_core.sql.
-- Part B drops the new objects created by that migration, in dependency order
-- (functions first, then tables — team last since timer_log/module_state/
-- chat_message/rounds.team_id reference it).
--
-- DO NOT run Part B if later work (later dev tasks reuse the disabled test
-- team row '123456') already depends on these tables — check first.

-- ─────────────────────────────────────────────────────────────────────────
-- Part A: cv_snapshot_now — restore pre-mod-console definition (verbatim)
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION climate_vote.cv_snapshot_now(p_label text DEFAULT NULL::text, p_source text DEFAULT 'cron'::text)
 RETURNS json
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_id bigint;
  v_votes_count int;
  v_rounds_count int;
  v_archive_log_count int;
  v_payload jsonb;
BEGIN
  SELECT COUNT(*) INTO v_votes_count FROM climate_vote.votes;
  SELECT COUNT(*) INTO v_rounds_count FROM climate_vote.rounds;
  SELECT COUNT(*) INTO v_archive_log_count FROM climate_vote.archive_log;

  v_payload := jsonb_build_object(
    'votes',       COALESCE((SELECT jsonb_agg(to_jsonb(v) ORDER BY id) FROM climate_vote.votes v), '[]'::jsonb),
    'rounds',      COALESCE((SELECT jsonb_agg(to_jsonb(r) ORDER BY sort_order) FROM climate_vote.rounds r), '[]'::jsonb),
    'archive_log', COALESCE((SELECT jsonb_agg(to_jsonb(l) ORDER BY id) FROM climate_vote.archive_log l), '[]'::jsonb),
    'agenda',      COALESCE((SELECT jsonb_agg(to_jsonb(a)  ORDER BY a.id)  FROM climate_vote.agenda a), '[]'::jsonb),
    'agenda_link', COALESCE((SELECT jsonb_agg(to_jsonb(al) ORDER BY al.id) FROM climate_vote.agenda_link al), '[]'::jsonb),
    'agenda_vote', COALESCE((SELECT jsonb_agg(to_jsonb(av) ORDER BY av.id) FROM climate_vote.agenda_vote av), '[]'::jsonb),
    'tally',       COALESCE((SELECT jsonb_agg(to_jsonb(t))                 FROM climate_vote.tally t), '[]'::jsonb)
  );

  INSERT INTO climate_vote.snapshots (label, source, votes_count, rounds_count, archive_log_count, payload)
  VALUES (p_label, p_source, v_votes_count, v_rounds_count, v_archive_log_count, v_payload)
  RETURNING id INTO v_id;

  RETURN json_build_object(
    'id', v_id,
    'taken_at', NOW(),
    'votes', v_votes_count,
    'rounds', v_rounds_count,
    'archive_log', v_archive_log_count,
    'bytes', length(v_payload::text)
  );
END $function$;

-- ─────────────────────────────────────────────────────────────────────────
-- Part B: drop mod-console objects (reverse dependency order)
-- ⚠️ DESTRUCTIVE — only run if you intend to fully undo the mod-console
-- migration. Drops all team/timer_log/module_state/chat_message data.
-- ─────────────────────────────────────────────────────────────────────────
-- 1) Realtime publication membership — INTENTIONALLY NOT DE-REGISTERED.
-- The forward migration's ADD TABLE calls were idempotent (wrapped in
-- `exception when duplicate_object then null`), so we do not know whether
-- climate_vote.rounds/votes were already members of supabase_realtime
-- BEFORE this migration ran — pre-migration publication membership was
-- never recorded. Unconditionally dropping them here could silently break
-- existing live dashboards that already depend on this realtime feed,
-- independent of the mod-console feature. If de-registration is ever
-- actually needed, first check current membership:
--   select * from pg_publication_tables
--    where pubname = 'supabase_realtime' and schemaname = 'climate_vote';
-- and only DROP TABLE for rows confirmed to have been added by the
-- mod-console migration (not present before it).

-- 2) RPC functions
DROP FUNCTION IF EXISTS climate_vote.hq_teams();
DROP FUNCTION IF EXISTS climate_vote.mod_proxy_vote(text, text, jsonb, int);
DROP FUNCTION IF EXISTS climate_vote.mod_set_round_status(text, text, text);
DROP FUNCTION IF EXISTS climate_vote.mod_create_round(text, text, text, jsonb);
DROP FUNCTION IF EXISTS climate_vote.mod_join(text);

-- 3) rounds columns added by migration
ALTER TABLE climate_vote.rounds DROP COLUMN IF EXISTS created_by;
DROP INDEX IF EXISTS climate_vote.rounds_team_idx;
ALTER TABLE climate_vote.rounds DROP COLUMN IF EXISTS team_id;

-- 4) new tables (chat_message/timer_log/module_state reference team; drop them first)
DROP TABLE IF EXISTS climate_vote.chat_message;
DROP TABLE IF EXISTS climate_vote.timer_log;
DROP TABLE IF EXISTS climate_vote.module_state;
DROP TABLE IF EXISTS climate_vote.team CASCADE;
