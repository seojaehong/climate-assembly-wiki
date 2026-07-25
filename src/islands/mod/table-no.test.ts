import { describe, expect, it } from 'vitest';
import { TABLE_NO_DISPLAY_MAX, TABLE_NO_MAX_LENGTH, normalizeTableNo, tableNoLabel } from './table-no';

describe('normalizeTableNo', () => {
  it('앞뒤 공백을 떼고 돌려준다', () => {
    expect(normalizeTableNo('  15  ')).toBe('15');
  });

  it('빈 문자열·공백만·null·undefined는 전부 null (= 값 없음)', () => {
    expect(normalizeTableNo('')).toBeNull();
    expect(normalizeTableNo('   ')).toBeNull();
    expect(normalizeTableNo(null)).toBeNull();
    expect(normalizeTableNo(undefined)).toBeNull();
  });

  it('문자열이 아닌 값은 null — 마이그레이션 미적용 DB가 무엇을 주든 화면이 깨지지 않는다', () => {
    expect(normalizeTableNo(12 as unknown as string)).toBeNull();
  });
});

describe('tableNoLabel', () => {
  it('값이 없으면 null — 호출부가 빈 자리를 만들지 않게 한다', () => {
    expect(tableNoLabel(null)).toBeNull();
    expect(tableNoLabel(undefined)).toBeNull();
    expect(tableNoLabel('   ')).toBeNull();
  });

  it('숫자만이면 "N번 테이블"', () => {
    expect(tableNoLabel('15')).toBe('15번 테이블');
    expect(tableNoLabel('7')).toBe('7번 테이블');
  });

  it('0으로 시작하는 번호도 그대로 쓴다(현장 좌석표를 임의로 고치지 않는다)', () => {
    expect(tableNoLabel('07')).toBe('07번 테이블');
  });

  it('숫자가 아니면 "테이블 X" — "A-3번 테이블"은 한국어로 어색하다', () => {
    expect(tableNoLabel('A-3')).toBe('테이블 A-3');
    expect(tableNoLabel('본부석')).toBe('테이블 본부석');
  });

  it('입력 공백을 떼고 표기한다', () => {
    expect(tableNoLabel(' 7 ')).toBe('7번 테이블');
  });

  it(`${TABLE_NO_DISPLAY_MAX}자까지는 그대로 둔다`, () => {
    const six = 'A'.repeat(TABLE_NO_DISPLAY_MAX);
    expect(tableNoLabel(six)).toBe(`테이블 ${six}`);
  });

  it('그보다 길면 …로 줄인다 — 28px 카드에서 무성 클리핑이 나기 때문이다', () => {
    // RPC는 20자까지 허용한다(TABLE_NO_MAX_LENGTH). 그 길이가 그대로 카드에 들어오면
    // 폭 223px 상자에서 소리 없이 잘린다 — fixture가 전부 '15'라 어느 검사에도 안 걸린다.
    const long = '가'.repeat(TABLE_NO_MAX_LENGTH);
    const label = tableNoLabel(long);
    expect(label).toBe(`테이블 ${'가'.repeat(TABLE_NO_DISPLAY_MAX)}…`);
    expect(Array.from(label ?? '').length).toBeLessThan(long.length);
  });

  it('줄일 때 코드포인트 단위로 자른다 — 서러게이트 쌍을 쪼개지 않는다', () => {
    const label = tableNoLabel('🚩'.repeat(10)) ?? '';
    expect(label).toBe(`테이블 ${'🚩'.repeat(TABLE_NO_DISPLAY_MAX)}…`);
    expect(label).not.toContain('�');
  });

  it('숫자만이어도 줄었으면 "번 테이블"을 붙이지 않는다(줄인 값은 더 이상 그 번호가 아니다)', () => {
    expect(tableNoLabel('1234567')).toBe('테이블 123456…');
  });
});

describe('TABLE_NO_MAX_LENGTH', () => {
  it('20 — attendance_hq_set_table_no의 length > 20 예외와 같은 값', () => {
    // 입력창 maxLength가 이 값이면 RPC 가드에 닿지 않는다(UTF-16 길이 >= 코드포인트 길이).
    expect(TABLE_NO_MAX_LENGTH).toBe(20);
  });
});
