/**
 * 「회차를 넘겼는데 아직 개통 안 했을 때 본부 화면이 무엇을 말하는가」 드라이런 — 실화면.
 *
 *   (터미널 1) npm run dev
 *   (터미널 2) node scripts/verify-hq-session-open.mjs
 *
 * 왜 필요한가
 *   `CURRENT_SESSION_SLUG` 를 9.12 로 넘기면 개통 SQL 을 적용하기 전까지 `hq_submissions`
 *   가 **행 0개**를 준다. 예전 화면은 그때 「아직 열린 토론 주제가 없습니다」 한 줄만 냈다 —
 *   본부가 그 화면에서 「무엇을 안 한 것인지」를 알 수 없었다.
 *
 * 무엇을 보나
 *   ① 행 0개일 때 「개통되지 않았다」 안내가 뜨고 **어느 세션인지**가 화면에 있다
 *   ② 그 안내가 원인을 하나로 단정하지 않는다(세션 미개통 · 꼭지 미개방 둘 다 적는다)
 *   ③ ★ 그 화면에 `<article>` 이 하나도 없다 — 포스트잇이 `<article>` 이라 새 UI 가
 *      그것을 내면 카드 수를 세는 다른 검증들이 조용히 틀린다
 *   ④ ★ 행이 있으면 **예전과 똑같이** 보드가 그려진다(카드 수 감소 금지 불변식)
 *   ⑤ 운영 DB 접촉 0건 — HTTP 는 전부 가로채고 WebSocket 은 무동작 스텁으로 바꾼다
 *      (verify-hq-deadline.mjs 와 같은 방식. Realtime 은 route 로 못 막는다)
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, readFileSync } from 'node:fs';
import { chromium } from '../automation/node_modules/playwright/index.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SHOTS = resolve(HERE, '../.tmp-verify');
const FIXTURE = resolve(HERE, '../automation/fixtures/0829-submissions.json');
const argv = process.argv.slice(2);
const arg = (n, d = null) => {
  const i = argv.indexOf(`--${n}`);
  return i === -1 ? d : argv[i + 1];
};
const BASE = arg('base', 'http://localhost:4321');
const URL_HQ = `${BASE}/hq`;
const HEADED = argv.includes('--headed');

const HQ_TOKEN_KEY = 'climate_vote_hq_attendance_token';
const HQ_ACTOR_KEY = 'climate_vote_hq_gate_actor';
const TOKEN = 'verify-hq-token-session-open';

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

// 픽스처 실측값 — 임계치가 아니라 **파일에서 지금 센 수**를 기대값으로 쓴다.
const FIXTURE_ROWS = JSON.parse(readFileSync(FIXTURE, 'utf8'));
const TOPIC_ID = 'topic-0829-1';
const CARDS_TOPIC1 = FIXTURE_ROWS.filter(
  (r) => r.topic_id === TOPIC_ID && (r.item_content ?? '').trim()
).length;

/** 화면이 보고 있는 세션 — 소스에서 읽는다(값을 두 번 적지 않는다). */
const SESSION_SLUG = /export const CURRENT_SESSION_SLUG = '([^']+)'/.exec(
  readFileSync(resolve(HERE, '../src/lib/hq-submissions.ts'), 'utf8')
)?.[1];

const server = { rows: [] };
const calls = { hq_submissions: 0, other: 0, escaped: 0 };

mkdirSync(SHOTS, { recursive: true });
const browser = await chromium.launch({ headless: !HEADED });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });

const json = (route, body, status = 200) =>
  route.fulfill({
    status,
    contentType: 'application/json',
    headers: { 'access-control-allow-origin': '*' },
    body: JSON.stringify(body),
  });

await context.route('**/rest/v1/**', async (route) => {
  const url = route.request().url();
  if (url.includes('/rpc/hq_submissions')) {
    calls.hq_submissions += 1;
    return json(route, server.rows);
  }
  calls.other += 1;
  return json(route, []);
});
// ★ 나중에 등록한 route 가 먼저 걸린다 — rest/v1 은 fallback 으로 위 규칙에 넘긴다.
await context.route('**/*.supabase.co/**', async (route) => {
  if (route.request().url().includes('/rest/v1/')) return route.fallback();
  calls.escaped += 1;
  return route.abort();
});

await context.addInitScript(
  ({ tokenKey, actorKey, token }) => {
    try {
      sessionStorage.setItem(tokenKey, token);
      sessionStorage.setItem(actorKey, '검증');
    } catch {
      /* 스토리지가 막힌 환경 — 게이트가 떠서 아래 검사가 실패로 잡힌다 */
    }
    const attempts = [];
    class NoopSocket {
      constructor(url) {
        attempts.push(String(url));
        this.url = String(url);
        this.readyState = 0;
      }
      send() {}
      close() {
        this.readyState = 3;
      }
      addEventListener() {}
      removeEventListener() {}
      dispatchEvent() {
        return false;
      }
    }
    NoopSocket.CONNECTING = 0;
    NoopSocket.OPEN = 1;
    NoopSocket.CLOSING = 2;
    NoopSocket.CLOSED = 3;
    Object.defineProperty(window, '__wsAttempts', { value: attempts, writable: false });
    window.WebSocket = NoopSocket;
  },
  { tokenKey: HQ_TOKEN_KEY, actorKey: HQ_ACTOR_KEY, token: TOKEN }
);

const bodyText = async (page) => (await page.locator('body').innerText()).replace(/\s+/g, ' ');

try {
  console.log(`\n미개통 회차 화면 드라이런 · ${URL_HQ} · 운영 DB 무접촉\n`);
  must(SESSION_SLUG, 'CURRENT_SESSION_SLUG 를 읽지 못했습니다');
  console.log(`  화면이 보는 세션: ${SESSION_SLUG}\n`);

  // ── ① 개통 전 (행 0개) ───────────────────────────────────────
  server.rows = [];
  const page = await context.newPage();
  await page.goto(URL_HQ, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForSelector('[role="status"]', { timeout: 60_000 });
  await page.waitForTimeout(500);
  const emptyText = await bodyText(page);

  await check('행 0개면 「개통되지 않았습니다」로 알린다 (빈 화면이 아니다)', async () => {
    must(emptyText.includes('아직 개통되지 않았습니다'), `문구 없음: ${emptyText.slice(0, 160)}`);
  });
  await check('어느 세션을 보고 있는지가 화면에 있다', async () => {
    must(emptyText.includes(SESSION_SLUG), `세션 슬러그 없음: ${SESSION_SLUG}`);
    return SESSION_SLUG;
  });
  await check('원인을 하나로 단정하지 않는다 (세션 미개통 · 꼭지 미개방 둘 다)', async () => {
    must(emptyText.includes('개통 SQL'), '개통 SQL 언급 없음');
    must(emptyText.includes('꼭지'), '꼭지 언급 없음');
  });
  await check('지난 회차 산출물이 지워진 것이 아님을 함께 알린다', async () => {
    must(emptyText.includes('지워지지 않았습니다'), '안심 문구 없음');
  });
  await check('★ 이 화면에 <article> 이 하나도 없다 (포스트잇 계수 오염 금지)', async () => {
    const n = await page.locator('article').count();
    must(n === 0, `article ${n}개`);
    return 'article 0';
  });
  await page.screenshot({ path: resolve(SHOTS, 'hq-0912-not-opened.png'), fullPage: true });

  // ── ② 개통 후 (행이 오면 예전 그대로) ────────────────────────
  server.rows = FIXTURE_ROWS;
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForSelector('article', { timeout: 60_000 });
  await page.waitForTimeout(700);

  await check('★ 행이 오면 카드 수가 픽스처 그대로다 (카드 감소 금지 불변식)', async () => {
    const n = await page.locator('article').count();
    must(n === CARDS_TOPIC1, `article ${n}개 ≠ 픽스처 ${CARDS_TOPIC1}장`);
    return `${n}장`;
  });
  await check('미제출 조 표기가 살아 있다', async () => {
    const t = await bodyText(page);
    must(/개 조/.test(t), '조 진척 표기 없음');
  });
  await check('개통 안내는 사라진다', async () => {
    const t = await bodyText(page);
    must(!t.includes('아직 개통되지 않았습니다'), '개통 안내가 남아 있다');
  });
  await page.screenshot({ path: resolve(SHOTS, 'hq-0912-board-after-open.png'), fullPage: true });

  // ── ③ 운영 DB 무접촉 ────────────────────────────────────────
  await check('운영 Supabase 로 새어 나간 요청 0건', async () => {
    const ws = await page.evaluate(() => window.__wsAttempts?.length ?? -1);
    must(calls.escaped === 0, `escaped ${calls.escaped}건`);
    must(calls.hq_submissions > 0, 'hq_submissions 를 한 번도 안 불렀다(가로채기 배선 오류)');
    return `가로챈 hq_submissions ${calls.hq_submissions}회 · WS 시도 ${ws}회(전부 스텁)`;
  });

  console.log(`\n  스크린샷: ${SHOTS}`);
} finally {
  await browser.close();
}

console.log(`\n결과: PASS ${pass} · FAIL ${fail}\n`);
process.exit(fail === 0 ? 0 : 1);
