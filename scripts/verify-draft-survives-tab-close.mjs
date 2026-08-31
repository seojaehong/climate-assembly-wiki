/**
 * 「탭을 닫았다 다시 열어도 쓰던 글이 남는가」 드라이런 — 실화면(US-003).
 *
 *   (터미널 1) npm run dev
 *   (터미널 2) node scripts/verify-draft-survives-tab-close.mjs
 *
 * 왜 실화면인가
 *   초안 보관 계층(submission-draft-store)은 단위 시험으로 다 덮이지만, **배선**은
 *   화면에서만 드러난다. 8.29에 글이 날아간 경로가 정확히 「탭을 닫았다」이므로
 *   그 동작을 브라우저에서 그대로 재현한다 — `page.close()` 로 탭을 없애고 새 탭으로 다시 연다.
 *   `sessionStorage` 는 탭과 함께 죽고 `localStorage` 는 산다. 그 차이가 이 story 다.
 *
 * 운영 DB 무접촉
 *   조 화면은 접속코드 뒤라 실계정으로 열면 topic_list·submission_get 이 운영 DB 로 나간다.
 *   그래서 픽스처 라우트(`/ko/moderator/insights/submission-panel-lab`)를 쓴다.
 *   Supabase 로 나가는 요청 수를 세어 0건임을 증명한다.
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

const KEY1 = 'climate_vote_draft:fixture:fixture-topic-1';
const KEY2 = 'climate_vote_draft:fixture:fixture-topic-2';
const STALE_KEY = 'climate_vote_draft:fixture:지난회차';
const TYPED = `탭을 닫아도 남아야 하는 글 ${Date.now()}`;
const OLD_SHAPE = '배포 이전 sessionStorage 초안';

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

mkdirSync(SHOTS, { recursive: true });
const browser = await chromium.launch({ headless: !HEADED });
/** 탭을 닫아도 사는 것을 보려면 **컨텍스트는 유지**해야 한다(localStorage 는 컨텍스트에 붙는다). */
const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
/**
 * ★ Supabase 로 나가는 요청은 **세는 것이 아니라 막는다.**
 *   이 브랜치는 운영 DB 에 읽기도 보내지 않는 것이 규칙이라, 픽스처 배선에 구멍이
 *   생겨도 실제 요청이 나가지 않게 여기서 끊는다. 센 숫자는 아래 검사에서 0건이어야 한다
 *   (2026-09-01 실제로 인쇄 문서 사전 준비가 submission_get 을 불러 4건이 새어 나갔다).
 */
let rpcCalls = 0;
const leaked = [];
await context.route('**/rest/v1/**', async (route) => {
  rpcCalls += 1;
  leaked.push(route.request().url().replace(/^https?:\/\/[^/]+/, ''));
  await route.abort();
});

const openTab = async () => {
  const page = await context.newPage();
  await page.goto(URL_LAB, { waitUntil: 'networkidle' });
  await page.waitForSelector('textarea', { timeout: 20_000 });
  await page.waitForTimeout(800);
  return page;
};

try {
  console.log(`\n초안 탭-종료 생존 드라이런 · ${URL_LAB} · 운영 DB 무접촉\n`);

  let page = await openTab();

  await check('픽스처 라우트 진입 · 편집 칸이 보인다', async () => {
    const n = await page.locator('textarea').count();
    must(n > 0, '편집 칸이 하나도 없다');
    return `칸 ${n}개`;
  });

  await check('★ 만료 초안은 패널이 뜰 때 지워진다 (72h 초과)', async () => {
    const stale = JSON.stringify({ v: 1, rows: [{ name: '', content: '지난 회차', rationale: '' }], savedAtMs: Date.now() - 73 * 3600 * 1000, baseUpdatedAt: null });
    const fresh = JSON.stringify({ v: 1, rows: [{ name: '', content: '이번 회차', rationale: '' }], savedAtMs: Date.now(), baseUpdatedAt: null });
    await page.evaluate(([k1, v1, k2, v2]) => {
      localStorage.setItem(k1, v1);
      localStorage.setItem(k2, v2);
    }, [STALE_KEY, stale, 'climate_vote_draft:fixture:살아있음', fresh]);
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('textarea', { timeout: 20_000 });
    await page.waitForTimeout(800);
    const after = await page.evaluate(([k1, k2]) => [localStorage.getItem(k1), localStorage.getItem(k2)], [STALE_KEY, 'climate_vote_draft:fixture:살아있음']);
    must(after[0] === null, '만료 초안이 남아 있다');
    must(after[1] !== null, '★ 살아 있는 초안까지 지웠다 — 조가 쓰던 글을 버리는 결함');
    return '만료 1건 삭제 · 생존 1건 유지';
  });

  await check('★ 저장하지 않은 글을 적으면 localStorage 에 봉투가 생긴다', async () => {
    const box = page.locator('textarea:not([readonly])').first();
    await box.click();
    await box.fill(TYPED);
    await page.waitForTimeout(700);
    const [local, session] = await page.evaluate((k) => [localStorage.getItem(k), sessionStorage.getItem(k)], KEY1);
    must(local, `localStorage 에 ${KEY1} 이 없다`);
    const env = JSON.parse(local);
    must(env.v === 1, `봉투 v 가 ${env.v}`);
    must(env.savedAtMs > 0, 'savedAtMs 가 안 박혔다');
    must(env.baseUpdatedAt === '2026-09-01T00:00:00.000Z', `baseUpdatedAt 이 ${env.baseUpdatedAt} — 서버 updated_at 이 안 실렸다`);
    must(env.rows.some((r) => r.content === TYPED), '봉투에 내가 친 글이 없다');
    must(session === null, '★ sessionStorage 에도 사본이 남았다 — 사본은 하나여야 한다');
    // 근거 사진은 **글이 보이는 자리**를 찍는다 — 첫 화면은 안내문이라 칸이 접혀 있다.
    await box.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${SHOTS}/us003-1-typed.png`, fullPage: false });
    return `v1 · baseUpdatedAt 동봉 · 사본 1개(localStorage)`;
  });

  await check('배포 이전 옛 초안(sessionStorage 배열)을 심어 둔다 — 승격 경로', async () => {
    await page.evaluate(([k, v]) => sessionStorage.setItem(k, v), [KEY2, JSON.stringify([{ content: OLD_SHAPE, rationale: '' }])]);
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('textarea', { timeout: 20_000 });
    await page.waitForTimeout(1_000);
    const values = await page.locator('textarea').evaluateAll((els) => els.map((e) => e.value));
    must(values.includes(OLD_SHAPE), '옛 모양 초안이 화면에 안 올라왔다');
    return '옛 모양(name 없음)도 그대로 열림';
  });

  await check('★★ 탭을 닫고 새 탭으로 다시 들어가도 글이 그대로 있다', async () => {
    await page.close(); // ← 여기서 sessionStorage 는 죽는다
    page = await openTab();
    await page.waitForTimeout(1_200);
    const values = await page.locator('textarea').evaluateAll((els) => els.map((e) => e.value));
    must(values.includes(TYPED), `${values.length}개 칸 어디에도 없다 — 글이 날아갔다`);
    await page.locator('textarea').filter({ hasNot: page.locator('never') }).first().scrollIntoViewIfNeeded();
    await page.evaluate((t) => {
      const el = [...document.querySelectorAll('textarea')].find((e) => e.value === t);
      el?.scrollIntoView({ block: 'center' });
    }, TYPED);
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${SHOTS}/us003-2-restored.png`, fullPage: false });
    return `칸 ${values.length}개 중 1개에 원문 그대로`;
  });

  await check('탭이 죽으면 sessionStorage 초안은 함께 죽는다 (대조군)', async () => {
    const gone = await page.evaluate((k) => sessionStorage.getItem(k), KEY2);
    must(gone === null, 'sessionStorage 가 탭을 건너 살았다 — 이 검사의 전제가 틀렸다');
    return 'localStorage 승격이 아니었으면 글도 같이 죽었다';
  });

  await check('운영 DB 에 아무것도 안 갔다', async () => {
    must(rpcCalls === 0, `Supabase 요청이 ${rpcCalls}번 시도됐다(막았다): ${leaked.join(' ')}`);
    return `Supabase 요청 시도 ${rpcCalls}건`;
  });
} finally {
  await browser.close();
  console.log(`\n결과: ${pass} PASS · ${fail} FAIL  (${pass}/${pass + fail})`);
  console.log(`스크린샷: ${SHOTS}\n`);
  process.exit(fail === 0 ? 0 : 1);
}
