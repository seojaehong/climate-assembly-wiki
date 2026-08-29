import { describe, expect, it } from 'vitest';
import {
  MAX_SUBMISSION_ROWS,
  splitPastedRows,
  type EditorRow,
} from './submission-panel-logic';

const row = (content: string): EditorRow => ({ content, rationale: '' });
const contents = (rows: EditorRow[]) => rows.map((r) => r.content);

describe('splitPastedRows — 언제 나서는가', () => {
  it('한 줄짜리는 손대지 않는다 — 브라우저 기본 붙여넣기에 맡긴다', () => {
    const rows = [row('')];
    const out = splitPastedRows(rows, 0, '한 문장만 붙였다');
    expect(out.applied).toBe(false);
    expect(out.rows).toBe(rows);
  });

  it('빈 붙여넣기도 손대지 않는다', () => {
    expect(splitPastedRows([row('')], 0, '   ').applied).toBe(false);
    expect(splitPastedRows([row('')], 0, '').applied).toBe(false);
  });

  it('줄바꿈이 있어도 실제 내용이 한 줄뿐이면 나서지 않는다', () => {
    expect(splitPastedRows([row('')], 0, '\n\n한 줄\n\n').applied).toBe(false);
  });

  it('범위 밖 인덱스는 무시한다', () => {
    expect(splitPastedRows([row('')], 5, '가\n나').applied).toBe(false);
    expect(splitPastedRows([row('')], -1, '가\n나').applied).toBe(false);
  });
});

describe('splitPastedRows — 나눠 넣기', () => {
  it('빈 칸에 붙이면 첫 줄이 그 칸에, 나머지는 뒤로', () => {
    const out = splitPastedRows([row('')], 0, '첫째\n둘째\n셋째');
    expect(out.applied).toBe(true);
    expect(contents(out.rows)).toEqual(['첫째', '둘째', '셋째']);
    expect(out.inserted).toBe(3);
    expect(out.dropped).toBe(0);
  });

  it('★ 글이 있는 칸에 붙이면 그 칸은 그대로 두고 뒤에 넣는다', () => {
    const out = splitPastedRows([row('원래 있던 글')], 0, '첫째\n둘째');
    expect(contents(out.rows)).toEqual(['원래 있던 글', '첫째', '둘째']);
    expect(out.inserted).toBe(2);
  });

  it('★ 가운데 칸에 붙여도 뒤쪽 행이 밀릴 뿐 내용은 안 바뀐다', () => {
    const out = splitPastedRows([row('앞'), row(''), row('뒤')], 1, '가\n나');
    expect(contents(out.rows)).toEqual(['앞', '가', '나', '뒤']);
  });

  it('★ 다른 행의 내용은 어떤 경우에도 그대로다', () => {
    const before = [row('A'), row('B'), row('C')];
    const out = splitPastedRows(before, 1, '가\n나\n다');
    expect(out.rows[0].content).toBe('A');
    expect(out.rows[1].content).toBe('B');
    expect(out.rows[out.rows.length - 1].content).toBe('C');
    expect(contents(before)).toEqual(['A', 'B', 'C']); // 원본 불변
  });

  it('\\r\\n(한글·워드 클립보드)도 나눈다', () => {
    const out = splitPastedRows([row('')], 0, '첫째\r\n둘째\r\n셋째');
    expect(contents(out.rows)).toEqual(['첫째', '둘째', '셋째']);
  });

  it('빈 줄과 앞뒤 공백은 버린다', () => {
    const out = splitPastedRows([row('')], 0, '  첫째  \n\n\n  둘째\n   \n셋째  ');
    expect(contents(out.rows)).toEqual(['첫째', '둘째', '셋째']);
  });

  it('rationale 열은 새 행에서 빈 문자열로 시작한다', () => {
    const out = splitPastedRows([{ content: '', rationale: '근거' }], 0, '가\n나');
    expect(out.rows[0].rationale).toBe('근거'); // 채운 칸의 기존 값은 보존
    expect(out.rows[1].rationale).toBe('');
  });
});

describe('splitPastedRows — 30줄 상한 (여기서 글이 사라지면 안 된다)', () => {
  it('★ 상한을 넘으면 넣을 수 있는 만큼만 넣고 나머지 수를 알려준다', () => {
    const rows = Array.from({ length: 26 }, (_, i) => row(`기존${i}`));
    const paste = Array.from({ length: 12 }, (_, i) => `새${i}`).join('\n');
    const out = splitPastedRows(rows, 0, paste, MAX_SUBMISSION_ROWS);
    expect(out.applied).toBe(true);
    expect(out.rows.length).toBe(MAX_SUBMISSION_ROWS);
    expect(out.inserted).toBe(4);
    expect(out.dropped).toBe(8);
  });

  it('빈 칸을 채우는 경우 그 칸만큼 한 줄 더 들어간다', () => {
    const rows = [...Array.from({ length: 28 }, (_, i) => row(`기존${i}`)), row('')];
    const out = splitPastedRows(rows, 28, '가\n나\n다\n라', MAX_SUBMISSION_ROWS);
    expect(out.rows.length).toBe(MAX_SUBMISSION_ROWS);
    expect(out.inserted).toBe(2); // 빈 칸 1 + 새 행 1
    expect(out.dropped).toBe(2);
  });

  it('★ 이미 꽉 찼으면 아무것도 넣지 않고 전부 못 넣었다고 알린다', () => {
    const rows = Array.from({ length: MAX_SUBMISSION_ROWS }, (_, i) => row(`기존${i}`));
    const out = splitPastedRows(rows, 0, '가\n나\n다', MAX_SUBMISSION_ROWS);
    expect(out.applied).toBe(false);
    expect(out.rows).toBe(rows);
    expect(out.dropped).toBe(3);
  });

  it('딱 맞으면 하나도 버리지 않는다', () => {
    const rows = Array.from({ length: 27 }, (_, i) => row(`기존${i}`));
    const out = splitPastedRows(rows, 0, '가\n나\n다', MAX_SUBMISSION_ROWS);
    expect(out.rows.length).toBe(MAX_SUBMISSION_ROWS);
    expect(out.dropped).toBe(0);
  });

  it('현장에서 나온 모양 — 이름(분류) 문장 9줄이 9행으로', () => {
    const paste = [
      '한지민(일회용품의 편리함의 문제) 배달음식을 먹을때 일회 용품을 사용해',
      '박태율(일회용품의 편리함의 문제) 음식매점내에서 일회용품을 많이 사용',
      '전지민(일회용품의 편리함의 문제) 싼값에 많이 소비하는 것을 유도',
      '백그루(환경인식의 부족 문제) 일회용품을 줄이기에 관심을 갖지 않는다',
      '박시온(환경인식의 부족 문제) 편리하다는 이유로 일회용품을 자주 이용',
      '강지호(환경인식의 부족 문제) 한번 사용하면 쓰레기라고 생각한다',
      '김용하(잘못된 쓰레기 배출방법) 재활용되지 않은 쓰레기가 많다',
      '김수인(잘못된 쓰레기 배출방법) 길가에 버려진 쓰레기들이 많다',
      '김민권(잘못된 쓰레기 배출방법) 대부분의 플라스틱 재활용을 하지 못한다',
    ].join('\r\n');
    const out = splitPastedRows([row('')], 0, paste);
    expect(out.rows.length).toBe(9);
    expect(out.inserted).toBe(9);
    expect(out.dropped).toBe(0);
    expect(out.rows[8].content).toContain('김민권');
  });
});
