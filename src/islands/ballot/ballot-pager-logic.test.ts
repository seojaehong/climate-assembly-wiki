import { describe, expect, it } from 'vitest';
import type { Ballot, BallotItem } from '../../lib/ballot';
import {
  ADVANCE_DELAY_MS,
  INPUT_LOCK_MS,
  clearPagerDraft,
  initialPagerState,
  loadPagerDraft,
  motionNumber,
  pagerChoiceText,
  pagerDraftKey,
  pagerPress,
  pagerSubmitGate,
  pagerSummary,
  pagerTick,
  savePagerDraft,
  shouldUsePager,
  type DraftStorage,
  type PagerState,
} from './ballot-pager-logic';

function items(n: number, required = true): BallotItem[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `item-${i + 1}`,
    ordinal: i + 1,
    statement: `2-${i + 1}-안1 권고 제목 ${i + 1}`,
    description: null,
    scale: 2 as const,
    required,
  }));
}

function ballot(n: number, over: Partial<Ballot> = {}): Ballot {
  return { id: 'b-1', title: '2분과 의결', instructions: null, status: 'open', subgroup: '2분과', items: items(n), ...over };
}

class MemStorage implements DraftStorage {
  map = new Map<string, string>();
  getItem(k: string) {
    return this.map.has(k) ? (this.map.get(k) as string) : null;
  }
  setItem(k: string, v: string) {
    this.map.set(k, v);
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
}

describe('넘김식 화면을 쓰는가', () => {
  it('분과 의결 투표지(2건 이상)는 넘김식', () => {
    expect(shouldUsePager(ballot(28), '')).toBe(true);
  });
  it('일반 다의제 투표는 지금 목록 그대로', () => {
    expect(shouldUsePager(ballot(5, { title: '분과 의견조사', subgroup: '2분과' }), '')).toBe(false);
    expect(shouldUsePager(ballot(5, { subgroup: null }), '')).toBe(false);
  });
  it('1건짜리 분과 의결(10/17 흐름)은 지금 화면 그대로', () => {
    expect(shouldUsePager(ballot(1), '')).toBe(false);
  });
  it('?view=list 이면 목록(비상용 토글)', () => {
    expect(shouldUsePager(ballot(28), '?t=abc&view=list')).toBe(false);
  });
});

describe('번호 표기', () => {
  it('「2-5-안1 제목」 → 「2-5」', () => {
    expect(motionNumber({ statement: '2-5-안1 일회용컵 보증금', ordinal: 5 })).toBe('2-5');
    expect(motionNumber({ statement: '1-12-안2 무엇', ordinal: 12 })).toBe('1-12');
  });
  it('모양이 다르면 순번', () => {
    expect(motionNumber({ statement: '아무 문장', ordinal: 7 })).toBe('7');
  });
});

describe('누르면 다음 건', () => {
  const list = items(28);
  it('찬성을 누르면 값이 들어가고 0.4초 뒤 다음 건', () => {
    let s = initialPagerState();
    s = pagerPress(s, list, 2, 1000);
    expect(s.answers['item-1']).toBe(2);
    expect(s.pos).toBe(0); // 고른 표시를 잠깐 보인다
    expect(pagerTick(s, 1000 + ADVANCE_DELAY_MS - 1).pos).toBe(0);
    s = pagerTick(s, 1000 + ADVANCE_DELAY_MS);
    expect(s.pos).toBe(1);
  });
  it('넘어간 뒤 500ms 는 누름을 받지 않는다(연달아 눌러 다음 건에 같은 값이 들어가지 않게)', () => {
    let s = initialPagerState();
    s = pagerPress(s, list, 2, 0);
    s = pagerTick(s, ADVANCE_DELAY_MS);
    const ignored = pagerPress(s, list, 1, ADVANCE_DELAY_MS + INPUT_LOCK_MS - 1);
    expect(ignored.answers['item-2']).toBeUndefined();
    const ok = pagerPress(s, list, 1, ADVANCE_DELAY_MS + INPUT_LOCK_MS);
    expect(ok.answers['item-2']).toBe(1);
  });
  it('고른 표시 중(0.4초)에 다시 눌러도 받지 않는다', () => {
    let s = initialPagerState();
    s = pagerPress(s, list, 2, 0);
    s = pagerPress(s, list, 1, 100);
    expect(s.answers['item-1']).toBe(2);
  });
  it('마지막 건 뒤에는 요약', () => {
    let s: PagerState = { ...initialPagerState(), pos: 27 };
    s = pagerPress(s, list, 1, 0);
    s = pagerTick(s, ADVANCE_DELAY_MS);
    expect(s.pos).toBe('summary');
  });
  it('이미 고른 건으로 돌아가 다시 누르면 바뀐다', () => {
    let s: PagerState = { ...initialPagerState(), answers: { 'item-3': 2 }, pos: 2 };
    s = pagerPress(s, list, 1, 0);
    expect(s.answers['item-3']).toBe(1);
  });
  it('요약 화면에서는 누름이 값을 바꾸지 않는다', () => {
    const s = { ...initialPagerState(), pos: 'summary' as const };
    expect(pagerPress(s, list, 2, 0)).toBe(s);
  });
});

describe('요약', () => {
  const list = items(6);
  const answers = { 'item-1': 2, 'item-2': 1, 'item-3': 2, 'item-5': 1 };
  it('찬성 · 반대 · 미응답 수와 반대 · 미응답 번호', () => {
    const s = pagerSummary(list, answers);
    expect(s.yes).toBe(2);
    expect(s.no).toBe(2);
    expect(s.unanswered).toBe(2);
    expect(s.noItems.map((x) => x.pos)).toEqual([1, 4]);
    expect(s.noItems.map((x) => x.number)).toEqual(['2-2', '2-5']);
    expect(s.unansweredItems.map((x) => x.number)).toEqual(['2-4', '2-6']);
  });
  it('번호를 누르면 그 건 — 요약의 pos 가 곧 건 위치', () => {
    const s = pagerSummary(list, answers);
    expect(list[s.unansweredItems[0].pos].id).toBe('item-4');
  });
  it('범위 밖 값은 미응답으로 센다', () => {
    const s = pagerSummary(list, { 'item-1': 9 });
    expect(s.unanswered).toBe(6);
  });
  it('제출 완료 화면 문구 — 28개 번호 나열 대신 「찬성 n건 · 반대 n건 · 기권 n건」', () => {
    expect(pagerChoiceText(list, answers)).toBe('찬성 2건 · 반대 2건 · 기권 2건');
    expect(pagerChoiceText(list, {})).toBe('찬성 0건 · 반대 0건 · 기권 6건');
  });
});

describe('제출 가부', () => {
  it('한 건도 고르지 않으면 제출 불가', () => {
    expect(pagerSubmitGate(items(3), {})).toBe('none-answered');
    expect(pagerSubmitGate(items(3, false), {})).toBe('none-answered');
  });
  it('전건 필수(required)인데 빠진 건이 있으면 제출 불가', () => {
    expect(pagerSubmitGate(items(3), { 'item-1': 2 })).toBe('required-missing');
  });
  it('미표시 허용(required=false)이면 한 번 더 확인하고 제출', () => {
    expect(pagerSubmitGate(items(3, false), { 'item-1': 2 })).toBe('confirm-missing');
  });
  it('다 골랐으면 바로 제출', () => {
    expect(pagerSubmitGate(items(2), { 'item-1': 2, 'item-2': 1 })).toBe('ready');
  });
});

describe('임시 저장(새로고침 · 화면 꺼짐)', () => {
  const list = items(28);
  it('고른 값과 위치를 투표지 id 별 키로 저장하고 되살린다', () => {
    const st = new MemStorage();
    savePagerDraft(st, 'b-1', { answers: { 'item-1': 2, 'item-2': 1 }, pos: 2, voter: { team: '2분과 3조', name: '가나다' } });
    expect(st.map.has(pagerDraftKey('b-1'))).toBe(true);
    const d = loadPagerDraft(st, 'b-1', list);
    expect(d).toEqual({ answers: { 'item-1': 2, 'item-2': 1 }, pos: 2, voter: { team: '2분과 3조', name: '가나다' } });
  });
  it('요약 위치도 되살린다', () => {
    const st = new MemStorage();
    savePagerDraft(st, 'b-1', { answers: { 'item-1': 2 }, pos: 'summary', voter: null });
    expect(loadPagerDraft(st, 'b-1', list)?.pos).toBe('summary');
  });
  it('다른 투표지의 저장값은 되살리지 않는다', () => {
    const st = new MemStorage();
    savePagerDraft(st, 'b-1', { answers: { 'item-1': 2 }, pos: 1, voter: null });
    expect(loadPagerDraft(st, 'b-2', list)).toBeNull();
  });
  it('문항에 없는 id · 척도 밖 값 · 범위 밖 위치는 버린다', () => {
    const st = new MemStorage();
    st.setItem(pagerDraftKey('b-1'), JSON.stringify({ v: 1, answers: { 'item-1': 2, ghost: 1, 'item-2': 7 }, pos: 99 }));
    expect(loadPagerDraft(st, 'b-1', list)).toEqual({ answers: { 'item-1': 2 }, pos: 0, voter: null });
  });
  it('깨진 값이면 null', () => {
    const st = new MemStorage();
    st.setItem(pagerDraftKey('b-1'), '{broken');
    expect(loadPagerDraft(st, 'b-1', list)).toBeNull();
  });
  it('제출 뒤 삭제', () => {
    const st = new MemStorage();
    savePagerDraft(st, 'b-1', { answers: { 'item-1': 2 }, pos: 1, voter: null });
    clearPagerDraft(st, 'b-1');
    expect(loadPagerDraft(st, 'b-1', list)).toBeNull();
  });
  it('저장소가 예외를 던져도 화면은 죽지 않는다', () => {
    const bad: DraftStorage = {
      getItem() {
        throw new Error('SecurityError');
      },
      setItem() {
        throw new Error('QuotaExceeded');
      },
      removeItem() {
        throw new Error('SecurityError');
      },
    };
    expect(() => savePagerDraft(bad, 'b-1', { answers: {}, pos: 0, voter: null })).not.toThrow();
    expect(loadPagerDraft(bad, 'b-1', list)).toBeNull();
    expect(() => clearPagerDraft(bad, 'b-1')).not.toThrow();
  });
});
