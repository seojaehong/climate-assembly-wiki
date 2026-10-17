import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CLOSED_POLL_MS, freshFor } from './NamedResultBoard';

describe('「투표결과 보기」 — 앞 투표 이름이 남지 않는다', () => {
  it('응답은 지금 보는 투표 번호와 같을 때만 쓴다', () => {
    const a = { id: 'ballot-a', responses: [] };
    expect(freshFor(a, 'ballot-a')).toBe(a);
    expect(freshFor(a, 'ballot-b')).toBeNull();
    expect(freshFor(a, null)).toBeNull();
    expect(freshFor(null, 'ballot-a')).toBeNull();
  });
  it('이름 화면을 그리는 곳마다 key=투표 번호(바뀌면 새로 마운트)', () => {
    for (const f of ['BallotPanel.tsx', 'DivisionPresentScreen.tsx', 'DivisionVotePanel.tsx']) {
      const src = readFileSync(new URL(`./${f}`, import.meta.url), 'utf8');
      const uses = src.split('<NamedResultBoard').slice(1);
      expect(uses.length).toBeGreaterThan(0);
      for (const u of uses) expect(u.slice(0, u.indexOf('/>'))).toMatch(/\bkey=\{/);
    }
  });
  it('닫힌 투표도 천천히 다시 읽는다 — 「큰 화면에 이름」을 끄면 열린 화면에서도 사라지게', () => {
    expect(CLOSED_POLL_MS).toBeGreaterThan(0);
    expect(CLOSED_POLL_MS).toBeLessThanOrEqual(15000);
    const src = readFileSync(new URL('./NamedResultBoard.tsx', import.meta.url), 'utf8');
    expect(src).toContain('live ? POLL_MS : CLOSED_POLL_MS');
    expect(src).not.toMatch(/live \? POLL_MS : 0/);
  });
});
