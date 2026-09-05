import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import QRCode from 'qrcode';
import {
  isValidJoinCode,
  tallyVotes,
  createPoll,
  setPollStatus,
  fetchTeamVotes,
  fetchActiveRound,
  fetchTeamRounds,
  fetchTeamVoteCounts,
  proxyVote,
  type Round,
  type Team,
  type Vote,
} from '../../lib/mod-console';
import type { SubmissionItemInput, WorkshopAuthorization } from '../../lib/deliberation';
import {
  clearWorkshopSession,
  deviceLabel,
  exchangeWorkshopCode,
  getOrCreateWorkshopDeviceId,
  readWorkshopSession,
  revokeWorkshopSession,
  resumeWorkshopSession,
  storeWorkshopSession,
  type WorkshopSession,
  type WorkshopTeam,
} from '../../lib/workshop-access';
import { fetchRoundEligibleCount } from '../../lib/attendance';
import {
  modReducer,
  initialModState,
  canReopen,
  closeConfirmMessage,
  participationBase,
  REOPEN_WINDOW_MS,
  joinCodeFromSearch,
  proxyVotePayload,
  toggleProxyVoteChoice,
  beginVoteRefresh,
  canUseFinalVoteSnapshot,
  completeVoteRefresh,
  EMPTY_VOTE_REFRESH_META,
  failVoteRefresh,
  getOrCreateRoundStatusIntent,
  isDefinitiveRoundStatusFailure,
  roundStatusRecoveryDecision,
  roundUpdatedAtMs,
  type RoundStatusIntent,
  type VoteRefreshMeta,
} from './mod-state';
import { roundSequence, teamRoundHistory, type TeamRoundHistoryItem } from './round-sequence';
import { renderResultSvg, type ResultImageInput } from './result-image';
import { downloadBlob, resultImageFileName, svgToPngBlob, RESULT_IMAGE_SCALE } from './svg-to-png';
import AttendancePanel from './AttendancePanel';
import BallotPanel from './BallotPanel';
import SubmissionPanel from './SubmissionPanel';
import DeadlineBanner from './DeadlineBanner';
import { tableNoLabel } from './table-no';
import { topicAnchorId } from './submission-guide';
import { MOD_TABS, MOD_TAB_KEY, normalizeTabId, tabAfterKey, tabById, type ModTabId } from './mod-tabs';
import {
  EMPTY_WORKSHOP_WORK_SUMMARY,
  useWorkshopSessionState,
  type WorkshopSessionController,
  type WorkshopWorkSummary,
} from './workshop-session-state';
import Timer from './Timer';
import {
  listLegacyDraftRecoveries,
  preserveLegacyDraftRecovery,
  readDraft,
  writeDraft,
  type LegacyDraftRecoveryRecord,
} from './submission-draft-store';
import { useModalDialog } from './use-modal-dialog';
import { createSafeBrowserStorage } from '../../lib/safe-browser-storage';
import {
  createResourceRequestCoordinator,
  type ResourceRequestPriority,
} from './resource-request-coordinator';

const OPTION_COLORS = ['#23B2C3', '#2E75B6', '#4F9D3A', '#F5A623', '#135C73', '#1F4E79'];

function workshopTeamToTeam(team: WorkshopTeam): Team {
  return {
    id: team.id,
    name: team.name,
    subgroup: team.subgroup,
    capacity: team.capacity,
    table_no: team.table_no,
  };
}

function canonicalLegacyDraft(raw: string | null, nowMs: number): string | null {
  const draft = readDraft(raw, nowMs, Number.POSITIVE_INFINITY);
  if (!draft) return null;
  return writeDraft(
    draft.rows,
    draft.baseUpdatedAt,
    draft.savedAtMs,
    draft.baseVersion,
  );
}

function isLegacyQueueItem(value: unknown): value is SubmissionItemInput {
  if (typeof value !== 'object' || value === null) return false;
  const item = value as Partial<SubmissionItemInput>;
  return Number.isSafeInteger(item.ordinal)
    && (item.ordinal ?? 0) > 0
    && (item.kind === 'core' || item.kind === 'extra')
    && typeof item.content === 'string'
    && (item.rationale === null || typeof item.rationale === 'string');
}

/**
 * Convert only the citizen-authored fields from a legacy v1 retry queue into a
 * normal draft envelope. Credential and retry fields are deliberately ignored,
 * and the recovery key is not a queue key, so this copy can never auto-resend.
 */
function legacyQueueRecoveryDraft(raw: string | null, nowMs: number): string | null {
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
  const queue = parsed as {
    v?: unknown;
    items?: unknown;
    baseUpdatedAt?: unknown;
    queuedAtMs?: unknown;
  };
  if (queue.v !== 1 || !Array.isArray(queue.items) || queue.items.length === 0) return null;
  if (!queue.items.every(isLegacyQueueItem)) return null;
  const savedAtMs = typeof queue.queuedAtMs === 'number'
    && Number.isFinite(queue.queuedAtMs)
    && queue.queuedAtMs >= 0
    ? queue.queuedAtMs
    : nowMs;
  const baseUpdatedAt = typeof queue.baseUpdatedAt === 'string' ? queue.baseUpdatedAt : null;
  return writeDraft(
    queue.items.map((item) => ({
      name: '',
      content: item.content,
      rationale: item.rationale ?? '',
    })),
    baseUpdatedAt,
    savedAtMs,
    null,
  );
}

type PersistenceAwareStorage = Storage & { isPersistent?: () => boolean };

function assertPersistentStorage(storage: Storage): void {
  const persistenceAware = storage as PersistenceAwareStorage;
  if (typeof persistenceAware.isPersistent === 'function' && !persistenceAware.isPersistent()) {
    throw new Error('Browser storage became non-persistent during legacy recovery.');
  }
}

function writeVerifiedDraft(storage: Storage, key: string, raw: string, nowMs: number): void {
  assertPersistentStorage(storage);
  storage.setItem(key, raw);
  assertPersistentStorage(storage);
  const stored = storage.getItem(key);
  assertPersistentStorage(storage);
  if (stored !== raw || canonicalLegacyDraft(stored, nowMs) !== raw) {
    throw new Error('Legacy draft copy could not be verified.');
  }
}

function preserveVerifiedRecovery(
  storage: Storage,
  teamId: string,
  topicId: string,
  draftRaw: string,
  nowMs: number,
): void {
  assertPersistentStorage(storage);
  preserveLegacyDraftRecovery(storage, teamId, topicId, draftRaw, nowMs);
  assertPersistentStorage(storage);
  const verified = listLegacyDraftRecoveries(storage, teamId)
    .some((record) => record.topicId === topicId && record.draftRaw === draftRaw);
  assertPersistentStorage(storage);
  if (!verified) throw new Error('Legacy recovery copy could not be read back.');
}

function restoreVolatileSource(storage: Storage, key: string, sourceRaw: string): void {
  try {
    storage.setItem(key, sourceRaw);
  } catch (error) {
    console.error('[workshop access] failed to restore volatile legacy source', error);
  }
}

function removeVerified(storage: Storage, key: string, sourceRaw: string): void {
  assertPersistentStorage(storage);
  storage.removeItem(key);
  try {
    assertPersistentStorage(storage);
  } catch (error) {
    restoreVolatileSource(storage, key, sourceRaw);
    throw error;
  }
  if (storage.getItem(key) !== null) {
    throw new Error('Legacy credential-bearing key could not be removed.');
  }
  try {
    assertPersistentStorage(storage);
  } catch (error) {
    restoreVolatileSource(storage, key, sourceRaw);
    throw error;
  }
}

export type LegacyWorkshopStorageMigration = {
  attentionCount: number;
  cleanupFailed: boolean;
};

/** Remove reusable join credentials only after join-code-free content is durably readable. */
export function migrateLegacyWorkshopStorage(
  storage: Storage,
  joinCode: string,
  teamId: string,
  nowMs: number = Date.now(),
): LegacyWorkshopStorageMigration {
  const draftPrefix = `climate_vote_draft:${joinCode}:`;
  const queuePrefix = `climate_vote_queue:${joinCode}:`;
  let recoveryNotices = 0;
  let cleanupFailed = false;
  let keys: string[];
  try {
    keys = Array.from({ length: storage.length }, (_, index) => storage.key(index))
      .filter((key): key is string => key !== null);
    assertPersistentStorage(storage);
  } catch (error) {
    console.error('[workshop access] legacy storage scan failed', error);
    return { attentionCount: 1, cleanupFailed: true };
  }

  for (const key of keys) {
    if (key.startsWith(draftPrefix)) {
      try {
        const topicId = key.slice(draftPrefix.length);
        if (!topicId) throw new Error('Legacy draft topic id is missing.');
        const sourceRaw = storage.getItem(key);
        assertPersistentStorage(storage);
        if (sourceRaw === null) continue;
        const sourceDraft = canonicalLegacyDraft(sourceRaw, nowMs);
        if (!sourceDraft) throw new Error('Legacy draft is malformed; preserving its original key.');
        const target = `climate_vote_draft:${teamId}:${topicId}`;
        const targetRaw = storage.getItem(target);
        assertPersistentStorage(storage);
        if (targetRaw === null) {
          writeVerifiedDraft(storage, target, sourceDraft, nowMs);
          removeVerified(storage, key, sourceRaw);
          continue;
        }
        const targetDraft = canonicalLegacyDraft(targetRaw, nowMs);
        if (targetDraft === null) {
          preserveVerifiedRecovery(storage, teamId, topicId, sourceDraft, nowMs);
          removeVerified(storage, key, sourceRaw);
          recoveryNotices += 1;
          continue;
        }
        if (targetRaw !== targetDraft) writeVerifiedDraft(storage, target, targetDraft, nowMs);
        if (targetDraft !== sourceDraft) {
          preserveVerifiedRecovery(storage, teamId, topicId, sourceDraft, nowMs);
          removeVerified(storage, key, sourceRaw);
          recoveryNotices += 1;
          continue;
        }
        removeVerified(storage, key, sourceRaw);
      } catch (error) {
        // A failed write, read-back, or removal leaves the original source in
        // place whenever it is still available. Never hide this from operators.
        console.error('[workshop access] legacy draft migration failed', error);
        recoveryNotices += 1;
        cleanupFailed = true;
      }
    } else if (key.startsWith(queuePrefix)) {
      try {
        const topicId = key.slice(queuePrefix.length);
        if (!topicId) throw new Error('Legacy queue topic id is missing.');
        const sourceRaw = storage.getItem(key);
        assertPersistentStorage(storage);
        if (sourceRaw === null) continue;
        const recoveryDraft = legacyQueueRecoveryDraft(sourceRaw, nowMs);
        if (!recoveryDraft) {
          throw new Error('Legacy queue is malformed; preserving its original key.');
        }
        preserveVerifiedRecovery(storage, teamId, topicId, recoveryDraft, nowMs);
        removeVerified(storage, key, sourceRaw);
        recoveryNotices += 1;
      } catch (error) {
        console.error('[workshop access] legacy queue recovery failed', error);
        recoveryNotices += 1;
        cleanupFailed = true;
      }
    }
  }
  return { attentionCount: recoveryNotices, cleanupFailed };
}

const workshopLocalStorage = createSafeBrowserStorage('localStorage');
const workshopSessionStorage = createSafeBrowserStorage('sessionStorage');

function legacyRecoveriesForTeam(teamId: string): LegacyDraftRecoveryRecord[] {
  const combined = [
    ...listLegacyDraftRecoveries(workshopLocalStorage, teamId),
    ...listLegacyDraftRecoveries(workshopSessionStorage, teamId),
  ];
  const seen = new Set<string>();
  return combined.filter((record) => {
    const identity = `${record.topicId}\u0000${record.draftRaw}`;
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
}

type AddressJoinCredential = { present: boolean; code: string | null };

export type StoredSessionResumeErrorKind = 'definitive' | 'retryable';

const DEFINITIVE_STORED_SESSION_ERRORS = [
  /^workshop authorization required$/i,
  /^workshop authorization expired or revoked$/i,
  /^team authorization required$/i,
  /^team authorization scope mismatch$/i,
  /^(?:invalid|expired|revoked) (?:workshop )?(?:authorization|token)$/i,
  /^(?:workshop )?(?:authorization|token) (?:is )?(?:invalid|expired|revoked)$/i,
] as const;

function storedSessionResumeErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message.trim();
  if (typeof error !== 'object' || error === null) return '';
  try {
    const message = Reflect.get(error, 'message');
    return typeof message === 'string' ? message.trim() : '';
  } catch {
    return '';
  }
}

/**
 * A stored bearer is removed only when the token-scoped RPC explicitly says it
 * can no longer authorize this team. Network, gateway, parse, and unknown
 * failures stay retryable because the server may never have answered.
 */
export function classifyStoredSessionResumeError(error: unknown): StoredSessionResumeErrorKind {
  const message = storedSessionResumeErrorMessage(error);
  return DEFINITIVE_STORED_SESSION_ERRORS.some((pattern) => pattern.test(message))
    ? 'definitive'
    : 'retryable';
}

function takeJoinCodeFromAddress(): AddressJoinCredential {
  const code = joinCodeFromSearch(window.location.search);
  const url = new URL(window.location.href);
  const carriedCredential = url.searchParams.has('code') || url.searchParams.has('c');
  if (carriedCredential) {
    url.searchParams.delete('code');
    url.searchParams.delete('c');
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
  }
  return { present: carriedCredential, code };
}

// ============================================================
// 작은 UI 조각 — 목업 확정 톤(하얀 바탕, 헤어라인, 트래킹, mono eyebrow)
// ============================================================

function Eyebrow({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={`font-mono text-[12px] font-semibold uppercase ${className}`}
      style={{ letterSpacing: '.14em' }}
    >
      {children}
    </div>
  );
}

function Logo() {
  return (
    <div className="w-12 h-12 rounded-2xl bg-[#135C73] grid place-items-center text-white font-extrabold text-2xl shrink-0">
      M
    </div>
  );
}

// ============================================================
// State 01 — 입장
// ============================================================

function JoinScreen({
  onJoin,
  onRetryStoredSession,
  storedSessionRetryAvailable,
  error,
  busy,
}: {
  onJoin: (code: string) => void;
  onRetryStoredSession: () => void;
  storedSessionRetryAvailable: boolean;
  error: string | null;
  busy: boolean;
}) {
  const [digits, setDigits] = useState<string>('');
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const submit = () => {
    if (!busy && isValidJoinCode(digits)) onJoin(digits);
  };
  const joinCodeError = Boolean(error) && !storedSessionRetryAvailable;

  const cells = Array.from({ length: 6 }, (_, i) => digits[i] ?? '');

  return (
    <div className="min-h-screen bg-[#F5F8FB] flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md bg-white rounded-3xl border border-[#DCE7EE] overflow-hidden shadow-[0_1px_2px_rgba(31,78,121,.04),0_8px_24px_-16px_rgba(31,78,121,.18)]">
        <div className="px-7 pt-12 pb-10 flex flex-col items-center text-center">
          <div className="mb-6">
            <Logo />
          </div>
          <Eyebrow className="text-[#23B2C3] mb-2">기후시민회의</Eyebrow>
          <h1
            className="text-[30px] font-extrabold text-[#1F4E79] leading-snug mb-2"
            style={{ letterSpacing: '-.022em' }}
          >
            조 접속코드를 입력하세요
          </h1>
          <p id="join-code-help" className="text-[#5A6B73] text-[16px] mb-9">
            운영진이 배부한 <b className="text-[#1F2933]">6자리 숫자</b>를 입력합니다.
          </p>

          <div
            className="flex justify-center gap-2 sm:gap-3 mb-3 max-w-full cursor-text rounded-2xl focus-within:outline-4 focus-within:outline-offset-4 focus-within:outline-[#1F4E79]"
            role="group"
            aria-label="접속코드 6자리"
            onClick={() => inputRef.current?.focus()}
          >
            {cells.map((d, i) => {
              const isActive = focused && i === digits.length && digits.length < 6;
              return (
                <div
                  key={i}
                  className={`w-12 h-16 sm:w-14 sm:h-[72px] rounded-2xl border grid place-items-center text-[44px] font-extrabold tr-num ${
                     joinCodeError
                      ? 'border-2 border-[#DC2626] bg-[#FEF2F2] text-[#DC2626]'
                      : isActive
                        ? 'border-2 border-[#23B2C3] bg-[#F1F7FA] text-[#1F4E79]'
                        : d
                          ? 'border-[#C4D8E4] bg-[#F1F7FA] text-[#1F4E79]'
                          : 'border-[#DCE7EE] bg-white text-[#1F4E79]'
                  }`}
                  style={{ fontVariantNumeric: 'tabular-nums' }}
                >
                  {d}
                </div>
              );
            })}
          </div>

          <input
            ref={inputRef}
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={6}
            value={digits}
            disabled={busy}
            aria-label="조 접속코드 6자리 입력"
            aria-invalid={joinCodeError}
            aria-describedby={joinCodeError ? 'join-code-help join-code-error' : 'join-code-help'}
            aria-errormessage={joinCodeError ? 'join-code-error' : undefined}
            className="sr-only"
            autoFocus
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onChange={(e) => {
              const v = e.target.value.replace(/\D/g, '').slice(0, 6);
              setDigits(v);
              if (!busy && v.length === 6 && isValidJoinCode(v)) onJoin(v);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit();
            }}
          />

          {error ? (
            <div
              id="join-code-error"
              role="alert"
              className={`flex items-center gap-2 text-[16px] font-semibold rounded-xl px-4 py-2.5 ${
                storedSessionRetryAvailable
                  ? 'mb-3 border-2 border-[#F5A623] bg-[#FFF4D6] text-[#6B4B00]'
                  : 'mb-8 border border-[#DC2626]/30 bg-[#FEF2F2] text-[#B91C1C]'
              }`}
            >
              <span aria-hidden="true">{storedSessionRetryAvailable ? '↻' : '⛔'}</span>
              <span>{error}</span>
            </div>
          ) : (
            <Eyebrow className="text-[#5A6B73] mb-9">Numeric keypad</Eyebrow>
          )}

          {storedSessionRetryAvailable ? (
            <button
              type="button"
              onClick={onRetryStoredSession}
              disabled={busy}
              aria-describedby="join-code-error"
              className="mb-5 min-h-14 w-full rounded-2xl border-2 border-[#1F4E79] bg-white px-4 text-[18px] font-bold text-[#1F4E79] disabled:opacity-50 focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-[#F5A623]"
            >
              {busy ? '저장된 연결 확인 중…' : '저장된 연결 다시 확인'}
            </button>
          ) : null}

          <button
            type="button"
            onClick={submit}
            disabled={!isValidJoinCode(digits) || busy}
            className="w-full h-16 rounded-2xl bg-[#135C73] text-white text-[22px] font-bold shadow-sm active:scale-[.99] transition disabled:opacity-40 focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-[#1F4E79]"
          >
            {busy ? '입장 중…' : joinCodeError ? '다시 입장' : '입장'}
          </button>
          <p className="text-[14px] text-[#5A6B73] mt-5">코드를 모르면 운영 데스크에 문의하세요.</p>
          <a
            href="/mod-help"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[13px] text-[#23B2C3] font-semibold underline underline-offset-2 mt-2"
          >
            도움말
          </a>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// 지난 투표 — 홈에서 우리 조가 오늘 한 투표를 회차별로 다시 본다 (읽기 전용)
// ============================================================

/** ISO 시각을 시:분으로. 값이 없거나 깨졌으면 '—'. (HqGrid.formatTime과 같은 관례) */
function formatClock(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
}

/**
 * 결과 한 장을 PNG로 내려받는 버튼. 결과 화면과 지난 투표 다시보기가 같은 것을 쓴다.
 *
 * 저장에 실패해도 화면은 그대로 두고 **다음에 할 일**을 알린다 — 현장에서 한 번 막히면
 * 되돌릴 시간이 없다. 브라우저가 canvas를 지원하지 않는 경우도 같은 경로로 떨어진다
 * (svgToPngBlob이 실패를 전부 문구 있는 예외로 모아 준다).
 */
function SaveResultImageButton({ input, className }: { input: ResultImageInput; className: string }) {
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    setFailed(false);
    try {
      const blob = await svgToPngBlob(renderResultSvg(input), RESULT_IMAGE_SCALE);
      downloadBlob(
        blob,
        // 파일명 시각은 '저장한 때'다. 마감 시각은 그림 안에 이미 들어 있고,
        // 같은 회차를 두 번 저장해도 파일이 서로 덮어쓰지 않는다.
        resultImageFileName({ teamName: input.teamName, sequence: input.sequence, at: new Date() }),
      );
    } catch {
      setFailed(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={handleSave}
        disabled={saving}
        className={`${className} disabled:opacity-50`}
      >
        <span aria-hidden="true">⬇</span> {saving ? '저장 중…' : '이미지 저장'}
      </button>
      {failed ? (
        <p className="rounded-xl border-2 border-[#F5A623] bg-[#F5A623]/10 px-4 py-3 text-[16px] font-extrabold text-[#B5651D]">
          이미지 저장에 실패했습니다 — 이 화면을 휴대폰으로 찍어 두세요. 결과는 남아 있어 본부에서
          나중에 다시 뽑을 수 있습니다.
        </p>
      ) : null}
    </>
  );
}

/**
 * 지난 라운드 하나의 결과를 다시 보여주는 읽기 전용 오버레이.
 * 마감·다시 열기 버튼은 넣지 않는다 — 여기서 현재 진행 중인 투표를 건드릴 수 있으면 안 된다.
 */
function PastRoundDetail({
  item,
  teamName,
  access,
  onClose,
}: {
  item: TeamRoundHistoryItem;
  teamName: string;
  access: WorkshopAuthorization;
  onClose: () => void;
}) {
  const [votes, setVotes] = useState<Vote[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setVotes(null);
    setFailed(false);
    fetchTeamVotes(access, item.id)
      .then((v) => {
        if (!cancelled) setVotes(v);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [access, item.id]);

  const tally = votes ? tallyVotes(item.round, votes) : null;
  // options가 없는 라운드(SCALE)도 집계는 나오므로 보기 목록이 아니라 집계 키를 기준으로 줄을 만든다.
  const ranked = tally
    ? Object.entries(tally.byOption)
        .map(([opt, count]) => ({ opt, count }))
        .sort((a, b) => b.count - a.count)
    : [];

  // 표를 아직 못 받았거나(로딩) 조회에 실패한 상태에서는 저장 버튼을 내지 않는다 —
  // 그 상태로 뽑으면 '표 없음'이라고 적힌 가짜 기록물이 남는다.
  const imageInput: ResultImageInput | null =
    tally && !failed
      ? {
          teamName,
          sequence: item.sequence,
          title: item.title,
          closedAtLabel: item.status === 'closed' && item.closedAt ? formatClock(item.closedAt) : null,
          total: tally.total,
          results: ranked.map(({ opt, count }) => ({ option: opt, count })),
        }
      : null;

  return (
    <div className="fixed inset-0 z-40 bg-[#1F4E79]/55 backdrop-blur-[1px] flex items-center justify-center p-5">
      <div className="w-full max-w-md bg-white rounded-2xl border border-[#DCE7EE] overflow-hidden">
        <div className="px-6 pt-6 pb-4">
          <Eyebrow className="text-[#5A6B73] mb-2">
            {item.sequence}차 투표 · {item.status === 'closed' ? `마감 ${formatClock(item.closedAt)}` : '진행 중'}
          </Eyebrow>
          <h4 className="text-[22px] font-extrabold text-[#1F4E79] leading-snug" style={{ letterSpacing: '-.01em' }}>
            {item.title}
          </h4>
        </div>

        <div className="px-6 pb-5 space-y-3 max-h-[50vh] overflow-y-auto">
          {failed ? (
            <p className="text-[17px] font-bold text-[#B5651D]">
              결과를 불러오지 못했습니다 — 네트워크를 확인하고 목록에서 다시 눌러 주세요.
            </p>
          ) : tally == null ? (
            <p className="text-[17px] text-[#5A6B73]">불러오는 중…</p>
          ) : ranked.length === 0 || tally.total === 0 ? (
            <p className="text-[17px] font-bold text-[#5A6B73]">표가 없습니다.</p>
          ) : (
            <>
              <p className="text-[17px] font-extrabold text-[#1F4E79] tr-num">총 {tally.total}표</p>
              {ranked.map(({ opt, count }, i) => {
                const pct = tally.total > 0 ? Math.round((count / tally.total) * 100) : 0;
                return (
                  <div key={opt}>
                    <div className="flex justify-between items-baseline mb-1.5 gap-3">
                      <span className="text-[18px] font-bold text-[#1F2933] min-w-0 break-words">{opt}</span>
                      <span className="text-[18px] font-extrabold text-[#1F4E79] tr-num shrink-0">
                        {count}표 <span className="text-[#5A6B73] text-[15px] font-semibold">{pct}%</span>
                      </span>
                    </div>
                    <div className="h-8 rounded-lg bg-[#F1F7FA] overflow-hidden">
                      <div
                        className="h-full rounded-lg"
                        style={{ width: `${pct}%`, background: OPTION_COLORS[i % OPTION_COLORS.length] }}
                      />
                    </div>
                  </div>
                );
              })}
            </>
          )}
        </div>

        <div className="p-5 pt-0 space-y-3">
          {imageInput ? (
            <SaveResultImageButton
              input={imageInput}
              className="w-full h-[56px] rounded-2xl border-2 border-[#1F4E79] bg-white text-[#1F4E79] text-[19px] font-bold flex items-center justify-center gap-2"
            />
          ) : null}
          <button
            type="button"
            onClick={onClose}
            className="w-full h-[56px] rounded-2xl bg-[#1F4E79] text-white text-[19px] font-bold shadow-sm"
          >
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * 우리 조의 지난 투표 목록. 라운드가 하나도 없으면 아무것도 렌더하지 않는다
 * (첫 투표 전 홈 화면에 빈 카드를 띄우지 않기 위해서다).
 */
function PastRoundsCard({
  teamId,
  teamName,
  access,
}: {
  teamId: string;
  teamName: string;
  access: WorkshopAuthorization;
}) {
  const [items, setItems] = useState<TeamRoundHistoryItem[]>([]);
  const [loadFailed, setLoadFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [selected, setSelected] = useState<TeamRoundHistoryItem | null>(null);

  useEffect(() => {
    if (!teamId) return;
    let cancelled = false;
    (async () => {
      try {
        const all = await fetchTeamRounds(access);
        const mine = all.filter((r) => r.team_id === teamId);
        // 표수는 라운드당 요청 1건이고 하나라도 실패하면 전부 throw한다 —
        // 목록 자체를 잃지 않도록 여기서 격리하고, 실패하면 표수만 '—'로 둔다.
        const counts =
          mine.length > 0
            ? await fetchTeamVoteCounts(access, mine.map((r) => r.id)).catch((error: unknown) => {
                console.warn('[moderator history] vote counts unavailable', error);
                return {};
              })
            : {};
        if (cancelled) return;
        setItems(teamRoundHistory(teamId, mine, counts));
        setLoadFailed(false);
      } catch {
        if (!cancelled) setLoadFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [access, teamId, reloadKey]);

  // 라운드가 없고 오류도 없으면 목록 영역을 통째로 렌더하지 않는다.
  if (items.length === 0 && !loadFailed) return null;

  return (
    <section className="rounded-2xl border border-[#DCE7EE] bg-white overflow-hidden shadow-sm">
      <div className="flex items-center gap-3 px-6 py-4 bg-[#1F4E79]/8 border-b border-[#DCE7EE]">
        <span className="w-11 h-11 rounded-xl bg-[#1F4E79] grid place-items-center text-white text-2xl" aria-hidden="true">
          🗂️
        </span>
        <h3 className="text-[22px] font-extrabold text-[#1F4E79]" style={{ letterSpacing: '-.01em' }}>
          지난 투표
        </h3>
      </div>
      <div className="p-4 sm:p-6 space-y-3">
        {loadFailed ? (
          <div className="flex flex-wrap items-center gap-3 rounded-xl border-2 border-[#F5A623] bg-[#F5A623]/10 px-4 py-3">
            <span className="text-[16px] font-extrabold text-[#B5651D] flex-1 min-w-[200px]">
              지난 투표를 불러오지 못했습니다 — 네트워크를 확인해 주세요.
            </span>
            <button
              type="button"
              onClick={() => setReloadKey((k) => k + 1)}
              className="min-h-11 rounded-lg border-2 border-[#B5651D] px-4 text-[15px] font-bold text-[#B5651D]"
            >
              지금 다시 시도
            </button>
          </div>
        ) : null}

        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setSelected(item)}
            className="w-full rounded-xl border border-[#C4D8E4] bg-white px-4 py-3 text-left flex items-center gap-3 active:scale-[.99] transition"
          >
            <span className="shrink-0 w-14 h-14 rounded-xl bg-[#F1F7FA] border border-[#DCE7EE] grid place-items-center text-[18px] font-extrabold text-[#1F4E79] tr-num">
              {item.sequence}차
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[18px] font-bold text-[#1F2933] truncate">{item.title}</span>
              <span className="mt-1 flex flex-wrap items-center gap-2 text-[15px] font-semibold text-[#5A6B73] tr-num">
                {item.status === 'closed' ? (
                  <span>마감 {formatClock(item.closedAt)}</span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-[#135C73] px-2.5 py-0.5 text-[14px] font-bold text-white">
                    <span className="w-2 h-2 rounded-full bg-white animate-pulse" aria-hidden="true" />
                    진행 중
                  </span>
                )}
                <span aria-hidden="true">·</span>
                <span>{item.total == null ? '표수 확인 안 됨' : `총 ${item.total}표`}</span>
              </span>
            </span>
            <span className="shrink-0 text-[16px] font-bold text-[#1F4E79]">결과 보기 →</span>
          </button>
        ))}
      </div>

      {selected ? (
        <PastRoundDetail item={selected} teamName={teamName} access={access} onClose={() => setSelected(null)} />
      ) : null}
    </section>
  );
}

// ============================================================
// State 02 — 홈 (투표 만들기)  * 타이머 카드는 Task 5 placeholder
// ============================================================

function formatSyncClock(atMs: number | null): string {
  if (atMs === null) return '아직 없음';
  return new Date(atMs).toLocaleTimeString('ko-KR', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

/** 꼭지·연결·작성 상태를 탭 밖 한 줄에서 함께 보여 주는 현장 상태 레일. */
function WorkshopStatusRail({
  session,
  work,
  onJumpToNewTopic,
}: {
  session: WorkshopSessionController;
  work: WorkshopWorkSummary;
  onJumpToNewTopic: () => void;
}) {
  const connectionLabel = session.syncing && session.lastSyncedAtMs === null
    ? '연결 확인 중'
    : session.connection === 'online'
      ? '연결됨'
      : session.connection === 'offline'
        ? '오프라인 · 연결 대기'
        : session.connection === 'retrying'
          ? session.syncing ? '다시 연결 중' : '연결 재시도 중'
          : '연결 확인 전';
  const connectionTone =
    session.connection === 'online'
      ? 'border-[#4F9D3A]/40 bg-[#EAF5E6] text-[#2F6322]'
      : session.connection === 'offline' || session.connection === 'retrying'
        ? 'border-[#F5A623] bg-[#FFF4D6] text-[#6B4B00]'
        : 'border-[#C4D8E4] bg-white text-[#5A6B73]';
  const counters = [
    { testId: 'workshop-work-unsaved', label: '미저장', value: work.unsaved, warn: work.unsaved > 0 },
    { testId: 'workshop-work-queued', label: '전송 대기', value: work.queued, warn: work.queued > 0 },
    { testId: 'workshop-work-conflict', label: '충돌', value: work.conflicts, warn: work.conflicts > 0 },
    { testId: 'workshop-work-saving', label: '저장 중', value: work.saving, warn: false },
    { testId: 'workshop-work-failed', label: '실패', value: work.failed, warn: work.failed > 0 },
  ] as const;

  return (
    <section
      data-testid="workshop-status-rail"
      aria-label="조 작업 상태"
      className="mb-3 rounded-2xl border border-[#C4D8E4] bg-white px-3 py-3 shadow-sm"
    >
      <div
        className="flex items-center gap-2 overflow-x-auto pb-1 whitespace-nowrap focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-[#1F4E79]"
        role="region"
        tabIndex={0}
        aria-label="조 작업 상태 가로 목록"
      >
        <span
          data-testid="workshop-sync-status"
          role="status"
          aria-live="polite"
          aria-atomic="true"
          className={`inline-flex min-h-11 shrink-0 items-center rounded-xl border px-3 text-[15px] font-extrabold ${connectionTone}`}
        >
          <span className="mr-2 h-2.5 w-2.5 shrink-0 rounded-full bg-current" aria-hidden="true" />
          {connectionLabel}
        </span>
        <span
          data-testid="workshop-last-synced"
          className="inline-flex min-h-11 shrink-0 items-center rounded-xl border border-[#DCE7EE] bg-[#F5F8FB] px-3 text-[14px] font-semibold text-[#5A6B73] tr-num"
        >
          마지막 확인 {formatSyncClock(session.lastSyncedAtMs)}
        </span>
        {counters.map((counter) => (
          <span
            key={counter.testId}
            data-testid={counter.testId}
            className={`inline-flex min-h-11 shrink-0 items-center rounded-xl border px-3 text-[14px] font-bold tr-num ${
              counter.warn
                ? 'border-[#B5651D] bg-[#FFF4D6] text-[#6B4B00]'
                : 'border-[#DCE7EE] bg-white text-[#5A6B73]'
            }`}
          >
            {counter.label} {counter.value}
          </span>
        ))}
        {(session.connection === 'retrying' || session.connection === 'offline') && (
          <button
            type="button"
            onClick={session.refresh}
            className="min-h-11 shrink-0 rounded-xl border-2 border-[#1F4E79] bg-white px-3 text-[14px] font-bold text-[#1F4E79] focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-[#F5A623]"
          >
            지금 다시 연결
          </button>
        )}
      </div>

      {session.newTopicAnnouncement ? (
        <div
          data-testid="workshop-new-topic-alert"
          className="mt-3 flex flex-wrap items-center gap-3 rounded-xl border-2 border-[#23B2C3] bg-[#EAF8FA] px-4 py-3 text-[#135C73]"
        >
          <span
            role="status"
            aria-live="polite"
            aria-atomic="true"
            className="min-w-[220px] flex-1 text-[17px] font-extrabold"
          >
            {session.newTopicAnnouncement} 작성 중인 위치는 그대로 유지했습니다.
          </span>
          <button
            type="button"
            data-testid="workshop-new-topic-jump"
            onClick={onJumpToNewTopic}
            className="min-h-11 rounded-xl bg-[#135C73] px-4 text-[16px] font-bold text-white focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-[#F5A623]"
          >
            새 꼭지로 이동
          </button>
        </div>
      ) : null}
    </section>
  );
}

function HomeScreen({
  teamId,
  teamName,
  tableNo,
  subgroup,
  access,
  onCreatePoll,
  creating,
  onExit,
}: {
  teamId: string;
  teamName: string;
  tableNo?: string | null;
  /** 토큰 교환 응답의 team.subgroup — BallotPanel의 분과 한정 투표 옵션에 쓴다. */
  subgroup?: string | null;
  access: WorkshopAuthorization | null;
  onCreatePoll: (input: { title: string; type: 'RADIO' | 'CHECKBOX'; options: string[] }) => void;
  creating: boolean;
  onExit?: () => void;
}) {
  // 탭 — 8.29는 조별 산출물이 본 과업이라 그것이 기본이다(mod-tabs.ts).
  // 새로고침해도 보던 탭에 머물도록 sessionStorage에 남긴다.
  const [tab, setTab] = useState<ModTabId>(() =>
    normalizeTabId(workshopSessionStorage.getItem(MOD_TAB_KEY))
  );
  const sessionState = useWorkshopSessionState({ access });
  const selectTab = (next: ModTabId) => {
    setTab(next);
    try {
      workshopSessionStorage.setItem(MOD_TAB_KEY, next);
    } catch (error) {
      console.warn('[moderator tabs] preference storage unavailable', error);
    }
  };

  /**
   * 저장 안 한 내용이 있는 꼭지 id — 작성 탭(`SubmissionPanel`)이 올려 보낸다.
   *
   * ★ 탭을 옮겨 패널이 사라져도 **마지막 값을 그대로 둔다.** 패널이 없는 동안에는
   *   아무도 글을 고칠 수 없으므로 그 값이 여전히 사실이고, 지우면 마감 3분 전에
   *   「저장 안 한 내용이 있습니다」가 조용히 사라진다.
   */
  const [workSummary, setWorkSummary] = useState<WorkshopWorkSummary>(() => ({
    ...EMPTY_WORKSHOP_WORK_SUMMARY,
    unsavedTopicIds: [],
  }));
  const [pendingTopicJump, setPendingTopicJump] = useState<string | null>(null);

  const jumpToNewTopic = () => {
    const topicId = sessionState.newTopicIds[0];
    if (!topicId) return;
    selectTab('submission');
    setPendingTopicJump(topicId);
    sessionState.clearNewTopicAnnouncement();
  };

  // 자동 폴링은 입력 위치를 건드리지 않는다. 이 이동은 새 꼭지 알림의 버튼을 사용자가
  // 직접 눌렀을 때만 예약되며, 탭 패널이 그려진 다음 제목으로 초점을 옮긴다.
  useEffect(() => {
    if (tab !== 'submission' || !pendingTopicJump) return;
    const frame = requestAnimationFrame(() => {
      const target = document.getElementById(topicAnchorId(pendingTopicJump));
      target?.focus({ preventScroll: true });
      target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setPendingTopicJump(null);
    });
    return () => cancelAnimationFrame(frame);
  }, [pendingTopicJump, sessionState.topics, tab]);

  const [title, setTitle] = useState('');
  const [type, setType] = useState<'RADIO' | 'CHECKBOX'>('RADIO');
  const [options, setOptions] = useState<string[]>(['', '']);

  const setOption = (i: number, v: string) =>
    setOptions((prev) => prev.map((o, idx) => (idx === i ? v : o)));
  const addOption = () => setOptions((prev) => (prev.length < 6 ? [...prev, ''] : prev));
  const removeOption = (i: number) =>
    setOptions((prev) => (prev.length > 2 ? prev.filter((_, idx) => idx !== i) : prev));

  const trimmed = options.map((o) => o.trim()).filter(Boolean);
  const hasDuplicateOptions = new Set(trimmed).size !== trimmed.length;
  const canOpen = title.trim().length > 0 && trimmed.length >= 2 && !hasDuplicateOptions;

  return (
    <div className="min-h-screen bg-[#F5F8FB]">
      <TopBar right={<TeamBadge name={teamName} tableNo={tableNo} live />} onExit={onExit} />

      <div className="max-w-5xl mx-auto p-6 sm:p-8">
        {/*
          마감 배너는 **탭 바 위·탭 렌더 바깥**이다. 조의 기본 탭이 `submission` 이라
          (`mod-tabs.ts:24-28`) `timer` 탭 안에 두면 8.29처럼 아무도 보지 않는다(설계 B-D2).
          마감이 안 걸려 있으면 스스로 아무것도 그리지 않는다.
        */}
        <div className="sticky top-0 z-30 -mx-2 bg-[#F5F8FB]/95 px-2 pt-2 backdrop-blur-sm print:hidden">
          <WorkshopStatusRail
            session={sessionState}
            work={workSummary}
            onJumpToNewTopic={jumpToNewTopic}
          />
          <DeadlineBanner
            topics={sessionState.topics}
            serverClockOffsetMs={sessionState.serverClockOffsetMs}
            unsavedTopicIds={workSummary.unsavedTopicIds}
          />
        </div>
        <ModTabBar active={tab} onSelect={selectTab} />

        {MOD_TABS.filter((item) => item.id !== tab).map((item) => (
          <div
            key={item.id}
            id={`mod-panel-${item.id}`}
            role="tabpanel"
            aria-labelledby={`mod-tab-${item.id}`}
            hidden
          />
        ))}
        <div
          id={`mod-panel-${tab}`}
          role="tabpanel"
          aria-labelledby={`mod-tab-${tab}`}
          tabIndex={0}
          className={tab === 'vote' ? 'grid lg:grid-cols-2 gap-6' : 'grid gap-6'}
        >
          {tab === 'vote' && (
          /* 투표 만들기 카드 */
          <section className="rounded-2xl border border-[#DCE7EE] bg-white overflow-hidden shadow-sm">
            <div className="flex items-center gap-3 px-6 py-4 bg-[#23B2C3]/8 border-b border-[#DCE7EE]">
              <span className="w-11 h-11 rounded-xl bg-[#23B2C3] grid place-items-center text-white text-2xl" aria-hidden="true">
                🗳️
              </span>
              <h3 className="text-[22px] font-extrabold text-[#1F4E79]" style={{ letterSpacing: '-.01em' }}>
                투표 만들기
              </h3>
            </div>
            <div className="p-4 sm:p-6 space-y-5">
              <div>
                <label className="block text-[#5A6B73] font-mono text-[12px] font-semibold uppercase mb-2" style={{ letterSpacing: '.14em' }}>
                  질문
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="예: 우리 조가 가장 중요하게 볼 의제는?"
                  className="w-full min-w-0 h-14 rounded-xl border border-[#C4D8E4] focus:border-[#23B2C3] px-4 text-[18px] text-[#1F2933] outline-none focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-[#1F4E79]"
                />
              </div>

              <div>
                <label className="block text-[#5A6B73] font-mono text-[12px] font-semibold uppercase mb-2" style={{ letterSpacing: '.14em' }}>
                  유형
                </label>
                <div className="inline-flex rounded-xl border border-[#C4D8E4] overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setType('RADIO')}
                    className={`px-6 h-12 text-[17px] font-bold ${type === 'RADIO' ? 'bg-[#135C73] text-white' : 'bg-white text-[#5A6B73]'}`}
                  >
                    단일선택
                  </button>
                  <button
                    type="button"
                    onClick={() => setType('CHECKBOX')}
                    className={`px-6 h-12 text-[17px] font-semibold ${type === 'CHECKBOX' ? 'bg-[#135C73] text-white' : 'bg-white text-[#5A6B73]'}`}
                  >
                    복수선택
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-[#5A6B73] font-mono text-[12px] font-semibold uppercase mb-2" style={{ letterSpacing: '.14em' }}>
                  보기 (2~6개)
                </label>
                <div className="space-y-3">
                  {options.map((opt, i) => (
                    <div key={i} className="flex min-w-0 items-center gap-2 sm:gap-3">
                      <span className="w-9 h-9 shrink-0 rounded-lg bg-[#F1F7FA] border border-[#DCE7EE] grid place-items-center text-[16px] font-bold text-[#1F4E79]">
                        {i + 1}
                      </span>
                      <input
                        type="text"
                        value={opt}
                        onChange={(e) => setOption(i, e.target.value)}
                        className="min-w-0 flex-1 h-[52px] rounded-xl border border-[#C4D8E4] focus:border-[#23B2C3] px-3 sm:px-4 text-[18px] text-[#1F2933] outline-none focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-[#1F4E79]"
                      />
                      <button
                        type="button"
                        onClick={() => removeOption(i)}
                        disabled={options.length <= 2}
                        aria-label={`보기 ${i + 1} 삭제`}
                        className="w-10 sm:w-12 h-12 shrink-0 rounded-lg border border-[#DCE7EE] text-[#5A6B73] text-2xl grid place-items-center disabled:opacity-30"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={addOption}
                  disabled={options.length >= 6}
                  className="mt-3 w-full h-[52px] rounded-xl border border-dashed border-[#23B2C3] text-[#135C73] text-[18px] font-bold flex items-center justify-center gap-2 disabled:opacity-30"
                >
                  <span className="text-2xl leading-none">＋</span> 보기 추가
                </button>
                {hasDuplicateOptions ? (
                  <p className="mt-3 rounded-xl border border-[#DC2626]/30 bg-[#FEF2F2] px-4 py-3 text-[15px] font-bold text-[#B91C1C]" role="alert">
                    같은 보기가 두 번 들어갔습니다. 중복된 보기를 다르게 수정해 주세요.
                  </p>
                ) : null}
              </div>

              <button
                type="button"
                disabled={!canOpen || creating}
                onClick={() => onCreatePoll({ title: title.trim(), type, options: trimmed })}
                className="w-full h-16 rounded-2xl bg-[#135C73] text-white text-[22px] font-bold shadow-sm active:scale-[.99] transition mt-2 disabled:opacity-40"
              >
                {creating ? '여는 중…' : '투표 열기'}
              </button>
            </div>
          </section>
          )}

          {tab === 'timer' && <Timer access={access} teamName={teamName} />}
          {tab === 'attendance' && (
            <AttendancePanel teamId={teamId} teamName={teamName} accessToken={access?.accessToken} />
          )}
          {tab === 'vote' && <BallotPanel access={access} subgroup={subgroup ?? null} />}
          {tab === 'submission' && (
            <SubmissionPanel
              access={access}
              storageScope={teamId}
              teamLabel={teamName}
              tableNo={tableNo}
              topics={sessionState.topics}
              topicsFailed={
                sessionState.topics === null &&
                (sessionState.connection === 'retrying' || sessionState.connection === 'offline')
              }
              onRetryTopics={sessionState.refresh}
              onWorkSummaryChange={setWorkSummary}
            />
          )}
          {tab === 'vote' && access && <PastRoundsCard teamId={teamId} teamName={teamName} access={access} />}
        </div>
      </div>
    </div>
  );
}

/**
 * 조 콘솔 상단 탭 — 8.29의 위계를 그대로 옮긴다(조별 산출물이 첫 탭·기본값).
 * 조 모더레이터가 노트북 앞에서 장갑 낀 손으로도 누를 수 있도록 높이 56px·18px 글자를 쓴다.
 */
function ModTabBar({ active, onSelect }: { active: ModTabId; onSelect: (id: ModTabId) => void }) {
  const tabRefs = useRef<Partial<Record<ModTabId, HTMLButtonElement>>>({});
  const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, current: ModTabId) => {
    const next = tabAfterKey(current, event.key);
    if (!next) return;
    event.preventDefault();
    onSelect(next);
    tabRefs.current[next]?.focus();
  };

  return (
    <div className="mb-8">
      <div
        role="tablist"
        aria-label="조 콘솔 메뉴"
        className="flex flex-wrap gap-2 p-2 rounded-2xl border border-[#DCE7EE] bg-white shadow-sm"
      >
        {MOD_TABS.map((tab) => {
          const selected = tab.id === active;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              id={`mod-tab-${tab.id}`}
              aria-controls={`mod-panel-${tab.id}`}
              aria-selected={selected}
              tabIndex={selected ? 0 : -1}
              ref={(element) => {
                tabRefs.current[tab.id] = element ?? undefined;
              }}
              onClick={() => onSelect(tab.id)}
              onKeyDown={(event) => handleKeyDown(event, tab.id)}
              className={`flex-1 min-w-[120px] h-14 px-4 rounded-xl text-[18px] font-bold transition active:scale-[.99] focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-[#1F4E79] ${
                selected
                  ? 'bg-[#135C73] text-white shadow-sm'
                  : 'bg-transparent text-[#5A6B73] hover:bg-[#F1F7FA]'
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
      <p className="text-[#5A6B73] text-[15px] mt-3 px-1">{tabById(active).hint}</p>
    </div>
  );
}

function TopBar({
  right,
  live,
  onExit,
}: {
  right: React.ReactNode;
  live?: boolean;
  /** 주면 조 배지 옆에 「나가기」가 붙는다. 조에 들어와 있을 때만 준다. */
  onExit?: () => void;
}) {
  return (
    <div className="flex items-center justify-between px-6 py-4 border-b border-[#DCE7EE] bg-[#F1F7FA]">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-[#135C73] grid place-items-center text-white font-bold">M</div>
        {live ? (
          <span className="flex items-center gap-2 text-[#135C73] font-bold text-[16px]">
            <span className="w-3 h-3 rounded-full bg-[#23B2C3] animate-pulse" />
            <Eyebrow className="text-[#135C73]">Live</Eyebrow> 투표 진행 중
          </span>
        ) : (
          <Eyebrow className="text-[#5A6B73]">Moderator Console</Eyebrow>
        )}
      </div>
      <div className="flex items-center gap-2">
        {right}
        {onExit ? (
          <button
            type="button"
            onClick={onExit}
            className="min-h-11 rounded-lg border border-[#C4D8E4] bg-white px-3 text-[14px] font-bold text-[#5A6B73] focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-[#1F4E79]"
          >
            나가기
          </button>
        ) : null}
      </div>
    </div>
  );
}

function TeamBadge({ name, tableNo, live }: { name: string; tableNo?: string | null; live?: boolean }) {
  // 번호가 없으면 아무것도 렌더하지 않는다 — 빈 칩이 생기면 "번호를 못 받았다"로 읽힌다.
  const tableLabel = tableNoLabel(tableNo);
  return (
    <div className="flex items-center gap-2 bg-[#1F4E79] text-white rounded-full pl-4 pr-3 py-2">
      <span className="text-[19px] font-bold" style={{ letterSpacing: '-.01em' }}>
        {name}
      </span>
      {tableLabel ? (
        <span className="rounded-full bg-white/20 px-2.5 py-0.5 text-[17px] font-extrabold whitespace-nowrap">
          {tableLabel}
        </span>
      ) : null}
      {live !== undefined && (
        <span className={`w-2.5 h-2.5 rounded-full ${live ? 'bg-[#4F9D3A]' : 'bg-[#5A6B73]'}`} title="접속됨" />
      )}
    </div>
  );
}

function VoteRefreshNotice({
  meta,
  final,
  onRetry,
}: {
  meta: VoteRefreshMeta;
  final: boolean;
  onRetry: () => void;
}) {
  const lastSuccess = meta.lastSuccessAt == null ? null : formatSyncClock(meta.lastSuccessAt);
  if (final && meta.finalVerificationStatus === 'pending') {
    return (
      <div
        className="mb-4 rounded-xl border-2 border-[#1F4E79]/30 bg-[#F1F7FA] px-4 py-3 text-[15px] font-extrabold text-[#1F4E79]"
        role="status"
        aria-live="polite"
      >
        마감 후 최종 집계를 확인 중입니다. 확인이 끝날 때까지 결과 확대·이미지 저장을 잠시 기다려 주세요.
      </div>
    );
  }
  if (!meta.failed && meta.finalVerificationStatus !== 'failed') {
    return (
      <p className="mb-4 text-[13px] font-semibold text-[#5A6B73]" role="status">
        {meta.busy ? '집계 확인 중…' : lastSuccess ? `마지막 집계 확인 ${lastSuccess}` : '첫 집계를 확인 중입니다.'}
      </p>
    );
  }
  return (
    <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border-2 border-[#DC2626] bg-[#FEF2F2] px-4 py-3" role="alert">
      <p className="min-w-[220px] flex-1 text-[15px] font-extrabold leading-relaxed text-[#B91C1C]">
        {final ? '마감 후 최종 집계를 검증하지 못했습니다.' : '집계 연결이 끊겼습니다.'}{' '}
        {lastSuccess ? `${lastSuccess}에 확인한 마지막 값이며, 확정 결과로 사용하면 안 됩니다.` : '아직 서버에서 확인된 집계가 없습니다.'}
      </p>
      <button
        type="button"
        onClick={onRetry}
        disabled={meta.busy}
        className="min-h-11 rounded-xl border-2 border-[#B91C1C] bg-white px-4 text-[14px] font-extrabold text-[#B91C1C] disabled:opacity-50"
      >
        {meta.busy ? '다시 확인 중…' : '집계 다시 확인'}
      </button>
    </div>
  );
}

// ============================================================
// State 03 — 투표 진행 (QR + 실시간 집계)
// ============================================================

function PollingScreen({
  teamName,
  tableNo,
  access,
  capacity,
  round,
  votes,
  onClose,
  closing,
  restoreNotice,
  voteRefreshMeta,
  onRetryVotes,
  onExit,
}: {
  teamName: string;
  tableNo?: string | null;
  access: WorkshopAuthorization | null;
  capacity: number;
  round: Round;
  votes: Vote[];
  onClose: () => void;
  closing: boolean;
  restoreNotice?: boolean;
  voteRefreshMeta: VoteRefreshMeta;
  onRetryVotes: () => void;
  onExit?: () => void;
}) {
  const [qr, setQr] = useState<string | null>(null);
  const [eligibleCount, setEligibleCount] = useState<number | null>(null);
  const eligibleRefreshCoordinator = useRef(createResourceRequestCoordinator());
  // 마감 확인 다이얼로그 — 열린 시점의 수치를 스냅샷해 5초 폴링에 숫자가 흔들리지 않게 한다.
  const [confirmClose, setConfirmClose] = useState<{ voted: number; base: number } | null>(null);
  const closeDialogRef = useModalDialog<HTMLDivElement>(
    confirmClose !== null,
    () => setConfirmClose(null),
  );
  const participantUrl = `${typeof window !== 'undefined' ? window.location.origin : ''}/v?r=${round.id}`;
  const participantUrlDisplay = participantUrl.replace(/^https?:\/\//, '');

  useEffect(() => {
    QRCode.toDataURL(participantUrl, { width: 480, margin: 1 })
      .then(setQr)
      .catch((error: unknown) => {
        console.error('[moderator poll] QR generation failed', error);
        setQr(null);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [round.id]);

  useEffect(() => {
    if (!access) {
      console.error('[attendance] eligible count unavailable without workshop authorization');
      setEligibleCount(null);
      return;
    }
    let cancelled = false;
    const coordinator = eligibleRefreshCoordinator.current;
    const refreshEligible = async (priority: ResourceRequestPriority) => {
      const ticket = coordinator.begin(`eligible:${round.id}`, priority);
      if (!ticket) return;
      try {
        const count = await fetchRoundEligibleCount(access.accessToken, round.id);
        if (!cancelled && coordinator.isCurrent(ticket)) setEligibleCount(count);
      } catch (error: unknown) {
        if (coordinator.isCurrent(ticket)) {
          console.error('[attendance] eligible count refresh failed', error);
        }
      } finally {
        coordinator.finish(ticket);
      }
    };
    void refreshEligible('background');
    const interval = setInterval(() => void refreshEligible('background'), 5000);
    return () => {
      cancelled = true;
      clearInterval(interval);
      coordinator.invalidate();
    };
  }, [access, round.id]);

  const tally = tallyVotes(round, votes);
  const options = round.options ?? [];
  const voterBase = participationBase(eligibleCount, capacity);

  return (
    <div className="min-h-screen bg-[#F5F8FB]">
      <TopBar right={<TeamBadge name={teamName} tableNo={tableNo} />} live onExit={onExit} />

      <div className="max-w-6xl mx-auto p-6 sm:p-8">
        {restoreNotice ? (
          <div className="mb-4 flex items-center gap-2 rounded-xl border border-[#C4D8E4] bg-[#F1F7FA] px-4 py-2.5 text-[14px] font-semibold text-[#135C73]">
            <span aria-hidden="true">↻</span> 진행 중인 투표를 불러왔습니다.
          </div>
        ) : null}
        <VoteRefreshNotice meta={voteRefreshMeta} final={false} onRetry={onRetryVotes} />
        <div className="mb-6">
          <Eyebrow className="text-[#5A6B73] mb-1.5">질문</Eyebrow>
          <h2 className="text-[26px] font-extrabold text-[#1F4E79] leading-snug" style={{ letterSpacing: '-.022em' }}>
            {round.title}
          </h2>
        </div>

        <div className="grid lg:grid-cols-2 gap-8">
          {/* 좌: QR */}
          <div className="flex flex-col items-center text-center">
            <div className="w-full max-w-[380px] aspect-square rounded-3xl border border-[#DCE7EE] bg-white p-6 grid place-items-center shadow-sm">
              {qr ? (
                <img src={qr} alt="참가용 QR 코드" className="w-full h-full object-contain" />
              ) : (
                <div className="w-full h-full bg-[#F1F7FA] rounded-xl animate-pulse" />
              )}
            </div>
            <div className="mt-5 flex items-center gap-2 text-[#1F4E79] text-[20px] font-bold">
              <span aria-hidden="true">📷</span> 휴대폰 카메라로 스캔하세요
            </div>
            <p className="text-[#5A6B73] text-[15px] mt-1">카메라를 QR에 비추면 투표 화면이 열립니다.</p>

            <div className="mt-6 pt-5 border-t border-[#DCE7EE] w-full max-w-[380px]">
              <Eyebrow className="text-[#5A6B73] mb-2">QR이 안 되면</Eyebrow>
              <p
                className="font-mono text-[20px] font-bold text-[#1F4E79] break-all select-all"
                style={{ letterSpacing: '-.01em' }}
              >
                {participantUrlDisplay}
              </p>
            </div>
          </div>

          {/* 우: 집계 */}
          <div className="flex flex-col">
            <div className="flex items-end justify-between mb-4">
              <div>
                <Eyebrow className="text-[#5A6B73] mb-1.5">참여 현황</Eyebrow>
                <div className="text-[46px] font-extrabold text-[#1F4E79] leading-none tr-num">
                  {tally.total}
                  <span className="text-[#5A6B73] text-[26px] font-bold"> / {voterBase}명</span>
                </div>
              </div>
              <div className="text-right">
                <Eyebrow className="text-[#5A6B73] mb-1.5">진행률</Eyebrow>
                <div className="text-[28px] font-extrabold text-[#135C73] leading-none tr-num">
                  {voterBase > 0 ? Math.min(100, Math.round((tally.total / voterBase) * 100)) : 0}%
                </div>
              </div>
            </div>

            <div className="space-y-4 flex-1">
              {options.map((opt, i) => {
                const count = tally.byOption[opt] ?? 0;
                const pct = tally.total > 0 ? Math.round((count / tally.total) * 100) : 0;
                return (
                  <div key={opt}>
                    <div className="flex justify-between items-baseline mb-1.5">
                      <span className="text-[18px] font-bold text-[#1F2933]">{opt}</span>
                      <span className="text-[18px] font-extrabold text-[#1F4E79] tr-num">
                        {count}표 <span className="text-[#5A6B73] text-[15px] font-semibold">{pct}%</span>
                      </span>
                    </div>
                    <div className="h-10 rounded-lg bg-[#F1F7FA] overflow-hidden">
                      <div
                        className="h-full rounded-lg transition-all"
                        style={{ width: `${pct}%`, background: OPTION_COLORS[i % OPTION_COLORS.length] }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="mt-7 space-y-3">
              <button
                type="button"
                onClick={() => setConfirmClose({ voted: tally.total, base: voterBase })}
                disabled={closing}
                className="w-full h-16 rounded-2xl bg-[#DC2626] text-white text-[22px] font-bold shadow-sm active:scale-[.99] transition flex items-center justify-center gap-2 disabled:opacity-50"
              >
                <span aria-hidden="true">⛔</span> {closing ? '마감 중…' : '투표 마감'}
              </button>
              {access ? <ProxyVoteControl access={access} round={round} /> : null}
            </div>
          </div>
        </div>
      </div>

      {confirmClose ? (
        <div className="fixed inset-0 z-40 bg-[#1F4E79]/55 backdrop-blur-[1px] flex items-center justify-center p-5">
          <div
            ref={closeDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="mod-close-poll-title"
            tabIndex={-1}
            className="w-full max-w-md bg-white rounded-2xl border border-[#DCE7EE] overflow-hidden"
          >
            <div className="px-6 pt-6 pb-5 text-center">
              <div className="w-14 h-14 mx-auto rounded-2xl bg-[#DC2626]/12 border border-[#DC2626]/40 grid place-items-center text-3xl mb-4" aria-hidden="true">
                ⛔
              </div>
              <Eyebrow className="text-[#B91C1C] mb-2">Confirm</Eyebrow>
              <h4 id="mod-close-poll-title" className="text-[22px] font-extrabold text-[#1F4E79] leading-snug mb-3" style={{ letterSpacing: '-.01em' }}>
                투표를 마감할까요?
              </h4>
              <p className="text-[19px] font-bold text-[#1F2933] leading-relaxed tr-num">
                {closeConfirmMessage(confirmClose.voted, confirmClose.base)}
              </p>
              <p className="text-[15px] text-[#5A6B73] mt-3">
                마감 후 60초 동안은 결과 화면에서 <b className="text-[#1F4E79]">다시 열기</b>로 되돌릴 수 있습니다.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3 p-5 pt-0">
              <button
                type="button"
                data-dialog-initial-focus
                onClick={() => setConfirmClose(null)}
                className="h-[56px] rounded-2xl border border-[#C4D8E4] bg-white text-[#1F4E79] text-[19px] font-bold"
              >
                더 기다리기
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfirmClose(null);
                  onClose();
                }}
                disabled={closing}
                className="h-[56px] rounded-2xl bg-[#DC2626] text-white text-[19px] font-bold shadow-sm disabled:opacity-50"
              >
                마감하기
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ============================================================
// 대리 입력 — 보기+매수 선택 → 확인 다이얼로그 → proxyVote
// ============================================================

function ProxyVoteControl({ access, round }: { access: WorkshopAuthorization; round: Round }) {
  const [step, setStep] = useState<'closed' | 'pick' | 'confirm'>('closed');
  const [choice, setChoice] = useState<string>(round.options?.[0] ?? '');
  const [checkboxChoices, setCheckboxChoices] = useState<string[]>([]);
  const [n, setN] = useState(1);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const requestIdRef = useRef<string | null>(null);
  const pickDialogRef = useModalDialog<HTMLDivElement>(step === 'pick', () => setStep('closed'));
  const confirmDialogRef = useModalDialog<HTMLDivElement>(step === 'confirm', () => {
    if (!busy) setStep('pick');
  });

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  const openPicker = () => {
    requestIdRef.current = null;
    setChoice(round.options?.[0] ?? '');
    setCheckboxChoices([]);
    setN(1);
    setStep('pick');
  };

  const selectSingleChoice = (nextChoice: string) => {
    if (nextChoice === choice) return;
    requestIdRef.current = null;
    setChoice(nextChoice);
  };

  const toggleCheckboxChoice = (option: string) => {
    requestIdRef.current = null;
    setCheckboxChoices((current) => toggleProxyVoteChoice(current, option));
  };

  const changeVoteCount = (delta: number) => {
    const nextCount = Math.min(5, Math.max(1, n + delta));
    if (nextCount === n) return;
    requestIdRef.current = null;
    setN(nextCount);
  };

  const confirmProxy = async () => {
    const requestId = requestIdRef.current ?? crypto.randomUUID();
    requestIdRef.current = requestId;
    const payload = proxyVotePayload(round.type, choice, checkboxChoices);
    setBusy(true);
    try {
      await proxyVote(access, round.id, payload, n, requestId);
      requestIdRef.current = null;
      setToast(round.type === 'CHECKBOX' ? `대리 ${n}명분 입력됨` : `대리 ${n}표 입력됨`);
      setStep('closed');
    } catch (error) {
      console.error('Proxy vote failed', error);
      setToast('대리 입력 실패 — 같은 요청으로 다시 시도해 주세요');
    } finally {
      setBusy(false);
    }
  };

  const options = round.options ?? [];
  const hasChoice = round.type === 'CHECKBOX' ? checkboxChoices.length > 0 : Boolean(choice);
  const choiceSummary = round.type === 'CHECKBOX' ? checkboxChoices.join(', ') : choice;

  return (
    <>
      <button
        type="button"
        onClick={openPicker}
        className="w-full h-[52px] rounded-2xl border border-[#C4D8E4] bg-white text-[#1F4E79] text-[18px] font-bold"
      >
        대리 입력
      </button>
      <p className="text-[14px] text-[#5A6B73] text-center">
        대리 입력: 휴대폰이 없는 참가자의 표를 진행자가 대신 넣습니다.
      </p>

      {toast ? (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-[#1F4E79] text-white text-[16px] font-bold rounded-full px-5 py-3 shadow-lg">
          {toast}
        </div>
      ) : null}

      {step === 'pick' ? (
        <div className="fixed inset-0 z-40 bg-[#1F4E79]/55 backdrop-blur-[1px] flex items-center justify-center p-5">
          <div
            ref={pickDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="mod-proxy-pick-title"
            tabIndex={-1}
            className="w-full max-w-md bg-white rounded-2xl border border-[#DCE7EE] overflow-hidden"
          >
            <div className="px-6 pt-6 pb-5">
              <Eyebrow className="text-[#5A6B73] mb-2">대리 입력</Eyebrow>
              <h4 id="mod-proxy-pick-title" className="text-[22px] font-extrabold text-[#1F4E79] leading-snug mb-4" style={{ letterSpacing: '-.01em' }}>
                누구에게 몇 표를 넣을까요?
              </h4>

              <Eyebrow className="text-[#5A6B73] mb-2">보기</Eyebrow>
              {round.type === 'CHECKBOX' ? (
                <fieldset className="grid grid-cols-1 gap-2 mb-5" aria-describedby="mod-proxy-checkbox-help">
                  <legend className="sr-only">대리 투표 보기 복수 선택</legend>
                  <p id="mod-proxy-checkbox-help" className="mb-1 text-[14px] font-semibold text-[#5A6B73]">
                    복수 선택 투표입니다. 참가자가 고른 보기를 모두 체크하세요.
                  </p>
                  {options.map((opt) => (
                    <label
                      key={opt}
                      className={`flex min-h-14 cursor-pointer items-center gap-3 rounded-xl border px-4 text-[18px] font-bold ${
                        checkboxChoices.includes(opt)
                          ? 'border-[#23B2C3] bg-[#23B2C3]/8 text-[#1F4E79]'
                          : 'border-[#C4D8E4] text-[#1F2933]'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checkboxChoices.includes(opt)}
                        onChange={() => toggleCheckboxChoice(opt)}
                        className="h-5 w-5 shrink-0 accent-[#135C73]"
                      />
                      <span>{opt}</span>
                    </label>
                  ))}
                </fieldset>
              ) : (
                <div className="grid grid-cols-1 gap-2 mb-5">
                  {options.map((opt) => (
                    <button
                      key={opt}
                      type="button"
                      aria-pressed={choice === opt}
                      onClick={() => selectSingleChoice(opt)}
                      className={`h-14 rounded-xl border text-[18px] font-bold px-4 text-left ${
                        choice === opt ? 'border-[#23B2C3] bg-[#23B2C3]/8 text-[#1F4E79]' : 'border-[#C4D8E4] text-[#1F2933]'
                      }`}
                    >
                      {opt}
                    </button>
                  ))}
                </div>
              )}

              <Eyebrow className="text-[#5A6B73] mb-2">매수 (1~5)</Eyebrow>
              <div className="flex items-center gap-3 mb-1">
                <div className="flex items-center rounded-xl border border-[#C4D8E4] overflow-hidden">
                  <button
                    type="button"
                    aria-label="매수 감소"
                    onClick={() => changeVoteCount(-1)}
                    className="w-14 h-16 text-3xl text-[#5A6B73] bg-[#F1F7FA]"
                  >
                    −
                  </button>
                  <div className="w-24 h-16 grid place-items-center text-[30px] font-extrabold text-[#1F4E79] tr-num">{n}</div>
                  <button
                    type="button"
                    aria-label="매수 증가"
                    onClick={() => changeVoteCount(1)}
                    className="w-14 h-16 text-3xl text-[#5A6B73] bg-[#F1F7FA]"
                  >
                    ＋
                  </button>
                </div>
                <span className="text-[18px] text-[#5A6B73] font-semibold">표</span>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 p-5 pt-2">
              <button
                type="button"
                data-dialog-initial-focus
                onClick={() => setStep('closed')}
                className="h-14 rounded-2xl border border-[#C4D8E4] bg-white text-[#1F4E79] text-[19px] font-bold"
              >
                취소
              </button>
              <button
                type="button"
                disabled={!hasChoice}
                onClick={() => setStep('confirm')}
                className="h-14 rounded-2xl bg-[#1F4E79] text-white text-[19px] font-bold disabled:opacity-40"
              >
                다음
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {step === 'confirm' ? (
        <div className="fixed inset-0 z-40 bg-[#1F4E79]/55 backdrop-blur-[1px] flex items-center justify-center p-5">
          <div
            ref={confirmDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="mod-proxy-confirm-title"
            tabIndex={-1}
            className="w-full max-w-md bg-white rounded-2xl border border-[#DCE7EE] overflow-hidden"
          >
            <div className="px-6 pt-6 pb-5 text-center">
              <div className="w-14 h-14 mx-auto rounded-2xl bg-[#F5A623]/15 border border-[#F5A623]/40 grid place-items-center text-3xl mb-4" aria-hidden="true">
                🗳️
              </div>
              <Eyebrow className="text-[#B5651D] mb-2">Confirm</Eyebrow>
              <h4 id="mod-proxy-confirm-title" className="text-[22px] font-extrabold text-[#1F4E79] leading-snug mb-3" style={{ letterSpacing: '-.01em' }}>
                대리 입력을 진행할까요?
              </h4>
              <p className="text-[17px] text-[#1F2933] leading-relaxed">
                {round.type === 'CHECKBOX' ? (
                  <>
                    무기명 복수 선택 투표에서 <b className="text-[#1F4E79]">{choiceSummary}</b>을(를)
                    <b className="text-[#1F4E79] tr-num"> {n}명분</b> 대리 입력합니다.
                  </>
                ) : (
                  <>
                    무기명 투표에 <b className="text-[#1F4E79]">{choiceSummary}</b>
                    <b className="text-[#1F4E79] tr-num"> {n}표</b>를 대리 입력합니다.
                  </>
                )}
              </p>
              <p className="text-[14px] text-[#5A6B73] mt-3">확정 후에는 되돌릴 수 없습니다. 참가자 수를 다시 확인하세요.</p>
            </div>
            <div className="grid grid-cols-2 gap-3 p-5 pt-0">
              <button
                type="button"
                data-dialog-initial-focus
                onClick={() => {
                  requestIdRef.current = null;
                  setStep('closed');
                }}
                disabled={busy}
                className="h-[56px] rounded-2xl border border-[#C4D8E4] bg-white text-[#1F4E79] text-[19px] font-bold disabled:opacity-50"
              >
                취소
              </button>
              <button
                type="button"
                onClick={confirmProxy}
                disabled={busy}
                className="h-[56px] rounded-2xl bg-[#1F4E79] text-white text-[19px] font-bold shadow-sm disabled:opacity-50"
              >
                {busy ? '입력 중…' : '확인'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

// ============================================================
// State 03-b — 마감 후 결과 확정 (풀스크린 진입점 포함)
// ============================================================

function ResultsScreen({
  teamName,
  tableNo,
  sequence,
  round,
  votes,
  onNewPoll,
  onEnterFullscreen,
  onReopen,
  closedAt,
  reopening,
  voteRefreshMeta,
  onRetryVotes,
  onExit,
}: {
  teamName: string;
  tableNo?: string | null;
  /** 이 조에서 몇 번째 투표인가. 조회 전이거나 실패하면 0이고, 그때는 회차 없이 저장한다. */
  sequence: number;
  round: Round;
  votes: Vote[];
  onNewPoll: () => void;
  onEnterFullscreen: () => void;
  onReopen: () => void;
  closedAt: number | null;
  reopening: boolean;
  voteRefreshMeta: VoteRefreshMeta;
  onRetryVotes: () => void;
  onExit?: () => void;
}) {
  const tally = tallyVotes(round, votes);
  const finalSnapshotVerified = canUseFinalVoteSnapshot(voteRefreshMeta);
  const ranked = (round.options ?? [])
    .map((opt) => ({ opt, count: tally.byOption[opt] ?? 0 }))
    .sort((a, b) => b.count - a.count);

  // 그림은 화면과 **같은 목록**을 그대로 쓴다 — 따로 만들면 저장본과 화면이 어긋난다.
  const imageInput: ResultImageInput = {
    teamName,
    sequence,
    title: round.title,
    closedAtLabel: round.updated_at ? formatClock(round.updated_at) : null,
    total: tally.total,
    results: ranked.map(({ opt, count }) => ({ option: opt, count })),
  };

  // 되돌리기 창(60초)을 1초마다 다시 판정한다 — 틱이 없으면 버튼이 제때 사라지지 않는다.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (closedAt == null) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [closedAt]);
  const showReopen = canReopen(closedAt, now);
  const reopenSecondsLeft =
    closedAt == null ? 0 : Math.max(0, Math.ceil((closedAt + REOPEN_WINDOW_MS - now) / 1000));

  return (
    <div className="min-h-screen bg-[#F5F8FB]">
      <TopBar right={<TeamBadge name={teamName} tableNo={tableNo} />} onExit={onExit} />

      <div className="max-w-2xl mx-auto p-6 sm:p-8">
        <VoteRefreshNotice meta={voteRefreshMeta} final onRetry={onRetryVotes} />
        <div className="bg-white rounded-3xl border border-[#DCE7EE] overflow-hidden shadow-sm">
          <div className="px-6 py-4 border-b border-[#DCE7EE] bg-[#1F4E79] text-white flex items-center justify-between">
            <span className="flex items-center gap-2 text-[16px] font-bold">
              <span aria-hidden="true">✔</span>{' '}
              {voteRefreshMeta.finalVerificationStatus === 'verified'
                ? '투표 마감됨 · 결과 확정'
                : voteRefreshMeta.finalVerificationStatus === 'failed'
                  ? '투표 마감됨 · 집계 확인 필요'
                  : '투표 마감됨 · 최종 집계 확인 중'}
            </span>
            <span className="text-[15px] font-semibold bg-white/15 rounded-full px-3 py-1 tr-num">
              총 {tally.total}표
            </span>
          </div>
          <div className="p-6 space-y-3">
            {ranked.map(({ opt, count }, i) => {
              const pct = tally.total > 0 ? Math.round((count / tally.total) * 100) : 0;
              return (
                <div
                  key={opt}
                  className={`flex items-center gap-3 rounded-xl border p-3 ${
                    i === 0 ? 'border-[#23B2C3] bg-[#23B2C3]/6' : 'border-[#DCE7EE]'
                  }`}
                >
                  <span
                    className={`w-9 h-9 rounded-lg grid place-items-center font-bold ${
                      i === 0 ? 'bg-[#135C73] text-white' : 'bg-[#F1F7FA] text-[#1F4E79]'
                    }`}
                  >
                    {i + 1}위
                  </span>
                  <span className={`flex-1 ${i === 0 ? 'text-[19px] font-extrabold text-[#1F4E79]' : 'text-[18px] font-bold text-[#1F2933]'}`}>
                    {opt}
                  </span>
                  <span className={`tr-num ${i === 0 ? 'text-[19px] font-extrabold text-[#1F4E79]' : 'text-[18px] font-bold text-[#1F2933]'}`}>
                    {count}표 · {pct}%
                  </span>
                </div>
              );
            })}

            <button
              type="button"
              onClick={onEnterFullscreen}
              disabled={!finalSnapshotVerified}
              className="w-full h-16 mt-2 rounded-2xl bg-[#135C73] text-white text-[20px] font-bold shadow-sm flex items-center justify-center gap-2 disabled:opacity-40"
            >
              <span aria-hidden="true">🖥️</span> 결과 크게 보기
            </button>
            <p className="text-[13px] text-[#5A6B73] text-center">대형 스크린(빔프로젝터)으로 결과를 송출합니다.</p>

            {showReopen ? (
              <>
                <button
                  type="button"
                  onClick={onReopen}
                  disabled={reopening}
                  className="w-full h-16 rounded-2xl border-2 border-[#F5A623] bg-[#F5A623]/10 text-[#B5651D] text-[20px] font-bold flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  <span aria-hidden="true">↩</span>{' '}
                  {reopening ? '다시 여는 중…' : `다시 열기 (${reopenSecondsLeft}초)`}
                </button>
                <p className="text-[14px] text-[#5A6B73] text-center">
                  실수로 마감했다면 지금 되돌릴 수 있습니다. 표는 그대로 유지됩니다.
                </p>
              </>
            ) : null}

            {/* '다시 열기'(60초) 아래에 둔다 — 되돌리기가 시간에 쫓기는 버튼이라 위로 밀지 않는다. */}
            {finalSnapshotVerified ? (
              <SaveResultImageButton
                input={imageInput}
                className="w-full h-16 rounded-2xl border-2 border-[#1F4E79] bg-white text-[#1F4E79] text-[20px] font-bold flex items-center justify-center gap-2"
              />
            ) : (
              <p className="rounded-xl border border-[#DC2626]/30 bg-[#FEF2F2] px-4 py-3 text-center text-[14px] font-bold text-[#B91C1C]">
                최종 집계 재확인 전에는 결과 이미지를 저장할 수 없습니다.
              </p>
            )}

            {/*
              '다시 열기' 요청이 날아가 있는 동안은 잠근다. 그 사이 '새 투표'를 누르면
              화면은 홈으로 가는데 서버 라운드는 active로 되살아나, 다음 투표를 열 때
              옛 질문이 함께 살아 있는 상태가 된다(리듀서 가드가 REOPEN을 버려도 DB는 이미 바뀜).
            */}
            <button
              type="button"
              onClick={onNewPoll}
              disabled={reopening}
              className="w-full h-[52px] rounded-2xl border border-[#C4D8E4] bg-white text-[#1F4E79] text-[18px] font-bold disabled:opacity-50"
            >
              {reopening ? '다시 여는 중…' : '새 투표'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// State 05 — 풀스크린 결과 송출 (대형 스크린)
// ============================================================

function FullscreenResults({
  teamName,
  round,
  votes,
  onExit,
}: {
  teamName: string;
  round: Round;
  votes: Vote[];
  onExit: () => void;
}) {
  const tally = tallyVotes(round, votes);
  const ranked = (round.options ?? [])
    .map((opt) => ({ opt, count: tally.byOption[opt] ?? 0 }))
    .sort((a, b) => b.count - a.count);
  const rankLabel = ['1위', '2위', '3위', '4위', '5위', '6위'];
  const rankColor = ['#135C73', '#2E75B6', '#5A6B73', '#5A6B73', '#5A6B73', '#5A6B73'];
  const barColor = ['#135C73', '#2E75B6', '#4F9D3A', '#F5A623', '#23B2C3', '#1F4E79'];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onExit();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onExit]);

  return (
    <div className="fixed inset-0 z-50 bg-white flex flex-col px-6 sm:px-14 py-8 sm:py-10">
      <div className="flex items-center justify-between mb-6">
        <div>
          <Eyebrow className="text-[#135C73] mb-2">최종 결과 · 총 {tally.total}표</Eyebrow>
          <h1
            className="text-[clamp(30px,3.6vw,52px)] font-extrabold text-[#1F4E79] leading-tight"
            style={{ letterSpacing: '-.022em' }}
          >
            {round.title}
          </h1>
        </div>
        <div className="hidden sm:flex items-center gap-2 bg-[#1F4E79] text-white rounded-full px-5 py-2.5 text-[22px] font-bold shrink-0" style={{ letterSpacing: '-.01em' }}>
          {teamName}
        </div>
        <button
          type="button"
          onClick={onExit}
          aria-label="풀스크린 결과 나가기"
          className="fixed top-4 right-4 sm:static ml-0 sm:ml-4 z-10 rounded-full border border-[#C4D8E4] bg-white/90 px-4 py-2 text-[15px] font-bold text-[#5A6B73] shadow-sm"
        >
          나가기 (ESC)
        </button>
      </div>

      <div className="flex-1 flex flex-col justify-center gap-[3.2%]">
        {ranked.map(({ opt, count }, i) => {
          const pct = tally.total > 0 ? Math.round((count / tally.total) * 100) : 0;
          return (
            <div key={opt}>
              <div className="flex items-baseline justify-between mb-1.5">
                <div className="flex items-baseline gap-3">
                  <span className="text-[clamp(20px,2vw,30px)] font-extrabold tr-num" style={{ color: rankColor[i] ?? '#5A6B73' }}>
                    {rankLabel[i] ?? `${i + 1}위`}
                  </span>
                  <span className="text-[clamp(24px,2.6vw,40px)] font-extrabold text-[#1F4E79]">{opt}</span>
                </div>
                <div className="flex items-baseline gap-3">
                  <span className="text-[clamp(48px,7vw,110px)] font-extrabold text-[#1F4E79] leading-none tr-num">
                    {pct}
                    <span className="text-[0.5em]">%</span>
                  </span>
                  <span className="text-[clamp(20px,2vw,30px)] font-bold text-[#5A6B73] tr-num w-[3.2em] text-right">{count}표</span>
                </div>
              </div>
              <div className="h-[clamp(28px,4.2vh,60px)] rounded-xl bg-[#F1F7FA] overflow-hidden border border-[#DCE7EE]">
                <div
                  className="h-full rounded-xl transition-all"
                  style={{ width: `${pct}%`, background: barColor[i % barColor.length] }}
                />
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex items-center justify-between mt-6 pt-5 border-t border-[#DCE7EE]">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-[#135C73] grid place-items-center text-white font-bold text-lg">M</div>
          <span className="text-[clamp(16px,1.6vw,22px)] font-bold text-[#1F4E79]">기후시민회의 · {teamName}</span>
        </div>
        <Eyebrow className="text-[#5A6B73]">climate-assembly.org</Eyebrow>
      </div>
    </div>
  );
}

// ============================================================
// Root
// ============================================================

export default function ModConsole() {
  const [state, dispatch] = useReducer(modReducer, initialModState);
  const [joinBusy, setJoinBusy] = useState(false);
  const [restoringSession, setRestoringSession] = useState(true);
  const [restoreAttempt, setRestoreAttempt] = useState(0);
  const [storedResumeRetryAvailable, setStoredResumeRetryAvailable] = useState(false);
  const [workshopSession, setWorkshopSession] = useState<WorkshopSession | null>(null);
  const [creating, setCreating] = useState(false);
  const [closing, setClosing] = useState(false);
  const [reopening, setReopening] = useState(false);
  const [closedAt, setClosedAt] = useState<number | null>(null);
  const [votes, setVotes] = useState<Vote[]>([]);
  const [voteRefreshMeta, setVoteRefreshMeta] = useState<VoteRefreshMeta>(EMPTY_VOTE_REFRESH_META);
  const voteRefreshCoordinatorRef = useRef(createResourceRequestCoordinator());
  const [fullscreen, setFullscreen] = useState(false);
  const [restoreNotice, setRestoreNotice] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [nonPersistentMode, setNonPersistentMode] = useState(
    () => !workshopLocalStorage.isPersistent(),
  );
  const [legacyDraftConflicts, setLegacyDraftConflicts] = useState(0);
  const [legacyDraftRecoveries, setLegacyDraftRecoveries] = useState<LegacyDraftRecoveryRecord[]>([]);
  const [legacyStorageCleanupFailed, setLegacyStorageCleanupFailed] = useState(false);
  const [exitConfirmOpen, setExitConfirmOpen] = useState(false);
  const [exitBusy, setExitBusy] = useState(false);
  const [exitError, setExitError] = useState<string | null>(null);
  const exitLockRef = useRef(false);
  const exitDialogRef = useModalDialog<HTMLDivElement>(
    exitConfirmOpen,
    () => { if (!exitLockRef.current) setExitConfirmOpen(false); },
  );
  const createPollIntentRef = useRef<{ fingerprint: string; requestId: string } | null>(null);
  const roundStatusIntentRef = useRef<RoundStatusIntent | null>(null);
  // 회차는 **라운드 id와 함께** 들고 있는다. 숫자만 두면 다음 라운드의 조회가 실패했을 때
  // 앞 라운드의 회차가 그대로 남아 2차 결과가 '1차'로 저장된다(조용히 틀린 기록물이 된다).
  const [resultsSequence, setResultsSequence] = useState<{ roundId: string; sequence: number } | null>(null);
  const authorization = useMemo<WorkshopAuthorization | null>(
    () => (workshopSession ? { accessToken: workshopSession.accessToken } : null),
    [workshopSession?.accessToken],
  );
  const authorizationRef = useRef<WorkshopAuthorization | null>(authorization);
  authorizationRef.current = authorization;

  const refreshVoteSnapshot = useCallback(async (
    roundId: string,
    priority: ResourceRequestPriority,
  ): Promise<boolean> => {
    const access = authorizationRef.current;
    if (!access) return false;
    const coordinator = voteRefreshCoordinatorRef.current;
    const ticket = coordinator.begin(`round:${roundId}`, priority);
    if (!ticket) return false;
    const finalVerification = priority === 'final';
    setVoteRefreshMeta((current) => beginVoteRefresh(current, priority));
    try {
      const nextVotes = await fetchTeamVotes(access, roundId);
      if (!coordinator.isCurrent(ticket)) return false;
      setVotes(nextVotes);
      setVoteRefreshMeta((current) => completeVoteRefresh(current, priority, Date.now()));
      return true;
    } catch (error: unknown) {
      console.error(
        finalVerification
          ? '[moderator results] final vote verification failed'
          : '[moderator poll] live vote refresh failed',
        error,
      );
      if (coordinator.isCurrent(ticket)) {
        setVoteRefreshMeta((current) => failVoteRefresh(current, priority));
      }
      return false;
    } finally {
      coordinator.finish(ticket);
    }
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  // 딥링크 코드는 한 번만 기기 세션으로 교환한다. URL에서는 요청을
  // 보내기 전에 즉시 제거하고, 새로고침은 저장된 불투명 토큰을 재검증해 복원한다.
  useEffect(() => {
    let cancelled = false;
    const fromAddress = takeJoinCodeFromAddress();

    const restore = async () => {
      try {
        let session: WorkshopSession | null = null;
        let migrationConflicts = 0;
        let migrationCleanupFailed = false;
        if (fromAddress.present) {
          setStoredResumeRetryAvailable(false);
          if (!fromAddress.code || !isValidJoinCode(fromAddress.code)) {
            clearWorkshopSession(workshopLocalStorage);
            setWorkshopSession(null);
            dispatch({
              type: 'JOIN_FAILURE',
              message: '링크의 접속코드 형식이 올바르지 않습니다. 6자리 조 코드를 입력해 주세요.',
            });
            return;
          }
          const deviceId = getOrCreateWorkshopDeviceId(workshopLocalStorage);
          session = await exchangeWorkshopCode(fromAddress.code, deviceId, deviceLabel(navigator.userAgent));
          const localMigration = migrateLegacyWorkshopStorage(
            workshopLocalStorage,
            fromAddress.code,
            session.team.id,
          );
          const sessionMigration = migrateLegacyWorkshopStorage(
            workshopSessionStorage,
            fromAddress.code,
            session.team.id,
          );
          migrationConflicts = localMigration.attentionCount + sessionMigration.attentionCount;
          migrationCleanupFailed = localMigration.cleanupFailed || sessionMigration.cleanupFailed;
        } else {
          const stored = readWorkshopSession(workshopLocalStorage);
          if (!stored) {
            setStoredResumeRetryAvailable(false);
            return;
          }
          session = await resumeWorkshopSession(stored.accessToken);
        }
        if (cancelled || !session) return;
        setStoredResumeRetryAvailable(false);
        const recoveries = legacyRecoveriesForTeam(session.team.id);
        setLegacyDraftRecoveries(recoveries);
        setLegacyDraftConflicts(Math.max(migrationConflicts, recoveries.length));
        setLegacyStorageCleanupFailed(migrationCleanupFailed);
        storeWorkshopSession(workshopLocalStorage, session);
        setNonPersistentMode(!workshopLocalStorage.isPersistent());
        setWorkshopSession(session);
        const team = workshopTeamToTeam(session.team);
        const round = await fetchActiveRound({ accessToken: session.accessToken }).catch((error: unknown) => {
          console.warn('[workshop access] active round restore failed', error);
          return null;
        });
        if (cancelled) return;
        if (round) {
          voteRefreshCoordinatorRef.current.invalidate();
          setVotes([]);
          setVoteRefreshMeta(EMPTY_VOTE_REFRESH_META);
        }
        dispatch({ type: 'RESTORE_TEAM', team, round });
      } catch (error: unknown) {
        const failureKind = fromAddress.present
          ? 'definitive'
          : classifyStoredSessionResumeError(error);
        console.error(
          fromAddress.present
            ? '[workshop access] deep-link code exchange failed'
            : '[workshop access] stored session resume failed',
          { failureKind },
          error,
        );
        if (!cancelled) {
          setNonPersistentMode(!workshopLocalStorage.isPersistent());
          setWorkshopSession(null);
          if (fromAddress.present || failureKind === 'definitive') {
            clearWorkshopSession(workshopLocalStorage);
            setStoredResumeRetryAvailable(false);
            dispatch({
              type: 'JOIN_FAILURE',
              message: fromAddress.present
                ? '접속코드를 확인하거나 다른 기기의 접속을 종료한 뒤 다시 시도해 주세요.'
                : '저장된 조 연결이 만료되었거나 종료되었습니다. 조 코드로 다시 입장해 주세요.',
            });
          } else {
            setStoredResumeRetryAvailable(true);
            dispatch({
              type: 'JOIN_FAILURE',
              message: '연결을 확인하지 못했습니다. 저장된 조 연결과 작성 중인 내용은 그대로 보관했습니다. 네트워크를 확인한 뒤 다시 시도해 주세요.',
            });
          }
        }
      } finally {
        if (!cancelled) setRestoringSession(false);
      }
    };
    void restore();
    return () => {
      cancelled = true;
    };
  }, [restoreAttempt]);

  const retryStoredSession = () => {
    setStoredResumeRetryAvailable(false);
    setRestoringSession(true);
    setRestoreAttempt((attempt) => attempt + 1);
  };

  // P2a closes broad anonymous Realtime reads. Token-scoped 5-second polling
  // remains the authoritative live tally path.
  useEffect(() => {
    const access = authorizationRef.current;
    if (state.screen !== 'polling' || !state.round || !access) return;
    const roundId = state.round.id;
    void refreshVoteSnapshot(roundId, 'background');
    const interval = setInterval(() => { void refreshVoteSnapshot(roundId, 'background'); }, 5000);
    return () => {
      clearInterval(interval);
    };
  }, [refreshVoteSnapshot, state.screen, state.round]);

  // results 화면에서도 최종 표를 한 번 더 가져온다(마감 직전 마지막 표 반영)
  useEffect(() => {
    const access = authorizationRef.current;
    if (state.screen !== 'results' || !state.round || !access) return;
    void refreshVoteSnapshot(state.round.id, 'final');
  }, [refreshVoteSnapshot, state.screen, state.round]);

  // 결과 화면에 들어오면 이 라운드가 이 조의 몇 차인지 도출한다(이미지 저장의 회차 표기용).
  // 실패하면 그대로 둔다 — 회차 없이 저장될 뿐, 저장 자체를 막지 않는다.
  useEffect(() => {
    const access = authorizationRef.current;
    if (state.screen !== 'results' || !state.round || !state.team || !access) return;
    const teamId = state.team.id;
    const roundId = state.round.id;
    let cancelled = false;
    fetchTeamRounds(access)
      .then((rounds) => {
        if (!cancelled) {
          setResultsSequence({ roundId, sequence: roundSequence(teamId, rounds).get(roundId) ?? 0 });
        }
      })
      .catch((error: unknown) => {
        console.warn('[moderator results] round sequence unavailable', error);
      });
    return () => {
      cancelled = true;
    };
  }, [state.screen, state.round, state.team]);

  useEffect(() => {
    const onFsChange = () => {
      if (!document.fullscreenElement) setFullscreen(false);
    };
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  const handleJoin = async (code: string) => {
    setStoredResumeRetryAvailable(false);
    setJoinBusy(true);
    try {
      const deviceId = getOrCreateWorkshopDeviceId(workshopLocalStorage);
      const session = await exchangeWorkshopCode(code, deviceId, deviceLabel(navigator.userAgent));
      const localMigration = migrateLegacyWorkshopStorage(workshopLocalStorage, code, session.team.id);
      const sessionMigration = migrateLegacyWorkshopStorage(workshopSessionStorage, code, session.team.id);
      const conflicts = localMigration.attentionCount + sessionMigration.attentionCount;
      const recoveries = legacyRecoveriesForTeam(session.team.id);
      setLegacyDraftRecoveries(recoveries);
      setLegacyDraftConflicts(Math.max(conflicts, recoveries.length));
      setLegacyStorageCleanupFailed(localMigration.cleanupFailed || sessionMigration.cleanupFailed);
      storeWorkshopSession(workshopLocalStorage, session);
      setNonPersistentMode(!workshopLocalStorage.isPersistent());
      setWorkshopSession(session);
      dispatch({ type: 'JOIN_SUCCESS', team: workshopTeamToTeam(session.team) });
    } catch (error) {
      console.error('[workshop access] code exchange failed', error);
      const message = error instanceof Error
        ? error.message
        : typeof error === 'object' && error !== null && 'message' in error
          ? String(error.message)
          : String(error);
      dispatch({
        type: 'JOIN_FAILURE',
        message: /two active devices/i.test(message)
          ? '이 조는 이미 두 대의 기기에서 접속 중입니다. 본부에 기기 해제를 요청해 주세요.'
          : /invalid|response is invalid|not found/i.test(message)
            ? '존재하지 않는 접속코드입니다. 다시 확인해 주세요.'
            : '연결에 실패했습니다 — 네트워크(와이파이)를 확인해 주세요.',
      });
    } finally {
      setJoinBusy(false);
    }
  };

  /**
   * Resolve an interrupted or rejected transition through the token-scoped read path.
   * Preserve the intent only when the server still exposes the exact expected snapshot.
   */
  const restoreRoundAfterStatusFailure = async (
    access: WorkshopAuthorization,
    roundId: string,
    intent: RoundStatusIntent,
    failure: unknown,
  ): Promise<void> => {
    const definitiveFailure = isDefinitiveRoundStatusFailure(failure);
    let latest: Round | null = null;
    try {
      const rounds = await fetchTeamRounds(access);
      latest = rounds.find((round) => round.id === roundId) ?? null;
    } catch (reloadError: unknown) {
      console.error('[moderator poll] status recovery reload failed', reloadError);
      if (authorizationRef.current?.accessToken !== access.accessToken) return;
      if (definitiveFailure) roundStatusIntentRef.current = null;
      setToast(definitiveFailure
        ? '상태 변경이 거부됐고 최신 상태도 확인하지 못했습니다. 네트워크를 확인한 뒤 다시 불러와 주세요.'
        : '응답이 끊겨 서버 상태를 확인하지 못했습니다. 다시 누르면 같은 요청으로 안전하게 확인합니다.');
      return;
    }

    if (authorizationRef.current?.accessToken !== access.accessToken) return;
    if (!latest || (latest.status !== 'active' && latest.status !== 'closed')) {
      roundStatusIntentRef.current = null;
      setToast('이 투표의 최신 상태를 확인하지 못했습니다. 조 화면을 다시 불러와 주세요.');
      return;
    }

    const recovery = roundStatusRecoveryDecision(latest, intent, definitiveFailure);
    if (recovery.clearIntent) {
      roundStatusIntentRef.current = null;
    }

    voteRefreshCoordinatorRef.current.invalidate();
    if (latest.status === 'closed') {
      setRestoreNotice(false);
      setClosedAt(roundUpdatedAtMs(latest));
      setVoteRefreshMeta((current) => beginVoteRefresh(current, 'final'));
      dispatch({ type: 'CLOSE_POLL', round: latest });
    } else if (state.team) {
      setClosedAt(null);
      setVoteRefreshMeta((current) => ({
        ...current,
        failed: false,
        finalVerificationStatus: 'not-required',
        busy: false,
      }));
      dispatch({ type: 'RESTORE_TEAM', team: state.team, round: latest });
    }

    if (recovery.reachedTarget) {
      setToast(intent.status === 'closed'
        ? '서버의 마감 상태를 확인해 결과 화면으로 복원했습니다.'
        : '서버의 진행 상태를 확인해 투표 화면으로 복원했습니다.');
    } else if (definitiveFailure) {
      setToast('다른 기기의 변경 또는 운영 시간 제한을 확인했습니다. 서버의 최신 상태로 화면을 맞췄습니다.');
    } else if (!recovery.unchangedExpectedSnapshot) {
      setToast('다른 기기에서 이 투표 상태를 바꾼 이력을 확인했습니다. 최신 상태로 화면을 맞췄습니다.');
    } else {
      setToast('서버 상태에는 아직 변경이 없습니다. 다시 누르면 같은 요청으로 안전하게 재시도합니다.');
    }
  };

  const handleCreatePoll = async (input: { title: string; type: 'RADIO' | 'CHECKBOX'; options: string[] }) => {
    const access = authorizationRef.current;
    if (!access || !state.team) return;
    const fingerprint = JSON.stringify(input);
    if (createPollIntentRef.current?.fingerprint !== fingerprint) {
      createPollIntentRef.current = { fingerprint, requestId: crypto.randomUUID() };
    }
    const requestId = createPollIntentRef.current.requestId;
    setCreating(true);
    try {
      // 방어적 이중 클릭/새로고침 경합 대비 — 이미 진행 중인 라운드가 있으면 새로 만들지 않고 복원한다.
      const active = await fetchActiveRound(access);
      if (active) {
        createPollIntentRef.current = null;
        roundStatusIntentRef.current = null;
        setRestoreNotice(true);
        voteRefreshCoordinatorRef.current.invalidate();
        setVotes([]);
        setVoteRefreshMeta(EMPTY_VOTE_REFRESH_META);
        dispatch({ type: 'RESTORE_TEAM', team: state.team, round: active });
        return;
      }
      const round = await createPoll(access, input, requestId);
      createPollIntentRef.current = null;
      roundStatusIntentRef.current = null;
      voteRefreshCoordinatorRef.current.invalidate();
      setVotes([]);
      setVoteRefreshMeta(EMPTY_VOTE_REFRESH_META);
      dispatch({ type: 'CREATE_POLL_SUCCESS', round });
    } catch (error) {
      console.error('[moderator poll] create failed', error);
      // 개설 실패 — 홈에 머무름(재시도 가능), 단 무슨 일이 일어났는지는 토스트로 알린다.
      setToast('투표 열기에 실패했습니다 — 네트워크를 확인하고 다시 시도해 주세요.');
    } finally {
      setCreating(false);
    }
  };

  const handleClosePoll = async () => {
    const access = authorizationRef.current;
    if (!access || !state.round) return;
    const roundId = state.round.id;
    const intent = getOrCreateRoundStatusIntent(
      roundStatusIntentRef.current,
      roundId,
      'active',
      'closed',
      state.round.updated_at ?? null,
    );
    roundStatusIntentRef.current = intent;
    setClosing(true);
    try {
      const closed = await setPollStatus(
        access,
        roundId,
        intent.expectedStatus,
        intent.status,
        intent.idempotencyKey,
      );
      if (authorizationRef.current?.accessToken !== access.accessToken) return;
      roundStatusIntentRef.current = null;
      voteRefreshCoordinatorRef.current.invalidate();
      setRestoreNotice(false);
      setClosedAt(roundUpdatedAtMs(closed));
      // The last live-poll snapshot is provisional. Only the post-close fetch
      // may unlock projection and export for this round.
      setVoteRefreshMeta((current) => beginVoteRefresh(current, 'final'));
      dispatch({ type: 'CLOSE_POLL', round: closed });
    } catch (error: unknown) {
      console.error('[moderator poll] close failed', error);
      await restoreRoundAfterStatusFailure(access, roundId, intent, error);
    } finally {
      setClosing(false);
    }
  };

  // 마감을 잘못 눌렀을 때의 되돌리기 — 라운드를 active로 되돌리고 진행 화면으로 복귀한다.
  // 마감은 표를 보관(archive)하지 않으므로 기존 표는 그대로 남는다.
  const handleReopenPoll = async () => {
    const access = authorizationRef.current;
    if (!access || !state.round) return;
    const roundId = state.round.id;
    const intent = getOrCreateRoundStatusIntent(
      roundStatusIntentRef.current,
      roundId,
      'closed',
      'active',
      state.round.updated_at ?? null,
    );
    roundStatusIntentRef.current = intent;
    setReopening(true);
    try {
      const reopened = await setPollStatus(
        access,
        roundId,
        intent.expectedStatus,
        intent.status,
        intent.idempotencyKey,
      );
      if (authorizationRef.current?.accessToken !== access.accessToken) return;
      roundStatusIntentRef.current = null;
      voteRefreshCoordinatorRef.current.invalidate();
      setClosedAt(null);
      setVoteRefreshMeta((current) => ({
        ...current,
        failed: false,
        finalVerificationStatus: 'not-required',
        busy: false,
      }));
      dispatch({ type: 'REOPEN_POLL', round: reopened });
    } catch (error: unknown) {
      console.error('[moderator poll] reopen failed', error);
      await restoreRoundAfterStatusFailure(access, roundId, intent, error);
    } finally {
      setReopening(false);
    }
  };

  /** 조 나가기 — 서버 bearer를 먼저 폐기하고 코드 입력 화면으로 되돌린다. */
  const handleExit = () => {
    setExitError(null);
    setExitConfirmOpen(true);
  };

  const confirmExit = async () => {
    if (exitLockRef.current) return;
    exitLockRef.current = true;
    setExitBusy(true);
    setExitError(null);
    const exitToken = authorizationRef.current?.accessToken ?? null;
    if (exitToken) {
      try {
        await revokeWorkshopSession(exitToken);
      } catch (error: unknown) {
        console.error('[workshop access] server logout failed', error);
        if (classifyStoredSessionResumeError(error) !== 'definitive') {
          setExitError('서버에서 이 기기의 조 연결을 종료하지 못했습니다. 연결을 확인한 뒤 다시 시도해 주세요.');
          exitLockRef.current = false;
          setExitBusy(false);
          return;
        }
      }
      if (authorizationRef.current?.accessToken !== exitToken) {
        setExitError('로그아웃 중 조 연결이 바뀌었습니다. 현재 연결 상태를 확인해 주세요.');
        exitLockRef.current = false;
        setExitBusy(false);
        return;
      }
    }

    try {
      workshopSessionStorage.removeItem(MOD_TAB_KEY);
    } catch (error) {
      console.error('[workshop access] failed to clear tab preference', error);
    }
    const localSessionCleared = clearWorkshopSession(workshopLocalStorage);
    setNonPersistentMode(!workshopLocalStorage.isPersistent());
    authorizationRef.current = null;
    createPollIntentRef.current = null;
    roundStatusIntentRef.current = null;
    setWorkshopSession(null);
    setVotes([]);
    voteRefreshCoordinatorRef.current.invalidate();
    setVoteRefreshMeta(EMPTY_VOTE_REFRESH_META);
    setClosedAt(null);
    setLegacyDraftConflicts(0);
    setLegacyDraftRecoveries([]);
    setLegacyStorageCleanupFailed(false);
    dispatch({ type: 'LOGOUT' });
    setExitConfirmOpen(false);
    setExitBusy(false);
    exitLockRef.current = false;
    if (!localSessionCleared) {
      setToast('서버 연결은 종료했지만 브라우저 정보를 지우지 못했습니다. 이 탭을 닫아 주세요.');
    }
  };

  const downloadLegacyDraftRecoveries = () => {
    const teamId = state.team?.id;
    if (!teamId || legacyDraftRecoveries.length === 0) {
      setToast('내려받을 이전 작성 내용 복구본이 없습니다.');
      return;
    }
    try {
      const payload = {
        format: 'climate-vote-legacy-draft-recovery-v1',
        exportedAt: new Date().toISOString(),
        teamId,
        drafts: legacyDraftRecoveries,
      };
      downloadBlob(
        new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' }),
        `climate-vote-draft-recovery-${teamId.slice(0, 8)}.json`,
      );
      setToast(`이전 작성 내용 복구본 ${legacyDraftRecoveries.length}개를 내려받았습니다.`);
    } catch (error) {
      console.error('[workshop access] legacy draft recovery download failed', error);
      setToast('이전 작성 내용 복구본을 내려받지 못했습니다. 다시 시도해 주세요.');
    }
  };

  const enterFullscreen = () => {
    // 풀스크린 진입 시 1회 재조회 — 마감 직전(가드 적용 이전) 도착한 표까지 반영한다.
    const access = authorizationRef.current;
    if (state.round && access) {
      void refreshVoteSnapshot(state.round.id, 'manual');
    }
    setFullscreen(true);
    const el = document.documentElement;
    if (el.requestFullscreen) {
      el.requestFullscreen().catch((error: unknown) => {
        console.warn('[moderator fullscreen] native fullscreen unavailable; using overlay', error);
      });
    }
  };

  const exitFullscreen = () => {
    setFullscreen(false);
    if (document.fullscreenElement && document.exitFullscreen) {
      document.exitFullscreen().catch((error: unknown) => {
        console.warn('[moderator fullscreen] native fullscreen exit failed', error);
      });
    }
  };

  const teamName = state.team?.name ?? '';
  // 토큰 교환 응답에 안전한 팀 필드가 들어 있어 별도 조회가 없다. 값이 없으면 배지가 알아서 비운다.
  const tableNo = state.team?.table_no ?? null;

  let screenEl: React.ReactNode;

  if (state.screen === 'home') {
    screenEl = (
      <HomeScreen
        onExit={handleExit}
        teamId={state.team?.id ?? ''}
        teamName={teamName}
        tableNo={tableNo}
        subgroup={state.team?.subgroup ?? null}
        access={authorization}
        onCreatePoll={handleCreatePoll}
        creating={creating}
      />
    );
  } else if (state.screen === 'polling' && state.round) {
    screenEl = (
      <PollingScreen
        onExit={handleExit}
        teamName={teamName}
        tableNo={tableNo}
        access={authorization}
        capacity={state.team?.capacity ?? 0}
        round={state.round}
        votes={votes}
        onClose={handleClosePoll}
        closing={closing}
        restoreNotice={restoreNotice}
        voteRefreshMeta={voteRefreshMeta}
        onRetryVotes={() => void refreshVoteSnapshot(state.round?.id ?? '', 'manual')}
      />
    );
  } else if (state.screen === 'results' && state.round && fullscreen) {
    screenEl = <FullscreenResults teamName={teamName} round={state.round} votes={votes} onExit={exitFullscreen} />;
  } else if (state.screen === 'results' && state.round) {
    screenEl = (
      <ResultsScreen
        onExit={handleExit}
        teamName={teamName}
        tableNo={tableNo}
        sequence={resultsSequence?.roundId === state.round.id ? resultsSequence.sequence : 0}
        round={state.round}
        votes={votes}
        onNewPoll={() => {
          roundStatusIntentRef.current = null;
          setClosedAt(null);
          voteRefreshCoordinatorRef.current.invalidate();
          setVoteRefreshMeta(EMPTY_VOTE_REFRESH_META);
          dispatch({ type: 'NEW_POLL' });
        }}
        onEnterFullscreen={enterFullscreen}
        onReopen={handleReopenPoll}
        closedAt={closedAt}
        reopening={reopening}
        voteRefreshMeta={voteRefreshMeta}
        onRetryVotes={() => void refreshVoteSnapshot(state.round?.id ?? '', 'final')}
      />
    );
  } else {
    screenEl = (
      <JoinScreen
        onJoin={handleJoin}
        onRetryStoredSession={retryStoredSession}
        storedSessionRetryAvailable={storedResumeRetryAvailable}
        error={state.joinError}
        busy={joinBusy || restoringSession}
      />
    );
  }

  return (
    <>
      {screenEl}
      {nonPersistentMode ? (
        <div
          role="alert"
          className="fixed left-4 right-4 top-4 z-[70] mx-auto max-w-3xl rounded-xl border-2 border-[#B5651D] bg-[#FFF4D6] px-4 py-3 text-center text-[14px] font-extrabold text-[#6B4B00] shadow-lg"
        >
          브라우저 저장소를 사용할 수 없어 연결 정보가 이 페이지 메모리에만 유지됩니다. 새로고침하면 조 코드로 다시 입장해야 합니다.
        </div>
      ) : null}
      {legacyDraftConflicts > 0 || legacyStorageCleanupFailed ? (
        <div
          role="alert"
          className="fixed bottom-20 left-4 right-4 z-[70] mx-auto flex max-w-3xl flex-wrap items-center justify-center gap-3 rounded-xl border-2 border-[#DC2626] bg-[#FEF2F2] px-4 py-3 text-center text-[14px] font-extrabold text-[#B91C1C] shadow-lg"
        >
          <span className="min-w-[220px] flex-1">
            이전 코드로 저장한 작성 내용을 현재 조 자료와 섞지 않고 별도 보존했습니다.
            {legacyDraftRecoveries.length > 0
              ? ` 조 코드가 들어 있지 않은 복구본 ${legacyDraftRecoveries.length}개를 내려받아 내용을 확인할 수 있습니다.`
              : ' 안전한 복구본을 만들지 못했으므로 이 페이지를 닫지 말고 지원 담당자에게 알려 주세요.'}
            {legacyStorageCleanupFailed
              ? legacyDraftRecoveries.length > 0
                ? ' 브라우저 저장 제한으로 이전 코드 정보 삭제를 확인하지 못했습니다. 복구본을 받은 뒤 지원 담당자와 이 사이트의 브라우저 데이터를 삭제해 주세요.'
                : ' 브라우저 저장 제한으로 이전 코드 정보 삭제를 확인하지 못했습니다. 이 페이지를 닫지 말고 지원 담당자가 작성 내용을 옮긴 뒤 이 사이트의 브라우저 데이터를 삭제해 주세요.'
              : ''}
          </span>
          {legacyDraftRecoveries.length > 0 ? (
            <button
              type="button"
              onClick={downloadLegacyDraftRecoveries}
              className="min-h-11 rounded-lg border-2 border-[#B91C1C] bg-white px-4 text-[#B91C1C]"
            >
              이전 작성 내용 복구본 내려받기
            </button>
          ) : null}
        </div>
      ) : null}
      {toast ? (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-[#1F4E79] text-white text-[16px] font-bold rounded-full px-5 py-3 shadow-lg">
          {toast}
        </div>
      ) : null}
      {exitConfirmOpen ? (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-[#1F4E79]/55 p-5 backdrop-blur-[1px]">
          <div
            ref={exitDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="mod-exit-dialog-title"
            tabIndex={-1}
            className="w-full max-w-md rounded-2xl border border-[#DCE7EE] bg-white p-6 shadow-xl"
          >
            <h2 id="mod-exit-dialog-title" className="text-[22px] font-extrabold text-[#1F4E79]">
              조에서 나갈까요?
            </h2>
            <p className="mt-3 text-[16px] leading-relaxed text-[#5A6B73]">
              서버에서 이 기기의 조 연결을 종료한 뒤 브라우저 정보를 지웁니다. 다시 들어오려면 조 코드가 필요합니다.
            </p>
            <div className="mt-6 grid grid-cols-2 gap-3">
              <button
                type="button"
                data-dialog-initial-focus
                onClick={() => setExitConfirmOpen(false)}
                disabled={exitBusy}
                className="min-h-14 rounded-xl border border-[#C4D8E4] bg-white text-[18px] font-bold text-[#1F4E79]"
              >
                취소
              </button>
              <button
                type="button"
                onClick={() => void confirmExit()}
                disabled={exitBusy}
                aria-busy={exitBusy}
                className="min-h-14 rounded-xl bg-[#B91C1C] text-[18px] font-bold text-white"
              >
                {exitBusy ? '서버 연결 종료 중…' : '조에서 나가기'}
              </button>
            </div>
            {exitError ? (
              <p role="alert" className="mt-4 rounded-xl bg-[#FDECEC] px-4 py-3 text-[15px] font-semibold text-[#B91C1C]">
                {exitError}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}
