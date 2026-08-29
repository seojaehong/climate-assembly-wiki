/**
 * 여러 줄 붙여넣기 분해 드라이런 — **저장하지 않는다**.
 *
 * 분해는 순수 클라이언트 상태다. 「저장」을 누르기 전에는 서버로 아무것도 가지
 * 않으므로, 붙여넣고 칸이 나뉘는 것만 보고 저장 없이 닫으면 조 데이터에
 * 손대지 않는다. 행사 중에 돌려도 안전한 이유가 이것이다.
 *
 *   node scripts/verify-paste-split.mjs --base https://climate-assembly.org --code 082901
 */
import { chromium } from '../automation/node_modules/playwright/index.mjs';

const argv = process.argv.slice(2);
const arg = (n, d = null) => {
  const i = argv.indexOf(`--${n}`);
  return i === -1 ? d : argv[i + 1];
};
const BASE = arg('base', 'http://localhost:4321');
const CODE = arg('code', '082901');
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

const LINES = [
  '드라이런 첫째 줄',
  '드라이런 둘째 줄',
  '드라이런 셋째 줄',
  '드라이런 넷째 줄',
];

const browser = await chromium.launch({ headless: !HEADED });
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });

try {
  console.log(`\n붙여넣기 분해 드라이런 · ${BASE} · 조 ${CODE} · 저장하지 않음\n`);
  await page.goto(`${BASE}/mod?code=${CODE}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3_000);

  // ★ 「편집 가능한」 칸이 있는 구역으로 좁힌다. 그냥 첫 section 을 잡으면 이미
  // 최종 제출로 잠긴 꼭지(readOnly)를 집어 붙여넣기가 무시된다 — 실측으로 겪었다.
  const area = page
    .locator('section')
    .filter({ has: page.locator('textarea:not([readonly])') })
    .first();
  await check('조 콘솔 진입 · 편집 칸이 보인다', async () => {
    await area.waitFor({ timeout: 20_000 });
    const n = await area.locator('textarea').count();
    must(n > 0, 'textarea 가 없다');
    return `칸 ${n}개`;
  });

  const before = await area.locator('textarea').count();

  await check('★ 여러 줄을 한 칸에 붙이면 줄마다 칸이 생긴다', async () => {
    const box = area.locator('textarea').last();
    await box.click();
    // 실제 붙여넣기 이벤트를 만든다 — 타이핑이 아니라 clipboard 경로여야 의미가 있다.
    await box.evaluate((el, text) => {
      const dt = new DataTransfer();
      dt.setData('text/plain', text);
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    }, LINES.join('\r\n'));
    await page.waitForTimeout(900);
    const after = await area.locator('textarea').count();
    must(after >= before + LINES.length - 1, `칸이 ${before} → ${after} (분해가 안 된 것 같다)`);
    return `칸 ${before} → ${after}`;
  });

  await check('★ 각 줄이 제 칸에 하나씩 들어갔다', async () => {
    const values = await area.locator('textarea').evaluateAll((els) => els.map((e) => e.value));
    for (const line of LINES) {
      must(values.includes(line), `「${line}」이 한 칸에 단독으로 없다`);
    }
    const blob = values.find((v) => v.includes('\n'));
    must(!blob, '한 칸에 줄바꿈째로 들어간 값이 있다');
    return `${LINES.length}줄 확인`;
  });

  await check('알림이 뜬다', async () => {
    const body = await page.locator('body').innerText();
    must(/나눠 넣었습니다/.test(body), '「나눠 넣었습니다」 알림을 못 찾았다');
    return null;
  });

  await check('★ 저장 버튼을 누르지 않았다 — 서버에 아무것도 안 갔다', async () => {
    const saving = await page.getByRole('button', { name: /^저장( 중…)?$/ }).count();
    must(saving > 0, '저장 버튼이 보이지 않는다');
    return '저장 미실행 상태로 종료';
  });
} finally {
  await browser.close();
  console.log(`\n결과: ${pass} PASS · ${fail} FAIL\n`);
  process.exit(fail === 0 ? 0 : 1);
}
