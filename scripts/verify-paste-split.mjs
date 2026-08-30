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
/*
 * ★ --code 기본값 주의 (2026-08-30)
 *   8.29 산출물은 행사 후 전부 `final` 로 잠겼다. **잠긴 조에서는 편집 칸이 하나도
 *   없어 이 드라이런을 돌릴 수 없다**(readOnly 라 붙여넣기·타이핑이 무시된다).
 *   그래서 아직 열린 꼭지가 남은 조를 기본값으로 둔다. 이 기본값이 나중에 잠기면
 *   아래 「편집 칸이 보인다」 검사가 그 사실을 이름 대고 알려 준다 — 다른 조로 바꾸면 된다.
 *     select t.join_code, dt.ordinal, s.status from climate_vote.team t
 *       cross join climate_vote.discussion_topic dt
 *       left join climate_vote.submission s on s.team_id=t.id and s.topic_id=dt.id
 *      where dt.status='open' and coalesce(s.status,'draft') <> 'final';
 */
const CODE = arg('code', '082915');
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
let saveCalls = 0;
// ★ 「저장 버튼이 보인다」로 저장 안 했다고 판정하면 안 된다 — 버튼 존재는 네트워크가
//   아니다. 실제 RPC 요청 수를 센다(Supabase 는 /rest/v1/rpc/submission_save 로 간다).
page.on('request', (r) => {
  if (/\/rpc\/submission_(save|finalize)/.test(r.url())) saveCalls += 1;
});

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
    must(n > 0, `조 ${CODE} 에 편집 가능한 꼭지가 없다 — 전부 최종 제출로 잠긴 조다. 열린 꼭지가 남은 조 코드를 --code 로 주자`);
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

  // ── 2차 방어선 — 붙여넣기 분해가 새어도 잡는가 (2026-08-30) ─────────
  //
  // 8.29 통짜 6건은 paste 이벤트를 타지 않은 것으로 보인다(옛 번들에는 onPaste 가 아예
  // 없었다). 그 경로를 재현하려면 **paste 이벤트 없이** 한 칸에 여러 줄을 넣어야 한다 —
  // fill() 이 정확히 그것이다(input 이벤트만 발생).
  const BLOB_LINES = Array.from({ length: 12 }, (_, i) => `${'가'.repeat(35)} ${i}`);
  let blobBefore = 0;

  await check('★ paste 없이 한 칸에 통짜로 넣으면 경고가 뜬다 (옛 번들·드래그앤드롭 경로)', async () => {
    blobBefore = await area.locator('textarea').count();
    const box = area.locator('textarea:not([readonly])').last();
    await box.click();
    await box.fill(BLOB_LINES.join('\n')); // paste 이벤트가 발생하지 않는다
    await page.waitForTimeout(800);
    const value = await box.inputValue();
    must(value.includes('\n'), '한 칸에 줄바꿈째로 들어가지 않았다 — 재현 실패');
    const body = await area.innerText();
    must(/한 칸에 들어간 것 같습니다/.test(body), '300자 경고가 안 떴다');
    return `한 칸 ${value.length}자 · 경고 표시`;
  });

  await check('★ 「줄 단위로 나누기」를 누르면 칸이 실제로 나뉜다', async () => {
    await area.getByRole('button', { name: '줄 단위로 나누기' }).click();
    await page.waitForTimeout(900);
    const after = await area.locator('textarea').count();
    must(
      after === blobBefore + BLOB_LINES.length - 1,
      `칸이 ${blobBefore} → ${after} (기대 ${blobBefore + BLOB_LINES.length - 1})`,
    );
    const values = await area.locator('textarea').evaluateAll((els) => els.map((e) => e.value));
    for (const line of BLOB_LINES) must(values.includes(line), `「…${line.slice(-6)}」이 제 칸에 없다`);
    must(!values.some((v) => v.includes('\n')), '줄바꿈이 남은 칸이 있다');
    return `1칸 → ${BLOB_LINES.length}칸 · 칸 ${blobBefore} → ${after}`;
  });

  await check('나눈 뒤에는 경고가 사라진다', async () => {
    const body = await area.innerText();
    must(!/한 칸에 들어간 것 같습니다/.test(body), '나눴는데 경고가 남아 있다');
    return null;
  });

  await check('★ 저장 버튼을 누르지 않았다 — 서버에 아무것도 안 갔다', async () => {
    must(saveCalls === 0, `submission_save/finalize 요청이 ${saveCalls}번 나갔다`);
    return `저장·최종제출 RPC 요청 ${saveCalls}건`;
  });
} finally {
  await browser.close();
  console.log(`\n결과: ${pass} PASS · ${fail} FAIL\n`);
  process.exit(fail === 0 ? 0 : 1);
}
