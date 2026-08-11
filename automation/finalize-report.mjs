import { fileURLToPath } from 'node:url';
import { evaluateCoverage, inspectWorkshopArchive } from './scripts/verify-drive.mjs';
import { expectedCaptureTimestamps } from './lib/schedule.mjs';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function parseDriveCredentials(raw) {
  try {
    const credentials = JSON.parse(raw);
    if (!credentials || typeof credentials !== 'object' || Array.isArray(credentials)) throw new Error();
    return credentials;
  } catch {
    throw new Error('Drive credentials JSON is invalid');
  }
}

function normalizeDate(d) {
  if (d instanceof Date) return d.toISOString().slice(0, 10);
  return String(d);
}

function kstDate(now, offsetDays = 0) {
  const kst = new Date(now.getTime() + 9 * 3600 * 1000 + offsetDays * 86400 * 1000);
  return kst.toISOString().slice(0, 10);
}

export function expectedCaptureSets(workshop, intervalMinutes = 5) {
  return expectedCaptureTimestamps(workshop, intervalMinutes).length;
}

export { expectedCaptureTimestamps };

export function resolveWorkshop({ schedule, explicitName, scheduled = false, now = new Date() }) {
  const today = kstDate(now, 0);
  const yesterday = kstDate(now, -1);
  if (explicitName) {
    const workshop = schedule.workshops.find(w => w.name === explicitName) ?? null;
    if (!workshop || !scheduled) return workshop;
    const date = normalizeDate(workshop.date);
    return date === today || date === yesterday ? workshop : null;
  }
  return schedule.workshops.find(w => {
    const d = normalizeDate(w.date);
    return d === today || d === yesterday;
  }) ?? null;
}

export function buildSummaryMarkdown(stats) {
  const finalVotes = Number.isSafeInteger(stats.finalVotes) ? stats.finalVotes : '미집계';
  const lines = [
    `# 워크숍 자동 아카이브 — ${stats.workshop}`,
    ``,
    `- 일자: ${stats.date}`,
    `- 캡쳐 set: ${stats.captureSets}`,
    `- 스냅샷 건수: ${stats.snapshotCount}`,
    `- 최종 표 수: ${finalVotes}`,
  ];
  if (stats.expectedSets) {
    const missing = stats.expectedSets - stats.captureSets;
    const pct = (missing / stats.expectedSets) * 100;
    if (pct > 5) {
      lines.push(``, `> ⚠️ 누락 ${missing} set (${pct.toFixed(1)}%) — 회고 필요`);
    }
  }
  return lines.join('\n');
}

export async function loadFinalizeReport({
  drive,
  parentId,
  workshop,
  requiredCaptureFiles,
  expectedSets = expectedCaptureSets(workshop),
}) {
  const expectedTimestamps = expectedCaptureTimestamps(workshop);
  const archive = await inspectWorkshopArchive({
    drive,
    parentId,
    workshop: workshop.name,
    requiredCaptureFiles,
    expectedCaptureTimestamps: expectedTimestamps,
  });
  const stats = {
    workshop: workshop.name,
    date: normalizeDate(workshop.date),
    ...archive,
    finalVotes: null,
    expectedSets,
  };
  const coverage = evaluateCoverage({ actual: stats.captureSets, expected: expectedSets });
  return { status: coverage.status, stats, markdown: buildSummaryMarkdown(stats) };
}

export async function sendFinalizeNotification({
  fetchImpl = fetch,
  sleepImpl = sleep,
  retryDelayMs = 1000,
  webhook,
  status,
  workshop,
  markdown,
}) {
  if (!webhook) return { sent: false };
  const icon = status === 'issue' ? '⚠️' : '✅';
  let lastError;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetchImpl(webhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: `${icon} finalize: ${workshop}\n\`\`\`\n${markdown}\n\`\`\`` }),
        signal: AbortSignal.timeout(20_000),
      });
      if (response.ok) return { sent: true };
      lastError = new Error(`finalize notification failed: HTTP ${response.status}`);
    } catch (error) {
      const name = error instanceof Error ? error.name : 'unknown';
      lastError = new Error(`finalize notification request failed: ${name}`);
    }
    if (attempt === 0) await sleepImpl(retryDelayMs);
  }
  throw lastError;
}

export async function writeFinalizeRow({ sheets, spreadsheetId, stats }) {
  const rowValues = [
    stats.date,
    stats.workshop,
    stats.captureSets,
    stats.snapshotCount,
    stats.finalVotes ?? '',
  ];
  const { data } = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: '워크숍_아카이브!A:B',
  });
  if (data.values !== undefined && !Array.isArray(data.values)) {
    throw new Error('workshop archive sheet returned invalid rows');
  }
  const rows = data.values ?? [];
  const matches = rows
    .map((row, index) => ({ row, number: index + 1 }))
    .filter(({ row }) => row[0] === stats.date && row[1] === stats.workshop);
  if (matches.length > 1) {
    throw new Error(`duplicate workshop archive rows: ${stats.date} ${stats.workshop}`);
  }
  if (matches.length === 1) {
    const row = matches[0].number;
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `워크숍_아카이브!A${row}:E${row}`,
      valueInputOption: 'RAW',
      requestBody: { values: [rowValues] },
    });
    return { action: 'updated', row };
  }
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: '워크숍_아카이브!A:E',
    valueInputOption: 'RAW',
    requestBody: { values: [rowValues] },
  });
  return { action: 'appended' };
}

// CLI mode
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { google } = await import('googleapis');
  const { writeFileSync } = await import('node:fs');
  const { loadSchedule } = await import('./lib/schedule.mjs');

  const schedule = await loadSchedule();
  const explicitName = process.env.WORKSHOP || null;
  const ws = resolveWorkshop({
    schedule,
    explicitName,
    scheduled: process.env.SCHEDULED === 'true',
  });
  if (!ws) {
    console.log(JSON.stringify({ skipped: 'no workshop to finalize' }));
    process.exit(0);
  }

  if (!process.env.DRIVE_SA_JSON || !process.env.DRIVE_PARENT_ID || !process.env.SHEETS_ID || !process.env.DISCORD_WEBHOOK) {
    throw new Error('finalize configuration is incomplete');
  }

  const auth = new google.auth.GoogleAuth({
    credentials: parseDriveCredentials(process.env.DRIVE_SA_JSON),
    scopes: [
      'https://www.googleapis.com/auth/drive.readonly',
      'https://www.googleapis.com/auth/spreadsheets'
    ]
  });
  const drive = google.drive({ version: 'v3', auth });
  const sheets = google.sheets({ version: 'v4', auth });

  const { status, stats, markdown: md } = await loadFinalizeReport({
    drive,
    parentId: process.env.DRIVE_PARENT_ID,
    workshop: ws,
    requiredCaptureFiles: schedule.pages.map((page) => `page-${page.id}.png`),
  });
  writeFileSync('/tmp/summary.md', md);

  const sheetWrite = await writeFinalizeRow({
    sheets,
    spreadsheetId: process.env.SHEETS_ID,
    stats,
  });

  await sendFinalizeNotification({
    webhook: process.env.DISCORD_WEBHOOK,
    status,
    workshop: stats.workshop,
    markdown: md,
  });
  console.log(JSON.stringify({ status, workshop: stats.workshop, sheetWrite, summaryPath: '/tmp/summary.md' }));
  if (status === 'issue') process.exitCode = 2;
}
