import { describe, expect, it } from 'vitest';
import type { SimilarPair } from './note-similarity';
import { marksByNote, pairKey } from './pair-marks';
import {
  describePickFailure,
  groupsFromCheckedPairs,
  groupsMapOf,
  pickFailureGuidance,
  pickedGroupCount,
  representativeNoteIds,
} from './representative-groups';
import {
  pickRepresentative,
  representativeStateFromGroups,
  type RepresentativeActor,
  type RepresentativePickErrorReason,
} from './representative-pick';

function pair(aId: string, bId: string, score = 0.5): SimilarPair {
  return { aId, bId, score, sharedTerms: ['버스'] };
}

/** 시민이 골랐고 모더레이터가 대신 기록한 사건 — 화면이 실제로 보내는 모양 그대로. */
function citizenPick(label = '1분과 시민들'): RepresentativeActor {
  return { kind: 'moderator', label, at: '2026-08-29T16:30:00.000Z', citizenConfirmed: true };
}

const PAIRS: SimilarPair[] = [
  pair('k1:t01:1', 'k1:t03:1', 0.9), // 1
  pair('k1:t02:1', 'k1:t05:2', 0.7), // 2
  pair('k1:t01:1', 'k1:t07:1', 0.5), // 3 — t01:1 이 두 짝에 든다
];

describe('groupsFromCheckedPairs', () => {
  it('체크 안 하면 묶음이 없다 — AI 가 미리 묶지 않는다', () => {
    expect(groupsFromCheckedPairs(PAIRS, new Set())).toEqual([]);
  });

  it('체크한 짝만 묶음이 된다', () => {
    const checked = new Set([pairKey('k1:t02:1', 'k1:t05:2')]);
    const groups = groupsFromCheckedPairs(PAIRS, checked);
    expect(groups).toHaveLength(1);
    expect(groups[0].memberIds).toEqual(['k1:t02:1', 'k1:t05:2']);
  });

  it('묶음은 언제나 카드 두 장이다 — 짝을 합쳐 큰 묶음을 만들지 않는다', () => {
    // t01:1 이 1번·3번 짝에 함께 들지만 둘은 별개 묶음으로 남는다.
    const checked = new Set([
      pairKey('k1:t01:1', 'k1:t03:1'),
      pairKey('k1:t01:1', 'k1:t07:1'),
    ]);
    const groups = groupsFromCheckedPairs(PAIRS, checked);
    expect(groups).toHaveLength(2);
    for (const group of groups) expect(group.memberIds).toHaveLength(2);
    // 셋이 한 덩어리로 뭉치지 않았다.
    expect(groups.flatMap((g) => g.memberIds)).toHaveLength(4);
  });

  it('★번호는 similarPairs 목록에서의 자리다 — 체크를 풀어도 안 밀린다', () => {
    const both = groupsFromCheckedPairs(
      PAIRS,
      new Set([pairKey('k1:t01:1', 'k1:t03:1'), pairKey('k1:t01:1', 'k1:t07:1')]),
    );
    expect(both.map((g) => g.ordinal)).toEqual([1, 3]);

    // 1번을 풀어도 나머지는 여전히 3번이다(누른 순서로 매기면 여기서 1로 밀린다).
    const one = groupsFromCheckedPairs(PAIRS, new Set([pairKey('k1:t01:1', 'k1:t07:1')]));
    expect(one.map((g) => g.ordinal)).toEqual([3]);
  });

  it('★번호가 카드에 붙는 「닮은 짝 N」(marksByNote)과 같은 것을 가리킨다', () => {
    const checked = new Set([pairKey('k1:t01:1', 'k1:t07:1')]);
    const groups = groupsFromCheckedPairs(PAIRS, checked);
    const marks = marksByNote(PAIRS, checked);
    expect(groups[0].ordinal).toBe(3);
    expect(marks.get('k1:t01:1')).toEqual([3]);
    expect(marks.get('k1:t07:1')).toEqual([3]);
  });

  it('순서는 pairs 순서 그대로다(점수 내림차순 = 짝 패널과 같은 차례)', () => {
    const groups = groupsFromCheckedPairs(
      PAIRS,
      new Set(PAIRS.map((p) => pairKey(p.aId, p.bId))),
    );
    expect(groups.map((g) => g.ordinal)).toEqual([1, 2, 3]);
  });
});

describe('groupsMapOf', () => {
  it('묶음 id → 카드 목록 맵을 만든다', () => {
    const groups = groupsFromCheckedPairs(PAIRS, new Set([pairKey('k1:t01:1', 'k1:t03:1')]));
    const map = groupsMapOf(groups);
    expect(map.size).toBe(1);
    expect(map.get(groups[0].groupId)).toEqual(['k1:t01:1', 'k1:t03:1']);
  });

  it('빈 묶음 목록이면 빈 맵이다', () => {
    expect(groupsMapOf([]).size).toBe(0);
  });
});

describe('representativeNoteIds', () => {
  const groups = groupsFromCheckedPairs(
    PAIRS,
    new Set([pairKey('k1:t01:1', 'k1:t03:1'), pairKey('k1:t01:1', 'k1:t07:1')]),
  );
  const base = representativeStateFromGroups(groupsMapOf(groups));

  it('아무도 안 골랐으면 비어 있다', () => {
    expect(representativeNoteIds(base, groups).size).toBe(0);
    expect(pickedGroupCount(base, groups)).toBe(0);
  });

  it('지목한 카드에 그 묶음 번호가 붙는다', () => {
    const next = pickRepresentative(base, groups[0].groupId, 'k1:t03:1', citizenPick());
    const marks = representativeNoteIds(next, groups);
    expect(marks.get('k1:t03:1')).toEqual([1]);
    expect(pickedGroupCount(next, groups)).toBe(1);
  });

  it('★대표가 아닌 카드도 묶음에 그대로 남는다 — 대표가 나머지를 대체하지 않는다', () => {
    const next = pickRepresentative(base, groups[0].groupId, 'k1:t03:1', citizenPick());
    // 맵에 없을 뿐, 묶음의 카드 목록은 두 장 그대로다.
    expect(representativeNoteIds(next, groups).has('k1:t01:1')).toBe(false);
    expect(next.groups.get(groups[0].groupId)).toEqual(['k1:t01:1', 'k1:t03:1']);
  });

  it('한 카드가 두 묶음의 대표면 번호가 둘 다 붙는다(오름차순)', () => {
    let state = pickRepresentative(base, groups[0].groupId, 'k1:t01:1', citizenPick());
    state = pickRepresentative(state, groups[1].groupId, 'k1:t01:1', citizenPick());
    expect(representativeNoteIds(state, groups).get('k1:t01:1')).toEqual([1, 3]);
    expect(pickedGroupCount(state, groups)).toBe(2);
  });

  it('묶음 목록에서 빠진 묶음의 지목은 표시되지 않는다(이력은 남는다)', () => {
    const state = pickRepresentative(base, groups[1].groupId, 'k1:t07:1', citizenPick());
    // 3번 짝의 체크를 푼 상태 = 묶음 목록에 1번만 남은 상태
    const shrunk = groups.slice(0, 1);
    expect(representativeNoteIds(state, shrunk).size).toBe(0);
    expect(state.history).toHaveLength(1);
  });

  it('카드 수는 어떤 지목에도 변하지 않는다', () => {
    const before = groups.flatMap((g) => g.memberIds).length;
    let state = pickRepresentative(base, groups[0].groupId, 'k1:t01:1', citizenPick());
    state = pickRepresentative(state, groups[0].groupId, 'k1:t03:1', citizenPick());
    const after = groups.flatMap((g) => [...(state.groups.get(g.groupId) ?? [])]).length;
    expect(after).toBe(before);
  });
});

describe('pickFailureGuidance / describePickFailure', () => {
  it('★moderator-alone 안내는 「왜 안 되는지」까지 적는다 — 이 화면의 요점이다', () => {
    const text = pickFailureGuidance('moderator-alone');
    expect(text).toContain('모더레이터 단독');
    expect(text).toContain('좋은 의견 선정');
  });

  it('이유마다 다른 안내를 낸다 — 한 줄로 뭉개지 않는다', () => {
    const reasons: RepresentativePickErrorReason[] = [
      'actor-label-required',
      'moderator-alone',
      'unknown-group',
      'outside-group',
    ];
    const texts = reasons.map(pickFailureGuidance);
    expect(new Set(texts).size).toBe(reasons.length);
  });

  it('실제 지목 실패를 그대로 안내로 옮긴다(예외를 삼키지 않는다)', () => {
    const groups = groupsFromCheckedPairs(PAIRS, new Set([pairKey('k1:t01:1', 'k1:t03:1')]));
    const state = representativeStateFromGroups(groupsMapOf(groups));
    try {
      pickRepresentative(state, groups[0].groupId, 'k1:t03:1', {
        kind: 'moderator',
        label: '진행자',
        at: '2026-08-29T16:30:00.000Z',
        // citizenConfirmed 없음 = 모더레이터 단독
      });
      throw new Error('예외가 나지 않았다');
    } catch (error) {
      expect(describePickFailure(error)).toBe(pickFailureGuidance('moderator-alone'));
    }
  });

  it('묶음 밖 카드를 대표로 세우려 하면 그 이유가 나온다', () => {
    const groups = groupsFromCheckedPairs(PAIRS, new Set([pairKey('k1:t01:1', 'k1:t03:1')]));
    const state = representativeStateFromGroups(groupsMapOf(groups));
    try {
      pickRepresentative(state, groups[0].groupId, 'k1:t09:1', citizenPick());
      throw new Error('예외가 나지 않았다');
    } catch (error) {
      expect(describePickFailure(error)).toBe(pickFailureGuidance('outside-group'));
    }
  });

  it('알 수 없는 오류도 삼키지 않는다', () => {
    expect(describePickFailure(new Error('무언가 잘못됨'))).toBe('무언가 잘못됨');
    expect(describePickFailure(null)).toBe('대표를 지정하지 못했습니다.');
  });
});
