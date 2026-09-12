import { describe, expect, it } from 'vitest';
import {
  AGENDA_STATUS_LABELS,
  nextAgendaStatus,
  statusCounts,
  subgroupSortKey,
} from './agenda-progress-logic';

describe('agenda progress status', () => {
  it('follows the five visible steps', () => {
    expect(nextAgendaStatus('waiting', 'start', false)).toBe('discussing');
    expect(nextAgendaStatus('discussing', 'save', true)).toBe('drafting');
    expect(nextAgendaStatus('drafting', 'confirm', true)).toBe('team_confirmed');
    expect(nextAgendaStatus('team_confirmed', 'submit', true)).toBe('submitted');
  });

  it('never confirms an empty draft or rewrites a submitted item', () => {
    expect(nextAgendaStatus('drafting', 'confirm', false)).toBeNull();
    expect(nextAgendaStatus('submitted', 'save', true)).toBeNull();
  });

  it('returns a submitted item to drafting when HQ requests revision', () => {
    expect(nextAgendaStatus('submitted', 'revision_request', true)).toBe('drafting');
  });

  it('keeps readable Korean labels for every state', () => {
    expect(Object.values(AGENDA_STATUS_LABELS)).toEqual([
      '대기', '논의 중', '초안 작성', '조 확인', '제출 완료',
    ]);
  });
});

describe('agenda progress grouping', () => {
  it('counts every assignment exactly once', () => {
    expect(statusCounts(['waiting', 'drafting', 'drafting', 'submitted'])).toEqual({
      waiting: 1,
      discussing: 0,
      drafting: 2,
      team_confirmed: 0,
      submitted: 1,
    });
  });

  it('sorts numbered divisions before unknown labels', () => {
    expect(['기타', '3분과', '1분과'].sort((a, b) => subgroupSortKey(a) - subgroupSortKey(b)))
      .toEqual(['1분과', '3분과', '기타']);
  });
});
