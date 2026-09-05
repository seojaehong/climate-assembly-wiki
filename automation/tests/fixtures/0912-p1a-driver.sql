\set ON_ERROR_STOP on
set check_function_bodies = on;

\echo === P1A PRELUDE ===
\i /tmp/00_prelude.sql
\echo === P1A MODERATOR CORE ===
\i /tmp/20260724_mod_console_core.sql
\echo === P1A ATTENDANCE AUTHORIZATION ===
\i /tmp/20260725_attendance_roster_hq.sql
\echo === P1A TEAM TABLE NUMBER ===
\i /tmp/20260726_team_table_no.sql
\i /tmp/20260726_attendance_unlock_by_join_code.sql
\i /tmp/20260726_revoke_public_execute_attendance.sql
\i /tmp/20260726_revoke_pin_unlock.sql
\i /tmp/20260726_grant_authenticated_execute.sql
\echo === P1A DISCUSSION AND SUBMISSIONS ===
\i /tmp/20260808_s1_assembly_topic_submission.sql
\echo === P1A BALLOTS ===
\i /tmp/20260808_s2_ballot_multi_agenda.sql
\i /tmp/20260808_s4_ballot_subgroup.sql
\echo === P1A SUBMISSION HISTORY AND REOPEN ===
\i /tmp/20260828_s8_hq_reopen_and_history.sql
\i /tmp/20260828_s9_submission_category.sql
\i /tmp/20260828_s10_hq_named_operator.sql
\i /tmp/20260828_s11_hq_change_password.sql
\i /tmp/20260828_s12_ontology_kind.sql
\i /tmp/20260828_s13_team_reopen.sql
\i /tmp/20260828_s14_hq_clear_submissions.sql
\echo === P1A SERVER LINE SPLIT ===
\i /tmp/20260830_s15_submission_server_line_split.sql
\echo === P1A TOPIC DEADLINE ===
\i /tmp/20260901_s17_topic_deadline.sql
\i /tmp/20260902_s19_hq_topic_deadlines.sql
\echo === P1 TENANCY ===
\i /tmp/platform_p1_tenancy.sql
\echo === SYNTHETIC 0912 EVENT ===
\i /tmp/0912-p1a-seed.sql
\echo === P1A EVENT ACCESS ===
\i /tmp/platform_p1a_0912_event_access.sql
\echo === P1A BEHAVIOR VERIFICATION ===
\i /tmp/platform_p1a_0912_event_access.verify.sql

\echo === P1A 0912 DRIVER PASSED ===
