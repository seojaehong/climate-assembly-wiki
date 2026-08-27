import { describe, expect, it } from 'vitest';
import {
  assignCategory,
  categoryOf,
  categoryOfCluster,
  emptyCategoryState,
  FOUR_CATEGORIES,
  FOUR_CATEGORY_LABELS,
  countsByCategory,
  preservationInvariant,
  preservationTone,
  toggleCategory,
  unassignCategory,
  unassignedCount,
  type CategoryState,
} from './four-category';

const notes = [
  { id: 'k1:t1:1' },
  { id: 'k1:t1:2' },
  { id: 'k1:t2:1' },
  { id: 'k1:t3:1' },
];

/** 배정을 여러 번 한 뒤에도 카드 목록 자체는 손대지 않았음을 확인하기 위한 사본. */
const notesSnapshot = notes.map((note) => note.id).join('|');

describe('FOUR_CATEGORIES', () => {
  it('네 범주뿐이고 순서는 공통·차이·갈등·질문으로 고정된다', () => {
    expect([...FOUR_CATEGORIES]).toEqual(['common', 'difference', 'conflict', 'question']);
    expect(FOUR_CATEGORIES).toHaveLength(4);
  });

  it('한국어 라벨이 공통·차이·갈등·질문이다', () => {
    expect(FOUR_CATEGORIES.map((c) => FOUR_CATEGORY_LABELS[c])).toEqual([
      '공통',
      '차이',
      '갈등',
      '질문',
    ]);
  });
});

describe('assignCategory', () => {
  it('배정해도 카드 수가 변하지 않는다', () => {
    let state: CategoryState = emptyCategoryState();
    for (const note of notes) state = assignCategory(state, note.id, 'common');
    expect(notes).toHaveLength(4);
    expect(notes.map((n) => n.id).join('|')).toBe(notesSnapshot);
    expect(preservationInvariant(notes, state).originalCount).toBe(4);
  });

  it('입력 상태를 건드리지 않고 새 맵을 돌려준다', () => {
    const before = emptyCategoryState();
    const after = assignCategory(before, 'k1:t1:1', 'question');
    expect(before.size).toBe(0);
    expect(after.size).toBe(1);
    expect(after).not.toBe(before);
  });

  it('재배정하면 덮어쓰며 한 카드가 두 범주에 겹치지 않는다', () => {
    let state: CategoryState = emptyCategoryState();
    state = assignCategory(state, 'k1:t1:1', 'common');
    state = assignCategory(state, 'k1:t1:1', 'conflict');
    expect(state.size).toBe(1);
    expect(categoryOf(state, 'k1:t1:1')).toBe('conflict');
    const values = [...state.values()].filter((v) => v === 'common');
    expect(values).toHaveLength(0);
  });

  it('배정 안 된 카드는 categoryOf 가 null', () => {
    expect(categoryOf(emptyCategoryState(), 'k1:t9:1')).toBeNull();
  });
});

describe('unassignCategory', () => {
  it('되돌리면 미배정으로 돌아갈 뿐 카드는 남는다', () => {
    let state: CategoryState = assignCategory(emptyCategoryState(), 'k1:t1:1', 'common');
    state = unassignCategory(state, 'k1:t1:1');
    expect(categoryOf(state, 'k1:t1:1')).toBeNull();
    expect(preservationInvariant(notes, state).originalCount).toBe(4);
    expect(unassignedCount(notes, state)).toBe(4);
  });

  it('배정된 적 없는 카드를 되돌려도 아무 일도 없다', () => {
    const state = emptyCategoryState();
    expect(unassignCategory(state, 'k1:t9:1')).toBe(state);
  });
});

describe('unassignedCount', () => {
  it('아직 어느 범주에도 없는 카드를 센다', () => {
    let state: CategoryState = emptyCategoryState();
    expect(unassignedCount(notes, state)).toBe(4);
    state = assignCategory(state, 'k1:t1:1', 'common');
    expect(unassignedCount(notes, state)).toBe(3);
    state = assignCategory(state, 'k1:t2:1', 'question');
    expect(unassignedCount(notes, state)).toBe(2);
  });

  it('재배정은 미배정 수를 더 줄이지 않는다', () => {
    let state: CategoryState = assignCategory(emptyCategoryState(), 'k1:t1:1', 'common');
    state = assignCategory(state, 'k1:t1:1', 'difference');
    expect(unassignedCount(notes, state)).toBe(3);
  });

  it('빈 목록은 0', () => {
    expect(unassignedCount([], emptyCategoryState())).toBe(0);
  });
});

describe('preservationInvariant', () => {
  it('아무것도 배정하지 않아도 삭제 0장이다', () => {
    const report = preservationInvariant(notes, emptyCategoryState());
    expect(report).toEqual({
      originalCount: 4,
      assignedCount: 0,
      unassignedCount: 4,
      deletedCount: 0,
      ok: true,
    });
  });

  it('전부 배정해도 원문 수와 배정+미배정이 맞고 삭제 0장이다', () => {
    let state: CategoryState = emptyCategoryState();
    notes.forEach((note, index) => {
      state = assignCategory(state, note.id, FOUR_CATEGORIES[index % 4]);
    });
    const report = preservationInvariant(notes, state);
    expect(report.originalCount).toBe(4);
    expect(report.assignedCount).toBe(4);
    expect(report.unassignedCount).toBe(0);
    expect(report.deletedCount).toBe(0);
    expect(report.ok).toBe(true);
  });

  it('★ 목록 밖 카드 id 의 배정은 세지 않고 판정도 깨지 않는다 (꼭지 탭이 맵 하나를 공유한다)', () => {
    let state: CategoryState = assignCategory(emptyCategoryState(), 'k1:t1:1', 'common');
    state = assignCategory(state, 'k2:t1:1', 'question'); // 다른 꼭지의 카드
    const report = preservationInvariant(notes, state);
    expect(report.assignedCount).toBe(1);
    expect(report.unassignedCount).toBe(3);
    expect(report.deletedCount).toBe(0);
    expect(report.ok).toBe(true);
  });

  it('빈 보드도 삭제 0장으로 통과한다', () => {
    expect(preservationInvariant([], emptyCategoryState())).toEqual({
      originalCount: 0,
      assignedCount: 0,
      unassignedCount: 0,
      deletedCount: 0,
      ok: true,
    });
  });
});

describe('categoryOfCluster', () => {
  it('조가 2개 이상이면 공통', () => {
    expect(categoryOfCluster(['t1', 't2'])).toBe('common');
    expect(categoryOfCluster(['t1', 't2', 't3'])).toBe('common');
  });

  it('조가 1개면 차이', () => {
    expect(categoryOfCluster(['t1'])).toBe('difference');
  });

  it('★ 같은 조가 나눠 쓴 두 문장은 조가 하나이므로 차이다', () => {
    expect(categoryOfCluster(['t1', 't1'])).toBe('difference');
    expect(categoryOfCluster(['t1', 't1', 't1'])).toBe('difference');
  });

  it('중복이 섞여도 조 수만 센다', () => {
    expect(categoryOfCluster(['t1', 't1', 't2'])).toBe('common');
  });

  it('빈 묶음은 묶음이 아니므로 null', () => {
    expect(categoryOfCluster([])).toBeNull();
  });

  it('세기일 뿐이라 갈등·질문은 절대 나오지 않는다', () => {
    const results = [
      categoryOfCluster(['t1']),
      categoryOfCluster(['t1', 't2']),
      categoryOfCluster(['t1', 't2', 't3', 't4', 't5']),
    ];
    expect(results.every((r) => r === 'common' || r === 'difference')).toBe(true);
  });
});

describe('toggleCategory', () => {
  it('빈 상태에서 누르면 배정된다', () => {
    const next = toggleCategory(emptyCategoryState(), 'k1:t1:1', 'common');
    expect(categoryOf(next, 'k1:t1:1')).toBe('common');
  });

  it('같은 범주를 다시 누르면 해제된다 — 되돌릴 수 있어야 「잠정」이다', () => {
    const once = toggleCategory(emptyCategoryState(), 'k1:t1:1', 'conflict');
    const twice = toggleCategory(once, 'k1:t1:1', 'conflict');
    expect(categoryOf(twice, 'k1:t1:1')).toBeNull();
  });

  it('다른 범주를 누르면 갈아탄다 — 두 범주에 겹치지 않는다', () => {
    const once = toggleCategory(emptyCategoryState(), 'k1:t1:1', 'common');
    const moved = toggleCategory(once, 'k1:t1:1', 'question');
    expect(categoryOf(moved, 'k1:t1:1')).toBe('question');
    expect(moved.size).toBe(1);
  });

  it('토글해도 카드는 사라지지 않는다 — 해제는 미배정으로 돌아갈 뿐이다', () => {
    let state: CategoryState = emptyCategoryState();
    for (const note of notes) state = toggleCategory(state, note.id, 'common');
    for (const note of notes) state = toggleCategory(state, note.id, 'common');
    const report = preservationInvariant(notes, state);
    expect(report.originalCount).toBe(4);
    expect(report.assignedCount).toBe(0);
    expect(report.unassignedCount).toBe(4);
    expect(report.deletedCount).toBe(0);
    expect(notes.map((n) => n.id).join('|')).toBe(notesSnapshot);
  });

  it('입력 상태를 건드리지 않는다', () => {
    const before = assignCategory(emptyCategoryState(), 'k1:t1:1', 'common');
    toggleCategory(before, 'k1:t1:1', 'common');
    expect(categoryOf(before, 'k1:t1:1')).toBe('common');
  });
});

describe('countsByCategory', () => {
  it('아무것도 배정 안 하면 네 범주가 모두 0이고 키는 다 있다', () => {
    const counts = countsByCategory(notes, emptyCategoryState());
    expect(counts).toEqual({ common: 0, difference: 0, conflict: 0, question: 0 });
    expect(Object.keys(counts).sort()).toEqual([...FOUR_CATEGORIES].sort());
  });

  it('범주별로 센다', () => {
    let state: CategoryState = emptyCategoryState();
    state = assignCategory(state, 'k1:t1:1', 'common');
    state = assignCategory(state, 'k1:t1:2', 'common');
    state = assignCategory(state, 'k1:t2:1', 'question');
    const counts = countsByCategory(notes, state);
    expect(counts.common).toBe(2);
    expect(counts.question).toBe(1);
    expect(counts.difference).toBe(0);
    expect(counts.conflict).toBe(0);
  });

  it('★ 네 범주 합 + 미배정 = 원문 수 — 화면의 카운터가 어긋날 수 없다', () => {
    let state: CategoryState = emptyCategoryState();
    state = assignCategory(state, 'k1:t1:1', 'common');
    state = assignCategory(state, 'k1:t3:1', 'conflict');
    const counts = countsByCategory(notes, state);
    const sum = FOUR_CATEGORIES.reduce((acc, c) => acc + counts[c], 0);
    expect(sum + unassignedCount(notes, state)).toBe(notes.length);
  });

  it('목록 밖 카드의 배정은 세지 않는다 — 배정 맵은 꼭지 세 개를 함께 담는다', () => {
    const state = assignCategory(emptyCategoryState(), 'k2:t9:1', 'common');
    expect(countsByCategory(notes, state).common).toBe(0);
  });

  it('빈 보드에서도 네 범주가 0으로 나온다', () => {
    expect(countsByCategory([], emptyCategoryState())).toEqual({
      common: 0,
      difference: 0,
      conflict: 0,
      question: 0,
    });
  });
});

describe('preservationTone', () => {
  it('삭제 0장이면 ok', () => {
    expect(preservationTone(preservationInvariant(notes, emptyCategoryState()))).toBe('ok');
  });

  it('배정을 해도 ok 그대로다', () => {
    const state = assignCategory(emptyCategoryState(), 'k1:t1:1', 'common');
    expect(preservationTone(preservationInvariant(notes, state))).toBe('ok');
  });

  it('★ 삭제가 0이 아니면 danger — 자료구조상 일어날 수 없지만 화면은 경고할 줄 알아야 한다', () => {
    expect(
      preservationTone({
        originalCount: 4,
        assignedCount: 2,
        unassignedCount: 1,
        deletedCount: 1,
        ok: false,
      }),
    ).toBe('danger');
  });
});
