import { describe, expect, it } from 'vitest';
import type { HqSubmissionRow } from '../../lib/hq-submissions';
import { buildBoards, flattenNotes } from './hq-submission-board-logic';
import {
  ONTOLOGY_KINDS,
  ONTOLOGY_KIND_HINTS,
  ONTOLOGY_KIND_LABELS,
  assignKind,
  countsByKind,
  emptyKindState,
  kindOf,
  kindPreservation,
  toggleKind,
  unassignKind,
  unspecifiedCount,
  type KindState,
  type OntologyKind,
} from './ontology-kind';
import { CANVAS_ONTOLOGY_NODE_KINDS } from '../../../automation/canvas-ontology-bridge.mjs';
import fixtureRaw from '../../../automation/fixtures/0829-submissions.json';

/**
 * 이 파일이 지키는 한 문장 — **묶어도 카드 수는 줄지 않는다.**
 * 종류를 붙이는 것은 카드에 이름표 하나를 얹는 것이고, 이름표는 카드를 지우거나 옮기지 않는다.
 */

const notes = flattenNotes(buildBoards(fixtureRaw as HqSubmissionRow[])[0]);

/** 목록에 없는 id 를 만들 때 쓴다(꼭지 밖 배정이 오탐되지 않는지 보는 용도). */
const ALIEN_ID = 'k9:t99:9';

describe('종류 7종 — 원본 파이프라인과의 대조', () => {
  it('이름·개수가 canvas-ontology-bridge.mjs 의 CANVAS_ONTOLOGY_NODE_KINDS 와 같다', () => {
    // ★ 이 테스트가 US-013 AC 의 첫 줄이다. 둘 중 하나만 고치면 깨진다 — 그러라고 둔 것이다.
    // 화면에서 붙인 종류와 검수 큐의 종류가 다른 어휘를 쓰면 사람이 같은 카드를 두 번,
    // 서로 다른 말로 판정하게 된다.
    expect([...ONTOLOGY_KINDS]).toEqual([...CANVAS_ONTOLOGY_NODE_KINDS]);
  });

  it('7종이고 중복이 없다', () => {
    expect(ONTOLOGY_KINDS).toHaveLength(7);
    expect(new Set(ONTOLOGY_KINDS).size).toBe(7);
  });

  it('한국어 라벨이 쟁점·주장·제안·우려·조건·가치·근거 순이다', () => {
    // 원본 .mjs 의 KIND_KO 는 export 되지 않으므로 AC 의 낱말을 그대로 적어 대조한다.
    expect(ONTOLOGY_KINDS.map((kind) => ONTOLOGY_KIND_LABELS[kind])).toEqual([
      '쟁점',
      '주장',
      '제안',
      '우려',
      '조건',
      '가치',
      '근거',
    ]);
  });

  it('종류마다 뜻 한 줄이 있다 — 낱말만으로는 조건과 우려가 헷갈린다', () => {
    for (const kind of ONTOLOGY_KINDS) {
      expect(ONTOLOGY_KIND_HINTS[kind].length).toBeGreaterThan(4);
    }
    expect(new Set(Object.values(ONTOLOGY_KIND_HINTS)).size).toBe(7);
  });
});

describe('처음에는 전부 미지정', () => {
  it('빈 상태는 아무 카드에도 종류가 없다', () => {
    const state = emptyKindState();
    expect(state.size).toBe(0);
    for (const note of notes) expect(kindOf(state, note.id)).toBeNull();
  });

  it('AI 가 미리 정하지 않는다 — 미지정 수 = 원문 수', () => {
    expect(unspecifiedCount(notes, emptyKindState())).toBe(notes.length);
    expect(notes.length).toBeGreaterThan(0);
  });

  it('빈 상태의 종류별 수는 일곱 개가 다 0 이다', () => {
    const counts = countsByKind(notes, emptyKindState());
    expect(Object.keys(counts).sort()).toEqual([...ONTOLOGY_KINDS].sort());
    for (const kind of ONTOLOGY_KINDS) expect(counts[kind]).toBe(0);
  });
});

describe('붙이기 · 떼기 · 되돌리기', () => {
  it('붙인 종류가 그 카드에만 붙는다', () => {
    const state = assignKind(emptyKindState(), notes[0].id, 'Claim');
    expect(kindOf(state, notes[0].id)).toBe('Claim');
    expect(kindOf(state, notes[1].id)).toBeNull();
  });

  it('새 맵을 돌려준다 — 원래 상태는 그대로다(React 리렌더 요건)', () => {
    const before = emptyKindState();
    const after = assignKind(before, notes[0].id, 'Issue');
    expect(after).not.toBe(before);
    expect(before.size).toBe(0);
  });

  it('다른 종류를 붙이면 갈아탄다 — 한 카드가 두 종류를 갖지 않는다', () => {
    let state: KindState = assignKind(emptyKindState(), notes[0].id, 'Claim');
    state = assignKind(state, notes[0].id, 'Proposal');
    expect(kindOf(state, notes[0].id)).toBe('Proposal');
    expect(state.size).toBe(1);
  });

  it('같은 종류를 다시 누르면 떨어진다 — 선택은 되돌릴 수 있다', () => {
    let state: KindState = toggleKind(emptyKindState(), notes[0].id, 'Concern');
    expect(kindOf(state, notes[0].id)).toBe('Concern');
    state = toggleKind(state, notes[0].id, 'Concern');
    expect(kindOf(state, notes[0].id)).toBeNull();
  });

  it('다른 종류를 누르면 해제가 아니라 갈아타기다', () => {
    let state: KindState = toggleKind(emptyKindState(), notes[0].id, 'Concern');
    state = toggleKind(state, notes[0].id, 'Condition');
    expect(kindOf(state, notes[0].id)).toBe('Condition');
  });

  it('떼면 미지정으로 돌아갈 뿐 카드가 사라지지 않는다', () => {
    const state = unassignKind(assignKind(emptyKindState(), notes[0].id, 'Value'), notes[0].id);
    expect(state.size).toBe(0);
    expect(unspecifiedCount(notes, state)).toBe(notes.length);
  });

  it('안 붙은 카드를 떼면 같은 상태를 그대로 돌려준다', () => {
    const before = assignKind(emptyKindState(), notes[0].id, 'Value');
    expect(unassignKind(before, notes[1].id)).toBe(before);
  });
});

describe('카드 수 보존 — 이름표는 카드를 지우지 못한다', () => {
  it('전부 붙여도 원문 수가 그대로다', () => {
    let state: KindState = emptyKindState();
    notes.forEach((note, index) => {
      state = assignKind(state, note.id, ONTOLOGY_KINDS[index % ONTOLOGY_KINDS.length]);
    });
    const report = kindPreservation(notes, state);
    expect(report.originalCount).toBe(notes.length);
    expect(report.specifiedCount).toBe(notes.length);
    expect(report.unspecifiedCount).toBe(0);
    expect(report.deletedCount).toBe(0);
    expect(report.ok).toBe(true);
  });

  it('절반만 붙여도 종류 + 미지정 = 원문 수', () => {
    let state: KindState = emptyKindState();
    notes.slice(0, Math.floor(notes.length / 2)).forEach((note) => {
      state = assignKind(state, note.id, 'Claim');
    });
    const report = kindPreservation(notes, state);
    expect(report.specifiedCount + report.unspecifiedCount).toBe(report.originalCount);
    expect(report.deletedCount).toBe(0);
  });

  it('일곱 종류 합 + 미지정 = 원문 수', () => {
    let state: KindState = emptyKindState();
    notes.forEach((note, index) => {
      if (index % 3 !== 0) state = assignKind(state, note.id, ONTOLOGY_KINDS[index % 7]);
    });
    const counts = countsByKind(notes, state);
    const total = ONTOLOGY_KINDS.reduce((sum, kind) => sum + counts[kind], 0);
    expect(total + unspecifiedCount(notes, state)).toBe(notes.length);
  });

  it('카드 목록은 어떤 연산으로도 바뀌지 않는다', () => {
    const idsBefore = notes.map((note) => note.id);
    let state: KindState = emptyKindState();
    state = assignKind(state, notes[0].id, 'Evidence');
    state = toggleKind(state, notes[1].id, 'Issue');
    state = unassignKind(state, notes[0].id);
    expect(notes.map((note) => note.id)).toEqual(idsBefore);
  });
});

describe('목록 밖 카드 id 는 무시한다', () => {
  it('다른 꼭지의 배정이 「사라진 카드」로 오탐되지 않는다', () => {
    const state = assignKind(emptyKindState(), ALIEN_ID, 'Claim');
    const report = kindPreservation(notes, state);
    expect(report.originalCount).toBe(notes.length);
    expect(report.specifiedCount).toBe(0);
    expect(report.unspecifiedCount).toBe(notes.length);
    expect(report.deletedCount).toBe(0);
    expect(report.ok).toBe(true);
  });

  it('종류별 수에도 안 잡힌다', () => {
    const counts = countsByKind(notes, assignKind(emptyKindState(), ALIEN_ID, 'Claim'));
    expect(counts.Claim).toBe(0);
  });
});

describe('빈 목록', () => {
  it('카드가 없으면 전부 0 이고 ok 다', () => {
    const report = kindPreservation([], emptyKindState());
    expect(report).toEqual({
      originalCount: 0,
      specifiedCount: 0,
      unspecifiedCount: 0,
      deletedCount: 0,
      ok: true,
    });
  });
});

describe('꼭지 세 개를 맵 하나로 담는다', () => {
  it('카드 id 에 꼭지가 들어 있어 꼭지를 넘나들어도 충돌하지 않는다', () => {
    const boards = buildBoards(fixtureRaw as HqSubmissionRow[]);
    const first = flattenNotes(boards[0]);
    const second = flattenNotes(boards[1]);
    let state: KindState = assignKind(emptyKindState(), first[0].id, 'Claim');
    state = assignKind(state, second[0].id, 'Proposal');
    expect(kindPreservation(first, state).specifiedCount).toBe(1);
    expect(kindPreservation(second, state).specifiedCount).toBe(1);
    const allIds = new Set([...first, ...second].map((note) => note.id));
    expect(allIds.size).toBe(first.length + second.length);
  });
});

describe('종류 값은 저장용 ASCII 다', () => {
  it('식별자에 한국어가 없다 — 한국어는 라벨에만 있다', () => {
    for (const kind of ONTOLOGY_KINDS) {
      expect(kind).toMatch(/^[A-Z][a-z]+$/);
      const typed: OntologyKind = kind;
      expect(ONTOLOGY_KIND_LABELS[typed]).toMatch(/^[가-힣]+$/);
    }
  });
});
