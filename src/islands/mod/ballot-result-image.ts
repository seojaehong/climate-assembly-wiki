/**
 * 다의제 투표(ballot) 결과를 **문항별 카드 1장씩** SVG 문자열로 만든다.
 * 문항마다 개별 파일이 나와야 조별 공유(단톡·화면 게시)에서 필요한 의제만 골라 쓸 수 있다.
 * PNG 변환(canvas)은 svg-to-png.ts가 맡는다 — 여기까지가 순수 함수라 테스트로 내용을 검증한다.
 *
 * 지켜야 할 제약(result-image.ts와 동일 — 브라우저 없이 검증할 수 없어 코드로 고정한다):
 * - 루트에 `xmlns`와 **픽셀 width/height**를 함께 쓴다. xmlns가 없으면 data URL을 `Image`에
 *   실었을 때 조용히 onerror로 떨어지고, viewBox만 있으면 고유 크기가 없어 canvas 크기가 0이 된다.
 * - 외부 폰트·이미지·앱 CSS 클래스를 참조하지 않는다. 스타일은 전부 표현 속성으로 준다.
 * - `Intl`·`toLocaleString`·`toFixed`를 쓰지 않는다(실행 환경에 따라 결과가 갈린다).
 *   시각 문자열은 이미 포맷된 것을 받고, 평균은 아래 `formatAvg`(정수 연산)로 만든다.
 */

import { distRows } from './ballot-panel-logic';
import { scaleLabels } from '../ballot/ballot-logic';

/** 문항 하나 = 카드 한 장의 입력. `ballot_results`의 items 원소와 1:1이다. */
export interface BallotItemImageInput {
  /** 투표 전체 제목 — 카드 머리글에 작게 들어간다. */
  ballotTitle: string;
  ordinal: number;
  statement: string;
  scale: number;
  /** 이 문항의 응답 수. 0이면 평균은 '—'로 그린다. */
  n: number;
  avg: number | null;
  /** 값('1'..'scale' 문자열 키)별 응답 수. null이면 전부 0으로 본다. */
  dist: Record<string, number> | null;
}

const WIDTH = 1200;
const PAD = 48;
const CONTENT = WIDTH - PAD * 2;

const HEADER_SIZE = 28;
const STATEMENT_SIZE = 40;
const STATEMENT_LINE_HEIGHT = 54;
/** 300자 문장도 3줄이면 판독 가능한 요지가 남는다 — 더 길면 …으로 줄인다. */
const STATEMENT_MAX_LINES = 3;
const AVG_LABEL_SIZE = 28;
const AVG_SIZE = 80;
const ROW_LABEL_SIZE = 28;
const BAR_HEIGHT = 32;
const ROW_HEIGHT = 92;
const PAD_BOTTOM = 40;

const HEADER_BASELINE = 76;
const META_BASELINE = 122;
const STATEMENT_TOP_BASELINE = 190;

/** `N건 · P%` 문구가 차지하는 오른쪽 폭. 척도 라벨은 이 만큼을 빼고 줄인다. */
const COUNT_RESERVE = 300;

const BG = '#FFFFFF';
const INK = '#1F2933';
const MUTED = '#33393F';
const NAVY = '#1F4E79';
const TRACK = '#E2E8EC';
const LINE = '#7A9AAF';

/** 화면(BallotPanel 결과 뷰)과 같은 값별 색 — 이미지와 스크린이 같은 그림이어야 혼선이 없다. */
const DIST_COLORS = ['#23B2C3', '#2E75B6', '#4F9D3A', '#F5A623', '#135C73', '#1F4E79', '#B5651D'];

/** 시스템 폰트만 쓴다 — 웹폰트를 참조하면 SVG-in-Image에서 글자가 사라진다. */
const FONT = "'Malgun Gothic', 'Apple SD Gothic Neo', 'Noto Sans KR', system-ui, sans-serif";

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * 글자 폭 추정 — result-image.ts와 같은 규칙(한글·전각은 폰트 크기, 라틴은 0.55배).
 * 범위는 코드포인트로 적는다 — 소스에 한글 글리프를 직접 넣으면 인코딩 사고 때 범위가 조용히 바뀐다.
 */
const WIDE_CHAR = /[\u1100-\u11FF\u2E80-\u9FFF\uAC00-\uD7AF\uF900-\uFAFF\uFF00-\uFF60]/;

function charWidth(char: string, fontSize: number): number {
  return WIDE_CHAR.test(char) ? fontSize : fontSize * 0.55;
}

function estimateWidth(text: string, fontSize: number): number {
  let width = 0;
  for (const char of text) width += charWidth(char, fontSize);
  return width;
}

/** 한 줄에 들어가도록 뒤를 …으로 줄인다. 이스케이프보다 먼저 호출해야 한다. */
function fitText(text: string, fontSize: number, maxWidth: number): string {
  if (estimateWidth(text, fontSize) <= maxWidth) return text;
  const budget = maxWidth - charWidth('…', fontSize);
  let kept = '';
  let width = 0;
  for (const char of text) {
    const next = charWidth(char, fontSize);
    if (width + next > budget) break;
    kept += char;
    width += next;
  }
  return `${kept}…`;
}

/**
 * 문장을 폭에 맞춰 여러 줄로 접는다(최대 maxLines, 마지막 줄은 …).
 * 문항 statement는 최대 300자라 한 줄 …로는 요지가 사라진다 — 카드의 본문이므로 접어서 보여 준다.
 * 공백 단위가 아니라 글자 단위로 접는다 — 한국어 문장은 공백 없는 긴 구가 흔하다.
 */
export function wrapText(text: string, fontSize: number, maxWidth: number, maxLines: number): string[] {
  const lines: string[] = [];
  let current = '';
  let width = 0;
  for (const char of text) {
    const next = charWidth(char, fontSize);
    if (width + next > maxWidth && current.length > 0) {
      lines.push(current);
      if (lines.length === maxLines) {
        // 넘친다 — 마지막 줄을 …로 다시 줄여서 교체한다.
        const last = lines[maxLines - 1];
        lines[maxLines - 1] = fitText(`${last}${char}`, fontSize, maxWidth);
        return lines;
      }
      current = char;
      width = next;
    } else {
      current += char;
      width += next;
    }
  }
  if (current.length > 0 || lines.length === 0) lines.push(current);
  return lines;
}

/**
 * 평균을 소수 둘째 자리 문자열로. `toFixed`를 쓰지 않는다(저장소 관례) — 정수 연산으로 만든다.
 * null·비정상 값은 '—'(응답 없음 표기). 척도 값은 1..scale이라 음수는 오지 않지만 방어한다.
 */
export function formatAvg(avg: number | null | undefined): string {
  if (avg == null || !Number.isFinite(avg) || avg < 0) return '—';
  const scaled = Math.round(avg * 100);
  const whole = Math.floor(scaled / 100);
  const frac = String(scaled % 100).padStart(2, '0');
  return `${whole}.${frac}`;
}

function textEl(
  content: string,
  x: number,
  y: number,
  fontSize: number,
  fill: string,
  anchor: 'start' | 'end' = 'start',
): string {
  return `<text x="${x}" y="${y}" font-family="${FONT}" font-size="${fontSize}" font-weight="800" fill="${fill}" text-anchor="${anchor}">${escapeXml(content)}</text>`;
}

/**
 * 문항 결과 카드 SVG 한 장. 투표 제목 · 의제 번호 · 척도 · 응답 수 · 문장 · 평균 ·
 * 값별 분포(가로 막대 + 건수·비율)를 담는다. 높이는 문장 줄 수와 척도 크기에 따라 늘어난다.
 */
export function renderBallotItemSvg(input: BallotItemImageInput): string {
  const lines = wrapText(input.statement, STATEMENT_SIZE, CONTENT, STATEMENT_MAX_LINES);
  const rows = distRows(input.scale, input.dist);
  const labels = scaleLabels(input.scale);

  const statementEnd = STATEMENT_TOP_BASELINE + (lines.length - 1) * STATEMENT_LINE_HEIGHT;
  const avgLabelBaseline = statementEnd + 64;
  const avgBaseline = avgLabelBaseline + 84;
  const dividerY = avgBaseline + 28;
  const barsTop = dividerY + 24;
  const height = barsTop + rows.length * ROW_HEIGHT + PAD_BOTTOM;

  const meta = `의제 ${input.ordinal} · ${input.scale}점 척도 · 응답 ${input.n}건`;

  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${height}" viewBox="0 0 ${WIDTH} ${height}">`,
    `<rect x="0" y="0" width="${WIDTH}" height="${height}" fill="${BG}" />`,
    textEl(fitText(input.ballotTitle, HEADER_SIZE, CONTENT), PAD, HEADER_BASELINE, HEADER_SIZE, MUTED),
    textEl(meta, PAD, META_BASELINE, HEADER_SIZE, MUTED),
  ];

  lines.forEach((line, index) => {
    parts.push(
      textEl(line, PAD, STATEMENT_TOP_BASELINE + index * STATEMENT_LINE_HEIGHT, STATEMENT_SIZE, NAVY),
    );
  });

  parts.push(
    textEl('평균', PAD, avgLabelBaseline, AVG_LABEL_SIZE, MUTED),
    textEl(formatAvg(input.n > 0 ? input.avg : null), PAD, avgBaseline, AVG_SIZE, NAVY),
    `<line x1="${PAD}" y1="${dividerY}" x2="${WIDTH - PAD}" y2="${dividerY}" stroke="${LINE}" stroke-width="2" />`,
  );

  rows.forEach((row, index) => {
    const top = barsTop + index * ROW_HEIGHT;
    const labelBaseline = top + 30;
    const barY = top + 44;
    // 값 라벨: `5 · 매우 동의합니다`. 폴백(비표준 척도)은 라벨이 값과 같아 숫자만 적는다.
    const valueLabel = labels[index] != null && labels[index] !== String(row.value)
      ? `${row.value} · ${labels[index]}`
      : String(row.value);
    const ratio = Math.min(1, Math.max(0, row.pct / 100));
    const filled = Math.round(CONTENT * ratio);
    parts.push(
      textEl(fitText(valueLabel, ROW_LABEL_SIZE, CONTENT - COUNT_RESERVE), PAD, labelBaseline, ROW_LABEL_SIZE, INK),
      textEl(`${row.count}건 · ${row.pct}%`, WIDTH - PAD, labelBaseline, ROW_LABEL_SIZE, MUTED, 'end'),
      `<rect x="${PAD}" y="${barY}" width="${CONTENT}" height="${BAR_HEIGHT}" rx="6" fill="${TRACK}" />`,
    );
    if (filled > 0) {
      parts.push(
        `<rect x="${PAD}" y="${barY}" width="${filled}" height="${BAR_HEIGHT}" rx="6" fill="${DIST_COLORS[(row.value - 1) % DIST_COLORS.length]}" />`,
      );
    }
  });

  parts.push('</svg>');
  return parts.join('\n');
}

/** 결과 전체 → 문항별 SVG 배열(ordinal 순서는 입력 순서 그대로). */
export function renderBallotItemSvgs(input: {
  title: string;
  items: Array<Omit<BallotItemImageInput, 'ballotTitle'>>;
}): string[] {
  return input.items.map((item) => renderBallotItemSvg({ ...item, ballotTitle: input.title }));
}
