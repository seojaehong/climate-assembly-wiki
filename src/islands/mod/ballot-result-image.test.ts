import { describe, expect, it } from 'vitest';
import {
  formatAvg,
  renderBallotItemSvg,
  renderBallotItemSvgs,
  wrapText,
  type BallotItemImageInput,
} from './ballot-result-image';

function input(overrides: Partial<BallotItemImageInput> = {}): BallotItemImageInput {
  return {
    ballotTitle: '폐회 일괄 투표 — 권고안 지지도',
    ordinal: 1,
    statement: '석탄 발전을 2035년까지 단계적으로 감축한다',
    scale: 5,
    n: 12,
    avg: 4.25,
    dist: { '1': 0, '2': 1, '3': 2, '4': 3, '5': 6 },
    ...overrides,
  };
}

/** 루트 `<svg …>` 여는 태그. width/height/viewBox/xmlns 검증용. */
function rootTag(svg: string): string {
  const match = svg.match(/^<svg[^>]*>/);
  expect(match).not.toBeNull();
  return match![0];
}

function rootHeight(svg: string): number {
  const match = rootTag(svg).match(/height="(\d+)"/);
  expect(match).not.toBeNull();
  return Number(match![1]);
}

type Rect = { x: number; y: number; width: number; height: number };

function rects(svg: string): Rect[] {
  return [...svg.matchAll(/<rect x="(\d+)" y="(\d+)" width="(\d+)" height="(\d+)"/g)].map((m) => ({
    x: Number(m[1]),
    y: Number(m[2]),
    width: Number(m[3]),
    height: Number(m[4]),
  }));
}

/** 막대 행의 y·높이. 배경 사각형(x=0,y=0)을 뺀 나머지를 y로 묶는다. */
function barRows(svg: string): { y: number; height: number }[] {
  const bars = rects(svg).filter((r) => !(r.x === 0 && r.y === 0));
  const byY = new Map<number, number>();
  for (const bar of bars) byY.set(bar.y, Math.max(byY.get(bar.y) ?? 0, bar.height));
  return [...byY.entries()]
    .map(([y, height]) => ({ y, height }))
    .sort((a, b) => a.y - b.y);
}

describe('formatAvg — toFixed 없이 소수 둘째 자리', () => {
  it('반올림해 항상 두 자리 소수로 적는다', () => {
    expect(formatAvg(4.25)).toBe('4.25');
    expect(formatAvg(4.246)).toBe('4.25');
    expect(formatAvg(4)).toBe('4.00');
    expect(formatAvg(3.5)).toBe('3.50');
    expect(formatAvg(1.005)).toBe('1.00'); // Math.round(100.49...) — 부동소수 그대로의 사실
  });

  it('null·NaN·음수는 —로 적는다 (응답 없음 표기)', () => {
    expect(formatAvg(null)).toBe('—');
    expect(formatAvg(undefined)).toBe('—');
    expect(formatAvg(Number.NaN)).toBe('—');
    expect(formatAvg(-1)).toBe('—');
  });
});

describe('wrapText — 글자 단위 줄 접기', () => {
  it('폭 안에 들어가면 한 줄 그대로 둔다', () => {
    expect(wrapText('짧은 문장', 40, 1104, 3)).toEqual(['짧은 문장']);
  });

  it('길면 여러 줄로 접고 maxLines를 넘기지 않는다', () => {
    const long = '가'.repeat(120); // 40px 한글 120자 = 4800px > 3줄 한계
    const lines = wrapText(long, 40, 1104, 3);
    expect(lines).toHaveLength(3);
    expect(lines[2].endsWith('…')).toBe(true);
  });

  it('접힌 각 줄이 지정 폭을 넘지 않는다 (한글 40px 기준 27자 이하)', () => {
    const long = '나'.repeat(80);
    const lines = wrapText(long, 40, 1104, 3);
    for (const line of lines) {
      expect(line.length * 40).toBeLessThanOrEqual(1104 + 40); // …치환 여유 1자
    }
  });

  it('빈 문자열도 한 줄로 나온다 (0줄이면 레이아웃 계산이 음수가 된다)', () => {
    expect(wrapText('', 40, 1104, 3)).toEqual(['']);
  });
});

describe('renderBallotItemSvg', () => {
  it('래스터화 가능한 독립 SVG를 만든다 — xmlns · width · height · viewBox', () => {
    const svg = renderBallotItemSvg(input());
    const root = rootTag(svg);
    expect(root).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(root).toMatch(/width="\d+"/);
    expect(root).toMatch(/height="\d+"/);
    expect(root).toMatch(/viewBox="0 0 \d+ \d+"/);
    expect(svg.trimEnd().endsWith('</svg>')).toBe(true);
  });

  it('외부 자원·앱 CSS·foreignObject를 참조하지 않는다 (canvas 오염·미렌더 방지)', () => {
    const svg = renderBallotItemSvg(input());
    expect(svg).not.toContain('foreignObject');
    expect(svg).not.toContain('class=');
    expect(svg).not.toContain('<image');
    expect(svg).not.toContain('xlink:href');
    expect(svg).not.toContain('url(');
    expect(svg.match(/https?:\/\//g)).toEqual(['http://']);
  });

  it('투표 제목 · 의제 번호 · 척도 · 응답 수 · 문장 · 평균 · 값별 건수와 비율을 담는다', () => {
    const svg = renderBallotItemSvg(input());
    expect(svg).toContain('폐회 일괄 투표 — 권고안 지지도');
    expect(svg).toContain('의제 1 · 5점 척도 · 응답 12건');
    expect(svg).toContain('석탄 발전을 2035년까지 단계적으로 감축한다');
    expect(svg).toContain('4.25');
    expect(svg).toContain('6건 · 50%');
    expect(svg).toContain('1건 · 8%');
  });

  it('척도 값 라벨을 ballot-logic의 문구로 적는다 (5점: 매우 동의합니다 등)', () => {
    const svg = renderBallotItemSvg(input());
    expect(svg).toContain('1 · 전혀 동의하지 않습니다');
    expect(svg).toContain('3 · 보통입니다');
    expect(svg).toContain('5 · 매우 동의합니다');
  });

  it('찬반(2점)은 반대/찬성 라벨을 쓴다', () => {
    const svg = renderBallotItemSvg(input({ scale: 2, dist: { '1': 4, '2': 8 }, avg: 1.67 }));
    expect(svg).toContain('1 · 반대');
    expect(svg).toContain('2 · 찬성');
    expect(svg).not.toContain('보통입니다');
  });

  it('제목·문장을 XML 이스케이프한다', () => {
    const svg = renderBallotItemSvg(
      input({ ballotTitle: 'A & B <투표>', statement: '"석탄 & 가스" <감축> 안' }),
    );
    expect(svg).not.toContain('<감축>');
    expect(svg).not.toContain('<투표>');
    expect(svg).toContain('A &amp; B &lt;투표&gt;');
    expect(svg).toContain('&quot;석탄 &amp; 가스&quot; &lt;감축&gt; 안');
  });

  it('응답 0건이면 평균을 —로 적고 NaN을 흘리지 않는다', () => {
    const svg = renderBallotItemSvg(input({ n: 0, avg: null, dist: {} }));
    expect(svg).toContain('응답 0건');
    expect(svg).toContain('>—</text>');
    expect(svg).not.toContain('NaN');
    expect(svg).not.toContain('Infinity');
    expect(svg).not.toContain('null');
  });

  it('dist가 null이어도 척도 전 구간 행을 0건으로 그린다', () => {
    const svg = renderBallotItemSvg(input({ dist: null, n: 0, avg: null }));
    expect(barRows(svg)).toHaveLength(5);
    expect(svg).toContain('0건 · 0%');
  });

  it('막대 행이 겹치지 않고 캔버스 안에 들어간다 (5점)', () => {
    const svg = renderBallotItemSvg(input());
    const rows = barRows(svg);
    expect(rows).toHaveLength(5);
    for (let i = 0; i + 1 < rows.length; i += 1) {
      expect(rows[i + 1].y).toBeGreaterThanOrEqual(rows[i].y + rows[i].height);
    }
    expect(rows[rows.length - 1].y + rows[rows.length - 1].height).toBeLessThanOrEqual(rootHeight(svg));
  });

  it('7점 척도가 2점보다 카드가 길다 (행 수에 따라 높이가 는다)', () => {
    const tall = renderBallotItemSvg(input({ scale: 7, dist: { '1': 1 }, n: 1, avg: 1 }));
    const short = renderBallotItemSvg(input({ scale: 2, dist: { '1': 1 }, n: 1, avg: 1 }));
    expect(barRows(tall)).toHaveLength(7);
    expect(barRows(short)).toHaveLength(2);
    expect(rootHeight(tall)).toBeGreaterThan(rootHeight(short));
  });

  it('긴 문장(300자)은 줄로 접고 카드 밖으로 흘리지 않는다', () => {
    const long = '기후위기 대응을 위해 우리 지역 산업 구조를 어떻게 바꿔야 하는지에 대한 매우 긴 의제 문장입니다 '.repeat(6);
    const svg = renderBallotItemSvg(input({ statement: long }));
    expect(svg).not.toContain(long);
    expect(svg).toContain('…');
    const rows = barRows(svg);
    expect(rows[rows.length - 1].y + rows[rows.length - 1].height).toBeLessThanOrEqual(rootHeight(svg));
  });

  it('대전제 하한 글자 크기를 지킨다 — 문장 40 · 평균 80 · 최소 28', () => {
    const svg = renderBallotItemSvg(input());
    const sizes = [...svg.matchAll(/font-size="(\d+)"/g)].map((m) => Number(m[1]));
    expect(Math.max(...sizes)).toBeGreaterThanOrEqual(80);
    expect(sizes).toContain(40);
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(28);
  });

  it('득표 막대가 트랙(콘텐츠 폭)을 넘지 않는다', () => {
    const svg = renderBallotItemSvg(input({ dist: { '1': 0, '2': 0, '3': 0, '4': 0, '5': 12 } }));
    const bars = rects(svg).filter((r) => !(r.x === 0 && r.y === 0));
    for (const bar of bars) expect(bar.width).toBeLessThanOrEqual(1104);
  });
});

describe('renderBallotItemSvgs', () => {
  it('문항 수만큼 SVG를 입력 순서 그대로 만든다', () => {
    const svgs = renderBallotItemSvgs({
      title: '폐회 일괄 투표',
      items: [
        { ordinal: 1, statement: '첫째 의제', scale: 5, n: 3, avg: 4, dist: { '4': 3 } },
        { ordinal: 2, statement: '둘째 의제', scale: 2, n: 3, avg: 1.5, dist: { '1': 2, '2': 1 } },
      ],
    });
    expect(svgs).toHaveLength(2);
    expect(svgs[0]).toContain('첫째 의제');
    expect(svgs[0]).toContain('의제 1 · 5점 척도');
    expect(svgs[1]).toContain('둘째 의제');
    expect(svgs[1]).toContain('의제 2 · 2점 척도');
    // 모든 카드에 투표 제목이 머리글로 들어간다.
    for (const svg of svgs) expect(svg).toContain('폐회 일괄 투표');
  });
});
