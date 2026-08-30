/**
 * 「새로고침해도 쓰던 글이 남는가」 드라이런 — 실화면. **저장하지 않는다.**
 *
 *   (터미널 1) npx astro preview            # dist/ 를 그대로 서빙한다
 *   (터미널 2) node scripts/verify-draft-survives-refresh.mjs --code 082901
 *
 * 왜 이 검사가 필요한가
 *   배포 감지 띠는 조에게 **새로고침을 시킨다.** 그때 입력 중이던 글이 날아가면 이
 *   수정은 이롭기는커녕 해롭다 — 8.29 통짜보다 나쁜 결함이 된다. 그러니 「띠가 뜬다」가
 *   아니라 **「띠 → 새로고침 → 글이 그대로 있다」를 화면에서 끝까지** 확인한다.
 *
 * 어떻게 배포를 바꾸나
 *   서빙 중인 `dist/deployment-revision.json` 의 커밋을 한 글자 바꾼다. 번들에 박힌
 *   커밋은 그대로이므로 화면 입장에서는 「내가 낡았다」와 정확히 같은 상황이다.
 *   끝나면 원래 값으로 되돌린다.
 *
 * 쓰기 없음 — 저장 버튼을 누르지 않는다. 서버로 가는 것은 읽기(topic_list·submission_get)뿐이다.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '../automation/node_modules/playwright/index.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const MANIFEST = resolve(HERE, '../dist/deployment-revision.json');
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

const TYPED = `드라이런 미저장 초안 ${Date.now()}`;

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

const original = readFileSync(MANIFEST, 'utf8');
const originalCommit = JSON.parse(original).sourceCommit;
const changedCommit = `${originalCommit.slice(0, 39)}${originalCommit[39] === 'a' ? 'b' : 'a'}`;

const browser = await chromium.launch({ headless: !HEADED });
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
let saveCalls = 0;
// ★ 「저장 버튼이 보인다」로 저장 안 했다고 판정하면 안 된다 — 버튼 존재는 네트워크가
//   아니다. 실제 RPC 요청 수를 센다(Supabase 는 /rest/v1/rpc/submission_save 로 간다).
page.on('request', (r) => {
  if (/\/rpc\/submission_(save|finalize)/.test(r.url())) saveCalls += 1;
});
let dialogs = 0;
page.on('dialog', async (d) => {
  dialogs += 1;
  await d.dismiss();
});

try {
  console.log(`\n새로고침 초안 보존 드라이런 · ${BASE} · 조 ${CODE} · 저장하지 않음\n`);
  await page.goto(`${BASE}/mod?code=${CODE}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3_000);

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

  await check('배포가 그대로면 띠가 없다 (거짓 경보 없음)', async () => {
    const body = await page.locator('body').innerText();
    must(!/화면이 갱신되었습니다/.test(body), '바뀐 게 없는데 띠가 떴다');
    return null;
  });

  await check('★ 저장하지 않은 글을 적는다', async () => {
    const box = area.locator('textarea:not([readonly])').last();
    await box.click();
    await box.fill(TYPED);
    await page.waitForTimeout(600);
    must((await box.inputValue()) === TYPED, '입력이 안 들어갔다');
    return `${TYPED.length}자 · 저장 안 누름`;
  });

  await check('★ 배포가 바뀌면 띠가 뜬다', async () => {
    writeFileSync(MANIFEST, `${JSON.stringify({ schemaVersion: 1, sourceCommit: changedCommit })}\n`);
    // 탭 복귀 경로로 즉시 확인시킨다(90초 주기를 기다리지 않는다).
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await page.waitForSelector('text=화면이 갱신되었습니다', { timeout: 15_000 });
    return `${originalCommit.slice(0, 8)}… → ${changedCommit.slice(0, 8)}…`;
  });

  await check('★ 띠의 새로고침 버튼을 누른다 — 겁주는 창이 뜨지 않는다', async () => {
    const before = dialogs;
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle', timeout: 30_000 }),
      page.getByRole('button', { name: '새로고침' }).first().click(),
    ]);
    must(dialogs === before, `이탈 경고 대화상자가 ${dialogs - before}번 떴다`);
    return '대화상자 0회';
  });

  await check('★★ 새로고침 뒤에도 쓰던 글이 그대로 있다', async () => {
    await page.waitForTimeout(4_000);
    const values = await page.locator('textarea').evaluateAll((els) => els.map((e) => e.value));
    must(values.includes(TYPED), `${values.length}개 칸 어디에도 없다 — 글이 날아갔다`);
    return `칸 ${values.length}개 중 1개에 원문 그대로`;
  });

  await check('저장은 여전히 안 눌렀다 — 서버에 아무것도 안 갔다', async () => {
    must(saveCalls === 0, `submission_save/finalize 요청이 ${saveCalls}번 나갔다`);
    return `저장·최종제출 RPC 요청 ${saveCalls}건`;
  });
} finally {
  writeFileSync(MANIFEST, original); // 매니페스트 원복
  await browser.close();
  console.log(`\n결과: ${pass} PASS · ${fail} FAIL  (${pass}/${pass + fail})\n`);
  process.exit(fail === 0 ? 0 : 1);
}
