import { describe, it, expect } from 'vitest';
import { modReducer, initialModState } from './mod-state';
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
});
