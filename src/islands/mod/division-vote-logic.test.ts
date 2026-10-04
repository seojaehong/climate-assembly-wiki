import { describe, expect, it, vi } from 'vitest';
import {
  CARD_STATUSES,
  CARD_STATUS_LABELS,
  CEREMONY_START,
  CRITERIA,
  CRITERION_LABELS,
  advanceCeremony,
  attendanceCheck,
  attendanceText,
  ballotCeremonyItems,
  barRatio,
  buildDivisionBallot,
  canCombine,
  cardStatusText,
  ceremonyReveal,
  createMotion,
  decideMotion,
  deleteMotion,
  exportFileName,
  fakeYeas,
  initPrepState,
  initialCardStatus,
  isUntitled,
  motionStatement,
  nextMotionId,
  openDivisionBallot,
  parseImport,
  practiceItems,
  prepStorageKey,
  readStoredPrep,
  rewindCeremony,
  serializePrep,
  setCardStatus,
  statusTally,
  summarizeCeremony,
  thresholdRatio,
  updateMotion,
  type Motion,
  type PrepState,
} from './division-vote-logic';
import { DIVISION_VOTE_FIXTURE } from './division-vote-fixture';
import type { BallotResults } from '../../lib/deliberation';

const div2 = DIVISION_VOTE_FIXTURE[0];
const fresh = (): PrepState => initPrepState(div2);

function mustCreate(state: PrepState, cardNos: string[], title = '안 제목', text = '문안') {
  const r = createMotion(state, { cardNos, title, text });
  if (!r.ok) throw new Error(r.error);
  return r;
}

describe('카드 상태', () => {
  it('6종 상태와 한국어 라벨이 짝을 이룬다', () => {
    expect(CARD_STATUSES.map((s) => CARD_STATUS_LABELS[s])).toEqual([
      '유지', '시행중-제외', '통합', '이관', '숙제', '미완성-선채택',
    ]);
  });

  it('2-14~2-17 은 숙제로, 나머지는 유지로 시작한다', () => {
    for (const t of ['2-14', '2-15', '2-16', '2-17']) expect(initialCardStatus(t)).toBe('homework');
    for (const t of ['2-13', '2-1', '1-14', '3-14', '2-18']) expect(initialCardStatus(t)).toBe('keep');
    const s = fresh();
    expect(s.cards['2-14-1'].status).toBe('homework');
    expect(s.cards['2-1-1'].status).toBe('keep');
    expect(Object.keys(s.cards)).toHaveLength(6);
  });

  it('제목이 빈 카드를 「제목 없음」으로 가린다', () => {
    expect(isUntitled({ title: '' })).toBe(true);
    expect(isUntitled({ title: '  ' })).toBe(true);
    expect(isUntitled({ title: '가' })).toBe(false);
  });

  it('이관·통합만 대상을 붙이고 다른 상태에서는 버린다', () => {
    let s = setCardStatus(fresh(), '2-1-1', { status: 'transferred', target: '3분과' });
    expect(cardStatusText(s.cards['2-1-1'])).toBe('이관 → 3분과');
    s = setCardStatus(s, '2-1-1', { status: 'excluded', target: '3분과' });
    expect(s.cards['2-1-1']).toEqual({ status: 'excluded' });
    expect(setCardStatus(s, '없는-카드', { status: 'keep' })).toBe(s);
  });

  it('상태별 수는 6종 모두 나오고 합이 카드 수와 같다', () => {
    const tally = statusTally(fresh());
    expect(Object.keys(tally)).toHaveLength(6);
    expect(Object.values(tally).reduce((a, b) => a + b, 0)).toBe(6);
    expect(tally.homework).toBe(1);
  });
});

describe('의결안 — 같은 주제 안에서만 묶는다', () => {
  it('같은 주제 카드 둘은 묶이고 카드가 「통합 → 안 번호」가 된다', () => {
    const r = mustCreate(fresh(), ['2-1-3', '2-1-1']);
    expect(r.motion.id).toBe('2-1-안1');
    expect(r.motion.cardNos).toEqual(['2-1-1', '2-1-3']); // 고른 순서가 아니라 자리 순서
    expect(r.state.cards['2-1-1']).toEqual({ status: 'merged', target: '2-1-안1' });
    expect(r.state.cards['2-1-3']).toEqual({ status: 'merged', target: '2-1-안1' });
    expect(r.state.cards['2-1-2'].status).toBe('keep');
  });

  it('★ 다른 주제 카드가 섞이면 거절하고 상태를 바꾸지 않는다', () => {
    const s = fresh();
    const check = canCombine(div2, ['2-1-1', '2-4-1']);
    expect(check).toEqual({ ok: false, reason: 'mixed-topic', topics: ['2-1', '2-4'] });
    const r = createMotion(s, { cardNos: ['2-1-1', '2-4-1'], title: '섞인 안', text: '' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('2-1 · 2-4');
    expect(s.motions).toHaveLength(0);
  });

  it('빈 선택·없는 카드·빈 제목을 거절한다', () => {
    expect(canCombine(div2, []).ok).toBe(false);
    expect(canCombine(div2, ['9-9-9']).ok).toBe(false);
    expect(createMotion(fresh(), { cardNos: ['2-1-1'], title: '  ', text: '' }).ok).toBe(false);
  });

  it('카드 1개짜리 안은 카드 상태를 그대로 둔다', () => {
    let s = setCardStatus(fresh(), '2-4-6', { status: 'adopt-pending' });
    s = mustCreate(s, ['2-4-6']).state;
    expect(s.cards['2-4-6'].status).toBe('adopt-pending');
    expect(s.motions[0].cardNos).toEqual(['2-4-6']);
  });

  it('안 번호는 주제마다 1부터, 지운 번호를 다시 쓰지 않는다', () => {
    let s = mustCreate(fresh(), ['2-1-1']).state;
    s = mustCreate(s, ['2-1-2']).state;
    s = mustCreate(s, ['2-4-1']).state;
    expect(s.motions.map((m) => m.id)).toEqual(['2-1-안1', '2-1-안2', '2-4-안1']);
    s = deleteMotion(s, '2-1-안2');
    expect(nextMotionId(s, '2-1')).toBe('2-1-안2'); // 최댓값 기준이라 마지막을 지우면 그 번호가 다시 난다
    s = deleteMotion(mustCreate(s, ['2-1-2']).state, '2-1-안1');
    expect(nextMotionId(s, '2-1')).toBe('2-1-안3');
  });

  it('안을 지우면 그 안으로 통합된 카드만 유지로 돌아간다', () => {
    let s = mustCreate(fresh(), ['2-1-1', '2-1-2']).state;
    s = setCardStatus(s, '2-1-3', { status: 'merged', target: '다른안' });
    s = deleteMotion(s, '2-1-안1');
    expect(s.cards['2-1-1'].status).toBe('keep');
    expect(s.cards['2-1-2'].status).toBe('keep');
    expect(s.cards['2-1-3']).toEqual({ status: 'merged', target: '다른안' });
    expect(s.motions).toHaveLength(0);
  });

  it('5개 기준 체크칸은 운영규정 §17② 순서이고 처음엔 비어 있다', () => {
    expect(CRITERIA.map((k) => CRITERION_LABELS[k])).toEqual([
      '효과성', '형평성', '사회적 수용성', '지속가능성', '실행가능성',
    ]);
    const r = mustCreate(fresh(), ['2-1-1']);
    expect(Object.values(r.motion.criteria).every((v) => v === false)).toBe(true);
    const s = updateMotion(r.state, r.motion.id, { criteria: { ...r.motion.criteria, equity: true } });
    expect(s.motions[0].criteria.equity).toBe(true);
  });
});

describe('JSON 내보내기·가져오기', () => {
  it('내보낸 파일을 가져오면 그대로 돌아온다', () => {
    let s = mustCreate(fresh(), ['2-1-1', '2-1-2'], '통합 안', '문안 본문').state;
    s = setCardStatus(s, '2-4-1', { status: 'transferred', target: '3분과' });
    const parsed = parseImport(serializePrep(s));
    expect(parsed.kind).toBe('state');
    if (parsed.kind === 'state') expect(parsed.state).toEqual(s);
    expect(readStoredPrep(serializePrep(s))).toEqual(s);
  });

  it('원천 배열(recs_1017.json 모양)을 알아본다', () => {
    const parsed = parseImport(JSON.stringify(DIVISION_VOTE_FIXTURE));
    expect(parsed.kind).toBe('recs');
    if (parsed.kind === 'recs') expect(parsed.divisions.map((d) => d.division)).toEqual([2, 3]);
  });

  it('★ 한 곳만 틀려도 통째로 거절한다', () => {
    const s = mustCreate(fresh(), ['2-1-1']).state;
    const bad = JSON.parse(serializePrep(s));
    bad.motions[0].cardNos = ['2-1-1', '2-4-1']; // 다른 주제가 섞인 안
    expect(parseImport(JSON.stringify(bad)).kind).toBe('error');

    const bad2 = JSON.parse(serializePrep(s));
    bad2.cards['2-1-1'].status = 'unknown';
    expect(parseImport(JSON.stringify(bad2)).kind).toBe('error');

    const recs = JSON.parse(JSON.stringify(DIVISION_VOTE_FIXTURE));
    delete recs[0].topics[1].cards[0].recs;
    expect(parseImport(JSON.stringify(recs)).kind).toBe('error');

    expect(parseImport('{').kind).toBe('error');
    expect(parseImport('{"x":1}').kind).toBe('error');
    expect(readStoredPrep(null)).toBeNull();
    expect(readStoredPrep('[]')).toBeNull();
  });

  it('저장 키에 분과가 들어가고 파일 이름에 분과·시각이 들어간다', () => {
    expect(prepStorageKey(2)).not.toBe(prepStorageKey(3));
    expect(prepStorageKey(2)).toContain(':2');
    expect(exportFileName(2, new Date(2026, 9, 17, 14, 5))).toBe('1017_의결준비_2분과_20261017-1405.json');
  });
});

describe('투표 열기 — ballot_create_v3 페이로드', () => {
  const motions = (n: number): Motion[] =>
    Array.from({ length: n }, (_, i) => ({
      id: `2-1-안${i + 1}`,
      topicNo: '2-1',
      cardNos: ['2-1-1'],
      title: `안 ${i + 1}`,
      text: '',
      criteria: { effectiveness: false, equity: false, acceptability: false, sustainability: false, feasibility: false },
    }));

  it('분과 한정 · 2점 척도(반대/찬성) · 안 번호를 문장 앞에 붙인다', () => {
    const plan = buildDivisionBallot(2, motions(2));
    expect(plan.problems).toEqual([]);
    expect(plan.payload.subgroup).toBe('2분과');
    expect(plan.payload.title).toBe('2분과 의결');
    expect(plan.payload.items).toEqual([
      { ordinal: 1, statement: '2-1-안1 안 1', scale: 2, required: true },
      { ordinal: 2, statement: '2-1-안2 안 2', scale: 2, required: true },
    ]);
  });

  it('20개까지는 통과, 21개부터 경고(1단계는 상한을 올리지 않는다)', () => {
    expect(buildDivisionBallot(1, motions(20)).problems).toEqual([]);
    expect(buildDivisionBallot(1, motions(21)).problems[0]).toContain('20개');
    expect(buildDivisionBallot(1, []).problems).toHaveLength(1);
  });

  it('300자를 넘는 문장을 경고한다', () => {
    const long = motions(1);
    long[0].title = '가'.repeat(300);
    expect(motionStatement(long[0]).length).toBeGreaterThan(300);
    expect(buildDivisionBallot(1, long).problems[0]).toContain('300자');
  });

  it('연결부는 주입받은 create 를 페이로드·멱등키 그대로 한 번 부른다(목)', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'b1', token: 't1', status: 'draft', items: 2, subgroup: '2분과' });
    const plan = buildDivisionBallot(2, motions(2));
    const res = await openDivisionBallot(create, plan, 'key-1');
    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith(plan.payload, 'key-1');
    expect(res.token).toBe('t1');
  });

  it('문제가 있으면 create 를 부르지 않는다', async () => {
    const create = vi.fn();
    await expect(openDivisionBallot(create, buildDivisionBallot(2, motions(21)), 'k')).rejects.toThrow('20개');
    expect(create).not.toHaveBeenCalled();
  });
});

describe('판정 — 재적 과반수 참석 + 참석자 3분의 2 이상 찬성', () => {
  it('정족수 경계: 재적 60 → 참석 30 미달, 31 성립', () => {
    expect(decideMotion(60, 30, 30)).toEqual({ kind: 'no-quorum', establishThreshold: 31, shortfall: 1 });
    expect(decideMotion(60, 31, 21).kind).toBe('decided');
    expect(attendanceText(60, 30)).toContain('31명 이상');
    expect(attendanceText(60, 31)).toContain('찬성 21표 이상');
  });

  it('정족수 경계(홀수 재적): 재적 59 → 참석 29 미달, 30 성립', () => {
    expect(decideMotion(59, 29, 29).kind).toBe('no-quorum');
    expect(decideMotion(59, 30, 20).kind).toBe('decided');
  });

  it('참석 60: 정확히 3분의 2(40) 가결, 1표 모자람(39) 부결', () => {
    expect(decideMotion(60, 60, 40)).toEqual({ kind: 'decided', passed: true, yeas: 40, present: 60, threshold: 40 });
    expect(decideMotion(60, 60, 39)).toMatchObject({ passed: false, threshold: 40 });
  });

  it('참석 61: 기준 41 — 41 가결, 40 부결', () => {
    expect(decideMotion(70, 61, 41)).toMatchObject({ passed: true, threshold: 41 });
    expect(decideMotion(70, 61, 40)).toMatchObject({ passed: false, threshold: 41 });
  });

  it('참석 59: 기준 40 — 40 가결, 39 부결', () => {
    expect(decideMotion(70, 59, 40)).toMatchObject({ passed: true, threshold: 40 });
    expect(decideMotion(70, 59, 39)).toMatchObject({ passed: false, threshold: 40 });
  });

  it('★ 잘못된 입력은 던지지 않고 문구로 돌려준다', () => {
    expect(decideMotion(60, 61, 10)).toMatchObject({ kind: 'invalid' });
    expect(decideMotion(60, 40, 41)).toMatchObject({ kind: 'invalid', message: expect.stringContaining('참석 인원보다') });
    expect(decideMotion(0, 0, 0).kind).toBe('invalid');
    expect(decideMotion(60, 40, 1.5).kind).toBe('invalid');
    expect(decideMotion(60, Number.NaN, 0).kind).toBe('invalid');
    expect(attendanceCheck(60, -1).kind).toBe('invalid');
  });

  it('막대·기준선 비율의 분모는 참석이다', () => {
    expect(barRatio(40, 60)).toBeCloseTo(2 / 3);
    expect(thresholdRatio(40, 60)).toBeCloseTo(2 / 3);
    expect(barRatio(10, 0)).toBe(0);
    expect(barRatio(70, 60)).toBe(1);
  });
});

describe('세리머니 진행', () => {
  it('안마다 제목 → 막대 → 기준선 → 도장, 끝나면 요약판', () => {
    const seq = [CEREMONY_START];
    for (let i = 0; i < 9; i++) seq.push(advanceCeremony(seq[seq.length - 1], 2));
    expect(seq.map((s) => `${s.phase}${s.index}`)).toEqual([
      'intro0', 'title0', 'bar0', 'line0', 'verdict0', 'title1', 'bar1', 'line1', 'verdict1', 'summary1',
    ]);
    expect(advanceCeremony({ phase: 'summary', index: 1 }, 2)).toEqual({ phase: 'summary', index: 1 });
    expect(advanceCeremony(CEREMONY_START, 0).phase).toBe('summary');
  });

  it('이전 안으로 돌아간다', () => {
    expect(rewindCeremony({ phase: 'bar', index: 1 }, 2)).toEqual({ phase: 'verdict', index: 0 });
    expect(rewindCeremony({ phase: 'title', index: 0 }, 2)).toEqual(CEREMONY_START);
    expect(rewindCeremony({ phase: 'summary', index: 1 }, 2)).toEqual({ phase: 'verdict', index: 1 });
    expect(rewindCeremony(CEREMONY_START, 2)).toEqual(CEREMONY_START);
  });

  it('단계마다 보이는 것이 하나씩 늘어난다', () => {
    expect(ceremonyReveal('title')).toEqual({ bar: false, line: false, stamp: false });
    expect(ceremonyReveal('bar')).toEqual({ bar: true, line: false, stamp: false });
    expect(ceremonyReveal('line')).toEqual({ bar: true, line: true, stamp: false });
    expect(ceremonyReveal('verdict')).toEqual({ bar: true, line: true, stamp: true });
  });

  it('요약은 가결·부결·판정불가를 나눈다', () => {
    const items = [
      { key: 'a', label: 'a', title: 'A', yeas: 40 },
      { key: 'b', label: 'b', title: 'B', yeas: 39 },
      { key: 'c', label: 'c', title: 'C', yeas: 61 },
    ];
    const s = summarizeCeremony(items, 60, 60);
    expect(s.passed.map((i) => i.key)).toEqual(['a']);
    expect(s.failed.map((i) => i.key)).toEqual(['b']);
    expect(s.invalid.map((i) => i.key)).toEqual(['c']);
  });
});

describe('결과 원천', () => {
  it('연습 모드 가짜 값은 참석의 절반~전원 범위다', () => {
    expect(fakeYeas(60, () => 0)).toBe(30);
    expect(fakeYeas(60, () => 0.9999999)).toBe(60);
    expect(fakeYeas(61, () => 0.5)).toBeGreaterThanOrEqual(30);
    expect(fakeYeas(0, () => 0.5)).toBe(0);
    for (let i = 0; i < 50; i++) {
      const v = fakeYeas(45, Math.random);
      expect(v).toBeGreaterThanOrEqual(22);
      expect(v).toBeLessThanOrEqual(45);
    }
  });

  it('연습 항목은 안 번호·제목·입력 찬성 수를 쓴다', () => {
    const r = mustCreate(fresh(), ['2-1-1'], '제목 하나');
    expect(practiceItems(r.state.motions, { '2-1-안1': 33 })).toEqual([
      { key: '2-1-안1', label: '2-1-안1', title: '제목 하나', yeas: 33 },
    ]);
  });

  it('실제 결과는 dist["2"](찬성)를 쓰고 문장 앞 안 번호를 라벨로 뗀다', () => {
    const results: BallotResults = {
      id: 'b',
      title: '2분과 의결',
      status: 'closed',
      subgroup: '2분과',
      responses: 50,
      items: [
        { id: 'i2', ordinal: 2, statement: '임의 문장', scale: 2, n: 50, avg: 1.5, dist: { '1': 25, '2': 25 } },
        { id: 'i1', ordinal: 1, statement: '2-1-안1 다회용기 확대', scale: 2, n: 50, avg: 1.8, dist: { '1': 10, '2': 40 } },
      ],
    };
    expect(ballotCeremonyItems(results)).toEqual([
      { key: 'i1', label: '2-1-안1', title: '다회용기 확대', yeas: 40 },
      { key: 'i2', label: '2번', title: '임의 문장', yeas: 25 },
    ]);
  });
});
