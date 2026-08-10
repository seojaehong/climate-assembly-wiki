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
  return runSnapshotRpc({
    client,
    roundId,
    rpcName: 'cv_snapshot_now',
    rpcArgs: { p_label: label, p_source: 'cron' },
    snapshotKind: 'legacy',
    maxRetries,
    baseDelayMs,
    alert,
    cumulativeFailures,
  });
}

/** Preserves the legacy snapshot and optionally adds the platform data snapshot. */
export async function snapshotArchive({
  client,
  roundId,
  label = null,
  includePlatformSnapshot = false,
  maxRetries = 5,
  baseDelayMs = 1000,
  alert = () => {},
  cumulativeFailures = 0,
}) {
  const shared = { client, roundId, maxRetries, baseDelayMs, alert, cumulativeFailures };
  const legacy = await snapshotRound({ ...shared, label });
  if (!includePlatformSnapshot) return legacy;
  const receipt = await runSnapshotRpc({
    ...shared,
    rpcName: 'platform_snapshot_now',
    rpcArgs: { p_label: label },
    snapshotKind: 'platform',
  });
  const platform = await readSnapshotRow({
    ...shared,
    snapshotId: receipt?.id,
  });
  return { legacy, platform };
}

async function readSnapshotRow({
  client,
  roundId,
  snapshotId,
  maxRetries,
  baseDelayMs,
  alert,
  cumulativeFailures,
}) {
  let lastError;
  if (!Number.isSafeInteger(snapshotId) || snapshotId <= 0) {
    lastError = new Error('platform snapshot receipt did not include a valid id');
  } else {
    for (let i = 0; i < maxRetries; i++) {
      try {
        const { data, error } = await client
          .schema('climate_vote')
          .from('snapshots')
          .select('*')
          .eq('id', snapshotId)
          .single();
        if (!error && data) return data;
        lastError = error ?? new Error('snapshot row was empty');
      } catch (error) {
        lastError = error;
      }
      if (i < maxRetries - 1) await sleep(baseDelayMs * 2 ** i);
    }
  }
  const level = cumulativeFailures >= 3 ? 'critical' : 'warning';
  const message = lastError instanceof Error ? lastError.message : lastError?.message;
  alert({ level, message: `platform snapshot export failed: ${message}`, roundId });
  throw new Error(`platform snapshot export persistent failure: ${message}`);
}

async function runSnapshotRpc({
  client,
  roundId,
  rpcName,
  rpcArgs,
  snapshotKind,
  maxRetries,
  baseDelayMs,
  alert,
  cumulativeFailures,
}) {
  let lastError;
  for (let i = 0; i < maxRetries; i++) {
    const { data, error } = await client.schema('climate_vote').rpc(rpcName, rpcArgs);
    if (!error) return data;
    lastError = error;
    if (i < maxRetries - 1) await sleep(baseDelayMs * 2 ** i);
  }
  const level = cumulativeFailures >= 3 ? 'critical' : 'warning';
  alert({ level, message: `${snapshotKind} snapshot failed: ${lastError?.message}`, roundId });
  throw new Error(`${snapshotKind} snapshot persistent failure: ${lastError?.message}`);
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
  const includePlatformSnapshot = process.env.PLATFORM_SNAPSHOT_ENABLED === 'true';
  const data = await snapshotArchive({ client, roundId, label: snapshotLabel, includePlatformSnapshot });
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
  const outDir = `/tmp/${ws.name}/snapshots`;
  mkdirSync(outDir, { recursive: true });
  const outPath = `${outDir}/${ts}.json`;
  writeFileSync(outPath, JSON.stringify(data, null, 2));
  console.log(JSON.stringify({ workshop: ws.name, ts, outPath, includePlatformSnapshot }));
}
