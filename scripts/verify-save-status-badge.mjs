/**
 * 「지금 내 글이 저장됐는지 한눈에 보이는가」 드라이런 — 실화면(US-006).
 *
 *   (터미널 1) npm run dev
 *   (터미널 2) node scripts/verify-save-status-badge.mjs
 *
 * 왜 실화면인가
 *   `draftStatusLabel` 은 단위 시험이 다 덮는다. 여기서 볼 것은 **배선과 가시성**이다 —
 *   ① 배지가 꼭지 머리에 실제로 떠 있는가(스크롤 없이 보이는가)
 *   ② 한 글자만 쳐도 saved → unsaved 로 뒤집히는가
 *   ③ 30초 tick 이 지나도 배지가 살아 있는가
 *   ④ 글자가 16px 이상이고 hover 없이 읽히는가
 *   이 넷은 DOM 존재만으로는 판정되지 않는다.
 *
 * 운영 DB 무접촉
 *   `rest/v1` 을 **전부 가로챈다.** 통과시키는 경로가 하나도 없다
 *   (US-003 의 「세지 말고 막아라」 — 세기만 하면 구멍을 찾는 순간이 곧 접촉이다).
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';
import { chromium } from '../automation/node_modules/playwright/index.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SHOTS = resolve(HERE, '../.tmp-verify');
const argv = process.argv.slice(2);
const arg = (n, d = null) => {
  const i = argv.indexOf(`--${n}`);
  return i === -1 ? d : argv[i + 1];
};
const BASE = arg('base', 'http://localhost:4321');
const URL_LAB = `${BASE}/ko/moderator/insights/submission-panel-lab`;
const HEADED = argv.includes('--headed');

const BASE_UPDATED_AT = '2026-09-01T00:00:00.000Z';
const QUEUE1 = 'climate_vote_queue:fixture:fixture-topic-1';
/**
 * 배지에 떠야 할 시각. 픽스처 라우트가 `fixtureSubmissions` 로 `updated_at` 을 주므로
 * **불러오기는 네트워크로 나가지 않는다** — 저장이 성공해도 화면의 「저장됨 · HH:MM」은
 * 언제나 이 값이다. 기계의 표준시대에 맞춰 여기서 같은 규칙으로 계산해 둔다.
 */
const pad = (n) => String(n).padStart(2, '0');
const FIXTURE_CLOCK = (() => {
  const d = new Date(BASE_UPDATED_AT);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
})();

let pass = 0;
let fail = 0;
const check = async (label, fn) => {
  try {
    const d = await fn();
    pass += 1;
    console.log(`  PASS  ${label}${d ? ` — ${d}` : ''}`);
  } catch (e) {
    fail += 1;
    console.log(`  FAIL  ${label} — ${e.message}`);
  }
};
const must = (c, m) => {
  if (!c) throw new Error(m);
};

const server = { saveMode: 'ok', getUpdatedAt: BASE_UPDATED_AT, getItems: [] };
const calls = { submission_save: 0, submission_get: 0, other: 0 };

mkdirSync(SHOTS, { recursive: true });
const browser = await chromium.launch({ headless: !HEADED });
const context = await browser.newContext({ viewport: { width: 1280, height: 1100 } });

const json = (route, body, status = 200) =>
  route.fulfill({
    status,
    contentType: 'application/json',
    headers: { 'access-control-allow-origin': '*' },
    body: JSON.stringify(body),
  });

await context.route('**/rest/v1/**', async (route) => {
  const url = route.request().url();
  if (url.includes('/rpc/submission_save')) {
    calls.submission_save += 1;
    if (server.saveMode === 'abort') return route.abort('internetdisconnected');
    return json(route, { id: 'fixture-sub', status: 'draft', saved: 1, split: 0 });
  }
  if (url.includes('/rpc/submission_get')) {
    calls.submission_get += 1;
    return json(route, { status: 'draft', updated_at: server.getUpdatedAt, items: server.getItems });
  }
  calls.other += 1;
  return route.abort();
});

/** 입력 칸을 가진 구역만이 꼭지다 — 안내·내려받기·개발 툴바까지 세면 15개가 잡힌다. */
const topicSection = (page, n) =>
  page.locator('section').filter({ has: page.locator('textarea') }).nth(n - 1);
const badge = (page, n) => topicSection(page, n).locator('[data-save-status]').first();
const box = (page, n) => topicSection(page, n).locator('textarea').first();
const saveButton = (page, n) =>
  topicSection(page, n).getByRole('button', { name: '저장', exact: true });
const badgeText = async (page, n) =>
  (await badge(page, n).innerText()).replace(/\s+/g, ' ').trim();

try {
  console.log(`\n저장 상태 배지 드라이런 · ${URL_LAB} · 운영 DB 무접촉(전부 가로챔)\n`);
  const page = await context.newPage();
  await page.goto(URL_LAB, { waitUntil: 'networkidle' });
  await page.waitForSelector('textarea', { timeout: 20_000 });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('textarea', { timeout: 20_000 });
  await page.waitForTimeout(700);

  await check('첫 화면 — 배지가 꼭지마다 하나씩 떠 있다', async () => {
    const n = await page.locator('[data-save-status]').count();
    must(n === 2, `배지가 ${n}개다 (꼭지 2개니 2개여야 한다)`);
    const s = await badge(page, 1).getAttribute('data-save-status');
    must(s === 'saved', `첫 상태가 ${s} 다`);
    return `state=saved · "${await badgeText(page, 1)}"`;
  });

  await check('★ 배지가 스크롤 없이 첫 화면 안에 보인다 (숨은 정보가 아니다)', async () => {
    const b = badge(page, 1);
    must(await b.isVisible(), '배지가 안 보인다');
    const vp = page.viewportSize();
    // 스크롤을 맨 위로 되돌린 뒤 잰다 — 「스크롤하면 보인다」는 답이 아니다.
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(200);
    const top = await b.boundingBox();
    must(top, '배지에 상자가 없다');
    must(top.y >= 0 && top.y < vp.height, `배지가 첫 화면 밖이다 (y=${top.y})`);
    return `y=${Math.round(top.y)} / 화면높이 ${vp.height}`;
  });

  await check('본문 글자 16px 이상 · hover 없이 읽힌다', async () => {
    const info = await badge(page, 1).evaluate((el) => {
      const cs = getComputedStyle(el);
      return {
        size: parseFloat(cs.fontSize),
        opacity: parseFloat(cs.opacity),
        visibility: cs.visibility,
        title: el.getAttribute('title'),
        text: el.innerText.replace(/\s+/g, ' ').trim(),
      };
    });
    must(info.size >= 16, `글자가 ${info.size}px 다`);
    must(info.opacity === 1 && info.visibility === 'visible', 'hover 전에 감춰져 있다');
    must(!info.title, 'title 속성에만 든 정보가 있다 — 태블릿에서는 안 뜬다');
    must(info.text.length > 0, '배지에 글자가 없다');
    return `${info.size}px · opacity=${info.opacity}`;
  });

  await check('★ 타이핑하면 saved → unsaved 로 뒤집힌다', async () => {
    await box(page, 1).fill('배지가 미저장으로 바뀌어야 하는 글');
    await page.waitForTimeout(400);
    const s = await badge(page, 1).getAttribute('data-save-status');
    must(s === 'unsaved', `state 가 ${s} 다`);
    const t = await badgeText(page, 1);
    must(t.includes('저장 안 함'), `문구가 "${t}" 다`);
    must(!/\d+분째/.test(t), `1분도 안 됐는데 "${t}" — 0분째류를 내면 안 된다`);
    return `"${t}"`;
  });

  await check('다른 꼭지의 배지는 그대로다 (꼭지마다 따로 센다)', async () => {
    const s = await badge(page, 2).getAttribute('data-save-status');
    must(s === 'saved', `꼭지② 가 ${s} 로 함께 움직였다`);
    return 'topic2=saved';
  });

  await page.screenshot({ path: resolve(SHOTS, 'us006-1-unsaved.png'), fullPage: false });

  await check('★ 30초 tick 이 지나도 배지가 살아 있다 (타이머 정리 사고 방지)', async () => {
    const before = await badgeText(page, 1);
    await page.waitForTimeout(31_500);
    const s = await badge(page, 1).getAttribute('data-save-status');
    must(s === 'unsaved', `tick 뒤 state 가 ${s} 로 바뀌었다`);
    const after = await badgeText(page, 1);
    must(after.includes('저장 안 함'), `tick 뒤 문구가 "${after}" 로 깨졌다`);
    return `직전 "${before}" → tick 뒤 "${after}"`;
  });

  await check('★ 저장이 성공하면 unsaved → saved 로 돌아오고 시각이 붙는다', async () => {
    server.saveMode = 'ok';
    await saveButton(page, 1).click();
    await page.waitForTimeout(1_500);
    const s = await badge(page, 1).getAttribute('data-save-status');
    must(s === 'saved', `state 가 ${s} 다`);
    const t = await badgeText(page, 1);
    must(/저장됨 · \d{2}:\d{2}/.test(t), `문구가 "${t}" 다 — 「저장됨 · HH:MM」이어야 한다`);
    must(
      t.includes(`저장됨 · ${FIXTURE_CLOCK}`),
      `문구가 "${t}" 다 — 픽스처 시각 ${FIXTURE_CLOCK} 이어야 한다`,
    );
    return `"${t}" (픽스처 updated_at ${BASE_UPDATED_AT} → 지역시각 ${FIXTURE_CLOCK})`;
  });

  await page.screenshot({ path: resolve(SHOTS, 'us006-2-saved.png'), fullPage: false });

  await check('★ 저장 실패로 큐에 얹히면 배지가 「대기 중 · n번째 시도」로 바뀐다', async () => {
    server.saveMode = 'abort';
    await context.setOffline(true);
    await box(page, 1).fill('연결이 끊긴 채로 친 글');
    await page.waitForTimeout(400);
    await saveButton(page, 1).click();
    await page.waitForTimeout(1_500);
    const raw = await page.evaluate((k) => localStorage.getItem(k), QUEUE1);
    must(raw, '큐가 안 얹혔다');
    const s = await badge(page, 1).getAttribute('data-save-status');
    must(s === 'queued', `state 가 ${s} 다`);
    const t = await badgeText(page, 1);
    must(t.includes('대기 중 · 1번째 시도'), `문구가 "${t}" 다`);
    must(t.includes('연결되면 자동 저장'), `문구가 "${t}" 다`);
    return `"${t}"`;
  });

  await page.screenshot({ path: resolve(SHOTS, 'us006-3-queued.png'), fullPage: false });

  await check('★ 본문의 대기 안내 블록은 그대로 남아 있다 (배지가 선택지를 삼키지 않는다)', async () => {
    const body = await topicSection(page, 1).innerText();
    must(body.includes('저장하지 못한 내용이 대기 중입니다'), '대기 안내 블록이 사라졌다');
    must(body.includes('지금 다시 시도'), '「지금 다시 시도」 버튼이 사라졌다');
    return '안내 블록 + 버튼 유지';
  });

  await check('★ 연결이 돌아오면 배지가 queued → saved 로 돌아온다', async () => {
    server.saveMode = 'ok';
    server.getUpdatedAt = BASE_UPDATED_AT; // 큐의 baseUpdatedAt 과 같다 = 충돌 아님, 보낸다
    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await page.waitForTimeout(3_000);
    const s = await badge(page, 1).getAttribute('data-save-status');
    must(s === 'saved', `state 가 ${s} 다`);
    const raw = await page.evaluate((k) => localStorage.getItem(k), QUEUE1);
    must(!raw, '큐가 안 지워졌다');
    return `"${await badgeText(page, 1)}"`;
  });

  await page.screenshot({ path: resolve(SHOTS, 'us006-4-recovered.png'), fullPage: false });

  await check('운영 DB 로 나간 요청 0건 (가로채기 밖 요청 없음)', async () => {
    must(calls.other === 0, `가로채기 밖 요청 ${calls.other}건`);
    return `submission_get ${calls.submission_get} · submission_save ${calls.submission_save} · 전부 지어낸 응답`;
  });
} finally {
  await context.close();
  await browser.close();
}

console.log(`\n  ${pass} PASS / ${fail} FAIL`);
console.log(`  사진: ${SHOTS}\n`);
// ★ 검사를 한 건도 못 돌았으면 실패다. dev 서버가 안 떠 있으면 「0 PASS / 0 FAIL」로
//   조용히 exit 0 이 된다 — 아무것도 안 잰 것을 통과로 읽으면 안 된다.
if (pass + fail === 0) {
  console.error(`  FAIL: 검사를 한 건도 돌지 못했다 — ${URL_LAB} 이 뜨는지 확인하라(npx astro dev --port 4321).\n`);
  process.exit(1);
}
process.exit(fail === 0 ? 0 : 1);
