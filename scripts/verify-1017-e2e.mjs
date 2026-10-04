#!/usr/bin/env node
/**
 * 10/17 분과 의결 탭 — 운영 드라이런 E2E + 네거티브 전수.
 *
 * ★ 운영(climate-assembly.org + labor_money)을 친다. 반드시 전용 드라이런 세션에서만 돈다.
 *   세션·조 시드와 행 삭제는 이 스크립트가 하지 않는다(서비스 키를 쓰지 않는다).
 *   시드 → SEED_FILE(JSON), 정리 → 매니페스트(MANIFEST)에 적힌 id 만 SQL 로 지운다.
 *
 * ★ 실데이터(recs_1017.json)는 공표 전 자료다. 브라우저 「JSON 가져오기」로만 넣는다.
 *   로그에 권고 문장을 찍지 않는다. 표본은 번호로만 남긴다.
 *
 * 사용
 *   SEED_FILE=... RECS_FILE=... OUT_DIR=... node scripts/verify-1017-e2e.mjs             # 본 시험
 *   ... node scripts/verify-1017-e2e.mjs --phase=expired                                   # 만료 토큰(SQL 로 만료시킨 뒤)
 *   PLAYWRIGHT_MODULE=file:///.../playwright/index.mjs 로 Playwright 위치를 준다.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SITE = process.env.SITE ?? 'https://climate-assembly.org';
const EXPECT_COMMIT = process.env.EXPECT_COMMIT ?? '64d87dfd832c8df53808819346c148df56dce5af';
const SEED_FILE = process.env.SEED_FILE;
const RECS_FILE = process.env.RECS_FILE;
const OUT_DIR = process.env.OUT_DIR;
const SHOTS = process.env.SHOTS_DIR ?? join(OUT_DIR ?? '.', 'shots');
const PHASE = (process.argv.find((a) => a.startsWith('--phase=')) ?? '--phase=main').slice(8);
if (!SEED_FILE || !RECS_FILE || !OUT_DIR) {
  console.error('SEED_FILE, RECS_FILE, OUT_DIR 가 필요합니다.');
  process.exit(2);
}
mkdirSync(OUT_DIR, { recursive: true });
mkdirSync(SHOTS, { recursive: true });
const MANIFEST = join(OUT_DIR, 'manifest-1017.json');
const RESULTS = join(OUT_DIR, `results-1017-${PHASE}.json`);

// 공개 publishable 키 — 번들에 이미 실려 있다. 로그에는 찍지 않는다.
const SUPA_SRC = readFileSync(resolve(ROOT, 'src/lib/supabase.ts'), 'utf8');
const URL_BASE = /FALLBACK_URL = '([^']+)'/.exec(SUPA_SRC)[1];
const ANON = /FALLBACK_ANON =\s*'([^']+)'/.exec(SUPA_SRC)[1];

const seed = JSON.parse(readFileSync(SEED_FILE, 'utf8'));
const recs = JSON.parse(readFileSync(RECS_FILE, 'utf8'));

// ── 결과 기록 ────────────────────────────────────────────────
const results = [];
function record(id, ok, detail) {
  results.push({ id, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${id} — ${detail}`);
}
const manifest = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, 'utf8')) : { tokens: {}, ballots: [], clientIds: [], devices: [] };
function saveManifest() {
  writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2));
}

// ── RPC ──────────────────────────────────────────────────────
async function rpc(name, body) {
  const res = await fetch(`${URL_BASE}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: ANON,
      Authorization: `Bearer ${ANON}`,
      'Content-Type': 'application/json',
      'Accept-Profile': 'climate_vote',
      'Content-Profile': 'climate_vote',
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { ok: res.ok, status: res.status, data, message: res.ok ? '' : String(data?.message ?? text).slice(0, 200) };
}
async function login(teamKey) {
  const device = randomUUID();
  const r = await rpc('mod_exchange_join_code', { p_join_code: seed.teams[teamKey][1], p_device_id: device, p_device_label: 'dryrun-1017 script' });
  if (!r.ok || !r.data?.accessToken) throw new Error(`login ${teamKey} failed: ${r.status} ${r.message}`);
  manifest.tokens[teamKey] = { token: r.data.accessToken, device };
  manifest.devices.push(device);
  saveManifest();
  return r.data.accessToken;
}
const logout = (token) => rpc('workshop_team_logout_v2', { p_token: token });
const vote = (ballotToken, clientId, answers) => rpc('ballot_submit', { p_token: ballotToken, p_client_id: clientId, p_answers: answers });

// ── 실데이터 파생값(로그에 문장 금지) ─────────────────────────
const byDiv = Object.fromEntries(recs.map((d) => [d.division, d]));
const counts = (d) => ({
  topics: d.topics.length,
  cards: d.topics.reduce((n, t) => n + t.cards.length, 0),
  recs: d.topics.reduce((n, t) => n + t.cards.reduce((m, c) => m + c.recs.length, 0), 0),
});
const allRecTexts = recs.flatMap((d) => d.topics.flatMap((t) => t.cards.flatMap((c) => c.recs.map((r) => r.text))));
const SAMPLE_IDX = Array.from({ length: 20 }, (_, i) => Math.floor((i * allRecTexts.length) / 20) + 3);

// ── 브라우저 ─────────────────────────────────────────────────
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const browser = await chromium.launch({ headless: true });
const bundles = new Map(); // url → body (운영에서 받은 js)
const supabaseHits = { lab: [] };
const pageErrors = {};

async function newCtx(name, { viewport = { width: 1440, height: 900 }, blockStorage = false } = {}) {
  const ctx = await browser.newContext({ viewport, locale: 'ko-KR', acceptDownloads: true });
  if (blockStorage) {
    await ctx.addInitScript(() => {
      const thrower = () => {
        throw new DOMException('blocked for test', 'SecurityError');
      };
      for (const key of ['localStorage', 'sessionStorage']) {
        try {
          Object.defineProperty(window, key, { configurable: true, get: thrower });
        } catch {
          /* ignore */
        }
      }
    });
  }
  pageErrors[name] = [];
  ctx.on('response', async (res) => {
    const u = res.url();
    if (u.startsWith(SITE) && /\.m?js(\?|$)/.test(u) && !bundles.has(u)) {
      try {
        bundles.set(u, await res.text());
      } catch {
        /* body gone */
      }
    }
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => pageErrors[name].push(String(e.message).slice(0, 200)));
  page.on('dialog', async (d) => {
    page.__dialogs = [...(page.__dialogs ?? []), d.message()];
    if (page.__dismissNext) {
      page.__dismissNext = false;
      await d.dismiss();
    } else await d.accept();
  });
  return { ctx, page };
}

/** 대형 화면 검사 — 보이는 글자 덩어리의 크기·화면 밖·겹침. */
async function layoutAudit(page, rootSel, minFont) {
  return page.evaluate(
    ({ rootSel, minFont }) => {
      const root = document.querySelector(rootSel);
      if (!root) return { missing: true };
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const leaves = [];
      for (const el of root.querySelectorAll('*')) {
        const hasText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
        if (!hasText) continue;
        const cs = getComputedStyle(el);
        if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 1 || r.height < 1) continue;
        leaves.push({ el, r, font: parseFloat(cs.fontSize), text: el.textContent.trim().slice(0, 24) });
      }
      const small = leaves.filter((l) => l.font < minFont).map((l) => `${l.font}px:${l.text}`);
      const off = leaves
        .filter((l) => l.r.left < -1 || l.r.top < -1 || l.r.right > vw + 1 || l.r.bottom > vh + 1)
        .map((l) => l.text);
      const overlaps = [];
      for (let i = 0; i < leaves.length; i++) {
        for (let j = i + 1; j < leaves.length; j++) {
          const a = leaves[i];
          const b = leaves[j];
          if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
          const w = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
          const h = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
          if (w > 2 && h > 2) overlaps.push(`${a.text} × ${b.text}`);
        }
      }
      const scroll = document.documentElement.scrollWidth > vw + 1;
      return { leaves: leaves.length, small, off, overlaps, hScroll: scroll };
    },
    { rootSel, minFont },
  );
}

async function importFile(page, filePath) {
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: 'JSON 가져오기' }).click()]);
  await chooser.setFiles(filePath);
  await page.waitForTimeout(600);
}
async function panelCounts(page) {
  return page.evaluate(() => {
    const p = document.querySelector('[data-testid=division-vote-panel]');
    const topics = p.querySelectorAll('[data-testid=division-topic]').length;
    const cards = p.querySelectorAll('li[data-card-no]').length;
    let recsN = 0;
    for (const s of p.querySelectorAll('summary')) {
      const m = /권고 (\d+)건/.exec(s.textContent);
      if (m) recsN += Number(m[1]);
    }
    const tally = p.querySelector('[data-testid=division-status-tally]')?.textContent ?? '';
    return { topics, cards, recs: recsN, tally };
  });
}
async function storageSnapshot(page) {
  return page.evaluate(() => {
    try {
      const o = {};
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k.includes('1017')) o[k] = localStorage.getItem(k);
      }
      return JSON.stringify(o);
    } catch (e) {
      return `ERR ${e}`;
    }
  });
}
const noticeText = (page) => page.locator('[data-testid=division-vote-panel] p[role=alert], [data-testid=division-vote-panel] p[role=status]').first().textContent().catch(() => '');
const divBtn = (page, d) => page.getByRole('button', { name: `${d}분과`, exact: true });
const viewTab = (page, name) => page.locator('[data-testid=division-vote-panel]').getByRole('tab', { name, exact: true });

async function makeMotion(page, cardNos, title, text = '') {
  for (const no of cardNos) await page.locator(`li[data-card-no="${no}"] input[type=checkbox]`).check();
  await page.getByLabel('안 제목', { exact: true }).fill(title);
  await page.getByLabel('안 문안', { exact: true }).fill(text);
  await page.getByRole('button', { name: '의결안 만들기' }).click();
  await page.waitForTimeout(200);
}

/** 세리머니를 판정·요약까지 진행하며 단계마다 콜백. */
async function runCeremony(page, onStep) {
  const dlg = page.locator('[data-testid=division-ceremony]');
  await dlg.waitFor();
  await onStep('intro');
  const next = page.locator('[data-testid=ceremony-next]');
  for (let guard = 0; guard < 40; guard++) {
    const phase = await dlg.getAttribute('data-phase');
    if (phase === 'summary') break;
    if (await next.isDisabled()) return 'blocked';
    await next.click();
    await page.waitForTimeout(150);
    const p2 = await dlg.getAttribute('data-phase');
    if (p2 === 'title') await onStep('title');
    if (p2 === 'bar') {
      await next.click(); // 애니메이션 건너뛰고 도장
      await page.waitForTimeout(700);
      await onStep('verdict');
    }
    if (p2 === 'summary') await onStep('summary');
  }
  return 'done';
}

// ── 공통 상태 ────────────────────────────────────────────────
let mainBallot = null; // {id, token}
// 「투표」 탭·「10/17 의결」 목록에서 투표 하나를 id 로 정확히 고른다 — .first() 는 다른 투표를 누른다.
const ballotCard = (page, id) => page.locator(`[data-ballot-id="${id}"]`);
const S = {};

async function phaseMain() {
  // ═══ P1 배포 반영 ═══
  {
    const rev = await (await fetch(`${SITE}/deployment-revision.json`, { cache: 'no-store' })).json();
    const html = await (await fetch(`${SITE}/mod/`, { cache: 'no-store' })).text();
    const m = /_astro\/ModConsole\.[A-Za-z0-9_-]+\.js/.exec(html);
    let has = false;
    if (m) {
      const js = await (await fetch(`${SITE}/${m[0]}`)).text();
      has = js.includes('10/17 의결') || js.includes('10/17 \\uC758\\uACB0');
      S.modBundle = m[0];
    }
    record('P1', rev.sourceCommit === EXPECT_COMMIT && has, `sourceCommit=${rev.sourceCommit.slice(0, 7)} · ${m ? m[0] : 'ModConsole 번들 못 찾음'} · 「10/17 의결」 ${has ? '있음' : '없음'}`);
  }

  // ═══ 미리보기(lab) — P2·P3(1분과)·N4·N5·N13 ═══
  const L = await newCtx('lab');
  L.page.on('request', (rq) => {
    if (/supabase\.co/.test(rq.url())) supabaseHits.lab.push(rq.url());
  });
  {
    const resp = await L.page.goto(`${SITE}/ko/moderator/insights/division-vote-lab`, { waitUntil: 'networkidle' });
    await L.page.locator('[data-testid=division-vote-panel]').waitFor({ timeout: 20000 });
    const robots = await L.page.locator('meta[name=robots]').getAttribute('content');
    S.labStatus = resp.status();
    S.labRobots = robots;
  }
  // P3 — 실데이터 가져오기(1분과만 새로 들어가야 한다: 2·3분과는 가상 데이터가 먼저 있다)
  {
    await importFile(L.page, RECS_FILE);
    const note = await noticeText(L.page);
    await divBtn(L.page, 1).click();
    const c1 = await panelCounts(L.page);
    const e1 = counts(byDiv[1]);
    const ok = c1.topics === e1.topics && c1.cards === e1.cards && c1.recs === e1.recs;
    S.labP3 = { ok, c1, e1, note };
    await L.page.screenshot({ path: join(SHOTS, 'p3-lab-1분과.png') });
  }
  // N5 — 가져오기 거절
  {
    const bad = {
      깨진JSON: '{"division": 1, "topics": [',
      빈파일: '',
      빈배열: '[]',
      스키마불일치: JSON.stringify({ foo: 1 }),
      필드누락: JSON.stringify([{ division: 7, agenda: 'x', topics: [{ no: '7-1', name: 'x', written_by: '', raised_by: '', cards: [{ no: '7-1-1', recs: [] }] }] }]),
      분과불일치_준비판: JSON.stringify({ v: 1, division: 1, source: { ...byDiv[2] }, cards: {}, motions: [] }),
      버전불일치_준비판: JSON.stringify({ v: 2, division: 2, source: byDiv[2], cards: {}, motions: [] }),
      같은분과중복: JSON.stringify([byDiv[1], byDiv[1]]),
      깨진거대파일: '[' + '{"division":9,"agenda":"x","topics":[]},'.repeat(120000),
    };
    const rows = [];
    for (const [name, body] of Object.entries(bad)) {
      const f = join(OUT_DIR, `n5-${name}.json`);
      writeFileSync(f, body);
      const before = await storageSnapshot(L.page);
      const tBefore = await panelCounts(L.page);
      const errsBefore = pageErrors.lab.length;
      await importFile(L.page, f);
      const alert = await L.page.locator('[data-testid=division-vote-panel] p[role=alert]').first().textContent().catch(() => '');
      const after = await storageSnapshot(L.page);
      const tAfter = await panelCounts(L.page);
      const same = before === after && JSON.stringify(tBefore) === JSON.stringify(tAfter);
      rows.push({ name, rejected: !!alert, alert: alert.slice(0, 40), same, pageErr: pageErrors.lab.length - errsBefore });
    }
    S.n5 = rows;
    // 다른 분과의 정상 준비판 파일 — 거절 대상이 아니라 확인 대화상자로 교체한다(관찰). 취소하면 그대로인지.
    const other = join(OUT_DIR, 'n5-다른분과준비판.json');
    writeFileSync(other, JSON.stringify({ v: 1, division: 3, source: byDiv[3], cards: {}, motions: [] }));
    const before = await storageSnapshot(L.page);
    L.page.__dismissNext = true;
    await importFile(L.page, other);
    const after = await storageSnapshot(L.page);
    S.n5other = { cancelKeeps: before === after, dialogs: (L.page.__dialogs ?? []).slice(-1)[0] ?? '' };
  }
  // N5 — XSS(정상 모양 파일 안에 태그) · 거대 정상 파일
  {
    const xssDiv = {
      division: 5,
      agenda: '<img src=x onerror="window.__xss=1">',
      topics: [{ no: '5-1', name: '<img src=x onerror="window.__xss=2">', written_by: '<script>window.__xss=3</script>', raised_by: '', cards: [{ no: '5-1-1', title: '<img src=x onerror="window.__xss=4">', background: '', effect: '', schedule: '', recs: [{ no: '1', text: '<svg onload="window.__xss=5">' }] }] }],
    };
    const f = join(OUT_DIR, 'n5-xss.json');
    writeFileSync(f, JSON.stringify([xssDiv]));
    await importFile(L.page, f);
    await divBtn(L.page, 5).click();
    await L.page.locator('li[data-card-no="5-1-1"] summary').click();
    await L.page.waitForTimeout(300);
    const r = await L.page.evaluate(() => ({
      flag: window.__xss ?? null,
      imgs: document.querySelectorAll('[data-testid=division-vote-panel] img').length,
      svgs: document.querySelectorAll('[data-testid=division-vote-panel] svg[onload]').length,
      shownAsText: document.querySelector('li[data-card-no="5-1-1"]').textContent.includes('<img src=x'),
    }));
    S.xss = r;
    await L.page.screenshot({ path: join(SHOTS, 'n5-xss.png') });

    // 거대 정상 파일(약 5MB) — 상한 없음 확인, 멈추지 않는지
    const big = { division: 6, agenda: 'big', topics: [] };
    for (let t = 0; t < 40; t++) {
      const cards = [];
      for (let c = 0; c < 25; c++) cards.push({ no: `6-${t}-${c}`, title: `t${t}c${c}`, background: '', effect: '', schedule: '', recs: Array.from({ length: 5 }, (_, i) => ({ no: String(i), text: 'x'.repeat(1000) })) });
      big.topics.push({ no: `6-${t}`, name: `topic ${t}`, written_by: '', raised_by: '', cards });
    }
    const bf = join(OUT_DIR, 'n5-big.json');
    const body = JSON.stringify([big]);
    writeFileSync(bf, body);
    const t0 = Date.now();
    const errsBefore = pageErrors.lab.length;
    await importFile(L.page, bf);
    const note = await noticeText(L.page);
    const persistWarn = await L.page.getByText('저장소를 쓸 수 없어').count();
    S.big = { mb: (body.length / 1e6).toFixed(1), ms: Date.now() - t0, note: note.slice(0, 50), pageErr: pageErrors.lab.length - errsBefore, persistWarn };
    // 거대 분과는 지운다(뒤 시험이 무거워지지 않게) — 저장소에서 빼고 새로고침
    await L.page.evaluate(() => {
      try {
        localStorage.removeItem('lab:climate_1017_prep_v1:6');
        localStorage.removeItem('lab:climate_1017_prep_v1:5');
        localStorage.setItem('lab:climate_1017_prep_v1:division', '2');
      } catch {
        /* */
      }
    });
    await L.page.reload({ waitUntil: 'networkidle' });
    await L.page.locator('[data-testid=division-vote-panel]').waitFor();
  }
  // N4 · N13 — 세리머니 연습 모드(가상 2분과)
  {
    await divBtn(L.page, 2).click();
    await viewTab(L.page, '준비판').click();
    const firstCard = await L.page.locator('li[data-card-no]').first().getAttribute('data-card-no');
    const secondCard = await L.page.locator('li[data-card-no]').nth(1).getAttribute('data-card-no');
    await makeMotion(L.page, [firstCard], '경계 시험 안');
    const motionId = await L.page.locator('[data-testid=motion-card]').first().getAttribute('data-motion-id');
    await viewTab(L.page, '세리머니').click();
    const R = L.page.getByLabel('재적 R');
    const M = L.page.getByLabel('참석 M');
    const att = () => L.page.locator('[data-testid=division-attendance]').textContent();
    const n4 = [];
    const setRM = async (r, m) => {
      await R.fill(String(r));
      await M.fill(String(m));
      await L.page.waitForTimeout(80);
    };
    // 정족수 경계 30/31
    for (const m of [30, 31]) {
      await setRM(60, m);
      const text = await att();
      await L.page.getByLabel(`${motionId} 찬성 수`).fill('20');
      await L.page.locator('[data-testid=division-ceremony-start]').click();
      const established = await L.page.locator('[data-testid=ceremony-attendance]').getAttribute('data-established');
      const nextDisabled = await L.page.locator('[data-testid=ceremony-next]').isDisabled();
      await L.page.keyboard.press('ArrowRight');
      const phase = await L.page.locator('[data-testid=division-ceremony]').getAttribute('data-phase');
      if (m === 30) await L.page.screenshot({ path: join(SHOTS, 'n4-quorum-30of60.png') });
      await L.page.keyboard.press('Escape');
      n4.push({ case: `재적60 참석${m}`, text: text.slice(0, 30), established, nextDisabled, phaseAfterKey: phase });
    }
    // 가결 경계 40/60, 39/60 (참석 60)
    for (const y of [40, 39]) {
      await setRM(60, 60);
      await L.page.getByLabel(`${motionId} 찬성 수`).fill(String(y));
      await L.page.locator('[data-testid=division-ceremony-start]').click();
      let stamp = null;
      await runCeremony(L.page, async (step) => {
        if (step === 'verdict' && stamp === null) stamp = await L.page.locator('[data-testid=ceremony-stamp]').getAttribute('data-passed');
      });
      const summary = await L.page.locator('[data-testid=ceremony-summary]').textContent();
      await L.page.keyboard.press('Escape');
      n4.push({ case: `찬성${y}/참석60`, stamp, summary });
    }
    // 이상 입력
    const errsBefore = pageErrors.lab.length;
    for (const [r, m] of [[0, 0], [-5, 3], [60.5, 30], ['', 30], [60, ''], [60, -1], [60, 30.5], [60, 61], [60, 0]]) {
      await setRM(r, m);
      const text = await att();
      let ceremonyNote = '';
      await L.page.locator('[data-testid=division-ceremony-start]').click();
      if (await L.page.locator('[data-testid=division-ceremony]').count()) {
        ceremonyNote = `${await L.page.locator('[data-testid=ceremony-attendance]').getAttribute('data-established')}/${await L.page.locator('[data-testid=ceremony-next]').isDisabled()}`;
        await L.page.keyboard.press('Escape');
      }
      n4.push({ case: `R=${JSON.stringify(r)} M=${JSON.stringify(m)}`, text: text.slice(0, 34), ceremonyNote });
    }
    S.n4 = { rows: n4, pageErr: pageErrors.lab.length - errsBefore };

    // N13 — 키보드(안 2개로)
    await setRM(60, 45);
    await viewTab(L.page, '준비판').click();
    await makeMotion(L.page, [secondCard], '키보드 시험 안');
    await viewTab(L.page, '세리머니').click();
    await L.page.getByRole('button', { name: '무작위 채우기' }).click();
    await L.page.locator('[data-testid=division-ceremony-start]').click();
    const dlg = L.page.locator('[data-testid=division-ceremony]');
    const phase = () => dlg.getAttribute('data-phase');
    const k = [];
    k.push(['처음 장 「이전」 버튼 비활성', await L.page.getByRole('button', { name: '이전', exact: true }).isDisabled()]);
    await L.page.keyboard.press('ArrowLeft');
    k.push(['처음 장 ←', (await phase()) === 'intro']);
    await L.page.keyboard.press('PageUp');
    k.push(['처음 장 PageUp', (await phase()) === 'intro']);
    await L.page.keyboard.press('ArrowRight');
    k.push(['→ 안1 제목', (await phase()) === 'title']);
    await L.page.keyboard.press('ArrowLeft');
    k.push(['안1 제목에서 ← = 시작', (await phase()) === 'intro']);
    await L.page.keyboard.press('PageDown');
    await L.page.keyboard.press('PageDown');
    await L.page.keyboard.press('PageDown');
    k.push(['PageDown×3 = 안1 판정', (await phase()) === 'verdict']);
    for (let i = 0; i < 6 && (await phase()) !== 'summary'; i++) {
      await L.page.keyboard.press('ArrowRight');
      await L.page.waitForTimeout(100);
    }
    k.push(['끝까지 → 요약판', (await phase()) === 'summary']);
    k.push(['마지막 장 「다음」 없음·「마치기」 있음', (await L.page.locator('[data-testid=ceremony-next]').count()) === 0 && (await L.page.getByRole('button', { name: '마치기' }).count()) === 1]);
    await L.page.keyboard.press('ArrowRight');
    k.push(['마지막 장 → 무변화', (await phase()) === 'summary']);
    await L.page.keyboard.press('ArrowLeft');
    k.push(['요약판 ← = 마지막 안 판정', (await phase()) === 'verdict']);
    await L.page.keyboard.press('Escape');
    k.push(['ESC 닫힘', (await dlg.count()) === 0]);
    S.n13 = k;
  }
  S.labSupabase = supabaseHits.lab.length;
  S.labErrors = [...pageErrors.lab];
  await L.ctx.close();

  // ═══ RPC 로그인(조마다 기기 2대 상한 — 브라우저 1 + 스크립트 1) ═══
  const T2 = await login('2');
  const T3 = await login('3');
  const TX = await login('x');

  // ═══ P4 /mod 2분과 ═══
  const M2 = await newCtx('mod2', { viewport: { width: 1920, height: 1080 } });
  const pg = M2.page;
  await pg.goto(`${SITE}/mod?code=${seed.teams['2'][1]}`, { waitUntil: 'networkidle' });
  await pg.locator('#mod-tab-decision').waitFor({ timeout: 30000 });
  S.p7mod2DefaultTab = await pg.locator('[role=tab][aria-selected=true]').first().textContent();
  await pg.locator('#mod-tab-decision').click();
  await pg.locator('[data-testid=division-vote-panel]').waitFor();
  await importFile(pg, RECS_FILE);
  const realCounts = {};
  for (const d of [1, 2, 3]) {
    await divBtn(pg, d).click();
    realCounts[d] = await panelCounts(pg);
  }
  S.p3mod = realCounts;
  await pg.screenshot({ path: join(SHOTS, 'p3-mod-3분과.png') });
  await divBtn(pg, 2).click();
  const d2 = byDiv[2];
  const nonHw = d2.topics.filter((t) => !['2-14', '2-15', '2-16', '2-17'].includes(t.no));
  const mergeTopic = nonHw.find((t) => t.cards.length >= 2);
  const singleTopic = nonHw.find((t) => d2.topics.indexOf(t) > d2.topics.indexOf(mergeTopic));
  // N1 — 다른 주제 섞기
  {
    const before = await panelCounts(pg);
    const snapBefore = await storageSnapshot(pg);
    await pg.locator(`li[data-card-no="${mergeTopic.cards[0].no}"] input[type=checkbox]`).check();
    await pg.locator(`li[data-card-no="${singleTopic.cards[0].no}"] input[type=checkbox]`).check();
    await pg.getByLabel('안 제목', { exact: true }).fill('섞인 안');
    const alert = await pg.locator('[data-testid=motion-builder] [role=alert]').first().textContent().catch(() => '');
    const disabled = await pg.getByRole('button', { name: '의결안 만들기' }).isDisabled();
    await pg.getByRole('button', { name: '의결안 만들기' }).click({ force: true }).catch(() => {});
    await pg.waitForTimeout(200);
    const after = await panelCounts(pg);
    const snapAfter = await storageSnapshot(pg);
    S.n1 = { alert: alert.slice(0, 50), disabled, unchanged: JSON.stringify(before) === JSON.stringify(after) && snapBefore === snapAfter };
    await pg.getByRole('button', { name: '선택 해제' }).click();
  }
  // 통합안 1 + 단일안 1
  await makeMotion(pg, [mergeTopic.cards[0].no, mergeTopic.cards[1].no], `통합안 ${mergeTopic.cards[0].title || mergeTopic.name}`.slice(0, 60), '드라이런 문안');
  await makeMotion(pg, [singleTopic.cards[0].no], `단일안 ${singleTopic.cards[0].title || singleTopic.name}`.slice(0, 60), '드라이런 문안');
  const motions = await pg.locator('[data-testid=motion-card]').evaluateAll((els) => els.map((e) => e.getAttribute('data-motion-id')));
  const mergedTally = (await panelCounts(pg)).tally;
  S.motions = { ids: motions, tally: mergedTally, mergeTopic: mergeTopic.no, singleTopic: singleTopic.no };
  await pg.screenshot({ path: join(SHOTS, 'p4-prep-motions.png'), fullPage: false });
  // 투표 열기 → 확인 대화상자 → 만들기
  await viewTab(pg, '투표 열기').click();
  await pg.locator('[data-testid=division-ballot-create]').click();
  const dlgText = await pg.getByRole('dialog', { name: '투표 만들기 확인' }).textContent();
  await pg.screenshot({ path: join(SHOTS, 'p4-create-dialog.png') });
  await pg.getByRole('dialog', { name: '투표 만들기 확인' }).getByRole('button', { name: '만들기' }).click();
  await pg.getByText('투표 초안을 만들었습니다').waitFor({ timeout: 15000 });
  const list = await rpc('ballot_list_v2', { p_token: T2 });
  const mine = (list.data ?? []).filter((b) => b.subgroup === '2분과' && b.status === 'draft');
  mainBallot = mine[0] ? { id: mine[0].id, token: mine[0].token } : null;
  if (mainBallot) {
    manifest.ballots.push(mainBallot.id);
    saveManifest();
  }
  const res0 = mainBallot ? await rpc('ballot_results_v2', { p_ballot_token: mainBallot.token, p_token: T2 }) : null;
  const stmts = (res0?.data?.items ?? []).map((i) => i.statement.split(' ')[0]);
  S.p4create = { dialog: dlgText.slice(0, 60), count: mine.length, status: mine[0]?.status, items: mine[0]?.item_count, stmtIds: stmts, scales: (res0?.data?.items ?? []).map((i) => i.scale) };
  // 「투표」 탭에서 시작 → QR 자동
  await pg.locator('#mod-tab-vote').click();
  await ballotCard(pg, mainBallot.id).getByRole('button', { name: '투표 시작', exact: true }).click();
  await pg.getByRole('dialog').getByRole('button', { name: '투표 시작', exact: true }).click();
  await pg.waitForTimeout(1500);
  const bodyText = await pg.locator('body').innerText();
  const qm = /climate-assembly\.org\/b\?t=([0-9a-f]{32})/.exec(bodyText);
  S.p4qr = { url: qm ? qm[0].replace(/t=.*/, 't=…') : null, tokenMatch: !!qm && qm[1] === mainBallot?.token };
  await pg.screenshot({ path: join(SHOTS, 'p4-qr-fullscreen-1920.png') });
  S.p6qr = {};
  S.p6qr['1920'] = await layoutAudit(pg, 'div.fixed.inset-0.z-50', 0);
  await pg.setViewportSize({ width: 1280, height: 720 });
  await pg.waitForTimeout(300);
  S.p6qr['1280'] = await layoutAudit(pg, 'div.fixed.inset-0.z-50', 0);
  await pg.screenshot({ path: join(SHOTS, 'p6-qr-1280.png') });
  await pg.setViewportSize({ width: 1920, height: 1080 });
  await pg.keyboard.press('Escape');
  // 10/17 탭의 「QR 띄우기」도 열리는지
  await pg.locator('#mod-tab-decision').click();
  await viewTab(pg, '투표 열기').click();
  await pg.getByRole('button', { name: '새로고침' }).click();
  await pg.waitForTimeout(800);
  await ballotCard(pg, mainBallot.id).getByRole('button', { name: 'QR 띄우기' }).click();
  await pg.waitForTimeout(800);
  S.p4qr2 = /\/b\?t=([0-9a-f]{32})/.exec(await pg.locator('body').innerText())?.[1] === mainBallot?.token;
  await pg.keyboard.press('Escape');

  // N10a — 열린 동안 공개 결과 없음
  S.n10 = { open: (await rpc('ballot_results', { p_token: mainBallot.token })).data };

  // ═══ P5 투표 — 화면 3표 ═══
  const itemsRes = await rpc('ballot_get', { p_token: mainBallot.token });
  const items = itemsRes.data.items.sort((a, b) => a.ordinal - b.ordinal);
  const [i1, i2] = items.map((i) => i.id);
  const plans = [[2, 2], [2, 2], [1, 1]]; // 찬성=2, 반대=1
  const voters = [];
  for (let v = 0; v < 3; v++) {
    const V = await newCtx(`voter${v}`, { viewport: { width: 390, height: 844 } });
    await V.page.goto(`${SITE}/b?t=${mainBallot.token}`, { waitUntil: 'networkidle' });
    const groups = V.page.locator('[role=group][aria-label$="응답"]');
    await groups.first().waitFor({ timeout: 20000 });
    for (let k = 0; k < 2; k++) {
      await groups.nth(k).getByRole('button', { name: plans[v][k] === 2 ? '찬성' : '반대', exact: true }).click();
    }
    await V.page.getByRole('button', { name: '제출하기' }).first().click();
    await V.page.getByRole('dialog').getByRole('button', { name: '제출하기' }).click();
    await V.page.getByText('의견이 제출되었습니다').waitFor({ timeout: 15000 });
    const dev = await V.page.evaluate(() => localStorage.getItem('cv_device'));
    if (v === 0) await V.page.screenshot({ path: join(SHOTS, 'p5-voter-submitted.png') });
    voters.push({ ...V, dev });
    manifest.clientIds.push(dev);
  }
  saveManifest();
  S.p5ui = voters.length;
  // N6 — 같은 기기 두 번
  {
    await voters[0].page.reload({ waitUntil: 'networkidle' });
    const uiDup = await voters[0].page.getByText(/이미 제출|의견이 제출되었습니다/).count();
    const r = await vote(mainBallot.token, voters[0].dev, { [i1]: 2, [i2]: 2 });
    const after = await rpc('ballot_results_v2', { p_ballot_token: mainBallot.token, p_token: T2 });
    S.n6 = { rpc: r.message.slice(0, 40), responses: after.data?.responses, uiShowsSubmitted: uiDup > 0 };
  }
  // 나머지 42표 RPC: 27×(찬,찬) · 1×(찬,반) · 14×(반,반)
  {
    const pattern = [...Array(27).fill([2, 2]), [2, 1], ...Array(14).fill([1, 1])];
    let ok = 0;
    for (let n = 0; n < pattern.length; n++) {
      const cid = `dryrun-1017-${n}-${randomUUID()}`;
      manifest.clientIds.push(cid);
      const r = await vote(mainBallot.token, cid, { [i1]: pattern[n][0], [i2]: pattern[n][1] });
      if (r.ok) ok++;
    }
    saveManifest();
    const after = await rpc('ballot_results_v2', { p_ballot_token: mainBallot.token, p_token: T2 });
    const it = after.data.items.sort((a, b) => a.ordinal - b.ordinal);
    S.p5tally = { rpcOk: ok, responses: after.data.responses, item1: it[0].dist, item2: it[1].dist };
  }
  // N8 — 잘못된 페이로드(다른 ballot 은 3분과에서 하나 만든다)
  {
    const other = await rpc('ballot_create_v3', { p_token: T3, p_title: '드라이런 다른 투표', p_instructions: null, p_items: [{ ordinal: 1, statement: '다른 투표 문항', scale: 2, required: true }], p_subgroup: '3분과', p_idempotency_key: randomUUID() });
    if (other.ok) {
      manifest.ballots.push(other.data.id);
      saveManifest();
      await rpc('ballot_set_status_v2', { p_token: T3, p_ballot_id: other.data.id, p_status: 'open' });
    }
    const otherItem = other.ok ? (await rpc('ballot_get', { p_token: other.data.token })).data.items[0].id : randomUUID();
    const cases = {
      문항누락: { [i1]: 2 },
      값3: { [i1]: 3, [i2]: 2 },
      값0: { [i1]: 0, [i2]: 2 },
      '값-1': { [i1]: -1, [i2]: 2 },
      값1_5: { [i1]: 1.5, [i2]: 2 },
      문자열: { [i1]: '2', [i2]: 2 },
      다른투표item: { [i1]: 2, [i2]: 2, [otherItem]: 1 },
      다른투표item만: { [otherItem]: 1 },
      배열: [2, 2],
    };
    const rows = [];
    for (const [name, answers] of Object.entries(cases)) {
      const cid = `dryrun-1017-bad-${randomUUID()}`;
      const r = await vote(mainBallot.token, cid, answers);
      if (r.ok) manifest.clientIds.push(cid);
      rows.push({ name, rejected: !r.ok, msg: r.message.slice(0, 45) });
    }
    const after = await rpc('ballot_results_v2', { p_ballot_token: mainBallot.token, p_token: T2 });
    S.n8 = { rows, responses: after.data.responses };
    S.otherBallot = other.ok ? other.data.id : null;
    // 다른 분과 투표는 치워 둔다. 아래 UI 조작은 ballotCard 로 mainBallot 만 누른다.
    if (other.ok) await rpc('ballot_set_status_v2', { p_token: T3, p_ballot_id: other.data.id, p_status: 'archived' });
  }
  // 마감(UI)
  await pg.locator('#mod-tab-vote').click();
  await ballotCard(pg, mainBallot.id).getByRole('button', { name: '투표 마감', exact: true }).click();
  await pg.getByRole('dialog').getByRole('button', { name: '투표 마감', exact: true }).click();
  await pg.waitForTimeout(1500);
  // N7 — 마감 후
  {
    const r = await vote(mainBallot.token, `dryrun-1017-late-${randomUUID()}`, { [i1]: 2, [i2]: 2 });
    const V = await newCtx('voterLate', { viewport: { width: 390, height: 844 } });
    await V.page.goto(`${SITE}/b?t=${mainBallot.token}`, { waitUntil: 'networkidle' });
    await V.page.waitForTimeout(1500);
    const formButtons = await V.page.getByRole('button', { name: '찬성', exact: true }).count();
    const txt = (await V.page.locator('body').innerText()).replace(/\s+/g, ' ');
    S.n7 = { rpc: r.message.slice(0, 50), formVisible: formButtons > 0, closedMsg: /마감/.test(txt) };
    // N10b — 마감 상태에서도 결과 비공개
    S.n10.closed = (await rpc('ballot_results', { p_token: mainBallot.token })).data;
    S.n10.closedPageHasNumbers = /찬성\s*30|30\s*명|67%|66\.7/.test(txt);
    await V.page.screenshot({ path: join(SHOTS, 'n7-closed-voter.png') });
    await V.ctx.close();
  }
  // ═══ P5 세리머니 실제 결과 · P6 대형 화면 ═══
  S.p5c = {};
  S.p6 = {};
  for (const vp of [
    { width: 1920, height: 1080 },
    { width: 1280, height: 720 },
  ]) {
    const key = String(vp.width);
    await pg.setViewportSize(vp);
    await pg.locator('#mod-tab-decision').click();
    await viewTab(pg, '세리머니').click();
    await pg.getByLabel('재적 R').fill('60');
    await pg.getByLabel('참석 M').fill('45');
    await pg.getByRole('radio', { name: '실제 투표 결과' }).click();
    await pg.waitForTimeout(1200);
    await pg.getByLabel('투표 고르기').selectOption(mainBallot.id);
    await pg.getByRole('button', { name: '결과 불러오기' }).click();
    await pg.getByText(/제출 \d+명을 불러왔습니다/).waitFor({ timeout: 15000 });
    const loadMsg = await pg.getByText(/제출 \d+명을 불러왔습니다/).textContent();
    await pg.locator('[data-testid=division-ceremony-start]').click();
    const seen = { loadMsg, verdicts: [] };
    S.p6[key] = {};
    let n = 0;
    await runCeremony(pg, async (step) => {
      if (step === 'intro') {
        seen.intro = await pg.locator('[data-testid=ceremony-attendance]').getAttribute('data-established');
        seen.source = await pg.locator('[data-testid=division-ceremony] header').innerText();
      }
      if (step === 'verdict') {
        n++;
        seen.verdicts.push({
          yeas: await pg.locator('[data-testid=ceremony-yeas]').textContent(),
          stamp: await pg.locator('[data-testid=ceremony-stamp]').getAttribute('data-passed'),
          stampText: await pg.locator('[data-testid=ceremony-stamp]').textContent(),
          line: (await pg.locator('[data-testid=division-ceremony]').innerText()).match(/3분의 2 = \d+표/)?.[0],
        });
      }
      if (step === 'summary') seen.summary = (await pg.locator('[data-testid=division-ceremony] main').innerText()).replace(/\s+/g, ' ');
      if (['intro', 'verdict', 'summary'].includes(step)) {
        S.p6[key][`${step}${step === 'verdict' ? n : ''}`] = await layoutAudit(pg, '[data-testid=division-ceremony]', 24);
        await pg.screenshot({ path: join(SHOTS, `p5-ceremony-${key}-${step}${step === 'verdict' ? n : ''}.png`) });
      }
    });
    await pg.keyboard.press('Escape');
    S.p5c[key] = seen;
  }
  await pg.setViewportSize({ width: 1920, height: 1080 });

  // ═══ N2 · N3 — UI(준비판 파일 가져오기로 21안 · 300자 초과 안) + RPC ═══
  {
    const cardsFlat = nonHw.flatMap((t) => t.cards.map((c) => ({ t: t.no, c: c.no })));
    const mk = (list) => list.map((x, i) => ({ id: `${x.t}-안${100 + i}`, topicNo: x.t, cardNos: [x.c], title: `드라이런 ${i + 1}`, text: '', criteria: {} }));
    const f21 = join(OUT_DIR, 'n2-21.json');
    writeFileSync(f21, JSON.stringify({ v: 1, division: 2, source: d2, cards: {}, motions: mk(cardsFlat.slice(0, 21)) }));
    await pg.locator('#mod-tab-decision').click();
    await viewTab(pg, '준비판').click();
    await importFile(pg, f21);
    await viewTab(pg, '투표 열기').click();
    const alert21 = await pg.locator('[data-testid=division-vote-panel] ul[role=alert]').textContent().catch(() => '');
    const dis21 = await pg.locator('[data-testid=division-ballot-create]').isDisabled();
    await pg.locator('[data-testid=division-vote-panel] fieldset input[type=checkbox]').last().uncheck();
    await pg.waitForTimeout(200);
    const dis20 = await pg.locator('[data-testid=division-ballot-create]').isDisabled();
    const rpc21 = await rpc('ballot_create_v3', {
      p_token: T2,
      p_title: '2분과 의결',
      p_instructions: null,
      p_items: Array.from({ length: 21 }, (_, i) => ({ ordinal: i + 1, statement: `드라이런 ${i + 1}`, scale: 2, required: true })),
      p_subgroup: '2분과',
      p_idempotency_key: randomUUID(),
    });
    if (rpc21.ok) manifest.ballots.push(rpc21.data.id);
    S.n2 = { alert: alert21.slice(0, 60), dis21, dis20, rpc: rpc21.ok ? 'ACCEPTED' : rpc21.message.slice(0, 50) };

    const long = 'ㄱ'.repeat(300);
    const f300 = join(OUT_DIR, 'n3-long.json');
    writeFileSync(f300, JSON.stringify({ v: 1, division: 2, source: d2, cards: {}, motions: [{ ...mk(cardsFlat.slice(0, 1))[0], title: long }] }));
    await viewTab(pg, '준비판').click();
    await importFile(pg, f300);
    await viewTab(pg, '투표 열기').click();
    const alert300 = await pg.locator('[data-testid=division-vote-panel] ul[role=alert]').textContent().catch(() => '');
    const dis300 = await pg.locator('[data-testid=division-ballot-create]').isDisabled();
    const rpc301 = await rpc('ballot_create_v3', {
      p_token: T2,
      p_title: '2분과 의결',
      p_instructions: null,
      p_items: [{ ordinal: 1, statement: 'ㄱ'.repeat(301), scale: 2, required: true }],
      p_subgroup: '2분과',
      p_idempotency_key: randomUUID(),
    });
    if (rpc301.ok) manifest.ballots.push(rpc301.data.id);
    S.n3 = { alert: alert300.slice(0, 60), dis300, rpc: rpc301.ok ? 'ACCEPTED' : rpc301.message.slice(0, 60) };
    saveManifest();
  }

  // ═══ N9 — 잘못된·폐기된·다른 세션 토큰 ═══
  {
    const rand = randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '');
    const create = (tok, sub = '2분과') =>
      rpc('ballot_create_v3', { p_token: tok, p_title: 'N9', p_instructions: null, p_items: [{ ordinal: 1, statement: 'x', scale: 2, required: true }], p_subgroup: sub, p_idempotency_key: randomUUID() });
    const rows = [];
    const push = (name, r) => {
      if (r.ok && r.data?.id) manifest.ballots.push(r.data.id);
      rows.push({ name, rejected: !r.ok || r.data === null, msg: r.ok ? JSON.stringify(r.data)?.slice(0, 40) : r.message.slice(0, 50) });
    };
    push('무작위64hex 생성', await create(rand));
    push('무작위64hex 마감', await rpc('ballot_set_status_v2', { p_token: rand, p_ballot_id: mainBallot.id, p_status: 'published' }));
    push('형식 틀림 생성', await create('not-a-token'));
    push('빈 토큰 생성', await create(''));
    // 폐기(로그아웃)된 토큰 — 1분과로 새로 받아 바로 로그아웃
    const T1 = await login('1');
    await logout(T1);
    manifest.tokens['1'].loggedOut = true;
    push('폐기 토큰 생성', await create(T1, '1분과'));
    push('폐기 토큰 마감', await rpc('ballot_set_status_v2', { p_token: T1, p_ballot_id: mainBallot.id, p_status: 'published' }));
    // 다른 세션
    push('다른세션 토큰 마감', await rpc('ballot_set_status_v2', { p_token: TX, p_ballot_id: mainBallot.id, p_status: 'published' }));
    push('다른세션 토큰 결과', await rpc('ballot_results_v2', { p_ballot_token: mainBallot.token, p_token: TX }));
    push('다른세션 토큰 1분과 생성', await create(TX, '1분과'));
    S.n9 = rows;
    saveManifest();
  }

  // 공개 → N10 대조군(공개 뒤에만 결과가 보인다)
  {
    await pg.locator('#mod-tab-vote').click();
    await pg.waitForTimeout(800);
    await ballotCard(pg, mainBallot.id).getByRole('button', { name: '결과 공개', exact: true }).click();
    await pg.getByRole('dialog').getByRole('button', { name: '결과 공개', exact: true }).click();
    await pg.waitForTimeout(1500);
    const pub = await rpc('ballot_results', { p_token: mainBallot.token });
    await voters[1].page.reload({ waitUntil: 'networkidle' });
    await voters[1].page.waitForTimeout(1500);
    S.n10.published = pub.data ? `responses=${pub.data.responses}` : null;
    S.n10.voterSeesAfterPublish = /결과/.test(await voters[1].page.locator('body').innerText());
    await voters[1].page.screenshot({ path: join(SHOTS, 'n10-voter-after-publish.png') });
  }
  for (const v of voters) await v.ctx.close();
  S.mod2Errors = [...pageErrors.mod2];
  await M2.ctx.close();

  // ═══ P7 회귀 — 1분과 조로 /mod 기본 탭·기존 탭 4개 ═══
  {
    const M1 = await newCtx('mod1');
    await M1.page.goto(`${SITE}/mod?code=${seed.teams['1'][1]}`, { waitUntil: 'networkidle' });
    await M1.page.locator('#mod-tab-progress').waitFor({ timeout: 30000 });
    const def = await M1.page.locator('[role=tab][aria-selected=true]').first().getAttribute('id');
    const tabs = [];
    for (const id of ['progress', 'submission', 'vote', 'timer']) {
      await M1.page.locator(`#mod-tab-${id}`).click();
      await M1.page.waitForTimeout(800);
      const sel = await M1.page.locator(`#mod-tab-${id}`).getAttribute('aria-selected');
      const txtLen = (await M1.page.locator('main, body').first().innerText()).length;
      tabs.push({ id, selected: sel === 'true', txtLen });
    }
    const http = {};
    for (const p of ['/hq', '/v', '/b', '/mod-help', '/mod']) {
      const r = await fetch(`${SITE}${p}`, { redirect: 'follow' });
      http[p] = r.status;
    }
    S.p7 = { defaultTab: def, tabs, http, errors: [...pageErrors.mod1] };
    await M1.ctx.close();
  }

  // ═══ N11 — 저장소 차단 ═══
  {
    const out = {};
    const B1 = await newCtx('blockLab', { blockStorage: true });
    await B1.page.goto(`${SITE}/ko/moderator/insights/division-vote-lab`, { waitUntil: 'networkidle' });
    await B1.page.waitForTimeout(1500);
    out.lab = { panel: await B1.page.locator('[data-testid=division-vote-panel]').count(), warn: await B1.page.getByText('저장소를 쓸 수 없어').count(), errors: [...pageErrors.blockLab] };
    await B1.page.screenshot({ path: join(SHOTS, 'n11-lab-storage-blocked.png') });
    await B1.ctx.close();
    const B2 = await newCtx('blockB', { blockStorage: true, viewport: { width: 390, height: 844 } });
    await B2.page.goto(`${SITE}/b?t=${mainBallot.token}`, { waitUntil: 'networkidle' });
    await B2.page.waitForTimeout(2000);
    out.b = { textLen: (await B2.page.locator('body').innerText()).length, errors: [...pageErrors.blockB] };
    await B2.page.screenshot({ path: join(SHOTS, 'n11-b-storage-blocked.png') });
    await B2.ctx.close();
    const B3 = await newCtx('blockMod', { blockStorage: true });
    await B3.page.goto(`${SITE}/mod?code=${seed.teams['3'][1]}`, { waitUntil: 'networkidle' });
    await B3.page.waitForTimeout(4000);
    const hasTabs = await B3.page.locator('#mod-tab-decision').count();
    if (hasTabs) {
      await B3.page.locator('#mod-tab-decision').click();
      await B3.page.waitForTimeout(800);
    }
    out.mod = { tabs: hasTabs, panel: await B3.page.locator('[data-testid=division-vote-panel]').count(), warn: await B3.page.getByText('저장소를 쓸 수 없어').count(), textLen: (await B3.page.locator('body').innerText()).length, errors: [...pageErrors.blockMod] };
    await B3.page.screenshot({ path: join(SHOTS, 'n11-mod-storage-blocked.png') });
    await B3.ctx.close();
    S.n11 = out;
  }

  // ═══ N12 — 운영 번들에 실제 권고 문구가 없는가 ═══
  {
    // 의결 탭 청크가 빠지지 않게 /mod HTML 이 가리키는 js 도 받아 둔다
    const html = await (await fetch(`${SITE}/mod/`)).text();
    for (const m of html.matchAll(/\/_astro\/[A-Za-z0-9_.-]+\.js/g)) {
      const u = `${SITE}${m[0]}`;
      if (!bundles.has(u)) bundles.set(u, await (await fetch(u)).text());
    }
    const all = [...bundles.values()];
    const hits = [];
    for (const idx of SAMPLE_IDX) {
      const text = allRecTexts[idx % allRecTexts.length];
      const probe = text.replace(/\s+/g, ' ').trim().slice(0, 20);
      if (all.some((b) => b.includes(probe))) hits.push(idx);
    }
    const control = all.some((b) => b.includes('10/17 의결'));
    S.n12 = { bundles: all.length, sampled: SAMPLE_IDX.length, hits, control };
  }
}

/**
 * P5 재실행 — 첫 실행에서 「투표」 탭의 .first() 가 3분과 시험 투표를 눌러 2분과 투표가 열린 채 남았다
 * (시험 결함). 앞 투표들을 보관(archived) 처리하고 새 투표로 P4 후반·P5·N6·N7·N10·P6 을 다시 돈다.
 */
async function phaseP5() {
  const T3 = await login('3');
  for (const id of manifest.ballots.slice(0, 2)) {
    const r = await rpc('ballot_set_status_v2', { p_token: T3, p_ballot_id: id, p_status: 'archived' });
    S[`archive_${id.slice(0, 8)}`] = r.ok ? r.data.status : r.message;
  }
  const M2 = await newCtx('mod2b', { viewport: { width: 1920, height: 1080 } });
  const pg = M2.page;
  await pg.goto(`${SITE}/mod?code=${seed.teams['2'][1]}`, { waitUntil: 'networkidle' });
  await pg.locator('#mod-tab-decision').waitFor({ timeout: 30000 });
  await pg.locator('#mod-tab-decision').click();
  await importFile(pg, RECS_FILE);
  await divBtn(pg, 2).click();
  const d2 = byDiv[2];
  const nonHw = d2.topics.filter((t) => !['2-14', '2-15', '2-16', '2-17'].includes(t.no));
  const mergeTopic = nonHw.find((t) => t.cards.length >= 2);
  const singleTopic = nonHw.find((t) => d2.topics.indexOf(t) > d2.topics.indexOf(mergeTopic));
  await makeMotion(pg, [mergeTopic.cards[0].no, mergeTopic.cards[1].no], `통합안 ${mergeTopic.cards[0].title || mergeTopic.name}`.slice(0, 60), '드라이런 문안');
  await makeMotion(pg, [singleTopic.cards[0].no], `단일안 ${singleTopic.cards[0].title || singleTopic.name}`.slice(0, 60), '드라이런 문안');
  await viewTab(pg, '투표 열기').click();
  await pg.locator('[data-testid=division-ballot-create]').click();
  await pg.getByRole('dialog', { name: '투표 만들기 확인' }).getByRole('button', { name: '만들기' }).click();
  await pg.getByText('투표 초안을 만들었습니다').waitFor({ timeout: 15000 });
  const list = await rpc('ballot_list_v2', { p_token: T3 });
  const visible = list.data ?? [];
  const b = visible.find((x) => x.subgroup === '2분과' && x.status === 'draft');
  mainBallot = { id: b.id, token: b.token };
  manifest.ballots.push(b.id);
  manifest.mainBallot2 = mainBallot;
  saveManifest();
  S.visibleBallots = visible.length;
  const status = async () => (await rpc('ballot_list_v2', { p_token: T3 })).data.find((x) => x.id === mainBallot.id)?.status;

  await pg.locator('#mod-tab-vote').click();
  await ballotCard(pg, mainBallot.id).getByRole('button', { name: '투표 시작', exact: true }).click();
  await pg.getByRole('dialog').getByRole('button', { name: '투표 시작', exact: true }).click();
  await pg.waitForTimeout(1500);
  const qm = /climate-assembly\.org\/b\?t=([0-9a-f]{32})/.exec(await pg.locator('body').innerText());
  S.p4qr = { tokenMatch: !!qm && qm[1] === mainBallot.token, status: await status() };
  await pg.screenshot({ path: join(SHOTS, 'p4-qr-fullscreen-1920.png') });
  await pg.keyboard.press('Escape');
  S.n10 = { open: (await rpc('ballot_results', { p_token: mainBallot.token })).data };

  const items = (await rpc('ballot_get', { p_token: mainBallot.token })).data.items.sort((a, c) => a.ordinal - c.ordinal);
  const [i1, i2] = items.map((i) => i.id);
  const plans = [[2, 2], [2, 2], [1, 1]];
  const voters = [];
  for (let v = 0; v < 3; v++) {
    const V = await newCtx(`voterB${v}`, { viewport: { width: 390, height: 844 } });
    await V.page.goto(`${SITE}/b?t=${mainBallot.token}`, { waitUntil: 'networkidle' });
    const groups = V.page.locator('[role=group][aria-label$="응답"]');
    await groups.first().waitFor({ timeout: 20000 });
    for (let k = 0; k < 2; k++) await groups.nth(k).getByRole('button', { name: plans[v][k] === 2 ? '찬성' : '반대', exact: true }).click();
    if (v === 0) await V.page.screenshot({ path: join(SHOTS, 'p5-voter-form.png') });
    await V.page.getByRole('button', { name: '제출하기' }).first().click();
    await V.page.getByRole('dialog').getByRole('button', { name: '제출하기' }).click();
    await V.page.getByText('의견이 제출되었습니다').waitFor({ timeout: 15000 });
    const dev = await V.page.evaluate(() => localStorage.getItem('cv_device'));
    if (v === 0) await V.page.screenshot({ path: join(SHOTS, 'p5-voter-submitted.png') });
    voters.push({ ...V, dev });
    manifest.clientIds.push(dev);
  }
  saveManifest();
  {
    await voters[0].page.reload({ waitUntil: 'networkidle' });
    const uiDup = await voters[0].page.getByText(/이미 제출|의견이 제출되었습니다/).count();
    const r = await vote(mainBallot.token, voters[0].dev, { [i1]: 2, [i2]: 2 });
    const after = await rpc('ballot_results_v2', { p_ballot_token: mainBallot.token, p_token: T3 });
    S.n6 = { rpc: r.message.slice(0, 40), responses: after.data?.responses, uiShowsSubmitted: uiDup > 0 };
  }
  {
    const pattern = [...Array(27).fill([2, 2]), [2, 1], ...Array(14).fill([1, 1])];
    let ok = 0;
    for (let n = 0; n < pattern.length; n++) {
      const cid = `dryrun-1017-b${n}-${randomUUID()}`;
      manifest.clientIds.push(cid);
      if ((await vote(mainBallot.token, cid, { [i1]: pattern[n][0], [i2]: pattern[n][1] })).ok) ok++;
    }
    saveManifest();
    const after = await rpc('ballot_results_v2', { p_ballot_token: mainBallot.token, p_token: T3 });
    const it = after.data.items.sort((a, c) => a.ordinal - c.ordinal);
    S.p5tally = { rpcOk: ok, responses: after.data.responses, item1: it[0].dist, item2: it[1].dist };
  }
  // 마감(UI) — 이번에는 목록에 이 투표 하나뿐이다. 상태를 RPC 로 확인한다.
  await pg.locator('#mod-tab-vote').click();
  await pg.waitForTimeout(800);
  S.voteTabCards = await pg.getByRole('button', { name: '투표 마감', exact: true }).count();
  await ballotCard(pg, mainBallot.id).getByRole('button', { name: '투표 마감', exact: true }).click();
  await pg.getByRole('dialog').getByRole('button', { name: '투표 마감', exact: true }).click();
  await pg.waitForTimeout(1500);
  S.afterClose = await status();
  {
    const r = await vote(mainBallot.token, `dryrun-1017-late-${randomUUID()}`, { [i1]: 2, [i2]: 2 });
    if (r.ok) manifest.clientIds.push('late-accepted');
    const V = await newCtx('voterLateB', { viewport: { width: 390, height: 844 } });
    await V.page.goto(`${SITE}/b?t=${mainBallot.token}`, { waitUntil: 'networkidle' });
    await V.page.waitForTimeout(1500);
    const formButtons = await V.page.getByRole('button', { name: '찬성', exact: true }).count();
    const txt = (await V.page.locator('body').innerText()).replace(/\s+/g, ' ');
    S.n7 = { rpcRejected: !r.ok, rpc: r.message.slice(0, 50), formVisible: formButtons > 0, closedText: txt.slice(0, 80) };
    S.n10.closed = (await rpc('ballot_results', { p_token: mainBallot.token })).data;
    S.n10.closedPageHasNumbers = /\b(30|29|45)\b/.test(txt);
    await V.page.screenshot({ path: join(SHOTS, 'n7-closed-voter.png') });
    await V.ctx.close();
  }
  S.p5c = {};
  S.p6 = {};
  for (const vp of [
    { width: 1920, height: 1080 },
    { width: 1280, height: 720 },
  ]) {
    const key = String(vp.width);
    await pg.setViewportSize(vp);
    await pg.locator('#mod-tab-decision').click();
    await viewTab(pg, '세리머니').click();
    await pg.getByLabel('재적 R').fill('60');
    await pg.getByLabel('참석 M').fill('45');
    await pg.getByRole('radio', { name: '실제 투표 결과' }).click();
    await pg.waitForTimeout(1200);
    await pg.getByLabel('투표 고르기').selectOption(mainBallot.id);
    await pg.getByRole('button', { name: '결과 불러오기' }).click();
    await pg.getByText(/제출 \d+명을 불러왔습니다/).waitFor({ timeout: 15000 });
    const loadMsg = await pg.getByText(/제출 \d+명을 불러왔습니다/).textContent();
    await pg.locator('[data-testid=division-ceremony-start]').click();
    const seen = { loadMsg, verdicts: [] };
    S.p6[key] = {};
    let n = 0;
    await runCeremony(pg, async (step) => {
      if (step === 'intro') {
        seen.intro = await pg.locator('[data-testid=ceremony-attendance]').getAttribute('data-established');
        seen.source = (await pg.locator('[data-testid=division-ceremony] header').innerText()).replace(/\s+/g, ' ');
      }
      if (step === 'verdict') {
        n++;
        seen.verdicts.push({
          yeas: await pg.locator('[data-testid=ceremony-yeas]').textContent(),
          stamp: await pg.locator('[data-testid=ceremony-stamp]').getAttribute('data-passed'),
          stampText: await pg.locator('[data-testid=ceremony-stamp]').textContent(),
          line: (await pg.locator('[data-testid=division-ceremony]').innerText()).match(/3분의 2 = \d+표/)?.[0],
        });
      }
      if (step === 'summary') seen.summary = (await pg.locator('[data-testid=ceremony-summary]').innerText()).replace(/\s+/g, ' ') + ' | ' + ((await pg.locator('[data-testid=division-ceremony] main').innerText()).match(/상정[^\n]*/)?.[0] ?? '');
      if (['intro', 'verdict', 'summary'].includes(step)) {
        S.p6[key][`${step}${step === 'verdict' ? n : ''}`] = await layoutAudit(pg, '[data-testid=division-ceremony]', 24);
        await pg.screenshot({ path: join(SHOTS, `p5-ceremony-${key}-${step}${step === 'verdict' ? n : ''}.png`) });
      }
    });
    await pg.keyboard.press('Escape');
    S.p5c[key] = seen;
  }
  await pg.setViewportSize({ width: 1920, height: 1080 });
  // 공개(UI) → 공개 뒤에만 결과
  await pg.locator('#mod-tab-vote').click();
  await pg.waitForTimeout(800);
  await ballotCard(pg, mainBallot.id).getByRole('button', { name: '결과 공개', exact: true }).click();
  await pg.getByRole('dialog').getByRole('button', { name: '결과 공개', exact: true }).click();
  await pg.waitForTimeout(1500);
  S.afterPublish = await status();
  const pub = await rpc('ballot_results', { p_token: mainBallot.token });
  S.n10.published = pub.data ? `responses=${pub.data.responses}` : null;
  await voters[1].page.reload({ waitUntil: 'networkidle' });
  await voters[1].page.waitForTimeout(1500);
  S.n10.voterAfterPublish = (await voters[1].page.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 120);
  await voters[1].page.screenshot({ path: join(SHOTS, 'n10-voter-after-publish.png') });
  for (const v of voters) await v.ctx.close();
  await M2.ctx.close();
  await logout(T3);
  manifest.tokens['3'].loggedOut = true;
  saveManifest();
}

async function phaseExpired() {
  const tx = manifest.tokens.x?.token;
  const r = await rpc('ballot_list_v2', { p_token: tx });
  const r2 = await rpc('ballot_set_status_v2', { p_token: tx, p_ballot_id: manifest.ballots[0], p_status: 'published' });
  record('N9-만료', !r.ok && !r2.ok, `목록 ${r.message.slice(0, 45)} · 상태변경 ${r2.message.slice(0, 45)}`);
}

// ── 실행 + 판정 ──────────────────────────────────────────────
try {
  if (PHASE === 'expired') await phaseExpired();
  else if (PHASE === 'p5') await phaseP5();
  else await phaseMain();
} catch (error) {
  record('RUN', false, `중단: ${String(error?.message ?? error).slice(0, 300)}`);
} finally {
  if (PHASE === 'main') {
    // 스크립트가 받은 토큰은 x(만료 시험용)를 빼고 모두 로그아웃
    for (const [k, v] of Object.entries(manifest.tokens)) {
      if (k === 'x' || v.loggedOut) continue;
      const r = await logout(v.token);
      v.loggedOut = r.ok;
    }
    manifest.mainBallot = mainBallot;
    saveManifest();
  }
  await browser.close().catch(() => {});
  writeFileSync(RESULTS, JSON.stringify({ S, results, pageErrors }, null, 2));
  console.log(`\nS 요약 → ${RESULTS}`);
}
