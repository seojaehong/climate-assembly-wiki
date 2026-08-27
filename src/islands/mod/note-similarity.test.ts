import { describe, it, expect } from 'vitest';
import type { Note } from './hq-submission-board-logic';
import {
  tokenize,
  similarity,
  sharedTerms,
  orderNotesBySimilarity,
  SIMILARITY_STOPWORDS,
} from './note-similarity';

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
