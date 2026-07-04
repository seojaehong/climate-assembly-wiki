import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

const readText = (path) => readFileSync(path, 'utf8');

describe('0704 conditional vote console', () => {
  test('offers projector-sized QR and gated result views for every conditional vote', () => {
    const html = readText('public/0704-admin/vote-structure.html');

    for (const code of ['V0', 'V1A', 'V1B']) {
      expect(html).toContain(`data-qr="${code}"`);
      expect(html).toContain(`data-result-slot="${code}"`);
      expect(html).toContain(`data-count-slot="${code}"`);
    }

    expect(html).toContain('id="qrModal"');
    expect(html).toContain('id="resultModal"');
    expect(html).toContain('data-result-next');
    expect(html).toContain('result-card feature');
    expect(html).toContain('renderActiveResult');
    expect(html).toContain('완료 전에는 결과를 참여단에게 공개하지 않습니다');
    expect(html).toContain('/0704-admin/decision-votes-report.json');
  });

  test('refresh script publishes the latest admin result snapshot', () => {
    const script = readText('scripts/refresh-0704-decision-votes.ps1');

    expect(script).toContain('public/0704-admin/decision-votes-report.json');
    expect(script).toContain('evaluation/0704-decision-votes-report.json');
  });

  test('conditional vote results can refresh continuously during a live vote', () => {
    const page = readText('public/0704-admin/vote-structure.html');
    const script = readText('scripts/refresh-0704-decision-votes.ps1');
    const liveFunction = readText('functions/0704-admin/decision-votes-live.json.js');

    expect(page).toContain('/0704-admin/decision-votes-live.json');
    expect(page).toContain('setInterval(loadDecisionReport, 5000)');
    expect(page).toContain('결과는 5초마다 자동 갱신됩니다');
    expect(page).toContain('운영 확인 및 발표 전환용');
    expect(page).not.toContain('관리자 확인용');
    expect(script).toContain('[switch]$Watch');
    expect(script).toContain('[int]$IntervalSeconds = 10');
    expect(script).toContain('Watching decision vote responses every $IntervalSeconds seconds');
    expect(script).toContain('Start-Sleep -Seconds $IntervalSeconds');
    expect(script).not.toContain('"-NameQuestionTitle", $NameQuestionTitle');
    expect(script).toContain('NameQuestionId = "380be3dc"');
    expect(script).toContain('NameQuestionId = "6c1868ed"');
    expect(script).toContain('NameQuestionId = "150bc490"');
    expect(script).toContain('$slot.NameQuestionId');
    expect(script).toContain('PublicSummarySpreadsheetId = "19xrXFFmaP4bS3JB2o6HeYmDyYgZhK6ez8URAHFYcBss"');
    expect(script).toContain('Update-SheetRows -TargetSpreadsheetId $PublicSummarySpreadsheetId');
    expect(liveFunction).toContain('PUBLIC_SUMMARY_SPREADSHEET_ID');
    expect(liveFunction).toContain('19xrXFFmaP4bS3JB2o6HeYmDyYgZhK6ez8URAHFYcBss');
    expect(liveFunction).toContain('public_summary_sheet');
  });

  test('admin and field manual enlarge every QR instead of opening tiny thumbnails', () => {
    const admin = readText('public/0704-admin/index.html');
    const manual = readText('public/0704-admin/operator-manual.html');

    expect((admin.match(/class="qr-box"/g) ?? []).length).toBeGreaterThanOrEqual(4);
    expect(admin).toContain('data-qr-title="탄소 감축 질문 QR"');
    expect(admin).toContain('data-qr-title="조별 의제 입력 QR"');
    expect(admin).toContain('data-qr-title="의제투표 QR"');
    expect(admin).toContain('data-qr-title="17~18시 소감발표 QR"');
    expect(admin).toContain('id="qr-modal-img"');
    expect(admin).toContain('openQrModal(qrBox)');

    expect((manual.match(/class="qr"/g) ?? []).length).toBeGreaterThanOrEqual(7);
    expect(manual).toContain('id="qr-modal-img"');
    expect(manual).toContain("document.querySelectorAll('a.qr')");
    expect(manual).toContain('openQr(qr)');
  });

  test('dashboard marks A/B live sheet as the default question route', () => {
    const admin = readText('public/0704-admin/index.html');
    const manual = readText('public/0704-admin/operator-manual.html');

    expect(admin).toContain('기본은 A/B 기록모더레이터 Sheet 입력');
    expect(admin).toContain('참여단 직접 QR 입력을 지시할 때만');
    expect(manual).toContain('기본 질문 수합은 A/B 입력 Sheet');
  });

  test('handoff records the previous Supabase regulation-vote reference', () => {
    const handoff = readText('docs/0704-dashboard-handoff.md');

    expect(handoff).toContain('Supabase 운영규정 투표 레퍼런스');
    expect(handoff).toContain('/regulation-vote/');
    expect(handoff).toContain('/archive/2026-06-14/regulation_R1-R9_results.html');
  });

  test('full demo scenario is available without touching live Sheets', () => {
    const admin = readText('public/0704-admin/index.html');
    const voteStructure = readText('public/0704-admin/vote-structure.html');
    const agendaRace = readText('public/agenda-vote-0704/index.html');
    const decisionDemo = JSON.parse(readText('public/0704-admin/decision-votes-report-demo-full.json'));
    const agendaDemo = JSON.parse(readText('public/agenda-vote-0704/data-demo-full.json'));

    expect(admin).toContain('/0704-admin/vote-structure?demo=full');
    expect(admin).toContain('/agenda-vote-0704/index.html?demo=full');
    expect(voteStructure).toContain('decision-votes-report-demo-full.json');
    expect(agendaRace).toContain("DATA_FILE = DEMO_MODE ? 'data-demo-full.json' : 'data.json'");
    expect(agendaRace).toContain("SHEET_ID = DEMO_MODE ? null : PAGE_PARAMS.get('sheet')");
    expect(decisionDemo.slots.map((slot) => slot.responseCount)).toEqual([64, 61, 58]);
    expect(agendaDemo.agendas).toHaveLength(10);
    expect(agendaDemo.meta.phases.map((phase) => phase.id)).toEqual(['pre', 'c1', 'c2', 'c3', 'c4', 'total']);
  });

  test('0704 field operation labels match the A/B and 17-group scenario', () => {
    const admin = readText('public/0704-admin/index.html');
    const manual = readText('public/0704-admin/operator-manual.html');

    expect(admin).toContain('13~16시는 A/B조');
    expect(admin).toContain('A조/B조');
    expect(admin).toContain('1~17조 시민 응답만');
    expect(admin).not.toContain('1~17조 + 연구진');
    expect(manual).toContain('13~16시');
    expect(manual).toContain('A조/B조');
    expect(manual).toContain('17시 이후');
    expect(manual).toContain('1~17조 중 선택');
    expect(manual).not.toContain('1~17조 + 연구진');
  });

  test('vote refresh scripts use participant names for duplicate checks', () => {
    const agendaRefresh = readText('scripts/refresh-0704-agenda-vote.ps1');
    const decisionRefresh = readText('scripts/refresh-0704-decision-votes.ps1');
    const formSetup = readText('scripts/ensure-0704-form-field-setup.ps1');

    expect(agendaRefresh).toContain('NameQuestionTitle');
    expect(agendaRefresh).toContain('name_latest_response');
    expect(agendaRefresh).toContain('duplicate_dropped');
    expect(agendaRefresh).toContain('Guide!D1:E11');
    expect(agendaRefresh).not.toContain('"Guide!D1:E7"');
    expect(decisionRefresh).toContain('NameQuestionTitle');
    expect(decisionRefresh).toContain('name_latest_response');
    expect(decisionRefresh).toContain('duplicate_dropped');
    expect(formSetup).toContain('title = "이름"');
    expect(formSetup).toContain('$i -le 17');
    expect(formSetup).not.toContain('$targetGroups += "연구진"');
  });

  test('agenda vote is generated as one 1-to-5 scale question per agenda and averaged into Scores', () => {
    const promote = readText('scripts/promote-0704-live-sheet-agendas-to-vote.ps1');
    const refresh = readText('scripts/refresh-0704-agenda-vote.ps1');

    expect(promote).toContain('scaleQuestion');
    expect(promote).toContain('low = 1');
    expect(promote).toContain('high = 5');
    expect(promote).toContain('createItem');
    expect(promote).not.toContain('type = "RADIO"');
    expect(refresh).toContain('scaleQuestion');
    expect(refresh).toContain('averageScore');
    expect(refresh).toContain('scoreSum');
    expect(refresh).toContain('[switch]$Watch');
    expect(refresh).toContain('Watching agenda vote responses every $IntervalSeconds seconds');
    expect(refresh).not.toContain('selectedAgenda');
  });

  test('single live operation sync command refreshes sheets, forms, votes, and deploys optionally', () => {
    const admin = readText('public/0704-admin/index.html');
    const manual = readText('public/0704-admin/operator-manual.html');
    const sync = readText('scripts/sync-0704-live-operation.ps1');

    expect(admin).toContain('scripts\\sync-0704-live-operation.ps1 -Deploy');
    expect(manual).toContain('scripts\\sync-0704-live-operation.ps1 -Deploy');
    expect(sync).toContain('ensure-0704-form-field-setup.ps1 -Apply');
    expect(sync).toContain('refresh-0704-input-forms.ps1');
    expect(sync).toContain('export-0704-live-sheet-packets.ps1');
    expect(sync).toContain('promote-0704-live-sheet-agendas-to-vote.ps1 -Apply');
    expect(sync).toContain('refresh-0704-agenda-vote.ps1');
    expect(sync).toContain('refresh-0704-decision-votes.ps1');
    expect(sync).toContain('wrangler pages deploy');
    expect(sync).toContain('Deployment complete');
  });

  test('live sheet packet export can watch and refresh print files every 30 seconds', () => {
    const admin = readText('public/0704-admin/index.html');
    const exportScript = readText('scripts/export-0704-live-sheet-packets.ps1');

    expect(admin).toContain('export-0704-live-sheet-packets.ps1 -Watch -IntervalSeconds 30');
    expect(exportScript).toContain('[switch]$Watch');
    expect(exportScript).toContain('[int]$IntervalSeconds = 30');
    expect(exportScript).toContain('Start-Sleep -Seconds $IntervalSeconds');
    expect(exportScript).toContain('-Watch and -SendEmail cannot be used together');
  });

  test('agenda candidates have a Miro-style board before voting', () => {
    const admin = readText('public/0704-admin/index.html');
    const manual = readText('public/0704-admin/operator-manual.html');
    const exportScript = readText('scripts/export-0704-live-sheet-packets.ps1');
    const board = readText('public/agenda-board-0704/index.html');

    expect(admin).toContain('/agenda-board-0704/index.html');
    expect(manual).toContain('https://climate-assembly.org/agenda-board-0704/');
    expect(exportScript).toContain('AgendaBoardData');
    expect(exportScript).toContain('public/agenda-board-0704/data.json');
    expect(board).toContain('투표 전 조별 의제 후보 보드');
    expect(board).toContain('/agenda-board-0704/data.json');
    expect(board).toContain('renderLane');
    expect(board).toContain("const POLL_MS = 5000");
    expect(board).toContain('Google Sheet 직접 연결');
    expect(board).toContain('setInterval(load, POLL_MS)');
  });

  test('live questions have a board for expert review as a separate track from print PDFs', () => {
    const admin = readText('public/0704-admin/index.html');
    const manual = readText('public/0704-admin/operator-manual.html');
    const board = readText('public/question-board-0704/index.html');

    expect(admin).toContain('/question-board-0704/index.html');
    expect(admin).toContain('Sheet 질문 보드');
    expect(manual).toContain('질문 보드는 전문가 화면');
    expect(manual).toContain('https://climate-assembly.org/question-board-0704/');
    expect(board).toContain('전문가 전달용 조별 질문 누적 보드');
    expect(board).toContain('/agenda-board-0704/data.json');
    expect(board).toContain('LIVE QUESTIONS');
    expect(board).toContain("const POLL_MS = 5000");
    expect(board).toContain('Google Sheet 직접 연결');
    expect(board).toContain('setInterval(load, POLL_MS)');
  });

  test('question and agenda boards keep cards within narrow mobile lanes', () => {
    const questionBoard = readText('public/question-board-0704/index.html');
    const agendaBoard = readText('public/agenda-board-0704/index.html');

    expect(questionBoard).toContain('minmax(min(100%,340px),1fr)');
    expect(agendaBoard).toContain('minmax(min(100%,320px),1fr)');
    expect(questionBoard).toContain('@media (max-width:900px)');
    expect(agendaBoard).toContain('@media (max-width:900px)');
  });
});
