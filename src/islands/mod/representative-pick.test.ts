import { describe, expect, it } from 'vitest';
import {
  REPRESENTATIVE_ACTOR_KINDS,
  RepresentativePickError,
  emptyRepresentativeState,
  groupMembers,
  pickHistory,
  pickRepresentative,
  representativeOf,
  representativeStateFromGroups,
  type RepresentativeActor,
} from './representative-pick';

/** 카드 id 는 실제 규격(`꼭지:조:순번`)을 흉내 낸다. */
const A = 'k1:t01:1';
const B = 'k1:t03:1';
const C = 'k1:t07:2';
const OUTSIDE = 'k1:t09:1';

const GROUP = 'pair-1';

function state() {
  return representativeStateFromGroups([[GROUP, [A, B, C]]]);
}

const citizen: RepresentativeActor = {
  kind: 'citizen',
  label: '1분과 3조',
  at: '2026-08-29T16:25:00+09:00',
};

const moderatorWithCitizens: RepresentativeActor = {
  kind: 'moderator',
  label: '총괄모더레이터 김○○',
  at: '2026-08-29T16:26:00+09:00',
  citizenConfirmed: true,
};

describe('REPRESENTATIVE_ACTOR_KINDS', () => {
  it('시민과 모더레이터 두 종류를 구분한다', () => {
    expect([...REPRESENTATIVE_ACTOR_KINDS]).toEqual(['citizen', 'moderator']);
  });
});

describe('pickRepresentative — 누가 골랐는지', () => {
  it('actor 가 없으면 예외를 던진다', () => {
    expect(() =>
      pickRepresentative(state(), GROUP, A, undefined as unknown as RepresentativeActor),
    ).toThrow(RepresentativePickError);
    try {
      pickRepresentative(state(), GROUP, A, null as unknown as RepresentativeActor);
    } catch (error) {
      expect((error as RepresentativePickError).reason).toBe('actor-required');
    }
  });

  it('이름이 비어 있으면 예외를 던진다 — 이력에 「누가」가 안 남는다', () => {
    try {
      pickRepresentative(state(), GROUP, A, { ...citizen, label: '   ' });
      throw new Error('예외가 나지 않았다');
    } catch (error) {
      expect((error as RepresentativePickError).reason).toBe('actor-label-required');
    }
  });

  it('★ 모더레이터 단독 지정은 예외다 — 「좋은 의견 선정」 금지', () => {
    try {
      pickRepresentative(state(), GROUP, A, {
        kind: 'moderator',
        label: '총괄모더레이터 김○○',
        at: '2026-08-29T16:26:00+09:00',
      });
      throw new Error('예외가 나지 않았다');
    } catch (error) {
      expect((error as RepresentativePickError).reason).toBe('moderator-alone');
    }
  });

  it('citizenConfirmed 가 false 여도 모더레이터 단독이다', () => {
    expect(() =>
      pickRepresentative(state(), GROUP, A, { ...moderatorWithCitizens, citizenConfirmed: false }),
    ).toThrow(RepresentativePickError);
  });

  it('시민이 고르면 지정된다', () => {
    const next = pickRepresentative(state(), GROUP, A, citizen);
    expect(representativeOf(next, GROUP)).toBe(A);
    expect(pickHistory(next, GROUP)[0].citizenConfirmed).toBe(true);
  });

  it('모더레이터도 시민이 골랐음을 확인했으면 대신 기록할 수 있다', () => {
    const next = pickRepresentative(state(), GROUP, B, moderatorWithCitizens);
    expect(representativeOf(next, GROUP)).toBe(B);
    expect(pickHistory(next, GROUP)[0].actorKind).toBe('moderator');
  });
});

describe('pickRepresentative — 대표는 묶음 안에서만', () => {
  it('묶음 밖의 카드는 예외다', () => {
    try {
      pickRepresentative(state(), GROUP, OUTSIDE, citizen);
      throw new Error('예외가 나지 않았다');
    } catch (error) {
      expect((error as RepresentativePickError).reason).toBe('outside-group');
    }
  });

  it('없는 묶음은 예외다', () => {
    try {
      pickRepresentative(state(), 'pair-없음', A, citizen);
      throw new Error('예외가 나지 않았다');
    } catch (error) {
      expect((error as RepresentativePickError).reason).toBe('unknown-group');
    }
  });

  it('빈 묶음에서는 어떤 카드도 대표가 될 수 없다', () => {
    const empty = representativeStateFromGroups([['pair-빈', []]]);
    expect(() => pickRepresentative(empty, 'pair-빈', A, citizen)).toThrow(RepresentativePickError);
  });

  it('아직 아무도 안 골랐으면 대표는 null 이다', () => {
    expect(representativeOf(state(), GROUP)).toBeNull();
    expect(representativeOf(emptyRepresentativeState(), GROUP)).toBeNull();
  });
});

describe('pickRepresentative — 이력', () => {
  it('덮어써도 이전 기록이 남고, 현재 대표는 마지막 것이다', () => {
    const first = pickRepresentative(state(), GROUP, A, citizen);
    const second = pickRepresentative(first, GROUP, C, {
      ...moderatorWithCitizens,
      at: '2026-08-29T16:30:00+09:00',
    });

    const history = pickHistory(second, GROUP);
    expect(history).toHaveLength(2);
    expect(history.map((entry) => entry.noteId)).toEqual([A, C]);
    expect(history.map((entry) => entry.at)).toEqual([
      '2026-08-29T16:25:00+09:00',
      '2026-08-29T16:30:00+09:00',
    ]);
    expect(representativeOf(second, GROUP)).toBe(C);
  });

  it('다른 묶음의 이력은 섞이지 않는다', () => {
    const two = representativeStateFromGroups([
      [GROUP, [A, B]],
      ['pair-2', [C]],
    ]);
    const next = pickRepresentative(pickRepresentative(two, GROUP, A, citizen), 'pair-2', C, citizen);
    expect(pickHistory(next, GROUP)).toHaveLength(1);
    expect(pickHistory(next)).toHaveLength(2);
    expect(representativeOf(next, GROUP)).toBe(A);
    expect(representativeOf(next, 'pair-2')).toBe(C);
  });

  it('입력 상태를 건드리지 않는다', () => {
    const before = state();
    pickRepresentative(before, GROUP, A, citizen);
    expect(before.history).toHaveLength(0);
    expect(representativeOf(before, GROUP)).toBeNull();
  });
});

describe('pickRepresentative — 카드 수 불변', () => {
  it('★ 대표를 바꿔도 묶음의 카드가 그대로다(수·목록 모두)', () => {
    const before = state();
    const after = pickRepresentative(
      pickRepresentative(before, GROUP, A, citizen),
      GROUP,
      B,
      citizen,
    );
    expect(groupMembers(after, GROUP)).toHaveLength(3);
    expect([...groupMembers(after, GROUP)].sort()).toEqual([...groupMembers(before, GROUP)].sort());
  });

  it('대표로 지목되지 않은 카드도 묶음에 그대로 있다', () => {
    const after = pickRepresentative(state(), GROUP, A, citizen);
    expect(groupMembers(after, GROUP)).toContain(B);
    expect(groupMembers(after, GROUP)).toContain(C);
  });
});
