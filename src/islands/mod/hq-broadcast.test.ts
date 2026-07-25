import { describe, it, expect } from 'vitest';
import { isOpsMode, participationParts } from './hq-broadcast-logic';
import type { TeamCellResult } from './hq-grid-logic';

function cell(participation: string): TeamCellResult {
  return { label: '투표중', participation };
}

describe('isOpsMode', () => {
  it("'?ops=1'일 때만 운영 모드다", () => {
    expect(isOpsMode('?ops=1')).toBe(true);
  });

  it('빈 문자열과 물음표만 있는 경우는 송출 모드다', () => {
    expect(isOpsMode('')).toBe(false);
    expect(isOpsMode('?')).toBe(false);
  });

  it("'?ops=0'은 송출 모드다", () => {
    expect(isOpsMode('?ops=0')).toBe(false);
  });

  it('다른 파라미터만 있으면 송출 모드다', () => {
    expect(isOpsMode('?x=1')).toBe(false);
  });

  it('다른 파라미터와 함께 있어도 ops=1이면 운영 모드다', () => {
    expect(isOpsMode('?code=ABCD&ops=1')).toBe(true);
    expect(isOpsMode('?ops=1&code=ABCD')).toBe(true);
  });

  it('물음표가 없는 검색 문자열도 처리한다', () => {
    expect(isOpsMode('ops=1')).toBe(true);
  });

  it("'1' 이외의 값은 운영 모드가 아니다 — 오타로 대형 스크린에 조작 UI가 뜨면 안 된다", () => {
    expect(isOpsMode('?ops=true')).toBe(false);
    expect(isOpsMode('?ops=')).toBe(false);
    expect(isOpsMode('?ops')).toBe(false);
    expect(isOpsMode('?ops=11')).toBe(false);
  });

  it('이름이 부분 일치하는 파라미터에 속지 않는다', () => {
    expect(isOpsMode('?xops=1')).toBe(false);
    expect(isOpsMode('?opsmode=1')).toBe(false);
  });
});

describe('participationParts', () => {
  it("'9/12'를 득표수와 전체로 나눈다", () => {
    expect(participationParts(cell('9/12'))).toEqual({ votes: '9', total: '12' });
  });

  it('0표도 그대로 유지한다', () => {
    expect(participationParts(cell('0/14'))).toEqual({ votes: '0', total: '14' });
  });

  it('슬래시가 없으면 전체는 빈 문자열이다', () => {
    expect(participationParts(cell('9'))).toEqual({ votes: '9', total: '' });
  });

  it('빈 문자열은 양쪽 모두 빈 문자열이다', () => {
    expect(participationParts(cell(''))).toEqual({ votes: '', total: '' });
  });

  it('슬래시가 여러 개면 첫 슬래시만 기준으로 나눈다', () => {
    expect(participationParts(cell('9/12/3'))).toEqual({ votes: '9', total: '12/3' });
  });

  it('앞뒤 공백을 제거한다', () => {
    expect(participationParts(cell(' 9 / 12 '))).toEqual({ votes: '9', total: '12' });
  });

  it('분모가 비어 있어도 터지지 않는다', () => {
    expect(participationParts(cell('9/'))).toEqual({ votes: '9', total: '' });
    expect(participationParts(cell('/12'))).toEqual({ votes: '', total: '12' });
  });
});
