import { describe, expect, it } from 'vitest';
import { pairKey, togglePair, marksByNote, checkedPairCount } from './pair-marks';
import type { SimilarPair } from './note-similarity';

function pair(aId: string, bId: string, score = 0.5): SimilarPair {
  return { aId, bId, score, sharedTerms: ['버스'] };
}

describe('pairKey', () => {
  it('두 카드 순서가 바뀌어도 같은 키다', () => {
    expect(pairKey('t:a:1', 't:b:1')).toBe(pairKey('t:b:1', 't:a:1'));
  });

  it('다른 짝은 다른 키다', () => {
    expect(pairKey('t:a:1', 't:b:1')).not.toBe(pairKey('t:a:1', 't:b:2'));
  });

  it('같은 조의 다른 항목도 구분된다', () => {
    expect(pairKey('t:a:1', 't:a:2')).not.toBe(pairKey('t:a:1', 't:a:3'));
  });
});

describe('togglePair', () => {
  it('없으면 켜고 있으면 끈다 — 왕복하면 원래대로', () => {
    const key = pairKey('t:a:1', 't:b:1');
    const on = togglePair(new Set(), key);
    expect(on.has(key)).toBe(true);
    const off = togglePair(on, key);
    expect(off.has(key)).toBe(false);
    expect(off.size).toBe(0);
  });

  it('입력 Set 을 건드리지 않는다 (React 상태로 그대로 쓴다)', () => {
    const before = new Set(['x']);
    const after = togglePair(before, 'y');
    expect([...before]).toEqual(['x']);
    expect(after).not.toBe(before);
    expect(after.has('y')).toBe(true);
  });

  it('다른 짝을 켜도 이미 켠 짝은 남는다', () => {
    const a = pairKey('t:a:1', 't:b:1');
    const b = pairKey('t:c:1', 't:d:1');
    const state = togglePair(togglePair(new Set(), a), b);
    expect(state.has(a)).toBe(true);
    expect(state.has(b)).toBe(true);
  });
});

describe('marksByNote', () => {
  const pairs = [pair('n1', 'n2', 0.9), pair('n3', 'n4', 0.8), pair('n1', 'n5', 0.7)];

  it('체크가 없으면 표시도 없다 — AI 가 미리 묶어 두지 않는다', () => {
    expect(marksByNote(pairs, new Set()).size).toBe(0);
  });

  it('체크한 짝의 두 카드에 같은 번호가 붙는다', () => {
    const checked = new Set([pairKey('n1', 'n2')]);
    const marks = marksByNote(pairs, checked);
    expect(marks.get('n1')).toEqual([1]);
    expect(marks.get('n2')).toEqual([1]);
  });

  it('번호는 누른 순서가 아니라 목록에서의 자리다', () => {
    // 두 번째 짝만 체크 → 「2」. 첫 체크라고 「1」이 되면 안 된다.
    const marks = marksByNote(pairs, new Set([pairKey('n3', 'n4')]));
    expect(marks.get('n3')).toEqual([2]);
    expect(marks.get('n4')).toEqual([2]);
  });

  it('앞 짝을 풀어도 뒤 짝의 번호가 밀리지 않는다', () => {
    const both = new Set([pairKey('n1', 'n2'), pairKey('n3', 'n4')]);
    expect(marksByNote(pairs, both).get('n3')).toEqual([2]);
    const onlySecond = togglePair(both, pairKey('n1', 'n2'));
    expect(marksByNote(pairs, onlySecond).get('n3')).toEqual([2]);
    expect(marksByNote(pairs, onlySecond).has('n1')).toBe(false);
  });

  it('한 카드가 여러 짝에 들면 번호가 오름차순으로 쌓인다', () => {
    const checked = new Set([pairKey('n1', 'n5'), pairKey('n1', 'n2')]);
    expect(marksByNote(pairs, checked).get('n1')).toEqual([1, 3]);
  });

  it('체크해도 카드는 사라지지 않는다 — 표시 대상 카드 수가 짝에 든 카드 수와 같다', () => {
    const checked = new Set([pairKey('n1', 'n2'), pairKey('n3', 'n4'), pairKey('n1', 'n5')]);
    const marks = marksByNote(pairs, checked);
    // 짝 3개에 등장하는 서로 다른 카드는 n1·n2·n3·n4·n5 = 5장. 하나도 합쳐지지 않는다.
    expect([...marks.keys()].sort()).toEqual(['n1', 'n2', 'n3', 'n4', 'n5']);
  });

  it('목록에 없는 짝의 체크는 무시한다 (꼭지를 옮겨도 남의 표시가 새지 않는다)', () => {
    expect(marksByNote(pairs, new Set([pairKey('zz1', 'zz2')])).size).toBe(0);
  });

  it('빈 목록도 견딘다', () => {
    expect(marksByNote([], new Set(['a|b'])).size).toBe(0);
  });
});

describe('checkedPairCount', () => {
  const pairs = [pair('n1', 'n2'), pair('n3', 'n4')];

  it('체크한 짝만 센다', () => {
    expect(checkedPairCount(pairs, new Set())).toBe(0);
    expect(checkedPairCount(pairs, new Set([pairKey('n1', 'n2')]))).toBe(1);
    expect(checkedPairCount(pairs, new Set([pairKey('n1', 'n2'), pairKey('n3', 'n4')]))).toBe(2);
  });

  it('목록 밖의 체크는 세지 않는다', () => {
    expect(checkedPairCount(pairs, new Set([pairKey('zz', 'yy')]))).toBe(0);
  });
});
