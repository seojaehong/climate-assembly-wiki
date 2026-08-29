/**
 * 발표 모드 「조 하나씩」 드라이런 — 실화면을 사람처럼 조작한다. **읽기 전용**.
 *
 * 저장·삭제·잠금 RPC를 부르지 않는다. 행사 중에 돌려도 조 데이터에 손대지 않는다.
 *
 *   node scripts/verify-present-focus.mjs --base https://climate-assembly.org \
 *        --operator 이름 --password 비번 [--subgroup 3분과] [--headed]
 */
import { chromium } from '../automation/node_modules/playwright/index.mjs';

const argv = process.argv.slice(2);
const arg = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : argv[i + 1];
};
const BASE = arg('base', 'https://climate-assembly.org');
const OPERATOR = arg('operator');
const PASSWORD = arg('password');
const SUBGROUP = arg('subgroup', '3분과');
const HEADED = argv.includes('--headed');

let pass = 0;
let fail = 0;
async function check(label, fn) {
  try {
    const detail = await fn();
    pass += 1;
    console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`);
  } catch (e) {
    fail += 1;
    console.log(`  FAIL  ${label} — ${e.message}`);
  }
}
function must(cond, msg) {
  if (!cond) throw new Error(msg);
}

if (!OPERATOR || !PASSWORD) {
  console.error('--operator 와 --password 가 필요하다');
  process.exit(2);
}

const browser = await chromium.launch({ headless: !HEADED });
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });

/** 발표 모드 그리드 안의 조 카드만 센다(숨은 인쇄 문서를 집지 않도록 그리드로 좁힌다). */
const grid = () => page.locator('div.grid').filter({ has: page.locator('section h2') }).first();
const teamSections = () => grid().locator('> section');
const teamNames = async () => {
  const n = await teamSections().count();
  const out = [];
  for (let i = 0; i < n; i += 1) {
    out.push((await teamSections().nth(i).locator('h2').first().innerText()).split('\n')[0].trim());
  }
  return out;
};

try {
  console.log(`\n발표 모드 「조 하나씩」 드라이런 · ${BASE} · ${SUBGROUP}\n`);

  await page.goto(`${BASE}/hq`, { waitUntil: 'networkidle' });
  await page.waitForSelector('input[type="password"]', { timeout: 25_000 });
  await page.fill('input[autocomplete="name"]', OPERATOR);
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForTimeout(2_500);

  await check('본부 화면 로그인', async () => {
    const n = await page.getByRole('button', { name: /^\d분과/ }).count();
    must(n > 0, '분과 버튼이 없다 — 로그인 실패로 보인다');
    return `분과 버튼 ${n}개`;
  });

  await page.getByRole('button', { name: new RegExp(`^${SUBGROUP}`) }).first().click();
  await page.waitForTimeout(1_000);
  await page.getByRole('button', { name: /^발표 모드$/ }).first().click();
  await page.waitForTimeout(1_500);

  let allTeams = [];
  await check('발표 모드 진입 — 기본은 전체 보기', async () => {
    allTeams = await teamNames();
    must(allTeams.length > 1, `조가 ${allTeams.length}개만 보인다(전체 보기여야 한다)`);
    const pressed = await page.getByRole('button', { name: /^전체$/ }).getAttribute('aria-pressed');
    must(pressed === 'true', '「전체」가 눌린 상태가 아니다');
    return `${allTeams.length}개 조: ${allTeams.join(' · ')}`;
  });

  await check('★ 「조 하나씩」을 누르면 한 조만 남는다', async () => {
    await page.getByTestId('present-one-team').click();
    await page.waitForTimeout(900);
    const shown = await teamNames();
    must(shown.length === 1, `${shown.length}개 조가 보인다 — 1개여야 한다`);
    return `보이는 조: ${shown[0]}`;
  });

  await check('「N / 5」 위치 표시가 있다', async () => {
    const body = await page.locator('body').innerText();
    must(new RegExp(`\\d+\\s*/\\s*${allTeams.length}`).test(body), '위치 표시를 찾지 못했다');
    return null;
  });

  let first = '';
  await check('★ 「다음 ▶」이 다른 조로 넘긴다', async () => {
    first = (await teamNames())[0];
    await page.getByRole('button', { name: /다음/ }).first().click();
    await page.waitForTimeout(800);
    const next = (await teamNames())[0];
    must(next !== first, `그대로다(${first})`);
    return `${first} → ${next}`;
  });

  await check('★ 「◀ 이전」이 되돌린다', async () => {
    await page.getByRole('button', { name: /이전/ }).first().click();
    await page.waitForTimeout(800);
    const back = (await teamNames())[0];
    must(back === first, `${back} — ${first}로 돌아와야 한다`);
    return `${back}`;
  });

  await check('★ 화살표 키로도 넘어간다', async () => {
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(800);
    const afterRight = (await teamNames())[0];
    must(afterRight !== first, '→ 키가 안 먹는다');
    await page.keyboard.press('ArrowLeft');
    await page.waitForTimeout(800);
    const afterLeft = (await teamNames())[0];
    must(afterLeft === first, '← 키로 안 돌아온다');
    return `→ ${afterRight} · ← ${afterLeft}`;
  });

  await check('★ 본문 글자가 24px 아래로 내려가지 않는다', async () => {
    const p = teamSections().first().locator('ol li p').first();
    if ((await p.count()) === 0) return '조가 아직 안 써서 잴 글이 없다(구조만 확인)';
    const size = await p.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    must(size >= 24, `${size}px`);
    return `${size}px`;
  });

  await check('가로 스크롤이 생기지 않는다', async () => {
    const over = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
    );
    must(!over, '가로로 삐져나온다');
    return null;
  });

  await check('「전체」로 되돌아간다', async () => {
    await page.getByRole('button', { name: /^전체$/ }).click();
    await page.waitForTimeout(900);
    const shown = await teamNames();
    must(shown.length === allTeams.length, `${shown.length}개 — ${allTeams.length}개여야 한다`);
    return `${shown.length}개 조`;
  });

  await check('★ Esc 로 발표 모드를 나간다', async () => {
    await page.getByTestId('present-one-team').click();
    await page.waitForTimeout(600);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1_000);
    const n = await page.getByRole('button', { name: /^발표 모드$/ }).count();
    must(n > 0, '발표 모드 버튼이 안 보인다 — 안 나가진 것 같다');
    return null;
  });
} finally {
  await browser.close();
  console.log(`\n결과: ${pass} PASS · ${fail} FAIL\n`);
  process.exit(fail === 0 ? 0 : 1);
}
