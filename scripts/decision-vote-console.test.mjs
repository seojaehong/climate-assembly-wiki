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
    expect(admin).toContain('1~17조 + 연구진');
    expect(manual).toContain('13~16시');
    expect(manual).toContain('A조/B조');
    expect(manual).toContain('17시 이후');
    expect(manual).toContain('1~17조 + 연구진');
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
  });
});
