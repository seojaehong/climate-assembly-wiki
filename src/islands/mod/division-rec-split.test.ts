import { describe, expect, it } from 'vitest';
import { cardRecList, checkRecEdits, recLine, type RecEditRow } from './division-rec-edits';
import type { RecsDivision } from './division-vote-logic';

// 1-9-1 카드(세부 1~8)에서 1-9-1-8 이 세 줄 → 1-9-1-8, 1-9-1-9(나뉨), 1-9-1-10(나뉨) · 번호 없는 추가는 그 뒤 번호
const source = {
  division: 1,
  agenda: 'x',
  topics: [{ no: '1-9', name: 't', cards: [{ no: '1-9-1', title: '카드', recs: Array.from({ length: 8 }, (_, i) => ({ no: `1-9-1-${i + 1}`, text: `원문${i + 1}` })) }] }],
} as unknown as RecsDivision;

const row = (line: number, no: string | null, action: string, text: string): RecEditRow =>
  ({ line, division: 1, divisionText: '1분과', rawAction: action, edit: { no, card: '1-9-1', action: action || '유지', text, target: '', note: '' } }) as unknown as RecEditRow;

describe('같은 번호 여러 줄 = 나뉨, 카드 끝 번호 다음 새 번호(휴대폰·출력물 규칙)', () => {
  const chk = checkRecEdits(source, [row(2, '1-9-1-8', '수정', '첫 문구'), row(3, '1-9-1-8', '수정', '둘째 문구'), row(4, '1-9-1-8', '', '셋째 문구'), row(5, null, '추가', '새 권고')]);
  it('오류 없이 나뉨 2줄 + 추가 1줄', () => {
    expect(chk.errors).toEqual([]);
    expect(chk.edits.filter((e) => e.from === '1-9-1-8')).toHaveLength(2);
  });
  it('번호 1-9-1-9, 1-9-1-10(나뉨), 1-9-1-11(추가)', () => {
    const list = cardRecList(source, chk.edits, '1-9-1');
    const added = list.filter((d) => d.mark === 'added');
    expect(added.map((d) => d.no)).toEqual(['1-9-1-9', '1-9-1-10', '1-9-1-11']);
    expect(recLine(added[0])).toBe('1-9-1-9 (1-9-1-8에서 나뉨) 둘째 문구');
    expect(recLine(added[2])).toBe('1-9-1-11 (추가) 새 권고');
    expect(list.find((d) => d.no === '1-9-1-8')?.text).toBe('첫 문구');
  });
  it('문구 없는 둘째 줄은 오류', () => {
    const bad = checkRecEdits(source, [row(2, '1-9-1-8', '수정', 'a'), row(3, '1-9-1-8', '', '')]);
    expect(bad.errors.length).toBe(1);
  });
});
