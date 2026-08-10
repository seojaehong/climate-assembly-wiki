import { fileURLToPath } from 'node:url';
import { createHmac, timingSafeEqual } from 'node:crypto';

const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Maps non-secret GitHub workflow provenance into the export audit manifest. */
export function workflowAuditContext(environment, exportedAt = new Date().toISOString()) {
  return {
    exportedAt,
    repository: environment.GITHUB_REPOSITORY ?? null,
    runId: environment.GITHUB_RUN_ID ?? null,
    commitSha: environment.GITHUB_SHA ?? null,
    workflowRef: environment.GITHUB_WORKFLOW_REF ?? null,
    keyId: environment.SNAPSHOT_AUDIT_KEY_ID ?? null,
  };
}

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
  auditContext = {},
  auditKey = '',
}) {
  const shared = { client, roundId, maxRetries, baseDelayMs, alert, cumulativeFailures };
  const legacy = await snapshotRound({ ...shared, label });
  if (!includePlatformSnapshot) return legacy;
  validateAuditConfiguration(auditKey, auditContext);
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
  return { legacy, platform, audit: buildSnapshotAudit(platform, auditContext, auditKey) };
}

function validateAuditConfiguration(auditKey, context) {
  const provenance = [
    context.exportedAt,
    context.repository,
    context.runId,
    context.commitSha,
    context.workflowRef,
    context.keyId,
  ];
  if (typeof auditKey !== 'string' || auditKey.length < 32 || provenance.some((value) => typeof value !== 'string' || value.length === 0)) {
    throw new Error('platform snapshot audit configuration is incomplete');
  }
}

function buildSnapshotAudit(platform, context, auditKey) {
  const audit = {
    schemaVersion: 1,
    event: 'platform_snapshot_export',
    exportedAt: context.exportedAt,
    repository: context.repository,
    runId: context.runId,
    commitSha: context.commitSha,
    workflowRef: context.workflowRef,
    keyId: context.keyId,
    snapshotId: platform.id,
  };
  return {
    ...audit,
    integrity: {
      algorithm: 'hmac-sha256',
      target: 'platform+provenance',
      digest: snapshotDigest(platform, audit, auditKey),
    },
  };
}

function snapshotDigest(platform, audit, auditKey) {
  const signedRecord = {
    schemaVersion: audit.schemaVersion,
    event: audit.event,
    exportedAt: audit.exportedAt,
    repository: audit.repository,
    runId: audit.runId,
    commitSha: audit.commitSha,
    workflowRef: audit.workflowRef,
    keyId: audit.keyId,
    snapshotId: audit.snapshotId,
    platform,
  };
  return createHmac('sha256', auditKey).update(JSON.stringify(signedRecord)).digest('hex');
}

/** Verifies that the exported platform row still matches its audit manifest. */
export function verifySnapshotArchiveIntegrity(archive, auditKey) {
  if (!archive?.platform || !archive?.audit) return false;
  if (typeof auditKey !== 'string' || auditKey.length < 32) return false;
  if (archive.audit.schemaVersion !== 1 || archive.audit.event !== 'platform_snapshot_export') return false;
  if (archive.audit.snapshotId !== archive.platform.id) return false;
  if (archive.audit.integrity?.algorithm !== 'hmac-sha256' || archive.audit.integrity?.target !== 'platform+provenance') return false;
  if (!/^[a-f0-9]{64}$/.test(archive.audit.integrity.digest)) return false;
  const expected = Buffer.from(snapshotDigest(archive.platform, archive.audit, auditKey), 'hex');
  const actual = Buffer.from(archive.audit.integrity.digest, 'hex');
  return timingSafeEqual(actual, expected);
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
  const data = await snapshotArchive({
    client,
    roundId,
    label: snapshotLabel,
    includePlatformSnapshot,
    auditContext: workflowAuditContext(process.env),
    auditKey: process.env.SNAPSHOT_AUDIT_HMAC_KEY,
  });
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
  const outDir = `/tmp/${ws.name}/snapshots`;
  mkdirSync(outDir, { recursive: true });
  const outPath = `${outDir}/${ts}.json`;
  writeFileSync(outPath, JSON.stringify(data, null, 2));
  console.log(JSON.stringify({ workshop: ws.name, ts, outPath, includePlatformSnapshot }));
}
