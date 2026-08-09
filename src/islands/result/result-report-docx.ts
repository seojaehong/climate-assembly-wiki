/**
 * 공개 결과 페이지(/r)용 결과보고서 DOCX 생성 — 화면(ResultView)과 같은 데이터로
 * 내려받을 수 있는 문서를 만든다.
 *
 * 두 층으로 나눈다(ballot-report-docx.ts와 동일 구조):
 * - **순수 로직**(모델 빌드 · 문자열 포맷 · 파일명) — 브라우저 API 없이 vitest로 검증한다.
 * - **docx 렌더**(`buildResultReportDoc`·`resultReportBlob`) — 모델을 그대로 문서로 옮기기만 한다.
 *
 * ★ body→뷰 변환은 `result-view-logic.ts`의 `buildResultView`가 담당한다. 이 모듈은 그 **뷰모델**을
 *   입력으로 받는다 — 한국어 4×6 라벨(STANCE/FREQUENCY_LABEL)·조×쟁점 매트릭스·랭킹 정렬을
 *   여기서 다시 만들면 라벨 표가 두 벌로 갈린다(svg-to-png의 safeSegment 주석과 같은 함정).
 *   따라서 result_get body → DOCX 경로는 "buildResultView(res) → buildResultReportModel(view)"다.
 *
 * 시각 문자열은 `Intl`·`toLocale*` 없이 로컬 getter로만 만든다(저장소 관례 — 환경마다 결과가 갈린다).
 * 파일명 치환기·저장 시각 포맷은 ballot 쪽 정본을 **그대로 import**한다(규칙이 두 벌로 갈리지 않게).
 *
 * ※ 이 DOCX는 한글(HWP)에서도 그대로 열린다(표준 OOXML). 공공 정본 제출이 필요하면 별도 HWPX를
 *   만들지 않고, 이 파일을 /한글변환 스킬로 후처리해 정본 서식을 입힌다.
 */

import {
  AlignmentType,
  BorderStyle,
  Document,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';
import type { ResultView, ViewIssue } from './result-view-logic';
import { formatGeneratedAt } from '../mod/ballot-report-docx';
import { safeSegment } from '../mod/svg-to-png';

// ============================================================
// 순수 로직 — 포맷 · 파일명 · 보고서 모델
// ============================================================

export { formatGeneratedAt };

/** 표지 보고서명. */
export const RESULT_REPORT_TITLE = '시민 숙의 결과 보고서';

/** §4 다음 단계 고정 문구 — 화면 TakeawaysBlock과 같은 취지. */
export const NEXT_STEPS_COPY =
  '이 결과는 숙의 과정의 중간 정리입니다. 더 논의할 쟁점은 다음 회차에서 이어 다루며, 정리된 내용은 권고안 심의의 근거 자료로 쓰입니다.';

const SUMMARY_EMPTY = '요약이 아직 작성되지 않았습니다.';
const REVIEWED_LABEL = '검수 완료';
const DRAFT_LABEL = '검수 대기 · AI 초안';

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/** 공개일 표기 `YYYY-MM-DD`. ISO를 받아 로컬 getter로만 찍는다(toLocale 금지 관례). */
export function formatPublishedDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** 파일명에 넣을 제목 길이 상한 — svg-to-png의 ZIP 경로와 같은 이유(Windows 260자 경로). */
const MAX_TITLE_CHARS = 60;
const FALLBACK_TITLE = '숙의결과';

/** 코드포인트 단위로 자른다 — UTF-16 인덱스로 자르면 서러게이트 쌍이 쪼개진다(ballot과 동일 규칙). */
function capChars(value: string, max: number): string {
  const chars = Array.from(value);
  if (chars.length <= max) return value;
  return chars.slice(0, max).join('').replace(/[_.]+$/, '');
}

/**
 * 보고서 파일명. `숙의결과보고서_<제목>_<YYYYMMDD>.docx`.
 * 치환기는 svg-to-png의 `safeSegment`를 그대로 쓴다 — 규칙이 두 벌로 갈리면 한쪽만 고쳐진다.
 */
export function resultReportFileName(input: { title: string; at: Date }): string {
  const title = capChars(safeSegment(input.title), MAX_TITLE_CHARS) || FALLBACK_TITLE;
  const date = `${input.at.getFullYear()}${pad2(input.at.getMonth() + 1)}${pad2(input.at.getDate())}`;
  return `숙의결과보고서_${title}_${date}.docx`;
}

export type ReportKV = { label: string; value: string };

export type ResultIssueSection = {
  label: string;
  /** 빈도 라벨(합의/다수의견/소수의견/혼재) 또는 '—'. */
  frequencyLabel: string;
  /** 방향 라벨(찬성/반대/조건부/우려/대안·제안/중립·불명) 또는 '—'. */
  stanceLabel: string;
  summary: string;
  /** 제기 조 목록(빈 배열이면 표기에서 생략). */
  teams: string[];
  teamCount: number;
  /** '원문 군집 N건' 또는 '—'. */
  clusterLabel: string;
  /** '검수 완료' 또는 '검수 대기 · AI 초안'. */
  reviewLabel: string;
};

/** §3 조×쟁점 매트릭스 모델. cells[i] = 세로 쟁점을 teams[i] 조가 제기했는가. */
export type ResultMatrixModel = {
  teams: string[];
  rows: Array<{ label: string; cells: boolean[] }>;
};

export type ResultTakeaways = {
  /** 합의로 분류된 쟁점 라벨. */
  consensus: string[];
  /** 추가 논의가 필요한 쟁점 라벨. */
  further: string[];
  nextSteps: string;
};

export type ResultReportModel = {
  /** 표지 보고서명. */
  title: string;
  /** 공론화/회차/주제 제목(view.title). */
  subject: string;
  /** '세션 단위' 등. 스코프 미상이면 빈 문자열. */
  scopeLabel: string;
  publishedAtLabel: string;
  generatedAtLabel: string;
  /** '검수 완료 N / 전체 M'. */
  reviewBadge: string;
  overview: ReportKV[];
  issues: ResultIssueSection[];
  /** null이면 §3을 만들지 않는다(조·쟁점이 비어 표가 malformed가 되는 것을 막는다). */
  matrix: ResultMatrixModel | null;
  takeaways: ResultTakeaways;
  /** HITL 문구. */
  hitlNotice: string;
  /** 합의 비율·분모 산정 규칙(body.consensus_rule). */
  consensusRule: string;
};

function issueSection(issue: ViewIssue): ResultIssueSection {
  return {
    label: issue.label,
    frequencyLabel: issue.frequencyLabel ?? '—',
    stanceLabel: issue.stanceLabel ?? '—',
    summary: issue.summary ?? SUMMARY_EMPTY,
    teams: issue.teams,
    teamCount: issue.teamCount,
    clusterLabel: issue.consensusDenominator != null ? `원문 군집 ${issue.consensusDenominator}건` : '—',
    reviewLabel: issue.isReviewed ? REVIEWED_LABEL : DRAFT_LABEL,
  };
}

/**
 * 결과보고서 모델. 뷰모델(buildResultView 결과)을 문서 문자열로 굳힌다.
 * 여기서 전부 문자열로 만들어 두면 docx 렌더는 배치만 하고, 내용 검증은 테스트가 맡는다.
 *
 * @param generatedAtLabel 저장(작성) 시각 — 호출부가 formatGeneratedAt(new Date())로 주입.
 */
export function buildResultReportModel(input: {
  view: ResultView;
  generatedAtLabel: string;
}): ResultReportModel {
  const { view } = input;
  const { stats } = view;

  const scopeLabel = view.scopeLabel.trim() ? `${view.scopeLabel} 단위` : '';

  const overview: ReportKV[] = [
    { label: '대상 스코프', value: scopeLabel || '—' },
    { label: '쟁점 수', value: `${stats.issueCount}개` },
    { label: '참여 조', value: `${stats.participatingTeams}개` },
    { label: '합의 쟁점 수', value: `${stats.consensusCount}개` },
    { label: '미분류 수', value: `${stats.unclassifiedCount}건` },
  ];

  // §2는 화면과 같은 랭킹 순서(제기 조 많은 순)로 싣는다.
  const issues = view.ranking.map(issueSection);

  // §3: 조·쟁점 중 하나라도 비면 표 자체를 만들지 않는다(빈 Table = malformed).
  const hasMatrix = view.matrix.teams.length > 0 && view.matrix.rows.length > 0;
  const matrix: ResultMatrixModel | null = hasMatrix
    ? {
        teams: view.matrix.teams,
        rows: view.matrix.rows.map((row) => ({ label: row.issue.label, cells: row.cells })),
      }
    : null;

  const takeaways: ResultTakeaways = {
    consensus: view.issues.filter((i) => i.isConsensus).map((i) => i.label),
    further: view.issues.filter((i) => !i.isConsensus).map((i) => i.label),
    nextSteps: NEXT_STEPS_COPY,
  };

  return {
    title: RESULT_REPORT_TITLE,
    subject: view.title,
    scopeLabel,
    publishedAtLabel: formatPublishedDate(view.publishedAt),
    generatedAtLabel: input.generatedAtLabel,
    reviewBadge: `검수 완료 ${stats.reviewedCount} / 전체 ${stats.issueCount}`,
    overview,
    issues,
    matrix,
    takeaways,
    hitlNotice: view.hitlNotice,
    consensusRule: view.consensusRule,
  };
}

// ============================================================
// docx 렌더 — 모델을 문서로 옮기기만 한다
// ============================================================

const FONT = 'Malgun Gothic';
const NAVY = '1F4E79';
const INK = '1F2933';
const MUTED = '5A6B73';
const GREEN = '2F7D1E';
const AMBER = 'B5651D';
const HEAD_FILL = 'F1F7FA';
const RAISED = '2E75B6';
const BORDER = { style: BorderStyle.SINGLE, size: 4, color: 'B7C7D1' } as const;
const TABLE_BORDERS = {
  top: BORDER,
  bottom: BORDER,
  left: BORDER,
  right: BORDER,
  insideHorizontal: BORDER,
  insideVertical: BORDER,
} as const;

function run(text: string, opts: { bold?: boolean; size?: number; color?: string } = {}): TextRun {
  return new TextRun({
    text,
    font: FONT,
    bold: opts.bold ?? false,
    size: opts.size ?? 22, // half-point — 22 = 11pt
    color: opts.color ?? INK,
  });
}

function para(
  text: string,
  opts: {
    bold?: boolean;
    size?: number;
    color?: string;
    align?: (typeof AlignmentType)[keyof typeof AlignmentType];
    before?: number;
    after?: number;
  } = {},
): Paragraph {
  return new Paragraph({
    alignment: opts.align,
    spacing: { before: opts.before ?? 0, after: opts.after ?? 120 },
    children: [run(text, opts)],
  });
}

function sectionHeading(text: string): Paragraph {
  return para(text, { bold: true, size: 28, color: NAVY, before: 320, after: 160 });
}

function cellPara(text: string, opts: { bold?: boolean; color?: string; align?: (typeof AlignmentType)[keyof typeof AlignmentType] } = {}): Paragraph {
  return new Paragraph({
    alignment: opts.align,
    spacing: { after: 40 },
    children: [run(text, { bold: opts.bold, color: opts.color })],
  });
}

function cell(
  text: string,
  opts: {
    bold?: boolean;
    widthPct?: number;
    shaded?: boolean;
    color?: string;
    align?: (typeof AlignmentType)[keyof typeof AlignmentType];
  } = {},
): TableCell {
  return new TableCell({
    width: opts.widthPct != null ? { size: opts.widthPct, type: WidthType.PERCENTAGE } : undefined,
    shading: opts.shaded ? { fill: HEAD_FILL } : undefined,
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
    children: [cellPara(text, { bold: opts.bold, color: opts.color, align: opts.align })],
  });
}

function table(rows: TableRow[]): Table {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: TABLE_BORDERS,
    rows,
  });
}

/** §2 한 쟁점의 메타 표(빈도·방향·검수·제기 조·원문 군집)를 만든다. */
function issueMetaTable(issue: ResultIssueSection): Table {
  const kv = (label: string, value: string, valueColor?: string): TableRow =>
    new TableRow({
      children: [
        cell(label, { bold: true, widthPct: 22, shaded: true }),
        cell(value, { widthPct: 78, color: valueColor }),
      ],
    });
  const teamsValue = issue.teamCount > 0 ? `${issue.teamCount}개 조 · ${issue.teams.join(', ')}` : `${issue.teamCount}개 조`;
  return table([
    kv('빈도', issue.frequencyLabel),
    kv('방향', issue.stanceLabel),
    kv('제기 조', teamsValue),
    kv('원문 군집', issue.clusterLabel),
    kv('검수', issue.reviewLabel, issue.reviewLabel === REVIEWED_LABEL ? GREEN : AMBER),
  ]);
}

/** 다음-단계·리스트 칸을 표 없이 문단으로 — 빈 목록이면 '해당 없음' 안내. */
function takeawayList(heading: string, accent: string, items: string[], empty: string): Paragraph[] {
  const out: Paragraph[] = [para(heading, { bold: true, size: 24, color: accent, before: 200, after: 80 })];
  if (items.length > 0) {
    for (const item of items) out.push(para(`· ${item}`, { size: 22, after: 40 }));
  } else {
    out.push(para(empty, { size: 20, color: MUTED, after: 40 }));
  }
  return out;
}

/** 모델 → docx Document. 내용은 모델이 확정한 문자열 그대로다(여기서 가공하지 않는다). */
export function buildResultReportDoc(model: ResultReportModel): Document {
  const children: Array<Paragraph | Table> = [
    // 표지
    para(model.title, { bold: true, size: 40, color: NAVY, align: AlignmentType.CENTER, after: 80 }),
    para(model.subject, { bold: true, size: 28, align: AlignmentType.CENTER, after: 60 }),
    para(`검수 완료 및 전체 · ${model.reviewBadge}`, {
      bold: true,
      size: 22,
      color: GREEN,
      align: AlignmentType.CENTER,
      after: 40,
    }),
    para(`공개일 ${model.publishedAtLabel} · 작성 ${model.generatedAtLabel}`, {
      size: 20,
      color: MUTED,
      align: AlignmentType.CENTER,
      after: 280,
    }),
    // §1 개요
    sectionHeading('1. 개요'),
    table(
      model.overview.map(
        (row) =>
          new TableRow({
            children: [
              cell(row.label, { bold: true, widthPct: 30, shaded: true }),
              cell(row.value, { widthPct: 70 }),
            ],
          }),
      ),
    ),
    // §2 쟁점별
    sectionHeading('2. 쟁점별 결과'),
  ];

  if (model.issues.length > 0) {
    model.issues.forEach((issue, idx) => {
      children.push(
        para(`${idx + 1}. ${issue.label}`, { bold: true, size: 24, color: NAVY, before: 240, after: 80 }),
        issueMetaTable(issue),
        para(issue.summary, { size: 22, before: 80, after: 40 }),
      );
    });
  } else {
    children.push(para('공개된 쟁점이 없습니다.', { size: 20, color: MUTED }));
  }

  // §3 조×쟁점 커버리지 매트릭스 (조·쟁점이 있을 때만)
  if (model.matrix != null) {
    children.push(
      sectionHeading('3. 조 × 쟁점 커버리지'),
      para('세로 = 쟁점, 가로 = 조. ● 제기 · · 미제기', { size: 20, color: MUTED, after: 120 }),
      table([
        new TableRow({
          tableHeader: true,
          children: [
            cell('쟁점', { bold: true, shaded: true }),
            ...model.matrix.teams.map((t) => cell(t, { bold: true, shaded: true, align: AlignmentType.CENTER })),
          ],
        }),
        ...model.matrix.rows.map(
          (row) =>
            new TableRow({
              children: [
                cell(row.label, { bold: true }),
                ...row.cells.map((raised) =>
                  cell(raised ? '●' : '·', {
                    align: AlignmentType.CENTER,
                    color: raised ? RAISED : 'C4D8E4',
                    bold: raised,
                  }),
                ),
              ],
            }),
        ),
      ]),
    );
  }

  // §4 함께 확인된 것 / 더 논의할 것 / 다음 단계
  children.push(
    sectionHeading('4. 정리'),
    ...takeawayList('함께 확인된 것', GREEN, model.takeaways.consensus, '합의로 분류된 쟁점이 아직 없습니다.'),
    ...takeawayList('더 논의할 것', AMBER, model.takeaways.further, '추가 논의가 필요한 쟁점이 없습니다.'),
    para('다음 단계', { bold: true, size: 24, color: NAVY, before: 200, after: 80 }),
    para(model.takeaways.nextSteps, { size: 22, after: 40 }),
  );

  // 하단 HITL 고정 문구 + 산정 기준
  children.push(
    sectionHeading('산정 기준 및 안내'),
    para(model.hitlNotice, { bold: true, size: 22, color: AMBER, after: 80 }),
    para(model.consensusRule, { size: 20, color: MUTED }),
  );

  return new Document({
    styles: { default: { document: { run: { font: FONT, size: 22 } } } },
    sections: [{ properties: {}, children }],
  });
}

/** 모델 → DOCX Blob. 실패는 호출부가 잡아 안내한다(화면을 멈추지 않는다). */
export function resultReportBlob(model: ResultReportModel): Promise<Blob> {
  return Packer.toBlob(buildResultReportDoc(model));
}
