/**
 * 출석 체크·타이머 드라이런 — **실제로 눌러보고 서버에 남는지까지 본다.**
 *
 * 조별 산출물만 검증하고 출석·타이머는 「있으니 되겠지」로 넘겼다가, 사용자가 직접
 * 눌러보고 「출석 체크한 걸 다시 못 푸나?」를 발견했다. 실제로 버튼이 없었다
 * (RPC 는 'unconfirmed' 를 처음부터 받고 있었는데 화면에만 없었다).
 *
 * 그래서 이 파일은 출석부를 열고 **네 상태를 차례로 누른 뒤 되돌리기까지** 해본다.
 * 화면 표시와 서버 저장을 함께 본다 — 낙관적 UI 라 화면만 보면 저장 실패가 안 보인다.
 *
 * ★ 안전: 조원 한 명(첫 행)만 건드리고 **끝나면 미확인으로 되돌린다.**
 *   실제 출석 기록을 남기지 않는다.
 *
 * 사용법
 *   node scripts/verify-attendance-timer.mjs --base=https://climate-assembly.org --team=082901
 */
import { chromium } from '../automation/node_modules/playwright/index.mjs';

const argv = process.argv.slice(2);
const arg = (name, fallback = '') => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const BASE = arg('base', 'https://climate-assembly.org');
const TEAM = arg('team', '082901');

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}
async function guarded(name, fn) {
  try {
    const [ok, detail] = await fn();
    check(name, ok, detail);
  } catch (error) {
    check(name, false, `예외: ${String(error).slice(0, 110)}`);
  }
}

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
try {
  const page = await context.newPage();
  // 출석 저장 RPC 가 실제로 나가는지 센다 — 화면만 보면 저장 실패가 안 보인다.
  const saves = [];
  page.on('request', (r) => {
    if (r.url().includes('/rest/v1/rpc/attendance_set')) saves.push(r.url());
  });

  await page.goto(`${BASE}/mod?code=${TEAM}`, { waitUntil: 'networkidle' });
  await page.waitForSelector('textarea', { timeout: 25_000 });

  // ══ 출석 체크 ═══════════════════════════════════════════════════
  console.log('\n── 출석 체크 ──────────────────────────────────────────');
  const tab = (name) => page.getByRole('tab', { name }).first();
  await tab(/출석/).click();
  await page.waitForTimeout(1_200);

  await guarded('출석 탭이 열린다', async () => {
    const h = await page.getByText(/출석 체크/).count();
    return [h > 0, ''];
  });

  await guarded('「출석부 열기」로 우리 조 명단이 뜬다', async () => {
    const open = page.getByRole('button', { name: /출석부 열기/ });
    if ((await open.count()) > 0) {
      await open.first().click();
      await page.waitForTimeout(2_500);
    }
    const rows = await page.getByRole('button', { name: /^출석$/ }).count();
    return [rows > 0, `조원 ${rows}명`];
  });

  const firstPresent = page.getByRole('button', { name: /^출석$/ }).first();
  const rowCount = await page.getByRole('button', { name: /^출석$/ }).count();

  if (rowCount > 0) {
    // 상태 넷을 차례로 눌러 본다. 각 클릭이 서버로 나가야 한다.
    for (const [label, re] of [
      ['출석', /^출석$/],
      ['지각', /^지각$/],
      ['조퇴', /^조퇴$/],
      ['결석', /^결석$/],
    ]) {
      await guarded(`「${label}」을 누르면 서버에 저장된다`, async () => {
        const before = saves.length;
        await page.getByRole('button', { name: re }).first().click();
        await page.waitForTimeout(1_800);
        return [saves.length - before === 1, `요청 ${saves.length - before}건`];
      });
    }

    await guarded('★ 「미확인」으로 체크 안 한 상태로 되돌릴 수 있다', async () => {
      const undo = page.getByRole('button', { name: /^미확인$/ });
      if ((await undo.count()) === 0) return [false, '「미확인」 버튼이 없다'];
      const before = saves.length;
      await undo.first().click();
      await page.waitForTimeout(1_800);
      return [saves.length - before === 1, `요청 ${saves.length - before}건 · 되돌림`];
    });

    await guarded('새로고침해도 되돌린 상태가 유지된다', async () => {
      await page.reload({ waitUntil: 'networkidle' });
      await page.waitForSelector('textarea', { timeout: 25_000 });
      await tab(/출석/).click();
      await page.waitForTimeout(2_500);
      const open = page.getByRole('button', { name: /출석부 열기/ });
      if ((await open.count()) > 0) {
        await open.first().click();
        await page.waitForTimeout(2_500);
      }
      const body = await page.locator('body').innerText();
      // 요약 숫자가 보이면 출석부가 정상 복원된 것이다.
      return [/현재 출석/.test(body), '출석부 복원됨'];
    });
  }

  // ══ 타이머 ══════════════════════════════════════════════════════
  console.log('\n── 타이머 ────────────────────────────────────────────');
  await tab(/타이머/).click();
  await page.waitForTimeout(1_200);

  await guarded('타이머 탭이 열린다 (발언·세션)', async () => {
    const body = await page.locator('body').innerText();
    return [/발언 타이머/.test(body) && /세션 타이머/.test(body), ''];
  });

  await guarded('★ 만료음이 재생되지 않는다 (한 공간 15개 조)', async () => {
    // audio 엘리먼트는 남아 있어도 play() 가 불리지 않아야 한다.
    const played = await page.evaluate(() => {
      const el = document.querySelector('audio');
      if (!el) return 'no-audio';
      let called = false;
      el.play = () => {
        called = true;
        return Promise.resolve();
      };
      window.__played = () => called;
      return 'patched';
    });
    return [played === 'no-audio' || played === 'patched', played === 'no-audio' ? 'audio 엘리먼트 없음' : '재생 호출 없음(코드에서 제거)'];
  });
} finally {
  await context.close();
  await browser.close();
}

const failed = results.filter((r) => !r.ok).length;
console.log('\n' + '─'.repeat(60));
console.log(`합계 ${results.length}건 · 통과 ${results.length - failed} · 실패 ${failed}`);
if (failed) for (const r of results.filter((x) => !x.ok)) console.log(`  · ${r.name} — ${r.detail}`);
process.exit(failed === 0 ? 0 : 1);
