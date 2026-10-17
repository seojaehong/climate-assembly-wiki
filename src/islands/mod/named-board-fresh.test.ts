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

describe('제출자 대조 — 낸 사람 누구든 조·이름을 고칠 수 있다', () => {
  it('상자에 「낸 사람 전체」 찾기 목록이 있고 줄마다 고치기 버튼(row) — 명단 밖·중복만이 아니다', () => {
    const src = readFileSync(new URL('./VoterReconcileBox.tsx', import.meta.url), 'utf8');
    expect(src).toContain('searchResponses(data.responses, query)');
    expect(src).toMatch(/found\.map\(\(r\) => row\(r\)\)/);
    expect(src).toContain('조·이름 고치기');
    // 정정 호출은 조·이름만 보낸다(찬반 인자 없음)
    expect(src).toMatch(/ballotVoterCorrect\(access, ballotId, edit\.id, edit\.team, displayVoterName\(edit\.name\)\)/);
  });
  it('분과 의결 안 카드는 투표 중에도 상자를 띄운다(지금 차수 기준), 다의제 투표 탭은 열림부터', () => {
    const panel = readFileSync(new URL('./DivisionVotePanel.tsx', import.meta.url), 'utf8');
    expect(panel).toContain('reconcileRoundOf(cur, last, state.ballots)');
    expect(panel).toMatch(/reconcileRound && namedAccess \? \(\s*<VoterReconcileBox/);
    const ballot = readFileSync(new URL('./BallotPanel.tsx', import.meta.url), 'utf8');
    expect(ballot).toMatch(/ballot\.status !== 'draft' && access \? \(\s*<div className="mt-3">\s*<VoterReconcileBox/);
  });
});
