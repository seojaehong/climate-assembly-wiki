import { describe, expect, it } from 'vitest';
import { MAX_SUBMISSION_ROWS, splitPastedRows, type EditorRow } from './submission-panel-logic';

const row = (content: string): EditorRow => ({ name: '', content, rationale: '' });
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
    const out = splitPastedRows([{ name: '', content: '', rationale: '근거' }], 0, '가\n나');
    expect(out.rows[0].rationale).toBe('근거'); // 채운 칸의 기존 값은 보존
    expect(out.rows[1].rationale).toBe('');
  });
});

// 상한 값 자체는 운영 판단으로 바뀐다(2026-08-29 30 → 200). 여기서는 **로직**을
// 재야 하므로 로컬 CAP 으로 고정한다 — 상수를 올릴 때마다 빨개지면 안 된다.
const CAP = 30;

describe('splitPastedRows — 상한 (여기서 글이 사라지면 안 된다)', () => {
  it('★ 상한을 넘으면 넣을 수 있는 만큼만 넣고 나머지 수를 알려준다', () => {
    const rows = Array.from({ length: 26 }, (_, i) => row(`기존${i}`));
    const paste = Array.from({ length: 12 }, (_, i) => `새${i}`).join('\n');
    const out = splitPastedRows(rows, 0, paste, CAP);
    expect(out.applied).toBe(true);
    expect(out.rows.length).toBe(CAP);
    expect(out.inserted).toBe(4);
    expect(out.dropped).toBe(8);
  });

  it('빈 칸을 채우는 경우 그 칸만큼 한 줄 더 들어간다', () => {
    const rows = [...Array.from({ length: 28 }, (_, i) => row(`기존${i}`)), row('')];
    const out = splitPastedRows(rows, 28, '가\n나\n다\n라', CAP);
    expect(out.rows.length).toBe(CAP);
    expect(out.inserted).toBe(2); // 빈 칸 1 + 새 행 1
    expect(out.dropped).toBe(2);
  });

  it('★ 이미 꽉 찼으면 아무것도 넣지 않고 전부 못 넣었다고 알린다', () => {
    const rows = Array.from({ length: CAP }, (_, i) => row(`기존${i}`));
    const out = splitPastedRows(rows, 0, '가\n나\n다', CAP);
    expect(out.applied).toBe(false);
    expect(out.rows).toBe(rows);
    expect(out.dropped).toBe(3);
  });

  it('딱 맞으면 하나도 버리지 않는다', () => {
    const rows = Array.from({ length: 27 }, (_, i) => row(`기존${i}`));
    const out = splitPastedRows(rows, 0, '가\n나\n다', CAP);
    expect(out.rows.length).toBe(CAP);
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

describe('상한 상수', () => {
  it('★ 화면 상한은 서버 RPC 상한(200)과 같아야 한다 — 크면 저장이 실패한다', () => {
    expect(MAX_SUBMISSION_ROWS).toBe(200);
  });
});

// ── 2026-08-30 ── 8.29 통짜 6건 이후 보강분 ────────────────────────

import {
  LONG_ROW_CHARS,
  overlongRowIndexes,
  splitOverlongRows,
  splitSubmissionLines,
  splittableRowIndexes,
} from './submission-panel-logic';
import { isStaleBundle, parseRevisionManifest } from './deploy-revision';

describe('splitSubmissionLines — 「한 줄」의 정의 (서버 SQL 과 같은 규칙)', () => {
  it('\r\n · \n 을 모두 자른다', () => {
    expect(splitSubmissionLines('가\r\n나\n다')).toEqual(['가', '나', '다']);
  });
  it('앞뒤 공백을 없애고 빈 줄을 버린다', () => {
    expect(splitSubmissionLines('  가  \n\n\t\n 나 ')).toEqual(['가', '나']);
  });
  it('★ 줄바꿈이 없으면 한 줄이다 — 나누지 않는다는 뜻', () => {
    expect(splitSubmissionLines('한 문장뿐')).toEqual(['한 문장뿐']);
    expect(splitSubmissionLines('끝에만 줄바꿈\n')).toEqual(['끝에만 줄바꿈']);
  });
  it('빈 문자열은 0줄', () => {
    expect(splitSubmissionLines('   \n\n ')).toEqual([]);
  });
});

const long = (n: number) => '가'.repeat(n);

describe('긴 칸 판정 — 경고를 언제 띄우는가', () => {
  it(`${LONG_ROW_CHARS}자 이하는 조용하다`, () => {
    expect(overlongRowIndexes([row(long(LONG_ROW_CHARS))])).toEqual([]);
  });
  it(`${LONG_ROW_CHARS}자를 넘으면 잡는다`, () => {
    expect(overlongRowIndexes([row('짧음'), row(long(LONG_ROW_CHARS + 1))])).toEqual([1]);
  });
  it('앞뒤 공백은 길이에 안 넣는다', () => {
    expect(overlongRowIndexes([row(`   ${long(10)}   `)])).toEqual([]);
  });
  it('★ 줄바꿈 없는 긴 한 문장은 「나눌 수 있는 칸」이 아니다 — 버튼을 주지 않는다', () => {
    const rows = [row(long(700))];
    expect(overlongRowIndexes(rows)).toEqual([0]);
    expect(splittableRowIndexes(rows)).toEqual([]);
  });
  it('길고 줄바꿈이 있으면 나눌 수 있는 칸이다', () => {
    const rows = [row(`${long(200)}\n${long(200)}`)];
    expect(splittableRowIndexes(rows)).toEqual([0]);
  });
});

describe('splitOverlongRows — 긴 칸 나누기 (강제하지 않는다)', () => {
  it('나눌 게 없으면 아무 일도 안 한다', () => {
    const rows = [row('짧음'), row('짧음2')];
    const out = splitOverlongRows(rows);
    expect(out.applied).toBe(false);
    expect(out.rows).toBe(rows);
  });

  it('★ 8.29 3분과 3조 꼭지① 모양 — 1칸이 13칸으로', () => {
    const blob = Array.from({ length: 13 }, (_, i) => `${'가'.repeat(30)} ${i}`).join('\r\n');
    const out = splitOverlongRows([row(blob)]);
    expect(out.applied).toBe(true);
    expect(out.before).toBe(1);
    expect(out.after).toBe(13);
    expect(out.rows.every((r) => !/\r?\n/.test(r.content))).toBe(true);
  });

  it('★ 나뉜 조각은 그 자리에 들어가고 다른 행은 순서도 내용도 그대로다', () => {
    const rows = [row('앞'), row(`${long(160)}\n${long(160)}`), row('뒤')];
    const out = splitOverlongRows(rows);
    expect(contents(out.rows)[0]).toBe('앞');
    expect(contents(out.rows)[out.rows.length - 1]).toBe('뒤');
    expect(out.rows.length).toBe(4);
  });

  it('rationale 은 첫 조각만 물려받는다 (복제 금지)', () => {
    const out = splitOverlongRows([{ name: '', content: `${long(160)}\n${long(160)}`, rationale: '근거' }]);
    expect(out.rows[0].rationale).toBe('근거');
    expect(out.rows[1].rationale).toBe('');
  });

  it('★ 나누면 상한을 넘을 때 — 조용히 잘라내지 않고 통째로 포기한다', () => {
    const rows = [row(Array.from({ length: 40 }, () => long(20)).join('\n'))];
    const out = splitOverlongRows(rows, CAP); // CAP = 30
    expect(out.applied).toBe(false);
    expect(out.overCap).toBe(true);
    expect(out.rows).toBe(rows); // 글자가 한 자도 사라지지 않았다
  });

  it('★ 멱등 — 나눈 결과를 다시 넣어도 그대로다 (서버 분해와 이중으로 걸려도 무해)', () => {
    const once = splitOverlongRows([row(`${long(160)}\n${long(160)}\n${long(160)}`)]);
    const twice = splitOverlongRows(once.rows);
    expect(twice.applied).toBe(false);
    expect(contents(twice.rows)).toEqual(contents(once.rows));
  });
});

describe('배포 감지 — 열어 둔 화면이 옛 코드인가', () => {
  const A = 'a'.repeat(40);
  const B = `${'a'.repeat(39)}b`;

  it('매니페스트를 해석한다', () => {
    expect(parseRevisionManifest({ schemaVersion: 1, sourceCommit: A })).toBe(A);
  });
  it('schema·형식이 틀리면 null (dev 서버 HTML·404 포함)', () => {
    expect(parseRevisionManifest({ schemaVersion: 2, sourceCommit: A })).toBeNull();
    expect(parseRevisionManifest({ schemaVersion: 1, sourceCommit: 'abc' })).toBeNull();
    expect(parseRevisionManifest('<!doctype html>')).toBeNull();
    expect(parseRevisionManifest(null)).toBeNull();
  });
  it('★ 배포가 바뀌면 잡는다', () => {
    expect(isStaleBundle(A, B)).toBe(true);
  });
  it('같으면 뜨지 않는다', () => {
    expect(isStaleBundle(A, A)).toBe(false);
  });
  it('★ 모르면 조용히 있는다 — 근거 없는 「새로고침하세요」가 더 나쁘다', () => {
    expect(isStaleBundle(null, A)).toBe(false);
    expect(isStaleBundle(A, null)).toBe(false);
  });
});
