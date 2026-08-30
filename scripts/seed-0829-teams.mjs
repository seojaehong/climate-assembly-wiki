#!/usr/bin/env node
// Seed the 8/29 deliberation session and its 15-team official roster.
// Normal join codes use MMDD + the canonical global team ordinal (082901..082915).
// --print-seed-sql emits an atomic admin transaction for a new session.
// --print-sync-sql emits an atomic admin transaction for an existing roster.
// --dry-run prints planned operations and the code table without a DB connection.
import { fileURLToPath } from 'node:url';
import {
  SESSION_SLUG,
  SESSION_TITLE,
  SESSION_DATE_MMDD,
  SESSION_CONFIG,
  TEAM_CAPACITY,
  fullTeamRoster,
  buildTeamPlan,
  joinCodeForTeamName,
  formatCodeTable,
  formatSessionSeedSql,
  formatJoinCodeSyncSql,
  sessionAction,
} from './seed-0829-lib.mjs';

function checkEnvOrExit() {
  const missing = [];
  if (!process.env.SUPABASE_URL) missing.push('SUPABASE_URL');
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) missing.push('SUPABASE_SERVICE_ROLE_KEY');
  if (missing.length > 0) {
    console.error(`환경변수 누락: ${missing.join(', ')} — .env 또는 셸 환경에 설정 후 다시 실행하세요.`);
    process.exit(1);
  }
}

async function runDryRun() {
  const plan = buildTeamPlan([]); // dry-run assumes a clean slate for display purposes
  const rows = plan.map((team) => ({ ...team, code: joinCodeForTeamName(team.name) }));

  console.log('[DRY RUN] no DB connection made. Planned operations:');
  console.log('');
  console.log(`1) session lookup by slug — create only if missing (existing session is never overwritten)`);
  console.log(`   slug:   ${SESSION_SLUG}`);
  console.log(`   title:  ${SESSION_TITLE}`);
  console.log(`   config: ${JSON.stringify(SESSION_CONFIG)}`);
  console.log(`   status: active`);
  console.log('');
  console.log(`2) team insert (skip if (session_id, name) already exists) — ${rows.length} rows`);
  console.log(`   capacity: ${TEAM_CAPACITY} each`);
  console.log(`   code rule: ${SESSION_DATE_MMDD} + global team ordinal 01..15`);
  console.log('');
  console.log(formatCodeTable(rows));
  console.log('');
  console.log('(live run requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY env vars)');
}

async function runLive() {
  checkEnvOrExit();
  // ★ Node 20 에서 supabase-js 가 WebSocket 을 못 찾아 죽는다 — createClient 앞에서 막는다.
  await import('./lib/node-ws-shim.mjs');
  const { createClient } = await import('@supabase/supabase-js');
  const client = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  ).schema('climate_vote');

  // 1) find existing session by slug — create-only, never overwrite an existing row
  const { data: existingSession, error: lookupErr } = await client
    .from('session')
    .select()
    .eq('slug', SESSION_SLUG)
    .maybeSingle();
  if (lookupErr) {
    console.error('session lookup failed:', lookupErr.message);
    process.exit(1);
  }

  let session;
  if (sessionAction(existingSession) === 'use') {
    session = existingSession;
    console.log(`기존 세션 사용: ${SESSION_SLUG}`);
  } else {
    const { data: created, error: insertErr } = await client
      .from('session')
      .insert({ slug: SESSION_SLUG, title: SESSION_TITLE, config: SESSION_CONFIG, status: 'active' })
      .select()
      .single();
    if (insertErr) {
      console.error('session insert failed:', insertErr.message);
      process.exit(1);
    }
    session = created;
  }

  // 2) find existing teams for this session (idempotency)
  const { data: existingTeams, error: existingErr } = await client
    .from('team')
    .select('id, name, join_code')
    .eq('session_id', session.id);
  if (existingErr) {
    console.error('failed to load existing teams:', existingErr.message);
    process.exit(1);
  }

  const plan = buildTeamPlan((existingTeams ?? []).map((t) => t.name));
  if (plan.length === 0) {
    console.log('모든 15팀이 이미 존재합니다. 신규 생성 없음.');
    return;
  }

  const rows = [];
  for (const team of plan) {
    const code = joinCodeForTeamName(team.name);
    const { data: inserted, error } = await client
      .from('team')
      .insert({
        session_id: session.id,
        name: team.name,
        subgroup: team.subgroup,
        join_code: code,
        capacity: TEAM_CAPACITY,
        status: 'active',
      })
      .select()
      .single();
    if (error) {
      const detail = error.code === '23505'
        ? `deterministic code ${code} is already in use`
        : error.message;
      console.error(`team insert failed for ${team.name}:`, detail);
      process.exit(1);
    }
    rows.push({ name: inserted.name, code: inserted.join_code });
  }

  console.log(`session: ${SESSION_SLUG} (${session.id})`);
  console.log(`생성된 팀: ${rows.length}건 (기존 스킵: ${plan.length < fullTeamRoster().length ? '있음' : '없음'})`);
  console.log('');
  console.log(formatCodeTable(rows));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const dryRun = process.argv.includes('--dry-run');
  const printSeedSql = process.argv.includes('--print-seed-sql');
  const printSyncSql = process.argv.includes('--print-sync-sql');
  if (printSyncSql) {
    console.log(formatJoinCodeSyncSql());
  } else if (printSeedSql) {
    console.log(formatSessionSeedSql());
  } else if (dryRun) {
    await runDryRun();
  } else {
    await runLive();
  }
}
