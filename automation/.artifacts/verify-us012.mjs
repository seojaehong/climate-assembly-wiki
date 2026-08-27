// US-012 브라우저 검증 — 온톨로지 검수 플랜(스냅샷) 내보내기 버튼.
// 사용: node automation/.artifacts/verify-us012.mjs   (dist 를 :4477 에 띄운 뒤)
import { chromium } from 'playwright';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const URL_BASE = 'http://localhost:4477/ko/moderator/insights/submission-lab/';
const OUT = 'evaluation';
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const NODE_ID = /^0829\/t\d{2}\/k1\/i\d{2}(\/r)?$/;

async function noteIds(page) {
  return page.$$eval('[data-testid="note-grid"] article', (els) =>
    els.map((el) => el.getAttribute('data-note-id')),
  );
}

async function counter(page) {
  const text = await page.locator('[data-testid="ontology-export-counter"]').innerText();
  const nums = [...text.matchAll(/(\d+)\s*장/g)].map((m) => Number(m[1]));
  return { text: text.replace(/\s+/g, ' ').trim(), submitted: nums[0], exported: nums[1], deleted: nums[2] };
}

async function download(page, dir) {
  const [dl] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('[data-testid="ontology-export-button"]').click(),
  ]);
  const name = dl.suggestedFilename();
  const path = join(dir, name);
  await dl.saveAs(path);
  return { name, snapshot: JSON.parse(readFileSync(path, 'utf8')) };
}

const browser = await chromium.launch();
const page = await browser.newPage({ acceptDownloads: true });
const supabaseCalls = [];
const consoleErrors = [];
page.on('request', (r) => {
  if (r.url().includes('supabase.co')) supabaseCalls.push(r.url());
});
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text());
});

const dir = mkdtempSync(join(tmpdir(), 'us012-'));
await page.goto(URL_BASE, { waitUntil: 'networkidle' });
await page.waitForSelector('[data-testid="ontology-export-panel"]');

// ── 1. 패널·버튼·카운터가 있다 (꼭지1, 전체 15개 조) ──────────────────────────
await page.locator('button[role="tab"]').first().click();
await page.waitForTimeout(200);
await page.locator('button:has-text("모아보기")').click();
await page.waitForTimeout(200);

const idsBefore = await noteIds(page);
check('꼭지1 모아보기 카드 27장', idsBefore.length === 27, `${idsBefore.length}장`);

const c1 = await counter(page);
check(
  '카운터 「원문 N장 · 내보냄 N장 · 삭제 0장」',
  c1.submitted === 27 && c1.exported === 27 && c1.deleted === 0,
  c1.text,
);
const btnText = await page.locator('[data-testid="ontology-export-button"]').innerText();
check('버튼 라벨', btnText.includes('온톨로지 검수로 내보내기'), btnText);
check(
  '버튼이 활성이고 이유 문구가 없다',
  (await page.locator('[data-testid="ontology-export-button"]').isEnabled()) &&
    (await page.locator('[data-testid="ontology-export-reason"]').count()) === 0,
);
check('경고 색이 아니다(삭제 0)', (await page.locator('[data-testid="ontology-export-alert"]').count()) === 0);

// ── 2. 누르면 파일이 내려온다 ────────────────────────────────────────────────
const first = await download(page, dir);
check('파일명에 꼭지(k1)와 시각이 들어간다', /k1/.test(first.name) && /2026/.test(first.name), first.name);
check('파일명에 금지 문자(:)가 없다', !first.name.includes(':'), first.name);

const agenda = first.snapshot.payload.agenda;
const links = first.snapshot.payload.agenda_link;
const content = agenda.filter((a) => !a.id.endsWith('/r'));
check('근거가 아닌 행 27개 = 화면 카드 27장', content.length === 27, `${content.length}행`);
check('모든 노드 id 가 0829/t{2}/k1/i{2}(+/r) 규격', agenda.every((a) => NODE_ID.test(a.id)),
  agenda.find((a) => !NODE_ID.test(a.id))?.id ?? '전부 일치');
check('group_id 가 전부 빈 값(null) — 미리 묶어 보내지 않는다', agenda.every((a) => a.group_id === null));
check('parent_id 도 전부 null', agenda.every((a) => a.parent_id === null));
check(
  '근거는 별도 행 + 링크로 나간다(relation 키 없음)',
  links.length > 0 && links.every((l) => !('relation' in l) && l.target_id + '/r' === l.source_id),
  `링크 ${links.length}개`,
);
check('taken_at·source 가 실려 있다', Boolean(first.snapshot.taken_at) && first.snapshot.source === 'climate_vote.submission_item',
  `${first.snapshot.source} / ${first.snapshot.taken_at}`);

// ── 3. 내보내기가 화면을 바꾸지 않는다 (읽기 전용) ───────────────────────────
const idsAfter = await noteIds(page);
const sameMultiset =
  idsBefore.length === idsAfter.length &&
  JSON.stringify([...idsBefore].sort()) === JSON.stringify([...idsAfter].sort());
check('내보낸 뒤 카드 id 다중집합이 동일하다(읽기 전용)', sameMultiset, `${idsAfter.length}장`);
const c2 = await counter(page);
check('카운터도 그대로', c2.submitted === 27 && c2.exported === 27 && c2.deleted === 0, c2.text);

// ── 4. 분과 필터가 걸려도 파일은 꼭지 전체다 ────────────────────────────────
await page.locator('button[aria-pressed]:has-text("2분과")').first().click();
await page.waitForTimeout(300);
const filteredIds = await noteIds(page);
check('분과 필터로 화면 카드가 줄었다', filteredIds.length > 0 && filteredIds.length < 27, `${filteredIds.length}장`);
check(
  '분과 안내 문구가 뜬다',
  (await page.locator('[data-testid="ontology-export-scope"]').count()) === 1,
  (await page.locator('[data-testid="ontology-export-scope"]').innerText().catch(() => '')).slice(0, 40),
);
const c3 = await counter(page);
check('카운터는 여전히 꼭지 전체(27/27/0)', c3.submitted === 27 && c3.exported === 27 && c3.deleted === 0, c3.text);

await page.screenshot({ path: `${OUT}/2026-08-28-submission-lab-us012-filtered.png`, fullPage: false });

const second = await download(page, dir);
const secondContent = second.snapshot.payload.agenda.filter((a) => !a.id.endsWith('/r'));
check('분과 필터 중에도 파일은 27행 그대로', secondContent.length === 27, `${secondContent.length}행`);
check(
  '★ 필터 전후 노드 id 다중집합이 정확히 같다 — 조 순번이 밀리지 않았다',
  JSON.stringify(secondContent.map((a) => a.id).sort()) === JSON.stringify(content.map((a) => a.id).sort()),
);
check('같은 순간이 아니어도 꼭지가 같으면 본문도 같다', JSON.stringify(secondContent.map((a) => a.text)) === JSON.stringify(content.map((a) => a.text)));

// ── 5. 꼭지2 는 다른 파일로 나간다 ──────────────────────────────────────────
await page.locator('button[aria-pressed]:has-text("전체 15개 조")').click();
await page.waitForTimeout(200);
await page.locator('button[role="tab"]').nth(1).click();
await page.waitForTimeout(300);
const c4 = await counter(page);
const k2Ids = await noteIds(page);
check('꼭지2 카운터가 그 꼭지 수를 따른다', c4.submitted === k2Ids.length && c4.deleted === 0, `${c4.text} / 화면 ${k2Ids.length}장`);
const third = await download(page, dir);
check('꼭지2 파일명은 k2 이고 꼭지1과 다르다', /k2/.test(third.name) && third.name !== first.name, third.name);
check(
  '꼭지2 노드는 전부 k2 이다 — 꼭지 간 누수 0',
  third.snapshot.payload.agenda.every((a) => /^0829\/t\d{2}\/k2\/i\d{2}(\/r)?$/.test(a.id)),
);

await page.locator('button[role="tab"]').first().click();
await page.waitForTimeout(300);
await page.screenshot({ path: `${OUT}/2026-08-28-submission-lab-us012-panel.png`, fullPage: false });
await page.screenshot({ path: `${OUT}/2026-08-28-submission-lab-us012-full.png`, fullPage: true });

check('supabase.co 요청 0건', supabaseCalls.length === 0, `${supabaseCalls.length}건`);
check('콘솔 에러 0건', consoleErrors.length === 0, consoleErrors.slice(0, 2).join(' | '));

await browser.close();

const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed}/${results.length} PASS`);
writeFileSync(`${OUT}/2026-08-28-us012-verify.json`, JSON.stringify({ passed, total: results.length, results }, null, 2));
process.exit(passed === results.length ? 0 : 1);
