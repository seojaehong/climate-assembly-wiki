import { describe, expect, test } from 'vitest';
import {
  RESULT_SCHEMA,
  VERDICTS,
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
  }));
  const people = roster ?? votes.map((_, i) => ({ team: `${agendaNo}분과 ${(i % 3) + 1}조`, no: i + 1, name: `가상${i + 1}` }));
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
  test('이름 없음 · 명단 밖 · 중복(늦은 것) · 출석부 없음을 빼고 센다', () => {
    const raw = rawAgenda(1, 2, [
      { answers: { [itemId(1, 1)]: 2, [itemId(1, 2)]: 2 } }, // 가상1 유효
      { answers: { [itemId(1, 1)]: 1, [itemId(1, 2)]: 2 } }, // 가상2 유효
      { name: null, answers: { [itemId(1, 1)]: 2 } }, // 이름 없음
      { name: '명단밖', answers: { [itemId(1, 1)]: 2 } }, // 명단 밖
      { name: '가상 1', team: '1분과 1조', at: '2026-11-14T05:59:00Z', answers: { [itemId(1, 1)]: 1 } }, // 가상1 중복(늦음)
      { answers: { [itemId(1, 1)]: 2 } }, // 가상6 — 출석부에 없음
    ]);
    raw.roster.push({ team: '1분과 1조', no: 99, name: '가상1' });
    const r = recountAgenda(raw, { agendaNo: 1, expectedCount: 2, attendance: [
      { team: '1분과 1조', name: '가상1' },
      { team: '1분과 2조', name: '가상2' },
    ] });
    expect(r.phoneValid).toBe(2);
    expect(r.excluded.map((e) => e.reason).sort()).toEqual(['명단 밖', '이름 없음', '중복', '출석부 없음'].sort());
    expect(r.items[0]).toMatchObject({ no: '1-1', yes: 1, nay: 1, sysYes: 4, sysNay: 2 });
    expect(r.items[1]).toMatchObject({ no: '1-2', yes: 2, nay: 0 });
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
  test('(11/14) 분과 지정이 남은 투표지는 거부 — 명단이 그 분과로 좁혀져 다른 분과 표가 「명단 밖」이 된다', () => {
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
  test('유효 제출 + 서면 투표지 > 출석이면 거부(판정 못 함)', () => {
    expect(one({ present: 7, paper: { ballots: 1, items: {} } }, Array.from({ length: 7 }, () => ({ answers: {} })))).toThrow(/출석/);
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
    const votes = [...uniform(1, 2, 6, 2), { name: null, answers: { [itemId(1, 1)]: 2 } }];
    const { doc, recounts } = buildResultV2(cfg([agendaCfg(1, 2)]), { 1: rawAgenda(1, 2, votes) }, { generatedAt: NOW });
    const t = summaryText(doc, recounts, 'abc123');
    expect(t).toMatch(/리허설/);
    expect(t).toMatch(/가결 2건: 1-1, 1-2/);
    expect(t).toMatch(/이름 없음 1/);
    expect(t).toMatch(/abc123/);
    expect(t).toMatch(/합계 2건/);
  });
});
