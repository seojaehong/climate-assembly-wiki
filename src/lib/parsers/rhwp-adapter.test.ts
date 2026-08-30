/**
 * rhwp 어댑터 누락 검사 시험 — WASM 없이 돈다.
 *
 * 실제 문서 숫자(A조 hwp 41.4% 누락 등)는 저장소 밖 `00_입력자료` 를 읽어야 해서
 * 여기 넣지 않는다. 그쪽은 실측 스크립트가 맡고(US-007 의 `verify-parsers.mjs`),
 * 여기서는 판정 규칙 자체만 못박는다.
 */
import { describe, expect, it } from 'vitest';

import {
  checkMissingContent,
  comparableLength,
  decodeNumericEntities,
  unwrapTextFileText,
} from './rhwp-adapter';

describe('unwrapTextFileText', () => {
  it('JSON 인코딩된 문자열을 푼다 — 개행이 역슬래시 2문자로 들어 있다', () => {
    const raw = JSON.stringify('첫 줄\n둘째 줄\t끝');
    expect(raw.startsWith('"')).toBe(true);
    expect(unwrapTextFileText(raw)).toBe('첫 줄\n둘째 줄\t끝');
  });

  it('JSON 이 아니면 리터럴 이스케이프만 치환한다', () => {
    expect(unwrapTextFileText('첫 줄\\r\\n둘째 줄\\t끝')).toBe('첫 줄\n둘째 줄\t끝');
  });

  it('JSON 이 문자열이 아닌 값이면 폴백으로 간다', () => {
    expect(unwrapTextFileText('123')).toBe('123');
  });
});

describe('decodeNumericEntities', () => {
  it('십진 엔티티를 디코드한다', () => {
    expect(decodeNumericEntities('가&#8212;나')).toBe('가—나');
  });

  it('십육진 엔티티를 디코드한다', () => {
    expect(decodeNumericEntities('&#x2014;')).toBe('—');
  });

  it('사용자정의 영역(윙딩 불릿)도 그대로 푼다', () => {
    expect(decodeNumericEntities('&#61580;')).toBe(String.fromCodePoint(61580));
  });

  it('범위를 벗어난 코드포인트는 원문을 남긴다', () => {
    expect(decodeNumericEntities('&#99999999;')).toBe('&#99999999;');
  });

  it('이름 엔티티는 건드리지 않는다 — 실측에서 관측되지 않았다', () => {
    expect(decodeNumericEntities('a&amp;b')).toBe('a&amp;b');
  });
});

describe('comparableLength', () => {
  it('공백·개행·탭을 모두 털고 센다', () => {
    expect(comparableLength(' 가 나\n다\t라 ')).toBe(4);
  });
});

describe('checkMissingContent', () => {
  const fullText = (chars: number) => JSON.stringify('가'.repeat(chars));

  it('전문이 구조보다 5% 넘게 많으면 missing-content 경고를 낸다', () => {
    const warning = checkMissingContent('가'.repeat(10321), fullText(17601));
    expect(warning?.kind).toBe('missing-content');
  });

  it('경고 메시지에 두 수치를 모두 적는다', () => {
    const warning = checkMissingContent('가'.repeat(10321), fullText(17601));
    expect(warning?.message).toContain('10,321');
    expect(warning?.message).toContain('17,601');
    expect(warning?.detail).toContain('structuralChars=10321');
    expect(warning?.detail).toContain('textFileChars=17601');
  });

  it('차이가 5% 이하면 경고하지 않는다', () => {
    expect(checkMissingContent('가'.repeat(96), fullText(100))).toBeNull();
    expect(checkMissingContent('가'.repeat(95), fullText(100))).toBeNull(); // 정확히 5% 는 통과
    expect(checkMissingContent('가'.repeat(94), fullText(100))?.kind).toBe('missing-content');
  });

  it('구조 쪽이 더 많으면 누락이 아니다 — 실측 hwpx 가 이 경우다', () => {
    expect(checkMissingContent('가'.repeat(2030), fullText(1309))).toBeNull();
  });

  it('공백 차이를 누락으로 보지 않는다', () => {
    const structural = ['가나다', '라마바', '사아자'].join('\n');
    const full = JSON.stringify('가나다\r\n\r\n  라마바  \r\n\t사아자\r\n');
    expect(checkMissingContent(structural, full)).toBeNull();
  });

  it('엔티티를 디코드한 뒤 센다 — 엔티티 표기를 누락으로 오인하지 않는다', () => {
    // 엔티티 6문자가 1글자로 줄어야 구조(1자)와 전문(1자)이 맞는다.
    expect(checkMissingContent('—', JSON.stringify('&#8212;'))).toBeNull();
  });

  it('전문이 비면 판정하지 않는다', () => {
    expect(checkMissingContent('가나다', JSON.stringify(''))).toBeNull();
  });
});
