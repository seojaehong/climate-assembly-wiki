#!/usr/bin/env node
/**
 * 10/17 발표 화면(10/15) 드라이런 — 운영 창 + 발표 창(같은 브라우저, BroadcastChannel).
 * ★ 실제 Supabase 를 친다. 드라이런 세션의 운영팀(분과 빈) 코드로만, 그 세션에 기본 자료(load-1017-baseline.ts)를 넣은 뒤 돌린다.
 *   BASE_URL=http://localhost:4321 OPS_CODE=123456 OUT_DIR=... PLAYWRIGHT_MODULE=file:///.../playwright/index.mjs node scripts/verify-1017-present.mjs
 * 확인: 문구를 치면 발표 창 제목이 바로 바뀐다 · 투표 시작 → 발표 창 QR, 노트북에는 QR 전체 화면 없음 · 마감 → 발표 창 결과.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const BASE = process.env.BASE_URL ?? 'http://localhost:4321';
const OUT = process.env.OUT_DIR ?? 'e2e-1017-present-out';
const CODE = process.env.OPS_CODE;
if (!CODE) throw new Error('OPS_CODE 필요');
mkdirSync(OUT, { recursive: true });
const log = [];
const record = (k, ok, d) => { log.push(`${ok ? 'PASS' : 'FAIL'}  ${k} — ${d}`); console.log(log.at(-1)); };
const twoStep = async (loc) => { await loc.click(); await loc.page().waitForTimeout(250); await loc.click(); };

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'ko-KR' });
const errors = [];
const A = await ctx.newPage();
A.on('pageerror', (e) => errors.push('A ' + e.message.slice(0, 150)));
A.on('dialog', (d) => d.accept());
await A.goto(`${BASE}/mod?code=${CODE}`, { waitUntil: 'domcontentloaded' });
await A.locator('#mod-tab-decision').waitFor({ timeout: 40000 });
await A.getByRole('button', { name: '1분과 화면 열기' }).click();
await A.getByRole('tab', { name: '1. 준비판', exact: true }).click();
await A.locator('[data-testid=motion-card]').first().waitFor({ timeout: 20000 });

// 발표 창 열기
const [P] = await Promise.all([ctx.waitForEvent('page'), A.locator('[data-testid=present-open]').click()]);
P.on('pageerror', (e) => errors.push('P ' + e.message.slice(0, 150)));
await P.setViewportSize({ width: 1920, height: 1080 });
await P.locator('[data-testid=present-screen]').waitFor({ timeout: 40000 });
await A.waitForTimeout(2500);
const linked = (await A.locator('[data-testid=present-open]').innerText()).trim();
record('p1-linked', /연결됨/.test(linked), `운영 창 버튼: ${linked} · 발표 창 장면 ${await P.locator('[data-testid=present-screen]').getAttribute('data-scene')}`);

// 문구 치기 → 발표 창 제목
const card = A.locator('[data-testid=motion-card]').first();
const id = await card.getAttribute('data-motion-id');
const title = card.locator(`[aria-label="${id} 제목"]`);
await title.click();
const phrase = '발표 화면 시험 문구 — 다회용기 회수 체계를 전국으로 넓힌다';
await title.fill(phrase);
const t0 = Date.now();
await P.locator('[data-testid=present-title]', { hasText: '전국으로 넓힌다' }).waitFor({ timeout: 5000 }).catch(() => undefined);
const shown = (await P.locator('[data-testid=present-title]').innerText().catch(() => '')).trim();
record('p2-live-title', shown === phrase, `${Date.now() - t0}ms 뒤 발표 창 「${shown.slice(0, 30)}…」 · 세부 권고 ${await P.locator('[data-testid=present-recs] li').count()}줄`);
await P.screenshot({ path: `${OUT}/p2_motion.png` });

// 투표 진행: 참석 넣고 시작
await A.getByRole('tab', { name: '2. 투표 진행', exact: true }).click();
const box = A.locator('[data-testid=attendance-box]');
await box.getByLabel('재적').fill('12');
await box.getByLabel('참석').fill('9');
await A.waitForTimeout(800);
const unit = A.locator(`[data-testid=vote-unit]:has-text("${id}")`).first();
await twoStep(unit.locator('[data-testid=vote-start]'));
await P.locator('[data-testid=present-screen][data-scene=vote]').waitFor({ timeout: 30000 }).catch(() => undefined);
await P.waitForTimeout(2000);
const pScene = await P.locator('[data-testid=present-screen]').getAttribute('data-scene');
const laptopQr = await A.getByRole('img', { name: /QR/ }).count();
record('p3-vote-on-presenter', pScene === 'vote' && laptopQr === 0, `발표 창 장면 ${pScene} · 노트북 QR 이미지 ${laptopQr}개`);
await P.screenshot({ path: `${OUT}/p3_vote.png` });

// 마감 → 결과
await twoStep(unit.locator('[data-testid=vote-close]'));
await P.locator('[data-testid=present-screen][data-scene=result]').waitFor({ timeout: 30000 }).catch(() => undefined);
const verdict = (await P.locator('[data-testid=present-verdict]').innerText().catch(() => '')).trim();
record('p4-result', !!verdict, `발표 창 장면 ${await P.locator('[data-testid=present-screen]').getAttribute('data-scene')} · 판정 「${verdict}」`);
await P.screenshot({ path: `${OUT}/p4_result.png` });
const hn = unit.locator('[data-testid=hand-none]');
if (await hn.count()) { await hn.click(); await A.waitForTimeout(1500); }
record('p5-result-final', /가결|부결/.test((await P.locator('[data-testid=present-verdict]').innerText().catch(() => '')).trim()), `거수 없음 뒤 「${(await P.locator('[data-testid=present-verdict]').innerText().catch(() => '')).trim()}」`);
await P.screenshot({ path: `${OUT}/p5_result_final.png` });

// 발표 창 닫으면 노트북이 다시 QR 을 띄우는 상태로
await P.close();
await A.waitForTimeout(5000);
record('p6-unlinked', /열기/.test(await A.locator('[data-testid=present-open]').innerText()), `닫은 뒤 버튼: ${(await A.locator('[data-testid=present-open]').innerText()).trim()}`);
record('p7-no-errors', errors.length === 0, errors.join(' | ') || '없음');
writeFileSync(`${OUT}/results.md`, log.join('\n') + '\n', 'utf8');
await browser.close();
process.exit(log.some((l) => l.startsWith('FAIL')) ? 1 : 0);
