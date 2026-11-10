// 부천 100인 공론장 — 세션1 질문 화면(카톡 브리지 → 본부 2번 화면) 점검.
//   python3 -m http.server 8765 --directory public  (별도 창)
//   BF_HQ_KEY=<키> BF_OUT=<스크린샷 폴더> PUPPETEER=<puppeteer-core 경로> node scripts/bucheon-questions-check.mjs
// 운영 DB 에 10개 조 시험 질문을 넣고 끝에 지운다. 이미 질문이 있으면 시작하지 않는다.
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const { default: puppeteer } = await import(pathToFileURL(process.env.PUPPETEER).href);
const BASE = process.env.BF_BASE || 'http://localhost:8765/bucheon/';
const OUT = process.env.BF_OUT;
const KEY = process.env.BF_HQ_KEY;
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const API = 'https://pleyuknjnprsckssxvrh.supabase.co/rest/v1/rpc/';
const PK = 'sb_publishable_OVwo9zs5i6xl5iFykM6zJQ_GWFcf5zn';
let pass = 0, fail = 0;
const ok = (c, n, x = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${x ? '  — ' + x : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function rpc(fn, args) {
  const r = await fetch(API + fn, { method: 'POST', headers: { apikey: PK, Authorization: 'Bearer ' + PK, 'Content-Type': 'application/json' }, body: JSON.stringify(args) });
  const t = await r.text(); if (!r.ok) throw new Error(fn + ' ' + t); return t ? JSON.parse(t) : null;
}

const before = await rpc('bucheon_hq', { p_key: KEY });
if (before.questions.length) { console.log('질문이 이미 있어 시작하지 않는다'); process.exit(2); }

// 실제 길이에 가까운 질문(긴 것 2개는 150자 안팎)
const long = '[시험] 제조업 종사자가 5년 새 11% 줄었는데, 2차 계획의 산업전환 고용위기 조기대응체계는 금형·조명 같은 특화산업의 영세 하청업체 노동자까지 실제로 닿을 수 있도록 어떤 전달 경로와 예산을 생각하고 계신지 구체적으로 듣고 싶습니다.';
const texts = Array.from({ length: 10 }, (_, i) => i % 4 === 1 ? long : `[시험] ${i + 1}조 질문 — 노동안전지킴이를 소규모 사업장까지 늘리려면 인력과 예산은 어떻게 마련하나요?`);
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
const shot = (n) => page.screenshot({ path: path.join(OUT, n + '.png') });
const measure = () => page.evaluate(() => {
  const V = document.getElementById('view'), sizes = [];
  const walk = document.createTreeWalker(V, NodeFilter.SHOW_TEXT);
  let t; while ((t = walk.nextNode())) {
    if (!t.textContent.trim()) continue;
    const e = t.parentElement, r = e.getBoundingClientRect();
    if (!r.width || getComputedStyle(e).display === 'none') continue;
    sizes.push([parseFloat(getComputedStyle(e).fontSize), t.textContent.trim().slice(0, 20)]);
  }
  sizes.sort((a, b) => a[0] - b[0]);
  const clipped = [...document.querySelectorAll('.card')].filter((c) => c.scrollHeight > c.clientHeight + 1).length;
  return { min: sizes[0], over: V.scrollHeight - V.clientHeight, clipped,
           labels: [...document.querySelectorAll('.card .no')].map((e) => e.textContent) };
});

try {
  await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
  await page.goto(BASE + 'hq/?key=' + KEY, { waitUntil: 'networkidle0' });
  await sleep(800); await page.keyboard.press('2'); await sleep(400);
  ok((await page.$eval('#view', (e) => e.textContent)).includes('아직 들어온 질문이 없습니다'), '질문 0개일 때 안내');

  for (let i = 0; i < 10; i++) {
    await rpc('bucheon_feed_question', { p_key: KEY, p_team_no: i + 1, p_q: texts[i], p_event: 'ev' + i, p_sent_at: `2026-11-18T15:0${i}:00+09:00` });
    if (i === 3) { await sleep(5600); const m = await measure(); ok(m.labels.length === 4, '5초 갱신으로 들어온 4개 조가 화면에 뜸', m.labels.join(',')); }
  }
  await sleep(5600);
  let m = await measure();
  ok(m.labels.length === 10, '10개 조 카드 10장', m.labels.join(','));
  ok(m.min[0] >= 24, '최소 글자 24px 이상', `${m.min[0]}px 「${m.min[1]}」`);
  ok(m.over <= 0 && m.clipped === 0, '넘침·잘림 없음', `세로 ${m.over}px, 잘린 카드 ${m.clipped}`);
  await shot('q10');

  await rpc('bucheon_question_edit', { p_key: KEY, p_team_no: 7, p_group_lead: 3, p_hidden: false });
  await rpc('bucheon_question_edit', { p_key: KEY, p_team_no: 9, p_group_lead: null, p_hidden: true });
  await sleep(5600);
  m = await measure();
  ok(m.labels.includes('3·7조') && !m.labels.includes('7조') && !m.labels.includes('9조') && m.labels.length === 8, '묶기 3·7조, 숨긴 9조 빠짐', m.labels.join(','));
  ok(m.min[0] >= 24 && m.over <= 0 && m.clipped === 0, '묶은 뒤에도 넘침 없음', `${m.min[0]}px, 세로 ${m.over}, 잘림 ${m.clipped}`);
  await shot('q_grouped');

  // 전문가 보기(공개, 키 없음): 숨긴 9조 빠짐, 3·7조 묶음, 휴대폰 가로 넘침 없음
  const viewer = await browser.newPage();
  viewer.on('pageerror', (e) => errors.push('viewer ' + e.message));
  await viewer.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
  await viewer.goto(BASE + 'q/', { waitUntil: 'networkidle0' }); await sleep(800);
  const vl = await viewer.$$eval('.card .no', (n) => n.map((e) => e.textContent.trim()));
  ok(vl.length === 8 && vl.some((t) => t.endsWith('3·7조')) && !vl.some((t) => / 9조$/.test(t)), '전문가 보기: 숨김 빠지고 묶음 반영, 번호 매김', vl.join(' | '));
  ok(await viewer.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), '전문가 보기 390px 가로 넘침 없음');
  const vmin = await viewer.evaluate(() => Math.min(...[...document.querySelectorAll('.card *')].map((e) => parseFloat(getComputedStyle(e).fontSize))));
  ok(vmin >= 15, '전문가 보기 글자 15px 이상', vmin + 'px');
  await viewer.screenshot({ path: path.join(OUT, 'viewer_390.png'), fullPage: true });
  await viewer.emulateMediaType('print');
  await viewer.pdf({ path: path.join(OUT, 'viewer_a4.pdf'), format: 'A4' });
  await viewer.screenshot({ path: path.join(OUT, 'viewer_print.png'), fullPage: true });
  const ph = await viewer.$eval('#printhead', (e) => getComputedStyle(e).display !== 'none' && e.textContent);
  ok(ph && ph.includes('8건'), '인쇄: 머리말에 기준 시각·건수', String(ph));
  await viewer.close(); await page.bringToFront();   // 뒤로 간 탭은 크기 변경 이벤트가 늦게 돈다

  // 중복 후보: 1조와 거의 같은 글을 5조로 → 정리 모드에 「1조와 비슷」
  await rpc('bucheon_feed_question', { p_key: KEY, p_team_no: 5, p_q: '[시험] 1조 질문 — 노동안전지킴이를 소규모 사업장까지 늘리려면 인력과 예산은 어떻게 마련하나요?', p_event: 'ev5b', p_sent_at: '2026-11-18T15:20:00+09:00' });
  await sleep(5600);
  await page.keyboard.press('e'); await sleep(300);
  const ctl = await page.$$eval('.card .ctl', (c) => c.filter((x) => getComputedStyle(x).display !== 'none').length);
  ok(ctl === 10, '정리 모드(E): 조마다 조작칸, 숨긴 조도 보임', `${ctl}개`);
  const hints = await page.$$eval('.ctl', (c) => c.map((x) => x.querySelector('b').textContent + ':' + (x.querySelector('.sim') ? x.querySelector('.sim').textContent : '')));
  ok(hints.some((h) => h.startsWith('5조:1조와 비슷')), '중복 후보: 5조에 「1조와 비슷」 표시', hints.filter((h) => h.includes('비슷')).join(' | '));
  // 화면 조작으로 9조 보이기 → 1조에 묶기
  await page.evaluate(() => { const b = [...document.querySelectorAll('.ctl')].find((c) => c.querySelector('b').textContent === '9조').querySelector('button'); b.click(); });
  await sleep(1500);
  await page.evaluate(() => { const s = [...document.querySelectorAll('.ctl')].find((c) => c.querySelector('b').textContent === '9조').querySelector('select'); s.value = '1'; s.dispatchEvent(new Event('change')); });
  await sleep(1500);
  await shot('q_edit');
  await page.keyboard.press('e'); await sleep(300);
  m = await measure();
  ok(m.labels.includes('1·9조') && m.labels.includes('3·7조') && m.labels.length === 8, '화면 조작으로 보이기·묶기 반영', m.labels.join(','));
  await shot('q_after_edit');

  await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 }); await sleep(600);
  m = await measure();
  ok(m.over <= 0 && m.clipped === 0, '1280×720 에서도 넘침·잘림 없음', `${m.min[0]}px, 세로 ${m.over}, 잘림 ${m.clipped}`);
  await shot('q_720');
  const seen = new Set(m.labels);
  for (let k = 0; k < 4 && seen.size < 8; k++) {
    await page.keyboard.press('ArrowRight'); await sleep(300);
    const mm = await measure(); mm.labels.forEach((l) => seen.add(l));
    ok(mm.clipped === 0 && mm.over <= 0, `1280×720 ${k + 2}쪽 잘림 없음`, mm.labels.join(','));
  }
  ok(seen.size === 8, '1280×720 쪽을 넘기면 8장 모두 보임', [...seen].join(','));
  ok(errors.length === 0, '콘솔 오류 없음', errors.slice(0, 3).join(' | '));
} finally {
  await browser.close();
  // 시험 질문 지우기: 본부 키로 숨김 해제 후 PAT 없이 지울 수단이 없어 호출자가 SQL 로 지운다
  console.log('정리 필요: delete from public.bucheon_question where src_event like \'ev%\';');
}
console.log(`\n합계 PASS ${pass} / FAIL ${fail}`);
process.exit(fail ? 1 : 0);
