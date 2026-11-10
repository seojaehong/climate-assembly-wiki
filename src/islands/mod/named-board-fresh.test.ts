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

describe('(11/10 결정 + 방어선) 제출자 대조 — 직접 입력은 출석부와 맞으면 유효표', () => {
  it('명단에 없는 조·이름을 「오타 의심」이 아니라 직접 입력으로 적고, 출석부 조건을 함께 적는다', () => {
    const src = readFileSync(new URL('./VoterReconcileBox.tsx', import.meta.url), 'utf8');
    expect(src).toContain('직접 입력');
    expect(src).toContain('출석부와 조·이름이 맞으면 유효표');
    expect(src).not.toContain('유효표로 셉니다(11/10 결정)');
    expect(src).not.toContain('오타 의심');
  });
});

describe('(11/14 큰 화면 위생) 투표 목록의 「투표결과 보기 (조·이름)」', () => {
  it('전체회의 의결 투표지에는 단추를 그리지 않고, 이름 화면도 열지 않는다(같은 노트북을 프로젝터로 내보낸다)', () => {
    const src = readFileSync(new URL('./BallotPanel.tsx', import.meta.url), 'utf8');
    expect(src).toMatch(/ballot\.status !== 'draft' && !plenaryQuietScreen\(ballot\) \? \(\s*<button[\s\S]{0,200}data-testid="ballot-named-board"/);
    expect(src).toMatch(/namesId && access[\s\S]{0,200}!plenaryQuietScreen\(b\)/);
  });
});
