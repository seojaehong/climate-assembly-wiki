import { fileURLToPath } from 'node:url';

const sleep = ms => new Promise(r => setTimeout(r, ms));

export async function snapshotRound({
  client,
  roundId,
  label = null,
  maxRetries = 5,
  baseDelayMs = 1000,
  alert = () => {},
  cumulativeFailures = 0
}) {
  let lastError;
  for (let i = 0; i < maxRetries; i++) {
    const { data, error } = await client.rpc('cv_snapshot_now', { p_label: label, p_source: 'cron' });
    if (!error) return data;
    lastError = error;
    if (i < maxRetries - 1) await sleep(baseDelayMs * 2 ** i);
  }
  const level = cumulativeFailures >= 3 ? 'critical' : 'warning';
  alert({ level, message: `snapshot failed: ${lastError?.message}`, roundId });
  throw new Error(`snapshot persistent failure: ${lastError?.message}`);
}

// CLI mode
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { createClient } = await import('@supabase/supabase-js');
  const { loadSchedule, findActiveWorkshop } = await import('./lib/schedule.mjs');
  const { writeFileSync, mkdirSync } = await import('node:fs');
  const schedule = await loadSchedule();
  const ws = findActiveWorkshop(schedule);
  if (!ws) {
    console.log(JSON.stringify({ skipped: 'not in workshop window' }));
    process.exit(0);
  }
  const client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE);
  const roundId = ws.supabase_round_id;
  const snapshotLabel = `${ws.name ?? ws.date}-r${roundId}`;
  const data = await snapshotRound({ client, roundId, label: snapshotLabel });
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
  const outDir = `/tmp/${ws.name}/snapshots`;
  mkdirSync(outDir, { recursive: true });
  const outPath = `${outDir}/${ts}.json`;
  writeFileSync(outPath, JSON.stringify(data, null, 2));
  console.log(JSON.stringify({ workshop: ws.name, ts, outPath }));
}
