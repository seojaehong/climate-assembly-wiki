import { describe, expect, it } from 'vitest';
import {
  PREP_VERSION,
  importSimilarGroups,
  initPrepState,
  migratePrep,
  parseSimilarGroups,
  serializePrep,
  updateMotion,
  type PrepState,
} from './division-vote-logic';
import { DIVISION_VOTE_FIXTURE } from './division-vote-fixture';
import {
  addBundleMotion,
  bundleCsvRows,
  bundleCsvText,
  bundleViews,
  cardWithTeam,
  defaultBundleRecord,
  nextBundleMotionNo,
  setBundleRecord,
  toggleBundleTeam,
} from './division-bundle';

// bundles_ag_1017.json 과 같은 모양(가상 데이터).
const FILE = JSON.stringify({
  source: 'test',
  groups: [
    {
      id: '2A', division: '2분과', letter: 'A', name: '다회용기', level: '높음', common: '보급·회수',
      cards: ['2-1-1', '2-1-2'], recs: ['2-1-1-1', '2-1-2-1'], card_teams: { '2-1-1': '1조', '2-1-2': '3조' }, teams: ['1조', '3조'],
    },
    {
      id: '2B', division: '2분과', letter: 'B', name: '순환센터', level: '중간', common: '',
      cards: ['2-4-1', '2-1-3'], recs: ['2-4-1-1'], card_teams: { '2-4-1': '3조', '2-1-3': '2조' }, teams: ['2조', '3조'],
    },
    { id: '3A', division: '3분과', letter: 'A', name: '교육', level: '낮음', common: '', cards: ['3-1-1'], recs: [], card_teams: { '3-1-1': '1조' }, teams: ['1조'] },
  ],
});

function seeded(): PrepState {
  const parsed = parseSimilarGroups(FILE);
  if (!parsed.ok) throw new Error(parsed.message);
  return importSimilarGroups(initPrepState(DIVISION_VOTE_FIXTURE[0]), parsed.groups).state;
}

describe('A–G 묶음 파일 가져오기', () => {
  it('진행자료 묶음 파일을 읽고(분과 글자·카드별 조), 자기 분과 묶음만 안으로 만든다', () => {
    const s = seeded();
    const views = bundleViews(s);
    expect(views.map((v) => v.label)).toEqual(['A 다회용기', 'B 순환센터']);
    expect(views[0].group.cardTeams).toEqual({ '2-1-1': '1조', '2-1-2': '3조' });
    expect(views[0].group.level).toBe('높음');
    expect(views[1].cards).toEqual(['2-1-3', '2-4-1']);
    expect(s.motions.every((m) => m.title === '')).toBe(true);
  });
  it('두 번 가져와도 안이 늘지 않는다', () => {
    const parsed = parseSimilarGroups(FILE);
    if (!parsed.ok) throw new Error();
    const again = importSimilarGroups(seeded(), parsed.groups);
    expect(again.created).toEqual([]);
    expect(again.state.motions).toHaveLength(2);
  });
  it('카드 옆 조 표시와 참여 조 미리 채움', () => {
    const v = bundleViews(seeded())[0];
    expect(cardWithTeam(v.group, '2-1-2')).toBe('2-1-2 (3조)');
    expect(cardWithTeam({}, '2-1-2')).toBe('2-1-2');
    expect(defaultBundleRecord(v.group).teams).toEqual(['1', '3']);
    expect(v.record.teams).toEqual(['1', '3']);
  });
  it('모양이 틀린 card_teams 는 파일째 거절', () => {
    const bad = JSON.stringify({ groups: [{ id: 'x', division: '2분과', name: 'n', cards: ['2-1-1'], recs: [], teams: [], card_teams: { '2-1-1': 3 } }] });
    expect(parseSimilarGroups(bad).ok).toBe(false);
  });
});

describe('묶음 기록 — 결론·참여 조·옮긴 세부권고·소수의견', () => {
  it('기록은 바뀐 칸만 바꾸고, 참여 조는 1~5조 순서로', () => {
    let s = seeded();
    s = setBundleRecord(s, '2A', { decision: 'merge', movedRecs: '2-1-2-1 → 통합1' });
    s = toggleBundleTeam(s, '2A', '5');
    s = toggleBundleTeam(s, '2A', '1');
    expect(s.bundles?.['2A']).toEqual({ decision: 'merge', teams: ['3', '5'], movedRecs: '2-1-2-1 → 통합1', minority: '' });
    s = setBundleRecord(s, '2A', { minority: '보증금은 따로' });
    expect(s.bundles?.['2A']?.decision).toBe('merge');
    expect(setBundleRecord(s, '없는묶음', { decision: 'move' })).toBe(s);
  });
  it('합친 문구 = 안 제목 — 기록 CSV 에 그대로', () => {
    let s = seeded();
    const v = bundleViews(s)[0];
    s = updateMotion(s, v.motions[0].id, { title: '다회용기 보급과 회수 체계를 함께 만든다' });
    s = setBundleRecord(s, '2A', { decision: 'merge' });
    const rows = bundleCsvRows(s);
    expect(rows[0].slice(0, 9)).toEqual(['2분과', '2A', 'A 다회용기', '높음', '2-1-1 (1조) 2-1-2 (3조)', '합친다(카드를 통째로 합치기)', '1조 3조', v.motions[0].id, '다회용기 보급과 회수 체계를 함께 만든다']);
    expect(bundleCsvText(rows).startsWith('﻿분과,묶음,묶음 이름')).toBe(true);
  });
  it('한 묶음에서 안을 더 만들 수 있고, 같은 번호로 다시 해도 하나', () => {
    let s = seeded();
    const n = nextBundleMotionNo(s, '2B');
    expect(n).toBe(2);
    const r = addBundleMotion(s, '2B', n);
    expect(r.motionId).not.toBeNull();
    s = r.state;
    expect(addBundleMotion(s, '2B', n).state).toBe(s);
    expect(nextBundleMotionNo(s, '2B')).toBe(3);
    const v = bundleViews(s).find((b) => b.id === '2B')!;
    expect(v.motions).toHaveLength(2);
    expect(bundleCsvRows(s).filter((row) => row[1] === '2B')).toHaveLength(2);
  });
});

describe('판 번호 4 — 묶음 칸이 왕복한다', () => {
  it('저장 → 읽기에서 묶음 기록·A–G 칸이 그대로', () => {
    let s = seeded();
    s = setBundleRecord(s, '2B', { decision: 'separate', minority: '소수' });
    const j = JSON.parse(serializePrep(s));
    expect(j.v).toBe(PREP_VERSION);
    expect(PREP_VERSION).toBe(5);
    expect(migratePrep(j)).toEqual(s);
  });
  it('모양이 틀린 기록은 판째 거절(반쪽만 읽지 않는다)', () => {
    const j = JSON.parse(serializePrep(setBundleRecord(seeded(), '2A', { decision: 'merge' })));
    expect(migratePrep({ ...j, bundles: { '2A': { ...j.bundles['2A'], decision: '모름' } } })).toBeNull();
    expect(migratePrep({ ...j, bundles: { '2A': { ...j.bundles['2A'], teams: ['9'] } } })).toBeNull();
  });
});
