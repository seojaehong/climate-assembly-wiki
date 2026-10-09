import { describe, expect, it } from 'vitest';
import { createFakeBallotApi, labOpsStates } from './division-vote-lab-fake';
import { beginVote, boardSummary, runVoteClose, runVoteStart } from './division-vote-flow';
import { createMotion, initPrepState, migratePrep, serializePrep, type PrepState } from './division-vote-logic';
import { DIVISION_VOTE_FIXTURE } from './division-vote-fixture';

describe('미리보기 가짜 투표 서버', () => {
  it('같은 멱등키는 같은 투표 · 상태는 앞으로만', async () => {
    const api = createFakeBallotApi();
    const input = { title: 't', subgroup: '2분과', items: [{ ordinal: 1, statement: 's', scale: 2 as const, required: true }] };
    const a = await api.create(input, 'k');
    const b = await api.create(input, 'k');
    expect(a).toEqual(b);
    await api.setStatus(a.id, 'open');
    await api.setStatus(a.id, 'open'); // 같은 상태는 성공
    await api.setStatus(a.id, 'closed');
    await expect(api.setStatus(a.id, 'open')).rejects.toThrow('invalid ballot transition');
    expect(await api.statusOf(a.id)).toBe('closed');
    expect((await api.list()).length).toBe(1);
  });

  it('시작 → 마감 → 결과까지 흐름이 실제로 돈다(서버 없이)', async () => {
    let t = 1_000_000;
    const api = createFakeBallotApi({ now: () => t });
    const r = createMotion(initPrepState(DIVISION_VOTE_FIXTURE[0]), { cardNos: ['2-1-1'], title: '안', text: '' });
    if (!r.ok) throw new Error(r.error);
    const b = beginVote({ ...r.state, attendance: { enrolled: 60, present: 45 } }, ['2-1-안1'], 'k1');
    if (!b.ok) throw new Error(b.error);
    let shared: PrepState = b.state;
    const commit = async (fn: (s: PrepState) => PrepState) => (shared = fn(shared));
    const rec = await runVoteStart(api, commit, () => shared, 'k1', () => new Date(t).toISOString());
    expect(rec.stage).toBe('open');
    t += 30_000;
    const out = await runVoteClose(api, commit, () => shared, 'k1', () => new Date(t).toISOString());
    expect(out.ok).toBe(true);
    const round = shared.motions[0].rounds[0];
    expect((round.onlineYes ?? 0) + (round.onlineNo ?? 0)).toBeGreaterThan(0);
    expect(round.verdict === 'passed' || round.verdict === 'failed').toBe(true);
  });

  it('운영팀 시연 상태는 세 분과가 다 읽히는 모양이다', () => {
    const states = labOpsStates(Date.parse('2026-10-17T05:00:00Z'));
    expect(Object.keys(states)).toEqual(['1', '2', '3']);
    for (const s of Object.values(states)) expect(migratePrep(JSON.parse(serializePrep(s)))).toEqual(s);
    expect(boardSummary(1, states[1])).toMatchObject({ passed: 1, excludedCount: 1, attendanceMissing: false });
    expect(boardSummary(1, states[1]).open).toHaveLength(1);
    expect(boardSummary(2, states[2]).attendanceMissing).toBe(true);
    expect(boardSummary(3, states[3]).minority).toBe(1);
  });
});
