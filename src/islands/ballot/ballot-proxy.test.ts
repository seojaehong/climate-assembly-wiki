import { describe, expect, it } from 'vitest';
import { isProxyMode, newProxyClientId } from './ballot-logic';

describe('(11/14) 대리 입력 모드', () => {
  it('proxy=1 · true 만 켠다', () => {
    expect(isProxyMode('?t=abc&proxy=1')).toBe(true);
    expect(isProxyMode('?proxy=true&t=abc')).toBe(true);
    expect(isProxyMode('?t=abc')).toBe(false);
    expect(isProxyMode('?t=abc&proxy=0')).toBe(false);
    expect(isProxyMode('?t=abc&proxy=')).toBe(false);
  });
  it('기기 번호는 proxy- 로 시작하고 서버 조건(8~80자)을 지킨다 · 부를 때마다 다르다', () => {
    const a = newProxyClientId();
    const b = newProxyClientId();
    expect(a.startsWith('proxy-')).toBe(true);
    expect(a.length).toBeGreaterThanOrEqual(8);
    expect(a.length).toBeLessThanOrEqual(80);
    expect(a).not.toBe(b);
    expect(newProxyClientId(() => 'x')).toBe('proxy-x');
  });
});
