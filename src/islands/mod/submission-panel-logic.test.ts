import { describe, expect, it } from 'vitest';
import {
  FINALIZE_CONFIRM_MESSAGE,
  MAX_SUBMISSION_ROWS,
  addRow,
  canFinalize,
  emptyRow,
  isDirty,
  isEditable,
  moveRow,
  removeRow,
  rowsFromItems,
  submissionBadge,
  toSaveItems,
  type EditorRow,
  pickRestoredRows,
} from './submission-panel-logic';
import type { SubmissionItem } from '../../lib/deliberation';

const row = (content: string, rationale = ''): EditorRow => ({ content, rationale });

describe('isEditable — 잠금 판정', () => {
  it('제출물 없음(null)·draft·reopened는 편집 가능', () => {
    expect(isEditable(null)).toBe(true);
    expect(isEditable('draft')).toBe(true);
    expect(isEditable('reopened')).toBe(true);
  });

  it('final(잠금)·archived는 편집 불가', () => {
    expect(isEditable('final')).toBe(false);
    expect(isEditable('archived')).toBe(false);
  });
});

describe('rowsFromItems — 서버 항목 → 편집 행', () => {
  it('ordinal 순으로 정렬하고 rationale null은 빈 문자열로 바꾼다', () => {
    const items: SubmissionItem[] = [
      { ordinal: 2, kind: 'core', content: '두 번째', rationale: null },
      { ordinal: 1, kind: 'core', content: '첫 번째', rationale: '근거' },
    ];
    expect(rowsFromItems(items)).toEqual([row('첫 번째', '근거'), row('두 번째')]);
  });

  it('항목이 없으면 빈 행 1개로 시작한다', () => {
    expect(rowsFromItems([])).toEqual([emptyRow()]);
  });
});

describe('toSaveItems — 저장 페이로드', () => {
  it('빈 내용 행을 버리고 ordinal을 1부터 다시 매긴다', () => {
    const items = toSaveItems([row('  '), row(' 의견 A ', ' 근거 A '), row(''), row('의견 B')]);
    expect(items).toEqual([
      { ordinal: 1, kind: 'core', content: '의견 A', rationale: '근거 A' },
      { ordinal: 2, kind: 'core', content: '의견 B', rationale: null },
    ]);
  });

  it('빈 rationale은 null로 보낸다', () => {
    expect(toSaveItems([row('의견', '   ')])[0].rationale).toBeNull();
  });

  it('전부 빈 행이면 빈 배열 (저장은 가능하나 최종 제출은 불가)', () => {
    expect(toSaveItems([emptyRow(), emptyRow()])).toEqual([]);
  });
});

describe('canFinalize — 최종 제출 게이트', () => {
  it('편집 가능 + 내용 1건 이상이어야 한다', () => {
    expect(canFinalize([row('의견')], null)).toBe(true);
    expect(canFinalize([row('의견')], 'draft')).toBe(true);
    expect(canFinalize([row('의견')], 'reopened')).toBe(true);
  });

  it('빈 제출은 막는다 (RPC의 cannot finalize empty와 동일)', () => {
    expect(canFinalize([emptyRow()], 'draft')).toBe(false);
    expect(canFinalize([row('   ')], 'draft')).toBe(false);
  });

  it('final 상태에서는 내용이 있어도 막는다', () => {
    expect(canFinalize([row('의견')], 'final')).toBe(false);
  });
});

describe('행 조작', () => {
  it('addRow — 빈 행을 뒤에 붙이고 상한(30)에서 멈춘다', () => {
    expect(addRow([row('a')])).toHaveLength(2);
    const full = Array.from({ length: MAX_SUBMISSION_ROWS }, (_, i) => row(`r${i}`));
    expect(addRow(full)).toBe(full);
  });

  it('removeRow — 지정 행을 지우고, 마지막 한 행은 지우는 대신 비운다', () => {
    expect(removeRow([row('a'), row('b')], 0)).toEqual([row('b')]);
    expect(removeRow([row('a')], 0)).toEqual([emptyRow()]);
  });

  it('removeRow — 범위 밖 인덱스는 무시한다', () => {
    const rows = [row('a'), row('b')];
    expect(removeRow(rows, -1)).toBe(rows);
    expect(removeRow(rows, 2)).toBe(rows);
  });

  it('moveRow — 위/아래로 자리를 바꾼다', () => {
    expect(moveRow([row('a'), row('b'), row('c')], 1, -1)).toEqual([row('b'), row('a'), row('c')]);
    expect(moveRow([row('a'), row('b'), row('c')], 1, 1)).toEqual([row('a'), row('c'), row('b')]);
  });

  it('moveRow — 경계 밖 이동은 그대로 둔다', () => {
    const rows = [row('a'), row('b')];
    expect(moveRow(rows, 0, -1)).toBe(rows);
    expect(moveRow(rows, 1, 1)).toBe(rows);
  });

  it('행 조작은 원본 배열을 변형하지 않는다', () => {
    const rows = [row('a'), row('b')];
    moveRow(rows, 0, 1);
    removeRow(rows, 0);
    addRow(rows);
    expect(rows).toEqual([row('a'), row('b')]);
  });
});

describe('isDirty — 저장 전 이탈 방어의 판정 기준', () => {
  it('내용·근거가 같으면 깨끗하다', () => {
    expect(isDirty([row('a', 'r')], [row('a', 'r')])).toBe(false);
  });

  it('내용 또는 근거가 다르면 더럽다', () => {
    expect(isDirty([row('a')], [row('b')])).toBe(true);
    expect(isDirty([row('a', 'x')], [row('a', 'y')])).toBe(true);
  });

  it('행 수가 다르면 더럽다', () => {
    expect(isDirty([row('a'), emptyRow()], [row('a')])).toBe(true);
  });
});

describe('submissionBadge — 상태 배지', () => {
  it('final은 잠금 배지', () => {
    expect(submissionBadge('final')).toEqual({ label: '최종 제출됨 · 잠금', tone: 'locked' });
  });

  it('reopened는 재오픈 배지', () => {
    expect(submissionBadge('reopened')).toEqual({ label: '재오픈됨 · 다시 편집 가능', tone: 'reopened' });
  });

  it('draft·없음은 배지를 달지 않는다', () => {
    expect(submissionBadge('draft')).toBeNull();
    expect(submissionBadge(null)).toBeNull();
  });
});

describe('확인 문구', () => {
  it('최종 제출 confirm은 본부(HQ)만 다시 열 수 있음을 못박는다', () => {
    expect(FINALIZE_CONFIRM_MESSAGE).toContain('본부(HQ)만 다시 열 수 있습니다');
  });
});

describe('pickRestoredRows — 탭을 옮겼다 와도 미저장분이 남는다', () => {
  const server: EditorRow[] = [{ content: '이미 저장한 줄', rationale: '' }];

  it('보관분이 서버와 다르면 그것을 되살린다', () => {
    const draft: EditorRow[] = [
      { content: '이미 저장한 줄', rationale: '' },
      { content: '아직 저장 안 한 줄', rationale: '' },
    ];
    expect(pickRestoredRows(JSON.stringify(draft), server)).toEqual(draft);
  });

  it('저장을 마쳐 서버와 같아지면 되살리지 않는다 — 낡은 초안이 되돌아오면 더 위험하다', () => {
    expect(pickRestoredRows(JSON.stringify(server), server)).toBeNull();
  });

  it('보관분이 없으면 서버 내용으로 연다', () => {
    expect(pickRestoredRows(null, server)).toBeNull();
  });

  it('깨진 값·빈 배열·모양이 다른 값은 무시한다', () => {
    expect(pickRestoredRows('{not json', server)).toBeNull();
    expect(pickRestoredRows('[]', server)).toBeNull();
    expect(pickRestoredRows('"문자열"', server)).toBeNull();
    expect(pickRestoredRows('[{"엉뚱":1}]', server)).toBeNull();
  });
});
