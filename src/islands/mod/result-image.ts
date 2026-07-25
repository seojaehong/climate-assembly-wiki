/**
 * 투표 결과를 그림 한 장(SVG 문자열)으로 만든다. 보고서·아카이브에 그대로 넣기 위한 것이고,
 * PNG 변환(canvas)은 이 모듈이 하지 않는다 — 여기까지가 순수 함수라서 테스트로 내용을 검증할 수 있다.
 *
 * 지켜야 할 제약(브라우저 없이 검증할 수 없는 것들이라 코드로 고정한다):
 * - 루트에 `xmlns`와 **픽셀 width/height**를 함께 쓴다. xmlns가 없으면 data URL을 `Image`에
 *   실었을 때 조용히 onerror로 떨어지고, viewBox만 있으면 고유 크기가 없어 canvas 크기가 0이 된다.
 * - 외부 폰트·이미지·앱 CSS 클래스를 참조하지 않는다. 외부 자원은 canvas를 오염시키거나
 *   SVG-in-Image에서 아예 로드되지 않는다. 스타일은 전부 표현 속성(presentation attribute)으로 준다.
 * - `Intl`·`toLocaleString`·`toFixed`를 쓰지 않는다(실행 환경에 따라 결과가 갈린다).
 *   시각 문자열은 이미 포맷된 것을 받는다 — 이 저장소의 관례다(round-sequence.ts 참조).
 */

/** 선택지 한 줄. 순서는 입력 그대로 유지된다(득표순으로 재정렬하지 않는다). */
export interface ResultImageOption {
  option: string;
  count: number;
}

export interface ResultImageInput {
  teamName: string;
  /** 이 조에서 몇 번째 투표인가(1부터). 1보다 작으면 회차 배지를 그리지 않는다. */
  sequence: number;
  title: string;
  /**
   * 이미 포맷된 마감 시각 문자열(예: '14:32'). null이면 '진행 중'으로 그린다.
   * 포맷을 여기서 하지 않는 이유: `toLocaleTimeString`은 실행 환경 타임존에 의존한다.
   */
  closedAtLabel: string | null;
  /** 투표한 사람 수(tallyVotes의 total). 선택지 득표의 합과 다를 수 있다 — CHECKBOX는 복수 선택이다. */
  total: number;
  /**
   * 선택지별 득표. 호출부는 `round.options`를 우선 쓰고, 그것이 null인 라운드(SCALE)에서는
   * `Object.keys(tally.byOption)`로 만들어야 한다 — options만 믿으면 SCALE 라운드가 빈 목록이 된다.
   */
  results: ResultImageOption[];
}

const WIDTH = 1200;
const PAD = 48;
const CONTENT = WIDTH - PAD * 2;

const NAME_SIZE = 48;
const META_SIZE = 28;
const TITLE_SIZE = 36;
const TOTAL_LABEL_SIZE = 28;
const TOTAL_SIZE = 88;
const OPTION_SIZE = 32;
const EMPTY_SIZE = 40;

const NAME_BASELINE = 88;
const META_BASELINE = 132;
const TITLE_BASELINE = 188;
const TOTAL_LABEL_BASELINE = 240;
const TOTAL_BASELINE = 324;
const DIVIDER_Y = 352;

const BARS_TOP = 372;
const BAR_HEIGHT = 36;
const ROW_HEIGHT = 104;
const EMPTY_BLOCK = 120;
const PAD_BOTTOM = 40;

/** 득표수·비율 문구가 차지하는 오른쪽 폭. 선택지 라벨은 이 만큼을 빼고 줄인다. */
const COUNT_RESERVE = 340;

const BG = '#FFFFFF';
const INK = '#1F2933';
const MUTED = '#33393F';
const NAVY = '#1F4E79';
const TRACK = '#E2E8EC';
const LINE = '#7A9AAF';

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
 * 글자 폭 추정. 한글·한자·전각 문자는 글자 크기와 거의 같은 폭을 쓰고, 라틴/숫자는 그보다 좁다.
 * 정확한 측정은 브라우저에서만 가능하므로(이 저장소에 DOM 테스트 도구가 없다) 넉넉한 추정치를 쓴다.
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

/**
 * 주어진 폭에 들어가도록 뒤를 …으로 줄인다. SVG의 `<text>`는 줄바꿈을 하지 않으므로
 * 줄이지 않으면 긴 제목이 캔버스 밖으로 그대로 삐져나간다(무성 클리핑).
 * 이스케이프보다 **먼저** 호출해야 한다 — 뒤에 하면 `&amp;` 같은 엔티티가 중간에서 잘린다.
 */
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

/** 비율(%)은 사실대로 적는다 — CHECKBOX 복수 선택에서 100%를 넘는 것은 오류가 아니다. */
function percentOf(count: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((count / total) * 100);
}

/** 막대 길이는 트랙 안으로 클램프한다. 비율이 100%를 넘어도 그림이 깨지지 않게. */
function barWidth(count: number, total: number): number {
  if (total <= 0) return 0;
  const ratio = Math.min(1, Math.max(0, count / total));
  return Math.round(CONTENT * ratio);
}

function metaLine(input: ResultImageInput): string {
  const parts: string[] = [];
  if (input.sequence >= 1) parts.push(`${input.sequence}차 투표`);
  parts.push(input.closedAtLabel ? `마감 ${input.closedAtLabel}` : '진행 중');
  return parts.join(' · ');
}

/**
 * 투표 결과 카드 SVG. 조 이름 · 회차 · 제목 · 마감 시각 · 총 표수 · 선택지별 득표와 비율을 담는다.
 * 높이는 선택지 수에 따라 늘어난다 — 고정 높이에 밀어 넣으면 10개에서 막대가 겹친다.
 */
export function renderResultSvg(input: ResultImageInput): string {
  const hasVotes = input.total > 0 && input.results.length > 0;
  const height = hasVotes
    ? BARS_TOP + input.results.length * ROW_HEIGHT + PAD_BOTTOM
    : BARS_TOP + EMPTY_BLOCK + PAD_BOTTOM;

  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${height}" viewBox="0 0 ${WIDTH} ${height}">`,
    `<rect x="0" y="0" width="${WIDTH}" height="${height}" fill="${BG}" />`,
    textEl(fitText(input.teamName, NAME_SIZE, CONTENT), PAD, NAME_BASELINE, NAME_SIZE, INK),
    textEl(fitText(metaLine(input), META_SIZE, CONTENT), PAD, META_BASELINE, META_SIZE, MUTED),
    textEl(fitText(input.title, TITLE_SIZE, CONTENT), PAD, TITLE_BASELINE, TITLE_SIZE, NAVY),
    textEl('총 표수', PAD, TOTAL_LABEL_BASELINE, TOTAL_LABEL_SIZE, MUTED),
    textEl(String(input.total), PAD, TOTAL_BASELINE, TOTAL_SIZE, NAVY),
    `<line x1="${PAD}" y1="${DIVIDER_Y}" x2="${WIDTH - PAD}" y2="${DIVIDER_Y}" stroke="${LINE}" stroke-width="2" />`,
  ];

  if (!hasVotes) {
    parts.push(textEl('표 없음', PAD, BARS_TOP + 60, EMPTY_SIZE, MUTED));
  } else {
    input.results.forEach((result, index) => {
      const top = BARS_TOP + index * ROW_HEIGHT;
      const labelBaseline = top + 32;
      const barY = top + 46;
      const filled = barWidth(result.count, input.total);
      parts.push(
        textEl(
          fitText(result.option, OPTION_SIZE, CONTENT - COUNT_RESERVE),
          PAD,
          labelBaseline,
          OPTION_SIZE,
          INK,
        ),
        textEl(
          `${result.count}표 · ${percentOf(result.count, input.total)}%`,
          WIDTH - PAD,
          labelBaseline,
          OPTION_SIZE,
          MUTED,
          'end',
        ),
        `<rect x="${PAD}" y="${barY}" width="${CONTENT}" height="${BAR_HEIGHT}" rx="6" fill="${TRACK}" />`,
      );
      if (filled > 0) {
        parts.push(`<rect x="${PAD}" y="${barY}" width="${filled}" height="${BAR_HEIGHT}" rx="6" fill="${NAVY}" />`);
      }
    });
  }

  parts.push('</svg>');
  return parts.join('\n');
}
