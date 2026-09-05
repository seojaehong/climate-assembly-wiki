import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const migrationName = 'platform_p1a_0912_event_access.sql';
const activationName = 'platform_p2a_0912_token_only_activation.sql';
const migrationPath = resolve(root, 'supabase', 'migrations', migrationName);
const rollbackPath = resolve(root, 'supabase', 'rollbacks', 'platform_p1a_0912_event_access_BEFORE.sql');
const verifyPath = resolve(root, 'supabase', 'verify', migrationName);
const activationPath = resolve(root, 'supabase', 'migrations', activationName);
const activationRollbackPath = resolve(root, 'supabase', 'rollbacks', 'platform_p2a_0912_token_only_activation_BEFORE.sql');
const activationVerifyPath = resolve(root, 'supabase', 'verify', 'platform_p2a_0912_token_only_activation.sql');
const activationDriverPath = resolve(root, 'automation', 'tests', 'fixtures', '0912-p1a-activation-driver.sql');
const designProvisioningPath = resolve(root, 'supabase', 'migrations', 'platform_p3_design_provisioning.sql');
const sql = readFileSync(migrationPath, 'utf8');
const rollback = readFileSync(rollbackPath, 'utf8');
const verify = readFileSync(verifyPath, 'utf8');
const activation = readFileSync(activationPath, 'utf8');
const activationRollback = readFileSync(activationRollbackPath, 'utf8');
const activationVerify = readFileSync(activationVerifyPath, 'utf8');
const activationDriver = readFileSync(activationDriverPath, 'utf8');
const designProvisioning = readFileSync(designProvisioningPath, 'utf8');
const workshopAccessClient = readFileSync(resolve(root, 'src/lib/workshop-access.ts'), 'utf8');
const moderatorClient = readFileSync(resolve(root, 'src/lib/mod-console.ts'), 'utf8');
const deliberationClient = readFileSync(resolve(root, 'src/lib/deliberation.ts'), 'utf8');
const hqClient = readFileSync(resolve(root, 'src/lib/workshop-hq.ts'), 'utf8');
const attendanceClient = readFileSync(resolve(root, 'src/lib/attendance.ts'), 'utf8');
const hqSubmissionsClient = readFileSync(resolve(root, 'src/lib/hq-submissions.ts'), 'utf8');
const platformClient = readFileSync(resolve(root, 'src/lib/platform.ts'), 'utf8');
const hqSubmissionBoard = readFileSync(resolve(root, 'src/islands/mod/HqSubmissionBoard.tsx'), 'utf8');
const hqSubmissionBoardLogic = readFileSync(resolve(root, 'src/islands/mod/hq-submission-board-logic.ts'), 'utf8');
const implementationConsole = readFileSync(resolve(root, 'src/islands/platform/publish/ImplementationConsole.tsx'), 'utf8');
const canvasBoard = readFileSync(resolve(root, 'src/islands/CanvasBoard.tsx'), 'utf8');
const voteCard = readFileSync(resolve(root, 'src/islands/mod/VoteCard.tsx'), 'utf8');
const publicVoteForm = readFileSync(resolve(root, 'public/v/vote-form.js'), 'utf8');
const publicVoteFallback = readFileSync(resolve(root, 'public/v/index.html'), 'utf8');
const publicVotePage = readFileSync(resolve(root, 'src/pages/v.astro'), 'utf8');
const loadtest = readFileSync(resolve(root, 'scripts/loadtest-mod-console.mjs'), 'utf8');
const postgresVerifier = readFileSync(resolve(root, 'scripts/verify-0912-postgres.sh'), 'utf8');
const runbook = readFileSync(resolve(root, 'docs/operations/0912-13-runbook.md'), 'utf8');
const complianceCatalog = readFileSync(resolve(root, 'docs/platform/platform-compliance-catalog.json'), 'utf8');

function requireText(source, pattern, label) {
  if (!pattern.test(source)) throw new Error(`Missing contract: ${label}`);
}

function rejectText(source, pattern, label) {
  if (pattern.test(source)) throw new Error(`Forbidden contract remains: ${label}`);
}

const ordered = readdirSync(resolve(root, 'supabase', 'migrations'))
  .filter((name) => name.startsWith('platform_p'))
  .sort();
const p1 = ordered.indexOf('platform_p1_tenancy.sql');
const p1a = ordered.indexOf(migrationName);
const p1b = ordered.indexOf('platform_p1b_backfill.sql');
const p2 = ordered.indexOf('platform_p2_analysis_review.sql');
const p2a = ordered.indexOf(activationName);
const p3 = ordered.indexOf('platform_p3_design_provisioning.sql');
if (!(p1 >= 0 && p1 < p1a && p1a < p1b)) {
  throw new Error(`Migration ordering invalid: ${ordered.join(', ')}`);
}
if (!(p2 >= 0 && p2 < p2a && (p3 < 0 || p2a < p3))) {
  throw new Error(`Activation must sort after every P2 migration and before P3: ${ordered.join(', ')}`);
}

const signatures = [
  /function climate_vote\.mod_exchange_join_code\(\s*p_join_code text, p_device_id uuid, p_device_label text default null\)/i,
  /function climate_vote\.mod_session_get\(p_token text\)/i,
  /function climate_vote\.topic_list_v2\(p_token text\)/i,
  /function climate_vote\.attendance_round_eligible_count_v2\(\s*p_token text, p_round_id text\)/i,
  /function climate_vote\.submission_get_v2\(\s*p_token text, p_topic_id uuid\)/i,
  /function climate_vote\.submission_save_v3\(\s*p_token text, p_topic_id uuid, p_items jsonb, p_expected_version bigint,\s*p_idempotency_key uuid, p_force boolean default false\)/i,
  /function climate_vote\.submission_finalize_v2\(\s*p_token text, p_topic_id uuid, p_expected_version bigint\)/i,
  /function climate_vote\.submission_reopen_by_team_v2\(\s*p_token text, p_topic_id uuid\)/i,
  /function climate_vote\.mod_create_round_v2\(\s*p_token text, p_title text, p_type text, p_options jsonb\)/i,
  /function climate_vote\.mod_create_round_v3\(\s*p_token text, p_title text, p_type text, p_options jsonb,\s*p_idempotency_key uuid\)/i,
  /function climate_vote\.mod_set_round_status_v2\(\s*p_token text, p_round_id text, p_status text\)/i,
  /function climate_vote\.mod_set_round_status_v3\(\s*p_token text, p_round_id text, p_expected_status text, p_status text,\s*p_idempotency_key uuid\)/i,
  /function climate_vote\.mod_proxy_vote_v2\(\s*p_token text, p_round_id text, p_choice jsonb, p_n int\)/i,
  /function climate_vote\.mod_proxy_vote_v3\(\s*p_token text, p_round_id text, p_choice jsonb, p_n int,\s*p_idempotency_key uuid\)/i,
  /function climate_vote\.mod_log_timer_v2\(\s*p_token text, p_kind text, p_duration_s int, p_started_at timestamptz,\s*p_ended_at timestamptz default null\)/i,
  /function climate_vote\.ballot_create_v2\(\s*p_token text, p_title text, p_instructions text, p_items jsonb,\s*p_subgroup text default null\)/i,
  /function climate_vote\.ballot_create_v3\(\s*p_token text, p_title text, p_instructions text, p_items jsonb,\s*p_subgroup text, p_idempotency_key uuid\)/i,
  /function climate_vote\.ballot_set_status_v2\(\s*p_token text, p_ballot_id uuid, p_status text\)/i,
  /function climate_vote\.ballot_list_v2\(p_token text\)/i,
  /function climate_vote\.ballot_results_v2\(\s*p_ballot_token text, p_token text\)/i,
  /function climate_vote\.workshop_hq_status\(\s*p_token text, p_session_slug text\)/i,
  /function climate_vote\.workshop_hq_logout_v2\(p_token text\)/i,
  /function climate_vote\.workshop_team_logout_v2\(p_token text\)/i,
  /function climate_vote\.workshop_hq_open_next_topic\(\s*p_token text, p_session_slug text, p_expected_ordinal int,\s*p_idempotency_key uuid\)/i,
  /function climate_vote\.workshop_hq_set_topic_status\(\s*p_token text, p_session_slug text, p_topic_id uuid, p_expected_status text,\s*p_status text, p_idempotency_key uuid\)/i,
  /function climate_vote\.workshop_hq_devices\(\s*p_token text, p_session_slug text\)/i,
  /function climate_vote\.workshop_hq_revoke_device\(\s*p_token text, p_session_slug text, p_token_hash text, p_reason text,\s*p_idempotency_key uuid\)/i,
  /function climate_vote\.workshop_hq_set_deadline\(\s*p_token text, p_session_slug text, p_topic_id uuid,\s*p_expected_deadline_at timestamptz, p_deadline_at timestamptz,\s*p_idempotency_key uuid\)/i,
  /function climate_vote\.workshop_hq_rotate_join_codes\(\s*p_token text, p_session_slug text, p_confirmation text,\s*p_idempotency_key uuid\)/i,
  /function climate_vote\.attendance_roster_v2\(\s*p_token text, p_session_slug text\)/i,
  /function climate_vote\.attendance_hq_summary_v2\(\s*p_token text, p_session_slug text\)/i,
  /function climate_vote\.attendance_set_v2\(\s*p_token text, p_session_slug text, p_assignment_id uuid,\s*p_action text, p_occurred_at timestamptz default now\(\)\)/i,
  /function climate_vote\.attendance_bulk_present_v2\(\s*p_token text, p_session_slug text, p_assignment_ids uuid\[\]\)/i,
  /function climate_vote\.attendance_finalize_absent_v2\(\s*p_token text, p_session_slug text\)/i,
  /function climate_vote\.attendance_member_save_v2\(\s*p_token text, p_session_slug text, p_assignment_id uuid,\s*p_official_id text, p_name text, p_team_id uuid default null,\s*p_active boolean default true\)/i,
  /function climate_vote\.attendance_hq_audit_v2\(\s*p_token text, p_session_slug text, p_limit int default 200\)/i,
  /function climate_vote\.attendance_hq_set_team_pin_v2\(\s*p_token text, p_session_slug text, p_team_id uuid, p_pin text\)/i,
  /function climate_vote\.attendance_hq_set_table_no_v2\(\s*p_token text, p_session_slug text, p_team_id uuid, p_table_no text\)/i,
  /function climate_vote\.hq_submissions_v2\(\s*p_token text, p_session_slug text\)/i,
  /function climate_vote\.hq_submissions_v3\(\s*p_token text, p_session_slug text\)/i,
  /function climate_vote\.submission_reopen_v2\(\s*p_token text, p_session_slug text, p_submission_id uuid, p_reason text\)/i,
  /function climate_vote\.hq_submission_history_v2\(\s*p_token text, p_session_slug text\)/i,
  /function climate_vote\.hq_submission_category_assign_v2\(\s*p_token text, p_session_slug text, p_submission_id uuid,\s*p_item_ordinal int, p_category text\)/i,
  /function climate_vote\.hq_submission_categories_v2\(\s*p_token text, p_session_slug text\)/i,
  /function climate_vote\.hq_submission_category_assign_v3\(\s*p_token text, p_session_slug text, p_submission_id uuid,\s*p_item_ordinal int, p_category text,\s*p_expected_submission_updated_at timestamptz, p_expected_event_id bigint,\s*p_idempotency_key uuid\)/i,
  /function climate_vote\.hq_submission_categories_v3\(\s*p_token text, p_session_slug text\)/i,
  /function climate_vote\.hq_submission_kind_assign_v2\(\s*p_token text, p_session_slug text, p_submission_id uuid,\s*p_item_ordinal int, p_kind text\)/i,
  /function climate_vote\.hq_submission_kinds_v2\(\s*p_token text, p_session_slug text\)/i,
  /function climate_vote\.hq_submission_kind_assign_v3\(\s*p_token text, p_session_slug text, p_submission_id uuid,\s*p_item_ordinal int, p_kind text,\s*p_expected_submission_updated_at timestamptz, p_expected_event_id bigint,\s*p_idempotency_key uuid\)/i,
  /function climate_vote\.hq_submission_kinds_v3\(\s*p_token text, p_session_slug text\)/i,
  /function climate_vote\.hq_topic_deadlines_v2\(\s*p_token text, p_session_slug text\)/i,
  /function climate_vote\.hq_clear_submissions_v2\(\s*p_token text, p_session_slug text, p_confirm text\)/i,
  /function climate_vote\.hq_clear_submissions_v3\(\s*p_token text, p_session_slug text, p_confirm text,\s*p_expected_submissions jsonb, p_idempotency_key uuid\)/i,
  /function climate_vote\.hq_teams_v2\(\s*p_token text, p_session_slug text\)/i,
  /function climate_vote\.hq_rounds_v2\(\s*p_token text, p_session_slug text\)/i,
  /function climate_vote\.hq_vote_counts_v2\(\s*p_token text, p_session_slug text, p_round_ids text\[\]\)/i,
  /function climate_vote\.hq_votes_v2\(\s*p_token text, p_session_slug text, p_round_ids text\[\]\)/i,
  /function climate_vote\.mod_rounds_v2\(p_token text\)/i,
  /function climate_vote\.mod_session_teams_v2\(p_token text\)/i,
  /function climate_vote\.mod_vote_counts_v2\(\s*p_token text, p_round_ids text\[\]\)/i,
  /function climate_vote\.mod_votes_v2\(\s*p_token text, p_round_id text\)/i,
  /function climate_vote\.public_round_get_v2\(p_round_id text\)/i,
  /function climate_vote\.public_round_votes_v2\(p_round_id text\)/i,
  /function climate_vote\.public_round_cast_v2\(\s*p_round_id text, p_choice jsonb, p_client_id text\)/i,
  /function climate_vote\.ballot_submit\(\s*p_token text, p_client_id text, p_answers jsonb\)/i,
  /function climate_vote\.platform_readiness_check_v2\(p_session_id uuid\)/i,
  /function climate_vote\.platform_canvas_round_create_v2\(\s*p_session_id uuid, p_options jsonb, p_idempotency_key uuid\)/i,
  /function climate_vote\.platform_canvas_round_current_v2\(p_session_id uuid\)/i,
  /function climate_vote\.platform_canvas_round_set_status_v2\(\s*p_session_id uuid, p_round_id text, p_expected_status text, p_status text,\s*p_idempotency_key uuid\)/i,
  /function climate_vote\.platform_ballot_list_v2\(p_session_id uuid\)/i,
  /function climate_vote\.platform_ballot_results_v2\(\s*p_ballot_token text, p_session_id uuid\)/i,
  /function climate_vote\.platform_issue_list_v2\(\s*p_session_id uuid, p_topic_id uuid\)/i,
  /function climate_vote\.platform_issue_items_v2\(\s*p_session_id uuid, p_topic_id uuid\)/i,
  /function climate_vote\.platform_issue_upsert_v2\(\s*p_session_id uuid, p_topic_id uuid, p_issue jsonb\)/i,
  /function climate_vote\.platform_issue_upsert_v3\(\s*p_session_id uuid, p_topic_id uuid, p_issue jsonb,\s*p_expected_snapshot_hash text, p_idempotency_key uuid\)/i,
  /function climate_vote\.platform_issue_link_set_v2\(\s*p_session_id uuid, p_issue_id uuid, p_item_ids uuid\[\], p_cluster_id uuid\)/i,
  /function climate_vote\.platform_issue_reclassify_v2\(\s*p_session_id uuid, p_topic_id uuid, p_plan jsonb, p_idempotency_key uuid\)/i,
  /function climate_vote\.platform_issue_merge_v2\(\s*p_session_id uuid, p_src_issue_id uuid, p_dst_issue_id uuid\)/i,
  /function climate_vote\.platform_issue_review_v2\(\s*p_session_id uuid, p_issue_id uuid\)/i,
  /function climate_vote\.platform_issue_snapshot_hash\(\s*p_issue_id uuid\)/i,
  /function climate_vote\.platform_issue_merge_v3\(\s*p_session_id uuid, p_src_issue_id uuid, p_dst_issue_id uuid,\s*p_expected_src_snapshot_hash text, p_expected_dst_snapshot_hash text,\s*p_idempotency_key uuid\)/i,
  /function climate_vote\.platform_issue_review_v3\(\s*p_session_id uuid, p_issue_id uuid, p_expected_snapshot_hash text,\s*p_idempotency_key uuid\)/i,
  /function climate_vote\.platform_result_publish_v2\(\s*p_session_id uuid, p_scope text, p_scope_id uuid, p_title text\)/i,
  /function climate_vote\.platform_result_unpublish_v2\(\s*p_session_id uuid, p_result_id uuid\)/i,
  /function climate_vote\.platform_result_implementation_upsert_v2\(\s*p_session_id uuid, p_result_token text, p_issue_id uuid,\s*p_implementation jsonb\)/i,
  /function climate_vote\.platform_result_implementation_upsert_v3\(\s*p_session_id uuid, p_result_token text, p_issue_id uuid,\s*p_implementation jsonb, p_expected_snapshot_hash text,\s*p_idempotency_key uuid\)/i,
];
for (const [index, signature] of signatures.entries()) {
  requireText(sql, signature, `RPC signature ${index + 1}`);
}
rejectText(sql,
  /function climate_vote\.workshop_hq_set_topic_status\(\s*p_token text, p_session_slug text, p_topic_id uuid, p_status text,\s*p_idempotency_key uuid\)/i,
  'topic status overload without caller CAS');
rejectText(sql,
  /function climate_vote\.workshop_hq_revoke_device\(\s*p_token text, p_session_slug text, p_token_hash text, p_reason text\)/i,
  'device revocation overload without stable request id');

const clientContracts = [
  [workshopAccessClient, ['mod_exchange_join_code', 'mod_session_get', 'workshop_team_logout_v2']],
  [moderatorClient, [
    'mod_create_round_v3', 'mod_set_round_status_v3', 'mod_proxy_vote_v3', 'mod_log_timer_v2',
    'hq_teams_v2', 'hq_rounds_v2', 'hq_vote_counts_v2', 'hq_votes_v2',
    'mod_rounds_v2', 'mod_session_teams_v2', 'mod_vote_counts_v2', 'mod_votes_v2',
    'public_round_get_v2', 'public_round_votes_v2', 'public_round_cast_v2',
  ]],
  [deliberationClient, [
    'topic_list_v2', 'submission_get_v2', 'submission_save_v3', 'submission_finalize_v2',
    'submission_reopen_by_team_v2', 'ballot_create_v3', 'ballot_set_status_v2',
    'ballot_list_v2', 'ballot_results_v2',
  ]],
  [hqClient, [
    'workshop_hq_status', 'workshop_hq_open_next_topic', 'workshop_hq_set_topic_status',
    'workshop_hq_devices', 'workshop_hq_revoke_device', 'workshop_hq_set_deadline',
  ]],
  [attendanceClient, [
    'attendance_roster_v2', 'attendance_hq_summary_v2', 'attendance_set_v2',
    'attendance_bulk_present_v2', 'attendance_finalize_absent_v2',
    'attendance_member_save_v2', 'attendance_hq_audit_v2',
    'attendance_hq_set_team_pin_v2', 'attendance_hq_set_table_no_v2',
    'attendance_round_eligible_count_v2', 'workshop_hq_logout_v2',
  ]],
  [hqSubmissionsClient, [
    'hq_submissions_v3', 'submission_reopen_v2', 'hq_submission_history_v2',
    'hq_submission_category_assign_v3', 'hq_submission_categories_v3',
    'hq_submission_kind_assign_v3', 'hq_submission_kinds_v3',
    'hq_topic_deadlines_v2', 'hq_clear_submissions_v3',
  ]],
  [platformClient, [
    'platform_readiness_check_v2',
    'platform_issue_list_v2', 'platform_issue_items_v2', 'platform_issue_upsert_v3',
    'platform_issue_reclassify_v2', 'platform_issue_merge_v3', 'platform_issue_review_v3',
    'platform_result_publish_v2', 'platform_result_unpublish_v2',
    'platform_result_implementation_upsert_v3',
  ]],
];
for (const [source, names] of clientContracts) {
  for (const name of names) requireText(source, new RegExp(`['"]${name}['"]`), `client RPC ${name}`);
}
requireText(moderatorClient, /mod_proxy_vote_v3[\s\S]{0,400}p_idempotency_key\s*:\s*idempotencyKey/i,
  'proxy vote request id forwarding');
requireText(moderatorClient, /mod_create_round_v3[\s\S]{0,500}p_idempotency_key\s*:\s*idempotencyKey/i,
  'round create request id forwarding');
requireText(moderatorClient,
  /mod_set_round_status_v3[\s\S]{0,500}p_expected_status\s*:\s*expectedStatus[\s\S]{0,250}p_idempotency_key\s*:\s*idempotencyKey/i,
  'round status expected-state CAS and request id forwarding');
requireText(deliberationClient, /ballot_create_v3[\s\S]{0,600}p_idempotency_key\s*:\s*idempotencyKey/i,
  'ballot create request id forwarding');
requireText(platformClient,
  /platform_issue_upsert_v3[\s\S]{0,500}p_expected_snapshot_hash\s*:\s*expectedSnapshotHash[\s\S]{0,250}p_idempotency_key\s*:\s*idempotencyKey/i,
  'issue upsert snapshot CAS and request id forwarding');
requireText(platformClient,
  /platform_issue_reclassify_v2[\s\S]{0,900}p_plan\s*:\s*\{[\s\S]{0,500}expected_links[\s\S]{0,500}p_idempotency_key\s*:\s*idempotencyKey/i,
  'atomic issue reclassification plan and request id forwarding');
requireText(platformClient,
  /platform_issue_merge_v3[\s\S]{0,500}p_expected_src_snapshot_hash\s*:\s*expectedSrcSnapshotHash[\s\S]{0,200}p_expected_dst_snapshot_hash\s*:\s*expectedDstSnapshotHash[\s\S]{0,200}p_idempotency_key\s*:\s*idempotencyKey/i,
  'issue merge source/destination snapshot CAS and request id forwarding');
requireText(platformClient,
  /platform_issue_review_v3[\s\S]{0,400}p_expected_snapshot_hash\s*:\s*expectedSnapshotHash[\s\S]{0,200}p_idempotency_key\s*:\s*idempotencyKey/i,
  'issue review snapshot CAS and request id forwarding');
requireText(platformClient,
  /platform_result_implementation_upsert_v3[\s\S]{0,700}p_expected_snapshot_hash\s*:\s*expectedSnapshotHash[\s\S]{0,250}p_idempotency_key\s*:\s*idempotencyKey/i,
  'implementation snapshot CAS and request id forwarding');
requireText(hqSubmissionsClient,
  /hq_submission_category_assign_v3[\s\S]{0,700}p_expected_submission_updated_at\s*:\s*input\.expectedSubmissionUpdatedAt[\s\S]{0,250}p_expected_event_id\s*:\s*input\.expectedEventId[\s\S]{0,250}p_idempotency_key\s*:\s*input\.idempotencyKey/i,
  'HQ category assignment source/event CAS and request id forwarding');
requireText(hqSubmissionsClient,
  /hq_submission_kind_assign_v3[\s\S]{0,700}p_expected_submission_updated_at\s*:\s*input\.expectedSubmissionUpdatedAt[\s\S]{0,250}p_expected_event_id\s*:\s*input\.expectedEventId[\s\S]{0,250}p_idempotency_key\s*:\s*input\.idempotencyKey/i,
  'HQ kind assignment source/event CAS and request id forwarding');
requireText(hqSubmissionsClient,
  /hq_clear_submissions_v3[\s\S]{0,500}p_expected_submissions\s*:\s*input\.expectedSubmissions[\s\S]{0,250}p_idempotency_key\s*:\s*input\.idempotencyKey/i,
  'HQ clear exact submission set and request id forwarding');
rejectText(platformClient, /['"]platform_issue_link_set_v2['"]/, 'retired non-atomic issue-link client call');
rejectText(platformClient, /['"]platform_issue_(?:merge|review)_v2['"]/, 'retired non-CAS issue mutation client call');
rejectText(platformClient, /['"]platform_issue_upsert_v2['"]/, 'retired last-write-wins issue upsert client call');
rejectText(platformClient, /['"]platform_result_implementation_upsert_v2['"]/, 'retired last-write-wins implementation client call');
rejectText(moderatorClient, /['"]mod_set_round_status_v2['"]/, 'retired non-CAS round status client call');
rejectText(hqSubmissionsClient,
  /['"]hq_(?:submissions|submission_categories|submission_kinds|clear_submissions)_v2['"]|['"]hq_submission_(?:category|kind)_assign_v2['"]/,
  'retired non-CAS HQ assignment/clear client call');

for (const key of ['accessToken', 'expiresAt', 'deviceId', 'deviceLabel', 'sessionId', 'sessionSlug']) {
  requireText(sql, new RegExp(`'${key}'`), `session response key ${key}`);
}
for (const key of [
  'session_id', 'session_slug', 'session_title', 'org_name', 'topics', 'topic_total',
  'topic_open', 'topic_closed', 'next_topic_id', 'next_topic_ordinal',
  'next_topic_prompt', 'teams_total', 'active_devices', 'teams_online',
  'submissions_draft', 'submissions_final', 'last_activity_at',
]) {
  requireText(sql, new RegExp(`'${key}'`), `HQ status key ${key}`);
}

requireText(sql, /gen_random_bytes\(32\)/i, '32-byte opaque token');
requireText(sql, /digest\(v_token\s*,\s*'sha256'\)/i, 'token hash persistence');
requireText(sql, /count\(distinct device_id\)[\s\S]{0,300}v_devices >= 2/i, 'two-device limit');
requireText(sql, /for update/i, 'row-level serialization');
requireText(sql, /'status'\s*,\s*'conflict'/i, 'OCC conflict result');
requireText(sql, /if\s+v_sub\.version\s*<>\s*p_expected_version\s+then/i,
  'explicit replacement still enforces reviewed-version CAS');
requireText(sql, /workshop_request_ledger/i, 'idempotency ledger');
requireText(sql, /pg_advisory_xact_lock\s*\(/i, 'serialized first result publish');
requireText(sql, /result_implementation_event/i, 'append-only implementation history');
requireText(sql, /workshop_audit_no_truncate/i, 'append-only audit truncate guard');
requireText(sql, /workshop_random_join_code/i, 'cryptographic join-code generator');
requireText(sql, /v_code\s*<>\s*'000000'/i, 'synthetic moderator code reservation');
requireText(
  designProvisioning,
  /v_code\s*<>\s*'000000'/i,
  'design-provisioning synthetic moderator code reservation',
);
requireText(sql, /workshop_request_source_hash/i, 'hashed request-source helper');
requireText(sql, /source_hash[\s\S]{0,500}interval '15 minutes'/i, 'source-layer exchange throttling');
requireText(sql, /v_source_failures\s*>=\s*60/i, 'venue-safe source failure threshold');
requireText(sql, /purpose in \('attendance','workshop','hq'\)/i, 'capability purpose separation');
requireText(sql, /v_auth\.purpose <> 'workshop'/i, 'workshop-only team token helper');
requireText(sql, /v_auth\.purpose <> 'hq'/i, 'HQ-only token helper');
if (/delete from climate_vote\.attendance_auth_session where expires_at\s*<=\s*now\(\)/i.test(sql)) {
  throw new Error('Unsafe expired-token cleanup can violate audit foreign keys');
}
requireText(sql, /\^0912\(0\[1-9\]\|1\[0-5\]\)\$/i, 'fixed-code exchange preflight gate');
if (/function climate_vote\.workshop_hq_rotate_join_codes\(\s*p_token text, p_session_slug text, p_confirmation text\s*\)/i.test(sql)) {
  throw new Error('Unsafe three-argument join-code rotation overload remains');
}
requireText(sql, /from public, anon, authenticated;/i, 'complete pre-cutover execute revocation');
requireText(sql, /grant execute[\s\S]*workshop_hq_status[\s\S]*workshop_hq_rotate_join_codes[\s\S]*to anon, authenticated;/i,
  'narrow pre-cutover HQ execution grants');

const revokedLegacySignatures = [
  'mod_join(text)',
  'mod_create_round(text,text,text,jsonb)',
  'mod_set_round_status(text,text,text)',
  'mod_proxy_vote(text,text,jsonb,int)',
  'mod_log_timer(text,text,int,timestamptz,timestamptz)',
  'topic_list(text)',
  'topic_set_deadline(text,uuid,timestamptz)',
  'readiness_check(uuid)',
  'org_of_code(text)',
  'org_of_token(text)',
  'attendance_hq_unlock(text,text)',
  'attendance_team_unlock(text,text)',
  'attendance_team_unlock_by_code(text)',
  'attendance_round_eligible_count(text)',
  'attendance_roster(text)',
  'attendance_hq_summary()',
  'attendance_set(text,uuid,text,timestamptz)',
  'attendance_bulk_present(text,uuid[])',
  'attendance_finalize_absent(text)',
  'attendance_member_save(text,uuid,text,text,uuid,boolean)',
  'attendance_hq_audit(text,int)',
  'attendance_hq_set_team_pin(text,uuid,text)',
  'attendance_hq_set_table_no(text,uuid,text)',
  'hq_teams()',
  'hq_submissions(text,text)',
  'submission_reopen(text,uuid,text)',
  'hq_submission_history(text,text)',
  'hq_submission_category_assign(text,uuid,int,text)',
  'hq_submission_categories(text,text)',
  'hq_submission_kind_assign(text,uuid,int,text)',
  'hq_submission_kinds(text,text)',
  'hq_topic_deadlines(text,text)',
  'hq_clear_submissions(text,text,text)',
  'submission_get(text,uuid)',
  'submission_save(text,uuid,jsonb)',
  'submission_save_v2(text,uuid,jsonb)',
  'submission_finalize(text,uuid)',
  'submission_finalize_hq(text,uuid,text)',
  'submission_reopen_by_team(text,uuid)',
  'ballot_create(text,text,text,jsonb,text)',
  'ballot_set_status(text,uuid,text)',
  'ballot_list(text)',
  'issue_items(text,uuid)',
  'issue_list(text,uuid)',
  'issue_upsert(text,uuid,jsonb)',
  'issue_link_set(text,uuid,uuid[],uuid)',
  'issue_merge(text,uuid,uuid)',
  'issue_review(text,uuid)',
  'result_publish(text,text,uuid,text)',
  'result_unpublish(text,uuid)',
  'mod_proxy_vote_v2(text,text,jsonb,int)',
  'result_implementation_upsert(text,text,uuid,jsonb)',
];
for (const signature of revokedLegacySignatures) {
  requireText(activation, new RegExp(`climate_vote\\.${signature.replace(/[()[\]{}.*+?^$|\\]/g, '\\$&')}`, 'i'), `activation revoke ${signature}`);
  requireText(activationRollback, new RegExp(`climate_vote\\.${signature.replace(/[()[\]{}.*+?^$|\\]/g, '\\$&')}`, 'i'), `activation rollback ${signature}`);
}
requireText(activation, /create or replace function climate_vote\.ballot_results\(\s*p_token text, p_code text default null\)[\s\S]*p_code is not null[\s\S]*status\s*=\s*'published'/i, 'published-only legacy ballot results');
requireText(activation, /revoke execute[\s\S]*from public, anon, authenticated/i, 'complete legacy execute revocation');
requireText(activation,
  /revoke all on table climate_vote\.hq_operator[\s\S]{0,80}from public, anon, authenticated/i,
  'HQ operator credential-state table closure');
requireText(activation,
  /update climate_vote\.attendance_auth_session[\s\S]{0,180}scope='hq' and purpose='hq' and revoked_at is null/i,
  'pre-cutover shared and forged HQ bearer revocation');
requireText(activation,
  /workshop_hq_session_row[\s\S]{0,700}hq_operator[\s\S]{0,150}op\.name=v_auth\.actor_label and op\.active/i,
  'named HQ active status revalidation');
requireText(activationRollback,
  /emergency_rollback_ack[\s\S]{0,240}I_ACCEPT_LEGACY_ACCESS_REOPEN[\s\S]{0,400}emergency_rollback_incident/i,
  'emergency activation rollback acknowledgement guard');
requireText(sql,
  /function climate_vote\.submission_reopen_v2[\s\S]{0,1600}set status='reopened',version=version\+1,updated_at=now\(\)[\s\S]{0,500}'version',v_sub\.version/i,
  'HQ reopen advances and returns the submission CAS generation');
requireText(sql,
  /function climate_vote\.workshop_hq_rotate_join_codes[\s\S]{0,2600}scope='team' and purpose in \('attendance','workshop'\)[\s\S]{0,500}'revoked_team_tokens'/i,
  'join-code rotation revokes all session team capabilities');
requireText(activation,
  /revoke execute on function[\s\S]{0,220}platform_issue_reclassify_v2\(uuid,uuid,jsonb,uuid\)[\s\S]{0,220}platform_issue_link_set_v2\(uuid,uuid,uuid\[\],uuid\)[\s\S]{0,220}platform_issue_merge_v2\(uuid,uuid,uuid\)[\s\S]{0,160}platform_issue_review_v2\(uuid,uuid\)[\s\S]{0,220}platform_issue_merge_v3\(uuid,uuid,uuid,text,text,uuid\)[\s\S]{0,180}platform_issue_review_v3\(uuid,uuid,text,uuid\)[\s\S]{0,300}from public, anon, authenticated[\s\S]{0,180}grant execute on function[\s\S]{0,180}platform_issue_reclassify_v2\(uuid,uuid,jsonb,uuid\)[\s\S]{0,180}platform_issue_merge_v3\(uuid,uuid,uuid,text,text,uuid\)[\s\S]{0,160}platform_issue_review_v3\(uuid,uuid,text,uuid\)[\s\S]{0,300}to authenticated/i,
  'atomic snapshot-CAS issue activation and old adapter closure');
requireText(activationRollback,
  /revoke execute on function[\s\S]{0,220}platform_issue_reclassify_v2\(uuid,uuid,jsonb,uuid\)[\s\S]{0,220}platform_issue_link_set_v2\(uuid,uuid,uuid\[\],uuid\)[\s\S]{0,220}platform_issue_merge_v2\(uuid,uuid,uuid\)[\s\S]{0,160}platform_issue_review_v2\(uuid,uuid\)[\s\S]{0,220}platform_issue_merge_v3\(uuid,uuid,uuid,text,text,uuid\)[\s\S]{0,180}platform_issue_review_v3\(uuid,uuid,text,uuid\)[\s\S]{0,300}from public, anon, authenticated[\s\S]{0,180}grant execute on function[\s\S]{0,180}platform_issue_link_set_v2\(uuid,uuid,uuid\[\],uuid\)[\s\S]{0,180}platform_issue_merge_v2\(uuid,uuid,uuid\)[\s\S]{0,160}platform_issue_review_v2\(uuid,uuid\)[\s\S]{0,300}to authenticated/i,
  'snapshot-CAS issue rollback and v2 emergency adapter restore');
requireText(sql,
  /platform_staff_session_row\(uuid\)[\s\S]{0,100}platform_staff_live_session_row\(uuid\)[\s\S]{0,180}from public, anon, authenticated/i,
  'live staff session helper execute closure');
requireText(sql,
  /revoke execute on function[\s\S]{0,100}platform_issue_reclassify_v2\(uuid,uuid,jsonb,uuid\)[\s\S]{0,80}from public, anon, authenticated/i,
  'atomic issue reclassification closed before P2a');
requireText(verify, /platform_staff_live_session_row\(uuid\)[\s\S]{0,1200}internal helper executable/i,
  'live staff session helper pg privilege verification');
requireText(activation, /votes_require_active_round\(\)[\s\S]{0,300}capture_round_attendance\(\)[\s\S]{0,300}submission_item_archive_trigger\(\)[\s\S]{0,200}from public, anon, authenticated/i,
  'internal trigger helper execute closure');
requireText(activation, /cv_snapshot_now\(text,text\)[\s\S]{0,120}cv_archive_round\(text,text,text\)[\s\S]{0,160}from public, anon, authenticated[\s\S]{0,220}cv_archive_round\(text,text,text\)[\s\S]{0,80}to service_role/i,
  'service-role-only snapshot/archive RPCs');
requireText(activation, /to_regprocedure\('public\.cv_set_active\(text\)'\)[\s\S]{0,200}revoke execute on function public\.cv_set_active\(text\) from public, anon, authenticated/i,
  'retired public round activation closure');
requireText(activationVerify, /do \$executable_allowlist\$[\s\S]{0,10000}pg_proc[\s\S]{0,3000}anon routine outside post-cutover allowlist[\s\S]{0,3000}authenticated routine outside post-cutover allowlist/i,
  'complete pg_proc role allowlist');
requireText(activationVerify, /legacy call permission denied/i, 'actual legacy permission-denied seam');
requireText(activationVerify, /legacy unscoped deadline permission denied/i, 'legacy unscoped deadline permission-denied seam');
requireText(activationVerify, /public published result/i, 'published ballot result seam');
requireText(activationVerify, /staff cross-org/i, 'staff cross-organization seam');
requireText(activationVerify, /nonmember staff issue read/i, 'staff nonmember rejection seam');
requireText(activationVerify, /serialized repeated publish/i, 'serialized publish row-count seam');
requireText(activationVerify, /client-id issue create replay/i, 'client issue idempotency seam');
requireText(activationVerify, /retired non-atomic issue link RPC remained executable/i,
  'retired issue-link RPC permission-denied seam');
requireText(activationVerify, /atomic issue reclassification contract mismatch/i,
  'atomic issue reclassification positive seam');
requireText(activationVerify, /atomic issue reclassification replay changed result/i,
  'atomic issue reclassification replay seam');
requireText(activationVerify, /stale atomic reclassification CAS changed links/i,
  'atomic issue reclassification CAS seam');
requireText(activationVerify, /failed atomic reclassification partially changed destination links/i,
  'atomic issue reclassification rollback seam');
requireText(verify, /pre-cutover anon exchange/i, 'pre-cutover token lock seam');
requireText(activationVerify, /post-cutover token exchange/i, 'post-cutover token activation seam');
requireText(activationDriver, /platform_p2_analysis_review\.sql[\s\S]*platform_p2a_0912_token_only_activation\.sql/i, 'P2-before-activation driver order');
requireText(activationDriver, /20260621140534_snapshot_include_agenda\.sql[\s\S]*cv_archive_round\(text,text,text\)[\s\S]*public\.cv_set_active/i,
  'production operational ACL fixture coverage');
requireText(activationDriver, /platform_p1a_0912_event_access\.sql[\s\S]*platform_p2_analysis_review\.sql[\s\S]*platform_p1b_backfill\.sql[\s\S]*platform_p1c_org_selection\.sql[\s\S]*platform_p1c_activation_preflight\.sql[\s\S]*platform_p1c_org_selection_activation\.sql[\s\S]*platform_p2a_0912_token_only_activation\.sql/i,
  'verified explicit platform migration execution order');
requireText(activationDriver, /platform_p2a_0912_token_only_activation\.verify\.sql/i, 'activation behavior verification driver');
requireText(activationDriver, /platform_p2a_0912_token_only_activation\.sql[\s\S]*platform_p3_design_provisioning\.sql[\s\S]*platform_p4_audit_log\.sql[\s\S]*platform_p2a_0912_token_only_activation\.verify\.sql/i,
  'post-P4 legacy privilege regression driver');
requireText(designProvisioning, /v_code\s*!~\s*'\^0912\(0\[1-9\]\|1\[0-5\]\)\$'/i,
  'future team provisioning excludes the blocked predictable 0912 code range');

requireText(rollback, /rollback refused:[\s\S]*forward migration/i, 'non-destructive rollback guard');
for (const seam of ['two-device invariant', 'stale OCC write', 'cross-team', 'cross-session', 'append-only']) {
  requireText(verify, new RegExp(seam, 'i'), `disposable SQL seam: ${seam}`);
}
for (const seam of [
  'same-org cross-session attendance read',
  'cross-org HQ submission read',
  'cross-org attendance admin mutation',
  'scoped clear crossed the session/org boundary',
]) {
  requireText(verify, new RegExp(seam, 'i'), `scoped attendance/HQ SQL seam: ${seam}`);
}
requireText(activationVerify, /legacy unscoped attendance summary permission denied/i,
  'legacy attendance permission-denied seam');
requireText(activationVerify, /legacy join-code attendance unlock permission denied/i,
  'legacy join-code attendance unlock permission-denied seam');
requireText(activationVerify, /legacy PIN attendance unlock permission denied/i,
  'legacy PIN attendance unlock permission-denied seam');
requireText(activationVerify, /legacy organization code oracle permission denied/i,
  'legacy organization code oracle permission-denied seam');
requireText(activationVerify, /legacy unscoped HQ finalize permission denied/i,
  'legacy HQ finalize permission-denied seam');
requireText(activationVerify, /workshop token attendance read failed/i,
  'strict workshop-token attendance positive seam');
requireText(activationVerify, /legacy unscoped eligible count permission denied/i,
  'legacy eligible-count permission-denied seam');
requireText(activationVerify, /workshop token eligible count failed/i,
  'token-scoped eligible-count positive seam');
requireText(activationVerify, /P2a cross-org HQ mutation unexpectedly accepted/i,
  'post-activation scoped HQ cross-org seam');

for (const name of [
  'platform_canvas_round_create_v2',
  'platform_canvas_round_current_v2',
  'platform_canvas_round_set_status_v2',
]) {
  requireText(canvasBoard, new RegExp(`rpc\\('${name}'`), `Canvas client RPC ${name}`);
}

const additionalBehavioralSeams = [
  [sql, /pg_advisory_xact_lock\(hashtextextended\('canvas-round:'/i, 'serialized current Canvas round create'],
  [sql, /close the current canvas round before creating another/i, 'one open Canvas round per session'],
  [sql, /platform_canvas_round_current_v2[\s\S]{0,900}r\.status in \('pending','active'\)/i, 'reload-safe Canvas round recovery'],
  [sql, /platform_canvas_round_event[\s\S]{0,500}actor_user_id[\s\S]{0,500}request_id/i, 'Canvas actor/request audit'],
  [sql, /canvas round option labels must be unique/i, 'Canvas duplicate label rejection'],
  [sql, /mod_create_round_v3[\s\S]{0,2400}round option labels must be unique/i, 'moderator option validation'],
  [sql, /active_round_invariant[\s\S]{0,700}multiple active moderator rounds[\s\S]{0,500}unique index if not exists rounds_one_active_per_team_uidx[\s\S]{0,180}status='active'/i, 'existing-data preflight and one active moderator round database invariant'],
  [sql, /mod_create_round_v3[\s\S]{0,3600}from climate_vote\.team[\s\S]{0,300}for update[\s\S]{0,600}workshop_request_claim[\s\S]{0,800}status='active'[\s\S]{0,500}active round conflict: existing round/i, 'round creation team serialization before exact-replay claim and active-round conflict'],
  [rollback, /drop index if exists climate_vote\.rounds_one_active_per_team_uidx/i, 'active moderator round invariant rollback'],
  [sql, /attendance_auth_attempt[\s\S]{0,700}source_hash text[\s\S]{0,800}attendance_auth_attempt_source_idx/i, 'named HQ one-way request-source attempt ledger'],
  [sql, /mod_proxy_vote_v3[\s\S]{0,2800}invalid proxy vote choice/i, 'proxy choice validation'],
  [sql, /mod_set_round_status_v3[\s\S]{0,2200}workshop_request_claim[\s\S]{0,1000}for update[\s\S]{0,900}round status conflict[\s\S]{0,700}interval '60 seconds'[\s\S]{0,1000}workshop_request_finish/i, 'round status exact replay, CAS, and bounded reopen'],
  [sql, /workshop_team_logout_v2[\s\S]{0,1500}team_token_row[\s\S]{0,1000}for update[\s\S]{0,700}device_logged_out/i, 'exact workshop team bearer logout'],
  [sql, /hq_clear_submissions_v3[\s\S]{0,3200}workshop_request_claim[\s\S]{0,1000}pg_advisory_xact_lock[\s\S]{0,1800}v_current<>v_expected[\s\S]{0,2600}v_linked_items>0[\s\S]{0,1800}version=version\+1[\s\S]{0,1200}workshop_request_finish/i, 'HQ clear exact-set CAS, linked fail-closed, and replay'],
  [sql, /hq_submissions_v3[\s\S]{0,700}item_id uuid[\s\S]{0,800}si\.id,si\.ordinal/i, 'HQ board exposes live item identity for no-ghost assignment joins'],
  [sql, /hq_submission_category_assign_v3[\s\S]{0,2400}for update of s[\s\S]{0,1300}workshop_request_claim[\s\S]{0,1600}source_item_id[\s\S]{0,1500}current_event_id[\s\S]{0,1400}workshop_request_finish/i, 'HQ category source/event CAS and replay'],
  [sql, /hq_submission_kind_assign_v3[\s\S]{0,2400}for update of s[\s\S]{0,1300}workshop_request_claim[\s\S]{0,1600}source_item_id[\s\S]{0,1500}current_event_id[\s\S]{0,1400}workshop_request_finish/i, 'HQ kind source/event CAS and replay'],
  [sql, /submission_finalize_v2[\s\S]{0,800}p_expected_version is null[\s\S]{0,200}expected version must be nonnegative/i, 'finalize NULL cannot bypass CAS'],
  [sql, /submission_finalize_v2[\s\S]{0,1300}v_before_status:=v_sub\.status[\s\S]{0,1100}'status',v_before_status/i, 'finalize audit preserves the actual draft or reopened before state'],
  [sql, /platform_issue_link_set_v2[\s\S]{0,700}p_item_ids is null[\s\S]{0,160}explicit array/i, 'NULL issue link list cannot clear links'],
  [sql, /platform_issue_reclassify_v2[\s\S]{0,1200}platform_staff_session_for_roles[\s\S]{0,10000}submission_item[\s\S]{0,5000}order by i\.id for update of i/i, 'atomic issue plan validates scope before deterministic locks'],
  [sql, /platform_issue_reclassify_v2[\s\S]{0,14000}workshop_request_claim[\s\S]{0,5000}v_actual<>v_expected[\s\S]{0,2500}delete from climate_vote\.issue_link[\s\S]{0,1500}review_status='draft'[\s\S]{0,1000}workshop_request_finish/i, 'atomic issue CAS, replacement, draft reset, and idempotent finish'],
  [sql, /platform_issue_snapshot_hash[\s\S]{0,2200}'label',i\.label[\s\S]{0,900}'review_status',i\.review_status[\s\S]{0,1600}'item_id',il\.item_id[\s\S]{0,1200}'content',si\.content[\s\S]{0,500}order by il\.item_id[\s\S]{0,700}digest\(v_snapshot::text,'sha256'\)/i, 'deterministic semantic issue and ordered evidence snapshot hash'],
  [sql, /platform_issue_upsert_v3[\s\S]{0,3800}workshop_request_claim[\s\S]{0,1000}for update[\s\S]{0,1400}platform_issue_snapshot_hash[\s\S]{0,600}'status','conflict'[\s\S]{0,1900}review_status='draft'[\s\S]{0,1600}'status','applied'[\s\S]{0,700}workshop_request_finish/i, 'issue upsert client UUID, snapshot CAS, draft reset, and exact replay'],
  [sql, /platform_issue_review_v3[\s\S]{0,3000}workshop_request_claim[\s\S]{0,1800}for update of i[\s\S]{0,900}platform_issue_snapshot_hash[\s\S]{0,700}'status','conflict'[\s\S]{0,1300}review_status='reviewed'[\s\S]{0,900}workshop_request_finish/i, 'review snapshot CAS, issue lock, conflict, and exact replay ledger'],
  [sql, /platform_issue_merge_v3[\s\S]{0,3600}workshop_request_claim[\s\S]{0,1600}order by i\.id for update of i[\s\S]{0,1300}v_src_hash is distinct from p_expected_src_snapshot_hash[\s\S]{0,500}v_dst_hash is distinct from p_expected_dst_snapshot_hash[\s\S]{0,1300}insert into climate_vote\.issue_link[\s\S]{0,900}review_status='archived'[\s\S]{0,1200}workshop_request_finish/i, 'merge claim-before-lookup, sorted locks, dual snapshot CAS, and replay finish'],
  [sql, /function climate_vote\.platform_staff_live_session_row[\s\S]{0,900}s\.status='active'[\s\S]{0,300}a\.archived_at is null[\s\S]{0,300}o\.archived_at is null[\s\S]{0,300}access_expires_at is not null[\s\S]{0,150}access_expires_at>now\(\)/i, 'Canvas live event hierarchy and hard expiry'],
  [sql, /platform_canvas_round_create_v2[\s\S]{0,600}platform_staff_live_session_row/i, 'Canvas create requires live session'],
  [sql, /platform_canvas_round_set_status_v2[\s\S]{0,1300}p_expected_status='pending'[\s\S]{0,120}p_status='active'[\s\S]{0,180}platform_staff_live_session_row/i, 'Canvas start requires live session'],
  [sql, /attendance_set_v2[\s\S]{0,700}p_action is null[\s\S]{0,400}p_occurred_at is null/i, 'attendance NULL action and timestamp fail closed'],
  [sql, /platform_canvas_round_set_status_v2[\s\S]{0,700}p_expected_status is null[\s\S]{0,200}p_status is null/i, 'Canvas NULL status cannot bypass CAS'],
  [sql, /public_round_cast_v2[\s\S]{0,300}p_choice is null[\s\S]{0,150}public vote choice required/i, 'NULL public choice rejection'],
  [sql, /workshop_hq_rotate_join_codes[\s\S]{0,700}p_confirmation is null[\s\S]{0,180}rotation confirmation mismatch/i, 'NULL rotation confirmation rejection'],
  [sql, /public_round_get_v2[\s\S]{0,300}returns table\(id text,title text,description text,type text,options jsonb,status text/i, 'least-data public round fields'],
  [sql, /public_round_votes_v2[\s\S]{0,2500}group by/i, 'server-side public aggregate'],
  [sql, /public_round_cast_v2[\s\S]{0,3500}invalid public vote choice/i, 'public choice validation'],
  [sql, /public_round_cast_v2[\s\S]{0,1400}o\.archived_at is null[\s\S]{0,700}a\.archived_at is null/i, 'public cast active non-archived tenancy'],
  [sql, /ballot_submit[\s\S]{0,1000}s\.access_expires_at is not null[\s\S]{0,700}for update of b/i, 'public ballot lifecycle and close serialization'],
  [rollback, /ballot_submit[\s\S]{0,1300}for update of b/i, 'rollback-compatible scoped ballot submit'],
  [sql, /platform_result_publish_v2[\s\S]{0,5000}with reviewed as materialized[\s\S]{0,3500}reviewed_count[\s\S]{0,3500}unclassified_count[\s\S]{0,800}into v_reviewed,v_issues,v_unclassified/i, 'published body uses one self-consistent SQL snapshot'],
  [sql, /platform_result_implementation_snapshot_hash[\s\S]{0,900}'status',p_implementation->>'status'[\s\S]{0,900}digest\(v_snapshot::text,'sha256'\)/i, 'deterministic semantic implementation snapshot hash'],
  [sql, /platform_result_implementation_upsert_v3[\s\S]{0,6500}workshop_request_claim[\s\S]{0,1200}for update[\s\S]{0,1200}v_current_hash is distinct from p_expected_snapshot_hash[\s\S]{0,400}'status','conflict'[\s\S]{0,4000}result_implementation_event[\s\S]{0,1300}'status','applied'[\s\S]{0,500}workshop_request_finish/i, 'implementation snapshot CAS, immutable audit, and exact replay'],
  [activation, /implementation_snapshots[\s\S]{0,1800}platform_result_implementation_snapshot_hash[\s\S]{0,1200}update climate_vote\.result_page/i, 'implementation snapshot backfill at atomic cutover'],
  [activationRollback, /implementation_snapshots[\s\S]{0,1200}'snapshot_hash'[\s\S]{0,1000}update climate_vote\.result_page/i, 'implementation snapshot metadata rollback'],
  [rollback, /platform_result_implementation_upsert_v3[\s\S]{0,300}platform_result_implementation_upsert_v2[\s\S]{0,300}platform_result_publish_v2[\s\S]{0,300}platform_result_implementation_snapshot_hash/i, 'P1a drops implementation writers and dependent hash helper in order'],
  [sql, /hq_change_password[\s\S]{0,2200}password-change:[\s\S]{0,900}v_password_failures>=5[\s\S]{0,400}rate_limited[\s\S]{0,900}current_password_incorrect/i, 'password change has a separate authenticated-actor failure budget'],
  [sql, /attendance_hq_unlock_named[\s\S]{0,1600}attendance-auth:hq-named-global[\s\S]{0,900}source_hash=v_source_hash[\s\S]{0,800}v_source_failures>=20[\s\S]{0,120}v_global_failures>=120[\s\S]{0,900}N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy[\s\S]{0,500}v_password_matches:=crypt\(p_password,v_hash\)=v_hash/i, 'named HQ source/global cost budgets and dummy bcrypt comparison'],
  [sql, /hq_change_password[\s\S]{0,4200}current_password_incorrect[\s\S]{0,2200}hq_password_changed[\s\S]{0,500}sessions_revoked/i, 'authenticated password recovery is rate bounded and appends audit'],
  [sql, /hq_change_password[\s\S]{0,3600}update climate_vote\.attendance_auth_session[\s\S]{0,300}scope='hq'[\s\S]{0,300}actor_label=v_name[\s\S]{0,500}sessions_revoked/i, 'password rotation revokes every actor HQ bearer'],
  [sql, /workshop_hq_logout_v2[\s\S]{0,900}attendance_token_row\(p_token\)[\s\S]{0,500}set revoked_at=now\(\)[\s\S]{0,300}digest\(lower\(p_token\),'sha256'\)/i, 'server-side exact HQ bearer logout'],
  [sql, /submission_reopen_by_team_v2[\s\S]{0,1200}dt\.status='open'/i, 'team submission reopen requires an open topic'],
  [sql, /submission_save_v3[\s\S]{0,5000}insert into climate_vote\.submission_item_archive[\s\S]{0,900}\(si\.kind,si\.content,si\.rationale\) is distinct from[\s\S]{0,500}on conflict\(submission_id,ordinal\) do update/i, 'same-ordinal old source archive before stable-id upsert'],
  [activation, /public\.cv_votes[\s\S]{0,250}public\.cv_rounds[\s\S]{0,250}public\.cv_tally_scale/i, 'owner-rights view revoke'],
  [activationRollback, /grant select, insert on table public\.cv_votes/i, 'emergency owner-rights view grant restore'],
  [activationVerify, /Canvas public SCALE_MULTI positive\/duplicate contract failed/i, 'Canvas public cast behavior'],
  [activationVerify, /failed linked clear mutated source or CAS version/i, 'linked clear negative behavior'],
  [activationVerify, /round status exact replay changed live state[\s\S]{0,1800}stale round status changed state or audit history[\s\S]{0,1000}expired round reopen changed state/i, 'round status replay, stale, and reopen-window behavior'],
  [activationVerify, /team token logout did not revoke exact bearer[\s\S]{0,900}team logout revoked a different bearer[\s\S]{0,1000}team logout audit count mismatch/i, 'team logout exact-token behavior'],
  [activationVerify, /inactive named HQ rejection changed deadline, audit, or ledger[\s\S]{0,900}forged unnamed HQ bearer unexpectedly accepted/i, 'inactive and forged HQ bearer rejection'],
  [activationVerify, /HQ assignment exact replay changed result[\s\S]{0,6000}stale HQ assignment event CAS mutated history[\s\S]{0,6000}same-ordinal replacement inherited an old HQ assignment[\s\S]{0,6000}deleted submission item assignment unexpectedly accepted/i, 'HQ assignment replay, CAS, deleted item, and no-ghost behavior'],
  [activationVerify, /HQ board did not expose the live source item identity[\s\S]{0,7000}HQ board kept a stale source item identity after replacement/i, 'HQ board live item identity replacement behavior'],
  [hqSubmissionBoardLogic, /hqLiveItemIdentityMap[\s\S]{0,800}row\.item_id[\s\S]{0,500}contradictory\.add\(noteId\)/i, 'HQ client builds a fail-closed live item identity map'],
  [hqSubmissionBoard, /(?=[\s\S]*hqLiveItemIdentityMap\(next\))(?=[\s\S]*liveItemIdentities\.get\(id\) !== row\.source_item_id)(?=[\s\S]*liveItemIdentities\.get\(noteId\) !== row\.source_item_id)/i, 'HQ client joins kind and category assignments to the live source item'],
  [activationVerify, /clear exact replay changed result[\s\S]{0,1000}clear idempotency payload mismatch unexpectedly accepted[\s\S]{0,1000}stale exact-set clear did not conflict/i, 'HQ clear replay, payload mismatch, and exact-set conflict'],
  [activationVerify, /stale issue upsert CAS mutated issue state[\s\S]{0,1000}stale issue upsert conflict replay changed result/i, 'issue upsert stale conflict no-mutation and exact replay'],
  [activationVerify, /implementation exact replay changed result or event identity[\s\S]{0,1800}implementation request key payload mismatch unexpectedly accepted[\s\S]{0,3000}implementation lost-response replay changed after later update[\s\S]{0,3000}stale implementation CAS mutated body or audit history[\s\S]{0,1800}stale implementation conflict replay changed result/i, 'implementation replay, payload mismatch, later update, and stale conflict behavior'],
  [platformClient, /resultImplementationUpsertIntentFingerprint[\s\S]{0,1300}current\?\.fingerprint === fingerprint[\s\S]{0,2600}hasExactJsonKeys[\s\S]{0,2200}platform_result_implementation_upsert_v3/i, 'implementation client stable intent and exact response contract'],
  [implementationConsole, /snapshot_hash[\s\S]{0,3500}ensureResultImplementationUpsertIntent[\s\S]{0,2500}current_snapshot_hash[\s\S]{0,2500}snapshot_hash/i, 'implementation UI carries snapshot CAS through conflict refresh'],
  [activationVerify, /platform_canvas_round_event[\s\S]{0,800}append-only/i, 'Canvas audit behavior'],
  [activationVerify, /NULL Canvas status input changed current recovery state/i, 'Canvas NULL status negative behavior'],
  [activationVerify, /session_inactive[\s\S]{0,300}assembly_inactive[\s\S]{0,300}assembly_archived[\s\S]{0,300}org_inactive[\s\S]{0,300}org_archived[\s\S]{0,300}null_expiry[\s\S]{0,300}expired/i, 'Canvas create/start lifecycle negative matrix'],
  [activationVerify, /expired Canvas round was not available for operator recovery[\s\S]{0,700}platform_canvas_round_set_status_v2/i, 'expired Canvas read and close recovery'],
  [activationVerify, /rejected public lifecycle action changed vote\/ballot state/i, 'public ballot lifecycle negative behavior'],
  [activationVerify, /public ballot response did not inherit ballot organization/i, 'public ballot organization binding'],
  [activationVerify, /account-name failure poisoning blocked valid[\s\S]{0,1200}source budget did not[\s\S]{0,6000}password change budget did not block attempt six[\s\S]{0,2200}password recovery did not resume after budget expiry/i, 'named HQ public-login and authenticated password-change budgets'],
  [activationVerify, /missing named HQ dummy bcrypt path minted a token or lost failure evidence/i, 'missing named HQ dummy bcrypt behavior'],
  [activationVerify, /password change did not revoke every actor session[\s\S]{0,900}second-device HQ token survived password change/i, 'password rotation multi-device revocation behavior'],
  [activationVerify, /named HQ logout failed through anon RPC role[\s\S]{0,500}revoked named HQ bearer logged out twice/i, 'anonymous RPC role HQ logout behavior'],
  [activationVerify, /same-ordinal save did not archive exactly one old row[\s\S]{0,5000}same-ordinal unchanged save appended archive/i, 'same-ordinal append-only source history behavior'],
  [activationVerify, /same-ordinal source change did not invalidate linked review/i, 'same-ordinal linked review invalidation behavior'],
  [activationVerify, /same-ordinal publish unexpectedly succeeded before re-review[\s\S]{0,400}no reviewed issue in scope/i, 'same-ordinal publish gate before re-review'],
  [activationVerify, /stale semantic-edit review mutated issue state[\s\S]{0,1000}issue review request key payload mismatch unexpectedly accepted/i, 'review versus semantic edit CAS and request replay'],
  [activationVerify, /stale reclassification review changed issue state/i, 'review versus reclassification CAS'],
  [activationVerify, /stale source merge mutated issue state[\s\S]{0,8000}stale destination merge mutated issue state/i, 'dual-sided merge stale snapshot no-mutation behavior'],
  [activationVerify, /successful merge replay failed after source archive[\s\S]{0,700}archived-source merge key payload mismatch unexpectedly accepted/i, 'merge exact replay after source archive and payload mismatch rejection'],
  [verify, /rejected ballot lifecycle submit changed response state/i, 'P1a ballot lifecycle negative behavior'],
  [verify, /closed-topic team reopen unexpectedly succeeded[\s\S]{0,800}closed-topic team reopen changed submission or audit state/i, 'closed-topic team reopen rejection behavior'],
  [verify, /legacy unbound public round accepted a new vote/i, 'legacy unbound round is read-only'],
  [canvasBoard, /runExclusiveCanvasAuthOperation\(voteRoundOperationLock[\s\S]{0,12000}disabled=\{voteRoundOperationBusy\}/i, 'Canvas create/status in-flight lock'],
  [canvasBoard, /platform_canvas_round_current_v2[\s\S]{0,18000}setVoteRound\(/i, 'Canvas UI reload restore'],
  [voteCard, /setInterval\([\s\S]{0,300}5_000/i, 'pending public vote polling'],
  [voteCard, /tally == null\s*\?\s*'집계 확인 중/i, 'closed tally loading state'],
  [voteCard, /resultError[\s\S]{0,700}마지막 집계/i, 'visible stale tally warning'],
  [publicVoteForm, /window\.location\.replace\(`\/v\?round=\$\{encodeURIComponent\(pathRoundId\)\}`\)/i, 'legacy route canonical redirect'],
  [publicVoteForm, /localStorage\.getItem\('cv_device'\) \|\| localStorage\.getItem\('climate_vote_client_id'\)/i, 'legacy device id migration'],
  [publicVoteForm, /makeNativeChoiceInput\(input, label\);/i, 'keyboard-reachable native vote inputs'],
  [publicVoteFallback, /window\.VOTE_ROUND_ID = roundId/i, 'safe generic fallback round id'],
  [loadtest, /rpc\/public_round_cast_v2/i, 'loadtest public cast RPC'],
  [loadtest, /classifyVoteRpcResponse[\s\S]{0,350}'duplicate'[\s\S]{0,120}'closed'/i, 'loadtest semantic response checks'],
  [postgresVerifier, /concurrent[^\n]*HQ|hq_change_password/i, 'concurrent HQ throttle verifier'],
  [postgresVerifier, /concurrent_active_round_creation=pass successes=1 conflicts=1 active_rounds=1/i, 'concurrent moderator active-round invariant verifier'],
  [postgresVerifier, /concurrent_named_password_recovery=pass account_poison_failures=5 incorrect=5 rate_limited=1 recovery_after_window=true old_bearer_revoked=true/i, 'concurrent named HQ password-change budget and recovery verifier'],
  [postgresVerifier, /concurrentActiveRoundCreationVerification[\s\S]{0,300}concurrentNamedPasswordRecoveryVerification/i, 'report records active-round and named recovery concurrency checks'],
  [postgresVerifier, /automation\/0912-rpc-contract\.mjs[\s\S]{0,500}src\/islands\/mod\/ModConsole\.tsx/i, 'manifest includes emulator and stored-session client contracts'],
  [postgresVerifier, /ballot[ _-]*close[ _-]*race|ballot_close_race/i, 'ballot close race verifier'],
  [postgresVerifier, /--release[\s\S]{0,7000}git_repo status --porcelain -- "\$\{target_files\[@\]\}"[\s\S]{0,1200}release verification refused/i, 'release mode rejects dirty manifest targets'],
  [postgresVerifier, /(?=[\s\S]*compute_target_manifest)(?=[\s\S]*createHash\("sha256"\))(?=[\s\S]*target_manifest_sha256)(?=[\s\S]*target_manifest_after)(?=[\s\S]*manifest target changed during execution)/i, 'target SHA-256 manifest bound before and after execution'],
  [postgresVerifier, /targetManifestCount[\s\S]{0,300}targetManifestSha256[\s\S]{0,300}targetManifestVerifiedAtCompletion[\s\S]{0,300}targetManifest/i, 'report embeds the verified target manifest'],
  [runbook, /비구속 현장 조사[\s\S]{0,400}공식 의사결정/i, 'public vote accepted-risk runbook'],
  [complianceCatalog, /canvas-round-lifecycle-audit[\s\S]{0,500}platform_canvas_round_event/i, 'Canvas audit compliance catalog'],
];
for (const [source, pattern, label] of additionalBehavioralSeams) requireText(source, pattern, label);

for (const [source, label] of [
  [moderatorClient, 'moderator client'],
  [canvasBoard, 'Canvas client'],
  [publicVoteForm, 'legacy public vote client'],
  [publicVoteFallback, 'public vote fallback'],
]) {
  if (/\.from\(['"](?:rounds|votes)['"]\)|\/rest\/v1\/(?:rounds|votes)(?:\?|['"`])/i.test(source)) {
    throw new Error(`Unsafe direct rounds/votes access remains in ${label}`);
  }
}
if (/innerHTML|voterName|voterRole|sbGet\(|sbPost\(/i.test(publicVoteFallback)) {
  throw new Error('Unsafe legacy public vote fallback body remains');
}
if (/maximum-scale\s*=\s*1/i.test(publicVotePage)) {
  throw new Error('Public vote page disables user zoom');
}

console.log(JSON.stringify({
  ok: true,
  migration: migrationName,
  activation: activationName,
  ordering: ordered,
  rpcSignatures: signatures.length,
  clientRpcCalls: clientContracts.reduce((total, [, names]) => total + names.length, 0),
  behavioralSeams: 25 + additionalBehavioralSeams.length,
  revokedLegacySignatures: revokedLegacySignatures.length,
}, null, 2));
