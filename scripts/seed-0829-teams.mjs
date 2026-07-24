#!/usr/bin/env node
// 8/29 숙의 세션 시드: session upsert(slug=0829-deliberation) + 15팀(1~3분과 x 1~5조) 생성.
// 기존 팀은 skip(idempotent), join_code는 crypto.randomInt(100000,999999) 유니크.
// --dry-run: DB 연결 없이 계획된 연산과 코드표만 stdout에 출력.
import { randomInt } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  SESSION_SLUG,
  SESSION_TITLE,
  SESSION_CONFIG,
  TEAM_CAPACITY,
  fullTeamRoster,
  buildTeamPlan,
  genUniqueCodes,
  formatCodeTable,
} from './seed-0829-lib.mjs';

const cliRandomInt = () => randomInt(100000, 1000000); // 100000-999999 inclusive

async function runDryRun() {
  const plan = buildTeamPlan([]); // dry-run assumes a clean slate for display purposes
  const codes = genUniqueCodes(plan.length, [], cliRandomInt);
  const rows = plan.map((team, i) => ({ ...team, code: codes[i] }));

  console.log('[DRY RUN] no DB connection made. Planned operations:');
  console.log('');
  console.log(`1) session upsert (onConflict: slug)`);
  console.log(`   slug:   ${SESSION_SLUG}`);
  console.log(`   title:  ${SESSION_TITLE}`);
  console.log(`   config: ${JSON.stringify(SESSION_CONFIG)}`);
  console.log(`   status: active`);
  console.log('');
  console.log(`2) team insert (skip if (session_id, name) already exists) — ${rows.length} rows`);
  console.log(`   capacity: ${TEAM_CAPACITY} each`);
  console.log('');
  console.log(formatCodeTable(rows));
  console.log('');
  console.log('(live run requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY env vars)');
}

async function runLive() {
  const { createClient } = await import('@supabase/supabase-js');
  const client = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  ).schema('climate_vote');

  // 1) session upsert by slug
  const { data: session, error: sessionErr } = await client
    .from('session')
    .upsert(
      { slug: SESSION_SLUG, title: SESSION_TITLE, config: SESSION_CONFIG, status: 'active' },
      { onConflict: 'slug' }
    )
    .select()
    .single();
  if (sessionErr) {
    console.error('session upsert failed:', sessionErr.message);
    process.exit(1);
  }

  // 2) find existing teams for this session (idempotency)
  const { data: existingTeams, error: existingErr } = await client
    .from('team')
    .select('name')
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
    let inserted = null;
    let lastErr = null;
    for (let attempt = 0; attempt < 5 && !inserted; attempt++) {
      const [code] = genUniqueCodes(1, [], cliRandomInt);
      const { data, error } = await client
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
      if (!error) {
        inserted = data;
      } else if (error.code === '23505') {
        // unique violation on join_code — regenerate and retry
        lastErr = error;
        continue;
      } else {
        console.error(`team insert failed for ${team.name}:`, error.message);
        process.exit(1);
      }
    }
    if (!inserted) {
      console.error(`team insert failed for ${team.name} after retries:`, lastErr?.message);
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
  if (dryRun) {
    await runDryRun();
  } else {
    await runLive();
  }
}
