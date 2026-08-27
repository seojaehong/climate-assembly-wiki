import { chromium } from 'playwright';
import fs from 'node:fs';

const URL = 'http://localhost:4477/ko/moderator/insights/submission-lab/';
const OUT = 'C:/Users/iceam/OneDrive/_30_컨설팅/2026/기후회의모더레이터/wiki/evaluation';
const results = [];
const check = (name, ok, extra = '') => {
  results.push({ name, ok, extra });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ' -- ' + extra : ''}`);
};

// ★ 포스트잇만 센다. 패널 발췌는 <li>·<div> 라 여기 안 걸린다(US-005 기록).
const gridIds = (page) =>
  page.$$eval('[data-testid="note-grid"] article', (els) =>
    els.map((e) => e.getAttribute('data-note-id')).sort(),
  );

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } });
const supabaseReqs = [];
const consoleErrors = [];
page.on('request', (r) => { if (r.url().includes('supabase.co')) supabaseReqs.push(r.url()); });
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForSelector('[data-testid="preservation-counter"]');

// 조별 뷰로 갔다 오면 모아보기 쪽 패널이 통째로 언마운트돼 접힘 상태(open)가 초기값으로 돌아간다.
// 체크된 짝·지목 이력은 보드 상태라 그대로다 — 판정 전에 패널을 다시 펼친다.
const ensureOpen = async () => {
  const expanded = await page.getAttribute('[data-testid="representative-toggle"]', 'aria-expanded');
  if (expanded === 'false') {
    await page.click('[data-testid="representative-toggle"]');
    await page.waitForTimeout(200);
  }
};

const nums = async () => {
  const el = await page.$('[data-testid="preservation-counter"]');
  const raw = (await el.innerText()).replace(/\s+/g, ' ');
  const m = raw.match(/원문 (\d+)장 · 배정 (\d+)장 · 미배정 (\d+)장 · 삭제 (\d+)장/);
  return m ? { original: +m[1], assigned: +m[2], unassigned: +m[3], deleted: +m[4], raw } : { raw };
};

// ── 0. 모아보기로 이동 · 카드 기준선 ────────────────────────────────
await page.click('button[aria-pressed="false"]:has-text("모아보기")');
await page.waitForSelector('[data-testid="note-grid"]');
const before = await gridIds(page);
check('모아보기 카드 27장(기준선)', before.length === 27, `${before.length}장`);

// ── 1. L4 패널이 있고 기본은 접혀 있다 ──────────────────────────────
const panel = await page.$('[data-testid="representative-panel"]');
check('대표 문장 지목 패널이 있다', panel !== null);
const collapsed = await page.getAttribute('[data-testid="representative-toggle"]', 'aria-expanded');
check('기본은 접힌 상태(화면이 아래로 안 밀린다)', collapsed === 'false', String(collapsed));
let panelText = (await page.textContent('[data-testid="representative-panel"]')).replace(/\s+/g, ' ');
check('접힌 채로도 「지목은 시민이 합니다 — 모더레이터는 기록만 합니다」',
  panelText.includes('지목은 시민이 합니다') && panelText.includes('모더레이터는 기록만 합니다'));
check('접힌 채로도 「대표는 나머지를 대체하지 않습니다」',
  panelText.includes('대표는 나머지를 대체하지 않습니다'));

// ── 2. 묶음이 없으면 안내만 있다(AI 가 미리 묶어두지 않는다) ────────
await page.click('[data-testid="representative-toggle"]');
await page.waitForTimeout(150);
check('체크한 짝이 없으면 묶음 0 — AI 가 미리 묶지 않는다',
  (await page.$('[data-testid="representative-empty"]')) !== null);
check('묶음이 없을 때 이유를 한 줄로 안내',
  ((await page.textContent('[data-testid="representative-empty"]')) || '').includes('닮은 짝'));
check('묶음 0개일 때 후보 카드 0개', (await page.$$('[data-testid="representative-candidate"]')).length === 0);

// ── 3. 닮은 짝 두 개를 ✓ → 묶음 두 개가 생긴다 ──────────────────────
const pairButtons = await page.$$('[data-testid="pair-row"] button[aria-pressed="false"]');
check('닮은 짝 후보가 있다', pairButtons.length >= 2, `${pairButtons.length}쌍`);
await pairButtons[0].click();
await pairButtons[2].click(); // 1번·3번 짝 — 번호가 자리 기준임을 확인하기 위해 건너뛴다
await page.waitForTimeout(200);
const groupEls = await page.$$('[data-testid="representative-group"]');
check('✓ 한 짝 수만큼 묶음이 생긴다(2묶음)', groupEls.length === 2, `${groupEls.length}묶음`);
const ordinals = await page.$$eval('[data-testid="representative-group"]', (els) =>
  els.map((e) => (e.textContent.match(/짝 (\d+)/) || [])[1]));
check('★묶음 번호는 짝 목록에서의 자리다(1,3)', ordinals.join(',') === '1,3', ordinals.join(','));
const memberCounts = await page.$$eval('[data-testid="representative-group"]', (els) =>
  els.map((e) => e.querySelectorAll('[data-testid="representative-candidate"]').length));
check('★묶음은 언제나 카드 2장 — 짝을 합쳐 큰 묶음을 만들지 않는다',
  memberCounts.every((c) => c === 2), memberCounts.join(','));
let after = await gridIds(page);
check('묶음이 생겨도 카드 27장 다중집합 동일', after.join('|') === before.join('|'));

// ── 4. 후보는 원문 카드뿐 · 문장 입력칸이 없다 ──────────────────────
const inputs = await page.$$eval('[data-testid="representative-panel"] input, [data-testid="representative-panel"] textarea',
  (els) => els.length);
check('패널에 문장 입력칸 0개(새 문장을 대표로 세울 수 없다)', inputs === 0, `${inputs}개`);
const candTexts = await page.$$eval('[data-testid="representative-group"]:first-child [data-testid="representative-candidate"]',
  (els) => els.map((e) => e.dataset.noteId));
check('후보 카드 id 가 전부 화면의 원문 카드다',
  candTexts.every((id) => before.includes(id)), candTexts.join(' | '));

// ── 5. 확인 없이 누르면 moderator-alone 으로 튕긴다 ────────────────
const firstGroupId = await page.getAttribute('[data-testid="representative-group"]:first-child', 'data-group-id');
const targetId = candTexts[1];
await page.click(`[data-testid="representative-group"][data-group-id="${firstGroupId}"] [data-testid="representative-pick-button"][data-note-id="${targetId}"]`);
await page.waitForSelector('[data-testid="representative-dialog"]');
check('지목은 확인 창을 거친다', (await page.$('[data-testid="representative-dialog"]')) !== null);
const dlgText = (await page.textContent('[data-testid="representative-dialog"]')).replace(/\s+/g, ' ');
check('확인 창에 「시민이 고른 것입니다」', dlgText.includes('시민이 고른 것입니다'));
const dlgTextareas = await page.$$eval('[data-testid="representative-dialog"] textarea', (e) => e.length);
check('확인 창에 문장 입력용 textarea 0개', dlgTextareas === 0, `${dlgTextareas}개`);

// 5-a. 이름도 확인란도 없이 기록 시도
await page.click('[data-testid="representative-confirm"]');
await page.waitForTimeout(150);
let err = (await page.textContent('[data-testid="representative-error"]')).replace(/\s+/g, ' ');
check('이름 없이 기록하면 이유를 보여준다(예외를 삼키지 않는다)', err.includes('누가 골랐는지'), err.slice(0, 50));

// 5-b. 이름만 넣고 확인란 없이 = 모더레이터 단독
await page.fill('[data-testid="representative-actor-label"]', '1분과 2조 시민들');
await page.click('[data-testid="representative-confirm"]');
await page.waitForTimeout(150);
err = (await page.textContent('[data-testid="representative-error"]')).replace(/\s+/g, ' ');
check('★모더레이터 단독으로는 진행되지 않는다', err.includes('모더레이터 단독'), err.slice(0, 40));
check('★왜 안 되는지(「좋은 의견 선정」)까지 알려준다', err.includes('좋은 의견 선정'));
check('단독 시도로는 지목이 기록되지 않는다',
  (await page.$$('[data-testid="representative-badge"]')).length === 0);
await page.screenshot({ path: `${OUT}/2026-08-28-submission-lab-us010-moderator-alone.png` });

// ── 6. 확인란 체크 → 기록된다 ───────────────────────────────────────
await page.check('[data-testid="representative-citizen-confirm"]');
await page.click('[data-testid="representative-confirm"]');
await page.waitForTimeout(250);
check('확인 후 창이 닫힌다', (await page.$('[data-testid="representative-dialog"]')) === null);
const picked = await page.getAttribute(`[data-testid="representative-group"][data-group-id="${firstGroupId}"]`, 'data-picked');
check('그 묶음의 대표가 지목한 카드다', picked === targetId, `${picked}`);
const pickedCount = (await page.textContent('[data-testid="representative-picked-count"]')).replace(/\s+/g, ' ');
check('「지목됨 1묶음」 표시', /지목됨 1묶음/.test(pickedCount), pickedCount);

// ── 7. 이력(누가·언제)이 화면에 남는다 ─────────────────────────────
const hist = (await page.textContent('[data-testid="representative-history"]')).replace(/\s+/g, ' ');
check('이력에 「누가」가 남는다', hist.includes('1분과 2조 시민들'), hist.slice(0, 60));
check('이력에 「언제」가 남는다', /\d+\/\d+/.test(hist) || /\d+:\d+/.test(hist), hist.slice(0, 60));
check('이력에 모더레이터 대리 기록임이 남는다', hist.includes('모더레이터 대리 기록'));

// ── 8. 대표가 나머지를 대체하지 않는다 ──────────────────────────────
const stillThere = await page.$$eval(`[data-testid="representative-group"][data-group-id="${firstGroupId}"] [data-testid="representative-candidate"]`,
  (els) => els.map((e) => e.dataset.noteId));
check('★대표로 지목되지 않은 카드도 묶음에 계속 보인다', stillThere.length === 2, stillThere.join(' | '));
after = await gridIds(page);
check('★지목 후에도 카드 27장 다중집합 동일 — 대표가 나머지를 삼키지 않는다',
  after.length === 27 && after.join('|') === before.join('|'), `${after.length}장`);
let n = await nums();
check('보존 카운터 삭제 0장 유지', n.original === 27 && n.deleted === 0, n.raw.slice(0, 60));

// ── 9. 포스트잇에 대표 배지가 붙는다 ────────────────────────────────
const badgeText = (await page.textContent(`[data-testid="note-grid"] article[data-note-id="${targetId}"] [data-testid="representative-badge"]`)).replace(/\s+/g, ' ').trim();
check('대표 카드에 「대표 · 짝 1」 배지', badgeText === '대표 · 짝 1', badgeText);
const badgeCount = await page.$$eval('[data-testid="note-grid"] [data-testid="representative-badge"]', (e) => e.length);
check('대표 배지는 지목된 카드에만(1장)', badgeCount === 1, `${badgeCount}개`);
await page.screenshot({ path: `${OUT}/2026-08-28-submission-lab-us010-picked.png` });

// ── 10. 대표를 바꿔도 이력이 쌓인다 · 카드 수 불변 ──────────────────
const otherId = stillThere.find((id) => id !== targetId);
await page.click(`[data-testid="representative-group"][data-group-id="${firstGroupId}"] [data-testid="representative-pick-button"][data-note-id="${otherId}"]`);
await page.waitForSelector('[data-testid="representative-dialog"]');
await page.fill('[data-testid="representative-actor-label"]', '1분과 2조 시민들(재투표)');
await page.check('[data-testid="representative-citizen-confirm"]');
await page.click('[data-testid="representative-confirm"]');
await page.waitForTimeout(250);
const picked2 = await page.getAttribute(`[data-testid="representative-group"][data-group-id="${firstGroupId}"]`, 'data-picked');
check('대표를 바꾸면 새 카드가 대표가 된다', picked2 === otherId, `${picked2}`);
const hist2 = (await page.textContent('[data-testid="representative-history"]')).replace(/\s+/g, ' ');
check('★덮어써도 이전 지목 기록이 남는다',
  hist2.includes('1분과 2조 시민들 ') && hist2.includes('재투표'), hist2.slice(0, 90));
const histRows = await page.$$eval(`[data-testid="representative-group"][data-group-id="${firstGroupId}"] [data-testid="representative-history"] li`, (e) => e.length);
check('이력이 2건으로 쌓였다', histRows === 2, `${histRows}건`);
after = await gridIds(page);
check('★대표를 바꿔도 카드 27장 다중집합 동일', after.join('|') === before.join('|'));

// ── 11. 조별 뷰에도 대표 표시가 따라간다 ────────────────────────────
await page.click('button[aria-pressed="false"]:has-text("조별")');
await page.waitForTimeout(300);
const groupedBadges = await page.$$eval('[data-testid="representative-badge"]', (e) => e.length);
check('조별 뷰에도 대표 배지가 따라간다', groupedBadges === 1, `${groupedBadges}개`);
await page.screenshot({ path: `${OUT}/2026-08-28-submission-lab-us010-grouped.png` });
await page.click('button[aria-pressed="false"]:has-text("모아보기")');
await page.waitForTimeout(250);
await ensureOpen();

// ── 12. 꼭지를 바꿔도 묶음이 새지 않는다 ────────────────────────────
const tabs = await page.$$('[role="tab"]');
await tabs[1].click();
await page.waitForTimeout(350);
await ensureOpen();
const otherTopicGroups = await page.$$('[data-testid="representative-group"]');
check('꼭지2 에는 이 꼭지의 묶음이 없다(꼭지 간 누수 없음)', otherTopicGroups.length === 0, `${otherTopicGroups.length}묶음`);
const otherTopicBadges = await page.$$eval('[data-testid="representative-badge"]', (e) => e.length);
check('꼭지2 카드에 대표 배지가 안 붙는다', otherTopicBadges === 0, `${otherTopicBadges}개`);
await tabs[0].click();
await page.waitForTimeout(350);
await ensureOpen();
check('꼭지1 로 돌아오면 지목이 그대로', (await page.$$('[data-testid="representative-badge"]')).length === 1);
after = await gridIds(page);
check('꼭지 왕복 후에도 카드 27장 다중집합 동일', after.join('|') === before.join('|'));
check('뷰·꼭지를 오간 뒤에도 묶음 2개가 그대로(체크·이력은 보드 상태)',
  (await page.$$('[data-testid="representative-group"]')).length === 2);

// ── 13. 짝 체크를 풀면 묶음이 사라지되 카드는 그대로 ────────────────
await ensureOpen();
const marked = await page.$$('[data-testid="pair-row"] button[aria-pressed="true"]');
const beforeUncheck = (await page.$$('[data-testid="representative-group"]')).length;
await marked[marked.length - 1].click();
await page.waitForTimeout(400);
const afterUncheck = await page.$$eval('[data-testid="representative-group"]', (els) =>
  els.map((e) => e.getAttribute('data-group-id')));
check('짝 표시를 풀면 그 묶음이 목록에서 빠진다',
  afterUncheck.length === beforeUncheck - 1, `${beforeUncheck}묶음 -> ${afterUncheck.length}묶음 (표시된 짝 ${marked.length}개)`);
after = await gridIds(page);
check('★묶음을 풀어도 카드 27장 다중집합 동일 — 카드는 아무 일도 안 겪는다',
  after.join('|') === before.join('|'));
n = await nums();
check('풀어도 삭제 0장', n.deleted === 0, n.raw.slice(0, 60));

// ── 14. 정렬 병행 ───────────────────────────────────────────────────
await page.click('button:has-text("비슷한 것끼리")');
await page.waitForTimeout(300);
after = await gridIds(page);
n = await nums();
check('★정렬 + 지목 병행해도 카드 27장 다중집합 동일 · 삭제 0',
  after.join('|') === before.join('|') && n.deleted === 0);
await page.screenshot({ path: `${OUT}/2026-08-28-submission-lab-us010-panel.png`, clip: { x: 0, y: 0, width: 1600, height: 1100 } });

// ── 15. 네트워크·콘솔 ───────────────────────────────────────────────
check('supabase.co 요청 0건', supabaseReqs.length === 0, supabaseReqs.join(','));
check('콘솔 에러 0건', consoleErrors.length === 0, consoleErrors.slice(0, 2).join(' | '));

await browser.close();
const pass = results.filter((r) => r.ok).length;
console.log(`\n${pass}/${results.length} PASS`);
fs.writeFileSync(`${OUT}/2026-08-28-us010-verify.json`, JSON.stringify(results, null, 2), 'utf8');
process.exit(pass === results.length ? 0 : 1);
