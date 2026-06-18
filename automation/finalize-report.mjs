import { fileURLToPath } from 'node:url';

function normalizeDate(d) {
  if (d instanceof Date) return d.toISOString().slice(0, 10);
  return String(d);
}

function kstDate(now, offsetDays = 0) {
  const kst = new Date(now.getTime() + 9 * 3600 * 1000 + offsetDays * 86400 * 1000);
  return kst.toISOString().slice(0, 10);
}

export function resolveWorkshop({ schedule, explicitName, now = new Date() }) {
  if (explicitName) {
    return schedule.workshops.find(w => w.name === explicitName) ?? null;
  }
  const today = kstDate(now, 0);
  const yesterday = kstDate(now, -1);
  return schedule.workshops.find(w => {
    const d = normalizeDate(w.date);
    return d === today || d === yesterday;
  }) ?? null;
}

export function buildSummaryMarkdown(stats) {
  const lines = [
    `# 워크숍 자동 아카이브 — ${stats.workshop}`,
    ``,
    `- 일자: ${stats.date}`,
    `- 캡쳐 set: ${stats.captureSets}`,
    `- 스냅샷 건수: ${stats.snapshotCount}`,
    `- 최종 표 수: ${stats.finalVotes}`,
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

// CLI mode
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { google } = await import('googleapis');
  const { writeFileSync } = await import('node:fs');
  const { loadSchedule } = await import('./lib/schedule.mjs');

  const schedule = await loadSchedule();
  const explicitName = process.env.WORKSHOP || null;
  const ws = resolveWorkshop({ schedule, explicitName });
  if (!ws) {
    console.log(JSON.stringify({ skipped: 'no workshop to finalize' }));
    process.exit(0);
  }

  const auth = new google.auth.GoogleAuth({
    credentials: JSON.parse(process.env.DRIVE_SA_JSON),
    scopes: [
      'https://www.googleapis.com/auth/drive',
      'https://www.googleapis.com/auth/spreadsheets'
    ]
  });
  const sheets = google.sheets({ version: 'v4', auth });

  // NOTE: 1차 구현 — 폴더 ID 기반 단순 카운트는 추후 verify-drive와 통합
  // Task 8 verify-drive.mjs가 evaluateCoverage 로직을 갖는다.
  // 지금은 0 placeholder. RUNBOOK D-30에서 실제 카운트 wiring 필요.
  const stats = {
    workshop: ws.name,
    date: normalizeDate(ws.date),
    captureSets: 0,
    snapshotCount: 0,
    finalVotes: 0,
    expectedSets: 108
  };
  const md = buildSummaryMarkdown(stats);
  writeFileSync('/tmp/summary.md', md);

  await sheets.spreadsheets.values.append({
    spreadsheetId: process.env.SHEETS_ID,
    range: '워크숍_아카이브!A:E',
    valueInputOption: 'RAW',
    requestBody: {
      values: [[stats.date, stats.workshop, stats.captureSets, stats.snapshotCount, stats.finalVotes]]
    }
  });

  const webhook = process.env.DISCORD_WEBHOOK;
  if (webhook) {
    await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: `✅ finalize: ${stats.workshop}\n\`\`\`\n${md}\n\`\`\`` })
    });
  }
  console.log(JSON.stringify({ workshop: stats.workshop, summaryPath: '/tmp/summary.md' }));
}
