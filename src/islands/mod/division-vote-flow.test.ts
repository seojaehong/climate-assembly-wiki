import { describe, expect, it, vi } from 'vitest';
import {
  PREP_VERSION,
  canDeleteMotion,
  ceremonyVerdict,
  createMotion,
  criteriaCount,
  decideVote,
  deleteMotion,
  excludedCardNos,
  finalCriterion,
  initPrepState,
  migratePrep,
  motionExcluded,
  parseImport,
  passLineText,
  attendanceReady,
  readStoredPrep,
  serializePrep,
  setCardStatus,
  setCriterionOverride,
  setGridMark,
  summarizeCeremony,
  teamMajority,
  updateMotion,
  type PrepState,
} from './division-vote-logic';
import {
  CSV_COLUMNS,
  CRITERIA_COLUMN_LABELS,
  MAX_ROUNDS,
  applyBallotResults,
  beginVote,
  boardSummary,
  canRevote,
  cancelRevote,
  createInputOf,
  csvCell,
  elapsedText,
  formatKst,
  markBallotClosed,
  markBallotCreated,
  markBallotOpened,
  markMinority,
  motionPhase,
  parseHandInput,
  setAttendanceField,
  qrRowOf,
  reapplyAttendance,
  requestRevote,
  resultCsvRows,
  resultsFileName,
  roundVerdict,
  runVoteClose,
  runVoteStart,
  setHandCount,
  storedCeremonyItems,
  toCsv,
  unmarkMinority,
  voteUnits,
  type VoteApi,
} from './division-vote-flow';
import { DIVISION_VOTE_FIXTURE } from './division-vote-fixture';
import type { BallotResults } from '../../lib/deliberation';

const div2 = DIVISION_VOTE_FIXTURE.find((d) => d.division === 2)!;
const NOW = '2026-10-17T05:05:09.000Z'; // KST 14:05:09

function make(state: PrepState, cardNos: string[], title = '안 제목'): PrepState {
  const r = createMotion(state, { cardNos, title, text: '' });
  if (!r.ok) throw new Error(r.error);
  return r.state;
}

/** 2-1-안1(카드 2-1-1), 2-1-안2(2-1-2), 2-4-안1(2-4-1). 재적 60·참석 45. */
function base(att: { enrolled: number | null; present: number | null } = { enrolled: 60, present: 45 }): PrepState {
  let s = initPrepState(div2);
  s = make(s, ['2-1-1'], '다회용기 확대');
  s = make(s, ['2-1-2'], '회수 체계');
  s = make(s, ['2-4-1'], '순환센터');
  return { ...s, attendance: att };
}

function results(record: { ballotId: string | null; statements: string[] }, counts: [number, number][]): BallotResults {
  return {
    id: record.ballotId ?? 'b',
    title: 't',
    status: 'closed',
    subgroup: '2분과',
    responses: Math.max(0, ...counts.map(([y, n]) => y + n)),
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

/** 시작 → 만들기 → 열기 → 결과까지 한 번에(순수 함수만). */
function voteThrough(s: PrepState, ids: string[], counts: [number, number][], key = 'req-1'): PrepState {
  const b = beginVote(s, ids, key);
  if (!b.ok) throw new Error(b.error);
  let x = markBallotCreated(b.state, key, { id: `ballot-${key}`, token: `tok-${key}` });
  x = markBallotOpened(x, key, NOW);
  const r = applyBallotResults(x, key, results(x.ballots[key], counts), NOW);
  if (!r.ok) throw new Error(r.error);
  return r.state;
}

// ─────────────────────────────────────────────────────────────

describe('준비판 v2 — 옛 저장(v1)도 읽는다', () => {
  const v1 = () => {
    const s = base();
    return {
      v: 1,
      division: s.division,
      source: s.source,
      cards: s.cards,
      motions: s.motions.map((m, i) => ({
        id: m.id,
        topicNo: m.topicNo,
        cardNos: m.cardNos,
        title: m.title,
        text: m.text,
        criteria: { effectiveness: i === 0, equity: false, acceptability: i === 0, sustainability: false, feasibility: false },
      })),
    };
  };

  it('v1 → v2: 체크(true)는 「직접 정함 충족」, false 는 빈칸(★미충족 아님)', () => {
    const s = migratePrep(v1());
    expect(s).not.toBeNull();
    expect(s!.v).toBe(PREP_VERSION);
    expect(s!.motions[0].override).toEqual({ effectiveness: 'met', acceptability: 'met' });
    expect(s!.motions[1].override).toEqual({});
    expect(finalCriterion(s!.motions[0], 'effectiveness')).toEqual({ value: 'met', direct: true });
    expect(finalCriterion(s!.motions[1], 'equity')).toEqual({ value: 'none', direct: false });
    expect(s!.attendance).toEqual({ enrolled: null, present: null });
    expect(s!.ballots).toEqual({});
    expect(s!.motions.every((m) => m.rounds.length === 0 && m.resolution === null && !m.revote)).toBe(true);
  });

  it('v1 파일 가져오기·저장소 읽기 모두 v2 로 돌아온다', () => {
    const text = JSON.stringify(v1());
    const p = parseImport(text);
    expect(p.kind).toBe('state');
    expect(readStoredPrep(text)?.v).toBe(2);
  });

  it('v2 를 투표·결과까지 채워 내보내도 그대로 돌아온다', () => {
    let s = voteThrough(base(), ['2-1-안1'], [[35, 5]]);
    s = setGridMark(s, '2-1-안1', '3', 'equity', 'unmet');
    s = setCriterionOverride(s, '2-1-안1', 'feasibility', 'met');
    s = updateMotion(s, '2-1-안1', { otherOpinion: '쉼표, "따옴표"\n줄바꿈', minorityOpinion: '' });
    expect(parseImport(serializePrep(s))).toEqual({ kind: 'state', state: s });
    expect(migratePrep(JSON.parse(JSON.stringify(s)))).toEqual(s);
  });

  it('★ v2 에서 한 곳이라도 틀리면 통째로 거절한다', () => {
    const s = voteThrough(base(), ['2-1-안1'], [[35, 5]]);
    const j = () => JSON.parse(serializePrep(s));
    const bad1 = j();
    bad1.motions[0].grid = { '6': { equity: 'met' } }; // 없는 조
    const bad2 = j();
    bad2.motions[0].override = { equity: 'yes' };
    const bad3 = j();
    bad3.motions[0].rounds[0].requestId = 'nope'; // 가리키는 투표가 없음
    const bad4 = j();
    bad4.attendance = { enrolled: -1, present: 3 };
    const bad5 = j();
    bad5.ballots['req-1'].stage = 'open';
    bad5.ballots['req-1'].ballotId = null; // 열렸는데 id 없음
    const bad6 = j();
    bad6.v = 3;
    for (const b of [bad1, bad2, bad3, bad4, bad5, bad6]) expect(migratePrep(b)).toBeNull();
    expect(migratePrep(null)).toBeNull();
    expect(migratePrep('문자열')).toBeNull();
  });
});

describe('참석 — 비어서 시작하고, 재적 과반수 참석이어야 투표를 연다', () => {
  it('새 준비판의 재적·참석은 비어 있다(미리 채우지 않는다)', () => {
    expect(initPrepState(div2).attendance).toEqual({ enrolled: null, present: null });
  });

  it('가결선 문구', () => {
    expect(passLineText(null, null)).toBe('재적과 참석 인원을 넣으십시오.');
    expect(passLineText(60, 45)).toBe('가결선: 찬성 30표 이상 (참석 45명의 3분의 2)');
    expect(passLineText(60, 30)).toContain('정족수 미달');
    expect(passLineText(60, 61)).toContain('재적보다 많습니다');
  });

  it('입력 칸: 빈칸은 미입력, 0 이상 정수만 받는다', () => {
    let s = initPrepState(div2);
    s = setAttendanceField(s, 'enrolled', '60');
    s = setAttendanceField(s, 'present', ' 45 ');
    expect(s.attendance).toEqual({ enrolled: 60, present: 45 });
    expect(setAttendanceField(s, 'present', '-3')).toBe(s);
    expect(setAttendanceField(s, 'present', '4.5')).toBe(s);
    expect(setAttendanceField(s, 'present', '사십')).toBe(s);
    expect(setAttendanceField(s, 'present', '45')).toBe(s);
    expect(setAttendanceField(s, 'present', '').attendance.present).toBeNull();
    expect(parseHandInput('')).toBe(0);
    expect(parseHandInput('3')).toBe(3);
    expect(parseHandInput('-1')).toBeNull();
    expect(parseHandInput('1.5')).toBeNull();
  });

  it('투표 시작 가능 여부', () => {
    expect(attendanceReady({ enrolled: null, present: 40 })).toBe(false);
    expect(attendanceReady({ enrolled: 60, present: null })).toBe(false);
    expect(attendanceReady({ enrolled: 60, present: 30 })).toBe(false);
    expect(attendanceReady({ enrolled: 60, present: 31 })).toBe(true);
    const r = beginVote(base({ enrolled: null, present: null }), ['2-1-안1'], 'k');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('재적·참석');
  });
});

describe('권고 수준 표 — 조1~조5 다수결 + 직접 정함', () => {
  it('충족이 많으면 충족, 미충족이 많으면 미충족, 같으면 동수, 다 비면 「-」', () => {
    let s = base();
    const id = '2-1-안1';
    expect(teamMajority(s.motions[0].grid, 'equity')).toBe('none');
    s = setGridMark(s, id, '1', 'equity', 'met');
    s = setGridMark(s, id, '2', 'equity', 'unmet');
    expect(teamMajority(s.motions[0].grid, 'equity')).toBe('tie');
    s = setGridMark(s, id, '3', 'equity', 'met');
    expect(teamMajority(s.motions[0].grid, 'equity')).toBe('met');
    s = setGridMark(s, id, '4', 'equity', 'unmet');
    s = setGridMark(s, id, '5', 'equity', 'unmet');
    expect(teamMajority(s.motions[0].grid, 'equity')).toBe('unmet');
    // 빈칸으로 되돌리면 계산에서 빠진다
    s = setGridMark(s, id, '5', 'equity', null);
    expect(teamMajority(s.motions[0].grid, 'equity')).toBe('tie');
    expect(s.motions[0].grid['5']).toBeUndefined();
  });

  it('직접 정한 값이 다수결을 이긴다 · 지우면 다수결로 돌아간다', () => {
    let s = setGridMark(base(), '2-1-안1', '1', 'feasibility', 'unmet');
    s = setCriterionOverride(s, '2-1-안1', 'feasibility', 'met');
    expect(finalCriterion(s.motions[0], 'feasibility')).toEqual({ value: 'met', direct: true });
    expect(criteriaCount(s.motions[0])).toBe(1);
    s = setCriterionOverride(s, '2-1-안1', 'feasibility', null);
    expect(finalCriterion(s.motions[0], 'feasibility')).toEqual({ value: 'unmet', direct: false });
  });

  it('없는 조·기준은 무시한다', () => {
    const s = base();
    expect(setGridMark(s, '2-1-안1', '9' as never, 'equity', 'met')).toBe(s);
    expect(setCriterionOverride(s, '2-1-안1', 'nope' as never, 'met')).toBe(s);
  });
});

describe('시행중-제외 — 실제로 뺀다', () => {
  it('제외 카드는 의결안에 넣을 수 없다', () => {
    const s = setCardStatus(initPrepState(div2), '2-1-1', { status: 'excluded' });
    const r = createMotion(s, { cardNos: ['2-1-1', '2-1-2'], title: 't', text: '' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('2-1-1');
  });

  it('원 카드가 전부 제외면 안도 제외 — 투표 단위·세리머니에서 빠진다', () => {
    let s = base();
    s = setCardStatus(s, '2-1-2', { status: 'excluded' });
    const m = s.motions.find((x) => x.id === '2-1-안2')!;
    expect(motionExcluded(s, m)).toBe(true);
    expect(motionPhase(s, m)).toBe('excluded');
    expect(voteUnits(s, 1).flatMap((u) => u.motionIds)).toEqual(['2-1-안1', '2-4-안1']);
    const r = beginVote(s, ['2-1-안2'], 'k');
    expect(r.ok).toBe(false);
    expect(excludedCardNos(s)).toEqual(['2-1-2']);
  });

  it('통합 안에서 일부만 제외면 안은 남는다', () => {
    let s = make(initPrepState(div2), ['2-1-1', '2-1-2'], '통합');
    s = setCardStatus(s, '2-1-1', { status: 'excluded' });
    expect(motionExcluded(s, s.motions[0])).toBe(false);
  });

  it('제외 안은 결과 CSV 에 「제외」로, 현황판에는 따로 센다', () => {
    const s = setCardStatus(base(), '2-4-1', { status: 'excluded' });
    const row = resultCsvRows(s).find((r) => r[1] === '2-4-안1')!;
    expect(row[14]).toBe('제외');
    const b = boardSummary(2, s);
    expect(b.excludedCount).toBe(1);
    expect(b.motionCount).toBe(2);
  });
});

describe('투표 단위 — 기본은 하나씩', () => {
  it('하나씩: 안마다 단위 하나', () => {
    expect(voteUnits(base(), 1).map((u) => u.motionIds)).toEqual([['2-1-안1'], ['2-1-안2'], ['2-4-안1']]);
  });

  it('묶음: 주제를 쪼개지 않고, 이미 시작한 안은 그 투표끼리', () => {
    let s = base();
    expect(voteUnits(s, 5).map((u) => u.motionIds)).toEqual([['2-1-안1', '2-1-안2', '2-4-안1']]);
    const b = beginVote(s, ['2-1-안1', '2-1-안2'], 'kk');
    if (!b.ok) throw new Error(b.error);
    s = b.state;
    const units = voteUnits(s, 1);
    expect(units.map((u) => u.motionIds)).toEqual([['2-1-안1', '2-1-안2'], ['2-4-안1']]);
    expect(units[0].requestId).toBe('kk');
  });
});

describe('투표 시작 — 한 번 누르면 만들기 → 열기 → QR', () => {
  it('시작 전에 투표 기록·차수를 먼저 적는다(만들기 전)', () => {
    const r = beginVote(base(), ['2-1-안1'], 'req-1');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const b = r.state.ballots['req-1'];
    expect(b.stage).toBe('creating');
    expect(b.title).toBe('2분과 의결 2-1-안1');
    expect(b.statements).toEqual(['2-1-안1 다회용기 확대']);
    expect(b.subgroup).toBe('2분과');
    expect(r.state.motions[0].rounds).toHaveLength(1);
    expect(motionPhase(r.state, r.state.motions[0])).toBe('starting');
    expect(createInputOf(b)).toEqual({
      title: '2분과 의결 2-1-안1',
      instructions: '안마다 찬성 또는 반대를 고릅니다.',
      subgroup: '2분과',
      items: [{ ordinal: 1, statement: '2-1-안1 다회용기 확대', scale: 2, required: true }],
    });
  });

  it('★ 시작 중에 다시 누르면 새 투표가 아니라 같은 멱등키로 이어 간다', () => {
    const r1 = beginVote(base(), ['2-1-안1'], 'req-1');
    if (!r1.ok) throw new Error();
    const r2 = beginVote(r1.state, ['2-1-안1'], 'req-2');
    expect(r2).toEqual({ ok: true, state: r1.state, requestId: 'req-1', resumed: true });
  });

  it('runVoteStart: 만들기 성공·열기 실패 → 재시도는 만들기 없이 열기만', async () => {
    const r = beginVote(base(), ['2-1-안1'], 'req-1');
    if (!r.ok) throw new Error();
    let shared = r.state;
    const commit = vi.fn(async (fn: (s: PrepState) => PrepState) => (shared = fn(shared)));
    const api: VoteApi = {
      create: vi.fn(async () => ({ id: 'B1', token: 'T1' })),
      setStatus: vi.fn().mockRejectedValueOnce(new Error('network')).mockResolvedValue({}),
      statusOf: vi.fn(async () => 'draft' as const),
      results: vi.fn(),
    };
    await expect(runVoteStart(api, commit, () => shared, 'req-1', () => NOW)).rejects.toThrow('network');
    expect(shared.ballots['req-1'].stage).toBe('draft');
    expect(shared.ballots['req-1'].ballotId).toBe('B1');

    const again = await runVoteStart(api, commit, () => shared, 'req-1', () => NOW);
    expect(api.create).toHaveBeenCalledTimes(1); // ★ 두 번째 투표를 만들지 않는다
    expect(api.setStatus).toHaveBeenCalledTimes(2);
    expect(again.stage).toBe('open');
    expect(shared.ballots['req-1'].openedAt).toBe(NOW);
    expect(qrRowOf(again, 7)).toMatchObject({ id: 'B1', token: 'T1', status: 'open', response_count: 7, subgroup: '2분과' });
  });

  it('runVoteStart: 만들기 응답을 잃으면 같은 멱등키·같은 내용으로 다시 보낸다', async () => {
    const r = beginVote(base(), ['2-1-안1'], 'req-1');
    if (!r.ok) throw new Error();
    let shared = r.state;
    const commit = async (fn: (s: PrepState) => PrepState) => (shared = fn(shared));
    const create = vi.fn().mockRejectedValueOnce(new Error('timeout')).mockResolvedValue({ id: 'B1', token: 'T1' });
    const api: VoteApi = { create, setStatus: vi.fn(async () => ({})), statusOf: vi.fn(), results: vi.fn() };
    await expect(runVoteStart(api, commit, () => shared, 'req-1', () => NOW)).rejects.toThrow();
    // 사이에 제목을 고쳐도 재시도 페이로드는 처음 그대로다(서버 멱등 해시가 같아야 한다)
    shared = updateMotion(shared, '2-1-안1', { title: '고친 제목' });
    await runVoteStart(api, commit, () => shared, 'req-1', () => NOW);
    expect(create.mock.calls[0]).toEqual(create.mock.calls[1]);
    expect(create.mock.calls[1][1]).toBe('req-1');
  });

  it('열기가 실패해도 서버가 이미 열려 있으면 성공으로 본다', async () => {
    let shared = markBallotCreated((beginVote(base(), ['2-1-안1'], 'k') as { state: PrepState }).state, 'k', { id: 'B', token: 'T' });
    const commit = async (fn: (s: PrepState) => PrepState) => (shared = fn(shared));
    const api: VoteApi = {
      create: vi.fn(),
      setStatus: vi.fn(async () => {
        throw new Error('lost');
      }),
      statusOf: vi.fn(async () => 'open' as const),
      results: vi.fn(),
    };
    const rec = await runVoteStart(api, commit, () => shared, 'k', () => NOW);
    expect(rec.stage).toBe('open');
  });

  it('제목이 빈 안·이미 투표한 안·2차를 묶음으로는 시작하지 않는다', () => {
    let s = updateMotion(base(), '2-1-안1', { title: '  ' });
    expect(beginVote(s, ['2-1-안1'], 'k').ok).toBe(false);
    s = voteThrough(base(), ['2-1-안1'], [[40, 5]]);
    const again = beginVote(s, ['2-1-안1'], 'k2');
    expect(again.ok).toBe(false);
    expect(beginVote(base(), [], 'k').ok).toBe(false);
    expect(beginVote(base(), ['없는-안'], 'k').ok).toBe(false);
  });
});

describe('마감하고 결과 보기 — 결과가 공유 상태에 남는다', () => {
  it('찬성 dist[2]·반대 dist[1] 을 안마다 적고 마감 때 재적·참석을 박는다', () => {
    const s = voteThrough(base(), ['2-1-안1', '2-1-안2'], [[30, 10], [20, 20]]);
    const [a, b] = s.motions;
    expect(a.rounds[0]).toMatchObject({ onlineYes: 30, onlineNo: 10, enrolled: 60, present: 45, verdict: 'passed', closedAt: NOW });
    expect(b.rounds[0]).toMatchObject({ onlineYes: 20, onlineNo: 20, verdict: 'failed' });
    expect(s.ballots['req-1'].stage).toBe('closed');
    // 새로고침 = 저장된 JSON 을 다시 읽음
    const reloaded = readStoredPrep(serializePrep(s))!;
    expect(motionPhase(reloaded, reloaded.motions[0])).toBe('passed');
    expect(motionPhase(reloaded, reloaded.motions[1])).toBe('failed');
  });

  it('★ 문항 문장이 기록과 다르면 결과를 적지 않는다', () => {
    const b = beginVote(base(), ['2-1-안1'], 'k');
    if (!b.ok) throw new Error();
    const s = markBallotCreated(b.state, 'k', { id: 'B', token: 'T' });
    const res = results({ ballotId: 'B', statements: ['다른 문장'] }, [[1, 1]]);
    const out = applyBallotResults(s, 'k', res, NOW);
    expect(out.ok).toBe(false);
    const other = applyBallotResults(s, 'k', { ...results(s.ballots.k, [[1, 1]]), id: 'X' }, NOW);
    expect(other.ok).toBe(false);
  });

  it('runVoteClose: 결과를 못 읽어도 마감은 남고, 다시 누르면 결과만 다시 읽는다', async () => {
    const b = beginVote(base(), ['2-1-안1'], 'k');
    if (!b.ok) throw new Error();
    let shared = markBallotOpened(markBallotCreated(b.state, 'k', { id: 'B', token: 'T' }), 'k', NOW);
    const commit = async (fn: (s: PrepState) => PrepState) => (shared = fn(shared));
    const api: VoteApi = {
      create: vi.fn(),
      setStatus: vi.fn(async () => ({})),
      statusOf: vi.fn(),
      results: vi.fn().mockResolvedValueOnce(null).mockImplementation(async () => results(shared.ballots.k, [[31, 2]])),
    };
    const first = await runVoteClose(api, commit, () => shared, 'k', () => NOW);
    expect(first.ok).toBe(false);
    expect(shared.ballots.k.stage).toBe('closed');
    expect(motionPhase(shared, shared.motions[0])).toBe('counting');
    const second = await runVoteClose(api, commit, () => shared, 'k', () => NOW);
    expect(second.ok).toBe(true);
    expect(api.setStatus).toHaveBeenCalledTimes(1); // 이미 마감이면 다시 마감하지 않는다
    expect(motionPhase(shared, shared.motions[0])).toBe('passed');
  });

  it('열린 적 없는 투표는 마감하지 않는다', async () => {
    const b = beginVote(base(), ['2-1-안1'], 'k');
    if (!b.ok) throw new Error();
    const api: VoteApi = { create: vi.fn(), setStatus: vi.fn(), statusOf: vi.fn(), results: vi.fn() };
    const out = await runVoteClose(api, async (fn) => fn(b.state), () => b.state, 'k', () => NOW);
    expect(out.ok).toBe(false);
    expect(api.setStatus).not.toHaveBeenCalled();
  });
});

describe('거수 — 온라인 표에 더한다', () => {
  it('온라인으로 부결이던 안이 거수로 가결이 된다(참석 45 → 가결선 30)', () => {
    let s = voteThrough(base(), ['2-1-안1'], [[28, 5]]);
    expect(s.motions[0].rounds[0].verdict).toBe('failed');
    s = setHandCount(s, '2-1-안1', 1, { handYes: 2 });
    expect(s.motions[0].rounds[0].verdict).toBe('passed');
    expect(motionPhase(s, s.motions[0])).toBe('passed');
  });

  it('반대 거수가 많아 찬성+반대가 참석을 넘으면 판정 불가', () => {
    let s = voteThrough(base(), ['2-1-안1'], [[30, 10]]);
    s = setHandCount(s, '2-1-안1', 1, { handNo: 6 }); // 30 + 16 = 46 > 45
    expect(s.motions[0].rounds[0].verdict).toBe('invalid');
    expect(roundVerdict(s.motions[0].rounds[0])).toMatchObject({ kind: 'invalid' });
    s = setHandCount(s, '2-1-안1', 1, { handNo: 5 });
    expect(s.motions[0].rounds[0].verdict).toBe('passed');
  });

  it('찬성 거수로 찬성이 참석을 넘으면 판정 불가, 음수·소수는 받지 않는다', () => {
    let s = voteThrough(base(), ['2-1-안1'], [[40, 0]]);
    s = setHandCount(s, '2-1-안1', 1, { handYes: 6 });
    expect(s.motions[0].rounds[0].verdict).toBe('invalid');
    expect(setHandCount(s, '2-1-안1', 1, { handYes: -1 })).toBe(s);
    expect(setHandCount(s, '2-1-안1', 1, { handNo: 1.5 })).toBe(s);
  });

  it('decideVote 경계', () => {
    expect(decideVote(60, 45, 30, 15)).toMatchObject({ kind: 'decided', passed: true, threshold: 30 });
    expect(decideVote(60, 45, 29, 16)).toMatchObject({ kind: 'decided', passed: false });
    expect(decideVote(60, 30, 30, 0)).toMatchObject({ kind: 'no-quorum' });
    expect(decideVote(60, 45, 30, -1)).toMatchObject({ kind: 'invalid' });
  });

  it('마감 뒤 참석을 고치면 「다시 판정」으로 그 차수에 반영한다', () => {
    let s = voteThrough(base({ enrolled: 60, present: 50 }), ['2-1-안1'], [[32, 10]]); // 50 → 가결선 34 → 부결
    expect(s.motions[0].rounds[0].verdict).toBe('failed');
    s = { ...s, attendance: { enrolled: 60, present: 45 } };
    expect(s.motions[0].rounds[0].present).toBe(50); // 저절로 바뀌지 않는다
    s = reapplyAttendance(s, '2-1-안1', 1);
    expect(s.motions[0].rounds[0]).toMatchObject({ present: 45, verdict: 'passed' });
  });
});

describe('부결 뒤 — 2차 투표 · 소수 의견', () => {
  it('문구 고쳐 2차: 새 투표가 2차로 붙고 1차 결과는 남는다', () => {
    let s = voteThrough(base(), ['2-1-안1'], [[20, 20]]);
    expect(canRevote(s, s.motions[0])).toBe(true);
    s = requestRevote(s, '2-1-안1');
    expect(motionPhase(s, s.motions[0])).toBe('revote');
    s = updateMotion(s, '2-1-안1', { title: '고친 문구' });
    const b = beginVote(s, ['2-1-안1'], 'req-2');
    expect(b.ok).toBe(true);
    if (!b.ok) return;
    const m = b.state.motions[0];
    expect(m.rounds.map((r) => [r.round, r.title, r.requestId])).toEqual([
      [1, '다회용기 확대', 'req-1'],
      [2, '고친 문구', 'req-2'],
    ]);
    expect(m.revote).toBe(false);
    expect(b.state.ballots['req-2'].title).toBe('2분과 의결 2-1-안1 2차');
    expect(b.state.ballots['req-2'].round).toBe(2);
    expect(b.state.ballots['req-1'].title).not.toBe(b.state.ballots['req-2'].title);
  });

  it(`2차 뒤 또 부결이면 더 열지 않는다(최대 ${MAX_ROUNDS}차) · 가결 안은 2차 대상이 아니다`, () => {
    let s = voteThrough(base(), ['2-1-안1'], [[20, 20]]);
    s = requestRevote(s, '2-1-안1');
    const b = beginVote(s, ['2-1-안1'], 'req-2');
    if (!b.ok) throw new Error(b.error);
    let x = markBallotOpened(markBallotCreated(b.state, 'req-2', { id: 'B2', token: 'T2' }), 'req-2', NOW);
    const r = applyBallotResults(x, 'req-2', results(x.ballots['req-2'], [[10, 30]]), NOW);
    if (!r.ok) throw new Error(r.error);
    x = r.state;
    expect(canRevote(x, x.motions[0])).toBe(false);
    expect(requestRevote(x, '2-1-안1')).toBe(x);
    const passed = voteThrough(base(), ['2-1-안1'], [[40, 0]]);
    expect(requestRevote(passed, '2-1-안1')).toBe(passed);
  });

  it('2차 준비 취소', () => {
    let s = requestRevote(voteThrough(base(), ['2-1-안1'], [[20, 20]]), '2-1-안1');
    s = cancelRevote(s, '2-1-안1');
    expect(motionPhase(s, s.motions[0])).toBe('failed');
  });

  it('소수 의견: 칸이 비면 확인을 받고, 적었으면 바로 기록', () => {
    let s = voteThrough(base(), ['2-1-안1'], [[20, 20]]);
    expect(markMinority(s, '2-1-안1')).toEqual({ ok: false, needsConfirm: true });
    const forced = markMinority(s, '2-1-안1', true);
    expect(forced.ok).toBe(true);
    s = updateMotion(s, '2-1-안1', { minorityOpinion: '소수 의견 본문' });
    const r = markMinority(s, '2-1-안1');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(motionPhase(r.state, r.state.motions[0])).toBe('minority');
    expect(resultCsvRows(r.state)[0][14]).toBe('부결(소수의견)');
    const back = unmarkMinority(r.state, '2-1-안1');
    expect(motionPhase(back, back.motions[0])).toBe('failed');
    // 가결 안·투표 전 안은 소수 의견으로 닫지 않는다
    expect(markMinority(voteThrough(base(), ['2-1-안1'], [[40, 0]]), '2-1-안1', true).ok).toBe(false);
    expect(markMinority(base(), '2-1-안1', true).ok).toBe(false);
  });

  it('투표를 시작한 안은 지우지 않는다', () => {
    const s = voteThrough(base(), ['2-1-안1'], [[40, 0]]);
    expect(canDeleteMotion(s.motions[0])).toBe(false);
    expect(deleteMotion(s, '2-1-안1')).toBe(s);
  });
});

describe('세리머니 — 저장된 결과 공개', () => {
  it('안마다 결과 있는 마지막 차수 · 2차는 라벨에 표시 · 거수 합산', () => {
    let s = voteThrough(base(), ['2-1-안1', '2-1-안2'], [[40, 2], [10, 30]]);
    s = setHandCount(s, '2-1-안1', 1, { handYes: 1, handNo: 1 });
    s = requestRevote(s, '2-1-안2');
    s = updateMotion(s, '2-1-안2', { title: '회수 체계(수정)' });
    const b = beginVote(s, ['2-1-안2'], 'req-2');
    if (!b.ok) throw new Error(b.error);
    let x = markBallotOpened(markBallotCreated(b.state, 'req-2', { id: 'B2', token: 'T2' }), 'req-2', NOW);
    const r = applyBallotResults(x, 'req-2', results(x.ballots['req-2'], [[31, 3]]), NOW);
    if (!r.ok) throw new Error(r.error);
    x = r.state;
    const items = storedCeremonyItems(x);
    expect(items).toEqual([
      { key: '2-1-안1:r1', label: '2-1-안1', title: '다회용기 확대', yeas: 41, nays: 3, enrolled: 60, present: 45, round: 1 },
      { key: '2-1-안2:r2', label: '2-1-안2 · 2차 투표', title: '회수 체계(수정)', yeas: 31, nays: 3, enrolled: 60, present: 45, round: 2 },
    ]);
    const sum = summarizeCeremony(items, 0, 0); // 세리머니 전체 값이 틀려도 항목 값으로 판정
    expect(sum.passed.map((i) => i.key)).toEqual(['2-1-안1:r1', '2-1-안2:r2']);
    expect(ceremonyVerdict({ key: 'a', label: 'a', title: 'a', yeas: 30 }, 60, 45)).toMatchObject({ kind: 'decided', passed: true });
  });
});

describe('결과 CSV', () => {
  it('머리줄 24칸이 정한 순서 · 기준 이름이 화면과 같다', () => {
    expect(CSV_COLUMNS).toHaveLength(24);
    expect(CSV_COLUMNS.slice(15, 20)).toEqual(CRITERIA_COLUMN_LABELS);
    const csv = toCsv([]);
    expect(csv.startsWith('﻿분과,안번호,제목,원카드번호,차수,')).toBe(true);
    expect(csv.endsWith('\r\n')).toBe(true);
  });

  it('쉼표·따옴표·줄바꿈을 감싸고 수식 시작 글자를 막는다', () => {
    expect(csvCell('가,나')).toBe('"가,나"');
    expect(csvCell('그는 "예"라고')).toBe('"그는 ""예""라고"');
    expect(csvCell('첫줄\n둘째줄')).toBe('"첫줄\n둘째줄"');
    expect(csvCell('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(csvCell('-3')).toBe('-3');
    expect(csvCell('- 항목')).toBe("'- 항목");
    expect(csvCell('보통 글')).toBe('보통 글');
  });

  it('안 × 차수마다 한 줄 · 투표 안 한 안도 한 줄', () => {
    let s = voteThrough(base(), ['2-1-안1'], [[28, 10]]);
    s = setHandCount(s, '2-1-안1', 1, { handYes: 3, handNo: 1 });
    s = setGridMark(s, '2-1-안1', '1', 'effectiveness', 'met');
    s = setCriterionOverride(s, '2-1-안1', 'equity', 'unmet');
    s = setGridMark(s, '2-1-안1', '1', 'feasibility', 'met');
    s = setGridMark(s, '2-1-안1', '2', 'feasibility', 'unmet');
    s = updateMotion(s, '2-1-안1', { otherOpinion: '의견, 하나' });
    const rows = resultCsvRows(s);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual([
      '2분과', '2-1-안1', '다회용기 확대', '2-1-1', '1차', '60', '45',
      '28', '10', '3', '1', '31', '11', '30', '가결',
      '충족', '미충족(직접)', '-', '-', '동수',
      '의견, 하나', '', 'ballot-req-1', '2026-10-17 14:05:09',
    ]);
    expect(rows[1].slice(0, 5)).toEqual(['2분과', '2-1-안2', '회수 체계', '2-1-2', '']);
    expect(rows[1][14]).toBe('미투표');
    expect(rows.every((r) => r.length === 24)).toBe(true);
    const csv = toCsv(rows);
    expect(csv).toContain('"의견, 하나"');
    expect(csv.split('\r\n')).toHaveLength(5); // 머리줄 + 3줄 + 끝 빈칸
  });

  it('투표 중인 안은 「투표중」, 서울 시각 변환, 파일 이름', () => {
    const b = beginVote(base(), ['2-1-안1'], 'k');
    if (!b.ok) throw new Error();
    const s = markBallotOpened(markBallotCreated(b.state, 'k', { id: 'B', token: 'T' }), 'k', NOW);
    expect(resultCsvRows(s)[0][14]).toBe('투표중');
    expect(resultCsvRows(b.state)[0][14]).toBe('시작 중');
    expect(resultCsvRows(markBallotClosed(s, 'k', NOW))[0][14]).toBe('집계 전');
    expect(formatKst('2026-10-17T15:30:00.000Z')).toBe('2026-10-18 00:30:00');
    expect(formatKst(null)).toBe('');
    expect(formatKst('nope')).toBe('');
    expect(resultsFileName(2, new Date(2026, 9, 17, 9, 5))).toBe('1017_의결결과_2분과_20261017_0905.csv');
    expect(resultsFileName('all', new Date(2026, 9, 17, 16, 40))).toBe('1017_의결결과_전체_20261017_1640.csv');
  });
});

describe('운영팀 현황판', () => {
  it('후보안·진행중·가결·부결·소수의견·참석 미입력', () => {
    expect(boardSummary(1, null)).toMatchObject({ hasState: false, attendanceMissing: true, motionCount: 0 });
    let s = base({ enrolled: null, present: null });
    expect(boardSummary(2, s)).toMatchObject({ motionCount: 3, pending: 3, attendanceMissing: true });
    s = voteThrough({ ...s, attendance: { enrolled: 60, present: 45 } }, ['2-1-안1'], [[40, 0]], 'a');
    s = voteThrough(s, ['2-1-안2'], [[10, 30]], 'b');
    const b = beginVote(s, ['2-4-안1'], 'c');
    if (!b.ok) throw new Error(b.error);
    s = markBallotOpened(markBallotCreated(b.state, 'c', { id: 'C', token: 'T' }), 'c', NOW);
    const sum = boardSummary(2, s);
    expect(sum).toMatchObject({ passed: 1, failed: 1, minority: 0, pending: 0, attendanceMissing: false });
    expect(sum.open).toEqual([{ label: '2-4-안1', openedAt: NOW }]);
    const m = markMinority(s, '2-1-안2', true);
    if (!m.ok) throw new Error();
    expect(boardSummary(2, m.state)).toMatchObject({ failed: 0, minority: 1 });
  });

  it('경과 시간', () => {
    const t = Date.parse(NOW);
    expect(elapsedText(NOW, t + 187_000)).toBe('3분 07초');
    expect(elapsedText(NOW, t + 42_000)).toBe('42초');
    expect(elapsedText(NOW, t - 5_000)).toBe('방금');
    expect(elapsedText(null, t)).toBe('방금');
  });
});
