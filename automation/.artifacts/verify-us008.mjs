import { chromium } from 'playwright';
import fs from 'node:fs';

const URL = 'http://localhost:4477/ko/moderator/insights/submission-lab/';
const OUT = 'C:/Users/iceam/OneDrive/_30_컨설팅/2026/기후회의모더레이터/wiki/evaluation';
const results = [];
const check = (name, ok, extra = '') => {
  results.push({ name, ok, extra });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ' -- ' + extra : ''}`);
};

const gridIds = (page) =>
  page.$$eval('[data-testid="note-grid"] article', (els) =>
    els.map((e) => e.getAttribute('data-note-id')).sort(),
  );

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } });
const supabaseReqs = [];
const consoleErrors = [];
page.on('request', (r) => { if (r.url().includes('supabase.co')) supabaseReqs.push(r.url()); });
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForSelector('[data-testid="preservation-counter"]');

const counterText = () => page.textContent('[data-testid="preservation-counter"]');
const nums = async () => {
  const el = await page.$('[data-testid="preservation-counter"]');
  const raw = (await el.innerText()).replace(/\s+/g, ' ');
  const m = raw.match(/원문 (\d+)장 · 배정 (\d+)장 · 미배정 (\d+)장 · 삭제 (\d+)장/);
  return m ? { original: +m[1], assigned: +m[2], unassigned: +m[3], deleted: +m[4], raw } : { raw };
};

// 1. 카운터가 조별 뷰(기본)에서 보인다
let t = await counterText();
check('조별 뷰에 보존 카운터 표시', /원문/.test(t) && /배정/.test(t) && /미배정/.test(t) && /삭제/.test(t));

let n = await nums();
check('AC 문자열 「원문 N장 · 배정 M장 · 미배정 K장 · 삭제 0장」 그대로', n.original !== undefined, n.raw.slice(0, 70));
check('초기값 = 원문 27 · 배정 0 · 미배정 27 · 삭제 0', n.original === 27 && n.assigned === 0 && n.unassigned === 27 && n.deleted === 0, JSON.stringify(n.original));
check('삭제 0장', n.deleted === 0);

// 2. 4범주 패널 + 다섯 번째 칸(미배정)
const cols = await page.$$eval('[data-testid="category-column"]', (els) => els.map((e) => e.dataset.category));
check('범주 칸 5개(공통·차이·갈등·질문 + 미배정)', cols.join(',') === 'common,difference,conflict,question,unassigned', cols.join(','));
const panelText = (await page.textContent('[data-testid="four-category-panel"]')).replace(/\s+/g, ' ');
check('「시민 검토 전에는 확정이 아닙니다」 문구', panelText.includes('시민 검토 전에는 확정이 아닙니다'));
check('미배정 칸에 27장', panelText.includes('미배정 27장'));

// 3. 모아보기 → 카드 27장 기준선
await page.click('button[aria-pressed="false"]:has-text("모아보기")');
await page.waitForSelector('[data-testid="note-grid"]');
const before = await gridIds(page);
check('모아보기 카드 27장', before.length === 27, `${before.length}장`);
t = await counterText();
check('모아보기에서도 카운터 표시(항상 보임)', /원문/.test(t));

// 4. 카드마다 범주 버튼 네 개 · 드래그 없음
const btnCounts = await page.$$eval('[data-testid="note-grid"] article', (els) =>
  els.map((e) => e.querySelectorAll('[data-testid="category-buttons"] button').length));
check('카드 27장 모두 범주 버튼 4개', btnCounts.length === 27 && btnCounts.every((c) => c === 4), `[${[...new Set(btnCounts)].join(',')}]`);
const labels = await page.$$eval('[data-testid="note-grid"] article:first-child [data-testid="category-buttons"] button',
  (els) => els.map((e) => e.textContent.trim()));
check('버튼 순서 공통·차이·갈등·질문 고정', labels.join(',') === '공통,차이,갈등,질문', labels.join(','));
const draggables = await page.$$eval('[draggable="true"]', (els) => els.length);
check('드래그 요소 0개(드래그는 쓰지 않는다)', draggables === 0, `${draggables}개`);

// 5. 배정 -- 첫 카드를 「공통」으로
const firstId = before[0];
const firstCard = `[data-testid="note-grid"] article[data-note-id="${firstId}"]`;
await page.click(`${firstCard} button[data-category="common"]`);
await page.waitForTimeout(150);
n = await nums();
check('배정 1건 후 배정 1 · 미배정 26 · 삭제 0', n.assigned === 1 && n.unassigned === 26 && n.deleted === 0, JSON.stringify(n.raw).slice(0, 60));
const badge = (await page.textContent(`${firstCard} [data-testid="category-badge"]`)).trim();
check('카드에 「잠정 · 공통」 배지', badge === '잠정 · 공통', badge);
const pressed = await page.getAttribute(`${firstCard} button[data-category="common"]`, 'aria-pressed');
check('누른 버튼 aria-pressed=true', pressed === 'true');

let after = await gridIds(page);
check('★ 배정 후 카드 27장 불변 + id 다중집합 동일', after.length === 27 && after.join('|') === before.join('|'));

// 6. 여러 범주로 배정
await page.click(`[data-testid="note-grid"] article[data-note-id="${before[1]}"] button[data-category="conflict"]`);
await page.click(`[data-testid="note-grid"] article[data-note-id="${before[2]}"] button[data-category="question"]`);
await page.click(`[data-testid="note-grid"] article[data-note-id="${before[3]}"] button[data-category="difference"]`);
await page.waitForTimeout(150);
n = await nums();
check('4건 배정 후 배정 4 · 미배정 23 · 삭제 0', n.assigned === 4 && n.unassigned === 23 && n.deleted === 0, n.raw.slice(0, 60));
const memberIds = await page.$$eval('[data-testid="category-member"]', (els) => els.map((e) => e.dataset.noteId).sort());
check('★ 패널 칸 합계 = 원문 27장(네 범주 + 미배정)', memberIds.length === 27 && memberIds.join('|') === before.join('|'), `${memberIds.length}장`);
after = await gridIds(page);
check('★ 4건 배정 후에도 카드 27장 다중집합 동일', after.join('|') === before.join('|'));
await page.screenshot({ path: `${OUT}/2026-08-28-submission-lab-us008-assigned.png` });

// 7. 갈아타기 -- 두 범주에 겹치지 않는다
await page.click(`[data-testid="note-grid"] article[data-note-id="${before[1]}"] button[data-category="common"]`);
await page.waitForTimeout(150);
const badges = await page.$$eval(`[data-testid="note-grid"] article[data-note-id="${before[1]}"] [data-testid="category-badge"]`, (e) => e.length);
check('갈아타면 배지는 여전히 1개(겹치지 않음)', badges === 1, `${badges}개`);
n = await nums();
check('갈아타도 배정 수 그대로 4', n.assigned === 4, n.raw.slice(0, 60));

// 8. 해제 -- 같은 버튼 재클릭
await page.click(`${firstCard} button[data-category="common"]`);
await page.waitForTimeout(150);
n = await nums();
check('해제하면 배정 3 · 미배정 24 · 삭제 0', n.assigned === 3 && n.unassigned === 24 && n.deleted === 0, n.raw.slice(0, 60));
const gone = await page.$$eval(`${firstCard} [data-testid="category-badge"]`, (e) => e.length);
check('해제한 카드에 배지 없음', gone === 0);
after = await gridIds(page);
check('★ 해제 후에도 카드 27장 다중집합 동일 -- 해제는 삭제가 아니다', after.join('|') === before.join('|'));

// 9. 미배정 강조
const unassignedCls = await page.getAttribute('[data-testid="unassigned-count"]', 'class');
check('미배정 > 0 이면 강조 색', /FFF4D6|B5651D/.test(unassignedCls));

// 10. 패널 접기 -> 카운터는 남는다
await page.click('[data-testid="four-category-panel"] button[aria-expanded="true"]');
await page.waitForTimeout(150);
check('패널을 접어도 보존 카운터는 남는다', (await page.$('[data-testid="preservation-counter"]')) !== null);
const collapsed = (await page.textContent('[data-testid="four-category-panel"]')).replace(/\s+/g, ' ');
check('접어도 「잠정」 주의 문구가 남는다', collapsed.includes('시민 검토 전에는 확정이 아닙니다'));
check('접어도 미배정 수가 보인다', /미배정 \d+장이 남아 있습니다/.test(collapsed));
await page.click('[data-testid="four-category-panel"] button[aria-expanded="false"]');
await page.waitForTimeout(150);

// 11. 조별 뷰에서도 배정이 따라간다
await page.click('button[aria-pressed="false"]:has-text("조별")');
await page.waitForTimeout(250);
const groupedBadges = await page.$$eval('[data-testid="category-badge"]', (e) => e.length);
check('조별 뷰에도 배정 배지가 따라간다', groupedBadges >= 3, `${groupedBadges}개`);
n = await nums();
check('조별 뷰 카운터도 배정 3 유지 · 삭제 0', n.assigned === 3 && n.deleted === 0, n.raw.slice(0, 60));
await page.screenshot({ path: `${OUT}/2026-08-28-submission-lab-us008-grouped.png` });

// 12. 꼭지 전환 -- 다른 꼭지 배정이 오탐으로 잡히지 않는다
const tabs = await page.$$('[role="tab"]');
await tabs[1].click();
await page.waitForTimeout(300);
n = await nums();
check('꼭지2 = 원문 21 · 배정 0 · 미배정 21 · 삭제 0(다른 꼭지 배정이 오탐 안 됨)',
  n.original === 21 && n.assigned === 0 && n.unassigned === 21 && n.deleted === 0, n.raw.slice(0, 60));
await tabs[0].click();
await page.waitForTimeout(300);
n = await nums();
check('꼭지1로 돌아오면 배정 3 그대로', n.original === 27 && n.assigned === 3 && n.deleted === 0, n.raw.slice(0, 60));

// 13. 정렬 병행
await page.click('button[aria-pressed="false"]:has-text("모아보기")');
await page.waitForTimeout(200);
await page.click('button:has-text("비슷한 것끼리")');
await page.waitForTimeout(250);
after = await gridIds(page);
n = await nums();
check('★ 정렬 + 배정 병행해도 카드 27장 다중집합 동일 · 삭제 0', after.join('|') === before.join('|') && n.deleted === 0);
await page.screenshot({ path: `${OUT}/2026-08-28-submission-lab-us008-counter.png`, clip: { x: 0, y: 0, width: 1600, height: 760 } });

// 14. 네트워크·콘솔
check('supabase.co 요청 0건', supabaseReqs.length === 0, supabaseReqs.join(','));
check('콘솔 에러 0건', consoleErrors.length === 0, consoleErrors.slice(0, 2).join(' | '));

await browser.close();
const pass = results.filter((r) => r.ok).length;
console.log(`\n${pass}/${results.length} PASS`);
fs.writeFileSync(`${OUT}/2026-08-28-us008-verify.json`, JSON.stringify(results, null, 2), 'utf8');
process.exit(pass === results.length ? 0 : 1);
