import { describe, expect, it } from 'vitest';
import type { BallotListRow, BallotResults } from '../../../lib/deliberation';
import { buildVoteView } from './vote-console-logic';

const ballots: BallotListRow[] = [
  {
    id: 'ballot-1',
    title: '에너지 정책 우선순위',
    status: 'open',
    token: 'token-1',
    subgroup: null,
    item_count: 2,
    response_count: 11,
    created_at: '2026-08-11T00:00:00Z',
  },
  {
    id: 'ballot-2',
    title: '수송 전환 권고안',
    status: 'published',
    token: 'token-2',
    subgroup: '2분과',
    item_count: 1,
    response_count: 9,
    created_at: '2026-08-10T00:00:00Z',
  },
];

const results: BallotResults[] = [
  {
    id: 'ballot-1',
    title: '에너지 정책 우선순위',
    status: 'open',
    subgroup: null,
    responses: 11,
    items: [
      { id: 'item-1', ordinal: 1, statement: '재생에너지 투자를 확대한다.', scale: 5, n: 11, avg: 4.1, dist: { '1': 0, '2': 1, '3': 2, '4': 3, '5': 5 } },
      { id: 'item-2', ordinal: 2, statement: '지역 이익공유를 의무화한다.', scale: 2, n: 10, avg: 1.7, dist: { '1': 3, '2': 7 } },
    ],
  },
  {
    id: 'ballot-2',
    title: '수송 전환 권고안',
    status: 'published',
    subgroup: '2분과',
    responses: 9,
    items: [
      { id: 'item-3', ordinal: 1, statement: '대중교통 투자를 우선한다.', scale: 5, n: 9, avg: 4, dist: { '1': 0, '2': 0, '3': 2, '4': 5, '5': 2 } },
    ],
  },
];

describe('buildVoteView', () => {
  it('회차 투표와 결과를 id로 연결하고 운영 통계를 계산한다', () => {
    const view = buildVoteView(ballots, results);

    expect(view.stats).toEqual({ ballotCount: 2, openCount: 1, itemCount: 3, responseCount: 20 });
    expect(view.ballots[0]).toMatchObject({
      id: 'ballot-1',
      title: '에너지 정책 우선순위',
      status: 'open',
      subgroup: null,
      responses: 11,
    });
    expect(view.ballots[0].items.map((item) => item.statement)).toEqual([
      '재생에너지 투자를 확대한다.',
      '지역 이익공유를 의무화한다.',
    ]);
    expect(view.ballots[1]).toMatchObject({ id: 'ballot-2', subgroup: '2분과', responses: 9 });
  });

  it('목록과 결과 id가 어긋나면 불완전한 집계를 만들지 않는다', () => {
    expect(() => buildVoteView(ballots, results.slice(0, 1))).toThrow('ballot-2');
  });
});
