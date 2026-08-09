/**
 * 다의제 투표(ballot) 결과보고서 DOCX 생성.
 *
 * 두 층으로 나눈다:
 * - **순수 로직**(모델 빌드 · 문자열 포맷 · 파일명) — 브라우저 API 없이 vitest로 검증한다.
 * - **docx 렌더**(`buildBallotReportDoc`·`ballotReportBlob`) — 모델을 그대로 문서로 옮기기만 한다.
 *
 * 시각 문자열은 `Intl`·`toLocale*` 없이 로컬 getter로만 만든다(저장소 관례 — 환경마다 결과가
 * 갈린다). 구조는 `10_작업산출물/_template/워크숍_결과보고서_템플릿.md`의 §1 개요 표 ·
 * §3 라운드별 투표 결과 표(항목·표·비율)를 따른다.
 */

import {
  AlignmentType,
  BorderStyle,
  Document,
  ImageRun,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';
import type { BallotResults, SubmissionGetResult, SubmissionStatus, Topic } from '../../lib/deliberation';
import { ballotStatusLabel, distRows, subgroupTargetLabel } from './ballot-panel-logic';
import { scaleLabels } from '../ballot/ballot-logic';
import { formatAvg } from './ballot-result-image';
import { safeSegment } from './svg-to-png';

// ============================================================
// 순수 로직 — 포맷 · 파일명 · 보고서 모델
// ============================================================

/** 하단 고정 문구(HITL) — 자동 집계를 확정 수치로 오인하지 않게 모든 보고서에 박는다. */
export const REPORT_HOLD_NOTICE = '본 자료는 잠정 집계이며, 최종 수치는 운영진 검수 후 확정됩니다.';

export const REPORT_TITLE = '기후시민회의 다의제 투표 결과보고서';

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/** 생성 시각 표기 `YYYY-MM-DD HH:mm`. 로컬 getter만 쓴다(toLocale 금지 관례). */
export function formatGeneratedAt(at: Date): string {
  return `${at.getFullYear()}-${pad2(at.getMonth() + 1)}-${pad2(at.getDate())} ${pad2(at.getHours())}:${pad2(at.getMinutes())}`;
}

/** 파일명에 넣을 제목 길이 상한 — svg-to-png의 ZIP 경로와 같은 이유(Windows 260자 경로). */
const MAX_TITLE_CHARS = 60;
const FALLBACK_TITLE = '투표';

/** 코드포인트 단위로 자른다 — UTF-16 인덱스로 자르면 서러게이트 쌍이 쪼개진다. */
function capChars(value: string, max: number): string {
  const chars = Array.from(value);
  if (chars.length <= max) return value;
  return chars.slice(0, max).join('').replace(/[_.]+$/, '');
}

/**
 * 보고서 파일명. `투표결과보고서_<투표제목>_<YYYYMMDD>.docx`.
 * 치환기는 svg-to-png의 `safeSegment`를 그대로 쓴다 — 규칙이 두 벌로 갈리면 한쪽만 고쳐진다.
 */
export function ballotReportFileName(input: { title: string; at: Date }): string {
  const title = capChars(safeSegment(input.title), MAX_TITLE_CHARS) || FALLBACK_TITLE;
  const date = `${input.at.getFullYear()}${pad2(input.at.getMonth() + 1)}${pad2(input.at.getDate())}`;
  return `투표결과보고서_${title}_${date}.docx`;
}

export type ReportOverviewRow = { label: string; value: string };

/** 문항별 결과 표의 한 행 — [척도 라벨, 표, 비율] 순서(템플릿 §3과 동일). */
export type ReportTableRow = { label: string; count: string; pct: string; emphasis?: boolean };

export type ReportItemSection = {
  /** `ballot_results`의 item id — 결과 이미지 맵(itemImages)을 이 키로 찾는다. */
  id: string;
  /** '의제 1. 문장' */
  heading: string;
  /** '5점 척도 · 응답 12건 · 평균 4.25' */
  meta: string;
  rows: ReportTableRow[];
};

export type ReportTopicItemRow = { kindLabel: string; content: string; rationale: string };

export type ReportTopicSection = {
  heading: string;
  statusLabel: string;
  rows: ReportTopicItemRow[];
};

export type BallotReportModel = {
  title: string;
  ballotTitle: string;
  generatedAtLabel: string;
  overview: ReportOverviewRow[];
  items: ReportItemSection[];
  /** 조별 산출물(선택 데이터). null이면 §3을 아예 만들지 않는다. */
  topics: ReportTopicSection[] | null;
  footer: string;
};

function submissionStatusLabel(status: SubmissionStatus | null): string {
  switch (status) {
    case 'draft':
      return '작성 중';
    case 'final':
      return '최종 제출';
    case 'reopened':
      return '재작성 중';
    case 'archived':
      return '보관됨';
    default:
      return '미작성';
  }
}

function kindLabel(kind: 'core' | 'extra'): string {
  return kind === 'core' ? '핵심' : '보충';
}

/** 값 라벨: `5 (매우 동의합니다)`. 폴백(비표준 척도)은 라벨이 값과 같아 숫자만 적는다. */
function valueLabel(value: number, labels: string[]): string {
  const label = labels[value - 1];
  if (label == null || label === String(value)) return String(value);
  return `${value} (${label})`;
}

/**
 * 결과보고서 모델. RPC 결과(ballot_results + topic_list/submission_get)를 문서 문자열로 굳힌다.
 * 여기서 전부 문자열로 만들어 두면 docx 렌더는 배치만 하고, 내용 검증은 테스트가 맡는다.
 */
export function buildBallotReportModel(input: {
  results: BallotResults;
  generatedAtLabel: string;
  /** 조별 산출물(선택). null·빈 배열·전부 항목 0건이면 §3을 만들지 않는다. */
  topics?: Array<{ topic: Topic; submission: SubmissionGetResult }> | null;
}): BallotReportModel {
  const { results } = input;

  // 분과 스코프(S4). subgroup 키가 없는(미적용 DB) 응답도 '세션 전체'로 안전하게 적힌다.
  const targetLabel = subgroupTargetLabel(results.subgroup);

  const overview: ReportOverviewRow[] = [
    { label: '투표 제목', value: results.title },
    { label: '대상', value: targetLabel },
    { label: '의제 수', value: `${results.items.length}개` },
    { label: '제출 수', value: `${results.responses}명` },
    { label: '상태', value: ballotStatusLabel(results.status) },
  ];

  const items: ReportItemSection[] = results.items.map((item) => {
    const labels = scaleLabels(item.scale);
    const rows: ReportTableRow[] = distRows(item.scale, item.dist).map((row) => ({
      label: valueLabel(row.value, labels),
      count: String(row.count),
      pct: `${row.pct}%`,
    }));
    rows.push({
      label: '계',
      count: String(item.n),
      pct: item.n > 0 ? '100%' : '—',
      emphasis: true,
    });
    return {
      id: item.id,
      heading: `의제 ${item.ordinal}. ${item.statement}`,
      meta: `${item.scale}점 척도 · 응답 ${item.n}건 · 평균 ${formatAvg(item.n > 0 ? item.avg : null)}`,
      rows,
    };
  });

  const topicSections = (input.topics ?? [])
    .filter((entry) => entry.submission.items.length > 0)
    .map((entry) => ({
      heading: entry.topic.prompt,
      statusLabel: submissionStatusLabel(entry.submission.status),
      rows: entry.submission.items.map((item) => ({
        kindLabel: kindLabel(item.kind),
        content: item.content,
        rationale: item.rationale ?? '—',
      })),
    }));

  return {
    title: REPORT_TITLE,
    // 표지 부제 — 분과 한정 투표는 분과명을 병기해 세 분과 보고서가 섞이지 않게 한다.
    ballotTitle: results.subgroup?.trim() ? `${results.title} — ${results.subgroup.trim()}` : results.title,
    generatedAtLabel: input.generatedAtLabel,
    overview,
    items,
    topics: topicSections.length > 0 ? topicSections : null,
    footer: REPORT_HOLD_NOTICE,
  };
}

/**
 * PNG 바이트에서 픽셀 크기를 읽는다(IHDR). 결과 이미지를 문서 폭에 맞춰 넣을 때
 * **세로 비율을 유지**하려면 원본 크기가 필요하다 — 브라우저 canvas 없이(순수 모듈에서)
 * 구할 수 있게 헤더만 파싱한다.
 *
 * 세 겹으로 방어한다(어긋나면 크기 계산이 조용히 망가진다):
 *  - 24바이트(서명 8 + IHDR 청크 헤더 8 + width/height 8) 미만이면 null.
 *  - 8바이트 PNG 서명(`89 50 4E 47 0D 0A 1A 0A`)이 아니면 null.
 *  - 첫 청크 타입이 `IHDR`(오프셋 12~15)가 아니면 null.
 * width/height는 **빅엔디안** 32비트다(오프셋 16·20) — 엔디안을 뒤집으면 2400이 0x60090000이 돼
 * 크래시 없이 말도 안 되는 크기가 나온다.
 */
export function pngPixelSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 24) return null;
  const SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (let i = 0; i < SIG.length; i += 1) {
    if (bytes[i] !== SIG[i]) return null;
  }
  // IHDR: 오프셋 8~11 = 청크 길이, 12~15 = 타입("IHDR").
  if (bytes[12] !== 0x49 || bytes[13] !== 0x48 || bytes[14] !== 0x44 || bytes[15] !== 0x52) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16, false);
  const height = view.getUint32(20, false);
  if (width <= 0 || height <= 0) return null;
  return { width, height };
}

// ============================================================
// docx 렌더 — 모델을 문서로 옮기기만 한다
// ============================================================

const FONT = 'Malgun Gothic';
const NAVY = '1F4E79';
const INK = '1F2933';
const MUTED = '5A6B73';
const HEAD_FILL = 'F1F7FA';
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

function cellPara(text: string, opts: { bold?: boolean } = {}): Paragraph {
  return new Paragraph({ spacing: { after: 40 }, children: [run(text, { bold: opts.bold })] });
}

function cell(
  text: string,
  opts: { bold?: boolean; widthPct?: number; shaded?: boolean } = {},
): TableCell {
  return new TableCell({
    width: opts.widthPct != null ? { size: opts.widthPct, type: WidthType.PERCENTAGE } : undefined,
    shading: opts.shaded ? { fill: HEAD_FILL } : undefined,
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
    children: [cellPara(text, { bold: opts.bold })],
  });
}

function table(rows: TableRow[]): Table {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: TABLE_BORDERS,
    rows,
  });
}

/** 문서 본문 폭에 맞춘 결과 이미지의 가로 크기(px 상당). A4/Letter 1인치 여백 기준 ≈ 6.5in. */
const IMAGE_WIDTH_PX = 600;

/** 결과 이미지 임베드 옵션. `itemImages`는 itemId → PNG ArrayBuffer. 없으면 표만(하위호환). */
export type BallotReportDocOptions = {
  itemImages?: Map<string, ArrayBuffer>;
};

/**
 * itemId의 결과 이미지를 담은 Paragraph를 만든다. 이미지가 없거나 PNG 크기를 못 읽으면 null —
 * 호출부는 그 문항의 표만 낸다(크기를 추측하지 않는다).
 */
function itemImagePara(id: string, images: Map<string, ArrayBuffer> | undefined): Paragraph | null {
  const data = images?.get(id);
  if (!data) return null;
  const size = pngPixelSize(new Uint8Array(data));
  if (!size) return null;
  const width = IMAGE_WIDTH_PX;
  const height = Math.round((IMAGE_WIDTH_PX * size.height) / size.width);
  return new Paragraph({
    spacing: { after: 120 },
    children: [
      new ImageRun({
        type: 'png',
        data,
        transformation: { width, height },
      }),
    ],
  });
}

/** 모델 → docx Document. 내용은 모델이 확정한 문자열 그대로다(여기서 가공하지 않는다). */
export function buildBallotReportDoc(model: BallotReportModel, options: BallotReportDocOptions = {}): Document {
  const children: Array<Paragraph | Table> = [
    para(model.title, { bold: true, size: 36, color: NAVY, align: AlignmentType.CENTER, after: 80 }),
    para(model.ballotTitle, { bold: true, size: 26, align: AlignmentType.CENTER, after: 40 }),
    para(`작성 ${model.generatedAtLabel}`, { size: 20, color: MUTED, align: AlignmentType.CENTER, after: 240 }),
    sectionHeading('1. 개요'),
    table(
      model.overview.map(
        (row) =>
          new TableRow({
            children: [
              cell(row.label, { bold: true, widthPct: 25, shaded: true }),
              cell(row.value, { widthPct: 75 }),
            ],
          }),
      ),
    ),
    sectionHeading('2. 문항별 결과'),
  ];

  model.items.forEach((item) => {
    children.push(
      para(item.heading, { bold: true, size: 24, before: 200, after: 40 }),
      para(item.meta, { size: 20, color: MUTED, after: 120 }),
    );
    // 표 위에 그 문항의 결과 이미지(있을 때만) — 접근성·정확 수치를 위해 표는 그대로 병행한다.
    const imagePara = itemImagePara(item.id, options.itemImages);
    if (imagePara) children.push(imagePara);
    children.push(
      table([
        new TableRow({
          tableHeader: true,
          children: [
            cell('항목', { bold: true, widthPct: 60, shaded: true }),
            cell('표', { bold: true, widthPct: 20, shaded: true }),
            cell('비율', { bold: true, widthPct: 20, shaded: true }),
          ],
        }),
        ...item.rows.map(
          (row) =>
            new TableRow({
              children: [
                cell(row.label, { bold: row.emphasis, widthPct: 60 }),
                cell(row.count, { bold: row.emphasis, widthPct: 20 }),
                cell(row.pct, { bold: row.emphasis, widthPct: 20 }),
              ],
            }),
        ),
      ]),
    );
  });

  if (model.topics != null) {
    children.push(sectionHeading('3. 내 조 산출물'));
    model.topics.forEach((topic) => {
      children.push(
        para(`${topic.heading} — ${topic.statusLabel}`, { bold: true, size: 24, before: 200, after: 120 }),
        table([
          new TableRow({
            tableHeader: true,
            children: [
              cell('구분', { bold: true, widthPct: 12, shaded: true }),
              cell('내용', { bold: true, widthPct: 48, shaded: true }),
              cell('근거', { bold: true, widthPct: 40, shaded: true }),
            ],
          }),
          ...topic.rows.map(
            (row) =>
              new TableRow({
                children: [
                  cell(row.kindLabel, { widthPct: 12 }),
                  cell(row.content, { widthPct: 48 }),
                  cell(row.rationale, { widthPct: 40 }),
                ],
              }),
          ),
        ]),
      );
    });
  }

  children.push(para(model.footer, { size: 20, color: MUTED, before: 360 }));

  return new Document({
    styles: { default: { document: { run: { font: FONT, size: 22 } } } },
    sections: [{ properties: {}, children }],
  });
}

/** 모델 → DOCX Blob. 실패는 호출부가 잡아 안내한다(화면을 멈추지 않는다). */
export function ballotReportBlob(model: BallotReportModel, options: BallotReportDocOptions = {}): Promise<Blob> {
  return Packer.toBlob(buildBallotReportDoc(model, options));
}
