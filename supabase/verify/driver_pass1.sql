\if :{?verify_function_bodies}
\else
  \set verify_function_bodies off
\endif
SET check_function_bodies = :verify_function_bodies;
\echo === prelude ===
\i /tmp/00_prelude.sql
\echo === mod_console_core ===
\i /tmp/20260724_mod_console_core.sql
\echo === capture_votes_unique_index ===
\i /tmp/20260724_capture_votes_unique_index.sql
\echo === mod_log_timer_rpc ===
\i /tmp/20260724_mod_log_timer_rpc.sql
\echo === votes_active_round_guard ===
\i /tmp/20260724_votes_active_round_guard.sql
\echo === attendance_roster_hq ===
\i /tmp/20260725_attendance_roster_hq.sql
\echo === team_table_no ===
\i /tmp/20260726_team_table_no.sql
\echo === s1 ===
\i /tmp/20260808_s1_assembly_topic_submission.sql
\echo === s2 ===
\i /tmp/20260808_s2_ballot_multi_agenda.sql
\echo === s4 ===
\i /tmp/20260808_s4_ballot_subgroup.sql
\echo === PLATFORM P1 ===
\i /tmp/platform_p1_tenancy.sql
\echo === PLATFORM P1C ORG SELECTION ===
\i /tmp/platform_p1c_org_selection.sql
\echo === PLATFORM P2 ===
\i /tmp/platform_p2_analysis_review.sql
\echo === PASS1 DONE ===
