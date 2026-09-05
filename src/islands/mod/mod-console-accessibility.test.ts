import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { classifyStoredSessionResumeError, migrateLegacyWorkshopStorage } from './ModConsole';
import {
  listLegacyDraftRecoveries,
  readDraft,
  writeDraft,
} from './submission-draft-store';
import { createSafeBrowserStorage } from '../../lib/safe-browser-storage';

const consoleSource = readFileSync(new URL('./ModConsole.tsx', import.meta.url), 'utf8');
const deadlineSource = readFileSync(new URL('./DeadlineBanner.tsx', import.meta.url), 'utf8');
const submissionSource = readFileSync(new URL('./SubmissionPanel.tsx', import.meta.url), 'utf8');
const sessionSource = readFileSync(new URL('./workshop-session-state.ts', import.meta.url), 'utf8');
const ballotSource = readFileSync(new URL('./BallotPanel.tsx', import.meta.url), 'utf8');
const attendanceSource = readFileSync(new URL('./AttendancePanel.tsx', import.meta.url), 'utf8');
const timerSource = readFileSync(new URL('./Timer.tsx', import.meta.url), 'utf8');
const queueSource = readFileSync(new URL('./submission-queue.ts', import.meta.url), 'utf8');
const pageSource = readFileSync(new URL('../../pages/mod.astro', import.meta.url), 'utf8');
const deliberationSource = readFileSync(new URL('../../lib/deliberation.ts', import.meta.url), 'utf8');
const moderatorApiSource = readFileSync(new URL('../../lib/mod-console.ts', import.meta.url), 'utf8');
const workshopAccessSource = readFileSync(new URL('../../lib/workshop-access.ts', import.meta.url), 'utf8');
const hqSubmissionSource = readFileSync(new URL('./HqSubmissionBoard.tsx', import.meta.url), 'utf8');
const clearAllSource = readFileSync(new URL('./ClearAllPanel.tsx', import.meta.url), 'utf8');
const hqGateSource = readFileSync(new URL('./HqGate.tsx', import.meta.url), 'utf8');
const hqGridSource = readFileSync(new URL('./HqGrid.tsx', import.meta.url), 'utf8');
const modalDialogSource = readFileSync(new URL('./use-modal-dialog.ts', import.meta.url), 'utf8');
const publicVoteSource = readFileSync(new URL('./VoteCard.tsx', import.meta.url), 'utf8');
const publicBallotSource = readFileSync(new URL('../ballot/BallotCard.tsx', import.meta.url), 'utf8');
const hqAttendanceSource = readFileSync(new URL('./HqAttendanceAdmin.tsx', import.meta.url), 'utf8');

const LEGACY_MIGRATION_NOW = 1_789_123_456_000;

function migrationStorage(initial: Record<string, string> = {}): Storage & {
  dump(): Record<string, string>;
} {
  const values = new Map(Object.entries(initial));
  return {
    get length(): number {
      return values.size;
    },
    clear(): void {
      values.clear();
    },
    getItem(key: string): string | null {
      return values.get(key) ?? null;
    },
    key(index: number): string | null {
      return [...values.keys()][index] ?? null;
    },
    removeItem(key: string): void {
      values.delete(key);
    },
    setItem(key: string, value: string): void {
      values.set(key, value);
    },
    dump(): Record<string, string> {
      return Object.fromEntries(values);
    },
  };
}

describe('/mod legacy join-code storage migration', () => {
  const joinCode = '091201';
  const teamId = 'team-safe-id';
  const topicId = 'topic-1';
  const legacyDraftKey = `climate_vote_draft:${joinCode}:${topicId}`;
  const teamDraftKey = `climate_vote_draft:${teamId}:${topicId}`;
  const legacyQueueKey = `climate_vote_queue:${joinCode}:${topicId}`;

  const draft = (content: string, extras: Record<string, unknown> = {}): string => JSON.stringify({
    v: 1,
    rows: [{ name: '', content, rationale: '근거' }],
    savedAtMs: LEGACY_MIGRATION_NOW - 100,
    baseUpdatedAt: '2026-09-12T01:00:00Z',
    baseVersion: 3,
    ...extras,
  });

  const queue = (content: string, extras: Record<string, unknown> = {}): string => JSON.stringify({
    v: 1,
    code: joinCode,
    topicId,
    items: [{ ordinal: 1, kind: 'core', content, rationale: '대기 근거' }],
    baseUpdatedAt: '2026-09-12T01:00:00Z',
    queuedAtMs: LEGACY_MIGRATION_NOW - 50,
    attempts: 1,
    nextAttemptAtMs: LEGACY_MIGRATION_NOW + 5_000,
    ...extras,
  });

  it('rewrites and verifies a legacy draft without carrying credentials before deleting the source', () => {
    const storage = migrationStorage({
      [legacyDraftKey]: draft('이전 초안', { code: joinCode, accessToken: 'secret-bearer' }),
    });

    expect(migrateLegacyWorkshopStorage(storage, joinCode, teamId, LEGACY_MIGRATION_NOW)).toEqual({
      attentionCount: 0,
      cleanupFailed: false,
    });
    expect(storage.getItem(legacyDraftKey)).toBeNull();
    expect(readDraft(storage.getItem(teamDraftKey), LEGACY_MIGRATION_NOW)?.rows).toEqual([
      { name: '', content: '이전 초안', rationale: '근거' },
    ]);
    expect(storage.getItem(teamDraftKey)).not.toContain(joinCode);
    expect(storage.getItem(teamDraftKey)).not.toContain('secret-bearer');
  });

  it('keeps the current team draft and moves a divergent legacy draft into a verified recovery', () => {
    const current = writeDraft(
      [{ name: '', content: '현재 초안', rationale: '' }],
      '2026-09-12T02:00:00Z',
      LEGACY_MIGRATION_NOW,
      4,
    );
    const storage = migrationStorage({
      [legacyDraftKey]: draft('충돌한 이전 초안', { code: joinCode }),
      [teamDraftKey]: current,
    });

    expect(migrateLegacyWorkshopStorage(storage, joinCode, teamId, LEGACY_MIGRATION_NOW)).toEqual({
      attentionCount: 1,
      cleanupFailed: false,
    });
    expect(storage.getItem(legacyDraftKey)).toBeNull();
    expect(storage.getItem(teamDraftKey)).toBe(current);
    const recoveries = listLegacyDraftRecoveries(storage, teamId);
    expect(recoveries).toHaveLength(1);
    expect(readDraft(recoveries[0]?.draftRaw ?? null, LEGACY_MIGRATION_NOW)?.rows[0]?.content)
      .toBe('충돌한 이전 초안');
    expect(JSON.stringify(storage.dump())).not.toContain(joinCode);
  });

  it('preserves a queue-only unsent payload as a join-code-free recovery without scheduling a resend', () => {
    const storage = migrationStorage({
      [legacyQueueKey]: queue('아직 전송하지 못한 내용', { accessToken: 'secret-bearer' }),
    });

    expect(migrateLegacyWorkshopStorage(storage, joinCode, teamId, LEGACY_MIGRATION_NOW)).toEqual({
      attentionCount: 1,
      cleanupFailed: false,
    });
    expect(storage.getItem(legacyQueueKey)).toBeNull();
    expect(storage.getItem(`climate_vote_queue:${teamId}:${topicId}`)).toBeNull();
    expect(storage.getItem(teamDraftKey)).toBeNull();
    const recoveries = listLegacyDraftRecoveries(storage, teamId);
    expect(recoveries).toHaveLength(1);
    expect(readDraft(recoveries[0]?.draftRaw ?? null, LEGACY_MIGRATION_NOW)?.rows).toEqual([
      { name: '', content: '아직 전송하지 못한 내용', rationale: '대기 근거' },
    ]);
    expect(JSON.stringify(storage.dump())).not.toContain(joinCode);
    expect(JSON.stringify(storage.dump())).not.toContain('secret-bearer');
  });

  it('preserves divergent draft and queue contents separately across a partial-save conflict', () => {
    const current = writeDraft(
      [{ name: '', content: '현재 조 초안', rationale: '' }],
      null,
      LEGACY_MIGRATION_NOW,
      5,
    );
    const storage = migrationStorage({
      [legacyDraftKey]: draft('이전 조 초안'),
      [legacyQueueKey]: queue('전송 대기 내용'),
      [teamDraftKey]: current,
    });

    expect(migrateLegacyWorkshopStorage(storage, joinCode, teamId, LEGACY_MIGRATION_NOW)).toEqual({
      attentionCount: 2,
      cleanupFailed: false,
    });
    expect(storage.getItem(teamDraftKey)).toBe(current);
    const recoveredContents = listLegacyDraftRecoveries(storage, teamId)
      .map((record) => readDraft(record.draftRaw, LEGACY_MIGRATION_NOW)?.rows[0]?.content)
      .sort();
    expect(recoveredContents).toEqual(['이전 조 초안', '전송 대기 내용'].sort());
    expect(storage.getItem(legacyDraftKey)).toBeNull();
    expect(storage.getItem(legacyQueueKey)).toBeNull();
  });

  it('retains the original draft or queue and reports an error when recovery cannot be verified', () => {
    const current = writeDraft(
      [{ name: '', content: '현재 초안', rationale: '' }],
      null,
      LEGACY_MIGRATION_NOW,
      4,
    );
    const draftRaw = draft('복구 실패 초안');
    const queueRaw = queue('복구 실패 큐');
    const storage = migrationStorage({
      [legacyDraftKey]: draftRaw,
      [legacyQueueKey]: queueRaw,
      [teamDraftKey]: current,
    });
    const originalSetItem = storage.setItem.bind(storage);
    storage.setItem = (key: string, value: string): void => {
      if (key.startsWith('climate_vote_draft_recovery:')) return;
      originalSetItem(key, value);
    };
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(migrateLegacyWorkshopStorage(storage, joinCode, teamId, LEGACY_MIGRATION_NOW)).toEqual({
      attentionCount: 2,
      cleanupFailed: true,
    });
    expect(storage.getItem(legacyDraftKey)).toBe(draftRaw);
    expect(storage.getItem(legacyQueueKey)).toBe(queueRaw);
    expect(storage.getItem(teamDraftKey)).toBe(current);
    expect(error).toHaveBeenCalled();

    error.mockRestore();
  });

  it('does not mistake a native write failure and memory fallback for durable recovery', () => {
    const draftRaw = draft('native 쓰기 실패 초안');
    const nativeStorage = migrationStorage({ [legacyDraftKey]: draftRaw });
    nativeStorage.setItem = (): void => {
      throw new Error('native quota');
    };
    const storage = createSafeBrowserStorage('localStorage', {
      getStorage: () => nativeStorage,
      memory: new Map<string, string>(),
    });
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(migrateLegacyWorkshopStorage(storage, joinCode, teamId, LEGACY_MIGRATION_NOW)).toEqual({
      attentionCount: 1,
      cleanupFailed: true,
    });
    expect(storage.isPersistent()).toBe(false);
    expect(nativeStorage.getItem(legacyDraftKey)).toBe(draftRaw);
    expect(storage.getItem(legacyDraftKey)).toBe(draftRaw);
    expect(error).toHaveBeenCalled();

    error.mockRestore();
  });

  it('restores the source mirror when native removal falls back after a verified queue recovery', () => {
    const queueRaw = queue('native 삭제 실패 큐');
    const nativeStorage = migrationStorage({ [legacyQueueKey]: queueRaw });
    nativeStorage.removeItem = (): void => {
      throw new Error('native removal denied');
    };
    const storage = createSafeBrowserStorage('sessionStorage', {
      getStorage: () => nativeStorage,
      memory: new Map<string, string>(),
    });
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(migrateLegacyWorkshopStorage(storage, joinCode, teamId, LEGACY_MIGRATION_NOW)).toEqual({
      attentionCount: 1,
      cleanupFailed: true,
    });
    expect(storage.isPersistent()).toBe(false);
    expect(nativeStorage.getItem(legacyQueueKey)).toBe(queueRaw);
    expect(storage.getItem(legacyQueueKey)).toBe(queueRaw);
    expect(storage.getItem(`climate_vote_queue:${teamId}:${topicId}`)).toBeNull();
    expect(listLegacyDraftRecoveries(nativeStorage, teamId)).toHaveLength(1);
    expect(error).toHaveBeenCalled();

    error.mockRestore();
  });
});

describe('one shared workshop snapshot', () => {
  it('loads topic_list only from the workshop session module', () => {
    expect(deadlineSource).not.toContain('topicList(');
    expect(submissionSource).not.toContain('topicList(');
    expect(consoleSource).toContain('useWorkshopSessionState(');
  });

  it('passes the same topics and server clock offset into the deadline and editor views', () => {
    expect(consoleSource).toContain('topics={sessionState.topics}');
    expect(consoleSource).toContain('serverClockOffsetMs={sessionState.serverClockOffsetMs}');
  });

  it('refreshes immediately when the page regains attention or connectivity', () => {
    expect(sessionSource).toContain("window.addEventListener('focus'");
    expect(sessionSource).toContain("document.addEventListener('visibilitychange'");
    expect(sessionSource).toContain("window.addEventListener('online'");
  });

  it('preserves focused editor scroll only for incremental topic insertion', () => {
    expect(sessionSource).toContain('if (newlyAdded.length > 0)');
    expect(sessionSource).toContain('preserveEditorScrollAfterTopicInsertion()');
    expect(sessionSource).toContain("active.closest('[data-workshop-editor-topic]')");
    expect(sessionSource).toContain('document.activeElement !== active');
    expect(sessionSource).toContain('window.scrollTo(scrollX, scrollY)');
    expect(submissionSource).toContain('data-workshop-editor-topic={topic.id}');
  });
});

describe('/mod opaque session and OCC wiring', () => {
  it('clears a stored token only for explicit server-final authorization rejections', () => {
    expect(classifyStoredSessionResumeError({ message: 'workshop authorization expired or revoked' }))
      .toBe('definitive');
    expect(classifyStoredSessionResumeError(new Error('team authorization scope mismatch')))
      .toBe('definitive');
    expect(classifyStoredSessionResumeError({ message: 'invalid workshop token' }))
      .toBe('definitive');

    expect(classifyStoredSessionResumeError(new TypeError('Failed to fetch'))).toBe('retryable');
    expect(classifyStoredSessionResumeError({ message: 'Load failed', status: 0 })).toBe('retryable');
    expect(classifyStoredSessionResumeError({ message: 'Service unavailable', status: 503 })).toBe('retryable');
    expect(classifyStoredSessionResumeError(new Error('Workshop authorization response is invalid')))
      .toBe('retryable');
    expect(classifyStoredSessionResumeError({
      get message(): never { throw new Error('hostile getter'); },
    })).toBe('retryable');
  });

  it('preserves stored authorization and drafts on ambiguous resume failures with an explicit retry', () => {
    expect(consoleSource).toContain("if (fromAddress.present || failureKind === 'definitive')");
    expect(consoleSource).toContain('setStoredResumeRetryAvailable(true)');
    expect(consoleSource).toContain('저장된 조 연결과 작성 중인 내용은 그대로 보관했습니다.');
    expect(consoleSource).toContain('저장된 연결 다시 확인');
    expect(consoleSource).toContain('setRestoreAttempt((attempt) => attempt + 1)');
    expect(consoleSource).toContain("'[workshop access] stored session resume failed'");
  });

  it('exchanges or resumes a device session and removes URL credentials before exchange', () => {
    expect(consoleSource).toContain('exchangeWorkshopCode(');
    expect(consoleSource).toContain('resumeWorkshopSession(');
    expect(consoleSource).toContain('storeWorkshopSession(');
    expect(consoleSource).not.toContain('joinTeam(');
    expect(consoleSource.indexOf('const fromAddress = takeJoinCodeFromAddress();')).toBeLessThan(
      consoleSource.indexOf('exchangeWorkshopCode(fromAddress.code'),
    );
    expect(consoleSource).toContain("url.searchParams.delete('code')");
    expect(consoleSource).toContain("url.searchParams.delete('c')");
    expect(consoleSource).toContain('window.history.replaceState(');
    expect(consoleSource).toContain('if (fromAddress.present)');
  });

  it('keeps the conflict dialog open with the latest server version when force-save CAS races again', () => {
    const start = submissionSource.indexOf('const saveConflictResolution');
    const end = submissionSource.indexOf('/** 충돌을 확인한 사용자가', start);
    const handler = submissionSource.slice(start, end);

    expect(start).toBeGreaterThanOrEqual(0);
    expect(handler).toContain('const nextConflict = conflictFromSaveError(error);');
    expect(handler).toContain('setConflict(nextConflict);');
    expect(handler).toContain('setShowServerRows(true);');
    expect(handler).toContain('setManualMerge(false);');
    expect(handler.indexOf('const nextConflict')).toBeLessThan(handler.indexOf('const kind'));
  });

  it('passes token authorization to every moderator child and RPC wrapper', () => {
    expect(consoleSource).toContain('useWorkshopSessionState({ access })');
    expect(consoleSource).toContain('<Timer access={access}');
    expect(consoleSource).toContain('<BallotPanel access={access}');
    expect(consoleSource).toContain('accessToken={access?.accessToken}');
    expect(consoleSource).toContain('access={authorization}');
    expect(ballotSource).not.toContain('code: string | null');
    expect(timerSource).not.toContain('code: string | null');
    expect(attendanceSource).toContain('externalAccessToken ?? storedToken');
  });

  it('has no production adapter branch that can send a reusable join code', () => {
    expect(deliberationSource).not.toContain('string | WorkshopAuthorization');
    expect(deliberationSource).not.toContain('p_code:');
    expect(sessionSource).not.toContain("typeof access === 'string'");
    expect(moderatorApiSource).not.toContain("rpc('mod_join'");
    expect(moderatorApiSource).not.toContain('p_code:');
    expect(deliberationSource).toContain("rpc('submission_save_v3'");
    expect(moderatorApiSource).toContain("rpc('mod_create_round_v3'");
  });

  it('keeps join credentials and tokens out of draft and retry queue keys', () => {
    expect(submissionSource).toContain('climate_vote_draft:${storageScope}:${topic.id}');
    expect(submissionSource).not.toContain('climate_vote_draft:${code}');
    expect(queueSource).toContain('baseVersion: number');
    expect(queueSource).toContain('requestId: string');
    expect(queueSource).not.toContain('code: string;');
    expect(queueSource).not.toContain('accessToken: string;');
    expect(submissionSource).not.toContain("fixtureTopics ? 'fixture'");
    expect(submissionSource).toContain('fixtureMode');
  });

  it('uses expectedVersion and exposes three explicit conflict choices', () => {
    expect(submissionSource).toContain('expectedVersion: editBaseVersion');
    expect(submissionSource).toContain('idempotencyKey: requestId');
    expect(submissionSource).toContain('expectedVersion: q.baseVersion');
    expect(submissionSource).toContain('idempotencyKey: q.requestId');
    expect(submissionSource).toContain('서버본 유지');
    expect(submissionSource).toContain('내 내용으로 덮어쓰기');
    expect(submissionSource).toContain('수동 병합');
  });

  it('preserves newer local edits when an older in-flight save succeeds', () => {
    expect(submissionSource).toContain('sameSavePayload(currentRows, items)');
    expect(submissionSource).toContain('writeDraft(currentRows, acceptedAt, Date.now(), version)');
    expect(submissionSource).toContain('if (!settled.hasNewerRows) await loadSubmission()');
    expect(submissionSource).toContain('최종 제출을 멈췄습니다');
    expect(submissionSource).toContain('readOnly={!editorWritable}');
  });

  it('reuses one proxy-vote request id until the server confirms the intent', () => {
    expect(consoleSource).toContain('const requestIdRef = useRef<string | null>(null)');
    expect(consoleSource).toContain('const requestId = requestIdRef.current ?? crypto.randomUUID()');
    expect(consoleSource).toContain('await proxyVote(access, round.id, payload, n, requestId)');
    expect(moderatorApiSource).toContain("rpc('mod_proxy_vote_v3'");
    expect(moderatorApiSource).toContain('p_idempotency_key: idempotencyKey');
  });

  it('renders CHECKBOX proxy choices as accessible multi-select controls and sends an array payload', () => {
    expect(consoleSource).toContain("round.type === 'CHECKBOX'");
    expect(consoleSource).toContain('type="checkbox"');
    expect(consoleSource).toContain('checked={checkboxChoices.includes(opt)}');
    expect(consoleSource).toContain("proxyVotePayload(round.type, choice, checkboxChoices)");
    expect(consoleSource).toContain('await proxyVote(access, round.id, payload, n, requestId)');
  });

  it('passes the authenticated HQ token into attendance even when browser storage is unavailable', () => {
    expect(hqGateSource).toContain('<HqGrid token={token} onAuthorizationExpired={handleAuthorizationExpired} />');
    expect(hqGridSource).toContain('token={token}');
    expect(hqGridSource).toContain('onAuthorizationExpired={onAuthorizationExpired}');
    expect(hqAttendanceSource).toContain('token: string;');
    expect(hqAttendanceSource).not.toContain("createSafeBrowserStorage('sessionStorage')");
    expect(hqAttendanceSource).not.toContain('unlockHqAttendance');
  });

  it('uses named HQ credentials only and never reads operator credential state before login', () => {
    expect(hqGateSource).toContain('const nextToken = await unlockHqNamed(label, password);');
    expect(hqGateSource).not.toContain('unlockHqAttendance');
    expect(hqGateSource).toContain('등록된 운영자 이름과 개인 비밀번호');
    expect(hqAttendanceSource).not.toContain('HQ 공유 비밀번호');
    expect(readFileSync(new URL('../../lib/attendance.ts', import.meta.url), 'utf8'))
      .not.toContain(".from('hq_operator')");
  });

  it('revokes HQ bearers server-side on logout and after password rotation', () => {
    expect(hqGateSource).toContain('await revokeHqSession(token);');
    expect(hqGateSource).toContain("clearLocalSession('비밀번호가 바뀌어 모든 기기에서 로그아웃되었습니다.");
    expect(hqGateSource).toContain('aria-busy={logoutBusy}');
    expect(readFileSync(new URL('../../lib/attendance.ts', import.meta.url), 'utf8'))
      .toContain("rpc('workshop_hq_logout_v2'");
  });

  it('returns every default HQ surface to the login gate after a definitive bearer rejection', () => {
    const workshopStatusSource = readFileSync(new URL('./WorkshopHqStatus.tsx', import.meta.url), 'utf8');
    const submissionBoardSource = readFileSync(new URL('./HqSubmissionBoard.tsx', import.meta.url), 'utf8');
    const gridSource = readFileSync(new URL('./HqGrid.tsx', import.meta.url), 'utf8');

    expect(hqGateSource).toContain('<WorkshopHqStatus token={token} onAuthorizationExpired={handleAuthorizationExpired} />');
    expect(hqGateSource).toContain('<HqSubmissionBoard token={token} onAuthorizationExpired={handleAuthorizationExpired} />');
    expect(hqGateSource).toContain("classifyHqAuthorizationError(error) === 'expired'");
    expect(workshopStatusSource).toContain("classifyHqAuthorizationError(caught) === 'expired'");
    expect(workshopStatusSource).toContain('onAuthorizationExpired();');
    expect(submissionBoardSource).toContain("classifyHqAuthorizationError(error) !== 'expired'");
    expect(submissionBoardSource).toContain('onAuthorizationExpired?.();');
    expect(gridSource).toContain("classifyHqAuthorizationError(error) === 'expired'");
    expect(gridSource).toContain('onAuthorizationExpired();');
    expect((gridSource.match(/classifyHqAuthorizationError\(error\) === 'expired'/g) ?? []).length)
      .toBeGreaterThanOrEqual(4);
  });

  it('revokes the exact team bearer before clearing the local workshop session', () => {
    const exitStart = consoleSource.indexOf('const confirmExit = async');
    const exitEnd = consoleSource.indexOf('const downloadLegacyDraftRecoveries', exitStart);
    const exitHandler = consoleSource.slice(exitStart, exitEnd);

    expect(exitStart).toBeGreaterThanOrEqual(0);
    expect(exitHandler).toContain('await revokeWorkshopSession(exitToken);');
    expect(exitHandler).toContain('if (exitLockRef.current) return;');
    expect(exitHandler.indexOf('await revokeWorkshopSession(exitToken);')).toBeLessThan(
      exitHandler.indexOf('clearWorkshopSession(workshopLocalStorage)'),
    );
    expect(exitHandler).toContain('서버에서 이 기기의 조 연결을 종료하지 못했습니다.');
    expect(exitHandler).toContain("classifyStoredSessionResumeError(error) !== 'definitive'");
    expect(workshopAccessSource).toContain("rpc('workshop_team_logout_v2'");
  });

  it('preserves the last HQ roster on transient refresh failures and coalesces overlapping polls', () => {
    expect(hqAttendanceSource).toContain("classifyAttendanceError(error) === 'transient'");
    expect(hqAttendanceSource).toContain('마지막으로 확인한 명단과 수정이력을 유지');
    expect(hqAttendanceSource).toContain('마지막 정상 확인');
    expect(hqAttendanceSource).toContain('지금 다시 연결');
    expect(hqAttendanceSource).toContain('if (currentRequest?.token === sessionToken) return currentRequest.promise');
    const transientStart = hqAttendanceSource.indexOf("if (classifyAttendanceError(error) === 'transient')");
    const transientBranch = hqAttendanceSource.slice(
      transientStart,
      hqAttendanceSource.indexOf('        setRows([]);', transientStart),
    );
    expect(transientBranch).not.toContain('setRows([])');
    expect(transientBranch).not.toContain('setAudit([])');
  });

  it('uses scoped polling instead of an unauthenticated broad submission channel', () => {
    expect(hqSubmissionSource).not.toContain('subscribeHqSubmissions');
    expect(hqSubmissionSource).not.toContain(".channel('hq:submissions')");
    expect(hqSubmissionSource).toContain('setInterval(() =>');
    expect(hqSubmissionSource).toContain('explicit scoped polling is the sole source');
  });

  it('reuses request ids for round and ballot creation until success or cancellation', () => {
    expect(consoleSource).toContain('createPollIntentRef');
    expect(consoleSource).toContain('await createPoll(access, input, requestId)');
    expect(moderatorApiSource).toContain("rpc('mod_create_round_v3'");
    expect(ballotSource).toContain('createRequestIdRef');
    expect(ballotSource).toContain('intent.requestId');
    expect(deliberationSource).toContain("rpc('ballot_create_v3'");
  });

  it('binds ballot retry identity to the canonical payload and blocks transitions while stale', () => {
    expect(ballotSource).toContain('ballotCreateIntent(');
    expect(ballotSource).toContain('intent.requestId');
    expect(ballotSource).toContain('refreshState.failed || refreshState.lastSuccessAt === null');
    expect(ballotSource).toContain('투표 목록 연결이 끊겨 마지막 확인 상태를 표시합니다.');
    expect(ballotSource).toContain('목록 다시 확인');
  });

  it('persists HQ categories, rolls back per card, and polls other HQ devices', () => {
    expect(hqSubmissionSource).toContain('fetchHqSubmissionCategories(');
    expect(hqSubmissionSource).toContain('assignSubmissionCategory(');
    expect(hqSubmissionSource).toContain('setCatState((current) => applyValue(current, previous))');
    expect(hqSubmissionSource).toContain('범주 저장 다시 시도');
    const pollStart = hqSubmissionSource.indexOf('const timer = setInterval(() => {');
    const pollEnd = hqSubmissionSource.indexOf('}, POLL_MS);', pollStart);
    expect(hqSubmissionSource.slice(pollStart, pollEnd)).toContain('void loadCategories()');
    expect(hqSubmissionSource.indexOf("if (!token && !fixtureRows)")).toBeLessThan(
      hqSubmissionSource.indexOf('setCatState((current) => applyValue(current, desired))'),
    );
  });

  it('fails closed when an HQ assignment or clear-all snapshot is stale', () => {
    expect(hqSubmissionSource).toContain("result.status === 'conflict'");
    expect(hqSubmissionSource).toContain('hqAssignmentConflictMessage({');
    expect(hqSubmissionSource).toContain('await reloadAssignmentBoard()');
    expect(hqSubmissionSource).toContain('if (!isCurrentOperation()) return;');
    expect(hqSubmissionSource).toContain('expectedSubmissionUpdatedAt: note.submissionUpdatedAt');
    expect(hqSubmissionSource).toContain('expectedEventId');
    expect(hqSubmissionSource).toContain('sourceItemId: note.itemId');
    expect(hqSubmissionSource).toContain('[noteId]: { message, retry: null }');
    expect(hqSubmissionSource).toContain('failure.retry.fingerprint');
    expect(hqSubmissionSource).toContain('if (mutationAnswered)');
    expect(hqSubmissionSource).toContain('onCategoryRetry={categoryErrors[note.id]?.retry ? retryNoteCategory : undefined}');
    expect(hqSubmissionSource).toContain('onKindRetry={kindErrors[note.id]?.retry ? retryNoteKind : undefined}');
    expect(hqSubmissionSource).toContain('liveItemIdentities.get(noteId) !== row.source_item_id');
    expect(hqSubmissionSource).toContain('setCategoryLoadError(null)');
    expect(hqSubmissionSource).toContain('setKindLoadError(null)');
    expect(hqSubmissionSource).toContain('setOperationError(null)');
    expect(clearAllSource).toContain('expectedSubmissions');
    expect(clearAllSource).toContain('resolveHqClearIntent(');
    expect(clearAllSource).toContain("result.status === 'conflict'");
    expect(clearAllSource).toContain('아무것도 비우지 않았습니다');
    expect(clearAllSource).toContain('await onRefresh()');
    expect(clearAllSource).toContain('if (credentialEpochRef.current !== credentialEpoch) return;');
  });

  it('implements an operable roving topic tablist and linked tabpanel', () => {
    expect(hqSubmissionSource).toContain('role="tablist"');
    expect(hqSubmissionSource).toContain('role="tab"');
    expect(hqSubmissionSource).toContain('tabIndex={selected ? 0 : -1}');
    expect(hqSubmissionSource).toContain('aria-controls={TOPIC_PANEL_ID}');
    expect(hqSubmissionSource).toContain("event.key === 'ArrowRight'");
    expect(hqSubmissionSource).toContain("event.key === 'ArrowLeft'");
    expect(hqSubmissionSource).toContain('role="tabpanel"');
    expect(hqSubmissionSource).toContain('aria-labelledby={topicTabId(board.topicId)}');
  });

  it('keeps HQ deadline freshness independent from submission refresh', () => {
    expect(hqSubmissionSource).toContain('const [deadlineRefresh, setDeadlineRefresh]');
    expect(hqSubmissionSource).toContain('data-testid="hq-deadline-refresh-error"');
    expect(hqSubmissionSource).toContain('마지막 정상 확인');
    expect(hqSubmissionSource).toContain('마감 다시 확인');
    expect(hqSubmissionSource).toContain('const [failed, setFailed]');
  });

  it('exports join-code-free recovery copies for divergent legacy drafts', () => {
    expect(consoleSource).toContain('preserveLegacyDraftRecovery(');
    expect(consoleSource).toContain('legacyRecoveriesForTeam(');
    expect(consoleSource).toContain('이전 작성 내용 복구본 내려받기');
    expect(consoleSource).toContain('이 사이트의 브라우저 데이터를 삭제해 주세요.');
    expect(consoleSource).toContain("format: 'climate-vote-legacy-draft-recovery-v1'");
  });

  it('labels stale tallies, blocks unverified final export, and offers an explicit retry', () => {
    expect(consoleSource).toContain('집계 연결이 끊겼습니다.');
    expect(consoleSource).toContain('마감 후 최종 집계를 검증하지 못했습니다.');
    expect(consoleSource).toContain('마지막 집계 확인');
    expect(consoleSource).toContain('집계 다시 확인');
    expect(consoleSource).toContain("beginVoteRefresh(current, 'final')");
    expect(consoleSource).toContain('completeVoteRefresh(current, priority, Date.now())');
    expect(consoleSource).toContain('failVoteRefresh(current, priority)');
    expect(consoleSource).toContain('finalSnapshotVerified = canUseFinalVoteSnapshot(voteRefreshMeta)');
    expect(consoleSource).toContain('disabled={!finalSnapshotVerified}');
    expect(consoleSource).toContain('마감 후 최종 집계를 확인 중입니다.');
    expect(consoleSource).toContain('최종 집계 재확인 전에는 결과 이미지를 저장할 수 없습니다.');
  });

  it('rejects duplicate option labels before opening a round', () => {
    expect(consoleSource).toContain('new Set(trimmed).size !== trimmed.length');
    expect(consoleSource).toContain('같은 보기가 두 번 들어갔습니다.');
    expect(consoleSource).toContain('trimmed.length >= 2 && !hasDuplicateOptions');
  });
});

describe('/mod keyboard and screen-reader contract', () => {
  it('connects tabs to a labelled tabpanel and uses a roving tab stop', () => {
    expect(consoleSource).toContain('aria-controls={`mod-panel-${tab.id}`}');
    expect(consoleSource).toContain('tabIndex={selected ? 0 : -1}');
    expect(consoleSource).toContain('role="tabpanel"');
  });

  it('exposes join failures as field errors', () => {
    expect(consoleSource).toContain('aria-invalid={joinCodeError}');
    expect(consoleSource).toContain('role="alert"');
    expect(consoleSource).toContain('aria-describedby=');
  });

  it('makes final submission a labelled modal dialog', () => {
    expect(submissionSource).toContain('role="dialog"');
    expect(submissionSource).toContain('aria-modal="true"');
    expect(submissionSource).toContain("event.key === 'Escape'");
  });

  it('traps focus and restores it for destructive confirmation dialogs', () => {
    expect(modalDialogSource).toContain("event.key === 'Escape'");
    expect(modalDialogSource).toContain("event.key !== 'Tab'");
    expect(modalDialogSource).toContain('previousFocus?.focus()');
    for (const source of [ballotSource, consoleSource, hqSubmissionSource, publicBallotSource]) {
      expect(source).toContain('useModalDialog<HTMLDivElement>');
      expect(source).toContain('aria-modal="true"');
      expect(source).toContain('data-dialog-initial-focus');
    }
    expect(consoleSource).not.toContain('window.confirm(');
  });

  it('requeries attendance and reports confirmed counts when finalize outcome is uncertain', () => {
    expect(attendanceSource).toContain("console.error('[attendance] finalize absent outcome is uncertain'");
    expect(attendanceSource).toContain("const confirmedRows = await load('manual')");
    expect(attendanceSource).toContain('현재 결석 ${confirmed.absent}명 · 미확인 ${confirmed.unconfirmed}명');
    expect(attendanceSource).toContain("role={finalizeNotice.kind === 'error' ? 'alert' : 'status'}");
  });

  it('shows memory-only mode on moderator, HQ, and public voting screens', () => {
    expect(consoleSource).toContain('이 페이지 메모리에만 유지됩니다');
    expect(publicVoteSource).toContain('isDeviceTokenPersistent()');
    expect(publicBallotSource).toContain('isDeviceTokenPersistent()');
    expect(publicVoteSource).toContain('기기 중복 확인 정보가 유지되지 않습니다');
  });

  it('uses 44px row action targets instead of the old 40px controls', () => {
    expect(submissionSource).not.toContain('className="w-10 h-10 rounded-lg');
    expect(submissionSource).toContain('className="w-11 h-11 rounded-lg');
  });

  it('has a skip link and main landmark', () => {
    expect(pageSource).toContain('href="#mod-console-content"');
    expect(pageSource).toContain('<main id="mod-console-content"');
  });

  it('makes the horizontally scrollable work status rail keyboard reachable', () => {
    expect(consoleSource).toContain('aria-label="조 작업 상태 가로 목록"');
    expect(consoleSource).toContain('role="region"');
    expect(consoleSource).toContain('tabIndex={0}');
  });

  it('uses readable attendance cards on mobile and keeps the dense table for desktop', () => {
    expect(hqAttendanceSource).toContain('aria-label="출석 명단" className="space-y-3 md:hidden"');
    expect(hqAttendanceSource).toContain('aria-label="출석 명단 표"');
    expect(hqAttendanceSource).toContain('md:block');
    expect(hqAttendanceSource).toContain('표시할 출석 명단이 없습니다. 검색어와 조 필터를 확인해 주세요.');
  });

  it('uses a contrast-safe selected tab color', () => {
    expect(consoleSource).toContain("? 'bg-[#135C73] text-white shadow-sm'");
    expect(consoleSource).not.toContain("? 'bg-[#23B2C3] text-white shadow-sm'");
  });
});
