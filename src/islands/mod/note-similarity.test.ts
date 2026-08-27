import { describe, it, expect } from 'vitest';
import type { Note } from './hq-submission-board-logic';
import {
  tokenize,
  similarity,
  sharedTerms,
  orderNotesBySimilarity,
  similarPairs,
  SIMILARITY_STOPWORDS,
  SIMILAR_PAIRS_THRESHOLD,
  SIMILAR_PAIRS_MAX,
} from './note-similarity';
import type { HqSubmissionRow } from '../../lib/hq-submissions';
import { buildBoards } from './hq-submission-board-logic';
import fixtureRaw from '../../../automation/fixtures/0829-submissions.json';

let seq = 0;
function note(content: string, over: Partial<Note> = {}): Note {
  seq += 1;
  return {
    id: `t1:team-${seq}:1`,
    teamId: `team-${seq}`,
    teamName: `1분과 ${seq}조`,
    tableNo: null,
    subgroup: '1분과',
    ordinal: 1,
    content,
    rationale: null,
    ...over,
  };
}

describe('tokenize', () => {
  it('drops one-letter josa and stopwords', () => {
    const tokens = tokenize('그 및 등 버스 배차 간격을 줄이자');
    for (const stop of SIMILARITY_STOPWORDS) expect(tokens.has(stop)).toBe(false);
    expect(tokens.has('버스')).toBe(true);
    expect(tokens.has('배차')).toBe(true);
    expect(tokens.has('간격')).toBe(true);
  });

  it('strips a trailing josa so 버스를 and 버스 count as the same word', () => {
    expect(tokenize('버스를').has('버스')).toBe(true);
  });

  it('keeps a two-letter word whose last letter looks like a josa', () => {
    // 「제도」에서 「도」를 떼면 「제」가 되어 뜻이 사라진다 — 떼지 않는다.
    expect(tokenize('제도 개선').has('제도')).toBe(true);
  });
});

describe('similarity', () => {
  it('is 1 for the same sentence', () => {
    const a = note('버스 배차 간격을 줄이자');
    const b = note('버스 배차 간격을 줄이자');
    expect(similarity(a, b).score).toBe(1);
  });

  it('is 0 when no word overlaps', () => {
    const a = note('버스 배차 간격 단축');
    const b = note('태양광 발전 확충');
    const result = similarity(a, b);
    expect(result.score).toBe(0);
    expect(result.sharedTerms).toEqual([]);
  });

  it('is 0 when only stopwords overlap', () => {
    const a = note('그 및 등 버스 배차');
    const b = note('그 및 등 태양광 발전');
    expect(similarity(a, b).score).toBe(0);
  });

  it('is 0 when both sentences have no countable word', () => {
    expect(similarity(note('그 및 등'), note('이 가 를')).score).toBe(0);
  });

  it('reports which words overlapped — never a bare score', () => {
    const a = note('버스 배차 간격 단축');
    const b = note('버스 배차 확대');
    const result = similarity(a, b);
    expect([...result.sharedTerms].sort()).toEqual(['버스', '배차'].sort());
    expect(result.score).toBeGreaterThan(0);
    expect(result.score).toBeLessThan(1);
  });

  it('sharedTerms returns the shared words', () => {
    const a = note('무더위쉼터를 늘리자');
    const b = note('무더위쉼터 운영 시간 연장');
    expect(sharedTerms(a, b)).toEqual(['무더위쉼터']);
  });
});

describe('orderNotesBySimilarity', () => {
  it('preserves the card count — reordering never drops a card', () => {
    const notes = [
      note('버스 배차 간격 단축'),
      note('태양광 발전 확충'),
      note('버스 노선 확대'),
      note('축산분뇨 처리 대책'),
      note('태양광 설치 보조금'),
    ];
    expect(orderNotesBySimilarity(notes)).toHaveLength(notes.length);
  });

  it('returns a permutation — same cards, no duplicate, no new card', () => {
    const notes = [
      note('버스 배차 간격 단축'),
      note('태양광 발전 확충'),
      note('버스 노선 확대'),
      note('축산분뇨 처리 대책'),
    ];
    const ordered = orderNotesBySimilarity(notes);
    expect([...ordered].map((n) => n.id).sort()).toEqual([...notes].map((n) => n.id).sort());
    expect(new Set(ordered.map((n) => n.id)).size).toBe(notes.length);
  });

  it('does not mutate or reuse the input array', () => {
    const notes = [note('버스 배차'), note('태양광 발전'), note('버스 노선')];
    const before = notes.map((n) => n.id);
    const ordered = orderNotesBySimilarity(notes);
    expect(notes.map((n) => n.id)).toEqual(before);
    expect(ordered).not.toBe(notes);
  });

  it('puts similar cards next to each other', () => {
    const bus1 = note('버스 배차 간격 단축');
    const solar1 = note('태양광 발전 확충');
    const bus2 = note('버스 배차 간격 확대');
    const solar2 = note('태양광 발전 보조금');
    const ordered = orderNotesBySimilarity([bus1, solar1, bus2, solar2]).map((n) => n.id);
    expect(Math.abs(ordered.indexOf(bus1.id) - ordered.indexOf(bus2.id))).toBe(1);
    expect(Math.abs(ordered.indexOf(solar1.id) - ordered.indexOf(solar2.id))).toBe(1);
  });

  it('is stable for empty and single-card input', () => {
    expect(orderNotesBySimilarity([])).toEqual([]);
    const one = [note('버스 배차')];
    expect(orderNotesBySimilarity(one).map((n) => n.id)).toEqual(one.map((n) => n.id));
  });
});

describe('similarPairs', () => {
  /** 같은 조 판정을 하려면 조를 직접 지정해야 한다 — 기본 helper 는 카드마다 조가 다르다. */
  function inTeam(team: string, content: string, ordinal: number): Note {
    return note(content, {
      id: `t1:${team}:${ordinal}`,
      teamId: team,
      teamName: team,
      ordinal,
    });
  }

  it('임계값 미만인 짝은 내지 않는다', () => {
    const pairs = similarPairs([
      inTeam('a', '버스 배차 간격을 줄이자', 1),
      inTeam('b', '축산 분뇨 냄새가 심하다', 1),
    ]);
    expect(pairs).toEqual([]);
  });

  it('임계값과 정확히 같으면 낸다 (미만만 제외)', () => {
    const a = inTeam('a', '버스 배차 간격', 1);
    const b = inTeam('b', '버스 배차 노선', 1);
    // 겹침 2 / 합집합 4 = 0.5
    const [pair] = similarPairs([a, b], 0.5);
    expect(pair).toBeDefined();
    expect(pair.score).toBeCloseTo(0.5, 10);
    expect(similarPairs([a, b], 0.51)).toEqual([]);
  });

  it('같은 조 안의 두 카드는 짝으로 내지 않는다', () => {
    const sameTeam = similarPairs([
      inTeam('a', '버스 배차 간격을 줄이자', 1),
      inTeam('a', '버스 배차 간격을 줄이자', 2),
    ]);
    expect(sameTeam).toEqual([]);

    // 문장이 같아도 조가 다르면 낸다 — 짝은 조와 조 사이에서만 뜻이 있다.
    const crossTeam = similarPairs([
      inTeam('a', '버스 배차 간격을 줄이자', 1),
      inTeam('b', '버스 배차 간격을 줄이자', 1),
    ]);
    expect(crossTeam).toHaveLength(1);
    expect(crossTeam[0].score).toBe(1);
    expect(crossTeam[0].sharedTerms.length).toBeGreaterThan(0);
  });

  it('점수 내림차순으로 정렬한다', () => {
    const pairs = similarPairs(
      [
        inTeam('a', '버스 배차 간격 확대', 1),
        inTeam('b', '버스 배차 간격 확대', 1), // a 와 1.00
        inTeam('c', '버스 배차 간격 축소 요구', 1), // a 와 3/5 = 0.6
      ],
      0.3,
    );
    const scores = pairs.map((p) => p.score);
    expect(scores).toEqual([...scores].sort((x, y) => y - x));
    expect(scores[0]).toBe(1);
  });

  it('동점이면 원래 카드 순서가 앞선 짝이 먼저다', () => {
    const pairs = similarPairs(
      [
        inTeam('a', '버스 배차 간격 확대', 1),
        inTeam('b', '버스 배차 간격 확대', 1),
        inTeam('c', '버스 배차 간격 확대', 1),
      ],
      0.3,
    );
    // 세 쌍 모두 1.00 — i<j 로 훑은 순서가 그대로 남아야 결과가 항상 같다.
    expect(pairs.map((p) => `${p.aId}~${p.bId}`)).toEqual([
      't1:a:1~t1:b:1',
      't1:a:1~t1:c:1',
      't1:b:1~t1:c:1',
    ]);
  });

  it('상한을 적용한다', () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      inTeam(`team-${i}`, '버스 배차 간격 확대', 1),
    );
    // 12장이 서로 다른 조 · 전부 같은 문장 → 66쌍이 임계값을 넘는다.
    expect(similarPairs(many, 0.3, 1000)).toHaveLength(66);
    expect(similarPairs(many, 0.3, 5)).toHaveLength(5);
    expect(similarPairs(many, 0.3)).toHaveLength(SIMILAR_PAIRS_MAX);
  });

  it('짝마다 두 카드 id · 점수 · 공유 낱말을 갖는다', () => {
    const [pair] = similarPairs([
      inTeam('a', '버스 배차 간격이 두 시간이 넘는다', 1),
      inTeam('b', '버스 배차 간격이 길어 불편하다', 1),
    ]);
    expect(pair.aId).toBe('t1:a:1');
    expect(pair.bId).toBe('t1:b:1');
    expect(pair.score).toBeGreaterThan(0);
    // 점수만 보여주는 불투명한 제안을 만들지 않는다 — 왜 비슷한지가 항상 낱말로 남는다.
    expect(pair.sharedTerms).toEqual(expect.arrayContaining(['버스', '배차', '간격']));
  });

  it('입력 배열과 카드를 건드리지 않는다', () => {
    const notes = [
      inTeam('a', '버스 배차 간격 확대', 1),
      inTeam('b', '버스 배차 간격 확대', 1),
    ];
    const snapshot = JSON.stringify(notes);
    similarPairs(notes);
    expect(JSON.stringify(notes)).toBe(snapshot);
    expect(notes).toHaveLength(2);
  });

  it('빈 입력·한 장 입력에서 빈 배열을 낸다', () => {
    expect(similarPairs([])).toEqual([]);
    expect(similarPairs([inTeam('a', '버스 배차 간격 확대', 1)])).toEqual([]);
  });
});

describe('similarPairs — 픽스처 실측 (임계값 보정의 경계)', () => {
  const boards = buildBoards(fixtureRaw as HqSubmissionRow[]);
  const notes = boards[0].teams.flatMap((team) => team.notes);

  it('꼭지1 에서 상한 안에 드는 짝만 낸다', () => {
    const pairs = similarPairs(notes);
    expect(pairs.length).toBeGreaterThan(0);
    expect(pairs.length).toBeLessThanOrEqual(SIMILAR_PAIRS_MAX);
    for (const pair of pairs) expect(pair.score).toBeGreaterThanOrEqual(SIMILAR_PAIRS_THRESHOLD);
  });

  it('다른 조가 낸 같은 문장은 1.00 으로 맨 앞에 온다', () => {
    const pairs = similarPairs(notes);
    expect(pairs[0].score).toBe(1);
  });

  it('★ 경계 — 「버스 배차」 짝이 임계값을 넘는다', () => {
    // 이 짝은 진짜 짝이지만 보일러플레이트(우리·것을·확인하였다)를 빼면 약 0.30 으로 임계값 아래로 떨어진다.
    // 그래서 불용어를 늘리거나 문서빈도 필터를 넣으면 **진짜 짝이 조용히 죽는다.**
    // 여기서 소리 나게 깨지라고 못 박아 둔다. 불용어·임계값은 반드시 같이 조정할 것.
    const pairs = similarPairs(notes);
    const bus = pairs.find(
      (pair) =>
        pair.score < 1 &&
        ['버스', '배차', '간격'].every((term) => pair.sharedTerms.includes(term)),
    );
    expect(bus).toBeDefined();
    expect(bus!.score).toBeGreaterThanOrEqual(SIMILAR_PAIRS_THRESHOLD);
  });

  it('같은 조 쌍은 한 건도 없다', () => {
    const teamOf = new Map(notes.map((n) => [n.id, n.teamId]));
    for (const pair of similarPairs(notes, 0.2, 1000)) {
      expect(teamOf.get(pair.aId)).not.toBe(teamOf.get(pair.bId));
    }
  });
});
