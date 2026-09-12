import { describe, expect, it } from 'vitest';
import { findProjectedAgenda } from './AgendaProgressBoard';

describe('agenda projector live payload', () => {
  it('resolves the same agenda id from the newest polling payload', () => {
    const agendaId = 'agenda-1';
    const firstPayload = [{
      id: agendaId,
      status: 'drafting',
      recommendationContent: '이전 권고문',
    }];
    const refreshedPayload = [{
      id: agendaId,
      status: 'team_confirmed',
      recommendationContent: '방금 갱신된 권고문',
    }];

    expect(findProjectedAgenda(firstPayload, agendaId)?.recommendationContent)
      .toBe('이전 권고문');
    expect(findProjectedAgenda(refreshedPayload, agendaId)).toEqual(refreshedPayload[0]);
  });

  it('closes safely when the projected agenda is no longer in the payload', () => {
    expect(findProjectedAgenda([], 'agenda-removed')).toBeNull();
    expect(findProjectedAgenda([{ id: 'agenda-1' }], null)).toBeNull();
  });
});
