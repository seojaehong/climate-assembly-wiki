import { chromium } from 'playwright';
const OUT = 'C:/Users/iceam/OneDrive/_30_컨설팅/2026/기후회의모더레이터/wiki/evaluation';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
await page.goto('http://localhost:4477/ko/moderator/insights/submission-lab/', { waitUntil: 'networkidle' });
await page.getByRole('button', { name: '모아보기' }).click();
await page.waitForSelector('[data-testid="pair-row"]');
const rows = page.locator('[data-testid="pair-row"]');
await rows.nth(0).getByRole('button', { name: /표시/ }).click();
await rows.nth(10).getByRole('button', { name: /표시/ }).click();
// 짝 1 과 짝 11 은 1분과 1조 카드를 공유한다 → 한 카드에 번호표 두 개가 붙는 모습을 본다.
await page.locator('[data-testid="similar-pairs-panel"]').getByRole('button', { name: '접기' }).click();
await page.locator('[data-testid="note-grid"]').scrollIntoViewIfNeeded();
await page.screenshot({ path: `${OUT}/2026-08-28-submission-lab-us005-badges.png` });
// 조별 뷰에서도 확인
await page.getByRole('button', { name: '조별' }).first().click();
await page.screenshot({ path: `${OUT}/2026-08-28-submission-lab-us005-grouped.png` });
await browser.close();
console.log('shots written');
