import { describe, it, expect } from 'vitest';
import {
  isOpsMode,
  participationParts,
  BROADCAST_STATUS_STYLE,
  BROADCAST_BORDER_COLOR,
} from './hq-broadcast-logic';
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
