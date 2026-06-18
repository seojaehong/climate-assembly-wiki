import { chromium } from 'playwright';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export async function capturePages({
  baseUrl,
  pages,
  outDir,
  pageTimeoutMs = 30000,
  viewport = { width: 1920, height: 1080 },
  waitUntil = 'networkidle'
}) {
  const browser = await chromium.launch();
  const success = [];
  const failed = [];
  try {
    for (const p of pages) {
      const ctx = await browser.newContext({ viewport });
      const page = await ctx.newPage();
      try {
        const url = p.path.startsWith('data:') ? p.path : `${baseUrl}${p.path}`;
        await page.goto(url, { timeout: pageTimeoutMs, waitUntil });
        const outPath = join(outDir, `page-${p.id}.png`);
        await page.screenshot({ path: outPath, fullPage: true });
        success.push({ id: p.id, outPath });
      } catch (e) {
        failed.push({ id: p.id, error: e.message });
      } finally {
        await ctx.close();
      }
    }
  } finally {
    await browser.close();
  }
  return { success, failed };
}

// CLI mode
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { loadSchedule, findActiveWorkshop } = await import('./lib/schedule.mjs');
  const { mkdirSync } = await import('node:fs');
  const schedule = await loadSchedule();
  const ws = findActiveWorkshop(schedule);
  if (!ws) {
    console.log(JSON.stringify({ skipped: 'not in workshop window' }));
    process.exit(0);
  }
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
  const outDir = `/tmp/${ws.name}/${ts}`;
  mkdirSync(outDir, { recursive: true });
  const result = await capturePages({ baseUrl: schedule.base_url, pages: schedule.pages, outDir });
  console.log(JSON.stringify({ workshop: ws.name, ts, outDir, ...result }));
  if (result.success.length === 0) process.exit(1);
}
