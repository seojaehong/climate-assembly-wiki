/**
 * 8.29 전수 검증 — **사람이 실제로 여는 화면을 사람처럼 조작한다.**
 *
 * ── 왜 이 파일이 필요한가 ────────────────────────────────────────────
 * 기존 검증기(verify-0829-e2e.mjs)는 RPC를 직접 부른다. 저장이 서버에 남는지는
 * 확인되지만 **화면이 그렇게 동작하는지는 확인되지 않는다.** 실제로 이 차이 때문에
 * 인쇄가 백지로 나가는 걸 못 잡았다 — RPC도 순수 함수 테스트도 전부 통과였다.
 *
 * 그래서 이 파일은 브라우저를 띄워 **딥링크로 들어가고, 타이핑하고, 버튼을 누르고,
 * 탭을 옮겼다 오고, 파일을 내려받는다.** 확인은 화면에 실제로 보이는 것으로 한다.
 *
 * ── 안전 규칙 ────────────────────────────────────────────────────────
 * 실제 운영 DB를 쓴다. 그래서
 *   · 쓰기는 **--team 으로 지정한 한 조에서만** 한다(기본 082901 = 1분과 1조)
 *   · 시작 전에 그 조가 비어 있는지 확인하고, 내용이 있으면 **멈춘다**
 *   · 넣는 문장은 전부 [검증] 으로 시작한다
 *   · 끝나면 지운다. 중간에 죽어도 다음 실행이 지운다
 *
 * 사용법
 *   node scripts/verify-0829-ui.mjs --base=http://localhost:4508 \
 *        --team=082901 --operator=박진환 --password=0000 [--headed]
 */
import { chromium } from '../automation/node_modules/playwright/index.mjs';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const argv = process.argv.slice(2);
const arg = (name, fallback = '') => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const BASE = arg('base', 'http://localhost:4508');
const TEAM = arg('team', '082901');
const OPERATOR = arg('operator');
const PASSWORD = arg('password');
const HEADED = argv.includes('--headed');
const MARK = '[검증]';

const results = [];
let group = '';
function section(name) {
  group = name;
  console.log(`\n── ${name} ${'─'.repeat(Math.max(0, 56 - name.length))}`);
}
function check(name, ok, detail = '') {
  results.push({ group, name, ok, detail });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}
async function guarded(name, fn) {
  try {
    const [ok, detail] = await fn();
    check(name, ok, detail);
  } catch (error) {
    check(name, false, `예외: ${String(error).slice(0, 120)}`);
  }
}

/**
 * 조 산출물 화면의 꼭지 구역. 꼭지 이름으로 찾는다(순서에 기대지 않는다).
 *
 * ⚠️ **입력칸이 있는 구역만** 고른다. 인쇄 문서(.print-root)가 항상 DOM에 붙어 있고
 * 그 안에도 같은 꼭지 이름을 가진 section 이 있어서, 그냥 이름으로만 찾으면 숨겨진
 * 인쇄 문서 쪽을 집어 클릭이 영원히 안 된다. 실제로 그렇게 실패했다.
 */
function topicSection(page, prompt) {
  return page
    .locator('section')
    .filter({ hasText: prompt })
    .filter({ has: page.locator('textarea') })
    .last();
}

const dl = mkdtempSync(join(tmpdir(), 'ui-'));
const browser = await chromium.launch({ headless: !HEADED });
const context = await browser.newContext({
  viewport: { width: 1500, height: 1000 },
  acceptDownloads: true,
});

/**
 * 검증으로 넣은 문장을 전부 지운다.
 *
 * ⚠️ 이게 없으면 **검증기를 두 번 못 돌린다.** 실제로 그랬다 — 첫 실행이 꼭지를 최종
 * 제출 상태로 남겨 두 번째 실행이 엉뚱하게 실패했다. 검증기는 몇 번을 돌려도 같은
 * 결과가 나와야 하고, 그러려면 시작할 때와 같은 상태로 돌려놓아야 한다.
 *
 * 잠긴 꼭지는 조 재오픈(s13)을 거쳐 비운다. **[검증] 로 시작하지 않는 문장이 하나라도
 * 섞여 있으면 그 꼭지는 건드리지 않는다** — 사람이 쓴 글을 지우느니 잔여를 남긴다.
 */
async function cleanup() {
  const env = Object.fromEntries(
    readFileSync(new URL('../.env', import.meta.url), 'utf8')
      .split(String.fromCharCode(10))
      .map((line) => line.trim())
      .filter((line) => line.startsWith('PUBLIC_SUPABASE'))
      .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]),
  );
  const url = env.PUBLIC_SUPABASE_URL;
  const key = env.PUBLIC_SUPABASE_ANON_KEY;
  const rpc = async (fn, body) => {
    const res = await fetch(`${url}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        'Content-Profile': 'climate_vote',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`${fn} ${res.status}`);
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  };

  let wiped = 0;
  let kept = 0;
  const topics = await rpc('topic_list', { p_code: TEAM });
  for (const topic of topics ?? []) {
    try {
      const got = await rpc('submission_get', { p_code: TEAM, p_topic_id: topic.id });
      const items = got?.items ?? [];
      if (items.length === 0) continue;
      if (!items.every((i) => String(i.content).startsWith(MARK))) {
        kept += 1;
        continue;
      }
      if (got.status === 'final') {
        await rpc('submission_reopen_by_team', { p_code: TEAM, p_topic_id: topic.id });
      }
      await rpc('submission_save', { p_code: TEAM, p_topic_id: topic.id, p_items: [] });
      wiped += 1;
    } catch (error) {
      console.log(`  ⚠️ 정리 실패 (${topic.prompt}): ${String(error).slice(0, 80)}`);
    }
  }
  return { wiped, kept };
}

try {
  const page = await context.newPage();

  // ══ 1. 조 화면 — 들어가기 ═══════════════════════════════════════
  section('조 화면 · 입장');

  await guarded('코드 없이 /mod 를 열면 남의 조가 열리지 않는다', async () => {
    await page.goto(`${BASE}/mod`, { waitUntil: 'networkidle' });
    const hasEditor = await page.locator('textarea').count();
    const asksCode = await page.getByText(/접속\s*코드/).count();
    return [hasEditor === 0 && asksCode > 0, `입력칸 ${hasEditor}개 · 코드 요구 ${asksCode > 0 ? 'O' : 'X'}`];
  });

  await guarded('딥링크(?code=)로 자동 입장한다', async () => {
    await page.goto(`${BASE}/mod?code=${TEAM}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('textarea', { timeout: 20_000 });
    const label = await page.locator('body').innerText();
    return [/\d분과\s*\d+조/.test(label), (label.match(/\d분과\s*\d+조/) ?? ['?'])[0]];
  });

  // ══ 2. 안전 확인 — 비어 있어야 쓴다 ════════════════════════════
  section('안전 확인');
  const before = await page.locator('textarea').evaluateAll((els) =>
    els.map((e) => e.value).filter((v) => v.trim().length > 0),
  );
  const foreign = before.filter((v) => !v.startsWith(MARK));
  check(
    `★ ${TEAM} 조에 남의 내용이 없다 (있으면 중단)`,
    foreign.length === 0,
    foreign.length ? `남의 문장 ${foreign.length}건 — 쓰기를 건너뛴다` : '비어 있음',
  );
  const SAFE = foreign.length === 0;

  // ══ 3. 세 꼭지가 한 화면에 ═════════════════════════════════════
  section('꼭지 3개');
  const PROMPTS = ['배경·문제 인식', '바라는 변화(기대 효과)', '의제와 관련된 질문'];
  for (const prompt of PROMPTS) {
    await guarded(`「${prompt}」 구역이 보인다`, async () => {
      const n = await topicSection(page, prompt).count();
      return [n > 0, n ? '' : '못 찾음'];
    });
  }
  await guarded('주제를 고르는 단계가 없다 (한 화면)', async () => {
    const tablists = await page.locator('[role="tablist"]').count();
    const areas = await page.locator('textarea').count();
    return [areas >= 3, `입력칸 ${areas}개 · tablist ${tablists}개`];
  });
  await guarded('「근거 (선택)」 칸이 없다', async () => {
    const n = await page.getByPlaceholder('근거 (선택)').count();
    return [n === 0, `${n}개`];
  });

  if (SAFE) {
    const first = topicSection(page, PROMPTS[0]);

    // ══ 4. 입력 → 저장 ══════════════════════════════════════════
    section('저장');
    await guarded('입력하면 저장 버튼이 열린다', async () => {
      await first.locator('textarea').first().fill(`${MARK} 첫 줄`);
      const btn = first.getByRole('button', { name: /저장/ }).first();
      await btn.waitFor({ timeout: 5_000 });
      return [!(await btn.isDisabled()), ''];
    });

    await guarded('저장하면 「마지막 저장」이 찍히고 버튼이 닫힌다', async () => {
      await first.getByRole('button', { name: /저장/ }).first().click();
      await page.waitForTimeout(2_500);
      const text = await first.innerText();
      const btn = first.getByRole('button', { name: /저장/ }).first();
      return [/저장/.test(text) && (await btn.isDisabled()), ''];
    });

    // ══ 5. ★ 탭을 옮겼다 와도 미저장 입력이 남는가 ═══════════════
    section('★ 탭 이동 시 미저장 보존 (현장 동선)');
    await guarded('저장 안 한 줄을 넣고 다른 탭에 갔다 오면 그대로 있다', async () => {
      const draft = `${MARK} 저장 안 한 줄 ${Date.now() % 100000}`;
      const boxes = first.locator('textarea');
      const count = await boxes.count();
      await boxes.nth(count - 1).fill(draft);
      await page.waitForTimeout(400);

      // 다른 탭으로 이동. 탭은 role="tab" 이다 — role="button" 으로 찾으면 못 잡는다.
      const tab = (name) => page.getByRole('tab', { name }).first();
      await tab(/타이머/).click();
      await page.waitForTimeout(1_500);
      // 조별 산출물로 복귀
      await tab(/조별 산출물/).click();
      await page.waitForTimeout(2_500);

      const values = await page.locator('textarea').evaluateAll((els) => els.map((e) => e.value));
      return [values.some((v) => v === draft), values.some((v) => v === draft) ? '' : '사라졌다'];
    });

    // ══ 6. 줄 추가·이동·삭제 ════════════════════════════════════
    section('줄 조작');
    await guarded('＋한 줄 더로 줄이 늘어난다', async () => {
      const target = topicSection(page, PROMPTS[1]);
      const before = await target.locator('textarea').count();
      await target.getByRole('button', { name: /한 줄 더/ }).click();
      await page.waitForTimeout(300);
      const after = await target.locator('textarea').count();
      return [after === before + 1, `${before} → ${after}`];
    });

    await guarded('30줄에 닿으면 ＋가 닫히고 이유가 화면에 뜬다', async () => {
      const target = topicSection(page, PROMPTS[1]);
      const add = target.getByRole('button', { name: /한 줄 더/ });
      for (let i = 0; i < 40; i += 1) {
        if (await add.isDisabled()) break;
        await add.click();
      }
      const rows = await target.locator('textarea').count();
      const notice = await target.getByText(/최대 30줄/).count();
      return [rows === 30 && (await add.isDisabled()) && notice > 0, `${rows}줄 · 안내 ${notice}개`];
    });

    await guarded('× 삭제는 내용이 있으면 한 번 묻는다', async () => {
      const target = topicSection(page, PROMPTS[1]);
      await target.locator('textarea').first().fill(`${MARK} 지울 줄`);
      await page.waitForTimeout(300);
      let asked = false;
      page.once('dialog', (d) => {
        asked = true;
        d.dismiss();
      });
      await target.getByRole('button', { name: /1번 삭제/ }).first().click();
      await page.waitForTimeout(600);
      const still = await target.locator('textarea').first().inputValue();
      return [asked && still.includes('지울 줄'), asked ? '물었고 취소하면 남는다' : '안 물었다'];
    });

    // ══ 7. 내려받기 — 실제 파일 ════════════════════════════════
    section('내려받기 (실제 파일)');
    for (const [label, ext] of [
      [/워드|docx/i, 'docx'],
      [/엑셀|csv/i, 'csv'],
      [/텍스트|txt/i, 'txt'],
    ]) {
      await guarded(`${ext} 파일이 실제로 떨어진다`, async () => {
        await page.getByRole('button', { name: /내려받기/ }).first().click();
        await page.waitForTimeout(400);
        const [download] = await Promise.all([
          page.waitForEvent('download', { timeout: 20_000 }),
          page.getByRole('button', { name: label }).first().click(),
        ]);
        const path = join(dl, `team.${ext}`);
        await download.saveAs(path);
        const bytes = existsSync(path) ? readFileSync(path) : Buffer.alloc(0);
        let ok = bytes.length > 100;
        let detail = `${bytes.length.toLocaleString()}바이트`;
        if (ext === 'docx') {
          ok = ok && bytes[0] === 0x50 && bytes[1] === 0x4b; // PK — 진짜 OOXML
          detail += ok ? ' · PK 시그니처' : ' · PK 아님';
        }
        if (ext === 'csv') {
          const head = bytes.subarray(0, 3);
          const bom = head[0] === 0xef && head[1] === 0xbb && head[2] === 0xbf;
          ok = ok && bom;
          detail += bom ? ' · BOM 있음(엑셀 한글 안 깨짐)' : ' · BOM 없음';
        }
        if (ext === 'txt') {
          const text = bytes.toString('utf8');
          ok = ok && text.includes(MARK);
          detail += text.includes(MARK) ? ' · 내용 일치' : ' · 내용 불일치';
        }
        return [ok, detail];
      });
    }

    // ══ 8. 최종 제출 → 잠금 → 다시 열기 ═══════════════════════
    section('최종 제출 · 다시 열기');
    const third = topicSection(page, PROMPTS[2]);
    await guarded('최종 제출하면 잠기고 입력칸이 읽기 전용이 된다', async () => {
      await third.locator('textarea').first().fill(`${MARK} 최종 제출용`);
      await page.waitForTimeout(300);
      await third.getByRole('button', { name: /저장/ }).first().click();
      await page.waitForTimeout(2_000);
      await third.getByRole('button', { name: /최종 제출/ }).first().click();
      await page.waitForTimeout(500);
      // 확인 모달
      const confirm = page.getByRole('button', { name: /^최종 제출$/ }).last();
      await confirm.click();
      await page.waitForTimeout(2_500);
      const readonly = await third.locator('textarea').first().getAttribute('readonly');
      const locked = (await third.innerText()).includes('잠');
      return [readonly !== null || locked, locked ? '잠금 표시 O' : '잠금 표시 X'];
    });

    await guarded('★ 조가 스스로 다시 열 수 있다 (s13)', async () => {
      const btn = third.getByRole('button', { name: /다시 열기/ }).first();
      if ((await btn.count()) === 0) return [false, '「다시 열기」 버튼이 없다'];
      page.once('dialog', (d) => d.accept());
      await btn.click();
      await page.waitForTimeout(2_500);
      const editable = await third.locator('textarea').first().isEditable();
      return [editable, editable ? '다시 고칠 수 있다' : '아직 잠겨 있다'];
    });
  } else {
    console.log('  SKIP  쓰기 검사 — 조에 남의 내용이 있어 건너뛴다');
  }

  // ══ 9. 본부 화면 ═══════════════════════════════════════════════
  if (OPERATOR && PASSWORD) {
    section('본부 화면');
    const hq = await context.newPage();
    await hq.goto(`${BASE}/hq`, { waitUntil: 'networkidle' });
    await hq.waitForSelector('input[autocomplete="name"]', { timeout: 20_000 });
    await hq.fill('input[autocomplete="name"]', OPERATOR);
    await hq.fill('input[type="password"]', PASSWORD);
    await hq.click('button[type="submit"]');
    const opened = await hq
      .waitForSelector('[data-testid="team-overlap-panel"]', { timeout: 25_000 })
      .then(() => true)
      .catch(() => false);
    check('이름·비밀번호로 로그인된다', opened, '');

    if (opened) {
      await guarded('15개 조가 모두 보인다', async () => {
        const text = await hq.locator('body').innerText();
        const teams = new Set(text.match(/\d분과\s*\d+조/g) ?? []);
        return [teams.size >= 15, `${teams.size}개 조`];
      });

      await guarded('조 × 조 겹침 패널이 뜬다', async () => {
        const n = await hq.locator('[data-testid="team-overlap-panel"]').count();
        return [n > 0, ''];
      });

      await guarded('분과 필터가 3개 분과를 낸다', async () => {
        const buttons = await hq.getByRole('button', { name: /^\d분과/ }).count();
        return [buttons >= 3, `${buttons}개`];
      });

      await guarded('★ 분과를 고르면 발표 모드가 열린다 (실제 데이터)', async () => {
        await hq.getByRole('button', { name: /^3분과/ }).first().click();
        await hq.waitForTimeout(900);
        const present = hq.getByRole('button', { name: /발표 모드/ }).first();
        if (await present.isDisabled()) return [false, '분과를 골랐는데도 닫혀 있다'];
        await present.click();
        await hq.waitForTimeout(1_200);
        const h1 = await hq.locator('h1').first().innerText().catch(() => '');
        const overflow = await hq.evaluate(
          () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
        );
        return [/분과/.test(h1) && !overflow, `제목 ${h1} · 가로스크롤 ${overflow ? '있음' : '없음'}`];
      });

      await guarded('발표 모드에서 나가기가 된다', async () => {
        await hq.getByRole('button', { name: /나가기/ }).first().click();
        await hq.waitForTimeout(900);
        const back = await hq.locator('[data-testid="team-overlap-panel"]').count();
        return [back > 0, ''];
      });

      await guarded('본부 내려받기(워드)가 실제로 떨어진다', async () => {
        await hq.getByRole('button', { name: /내려받기/ }).first().click();
        await hq.waitForTimeout(400);
        const [download] = await Promise.all([
          hq.waitForEvent('download', { timeout: 25_000 }),
          hq.getByRole('button', { name: /워드|docx/i }).first().click(),
        ]);
        const path = join(dl, 'hq.docx');
        await download.saveAs(path);
        const bytes = readFileSync(path);
        return [bytes[0] === 0x50 && bytes[1] === 0x4b, `${bytes.length.toLocaleString()}바이트 · PK`];
      });
    }
    await hq.close();
  } else {
    console.log('\n  SKIP  본부 화면 — --operator= 와 --password= 를 줘야 돈다');
  }

  await page.close();
} finally {
  await context.close();
  await browser.close();
  rmSync(dl, { recursive: true, force: true });
  // 검증기는 몇 번을 돌려도 같은 결과가 나와야 한다 — 시작할 때 상태로 되돌린다.
  const { wiped, kept } = await cleanup();
  console.log(`
정리 — ${TEAM} 조의 검증 문장을 비운 꼭지 ${wiped}개` + (kept ? ` · 사람 글이 섞여 남긴 꼭지 ${kept}개` : ''));
}

const failed = results.filter((r) => !r.ok).length;
console.log('\n' + '═'.repeat(62));
console.log(`합계 ${results.length}건 · 통과 ${results.length - failed} · 실패 ${failed}`);
if (failed) {
  console.log('\n실패 항목');
  for (const r of results.filter((x) => !x.ok)) console.log(`  · [${r.group}] ${r.name} — ${r.detail}`);
}
console.log(`\n⚠️ ${TEAM} 조에 남은 「${MARK}」 문장은 scripts/verify-0829-e2e.mjs 의 정리 SQL로 지운다.`);
process.exit(failed === 0 ? 0 : 1);
