import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REQUIRED_0912_REQUIREMENTS = Object.freeze([
  'AUTH-2DEVICE',
  'AUTH-TOKEN-ONLY',
  'SYNC-SESSION-STATE',
  'UX-STATUS-RAIL',
  'TOPIC-CONTEXT-PRESERVE',
  'SAVE-OCC-IDEMPOTENCY',
  'PLATFORM-RECLASSIFY-ATOMIC',
  'HQ-CONTROL',
  'HQ-TOKEN-REVOCATION',
  'A11Y-MOD-HQ',
  'DB-P1A-DISPOSABLE',
  'OPS-ZERO-LIVE-MUTATION',
  'OPS-BACKUP-RESTORE-STOP',
  'CI-COMPLETE-MATRIX',
]);

export const REQUIRED_0912_CRITICAL_GATES = Object.freeze([
  'source-clean',
  'root-vitest',
  'automation-vitest',
  'astro-check-production-build',
  'rpc-contract',
  'traceability-report',
  'security-diff-review',
  'postgres-p1a-p2a-disposable',
  'roster-canonical-review',
  'p1-tenancy-production-approval',
  'secure-seed-sync-production-approval',
  's20-topics-production-approval',
  'p1a-additive-production-approval',
  'p1a-production-verification',
  'named-hq-operators-ready',
  'hq-join-code-pre-rotation',
  'join-code-throttle-edge-probe',
  'p2-p1b-p1c-production-approval',
  'maintenance-token-staff-client-deployed',
  'deployed-revision-match',
  'production-routine-acl-inventory',
  'p2a-cutover-separate-production-approval',
  'p2a-positive-legacy-negative-verification',
  'p3-design-provisioning-production-approval',
  'p4-audit-log-production-approval',
  'post-p4-legacy-negative-verification',
  'field-rehearsal',
  'hq-field-rehearsal',
  'onsite-device-network-rehearsal',
  'mod-hq-automated-a11y',
  'mod-hq-manual-a11y',
  'backup',
  'restore-isolated',
  'token-revocation',
]);

export const REQUIRED_0912_APPROVAL_GATES = Object.freeze([
  'p1-tenancy',
  'secure-session-team-seed',
  's20-draft-topics',
  'p1a-additive',
  'p2-analysis-org-selection',
  'p2a-token-only-cutover',
  'p3-design-provisioning',
  'p4-audit-log',
]);

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(`JSON을 읽지 못했습니다: ${path} (${error instanceof Error ? error.message : String(error)})`);
  }
}

function requireArray(value, label) {
  if (!Array.isArray(value) || value.length === 0 || value.some((item) => typeof item !== 'string' || !item)) {
    throw new Error(`${label}은 비어 있지 않은 파일 경로 배열이어야 합니다.`);
  }
}

function filePart(reference) {
  return reference.split('#', 1)[0];
}

function inspectRequiredText(root, relativePath, snippets) {
  const content = readFileSync(resolve(root, relativePath), 'utf8');
  const missing = snippets.filter((snippet) => !content.includes(snippet));
  if (missing.length > 0) throw new Error(`${relativePath} 필수 표식 누락: ${missing.join(', ')}`);
  return { path: relativePath, snippets };
}

function inspectRequiredOrder(root, relativePath, snippets) {
  const content = readFileSync(resolve(root, relativePath), 'utf8');
  const positions = snippets.map((snippet) => content.indexOf(snippet));
  if (positions.some((position) => position < 0)) {
    const missing = snippets.filter((_, index) => positions[index] < 0);
    throw new Error(`${relativePath} 순서 표식 누락: ${missing.join(', ')}`);
  }
  if (positions.some((position, index) => index > 0 && position <= positions[index - 1])) {
    throw new Error(`${relativePath} 적용 순서가 정본과 다릅니다: ${snippets.join(' → ')}`);
  }
  return { path: relativePath, orderedSnippets: snippets };
}

export function verify0912Readiness({
  root,
  manifestPath = 'automation/fixtures/0912-traceability.json',
  reportTemplatePath = 'evaluation/0912-13-readiness-report.template.json',
  fieldReportTemplatePath = 'evaluation/0912-13-field-rehearsal.template.json',
  hqReportTemplatePath = 'evaluation/0912-13-hq-rehearsal.template.json',
  rehearsalFixturePath = 'automation/fixtures/0912-rehearsal.json',
  generatedAt = new Date(),
} = {}) {
  if (!root) throw new Error('root가 필요합니다.');
  const absoluteRoot = resolve(root);
  const manifest = readJson(resolve(absoluteRoot, manifestPath));
  const template = readJson(resolve(absoluteRoot, reportTemplatePath));
  const errors = [];
  const checks = [];

  const record = (id, fn) => {
    try {
      const evidence = fn();
      checks.push({ id, status: 'pass', evidence });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`${id}: ${message}`);
      checks.push({ id, status: 'fail', evidence: message });
    }
  };

  record('manifest-schema', () => {
    if (manifest.schemaVersion !== 1 || manifest.manifestId !== '0912-13-readiness-traceability') {
      throw new Error('지원하지 않는 추적성 manifest입니다.');
    }
    const ids = manifest.requirements?.map((item) => item.id) ?? [];
    if (new Set(ids).size !== ids.length || ids.length !== REQUIRED_0912_REQUIREMENTS.length
      || REQUIRED_0912_REQUIREMENTS.some((id) => !ids.includes(id))) {
      throw new Error('요구사항 ID 집합이 고정 matrix와 다릅니다.');
    }
    return { requirementCount: ids.length };
  });

  record('requirement-links', () => {
    let linkCount = 0;
    for (const requirement of manifest.requirements ?? []) {
      if (typeof requirement.statement !== 'string' || requirement.statement.trim() === '') {
        throw new Error(`${requirement.id} 설명이 없습니다.`);
      }
      for (const field of ['implementationFiles', 'testFiles', 'evidenceFiles']) {
        requireArray(requirement[field], `${requirement.id}.${field}`);
        for (const reference of requirement[field]) {
          const relativePath = filePart(reference);
          if (!existsSync(resolve(absoluteRoot, relativePath))) {
            throw new Error(`${requirement.id}가 없는 파일을 가리킵니다: ${relativePath}`);
          }
          linkCount += 1;
        }
      }
    }
    return { linkCount };
  });

  record('report-template', () => {
    if (template.schemaVersion !== 1 || template.status !== 'needs_review'
      || template.releaseDecision !== 'not_ready') {
      throw new Error('보고서 template은 실행 전 needs_review/not_ready여야 합니다.');
    }
    if (template.safety?.liveDatabaseMutationCount !== 0
      || template.safety?.capabilityValuesLeakedToDraftQueueOrEvidence !== null) {
      throw new Error('보고서 안전 경계가 운영 DB 0건/권한값 누출 미실행으로 잠기지 않았습니다.');
    }
    const reportIds = template.requirements?.map((item) => item.id) ?? [];
    if (REQUIRED_0912_REQUIREMENTS.some((id) => !reportIds.includes(id))) {
      throw new Error('보고서 template에 요구사항이 빠졌습니다.');
    }
    const criticalGateIds = template.criticalGates?.map((gate) => gate.id) ?? [];
    if (JSON.stringify(criticalGateIds) !== JSON.stringify(REQUIRED_0912_CRITICAL_GATES)
      || new Set(criticalGateIds).size !== criticalGateIds.length) {
      throw new Error('critical gate ID 집합·순서가 정본과 다릅니다.');
    }
    if (template.criticalGates.some((gate) => gate.status !== 'not_run')) {
      throw new Error('실행 전 gate에 미리 채운 결과가 있습니다.');
    }
    const rolloutIds = template.productionRollout?.orderedSteps?.map((step) => step.id) ?? [];
    const expectedRolloutIds = [
      'session-roster-review',
      'p1-tenancy',
      'secure-session-team-seed',
      's20-draft-topics',
      'p1a-additive-and-verify',
      'hq-rotate-join-codes',
      'p2-analysis',
      'p1b-p1c-org-selection',
      'maintenance-deploy-token-staff-client',
      'p2a-atomic-token-grant-legacy-revoke',
      'p2a-positive-legacy-negative-verify',
      'p3-design-provisioning',
      'p4-audit-log',
      'post-p4-legacy-negative-and-final-status',
    ];
    if (template.productionRollout?.productionMutationRequiresExplicitApproval !== true
      || JSON.stringify(rolloutIds) !== JSON.stringify(expectedRolloutIds)
      || template.productionRollout.orderedSteps.some((step) => step.status !== 'not_run')) {
      throw new Error('보고서 production rollout 승인·적용 순서가 정본과 다릅니다.');
    }
    return {
      gateCount: template.criticalGates.length,
      requirementCount: reportIds.length,
      rolloutStepCount: rolloutIds.length,
    };
  });

  record('field-report-template', () => {
    const fieldTemplate = readJson(resolve(absoluteRoot, fieldReportTemplatePath));
    if (fieldTemplate.status !== 'not_run'
      || fieldTemplate.safety?.liveNetworkRequestCount !== 0
      || fieldTemplate.safety?.liveDatabaseMutationCount !== 0
      || fieldTemplate.networkContract?.escapedExternalRequestCount !== 0
      || !Array.isArray(fieldTemplate.networkContract?.escapedExternalOrigins)
      || fieldTemplate.networkContract.escapedExternalOrigins.length !== 0
      || fieldTemplate.networkContract?.webSocket?.stubbed !== null
      || fieldTemplate.networkContract?.webSocket?.actualNetworkConnectionCount !== 0
      || fieldTemplate.networkContract?.webSocket?.blockedExternalConnectionAttemptCount !== 0
      || !Array.isArray(fieldTemplate.networkContract?.webSocket?.blockedExternalOrigins)
      || fieldTemplate.networkContract.webSocket.blockedExternalOrigins.length !== 0) {
      throw new Error('현장 리허설 template의 미실행·HTTP/WebSocket·운영 DB 안전 경계가 올바르지 않습니다.');
    }
    return {
      path: fieldReportTemplatePath,
      escapedExternalRequestCount: 0,
      webSocketActualNetworkConnectionCount: 0,
    };
  });

  record('hq-report-template', () => {
    const hqTemplate = readJson(resolve(absoluteRoot, hqReportTemplatePath));
    if (hqTemplate.schemaVersion !== 1
      || hqTemplate.rehearsalId !== '0912-13-hq-v3-browser-rehearsal'
      || hqTemplate.status !== 'not_run'
      || hqTemplate.target?.route !== '/hq?ops=1'
      || hqTemplate.fixture !== 'automation/fixtures/0912-hq-rehearsal.json'
      || hqTemplate.evidenceBoundary?.evidenceClass !== 'ui-fixture-only'
      || hqTemplate.evidenceBoundary?.databaseAuthorizationOrLifecycleEvidence !== false
      || hqTemplate.evidenceBoundary?.canonicalDatabaseVerifier !== 'scripts/verify-0912-postgres.sh'
      || hqTemplate.safety?.forwardedSupabaseHttpRequestCount !== 0
      || hqTemplate.safety?.blockedUnexpectedSupabaseHttpRequestCount !== 0
      || hqTemplate.safety?.productionDatabaseMutationCount !== 0
      || hqTemplate.safety?.webSocket?.attemptCount !== 0
      || hqTemplate.safety?.webSocket?.actualConnectionCount !== 0
      || hqTemplate.namedHqSession?.capabilitySource !== 'runtime-generated') {
      throw new Error('HQ 리허설 template의 미실행·fixture·HTTP/WebSocket·운영 DB 안전 경계가 올바르지 않습니다.');
    }
    return {
      path: hqReportTemplatePath,
      rehearsalId: hqTemplate.rehearsalId,
      productionDatabaseMutationCount: 0,
    };
  });

  record('synthetic-fixture', () => {
    const fixture = readJson(resolve(absoluteRoot, rehearsalFixturePath));
    if (fixture.classification !== 'synthetic-no-pii-no-secrets'
      || fixture.authorization?.capabilityValuesStoredInFixture !== false) {
      throw new Error('합성 fixture 분류 또는 권한값 미보관 선언이 없습니다.');
    }
    const serialized = JSON.stringify(fixture);
    if (/@|010[- ]?\d{3,4}[- ]?\d{4}/.test(serialized)) {
      throw new Error('fixture에 이메일 또는 전화번호 형태가 있습니다.');
    }
    for (const rpc of ['mod_create_round_v3', 'mod_proxy_vote_v3', 'mod_rounds_v2',
      'mod_session_teams_v2', 'mod_vote_counts_v2', 'mod_votes_v2',
      'public_round_get_v2', 'public_round_votes_v2', 'public_round_cast_v2', 'ballot_create_v3',
      'platform_canvas_round_create_v2', 'platform_canvas_round_current_v2',
      'platform_canvas_round_set_status_v2',
      'ballot_list_v2', 'ballot_results_v2',
      'attendance_roster_v2', 'attendance_hq_summary_v2', 'attendance_set_v2',
      'attendance_bulk_present_v2', 'attendance_finalize_absent_v2', 'attendance_member_save_v2',
      'attendance_hq_audit_v2', 'attendance_hq_set_team_pin_v2', 'attendance_hq_set_table_no_v2',
      'hq_submissions_v3', 'submission_reopen_v2', 'hq_submission_history_v2',
      'hq_submission_category_assign_v3', 'hq_submission_categories_v3',
      'hq_submission_kind_assign_v3', 'hq_submission_kinds_v3', 'hq_topic_deadlines_v2',
      'hq_clear_submissions_v3', 'hq_teams_v2', 'hq_rounds_v2', 'hq_vote_counts_v2', 'hq_votes_v2',
      'workshop_team_logout_v2', 'workshop_hq_set_deadline',
      'workshop_hq_rotate_join_codes', 'workshop_hq_logout_v2']) {
      if (!fixture.expectedRpcContracts?.includes(rpc)) {
        throw new Error(`합성 fixture RPC 계약 누락: ${rpc}`);
      }
    }
    const declaredRpcs = fixture.expectedRpcContracts ?? [];
    const implementedRpcs = fixture.rpcCoverage?.emulatorImplementedRpcNames ?? [];
    if (fixture.rpcCoverage?.declaredInventorySource !== 'expectedRpcContracts'
      || !String(fixture.rpcCoverage?.declaredInventoryMeaning ?? '').includes('not emulator implementation')
      || !String(fixture.rpcCoverage?.executionEvidenceMeaning ?? '').includes('observed')
      || new Set(declaredRpcs).size !== declaredRpcs.length
      || new Set(implementedRpcs).size !== implementedRpcs.length
      || implementedRpcs.some((rpc) => !declaredRpcs.includes(rpc))) {
      throw new Error('합성 fixture의 declared·implemented·executed RPC 범위 구분이 올바르지 않습니다.');
    }
    const expectedRollout = [
      'session-roster-review',
      'p1-tenancy',
      'secure-session-team-seed',
      's20-draft-topics',
      'p1a-additive-and-verify',
      'hq-rotate-join-codes',
      'p2-analysis',
      'p1b-p1c-org-selection',
      'maintenance-deploy-token-staff-client',
      'p2a-atomic-token-grant-legacy-revoke',
      'p2a-positive-legacy-negative-verify',
      'p3-design-provisioning',
      'p4-audit-log',
      'post-p4-legacy-negative-and-final-status',
    ];
    const approvalGates = fixture.rolloutContract?.approvalGates ?? [];
    if (JSON.stringify(approvalGates) !== JSON.stringify(REQUIRED_0912_APPROVAL_GATES)
      || new Set(approvalGates).size !== approvalGates.length) {
      throw new Error('합성 fixture의 production approval gate 집합·순서가 정본과 다릅니다.');
    }
    if (JSON.stringify(fixture.rolloutContract?.orderedSteps) !== JSON.stringify(expectedRollout)
      || fixture.rolloutContract?.productionMutationRequiresExplicitApproval !== true) {
      throw new Error('합성 fixture의 승인·activation 순서가 정본과 다릅니다.');
    }
    return {
      fixtureId: fixture.fixtureId,
      topicCount: fixture.topics.length,
      rolloutSteps: fixture.rolloutContract.orderedSteps.length,
    };
  });

  record('ci-matrix', () => inspectRequiredText(absoluteRoot, '.github/workflows/test.yml', [
    "src/islands/mod/**",
    "src/lib/**",
    "docs/platform/**",
    "src/pages/mod.astro",
    "src/pages/hq.astro",
    "scripts/verify-0912-readiness.mjs",
    "scripts/verify-0912-release-report.mjs",
    "scripts/verify-0912-hq-rehearsal.mjs",
    "scripts/verify-workshop-access-contract.mjs",
    "scripts/verify-0912-postgres.sh",
    "scripts/seed-0829-*.mjs",
    "scripts/rotate-join-code.mjs",
    "scripts/session-rosters*.mjs",
    "verify-0912-field-rehearsal",
    "node-version: 20",
    "node scripts/verify-field-rehearsal.mjs",
    "node scripts/verify-0912-hq-rehearsal.mjs",
    "0912-field-rehearsal",
    "0912-hq-rehearsal",
    "verify-0912-event-access",
    'Run P1a, P2a, P3 and P4 ordered access rehearsals',
    'Run strict Astro and TypeScript checks',
    'npm run check',
    'npm exec vitest -- run',
  ]));

  record('postgres-p1a-p2a-disposable', () => {
    const runner = inspectRequiredText(absoluteRoot, 'scripts/verify-0912-postgres.sh', [
      'postgres:16',
      'container_id=""',
      'seed_sql_path=""',
      'docker rm -f "$container_id"',
      'chmod 600 "$seed_sql_path"',
      "stat -c '%a' \"$seed_sql_path\"",
      'test "$seed_sql_mode" = "0600"',
      'rm -f -- "$seed_sql_path"',
      '0912-p1a-driver.sql',
      '0912-p1a-activation-driver.sql',
      'platform_p1a_0912_event_access_BEFORE.sql',
      'platform_p2a_0912_token_only_activation_BEFORE.sql',
      'platform_p2a_0912_token_only_activation.verify.sql',
      'platform_p2a_0912_token_only_activation.rollback.verify.sql',
      'tokenOnlyActivationVerification',
      'legacyPermissionNegativeVerification',
      'legacyCrossSessionDeadlineNegativeVerification',
      'predictableJoinCodeExclusionVerification',
      'postP4LegacyNegativeVerification',
      'activationRollbackGuardVerification',
      'activationRollbackExerciseVerification',
      'activationReapplyVerification',
      'seedCliSqlSyntaxAndSuccessVerification',
      'seedCliPartialTenancyFailClosedVerification',
      'seedCliCapabilityValuesLogged',
      'seedCliHostTemporaryFileMode',
      'seedCliHostTemporaryFileRemovedBeforeExecution',
      'seedCliContainerCopyRemovedWithCreatedContainer',
      'productionDatabaseConnectionCount',
      'productionMutationCount',
    ]);
    const driver = inspectRequiredText(absoluteRoot, 'automation/tests/fixtures/0912-p1a-driver.sql', [
      'set check_function_bodies = on',
      'platform_p1_tenancy.sql',
      '0912-p1a-seed.sql',
      'platform_p1a_0912_event_access.sql',
      'platform_p1a_0912_event_access.verify.sql',
    ]);
    const driverOrder = inspectRequiredOrder(absoluteRoot, 'automation/tests/fixtures/0912-p1a-driver.sql', [
      '\\i /tmp/platform_p1_tenancy.sql',
      '\\i /tmp/0912-p1a-seed.sql',
      '\\i /tmp/platform_p1a_0912_event_access.sql',
    ]);
    const activationDriver = inspectRequiredText(
      absoluteRoot,
      'automation/tests/fixtures/0912-p1a-activation-driver.sql',
      [
        'platform_p1a_0912_event_access.sql',
        'platform_p2_analysis_review.sql',
        'platform_p1b_backfill.sql',
        'platform_p1c_org_selection.sql',
        'platform_p2a_0912_token_only_activation.sql',
        'platform_p2a_0912_token_only_activation.verify.sql',
        'platform_p3_design_provisioning.sql',
        'platform_p4_audit_log.sql',
        'platform_p2a_0912_token_only_activation_BEFORE.sql',
        'platform_p2a_0912_token_only_activation.rollback.verify.sql',
        "emergency_rollback_ack='I_ACCEPT_LEGACY_ACCESS_REOPEN'",
        "emergency_rollback_incident='disposable-verification-only'",
        'P2A REAPPLY AFTER ROLLBACK',
      ],
    );
    const activationDriverOrder = inspectRequiredOrder(
      absoluteRoot,
      'automation/tests/fixtures/0912-p1a-activation-driver.sql',
      [
        '\\i /tmp/platform_p1_tenancy.sql',
        '\\i /tmp/0912-p1a-seed.sql',
        '\\i /tmp/platform_p1a_0912_event_access.sql',
        '\\i /tmp/platform_p2_analysis_review.sql',
        '\\i /tmp/platform_p1b_backfill.sql',
        '\\i /tmp/platform_p1c_org_selection.sql',
        '\\i /tmp/platform_p2a_0912_token_only_activation.sql',
        '\\i /tmp/platform_p3_design_provisioning.sql',
        '\\i /tmp/platform_p4_audit_log.sql',
      ],
    );
    const activationVerify = inspectRequiredText(
      absoluteRoot,
      'supabase/verify/platform_p2a_0912_token_only_activation.sql',
      [
        'legacy execute survived activation',
        'staff ballot privilege mismatch',
        'mod_proxy_vote_v3',
        'topic_set_deadline',
        'legacy call permission denied seam failed',
      ],
    );
    const activationRollbackVerify = inspectRequiredText(
      absoluteRoot,
      'supabase/verify/platform_p2a_0912_token_only_activation_rollback.sql',
      ['activation rollback privilege mismatch', 'activation rollback left token/non-idempotent RPC executable',
        'mod_proxy_vote_v2'],
    );
    const seed = inspectRequiredText(absoluteRoot, 'automation/tests/fixtures/0912-p1a-seed.sql', [
      "current_database() <> 'verify'",
      "'0912-deliberation'",
      "'091201'",
      "'091202'",
      "'draft'",
    ]);
    const seedCliPrelude = inspectRequiredText(
      absoluteRoot,
      'automation/tests/fixtures/0912-seed-cli-prelude.sql',
      [
        "current_database() <> 'verify'",
        "'0829-deliberation'",
        'platform_p1_tenancy.sql',
        'SEED CLI THROWAWAY SOURCE INSTALLED',
      ],
    );
    return {
      runner,
      driver,
      driverOrder,
      activationDriver,
      activationDriverOrder,
      activationVerify,
      activationRollbackVerify,
      seed,
      seedCliPrelude,
    };
  });

  record('seed-live-write-disabled', () => {
    const implementation = inspectRequiredText(absoluteRoot, 'scripts/seed-0829-teams.mjs', [
      'There is intentionally no direct live-write mode',
      '--print-seed-sql',
      '--print-sync-sql',
      "import { randomInt } from 'node:crypto'",
      'unknownArgs.length > 0 || selectedModes.length !== 1',
      "code: '******'",
      'process.exitCode = 2',
    ]);
    const library = inspectRequiredText(absoluteRoot, 'scripts/seed-0829-lib.mjs', [
      'roster codes are required; operational callers must use a cryptographically secure generator',
      'function rosterCodeRows(roster, codes)',
    ]);
    const rotation = inspectRequiredText(absoluteRoot, 'scripts/rotate-join-code.mjs', [
      "const allowedModes = new Set(['--dry-run', '--print-sql'])",
      'modes.length !== 1 || names.length !== 1',
      '직접 live 쓰기 경로는 비활성화되어 있습니다.',
      'process.exitCode = 2',
    ]);
    const rotationSource = readFileSync(resolve(absoluteRoot, 'scripts/rotate-join-code.mjs'), 'utf8');
    if (rotationSource.includes('createClient(') || rotationSource.includes('SUPABASE_SERVICE_ROLE_KEY')
      || rotationSource.includes(".from('team')")) {
      throw new Error('rotate-join-code.mjs에 direct Supabase write 경로가 남아 있습니다.');
    }
    const test = inspectRequiredText(absoluteRoot, 'scripts/seed-0829.test.mjs', [
      'refuses a no-argument direct live write before loading any credentials',
      'rejects unknown or conflicting seed modes instead of guessing operator intent',
      'disables direct rotation and keeps dry-run codes masked',
      'emits an atomic admin transaction for a new session roster',
      'creates one unique six-digit code per active team',
      'refuses to generate operational SQL without caller-supplied secure codes',
      'expect(result.status).toBe(2)',
    ]);
    return { implementation, library, rotation, test };
  });

  record('hq-attendance-session-boundary', () => {
    const attendance = inspectRequiredText(absoluteRoot, 'src/lib/attendance.ts', [
      "'attendance_roster_v2'",
      "'attendance_hq_summary_v2'",
      "'attendance_set_v2'",
      "'attendance_bulk_present_v2'",
      "'attendance_finalize_absent_v2'",
      "'attendance_member_save_v2'",
      "'attendance_hq_audit_v2'",
      "'attendance_hq_set_team_pin_v2'",
      "'attendance_hq_set_table_no_v2'",
      "'workshop_hq_logout_v2'",
      'p_token: token',
      'p_session_slug: sessionSlug',
    ]);
    const submissions = inspectRequiredText(absoluteRoot, 'src/lib/hq-submissions.ts', [
      "'hq_submissions_v3'",
      "'submission_reopen_v2'",
      "'hq_submission_history_v2'",
      "'hq_submission_category_assign_v3'",
      "'hq_submission_categories_v3'",
      "'hq_submission_kind_assign_v3'",
      "'hq_submission_kinds_v3'",
      "'hq_topic_deadlines_v2'",
      "'hq_clear_submissions_v3'",
      'source_item_id',
      'p_token: token',
      'p_session_slug: sessionSlug',
    ]);
    const grid = inspectRequiredText(absoluteRoot, 'src/lib/mod-console.ts', [
      "'mod_rounds_v2'",
      "'mod_session_teams_v2'",
      "'mod_vote_counts_v2'",
      "'mod_votes_v2'",
      "'public_round_get_v2'",
      "'public_round_votes_v2'",
      "'public_round_cast_v2'",
      "'hq_teams_v2'",
      "'hq_rounds_v2'",
      "'hq_vote_counts_v2'",
      "'hq_votes_v2'",
      'p_token: token',
      'p_session_slug: sessionSlug',
    ]);
    return { attendance, submissions, grid };
  });

  record('accessibility-routes', () => {
    const automated = inspectRequiredText(absoluteRoot, 'automation/platform-accessibility-audit.mjs', [
      "id: 'moderator-console'",
      "path: '/mod?code=000000'",
      "id: 'hq-console-gate'",
      "id: 'hq-console-dashboard'",
      "path: '/hq'",
      "sessionStorage.setItem('climate_vote_hq_attendance_token'",
      "'workshop_hq_status'",
      "'workshop_hq_devices'",
      "'attendance_hq_summary_v2'",
      "'attendance_roster_v2'",
      "'attendance_hq_audit_v2'",
      "'hq_submissions_v3'",
      "'hq_submission_history_v2'",
      "'hq_submission_categories_v3'",
      "'hq_submission_kinds_v3'",
      "'hq_topic_deadlines_v2'",
      "'attendance_set_v2'",
      "'attendance_bulk_present_v2'",
      "'attendance_finalize_absent_v2'",
      "'attendance_member_save_v2'",
      "'attendance_hq_set_team_pin_v2'",
      "'attendance_hq_set_table_no_v2'",
      "'submission_reopen_v2'",
      "'hq_submission_category_assign_v3'",
      "'hq_submission_kind_assign_v3'",
      "'hq_clear_submissions_v3'",
      "'hq_teams_v2'",
      "'hq_rounds_v2'",
      "'hq_vote_counts_v2'",
      "'hq_votes_v2'",
      'escapedNetworkRequestCount: 0',
      'blockedExternalRequestCount === 0',
      "page.route('**/*'",
      "serviceWorkers: 'block'",
      'context.routeWebSocket(/.*/',
      'blockedExternalConnectionAttemptCount === 0',
      'actualNetworkConnectionCount: 0',
    ]);
    const manual = inspectRequiredText(absoluteRoot, 'automation/platform-accessibility-manual-evidence.mjs', [
      "id: 'moderator-console'",
      "id: 'hq-console-gate'",
    ]);
    return { automated, manual };
  });

  record('field-context-preservation', () => inspectRequiredText(
    absoluteRoot,
    'scripts/verify-field-rehearsal.mjs',
    ['workshop-new-topic-alert', 'contextState.focused', 'contextState.scrollDelta',
      '__fieldRehearsalWebSocket', 'actualNetworkConnectionCount',
      "serviceWorkers: 'block'", 'context.routeWebSocket(/.*/',
      'blockedExternalConnectionAttemptCount',
      'liveDatabaseMutationCount: calls.live_database_mutation',
      'unexpectedRpcRequestCount: calls.unexpected_rpc',
      "context.route('**/*'", 'requestUrl.origin === BASE_ORIGIN',
      'requestUrl.origin === FIXTURE_SUPABASE_ORIGIN', 'escapedExternalRequestCount: calls.escaped'],
  ));

  record('runbook-controls', () => inspectRequiredText(
    absoluteRoot,
    'docs/operations/0912-13-runbook.md',
    [
      '백업',
      '복원',
      '토큰 폐기',
      '비상 RPC',
      '중단 기준',
      '운영 DB 변경 0건',
      '운영 승인 gate 1',
      '운영 승인 gate 2',
      '운영 승인 gate 3',
      '4인자 HQ rotate 선교체',
      'maintenance token/staff client 배포',
      'P2a 별도 승인·원자 cutover',
      'activation positive·negative 검증',
      'P3 design provisioning',
      'P4 audit log',
      'post-P4 legacy negative 재검증',
      'P1 → seed/s20 → P1a → P2 → P1b/P1c → P2a → P3 → P4',
      'P1보다 앞서 실행하면 안 된다',
      'mod_proxy_vote_v3',
      'platform_ballot_results_v2',
      'workshop_hq_rotate_join_codes(p_token, p_session_slug, p_confirmation, p_idempotency_key)',
      'workshop_hq_logout_v2(p_token)',
      'scripts/verify-0912-hq-rehearsal.mjs',
      'scripts/verify-0912-release-report.mjs',
      'direct live-write 경로는 완전히 비활성화',
    ],
  ));

  let sourceCommit = null;
  let sourceTreeClean = null;
  try {
    const gitOptions = {
      cwd: absoluteRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    };
    sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], gitOptions).trim();
    sourceTreeClean = execFileSync('git', ['status', '--porcelain'], gitOptions).trim() === '';
  } catch (error) {
    errors.push(`git-state: ${error instanceof Error ? error.message : String(error)}`);
  }

  return {
    schemaVersion: 1,
    reportId: '0912-13-traceability-verification',
    generatedAt: generatedAt.toISOString(),
    sourceCommit,
    sourceTreeClean,
    status: errors.length === 0 ? 'pass' : 'fail',
    safety: { liveDatabaseMutationCount: 0, networkRequestCount: 0 },
    summary: {
      requirementCount: manifest.requirements?.length ?? 0,
      checkCount: checks.length,
      passCount: checks.filter((item) => item.status === 'pass').length,
      failCount: checks.filter((item) => item.status === 'fail').length,
    },
    checks,
    errors,
  };
}

export function parse0912ReadinessCliArgs(args) {
  if (!Array.isArray(args)) throw new Error('CLI 인자는 배열이어야 합니다.');
  const supported = new Set(['--root', '--output']);
  const parsed = {};
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    if (!supported.has(name)) throw new Error(`지원하지 않는 옵션입니다: ${String(name)}`);
    if (Object.hasOwn(parsed, name)) throw new Error(`중복 옵션은 허용하지 않습니다: ${name}`);
    const value = args[index + 1];
    if (typeof value !== 'string' || value.trim() === '' || value.startsWith('--')) {
      throw new Error(`${name} 옵션에는 값이 필요합니다.`);
    }
    parsed[name] = value;
  }
  return parsed;
}

export function run0912ReadinessCli(args) {
  const options = parse0912ReadinessCliArgs(args);
  const here = dirname(fileURLToPath(import.meta.url));
  const root = resolve(options['--root'] ?? resolve(here, '..'));
  const output = resolve(root, options['--output'] ?? 'evaluation/0912-13-traceability-report.json');
  const report = verify0912Readiness({ root });
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify({ output, status: report.status, summary: report.summary })}\n`);
  if (report.status !== 'pass') process.exitCode = 1;
  return report;
}

const isCli = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  try {
    run0912ReadinessCli(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`0912 readiness CLI error: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
