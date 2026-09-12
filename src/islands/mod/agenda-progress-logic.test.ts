import { describe, expect, it } from 'vitest';
import {
  AGENDA_STATUS_LABELS,
  agendaBoardPendingStorageKey,
  canEditRecommendation,
  canWriteActiveAgendaStage,
  canSaveRecommendation,
  dirtyMapForRecoveredDrafts,
  emptyAgendaBoardPendingState,
  hasRecommendationContent,
  nextAgendaStatus,
  normalizeAgendaTitle,
  recommendationMatchesSearch,
  mutationRequestId,
  mutationPayloadFingerprint,
  pendingMutationMatches,
  pendingRecommendationSaveDrafts,
  topicIdForPendingMutation,
  pendingRecordAfterMutationFailure,
  parseAgendaBoardPendingState,
  isRevisionConflictMessage,
  isWorkflowStageConflictMessage,
  recommendationProgressBlockMessage,
  recommendationSaveLabel,
  similarAgendaTitles,
  statusCounts,
  subgroupSortKey,
  withoutRecordKey,
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
    expect(nextAgendaStatus('waiting', 'save', true)).toBeNull();
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

describe('recommendation authoring helpers', () => {
  it('allows topic-linked writes only for one explicitly writable active stage', () => {
    expect(canWriteActiveAgendaStage({ id: 'topic-a' }, { writable: true })).toBe(true);
    expect(canWriteActiveAgendaStage({ id: 'topic-a' }, { writable: false })).toBe(false);
    expect(canWriteActiveAgendaStage(null, { writable: true })).toBe(false);
    expect(canWriteActiveAgendaStage({ id: '' }, { writable: true })).toBe(false);
  });

  it('keeps a pending mutation bound to its original workflow stage', () => {
    const key = 'recommendation:save:recommendation-1';
    const fingerprints = {
      [key]: mutationPayloadFingerprint({ topicId: 'topic-a', draft: { title: '초안' } }),
    };
    expect(topicIdForPendingMutation(fingerprints, key, 'topic-b')).toBe('topic-a');
    expect(topicIdForPendingMutation({}, key, 'topic-b')).toBe('topic-b');
    expect(topicIdForPendingMutation({}, key, null)).toBeNull();
  });

  it('requires the three active workshop fields', () => {
    expect(hasRecommendationContent({
      title: '대중교통 우선 투자',
      problemRecognition: '이동권 격차가 큽니다.',
      recommendationContent: '환승 거점부터 확충합니다.',
    })).toBe(true);
    expect(hasRecommendationContent({
      title: '대중교통 우선 투자',
      problemRecognition: '',
      recommendationContent: '환승 거점부터 확충합니다.',
    })).toBe(false);
  });

  it('normalizes punctuation and finds likely duplicate agenda titles', () => {
    expect(normalizeAgendaTitle('  건물·에너지 효율! ')).toBe('건물 에너지 효율');
    expect(similarAgendaTitles('건물 에너지 효율 강화', [
      '건물·에너지 효율 강화',
      '재생에너지 주민 참여',
    ])).toEqual(['건물·에너지 효율 강화']);
  });

  it('searches across recommendation fields', () => {
    expect(recommendationMatchesSearch('이동권', [
      '교통 정책',
      '농촌 이동권 격차를 줄입니다.',
      null,
    ])).toBe(true);
    expect(recommendationMatchesSearch('폐기물', ['교통 정책', '이동권 격차'])).toBe(false);
  });

  it('marks every locally recovered draft as unsent', () => {
    expect(dirtyMapForRecoveredDrafts({
      'recommendation-1': {
        title: '복구 초안',
        problemRecognition: '',
        recommendationContent: '',
      },
    })).toEqual({ 'recommendation-1': true });
  });

  it('blocks confirmation and submission while a recovered draft is unsent', () => {
    const completeDraft = {
      title: '생활권 교통 강화',
      problemRecognition: '이동권 격차가 큽니다.',
      recommendationContent: '환승 거점을 확충합니다.',
    };
    expect(recommendationProgressBlockMessage('confirm', completeDraft, true))
      .toContain('먼저 초안 저장');
    expect(recommendationProgressBlockMessage('submit', completeDraft, true))
      .toContain('미전송 초안');
    expect(recommendationProgressBlockMessage('confirm', completeDraft, false)).toBeNull();
    expect(recommendationProgressBlockMessage('submit', completeDraft, false)).toBeNull();
  });

  it('restores offline forms and request ids without storing a token', () => {
    const persisted = JSON.stringify({
      requestIds: { 'agenda:create': 'same-request-id' },
      requestFingerprints: { 'agenda:create': '{"title":"새로운 지역 의제"}' },
      agendaForm: {
        open: true,
        title: '새로운 지역 의제',
        sourceUtterance: '시민 원문',
        subgroup: '2분과',
      },
      recommendationForm: {
        open: true,
        agendaId: 'agenda-2',
        teamId: 'team-2',
        draft: {
          title: '복구할 권고안',
          problemRecognition: '문제 인식',
          recommendationContent: '권고 내용',
        },
      },
    });

    const restored = parseAgendaBoardPendingState(persisted, '1분과');
    expect(restored.requestIds['agenda:create']).toBe('same-request-id');
    expect(restored.requestFingerprints['agenda:create']).toBe('{"title":"새로운 지역 의제"}');
    expect(restored.agendaForm.title).toBe('새로운 지역 의제');
    expect(restored.recommendationForm?.draft.title).toBe('복구할 권고안');
    expect(JSON.stringify(restored)).not.toContain('token');
    expect(agendaBoardPendingStorageKey('hq', null, null)).toBe('climate_agenda_board_pending_v2:hq:hq');
    expect(agendaBoardPendingStorageKey('team', 'team-2', '2분과'))
      .toBe('climate_agenda_board_pending_v2:team:team-2');
  });

  it('replays a lost response with the same idempotency id', () => {
    const restored = { 'recommendation:save:1': 'persisted-request-id' };
    expect(mutationRequestId(restored, 'recommendation:save:1', () => 'new-request-id'))
      .toBe('persisted-request-id');
    expect(mutationRequestId({}, 'recommendation:save:1', () => 'new-request-id'))
      .toBe('new-request-id');
    expect(withoutRecordKey({
      'recommendation:save:1': 'persisted-request-id',
      'agenda:create': 'another-request-id',
    }, 'recommendation:save:1')).toEqual({
      'agenda:create': 'another-request-id',
    });
  });

  it('restores only drafts attached to valid pending recommendation save snapshots', () => {
    const validDraft = {
      title: '응답 유실 권고안',
      problemRecognition: '문제 인식',
      recommendationContent: '권고 내용',
    };
    const requestIds = {
      'recommendation:save:recommendation-1': 'request-1',
      'recommendation:save:recommendation-2': 'request-2',
      'agenda:create': 'request-3',
    };
    const fingerprints = {
      'recommendation:save:recommendation-1': mutationPayloadFingerprint({
        recommendationId: 'recommendation-1',
        draft: validDraft,
        expectedEffect: null,
        expectedVersion: 3,
        topicId: 'topic-a',
      }),
      'recommendation:save:recommendation-2': mutationPayloadFingerprint({
        recommendationId: 'different-recommendation',
        draft: { ...validDraft, title: '잘못 연결된 문안' },
        expectedVersion: 1,
        topicId: 'topic-a',
      }),
      'agenda:create': mutationPayloadFingerprint({ draft: validDraft, expectedVersion: 1 }),
      'recommendation:save:not-pending': mutationPayloadFingerprint({
        recommendationId: 'not-pending',
        draft: validDraft,
        expectedVersion: 1,
        topicId: 'topic-a',
      }),
    };

    expect(pendingRecommendationSaveDrafts(requestIds, fingerprints)).toEqual({
      'recommendation-1': validDraft,
    });
  });

  it('locks a pending idempotent request to its original payload fingerprint', () => {
    const original = mutationPayloadFingerprint({ title: '원래 문안', content: '가나다' });
    const changed = mutationPayloadFingerprint({ title: '바뀐 문안', content: '가나다' });
    const ids = { save: 'same-uuid' };
    const fingerprints = { save: original };
    expect(pendingMutationMatches(ids, fingerprints, 'save', original)).toBe(true);
    expect(pendingMutationMatches(ids, fingerprints, 'save', changed)).toBe(false);
    expect(pendingMutationMatches({}, {}, 'save', changed)).toBe(true);
  });

  it('recognizes optimistic concurrency conflicts for a clear refresh message', () => {
    expect(isRevisionConflictMessage('revision version conflict: expected 3 actual 4')).toBe(true);
    expect(isRevisionConflictMessage('stale recommendation revision: expected 1, current 2')).toBe(true);
    expect(isRevisionConflictMessage('network timeout')).toBe(false);
  });

  it('recognizes terminal workflow-stage conflicts separately from revision conflicts', () => {
    expect(isWorkflowStageConflictMessage('workflow stage must be the single open stage')).toBe(true);
    expect(isWorkflowStageConflictMessage('exactly one open workflow stage required')).toBe(true);
    expect(isWorkflowStageConflictMessage('stale recommendation revision: expected 1, current 2')).toBe(false);
  });

  it('releases an OCC-conflicted request id and fingerprint but retains retryable failures', () => {
    const pending = {
      'recommendation:save:1': 'pending-value',
      'agenda:create': 'other-value',
    };
    expect(pendingRecordAfterMutationFailure(
      pending,
      'recommendation:save:1',
      'stale recommendation revision: expected 1, current 2',
    )).toEqual({ 'agenda:create': 'other-value' });
    expect(pendingRecordAfterMutationFailure(
      pending,
      'recommendation:save:1',
      'network timeout',
    )).toEqual(pending);
    expect(pendingRecordAfterMutationFailure(
      pending,
      'recommendation:save:1',
      'workflow stage must be the single open stage',
    )).toEqual({ 'agenda:create': 'other-value' });
  });

  it('removes a successful local edit so refreshed server text is visible', () => {
    const edits = {
      'recommendation-1': {
        title: '오래된 로컬 편집본',
        problemRecognition: '이전 문제 인식',
        recommendationContent: '이전 내용',
      },
      'recommendation-2': {
        title: '계속 작성 중',
        problemRecognition: '',
        recommendationContent: '',
      },
    };
    expect(withoutRecordKey(edits, 'recommendation-1')).toEqual({
      'recommendation-2': edits['recommendation-2'],
    });
  });

  it('prevents duplicate saves and editing recommendations under an archived agenda', () => {
    expect(canSaveRecommendation({ editable: true, dirty: false, mode: 'team', status: 'waiting' })).toBe(false);
    expect(canSaveRecommendation({ editable: true, dirty: false, mode: 'team', status: 'discussing' })).toBe(true);
    expect(canSaveRecommendation({ editable: true, dirty: false, mode: 'team', status: 'drafting' })).toBe(false);
    expect(canSaveRecommendation({ editable: true, dirty: true, mode: 'team', status: 'drafting' })).toBe(true);
    expect(recommendationSaveLabel('team', 'discussing')).toBe('초안 작성 완료');
    expect(recommendationSaveLabel('team', 'drafting')).toBe('초안 저장');
    expect(recommendationSaveLabel('hq', 'drafting')).toBe('수정 저장');
    expect(canEditRecommendation({
      agendaArchived: false,
      recommendationArchived: false,
      status: 'waiting',
      mode: 'hq',
      teamId: undefined,
      authorTeamId: 'team-1',
    })).toBe(false);
    expect(canEditRecommendation({
      agendaArchived: true,
      recommendationArchived: false,
      status: 'drafting',
      mode: 'hq',
      teamId: undefined,
      authorTeamId: 'team-1',
    })).toBe(false);
  });

  it('falls back safely when persisted offline state is corrupt', () => {
    expect(parseAgendaBoardPendingState('{broken', '3분과'))
      .toEqual(emptyAgendaBoardPendingState('3분과'));
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
