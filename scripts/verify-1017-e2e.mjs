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
const consoleErrors = {};
const netErrors = {};

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
  consoleErrors[name] = [];
  netErrors[name] = [];
  ctx.on('response', async (res) => {
    const u = res.url();
    if (res.status() >= 400) netErrors[name].push(`${res.status()} ${u.replace(/\?.*$/, '').replace(/^https:\/\/[^/]+/, '')}`);
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
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors[name].push(m.text().slice(0, 200));
  });
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
  // 69b6fae — 분과 조 콘솔은 자기 분과만 보인다. 1·3분과 수는 운영진 콘솔(N15)에서 잰다.
  // 관찰(69b6fae): 가져온 직후 활성 분과가 파일의 첫 분과(1분과)로 잡히는지 — 버튼은 2분과뿐인데 내용은 1분과
  const heading = async () => (await pg.locator('[data-testid=division-vote-panel] p.text-\\[16px\\] > span.font-bold').first().textContent().catch(() => '')).trim();
  S.p3lock = { div1: await divBtn(pg, 1).count(), div2: await divBtn(pg, 2).count(), div3: await divBtn(pg, 3).count(), shownAfterImport: await heading(), btn2Pressed: await divBtn(pg, 2).getAttribute('aria-pressed') };
  await pg.screenshot({ path: join(SHOTS, 'p3-mod2-locked.png') });
  await divBtn(pg, 2).click();
  S.p3lock.shownAfterClick = await heading();
  S.p3mod = { 2: await panelCounts(pg) };
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

  // ═══ N15 분과 격리 — 운영진(분과 없음) 토큰으로 1분과·3분과·세션 전체 투표를 만든다 ═══
  if (seed.teams.o) {
    const TO = await login('o');
    const mk = async (sub, title) => {
      const r = await rpc('ballot_create_v3', { p_token: TO, p_title: title, p_instructions: null, p_items: [{ ordinal: 1, statement: `${title} 문항`, scale: 2, required: true }], p_subgroup: sub, p_idempotency_key: randomUUID() });
      if (r.ok) manifest.ballots.push(r.data.id);
      return r.ok ? r.data.id : null;
    };
    const b1 = await mk('1분과', 'N15 1분과 투표');
    const b3 = await mk('3분과', 'N15 3분과 투표');
    const ball = await mk(null, 'N15 세션 전체 투표');
    saveManifest();
    // 2분과 콘솔 「투표」 탭
    await pg.locator('#mod-tab-decision').click();
    await pg.locator('#mod-tab-vote').click();
    await pg.waitForTimeout(500);
    await pg.reload({ waitUntil: 'networkidle' });
    await pg.locator('#mod-tab-vote').waitFor({ timeout: 30000 });
    await pg.locator('#mod-tab-vote').click();
    await pg.waitForTimeout(2500);
    const seen2 = await pg.locator('[data-ballot-id]').evaluateAll((els) => els.map((e) => e.getAttribute('data-ballot-id')));
    await pg.getByRole('button', { name: /새 다의제 투표/ }).click();
    await pg.waitForTimeout(800);
    const targets2 = await pg.locator('button[aria-pressed]').evaluateAll((els) => els.map((e) => `${e.textContent.trim()}${e.getAttribute('aria-pressed') === 'true' ? '*' : ''}`));
    await pg.screenshot({ path: join(SHOTS, 'n15-mod2-create-targets.png') });
    await pg.reload({ waitUntil: 'networkidle' });
    await pg.locator('#mod-tab-vote').waitFor({ timeout: 30000 });
    // 운영진 콘솔
    const MO = await newCtx('modOps');
    await MO.page.goto(`${SITE}/mod?code=${seed.teams.o[1]}`, { waitUntil: 'networkidle' });
    await MO.page.locator('#mod-tab-vote').waitFor({ timeout: 30000 });
    await MO.page.locator('#mod-tab-vote').click();
    await MO.page.waitForTimeout(2500);
    const seenO = await MO.page.locator('[data-ballot-id]').evaluateAll((els) => els.map((e) => e.getAttribute('data-ballot-id')));
    await MO.page.getByRole('button', { name: /새 다의제 투표/ }).click();
    await MO.page.waitForTimeout(1500);
    const targetsO = await MO.page.locator('button[aria-pressed]').evaluateAll((els) => els.map((e) => `${e.textContent.trim()}${e.getAttribute('aria-pressed') === 'true' ? '*' : ''}`));
    await MO.page.screenshot({ path: join(SHOTS, 'n15-ops-create-targets.png') });
    // 운영진은 분과 잠금이 없다 — 세 분과 실데이터 수(P3)
    await MO.page.reload({ waitUntil: 'networkidle' });
    await MO.page.locator('#mod-tab-decision').waitFor({ timeout: 30000 });
    await MO.page.locator('#mod-tab-decision').click();
    await MO.page.locator('[data-testid=division-vote-panel]').waitFor();
    await importFile(MO.page, RECS_FILE);
    for (const d of [1, 2, 3]) {
      if (!(await divBtn(MO.page, d).count())) continue;
      await divBtn(MO.page, d).click();
      S.p3mod[`ops${d}`] = await panelCounts(MO.page);
    }
    await MO.page.screenshot({ path: join(SHOTS, 'p3-ops-3분과.png') });
    S.opsErrors = [...pageErrors.modOps];
    await MO.ctx.close();
    // 알려진 서버 위험 — 2분과 조 토큰으로 1분과 투표 상태 변경
    const risk = await rpc('ballot_set_status_v2', { p_token: T2, p_ballot_id: b1, p_status: 'open' });
    S.n15 = {
      mod2: { main: seen2.includes(mainBallot.id), all: seen2.includes(ball), b1: seen2.includes(b1), b3: seen2.includes(b3), n: seen2.length, targets: targets2 },
      ops: { main: seenO.includes(mainBallot.id), all: seenO.includes(ball), b1: seenO.includes(b1), b3: seenO.includes(b3), n: seenO.length, targets: targetsO },
      serverRisk: risk.ok ? `ACCEPTED → ${risk.data.status}` : `rejected: ${risk.message}`,
    };
    // 양성 — 운영진(분과 없음) 토큰은 분과 투표 상태를 바꿀 수 있어야 한다(s24 뒤에도)
    const opsOpen = await rpc('ballot_set_status_v2', { p_token: TO, p_ballot_id: b3, p_status: 'open' });
    S.n15.opsChange = opsOpen.ok ? `ACCEPTED → ${opsOpen.data?.status}` : `rejected: ${opsOpen.message}`;
    // 뒤 시험에 끼지 않게 치운다
    for (const id of [b1, b3, ball]) if (id) await rpc('ballot_set_status_v2', { p_token: TO, p_ballot_id: id, p_status: 'archived' });
    await logout(TO);
    manifest.tokens.o.loggedOut = true;
    saveManifest();
  }

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
    await pg.locator(`[data-ballot-pick="${mainBallot.id}"]`).check();
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
    // (a) 저장소 차단 기기로 2분과 /mod 입장 → 10/17 탭 → 투표 생성·시작. 2분과 기기 2대 상한 때문에 스크립트 토큰을 먼저 내려놓는다.
    await logout(T2);
    manifest.tokens['2'].loggedOut = true;
    const B3 = await newCtx('blockMod', { blockStorage: true });
    const bp = B3.page;
    await bp.goto(`${SITE}/mod?code=${seed.teams['2'][1]}`, { waitUntil: 'networkidle' });
    await bp.locator('#mod-tab-decision').waitFor({ timeout: 30000 }).catch(() => {});
    const hasTabs = await bp.locator('#mod-tab-decision').count();
    out.mod = { joined: hasTabs > 0 };
    let nb = null;
    if (hasTabs) {
      await bp.locator('#mod-tab-decision').click();
      await importFile(bp, RECS_FILE);
      await divBtn(bp, 2).click();
      const card = byDiv[2].topics.find((t) => t.no === '2-3')?.cards[0]?.no ?? byDiv[2].topics[2].cards[0].no;
      await makeMotion(bp, [card], 'N11 저장소 차단 안');
      out.mod.warn = await bp.getByText('저장소를 쓸 수 없어').count();
      await viewTab(bp, '투표 열기').click();
      await bp.locator('[data-testid=division-ballot-create]').click();
      await bp.getByRole('dialog', { name: '투표 만들기 확인' }).getByRole('button', { name: '만들기' }).click();
      out.mod.created = await bp.getByText('투표 초안을 만들었습니다').waitFor({ timeout: 15000 }).then(() => true).catch(() => false);
      const before = new Set([mainBallot.id]);
      const l = (await rpc('ballot_list_v2', { p_token: T3 })).data ?? [];
      const row = l.find((x) => x.subgroup === '2분과' && x.status === 'draft' && !before.has(x.id));
      if (row) {
        nb = { id: row.id, token: row.token };
        manifest.ballots.push(row.id);
        saveManifest();
        await bp.locator('#mod-tab-vote').click();
        await bp.waitForTimeout(1500);
        await ballotCard(bp, nb.id).getByRole('button', { name: '투표 시작', exact: true }).click();
        await bp.getByRole('dialog').getByRole('button', { name: '투표 시작', exact: true }).click();
        await bp.waitForTimeout(1500);
        out.mod.status = ((await rpc('ballot_list_v2', { p_token: T3 })).data ?? []).find((x) => x.id === nb.id)?.status;
        await bp.keyboard.press('Escape');
      }
    }
    out.mod.errors = [...pageErrors.blockMod];
    await bp.screenshot({ path: join(SHOTS, 'n11-mod-storage-blocked.png') });
    await B3.ctx.close();
    // (b)(c)(d) 저장소 차단 기기로 /b 투표
    if (nb) {
      const count = async () => (await rpc('ballot_results_v2', { p_ballot_token: nb.token, p_token: T3 })).data?.responses;
      const B4 = await newCtx('blockVote', { blockStorage: true, viewport: { width: 390, height: 844 } });
      const vp = B4.page;
      const sent = [];
      vp.on('request', (rq) => {
        if (rq.url().includes('/rpc/ballot_submit')) {
          try {
            sent.push(JSON.parse(rq.postData()).p_client_id);
          } catch {
            /* */
          }
        }
      });
      const submitOnce = async () => {
        await vp.goto(`${SITE}/b?t=${nb.token}`, { waitUntil: 'networkidle' });
        const g = vp.locator('[role=group][aria-label$="응답"]');
        const shown = await g.first().waitFor({ timeout: 15000 }).then(() => true).catch(() => false);
        if (!shown) return { form: false, text: (await vp.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 80) };
        await g.first().getByRole('button', { name: '찬성', exact: true }).click();
        await vp.getByRole('button', { name: '제출하기' }).first().click();
        await vp.getByRole('dialog').getByRole('button', { name: '제출하기' }).click();
        await vp.waitForTimeout(2000);
        return { form: true, text: (await vp.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 80) };
      };
      const c0 = await count();
      const first = await submitOnce();
      const c1 = await count();
      // (c) 같은 페이지 — 폼이 남아 있는지, 같은 기기 토큰으로 다시 보내면 거절되는지
      const formStill = await vp.locator('[role=group][aria-label$="응답"]').count();
      const again = sent[0] ? await vote(nb.token, sent[0], { [((await rpc('ballot_get', { p_token: nb.token })).data.items[0].id)]: 2 }) : { ok: false, message: 'no client id captured' };
      const c2 = await count();
      // (d) 새로고침 — 메모리 토큰이 사라지면 새 토큰으로 다시 들어가는가
      const second = await submitOnce();
      const c3 = await count();
      for (const cid of sent) manifest.clientIds.push(cid);
      saveManifest();
      await vp.screenshot({ path: join(SHOTS, 'n11-b-after-reload.png') });
      out.b = {
        counts: [c0, c1, c2, c3],
        first: first.text,
        sameTabFormVisible: formStill > 0,
        samePageResubmit: again.ok ? 'ACCEPTED' : again.message.slice(0, 40),
        afterReload: second,
        clientIds: sent.length,
        distinctClientIds: new Set(sent).size,
        errors: [...pageErrors.blockVote],
      };
      await B4.ctx.close();
      await rpc('ballot_set_status_v2', { p_token: T3, p_ballot_id: nb.id, p_status: 'archived' });
    }
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
    await pg.locator(`[data-ballot-pick="${mainBallot.id}"]`).check();
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

// ── 본 시험(S) 판정 — 값을 베끼지 않고 규칙으로 판정한다 ─────────
function judgeMain() {
  const has = (k) => S[k] !== undefined;
  const j = (id, keys, fn, detail) => {
    if (!keys.every(has)) return record(id, false, `미측정 — S.${keys.filter((k) => !has(k)).join(',')} 없음`);
    let ok = false;
    try {
      ok = !!fn();
    } catch (e) {
      ok = false;
    }
    record(id, ok, detail());
  };
  const cleanAudit = (a) => a && !a.missing && a.small.length === 0 && a.off.length === 0 && a.overlaps.length === 0 && !a.hScroll;
  j('P2', ['labStatus', 'labRobots', 'labSupabase'], () => S.labStatus === 200 && /noindex/.test(S.labRobots) && S.labSupabase === 0, () => `lab ${S.labStatus} · robots=${S.labRobots} · supabase 요청 ${S.labSupabase}`);
  const sameCounts = (c, d) => { const e = counts(byDiv[d]); return !!c && c.topics === e.topics && c.cards === e.cards && c.recs === e.recs; };
  const fmt = (c) => (c ? `${c.topics}/${c.cards}/${c.recs}` : '없음');
  j('P3', ['labP3', 'p3mod', 'p3lock'], () => S.labP3.ok && sameCounts(S.p3mod[2], 2) && [1, 2, 3].every((d) => sameCounts(S.p3mod[`ops${d}`], d)) && S.p3lock.div1 === 0 && S.p3lock.div3 === 0, () => `lab 1분과 ${fmt(S.labP3.c1)} · 2분과 콘솔 ${fmt(S.p3mod[2])} (분과 버튼 1:${S.p3lock.div1} 2:${S.p3lock.div2} 3:${S.p3lock.div3}) · 운영진 ${[1, 2, 3].map((d) => `${d}:${fmt(S.p3mod[`ops${d}`])}`).join(' ')}`);
  j('P4', ['p4create', 'p4qr', 'p4qr2', 'motions'], () => S.p4create.count === 1 && S.p4create.status === 'draft' && S.p4create.items === S.motions.ids.length && JSON.stringify(S.p4create.stmtIds) === JSON.stringify(S.motions.ids) && S.p4create.scales.every((s) => s === 2) && S.p4qr.tokenMatch && S.p4qr2 === true, () => `투표 ${S.p4create.count}개 ${S.p4create.status} 문항 ${S.p4create.stmtIds.join(',')} scale ${S.p4create.scales} · QR ${S.p4qr.tokenMatch}/${S.p4qr2}`);
  j('P5', ['p5ui', 'p5tally', 'p5c'], () => {
    const t = S.p5tally;
    const okTally = S.p5ui === 3 && t.rpcOk === 42 && t.responses === 45 && t.item1['2'] === 30 && t.item1['1'] === 15 && t.item2['2'] === 29 && t.item2['1'] === 16;
    const okCer = ['1920', '1280'].every((k) => {
      const c = S.p5c[k];
      return c && c.intro === 'true' && c.verdicts.length === 2 && c.verdicts[0].yeas === '30' && c.verdicts[0].stamp === 'true' && c.verdicts[1].yeas === '29' && c.verdicts[1].stamp === 'false' && /의결 1건/.test(c.summary);
    });
    return okTally && okCer;
  }, () => `화면 ${S.p5ui}표 + RPC ${S.p5tally.rpcOk} = ${S.p5tally.responses} · 안1 ${JSON.stringify(S.p5tally.item1)} 안2 ${JSON.stringify(S.p5tally.item2)} · 세리머니 ${['1920', '1280'].map((k) => (S.p5c[k]?.verdicts ?? []).map((v) => `${v.yeas}:${v.stamp}`).join('/')).join(' | ')}`);
  j('P6', ['p6qr', 'p6'], () => ['1920', '1280'].every((k) => cleanAudit(S.p6qr[k]) && Object.values(S.p6[k] ?? {}).length >= 3 && Object.values(S.p6[k]).every(cleanAudit)), () => `QR·세리머니 ${['1920', '1280'].map((k) => `${k}: ${Object.keys(S.p6[k] ?? {}).length}장`).join(' ')} 겹침·넘침·24px 미만 0`);
  j('P7', ['p7'], () => S.p7.defaultTab === 'mod-tab-progress' && S.p7.tabs.every((t) => t.selected && t.txtLen > 0) && Object.values(S.p7.http).every((s) => s === 200) && S.p7.errors.length === 0, () => `기본 탭 ${S.p7.defaultTab} · HTTP ${JSON.stringify(S.p7.http)} · 오류 ${S.p7.errors.length}`);
  j('N1', ['n1'], () => S.n1.alert && S.n1.disabled && S.n1.unchanged, () => `${S.n1.alert} · 버튼 비활성 ${S.n1.disabled} · 무변화 ${S.n1.unchanged}`);
  j('N2', ['n2'], () => S.n2.dis21 && !S.n2.dis20 && S.n2.alert && S.n2.rpc !== 'ACCEPTED', () => `21안 비활성 ${S.n2.dis21}·20안 활성 ${!S.n2.dis20} · RPC ${S.n2.rpc}`);
  j('N3', ['n3'], () => S.n3.dis300 && S.n3.alert && S.n3.rpc !== 'ACCEPTED', () => `300자 초과 비활성 ${S.n3.dis300} · RPC ${S.n3.rpc}`);
  j('N4', ['n4'], () => {
    const r = S.n4.rows;
    const q30 = r.find((x) => x.case === '재적60 참석30');
    const q31 = r.find((x) => x.case === '재적60 참석31');
    const p40 = r.find((x) => x.case === '찬성40/참석60');
    const p39 = r.find((x) => x.case === '찬성39/참석60');
    const bad = r.filter((x) => x.case.startsWith('R='));
    return q30.established === 'false' && q30.nextDisabled && q30.phaseAfterKey === 'intro' && q31.established === 'true' && q31.phaseAfterKey === 'title' && p40.stamp === 'true' && /의결 1건/.test(p40.summary) && p39.stamp === 'false' && /의결 0건/.test(p39.summary) && bad.length === 9 && bad.every((x) => x.ceremonyNote === '' || x.ceremonyNote.startsWith('false/true')) && S.n4.pageErr === 0;
  }, () => `정족수 30/31 · 가결 40/39 · 이상입력 ${S.n4.rows.filter((x) => x.case.startsWith('R=')).map((x) => x.ceremonyNote || '시작안됨').join(',')} · pageerror ${S.n4.pageErr}`);
  j('N5', ['n5', 'n5other', 'xss', 'big'], () => S.n5.every((x) => x.rejected && x.same && x.pageErr === 0) && S.n5other.cancelKeeps && S.xss.flag === null && S.xss.imgs === 0 && S.xss.svgs === 0 && S.xss.shownAsText && S.big.pageErr === 0, () => `거절 ${S.n5.filter((x) => x.rejected && x.same).length}/${S.n5.length} · 취소 유지 ${S.n5other.cancelKeeps} · XSS ${S.xss.flag}/${S.xss.imgs} · 거대 ${S.big.mb}MB ${S.big.ms}ms`);
  j('N6', ['n6'], () => /already/.test(S.n6.rpc) && S.n6.responses === 3 && S.n6.uiShowsSubmitted, () => `${S.n6.rpc} · 응답 ${S.n6.responses}`);
  j('N7', ['n7'], () => S.n7.rpc && !S.n7.formVisible && S.n7.closedMsg, () => `${S.n7.rpc} · 폼 ${S.n7.formVisible}`);
  j('N8', ['n8'], () => S.n8.rows.every((x) => x.rejected) && S.n8.responses === 45, () => `거절 ${S.n8.rows.filter((x) => x.rejected).length}/${S.n8.rows.length} · 응답 ${S.n8.responses}`);
  j('N9', ['n9'], () => S.n9.every((x) => x.rejected), () => `거절 ${S.n9.filter((x) => x.rejected).length}/${S.n9.length}`);
  j('N10', ['n10'], () => S.n10.open === null && S.n10.closed === null && !S.n10.closedPageHasNumbers && !!S.n10.published, () => `열림 ${S.n10.open} · 마감 ${S.n10.closed} · 공개 ${S.n10.published}`);
  j('N11', ['n11'], () => {
    const o = S.n11;
    const c = o.b.counts ?? [];
    return o.lab.panel === 1 && o.lab.warn >= 1 && o.lab.errors.length === 0 && o.mod.joined && o.mod.created && o.mod.status === 'open' && o.mod.errors.length === 0 && c.length === 4 && c[1] === c[0] + 1 && c[2] === c[1] && c[3] === c[2] + 1 && o.b.errors.length === 0;
  }, () => `lab ${S.n11.lab.panel}/${S.n11.lab.warn} · mod ${S.n11.mod.created}/${S.n11.mod.status} · /b 제출 수 ${JSON.stringify(S.n11.b.counts)}`);
  j('N12', ['n12'], () => S.n12.hits.length === 0 && S.n12.control, () => `번들 ${S.n12.bundles}개 표본 ${S.n12.sampled} 적중 ${S.n12.hits.length} · 대조군 ${S.n12.control}`);
  j('N13', ['n13'], () => S.n13.every(([, ok]) => ok), () => `${S.n13.filter(([, ok]) => ok).length}/${S.n13.length}`);
  j('N15', ['n15'], () => S.n15.mod2.main && S.n15.mod2.all && !S.n15.mod2.b1 && !S.n15.mod2.b3 && S.n15.ops.b1 && S.n15.ops.b3 && S.n15.ops.all, () => `2분과 콘솔 b1 ${S.n15.mod2.b1}·b3 ${S.n15.mod2.b3} · 운영진 전부 ${S.n15.ops.b1 && S.n15.ops.b3} (서버: 2분과 토큰으로 1분과 상태변경 ${S.n15.serverRisk})`);
  // 별도 결함 항목 — UI 격리와 섞지 않는다
  if (S.p3lock) record('OBS-lock', S.p3lock.shownAfterImport === '2분과', `2분과 콘솔 가져오기 직후 표시 분과 「${S.p3lock.shownAfterImport}」(2분과 버튼 pressed=${S.p3lock.btn2Pressed}) → 2분과 클릭 뒤 「${S.p3lock.shownAfterClick}」`);
  if (S.n15) record('N15-server', /scope/.test(S.n15.serverRisk) && /^rejected/.test(S.n15.serverRisk), `2분과 조 토큰 → 1분과 투표 ballot_set_status_v2: ${S.n15.serverRisk}`);
  if (S.n15) record('N15-ops', /^ACCEPTED → open/.test(S.n15.opsChange ?? ''), `운영진 토큰 → 3분과 투표 open: ${S.n15.opsChange}`);
}

// ── 묶음 투표 ────────────────────────────────────────────────
const HOMEWORK = ['2-14', '2-15', '2-16', '2-17'];
const SIZES = [
  [1, '하나씩'],
  [5, '5개 안팎'],
  [10, '10개 안팎'],
  [Number.POSITIVE_INFINITY, '전체 한 번'],
];
/** 시험이 만드는 의결안 — 숙제 주제를 뺀 카드마다 하나. 제목은 번호만(공표 전 자료). */
function plannedMotions(div) {
  const out = [];
  for (const t of byDiv[div].topics) {
    if (HOMEWORK.includes(t.no)) continue;
    t.cards.forEach((c, i) => out.push({ id: `${t.no}-안${i + 1}`, topicNo: t.no, cardNo: c.no, title: `드라이런 ${c.no}` }));
  }
  return out;
}
const topicOfId = (id) => id.replace(/-안\d+$/, '');
/** 독립 재구현 — 로직 파일을 import 하지 않는다. 연속한 같은 주제를 한 덩어리로, 덩어리째 앞 묶음에 넣고 넘치면 새 묶음. */
function expectBatches(ids, size) {
  if (size <= 1) return ids.map((id) => [id]);
  const chunks = [];
  for (const id of ids) {
    const t = topicOfId(id);
    if (chunks.length && topicOfId(chunks[chunks.length - 1][0]) === t) chunks[chunks.length - 1].push(id);
    else chunks.push([id]);
  }
  const out = [];
  for (const ch of chunks) {
    if (out.length && out[out.length - 1].length + ch.length <= size) out[out.length - 1].push(...ch);
    else out.push([...ch]);
  }
  return out;
}
function expectLabel(batch) {
  if (batch.length === 1) return batch[0];
  const a = topicOfId(batch[0]);
  const b = topicOfId(batch[batch.length - 1]);
  return a === b ? a : `${a}~${b}`;
}
const batchArea = (page) => page.locator('[data-testid=division-batches]');
const batchBtns = (page) => batchArea(page).locator('ol > li > button');
const sizeBtn = (page, name) => batchArea(page).getByRole('button', { name, exact: true });
async function pickedIds(page) {
  return page.locator('[data-testid=division-vote-panel] fieldset li').evaluateAll((lis) =>
    lis.filter((li) => li.querySelector('input')?.checked).map((li) => li.querySelector('span.font-bold').textContent.trim()),
  );
}
async function shownMotionIds(page) {
  return page.locator('[data-testid=division-vote-panel] fieldset li span.font-bold').allTextContents();
}

/** 콘솔에서 의결안을 카드마다 하나씩 만든다(UI). */
async function makeAllMotions(page, div) {
  await divBtn(page, div).click();
  await viewTab(page, '준비판').click();
  for (const m of plannedMotions(div)) await makeMotion(page, [m.cardNo], m.title, '');
  return (await page.locator('[data-testid=motion-card]').evaluateAll((els) => els.map((e) => e.getAttribute('data-motion-id'))));
}

/** B1·B2·C2 측정 — 크기 4종 × 묶음 버튼 전부. */
async function measureBatches(page, div) {
  await viewTab(page, '투표 열기').click();
  await batchArea(page).waitFor();
  const screenIds = await shownMotionIds(page);
  const plannedIds = plannedMotions(div).map((m) => m.id);
  const out = { div, screenIds: screenIds.length, listMatchesPlan: JSON.stringify(screenIds) === JSON.stringify(plannedIds), sizes: {} };
  for (const [size, name] of SIZES) {
    await sizeBtn(page, name).click();
    await page.waitForTimeout(100);
    const pressed = await sizeBtn(page, name).getAttribute('aria-pressed');
    const others = [];
    for (const [, n2] of SIZES) if (n2 !== name) others.push(await sizeBtn(page, n2).getAttribute('aria-pressed'));
    const texts = (await batchBtns(page).allTextContents()).map((t) => t.replace(/\s+/g, ' ').trim());
    const members = [];
    for (let i = 0; i < texts.length; i++) {
      await batchBtns(page).nth(i).click();
      members.push(await pickedIds(page));
    }
    const exp = expectBatches(screenIds, size);
    const expTexts = exp.map((b, i) => `${i + 1}. ${expectLabel(b)} · 안 ${b.length}`);
    const gotTexts = texts.map((t) => t.replace(/ ✓$/, ''));
    const flat = members.flat();
    const topicBatches = new Map();
    members.forEach((b, i) => b.forEach((id) => topicBatches.set(topicOfId(id), new Set([...(topicBatches.get(topicOfId(id)) ?? []), i]))));
    const s = {
      pressed: pressed === 'true' && others.every((x) => x === 'false'),
      n: texts.length,
      expN: exp.length,
      textsMatch: JSON.stringify(gotTexts) === JSON.stringify(expTexts),
      membersMatch: JSON.stringify(members) === JSON.stringify(exp),
      union: flat.length === screenIds.length && new Set(flat).size === screenIds.length && screenIds.every((id) => flat.includes(id)),
      dup: flat.length - new Set(flat).size,
      order: JSON.stringify(flat) === JSON.stringify(screenIds),
      // 「하나씩」은 정의상 안 하나가 한 묶음이라 주제가 여러 묶음에 걸친다 — 걸침 검사는 크기 2 이상에만.
      split: size <= 1 ? [] : [...topicBatches.entries()].filter(([, set]) => set.size > 1).map(([t]) => t),
      splitByDesign: size <= 1 ? [...topicBatches.entries()].filter(([, set]) => set.size > 1).length : 0,
      mismatch: gotTexts.map((t, i) => (t === expTexts[i] ? null : `${t} ≠ ${expTexts[i]}`)).filter(Boolean).slice(0, 3),
      labels: gotTexts.map((t) => t.replace(/^\d+\. /, '')),
    };
    if (size === Number.POSITIVE_INFINITY) {
      await batchBtns(page).first().click();
      const alert = await page.locator('[data-testid=division-vote-panel] ul[role=alert]').textContent().catch(() => '');
      s.c2 = { total: screenIds.length, disabled: await page.locator('[data-testid=division-ballot-create]').isDisabled(), alert: alert.slice(0, 60), cap: /20개/.test(alert) };
    }
    out.sizes[name] = s;
  }
  return out;
}

/** 묶음 하나로 투표 만들기. double = 확인 대화상자의 「만들기」를 같은 틱에 두 번 누른다. */
async function createBatchBallot(page, sizeName, index, { double = false } = {}) {
  await viewTab(page, '투표 열기').click();
  await sizeBtn(page, sizeName).click();
  await batchBtns(page).nth(index).click();
  const ids = await pickedIds(page);
  const btnText = (await page.locator('[data-testid=division-ballot-create]').textContent()).trim();
  await page.locator('[data-testid=division-ballot-create]').click();
  const dlg = page.getByRole('dialog', { name: '투표 만들기 확인' });
  const make = dlg.getByRole('button', { name: '만들기', exact: true });
  if (double) await make.evaluate((b) => { b.click(); b.click(); });
  else await make.click();
  await dlg.waitFor({ state: 'detached', timeout: 20000 });
  await page.waitForTimeout(1200);
  return { ids, btnText };
}

async function regionAudit(page, sel) {
  return page.evaluate((sel) => {
    const root = document.querySelector(sel);
    if (!root) return { missing: true };
    const els = [];
    for (const el of root.querySelectorAll('*')) {
      const direct = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
      if (!direct && !['BUTTON', 'INPUT'].includes(el.tagName)) continue;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      els.push({ el, r, t: (el.textContent || el.tagName).trim().slice(0, 20) });
    }
    const overlaps = [];
    for (let i = 0; i < els.length; i++)
      for (let k = i + 1; k < els.length; k++) {
        const a = els[i];
        const b = els[k];
        if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
        const w = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
        const h = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
        if (w > 1 && h > 1) overlaps.push(`${a.t} × ${b.t}`);
      }
    const rr = root.getBoundingClientRect();
    const outside = els.filter((e) => e.r.left < rr.left - 1 || e.r.right > rr.right + 1).map((e) => e.t);
    const de = document.documentElement;
    return { n: els.length, overlaps: overlaps.slice(0, 10), nOverlaps: overlaps.length, outside: outside.slice(0, 10), docOverflow: de.scrollWidth > de.clientWidth, rootOverflow: root.scrollWidth > root.clientWidth, sw: de.scrollWidth, cw: de.clientWidth };
  }, sel);
}

async function openConsole(name, teamKey, viewport = { width: 1920, height: 1080 }) {
  const C = await newCtx(name, { viewport });
  await C.page.goto(`${SITE}/mod?code=${seed.teams[teamKey][1]}`, { waitUntil: 'networkidle' });
  await C.page.locator('#mod-tab-decision').waitFor({ timeout: 30000 });
  await C.page.locator('#mod-tab-decision').click();
  await C.page.locator('[data-testid=division-vote-panel]').waitFor();
  return C;
}
const listIds = (page) => page.locator('[data-ballot-id]').evaluateAll((els) => els.map((e) => e.getAttribute('data-ballot-id')));
const pickIds = (page) => page.locator('[data-ballot-pick]').evaluateAll((els) => els.map((e) => e.getAttribute('data-ballot-pick')));
const findBallot = async (token, title) => ((await rpc('ballot_list_v2', { p_token: token })).data ?? []).filter((b) => b.title === title);

/** /b 에서 안마다 찬성(2)/반대(1)를 골라 제출. */
async function voteUi(page, ballotToken, answersByOrdinal) {
  await page.goto(`${SITE}/b?t=${ballotToken}`, { waitUntil: 'networkidle' });
  const groups = page.locator('[role=group][aria-label$="응답"]');
  await groups.first().waitFor({ timeout: 20000 });
  const n = await groups.count();
  for (let k = 0; k < n; k++) await groups.nth(k).getByRole('button', { name: answersByOrdinal[k] === 2 ? '찬성' : '반대', exact: true }).click();
  await page.getByRole('button', { name: '제출하기' }).first().click();
  await page.getByRole('dialog').getByRole('button', { name: '제출하기' }).click();
  return page.getByText('의견이 제출되었습니다').waitFor({ timeout: 15000 }).then(() => n).catch(() => -1);
}

async function startFromVoteTab(page, id) {
  await page.locator('#mod-tab-vote').click();
  await page.waitForTimeout(1500);
  await ballotCard(page, id).getByRole('button', { name: '투표 시작', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '투표 시작', exact: true }).click();
  await page.waitForTimeout(1500);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
}
async function voteTabAction(page, id, label) {
  await page.locator('#mod-tab-vote').click();
  await page.waitForTimeout(1200);
  await ballotCard(page, id).getByRole('button', { name: label, exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: label, exact: true }).click();
  await page.waitForTimeout(1500);
}

async function phaseBatch() {
  const B = {};
  S.batch = B;
  const XSS_RE = /__xss/;
  const T = {};
  for (const k of ['b1', 'b2', 'b3', 'bx']) T[k] = await login(k);
  const R_IN = 8;
  const M_IN = 5;
  const created = {}; // div → [{id, token, title, ids}]

  // ═══ 1·3분과 콘솔 — 의결안 · 묶음 측정 · 묶음 #1 투표 ═══
  B.measure = {};
  for (const div of [1, 3]) {
    const C = await openConsole(`batchMod${div}`, `b${div}`);
    await importFile(C.page, RECS_FILE);
    const made = await makeAllMotions(C.page, div);
    B[`made${div}`] = made.length;
    B.measure[div] = await measureBatches(C.page, div);
    const c = await createBatchBallot(C.page, '5개 안팎', 0);
    const label = expectLabel(c.ids);
    const rows = await findBallot(T[`b${div}`], `${div}분과 의결 ${label}`);
    created[div] = rows.map((r) => ({ id: r.id, token: r.token, title: r.title, ids: c.ids }));
    for (const r of rows) manifest.ballots.push(r.id);
    saveManifest();
    await C.page.screenshot({ path: join(SHOTS, `b-mod${div}-batches.png`) });
    await C.ctx.close();
  }

  // ═══ 2분과 콘솔 ═══
  const C2 = await openConsole('batchMod2', 'b2');
  const pg = C2.page;
  await importFile(pg, RECS_FILE);
  // 잠금 관찰 — 가져온 직후 어느 분과가 보이고, 투표 만들기 버튼이 어느 분과 제목을 띄우는가
  {
    const head = (await pg.locator('[data-testid=division-vote-panel] p.text-\\[16px\\] > span.font-bold').first().textContent().catch(() => '')).trim();
    await viewTab(pg, '투표 열기').click();
    const btn = (await pg.locator('[data-testid=division-ballot-create]').textContent().catch(() => '')).trim();
    await pg.screenshot({ path: join(SHOTS, 'lock-b2-after-import-ballot-view.png') });
    // 서버 — 2분과 조 토큰으로 1분과 투표 생성이 되는가(되면 바로 보관)
    const r = await rpc('ballot_create_v3', { p_token: T.b2, p_title: '잠금 시험 1분과', p_instructions: null, p_items: [{ ordinal: 1, statement: '잠금 시험', scale: 2, required: true }], p_subgroup: '1분과', p_idempotency_key: randomUUID() });
    if (r.ok && r.data?.id) {
      manifest.ballots.push(r.data.id);
      saveManifest();
      const a = await rpc('ballot_set_status_v2', { p_token: T.b2, p_ballot_id: r.data.id, p_status: 'archived' });
      B.lockCreateArchive = a.ok ? a.data?.status : a.message;
    }
    B.lock = { shownAfterImport: head, createBtn: btn, serverCreateOtherDivision: r.ok ? `ACCEPTED (${r.data?.id?.slice(0, 8)})` : `rejected: ${r.message}` };
  }
  B.made2 = (await makeAllMotions(pg, 2)).length;
  B.measure[2] = await measureBatches(pg, 2);

  // B3 · B4 — 5개 안팎 묶음 #1
  const ballots = {};
  {
    const c = await createBatchBallot(pg, '5개 안팎', 0);
    const title = `2분과 의결 ${expectLabel(c.ids)}`;
    const rows = await findBallot(T.b2, title);
    rows.forEach((r) => manifest.ballots.push(r.id));
    saveManifest();
    const row = rows[0];
    const items = row ? ((await rpc('ballot_get', { p_token: row.token })).data?.items ?? []).sort((a, b) => a.ordinal - b.ordinal) : [];
    const expStmts = c.ids.map((id) => `${id} 드라이런 ${plannedMotions(2).find((m) => m.id === id).cardNo}`);
    B.b3 = {
      title,
      btnText: c.btnText,
      btnOk: c.btnText === `「${title}」 투표 만들기 (찬성/반대)`,
      rows: rows.length,
      subgroup: row?.subgroup,
      status: row?.status,
      itemCount: row?.item_count,
      batchN: c.ids.length,
      stmtsMatch: JSON.stringify(items.map((i) => i.statement)) === JSON.stringify(expStmts),
      stmtIds: items.map((i) => i.statement.split(' ')[0]),
      scales: items.map((i) => i.scale),
    };
    ballots.A = row ? { id: row.id, token: row.token, title, ids: c.ids, items } : null;
    // B4 — ✓ 와 중복 경고
    await sizeBtn(pg, '5개 안팎').click();
    const txt0 = (await batchBtns(pg).nth(0).textContent()).trim();
    const txt2 = (await batchBtns(pg).nth(2).textContent()).trim();
    await batchBtns(pg).nth(2).click();
    const alertOther = await pg.locator('[data-testid=division-vote-panel] p[role=alert]').filter({ hasText: '이미 있습니다' }).count();
    await batchBtns(pg).nth(0).click();
    await pg.waitForTimeout(200);
    const dupAlert = await pg.locator('[data-testid=division-vote-panel] p[role=alert]').filter({ hasText: '이미 있습니다' }).textContent().catch(() => '');
    await pg.locator('[data-testid=division-batches]').screenshot({ path: join(SHOTS, 'b4-check-and-dup.png') });
    B.b4 = { check0: / ✓$/.test(txt0), check2: / ✓$/.test(txt2), dupAlert: dupAlert.slice(0, 80), dupHasTitle: dupAlert.includes(title), alertOnOther: alertOther };
  }
  // C3 — 묶음 #2 를 두 번 클릭으로
  {
    const c = await createBatchBallot(pg, '5개 안팎', 1, { double: true });
    const title = `2분과 의결 ${expectLabel(c.ids)}`;
    await pg.waitForTimeout(1500);
    const rows = await findBallot(T.b2, title);
    rows.forEach((r) => manifest.ballots.push(r.id));
    saveManifest();
    B.c3 = { title, rows: rows.length };
    const row = rows[0];
    const items = row ? ((await rpc('ballot_get', { p_token: row.token })).data?.items ?? []).sort((a, b) => a.ordinal - b.ordinal) : [];
    ballots.B = row ? { id: row.id, token: row.token, title, ids: c.ids, items } : null;
  }
  // B6 — 하나씩, 마지막 안
  {
    await viewTab(pg, '투표 열기').click();
    await sizeBtn(pg, '하나씩').click();
    const n = await batchBtns(pg).count();
    const c = await createBatchBallot(pg, '하나씩', n - 1);
    const title = `2분과 의결 ${c.ids[0]}`;
    const rows = await findBallot(T.b2, title);
    rows.forEach((r) => manifest.ballots.push(r.id));
    saveManifest();
    B.b6 = { title, rows: rows.length, idShape: /^2-\d+-안\d+$/.test(c.ids[0]), items: rows[0]?.item_count, btnText: c.btnText };
    ballots.C = rows[0] ? { id: rows[0].id, token: rows[0].token, title } : null;
  }
  created[2] = Object.values(ballots).filter(Boolean);

  // C4(b) — 열린(마감 전) 투표의 공개 결과는 없다. C6 — 저장소 차단 기기로 /b 제출
  if (ballots.C) {
    const op = await rpc('ballot_set_status_v2', { p_token: T.b2, p_ballot_id: ballots.C.id, p_status: 'open' });
    B.c4open = { status: op.ok ? op.data.status : op.message, publicResults: (await rpc('ballot_results', { p_token: ballots.C.token })).data };
    const before = (await rpc('ballot_results_v2', { p_ballot_token: ballots.C.token, p_token: T.b2 })).data?.responses;
    const BV = await newCtx('batchBlockedVoter', { blockStorage: true, viewport: { width: 390, height: 844 } });
    const sent = [];
    BV.page.on('request', (rq) => {
      if (rq.url().includes('/rpc/ballot_submit')) {
        try {
          sent.push(JSON.parse(rq.postData()).p_client_id);
        } catch {
          /* */
        }
      }
    });
    const n = await voteUi(BV.page, ballots.C.token, [2]);
    const after = (await rpc('ballot_results_v2', { p_ballot_token: ballots.C.token, p_token: T.b2 })).data?.responses;
    const storageBlocked = await BV.page.evaluate(() => {
      try {
        void window.localStorage;
        return false;
      } catch {
        return true;
      }
    });
    sent.forEach((x) => manifest.clientIds.push(x));
    saveManifest();
    await BV.page.screenshot({ path: join(SHOTS, 'c6-blocked-voter.png') });
    B.c6 = { storageBlocked, itemsAnswered: n, before, after };
    await BV.ctx.close();
  }

  // B5 — A·B 시작(UI) → 브라우저 5대로 제출 → 마감·공개(UI)
  const VOTERS = 5;
  const planA = (k) => [4, 3, 5, 2, 4, 3, 5, 2][k % 8];
  const planB = (k) => [3, 4, 2, 5, 4, 3, 5, 2][k % 8];
  const ans = (plan, n, v) => Array.from({ length: n }, (_, k) => (v < plan(k) ? 2 : 1));
  if (ballots.A && ballots.B) {
    await startFromVoteTab(pg, ballots.A.id);
    await startFromVoteTab(pg, ballots.B.id);
    const st = async (id) => ((await rpc('ballot_list_v2', { p_token: T.b2 })).data ?? []).find((x) => x.id === id)?.status;
    B.b5 = { started: [await st(ballots.A.id), await st(ballots.B.id)], submitted: [] };
    const xssDialogs = [];
    for (let v = 0; v < VOTERS; v++) {
      const V = await newCtx(`batchVoter${v}`, { viewport: { width: 390, height: 844 } });
      const a = await voteUi(V.page, ballots.A.token, ans(planA, ballots.A.items.length, v));
      const b = await voteUi(V.page, ballots.B.token, ans(planB, ballots.B.items.length, v));
      const dev = await V.page.evaluate(() => localStorage.getItem('cv_device'));
      manifest.clientIds.push(dev);
      if (v === 0) await V.page.screenshot({ path: join(SHOTS, 'b5-voter-submitted.png') });
      B.b5.submitted.push([a, b]);
      xssDialogs.push(...(V.page.__dialogs ?? []));
      await V.ctx.close();
    }
    saveManifest();
    const dist = async (bl) => ((await rpc('ballot_results_v2', { p_ballot_token: bl.token, p_token: T.b2 })).data?.items ?? []).sort((x, y) => x.ordinal - y.ordinal).map((i) => i.dist?.['2'] ?? 0);
    B.b5.yeasA = await dist(ballots.A);
    B.b5.yeasB = await dist(ballots.B);
    B.b5.expA = ballots.A.items.map((_, k) => planA(k));
    B.b5.expB = ballots.B.items.map((_, k) => planB(k));
    await voteTabAction(pg, ballots.A.id, '투표 마감');
    await voteTabAction(pg, ballots.B.id, '투표 마감');
    await voteTabAction(pg, ballots.A.id, '결과 공개');
    await voteTabAction(pg, ballots.B.id, '결과 공개');
    B.b5.final = [await st(ballots.A.id), await st(ballots.B.id)];

    // 세리머니 — 1920·1280
    const expByLabel = {};
    ballots.A.items.forEach((it, k) => (expByLabel[it.statement.split(' ')[0]] = planA(k)));
    ballots.B.items.forEach((it, k) => (expByLabel[it.statement.split(' ')[0]] = planB(k)));
    const threshold = Math.ceil((2 * M_IN) / 3);
    const quorum = M_IN > R_IN / 2;
    const expPass = Object.values(expByLabel).filter((y) => quorum && y >= threshold).length;
    B.b5.expect = { threshold, quorum, expPass, total: Object.keys(expByLabel).length };
    B.b5.cer = {};
    for (const vp of [
      { width: 1920, height: 1080 },
      { width: 1280, height: 720 },
    ]) {
      const key = String(vp.width);
      await pg.setViewportSize(vp);
      await pg.locator('#mod-tab-decision').click();
      await divBtn(pg, 2).click();
      await viewTab(pg, '세리머니').click();
      await pg.getByLabel('재적 R').fill(String(R_IN));
      await pg.getByLabel('참석 M').fill(String(M_IN));
      await pg.getByRole('radio', { name: '실제 투표 결과' }).click();
      await pg.waitForTimeout(1500);
      const loadBtn = pg.getByRole('button', { name: '결과 불러오기' });
      const disabledNone = await loadBtn.isDisabled();
      await pg.locator(`[data-ballot-pick="${ballots.A.id}"]`).check();
      await pg.locator(`[data-ballot-pick="${ballots.B.id}"]`).check();
      await loadBtn.click();
      const loadRe = /투표 \d+개 · 안 \d+건 · 제출 [\d·]+명을 불러왔습니다/;
      await pg.getByText(loadRe).waitFor({ timeout: 20000 });
      const loadMsg = await pg.getByText(loadRe).textContent();
      await pg.locator('[data-testid=division-ceremony-start]').click();
      const seen = { disabledNone, loadMsg, verdicts: [] };
      let n = 0;
      const status = await runCeremony(pg, async (step) => {
        if (step === 'intro') {
          seen.intro = await pg.locator('[data-testid=ceremony-attendance]').getAttribute('data-established');
          await pg.screenshot({ path: join(SHOTS, `b5-ceremony-${key}-intro.png`) });
        }
        if (step === 'verdict') {
          n++;
          const all = await pg.locator('[data-testid=division-ceremony]').innerText();
          const label = /(\d-\d+-안\d+)/.exec(all)?.[1];
          seen.verdicts.push({ label, yeas: Number((await pg.locator('[data-testid=ceremony-yeas]').textContent()).trim()), stamp: await pg.locator('[data-testid=ceremony-stamp]').getAttribute('data-passed') });
          if (n === 1) await pg.screenshot({ path: join(SHOTS, `b5-ceremony-${key}-verdict1.png`) });
        }
        if (step === 'summary') {
          seen.summary = (await pg.locator('[data-testid=ceremony-summary]').innerText()).replace(/\s+/g, ' ');
          await pg.screenshot({ path: join(SHOTS, `b5-ceremony-${key}-summary.png`) });
        }
      });
      seen.status = status;
      await pg.keyboard.press('Escape');
      seen.loadedN = Number(/안 (\d+)건/.exec(loadMsg)?.[1]);
      seen.match = seen.verdicts.map((v) => ({ l: v.label, got: v.yeas, exp: expByLabel[v.label], stamp: v.stamp, expStamp: String(quorum && expByLabel[v.label] >= threshold) }));
      B.b5.cer[key] = seen;
    }
    await pg.setViewportSize({ width: 1920, height: 1080 });
  }

  // ═══ E1 — 화면 영역 겹침·넘침 ═══
  B.e1 = {};
  for (const vp of [
    { width: 1280, height: 720 },
    { width: 1920, height: 1080 },
  ]) {
    const key = `${vp.width}x${vp.height}`;
    await pg.setViewportSize(vp);
    await pg.locator('#mod-tab-decision').click();
    await divBtn(pg, 2).click();
    await viewTab(pg, '투표 열기').click();
    const r = {};
    for (const [, name] of SIZES) {
      await sizeBtn(pg, name).click();
      await pg.waitForTimeout(150);
      r[`batches-${name}`] = await regionAudit(pg, '[data-testid=division-batches]');
    }
    await sizeBtn(pg, '하나씩').click();
    await pg.locator('[data-testid=division-batches]').screenshot({ path: join(SHOTS, `e1-${key}-batches-one.png`) });
    await sizeBtn(pg, '5개 안팎').click();
    await pg.locator('[data-testid=division-batches]').screenshot({ path: join(SHOTS, `e1-${key}-batches-5.png`) });
    await pg.screenshot({ path: join(SHOTS, `e1-${key}-ballot-view.png`) });
    await pg.evaluate(() => {
      const li = document.querySelector('[data-ballot-id]');
      li?.closest('div.rounded-2xl')?.setAttribute('data-e1', 'list');
    });
    r.list = await regionAudit(pg, '[data-e1=list]');
    await pg.locator('[data-e1=list]').screenshot({ path: join(SHOTS, `e1-${key}-ballot-list.png`) }).catch(() => {});
    await viewTab(pg, '세리머니').click();
    await pg.getByRole('radio', { name: '실제 투표 결과' }).click();
    await pg.waitForTimeout(1500);
    await pg.evaluate(() => {
      document.querySelector('[data-ballot-pick]')?.closest('fieldset')?.setAttribute('data-e1', 'picks');
    });
    r.picks = await regionAudit(pg, '[data-e1=picks]');
    await pg.locator('[data-e1=picks]').screenshot({ path: join(SHOTS, `e1-${key}-ceremony-picks.png`) }).catch(() => {});
    B.e1[key] = r;
  }
  await pg.setViewportSize({ width: 1920, height: 1080 });

  // ═══ C1 — 2분과 콘솔에서 1·3분과 묶음 투표 ═══
  {
    const foreign = [...(created[1] ?? []), ...(created[3] ?? [])].map((b) => b.id);
    const own = (created[2] ?? []).map((b) => b.id);
    const look = async (div) => {
      await pg.locator('#mod-tab-decision').click();
      await divBtn(pg, div).click();
      await viewTab(pg, '투표 열기').click();
      await pg.getByRole('button', { name: '새로고침' }).click();
      await pg.waitForTimeout(1500);
      const list = await listIds(pg);
      await viewTab(pg, '세리머니').click();
      await pg.getByRole('radio', { name: '실제 투표 결과' }).click();
      await pg.waitForTimeout(1500);
      const picks = await pickIds(pg);
      return { list, picks };
    };
    const sel2 = await look(2);
    await pg.locator('#mod-tab-vote').click();
    await pg.waitForTimeout(1500);
    const voteTab = await listIds(pg);
    // 69b6fae — 2분과 콘솔에는 1·3분과 버튼 자체가 없어야 한다(recs 에 세 분과가 다 들어 있어도)
    await pg.locator('#mod-tab-decision').click();
    const btns = { div1: await divBtn(pg, 1).count(), div2: await divBtn(pg, 2).count(), div3: await divBtn(pg, 3).count() };
    await pg.screenshot({ path: join(SHOTS, 'c1-mod2-division-buttons.png') });
    const hit = (arr) => arr.filter((id) => foreign.includes(id)).length;
    B.c1 = {
      foreign: foreign.length,
      div2: { list: hit(sel2.list), picks: hit(sel2.picks), voteTab: hit(voteTab), ownSeen: own.every((id) => sel2.list.includes(id) && sel2.picks.includes(id)) },
      btns,
    };
  }

  // ═══ C5 — 다른 세션 조 ═══
  {
    const X = await openConsole('batchModX', 'bx');
    const xp = X.page;
    await importFile(xp, RECS_FILE);
    const seen = new Set();
    for (const div of [1, 2, 3]) {
      if (!(await divBtn(xp, div).count())) continue;
      await divBtn(xp, div).click();
      await viewTab(xp, '투표 열기').click();
      await xp.waitForTimeout(1500);
      (await listIds(xp)).forEach((id) => seen.add(id));
      await viewTab(xp, '세리머니').click();
      await xp.getByRole('radio', { name: '실제 투표 결과' }).click();
      await xp.waitForTimeout(1500);
      (await pickIds(xp)).forEach((id) => seen.add(id));
    }
    await xp.locator('#mod-tab-vote').click();
    await xp.waitForTimeout(2000);
    (await listIds(xp)).forEach((id) => seen.add(id));
    await xp.screenshot({ path: join(SHOTS, 'c5-x-console-vote-tab.png') });
    await X.ctx.close();
    const mine = [...Object.values(created).flat()].map((b) => b.id);
    const tgt = ballots.A ?? ballots.C;
    const res = await rpc('ballot_results_v2', { p_ballot_token: tgt.token, p_token: T.bx });
    const setS = await rpc('ballot_set_status_v2', { p_token: T.bx, p_ballot_id: tgt.id, p_status: 'archived' });
    const lst = ((await rpc('ballot_list_v2', { p_token: T.bx })).data ?? []).map((b) => b.id);
    B.c5 = {
      uiSeen: mine.filter((id) => seen.has(id)).length,
      results: res.ok && res.data ? `ACCEPTED` : `rejected: ${res.message || 'null'}`,
      setStatus: setS.ok ? `ACCEPTED → ${setS.data?.status}` : `rejected: ${setS.message}`,
      listLeak: mine.filter((id) => lst.includes(id)).length,
      note: 'ballot_submit 은 조 토큰이 아니라 투표 토큰을 받는다 — 조 토큰으로 제출하는 경로 자체가 없다',
    };
  }

  // ═══ C7 — XSS 묶음 투표 ═══
  {
    const A = '2-<img/src=x/onerror=window.__xss=31>';
    const src = {
      division: 2,
      agenda: 'xss 시험',
      topics: [
        { no: A, name: '<img src=x onerror="window.__xss=34">', written_by: '', raised_by: '', cards: Array.from({ length: 5 }, (_, i) => ({ no: `2-x-${i + 1}`, title: `<svg/onload=window.__xss=35>`, background: '', effect: '', schedule: '', recs: [{ no: '1', text: 'x' }] })) },
        { no: '2-98', name: 'normal', written_by: '', raised_by: '', cards: [{ no: '2-98-1', title: 't', background: '', effect: '', schedule: '', recs: [{ no: '1', text: 'x' }] }] },
      ],
    };
    const motions = [
      ...Array.from({ length: 5 }, (_, i) => ({ id: `${A}-안${i + 1}`, topicNo: A, cardNos: [`2-x-${i + 1}`], title: i % 2 ? '<svg/onload=window.__xss=33>' : '<img src=x onerror="window.__xss=32">', text: '<script>window.__xss=36</script>', criteria: {} })),
      { id: '2-98-안1', topicNo: '2-98', cardNos: ['2-98-1'], title: 'normal', text: '', criteria: {} },
    ];
    const f = join(OUT_DIR, 'c7-xss-prep.json');
    writeFileSync(f, JSON.stringify({ v: 1, division: 2, source: src, cards: {}, motions }));
    await pg.locator('#mod-tab-decision').click();
    await divBtn(pg, 2).click();
    await viewTab(pg, '준비판').click();
    await importFile(pg, f);
    const d0 = (pg.__dialogs ?? []).length;
    const c = await createBatchBallot(pg, '5개 안팎', 0);
    const title = `2분과 의결 ${A}`;
    const rows = await findBallot(T.b2, title);
    rows.forEach((r) => manifest.ballots.push(r.id));
    saveManifest();
    const row = rows[0];
    const probe = async (page) => page.evaluate(() => ({ flag: window.__xss ?? null, imgs: document.querySelectorAll('img[onerror], svg[onload]').length }));
    const r = { created: rows.length, picked: c.ids.length };
    r.consoleAfterCreate = await probe(pg);
    if (row) {
      await rpc('ballot_set_status_v2', { p_token: T.b2, p_ballot_id: row.id, p_status: 'open' });
      await pg.locator('#mod-tab-vote').click();
      await pg.waitForTimeout(2000);
      r.voteTab = await probe(pg);
      await pg.screenshot({ path: join(SHOTS, 'c7-vote-tab.png') });
      const V = await newCtx('batchXssVoter', { viewport: { width: 390, height: 844 } });
      const n = await voteUi(V.page, row.token, [2, 2, 1, 2, 1]);
      r.voter = { ...(await probe(V.page)), answered: n, dialogs: V.page.__dialogs ?? [] };
      manifest.clientIds.push(await V.page.evaluate(() => localStorage.getItem('cv_device')));
      saveManifest();
      await V.page.screenshot({ path: join(SHOTS, 'c7-voter.png') });
      await V.ctx.close();
      await rpc('ballot_set_status_v2', { p_token: T.b2, p_ballot_id: row.id, p_status: 'closed' });
      await pg.locator('#mod-tab-decision').click();
      await viewTab(pg, '투표 열기').click();
      await pg.getByRole('button', { name: '새로고침' }).click();
      await pg.waitForTimeout(1500);
      r.decisionList = await probe(pg);
      await viewTab(pg, '세리머니').click();
      await pg.getByRole('radio', { name: '실제 투표 결과' }).click();
      await pg.waitForTimeout(1500);
      await pg.locator(`[data-ballot-pick="${row.id}"]`).check();
      await pg.getByRole('button', { name: '결과 불러오기' }).click();
      await pg.waitForTimeout(2500);
      await pg.locator('[data-testid=division-ceremony-start]').click();
      await runCeremony(pg, async (step) => {
        if (step === 'title' && !r.cerShot) {
          r.cerShot = true;
          await pg.screenshot({ path: join(SHOTS, 'c7-ceremony-title.png') });
        }
      });
      await pg.screenshot({ path: join(SHOTS, 'c7-ceremony-summary.png') });
      r.ceremony = await probe(pg);
      await pg.keyboard.press('Escape');
    }
    r.consoleDialogs = (pg.__dialogs ?? []).slice(typeof d0 === 'number' ? d0 : 0);
    r.consoleErrs = consoleErrors.batchMod2.filter((m) => XSS_RE.test(m));
    B.c7 = r;
  }
  B.created = Object.fromEntries(Object.entries(created).map(([k, v]) => [k, v.map((b) => ({ id: b.id, title: b.title }))]));
  await C2.ctx.close();
}

/** DB 없이 미리보기(lab)에서 셀렉터·기대값 계산을 먼저 맞춰 본다(점수 아님). */
async function phaseLab() {
  const L = await newCtx('batchLab', { viewport: { width: 1920, height: 1080 } });
  await L.page.goto(`${SITE}/ko/moderator/insights/division-vote-lab`, { waitUntil: 'networkidle' });
  await L.page.locator('[data-testid=division-vote-panel]').waitFor({ timeout: 20000 });
  await importFile(L.page, RECS_FILE);
  await makeAllMotions(L.page, 1);
  S.batch = { measure: { 1: await measureBatches(L.page, 1) } };
  const m = S.batch.measure[1];
  for (const [name, s] of Object.entries(m.sizes)) record(`LAB-${name}`, s.pressed && s.textsMatch && s.membersMatch && s.union && s.order && !s.split.length, `${s.n}/${s.expN} 묶음 · ${s.labels.join(' ')} ${s.c2 ? JSON.stringify(s.c2) : ''}`);
  S.labErrors = { page: pageErrors.batchLab, console: consoleErrors.batchLab };
  await L.ctx.close();
}

function judgeBatch() {
  const B = S.batch;
  if (!B) return;
  if (B.lock) record('OBS-lock-batch', B.lock.shownAfterImport === '2분과' && /2분과 의결/.test(B.lock.createBtn) && /^rejected/.test(B.lock.serverCreateOtherDivision), `b2 콘솔 가져오기 직후 「${B.lock.shownAfterImport}」 · 만들기 버튼 「${B.lock.createBtn}」 · 서버 2분과 토큰→1분과 생성 ${B.lock.serverCreateOtherDivision}`);
  const sizes = (d) => Object.values(B.measure?.[d]?.sizes ?? {});
  const divs = [1, 2, 3];
  const okMeasured = divs.every((d) => B.measure?.[d] && sizes(d).length === 4);
  record('B1', okMeasured && divs.every((d) => B.measure[d].listMatchesPlan && sizes(d).every((s) => s.pressed && s.n === s.expN && s.textsMatch)), `분과별 의결안 ${divs.map((d) => B.measure?.[d]?.screenIds).join('/')} · 묶음 수 ${divs.map((d) => sizes(d).map((s) => s.n).join(',')).join(' | ')} · 불일치 ${JSON.stringify(divs.flatMap((d) => sizes(d).flatMap((s) => s.mismatch)))}`);
  record('B2', okMeasured && divs.every((d) => sizes(d).every((s) => s.membersMatch && s.union && s.dup === 0 && s.order && s.split.length === 0)), `12조합 — 합집합 ${divs.every((d) => sizes(d).every((s) => s.union))} · 중복 ${divs.reduce((n, d) => n + sizes(d).reduce((m, s) => m + s.dup, 0), 0)} · 순서 ${divs.every((d) => sizes(d).every((s) => s.order))} · 주제 걸침 ${JSON.stringify(divs.flatMap((d) => sizes(d).flatMap((s) => s.split)))}`);
  const b3 = B.b3;
  record('B3', !!b3 && b3.rows === 1 && b3.subgroup === '2분과' && b3.itemCount === b3.batchN && b3.stmtsMatch && b3.scales.every((x) => x === 2) && b3.btnOk, b3 ? `「${b3.title}」 ${b3.rows}개 · ${b3.subgroup} · 문항 ${b3.itemCount}/${b3.batchN} · 문장 순서 ${b3.stmtsMatch} · scale ${b3.scales} · 버튼 「${b3.btnText}」` : '미측정');
  const b4 = B.b4;
  record('B4', !!b4 && b4.check0 && !b4.check2 && b4.dupHasTitle && b4.alertOnOther === 0, b4 ? `#1 ✓ ${b4.check0} · #3 ✓ ${b4.check2} · 경고 「${b4.dupAlert}」 · 다른 묶음 경고 ${b4.alertOnOther}` : '미측정');
  const b5 = B.b5;
  const cerOk = (c) => c && c.status === 'done' && c.loadedN === b5.expect.total && c.verdicts.length === b5.expect.total && c.match.every((m) => m.got === m.exp && m.stamp === m.expStamp) && new RegExp(`의결 ${b5.expect.expPass}건`).test(c.summary) && c.intro === String(b5.expect.quorum);
  record('B5', !!b5 && JSON.stringify(b5.yeasA) === JSON.stringify(b5.expA) && JSON.stringify(b5.yeasB) === JSON.stringify(b5.expB) && b5.submitted.every(([a, b]) => a > 0 && b > 0) && b5.final.every((s) => s === 'published') && cerOk(b5.cer?.['1920']) && cerOk(b5.cer?.['1280']), b5 ? `기기 ${b5.submitted.length}대 · A 찬성 ${b5.yeasA}(기대 ${b5.expA}) · B ${b5.yeasB}(기대 ${b5.expB}) · R${R_IN_J}/M${M_IN_J} 기준 ${b5.expect.threshold}표 · 불러온 안 ${b5.cer?.['1920']?.loadedN}/${b5.expect.total} · 요약 「${b5.cer?.['1920']?.summary}」 기대 의결 ${b5.expect.expPass}건 · 1280 ${cerOk(b5.cer?.['1280'])}` : '미측정');
  const b6 = B.b6;
  record('B6', !!b6 && b6.rows === 1 && b6.idShape && b6.items === 1, b6 ? `「${b6.title}」 ${b6.rows}개 · 문항 ${b6.items}` : '미측정');
  const c1 = B.c1;
  record('C1', !!c1 && c1.foreign >= 2 && c1.div2.list === 0 && c1.div2.picks === 0 && c1.div2.voteTab === 0 && c1.div2.ownSeen && c1.btns.div1 === 0 && c1.btns.div3 === 0 && c1.btns.div2 === 1, c1 ? `타 분과 투표 ${c1.foreign}개 — 의결 목록 ${c1.div2.list}·세리머니 체크 ${c1.div2.picks}·투표 탭 ${c1.div2.voteTab} · 자기 투표 보임 ${c1.div2.ownSeen} · 분과 버튼 1:${c1.btns.div1} 2:${c1.btns.div2} 3:${c1.btns.div3}` : '미측정');
  const c2 = divs.map((d) => B.measure?.[d]?.sizes?.['전체 한 번']?.c2);
  record('C2', c2.every((x) => x && x.total > 20 && x.disabled && x.cap), `전체 한 번 — ${c2.map((x, i) => (x ? `${i + 1}분과 ${x.total}안 비활성 ${x.disabled} 「${x.alert}」` : '미측정')).join(' · ')}`);
  record('C3', !!B.c3 && B.c3.rows === 1, B.c3 ? `「${B.c3.title}」 DB ${B.c3.rows}개` : '미측정');
  const nonePicked = [B.b5?.cer?.['1920']?.disabledNone, B.b5?.cer?.['1280']?.disabledNone];
  record('C4', nonePicked.every((x) => x === true) && !!B.c4open && B.c4open.status === 'open' && B.c4open.publicResults === null, `선택 0 「결과 불러오기」 비활성 ${nonePicked} · 열린 투표 공개결과 ${JSON.stringify(B.c4open?.publicResults)}`);
  const c5 = B.c5;
  record('C5', !!c5 && c5.uiSeen === 0 && c5.listLeak === 0 && /^rejected/.test(c5.results) && /^rejected/.test(c5.setStatus), c5 ? `x 콘솔 노출 ${c5.uiSeen} · 목록 ${c5.listLeak} · 결과 ${c5.results} · 상태변경 ${c5.setStatus}` : '미측정');
  const c6 = B.c6;
  record('C6', !!c6 && c6.storageBlocked && c6.itemsAnswered === 1 && c6.after === c6.before + 1, c6 ? `저장소 차단 ${c6.storageBlocked} · 제출 수 ${c6.before}→${c6.after}` : '미측정');
  const c7 = B.c7;
  const clean = (p) => p && p.flag === null && p.imgs === 0;
  record('C7', !!c7 && c7.created === 1 && ['consoleAfterCreate', 'voteTab', 'voter', 'decisionList', 'ceremony'].every((k) => clean(c7[k])) && (c7.voter?.answered ?? 0) > 0 && c7.consoleDialogs.length === 0 && (c7.voter?.dialogs ?? []).length === 0, c7 ? `투표 ${c7.created}개 · flag ${['consoleAfterCreate', 'voteTab', 'voter', 'decisionList', 'ceremony'].map((k) => `${k}:${c7[k]?.flag ?? '-'}/${c7[k]?.imgs ?? '-'}`).join(' ')} · dialog ${c7.consoleDialogs.length + (c7.voter?.dialogs ?? []).length}` : '미측정');
  const e1 = Object.values(B.e1 ?? {}).flatMap((r) => Object.values(r));
  record('E1', Object.keys(B.e1 ?? {}).length === 2 && e1.length > 0 && e1.every((a) => !a.missing && a.nOverlaps === 0 && !a.docOverflow && !a.rootOverflow && a.outside.length === 0), `${e1.length}영역 — 겹침 ${e1.reduce((n, a) => n + (a.nOverlaps ?? 0), 0)} · 문서 가로넘침 ${e1.filter((a) => a.docOverflow).length} · 영역 넘침 ${e1.filter((a) => a.rootOverflow).length} · 누락 ${e1.filter((a) => a.missing).length}`);
  const names = Object.keys(pageErrors).filter((k) => k.startsWith('batch'));
  const pe = names.flatMap((k) => pageErrors[k].map((m) => `${k}: ${m}`));
  const ce = names.flatMap((k) => consoleErrors[k].map((m) => ({ k, m })));
  const intended = (x) => /status of 4\d\d|Failed to load resource/.test(x.m) || (x.k === 'batchBlockedVoter' && /\[browser storage\]/.test(x.m));
  const unexpected = ce.filter((x) => !intended(x));
  S.batchErrors = { pageErrors: pe, consoleIntended: ce.filter(intended).map((x) => `${x.k}: ${x.m}`), consoleUnexpected: unexpected.map((x) => `${x.k}: ${x.m}`), net: Object.fromEntries(names.map((k) => [k, netErrors[k]])) };
  record('E2', pe.length === 0 && unexpected.length === 0, `pageerror ${pe.length} · console error ${ce.length}(의도된 거부·저장소 차단 ${ce.length - unexpected.length}, 그 외 ${unexpected.length}) ${unexpected.slice(0, 3).map((x) => x.m).join(' | ')}`);
}
const R_IN_J = 8;
const M_IN_J = 5;

// ── 실행 + 판정 ──────────────────────────────────────────────
try {
  if (PHASE === 'expired') await phaseExpired();
  else if (PHASE === 'p5') await phaseP5();
  else if (PHASE === 'batch') await phaseBatch();
  else if (PHASE === 'lab') await phaseLab();
  else await phaseMain();
} catch (error) {
  record('RUN', false, `중단: ${String(error?.message ?? error).slice(0, 300)}`);
} finally {
  if (PHASE === 'main') judgeMain();
  if (PHASE === 'batch') {
    try {
      judgeBatch();
    } catch (e) {
      record('JUDGE', false, String(e).slice(0, 200));
    }
    for (const k of ['b1', 'b2', 'b3', 'bx']) {
      const v = manifest.tokens[k];
      if (v && !v.loggedOut) v.loggedOut = (await logout(v.token)).ok;
    }
    saveManifest();
  }
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
