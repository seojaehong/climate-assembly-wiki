-- ROLLBACK REFERENCE (BEFORE state) — captured 2026-06-21 via pg_get_functiondef
-- project: labor_money (pleyuknjnprsckssxvrh), schema: climate_vote
--
-- These are the EXACT definitions of cv_snapshot_now and cv_archive_round
-- BEFORE the additive change in 20260621140534_snapshot_include_agenda.sql.
-- To roll back, run this file as-is (CREATE OR REPLACE restores prior payload).
--
-- DO NOT modify data tables, triggers, or policies — function definitions only.

CREATE OR REPLACE FUNCTION climate_vote.cv_archive_round(p_round_id text, p_reason text DEFAULT NULL::text, p_archived_by text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_max_attempt int;
  v_archived_count int;
  v_snapshot_id bigint;
BEGIN
  -- 1) 리셋 직전 강제 snapshot (Layer 1-B 보장)
  INSERT INTO climate_vote.snapshots (label, source, votes_count, rounds_count, archive_log_count, payload)
  SELECT 'pre_archive_' || p_round_id || '_' || extract(epoch from now())::bigint,
         'pre_archive',
         (SELECT COUNT(*) FROM climate_vote.votes),
         (SELECT COUNT(*) FROM climate_vote.rounds),
         (SELECT COUNT(*) FROM climate_vote.archive_log),
         jsonb_build_object(
           'votes',       COALESCE((SELECT jsonb_agg(to_jsonb(v) ORDER BY id) FROM climate_vote.votes v), '[]'::jsonb),
           'rounds',      COALESCE((SELECT jsonb_agg(to_jsonb(r) ORDER BY sort_order) FROM climate_vote.rounds r), '[]'::jsonb),
           'archive_log', COALESCE((SELECT jsonb_agg(to_jsonb(l) ORDER BY id) FROM climate_vote.archive_log l), '[]'::jsonb),
           'about_to_archive_round', p_round_id,
           'reason', p_reason,
           'archived_by', p_archived_by
         )
  RETURNING id INTO v_snapshot_id;

  -- 2) 기존 archive 로직
  SELECT COALESCE(MAX(attempt), 1) INTO v_max_attempt
    FROM climate_vote.votes WHERE round_id = p_round_id AND archived_at IS NULL;

  UPDATE climate_vote.votes
     SET archived_at = NOW(), archive_reason = p_reason, archived_by = p_archived_by
   WHERE round_id = p_round_id AND archived_at IS NULL;
  GET DIAGNOSTICS v_archived_count = ROW_COUNT;

  INSERT INTO climate_vote.archive_log (round_id, archived_by, reason, archived_count, attempt_archived, metadata)
  VALUES (p_round_id, p_archived_by, p_reason, v_archived_count, v_max_attempt,
          jsonb_build_object('source', 'cv_archive_round', 'pre_snapshot_id', v_snapshot_id));

  RETURN json_build_object(
    'round_id', p_round_id,
    'archived_count', v_archived_count,
    'archived_at', NOW(),
    'next_attempt', v_max_attempt + 1,
    'pre_snapshot_id', v_snapshot_id
  );
END $function$;

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
    'archive_log', COALESCE((SELECT jsonb_agg(to_jsonb(l) ORDER BY id) FROM climate_vote.archive_log l), '[]'::jsonb)
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
