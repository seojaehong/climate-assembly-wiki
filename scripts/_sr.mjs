import { chromium } from '../automation/node_modules/playwright/index.mjs';
const b = await chromium.launch({ headless: true });
const p = await b.newPage({ viewport: { width: 1100, height: 1400 }, deviceScaleFactor: 1 });
await p.goto('file://' + 'C:/Users/iceam/OneDrive/_30_컨설팅/2026/기후회의모더레이터/10_작업산출물/2026-08-29_산출물_백업' + '/분석보고서_0829.html', { waitUntil: 'networkidle' });
await p.waitForTimeout(800);
const h = await p.evaluate(() => document.documentElement.scrollHeight);
console.log('문서 높이', h, 'px');
// 넘침·겹침 점검
const bad = await p.evaluate(() => {
  const over = [...document.querySelectorAll('table,figure,svg,p,h2,h3')]
    .filter(e => e.scrollWidth > e.clientWidth + 2).length;
  const hoz = document.documentElement.scrollWidth > document.documentElement.clientWidth + 2;
  return { over, hoz, svgs: document.querySelectorAll('svg.chart').length,
           figs: document.querySelectorAll('figure').length };
});
console.log(JSON.stringify(bad));
for (const [i, y] of [3300, 4300].entries()) {
  await p.evaluate(v => window.scrollTo(0, v), y);
  await p.waitForTimeout(250);
  await p.screenshot({ path: `../../10_작업산출물/2026-08-29_산출물_백업/rep-${i}.png` });
}
await b.close();
