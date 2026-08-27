import { chromium } from 'playwright';

const URL = 'http://localhost:4477/ko/moderator/insights/submission-lab/';
const OUT = 'C:/Users/iceam/OneDrive/_30_컨설팅/2026/기후회의모더레이터/wiki/evaluation';

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } });

const supabaseReqs = [];
const consoleErrors = [];
page.on('request', (r) => { if (/supabase\.co/.test(r.url())) supabaseReqs.push(r.url()); });
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => consoleErrors.push(String(e)));

await page.goto(URL, { waitUntil: 'networkidle' });
await page.getByRole('button', { name: '모아보기' }).click();
await page.waitForSelector('[data-testid="similar-pairs-panel"]');

// 꼭지1 에서 검증한다 — 꼭지2/3 은 1.00 짜리(완전 동일 문장)뿐이라 패널이 도는지 판정이 안 된다.
const activeTab = await page.locator('[role="tab"][aria-selected="true"]').innerText();
check('꼭지1 탭이 활성 (배경·문제 인식 · 27건)', activeTab.includes('배경') && activeTab.includes('27'), activeTab.split('\n').join(' '));

const panel = page.locator('[data-testid="similar-pairs-panel"]');
const panelText = await panel.innerText();
check('「AI 제안 — 확정은 사람이 합니다」 표시', panelText.includes('AI 제안 — 확정은 사람이 합니다'));
check('한국어 단문 유사도 주의 표시', panelText.includes('짧은 한국어 문장에서는 유사도가 자주 틀립니다'));
check('카드가 합쳐지지 않는다는 문구', panelText.includes('합쳐지거나 사라지지'));

const rows = page.locator('[data-testid="pair-row"]');
const pairCount = await rows.count();
check('짝 18쌍 (US-004 픽스처 실측)', pairCount === 18, `${pairCount}쌍`);

// 그리드 카드 수 — 패널의 짝 발췌는 <div> 라 이 셀렉터에 안 걸려야 한다.
const gridCards = page.locator('[data-testid="note-grid"] article');
const before = await gridCards.count();
const beforeIds = (await gridCards.evaluateAll((els) => els.map((e) => e.dataset.noteId))).sort();
const beforeLabel = await page.locator('[data-testid="note-count"]').innerText();
check('그리드 카드 27장', before === 27, `${before}장 · 표시「${beforeLabel.replace(/\n/g, ' ')}」`);

// 각 짝 행에 원문·조 이름·겹친 낱말이 함께 있는가
const row0 = rows.nth(0);
const row0Text = await row0.innerText();
const hasTeam = /\d분과 \d조/.test(row0Text);
const hasTerms = row0Text.includes('겹친 낱말');
const hasScore = row0Text.includes('참고 점수');
check('짝 행에 조 이름·겹친 낱말·참고 점수', hasTeam && hasTerms && hasScore,
  row0Text.split('\n').slice(0, 4).join(' | '));

// 점수 0.36~0.46 짜리(완전 동일 문장이 아닌 진짜 판단거리)가 실제로 있는가
const scores = await rows.evaluateAll((els) =>
  els.map((e) => parseFloat((e.innerText.match(/참고 점수 ([\d.]+)/) || [])[1])));
const partial = scores.filter((s) => s < 1).length;
check('부분 유사 짝이 존재 (전부 1.00 이 아님)', partial > 0,
  `1.00 ${scores.filter((s) => s === 1).length}쌍 · 부분 ${partial}쌍 (${scores.filter((s) => s < 1).join(', ')})`);

// ── 체크 동작 ──────────────────────────────────────────────
// 부분 유사 짝(1.00 이 아닌 것) 하나를 골라 검증한다.
const targetIdx = scores.findIndex((s) => s < 1);
const target = rows.nth(targetIdx);
await target.getByRole('button', { name: /표시/ }).click();

const marked = page.locator('[data-testid="note-grid"] [data-testid="pair-marks"]');
const markedCount = await marked.count();
check('체크하면 카드 2장에 표시가 붙는다', markedCount === 2, `${markedCount}장`);

const markTexts = await marked.evaluateAll((els) => els.map((e) => e.innerText.trim()));
check('두 카드의 표시 번호가 같다', markTexts.length === 2 && markTexts[0] === markTexts[1],
  markTexts.join(' / '));
check('표시 번호가 짝 목록의 자리와 일치', markTexts[0] === `닮은 짝 ${targetIdx + 1}`,
  `${markTexts[0]} vs 목록 ${targetIdx + 1}번`);

const afterIds = (await gridCards.evaluateAll((els) => els.map((e) => e.dataset.noteId))).sort();
const afterLabel = await page.locator('[data-testid="note-count"]').innerText();
check('★ 체크해도 카드 수 불변 (삭제 0장)', afterIds.length === 27, `${afterIds.length}장 · 표시「${afterLabel.replace(/\n/g, ' ')}」`);
check('★ 체크 전후 카드 다중집합 동일 (합쳐지지도 않음)',
  JSON.stringify(beforeIds) === JSON.stringify(afterIds));
check('짝 목록도 그대로 18쌍', (await rows.count()) === 18);
check('표시함 쌍 수 표시', (await page.locator('[data-testid="pair-checked-count"]').innerText()).includes('1'));

await page.screenshot({ path: `${OUT}/2026-08-28-submission-lab-us005-checked.png`, fullPage: false });

// ── 되돌리기 ────────────────────────────────────────────────
await target.getByRole('button', { name: /표시/ }).click();
check('되돌리면 표시가 사라진다', (await marked.count()) === 0);
const undoIds = (await gridCards.evaluateAll((els) => els.map((e) => e.dataset.noteId))).sort();
check('되돌린 뒤에도 카드 27장 그대로', JSON.stringify(undoIds) === JSON.stringify(beforeIds), `${undoIds.length}장`);

// ── 다중 체크 · 접기 ────────────────────────────────────────
await rows.nth(0).getByRole('button', { name: /표시/ }).click();
await rows.nth(1).getByRole('button', { name: /표시/ }).click();
check('두 짝을 체크하면 표시된 카드 4장', (await marked.count()) === 4, `${await marked.count()}장`);
check('여러 짝 체크 후에도 카드 27장', (await gridCards.count()) === 27);

await panel.getByRole('button', { name: '접기' }).click();
check('접으면 짝 행이 감춰진다', (await rows.count()) === 0);
check('접어도 주의 문구는 남는다', (await panel.innerText()).includes('AI 제안 — 확정은 사람이 합니다'));
await panel.getByRole('button', { name: '펼치기' }).click();
check('다시 펼치면 18쌍 복귀', (await rows.count()) === 18);

// 조별 뷰에도 표시가 따라가는가
await page.getByRole('button', { name: '조별' }).first().click();
const groupedMarks = await page.locator('[data-testid="pair-marks"]').count();
check('조별 뷰에서도 같은 표시가 보인다', groupedMarks === 4, `${groupedMarks}장`);
await page.getByRole('button', { name: '모아보기' }).click();

// 정렬 토글과 함께 써도 카드 수 불변
await page.getByRole('button', { name: '비슷한 것끼리' }).click();
const sortedIds = (await gridCards.evaluateAll((els) => els.map((e) => e.dataset.noteId))).sort();
check('정렬 + 체크를 같이 써도 카드 다중집합 동일',
  JSON.stringify(sortedIds) === JSON.stringify(beforeIds), `${sortedIds.length}장`);
check('정렬 후에도 표시 4장 유지', (await marked.count()) === 4);
await page.screenshot({ path: `${OUT}/2026-08-28-submission-lab-us005-panel.png`, fullPage: false });

check('supabase.co 요청 0건', supabaseReqs.length === 0, supabaseReqs.join(', '));
check('콘솔 에러 0건', consoleErrors.length === 0, consoleErrors.join(' | '));

await browser.close();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length === 0 ? 0 : 1);
