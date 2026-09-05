#!/usr/bin/env node
// Emergency reissue for a leaked code: update one team with a new cryptographic six-digit code.
// Usage: node scripts/rotate-join-code.mjs "1분과 1조" (--dry-run|--print-sql)
import { randomInt } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  SESSION_SLUG,
  genUniqueCodes,
  formatJoinCodeRotationSql,
} from './seed-0829-lib.mjs';

const cliRandomInt = () => randomInt(100000, 1000000);

function parseArgs(argv) {
  const args = argv.slice(2);
  const allowedModes = new Set(['--dry-run', '--print-sql']);
  const modes = args.filter((arg) => allowedModes.has(arg));
  const unknownFlags = args.filter((arg) => arg.startsWith('--') && !allowedModes.has(arg));
  const names = args.filter((arg) => !arg.startsWith('--'));
  if (unknownFlags.length > 0 || modes.length !== 1 || names.length !== 1) {
    return { valid: false, teamName: null, mode: null, unknownFlags };
  }
  return { valid: true, teamName: names[0], mode: modes[0], unknownFlags: [] };
}

async function runDryRun(teamName) {
  console.log('[DRY RUN] no DB connection made. Planned operation:');
  console.log('');
  console.log(`session slug: ${SESSION_SLUG}`);
  console.log(`team:         ${teamName}`);
  console.log('old code:     ******');
  console.log('new code:     ****** (generated only with --print-sql)');
  console.log('');
  console.log('(적용은 --print-sql 출력물을 별도 승인한 뒤 SQL Editor에서 실행합니다.)');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { valid, teamName, mode, unknownFlags } = parseArgs(process.argv);
  if (!valid || !teamName || !mode) {
    const detail = unknownFlags.length > 0 ? ` 알 수 없는 인자: ${unknownFlags.join(', ')}` : '';
    console.error(`사용: node scripts/rotate-join-code.mjs "<조이름>" (--dry-run|--print-sql).${detail}`);
    console.error('직접 live 쓰기 경로는 비활성화되어 있습니다.');
    process.exitCode = 2;
  } else if (mode === '--print-sql') {
    const [newCode] = genUniqueCodes(1, [], cliRandomInt);
    console.log(formatJoinCodeRotationSql(teamName, newCode));
  } else {
    await runDryRun(teamName);
  }
}
