/**
 * 인쇄 검증 — **실제 화면(/mod·/hq)** 에 print 미디어를 씌워 종이에 나갈 것을 잰다.
 *
 * ── 이 파일이 세 번 고쳐진 이유 ──────────────────────────────────────
 * 「인쇄 검증 완료」라고 보고했다가 실제 출력물이 백지 4쪽으로 나왔다. 원인은
 * 매번 **결과물 대신 재기 쉬운 대체물을 재고 통과라고 부른 것**이었다.
 *
 *   1판  인쇄 문서의 DOM에 글자가 있는지 봤다 → 인쇄를 실행하지 않아 백지를 못 잡음
 *   2판  PDF에서 (...) 를 긁어 셌다 → 한글은 글리프 번호로 실려 폰트 바이너리를 셈.
 *        백지든 아니든 10만 자로 나와 무조건 통과
 *   3판  submission-lab(미리보기)에서 쟀다 → 그 라우트에는 인쇄 CSS가 아예 없다.
 *        정작 고친 mod.astro·hq.astro 를 한 번도 안 태움
 *
 * 그래서 이 판은 **사람이 실제로 여는 주소를 그대로 연다.** 조는 딥링크로,
 * 본부는 로그인 폼을 채워서 들어간다. 그 상태에 print 미디어를 씌우고,
 * Chromium이 종이에 그릴 때와 같은 계산(display·visibility)으로 보이는 글자만 모은다.
 *
 * 사용법
 *   node scripts/verify-print.mjs --base=http://localhost:4507 \
 *        --code=082901 --operator=박진환 --password=0000
 *
 * 비밀번호는 인자로만 받는다 — 파일에 적지 않는다.
 */
import { chromium } from '../automation/node_modules/playwright/index.mjs';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const argv = process.argv.slice(2);
const arg = (name, fallback = '') => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const BASE = arg('base', 'http://localhost:4507');
const CODE = arg('code', '082901');
const OPERATOR = arg('operator');
const PASSWORD = arg('password');
const KEEP = argv.includes('--keep');

/** 완전한 백지 4쪽이 2,231바이트였다. 글이 실렸다면 그 몇 배는 된다. */
const BLANK_PDF_BYTES = 20_000;

/** 종이에 절대 나오면 안 되는 조작용 문구. */
const SCREEN_ONLY = [
  '펼치기',
  '접기',
  '내려받기',
  '텍스트로 복사',
  '발표 모드',
  '여기에 적습니다',
  '한 줄 더',
  '최종 제출',
  '나가기',
];

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

/** print 미디어가 걸린 상태에서 **눈에 보일 글자**만 모은다. */
function visibleUnderPrint(page) {
  return page.evaluate(() => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const out = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.textContent?.trim();
      if (!text) continue;
      // ⚠️ 조상의 visibility 까지 보면 안 된다 — visibility 는 자식에서 되살릴 수 있어
      //    (숨긴 화면 위에 인쇄 문서만 드러내는 방식이 정확히 그것이다) 전부 안 보인다고
      //    잘못 세게 된다. 실제로 본부 화면이 PDF 는 멀쩡한데 0자로 나왔다.
      //    자기 자신의 computed visibility 는 이미 상속·재설정이 반영된 값이다.
      //    조상에서 볼 것은 **display:none 뿐**이다 — 그것만은 자식이 되살릴 수 없다.
      const own = node.parentElement ? getComputedStyle(node.parentElement) : null;
      if (!own || own.visibility === 'hidden') continue;
      let visible = true;
      for (let cur = node.parentElement; cur && cur !== document.documentElement; cur = cur.parentElement) {
        if (getComputedStyle(cur).display === 'none') {
          visible = false;
          break;
        }
      }
      if (visible) out.push(text);
    }
    return out.join(' ');
  });
}

/** 한 화면을 인쇄 관점으로 전부 검사한다. */
async function auditPrint(page, label, dir) {
  await page.emulateMedia({ media: 'print' });

  const printed = await visibleUnderPrint(page);
  const chars = printed.replace(/\s+/g, '').length;
  check(`[${label}] ★ 그냥 인쇄해도(Ctrl+P) 백지가 아니다`, chars > 200, `종이 글자 ${chars}자`);

  const leaked = SCREEN_ONLY.filter((word) => printed.includes(word));
  check(`[${label}] 종이에 화면 조작 요소가 섞이지 않는다`, leaked.length === 0, leaked.join(', ') || '없음');

  const hasDoc = await page.locator('.print-root').count();
  check(`[${label}] 인쇄 문서가 항상 준비돼 있다`, hasDoc > 0, `.print-root ${hasDoc}개`);

  const file = join(dir, `${label}.pdf`);
  await page.pdf({ path: file, format: 'A4', printBackground: false });
  const bytes = readFileSync(file).length;
  check(`[${label}] ★ 뽑힌 PDF가 백지 크기가 아니다`, bytes > BLANK_PDF_BYTES, `${bytes.toLocaleString()}바이트`);

  // 인쇄 문서를 지워 본다 — :has 가드가 빠지면 여기서 백지가 된다.
  await page.evaluate(() => document.querySelectorAll('.print-root').forEach((el) => el.remove()));
  const fallback = (await visibleUnderPrint(page)).replace(/\s+/g, '').length;
  check(
    `[${label}] ★ 인쇄 문서가 없어도 백지가 되지 않는다 (:has 가드)`,
    fallback > 200,
    `종이 글자 ${fallback}자`,
  );

  await page.emulateMedia({ media: 'screen' });
}

const browser = await chromium.launch();
const dir = mkdtempSync(join(tmpdir(), 'print-'));
try {
  // ── 조 화면 — 사람이 받는 딥링크 그대로 ──────────────────────────
  {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const res = await page.goto(`${BASE}/mod?code=${CODE}`, { waitUntil: 'networkidle' });
    check('[조] 딥링크로 열린다', res?.ok() === true, `HTTP ${res?.status()}`);
    // 조별 산출물 탭이 첫 탭·기본값이다.
    await page.waitForSelector('textarea', { timeout: 20_000 });
    // 인쇄 문서는 첫 화면 진입 뒤 스스로 준비된다 — 그것을 기다린다.
    await page.waitForSelector('.print-root', { timeout: 20_000 }).catch(() => {});
    await auditPrint(page, '조', dir);
    await page.close();
  }

  // ── 본부 화면 — 로그인 폼을 실제로 채워 들어간다 ─────────────────
  if (OPERATOR && PASSWORD) {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    const res = await page.goto(`${BASE}/hq`, { waitUntil: 'networkidle' });
    check('[본부] 화면이 열린다', res?.ok() === true, `HTTP ${res?.status()}`);
    await page.waitForSelector('input[autocomplete="name"]', { timeout: 20_000 });
    await page.fill('input[autocomplete="name"]', OPERATOR);
    await page.fill('input[type="password"]', PASSWORD);
    await page.click('button[type="submit"]');
    const ok = await page
      .waitForSelector('[data-testid="team-overlap-panel"]', { timeout: 25_000 })
      .then(() => true)
      .catch(() => false);
    check('[본부] 로그인해서 보드가 열린다', ok, ok ? '' : '보드가 뜨지 않았다');
    if (ok) await auditPrint(page, '본부', dir);
    await page.close();
  } else {
    console.log('  SKIP  [본부] --operator= 와 --password= 를 줘야 돈다');
  }
} finally {
  await browser.close();
  if (KEEP) console.log(`\nPDF 남김: ${dir}`);
  else rmSync(dir, { recursive: true, force: true });
}

const failed = results.filter((r) => !r.ok).length;
console.log('\n' + '─'.repeat(60));
console.log(`합계 ${results.length}건 · 통과 ${results.length - failed} · 실패 ${failed}`);
process.exit(failed === 0 ? 0 : 1);
