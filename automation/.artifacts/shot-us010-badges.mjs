// 배지 세 겹(대표 · 닮은 짝 · 잠정 범주)이 한 포스트잇에 얹혔을 때 본문이 읽히는지 눈으로 보기 위한 스크린샷.
import { chromium } from 'playwright';

const URL = 'http://localhost:4477/ko/moderator/insights/submission-lab/';
const OUT = 'C:/Users/iceam/OneDrive/_30_컨설팅/2026/기후회의모더레이터/wiki/evaluation';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } });
await page.goto(URL, { waitUntil: 'networkidle' });
await page.click('button[aria-pressed="false"]:has-text("모아보기")');
await page.waitForSelector('[data-testid="note-grid"]');

// 짝 1·3 을 표시하고 패널을 편다
const pairButtons = await page.$$('[data-testid="pair-row"] button[aria-pressed="false"]');
await pairButtons[0].click();
await pairButtons[2].click();
await page.click('[data-testid="representative-toggle"]');
await page.waitForTimeout(250);

// 짝 1 의 두 번째 카드를 대표로 지목
const gid = await page.getAttribute('[data-testid="representative-group"]:first-child', 'data-group-id');
const ids = await page.$$eval('[data-testid="representative-group"]:first-child [data-testid="representative-candidate"]',
  (els) => els.map((e) => e.dataset.noteId));
const target = ids[1];
await page.click(`[data-testid="representative-group"][data-group-id="${gid}"] [data-testid="representative-pick-button"][data-note-id="${target}"]`);
await page.waitForSelector('[data-testid="representative-dialog"]');
await page.screenshot({ path: `${OUT}/2026-08-28-submission-lab-us010-dialog.png` });
await page.fill('[data-testid="representative-actor-label"]', '1분과 2조 시민들');
await page.check('[data-testid="representative-citizen-confirm"]');
await page.click('[data-testid="representative-confirm"]');
await page.waitForTimeout(300);

// 같은 카드에 범주까지 얹는다 → 배지 세 겹
await page.click(`[data-testid="note-grid"] article[data-note-id="${target}"] button[data-category="common"]`);
await page.waitForTimeout(250);
const card = await page.$(`[data-testid="note-grid"] article[data-note-id="${target}"]`);
await card.scrollIntoViewIfNeeded();
await page.waitForTimeout(200);
await card.screenshot({ path: `${OUT}/2026-08-28-submission-lab-us010-badges.png` });
console.log('badge card =', target);

await browser.close();
