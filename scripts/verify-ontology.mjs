/**
 * 온톨로지 검증 — **종류 배정이 서버까지 가는지 네트워크로 확인한다.**
 *
 * ── 왜 화면만 보면 안 되나 ───────────────────────────────────────────
 * 종류 배정은 화면을 먼저 바꾸고 서버에 보낸다. 그래서 서버 호출이 통째로 죽어도
 * **카드에는 배지가 붙는다.** 실제로 그랬다 — toggleNoteKind 의 의존성이 []라
 * 첫 렌더의 board(=null)를 영원히 붙잡아 저장 RPC가 한 번도 안 불렸는데,
 * 화면상으로는 완벽히 정상이었다. 새로고침해야만 사라진 걸 안다.
 *
 * 그래서 이 파일은 **버튼을 누른 뒤 hq_submission_kind_assign 요청이 실제로 나갔는지**
 * 를 센다. 그리고 새로고침해서 되살아나는지까지 본다. 둘 다 통과해야 저장이 산 것이다.
 *
 * ★ 반드시 /hq 실경로로 한다. submission-lab 은 token 을 주지 않아 이 결함을
 *   구조적으로 재현할 수 없다 — 랩 통과를 /hq 통과로 옮겨 읽으면 안 된다.
 *
 * 사용법
 *   node scripts/verify-ontology.mjs --base=http://localhost:4509 \
 *        --operator=박진환 --password=0000
 */
import { chromium } from '../automation/node_modules/playwright/index.mjs';

const argv = process.argv.slice(2);
const arg = (name, fallback = '') => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const BASE = arg('base', 'http://localhost:4509');
const OPERATOR = arg('operator');
const PASSWORD = arg('password');

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

async function login(page) {
  await page.goto(`${BASE}/hq`, { waitUntil: 'networkidle' });
  await page.waitForSelector('input[autocomplete="name"]', { timeout: 20_000 });
  await page.fill('input[autocomplete="name"]', OPERATOR);
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForSelector('[data-testid="team-overlap-panel"]', { timeout: 25_000 });
}

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
try {
  const page = await context.newPage();

  // 저장 RPC 요청만 센다.
  const calls = [];
  page.on('request', (r) => {
    if (r.url().includes('/rest/v1/rpc/hq_submission_kind_assign')) calls.push(r.url());
  });

  await login(page);
  check('본부 로그인', true, OPERATOR);

  await page.click('[data-testid="ontology-view-toggle"]');
  await page.waitForTimeout(900);
  const counter = await page.locator('[data-testid="ontology-kind-counter"]').count();
  check('온톨로지 관점이 켜진다', counter > 0, `카운터 ${counter}개`);

  const buttons = page.locator('[data-testid="ontology-kind-buttons"]');
  const groups = await buttons.count();
  check('종류 버튼이 카드마다 붙는다', groups > 0, `${groups}장`);

  if (groups > 0) {
    const before = calls.length;
    await buttons.first().locator('button[data-kind="Issue"]').click();
    await page.waitForTimeout(2_500);

    // ★ 이 한 줄이 「화면만 바뀐 것」과 「서버까지 간 것」을 가른다.
    check(
      '★ 종류를 붙이면 저장 RPC가 실제로 나간다',
      calls.length - before === 1,
      `요청 ${calls.length - before}건 (0=미저장 · 2=중복호출)`,
    );

    const badge = await page.locator('[data-testid="ontology-kind-badge"][data-kind="Issue"]').count();
    check('카드에 종류 배지가 붙는다', badge > 0, `${badge}개`);

    // ★ 새로고침 생존 — 저장·복원이 함께 살아야 통과
    await page.reload({ waitUntil: 'networkidle' });
    const survived = await page
      .waitForSelector('[data-testid="team-overlap-panel"]', { timeout: 25_000 })
      .then(() => true)
      .catch(() => false);
    if (survived) {
      await page.click('[data-testid="ontology-view-toggle"]');
      await page.waitForTimeout(1_500);
      const after = await page.locator('[data-testid="ontology-kind-badge"][data-kind="Issue"]').count();
      check('★ 새로고침해도 종류가 남아 있다', after > 0, `${after}개`);

      // 정리 — 같은 버튼을 다시 눌러 해제 사건을 남긴다.
      // ⚠️ 지우지 않는다. 이 표는 append-only 감사 이력이라 해제도 한 줄로 남겨야 한다.
      const again = page.locator('[data-testid="ontology-kind-buttons"]');
      if ((await again.count()) > 0) {
        await again.first().locator('button[data-kind="Issue"]').click();
        await page.waitForTimeout(2_000);
      }
      const cleared = await page.locator('[data-testid="ontology-kind-badge"][data-kind="Issue"]').count();
      check('정리 — 시험으로 붙인 종류를 해제했다', cleared === 0, `남은 배지 ${cleared}개`);
    } else {
      check('★ 새로고침해도 종류가 남아 있다', false, '보드가 다시 뜨지 않았다');
    }
  }
} finally {
  await context.close();
  await browser.close();
}

const failed = results.filter((r) => !r.ok).length;
console.log('\n' + '─'.repeat(60));
console.log(`합계 ${results.length}건 · 통과 ${results.length - failed} · 실패 ${failed}`);
process.exit(failed === 0 ? 0 : 1);
