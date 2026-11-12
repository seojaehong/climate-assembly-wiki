import { describe, expect, it } from 'vitest';
import { boardChaseState, chaseState, chaseText, kstHm, namedToBoard, remainText } from './chase-1114.mjs';

const roster = [
  { team: '1분과 1조', no: 1, name: '김가나' },
  { team: '1분과 1조', no: 2, name: '이다라' },
  { team: '1분과 2조', no: 1, name: '박마바' },
  { team: '2분과 1조', no: 1, name: '최사아' },
  { team: '2분과 3조', no: 1, name: '김민수' }, // 동명이인
  { team: '3분과 3조', no: 1, name: '김민수' },
];
const resp = (team, name) => ({ voter_team: team, voter_name: name, answers: { a: 2 } });
const start = (team, name, t) => ({ voter_team: team, voter_name: name, voter_in_roster: true, started_at: t });

describe('chaseState', () => {
  it('전원 제출이면 남은 분 0, 문구에 전원 제출', () => {
    const st = chaseState({ roster, responses: roster.map((r) => resp(r.team, r.name)) });
    expect(st.remaining).toBe(0);
    expect(chaseText(st, { label: '의제1', now: '2026-11-14T06:00:00Z' })).toContain('명단 전원 제출했습니다.');
  });

  it('동명이인 — 한쪽이 내도 다른 쪽은 남는다', () => {
    const st = chaseState({ roster, responses: [resp('2분과 3조', '김민수')] });
    const left = st.teams.flatMap((t) => t.names.map((n) => `${t.team}|${n}`));
    expect(left).toContain('3분과 3조|김민수');
    expect(left).not.toContain('2분과 3조|김민수');
  });

  it('이름이 하나뿐이면 조를 잘못 골라 냈어도 낸 것으로 본다', () => {
    const st = chaseState({ roster, responses: [resp('1분과 2조', '김가나')] });
    expect(st.teams.flatMap((t) => t.names)).not.toContain('김가나');
  });

  it('시작 0명이면 전부 ②, 시작했으면 ①(오래된 순)', () => {
    const none = chaseState({ roster, responses: [] });
    expect(none.waiting).toHaveLength(0);
    expect(none.notStartedCount).toBe(6);
    const st = chaseState({
      roster,
      responses: [],
      starts: [start('2분과 1조', '최사아', '2026-11-14T05:30:00Z'), start('1분과 1조', '이다라', '2026-11-14T05:25:00Z')],
    });
    expect(st.waiting.map((w) => w.name)).toEqual(['이다라', '최사아']);
    expect(st.notStartedCount).toBe(4);
  });

  it('명단 밖 이름으로 시작만 한 사람은 ①에 「명단에 없는 이름」으로, 명단 밖 제출은 제출 수에만', () => {
    const st = chaseState({
      roster,
      responses: [resp('1분과 1조', '홍길동')],
      starts: [start('1분과 1조', '장보고', '2026-11-14T05:31:00Z')],
    });
    expect(st.submitted).toBe(1);
    expect(st.remaining).toBe(7);
    const text = chaseText(st, { label: '의제2', now: '2026-11-14T05:40:00Z' });
    expect(text).toContain('장보고 (14:31 시작, 명단에 없는 이름)');
  });

  it('제외(불참·서면)는 목록에서 빠지고 머리줄에 수만', () => {
    const st = chaseState({ roster, responses: [], exclude: ['박마바', '3분과 3조|김민수'] });
    expect(st.excluded).toBe(2);
    const names = st.teams.flatMap((t) => t.names);
    expect(names).not.toContain('박마바');
    expect(names.filter((n) => n === '김민수')).toHaveLength(1);
    expect(chaseText(st, { label: '의제1', now: '2026-11-14T05:00:00Z' })).toContain('그 밖 제외 2명');
  });

  it('제외 「조|이름」은 조의 띄어쓰기가 달라도 맞는다', () => {
    const st = chaseState({ roster: [{ team: '1분과 1조', name: '이영희' }], responses: [], exclude: ['1분과1조|이영희'] });
    expect(st.excluded).toBe(1);
    expect(st.remaining).toBe(0);
  });

  it('동명이인이 명단에 없는 조로 시작하면 ①에 명단 밖으로 올라온다', () => {
    const r2 = [
      { team: '2분과 3조', name: '김민수' },
      { team: '3분과 3조', name: '김민수' },
    ];
    const st = chaseState({
      roster: r2,
      responses: [],
      starts: [{ voter_team: '1분과 1조', voter_name: '김민수', started_at: '2026-11-14T05:10:00Z', answered_count: 10 }],
      itemCount: 19,
    });
    expect(st.waiting).toHaveLength(1);
    expect(st.waiting[0]).toMatchObject({ team: '1분과 1조', name: '김민수', answered: 10, offRoster: true });
    expect(st.notStartedCount).toBe(2);
    expect(chaseText(st, { label: '의제1', now: '2026-11-14T05:20:00Z' })).toContain('김민수 10/19(명단 밖)');
  });

  it('문구에 찬반 낱말이 없다', () => {
    const st = chaseState({ roster, responses: [resp('1분과 1조', '김가나')], starts: [start('1분과 2조', '박마바', '2026-11-14T05:20:00Z')] });
    const text = chaseText(st, { label: '의제1', now: '2026-11-14T05:22:00Z' });
    expect(text).not.toMatch(/찬성|반대|가결|부결/);
    expect(text.split('\n')[0]).toBe('[의제1 투표 독려] 14:22 기준');
  });

  it('kstHm', () => {
    expect(kstHm('2026-11-14T05:40:00Z')).toBe('14:40');
  });
});

// ── 진행 기록(ballot_progress_board) 입력 ─────────────────────────────
const voter = (team, name, o = {}) => ({
  team,
  name,
  in_roster: true,
  started_at: null,
  answered_count: 0,
  last_ordinal: null,
  updated_at: null,
  submitted: false,
  submitted_at: null,
  ...o,
});
const board = (voters) => ({ id: 'b1', title: '의제1', status: 'open', item_count: 19, voters });

describe('boardChaseState', () => {
  it('① 진행 수를 「이름 n/총건」으로, 조별로 묶는다', () => {
    const b = board([
      voter('1분과 3조', '홍길동', { started_at: '2026-11-14T05:20:00Z', answered_count: 7, last_ordinal: 7 }),
      voter('1분과 3조', '김철수', { started_at: '2026-11-14T05:21:00Z', answered_count: 3 }),
      voter('2분과 1조', '이영희', { answered_count: 2, updated_at: '2026-11-14T05:22:00Z' }), // 시작 기록 없이 진행만
      voter('2분과 1조', '박미진'),
      voter('기획참여단 1조', '정하나', { submitted: true, submitted_at: '2026-11-14T05:25:00Z', answered_count: 19 }),
    ]);
    const st = boardChaseState(b);
    expect(st.itemCount).toBe(19);
    expect(st.submitted).toBe(1);
    expect(st.remaining).toBe(4);
    const text = chaseText(st, { label: '의제1', now: '2026-11-14T05:30:00Z', remainText: '남은 시간 5분' });
    const lines = text.split('\n');
    expect(lines[0]).toBe('[의제1 투표 독려] 14:30 기준 · 남은 시간 5분');
    expect(lines[1]).toBe('제출 1 / 명단 5 · 남은 분 4');
    expect(text).toContain('· 1분과 3조(2): 홍길동 7/19, 김철수 3/19');
    expect(text).toContain('· 2분과 1조(1): 이영희 2/19');
    expect(text).toContain('· 2분과 1조(1): 박미진');
    expect(text).not.toMatch(/찬성|반대|가결|부결/);
    const g = st.groups.find((x) => x.team === '1분과 3조');
    expect(g).toMatchObject({ total: 2, inProgress: 2, submitted: 0, notStarted: 0 });
  });

  it('동명이인 — 다른 조 같은 이름의 진행은 서로 섞이지 않는다', () => {
    const st = boardChaseState(
      board([
        voter('2분과 3조', '김민수', { started_at: '2026-11-14T05:20:00Z', answered_count: 10 }),
        voter('3분과 3조', '김민수'),
      ]),
    );
    expect(st.waiting).toHaveLength(1);
    expect(st.waiting[0]).toMatchObject({ team: '2분과 3조', answered: 10 });
    expect(st.teams).toEqual([{ team: '3분과 3조', names: ['김민수'] }]);
  });

  it('이름이 하나뿐인데 조를 잘못 골라 시작하면 진행 수가 명단 줄을 따라온다', () => {
    const st = boardChaseState(
      board([
        voter('1분과 1조', '김가나'),
        voter('1분과 2조', '김가나', { in_roster: false, started_at: '2026-11-14T05:20:00Z', answered_count: 5 }),
      ]),
    );
    expect(st.waiting).toHaveLength(1);
    expect(st.waiting[0]).toMatchObject({ team: '1분과 1조', name: '김가나', answered: 5 });
    expect(st.waiting[0].offRoster).toBeUndefined();
    expect(st.notStartedCount).toBe(0);
  });

  it('제외 목록은 ①②에서 빠지고 진행표에 제외로 센다', () => {
    const st = boardChaseState(
      board([
        voter('1분과 1조', '김가나', { started_at: '2026-11-14T05:20:00Z', answered_count: 4 }),
        voter('1분과 1조', '이다라'),
      ]),
      ['1분과 1조|김가나', '이다라'],
    );
    expect(st.remaining).toBe(0);
    expect(st.excluded).toBe(2);
    expect(st.groups[0]).toMatchObject({ excluded: 2, inProgress: 0, notStarted: 0 });
  });

  it('전원 제출', () => {
    const st = boardChaseState(board([voter('1분과 1조', '김가나', { submitted: true }), voter('1분과 2조', '박마바', { submitted: true })]));
    expect(st.remaining).toBe(0);
    expect(chaseText(st, { label: '의제2', now: '2026-11-14T06:00:00Z' })).toContain('명단 전원 제출했습니다.');
  });
});

describe('namedToBoard (진행 기록 함수가 없을 때)', () => {
  it('답의 값은 버리고 「답이 있다」로만 센다', () => {
    const b = namedToBoard({
      id: 'b1',
      title: 't',
      status: 'open',
      items: [
        { id: 'i1', ordinal: 1, statement: '첫 문장' },
        { id: 'i2', ordinal: 2, statement: '둘째 문장' },
      ],
      roster: [{ team: '1분과 1조', no: 1, name: '김가나' }, { team: '1분과 1조', no: 2, name: '이다라' }],
      responses: [{ voter_team: '1분과 1조', voter_name: '김가나', answers: { i1: 2, i2: 1 }, submitted_at: '2026-11-14T05:00:00Z' }],
      starts: [{ voter_team: '1분과 1조', voter_name: '이다라', started_at: '2026-11-14T04:59:00Z' }],
    });
    expect(b.items.map((i) => i.answered)).toEqual([1, 1]);
    expect(JSON.stringify(b)).not.toMatch(/"answers"|"i1":2/);
    const st = boardChaseState(b);
    expect(st.submitted).toBe(1);
    expect(st.waiting.map((w) => w.name)).toEqual(['이다라']);
    expect(st.itemCount).toBeNull(); // 진행 수를 모르니 n/총건 대신 시작 시각
    expect(chaseText(st, { label: '의제1', now: '2026-11-14T05:05:00Z' })).toContain('· 1분과 1조 이다라 (13:59 시작)');
  });
});

describe('remainText', () => {
  it('마감 시각까지 남은 분', () => {
    expect(remainText('14:40', '2026-11-14T05:30:00Z')).toBe('남은 시간 10분');
    expect(remainText('14:20', '2026-11-14T05:30:00Z')).toBe('마감 시각 지남');
    expect(remainText('', '2026-11-14T05:30:00Z')).toBe('');
  });
});

describe('(11/14) 의결 서명 명단 · ③ 이름 확인', () => {
  const vs = [
    voter('1분과 1조', '가'),
    voter('1분과 1조', '나', { started_at: '2026-11-14T05:01:00Z', answered_count: 3 }),
    voter('1분과 2조', '다', { submitted: true, submitted_at: '2026-11-14T05:02:00Z' }),
    voter('1분과 2조', '라'),
  ];
  it('서명 명단이 있으면 서명한 사람만 ①② · 분모 = 서명 인원 · 서명 안 한 사람은 빠진다', () => {
    const st = boardChaseState(board(vs), [], ['1분과 1조|나', '다', '라']);
    expect(st.useSigned).toBe(true);
    expect(st.signedCount).toBe(3);
    expect(st.unsigned).toBe(1); // 가
    expect(st.waiting.map((w) => w.name)).toEqual(['나']);
    expect(st.teams.flatMap((t) => t.names)).toEqual(['라']);
    expect(st.remaining).toBe(2);
    const text = chaseText(st, { label: '의제1', now: '2026-11-14T05:05:00Z' });
    expect(text).toContain('제출 1 / 의결 서명 3 · 남은 분 2');
    expect(text).not.toMatch(/[:,] 가( |,|$)/m);
    expect(text).toContain('· 1분과 1조(1): 나 3/19');
  });
  it('서명 명단 줄이 명단에 안 맞으면 따로 알린다(조 표기 띄어쓰기는 무시)', () => {
    const st = boardChaseState(board(vs), [], ['1분과1조|나', '홍길동', '1분과 2조|가']);
    expect(st.signedUnmatched).toEqual(['홍길동', '1분과 2조|가']);
  });
  it('서명 명단이 비면 명단 전원 기준(지금과 같음)', () => {
    const st = boardChaseState(board(vs), []);
    expect(st.useSigned).toBe(false);
    expect(chaseText(st, { label: '의제1', now: '2026-11-14T05:05:00Z' })).toContain('/ 명단 4 ·');
  });
  it('③ 한 이름에 기기 2대 이상 · 명단 밖 이름 제출 · 대리 제출 표시', () => {
    const st = boardChaseState(
      board([
        voter('1분과 1조', '가', { started_at: '2026-11-14T05:01:00Z', devices: 2 }),
        voter('1분과 2조', '다', { submitted: true, devices: 2, proxy: true }),
        voter('2분과 1조', '마', { in_roster: false, submitted: true, devices: 1 }),
        voter('1분과 2조', '라', { devices: 1 }),
      ]),
    );
    expect(st.checks.map((c) => c.name)).toEqual(['가', '다', '마']);
    const text = chaseText(st, { label: '의제1', now: '2026-11-14T05:05:00Z' });
    expect(text).toContain('③ 이름 확인 3명');
    expect(text).toContain('· 1분과 1조 가 (기기 2대, 미제출)');
    expect(text).toContain('· 1분과 2조 다 (기기 2대, 대리 입력으로 제출됨)');
    expect(text).toContain('· 2분과 1조 마 (명단 밖 이름, 제출됨)');
  });
  it('③ 은 찬반 낱말을 쓰지 않는다', () => {
    const st = boardChaseState(board([voter('1분과 1조', '가', { submitted: true, devices: 3 })]));
    expect(chaseText(st, { label: '의제1' })).not.toMatch(/찬성|반대/);
  });
});

describe('(11/14) 서명 안 한 사람의 제출', () => {
  it('머리줄 제출 수에서 빼고 ③ 에 「의결 서명 명단에 없음」으로 올린다', () => {
    const st = boardChaseState(
      board([
        voter('1분과 1조', '가', { submitted: true }),
        voter('1분과 1조', '나', { submitted: true, devices: 2 }),
        voter('1분과 2조', '다'),
      ]),
      [],
      ['1분과 1조|가', '다'],
    );
    expect(st.submittedBase).toBe(1);
    const text = chaseText(st, { label: '의제1', now: '2026-11-14T05:05:00Z' });
    expect(text).toContain('제출 1 / 의결 서명 2 · 남은 분 1');
    expect(text).toContain('· 1분과 1조 나 (의결 서명 명단에 없음, 기기 2대, 제출됨)');
  });
});
