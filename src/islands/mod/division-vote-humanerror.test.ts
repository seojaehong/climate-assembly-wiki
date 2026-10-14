import { describe, expect, it } from 'vitest';
import {
  canEditMotionTitle,
  createMotion,
  initPrepState,
  migratePrep,
  parseImport,
  replaceStateProblem,
  serializePrep,
  updateMotion,
  type PrepState,
} from './division-vote-logic';
import {
  MAX_ROUNDS,
  applyBallotResults,
  armedText,
  beginVote,
  boardSummary,
  canEditRoundCounts,
  canRevote,
  canVoidRound,
  cancelRevote,
  ceremonyGaps,
  confirmHandCount,
  currentRound,
  handPending,
  liveBallots,
  markBallotCreated,
  markBallotOpened,
  markMinority,
  motionPhase,
  overdue,
  requestRevote,
  resultCsvRows,
  runVoteVoid,
  setHandCount,
  storedCeremonyItems,
  titleHead,
  voidBallot,
  voteUnits,
  type VoteApi,
} from './division-vote-flow';
import { DIVISION_VOTE_FIXTURE } from './division-vote-fixture';
import { replayEdits, replayNotice } from './division-prep-sync';
import { createFakePrepServer, labPairState } from './division-vote-lab-fake';
import type { BallotResults } from '../../lib/deliberation';

/**
 * 10/14 휴먼에러 점검에서 확정된 지적(operator-1~6 · moderator-1~5 · ops-1·2·6)의 순수 규칙 시험.
 * 화면은 이 함수들의 결과만 보여 준다.
 */

const div2 = DIVISION_VOTE_FIXTURE.find((d) => d.division === 2)!;
const NOW = '2026-10-17T05:05:09.000Z';
const LATER = '2026-10-17T05:06:00.000Z';

function make(state: PrepState, cardNos: string[], title: string): PrepState {
  const r = createMotion(state, { cardNos, title, text: '' });
  if (!r.ok) throw new Error(r.error);
  return r.state;
}

function base(): PrepState {
  let s = initPrepState(div2);
  s = make(s, ['2-1-1'], '다회용기 확대');
  s = make(s, ['2-1-2'], '회수 체계');
  s = make(s, ['2-4-1'], '순환센터');
  return { ...s, attendance: { enrolled: 60, present: 45 } };
}

function results(record: { ballotId: string | null; statements: string[] }, counts: [number, number][]): BallotResults {
  return {
    id: record.ballotId ?? 'b',
    title: 't',
    status: 'closed',
    subgroup: '2분과',
    responses: 40,
    items: record.statements.map((statement, i) => ({
      id: `i${i}`,
      ordinal: i + 1,
      statement,
      scale: 2,
      n: counts[i][0] + counts[i][1],
      avg: null,
      dist: { '1': counts[i][1], '2': counts[i][0] },
    })),
  };
}

function open(s: PrepState, id: string, key: string): PrepState {
  const b = beginVote(s, [id], key, NOW);
  if (!b.ok) throw new Error(b.error);
  return markBallotOpened(markBallotCreated(b.state, key, { id: `B-${key}`, token: `T-${key}` }), key, NOW);
}

function close(s: PrepState, key: string, counts: [number, number][]): PrepState {
  const r = applyBallotResults(s, key, results(s.ballots[key], counts), LATER);
  if (!r.ok) throw new Error(r.error);
  return r.state;
}

const motion = (s: PrepState, id: string) => s.motions.find((m) => m.id === id)!;

describe('operator-3 — 한 분과에 열린 투표는 하나만', () => {
  it('다른 안이 열려 있으면 [투표 시작]을 막고 그 안 번호를 알린다', () => {
    const s = open(base(), '2-1-안1', 'a');
    expect(liveBallots(s).map((b) => b.requestId)).toEqual(['a']);
    const r = beginVote(s, ['2-1-안2'], 'b');
    expect(r).toEqual({ ok: false, error: '2-1-안1 투표가 열려 있습니다. 먼저 마감하십시오.' });
  });

  it('여는 중(만들기 전)에 멈춘 투표도 막는다 · 마감하면 다음 안을 연다', () => {
    const started = beginVote(base(), ['2-1-안1'], 'a');
    if (!started.ok) throw new Error();
    expect(beginVote(started.state, ['2-1-안2'], 'b').ok).toBe(false);
    const s = close(open(base(), '2-1-안1', 'a'), 'a', [[40, 0]]);
    expect(beginVote(s, ['2-1-안2'], 'b').ok).toBe(true);
  });

  it('같은 안을 다시 누르면(이어 가기) 막지 않는다', () => {
    const started = beginVote(base(), ['2-1-안1'], 'a');
    if (!started.ok) throw new Error();
    expect(beginVote(started.state, ['2-1-안1'], 'zzz')).toMatchObject({ ok: true, requestId: 'a', resumed: true });
  });
});

describe('operator-2·ops-1 — 잘못 연 투표 무효', () => {
  it('1차를 무효로 하면 안은 「투표 전」, 차수 번호를 쓰지 않는다, 투표 기록은 마감', () => {
    let s = open(base(), '2-1-안2', 'wrong');
    const v = voidBallot(s, 'wrong', LATER);
    if (!v.ok) throw new Error(v.error);
    s = v.state;
    expect(motionPhase(s, motion(s, '2-1-안2'))).toBe('ready');
    expect(s.ballots.wrong.stage).toBe('closed');
    expect(liveBallots(s)).toEqual([]);
    expect(currentRound(motion(s, '2-1-안2'))).toBeNull();
    // 다시 열면 다시 1차
    const again = beginVote(s, ['2-1-안2'], 'right');
    if (!again.ok) throw new Error(again.error);
    expect(again.state.ballots.right.round).toBe(1);
    expect(again.state.ballots.right.title).toBe('2분과 의결 2-1-안2');
    expect(motion(again.state, '2-1-안2').rounds.map((r) => [r.round, r.requestId, !!r.voidedAt])).toEqual([
      [1, 'wrong', true],
      [1, 'right', false],
    ]);
  });

  it('무효 1차 + 진짜 1차 부결 → 2차를 열 수 있다(MAX_ROUNDS 를 쓰지 않았다) · 거수는 진짜 1차에 붙는다', () => {
    let s = open(base(), '2-1-안1', 'wrong');
    const v = voidBallot(s, 'wrong', LATER);
    if (!v.ok) throw new Error();
    s = close(open(v.state, '2-1-안1', 'real'), 'real', [[20, 20]]);
    s = setHandCount(s, '2-1-안1', 1, { handYes: 3 });
    const m = motion(s, '2-1-안1');
    expect(m.rounds.find((r) => r.requestId === 'real')!.handYes).toBe(3);
    expect(m.rounds.find((r) => r.requestId === 'wrong')!.handYes).toBe(0);
    s = confirmHandCount(s, '2-1-안1', 1, 'entered');
    expect(canRevote(s, motion(s, '2-1-안1'))).toBe(true);
    s = requestRevote(s, '2-1-안1');
    const b = beginVote(s, ['2-1-안1'], 'r2');
    if (!b.ok) throw new Error(b.error);
    expect(b.state.ballots.r2.round).toBe(2);
    expect(MAX_ROUNDS).toBe(2);
  });

  it('2차를 무효로 하면 「2차 준비」로 돌아가 다시 2차를 연다', () => {
    let s = confirmHandCount(close(open(base(), '2-1-안1', 'r1'), 'r1', [[20, 20]]), '2-1-안1', 1, 'entered');
    s = requestRevote(s, '2-1-안1');
    s = updateMotion(s, '2-1-안1', { title: '고친 문구' });
    const b = beginVote(s, ['2-1-안1'], 'r2');
    if (!b.ok) throw new Error(b.error);
    s = markBallotOpened(markBallotCreated(b.state, 'r2', { id: 'B2', token: 'T2' }), 'r2', NOW);
    const v = voidBallot(s, 'r2', LATER);
    if (!v.ok) throw new Error(v.error);
    expect(motionPhase(v.state, motion(v.state, '2-1-안1'))).toBe('revote');
    expect(motion(v.state, '2-1-안1').title).toBe('고친 문구');
    const again = beginVote(v.state, ['2-1-안1'], 'r2b');
    if (!again.ok) throw new Error(again.error);
    expect(again.state.ballots.r2b.round).toBe(2);
  });

  it('무효 가능 단계 — 투표 중·시작 중·집계 전은 누구나, 결과가 나온 뒤는 운영팀만', () => {
    const s = open(base(), '2-1-안1', 'a');
    expect(canVoidRound(s, motion(s, '2-1-안1'), false)).toBe(true);
    expect(canVoidRound(s, motion(s, '2-1-안2'), true)).toBe(false); // 투표 전
    const closed = close(s, 'a', [[40, 0]]);
    expect(canVoidRound(closed, motion(closed, '2-1-안1'), false)).toBe(false);
    expect(canVoidRound(closed, motion(closed, '2-1-안1'), true)).toBe(true);
  });

  it('결과가 들어간 투표를 무효로 하면 세리머니·판정에서 빠지고 CSV 에 「무효(잘못 열림)」로 남는다', () => {
    let s = close(open(base(), '2-1-안1', 'wrong'), 'wrong', [[33, 3]]);
    const v = voidBallot(s, 'wrong', LATER);
    if (!v.ok) throw new Error();
    s = v.state;
    expect(storedCeremonyItems(s)).toEqual([]);
    const rows = resultCsvRows(s).filter((r) => r[1] === '2-1-안1');
    expect(rows.map((r) => r[14])).toEqual(['무효(잘못 열림)', '미투표']);
    expect(boardSummary(2, s)).toMatchObject({ passed: 0, pending: 3 });
  });

  it('runVoteVoid — 서버 닫기가 실패했는데 서버에서 아직 열려 있으면 무효로 적지 않는다', async () => {
    const s = open(base(), '2-1-안1', 'a');
    let state = s;
    const commit = async (fn: (x: PrepState) => PrepState) => (state = fn(state));
    const api = (status: string | null, fail: boolean): VoteApi => ({
      create: async () => ({ id: 'x', token: 'y' }),
      setStatus: async () => {
        if (fail) throw new Error('net');
        return {};
      },
      statusOf: async () => status as never,
      results: async () => null,
    });
    await expect(runVoteVoid(api('open', true), commit, () => state, 'a', () => LATER)).rejects.toThrow('net');
    expect(motionPhase(state, motion(state, '2-1-안1'))).toBe('open');
    // 응답만 잃고 서버는 이미 닫힘 → 무효 처리
    const r = await runVoteVoid(api('closed', true), commit, () => state, 'a', () => LATER);
    expect(r.ok).toBe(true);
    expect(motionPhase(state, motion(state, '2-1-안1'))).toBe('ready');
  });

  it('★ 만들기 전(creating, 번호 없음)에 멈춘 투표를 무효로 해도 준비판이 읽힌다 · 다음 안을 연다', () => {
    const started = beginVote(base(), ['2-1-안1'], 'stuck', NOW);
    if (!started.ok) throw new Error();
    expect(liveBallots(started.state)).toHaveLength(1);
    const v = voidBallot(started.state, 'stuck', LATER);
    if (!v.ok) throw new Error(v.error);
    expect(v.state.ballots.stuck).toMatchObject({ stage: 'creating', ballotId: null, voidedAt: LATER });
    const back = migratePrep(JSON.parse(serializePrep(v.state)));
    expect(back).not.toBeNull();
    expect(liveBallots(back!)).toEqual([]);
    expect(motionPhase(back!, motion(back!, '2-1-안1'))).toBe('ready');
    expect(beginVote(back!, ['2-1-안2'], 'next').ok).toBe(true);
    // 열기 전(draft, 번호 있음)은 마감으로
    const b = beginVote(base(), ['2-1-안1'], 'd', NOW);
    if (!b.ok) throw new Error();
    const draft = markBallotCreated(b.state, 'd', { id: 'BD', token: 'TD' });
    const vd = voidBallot(draft, 'd', LATER);
    if (!vd.ok) throw new Error();
    expect(vd.state.ballots.d.stage).toBe('closed');
    expect(migratePrep(JSON.parse(serializePrep(vd.state)))).not.toBeNull();
  });

  it('무효 차수는 옛 화면(칸 모름)에서도 읽힌다 — 새 열거값이 아니라 선택 칸', () => {
    const v = voidBallot(open(base(), '2-1-안1', 'a'), 'a', LATER);
    if (!v.ok) throw new Error();
    const back = migratePrep(JSON.parse(serializePrep(v.state)));
    expect(back).not.toBeNull();
    expect(back!.motions[0].rounds[0].voidedAt).toBe(LATER);
    expect(back!.ballots.a.createdAt).toBe(NOW);
    expect(voteUnits(back!, 1).map((u) => u.key)).toContain('new:2-1-안1');
  });
});

describe('operator-2·ops-6 — 무장 문구에 분과·안 번호·제목', () => {
  it('시작·마감·무효 문구', () => {
    expect(armedText('start', 2, '2-1-안2', '예시 제목 가-3 다회용기 회수 체계 정비와 보증금')).toBe(
      '2분과 2-1-안2 「예시 제목 가-3 다회용기 회수 …」 투표를 시작합니까? (다시 누르면 시작)',
    );
    expect(armedText('close', 1, '1-1-안1 2차', '짧은 제목')).toBe('1분과 1-1-안1 2차 「짧은 제목」 투표를 마감합니까? (다시 누르면 마감)');
    expect(armedText('void', 3, '3-2-안1', '가')).toContain('무효로 합니까?');
    expect(titleHead('줄\n바꿈   많은   제목')).toBe('줄 바꿈 많은 제목');
  });
});

describe('operator-5 — 투표를 시작한 안의 제목은 잠근다', () => {
  it('투표 중·가결 뒤에는 제목을 바꾸지 않고, 2차 준비에서만 고친다', () => {
    let s = open(base(), '2-1-안1', 'a');
    expect(canEditMotionTitle(motion(s, '2-1-안1'))).toBe(false);
    expect(updateMotion(s, '2-1-안1', { title: '오타 고침' })).toBe(s);
    // 다른 칸(기타 의견)은 그대로 고친다
    expect(motion(updateMotion(s, '2-1-안1', { otherOpinion: '메모' }), '2-1-안1').otherOpinion).toBe('메모');
    s = confirmHandCount(close(s, 'a', [[20, 20]]), '2-1-안1', 1, 'entered');
    expect(updateMotion(s, '2-1-안1', { title: 'x' })).toBe(s);
    s = requestRevote(s, '2-1-안1');
    s = updateMotion(s, '2-1-안1', { title: '2차 문구' });
    expect(motion(s, '2-1-안1').title).toBe('2차 문구');
    // 2차 그만두기 = 고쳐 둔 문구를 버리고 투표한 제목으로
    s = cancelRevote(s, '2-1-안1');
    expect(motion(s, '2-1-안1').title).toBe('다회용기 확대');
  });

  it('투표 전 안은 제목을 고친다', () => {
    const s = base();
    expect(motion(updateMotion(s, '2-1-안2', { title: '새 제목' }), '2-1-안2').title).toBe('새 제목');
  });
});

describe('operator-1 — 옛 준비판 파일로 투표 기록을 덮어쓰지 않는다', () => {
  it('지금 분과의 투표가 가져올 파일에 없으면 거절, 같거나 더 많으면 허용', () => {
    const old = base();
    const now = close(open(old, '2-1-안1', 'a'), 'a', [[40, 0]]);
    expect(replaceStateProblem(now, old)).toMatch(/투표 기록이 있는 분과는 옛 파일로 바꿀 수 없습니다/);
    expect(replaceStateProblem(now, now)).toBeNull();
    expect(replaceStateProblem(old, now)).toBeNull();
    expect(replaceStateProblem(null, old)).toBeNull();
    const parsed = parseImport(serializePrep(old));
    if (parsed.kind !== 'state') throw new Error();
    expect(replaceStateProblem(now, parsed.state)).not.toBeNull();
  });
});

describe('moderator-1 — 2차가 열린 동안 1차 거수 칸은 잠긴다', () => {
  function secondOpen(): PrepState {
    let s = confirmHandCount(close(open(base(), '2-1-안1', 'r1'), 'r1', [[27, 9]]), '2-1-안1', 1, 'entered');
    s = requestRevote(s, '2-1-안1');
    s = updateMotion(s, '2-1-안1', { title: '고친 문구' });
    const b = beginVote(s, ['2-1-안1'], 'r2');
    if (!b.ok) throw new Error(b.error);
    return markBallotOpened(markBallotCreated(b.state, 'r2', { id: 'B2', token: 'T2' }), 'r2', NOW);
  }

  it('2차 투표 중 1차에 거수 9 를 넣어도 1차 부결 그대로', () => {
    const s = secondOpen();
    const m = motion(s, '2-1-안1');
    expect(canEditRoundCounts(m, 1)).toBe(false);
    expect(canEditRoundCounts(m, 2)).toBe(true);
    const after = setHandCount(s, '2-1-안1', 1, { handYes: 9 });
    expect(after).toBe(s);
    expect(motion(after, '2-1-안1').rounds[0]).toMatchObject({ handYes: 0, verdict: 'failed' });
  });

  it('2차 준비 중·소수 의견으로 닫은 안도 1차 거수를 못 고친다(먼저 되돌린다)', () => {
    let s = confirmHandCount(close(open(base(), '2-1-안1', 'r1'), 'r1', [[27, 9]]), '2-1-안1', 1, 'entered');
    const revoting = requestRevote(s, '2-1-안1');
    expect(setHandCount(revoting, '2-1-안1', 1, { handYes: 9 })).toBe(revoting);
    const back = cancelRevote(revoting, '2-1-안1');
    expect(motion(setHandCount(back, '2-1-안1', 1, { handYes: 9 }), '2-1-안1').rounds[0].verdict).toBe('passed');
    const m = markMinority(s, '2-1-안1', true);
    if (!m.ok) throw new Error();
    s = m.state;
    expect(setHandCount(s, '2-1-안1', 1, { handYes: 9 })).toBe(s);
  });
});

describe('moderator-2 — 거수 확인 전에는 판정이 잠정이다', () => {
  it('마감 직후 = 거수 확인 전 · 2차·소수 의견을 막는다 · [거수 입력 완료] 뒤 연다', () => {
    let s = close(open(base(), '2-1-안1', 'a'), 'a', [[27, 9]]);
    const r = currentRound(motion(s, '2-1-안1'));
    expect(handPending(r)).toBe(true);
    expect(motionPhase(s, motion(s, '2-1-안1'))).toBe('failed');
    expect(canRevote(s, motion(s, '2-1-안1'))).toBe(false);
    expect(requestRevote(s, '2-1-안1')).toBe(s);
    expect(markMinority(s, '2-1-안1', true).ok).toBe(false);
    expect(resultCsvRows(s)[0][14]).toBe('부결(거수 확인 전)');
    expect(ceremonyGaps(s)).toEqual([
      { id: '2-1-안1', status: '거수 확인 전', blocking: false },
      { id: '2-1-안2', status: '투표 전', blocking: false },
      { id: '2-4-안1', status: '투표 전', blocking: false },
    ]);
    expect(boardSummary(2, s).handPending).toEqual(['2-1-안1']);
    // 거수 3 → 가결선 30 넘어 가결 → 확인
    s = setHandCount(s, '2-1-안1', 1, { handYes: 3 });
    s = confirmHandCount(s, '2-1-안1', 1, 'entered');
    expect(handPending(currentRound(motion(s, '2-1-안1')))).toBe(false);
    expect(motionPhase(s, motion(s, '2-1-안1'))).toBe('passed');
    expect(resultCsvRows(s)[0][14]).toBe('가결');
  });

  it('[거수 없음] = 거수 0·0 을 확인할 뿐 · 거수가 들어 있으면 지우지 않는다(10/14 재검)', () => {
    let s = close(open(base(), '2-1-안1', 'a'), 'a', [[20, 20]]);
    const withHand = setHandCount(s, '2-1-안1', 1, { handYes: 5 });
    expect(confirmHandCount(withHand, '2-1-안1', 1, 'none')).toBe(withHand);
    s = confirmHandCount(s, '2-1-안1', 1, 'none');
    expect(currentRound(motion(s, '2-1-안1'))).toMatchObject({ handYes: 0, handNo: 0, handConfirmed: true, verdict: 'failed' });
    expect(canRevote(s, motion(s, '2-1-안1'))).toBe(true);
  });

  it('투표 중(결과 전)에는 확인할 것이 없다 · 옛 저장(칸 없음)은 확인한 것으로 본다', () => {
    const s = open(base(), '2-1-안1', 'a');
    expect(confirmHandCount(s, '2-1-안1', 1, 'entered')).toBe(s);
    expect(handPending({ onlineYes: 1, onlineNo: 1 })).toBe(false);
  });
});

describe('moderator-5 — 세리머니에서 결론 없는 안이 조용히 빠지지 않는다', () => {
  it('투표 중·2차 준비·2차 투표 중 안은 세리머니에서 빼고 gaps 로 알린다(투표 중은 blocking)', () => {
    let s = confirmHandCount(close(open(base(), '2-1-안1', 'a'), 'a', [[40, 0]]), '2-1-안1', 1, 'entered');
    s = confirmHandCount(close(open(s, '2-1-안2', 'b'), 'b', [[10, 30]]), '2-1-안2', 1, 'entered');
    s = requestRevote(s, '2-1-안2');
    s = open(s, '2-4-안1', 'c');
    expect(storedCeremonyItems(s).map((i) => i.key)).toEqual(['2-1-안1:r1']);
    expect(ceremonyGaps(s)).toEqual([
      { id: '2-1-안2', status: '2차 준비', blocking: false },
      { id: '2-4-안1', status: '투표 중', blocking: true },
    ]);
  });
});

describe('ops-2 — 현황판이 시작 멈춤·집계 실패를 따로 센다', () => {
  it('시작 중은 「투표 중」이 아니라 starting(누른 시각과 함께), 집계 전은 「투표 전」이 아니라 counting', () => {
    const started = beginVote(base(), ['2-1-안1'], 'a', NOW);
    if (!started.ok) throw new Error();
    const sum = boardSummary(2, started.state);
    expect(sum.open).toEqual([]);
    expect(sum.starting).toEqual([{ label: '2-1-안1', since: NOW }]);
    expect(sum.pending).toBe(2);
    const t = Date.parse(NOW);
    expect(overdue(NOW, t + 31_000, 30_000)).toBe(true);
    expect(overdue(NOW, t + 29_000, 30_000)).toBe(false);
    expect(overdue(null, t + 999_999, 30_000)).toBe(false);
    // 마감했지만 결과 못 읽음
    let s = open(base(), '2-1-안1', 'b');
    s = { ...s, ballots: { ...s.ballots, b: { ...s.ballots.b, stage: 'closed' } } };
    expect(boardSummary(2, s)).toMatchObject({ counting: ['2-1-안1'], pending: 2, open: [] });
  });
});

describe('operator-4 — 충돌해도 이 기기 고침을 서버 최신 위에 다시 적용한다', () => {
  it('PC-B 거수 입력 중 PC-A 가 다음 안을 열어도 거수·의견이 남는다', () => {
    // 같은 출발점: 2-1-안1 마감(거수 확인 전)
    const start = close(open(base(), '2-1-안1', 'a'), 'a', [[27, 9]]);
    // PC-B 의 고침(아직 저장 안 됨)
    const edits = [
      (s: PrepState) => setHandCount(s, '2-1-안1', 1, { handYes: 3 }),
      (s: PrepState) => updateMotion(s, '2-1-안1', { otherOpinion: '거수 3명 추가' }),
      (s: PrepState) => confirmHandCount(s, '2-1-안1', 1, 'entered'),
    ];
    // PC-A 가 먼저 저장한 서버 최신: 2-1-안2 를 열었다
    const server = open(start, '2-1-안2', 'b');
    const rebased = replayEdits(server, edits);
    const m = motion(rebased, '2-1-안1');
    expect(currentRound(m)).toMatchObject({ handYes: 3, handConfirmed: true, verdict: 'passed' });
    expect(m.otherOpinion).toBe('거수 3명 추가');
    expect(motionPhase(rebased, motion(rebased, '2-1-안2'))).toBe('open');
  });

  it('고침 하나가 예외를 내면 그것만 건너뛴다 · 알림 문구에 분과와 건수', () => {
    const s = base();
    const out = replayEdits(s, [
      () => {
        throw new Error('x');
      },
      (x) => updateMotion(x, '2-1-안1', { otherOpinion: 'ok' }),
    ]);
    expect(motion(out, '2-1-안1').otherOpinion).toBe('ok');
    expect(replayNotice('2분과', 3)?.text).toContain('2분과: 다른 화면이 먼저 저장했습니다. 이 화면에서 고친 3건');
  });
});

describe('미리보기 가짜 공유 저장(?pair=1) — 실제 RPC 와 같은 충돌 모양', () => {
  it('판번호가 맞으면 저장·판번호 +1, 어긋나면 서버 최신 줄을 돌려준다', async () => {
    const server = createFakePrepServer({ 2: labPairState(Date.parse(NOW)) }, () => Date.parse(NOW));
    const api = server.apiFor('2분과');
    const got = await api.get();
    expect(got.rows[0].version).toBe(1);
    const st = migratePrep(got.rows[0].state)!;
    expect(handPending(currentRound(motion(st, '2-1-안1')))).toBe(true);
    const ok = await api.save('2분과', 1, st, 'PC-A');
    expect(ok).toMatchObject({ ok: true, version: 2 });
    const stale = await api.save('2분과', 1, st, 'PC-B');
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.current).toMatchObject({ version: 2, updated_by: 'PC-A' });
    await expect(api.save('1분과', 2, st, 'x')).rejects.toThrow('division mismatch');
  });
});
