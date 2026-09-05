#!/usr/bin/env node
// Build an admin SQL packet for the active deliberation session and official roster.
// Generated SQL uses unique cryptographic six-digit join codes.
// --print-seed-sql emits an atomic admin transaction for a new session.
// --print-sync-sql emits an atomic admin transaction for an existing roster.
// --dry-run prints planned operations and the code table without a DB connection.
// There is intentionally no direct live-write mode: only the reviewable atomic SQL packet may be applied.
import { randomInt } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  SESSION_SLUG,
  SESSION_TITLE,
  SESSION_CONFIG,
  TEAM_CAPACITY,
  buildTeamPlan,
  genRosterCodes,
  formatCodeTable,
  formatSessionSeedSql,
  formatJoinCodeSyncSql,
} from './seed-0829-lib.mjs';

async function runDryRun() {
  const plan = buildTeamPlan([]); // dry-run assumes a clean slate for display purposes
  const rows = plan.map((team) => ({ ...team, code: '******' }));

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
  console.log('   code rule: unique cryptographic six-digit values generated only with the SQL packet');
  console.log('');
  console.log(formatCodeTable(rows));
  console.log('');
  console.log('(적용은 --print-seed-sql 출력물을 검토·승인한 뒤 하나의 트랜잭션으로 실행합니다.)');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  const allowedModes = new Set(['--dry-run', '--print-seed-sql', '--print-sync-sql']);
  const unknownArgs = args.filter((arg) => !allowedModes.has(arg));
  const selectedModes = args.filter((arg) => allowedModes.has(arg));
  if (unknownArgs.length > 0 || selectedModes.length !== 1) {
    const detail = unknownArgs.length > 0 ? ` 알 수 없는 인자: ${unknownArgs.join(', ')}` : '';
    console.error(
      `사용: node scripts/seed-0829-teams.mjs (--dry-run|--print-seed-sql|--print-sync-sql).${detail}`,
    );
    console.error('직접 live 쓰기 경로는 비활성화되어 있습니다.');
    process.exitCode = 2;
  } else if (selectedModes[0] === '--print-sync-sql') {
    console.log(formatJoinCodeSyncSql(
      undefined,
      genRosterCodes(undefined, () => randomInt(100000, 1000000)),
    ));
  } else if (selectedModes[0] === '--print-seed-sql') {
    console.log(formatSessionSeedSql(
      undefined,
      genRosterCodes(undefined, () => randomInt(100000, 1000000)),
    ));
  } else {
    await runDryRun();
  }
}
