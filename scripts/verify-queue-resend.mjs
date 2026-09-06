/**
 * 「저장이 실패해도 연결되면 자동으로 다시 올라가는가」 드라이런 — 실화면(US-005).
 *
 *   (터미널 1) npm run dev
 *   (터미널 2) node scripts/verify-queue-resend.mjs
 *
 * 왜 실화면인가
 *   큐 자료구조(submission-queue)는 단위 시험으로 다 덮이지만, **배선**은 화면에서만
 *   드러난다. 오프라인에서 저장 버튼을 누르고, 연결이 돌아오는 순간 `online` 이벤트가
 *   워커를 깨워 실제로 다시 보내는지 — 그 사슬은 브라우저에서만 확인된다.
 *
 * 운영 DB 무접촉
 *   `**\/rest/v1/**` 을 **전부 가로챈다.** 통과시키는 경로가 하나도 없다. 화면이 부르는
 *   submission_get·submission_save 는 이 스크립트가 지어낸 응답으로만 답한다
 *   (2026-09-01 에 인쇄 문서 사전 준비가 운영 DB 로 읽기를 보낸 사고가 있었다).
 *   꼭지·초기 제출물은 픽스처 라우트가 준다(/ko/moderator/insights/submission-panel-lab).
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

/** 픽스처 라우트가 topic-1 에 실어 둔 서버 updated_at. 큐의 baseUpdatedAt 이 된다. */
const BASE_UPDATED_AT = '2026-09-01T00:00:00.000Z';
const DRAFT1 = 'climate_vote_draft:fixture:fixture-topic-1';
const QUEUE1 = 'climate_vote_queue:fixture:fixture-topic-1';
const QUEUE2 = 'climate_vote_queue:fixture:fixture-topic-2';
const TYPED = `오프라인에서 친 글 ${Date.now()}`;

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

/** 가로챈 RPC 가 어떻게 답할지 — 검사마다 여기를 바꾼다. */
const server = {
  /** 'abort' = 연결 끊김 · 'ok' = 성공 · 'finalized' = 잠긴 꼭지 */
  saveMode: 'abort',
  /** submission_get 이 돌려줄 updated_at. 큐의 baseUpdatedAt 과 다르면 충돌이다. */
  getUpdatedAt: BASE_UPDATED_AT,
  getItems: [],
  getMode: 'ok',
};
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
    if (server.saveMode === 'finalized') {
      return json(
        route,
        { code: 'P0001', details: null, hint: null, message: 'submission is finalized — reopen required (hq)' },
        400,
      );
    }
    return json(route, { id: 'fixture-sub', status: 'draft', saved: 1, split: 0 });
  }
  if (url.includes('/rpc/submission_get')) {
    calls.submission_get += 1;
    if (server.getMode === 'abort') return route.abort('internetdisconnected');
    return json(route, { status: 'draft', updated_at: server.getUpdatedAt, items: server.getItems });
  }
  calls.other += 1;
  return route.abort();
});

const openTab = async () => {
  const page = await context.newPage();
  await page.goto(URL_LAB, { waitUntil: 'networkidle' });
  await page.waitForSelector('textarea', { timeout: 20_000 });
  await page.waitForTimeout(600);
  return page;
};
const readKey = (page, key) => page.evaluate((k) => localStorage.getItem(k), key);
/**
 * 꼭지 n(1-based)의 구역.
 *
 * ★ `section` 을 그냥 세면 안 된다 — 첫 구역은 「작성 안내」이고 뒤에는 내려받기·
 *   본부 미리보기·Astro 개발 툴바까지 섞여 15개가 잡힌다. 입력 칸을 가진 구역만 고른다.
 */
const topicSection = (page, n) =>
  page.locator('section').filter({ has: page.locator('textarea') }).nth(n - 1);
const box = (page, n) => topicSection(page, n).locator('textarea').first();
const saveButton = (page, n) => topicSection(page, n).getByRole('button', { name: '저장', exact: true });

try {
  console.log(`\n재전송 큐 배선 드라이런 · ${URL_LAB} · 운영 DB 무접촉(전부 가로챔)\n`);
  const page = await openTab();
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('textarea', { timeout: 20_000 });
  await page.waitForTimeout(600);

  await check('오프라인에서 저장하면 큐에 얹히고 「대기 중」이 뜬다', async () => {
    server.saveMode = 'abort';
    await context.setOffline(true);
    await box(page, 1).fill(TYPED);
    await page.waitForTimeout(500);
    await saveButton(page, 1).click();
    await page.waitForTimeout(1_200);
    const raw = await readKey(page, QUEUE1);
    must(raw, `${QUEUE1} 이 없다 — 큐에 안 얹혔다`);
    const q = JSON.parse(raw);
    must(q.v === 1 && q.attempts === 1, `봉투가 이상하다: ${raw.slice(0, 120)}`);
    must(q.baseUpdatedAt === BASE_UPDATED_AT, `baseUpdatedAt 이 ${q.baseUpdatedAt}`);
    must(q.items.some((i) => i.content.includes(TYPED)), '큐에 내가 친 글이 없다');
    const notice = page.getByText('저장하지 못한 내용이 대기 중입니다', { exact: false });
    must(await notice.count(), '「대기 중」 안내가 화면에 없다');
    await notice.first().scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${SHOTS}/us005-1-queued.png` });
    return `attempts=1 · baseUpdatedAt 동봉 · 안내 노출`;
  });

  await check('★ 오프라인 동안에는 재전송을 시도조차 하지 않는다', async () => {
    const before = calls.submission_get;
    await page.waitForTimeout(6_000); // 첫 백오프(5초)를 넘긴다
    must(
      calls.submission_get === before,
      `오프라인인데 submission_get 이 ${calls.submission_get - before}번 나갔다 — 실패 횟수만 태운다`,
    );
    return `백오프 5초를 넘겨도 시도 0건`;
  });

  await check('★★ 연결이 돌아오면 자동으로 다시 보낸다 (online 이벤트)', async () => {
    server.saveMode = 'ok';
    server.getUpdatedAt = BASE_UPDATED_AT; // 큐의 base 와 같다 → send
    const beforeSave = calls.submission_save;
    await context.setOffline(false); // 페이지에 'online' 이벤트가 실제로 발생한다
    await page.waitForTimeout(2_500);
    must(calls.submission_get > 0, 'submission_get 을 안 불렀다 — 대조 없이 보내면 안 된다');
    must(calls.submission_save > beforeSave, 'submission_save 를 다시 안 보냈다');
    must((await readKey(page, QUEUE1)) === null, '보냈는데 큐가 안 지워졌다 — 다음에 또 보낸다');
    must((await readKey(page, DRAFT1)) === null, '초안이 안 지워졌다');
    const toast = page.getByText('연결이 돌아와 자동으로 저장했습니다', { exact: false });
    must(await toast.count(), '조에게 알리지 않았다');
    await page.screenshot({ path: `${SHOTS}/us005-2-resent.png` });
    return `get 1 → 대조 send → save 1 → 큐·초안 삭제 · 조에게 알림`;
  });

  await check('서버가 더 새것이면 보내지 않고 두 선택지를 낸다 (충돌)', async () => {
    server.saveMode = 'abort';
    await context.setOffline(true);
    await box(page, 2).fill('두 번째 꼭지 · 충돌 시험');
    await page.waitForTimeout(500);
    await saveButton(page, 2).click();
    await page.waitForTimeout(1_000);
    must(await readKey(page, QUEUE2), '두 번째 꼭지가 큐에 안 얹혔다');
    // 그사이 다른 기기가 저장했다 — updated_at 이 큐의 base(null)와 다르다
    server.getUpdatedAt = '2026-09-01T09:30:00.000Z';
    server.getItems = [
      { ordinal: 1, kind: 'core', content: '(다른조) 다른 기기에서 저장된 문장', rationale: null },
    ];
    server.saveMode = 'ok';
    const beforeSave = calls.submission_save;
    await context.setOffline(false);
    await page.waitForTimeout(2_500);
    must(calls.submission_save === beforeSave, '★ 충돌인데 보냈다 — 남의 글을 조용히 덮었다');
    must(await readKey(page, QUEUE2), '충돌인데 큐를 버렸다');
    const alert = page.getByText('다른 기기에서 이 꼭지를 먼저 저장했습니다', { exact: false });
    must(await alert.count(), '충돌 안내가 없다');
    const over = page.getByRole('button', { name: '내 내용으로 덮어쓰기' });
    const view = page.getByRole('button', { name: '서버 내용 보기' });
    must((await over.count()) === 1 && (await view.count()) === 1, '선택지 두 개가 다 있어야 한다');
    await alert.first().scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${SHOTS}/us005-3-conflict.png` });
    return `전송 0건 · 선택지 2개(기본 선택 없음)`;
  });

  await check('「서버 내용 보기」는 서버 문장을 보기 전용으로 펼친다', async () => {
    await page.getByRole('button', { name: '서버 내용 보기' }).click();
    await page.waitForTimeout(400);
    const shown = page.getByText('다른 기기에서 저장된 문장', { exact: false });
    must(await shown.count(), '서버 내용이 안 보인다');
    must(await readKey(page, QUEUE2), '보기만 했는데 큐가 사라졌다');
    await shown.first().scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${SHOTS}/us005-4-server-view.png` });
    return `서버 1줄 노출 · 큐는 보류 유지`;
  });

  await check('「내 내용으로 덮어쓰기」를 고르면 그때 보낸다', async () => {
    const beforeSave = calls.submission_save;
    await page.getByRole('button', { name: '내 내용으로 덮어쓰기' }).click();
    await page.waitForTimeout(1_500);
    must(calls.submission_save === beforeSave + 1, '덮어쓰기를 눌렀는데 안 보냈다');
    must((await readKey(page, QUEUE2)) === null, '보냈는데 큐가 남았다');
    return `save 1건 · 큐 삭제`;
  });

  await check('★ 잠긴 꼭지의 실패는 큐에 넣지 않는다 (재시도해도 같은 결과)', async () => {
    server.saveMode = 'finalized';
    await box(page, 1).fill('잠긴 꼭지에 쓴 글');
    await page.waitForTimeout(400);
    await saveButton(page, 1).click();
    await page.waitForTimeout(1_200);
    must((await readKey(page, QUEUE1)) === null, '★ finalized 를 큐에 넣었다 — 영원히 두드린다');
    const toast = page.getByText('이미 제출 완료된 상태입니다', { exact: false });
    must(await toast.count(), 'finalized 안내가 안 떴다');
    return `큐 0건 · 기존 토스트 유지`;
  });

  await check('큐가 빈 뒤에는 타이머·리스너가 아무 요청도 안 낸다', async () => {
    await context.setOffline(false);
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('textarea', { timeout: 20_000 });
    const before = calls.submission_get + calls.submission_save;
    await page.waitForTimeout(6_000);
    const after = calls.submission_get + calls.submission_save;
    must(after === before, `큐가 없는데 ${after - before}건이 나갔다`);
    return `6초 대기 중 요청 0건`;
  });

  await check('운영 DB 로 나간 요청이 0건이다 (전부 가로챘다)', async () => {
    must(calls.other === 0, `가로채기 밖 요청 ${calls.other}건`);
    return `가로챈 RPC: submission_get ${calls.submission_get} · submission_save ${calls.submission_save} · 그 밖 0`;
  });
} finally {
  await browser.close();
  console.log(`\n결과: ${pass} PASS · ${fail} FAIL  (${pass}/${pass + fail})`);
  console.log(`스크린샷: ${SHOTS}\n`);
  // ★ 검사를 한 건도 못 돌았으면 실패다. dev 서버가 안 떠 있으면 try 가 초반에 던지고
  //   fail 이 0 인 채로 여기 와서 「0 PASS · 0 FAIL」로 조용히 exit 0 이 된다.
  if (pass + fail === 0) {
    console.error(`FAIL: 검사를 한 건도 돌지 못했다 — ${URL_LAB} 이 뜨는지 확인하라(npx astro dev --port 4321).\n`);
    process.exit(1);
  }
  process.exit(fail === 0 ? 0 : 1);
}
