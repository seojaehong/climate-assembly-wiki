#!/usr/bin/env node
// 코드 유출 시 재발급: 8/29 세션(slug=0829-deliberation) 내 특정 조의 join_code를 새로 갱신.
// 사용: node scripts/rotate-join-code.mjs "1분과 1조" [--dry-run]
import { randomInt } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { SESSION_SLUG, genUniqueCodes } from './seed-0829-lib.mjs';

const cliRandomInt = () => randomInt(100000, 1000000);

function checkEnvOrExit() {
  const missing = [];
  if (!process.env.SUPABASE_URL) missing.push('SUPABASE_URL');
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) missing.push('SUPABASE_SERVICE_ROLE_KEY');
  if (missing.length > 0) {
    console.error(`환경변수 누락: ${missing.join(', ')} — .env 또는 셸 환경에 설정 후 다시 실행하세요.`);
    process.exit(1);
  }
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const teamName = args.find((a) => !a.startsWith('--'));
  return { teamName, dryRun };
}

async function runDryRun(teamName) {
  const [newCode] = genUniqueCodes(1, [], cliRandomInt);
  console.log('[DRY RUN] no DB connection made. Planned operation:');
  console.log('');
  console.log(`session slug: ${SESSION_SLUG}`);
  console.log(`team:         ${teamName}`);
  console.log(`old code:     <unknown until DB lookup>`);
  console.log(`new code:     ${newCode}`);
  console.log('');
  console.log('(live run requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY env vars)');
}

async function runLive(teamName) {
  checkEnvOrExit();
  const { createClient } = await import('@supabase/supabase-js');
  const client = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  ).schema('climate_vote');

  const { data: session, error: sessionErr } = await client
    .from('session')
    .select('id')
    .eq('slug', SESSION_SLUG)
    .single();
  if (sessionErr) {
    console.error(`session lookup failed (slug=${SESSION_SLUG}):`, sessionErr.message);
    process.exit(1);
  }

  const { data: team, error: teamErr } = await client
    .from('team')
    .select('id, name, join_code')
    .eq('session_id', session.id)
    .eq('name', teamName)
    .single();
  if (teamErr) {
    console.error(`team lookup failed (name=${teamName}):`, teamErr.message);
    process.exit(1);
  }

  const oldCode = team.join_code;
  let updated = null;
  let lastErr = null;
  for (let attempt = 0; attempt < 5 && !updated; attempt++) {
    const [newCode] = genUniqueCodes(1, [String(oldCode)], cliRandomInt);
    const { data, error } = await client
      .from('team')
      .update({ join_code: newCode })
      .eq('id', team.id)
      .select()
      .single();
    if (!error) {
      updated = data;
    } else if (error.code === '23505') {
      lastErr = error;
      continue;
    } else {
      console.error('join_code update failed:', error.message);
      process.exit(1);
    }
  }
  if (!updated) {
    console.error('join_code update failed after retries:', lastErr?.message);
    process.exit(1);
  }

  console.log(`team:     ${team.name}`);
  console.log(`old code: ${oldCode}`);
  console.log(`new code: ${updated.join_code}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { teamName, dryRun } = parseArgs(process.argv);
  if (!teamName) {
    console.error('사용: node scripts/rotate-join-code.mjs "<조이름>" [--dry-run]');
    process.exit(1);
  }
  if (dryRun) {
    await runDryRun(teamName);
  } else {
    await runLive(teamName);
  }
}
