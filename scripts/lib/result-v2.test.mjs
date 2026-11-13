import { describe, expect, test } from 'vitest';
import {
  RESULT_SCHEMA,
  VERDICTS,
  attachRequired,
  buildResultV2,
  isEstablished,
  motionNumber,
  recountAgenda,
  summaryText,
  thresholdFor,
  validateResultV2,
} from './result-v2.mjs';

// ── 가상 데이터(실명 없음) ────────────────────────────────────────────

const itemId = (a, n) => `i-${a}-${n}`;

function rawAgenda(agendaNo, count, votes, { status = 'closed', roster = null, id = `ballot-${agendaNo}` } = {}) {
  const items = Array.from({ length: count }, (_, i) => ({
    id: itemId(agendaNo, i + 1),
    ordinal: i + 1,
    statement: `${agendaNo}-${i + 1}-안1 가상 권고 ${i + 1}`,
    scale: 2,
    // 내보내기가 ballot_get 으로 채우는 칸(11/10 C — 모든 건이 필수여야 센다).
    required: true,
  }));
  const people = roster ??votes.map((_, i) => ({ team: `${agendaNo}분과 ${(i % 3) + 1}조`, no: i + 1, name: `가상${i + 1}` }));
  const responses = votes.map((v, i) => ({
    id: `r-${agendaNo}-${i}`,
    voter_team: v.team ?? people[i]?.team ?? null,
    voter_name: v.name !== undefined ? v.name : people[i]?.name ?? null,
    voter_in_roster: true,
    answers: v.answers,
    submitted_at: v.at ?? `2026-11-14T05:${String(10 + (i % 40)).padStart(2, '0')}:00Z`,
  }));
  // 11/14 투표지는 분과 지정 없음(전원 투표) — ballot_named_responses_v2 가 세션 명단 전체를 준다.
  return { id, title: `전체회의 의결 의제${agendaNo}`, status, subgroup: null, items, roster: people, responses };
}

/** n 명이 모든 건에 같은 값(2=찬성, 1=반대). */
function uniform(agendaNo, count, n, value) {
  return Array.from({ length: n }, () => ({
    answers: Object.fromEntries(Array.from({ length: count }, (_, i) => [itemId(agendaNo, i + 1), value])),
  }));
}

function agendaCfg(no, count, over = {}) {
  return {
    no,
    name: `가상 의제 ${no}`,
    count,
    ballot_id: `ballot-${no}`,
    present: 9,
    method: '휴대폰',
    confirmed: true,
    signer: '검증자',
    confirmed_at: '2026-11-14T14:48:00+09:00',
    ...over,
  };
}

function cfg(agendas, over = {}) {
  return { rehearsal: true, example: false, enrolled: 12, report: { mode: 'present_only' }, agendas, ...over };
}

const NOW = '2026-11-14T16:05:00+09:00';

// ── 산술 ──────────────────────────────────────────────────────────────

describe('기준표수 · 성립', () => {
  test('기준표수 = 출석 × 2/3 올림(정수 산술)', () => {
    expect(thresholdFor(160)).toBe(107);
    expect(thresholdFor(161)).toBe(108);
    expect(thresholdFor(159)).toBe(106);
    expect(thresholdFor(9)).toBe(6);
    expect(thresholdFor(3)).toBe(2);
  });
  test('성립 = 출석 > 재적/2', () => {
    expect(isEstablished(103, 204)).toBe(true);
    expect(isEstablished(102, 204)).toBe(false);
    expect(isEstablished(7, 12)).toBe(true);
    expect(isEstablished(6, 12)).toBe(false);
  });
  test('번호 「2-5-안1 제목」 → 「2-5」', () => {
    expect(motionNumber('2-5-안1 가상 제목')).toBe('2-5');
    expect(motionNumber('제목만')).toBeNull();
  });
});

// ── 재집계 ────────────────────────────────────────────────────────────

describe('재집계 — 명단 안 · 이름 있음 · 중복 없음 · 출석부', () => {
  test('이름 없음 · 중복(늦은 것) · 출석부 없음을 빼고 센다 — 명단 밖(직접 입력)은 빼지 않는다(11/10 결정)', () => {
    const raw = rawAgenda(1, 2, [
      { answers: { [itemId(1, 1)]: 2, [itemId(1, 2)]: 2 } }, // 가상1 유효
      { answers: { [itemId(1, 1)]: 1, [itemId(1, 2)]: 2 } }, // 가상2 유효
      { name: null, answers: { [itemId(1, 1)]: 2, [itemId(1, 2)]: 2 } }, // 이름 없음
      { name: '명단밖', answers: { [itemId(1, 1)]: 1, [itemId(1, 2)]: 1 } }, // 직접 입력(1분과 1조) — 출석부에 있으니 센다
      { name: '가상 1', team: '1분과 1조', at: '2026-11-14T05:59:00Z', answers: { [itemId(1, 1)]: 1, [itemId(1, 2)]: 1 } }, // 가상1 중복(늦음)
      { answers: { [itemId(1, 1)]: 2, [itemId(1, 2)]: 2 } }, // 가상6 — 출석부에 없음
    ]);
    raw.roster.push({ team: '1분과 1조', no: 99, name: '가상1' });
    const r = recountAgenda(raw, { agendaNo: 1, expectedCount: 2, attendance: [
      { team: '1분과 1조', name: '가상1' },
      { team: '1분과 2조', name: '가상2' },
      { team: '1분과 1조', name: '명단밖' },
    ] });
    expect(r.phoneValid).toBe(3);
    expect(r.excluded.map((e) => e.reason).sort()).toEqual(['이름 없음', '중복', '출석부 없음'].sort());
    expect(r.items[0]).toMatchObject({ no: '1-1', yes: 1, nay: 2, sysYes: 3, sysNay: 3 });
    expect(r.items[1]).toMatchObject({ no: '1-2', yes: 2, nay: 1, sysYes: 4, sysNay: 2 });
    expect(r.manual.map((m) => [m.team, m.name, m.counted])).toEqual([['1분과 1조', '명단밖', true]]);
  });
  test('(11/14) 다른 분과 소속 시민의 표도 센다 — 명단은 세션 전원', () => {
    const roster = [
      { team: '1분과 1조', no: 1, name: '가상1' },
      { team: '2분과 3조', no: 2, name: '가상2' },
      { team: '3분과 5조', no: 3, name: '가상3' },
    ];
    const raw = rawAgenda(1, 2, [
      { answers: { [itemId(1, 1)]: 2, [itemId(1, 2)]: 2 } },
      { answers: { [itemId(1, 1)]: 2, [itemId(1, 2)]: 1 } },
      { answers: { [itemId(1, 1)]: 1, [itemId(1, 2)]: 2 } },
    ], { roster });
    const r = recountAgenda(raw, { agendaNo: 1, expectedCount: 2 });
    expect(r.excluded).toEqual([]);
    expect(r.phoneValid).toBe(3);
    expect(r.items[0]).toMatchObject({ yes: 2, nay: 1 });
    expect(r.items[1]).toMatchObject({ yes: 2, nay: 1 });
  });
  test('(11/14) 분과 지정이 남은 투표지는 거부 — 명단이 그 분과로 좁혀져 다른 분과 시민은 투표하지 못했다', () => {
    const raw = rawAgenda(1, 2, uniform(1, 2, 3, 2));
    raw.subgroup = '1분과';
    expect(() => recountAgenda(raw, { agendaNo: 1, expectedCount: 2 })).toThrow(/분과 지정/);
    raw.subgroup = '  ';
    expect(() => recountAgenda(raw, { agendaNo: 1, expectedCount: 2 })).not.toThrow();
  });
  test('(현행 규칙 · 결정 대기) 동명이인 — 조가 달라도 같은 이름의 늦은 표는 「중복」으로 빠진다', () => {
    const roster = [
      { team: '1분과 1조', no: 1, name: '가상동명' },
      { team: '2분과 2조', no: 2, name: '가상동명' },
    ];
    const raw = rawAgenda(1, 2, [
      { answers: { [itemId(1, 1)]: 2, [itemId(1, 2)]: 2 } },
      { answers: { [itemId(1, 1)]: 1, [itemId(1, 2)]: 1 } },
    ], { roster });
    const r = recountAgenda(raw, { agendaNo: 1, expectedCount: 2 });
    expect(r.phoneValid).toBe(1);
    expect(r.excluded.map((e) => [e.team, e.reason])).toEqual([['2분과 2조', '중복']]);
  });
  test('서면 집계표를 더한다', () => {
    const raw = rawAgenda(1, 2, uniform(1, 2, 3, 2));
    const r = recountAgenda(raw, { agendaNo: 1, expectedCount: 2, paper: { ballots: 2, items: { '1-1': { yes: 1, nay: 1 }, '1-2': { yes: 2 } } } });
    expect(r.items[0]).toMatchObject({ yes: 4, nay: 1 });
    expect(r.items[1]).toMatchObject({ yes: 5, nay: 0 });
    expect(r.paperBallots).toBe(2);
  });
  test('건수가 다르면 거부', () => {
    expect(() => recountAgenda(rawAgenda(1, 18, []), { agendaNo: 1, expectedCount: 19 })).toThrow(/건수/);
  });
  test('번호 중복 · 다른 의제 번호 · 찬반 아닌 문항은 거부', () => {
    const dup = rawAgenda(1, 2, []);
    dup.items[1].statement = '1-1-안1 같은 번호';
    expect(() => recountAgenda(dup, { agendaNo: 1, expectedCount: 2 })).toThrow(/중복/);
    const other = rawAgenda(1, 2, []);
    other.items[0].statement = '2-1-안1 다른 의제';
    expect(() => recountAgenda(other, { agendaNo: 1, expectedCount: 2 })).toThrow(/의제/);
    const scale = rawAgenda(1, 2, []);
    scale.items[0].scale = 5;
    expect(() => recountAgenda(scale, { agendaNo: 1, expectedCount: 2 })).toThrow(/찬반/);
  });
  test('서면 집계표에 없는 번호 · 찬+반 > 서면 투표지 수는 거부', () => {
    const raw = rawAgenda(1, 2, []);
    expect(() => recountAgenda(raw, { agendaNo: 1, expectedCount: 2, paper: { ballots: 1, items: { '1-9': { yes: 1 } } } })).toThrow(/서면/);
    expect(() => recountAgenda(raw, { agendaNo: 1, expectedCount: 2, paper: { ballots: 1, items: { '1-1': { yes: 1, nay: 1 } } } })).toThrow(/서면/);
  });
});

// ── 11/10 주최 결정 + 방어선: 직접 입력 = 출석부와 맞으면 유효표 · 기권 불인정(필수 아닌 문항 · 미응답 응답은 거부) ──

describe('(11/10 결정 · 방어선 B①) 직접 입력은 출석부의 (조, 이름)과 맞을 때만 유효 — 안 맞으면 검증자 확인 목록', () => {
  const roster = [
    { team: '1분과 1조', no: 1, name: '가상일' },
    { team: '1분과 3조', no: 2, name: '가상삼' },
    { team: '2분과 2조', no: 3, name: '가상이' },
  ];
  const all = (v) => ({ [itemId(1, 1)]: v, [itemId(1, 2)]: v });
  const at = (m) => `2026-11-14T05:${String(m).padStart(2, '0')}:00Z`;
  const pairs = (...xs) => xs.map(([team, name]) => ({ team, name }));

  test('출석부 파일이 없으면 직접 입력 표는 세지 않는다 — 명단 표는 지금처럼 센다', () => {
    const raw = rawAgenda(1, 2, [
      { team: '1분과 1조', name: '가상일', at: at(10), answers: all(2) },
      { team: '3분과 4조', name: '직접가', at: at(11), answers: all(1) },
    ], { roster });
    const r = recountAgenda(raw, { agendaNo: 1, expectedCount: 2 });
    expect(r.phoneValid).toBe(1);
    expect(r.items[0]).toMatchObject({ yes: 1, nay: 0 });
    expect(r.excluded.map((e) => [e.name, e.reason])).toEqual([['직접가', '직접 입력 · 출석부 파일 없음']]);
    expect(r.manual).toEqual([
      { team: '3분과 4조', name: '직접가', submitted_at: at(11), counted: false, reason: '직접 입력 · 출석부 파일 없음', rosterTeam: null },
    ]);
  });

  test('출석부에 같은 (조, 이름)이 있으면 센다', () => {
    const raw = rawAgenda(1, 2, [
      { team: '1분과 1조', name: '가상일', at: at(10), answers: all(2) },
      { team: '3분과 4조', name: '직접 가', at: at(11), answers: all(1) },
    ], { roster });
    const r = recountAgenda(raw, { agendaNo: 1, expectedCount: 2, attendance: pairs(['1분과 1조', '가상일'], ['3분과 4조', '직접가']) });
    expect(r.excluded).toEqual([]);
    expect(r.phoneValid).toBe(2);
    expect(r.items[0]).toMatchObject({ yes: 1, nay: 1 });
    expect(r.manual).toEqual([
      { team: '3분과 4조', name: '직접 가', submitted_at: at(11), counted: true, reason: null, rosterTeam: null },
    ]);
  });

  test('출석부에 없거나 조가 다르면 세지 않는다 — 명단 이름을 다른 조로 친 표(대리 의심)도 같다', () => {
    const raw = rawAgenda(1, 2, [
      { team: '3분과 4조', name: '직접가', at: at(10), answers: all(2) }, // 출석부에 없음
      { team: '2분과 5조', name: '가상삼', at: at(11), answers: all(1) }, // 명단에는 1분과 3조 — 출석부도 1분과 3조
    ], { roster });
    const r = recountAgenda(raw, { agendaNo: 1, expectedCount: 2, attendance: pairs(['1분과 3조', '가상삼'], ['3분과 4조', '다른이']) });
    expect(r.phoneValid).toBe(0);
    expect(r.manual.map((m) => [m.name, m.counted, m.reason, m.rosterTeam])).toEqual([
      ['직접가', false, '출석부 없음', null],
      ['가상삼', false, '출석부 없음', '1분과 3조'],
    ]);
  });

  test('직접 입력이 먼저면(출석부와 맞음) 그 표를 세고, 같은 이름(공백 · 대소문자 무시)의 명단 표는 「중복」', () => {
    const raw = rawAgenda(1, 2, [
      { team: '2분과 1조', name: '가상 삼', at: at(10), answers: all(1) },
      { team: '1분과 3조', name: '가상삼', at: at(12), answers: all(2) },
    ], { roster });
    const r = recountAgenda(raw, { agendaNo: 1, expectedCount: 2, attendance: pairs(['2분과 1조', '가상삼'], ['1분과 3조', '가상삼']) });
    expect(r.phoneValid).toBe(1);
    expect(r.items[0]).toMatchObject({ yes: 0, nay: 1 });
    expect(r.excluded.map((e) => [e.team, e.reason])).toEqual([['1분과 3조', '중복']]);
    expect(r.manual).toEqual([
      { team: '2분과 1조', name: '가상 삼', submitted_at: at(10), counted: true, reason: null, rosterTeam: '1분과 3조' },
    ]);
  });

  test('명단 표가 먼저면 같은 이름의 직접 입력은 「중복」 — 이중 집계 없음', () => {
    const raw = rawAgenda(1, 2, [
      { team: '1분과 3조', name: '가상삼', at: at(10), answers: all(2) },
      { team: '2분과 1조', name: '가상삼', at: at(12), answers: all(1) },
    ], { roster });
    const r = recountAgenda(raw, { agendaNo: 1, expectedCount: 2, attendance: pairs(['1분과 3조', '가상삼'], ['2분과 1조', '가상삼']) });
    expect(r.phoneValid).toBe(1);
    expect(r.items[0]).toMatchObject({ yes: 1, nay: 0 });
    expect(r.excluded.map((e) => [e.team, e.reason])).toEqual([['2분과 1조', '중복']]);
    expect(r.manual).toEqual([
      { team: '2분과 1조', name: '가상삼', submitted_at: at(12), counted: false, reason: '중복', rosterTeam: '1분과 3조' },
    ]);
  });

  test('직접 입력끼리 같은 이름(정규화 후)이면 먼저 낸 것만 센다', () => {
    const raw = rawAgenda(1, 2, [
      { team: '3분과 1조', name: 'Kim Ga', at: at(10), answers: all(2) },
      { team: '3분과 2조', name: 'kimga', at: at(11), answers: all(1) },
    ], { roster });
    const r = recountAgenda(raw, { agendaNo: 1, expectedCount: 2, attendance: pairs(['3분과 1조', 'kimga'], ['3분과 2조', 'kimga']) });
    expect(r.phoneValid).toBe(1);
    expect(r.items[0]).toMatchObject({ yes: 1, nay: 0 });
    expect(r.manual.map((m) => [m.name, m.counted, m.reason])).toEqual([
      ['Kim Ga', true, null],
      ['kimga', false, '중복'],
    ]);
  });

  test('result/v2 에 출석부와 맞는 직접 입력 표가 들어간다', () => {
    const raw = rawAgenda(1, 1, [
      ...uniform(1, 1, 5, 2),
      { team: '3분과 4조', name: '직접가', answers: { [itemId(1, 1)]: 2 } },
    ]);
    // 출석 9 = 투표한 6명 + 투표하지 않은 3명.
    const attendance = [...raw.roster.map(({ team, name }) => ({ team, name })), { team: '3분과 4조', name: '직접가' }, ...pairs(['9조', '불참1'], ['9조', '불참2'], ['9조', '불참3'])];
    const { doc } = buildResultV2(cfg([agendaCfg(1, 1, { attendance })]), { 1: raw }, { generatedAt: NOW });
    expect(doc.items[0]).toMatchObject({ yes: 6, nay: 0, abstain: 3, verdict: '가결' });
  });

  test('출석부 사람 수가 출석보다 적으면 거부 — 직접 입력자만 적은 출석부로 명단 표가 다 빠지는 일을 막는다', () => {
    const raw = rawAgenda(1, 1, [...uniform(1, 1, 5, 2), { team: '3분과 4조', name: '직접가', answers: { [itemId(1, 1)]: 2 } }]);
    const only = [{ team: '3분과 4조', name: '직접가' }];
    expect(() => buildResultV2(cfg([agendaCfg(1, 1, { attendance: only })]), { 1: raw }, { generatedAt: NOW })).toThrow(/출석부 1명 < 출석 9/);
    // 같은 (조, 이름)은 한 사람으로 센다.
    const twice = Array.from({ length: 9 }, () => ({ team: '3분과 4조', name: '직접 가' }));
    expect(() => buildResultV2(cfg([agendaCfg(1, 1, { attendance: twice })]), { 1: raw }, { generatedAt: NOW })).toThrow(/출석부 1명/);
  });
});

describe('(방어선 B③) 고의 결함 — 지어낸 이름 여러 개로 직접 입력 표를 채운 원자료', () => {
  const FAKE = 12;
  const fakeVotes = () =>
    Array.from({ length: FAKE }, (_, i) => ({ team: '3분과 5조', name: `지어낸${i + 1}`, answers: { [itemId(1, 1)]: 1, [itemId(1, 2)]: 1 } }));
  const raw = () => rawAgenda(1, 2, [...uniform(1, 2, 5, 2), ...fakeVotes()]);
  const rosterPairs = (r) => r.roster.slice(0, 5).map(({ team, name }) => ({ team, name }));
  const absent = (n) => Array.from({ length: n }, (_, i) => ({ team: '9조', name: `불참${i + 1}` }));

  test('① 출석부가 없으면 지어낸 이름은 하나도 세지 않는다 — 전부 검증자 확인 목록, 파일은 만든다', () => {
    const built = buildResultV2(cfg([agendaCfg(1, 2)]), { 1: raw() }, { generatedAt: NOW });
    expect(built.doc.items.map((i) => [i.yes, i.nay])).toEqual([[5, 0], [5, 0]]);
    const rc = built.recounts[0];
    expect(rc.phoneValid).toBe(5);
    expect(rc.manual).toHaveLength(FAKE);
    expect(rc.manual.every((m) => !m.counted && m.reason === '직접 입력 · 출석부 파일 없음')).toBe(true);
    const txt = summaryText(built.doc, built.recounts, 'f'.repeat(64));
    expect(txt).toMatch(/직접 입력\(명단에 없는 조·이름\) 12건 — 유효 0 · 검증자 확인 목록 12\(집계 제외\)/);
    expect(txt).toContain('확인 목록: 3분과 5조 지어낸7 ·');
  });

  test('① 출석부에 없는 지어낸 이름은 세지 않는다', () => {
    const r = raw();
    const attendance = [...rosterPairs(r), ...absent(4)];
    const built = buildResultV2(cfg([agendaCfg(1, 2, { attendance })]), { 1: r }, { generatedAt: NOW });
    expect(built.recounts[0].phoneValid).toBe(5);
    expect(built.recounts[0].manual.every((m) => m.reason === '출석부 없음')).toBe(true);
    expect(built.doc.items[0]).toMatchObject({ yes: 5, nay: 0, abstain: 4 });
  });

  test('② 출석부가 지어낸 이름까지 받아 유효표가 출석을 넘으면 파일을 만들지 않는다', () => {
    const r = raw();
    const generous = [...rosterPairs(r), ...r.responses.slice(5).map((x) => ({ team: x.voter_team, name: x.voter_name }))];
    expect(generous).toHaveLength(17);
    // 출석 9 인데 유효 17.
    expect(() => buildResultV2(cfg([agendaCfg(1, 2, { attendance: generous })]), { 1: r }, { generatedAt: NOW })).toThrow(/휴대폰 유효표 17 \+ 서면 0 > 출석 9/);
    // 고친 출석(17)이면 만든다 — 이 거부는 출석 수와의 대조다.
    expect(() => buildResultV2(cfg([agendaCfg(1, 2, { attendance: generous, present: 17 })], { enrolled: 20 }), { 1: r }, { generatedAt: NOW })).not.toThrow();
  });
});

describe('(11/10 결정 · C) 기권 불인정 — 필수 아닌 문항이 있는 투표지 · 누르지 않은 건이 있는 응답은 거부', () => {
  const roster = [
    { team: '1분과 1조', no: 1, name: '가상일' },
    { team: '1분과 2조', no: 2, name: '가상이' },
  ];
  const at = (m) => `2026-11-14T05:${String(m).padStart(2, '0')}:00Z`;

  test('「누르지 않은 건 허용」(required=false) 문항이 하나라도 있으면 그 투표지를 세지 않는다', () => {
    const raw = rawAgenda(1, 3, uniform(1, 3, 2, 2), { roster });
    raw.items[1].required = false;
    raw.items[2].required = false;
    expect(() => recountAgenda(raw, { agendaNo: 1, expectedCount: 3 })).toThrow(/필수가 아닌 문항 2건\(1-2, 1-3\)/);
    expect(() => buildResultV2(cfg([agendaCfg(1, 3)]), { 1: raw }, { generatedAt: NOW })).toThrow(/누르지 않은 건 허용/);
  });

  test('필수 표시(required)를 원자료에서 읽지 못하면 거부 — 「필수 아님」과 다른 문구(다시 받기)', () => {
    const raw = rawAgenda(1, 2, uniform(1, 2, 2, 2), { roster });
    delete raw.items[0].required;
    expect(() => recountAgenda(raw, { agendaNo: 1, expectedCount: 2 })).toThrow(/필수 표시\(required\)를 읽지 못한 문항 1건\(1-1\).*rpc 로 다시/);
  });

  test('누르지 않은 건이 있는 응답이 하나라도 있으면 조용히 빼지 않고 거부한다 — 조 · 이름 · 시각 · 빠진 번호', () => {
    const raw = rawAgenda(1, 3, [
      { team: '1분과 1조', name: '가상일', at: at(10), answers: { [itemId(1, 1)]: 2, [itemId(1, 2)]: 2, [itemId(1, 3)]: 2 } },
      { team: '1분과 2조', name: '가상이', at: at(11), answers: { [itemId(1, 1)]: 2, [itemId(1, 3)]: 1 } },
    ], { roster });
    expect(() => recountAgenda(raw, { agendaNo: 1, expectedCount: 3 })).toThrow(
      /누르지 않은 건이 있는 응답 1건[\s\S]*1분과 2조 가상이 · 2026-11-14T05:11:00Z · 누르지 않은 건 1건\(1-2\)/,
    );
  });

  test('찬반(1 · 2)이 아닌 값도 누르지 않은 건이다 · 이름 없음 · 중복 응답이어도 거부한다(서버가 막았어야 하는 행)', () => {
    const three = rawAgenda(1, 2, [{ team: '1분과 1조', name: '가상일', answers: { [itemId(1, 1)]: 2, [itemId(1, 2)]: 3 } }], { roster });
    expect(() => recountAgenda(three, { agendaNo: 1, expectedCount: 2 })).toThrow(/누르지 않은 건/);
    const anon = rawAgenda(1, 2, [...uniform(1, 2, 2, 2), { name: null, team: null, answers: { [itemId(1, 1)]: 2 } }], { roster });
    expect(() => recountAgenda(anon, { agendaNo: 1, expectedCount: 2 })).toThrow(/\(조 없음\) \(이름 없음\)/);
  });

  test('모든 건을 누른 응답만 있으면 센다', () => {
    const r = recountAgenda(rawAgenda(1, 2, uniform(1, 2, 2, 1), { roster }), { agendaNo: 1, expectedCount: 2 });
    expect(r.phoneValid).toBe(2);
    expect(r.items.map((i) => [i.yes, i.nay])).toEqual([[0, 2], [0, 2]]);
  });
});

describe('ballot_get 의 필수 표시를 원자료 문항에 붙인다(attachRequired)', () => {
  const raw = () => ({ id: 'b', items: [{ id: 'x', ordinal: 1, statement: '1-1-안1 가', scale: 2 }, { id: 'y', ordinal: 2, statement: '1-2-안1 나', scale: 2 }] });
  test('문항 id 로 맞춰 required 를 붙인다(원자료는 바꾸지 않는다)', () => {
    const src = raw();
    const out = attachRequired(src, { items: [{ id: 'y', required: false }, { id: 'x', required: true }] });
    expect(out.items.map((i) => [i.id, i.required])).toEqual([['x', true], ['y', false]]);
    expect(src.items[0].required).toBeUndefined();
  });
  test('ballot_get 이 null(초안 · 보관)이거나 짝이 없는 문항은 비워 둔다 — 재집계가 「읽지 못함」으로 거부', () => {
    expect(attachRequired(raw(), null).items.map((i) => i.required)).toEqual([undefined, undefined]);
    expect(attachRequired(raw(), { items: [{ id: 'x', required: true }] }).items.map((i) => i.required)).toEqual([true, undefined]);
    expect(attachRequired(raw(), { items: [{ id: 'x', required: 'yes' }] }).items[0].required).toBeUndefined();
  });
});

describe('검증자 요약 — 직접 입력 목록(유효 · 검증자 확인 목록)', () => {
  test('직접 입력 표를 조 · 이름 · 제출 시각으로 따로 적고, 세지 않은 것은 「확인 목록」으로 사유와 함께 적는다', () => {
    const roster = [{ team: '1분과 3조', no: 1, name: '가상삼' }];
    const raw = rawAgenda(1, 2, [
      { team: '1분과 3조', name: '가상삼', at: '2026-11-14T05:10:00Z', answers: { [itemId(1, 1)]: 2, [itemId(1, 2)]: 2 } },
      { team: '2분과 4조', name: '직접가', at: '2026-11-14T05:11:00Z', answers: { [itemId(1, 1)]: 2, [itemId(1, 2)]: 1 } },
      { team: '2분과 5조', name: '가상 삼', at: '2026-11-14T05:12:00Z', answers: { [itemId(1, 1)]: 1, [itemId(1, 2)]: 1 } },
      { team: '3분과 1조', name: '모르는이', at: '2026-11-14T05:13:00Z', answers: { [itemId(1, 1)]: 2, [itemId(1, 2)]: 2 } },
    ], { roster });
    const attendance = [
      { team: '1분과 3조', name: '가상삼' },
      { team: '2분과 4조', name: '직접가' },
      ...Array.from({ length: 7 }, (_, i) => ({ team: '9조', name: `불참${i + 1}` })),
    ];
    const built = buildResultV2(cfg([agendaCfg(1, 2, { attendance })]), { 1: raw }, { generatedAt: NOW });
    const txt = summaryText(built.doc, built.recounts, 'f'.repeat(64));
    expect(txt).toMatch(/직접 입력\(명단에 없는 조·이름\) 3건 — 유효 1 · 검증자 확인 목록 2\(집계 제외\)/);
    expect(txt).toContain('    - 유효: 2분과 4조 직접가 · 2026-11-14T05:11:00Z');
    expect(txt).toContain('    - 확인 목록: 2분과 5조 가상 삼 · 2026-11-14T05:12:00Z · 중복 · 명단에는 1분과 3조');
    expect(txt).toContain('    - 확인 목록: 3분과 1조 모르는이 · 2026-11-14T05:13:00Z · 출석부 없음');
    expect(txt).not.toMatch(/미응답/);
  });

  test('직접 입력이 없어도 「0건」 줄을 적는다', () => {
    const built = buildResultV2(cfg([agendaCfg(1, 1)]), { 1: rawAgenda(1, 1, uniform(1, 1, 7, 2)) }, { generatedAt: NOW });
    expect(summaryText(built.doc, built.recounts, 'f'.repeat(64))).toMatch(/직접 입력\(명단에 없는 조·이름\) 0건/);
  });
});

// ── 결과 파일 ─────────────────────────────────────────────────────────

describe('result/v2 만들기 — 판정 분기', () => {
  test('가결 · 부결 · 기권 = 출석 − 찬성 − 반대', () => {
    // 의제1: 9명 출석, 2건. 6명 1-1 찬성(가결 기준 6) / 1-2 는 5명 찬성 1명 반대(부결), 3명은 미제출.
    const votes = Array.from({ length: 6 }, (_, i) => ({ answers: { [itemId(1, 1)]: 2, [itemId(1, 2)]: i === 0 ? 1 : 2 } }));
    const { doc } = buildResultV2(cfg([agendaCfg(1, 2)]), { 1: rawAgenda(1, 2, votes) }, { generatedAt: NOW });
    expect(doc.schema).toBe(RESULT_SCHEMA);
    expect(doc.agendas[0]).toMatchObject({ present: 9, enrolled: 12, threshold: 6, established: true, confirmed: true });
    expect(doc.items[0]).toMatchObject({ no: '1-1', yes: 6, nay: 0, abstain: 3, verdict: '가결' });
    expect(doc.items[1]).toMatchObject({ no: '1-2', yes: 5, nay: 1, abstain: 3, verdict: '부결' });
    expect(doc.status).toBe('확정');
    expect(doc.summary).toEqual({ total: 2, passed: 1, failed: 1, not_established: 0, pending: 0 });
    expect(validateResultV2(doc)).toEqual([]);
  });
  test('미확정 의제는 표수를 null 로, 판정은 「미확정」, 전체 상태는 「일부 확정」', () => {
    const c = cfg([agendaCfg(1, 1), agendaCfg(2, 1, { confirmed: false, signer: null, confirmed_at: null })]);
    const { doc } = buildResultV2(c, { 1: rawAgenda(1, 1, uniform(1, 1, 7, 2)), 2: rawAgenda(2, 1, uniform(2, 1, 7, 2), { status: 'open' }) }, { generatedAt: NOW });
    expect(doc.items[1]).toEqual({ no: '2-1', agenda: 2, title: '가상 권고 1', yes: null, nay: null, abstain: null, verdict: '미확정', corrected: null });
    expect(doc.status).toBe('일부 확정');
    expect(doc.summary.pending).toBe(1);
    expect(validateResultV2(doc)).toEqual([]);
  });
  test('성립 미달(출석 ≤ 재적/2)이면 「불성립」 — 찬성이 기준을 넘어도', () => {
    const c = cfg([agendaCfg(1, 1, { present: 6 })]);
    const { doc } = buildResultV2(c, { 1: rawAgenda(1, 1, uniform(1, 1, 6, 2)) }, { generatedAt: NOW });
    expect(doc.agendas[0].established).toBe(false);
    expect(doc.items[0].verdict).toBe('불성립');
    expect(doc.summary.not_established).toBe(1);
    expect(validateResultV2(doc)).toEqual([]);
  });
  test('성립 경계 — 출석 7/12 는 성립, 기준 5표(7×2/3 올림), 찬성 5 → 가결', () => {
    const c = cfg([agendaCfg(1, 1, { present: 7 })]);
    const { doc } = buildResultV2(c, { 1: rawAgenda(1, 1, uniform(1, 1, 5, 2)) }, { generatedAt: NOW });
    expect(doc.agendas[0]).toMatchObject({ threshold: 5, established: true });
    expect(doc.items[0].verdict).toBe('가결');
  });
  test('보고서 승인 표결(report_mode vote)', () => {
    const c = cfg([agendaCfg(1, 1)], {
      report: { mode: 'vote', present: 9, yes: 7, nay: 1, confirmed: true, signer: '검증자', confirmed_at: '2026-11-14T16:10:00+09:00' },
    });
    const { doc } = buildResultV2(c, { 1: rawAgenda(1, 1, uniform(1, 1, 7, 2)) }, { generatedAt: NOW });
    expect(doc.report_mode).toBe('vote');
    expect(doc.report).toMatchObject({ status: '확정', yes: 7, nay: 1, abstain: 1, threshold: 6, verdict: '가결' });
    expect(validateResultV2(doc)).toEqual([]);
  });
  test('보고서 표결 투표지를 다시 셀 때도 같은 규칙 — 직접 입력은 보고서 출석부와 맞을 때만 · 필수 아닌 문항은 거부', () => {
    const rep = (over) => ({ mode: 'vote', present: 9, confirmed: true, signer: '검증자', confirmed_at: '2026-11-14T16:10:00+09:00', ...over });
    const reportRaw = () => rawAgenda(1, 1, [...uniform(1, 1, 5, 2), { team: '3분과 4조', name: '직접가', answers: { [itemId(1, 1)]: 2 } }], { id: 'report' });
    const base = { 1: rawAgenda(1, 1, uniform(1, 1, 7, 2)) };
    const no = buildResultV2(cfg([agendaCfg(1, 1)], { report: rep() }), { ...base, report: reportRaw() }, { generatedAt: NOW });
    expect(no.doc.report).toMatchObject({ yes: 5, nay: 0 });
    const r = reportRaw();
    const attendance = [...r.roster.slice(0, 5).map(({ team, name }) => ({ team, name })), { team: '3분과 4조', name: '직접가' }, { team: '9조', name: '불참1' }, { team: '9조', name: '불참2' }, { team: '9조', name: '불참3' }];
    const yes = buildResultV2(cfg([agendaCfg(1, 1)], { report: rep({ attendance }) }), { ...base, report: r }, { generatedAt: NOW });
    expect(yes.doc.report).toMatchObject({ yes: 6, nay: 0, abstain: 3 });
    expect(() => buildResultV2(cfg([agendaCfg(1, 1)], { report: rep({ attendance: attendance.slice(5, 6) }) }), { ...base, report: reportRaw() }, { generatedAt: NOW })).toThrow(/보고서: 출석부 1명 < 출석 9/);
    const optional = reportRaw();
    optional.items[0].required = false;
    expect(() => buildResultV2(cfg([agendaCfg(1, 1)], { report: rep() }), { ...base, report: optional }, { generatedAt: NOW })).toThrow(/보고서: .*필수가 아닌 문항/);
  });
  test('보고서 발표만(present_only)', () => {
    const { doc } = buildResultV2(cfg([agendaCfg(1, 1)]), { 1: rawAgenda(1, 1, uniform(1, 1, 7, 2)) }, { generatedAt: NOW });
    expect(doc.report_mode).toBe('present_only');
    expect(doc.report).toEqual({ status: '발표' });
  });
});

describe('result/v2 만들기 — 거부(파일을 만들지 않는다)', () => {
  const one = (over, votes = uniform(1, 1, 7, 2), rawOver = {}) => () =>
    buildResultV2(cfg([agendaCfg(1, 1, over)]), { 1: rawAgenda(1, 1, votes, rawOver) }, { generatedAt: NOW });
  test('확정인데 서명자 · 확정 시각이 없으면 거부', () => {
    expect(one({ signer: '' })).toThrow(/서명/);
    expect(one({ confirmed_at: null })).toThrow(/확정 시각/);
    expect(one({ confirmed_at: '2026-11-14 14:48' })).toThrow(/확정 시각/);
  });
  test('찬성 + 반대 > 출석이면 거부', () => {
    expect(one({ present: 7 }, uniform(1, 1, 8, 2))).toThrow(/출석/);
  });
  test('휴대폰 유효표 + 서면 투표지 > 출석이면 거부(판정 못 함)', () => {
    expect(one({ present: 7, paper: { ballots: 1, items: {} } })).toThrow(/휴대폰 유효표 7 \+ 서면 1 > 출석 7/);
    expect(one({ present: 8, paper: { ballots: 1, items: {} } })).not.toThrow();
  });
  test('출석 > 재적 · 출석 0 이면 거부', () => {
    expect(one({ present: 13 })).toThrow(/재적/);
    expect(one({ present: 0 }, [])).toThrow(/출석/);
  });
  test('확정인데 투표지가 아직 열려 있으면 거부', () => {
    expect(one({}, uniform(1, 1, 7, 2), { status: 'open' })).toThrow(/열려/);
  });
  test('투표지 id 가 설정과 다르면 거부', () => {
    expect(one({ ballot_id: 'other' })).toThrow(/id/);
  });
  test('실전(rehearsal=false)은 의제 1·2·3 = 19·28·23건이어야 한다', () => {
    expect(() =>
      buildResultV2(cfg([agendaCfg(1, 1)], { rehearsal: false }), { 1: rawAgenda(1, 1, uniform(1, 1, 7, 2)) }, { generatedAt: NOW }),
    ).toThrow(/19 · 28 · 23/);
  });
  test('example · rehearsal 은 참/거짓만', () => {
    expect(() => buildResultV2(cfg([agendaCfg(1, 1)], { rehearsal: 'yes' }), { 1: rawAgenda(1, 1, uniform(1, 1, 7, 2)) }, { generatedAt: NOW })).toThrow(/rehearsal/);
  });
});

describe('검사기 — 손댄 파일을 잡는다', () => {
  const good = () =>
    buildResultV2(cfg([agendaCfg(1, 2)]), { 1: rawAgenda(1, 2, uniform(1, 2, 7, 2)) }, { generatedAt: NOW }).doc;
  test('verdict 허용값 밖', () => {
    const d = good();
    d.items[0].verdict = '통과';
    expect(validateResultV2(d).join('\n')).toMatch(/verdict/);
    expect(VERDICTS).toEqual(['가결', '부결', '불성립', '미확정']);
  });
  test('판정이 재계산과 다름', () => {
    const d = good();
    d.items[0].verdict = '부결';
    expect(validateResultV2(d).join('\n')).toMatch(/재계산/);
  });
  test('기권 · 기준표수 · 성립 · 요약 · 상태 조작', () => {
    const d = good();
    d.items[0].abstain = 0;
    d.agendas[0].threshold = 5;
    d.agendas[0].established = false;
    d.summary.passed = 0;
    d.status = '미확정';
    const msg = validateResultV2(d).join('\n');
    expect(msg).toMatch(/abstain/);
    expect(msg).toMatch(/threshold/);
    expect(msg).toMatch(/established/);
    expect(msg).toMatch(/summary/);
    expect(msg).toMatch(/status/);
  });
  test('schema 가 다르거나 의제 건수와 items 수가 다르면', () => {
    const d = good();
    d.schema = 'result/v1';
    d.items.pop();
    const msg = validateResultV2(d).join('\n');
    expect(msg).toMatch(/schema/);
    expect(msg).toMatch(/count/);
  });
});

describe('검증자용 요약', () => {
  test('의제별 가결 · 부결 번호와 합계, 리허설 표시, 뺀 표 사유', () => {
    const votes = [...uniform(1, 2, 6, 2), { name: null, answers: { [itemId(1, 1)]: 2, [itemId(1, 2)]: 2 } }];
    const { doc, recounts } = buildResultV2(cfg([agendaCfg(1, 2)]), { 1: rawAgenda(1, 2, votes) }, { generatedAt: NOW });
    const t = summaryText(doc, recounts, 'abc123');
    expect(t).toMatch(/리허설/);
    expect(t).toMatch(/가결 2건: 1-1, 1-2/);
    expect(t).toMatch(/이름 없음 1/);
    expect(t).toMatch(/abc123/);
    expect(t).toMatch(/합계 2건/);
  });
});

describe('(11/11) 한 장 70건 투표지를 의제별로 나눠 센다', () => {
  test('제목이 「전체회의 의결 정책권고안」이면 번호 앞자리 문항만 남긴다', async () => {
    const { sliceAgendaOfAll } = await import('./result-v2.mjs');
    const a = rawAgenda(1, 2, []);
    const b = rawAgenda(2, 3, []);
    const all = { ...a, id: 'one', title: '전체회의 의결 정책권고안', items: [...a.items, ...b.items] };
    expect(sliceAgendaOfAll(all, 2).items.map((it) => it.statement.slice(0, 3))).toEqual(['2-1', '2-2', '2-3']);
    expect(sliceAgendaOfAll(all, 1).items).toHaveLength(2);
    expect(sliceAgendaOfAll(a, 2)).toBe(a);
  });
});

describe('(11/13 결정) 수정 표 「이름(수정)」 — 진행요원 대리 입력이 원래 표를 대신한다', () => {
  const ans = (a, b) => ({ [itemId(1, 1)]: a, [itemId(1, 2)]: b });
  test('원래 표는 「수정으로 대체」로 빠지고 수정 표가 그 이름으로 센다 — 이중 집계 없음', () => {
    const raw = rawAgenda(1, 2, [
      { answers: ans(1, 1) }, // 가상1 원래 표(반대 · 반대)
      { answers: ans(2, 2) }, // 가상2
      { name: '가상1(수정)', team: '1분과 1조', at: '2026-11-14T05:50:00Z', answers: ans(2, 1) },
    ]);
    const r = recountAgenda(raw, { agendaNo: 1, expectedCount: 2, attendance: [
      { team: '1분과 1조', name: '가상1' },
      { team: '1분과 2조', name: '가상2' },
    ] });
    expect(r.phoneValid).toBe(2);
    expect(r.excluded.map((e) => [e.name, e.reason])).toEqual([['가상1', '수정으로 대체']]);
    expect(r.corrected).toEqual([{ team: '1분과 1조', name: '가상1', submitted_at: '2026-11-14T05:50:00Z' }]);
    expect(r.manual).toEqual([]); // 기준 이름이 명단에 있으니 직접 입력이 아니다
    expect(r.items[0]).toMatchObject({ yes: 2, nay: 0 });
    expect(r.items[1]).toMatchObject({ yes: 1, nay: 1 });
  });
  test('수정이 둘이면 마지막 것만 · 전각 괄호 · 공백도 받는다 · 다른 조의 같은 이름은 대체하지 않는다', () => {
    const raw = rawAgenda(1, 2, [
      { answers: ans(1, 1) }, // 가상1(1분과 1조)
      { name: '가상1 (수정)', team: '1분과 1조', at: '2026-11-14T05:50:00Z', answers: ans(2, 2) },
      { name: '가상1（수정）', team: '1분과 1조', at: '2026-11-14T05:55:00Z', answers: ans(1, 2) },
    ]);
    const r = recountAgenda(raw, { agendaNo: 1, expectedCount: 2, attendance: [{ team: '1분과 1조', name: '가상1' }] });
    expect(r.phoneValid).toBe(1);
    expect(r.excluded.map((e) => e.reason)).toEqual(['수정으로 대체', '앞선 수정(마지막 수정만 셈)']);
    expect(r.items[0]).toMatchObject({ yes: 0, nay: 1 });
    expect(r.items[1]).toMatchObject({ yes: 1, nay: 0 });
  });
  test('원래 표가 없어도 수정 표는 그 이름으로 센다(출석부 대조는 기준 이름)', () => {
    const raw = rawAgenda(1, 2, [{ name: '가상1(수정)', team: '1분과 1조', answers: ans(2, 2) }], {
      roster: [{ team: '1분과 1조', no: 1, name: '가상1' }],
    });
    const ok = recountAgenda(raw, { agendaNo: 1, expectedCount: 2, attendance: [{ team: '1분과 1조', name: '가상1' }] });
    expect(ok.phoneValid).toBe(1);
    const no = recountAgenda(raw, { agendaNo: 1, expectedCount: 2, attendance: [{ team: '1분과 1조', name: '다른사람' }] });
    expect(no.excluded.map((e) => e.reason)).toEqual(['출석부 없음']);
  });
});
