import { describe, expect, it } from 'vitest';
import {
  AGENDA_PRESETS,
  agendaTopicNo,
  buildDivisionBallot,
  cardsInMotions,
  createAgendaMotion,
  createMotion,
  deleteMotion,
  groupRecTexts,
  importSimilarGroups,
  initPrepState,
  isAgendaMotion,
  parseImport,
  parseSimilarGroups,
  readStoredPrep,
  serializePrep,
  updateMotion,
  type PrepState,
} from './division-vote-logic';
import { beginVote, resultCsvRows, voteUnits } from './division-vote-flow';
import { parseMotionStatement } from '../../lib/division-ballot-format';
import { DIVISION_VOTE_FIXTURE } from './division-vote-fixture';

/**
 * 10/14 추진계획안5 — 유사 묶음 불러오기 · 카드 공유 · 카드 없는 안건.
 * 묶음 파일은 **가상**(실제 묶음 이름·문구 금지). 실제 파일과 같은 모양(division 「N분과」, groups 배열).
 */

const div2 = DIVISION_VOTE_FIXTURE[0];
const fresh = (): PrepState => initPrepState(div2);

const FAKE_GROUPS = JSON.stringify({
  source: '가상 묶음 파일(시험용)',
  groups: [
    { id: '유사1', division: '2분과', name: '가상 공통 취지 하나', recs: ['2-1-1-1', '2-1-2-2'], cards: ['2-1-2', '2-1-1'], teams: ['1조', '2조'] },
    { id: '유사2', division: '2분과', name: '가상 공통 취지 둘', recs: ['2-1-1-3', '2-4-1-1'], cards: ['2-1-1', '2-4-1'], teams: ['3조'] },
    { id: '유사3', division: '2분과', name: '가상 공통 취지 셋', recs: ['2-1-3-1', '2-1-3-4'], cards: ['2-1-3'], teams: ['5조'] },
    { id: '유사9', division: '3분과', name: '가상 다른 분과', recs: ['3-1-1-1'], cards: ['3-1-1'], teams: ['1조'] },
  ],
});

function groups() {
  const p = parseSimilarGroups(FAKE_GROUPS);
  if (!p.ok) throw new Error(p.message);
  return p.groups;
}

describe('유사 묶음 파일 판독', () => {
  it('「N분과」 문자열 분과를 숫자로 읽고 네 묶음을 다 읽는다', () => {
    const g = groups();
    expect(g.map((x) => [x.id, x.division])).toEqual([
      ['유사1', 2],
      ['유사2', 2],
      ['유사3', 2],
      ['유사9', 3],
    ]);
  });
  it('모양이 틀리면 통째로 거절한다', () => {
    expect(parseSimilarGroups('{').ok).toBe(false);
    expect(parseSimilarGroups('{"groups":[]}').ok).toBe(false);
    expect(parseSimilarGroups('{"groups":[{"id":"유사1","division":"분과","name":"x","recs":[],"cards":["2-1-1"]}]}').ok).toBe(false);
    expect(parseSimilarGroups('{"groups":[{"id":"유사1","division":"2분과","name":"x","recs":[],"cards":[]}]}').ok).toBe(false);
    const dup = '{"groups":[{"id":"유사1","division":"2분과","name":"x","recs":[],"cards":["2-1-1"]},{"id":"유사1","division":"2분과","name":"y","recs":[],"cards":["2-1-2"]}]}';
    expect(parseSimilarGroups(dup).ok).toBe(false);
  });
  it('준비판 [JSON 가져오기]에 묶음 파일을 넣으면 알맞은 버튼을 알려 준다', () => {
    const r = parseImport(FAKE_GROUPS);
    expect(r.kind).toBe('error');
    if (r.kind === 'error') expect(r.message).toContain('유사 묶음 파일 가져오기');
  });
});

describe('★ 유사 묶음 → 안 한꺼번에 만들기', () => {
  it('자기 분과 묶음만, 제목은 비워 두고, 카드 상태는 건드리지 않는다', () => {
    const r = importSimilarGroups(fresh(), groups());
    expect(r.created).toEqual([
      { groupId: '유사1', motionId: '2-1-안1' },
      { groupId: '유사2', motionId: '2-1-안2' },
      { groupId: '유사3', motionId: '2-1-안3' },
    ]);
    expect(r.failed).toEqual([]);
    const m1 = r.state.motions.find((m) => m.id === '2-1-안1')!;
    expect(m1.title).toBe('');
    expect(m1.cardNos).toEqual(['2-1-1', '2-1-2']); // 원천 자리 순서
    expect(m1.group).toEqual({ id: '유사1', name: '가상 공통 취지 하나', recs: ['2-1-1-1', '2-1-2-2'], teams: ['1조', '2조'] });
    for (const c of Object.values(r.state.cards)) expect(['keep', 'homework']).toContain(c.status);
    // 2-1-1 은 두 묶음이 함께 쓴다
    expect(cardsInMotions(r.state).get('2-1-1')).toEqual(['2-1-안1', '2-1-안2']);
  });

  it('★ 같은 파일을 두 번 가져와도 중복 안이 생기지 않는다(저장 충돌 재적용에도 같은 결과)', () => {
    const once = importSimilarGroups(fresh(), groups());
    const twice = importSimilarGroups(once.state, groups());
    expect(twice.created).toEqual([]);
    expect(twice.skipped).toEqual(['유사1', '유사2', '유사3']);
    expect(twice.state.motions).toEqual(once.state.motions);
  });

  it('묶음 안을 지운 뒤 다시 가져오면 그 묶음만 다시 만든다', () => {
    const once = importSimilarGroups(fresh(), groups());
    const again = importSimilarGroups(deleteMotion(once.state, '2-1-안2'), groups());
    expect(again.created).toEqual([{ groupId: '유사2', motionId: '2-1-안4' }]); // 지운 번호는 다시 쓰지 않는다
  });

  it('원천에 없는 카드가 있는 묶음은 만들지 않고 알린다', () => {
    const bad = [{ id: '유사7', division: 2, name: 'x', recs: [], cards: ['2-9-9'], teams: [] }];
    const r = importSimilarGroups(fresh(), bad);
    expect(r.created).toEqual([]);
    expect(r.failed[0].groupId).toBe('유사7');
    expect(r.failed[0].reason).toContain('2-9-9');
  });

  it('★ 세부 권고 문구 — 묶음이 적은 세부 번호만, 원천에서 찾아 준다', () => {
    const t = groupRecTexts(div2, ['2-1-1-3', '2-4-1-1', '2-9-9-9']);
    expect(t).toEqual([
      { no: '2-1-1-3', cardNo: '2-1-1', text: '예시 권고 문장 2-1-1-3입니다.' },
      { no: '2-4-1-1', cardNo: '2-4-1', text: '예시 권고 문장 2-4-1-1입니다.' },
      { no: '2-9-9-9', cardNo: null, text: null },
    ]);
  });

  it('★ 제목이 빈 안은 투표를 열 수 없다(빈 제목으로 휴대폰에 나가는 실수)', () => {
    let s = importSimilarGroups(fresh(), groups()).state;
    s = { ...s, attendance: { enrolled: 60, present: 45 } };
    const b = beginVote(s, ['2-1-안1'], 'k-empty', '2026-10-17T02:00:00.000Z');
    expect(b.ok).toBe(false);
    if (!b.ok) expect(b.error).toContain('제목이 빈 안');
    s = updateMotion(s, '2-1-안1', { title: '합친 문구 예시' });
    const ok = beginVote(s, ['2-1-안1'], 'k-ok', '2026-10-17T02:00:00.000Z');
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.state.ballots['k-ok'].statements).toEqual(['2-1-안1 합친 문구 예시']);
  });
});

describe('★ 카드 없는 안건', () => {
  it('안 번호는 「N-최종-안k」, 주제 맨 뒤로 정렬, 휴대폰 문장 모양을 그대로 따른다', () => {
    let s = createMotion(fresh(), { cardNos: ['2-4-1'], title: '카드 안', text: '' });
    if (!s.ok) throw new Error(s.error);
    const a = createAgendaMotion(s.state, { title: AGENDA_PRESETS[0], text: '' });
    if (!a.ok) throw new Error(a.error);
    expect(a.motion.id).toBe('2-최종-안1');
    expect(a.motion.topicNo).toBe(agendaTopicNo(2));
    expect(isAgendaMotion(a.motion)).toBe(true);
    const b = createAgendaMotion(a.state, { title: AGENDA_PRESETS[1], text: '' });
    if (!b.ok) throw new Error(b.error);
    expect(b.motion.id).toBe('2-최종-안2');
    // 카드 안을 나중에 만들어도 카드 없는 안건은 맨 뒤
    const c = createMotion(b.state, { cardNos: ['2-1-1'], title: '나중 카드 안', text: '' });
    if (!c.ok) throw new Error(c.error);
    expect(c.state.motions.map((m) => m.id)).toEqual(['2-1-안1', '2-4-안1', '2-최종-안1', '2-최종-안2']);
    const plan = buildDivisionBallot(2, [b.motion], '2-최종-안2');
    expect(plan.problems).toEqual([]);
    expect(parseMotionStatement(plan.payload.items[0].statement)).toEqual({ id: '2-최종-안2', title: '최종 권고안 문구 작성 위임 의결' });
    expect(createAgendaMotion(fresh(), { title: '  ', text: '' }).ok).toBe(false);
  });

  it('카드 없는 안건도 투표 순서에 들어가고 CSV 한 줄을 갖는다', () => {
    const a = createAgendaMotion(fresh(), { title: '분과별 최종 권고안 의결', text: '' });
    if (!a.ok) throw new Error(a.error);
    const s = { ...a.state, attendance: { enrolled: 60, present: 45 } };
    expect(voteUnits(s, 1).map((u) => u.motionIds)).toEqual([['2-최종-안1']]);
    expect(beginVote(s, ['2-최종-안1'], 'k1', '2026-10-17T07:20:00.000Z').ok).toBe(true);
    const rows = resultCsvRows(s);
    expect(rows.some((r) => r[1] === '2-최종-안1' && r[2] === '분과별 최종 권고안 의결')).toBe(true);
  });
});

describe('★★ 왕복 — 묶음 안 · 카드 없는 안건 · 공유 카드가 든 준비판이 내보내기→가져오기 뒤 그대로', () => {
  it('serialize → parseImport / readStoredPrep 가 같은 상태를 돌려준다', () => {
    let s = importSimilarGroups(fresh(), groups()).state; // 유사1·유사2 가 2-1-1 공유
    s = updateMotion(s, '2-1-안1', { title: '합친 문구 하나' });
    const m = createMotion(s, { cardNos: ['2-1-1', '2-4-1'], title: '손으로 만든 안', text: '문안' }); // 공유 카드 + 통합 상태
    if (!m.ok) throw new Error(m.error);
    const a = createAgendaMotion(m.state, { title: AGENDA_PRESETS[1], text: '' });
    if (!a.ok) throw new Error(a.error);
    const state = a.state;
    expect(state.motions.length).toBe(5);
    const parsed = parseImport(serializePrep(state));
    expect(parsed.kind).toBe('state');
    if (parsed.kind === 'state') expect(parsed.state).toEqual(state);
    expect(readStoredPrep(serializePrep(state))).toEqual(state);
  });

  it('카드 없는 안건의 주제 번호가 다른 분과 것이면 거절한다(손상 파일)', () => {
    const a = createAgendaMotion(fresh(), { title: 'x', text: '' });
    if (!a.ok) throw new Error(a.error);
    const broken = JSON.parse(serializePrep(a.state));
    broken.motions[0].topicNo = '3-최종';
    expect(parseImport(JSON.stringify(broken)).kind).toBe('error');
  });
});
