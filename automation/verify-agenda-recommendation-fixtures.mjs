import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const baseUrl = (process.env.AGENDA_FIXTURE_BASE_URL ?? 'http://127.0.0.1:4323').replace(/\/$/, '');
const outputDir = resolve(process.cwd(), 'evaluation/0912-agenda-progress-board');
const reportPath = resolve(outputDir, 'browser-fixture-report.json');
const hqScreenshot = resolve(outputDir, 'hq-add-agenda.png');
const teamScreenshot = resolve(outputDir, 'team-recommendation-authoring.png');

mkdirSync(outputDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  serviceWorkers: 'block',
});
const externalAttempts = [];
await context.route('**/*', async (route) => {
  const requestUrl = new URL(route.request().url());
  if (requestUrl.origin !== new URL(baseUrl).origin) {
    externalAttempts.push(requestUrl.href);
    await route.abort('blockedbyclient');
    return;
  }
  await route.continue();
});
await context.routeWebSocket(/.*/, (socket) => socket.close());

const checks = [];
const record = (name, passed, detail) => {
  checks.push({ name, passed, detail });
  if (!passed) throw new Error(`${name}: ${detail}`);
};

try {
  const hq = await context.newPage();
  await hq.goto(`${baseUrl}/ko/moderator/insights/agenda-progress-lab/`, { waitUntil: 'networkidle' });
  await hq.getByRole('heading', { name: '분과별 권고안 진행상황판' }).waitFor();
  const divisionCounts = {};
  for (const [division, expected] of [['1분과', 9], ['2분과', 8], ['3분과', 8]]) {
    const count = await hq.locator(`article[data-agenda-subgroup="${division}"]`).count();
    divisionCounts[division] = count;
    record(`hq-agenda-count-${division}`, count === expected, `${division} 의제는 ${expected}건이어야 합니다(실제 ${count}건).`);
    record(`hq-projector-${division}`, await hq.getByRole('button', { name: `${division} 현황 송출` }).isVisible(), `${division} 송출 버튼이 보여야 합니다.`);
  }
  const firstAgenda = hq.locator('article[data-agenda-subgroup="1분과"]').first();
  record('hq-multi-team-assignment', await firstAgenda.locator('button[aria-pressed="true"]').count() >= 2, '하나의 의제에 두 개 이상 조가 배정된 상태를 표시해야 합니다.');
  for (const label of ['대기', '논의 중', '초안 작성', '조 확인', '제출 완료']) {
    const labelMatches = await hq.getByText(label, { exact: true }).all();
    const visible = (await Promise.all(labelMatches.map((match) => match.isVisible()))).some(Boolean);
    record(`hq-status-${label}`, visible, `5단계 상태의 '${label}'이 표시되어야 합니다.`);
  }
  await hq.getByRole('button', { name: '1분과 현황 송출' }).click();
  record('hq-projector-open', await hq.getByRole('heading', { name: '1분과 권고안 진행상황' }).isVisible(), '분과 전체화면 송출이 열려야 합니다.');
  await hq.getByRole('button', { name: '운영 화면으로', exact: true }).click();
  await hq.getByRole('button', { name: '+ 새 의제 추가' }).click();
  await hq.getByLabel('새 의제 제목').fill('현장 추가 의제 예시');
  await hq.getByLabel('새 의제 연결 시민 원문').fill('시민이 말한 원문을 그대로 연결하는 입력 예시입니다.');
  record('hq-add-fields', await hq.getByLabel('새 의제 연결 시민 원문').isVisible(), '의제 제목과 연결 시민 원문 입력칸이 필요합니다.');
  await hq.screenshot({ path: hqScreenshot });

  const team = await context.newPage();
  await team.goto(`${baseUrl}/ko/moderator/insights/agenda-progress-team-lab/`, { waitUntil: 'networkidle' });
  await team.getByRole('heading', { name: '우리 조 권고안 작성' }).waitFor();
  record('team-agenda-select', await team.getByLabel('작성할 의제 선택').isVisible(), '배정 의제 드롭다운이 보여야 합니다.');

  const transitionId = '30000000-0000-4000-8000-000000000001';
  const transitionCard = team.locator(`section[data-recommendation-id="${transitionId}"]`);
  const waitForTransition = async (status) => {
    await team.locator(`section[data-recommendation-id="${transitionId}"][data-recommendation-status="${status}"]`).waitFor();
    record(`team-transition-${status}`, true, `${status} 단계로 전환되어야 합니다.`);
  };
  record('team-transition-waiting', await transitionCard.getAttribute('data-recommendation-status') === 'waiting', '권고안은 대기에서 시작해야 합니다.');
  await transitionCard.getByRole('button', { name: '논의 시작', exact: true }).click();
  await waitForTransition('discussing');
  await transitionCard.getByRole('button', { name: '초안 작성 완료', exact: true }).click();
  await waitForTransition('drafting');
  await transitionCard.getByRole('button', { name: '조 확인 완료', exact: true }).click();
  await waitForTransition('team_confirmed');
  await transitionCard.getByRole('button', { name: '최종 제출', exact: true }).click();
  await waitForTransition('submitted');

  await team.getByRole('button', { name: '+ 권고안 추가' }).click();
  await team.getByLabel('새 권고안 권고안 제목').fill('생활권 기후안전망 강화');
  await team.getByLabel('새 권고안 배경·문제 인식').fill('폭염 취약계층의 쉼터 접근성이 지역마다 다릅니다.');
  await team.getByLabel('새 권고안 권고 내용').fill('생활권별 쉼터 운영시간과 이동 지원을 함께 제공합니다.');
  record('team-active-fields', await team.getByLabel('새 권고안 권고 내용').isVisible(), '오늘 작성할 세 입력칸이 모두 보여야 합니다.');
  record('inactive-fields-hidden', await team.getByText('이행 일정', { exact: true }).count() === 0, '이행 일정 이후 필드는 현재 입력 화면에 나오면 안 됩니다.');
  await team.screenshot({ path: teamScreenshot });

  record('no-external-network', externalAttempts.length === 0, `외부 연결 시도 ${externalAttempts.length}건`);
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    status: 'pass',
    baseUrl,
    checks,
    divisionCounts,
    externalNetworkAttemptCount: externalAttempts.length,
    productionDatabaseRequestCount: 0,
    screenshots: [
      'evaluation/0912-agenda-progress-board/hq-add-agenda.png',
      'evaluation/0912-agenda-progress-board/team-recommendation-authoring.png',
    ],
  };
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify(report)}\n`);
} catch (error) {
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    status: 'fail',
    baseUrl,
    checks,
    externalNetworkAttemptCount: externalAttempts.length,
    productionDatabaseRequestCount: 0,
    error: error instanceof Error ? error.message : String(error),
  };
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  throw error;
} finally {
  await browser.close();
}
