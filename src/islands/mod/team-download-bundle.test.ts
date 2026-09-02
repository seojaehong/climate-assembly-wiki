import { describe, it, expect } from 'vitest';
import type { HqSubmissionRow } from '../../lib/hq-submissions';
import { buildBoards } from './hq-submission-board-logic';
import { buildSubmissionReport, reportToCsv, reportToText, reportFileName } from './submission-report';
import { buildZipArchive } from './zip-store';
import {
  MULTI_DOWNLOAD_HINT,
  TEAM_BUNDLE_FORMATS,
  buildTeamBundleEntries,
  shouldShowMultiDownloadHint,
  teamBundleFileName,
} from './team-download-bundle';

function row(over: Partial<HqSubmissionRow> = {}): HqSubmissionRow {
  return {
    topic_id: 't1',
    topic_ordinal: 1,
    topic_prompt: '배경·문제 인식',
    topic_status: 'open',
    team_id: 'team-1',
    team_name: '1분과 1조',
    team_subgroup: '1분과',
    table_no: '3',
    submission_id: 'sub-1',
    submission_status: 'draft',
    submission_updated_at: '2026-08-29T05:00:00Z',
    submission_finalized_at: null,
    item_ordinal: 1,
    item_kind: 'core',
    item_content: '우리는 마을에서 버스 배차 간격이 두 시간이 넘는다는 것을 확인하였다',
    item_rationale: null,
    ...over,
  };
}

// 조가 쓴 카드 3장 + 한 줄도 안 쓴 조 1개(미제출 표기가 살아 있는지 보려고 둔다).
const boards = buildBoards([
  row(),
  row({ item_ordinal: 2, item_content: '우리는 요금이 비싸다는 것을 확인하였다', item_rationale: '7.4 기록' }),
  row({ topic_id: 't2', topic_ordinal: 2, topic_prompt: '바라는 변화', item_content: '버스가 자주 오는 상태가 된다' }),
  row({
    team_id: 'team-2',
    team_name: '1분과 2조',
    table_no: null,
    submission_status: null,
    item_ordinal: null,
    item_kind: null,
    item_content: null,
    item_rationale: null,
  }),
]);

const report = buildSubmissionReport(boards, {
  generatedAt: '2026-08-29 14:05',
  scopeLabel: '1분과 1조',
});

const docxBytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x01, 0x02, 0x03]);
const parts = { docx: docxBytes, csv: reportToCsv(report), txt: reportToText(report) };
// ⚠️ `ignoreBOM: true` 가 없으면 TextDecoder 가 앞머리 BOM 을 **먹어 버려**
//    「바이트로 같다」 검사가 CSV 만 조용히 어긋난다. 여기서는 실린 그대로를 읽어야 한다.
const decode = (bytes: Uint8Array) => new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes);

describe('buildTeamBundleEntries', () => {
  it('세 형식을 워드·엑셀·줄글 순으로 담는다', () => {
    expect(TEAM_BUNDLE_FORMATS).toEqual(['docx', 'csv', 'txt']);
    expect(buildTeamBundleEntries(report, parts)).toHaveLength(3);
    expect(buildTeamBundleEntries(report, parts).map((e) => e.name.slice(-4))).toEqual([
      'docx',
      '.csv',
      '.txt',
    ]);
  });

  it('개별 내려받기와 같은 파일명 규칙을 쓴다', () => {
    expect(buildTeamBundleEntries(report, parts).map((e) => e.name)).toEqual([
      reportFileName(report, 'docx'),
      reportFileName(report, 'csv'),
      reportFileName(report, 'txt'),
    ]);
  });

  // 이름이 겹치면 압축을 풀 때 한 파일이 다른 파일을 덮어써 조용히 사라진다.
  it('이름이 서로 다르다', () => {
    const names = buildTeamBundleEntries(report, parts).map((e) => e.name);
    expect(new Set(names).size).toBe(3);
  });

  // ★ 불변식 — ZIP 은 담기만 한다. 고르거나 줄이거나 새로 쓰지 않는다.
  it('내용이 개별 내려받기와 바이트로 같다', () => {
    const [docx, csv, txt] = buildTeamBundleEntries(report, parts);
    expect(Array.from(docx.data)).toEqual(Array.from(docxBytes));
    expect(decode(csv.data)).toBe(reportToCsv(report));
    expect(decode(txt.data)).toBe(reportToText(report));
  });

  // 엑셀이 한글을 깨서 열지 않게 개별 CSV 가 붙이는 BOM 이 ZIP 안에서도 살아야 한다.
  it('CSV 의 BOM 을 그대로 싣는다', () => {
    const csv = buildTeamBundleEntries(report, parts)[1];
    expect(Array.from(csv.data.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf]);
  });

  // 회의자료 260811 「소수의견 삭제 금지」 — 한 줄도 안 쓴 조가 ZIP 안에서도 이름을 남긴다.
  it('카드 수와 미제출 표기가 줄지 않는다', () => {
    const [, csv, txt] = buildTeamBundleEntries(report, parts);
    const zipCsv = decode(csv.data);
    expect(zipCsv.split('\r\n').filter((line) => line.length > 0)).toHaveLength(
      reportToCsv(report).split('\r\n').filter((line) => line.length > 0).length
    );
    expect(zipCsv).toContain('미제출');
    expect(decode(txt.data)).toContain('미제출 1개 조 — 1분과 2조');
  });

  it('묶은 것이 실제로 열리는 ZIP 이다', () => {
    const archive = buildZipArchive(buildTeamBundleEntries(report, parts), new Date(2026, 7, 29, 14, 5));
    expect(Array.from(archive.slice(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04]);
    // EOCD 의 항목 수(리틀엔디언 16비트)가 3이어야 압축 해제기가 셋을 다 본다.
    const eocd = archive.length - 22;
    expect(archive[eocd + 10] | (archive[eocd + 11] << 8)).toBe(3);
  });
});

describe('teamBundleFileName', () => {
  it('개별 파일과 같은 이름에 확장자만 zip 이다', () => {
    expect(teamBundleFileName(report)).toBe('기후시민회의_조별산출물_1분과1조_20260829-1405.zip');
    expect(teamBundleFileName(report)).toBe(reportFileName(report, 'txt').replace(/\.txt$/, '.zip'));
  });
});

describe('shouldShowMultiDownloadHint', () => {
  it('두 번째 개별 내려받기부터 안내한다', () => {
    expect(shouldShowMultiDownloadHint(0)).toBe(false);
    expect(shouldShowMultiDownloadHint(1)).toBe(false);
    expect(shouldShowMultiDownloadHint(2)).toBe(true);
    expect(shouldShowMultiDownloadHint(5)).toBe(true);
  });

  // 해명형 캡션 금지 — 무엇을 하면 되는지만 적는다.
  it('안내는 다음에 할 일을 가리킨다', () => {
    expect(MULTI_DOWNLOAD_HINT).toContain('전부 받기 (.zip)');
    expect(MULTI_DOWNLOAD_HINT).toMatch(/누르세요|고르면 됩니다/);
  });
});
