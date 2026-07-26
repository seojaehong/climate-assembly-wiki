import { describe, it, expect } from 'vitest';
import {
  isOpsMode,
  participationParts,
  broadcastViewportShortfall,
  BROADCAST_STATUS_STYLE,
  BROADCAST_BORDER_COLOR,
  BROADCAST_TYPE_TOKENS,
  BROADCAST_CARD_BOX_X,
  BROADCAST_CARD_BOX_Y,
  BROADCAST_GRID_CHROME_PX,
  BROADCAST_GRID_GAP_PX,
  BROADCAST_GRID_MIN_HEIGHT,
  BROADCAST_GRID_MIN_WIDTH,
  BROADCAST_PAGE_PADDING_X,
  BROADCAST_ROW_MIN_HEIGHT,
  broadcastFontSize,
  broadcastFontCss,
  broadcastCardContentHeight,
  broadcastCardAvailableHeight,
  broadcastCardRequiredWidth,
  broadcastCardAvailableWidth,
} from './hq-broadcast-logic';
import type { BroadcastTypeKey } from './hq-broadcast-logic';
import type { TeamCellResult } from './hq-grid-logic';

function cell(participation: string): TeamCellResult {
  return { label: '투표중', participation };
}

const PAGE_BG = '#F5F8FB';
const CARD_BG = '#FFFFFF';

// WCAG 2.x 상대휘도 — 테스트에서만 쓰는 검증 도구라 로직 모듈에 넣지 않는다.
function relativeLuminance(hex: string): number {
  const v = hex.replace('#', '');
  const ch = [0, 2, 4].map((i) => {
    const s = parseInt(v.slice(i, i + 2), 16) / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

describe('isOpsMode', () => {
  it("'?ops=1'일 때만 운영 모드다", () => {
    expect(isOpsMode('?ops=1')).toBe(true);
  });

  it('빈 문자열과 물음표만 있는 경우는 송출 모드다', () => {
    expect(isOpsMode('')).toBe(false);
    expect(isOpsMode('?')).toBe(false);
  });

  it("'?ops=0'은 송출 모드다", () => {
    expect(isOpsMode('?ops=0')).toBe(false);
  });

  it('다른 파라미터만 있으면 송출 모드다', () => {
    expect(isOpsMode('?x=1')).toBe(false);
  });

  it('다른 파라미터와 함께 있어도 ops=1이면 운영 모드다', () => {
    expect(isOpsMode('?code=ABCD&ops=1')).toBe(true);
    expect(isOpsMode('?ops=1&code=ABCD')).toBe(true);
  });

  it('물음표가 없는 검색 문자열도 처리한다', () => {
    expect(isOpsMode('ops=1')).toBe(true);
  });

  it("'1' 이외의 값은 운영 모드가 아니다 — 오타로 대형 스크린에 조작 UI가 뜨면 안 된다", () => {
    expect(isOpsMode('?ops=true')).toBe(false);
    expect(isOpsMode('?ops=')).toBe(false);
    expect(isOpsMode('?ops')).toBe(false);
    expect(isOpsMode('?ops=11')).toBe(false);
  });

  it('이름이 부분 일치하는 파라미터에 속지 않는다', () => {
    expect(isOpsMode('?xops=1')).toBe(false);
    expect(isOpsMode('?opsmode=1')).toBe(false);
  });
});

describe('participationParts', () => {
  it("'9/12'를 득표수와 전체로 나눈다", () => {
    expect(participationParts(cell('9/12'))).toEqual({ votes: '9', total: '12' });
  });

  it('0표도 그대로 유지한다', () => {
    expect(participationParts(cell('0/14'))).toEqual({ votes: '0', total: '14' });
  });

  it('슬래시가 없으면 전체는 빈 문자열이다', () => {
    expect(participationParts(cell('9'))).toEqual({ votes: '9', total: '' });
  });

  it('빈 문자열은 양쪽 모두 빈 문자열이다', () => {
    expect(participationParts(cell(''))).toEqual({ votes: '', total: '' });
  });

  it('슬래시가 여러 개면 첫 슬래시만 기준으로 나눈다', () => {
    expect(participationParts(cell('9/12/3'))).toEqual({ votes: '9', total: '12/3' });
  });

  it('앞뒤 공백을 제거한다', () => {
    expect(participationParts(cell(' 9 / 12 '))).toEqual({ votes: '9', total: '12' });
  });

  it('분모가 비어 있어도 터지지 않는다', () => {
    expect(participationParts(cell('9/'))).toEqual({ votes: '9', total: '' });
    expect(participationParts(cell('/12'))).toEqual({ votes: '', total: '12' });
  });
});

describe('contrastRatio (테스트 도구 자체 검증)', () => {
  it('흑백은 21:1, 같은 색은 1:1이다', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 1);
    expect(contrastRatio('#1F4E79', '#1F4E79')).toBeCloseTo(1, 5);
  });
});

describe('BROADCAST_STATUS_STYLE', () => {
  it('세 가지 상태를 빠짐없이 정의한다', () => {
    expect(Object.keys(BROADCAST_STATUS_STYLE).sort()).toEqual(['대기', '마감', '투표중']);
  });

  it('배지 글자와 배경의 대비가 4.5:1 이상이다 (32px 굵은 글자 = 큰 글자 AAA)', () => {
    for (const [label, s] of Object.entries(BROADCAST_STATUS_STYLE)) {
      expect(contrastRatio(s.text, s.bg), label).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('상태 도트가 배지 배경 위에서 3:1 이상으로 보인다', () => {
    for (const [label, s] of Object.entries(BROADCAST_STATUS_STYLE)) {
      expect(contrastRatio(s.dot, s.bg), label).toBeGreaterThanOrEqual(3);
    }
  });

  it('좌측 색 띠가 페이지 배경 대비 2.5:1 이상이다', () => {
    for (const [label, s] of Object.entries(BROADCAST_STATUS_STYLE)) {
      expect(contrastRatio(s.band, PAGE_BG), label).toBeGreaterThanOrEqual(2.5);
    }
  });

  it('상태끼리 배지 배경 밝기가 서로 구분된다 — 색상만으로 나뉘지 않는다', () => {
    expect(contrastRatio(BROADCAST_STATUS_STYLE.대기.bg, BROADCAST_STATUS_STYLE.투표중.bg)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(BROADCAST_STATUS_STYLE.투표중.bg, BROADCAST_STATUS_STYLE.마감.bg)).toBeGreaterThanOrEqual(1.5);
  });
});

describe('BROADCAST_BORDER_COLOR', () => {
  it('페이지 배경(#F5F8FB) 대비 2.5:1 이상이다 — 15개 카드가 흰 덩어리로 뭉치지 않게', () => {
    expect(contrastRatio(BROADCAST_BORDER_COLOR, PAGE_BG)).toBeGreaterThanOrEqual(2.5);
  });

  it('카드 배경(흰색) 대비도 2.5:1 이상이다', () => {
    expect(contrastRatio(BROADCAST_BORDER_COLOR, CARD_BG)).toBeGreaterThanOrEqual(2.5);
  });

  it('AC 예시값 #9CB7C8은 실제로 2.5:1을 못 넘긴다 — 임계값을 따른 근거', () => {
    expect(contrastRatio('#9CB7C8', PAGE_BG)).toBeLessThan(2.5);
  });
});

// ── US-019: 송출 타이포를 뷰포트 비례로 ────────────────────────────────────────
// 1080p에서 고정 px가 산술적으로 불가능하다는 근거는
// evaluation/2026-07-26-hq-broadcast-mod-blockers.md §4에 있다.

const RES = {
  '1440x900': { w: 1440, h: 900 },
  '1920x1080': { w: 1920, h: 1080 },
  '2560x1440': { w: 2560, h: 1440 },
  '3840x2160': { w: 3840, h: 2160 },
} as const;

const TYPE_KEYS: BroadcastTypeKey[] = [
  'teamName',
  'tableNo',
  'statusBadge',
  'blockLabel',
  'votes',
  'votesTotal',
  'attendanceValue',
];

/** CSS `clamp(Apx, min(Xvh, Yvw), Bpx)` 문자열을 브라우저와 같은 규칙으로 되푼다. */
function resolveCss(css: string, w: number, h: number): number {
  const m = css.match(
    /^clamp\(\s*([\d.]+)px,\s*min\(\s*([\d.]+)vh,\s*([\d.]+)vw\s*\),\s*([\d.]+)px\s*\)$/,
  );
  if (!m) throw new Error(`clamp 형식이 아니다: ${css}`);
  const [lo, vh, vw, hi] = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
  return Math.min(hi, Math.max(lo, Math.min((vh * h) / 100, (vw * w) / 100)));
}

describe('broadcastFontSize / broadcastFontCss', () => {
  it('CSS clamp 문자열과 순수 함수가 모든 해상도에서 같은 값을 낸다', () => {
    // 이게 이 story의 핵심 방어선이다. 화면 크기는 CSS가 정하고 예산 계산은 JS가 하므로
    // 둘이 어긋나면 "예산은 맞는데 화면은 잘리는" 상태가 되는데 브라우저 없이는 못 잡는다.
    for (const key of TYPE_KEYS) {
      const css = broadcastFontCss(key);
      for (const [name, { w, h }] of Object.entries(RES)) {
        expect(resolveCss(css, w, h), `${key} @ ${name}`).toBeCloseTo(broadcastFontSize(key, w, h), 2);
      }
    }
  });

  it('AC #5 — 어떤 해상도에서도 하한(득표 56 · 조 이름 32 · 출석 숫자 40)을 지킨다', () => {
    const tiny: [number, number][] = [
      [0, 0],
      [390, 844],
      [1024, 768],
      [RES['1440x900'].w, RES['1440x900'].h],
    ];
    for (const [w, h] of tiny) {
      expect(broadcastFontSize('votes', w, h)).toBeGreaterThanOrEqual(56);
      expect(broadcastFontSize('teamName', w, h)).toBeGreaterThanOrEqual(32);
      expect(broadcastFontSize('attendanceValue', w, h)).toBeGreaterThanOrEqual(40);
      // 테이블 번호(US-017)는 AC #3·#5 목록에 빠져 있지만 같은 카드에 있으므로 함께 지킨다.
      expect(broadcastFontSize('tableNo', w, h)).toBeGreaterThanOrEqual(24);
    }
  });

  it('AC #4 — 1440p·2160p에서 득표 수가 88px에 도달한다', () => {
    expect(broadcastFontSize('votes', RES['2560x1440'].w, RES['2560x1440'].h)).toBe(88);
    expect(broadcastFontSize('votes', RES['3840x2160'].w, RES['3840x2160'].h)).toBe(88);
    expect(broadcastFontSize('attendanceValue', RES['3840x2160'].w, RES['3840x2160'].h)).toBe(64);
  });

  it('AC #4 — 화면이 커질수록 작아지지 않는다(단조 증가)', () => {
    for (const key of TYPE_KEYS) {
      const a = broadcastFontSize(key, RES['1440x900'].w, RES['1440x900'].h);
      const b = broadcastFontSize(key, RES['1920x1080'].w, RES['1920x1080'].h);
      const c = broadcastFontSize(key, RES['2560x1440'].w, RES['2560x1440'].h);
      const d = broadcastFontSize(key, RES['3840x2160'].w, RES['3840x2160'].h);
      expect(b, key).toBeGreaterThanOrEqual(a);
      expect(c, key).toBeGreaterThanOrEqual(b);
      expect(d, key).toBeGreaterThanOrEqual(c);
    }
  });

  it('상한을 넘지 않는다 — 8K에서도 카드 밖으로 자라지 않는다', () => {
    for (const key of TYPE_KEYS) {
      expect(broadcastFontSize(key, 7680, 4320), key).toBe(BROADCAST_TYPE_TOKENS[key].max);
    }
  });

  it('16:9가 아닌 화면에서는 폭이 제약이 된다 — 높이만으로 88px에 닿지 않는다', () => {
    // AC #4의 "1440p"는 2560x1440을 뜻한다. 세로만 1440인 4:3 화면(1920x1440)에서는
    // 폭이 먼저 걸려 득표수가 88에 못 미치는 것이 **정상**이다(안 그러면 가로로 잘린다).
    expect(broadcastFontSize('votes', 1920, 1440)).toBeLessThan(88);
    expect(broadcastFontSize('votes', 1920, 1440)).toBe(broadcastFontSize('votes', 1920, 4320));
  });
});

describe('송출 카드 높이 예산', () => {
  it('AC #3 — 1080p·1440p·2160p에서 카드 내용이 트랙 안에 들어간다', () => {
    for (const name of ['1920x1080', '2560x1440', '3840x2160'] as const) {
      const { w, h } = RES[name];
      expect(broadcastCardContentHeight(w, h), name).toBeLessThanOrEqual(broadcastCardAvailableHeight(h));
    }
  });

  it('하한 조합이 최소 행 높이 안에 들어간다 — 짧은 화면은 잘리는 대신 스크롤된다', () => {
    // 숫자를 두 번 적지 않는다: 상수 자체가 하한 조합에서 유도돼야 "안 잘린다"는 주장이 유지된다.
    const floorContent = broadcastCardContentHeight(0, 0);
    expect(floorContent + BROADCAST_CARD_BOX_Y).toBeLessThanOrEqual(BROADCAST_ROW_MIN_HEIGHT);
    expect(BROADCAST_GRID_MIN_HEIGHT).toBe(BROADCAST_ROW_MIN_HEIGHT * 3 + BROADCAST_GRID_GAP_PX * 2);
  });

  it('1080p에서는 min-h가 아니라 뷰포트가 트랙을 정한다(세로 스크롤 없음)', () => {
    const viewportTrack = (1080 - BROADCAST_GRID_CHROME_PX - BROADCAST_GRID_GAP_PX * 2) / 3;
    expect(viewportTrack).toBeGreaterThanOrEqual(BROADCAST_ROW_MIN_HEIGHT);
  });
});

describe('송출 카드 폭 예산', () => {
  it('AC #6 — 1080p·1440p·2160p에서 줄바꿈 없는 요소가 카드 폭 안에 들어간다', () => {
    for (const name of ['1920x1080', '2560x1440', '3840x2160'] as const) {
      const { w, h } = RES[name];
      expect(broadcastCardRequiredWidth(w, h), name).toBeLessThanOrEqual(broadcastCardAvailableWidth(w));
    }
  });

  it('좁은 화면에서도 폭이 모자라지 않는다 — min-w가 가로 스크롤로 바꾼다', () => {
    // min-w가 막 풀리는 폭이 전 구간에서 가장 빡빡하다 — 반드시 그 경계를 넣는다.
    const edge = BROADCAST_GRID_MIN_WIDTH + BROADCAST_PAGE_PADDING_X;
    for (const w of [390, 1024, 1280, edge - 1, edge, edge + 1, 1440]) {
      expect(broadcastCardRequiredWidth(w, 900), String(w)).toBeLessThanOrEqual(broadcastCardAvailableWidth(w));
    }
  });

  it('최소 크기 상수가 HqGrid의 Tailwind 리터럴과 같다', () => {
    // 클래스 문자열은 purge 때문에 리터럴이어야 해서 숫자가 두 곳에 산다.
    // 토큰을 바꾸면 여기가 먼저 깨지고, 그때 min-h-[…]/min-w-[…]를 함께 고치라는 뜻이다.
    expect(BROADCAST_GRID_MIN_HEIGHT).toBe(792); // HqGrid.tsx: min-h-[792px]
    expect(BROADCAST_GRID_MIN_WIDTH).toBe(1288); // HqGrid.tsx: min-w-[1288px]
  });

  it('그리드 최소 폭이 하한 조합에서 유도된다', () => {
    const floorWidth = broadcastCardRequiredWidth(0, 0);
    expect(BROADCAST_GRID_MIN_WIDTH).toBeGreaterThanOrEqual(
      (floorWidth + BROADCAST_CARD_BOX_X) * 5 + BROADCAST_GRID_GAP_PX * 4,
    );
  });
});

describe('broadcastViewportShortfall — 송출 화면이 너무 낮을 때', () => {
  it('1080p 이상에서는 부족분이 없다', () => {
    expect(broadcastViewportShortfall(1080)).toBe(0);
    expect(broadcastViewportShortfall(1440)).toBe(0);
  });

  it('952px 미만에서는 부족한 픽셀 수를 그대로 알려준다', () => {
    // 그리드 바닥값(792) + 헤더·푸터(160) = 952. 이 아래로는 3행이 뷰포트를 넘는다.
    expect(broadcastViewportShortfall(768)).toBe(184);
    expect(broadcastViewportShortfall(900)).toBe(52);
    expect(broadcastViewportShortfall(951)).toBe(1);
    expect(broadcastViewportShortfall(952)).toBe(0);
  });

  it('측정 전(0)이나 음수 입력에서는 경고하지 않는다 — SSR·초기 렌더에서 오경보를 내지 않기 위함', () => {
    expect(broadcastViewportShortfall(0)).toBe(0);
    expect(broadcastViewportShortfall(-100)).toBe(0);
  });
});
