/**
 * US-013 브라우저 검증 — 온톨로지 관점 보기(카드에 종류 붙이기).
 *
 * 절차: npx astro build → python3 -m http.server 4477 --directory dist → node 이 파일
 * 끝나면 netstat 로 PID 찾아 taskkill 할 것.
 */
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const URL_LAB = 'http://localhost:4477/ko/moderator/insights/submission-lab/';
const EVID = 'evaluation/2026-08-28-submission-lab-us013';
const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass, detail: String(detail).slice(0, 300) });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const KINDS = ['Issue', 'Claim', 'Proposal', 'Concern', 'Condition', 'Value', 'Evidence'];
const LABELS = ['쟁점', '주장', '제안', '우려', '조건', '가치', '근거'];

/** 그리드 카드 id 다중집합(정렬된 배열). 개수만 세면 「한 장 빼고 한 장 복제」가 통과한다. */
const gridIds = (page) =>
  page.$$eval('[data-testid="note-grid"] article', (els) =>
    els.map((el) => el.getAttribute('data-note-id')).sort(),
  );

/** 조별 뷰의 카드 id 다중집합. 조별 뷰에는 note-grid 가 없다. */
const groupedIds = (page) =>
  page.$$eval('article[data-note-id]', (els) =>
    els.map((el) => el.getAttribute('data-note-id')).sort(),
  );

const counterText = async (page) => {
  const el = await page.$('[data-testid="ontology-kind-counter"]');
  return el ? (await el.innerText()).replace(/\s+/g, ' ') : '';
};

/** 「원문 N장 · 종류 M장 · 미지정 K장 · 삭제 D장」 네 숫자. */
const counterNumbers = async (page) => {
  const t = await counterText(page);
  const m = t.match(/원문\s*(\d+)\s*장.*?종류\s*(\d+)\s*장.*?미지정\s*(\d+)\s*장.*?삭제\s*(\d+)\s*장/);
  return m ? m.slice(1, 5).map(Number) : null;
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } });

const supabaseReqs = [];
const consoleErrors = [];
page.on('request', (r) => {
  if (/supabase\.co/.test(r.url())) supabaseReqs.push(r.url());
});
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text());
});
page.on('pageerror', (e) => consoleErrors.push(String(e)));

await page.goto(URL_LAB, { waitUntil: 'networkidle' });
await page.waitForSelector('[data-testid="preservation-counter"]');

// ── 1. 관점이 꺼진 것이 기본 ─────────────────────────────────────────────
const toggle = await page.$('[data-testid="ontology-view-toggle"]');
check('온톨로지 전환 버튼이 있다', !!toggle);
check(
  '전환 버튼 라벨이 「온톨로지」',
  toggle && (await toggle.innerText()).trim() === '온톨로지',
  toggle ? (await toggle.innerText()).trim() : '',
);
check(
  '기본은 꺼짐(aria-pressed=false)',
  (await toggle.getAttribute('aria-pressed')) === 'false',
);
check(
  '꺼진 동안 종류 버튼이 0개',
  (await page.$$('[data-testid="ontology-kind-buttons"]')).length === 0,
);
check('꺼진 동안 카운터가 없다', (await page.$('[data-testid="ontology-kind-counter"]')) === null);

// 조별 뷰에서의 기준 카드 id (관점 전 상태)
const groupedBefore = await groupedIds(page);
check('조별 뷰 카드가 있다', groupedBefore.length > 0, `${groupedBefore.length}장`);

// ── 2. 조별 뷰에서도 관점이 켜진다 ────────────────────────────────────────
await toggle.click();
await page.waitForSelector('[data-testid="ontology-kind-counter"]');
check('켜면 aria-pressed=true', (await toggle.getAttribute('aria-pressed')) === 'true');
const groupedBtnCards = await page.$$eval('article[data-note-id]', (els) =>
  els.filter((el) => el.querySelector('[data-testid="ontology-kind-buttons"]')).length,
);
check(
  '조별 뷰에서도 카드마다 종류 버튼이 붙는다',
  groupedBtnCards === groupedBefore.length,
  `${groupedBtnCards}/${groupedBefore.length}`,
);
const groupedAfterOn = await groupedIds(page);
check(
  '관점을 켜도 조별 뷰 카드 id 다중집합 불변',
  JSON.stringify(groupedAfterOn) === JSON.stringify(groupedBefore),
  `${groupedAfterOn.length}장`,
);
await page.waitForTimeout(400);
await page.screenshot({ path: `${EVID}-grouped.png`, fullPage: false });

// ── 3. 모아보기로 옮겨 본격 검증 ─────────────────────────────────────────
await page.click('button[aria-pressed="false"]:has-text("모아보기")');
await page.waitForSelector('[data-testid="note-grid"]');
const idsBase = await gridIds(page);
check('모아보기 카드가 있다', idsBase.length > 0, `${idsBase.length}장`);

const cards = await page.$$('[data-testid="note-grid"] article');
const withButtons = await page.$$eval('[data-testid="note-grid"] article', (els) =>
  els.filter((el) => el.querySelector('[data-testid="ontology-kind-buttons"]')).length,
);
check('카드마다 종류 버튼이 붙는다', withButtons === cards.length, `${withButtons}/${cards.length}`);

// 버튼 7종 · 이름·순서
const firstBtns = await page.$$eval(
  '[data-testid="note-grid"] article:first-child [data-testid="ontology-kind-buttons"] button',
  (els) => els.map((el) => ({ kind: el.getAttribute('data-kind'), label: el.innerText.trim() })),
);
check('카드 한 장의 종류 버튼이 7개', firstBtns.length === 7, `${firstBtns.length}개`);
check(
  '종류 값이 브리지의 7종·순서와 같다',
  JSON.stringify(firstBtns.map((b) => b.kind)) === JSON.stringify(KINDS),
  firstBtns.map((b) => b.kind).join(','),
);
check(
  '한국어 라벨이 쟁점·주장·제안·우려·조건·가치·근거',
  JSON.stringify(firstBtns.map((b) => b.label)) === JSON.stringify(LABELS),
  firstBtns.map((b) => b.label).join(','),
);

// ── 4. 처음에는 전부 미지정 ──────────────────────────────────────────────
const n0 = await counterNumbers(page);
check('카운터가 네 숫자를 낸다', !!n0, JSON.stringify(n0));
check(
  '상단에 「미지정 N장」이 있다',
  (await counterText(page)).includes('미지정'),
  (await counterText(page)).slice(0, 80),
);
check('처음에는 종류 0장 · 미지정 = 원문', n0 && n0[1] === 0 && n0[2] === n0[0], JSON.stringify(n0));
check('삭제 0장', n0 && n0[3] === 0);
check(
  'AI 가 미리 정하지 않는다 — data-kind 가 붙은 카드 0장',
  (await page.$$('[data-testid="note-grid"] article[data-kind]:not([data-kind=""])')).length === 0,
);
check(
  '종류별 수 일곱 개가 다 0',
  (await page.$$eval('[data-testid="ontology-kind-tally"]', (els) => els.map((e) => e.innerText.trim()))).every(
    (t) => /\s0$/.test(t),
  ),
);
check(
  '드래그 조작이 없다',
  (await page.$$('[draggable="true"]')).length === 0,
);

// ── 5. 사람이 붙인다 — 원문 불변 ─────────────────────────────────────────
const targetId = idsBase[0];
const targetSel = `[data-testid="note-grid"] article[data-note-id="${targetId}"]`;
const textBefore = await page.$eval(`${targetSel} p`, (el) => el.innerText);
await page.click(`${targetSel} [data-testid="ontology-kind-buttons"] button[data-kind="Claim"]`);
await page.waitForSelector(`${targetSel}[data-kind="Claim"]`);
check('종류를 누르면 카드에 data-kind 가 붙는다', true, targetId);
const badge = await page.$(`${targetSel} [data-testid="ontology-kind-badge"]`);
check('배지가 붙는다', !!badge);
check(
  '배지에 「잠정」이 글자로 들어 있다',
  badge && (await badge.innerText()).includes('잠정 · 주장'),
  badge ? (await badge.innerText()).trim() : '',
);
check(
  '카드 원문이 그대로다',
  (await page.$eval(`${targetSel} p`, (el) => el.innerText)) === textBefore,
);
const idsAfterAssign = await gridIds(page);
check(
  '종류를 붙여도 카드 id 다중집합 불변 — 카드 수가 줄지 않는다',
  JSON.stringify(idsAfterAssign) === JSON.stringify(idsBase),
  `${idsAfterAssign.length}장`,
);
const n1 = await counterNumbers(page);
check(
  '미지정이 1 줄고 종류가 1 는다',
  n1 && n1[0] === n0[0] && n1[1] === 1 && n1[2] === n0[2] - 1 && n1[3] === 0,
  JSON.stringify(n1),
);
check(
  '주장 칸의 수가 1',
  /주장\s*1$/.test(
    await page.$eval('[data-testid="ontology-kind-tally"][data-kind="Claim"]', (el) => el.innerText.trim()),
  ),
);
await page.waitForTimeout(400);
await page.screenshot({ path: `${EVID}-assigned.png`, fullPage: false });

// ── 6. 갈아타기 · 되돌리기 ───────────────────────────────────────────────
await page.click(`${targetSel} [data-testid="ontology-kind-buttons"] button[data-kind="Evidence"]`);
await page.waitForSelector(`${targetSel}[data-kind="Evidence"]`);
const n2 = await counterNumbers(page);
check('다른 종류를 누르면 갈아탄다 — 종류 수는 그대로 1', n2 && n2[1] === 1, JSON.stringify(n2));
check(
  '배지가 근거로 바뀐다',
  (await page.$eval(`${targetSel} [data-testid="ontology-kind-badge"]`, (el) => el.innerText)).includes('근거'),
);

await page.click(`${targetSel} [data-testid="ontology-kind-buttons"] button[data-kind="Evidence"]`);
await page.waitForSelector(`${targetSel}[data-kind=""]`);
const n3 = await counterNumbers(page);
check(
  '같은 버튼을 다시 누르면 해제된다 — 선택은 되돌릴 수 있다',
  n3 && JSON.stringify(n3) === JSON.stringify(n0),
  JSON.stringify(n3),
);
check(
  '해제하면 배지가 사라진다',
  (await page.$(`${targetSel} [data-testid="ontology-kind-badge"]`)) === null,
);
check(
  '해제해도 카드 id 다중집합 불변',
  JSON.stringify(await gridIds(page)) === JSON.stringify(idsBase),
);

// ── 7. 여러 장 붙이기 · 보기 전환에도 남는다 ─────────────────────────────
for (let i = 0; i < 5; i += 1) {
  await page.click(
    `[data-testid="note-grid"] article[data-note-id="${idsBase[i]}"] [data-testid="ontology-kind-buttons"] button[data-kind="${KINDS[i]}"]`,
  );
}
const n4 = await counterNumbers(page);
check('다섯 장에 서로 다른 종류', n4 && n4[1] === 5 && n4[2] === n0[0] - 5, JSON.stringify(n4));
check(
  '일곱 종류 합 + 미지정 = 원문',
  (await page.$$eval('[data-testid="ontology-kind-tally"]', (els) =>
    els.reduce((s, e) => s + Number(e.innerText.trim().split(/\s+/).pop()), 0),
  )) +
    n4[2] ===
    n4[0],
);

// 관점을 껐다 켠다 — 붙인 것은 남아야 한다
await toggle.click();
check('끄면 카운터가 사라진다', (await page.$('[data-testid="ontology-kind-counter"]')) === null);
check(
  '끄면 종류 버튼도 사라진다',
  (await page.$$('[data-testid="ontology-kind-buttons"]')).length === 0,
);
check(
  '끄면 배지도 사라진다 — 관점은 한 겹일 뿐',
  (await page.$$('[data-testid="ontology-kind-badge"]')).length === 0,
);
check(
  '껐을 때도 카드 id 다중집합 불변',
  JSON.stringify(await gridIds(page)) === JSON.stringify(idsBase),
);
await toggle.click();
await page.waitForSelector('[data-testid="ontology-kind-counter"]');
const n5 = await counterNumbers(page);
check(
  '다시 켜면 붙여둔 종류가 그대로 있다',
  n5 && JSON.stringify(n5) === JSON.stringify(n4),
  JSON.stringify(n5),
);

// 조별 ↔ 모아보기 왕복
await page.click('button[aria-pressed="false"]:has-text("조별")');
await page.waitForSelector('article[data-note-id]');
const groupedKinds = await page.$$eval('article[data-note-id]', (els) =>
  els.filter((el) => el.getAttribute('data-kind')).length,
);
check('조별 뷰에도 같은 이름표가 보인다', groupedKinds === 5, `${groupedKinds}장`);
await page.click('button[aria-pressed="false"]:has-text("모아보기")');
await page.waitForSelector('[data-testid="note-grid"]');
check(
  '보기 왕복 후에도 카드 id 다중집합 불변',
  JSON.stringify(await gridIds(page)) === JSON.stringify(idsBase),
);

// ── 8. 다른 꼭지 · 분과 필터 ─────────────────────────────────────────────
const tabs = await page.$$('[role="tab"]');
await tabs[1].click();
await page.waitForSelector('[data-testid="note-grid"]');
const nT2 = await counterNumbers(page);
check(
  '다른 꼭지에서는 종류 0장 — 꼭지 배정이 새지 않는다',
  nT2 && nT2[1] === 0 && nT2[2] === nT2[0],
  JSON.stringify(nT2),
);
await tabs[0].click();
await page.waitForSelector('[data-testid="note-grid"]');
const nBack = await counterNumbers(page);
check(
  '꼭지를 돌아오면 종류가 그대로다',
  nBack && JSON.stringify(nBack) === JSON.stringify(n4),
  JSON.stringify(nBack),
);

const subBtns = await page.$$('[aria-label="분과 선택"] button');
if (subBtns.length > 1) {
  await subBtns[1].click();
  await page.waitForSelector('[data-testid="note-grid"]');
  const nSub = await counterNumbers(page);
  check(
    '분과를 고르면 카운터가 그 분과 카드만 센다',
    nSub && nSub[0] < n4[0] && nSub[1] + nSub[2] === nSub[0] && nSub[3] === 0,
    JSON.stringify(nSub),
  );
  await subBtns[0].click();
  await page.waitForSelector('[data-testid="note-grid"]');
  check(
    '전체로 돌아오면 원래 수',
    JSON.stringify(await counterNumbers(page)) === JSON.stringify(n4),
  );
}

// ── 9. 네트워크·콘솔 ─────────────────────────────────────────────────────
check('supabase.co 요청 0건', supabaseReqs.length === 0, supabaseReqs.join(' '));
check('콘솔 에러 0건', consoleErrors.length === 0, consoleErrors.join(' | '));

await page.waitForTimeout(400);
await page.screenshot({ path: `${EVID}-panel.png`, fullPage: false });
await page.waitForTimeout(400);
await page.screenshot({ path: `${EVID}-full.png`, fullPage: true });

const passed = results.filter((r) => r.pass).length;
writeFileSync(
  'evaluation/2026-08-28-us013-verify.json',
  JSON.stringify({ url: URL_LAB, passed, total: results.length, results }, null, 2),
);
console.log(`\n${passed}/${results.length} PASS`);
await browser.close();
process.exitCode = passed === results.length ? 0 : 1;
