import type {
  BallotListRow,
  BallotResultItem,
  BallotResults,
  BallotStatus,
} from '../../../lib/deliberation';

export interface VoteBallot {
  id: string;
  title: string;
  status: BallotStatus;
  token: string;
  subgroup: string | null;
  responses: number;
  createdAt: string;
  items: BallotResultItem[];
}

export interface VoteView {
  ballots: VoteBallot[];
  stats: {
    ballotCount: number;
    openCount: number;
    itemCount: number;
    responseCount: number;
  };
}

/** Joins ballot metadata and aggregate results without exposing partial session data. */
export function buildVoteView(
  rows: readonly BallotListRow[],
  results: readonly BallotResults[],
): VoteView {
  const resultsById = new Map(results.map((result) => [result.id, result]));
  const ballots = rows.map((row): VoteBallot => {
    const result = resultsById.get(row.id);
    if (!result) throw new Error(`Missing aggregate result for ballot ${row.id}`);
    return {
      id: row.id,
      title: result.title,
      status: result.status,
      token: row.token,
      subgroup: result.subgroup?.trim() || null,
      responses: result.responses,
      createdAt: row.created_at,
      items: result.items,
    };
  });

  return {
    ballots,
    stats: {
      ballotCount: ballots.length,
      openCount: ballots.filter((ballot) => ballot.status === 'open').length,
      itemCount: ballots.reduce((sum, ballot) => sum + ballot.items.length, 0),
      responseCount: ballots.reduce((sum, ballot) => sum + ballot.responses, 0),
    },
  };
}
