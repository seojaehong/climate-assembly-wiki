import { describe, expect, it } from 'vitest';
import { boardChaseState } from './chase-1114.mjs';
import { recountAgenda } from './result-v2.mjs';
import { recountSummary, reflectView } from './reflect-1114.mjs';

const at = (s) => `2026-11-14T05:${String(s).padStart(2, '0')}:00Z`;
const v = (team, name, extra = {}) => ({ team, name, in_roster: true, started_at: at(1), answered_count: 2, last_ordinal: 2, updated_at: at(2), submitted: true, submitted_at: at(2), devices: 1, proxy: false, ...extra });

const board = {
  id: 'b', title: '의제1', status: 'open', item_count: 2,
  voters: [
    v('1분과 1조', '김가', { submitted_at: at(3) }),
    v('1분과 1조', '김가(수정)', { in_roster: false, proxy: true, submitted_at: at(9) }),
    v('1분과 2조', '이나', { proxy: true, submitted_at: at(4) }), // 수기 투표지 대리 입력
    v('1분과 2조', '박다(수정)', { in_roster: false, proxy: true, submitted_at: at(5) }), // 원래 표 없음
    v('1분과 2조', '박다', { submitted: false, submitted_at: null, answered_count: 0, started_at: null, last_ordinal: null, updated_at: null }),
    v('1분과 3조', '최라', { submitted: false, submitted_at: null }), // 진행 중
    v('1분과 3조', '홍길동', { in_roster: false, submitted_at: at(6) }), // 명단 밖
  ],
};

describe('반영 확인', () => {
  const st = boardChaseState(board);
  const r = reflectView(board, st);
  it('대리 입력 목록(조 순) · 합계', () => {
    expect(r.proxyKnown).toBe(true);
    expect(r.proxy.map((p) => p.name)).toEqual(['김가(수정)', '이나', '박다(수정)']);
    expect(r.proxyTeams).toEqual([{ team: '1분과 1조', n: 1 }, { team: '1분과 2조', n: 2 }]);
    expect(r.proxyTotal).toBe(3);
  });
  it('수정 표 — 원래 표 대체 여부', () => {
    const byName = Object.fromEntries(r.corrections.map((c) => [c.name, c]));
    expect(byName['김가'].hadOriginal).toBe(true);
    expect(byName['박다'].hadOriginal).toBe(false);
    expect(r.replacedCount).toBe(1);
  });
  it('이상 — 원래 표 없는 수정 · 명단 밖 이름', () => {
    const kinds = r.anomalies.map((a) => `${a.kind}:${a.name}`);
    expect(kinds).toContain('원래 표 없는 수정:박다');
    expect(kinds).toContain('명단 밖 이름으로 제출:홍길동');
    expect(r.unanswered.total).toBeGreaterThanOrEqual(1);
  });
  it('대체 경로(s35 없음)면 대리 입력은 「알 수 없음」', () => {
    const fb = reflectView({ ...board, fallback: 'named_responses' }, st);
    expect(fb.proxyKnown).toBe(false);
    expect(fb.proxyTotal).toBe(0);
  });
  it('같은 이름이 두 조에서 제출 · 수정 2건 이상', () => {
    const b2 = { ...board, voters: [v('1분과 1조', '김가'), v('2분과 1조', '김가', { in_roster: true })] };
    const r2 = reflectView(b2, { corrections: [{ team: '1분과 1조', name: '김가', hadOriginal: true, count: 2 }], checks: [], waiting: [], notStartedCount: 0 });
    const kinds = r2.anomalies.map((a) => a.kind);
    expect(kinds.some((k) => k.startsWith('같은 이름이 2개 조'))).toBe(true);
    expect(kinds).toContain('수정 2건(마지막만 셈)');
  });
});

describe('재집계 한 줄 — result-v2 규칙 그대로, 찬반 없음', () => {
  it('원래 표 + 수정 표 → 유효 1 · 대체 1', () => {
    const raw = {
      id: 'b', status: 'closed',
      items: [
        { id: 'i1', ordinal: 1, statement: '1-1-안1 가', scale: 2, required: true },
        { id: 'i2', ordinal: 2, statement: '1-2-안1 나', scale: 2, required: true },
      ],
      roster: [{ team: '1분과 1조', name: '김가' }, { team: '1분과 2조', name: '이나' }],
      responses: [
        { id: 'r1', voter_team: '1분과 1조', voter_name: '김가', answers: { i1: 1, i2: 1 }, submitted_at: at(3) },
        { id: 'r2', voter_team: '1분과 2조', voter_name: '이나', answers: { i1: 2, i2: 1 }, submitted_at: at(4) },
        { id: 'r3', voter_team: '1분과 1조', voter_name: '김가(수정)', answers: { i1: 2, i2: 2 }, submitted_at: at(9) },
      ],
    };
    const s = recountSummary(recountAgenda(raw, { agendaNo: 1, expectedCount: 2 }));
    expect(s).toMatchObject({ valid: 2, replaced: 1, corrected: 1, oddTotal: 0, systemResponses: 3 });
    expect(JSON.stringify(s)).not.toMatch(/yes|nay/);
    expect(s.line).toBe('유효 표 2 · 수정으로 대체 1 · 이상 0 · 받은 응답 3');
  });
});
