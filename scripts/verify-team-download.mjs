/**
 * 조 산출물 내려받기 드라이런 — 워드·엑셀·줄글이 실제로 파일로 떨어지는지,
 * 그리고 「전부 받기(.zip)」 한 번이 그 셋을 **같은 내용으로** 담아 오는지.
 *
 * ★ 형식마다 **새 페이지**로 연다. 한 페이지에서 연달아 누르면 앞 다운로드의
 *   잔재(busy·revokeObjectURL 경합)와 섞여 원인이 안 갈린다.
 *
 *   (터미널 1) npx astro preview --port 4331   또는  npx astro dev --port 4321
 *   (터미널 2) node scripts/verify-team-download.mjs [--base http://localhost:4331]
 */
import { chromium } from '../automation/node_modules/playwright/index.mjs';
import { mkdirSync, statSync, readFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';

const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > -1 ? process.argv[i + 1] : d;
};
const BASE = arg('base', 'http://localhost:4331');
const URL_LAB = `${BASE}/ko/moderator/insights/submission-panel-lab/`;
const OUT = '.tmp-verify/downloads';
const SHOT = '.tmp-verify';
mkdirSync(OUT, { recursive: true });

let pass = 0, fail = 0, known = 0;
const check = async (name, fn) => {
  try { const d = await fn(); console.log(`  PASS  ${name}${d ? ' — ' + d : ''}`); pass++; }
  catch (e) { console.log(`  FAIL  ${name} — ${String(e.message).split('\n')[0]}`); fail++; }
};
/** 우리가 못 고치는 것(브라우저 정책·화면 관례)을 재는 참고 항목 — 결과에 남기되 종료코드는 흔들지 않는다. */
const note = async (name, fn) => {
  try { const d = await fn(); console.log(`  참고 PASS  ${name}${d ? ' — ' + d : ''}`); known++; }
  catch (e) { console.log(`  참고 알려진실패  ${name} — ${String(e.message).split('\n')[0]}`); known++; }
};
const must = (c, m) => { if (!c) throw new Error(m); };

// ── ZIP 읽기 ────────────────────────────────────────────────────────────
// 겉봉 ZIP 은 무압축(store, `src/islands/mod/zip-store.ts`)이고, 그 안의 .docx 는
// 그 자체가 deflate ZIP 이다. 두 경우를 다 읽어야 문서 본문까지 대조할 수 있다.
const u16 = (b, o) => b[o] | (b[o + 1] << 8);
const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
function unzip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i -= 1) if (u32(buf, i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('ZIP 이 아니다 — EOCD 서명을 못 찾았다');
  const count = u16(buf, eocd + 10);
  let p = u32(buf, eocd + 16);
  const out = [];
  for (let i = 0; i < count; i += 1) {
    if (u32(buf, p) !== 0x02014b50) throw new Error('중앙 디렉터리 서명이 깨졌다');
    const method = u16(buf, p + 10);
    const compressed = u32(buf, p + 20);
    const nameLen = u16(buf, p + 28), extraLen = u16(buf, p + 30), cmtLen = u16(buf, p + 32);
    const off = u32(buf, p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    const start = off + 30 + u16(buf, off + 26) + u16(buf, off + 28);
    const raw = buf.subarray(start, start + compressed);
    out.push({ name, method, data: method === 8 ? inflateRawSync(raw) : Buffer.from(raw) });
    p += 46 + nameLen + extraLen + cmtLen;
  }
  return out;
}
/**
 * 개별 내려받기와 ZIP 안 파일은 **서로 다른 순간**에 만들어져 문서에 찍힌 시각이 분 단위로
 * 갈릴 수 있다. 시각만 가리고 나머지가 한 글자도 안 달라야 「같은 문서」다.
 */
const normStamp = (s) => s.replace(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}/g, '«시각»');
/** .docx 본문. docProps 는 Packer 가 현재 시각을 박는 자리라 대조 대상이 아니다. */
const docxBody = (bytes) => {
  const doc = unzip(bytes).find((e) => e.name === 'word/document.xml');
  if (!doc) throw new Error('docx 안에 word/document.xml 이 없다');
  return normStamp(doc.data.toString('utf8'));
};

// ⚠️ 형식 버튼은 **이름 앞머리로** 고른다(`/^워드/`). 「전부 받기」 버튼의 접근성 이름에
//    부제 「워드·엑셀·줄글 세 파일을 한 번에」가 들어가 `/워드/` 로는 그쪽이 먼저 잡힌다(실측).
const browser = await chromium.launch();
let rpcTotal = 0;

for (const [label, ext] of [[/^워드/, 'docx'], [/^엑셀/, 'csv'], [/^줄글/, 'txt']]) {
  await check(`${ext} — 새 페이지에서 눌러 파일이 떨어진다`, async () => {
    const ctx = await browser.newContext({ acceptDownloads: true });
    const page = await ctx.newPage();
    await page.route('**/rest/v1/**', (r) => { rpcTotal++; r.abort(); });
    await page.goto(URL_LAB, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: /내려받기/ }).first().click();
    const [dl] = await Promise.all([
      page.waitForEvent('download', { timeout: 20000 }),
      page.getByRole('button', { name: label }).first().click(),
    ]);
    const p = `${OUT}/out.${ext}`;
    await dl.saveAs(p);
    const size = statSync(p).size;
    must(size > 100, `파일이 ${size}바이트다`);
    must(dl.suggestedFilename().endsWith('.' + ext), `확장자 ${dl.suggestedFilename()}`);
    if (ext !== 'docx') {
      const t = readFileSync(p, 'utf8');
      must(t.trim().length > 30, '내용이 비었다');
    }
    await ctx.close();
    return `${dl.suggestedFilename()} · ${size}B`;
  });
}

// ── ★ 전부 받기(.zip) — 클릭 한 번에 세 파일 ────────────────────────────
let bundle = null;
await check('★ 전부 받기 — 한 번 눌러 .zip 이 떨어진다', async () => {
  const ctx = await browser.newContext({ acceptDownloads: true });
  const page = await ctx.newPage();
  await page.route('**/rest/v1/**', (r) => { rpcTotal++; r.abort(); });
  await page.goto(URL_LAB, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /내려받기/ }).first().click();
  await page.locator('[data-testid="team-download-zip"]').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${SHOT}/team-download-menu.png`, fullPage: false });
  const [dl] = await Promise.all([
    page.waitForEvent('download', { timeout: 20000 }),
    page.getByRole('button', { name: /전부 받기/ }).first().click(),
  ]);
  const p = `${OUT}/bundle.zip`;
  await dl.saveAs(p);
  const size = statSync(p).size;
  must(dl.suggestedFilename().endsWith('.zip'), `확장자 ${dl.suggestedFilename()}`);
  must(size > 1000, `파일이 ${size}바이트다`);
  bundle = unzip(readFileSync(p));
  await ctx.close();
  return `${dl.suggestedFilename()} · ${size}B`;
});

await check('★ ZIP 안에 워드·엑셀·줄글 3개가 들어 있다', async () => {
  must(bundle != null, '앞 검사가 실패해 ZIP 이 없다');
  must(bundle.length === 3, `${bundle.length}개다`);
  const names = bundle.map((e) => e.name);
  must(names.every((n) => /^기후시민회의_조별산출물_.+_\d{8}-\d{4}\.(docx|csv|txt)$/.test(n)), `이름 규칙 위반 — ${names.join(' · ')}`);
  must(names.map((n) => n.split('.').pop()).join() === 'docx,csv,txt', `순서·확장자 — ${names.join(' · ')}`);
  const stamps = new Set(names.map((n) => n.match(/_(\d{8}-\d{4})\./)[1]));
  must(stamps.size === 1, `세 파일의 시각이 갈렸다 — ${[...stamps].join(' · ')}`);
  return names.join(' · ');
});

await check('★ ZIP 안 내용이 개별 내려받기와 같다', async () => {
  must(bundle != null, '앞 검사가 실패해 ZIP 이 없다');
  const inZip = Object.fromEntries(bundle.map((e) => [e.name.split('.').pop(), e.data]));

  // 엑셀·줄글 — 텍스트로 한 글자까지 대조(BOM 포함).
  for (const ext of ['csv', 'txt']) {
    const alone = readFileSync(`${OUT}/out.${ext}`, 'utf8');
    must(normStamp(inZip[ext].toString('utf8')) === normStamp(alone), `${ext} 가 다르다`);
  }
  // 워드 — docProps 의 생성 시각은 매번 달라지므로 본문(word/document.xml)을 대조한다.
  must(docxBody(inZip.docx) === docxBody(readFileSync(`${OUT}/out.docx`)), 'docx 본문이 다르다');

  // 불변식 — 어떤 내보내기에서도 카드 수가 줄지 않는다 · 미제출 조 표기가 빠지지 않는다.
  const rows = (t) => t.split('\r\n').filter((l) => l.length > 0).length;
  const zipCsv = inZip.csv.toString('utf8');
  const aloneCsv = readFileSync(`${OUT}/out.csv`, 'utf8');
  must(rows(zipCsv) === rows(aloneCsv), `CSV 줄 수 ${rows(zipCsv)} ≠ ${rows(aloneCsv)}`);
  must(zipCsv.includes('미제출') === aloneCsv.includes('미제출'), '미제출 표기가 한쪽에만 있다');
  must(inZip.txt.toString('utf8').includes('미제출') === readFileSync(`${OUT}/out.txt`, 'utf8').includes('미제출'), '줄글 미제출 표기가 한쪽에만 있다');
  return `CSV ${rows(zipCsv)}줄 · docx 본문 일치`;
});

// ── 참고 · 연달아 내려받기 ───────────────────────────────────────────────
// 이 항목은 **우리가 고치는 대상이 아니라 재는 대상**이라 종료코드에 넣지 않는다.
//
//  · 실측(2026-09-01): 이 랩에서 실패하는 직접 원인은 브라우저 차단이 아니라 **메뉴가 닫히는 것**이다.
//    개별 내려받기가 성공하면 `setOpen(false)` 로 메뉴가 접혀 다음 형식의 버튼이 DOM 에서 사라진다.
//    메뉴를 다시 열고 누르면 두 번째도 떨어진다(프로브로 확인).
//  · 현장에서 남는 위험은 따로 있다 — 크롬·엣지는 한 페이지가 자동 다운로드를 연달아 걸면
//    「여러 파일 내려받기」를 물어보고, 거절되면 **조용히** 막는다(`a.click()` 은 성공한다).
//    Playwright 는 `acceptDownloads` 로 그 물음을 건너뛰므로 이 스크립트로는 재현되지 않는다.
//  · 두 경우 모두 「전부 받기(.zip)」은 **클릭 한 번 = 다운로드 한 개**라 경계에 닿지 않는다.
//    그래서 고친 것은 이 항목이 아니라 위의 ★ 세 검사다.
await note('참고 · 같은 페이지에서 워드 → 엑셀 → 줄글 연달아', async () => {
  const ctx = await browser.newContext({ acceptDownloads: true });
  const page = await ctx.newPage();
  await page.route('**/rest/v1/**', (r) => { rpcTotal++; r.abort(); });
  await page.goto(URL_LAB, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /내려받기/ }).first().click();
  const got = [];
  for (const [label, ext] of [[/^워드/, 'docx'], [/^엑셀/, 'csv'], [/^줄글/, 'txt']]) {
    try {
      const [dl] = await Promise.all([
        page.waitForEvent('download', { timeout: 15000 }),
        page.getByRole('button', { name: label }).first().click(),
      ]);
      got.push(ext);
      await dl.saveAs(`${OUT}/seq.${ext}`);
    } catch {
      throw new Error(`연속 ${got.length + 1}번째(${ext})가 안 떨어졌다 — 받은 것: ${got.join(', ') || '없음'}`);
    }
  }
  await ctx.close();
  return got.join(' → ');
});

// 두 번째 개별 내려받기부터는 다음에 할 일(=전부 받기)이 화면에 남아야 한다.
await check('★ 개별을 두 번 받으면 「전부 받기」 안내가 뜬다', async () => {
  const ctx = await browser.newContext({ acceptDownloads: true });
  const page = await ctx.newPage();
  await page.route('**/rest/v1/**', (r) => { rpcTotal++; r.abort(); });
  await page.goto(URL_LAB, { waitUntil: 'networkidle' });
  const hint = page.locator('[data-testid="team-download-multi-hint"]');
  for (const label of [/^워드/, /^엑셀/]) {
    await page.getByRole('button', { name: /내려받기/ }).first().click();
    const [dl] = await Promise.all([
      page.waitForEvent('download', { timeout: 20000 }),
      page.getByRole('button', { name: label }).first().click(),
    ]);
    await dl.saveAs(`${OUT}/hint.${label.source.includes('워드') ? 'docx' : 'csv'}`);
    if (label.source.includes('워드')) must(await hint.count() === 0, '한 번 받았을 뿐인데 안내가 떴다');
  }
  await page.waitForTimeout(300);
  must(await hint.count() === 1, '두 번 받았는데 안내가 없다');
  const text = (await hint.innerText()).trim();
  must(text.includes('전부 받기 (.zip)'), `안내가 다음에 할 일을 안 가리킨다 — ${text}`);
  await hint.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${SHOT}/team-download-hint.png`, fullPage: false });
  await ctx.close();
  return text;
});

await check('운영 DB 로 나간 요청 0건', async () => {
  must(rpcTotal === 0, `${rpcTotal}건 새어 나갔다`);
  return '가로챈 요청 0';
});

await browser.close();
console.log(`\n결과: ${pass} PASS · ${fail} FAIL  (${pass}/${pass + fail}) · 참고 ${known}건`);
if (pass + fail === 0) { console.error('FAIL: 검사를 한 건도 못 돌았다 — 서버가 떠 있는지 확인하라.'); process.exit(1); }
process.exit(fail === 0 ? 0 : 1);
