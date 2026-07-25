import { describe, it, expect } from 'vitest';
import {
  modReducer,
  initialModState,
  canReopen,
  closeConfirmMessage,
  participationBase,
  REOPEN_WINDOW_MS,
} from './mod-state';
import type { Round, Team } from '../../lib/mod-console';

const team: Team = { id: 't1', name: '3분과 2조', subgroup: '3분과', join_code: '482913', capacity: 20 };
const round: Round = {
  id: 'r1',
  title: '우리 조가 가장 중요하게 볼 의제는?',
  type: 'RADIO',
  options: ['에너지 전환', '자원순환', '기후교육'],
  status: 'active',
  team_id: 't1',
};
const closedRound: Round = { ...round, status: 'closed' };

describe('modReducer', () => {
  it('starts on the join screen', () => {
    expect(initialModState.screen).toBe('join');
  });

  it('JOIN_SUCCESS moves join -> home and stores the team', () => {
    const next = modReducer(initialModState, { type: 'JOIN_SUCCESS', team });
    expect(next.screen).toBe('home');
    expect(next.team).toEqual(team);
    expect(next.joinError).toBeNull();
  });

  it('JOIN_FAILURE keeps the join screen and records the error', () => {
    const next = modReducer(initialModState, { type: 'JOIN_FAILURE', message: '존재하지 않는 접속코드입니다.' });
    expect(next.screen).toBe('join');
    expect(next.joinError).toBe('존재하지 않는 접속코드입니다.');
  });

  it('CREATE_POLL_SUCCESS moves home -> polling and stores the round', () => {
    const home = modReducer(initialModState, { type: 'JOIN_SUCCESS', team });
    const next = modReducer(home, { type: 'CREATE_POLL_SUCCESS', round });
    expect(next.screen).toBe('polling');
    expect(next.round).toEqual(round);
  });

  it('CLOSE_POLL moves polling -> results and stores the closed round', () => {
    const home = modReducer(initialModState, { type: 'JOIN_SUCCESS', team });
    const polling = modReducer(home, { type: 'CREATE_POLL_SUCCESS', round });
    const next = modReducer(polling, { type: 'CLOSE_POLL', round: closedRound });
    expect(next.screen).toBe('results');
    expect(next.round).toEqual(closedRound);
  });

  it('NEW_POLL moves results -> home and clears the round', () => {
    const home = modReducer(initialModState, { type: 'JOIN_SUCCESS', team });
    const polling = modReducer(home, { type: 'CREATE_POLL_SUCCESS', round });
    const results = modReducer(polling, { type: 'CLOSE_POLL', round: closedRound });
    const next = modReducer(results, { type: 'NEW_POLL' });
    expect(next.screen).toBe('home');
    expect(next.round).toBeNull();
  });

  it('RESTORE_TEAM without an active round re-enters on the home screen', () => {
    const next = modReducer(initialModState, { type: 'RESTORE_TEAM', team, round: null });
    expect(next.screen).toBe('home');
    expect(next.team).toEqual(team);
    expect(next.round).toBeNull();
  });

  it('RESTORE_TEAM with an active round resumes the polling screen', () => {
    const next = modReducer(initialModState, { type: 'RESTORE_TEAM', team, round });
    expect(next.screen).toBe('polling');
    expect(next.team).toEqual(team);
    expect(next.round).toEqual(round);
  });

  it('REOPEN_POLL moves results -> polling and puts the round back to active', () => {
    const home = modReducer(initialModState, { type: 'JOIN_SUCCESS', team });
    const polling = modReducer(home, { type: 'CREATE_POLL_SUCCESS', round });
    const results = modReducer(polling, { type: 'CLOSE_POLL', round: closedRound });
    const next = modReducer(results, { type: 'REOPEN_POLL', round: closedRound });
    expect(next.screen).toBe('polling');
    expect(next.round?.status).toBe('active');
    expect(next.round?.id).toBe(round.id);
  });

  it('REOPEN_POLL is ignored on the polling screen', () => {
    const home = modReducer(initialModState, { type: 'JOIN_SUCCESS', team });
    const polling = modReducer(home, { type: 'CREATE_POLL_SUCCESS', round });
    const next = modReducer(polling, { type: 'REOPEN_POLL', round: closedRound });
    expect(next).toBe(polling);
  });

  it('REOPEN_POLL is ignored on the home screen', () => {
    const home = modReducer(initialModState, { type: 'JOIN_SUCCESS', team });
    const next = modReducer(home, { type: 'REOPEN_POLL', round: closedRound });
    expect(next).toBe(home);
  });
});

describe('canReopen', () => {
  it('is false when nothing has been closed yet', () => {
    expect(canReopen(null, 1_000_000)).toBe(false);
  });

  it('is true right after closing', () => {
    expect(canReopen(1_000_000, 1_000_000)).toBe(true);
  });

  it('is true one second before the window ends', () => {
    expect(canReopen(1_000_000, 1_000_000 + REOPEN_WINDOW_MS - 1_000)).toBe(true);
  });

  it('is false once the 60s window has elapsed', () => {
    expect(canReopen(1_000_000, 1_000_000 + REOPEN_WINDOW_MS)).toBe(false);
    expect(canReopen(1_000_000, 1_000_000 + REOPEN_WINDOW_MS + 1)).toBe(false);
  });

  it('uses a 60 second window', () => {
    expect(REOPEN_WINDOW_MS).toBe(60_000);
  });
});

describe('participationBase', () => {
  it('prefers the attendance-eligible count', () => {
    expect(participationBase(9, 20)).toBe(9);
  });

  it('falls back to team capacity when check-in never ran (count is 0, not null)', () => {
    expect(participationBase(0, 20)).toBe(20);
  });

  it('falls back to team capacity when the count is unavailable', () => {
    expect(participationBase(null, 20)).toBe(20);
  });

  it('returns 0 when neither is known', () => {
    expect(participationBase(0, 0)).toBe(0);
  });
});

describe('closeConfirmMessage', () => {
  it('names how many people have not voted yet', () => {
    expect(closeConfirmMessage(7, 12)).toBe('12명 중 7명이 투표했습니다. 아직 5명이 남았습니다.');
  });

  it('says everyone voted when none are left', () => {
    expect(closeConfirmMessage(12, 12)).toBe('12명 중 12명이 투표했습니다. 모두 투표했습니다.');
  });

  it('clamps to 모두 투표했습니다 when proxy votes exceed the roster', () => {
    expect(closeConfirmMessage(14, 12)).toBe('12명 중 14명이 투표했습니다. 모두 투표했습니다.');
  });

  it('drops the denominator when the roster size is unknown', () => {
    expect(closeConfirmMessage(3, 0)).toBe('지금까지 3표가 들어왔습니다.');
  });

  it('handles nobody having voted yet', () => {
    expect(closeConfirmMessage(0, 12)).toBe('12명 중 0명이 투표했습니다. 아직 12명이 남았습니다.');
  });
});
