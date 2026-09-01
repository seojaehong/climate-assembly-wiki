/**
 * 조 산출물 내려받기 드라이런 — 워드·엑셀·줄글이 실제로 파일로 떨어지는지.
 *
 * ★ 형식마다 **새 페이지**로 연다. 한 페이지에서 연달아 누르면 앞 다운로드의
 *   잔재(busy·revokeObjectURL 경합)와 섞여 원인이 안 갈린다.
 *
 *   (터미널 1) npx astro preview --port 4331   또는  npx astro dev --port 4321
 *   (터미널 2) node scripts/verify-team-download.mjs [--base http://localhost:4331]
 */
import { chromium } from '../automation/node_modules/playwright/index.mjs';
import { mkdirSync, statSync, readFileSync } from 'node:fs';

const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > -1 ? process.argv[i + 1] : d;
};
const BASE = arg('base', 'http://localhost:4331');
const URL_LAB = `${BASE}/ko/moderator/insights/submission-panel-lab/`;
const OUT = '.tmp-verify/downloads';
mkdirSync(OUT, { recursive: true });

let pass = 0, fail = 0;
const check = async (name, fn) => {
  try { const d = await fn(); console.log(`  PASS  ${name}${d ? ' — ' + d : ''}`); pass++; }
  catch (e) { console.log(`  FAIL  ${name} — ${String(e.message).split('\n')[0]}`); fail++; }
};
const must = (c, m) => { if (!c) throw new Error(m); };

const browser = await chromium.launch();
let rpcTotal = 0;

for (const [label, ext] of [[/워드/, 'docx'], [/엑셀/, 'csv'], [/줄글/, 'txt']]) {
  await check(`${ext} — 새 페이지에서 눌러 파일이 떨어진다`, async () => {
    const ctx = await browser.newContext({ acceptDownloads: true });
    const page = await ctx.newPage();
    await page.route('**/rest/v1/**', (r) => { rpcTotal++; r.abort(); });
    await page.goto(URL_LAB, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: /내려받기/ }).first().click();
    const [dl] = await Promise.all([
      page.waitForEvent('download', { timeout: 20000 }),
      page.getByRole('button', { name: label }).first().click(),
    ]);
    const p = `${OUT}/out.${ext}`;
    await dl.saveAs(p);
    const size = statSync(p).size;
    must(size > 100, `파일이 ${size}바이트다`);
    must(dl.suggestedFilename().endsWith('.' + ext), `확장자 ${dl.suggestedFilename()}`);
    if (ext !== 'docx') {
      const t = readFileSync(p, 'utf8');
      must(t.trim().length > 30, '내용이 비었다');
    }
    await ctx.close();
    return `${dl.suggestedFilename()} · ${size}B`;
  });
}


// ── ★ 연달아 내려받기 — 실전 동선(워드 받고 이어서 엑셀) ──────────────
await check('★ 같은 페이지에서 워드 → 엑셀 → 줄글 연달아', async () => {
  const ctx = await browser.newContext({ acceptDownloads: true });
  const page = await ctx.newPage();
  await page.route('**/rest/v1/**', (r) => { rpcTotal++; r.abort(); });
  await page.goto(URL_LAB, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /내려받기/ }).first().click();
  const got = [];
  for (const [label, ext] of [[/워드/, 'docx'], [/엑셀/, 'csv'], [/줄글/, 'txt']]) {
    try {
      const [dl] = await Promise.all([
        page.waitForEvent('download', { timeout: 15000 }),
        page.getByRole('button', { name: label }).first().click(),
      ]);
      got.push(ext);
      await dl.saveAs(`${OUT}/seq.${ext}`);
    } catch {
      throw new Error(`연속 ${got.length + 1}번째(${ext})가 안 떨어졌다 — 받은 것: ${got.join(', ') || '없음'}`);
    }
  }
  await ctx.close();
  return got.join(' → ');
});

await check('운영 DB 로 나간 요청 0건', async () => {
  must(rpcTotal === 0, `${rpcTotal}건 새어 나갔다`);
  return '가로챈 요청 0';
});

await browser.close();
console.log(`\n결과: ${pass} PASS · ${fail} FAIL  (${pass}/${pass + fail})`);
if (pass + fail === 0) { console.error('FAIL: 검사를 한 건도 못 돌았다 — 서버가 떠 있는지 확인하라.'); process.exit(1); }
process.exit(fail === 0 ? 0 : 1);
