import { describe, expect, it } from 'vitest';
import { renderResultSvg, type ResultImageInput } from './result-image';

function input(overrides: Partial<ResultImageInput> = {}): ResultImageInput {
  return {
    teamName: '1분과 1조',
    sequence: 2,
    title: '우리 조의 우선 의제는 무엇입니까?',
    closedAtLabel: '14:32',
    total: 4,
    results: [
      { option: '에너지 전환', count: 3 },
      { option: '수송 전환', count: 1 },
    ],
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

/**
 * 막대 행의 y·높이. 배경 사각형(x=0,y=0)을 뺀 나머지를 y로 묶는다
 * (한 행은 트랙 + 득표 막대 2개가 같은 y를 쓴다).
 */
function barRows(svg: string): { y: number; height: number }[] {
  const bars = rects(svg).filter((r) => !(r.x === 0 && r.y === 0));
  const byY = new Map<number, number>();
  for (const bar of bars) byY.set(bar.y, Math.max(byY.get(bar.y) ?? 0, bar.height));
  return [...byY.entries()]
    .map(([y, height]) => ({ y, height }))
    .sort((a, b) => a.y - b.y);
}

function options(count: number): ResultImageInput['results'] {
  return Array.from({ length: count }, (_, i) => ({ option: `선택지 ${i + 1}`, count: i }));
}

describe('renderResultSvg', () => {
  it('래스터화 가능한 독립 SVG를 만든다 — xmlns · width · height · viewBox', () => {
    const svg = renderResultSvg(input());
    const root = rootTag(svg);
    expect(root).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(root).toMatch(/width="\d+"/);
    expect(root).toMatch(/height="\d+"/);
    expect(root).toMatch(/viewBox="0 0 \d+ \d+"/);
    expect(svg.trimEnd().endsWith('</svg>')).toBe(true);
  });

  it('외부 자원·앱 CSS·foreignObject를 참조하지 않는다 (canvas 오염·미렌더 방지)', () => {
    const svg = renderResultSvg(input());
    expect(svg).not.toContain('foreignObject');
    expect(svg).not.toContain('class=');
    expect(svg).not.toContain('<image');
    expect(svg).not.toContain('xlink:href');
    expect(svg).not.toContain('url(');
    // 유일하게 허용되는 URL은 SVG 네임스페이스뿐이다.
    expect(svg.match(/https?:\/\//g)).toEqual(['http://']);
  });

  it('조 이름 · 회차 · 제목 · 마감 시각 · 총 표수 · 선택지별 득표와 비율을 담는다', () => {
    const svg = renderResultSvg(input());
    expect(svg).toContain('1분과 1조');
    expect(svg).toContain('2차 투표');
    expect(svg).toContain('우리 조의 우선 의제는 무엇입니까?');
    expect(svg).toContain('14:32');
    expect(svg).toContain('>4</text>');
    expect(svg).toContain('에너지 전환');
    expect(svg).toContain('3표');
    expect(svg).toContain('75%');
    expect(svg).toContain('25%');
  });

  it('제목과 선택지 라벨을 **모두** XML 이스케이프한다', () => {
    const svg = renderResultSvg(
      input({
        title: '"석탄 & 가스" <감축> 안',
        teamName: '1조 & 2조',
        results: [
          { option: 'A & B', count: 2 },
          { option: '<보류>', count: 2 },
        ],
      }),
    );
    expect(svg).not.toContain('& ');
    expect(svg).not.toContain('<감축>');
    expect(svg).not.toContain('<보류>');
    expect(svg).toContain('&quot;석탄 &amp; 가스&quot; &lt;감축&gt; 안');
    expect(svg).toContain('1조 &amp; 2조');
    expect(svg).toContain('A &amp; B');
    expect(svg).toContain('&lt;보류&gt;');
  });

  it('회차가 1보다 작으면 회차 배지를 그리지 않는다 (0차 방지)', () => {
    const svg = renderResultSvg(input({ sequence: 0 }));
    expect(svg).not.toContain('0차');
    expect(svg).not.toContain('차 투표');
    // 회차가 없어도 나머지 머리글은 그대로다.
    expect(svg).toContain('1분과 1조');
    expect(svg).toContain('14:32');
  });

  it('마감 시각이 없으면 "진행 중"으로 쓰고 문자열 null을 흘리지 않는다', () => {
    const svg = renderResultSvg(input({ closedAtLabel: null }));
    expect(svg).toContain('진행 중');
    expect(svg).not.toContain('null');
    expect(svg).not.toContain('undefined');
  });

  it('마감 시각이 있으면 "마감 hh:mm"으로 쓴다 (포맷은 호출부가 이미 한 것)', () => {
    const svg = renderResultSvg(input({ closedAtLabel: '2026-08-29 14:32' }));
    expect(svg).toContain('마감 2026-08-29 14:32');
    expect(svg).not.toContain('진행 중');
  });

  it('총 표수 0이면 막대 없이 "표 없음"을 쓰고 0으로 나누지 않는다', () => {
    const svg = renderResultSvg(
      input({ total: 0, results: [{ option: '에너지 전환', count: 0 }, { option: '수송 전환', count: 0 }] }),
    );
    expect(svg).toContain('표 없음');
    expect(barRows(svg)).toHaveLength(0);
    expect(svg).not.toContain('NaN');
    expect(svg).not.toContain('Infinity');
    expect(svg).toContain('>0</text>');
  });

  it('선택지 2개에서 막대가 겹치지 않고 캔버스 안에 들어간다', () => {
    const svg = renderResultSvg(input({ total: 3, results: options(2) }));
    const rows = barRows(svg);
    expect(rows).toHaveLength(2);
    for (let i = 0; i + 1 < rows.length; i += 1) {
      expect(rows[i + 1].y).toBeGreaterThanOrEqual(rows[i].y + rows[i].height);
    }
    expect(rows[rows.length - 1].y + rows[rows.length - 1].height).toBeLessThanOrEqual(rootHeight(svg));
  });

  it('선택지 10개에서도 막대가 겹치지 않고 캔버스 안에 들어간다', () => {
    const svg = renderResultSvg(input({ total: 45, results: options(10) }));
    const rows = barRows(svg);
    expect(rows).toHaveLength(10);
    for (let i = 0; i + 1 < rows.length; i += 1) {
      expect(rows[i + 1].y).toBeGreaterThanOrEqual(rows[i].y + rows[i].height);
    }
    expect(rows[rows.length - 1].y + rows[rows.length - 1].height).toBeLessThanOrEqual(rootHeight(svg));
    // 높이는 선택지 수에 따라 늘어난다(2개보다 커야 한다).
    expect(rootHeight(svg)).toBeGreaterThan(rootHeight(renderResultSvg(input({ total: 3, results: options(2) }))));
  });

  it('득표가 총 표수를 넘어도(CHECKBOX 복수 선택) 막대가 트랙을 넘지 않는다', () => {
    const svg = renderResultSvg(
      input({ total: 5, results: [{ option: '에너지 전환', count: 8 }, { option: '수송 전환', count: 2 }] }),
    );
    const bars = rects(svg).filter((r) => !(r.x === 0 && r.y === 0));
    const trackWidth = Math.max(...bars.map((b) => b.width));
    for (const bar of bars) {
      expect(bar.x + bar.width).toBeLessThanOrEqual(bar.x + trackWidth);
      expect(bar.width).toBeLessThanOrEqual(trackWidth);
    }
    // 비율 자체는 정직하게 적는다 — 복수 선택에서 100%를 넘는 것은 사실이다.
    expect(svg).toContain('160%');
  });

  it('긴 제목과 긴 선택지 라벨을 …으로 줄여 캔버스를 넘지 않게 한다', () => {
    const longTitle = '기후위기 대응을 위한 우리 지역의 우선 의제는 무엇이라고 생각하십니까 그리고 그 이유는 무엇입니까';
    const svg = renderResultSvg(
      input({ title: longTitle, results: [{ option: '가'.repeat(80), count: 3 }, { option: '나', count: 1 }] }),
    );
    expect(svg).not.toContain(longTitle);
    expect(svg).toContain('…');
    expect(svg).not.toContain('가'.repeat(80));
  });

  it('대전제 하한 글자 크기를 지킨다 — 조 이름 40+ · 총 표수 80+ · 선택지 라벨 28+', () => {
    const svg = renderResultSvg(input());
    const sizes = [...svg.matchAll(/font-size="(\d+)"/g)].map((m) => Number(m[1]));
    expect(Math.max(...sizes)).toBeGreaterThanOrEqual(80);
    expect(sizes).toContain(48);
    expect(sizes).toContain(88);
    expect(sizes).toContain(32);
    // 8~15m 판독 기준 — 이 이미지에는 28px 미만 글자가 없다.
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(28);
  });

  it('선택지 순서를 입력 순서 그대로 유지한다 (득표순으로 재정렬하지 않는다)', () => {
    const svg = renderResultSvg(
      input({
        total: 6,
        results: [
          { option: '가장 적은 선택지', count: 1 },
          { option: '가장 많은 선택지', count: 5 },
        ],
      }),
    );
    expect(svg.indexOf('가장 적은 선택지')).toBeLessThan(svg.indexOf('가장 많은 선택지'));
  });

  it('선택지가 하나도 없어도 깨지지 않는다', () => {
    const svg = renderResultSvg(input({ total: 0, results: [] }));
    expect(rootTag(svg)).toMatch(/height="\d+"/);
    expect(svg).toContain('표 없음');
    expect(svg).not.toContain('NaN');
  });
});
