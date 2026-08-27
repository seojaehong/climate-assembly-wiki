/**
 * US-003 브라우저 검증 — /ko/moderator/insights/submission-lab 의 L1 정렬 토글.
 *
 * 확인 항목
 *  1) 「모아보기」에서 정렬 토글 두 개(조별 순서 / 비슷한 것끼리)가 보인다
 *  2) 「비슷한 것끼리」를 누르면 카드 DOM 순서가 실제로 바뀐다
 *  3) 정렬을 바꿔도 카드 수가 그대로다(화면 표시 수 · 실제 article 수 둘 다)
 *  4) 같은 문장을 낸 다른 조 카드가 이웃이 된다
 *  5) 안내 문구가 화면에 있다
 *  6) supabase 요청 0건 · 콘솔 에러 0건
 */
import { chromium } from 'playwright';

const BASE = 'http://localhost:4477';
const URL = `${BASE}/ko/moderator/insights/submission-lab/`;

const supabaseRequests = [];
const consoleErrors = [];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } });
page.on('request', (r) => {
  if (/supabase/i.test(r.url())) supabaseRequests.push(r.url());
});
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text());
});
page.on('websocket', (ws) => supabaseRequests.push(`WS ${ws.url()}`));

await page.goto(URL, { waitUntil: 'networkidle' });
await page.getByRole('button', { name: '모아보기' }).click();
await page.waitForSelector('article');

const teamBtn = page.getByRole('button', { name: '조별 순서' });
const simBtn = page.getByRole('button', { name: '비슷한 것끼리' });
const results = {};
results.toggleVisible = (await teamBtn.count()) === 1 && (await simBtn.count()) === 1;

const readCards = () => page.$$eval('article', (els) => els.map((e) => e.querySelector('p')?.textContent?.trim() ?? ''));
const readTeams = () => page.$$eval('article', (els) => els.map((e) => e.querySelector('span')?.textContent?.trim() ?? ''));
const readCountLabel = () => page.locator('[data-testid="note-count"]').innerText();

const beforeCards = await readCards();
const beforeTeams = await readTeams();
const beforeLabel = await readCountLabel();

await simBtn.click();
await page.waitForTimeout(300);
const afterCards = await readCards();
const afterTeams = await readTeams();
const afterLabel = await readCountLabel();

results.pressedAfterClick = (await simBtn.getAttribute('aria-pressed')) === 'true'
  && (await teamBtn.getAttribute('aria-pressed')) === 'false';
results.countUnchanged = beforeCards.length === afterCards.length;
results.labelUnchanged = beforeLabel === afterLabel;
results.labelText = afterLabel.replace(/\s+/g, ' ');
results.cardCount = afterCards.length;
results.orderChanged = beforeCards.join('|') !== afterCards.join('|');
results.samePermutation =
  JSON.stringify([...beforeCards].sort()) === JSON.stringify([...afterCards].sort());

// 같은 문장을 낸 서로 다른 조가 이웃이 되었는가 (원문 보존 + 유사도 배치의 눈에 보이는 증거)
const dupIdx = [];
afterCards.forEach((text, i) => {
  if (afterCards.indexOf(text) !== i) dupIdx.push([afterCards.indexOf(text), i]);
});
results.duplicatePairs = dupIdx.length;
results.duplicatePairsAdjacent = dupIdx.filter(([a, b]) => b - a === 1).length;
results.sampleAdjacent = dupIdx.slice(0, 3).map(([a, b]) => ({
  gap: b - a,
  team: [beforeTeams[a] ?? afterTeams[a], afterTeams[b]],
  text: afterCards[a].slice(0, 30),
}));

results.noticeShown = await page.getByText('배치만 바꿉니다').isVisible();

await page.screenshot({ path: 'evaluation/2026-08-27-submission-lab-us003-similar.png', fullPage: false });
await teamBtn.click();
await page.waitForTimeout(200);
const backCards = await readCards();
results.backToTeamOrder = backCards.join('|') === beforeCards.join('|');
results.backCount = backCards.length;
await page.screenshot({ path: 'evaluation/2026-08-27-submission-lab-us003-team.png', fullPage: false });

results.supabaseRequests = supabaseRequests;
results.consoleErrors = consoleErrors;

console.log(JSON.stringify(results, null, 2));
await browser.close();
