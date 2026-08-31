/**
 * 「어느 탭에 있어도 마감이 보이는가」 드라이런 — 실화면(US-010).
 *
 *   (터미널 1) npm run dev
 *   (터미널 2) node scripts/verify-deadline-banner.mjs
 *
 * 왜 픽스처 라우트가 아니라 /mod 인가
 *   이 story 의 핵심 AC 는 **마운트 위치**다 — 「탭 렌더 바깥, 탭 바 위」.
 *   미리보기 라우트(submission-panel-lab)는 탭 바 자체가 없어 그 사실을 재지 못한다.
 *   그래서 조가 실제로 여는 `/mod?code=…` 를 열되, `rest/v1` 을 **전부 가로채** 지어낸
 *   응답만 준다(`mod_join` 까지 지어낸다). 운영 DB 로 나가는 요청은 0건이다.
 *   AC 문구가 지목한 submission-lab 은 본부 보드라 조 화면이 아니다(US-003·US-006 에서 확인).
 *
 * 무엇을 보나 — DOM 존재만으로는 판정되지 않는 것들
 *   ① 배너가 탭 바 **앞**에 있고, 탭을 옮겨도 사라지지 않는가
 *   ② 마감이 없으면 **아예 안 그리는가**(빈 껍데기 금지)
 *   ③ 1초 tick 이 실제로 도는가(잔여가 줄어드는가)
 *   ④ calm→notice→warn 이 눈앞에서 바뀌는가(색까지)
 *   ⑤ 그 꼭지에 미저장이 생기면 warn 문구에 저장 안내가 붙는가
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
const URL_MOD = `${BASE}/mod?code=082901`;
const HEADED = argv.includes('--headed');

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

/**
 * 서버가 돌려줄 꼭지. `deadlineMs` 는 **지금으로부터 몇 ms 뒤**이고 응답을 만들 때
 * 절대 시각으로 굳는다. `server_now` 는 `serverSkewMs` 만큼 기울일 수 있다.
 */
const server = { topics: [], serverSkewMs: 0 };
const calls = { topic_list: 0, mod_join: 0, submission_get: 0, other: 0, escaped: 0 };

const isoAt = (msFromNow) => new Date(Date.now() + server.serverSkewMs + msFromNow).toISOString();

function topicRows() {
  const now = isoAt(0);
  return server.topics.map((t, i) => ({
    id: t.id,
    ordinal: i + 1,
    block: 'am',
    prompt: t.prompt,
    guidance: null,
    status: t.status ?? 'open',
    deadline_at: t.deadlineMs === null ? null : isoAt(t.deadlineMs),
    server_now: now,
  }));
}

mkdirSync(SHOTS, { recursive: true });
const browser = await chromium.launch({ headless: !HEADED });
const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });

const json = (route, body, status = 200) =>
  route.fulfill({
    status,
    contentType: 'application/json',
    headers: { 'access-control-allow-origin': '*' },
    body: JSON.stringify(body),
  });

// ★ 통과시키는 경로가 하나도 없다. 세는 것이 아니라 막는다(US-003 의 규칙).
await context.route('**/rest/v1/**', async (route) => {
  const url = route.request().url();
  if (url.includes('/rpc/mod_join')) {
    calls.mod_join += 1;
    return json(route, [
      { id: 'fixture-team', name: '픽스처 조', subgroup: null, join_code: '082901', capacity: 8, table_no: '1' },
    ]);
  }
  if (url.includes('/rpc/topic_list')) {
    calls.topic_list += 1;
    return json(route, topicRows());
  }
  if (url.includes('/rpc/submission_get')) {
    calls.submission_get += 1;
    return json(route, { status: 'draft', updated_at: '2026-09-01T00:00:00.000Z', items: [] });
  }
  // 그 밖의 조회(rounds·attendance 등)는 빈 배열. 화면이 죽지 않을 만큼만 준다.
  calls.other += 1;
  return json(route, []);
});
// rest/v1 밖(auth·realtime 등)으로 새는 길도 막는다.
// ★ Playwright 는 **나중에 등록한 route 를 먼저** 본다. 그래서 이 포괄 규칙이 위의
//   rest/v1 규칙을 가려 버린다 — 실제로 mod_join 까지 abort 되어 화면이 안 떴다.
//   rest/v1 은 fallback 으로 넘겨 위 규칙이 처리하게 한다.
await context.route('**/*.supabase.co/**', async (route) => {
  if (route.request().url().includes('/rest/v1/')) return route.fallback();
  calls.escaped += 1;
  return route.abort();
});

const banner = (page) => page.locator('[data-deadline-banner]');
const tier = async (page) => banner(page).getAttribute('data-deadline-banner');
const countdown = async (page) => (await page.locator('[data-deadline-countdown]').innerText()).trim();
const message = async (page) => {
  const m = page.locator('[data-deadline-message]');
  return (await m.count()) === 0 ? '' : (await m.innerText()).replace(/\s+/g, ' ').trim();
};
/**
 * 구간이 바뀔 때까지 기다린다. 고정 시간(waitForTimeout)으로 재면 dev 서버 컴파일·수화
 * 지연이 몇 초씩 들쭉날쭉해 **경계에서 흔들린다**(실측: 같은 검사가 통과/실패를 오갔다).
 * 「몇 초 안에 바뀌었나」를 세는 편이 사실에 가깝고 재현도 된다.
 */
const waitForTier = async (page, want, timeoutMs) => {
  const started = Date.now();
  for (;;) {
    const now = await tier(page);
    if (now === want) return Math.round((Date.now() - started) / 100) / 10;
    if (Date.now() - started > timeoutMs) {
      throw new Error(`${timeoutMs / 1000}초를 기다려도 ${now} 다 (잔여 ${await countdown(page)})`);
    }
    await page.waitForTimeout(400);
  }
};

const openMod = async (page) => {
  // ★ networkidle 을 기다리면 안 된다 — 조 콘솔은 라운드를 계속 폴링해 「조용해지는 순간」이
  //   오지 않는다(실측: 30초 타임아웃). 탭 바가 뜬 것을 신호로 쓴다.
  await page.goto(URL_MOD, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForSelector('[role="tablist"]', { timeout: 60_000 });
  await page.waitForTimeout(800);
};

const MIN = 60_000;

try {
  console.log(`\n마감 배너 드라이런 · ${URL_MOD} · 운영 DB 무접촉(전부 가로챔)\n`);
  const page = await context.newPage();

  // ── V5c 마감시각 미설정 ────────────────────────────────────
  server.topics = [
    { id: 'topic-1', prompt: '꼭지 하나', deadlineMs: null },
    { id: 'topic-2', prompt: '꼭지 둘', deadlineMs: null },
  ];
  await openMod(page);
  await page.evaluate(() => localStorage.clear());

  await check('★ 마감이 없으면 배너를 아예 안 그린다 (빈 껍데기 금지)', async () => {
    const n = await banner(page).count();
    must(n === 0, `배너 요소가 ${n}개 있다`);
    return '배너 요소 0개';
  });

  // ── calm: 10분 남음 ────────────────────────────────────────
  server.topics = [
    { id: 'topic-1', prompt: '꼭지 하나', deadlineMs: 40 * MIN },
    { id: 'topic-2', prompt: '꼭지 둘', deadlineMs: 10 * MIN },
  ];
  await openMod(page);

  await check('가장 임박한 꼭지 하나만 뜬다 · 10분 남으면 calm(회색)', async () => {
    must((await banner(page).count()) === 1, '배너가 1개가 아니다');
    const t = await tier(page);
    must(t === 'calm', `구간이 ${t} 다`);
    const text = (await banner(page).innerText()).replace(/\s+/g, ' ').trim();
    must(text.includes('꼭지②'), `문구가 "${text}" 다 — 임박한 꼭지②여야 한다`);
    const c = await countdown(page);
    must(/^(09|10):\d{2}$/.test(c), `잔여가 ${c} 다`);
    return `${t} · "${text}"`;
  });

  await check('★ 배너가 탭 바 **앞**에 있다 (탭 안이 아니다)', async () => {
    const order = await page.evaluate(() => {
      const b = document.querySelector('[data-deadline-banner]');
      const tabs = document.querySelector('[role="tablist"]');
      if (!b || !tabs) return null;
      // DOCUMENT_POSITION_FOLLOWING = 4 → 배너가 탭바보다 앞
      return {
        bannerFirst: Boolean(b.compareDocumentPosition(tabs) & 4),
        insideTabs: tabs.contains(b),
        y: Math.round(b.getBoundingClientRect().top),
      };
    });
    must(order, '배너나 탭바를 못 찾았다');
    must(order.bannerFirst, '배너가 탭 바 뒤에 있다');
    must(!order.insideTabs, '배너가 탭 바 안에 있다');
    must(order.y >= 0 && order.y < 400, `배너가 첫 화면 위쪽이 아니다 (y=${order.y})`);
    return `문서 순서상 배너 → 탭바 · y=${order.y}`;
  });

  await check('잔여 시간 36px 이상 tabular-nums · 본문 24px 이상 · hover 없이 읽힌다', async () => {
    const info = await page.evaluate(() => {
      const box = document.querySelector('[data-deadline-banner]');
      const time = document.querySelector('[data-deadline-countdown]');
      const cs = getComputedStyle(time);
      const labels = [...box.querySelectorAll('span')]
        .filter((el) => el !== time)
        .map((el) => parseFloat(getComputedStyle(el).fontSize));
      return {
        timeSize: parseFloat(cs.fontSize),
        numeric: cs.fontVariantNumeric,
        opacity: parseFloat(getComputedStyle(box).opacity),
        title: box.getAttribute('title'),
        minLabel: labels.length ? Math.min(...labels) : 0,
      };
    });
    must(info.timeSize >= 36, `잔여 시간이 ${info.timeSize}px 다`);
    must(info.numeric.includes('tabular-nums'), `font-variant-numeric 이 "${info.numeric}" 다`);
    must(info.minLabel >= 24, `본문 글자가 ${info.minLabel}px 다`);
    must(info.opacity === 1, 'hover 전에 감춰져 있다');
    must(!info.title, 'title 속성에만 든 정보가 있다');
    return `잔여 ${info.timeSize}px(${info.numeric}) · 본문 ${info.minLabel}px`;
  });

  await check('★ 1초 tick 이 돈다 (잔여가 실제로 줄어든다)', async () => {
    const before = await countdown(page);
    await page.waitForTimeout(2_200);
    const after = await countdown(page);
    must(before !== after, `2초가 지나도 ${before} 그대로다 — tick 이 안 돈다`);
    const toSec = (s) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3));
    must(toSec(after) < toSec(before), `${before} → ${after} 로 줄지 않았다`);
    return `${before} → ${after}`;
  });

  await page.screenshot({ path: resolve(SHOTS, 'us010-1-calm.png'), fullPage: false });

  // ── calm → notice 전환을 눈앞에서 ──────────────────────────
  server.topics = [{ id: 'topic-1', prompt: '꼭지 하나', deadlineMs: 5 * MIN + 3_000 }];
  await openMod(page);

  await check('★ calm → notice(노랑) 로 눈앞에서 바뀐다', async () => {
    const first = await tier(page);
    must(first === 'calm', `첫 구간이 ${first} 다`);
    const before = await banner(page).evaluate((el) => getComputedStyle(el).borderTopColor);
    const secs = await waitForTier(page, 'notice', 20_000);
    const after = await banner(page).evaluate((el) => getComputedStyle(el).borderTopColor);
    must(before !== after, `색이 그대로다 (${after})`);
    const msg = await message(page);
    must(msg.includes('곧 마감입니다'), `문구가 "${msg}" 다`);
    return `${secs}초 만에 calm(${before}) → notice(${after})`;
  });

  await page.screenshot({ path: resolve(SHOTS, 'us010-2-notice.png'), fullPage: false });

  // ── notice → warn 전환 + 미저장 결합 ───────────────────────
  server.topics = [{ id: 'topic-1', prompt: '꼭지 하나', deadlineMs: 3 * MIN + 5_000 }];
  await openMod(page);
  await page.waitForSelector('textarea', { timeout: 20_000 });

  await check('★ 타이핑해 미저장을 만들면 warn 문구에 저장 안내가 붙는다', async () => {
    const firstTier = await tier(page);
    must(firstTier === 'notice', `타이핑 전 구간이 ${firstTier} 다`);
    await page.locator('textarea').first().fill('마감 직전에 친 글 — 아직 저장 안 했다');
    await page.waitForTimeout(600);
    const noticeMsg = await message(page);
    must(
      !noticeMsg.includes('저장하지 않은 내용'),
      `notice 구간인데 벌써 "${noticeMsg}" — 3분 이하에서만 붙어야 한다`,
    );
    const secs = await waitForTier(page, 'warn', 20_000);
    const warnMsg = await message(page);
    must(warnMsg.includes('지금 저장하세요'), `문구가 "${warnMsg}" 다`);
    must(warnMsg.includes('저장하지 않은 내용이 있습니다'), `문구가 "${warnMsg}" 다`);
    return `${secs}초 만에 notice "${noticeMsg}" → warn "${warnMsg}"`;
  });

  await page.screenshot({ path: resolve(SHOTS, 'us010-3-warn-unsaved.png'), fullPage: false });

  await check('★ 다른 탭으로 옮겨도 배너가 그대로 보인다 (8.29 사고 그 자체)', async () => {
    await page.getByRole('tab', { name: /타이머/ }).click();
    await page.waitForTimeout(1_200);
    must((await banner(page).count()) === 1, '탭을 옮기니 배너가 사라졌다');
    must(await banner(page).isVisible(), '배너가 안 보인다');
    const t = await tier(page);
    must(t === 'warn', `구간이 ${t} 로 바뀌었다`);
    const msg = await message(page);
    must(
      msg.includes('저장하지 않은 내용이 있습니다'),
      `작성 탭을 떠나니 미저장 안내가 "${msg}" 로 사라졌다`,
    );
    const textareas = await page.locator('textarea').count();
    must(textareas === 0, '작성 탭을 안 떠났다 (textarea 가 남아 있다)');
    return `타이머 탭에서도 warn · "${msg}"`;
  });

  await page.screenshot({ path: resolve(SHOTS, 'us010-4-other-tab.png'), fullPage: false });

  // ── over ───────────────────────────────────────────────────
  server.topics = [{ id: 'topic-1', prompt: '꼭지 하나', deadlineMs: -90_000 }];
  await openMod(page);

  await check('마감이 지나면 빨강 「마감되었습니다」 · 잔여는 00:00', async () => {
    const t = await tier(page);
    must(t === 'over', `구간이 ${t} 다`);
    const c = await countdown(page);
    must(c === '00:00', `잔여가 ${c} 다`);
    const msg = await message(page);
    must(msg.includes('마감되었습니다'), `문구가 "${msg}" 다`);
    return `over · "${msg}"`;
  });

  await check('★ 마감 뒤에도 입력·저장이 잠기지 않는다 (마감은 잠금이 아니다)', async () => {
    // 앞 검사에서 타이머 탭으로 옮겼고 탭 선택은 sessionStorage 에 남는다(mod-tabs.ts:34).
    // 작성 탭으로 되돌아온 뒤에 잰다.
    await page.getByRole('tab', { name: '조별 산출물' }).click();
    await page.waitForSelector('textarea', { timeout: 20_000 });
    const box = page.locator('textarea').first();
    must(await box.isEditable(), '마감 뒤 입력칸이 잠겼다');
    await box.fill('마감 뒤에도 적을 수 있어야 한다');
    await page.waitForTimeout(400);
    const save = page.getByRole('button', { name: '저장', exact: true }).first();
    must(await save.isEnabled(), '마감 뒤 저장 버튼이 잠겼다');
    return '입력칸·저장 버튼 모두 살아 있다';
  });

  await page.screenshot({ path: resolve(SHOTS, 'us010-5-over.png'), fullPage: false });

  // ── 서버 시각이 기기와 다를 때 ─────────────────────────────
  server.serverSkewMs = 10 * MIN; // 서버가 「지금」을 기기보다 10분 뒤로 말한다
  server.topics = [{ id: 'topic-1', prompt: '꼭지 하나', deadlineMs: 4 * MIN }];
  await openMod(page);

  await check('★ 기기 시계가 10분 틀려도 서버 기준으로 센다', async () => {
    const t = await tier(page);
    const c = await countdown(page);
    must(t === 'notice', `구간이 ${t} 다 — 서버 기준 4분이면 notice 다`);
    must(/^0[34]:\d{2}$/.test(c), `잔여가 ${c} 다 — 04:00 언저리여야 한다(기기 기준이면 14:00)`);
    return `서버 +10분 · 잔여 ${c} (${t})`;
  });
  server.serverSkewMs = 0;

  await check('운영 DB 로 나간 요청 0건 (가로채기 밖 요청 없음)', async () => {
    must(calls.escaped === 0, `rest/v1 밖으로 새어 나간 요청 ${calls.escaped}건`);
    return `mod_join ${calls.mod_join} · topic_list ${calls.topic_list} · submission_get ${calls.submission_get} · 기타 ${calls.other} — 전부 지어낸 응답`;
  });
} finally {
  await context.close();
  await browser.close();
}

console.log(`\n  ${pass} PASS / ${fail} FAIL`);
console.log(`  사진: ${SHOTS}\n`);
// ★ 검사를 한 건도 못 돌았으면 실패다 — 아무것도 안 잰 것을 통과로 읽으면 안 된다.
if (pass + fail === 0) {
  console.error(`  FAIL: 검사를 한 건도 돌지 못했다 — ${URL_MOD} 이 뜨는지 확인하라(npm run dev).\n`);
  process.exit(1);
}
process.exit(fail === 0 ? 0 : 1);
