// 부천 100인 공론장 화면 점검 — 로컬 정적 서버(public/)를 헤드리스 크롬으로 연다.
//   python3 -m http.server 8765 --directory public  (별도 창)
//   BF_CODE=<조코드> BF_HQ_KEY=<키> BF_OUT=<스크린샷 폴더> PUPPETEER=<puppeteer-core 경로> node scripts/bucheon-ui-check.mjs
// 데이터는 운영 DB 를 그대로 쓴다(드라이런 시험 데이터가 들어 있는 상태에서 돌린다).
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const { default: puppeteer } = await import(pathToFileURL(process.env.PUPPETEER).href);
const BASE = process.env.BF_BASE || 'http://localhost:8765/bucheon/';
const OUT = process.env.BF_OUT;
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
let pass = 0, fail = 0;
const ok = (c, n, x = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${x ? '  — ' + x : ''}`); };

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
// 400 = 시험이 일부러 보낸 틀린 입력의 정상 거절, 404 = 로컬 서버 favicon. JS 예외(pageerror)만 결함으로 센다.
page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
const shot = (n) => page.screenshot({ path: path.join(OUT, n + '.png') });
const noHScroll = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── 휴대폰: 안내 → 조 화면 → 설문 ──
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
await page.goto(BASE, { waitUntil: 'networkidle0' });
ok(await noHScroll(), '안내 390px 가로 넘침 없음');
const cardRight = await page.evaluate(() => Math.max(...[...document.querySelectorAll('.btn')].map((b) => b.getBoundingClientRect().right)));
ok(cardRight <= 390 - 15, '안내 카드 오른쪽 여백 16px', `right=${cardRight}`);
await shot('m1_hub');

await page.goto(BASE + 't/', { waitUntil: 'networkidle0' });
await page.evaluate(() => localStorage.clear());
await page.goto(BASE + 't/', { waitUntil: 'networkidle0' });
ok(await page.$eval('#gate', (e) => !e.classList.contains('hidden')), '코드 없이 들어오면 코드 입력칸');
await page.type('#code', 'zzzzzz'); await page.click('#enter'); await sleep(1200);
ok((await page.$eval('#gateMsg', (e) => e.textContent)).includes('조 코드가 맞지 않습니다'), '틀린 코드 안내문');

await page.goto(BASE + 't/?code=' + process.env.BF_CODE, { waitUntil: 'networkidle0' });
await sleep(800);
const title = await page.$eval('#teamTitle', (e) => e.textContent);
ok(/^\d+조$/.test(title), '조 코드 링크로 입장', title);
ok(await noHScroll(), '조 화면(세션1) 390px 가로 넘침 없음');
await shot('m2_team_s1');
await page.$eval('#q1', (e) => { e.value = ''; });
await page.type('#q1', '[UI시험] 화면에서 고친 질문 1');
await page.click('#submit'); await sleep(1500);
ok((await page.$eval('#msg', (e) => e.textContent)).includes('세션1 제출 완료'), '화면에서 세션1 제출');

await page.click('#tab2'); await sleep(300);
ok(await noHScroll(), '조 화면(세션2) 390px 가로 넘침 없음');
await page.evaluate(() => [...document.querySelectorAll('.rank .ghost, .row .ghost')].find((b) => b.textContent === '처음부터').click());
await sleep(200);
// 미완성 제출 → 거절 문구
await page.click('#submit'); await sleep(1200);
ok((await page.$eval('#msg', (e) => e.textContent)).includes('모든 과제의 순위'), '순위 미완성 제출 거절 문구');
// 각 과제 시기 = 「중기」, 순위 = 아래에서 위로 누르기
const n = await page.$$eval('.seg', (s) => s.length);
for (let i = 0; i < n; i++) {
  await page.evaluate((i) => document.querySelectorAll('.seg')[i].children[1].click(), i);
}
for (let i = 0; i < n; i++) {
  await page.evaluate(() => { const u = [...document.querySelectorAll('.rank button.item')].filter((b) => !b.classList.contains('on')); u[u.length - 1].click(); });
}
const badges = await page.$$eval('.rank .badge', (b) => b.map((x) => x.textContent));
ok(badges.join(',') === Array.from({ length: n }, (_, i) => i + 1).join(','), `순위 배지 1~${n} 차례대로`);
await page.$eval('#top', (e) => { e.value = '[UI시험] 이유'; e.dispatchEvent(new Event('input')); });
await shot('m3_team_s2');
await page.click('#submit'); await sleep(1500);
ok((await page.$eval('#msg', (e) => e.textContent)).includes('세션2 제출 완료'), '화면에서 세션2 제출');
// 새로고침해도 초안·제출값 유지
await page.reload({ waitUntil: 'networkidle0' }); await sleep(800);
await page.click('#tab2'); await sleep(300);
const kept = await page.$$eval('.rank button.on', (b) => b.length);
ok(kept === n, '새로고침 뒤 순위 유지', `${kept}/${n}`);

await page.goto(BASE + 's/', { waitUntil: 'networkidle0' });
await page.evaluate(() => localStorage.removeItem('bf_survey_done'));
await page.reload({ waitUntil: 'networkidle0' });
ok(await noHScroll(), '설문 390px 가로 넘침 없음');
await page.click('#send'); await sleep(300);
ok((await page.$eval('#msg', (e) => e.textContent)).includes('1번에 답해'), '빈 설문 제출 막음');
const groups = await page.$$eval('.opts', (g) => g.length);
for (let i = 0; i < groups; i++) await page.evaluate((i) => document.querySelectorAll('.opts')[i].children[0].click(), i);
await shot('m4_survey');
await page.click('#send'); await sleep(1500);
ok((await page.$eval('main', (e) => e.textContent)).includes('감사합니다'), '설문 제출 완료 화면');

// ── 대형 화면 1920×1080 ──
await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
await page.goto(BASE + 'hq/?key=' + process.env.BF_HQ_KEY, { waitUntil: 'networkidle0' });
await sleep(1500);
for (const v of [1, 2, 3, 4]) {
  await page.keyboard.press(String(v)); await sleep(500);
  const m = await page.evaluate(() => {
    const V = document.getElementById('view');
    const sizes = [];
    const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let t; while ((t = walk.nextNode())) {
      if (!t.textContent.trim()) continue;
      const e = t.parentElement, r = e.getBoundingClientRect();
      if (!r.width || getComputedStyle(e).display === 'none') continue;
      sizes.push([parseFloat(getComputedStyle(e).fontSize), t.textContent.trim().slice(0, 20)]);
    }
    sizes.sort((a, b) => a[0] - b[0]);
    return { min: sizes[0], over: V.scrollHeight - V.clientHeight, hs: document.documentElement.scrollWidth > window.innerWidth };
  });
  ok(m.min[0] >= 24, `본부 화면 ${v}: 최소 글자 24px 이상`, `${m.min[0]}px 「${m.min[1]}」`);
  ok(m.over <= 0 && !m.hs, `본부 화면 ${v}: 넘침 없음`, `세로 초과 ${m.over}px`);
  await shot('hq' + v);
}
await page.keyboard.press('2'); await page.keyboard.press('ArrowRight'); await sleep(300);
ok((await page.$eval('.pager', (e) => e.textContent)).startsWith('2 /'), '본부 질문 화면 → 로 2쪽');
await shot('hq2b');

ok(errors.length === 0, '콘솔 오류 없음', errors.slice(0, 3).join(' | '));
await browser.close();
console.log(`\n합계 PASS ${pass} / FAIL ${fail}`);
process.exit(fail ? 1 : 0);
