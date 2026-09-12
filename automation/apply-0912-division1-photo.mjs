import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';

const apply = process.argv.includes('--apply');
const privateDirectory = process.env.WORKSHOP_PRIVATE_DIRECTORY;
const sourcePhoto = process.env.WORKSHOP_SOURCE_PHOTO;
if (!privateDirectory || !sourcePhoto) throw new Error('Private credential directory and source photo are required');
const password = readFileSync(`${privateDirectory}/0912-hq-initial-credential-correction.sql`, 'utf8').match(/crypt\('([^']+)'\s*,/)?.[1];
if (!password) throw new Error('Private HQ credential unavailable');
const desired = { 1: [6, 9, 4, 7], 2: [8, 6, 1], 3: [4, 2, 3, 6], 4: [8, 1, 6, 2], 5: [7, 5, 4, 8] };
const report = { startedAt: new Date().toISOString(), status: 'started', apply, sourcePhotoSha256: createHash('sha256').update(readFileSync(sourcePhoto)).digest('hex'), desired, changed: [], scope: '1분과 배정만; 작은 숫자 순위 및 문안·상태 변경 제외' };
report.pendingConfirmation = '2조 맨 위 주제 3번/7번 판독 확인 대기. 기존 두 배정은 유지.';
const persist = () => writeFileSync('evaluation/0912-agenda-progress-board/division1-photo-assignment.json', `${JSON.stringify(report, null, 2)}\n`);
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
page.setDefaultTimeout(45000);
let loggedIn = false;
const snapshot = async () => {
  const rows = [];
  for (const article of await page.locator('article[data-agenda-subgroup]').all()) {
    const subgroup = await article.getAttribute('data-agenda-subgroup');
    const ordinal = Number((await article.locator('p').first().textContent()).match(/주제\s+(\d+)/)?.[1]);
    const teams = [];
    for (let team = 1; team <= 5; team++) {
      const button = article.getByRole('button', { name: new RegExp(`^(✓ )?${team}조$`) });
      if (await button.count() !== 1) throw new Error('Assignment controls unavailable');
      if (await button.getAttribute('aria-pressed') === 'true') teams.push(team);
    }
    rows.push({ subgroup, ordinal, title: await article.locator('h3').first().textContent(), teams });
  }
  return rows;
};
try {
  await page.goto('https://climate-assembly.org/hq/', { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.getByLabel('운영자 표시 이름').fill('서재홍');
  await page.getByLabel('개인 비밀번호', { exact: true }).fill(password);
  await page.getByRole('button', { name: '본부 로그인', exact: true }).click();
  await page.locator('article[data-agenda-subgroup="1분과"]').first().waitFor();
  loggedIn = true;
  report.before = await snapshot();
  const division = report.before.filter((row) => row.subgroup === '1분과');
  if (division.length !== 9 || new Set(division.map((row) => row.ordinal)).size !== 9) throw new Error('Unexpected division catalog');
  const extras = division.flatMap((row) => row.teams.filter((team) => !desired[team].includes(row.ordinal) && !(team === 2 && [3, 7].includes(row.ordinal))).map((team) => ({ agenda: row.ordinal, team })));
  if (extras.length) { report.existingUnpicturedAssignments = extras; throw new Error('Existing assignments conflict with photo; no mutation performed'); }
  report.status = 'preflight_pass';
  persist();
  if (apply) {
    for (const row of division) {
      const article = page.locator('article[data-agenda-subgroup="1분과"]').filter({ has: page.locator('p').filter({ hasText: new RegExp(`^1분과 · 주제 ${row.ordinal}$`) }) });
      if (await article.count() !== 1) throw new Error('Agenda identity mismatch');
      for (let team = 1; team <= 5; team++) {
        if (!desired[team].includes(row.ordinal) || row.teams.includes(team)) continue;
        const button = article.getByRole('button', { name: new RegExp(`^(✓ )?${team}조$`) });
        if (await button.getAttribute('aria-pressed') !== 'true') {
          await button.click();
          await article.getByRole('button', { name: `✓ ${team}조`, exact: true }).waitFor();
          report.changed.push({ agenda: row.ordinal, team }); persist();
        }
      }
    }
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('article[data-agenda-subgroup="1분과"]').first().waitFor();
    report.after = await snapshot();
    for (const row of report.after.filter((item) => item.subgroup === '1분과')) {
      const expected = [1, 2, 3, 4, 5].filter((team) => desired[team].includes(row.ordinal) || (team === 2 && [3, 7].includes(row.ordinal) && division.find((before) => before.ordinal === row.ordinal).teams.includes(team)));
      if (JSON.stringify(row.teams) !== JSON.stringify(expected)) throw new Error('Read-back assignment mismatch');
    }
    report.otherDivisionsUnchanged = JSON.stringify(report.before.filter((row) => row.subgroup !== '1분과')) === JSON.stringify(report.after.filter((row) => row.subgroup !== '1분과'));
    if (!report.otherDivisionsUnchanged) throw new Error('Other division snapshot changed');
    report.status = 'partial_pending_confirmation';
  }
} catch (error) {
  report.status = 'fail'; report.errorType = error instanceof Error ? error.name : 'UnknownError'; process.exitCode = 1;
} finally {
  if (loggedIn) {
    try { await page.getByRole('button', { name: '로그아웃', exact: true }).click(); await page.getByRole('button', { name: '본부 로그인', exact: true }).waitFor(); report.loggedOut = true; }
    catch { report.loggedOut = false; process.exitCode = 1; }
  }
  report.finishedAt = new Date().toISOString(); persist(); await browser.close();
  console.log(JSON.stringify(report));
}
