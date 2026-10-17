import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { UnitCard } from './DivisionVotePanel';
import {
  PREP_VERSION,
  createAgendaMotion,
  createMotion,
  deleteMotion,
  groupMotionKey,
  importSimilarGroups,
  initPrepState,
  migratePrep,
  motionRef,
  onMotion,
  replaceStateProblem,
  resolveMotionId,
  serializePrep,
  setGridMark,
  updateMotion,
  type PrepState,
} from './division-vote-logic';
import {
  applyBallotResults,
  beginVote,
  confirmHandCount,
  currentRound,
  liveBallots,
  markBallotCreated,
  markBallotOpened,
  motionPhase,
  runStrayClose,
  runVoteStart,
  runVoteVoid,
  setHandCount,
  storedCeremonyItems,
  startStuck,
  elsewhereHint,
  strayOpenBallot,
  voidBallot,
  voteUnits,
  type VoteApi,
} from './division-vote-flow';
import { replayEdits } from './division-prep-sync';
import { DIVISION_VOTE_FIXTURE } from './division-vote-fixture';
import type { BallotResults } from '../../lib/deliberation';

/**
 * 10/14 밤 재검 지적(critical 3 · major 5)의 순수 규칙 시험.
 * 무효와 여는 중의 엇갈림 · [거수 없음] 다시 적용 · 옛 파일로 진행 되돌리기 · 다시 적용 때 안 번호 밀림 · 만들기 중복 · 판 번호.
 */

const div2 = DIVISION_VOTE_FIXTURE.find((d) => d.division === 2)!;
const NOW = '2026-10-17T05:05:09.000Z';
const LATER = '2026-10-17T05:06:00.000Z';

function make(state: PrepState, cardNos: string[], title: string, key?: string): PrepState {
  const r = createMotion(state, { cardNos, title, text: '', key });
  if (!r.ok) throw new Error(r.error);
  return r.state;
}

function base(): PrepState {
  let s = initPrepState(div2);
  s = make(s, ['2-1-1'], '다회용기 확대');
  s = make(s, ['2-1-2'], '회수 체계');
  return { ...s, attendance: { enrolled: 60, present: 45 } };
}

const motion = (s: PrepState, id: string) => s.motions.find((m) => m.id === id)!;

function results(s: PrepState, key: string, counts: [number, number][]): BallotResults {
  const record = s.ballots[key];
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
  const r = applyBallotResults(s, key, results(s, key, counts), LATER);
  if (!r.ok) throw new Error(r.error);
  return r.state;
}

/** 서버 호출을 적어 두는 가짜 API. hooks 로 호출 도중에 다른 화면의 일을 끼워 넣는다. */
function fakeApi(hooks: { onCreate?: () => void; onOpen?: () => void } = {}) {
  const calls: string[] = [];
  const api: VoteApi = {
    create: async (_input, key) => {
      calls.push(`create:${key}`);
      hooks.onCreate?.();
      return { id: `B-${key}`, token: `T-${key}` };
    },
    setStatus: async (id, status) => {
      calls.push(`${id}:${status}`);
      if (status === 'open') hooks.onOpen?.();
      return {};
    },
    statusOf: async () => null,
    results: async () => null,
  };
  return { api, calls };
}

describe('critical — 여는 중에 무효로 하면 열지 않는다', () => {
  it('무효 → 만들기 응답 → 열기 기록: 무효 투표는 열리지 않고 번호만 남긴 채 마감, 다음 안은 하나만 연다', () => {
    const b = beginVote(base(), ['2-1-안1'], 'a', NOW);
    if (!b.ok) throw new Error(b.error);
    const v = voidBallot(b.state, 'a', LATER);
    if (!v.ok) throw new Error(v.error);
    let s = markBallotCreated(v.state, 'a', { id: 'B-a', token: 'T-a' });
    s = markBallotOpened(s, 'a', LATER);
    expect(s.ballots.a).toMatchObject({ stage: 'closed', ballotId: 'B-a', voidedAt: LATER });
    expect(liveBallots(s)).toEqual([]);
    expect(motionPhase(s, motion(s, '2-1-안1'))).toBe('ready');
    // 준비판으로 다시 읽힌다(마감 + 번호)
    expect(migratePrep(JSON.parse(serializePrep(s)))).not.toBeNull();
  });

  it('runVoteStart — 만드는 사이(create 응답 전)에 무효가 들어오면 열지 않고 서버 투표를 닫는다', async () => {
    const b = beginVote(base(), ['2-1-안1'], 'a', NOW);
    if (!b.ok) throw new Error(b.error);
    let state = b.state;
    const commit = async (fn: (x: PrepState) => PrepState) => (state = fn(state));
    const { api, calls } = fakeApi({
      onCreate: () => {
        const v = voidBallot(state, 'a', LATER);
        if (!v.ok) throw new Error(v.error);
        state = v.state;
      },
    });
    const record = await runVoteStart(api, commit, () => state, 'a', () => LATER);
    expect(calls).toEqual(['create:a', 'B-a:closed']);
    expect(calls).not.toContain('B-a:open');
    expect(record.voidedAt).toBe(LATER);
    expect(record.stage).toBe('closed');
    expect(liveBallots(state)).toEqual([]);
  });

  it('runVoteStart — 만든 뒤·열기 전에 다른 화면이 무효로 하면 열지 않는다', async () => {
    const b = beginVote(base(), ['2-1-안1'], 'a', NOW);
    if (!b.ok) throw new Error(b.error);
    let state = b.state;
    const commit = async (fn: (x: PrepState) => PrepState) => (state = fn(state));
    let reads = 0;
    const getState = () => {
      reads += 1;
      if (reads === 2) {
        // markBallotCreated 저장이 끝난 뒤·열기 전에 운영팀 무효가 들어왔다(이 화면이 다시 읽을 때 보인다)
        const v = voidBallot(state, 'a', LATER);
        if (!v.ok) throw new Error(v.error);
        state = v.state;
      }
      return state;
    };
    const { api, calls } = fakeApi();
    const record = await runVoteStart(api, commit, getState, 'a', () => LATER);
    // 이 화면은 열지 않고, 열기 전 투표를 닫아 둔다(무효 쪽 runVoteVoid 도 번호를 보고 닫는다)
    expect(calls).toEqual(['create:a', 'B-a:closed']);
    expect(calls).not.toContain('B-a:open');
    expect(record.voidedAt).toBe(LATER);
    expect(liveBallots(state)).toEqual([]);
  });

  it('runVoteStart — 여는 사이에 무효가 들어오면 열기를 기록하지 않고 서버를 한 번 더 닫는다', async () => {
    const b = beginVote(base(), ['2-1-안1'], 'a', NOW);
    if (!b.ok) throw new Error(b.error);
    let state = b.state;
    const commit = async (fn: (x: PrepState) => PrepState) => (state = fn(state));
    const { api, calls } = fakeApi({
      onOpen: () => {
        const v = voidBallot(state, 'a', LATER);
        if (!v.ok) throw new Error(v.error);
        state = v.state;
      },
    });
    const record = await runVoteStart(api, commit, () => state, 'a', () => LATER);
    expect(calls).toEqual(['create:a', 'B-a:open', 'B-a:closed']);
    expect(record).toMatchObject({ stage: 'closed', voidedAt: LATER });
    expect(motionPhase(state, motion(state, '2-1-안1'))).toBe('ready');
  });

  it('정상 시작은 그대로 연다', async () => {
    const b = beginVote(base(), ['2-1-안1'], 'a', NOW);
    if (!b.ok) throw new Error(b.error);
    let state = b.state;
    const commit = async (fn: (x: PrepState) => PrepState) => (state = fn(state));
    const { api, calls } = fakeApi();
    const record = await runVoteStart(api, commit, () => state, 'a', () => LATER);
    expect(calls).toEqual(['create:a', 'B-a:open']);
    expect(record.stage).toBe('open');
    expect(record.voidedAt).toBeUndefined();
  });

  it('옛 화면이 남긴 「무효인데 열림」 투표는 열린 투표로 세고 [서버 투표 닫기]로 닫는다', async () => {
    const s0 = open(base(), '2-1-안1', 'a');
    let state: PrepState = { ...s0, ballots: { ...s0.ballots, a: { ...s0.ballots.a, voidedAt: LATER } } };
    state = { ...state, motions: state.motions.map((m) => (m.id === '2-1-안1' ? { ...m, rounds: m.rounds.map((r) => ({ ...r, voidedAt: LATER })) } : m)) };
    expect(liveBallots(state).map((b) => b.requestId)).toEqual(['a']);
    expect(strayOpenBallot(state.ballots.a)).toBe(true);
    expect(beginVote(state, ['2-1-안2'], 'b').ok).toBe(false);
    const commit = async (fn: (x: PrepState) => PrepState) => (state = fn(state));
    const { api, calls } = fakeApi();
    await runStrayClose(api, commit, () => state, 'a', () => LATER);
    expect(calls).toEqual(['B-a:closed']);
    expect(liveBallots(state)).toEqual([]);
    expect(beginVote(state, ['2-1-안2'], 'b').ok).toBe(true);
  });
});

describe('critical — 운영팀 화면(묵은 기록)에서 무효로 해도 다른 화면이 연 서버 투표를 닫는다', () => {
  async function race(closeFails: boolean, status: string | null) {
    // 운영팀 화면은 아직 「만드는 중(번호 없음)」으로 본다
    const b = beginVote(base(), ['2-1-안1'], 'a', NOW);
    if (!b.ok) throw new Error(b.error);
    const stale = b.state;
    // 서버 최신: 분과 PC 가 이미 만들고 열었다
    let server = open(stale, '2-1-안1', 'a');
    const commit = async (fn: (x: PrepState) => PrepState) => (server = fn(server));
    const calls: string[] = [];
    const api: VoteApi = {
      create: async () => ({ id: 'x', token: 'y' }),
      setStatus: async (id, st) => {
        calls.push(`${id}:${st}`);
        if (closeFails) throw new Error('net');
        return {};
      },
      statusOf: async () => status as never,
      results: async () => null,
    };
    const out = await runVoteVoid(api, commit, () => stale, 'a', () => LATER);
    return { out, calls, server };
  }

  it('무효를 적은 뒤 번호가 보이면 서버 투표를 닫는다', async () => {
    const { out, calls, server } = await race(false, null);
    expect(out.ok).toBe(true);
    expect(calls).toEqual(['B-a:closed']);
    expect(server.ballots.a).toMatchObject({ stage: 'closed', voidedAt: LATER });
    expect(liveBallots(server)).toEqual([]);
  });

  it('닫지 못했고 서버가 열려 있으면 「무효인데 열림」으로 남겨 [서버 투표 닫기]가 뜬다', async () => {
    const { out, server } = await race(true, 'open');
    expect(out.ok).toBe(true);
    expect(server.ballots.a).toMatchObject({ stage: 'open', voidedAt: LATER });
    expect(strayOpenBallot(server.ballots.a)).toBe(true);
    expect(liveBallots(server).map((x) => x.requestId)).toEqual(['a']);
    expect(motionPhase(server, motion(server, '2-1-안1'))).toBe('ready');
    expect(migratePrep(JSON.parse(serializePrep(server)))).not.toBeNull();
  });

  it('닫지 못했어도 서버가 이미 닫혀 있으면 그대로 마감', async () => {
    const { server } = await race(true, 'closed');
    expect(server.ballots.a.stage).toBe('closed');
  });
});

describe('major — [거수 없음]이 다른 화면의 거수를 지우지 않는다', () => {
  it('서버에 거수 5 가 들어온 뒤 다시 적용된 [거수 없음]은 아무것도 바꾸지 않는다(가결 유지)', () => {
    const closed = close(open(base(), '2-1-안1', 'a'), 'a', [[27, 3]]);
    // 이 화면은 0·0 을 보고 [거수 없음]을 눌렀다
    const pending = [(s: PrepState) => confirmHandCount(s, '2-1-안1', 1, 'none')];
    // 다른 화면이 먼저 거수 5 를 저장했다
    const server = setHandCount(closed, '2-1-안1', 1, { handYes: 5 });
    expect(currentRound(motion(server, '2-1-안1'))?.verdict).toBe('passed');
    const rebased = replayEdits(server, pending);
    expect(currentRound(motion(rebased, '2-1-안1'))).toMatchObject({ handYes: 5, verdict: 'passed', handConfirmed: false });
  });
});

describe('major — 옛 준비판 파일이 투표 진행을 되돌리지 못한다', () => {
  it('(a) 마감 뒤 백업 → 무효 → 백업 가져오기는 거절(무효 투표가 다시 세지지 않게)', () => {
    const backup = close(open(base(), '2-1-안1', 'a'), 'a', [[40, 0]]);
    const v = voidBallot(backup, 'a', LATER);
    if (!v.ok) throw new Error(v.error);
    const problem = replaceStateProblem(v.state, backup);
    expect(problem).toMatch(/투표 기록이 있는 분과는 옛 파일로 바꿀 수 없습니다/);
    expect(problem).toContain('2-1-안1');
    expect(storedCeremonyItems(backup).map((i) => i.key)).toEqual(['2-1-안1:r1']); // 받아들였다면 되살아났을 결과
  });

  it('(b) 투표 중 백업 → 마감·거수 확인 → 백업 가져오기는 거절', () => {
    const backup = open(base(), '2-1-안1', 'a');
    let now = close(backup, 'a', [[27, 3]]);
    now = confirmHandCount(setHandCount(now, '2-1-안1', 1, { handYes: 5 }), '2-1-안1', 1, 'entered');
    expect(replaceStateProblem(now, backup)).toContain('2-1-안1');
    // 거수 확인만 되돌리는 파일도 거절
    const unconfirmed = close(backup, 'a', [[27, 3]]);
    expect(replaceStateProblem(now, unconfirmed)).toContain('2-1-안1');
  });

  it('같거나 앞선 파일은 받는다', () => {
    const a = open(base(), '2-1-안1', 'a');
    const b = close(a, 'a', [[27, 3]]);
    expect(replaceStateProblem(a, b)).toBeNull();
    expect(replaceStateProblem(b, b)).toBeNull();
  });
});

describe('critical — 저장 충돌 뒤 다시 적용해도 고침이 다른 화면의 안으로 가지 않는다', () => {
  it('운영팀이 같은 주제에 먼저 안을 만들었다 — 이 화면의 안은 안2 로, 본문도 안2 에', () => {
    const start = base();
    const opsFirst = make({ ...start, motions: start.motions.filter((m) => m.topicNo !== '2-1') }, ['2-1-2'], 'OPS 안');
    expect(opsFirst.motions.find((m) => m.title === 'OPS 안')?.id).toBe('2-1-안1');
    // 이 화면에서는 같은 주제가 비어 보였다 → 「PC-A 안」이 안1 로 만들어졌다
    const local = { ...start, motions: start.motions.filter((m) => m.topicNo !== '2-1') };
    const spec = { cardNos: ['2-1-1'], title: 'PC-A 안', text: '', key: 'k-pca' };
    const made = createMotion(local, spec);
    if (!made.ok) throw new Error(made.error);
    expect(made.motion.id).toBe('2-1-안1');
    const ref = motionRef(made.motion);
    const pending = [
      (s: PrepState) => {
        const r = createMotion(s, spec);
        return r.ok ? r.state : s;
      },
      onMotion(ref, (s, id) => updateMotion(s, id, { text: 'PC-A 본문' })),
      onMotion(ref, (s, id) => setGridMark(s, id, '1', 'equity', 'met')),
    ];
    const rebased = replayEdits(opsFirst, pending);
    expect(motion(rebased, '2-1-안1')).toMatchObject({ title: 'OPS 안', text: '', grid: {} });
    expect(motion(rebased, '2-1-안2')).toMatchObject({ title: 'PC-A 안', text: 'PC-A 본문', key: 'k-pca' });
    expect(motion(rebased, '2-1-안2').grid).toEqual({ '1': { equity: 'met' } });
  });

  it('묶음에서 만든 안도 열쇠(group:id)로 찾는다 — 어느 화면에서 가져와도 같은 열쇠', () => {
    const g = { id: '유사9', division: 2, name: '공통 취지', recs: ['2-1-1-1'], cards: ['2-1-1'], teams: ['1'] };
    const imported = importSimilarGroups(initPrepState(div2), [g]).state;
    const m = imported.motions[0];
    expect(m.key).toBe(groupMotionKey('유사9'));
    expect(resolveMotionId(imported, motionRef(m))).toBe(m.id);
    // 열쇠 없는 옛 안은 안 번호로 찾는다
    const old = base();
    expect(motionRef(old.motions[0])).toBe('2-1-안1');
    expect(onMotion('2-1-안1', (s, id) => deleteMotion(s, id))(old).motions.map((x) => x.id)).toEqual(['2-1-안2']);
    expect(onMotion('없는열쇠', (s, id) => deleteMotion(s, id))(old)).toBe(old);
  });
});

describe('major — 만들기는 같은 열쇠로 두 번 적용돼도 하나만 만든다', () => {
  it('저장 응답만 잃고 다시 적용(카드 안·카드 없는 안건)', () => {
    const spec = { cardNos: ['2-1-1'], title: 'PC-A 안', text: '', key: 'k1' };
    const once = createMotion(initPrepState(div2), spec);
    if (!once.ok) throw new Error(once.error);
    const twice = createMotion(once.state, spec);
    expect(twice.ok && twice.state).toBe(once.state);
    expect(once.state.motions.map((m) => m.id)).toEqual(['2-1-안1']);
    const agenda = { title: '분과별 최종 권고안 의결', text: '', key: 'k2' };
    const a1 = createAgendaMotion(once.state, agenda);
    if (!a1.ok) throw new Error(a1.error);
    const a2 = createAgendaMotion(a1.state, agenda);
    expect(a2.ok && a2.state).toBe(a1.state);
    expect(a1.state.motions.filter((m) => m.cardNos.length === 0)).toHaveLength(1);
    // 열쇠 없이(옛 호출) 두 번 부르면 두 개 — 화면은 늘 열쇠를 넘긴다
    const plain = createMotion(once.state, { cardNos: ['2-1-1'], title: 'x', text: '' });
    expect(plain.ok && plain.state.motions).toHaveLength(2);
  });
});

describe('major — 판 번호 3', () => {
  it('2 판을 읽어 3 으로 쓰고, 열쇠·무효·거수 확인·묶음이 왕복한다 · 모르는 판(4)은 거절', () => {
    let s = make(base(), ['2-4-1'], '순환센터', 'k-x');
    s = close(open(s, '2-1-안1', 'a'), 'a', [[27, 3]]);
    const v = voidBallot(s, 'a', LATER);
    if (!v.ok) throw new Error(v.error);
    s = importSimilarGroups(v.state, [{ id: '유사1', division: 2, name: '공통', recs: [], cards: ['2-1-2'], teams: [] }]).state;
    const j = JSON.parse(serializePrep(s));
    // 10/17 — 판 번호 5(묶음 기록·A–G 칸 = 4, 전문가 의견 = 5). 3·4 는 그대로 읽는다.
    expect(j.v).toBe(6);
    expect(PREP_VERSION).toBe(6);
    const back = migratePrep(j);
    expect(back).toEqual(s);
    // 옛 판 번호(2·3·4)로 적힌 같은 내용도 읽고, 쓰면 5
    const asV2 = migratePrep({ ...j, v: 2 });
    expect(asV2?.v).toBe(6);
    expect(migratePrep({ ...j, v: 3 })?.v).toBe(6);
    expect(migratePrep({ ...j, v: 4 })?.v).toBe(6);
    expect(migratePrep({ ...j, v: 5 })?.v).toBe(6);
    expect(migratePrep({ ...j, v: 7 })).toBeNull();
    // 빈 열쇠는 거절
    const badKey = JSON.parse(serializePrep(s));
    badKey.motions[0].key = '';
    expect(migratePrep(badKey)).toBeNull();
  });
});

describe('critical — 이 화면이 여는 중에는 무효·이어서 하기를 막고, 30초 전에는 「멈춤」이라 하지 않는다', () => {
  it('startStuck — 여는 중(이 화면) · 30초 전 · 30초 뒤 · 시각 없는 옛 기록', () => {
    const t = Date.parse(NOW);
    const creating = { stage: 'creating' as const, createdAt: NOW };
    expect(startStuck(creating, true, t + 60_000)).toBe(false);
    expect(startStuck(creating, false, t + 5_000)).toBe(false);
    expect(startStuck(creating, false, t + 31_000)).toBe(true);
    expect(startStuck({ stage: 'draft' }, false, t)).toBe(true);
    expect(startStuck({ stage: 'open', createdAt: NOW }, false, t + 999_999)).toBe(false);
  });

  it('시작 중 단위 카드 — 이 화면이 여는 중이면 [이어서 하기]가 눌리지 않고 [잘못 연 투표 무효]는 30초 멈춘 뒤에만 보인다', () => {
    const b = beginVote(base(), ['2-1-안1'], 'req1', NOW);
    if (!b.ok) throw new Error(b.error);
    const unit = voteUnits(b.state, 1).find((u) => u.motionIds.includes('2-1-안1'))!;
    expect(unit.key).toBe('req1');
    const render = (busy: 'start' | null, nowMs = Date.parse(NOW)) =>
      renderToStaticMarkup(
        createElement(UnitCard, {
          unit,
          state: b.state,
          update: () => undefined,
          ready: true,
          isOps: false,
          otherLive: null,
          canNetwork: true,
          busy,
          msg: null,
          responses: 0,
          nowMs,
          onStart: () => undefined,
          onClose: () => undefined,
          onVoid: () => undefined,
          onQr: () => undefined,
        }),
      );
    const disabledOf = (html: string, testId: string) => new RegExp(`<button[^>]*data-testid="${testId}"[^>]*disabled=""|<button[^>]*disabled=""[^>]*data-testid="${testId}"`).test(html);
    const later = Date.parse(NOW) + 31_000;
    const busyHtml = render('start', later);
    expect(busyHtml).not.toContain('data-testid="vote-void"');
    expect(disabledOf(busyHtml, 'vote-start')).toBe(true);
    expect(render(null)).not.toContain('data-testid="vote-void"'); // 누른 지 30초 전
    const stuck = render(null, later);
    expect(stuck).toContain('data-testid="vote-void"');
    expect(disabledOf(stuck, 'vote-void')).toBe(false);
  });
});

describe('10/15 E2E h3b — 운영팀이 대신 연 투표를 분과 PC 가 [QR 띄우기]로 한 번 띄우면 「다른 화면에서 연 투표」 안내가 다시 나오지 않는다', () => {
  it('elsewhereHint — 운영팀 화면 · 열린 투표만 · 이 화면에서 띄운 적 있음 · 지금 QR 이 떠 있음', () => {
    // 분과 PC, 다른 화면이 연 투표, 아직 띄운 적 없음 → 안내
    expect(elsewhereHint(false, 'open', false, false)).toBe(true);
    // [QR 띄우기]로 띄운 뒤 나가기(ESC) — 띄운 적 있음 → 안내 없음(이전에는 다시 나왔다)
    expect(elsewhereHint(false, 'open', true, false)).toBe(false);
    // QR 이 떠 있는 동안
    expect(elsewhereHint(false, 'open', false, true)).toBe(false);
    // 운영팀 화면은 큰 화면에 연결하지 않는다
    expect(elsewhereHint(true, 'open', false, false)).toBe(false);
    // 여는 중·마감은 안내 대상 아님
    expect(elsewhereHint(false, 'creating', false, false)).toBe(false);
    expect(elsewhereHint(false, 'closed', false, false)).toBe(false);
  });
});
