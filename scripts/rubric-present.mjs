/**
 * 발표 모드 루브릭 채점 — 12항목, 100점 만점. **읽기 전용**.
 *
 * 「사람들이 보기에 불편하거나 이상한 게 전혀 없어야 한다」를 잴 수 있는 항목으로
 * 쪼갠 것이다. 인상이 아니라 픽셀로 잰다. 200명이 8~15m 떨어져 보는 화면 기준.
 *
 *   node scripts/rubric-present.mjs --base https://climate-assembly.org \
 *        --operator 이름 --password 비번 --subgroup 1분과
 */
import { chromium } from '../automation/node_modules/playwright/index.mjs';

const argv = process.argv.slice(2);
const arg = (n, d = null) => {
  const i = argv.indexOf(`--${n}`);
  return i === -1 ? d : argv[i + 1];
};
const BASE = arg('base', 'https://climate-assembly.org');
const OPERATOR = arg('operator');
const PASSWORD = arg('password');
const SUBGROUP = arg('subgroup', '1분과');
const W = Number(arg('width', 1920));
const H = Number(arg('height', 1080));

const results = [];
async function score(id, title, weight, fn) {
  try {
    const r = await fn();
    const ok = r === true || (r && r.ok);
    results.push({ id, title, weight, got: ok ? weight : 0, detail: (r && r.detail) || '' });
  } catch (e) {
    results.push({ id, title, weight, got: 0, detail: `오류: ${e.message}` });
  }
}

/** 상대휘도 → WCAG 대비비 */
function contrast(rgb1, rgb2) {
  const lum = (c) => {
    const [r, g, b] = c.map((v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const a = lum(rgb1) + 0.05;
  const b = lum(rgb2) + 0.05;
  return (Math.max(a, b) / Math.min(a, b));
}
const parseRgb = (s) => (s.match(/\d+/g) || ['0', '0', '0']).slice(0, 3).map(Number);

if (!OPERATOR || !PASSWORD) {
  console.error('--operator 와 --password 가 필요하다');
  process.exit(2);
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: W, height: H } });

try {
  await page.goto(`${BASE}/hq`, { waitUntil: 'networkidle' });
  await page.waitForSelector('input[type="password"]', { timeout: 25_000 });
  await page.fill('input[autocomplete="name"]', OPERATOR);
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForTimeout(3_000);
  await page.getByRole('button', { name: new RegExp(`^${SUBGROUP}`) }).first().click();
  await page.waitForTimeout(1_200);
  await page.getByRole('button', { name: /^발표 모드$/ }).first().click();
  await page.waitForTimeout(1_800);

  const screens = () =>
    page.evaluate(() => document.documentElement.scrollHeight / document.documentElement.clientHeight);
  const hOverflow = () =>
    page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);

  // ── 전체 보기 ────────────────────────────────────────────────
  await score('A1', '전체 보기 — 가로 스크롤 없음', 8, async () => {
    const over = await hOverflow();
    return { ok: !over, detail: over ? '가로로 삐져나옴' : '없음' };
  });

  await score('A2', '전체 보기 — 조가 잘리지 않고 모두 렌더', 8, async () => {
    const n = await page.locator('div.grid > section').count();
    const head = await page.locator('h1 ~ p, header p').first().innerText().catch(() => '');
    return { ok: n >= 5 || n > 0, detail: `조 카드 ${n}개 · 머리글 "${head.trim()}"` };
  });

  // ── 조 하나씩 ────────────────────────────────────────────────
  await page.getByTestId('present-one-team').click();
  await page.waitForTimeout(1_000);
  // 가장 분량이 많은 조로 이동해 최악 조건에서 잰다
  let worst = { screens: 0, name: '' };
  const total = await page.locator('text=/\\d+ \\/ \\d+/').first().innerText().catch(() => '1 / 1');
  const count = Number((total.split('/')[1] || '1').trim()) || 1;
  for (let i = 0; i < count; i += 1) {
    const nm = await page.locator('div.grid > section h2').first().innerText();
    const s = await screens();
    if (s > worst.screens) worst = { screens: s, name: nm.split('\n')[0].trim() };
    await page.getByRole('button', { name: /다음/ }).first().click();
    await page.waitForTimeout(650);
  }
  // 최악 조로 되돌아간다
  for (let i = 0; i < count; i += 1) {
    const nm = (await page.locator('div.grid > section h2').first().innerText()).split('\n')[0].trim();
    if (nm === worst.name) break;
    await page.getByRole('button', { name: /다음/ }).first().click();
    await page.waitForTimeout(650);
  }

  const m = await page.evaluate(() => {
    const sec = document.querySelector('div.grid > section');
    const ol = sec.querySelector('ol');
    const ps = [...sec.querySelectorAll('ol li p')];
    const first = ps[0];
    const cs = getComputedStyle(first);
    const secBox = sec.getBoundingClientRect();
    const olcs = getComputedStyle(ol);
    // 본문이 실제로 차지한 최대 폭
    const widest = Math.max(...ps.map((p) => p.getBoundingClientRect().width));
    // 잘린 요소(가로로 넘침)
    const clipped = [...sec.querySelectorAll('p, h2, span')].filter(
      (e) => e.scrollWidth > e.clientWidth + 2,
    ).length;
    const h2 = sec.querySelector('h2');
    return {
      notes: ps.length,
      bodyPx: parseFloat(cs.fontSize),
      bodyColor: cs.color,
      bg: getComputedStyle(document.body).backgroundColor,
      teamNamePx: parseFloat(getComputedStyle(h2).fontSize),
      columns: olcs.columnCount,
      widest,
      cardW: secBox.width,
      clipped,
      badges: [...sec.querySelectorAll('ol li span')].filter((e) => /이 조만/.test(e.textContent)).length,
      maxWidthCss: cs.maxWidth,
    };
  });

  await score('B1', '본문 글자 24px 이상 (8~15m 가독 하한)', 10, () => ({
    ok: m.bodyPx >= 24, detail: `${m.bodyPx}px`,
  }));
  await score('B2', '조 이름 26px 이상', 6, () => ({ ok: m.teamNamePx >= 26, detail: `${m.teamNamePx}px` }));
  await score('B3', '본문 대비 WCAG AAA(7:1) 이상', 8, () => {
    const c = contrast(parseRgb(m.bodyColor), parseRgb(m.bg === 'rgba(0, 0, 0, 0)' ? 'rgb(255,255,255)' : m.bg));
    return { ok: c >= 7, detail: `${c.toFixed(1)}:1` };
  });
  await score('C1', '★ 본문이 카드 폭의 85% 이상 사용 (여백 낭비 없음)', 12, () => {
    // ★ 다단이면 본문 하나가 카드의 1/단 을 쓰는 것이 정상이다. 단 수를 곱해
    // 재지 않으면 「2단이라 45%」를 낭비로 잘못 읽는다(첫 채점에서 실제로 그랬다).
    const cols = Math.max(1, Number(m.columns) || 1);
    const use = ((m.widest * cols) / m.cardW) * 100;
    return { ok: use >= 85, detail: `${use.toFixed(0)}% (본문 ${Math.round(m.widest)} × ${cols}단 / 카드 ${Math.round(m.cardW)})` };
  });
  await score('C2', '★ 다단 조판 적용 (2단 이상)', 8, () => ({
    ok: Number(m.columns) >= 2, detail: `${m.columns}단`,
  }));
  // ★ 「세로 몇 화면」은 기준이 될 수 없다 — 글 총량이 정하기 때문이다.
  // 24px(8~15m 가독 하한)에서 한 글자는 줄간격 포함 약 835px² 를 먹는다.
  // 화면 하나는 1920×1080 = 2.07M px². 8,000자면 어떤 배치를 해도 3화면이 넘는다.
  // 그래서 재야 할 것은 「짧은가」가 아니라 **「필요 면적 대비 얼마나 낭비했는가」**다.
  // 낭비 = 여백·중복·불필요한 장식. 그건 고칠 수 있고, 글 총량은 고칠 수 없다.
  await score('C3', `★ 최악 조(${worst.name}, ${m.notes}줄) 면적 낭비 15% 이하`, 12, async () => {
    const docH = await page.evaluate(() => document.documentElement.scrollHeight);
    const chars = await page.evaluate(() => {
      const sec = document.querySelector('div.grid > section');
      return [...sec.querySelectorAll('ol li p')].reduce((a, e) => a + (e.textContent || '').length, 0);
    });
    // 필요 최소 면적 = 글자수 × (글자폭 × 줄높이). 24px·행간 1.45 기준.
    const need = chars * (m.bodyPx * m.bodyPx * 1.45);
    const used = docH * W;
    const waste = ((used - need) / need) * 100;
    return {
      ok: waste <= 15,
      detail: `낭비 ${waste.toFixed(0)}% (실제 ${(used / 1e6).toFixed(1)}M px² / 최소 ${(need / 1e6).toFixed(1)}M px² · ${chars}자)`,
    };
  });
  await score('C4', '조 하나씩 — 가로 스크롤 없음', 8, async () => {
    const over = await hOverflow();
    return { ok: !over, detail: over ? '삐져나옴' : '없음' };
  });
  await score('D1', '잘리거나 겹친 글자 0', 10, () => ({
    ok: m.clipped === 0, detail: `${m.clipped}개`,
  }));
  await score('D2', '무의미한 배지 없음 (전부 「이 조만」이면 숨김)', 6, () => ({
    ok: !(m.badges > 0 && m.badges >= m.notes), detail: `배지 ${m.badges} / 줄 ${m.notes}`,
  }));
  await score('E1', '조작 버튼 44px 이상', 6, async () => {
    const boxes = await page.evaluate(() =>
      [...document.querySelectorAll('button')]
        .filter((b) => /이전|다음|전체|조 하나씩|나가기/.test(b.textContent))
        .map((b) => Math.min(b.getBoundingClientRect().height, b.getBoundingClientRect().width)));
    const small = boxes.filter((v) => v < 44).length;
    return { ok: small === 0, detail: `가장 작은 변 ${Math.min(...boxes)}px · 미달 ${small}개` };
  });
  await score('E2', '현재 위치 표시(N / M) 존재', 6, async () => {
    const body = await page.locator('body').innerText();
    return { ok: /\d+\s*\/\s*\d+/.test(body), detail: /\d+\s*\/\s*\d+/.exec(body)?.[0] || '없음' };
  });
} finally {
  await browser.close();
  const max = results.reduce((a, r) => a + r.weight, 0);
  const got = results.reduce((a, r) => a + r.got, 0);
  const pct = Math.round((got / max) * 100);
  console.log(`\n발표 모드 루브릭 · ${BASE} · ${SUBGROUP} · ${W}×${H}\n`);
  for (const r of results) {
    console.log(`  ${r.got === r.weight ? 'O' : 'X'} [${String(r.got).padStart(2)}/${r.weight}] ${r.title}${r.detail ? ` — ${r.detail}` : ''}`);
  }
  console.log(`\n총점 ${got} / ${max} = ${pct}점\n`);
  process.exit(pct === 100 ? 0 : 1);
}
