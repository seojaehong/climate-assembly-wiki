import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  submissionFinalize,
  submissionGet,
  submissionSave,
  submissionReopenByTeam,
  SubmissionVersionConflictError,
  type SubmissionGetResult,
  type SubmissionSaveResult,
  type SubmissionStatus,
  type Topic,
  type WorkshopAccess,
  type WorkshopAuthorization,
} from '../../lib/deliberation';
import {
  FINALIZE_CONFIRM_MESSAGE,
  LONG_ROW_CHARS,
  MAX_SUBMISSION_ROWS,
  addRow,
  canFinalize,
  draftStatusLabel,
  emptyRow,
  formatSavedClock,
  isDirty,
  isEditable,
  liftNameOnlyRows,
  moveRow,
  nameOnlyRowIndexes,
  overlongRowIndexes,
  restoredDraftDecision,
  removeRow,
  rowsFromItems,
  sameSavePayload,
  saveFailureKind,
  saveFailureMessage,
  saveOutcomeMessage,
  splitOverlongRows,
  splitPastedRows,
  splittableRowIndexes,
  submissionBadge,
  toSaveItems,
  type EditorRow,
} from './submission-panel-logic';
import {
  createDraftStorage,
  staleKeys,
  writeDraft,
} from './submission-draft-store';
import {
  makeQueuedSave,
  queueKey,
  readQueue,
  shouldAttempt,
  withFailedAttempt,
  writeQueue,
  type QueuedSave,
} from './submission-queue';
import {
  REVISION_POLL_MS,
  fetchServedRevision,
  isStaleBundle,
  runningRevision,
} from './deploy-revision';
import { SUBMISSION_GUIDE, topicAnchorId } from './submission-guide';
import {
  buildSubmissionReport,
  reportToCsv,
  reportToText,
  reportFileName,
  formatStamp,
} from './submission-report';
import { submissionReportBlob } from './submission-report-docx';
import {
  MULTI_DOWNLOAD_HINT,
  buildTeamBundleEntries,
  shouldShowMultiDownloadHint,
  teamBundleFileName,
} from './team-download-bundle';
import { buildZipArchive } from './zip-store';
import PrintableReport from './PrintableReport';
import type { SubmissionReport } from './submission-report';
import { buildBoards } from './hq-submission-board-logic';
import type { HqSubmissionRow } from '../../lib/hq-submissions';
import {
  summarizeTopicWork,
  type TopicWorkState,
  type WorkshopWorkSummary,
} from './workshop-session-state';

/**
 * 조별 산출물 — 그날의 꼭지를 **한 화면에 모두 펼친다.**
 *
 * 예전에는 주제를 하나 골라 들어가는 탭 구조였다. 8.29에 조가 하는 일은 세 꼭지를
 * 줄글로 채우는 것 하나뿐이라, 고르는 단계가 군더더기였고 주제가 아직 안 열렸을 때는
 * 「본부에서 주제를 열면…」이라는 운영 사정이 시민에게 그대로 노출됐다.
 * 이제 꼭지마다 제 편집기를 가진 구역이 세로로 놓이고, 조는 시트에 적듯 위에서 아래로 쓴다.
 *
 * 상태는 구역마다 따로 갖는다(한 꼭지를 저장해도 다른 꼭지의 미저장 내용이 날아가지 않게).
 */

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

/**
 * ISO 시각을 `14:23` 꼴로. 값이 없거나 깨졌으면 '—'.
 *
 * 표기는 `formatSavedClock` 하나에 맡긴다 — 상태 배지와 이 자리(마지막 저장·최종
 * 제출 시각)가 **같은 사실을 다른 모양으로** 내면 조가 두 시각을 다른 것으로 읽는다.
 */
function formatClock(iso: string | null | undefined): string {
  return formatSavedClock(iso) || '—';
}

type LoadedSubmission = {
  status: SubmissionStatus | null;
  updatedAt: string | null;
  finalizedAt: string | null;
  version: number;
};

type SubmissionConflict = {
  serverRows: EditorRow[];
  serverVersion: number;
  serverUpdatedAt: string | null;
};

export function conflictFromSaveError(
  error: unknown,
): SubmissionConflict | null {
  if (!(error instanceof SubmissionVersionConflictError)) return null;
  return {
    serverRows: rowsFromItems(error.currentItems),
    serverVersion: error.currentVersion,
    serverUpdatedAt: error.currentUpdatedAt,
  };
}

/**
 * 인쇄 문서를 다시 만들라는 신호.
 *
 * 인쇄 문서는 **항상 DOM에 있어야 한다** — 버튼을 눌러야 만들어지게 두면 Ctrl+P나
 * 브라우저 메뉴로 인쇄할 때 드러낼 것이 없어 백지가 나간다(실제로 4쪽 전부 빈 종이가
 * 나왔다). 그래서 처음에 한 번 만들고, 조가 저장할 때마다 이 신호로 갱신한다.
 *
 * 조 콘솔은 꼭지마다 구역이 따로라 상태를 공유하지 않는다. 상태를 위로 끌어올리면
 * 세 구역이 서로의 저장에 다시 그려진다 — 입력 중에 그건 위험하다. 신호만 보낸다.
 */
/**
 * 미저장분 보관함 — **모듈에 하나만 둔다.**
 *
 * 구역(TopicSection)마다 새로 만들면 메모리 계층이 구역별로 갈리고, 배포 이전
 * `sessionStorage` 초안을 훑어 올리는 승격 경로도 구역마다 따로 돌게 된다.
 * 계층 결정(local→session→메모리)은 탭 전체에서 한 번이어야 한다.
 */
const draftStore = createDraftStorage();

/**
 * 재전송 자물쇠의 유효기간. 이 시간이 지나면 앞선 시도가 아직 안 끝났어도 다시 건다.
 *
 * 요청이 영영 안 끝나는 망(캡티브 포털·죽은 와이파이)이 실제로 있다. 자물쇠를
 * 불리언으로 두면 그 한 번에 큐가 영원히 멈춘다 — 그게 이 story 가 막으려는 상태다.
 */
const ATTEMPT_LOCK_MS = 60_000;

const SUBMISSION_CHANGED = 'climate-vote:submission-changed';
function announceSubmissionChanged() {
  window.dispatchEvent(new CustomEvent(SUBMISSION_CHANGED));
}

/**
 * 우리가 시킨 새로고침인가.
 *
 * 미저장분이 있으면 `beforeunload` 가 「나가시겠습니까」를 띄운다. 그건 조가 실수로
 * 탭을 닫을 때를 위한 것이지, **우리가 눌러 달라고 한 새로고침**을 막으라는 게 아니다.
 * 겁주는 창이 뜨면 조는 새로고침을 안 한다 — 그러면 옛 번들 그대로 남는다.
 *
 * 안전한 이유 — 미저장분은 이미 초안 보관함에 들어가 있고(TopicSection 의 보관
 * useEffect), 새로 열릴 때 `pickRestoredRows` 가 서버 내용과 견줘 되살린다.
 * 보관함은 `localStorage` 를 먼저 쓰므로 새로고침뿐 아니라 **탭을 닫았다 다시 열어도
 * 산다**(US-003). 막힌 브라우저에서만 `sessionStorage`·메모리로 내려간다.
 */
let suppressUnloadGuard = false;

/**
 * 돌고 있는 번들이 서버의 현재 배포보다 낡았는가.
 * 확실할 때만 true — 근거 없는 「새로고침하세요」는 입력 중인 조에게 해롭다.
 */
function useStaleBundle(): boolean {
  const [stale, setStale] = useState(false);
  useEffect(() => {
    const running = runningRevision();
    if (!running) return; // 번들에 커밋이 안 박혔다(dev 등) — 감지를 접는다
    let alive = true;
    const check = async () => {
      const served = await fetchServedRevision();
      if (alive && isStaleBundle(running, served)) setStale(true);
    };
    void check();
    const timer = setInterval(() => void check(), REVISION_POLL_MS);
    // ★ 탭으로 돌아온 순간을 놓치면 안 된다 — 8.29에 조가 한 일이 정확히 그것이고,
    //   배경 탭에서는 브라우저가 타이머를 늘려 잡는다.
    const onVisible = () => {
      if (document.visibilityState === 'visible') void check();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      alive = false;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);
  return stale;
}

/** 새 배포 알림 띠. 화면 맨 위에 붙어 따라다닌다 — 조는 아래쪽 입력칸을 보고 있다. */
function StaleBundleBanner() {
  const reload = () => {
    suppressUnloadGuard = true;
    window.location.reload();
  };
  return (
    <div
      role="status"
      className="sticky top-0 z-30 -mx-1 flex flex-wrap items-center gap-3 rounded-2xl border-2 border-[#B5651D] bg-[#FFF4D6] px-4 py-3 shadow-sm print:hidden"
    >
      <span className="text-[22px]" aria-hidden="true">🔄</span>
      <span className="min-w-[220px] flex-1">
        <span className="block text-[18px] font-extrabold text-[#6B4B00]">
          화면이 갱신되었습니다
        </span>
        <span className="block text-[15px] font-semibold text-[#6B4B00]">
          새로고침해야 새 기능이 켜집니다. <b>쓰던 글은 그대로 남습니다.</b>
        </span>
      </span>
      <button
        type="button"
        onClick={reload}
        className="h-12 shrink-0 rounded-xl bg-[#8A4F08] px-5 text-[17px] font-bold text-white"
      >
        새로고침
      </button>
    </div>
  );
}

/** 꼭지 하나 = 구역 하나. 편집·저장·최종 제출을 스스로 갖는다. */
function TopicSection({
  access,
  fixtureMode = false,
  storageScope,
  topic,
  fixtureSubmission,
  onUnsavedChange,
  onWorkStateChange,
}: {
  access: WorkshopAccess | null;
  /** 명시적인 무네트워크 미리보기 경로. */
  fixtureMode?: boolean;
  /** 저장소 키에만 쓰는 비식별 조 scope(team.id). */
  storageScope: string;
  topic: Topic;
  /** 주면 `submission_get` 을 부르지 않는다 — 픽스처 라우트 전용(HqSubmissionBoard 의 fixtureRows 와 같은 관례). */
  fixtureSubmission?: SubmissionGetResult;
  /**
   * 이 꼭지에 저장 안 한 내용이 있는지 위로 알린다(마감 배너가 쓴다, US-010).
   *
   * ★ 배너가 초안 보관함을 뒤져 스스로 판정하면 안 되기 때문에 있는 통로다 —
   *   서버와 내용이 같은 초안까지 「미저장」이 되어 배지와 배너가 다른 말을 한다.
   */
  onUnsavedChange?: (topicId: string, unsaved: boolean) => void;
  /** 상태 레일이 꼭지별 저장 상태를 합쳐 보여 주는 통로. */
  onWorkStateChange?: (topicId: string, state: TopicWorkState) => void;
}) {
  const [loaded, setLoaded] = useState<LoadedSubmission | null>(null);
  /** 현재 편집본이 딛고 선 서버 OCC 버전. */
  const [editBaseVersion, setEditBaseVersion] = useState(0);
  /** 버전 필드가 없던 예전 초안의 충돌 감지를 위한 하위 호환 기준. */
  const [editBaseUpdatedAt, setEditBaseUpdatedAt] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [rows, setRows] = useState<EditorRow[]>([emptyRow()]);
  const [baseline, setBaseline] = useState<EditorRow[]>([emptyRow()]);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [confirmFinalize, setConfirmFinalize] = useState(false);
  const [reopening, setReopening] = useState(false);
  const [operationFailed, setOperationFailed] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  /** 「이대로 두겠다」고 조가 답한 긴 칸 조합. 새 덩어리가 생기면 다시 묻는다. */
  const [longNoticeAnswered, setLongNoticeAnswered] = useState<string | null>(null);
  /** 같은 방식으로, 「이름만 있는 줄」 안내에 답한 조합. */
  const [nameNoticeAnswered, setNameNoticeAnswered] = useState<string | null>(null);
  /** 저장에 실패해 다시 보낼 것을 기다리는 건. 꼭지당 1건이다(submission-queue). */
  const [queued, setQueued] = useState<QueuedSave | null>(null);
  /**
   * 재전송 직전에 **서버가 더 새것**으로 밝혀진 상태. 보내지 않고 조에게 묻는다(A-D5).
   * 병합도 하지 않고 조용히 덮어쓰지도 않는다 — 어느 쪽이든 남의 글이 사라진다.
   */
  const [conflict, setConflict] = useState<SubmissionConflict | null>(null);
  const [showServerRows, setShowServerRows] = useState(false);
  const [manualMerge, setManualMerge] = useState(false);
  /**
   * 재전송이 겹치지 않게 하는 자물쇠. 불리언이 아니라 **시각**을 넣는다 —
   * 요청이 영영 안 끝나면 불리언 자물쇠는 박힌 채 남아 큐가 영원히 멈춘다.
   */
  const attemptingSinceRef = useRef<number | null>(null);
  const finalizeDialogRef = useRef<HTMLDivElement>(null);
  const finalizeTriggerRef = useRef<HTMLButtonElement>(null);
  const finalizeTitleId = useId();
  const finalizeDescriptionId = useId();
  /**
   * 워커가 「지금 화면」을 봐야 할 때만 쓴다. 워커 이펙트를 `rows` 로 다시 태우면
   * 조가 한 글자 칠 때마다 백오프 타이머가 처음부터 다시 걸린다.
   */
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  /** 손으로 누른 저장·최종 제출이 날아가는 중인가. 워커가 그 위에 겹치면 안 된다. */
  const savingRef = useRef(false);
  savingRef.current = saving || finalizing;

  const dirty = isDirty(rows, baseline);

  // ── 저장 상태 배지의 시계 (설계 §1.4) ─────────────────────────
  // 「저장 안 함 · 3분째」를 내려면 **언제부터** 미저장인지와 **지금**이 필요하다.
  // 둘 다 화면 상태로 둔다 — 순수 함수(`draftStatusLabel`)는 시각을 인자로만 받는다.
  const [dirtySinceMs, setDirtySinceMs] = useState<number | null>(null);
  const [statusNowMs, setStatusNowMs] = useState(() => Date.now());
  useEffect(() => {
    // 미저장이 이어지는 동안 시작 시각은 그대로 둔다(한 글자마다 0분으로 되돌아가면
    // 「몇 분째 저장 안 했는지」라는 정보 자체가 없어진다).
    setDirtySinceMs((prev) => (dirty ? (prev ?? Date.now()) : null));
  }, [dirty]);
  useEffect(() => {
    if (dirtySinceMs == null) return;
    // 이펙트가 다시 걸리는 순간이 곧 미저장의 시작이므로 여기서 시계를 맞춘다.
    setStatusNowMs(Date.now());
    // 30초 간격 — 분이 바뀌는 순간과 화면이 어긋나는 폭을 30초 아래로 묶는다.
    const t = setInterval(() => setStatusNowMs(Date.now()), 30_000);
    return () => clearInterval(t);
  }, [dirtySinceMs]);
  // 미저장 입력 임시 보관함 — 조·꼭지마다 따로 둔다.
  const draftKey = `climate_vote_draft:${storageScope}:${topic.id}`;
  // 저장 실패분 재전송 큐 — 같은 보관함(local→session→메모리)에 접두사만 갈라 둔다.
  const qKey = queueKey(storageScope, topic.id);
  const badge = submissionBadge(loaded?.status ?? null);
  // ★ 위 `badge` 는 잠금(최종 제출) 배지다. 이것은 **저장 상태** 배지로 별개다.
  const saveStatus = draftStatusLabel(
    {
      loadFailed,
      saving: saving || finalizing,
      conflict: conflict != null,
      queuedAttempts: queued?.attempts ?? null,
      dirty,
      dirtySinceMs,
      savedAt,
    },
    statusNowMs,
  );
  const topicOpen = topic.status === 'open';
  const editable = loaded != null && isEditable(loaded.status) && topicOpen;
  // A save/finalize request captures a complete replacement payload. Keep the editor read-only
  // while it is in flight so a successful response can never erase a later keystroke.
  const editorWritable = editable && !saving && !finalizing && !reopening && !confirmFinalize;

  // ── 한 칸에 여러 사람 말이 든 것 같을 때 (2차 방어선) ────────────
  // 1차(붙여넣기 분해)가 옛 번들·드래그앤드롭으로 새어도 여기서 한 번 더 잡힌다.
  // ★ 강제로 나누지 않는다 — 정말 긴 발언 한 건일 수 있다. 묻고 조가 고른다.
  const overlong = overlongRowIndexes(rows);
  const splittable = splittableRowIndexes(rows);
  const longSignature = `${overlong.join(',')}|${splittable.join(',')}`;
  const showLongNotice =
    editable && overlong.length > 0 && longNoticeAnswered !== longSignature;

  const handleSplitLong = () => {
    if (!editorWritable) return;
    const out = splitOverlongRows(rows);
    if (!out.applied) {
      setToast(
        out.overCap
          ? `나누면 ${MAX_SUBMISSION_ROWS}줄을 넘어 그대로 두었습니다 — 글자는 하나도 지우지 않았습니다. 몇 줄을 덜어 낸 뒤 다시 눌러 주세요.`
          : '나눌 줄바꿈이 없습니다 — 한 문장이 길 뿐인 것 같습니다.',
      );
      setLongNoticeAnswered(longSignature);
      return;
    }
    setRows(out.rows);
    setLongNoticeAnswered(null);
    setToast(`${out.before}칸을 ${out.after}칸으로 나눴습니다. 저장을 눌러 주세요.`);
  };

  // ── 이름만 있는 줄 (진단서 §4-5, 유형 C) ────────────────────────
  // 이름을 한 줄에 따로 쓰면 그 줄은 쓰레기 노드가 되고 아래 문장들은 화자를 잃는다.
  // ★ 여기서도 강제하지 않는다 — 옮겨 주는 버튼과 「이대로 두기」를 함께 준다.
  const nameOnly = nameOnlyRowIndexes(rows);
  const nameSignature = nameOnly.map((m) => `${m.index}:${m.name}:${m.inBody ? 'b' : 'n'}`).join(',');
  const liftable = nameOnly.filter((m) => m.inBody).length;
  const showNameNotice = editable && nameOnly.length > 0 && nameNoticeAnswered !== nameSignature;

  const handleLiftNames = () => {
    if (!editorWritable) return;
    const out = liftNameOnlyRows(rows);
    if (!out.applied) {
      setNameNoticeAnswered(nameSignature);
      return;
    }
    setRows(out.rows);
    setNameNoticeAnswered(null);
    setToast(`이름 ${out.removed}개를 아래 ${out.filled}줄의 이름 칸으로 옮겼습니다. 저장을 눌러 주세요.`);
  };

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  // 최종 제출은 파괴적 잠금 동작이다. 열리면 안전한 첫 버튼으로 이동하고, Tab을
  // 다이얼로그 안에 가두며, Escape/닫기 뒤에는 열었던 버튼으로 돌아간다.
  useEffect(() => {
    if (!confirmFinalize) return;
    const dialog = finalizeDialogRef.current;
    if (!dialog) return;
    const previousFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : finalizeTriggerRef.current;
    const focusable = () =>
      Array.from(dialog.querySelectorAll<HTMLButtonElement>('button:not([disabled])'));
    focusable()[0]?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setConfirmFinalize(false);
        return;
      }
      if (event.key !== 'Tab') return;
      const buttons = focusable();
      if (buttons.length === 0) return;
      const currentIndex = buttons.indexOf(document.activeElement as HTMLButtonElement);
      if (event.shiftKey && currentIndex <= 0) {
        event.preventDefault();
        buttons[buttons.length - 1].focus();
      } else if (!event.shiftKey && currentIndex === buttons.length - 1) {
        event.preventDefault();
        buttons[0].focus();
      }
    };
    dialog.addEventListener('keydown', onKeyDown);
    return () => {
      dialog.removeEventListener('keydown', onKeyDown);
      previousFocus?.focus();
    };
  }, [confirmFinalize]);

  const loadSubmission = useCallback(async () => {
    try {
      let result: SubmissionGetResult;
      if (fixtureMode) {
        result = fixtureSubmission ?? { status: null, version: 0, items: [] };
      } else {
        if (!access) throw new Error('Workshop authorization is unavailable');
        result = await submissionGet(access, topic.id);
      }
      const nextRows = rowsFromItems(result.items ?? []);
      setLoaded({
        status: result.status ?? null,
        updatedAt: result.updated_at ?? null,
        finalizedAt: result.finalized_at ?? null,
        version: result.version ?? 0,
      });
      setBaseline(nextRows);
      setSavedAt(result.updated_at ?? null);
      setLoadFailed(false);
      setOperationFailed(false);
      // 탭을 옮겼다 왔을 때 저장 안 한 글을 되살린다. 서버 내용을 기준선으로 두고,
      // 보관분이 그와 다를 때만 화면에 올린다(저장을 마친 뒤엔 같아지므로 안 뜬다).
      const currentVersion = result.version ?? 0;
      let restored: ReturnType<typeof restoredDraftDecision> = null;
      try {
        const rawDraft = draftStore.getItem(draftKey);
        restored = restoredDraftDecision(
          rawDraft,
          nextRows,
          currentVersion,
          result.updated_at ?? null,
        );
      } catch (error) {
        console.error('[submission draft] failed to restore local draft', error);
      }
      if (restored) {
        setEditBaseVersion(restored.expectedVersion);
        setEditBaseUpdatedAt(restored.baseUpdatedAt);
        setRows(restored.rows);
        if (restored.conflictsWithServer) {
          setConflict({
            serverRows: nextRows,
            serverVersion: currentVersion,
            serverUpdatedAt: result.updated_at ?? null,
          });
          setShowServerRows(true);
          setManualMerge(false);
        }
      } else {
        setEditBaseVersion(currentVersion);
        setEditBaseUpdatedAt(result.updated_at ?? null);
        setRows(nextRows);
      }
    } catch (error) {
      console.warn('[submission] load failed; preserving the current editor state', error);
      setLoadFailed(true);
    }
  }, [access, topic.id, draftKey, fixtureMode, fixtureSubmission]);

  useEffect(() => {
    void loadSubmission();
  }, [loadSubmission]);

  // 미저장 내용을 보관함에 넣어 둔다. 저장해서 서버와 같아지면 지운다
  // (낡은 초안이 남아 다음에 되살아나면 그게 더 위험하다).
  useEffect(() => {
    if (loaded == null) return;
    // ★ 딛고 선 서버 updated_at 을 함께 넣는다 — 재전송 큐(US-004·005)가
    //   「내가 읽은 뒤에 남이 저장했는가」를 이 값으로 판정한다.
    if (dirty) draftStore.setItem(draftKey, writeDraft(rows, editBaseUpdatedAt, Date.now(), editBaseVersion));
    else draftStore.removeItem(draftKey);
  }, [rows, dirty, loaded, draftKey, editBaseUpdatedAt, editBaseVersion]);

  // 마감 배너(탭 바깥)가 볼 수 있게 미저장 사실을 위로 올린다.
  // ★ 「저장 안 함」과 「재전송 대기」를 **같은 사실**로 묶는다 — 둘 다 서버에 아직
  //   안 올라간 글이고, 설계 §2.4 도 `unsaved`/`queued` 를 함께 센다.
  const unsavedForBanner = dirty || queued != null;
  useEffect(() => {
    onUnsavedChange?.(topic.id, unsavedForBanner);
  }, [onUnsavedChange, topic.id, unsavedForBanner]);
  useEffect(() => {
    onWorkStateChange?.(topic.id, {
      unsaved: unsavedForBanner,
      queued: queued != null,
      conflict: conflict != null,
      saving: saving || finalizing,
      failed: loadFailed || operationFailed,
    });
  }, [
    conflict,
    finalizing,
    loadFailed,
    onWorkStateChange,
    operationFailed,
    queued,
    saving,
    topic.id,
    unsavedForBanner,
  ]);

  // 저장 전 이탈(새로고침·탭 닫기) confirm — 자동 저장이 없으므로 이 방어선이 유일하다.
  // 구역마다 걸어 두면 어느 꼭지에 미저장분이 있어도 잡힌다.
  useEffect(() => {
    if (!dirty || !editable) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      // 우리가 띄운 「새로고침」 버튼으로 나가는 길만 열어 준다 — 초안은 이미 보관돼 있고
      // 새로 열릴 때 되살아난다. 그 길까지 막으면 조가 새로고침을 안 하고 옛 번들이 남는다.
      if (suppressUnloadGuard) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty, editable]);

  /**
   * 저장이 끝나면 초안을 **먼저** 버린다.
   *
   * 서버가 줄을 나누면(s15) 서버 행수가 우리가 보낸 행수보다 많아진다. 이때 초안이
   * 남아 있으면 loadSubmission 안의 pickRestoredRows 가 「초안 ≠ 서버」로 보고
   * **나누기 전 초안을 되살린다.** DB 는 나뉘어 있는데 화면은 안 나뉜 채 계속
   * 「저장하지 않은 변경」으로 남는다(2026-08-30 실화면 확인).
   * 초안의 임무는 **저장 못 한 것**을 새로고침 너머로 살리는 것이다. 저장이 끝난
   * 순간 정본은 서버다.
   */
  /**
   * 큐를 놓는다 — 보관함에서도, 화면 상태에서도.
   *
   * 저장이 어떤 경로로든 성공하면 대기 중이던 옛 내용은 더 이상 보낼 것이 아니다.
   * 남겨 두면 워커가 **이미 지난 내용을 다시 올려** 방금 저장한 것을 덮는다.
   */
  const clearQueue = useCallback(() => {
    draftStore.removeItem(qKey);
    setQueued(null);
    setConflict(null);
    setShowServerRows(false);
    setManualMerge(false);
  }, [qKey]);

  const dropDraft = useCallback(() => {
    // 보관함이 모든 계층에서 지운다 — 한 곳만 지우면 배포 이전 `sessionStorage`
    // 사본이 남아 다음 열람에 되살아난다(submission-draft-store).
    draftStore.removeItem(draftKey);
    // 설계 §1.5 — 초안을 버릴 때 큐도 함께 버린다. 초안이 없어졌다는 건 저장이
    // 끝났다는 뜻이고, 그러면 큐에 실린 옛 내용은 되레 위험하다.
    clearQueue();
  }, [draftKey, clearQueue]);

  /**
   * Accept a successful save as the new OCC baseline before doing a follow-up fetch.
   *
   * The fetch can fail even though the write succeeded. More importantly, a queued request can
   * finish after the user has continued typing. In that case we keep the current rows on screen,
   * rewrite their draft against the newly accepted server version, and deliberately skip reload.
   */
  const settleAcceptedSave = useCallback((
    items: ReturnType<typeof toSaveItems>,
    result: SubmissionSaveResult,
    fallbackBaseVersion: number,
  ): { hasNewerRows: boolean; version: number } => {
    const acceptedRows = rowsFromItems(items);
    const acceptedAt = result.updated_at ?? new Date().toISOString();
    const version = result.version ?? (fallbackBaseVersion + 1);
    const currentRows = rowsRef.current;
    const hasNewerRows = !sameSavePayload(currentRows, items);

    setBaseline(acceptedRows);
    setSavedAt(acceptedAt);
    setEditBaseVersion(version);
    setEditBaseUpdatedAt(acceptedAt);
    setLoaded((current) => current ? {
      ...current,
      status: result.status,
      updatedAt: acceptedAt,
      version,
    } : current);
    setLoadFailed(false);

    if (hasNewerRows) {
      clearQueue();
      draftStore.setItem(
        draftKey,
        writeDraft(currentRows, acceptedAt, Date.now(), version),
      );
    } else {
      dropDraft();
    }
    return { hasNewerRows, version };
  }, [clearQueue, draftKey, dropDraft]);

  /** Lab route only: mirror a completed write in component state without touching Supabase. */
  const applyFixtureSubmission = (
    items: ReturnType<typeof toSaveItems>,
    status: LoadedSubmission['status'],
  ): number => {
    const nextRows = rowsFromItems(items);
    const now = new Date().toISOString();
    const version = Math.max(editBaseVersion, loaded?.version ?? 0) + 1;
    dropDraft();
    setRows(nextRows);
    setBaseline(nextRows);
    setSavedAt(now);
    setEditBaseVersion(version);
    setEditBaseUpdatedAt(now);
    setLoaded({ status, updatedAt: now, finalizedAt: status === 'final' ? now : null, version });
    return version;
  };

  const handleSave = async () => {
    if (!editorWritable || !loaded || savingRef.current) return;
    const items = toSaveItems(rows);
    if (fixtureMode) {
      setSaving(true);
      applyFixtureSubmission(items, loaded.status === 'reopened' ? 'reopened' : 'draft');
      setToast('미리보기에서 저장 상태를 확인했습니다. 운영 DB에는 전송하지 않았습니다.');
      setSaving(false);
      return;
    }
    if (!access) return;
    const requestId = crypto.randomUUID();
    setSaving(true);
    setOperationFailed(false);
    try {
      // ★ 반환값을 버리지 않는다 — 서버가 줄을 나눴는지, 상한 때문에 나누기를 포기했는지가
      //   여기에만 실려 온다(마이그레이션 s15). 버리면 조는 칸이 왜 늘었는지 모른다.
      const result = await submissionSave(access, topic.id, items, {
        expectedVersion: editBaseVersion,
        idempotencyKey: requestId,
      });
      const settled = settleAcceptedSave(items, result, editBaseVersion);
      setToast(settled.hasNewerRows
        ? '누르기 전 내용은 저장했고, 그 뒤에 쓴 내용은 미저장으로 남겨 두었습니다.'
        : saveOutcomeMessage(result));
      if (!settled.hasNewerRows) await loadSubmission();
      announceSubmissionChanged();
    } catch (error) {
      console.warn('[submission] save failed', error);
      const nextConflict = conflictFromSaveError(error);
      if (nextConflict) {
        draftStore.removeItem(qKey);
        setQueued(null);
        setConflict(nextConflict);
        setShowServerRows(true);
        setManualMerge(false);
        setOperationFailed(false);
        setToast('다른 기기에서 먼저 저장했습니다. 두 내용을 확인해 주세요.');
        return;
      }
      // ★ 다시 보내면 될 실패(네트워크 계열)만 큐로 간다. 잠긴 꼭지·마감된 꼭지는
      //   몇 번을 보내도 같은 결과라, 큐에 넣으면 300초마다 영원히 두드리는 소음이 된다.
      const kind = saveFailureKind(error);
      if (kind === 'network' && loaded != null) {
        const q = makeQueuedSave({
          topicId: topic.id,
          items,
          baseVersion: editBaseVersion,
          requestId,
          nowMs: Date.now(),
        });
        draftStore.setItem(qKey, writeQueue(q));
        setQueued(q);
        setConflict(null);
      }
      setOperationFailed(kind !== 'network');
      setToast(saveFailureMessage(kind));
    } finally {
      setSaving(false);
    }
  };

  /**
   * 재전송 한 번 — 설계 §1.3 의 절차를 그대로 따른다.
   *
   * 큐에 보존한 `baseVersion`·`requestId`를 그대로 `submission_save_v3`에 보낸다.
   * 서버의 원자적 버전 비교가 conflict를 돌려주면 자동 전송을 멈추고 조에게 묻는다.
   *
   * `force` 는 「연결이 돌아왔다」·「지금 다시 시도」처럼 **새 정보가 생긴 순간**에만 준다.
   * 그때까지의 백오프는 「연결이 없다」는 추정 위에 잡힌 것이라 더 기다릴 이유가 없다.
   */
  const attempt = useCallback(
    async (q: QueuedSave, force: boolean) => {
      if (fixtureMode || !access) return;
      const now = Date.now();
      const online = typeof navigator === 'undefined' ? true : navigator.onLine !== false;
      if (!online) return; // 오프라인이면 시도 자체를 건너뛴다 — 실패 횟수를 낭비하지 않는다
      if (!force && !shouldAttempt(q, now, online)) return;
      // ★ 손으로 누른 저장이 날아가는 중이면 비킨다. 겹치면 늦게 도착한 쪽이 이기는데,
      //   그게 큐(옛 내용)면 방금 손으로 저장한 새 내용이 서버에서 지워진다.
      //   그 저장이 성공하면 큐째로 없어지고, 실패하면 큐가 새로 얹혀 여기로 다시 온다.
      if (savingRef.current) return;
      const since = attemptingSinceRef.current;
      if (since !== null && now - since < ATTEMPT_LOCK_MS) return;
      attemptingSinceRef.current = now;
      // 보내는 동안은 저장·최종 제출 버튼을 잠근다 — 조가 그 틈에 새 내용을 저장하면
      // 뒤늦게 도착한 큐가 그걸 덮는다(같은 사고의 반대 방향).
      setSaving(true);
      setOperationFailed(false);
      try {
        const result = await submissionSave(access, q.topicId, q.items, {
          expectedVersion: q.baseVersion,
          idempotencyKey: q.requestId,
        });
        const settled = settleAcceptedSave(q.items, result, q.baseVersion);
        if (!settled.hasNewerRows) await loadSubmission();
        announceSubmissionChanged();
        setToast(settled.hasNewerRows
          ? '대기하던 내용은 저장했고, 그 뒤에 쓴 내용은 미저장으로 남겨 두었습니다.'
          : '연결이 돌아와 자동으로 저장했습니다.');
      } catch (error) {
        console.warn('[submission queue] retry failed', error);
        const nextConflict = conflictFromSaveError(error);
        if (nextConflict) {
          setConflict(nextConflict);
          setShowServerRows(true);
          setManualMerge(false);
          setOperationFailed(false);
          return;
        }
        const kind = saveFailureKind(error);
        if (kind !== 'network') {
          // 잠겼거나 마감됐다 — 다시 보내도 같은 결과다. 큐를 놓고 조에게 알린다.
          clearQueue();
          setOperationFailed(true);
          setToast(saveFailureMessage(kind));
          return;
        }
        const next = withFailedAttempt(q, Date.now());
        draftStore.setItem(qKey, writeQueue(next));
        setQueued(next);
      } finally {
        attemptingSinceRef.current = null;
        setSaving(false);
      }
    },
    [access, fixtureMode, qKey, clearQueue, loadSubmission, settleAcceptedSave],
  );

  const saveConflictResolution = async (
    items: ReturnType<typeof toSaveItems>,
    successMessage: string,
  ) => {
    if (!conflict) return;
    if (fixtureMode) {
      applyFixtureSubmission(items, loaded?.status === 'reopened' ? 'reopened' : 'draft');
      setToast(`${successMessage} 운영 DB에는 전송하지 않았습니다.`);
      return;
    }
    if (!access) return;
    const retryRequestId = crypto.randomUUID();
    setSaving(true);
    setOperationFailed(false);
    try {
      const result = await submissionSave(access, topic.id, items, {
        expectedVersion: conflict.serverVersion,
        idempotencyKey: retryRequestId,
        force: true,
      });
      const settled = settleAcceptedSave(items, result, conflict.serverVersion);
      if (!settled.hasNewerRows) await loadSubmission();
      announceSubmissionChanged();
      setToast(settled.hasNewerRows
        ? `${successMessage} 그 뒤에 쓴 내용은 미저장으로 남겨 두었습니다.`
        : successMessage);
    } catch (error) {
      console.warn('[submission conflict] selected resolution failed', error);
      const nextConflict = conflictFromSaveError(error);
      if (nextConflict) {
        // force 저장도 서버가 확인한 version에 대한 CAS다. 선택 뒤 다른 기기가 먼저
        // 저장했다면 최신 서버본으로 대화상자를 갱신하고 다시 판단하게 한다.
        setConflict(nextConflict);
        setShowServerRows(true);
        setManualMerge(false);
        setOperationFailed(false);
        setToast('선택 내용을 저장하는 사이 다른 변경이 반영됐습니다. 최신 서버본을 다시 확인해 주세요.');
        return;
      }
      const kind = saveFailureKind(error);
      if (kind === 'network') {
        // The explicit overwrite may or may not have reached the server. Retry non-forced with a
        // fresh request id: unchanged state saves, while any completed/racing write becomes a
        // visible conflict instead of being overwritten automatically.
        const q = makeQueuedSave({
          topicId: topic.id,
          items,
          baseVersion: conflict.serverVersion,
          requestId: crypto.randomUUID(),
          nowMs: Date.now(),
        });
        draftStore.setItem(qKey, writeQueue(q));
        setQueued(q);
        setConflict(null);
      } else {
        clearQueue();
      }
      setOperationFailed(kind !== 'network');
      setToast(saveFailureMessage(kind));
    } finally {
      setSaving(false);
    }
  };

  /** 충돌을 확인한 사용자가 명시적으로 선택할 때만 내 시도분을 강제 저장한다. */
  const handleOverwrite = async () => {
    if (!conflict) return;
    await saveConflictResolution(toSaveItems(rowsRef.current), '내 내용으로 저장했습니다.');
  };

  /** 서버본을 정본으로 고르면 내 초안·큐를 지우고 화면도 같이 맞춘다. */
  const handleKeepServer = async () => {
    if (!conflict) return;
    const serverRows = conflict.serverRows;
    dropDraft();
    setRows(serverRows);
    setBaseline(serverRows);
    setSavedAt(conflict.serverUpdatedAt);
    setEditBaseVersion(conflict.serverVersion);
    setEditBaseUpdatedAt(conflict.serverUpdatedAt);
    setLoaded((current) => current ? {
      ...current,
      version: conflict.serverVersion,
      updatedAt: conflict.serverUpdatedAt,
    } : current);
    setToast('서버에 있던 내용을 유지했습니다.');
    await loadSubmission();
  };

  const handleManualMergeSave = async () => {
    await saveConflictResolution(toSaveItems(rowsRef.current), '병합한 내용으로 저장했습니다.');
  };

  // 마운트 시 큐 확인 — 탭을 닫았다 다시 연 조는 여기서 대기 중인 건을 되찾는다.
  useEffect(() => {
    const raw = draftStore.getItem(qKey);
    const restored = readQueue(raw);
    if (raw && !restored) draftStore.removeItem(qKey);
    setQueued(restored);
  }, [qKey]);

  /**
   * 큐 워커 — 깨우는 조건 셋 중 둘이 여기 있다(설계 §1.3).
   * ① `nextAttemptAtMs` 타이머 ② `online` 이벤트. ③ 「지금 다시 시도」 버튼은 아래 화면에.
   *
   * 충돌 중에는 돌지 않는다 — 조가 고르기 전에는 보낼 것이 없다.
   */
  useEffect(() => {
    if (fixtureMode || !loaded || !queued || conflict) return;
    const timer = setTimeout(
      () => void attempt(queued, false),
      Math.max(0, queued.nextAttemptAtMs - Date.now()),
    );
    const onOnline = () => void attempt(queued, true);
    window.addEventListener('online', onOnline);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('online', onOnline);
    };
  }, [fixtureMode, loaded, queued, conflict, attempt]);

  /**
   * 다시 열기 — 본부 승인 없이 조가 직접 푼다. 기록은 남는다(actor_scope='team').
   * 행사 중 본부를 부르게 하면 그 조가 몇 분씩 멈춘다.
   */
  const handleReopen = async () => {
    if (!window.confirm('최종 제출을 취소하고 다시 고칠 수 있게 합니다. 내용은 그대로 남습니다.')) return;
    if (fixtureMode) {
      const currentItems = toSaveItems(rowsRef.current);
      applyFixtureSubmission(currentItems, 'reopened');
      setToast('미리보기에서 다시 열었습니다. 운영 DB에는 전송하지 않았습니다.');
      return;
    }
    if (!access) return;
    setReopening(true);
    setOperationFailed(false);
    try {
      await submissionReopenByTeam(access, topic.id);
      setToast('다시 열었습니다. 이어서 고치고 저장하세요.');
      await loadSubmission();
      announceSubmissionChanged();
    } catch (error) {
      console.error('[submission] reopen failed', error);
      setOperationFailed(true);
      setToast(error instanceof Error ? error.message : '다시 열지 못했습니다.');
    } finally {
      setReopening(false);
    }
  };

  /**
   * 최종 제출 — 화면의 내용을 먼저 저장한 뒤 잠근다. 저장 없이 finalize하면
   * 서버에 남은 옛 항목이 잠겨 화면과 다른 내용이 최종본이 된다.
   */
  const handleFinalize = async () => {
    if (!editable || !loaded || savingRef.current) return;
    const items = toSaveItems(rows);
    if (fixtureMode) {
      setFinalizing(true);
      applyFixtureSubmission(items, 'final');
      setToast('미리보기에서 최종 제출 상태를 확인했습니다. 운영 DB에는 전송하지 않았습니다.');
      setFinalizing(false);
      return;
    }
    if (!access) return;
    setFinalizing(true);
    setOperationFailed(false);
    try {
      const result = await submissionSave(access, topic.id, items, {
        expectedVersion: editBaseVersion,
        idempotencyKey: crypto.randomUUID(),
      });
      const settled = settleAcceptedSave(items, result, editBaseVersion);
      if (settled.hasNewerRows) {
        setToast('저장하는 동안 내용이 바뀌어 최종 제출을 멈췄습니다. 새 내용을 확인한 뒤 다시 제출해 주세요.');
        announceSubmissionChanged();
        return;
      }
      await submissionFinalize(access, topic.id, settled.version);
      // 나누지 못한 채 잠겼다면 그 사실이 「제출 완료」보다 먼저 알려져야 한다 —
      // 잠긴 뒤에는 「다시 열기」를 눌러야 고칠 수 있다.
      setToast(
        result?.split_skipped_over_cap
          ? `최종 제출되었습니다. 다만 줄이 ${MAX_SUBMISSION_ROWS}개를 넘어 나누지 못했습니다 — 나누려면 「다시 열기」를 눌러 주세요.`
          : '최종 제출되었습니다.',
      );
      await loadSubmission();
      announceSubmissionChanged();
    } catch (error) {
      console.warn('[submission] finalize failed', error);
      const nextConflict = conflictFromSaveError(error);
      if (nextConflict) {
        setConflict(nextConflict);
        setShowServerRows(true);
        setManualMerge(false);
        setOperationFailed(false);
        setToast('다른 기기의 저장이 먼저 반영돼 최종 제출을 멈췄습니다.');
      } else {
        const kind = saveFailureKind(error);
        setOperationFailed(true);
        setToast(kind === 'network'
          ? '최종 제출에 실패했습니다 — 네트워크를 확인하고 다시 시도해 주세요.'
          : saveFailureMessage(kind));
        // The finalize request may have reached the server even when its response was lost.
        // Reconcile before letting the user retry so an already-final submission is visible.
        await loadSubmission();
      }
    } finally {
      setFinalizing(false);
    }
  };

  return (
    <section
      id={topicAnchorId(topic.id)}
      data-workshop-editor-topic={topic.id}
      tabIndex={-1}
      aria-labelledby={`${topicAnchorId(topic.id)}-title`}
      className="rounded-2xl border border-[#DCE7EE] bg-white overflow-hidden scroll-mt-48 focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-[#1F4E79]"
    >
      <header className="px-5 py-4 bg-[#4F9D3A]/8 border-b border-[#DCE7EE]">
        <div className="flex items-baseline gap-2">
          <span className="text-[22px] font-extrabold text-[#2F6F25]" aria-hidden="true">
            {topic.ordinal}
          </span>
          <h4 id={`${topicAnchorId(topic.id)}-title`} className="text-[21px] font-extrabold text-[#1F4E79] break-words" style={{ letterSpacing: '-.01em' }}>
            {topic.prompt}
          </h4>
          {topic.status === 'closed' ? (
            <span className="ml-auto shrink-0 rounded-full bg-[#5A6B73] px-2.5 py-[3px] text-[13px] font-bold text-white">
              마감
            </span>
          ) : null}
        </div>
        {/* 저장 상태 배지 (설계 §1.4) — 「지금 내 글이 안전한가」.
            ★ 꼭지 **머리**에 둔다. 저장 버튼 옆(맨 아래)에만 두면 긴 꼭지에서는
              스크롤 밖으로 나가 조가 못 본다. 8.29에 실제로 그랬다.
            ★ hover 로만 보이는 정보를 두지 않는다 — 현장은 태블릿·손가락이다.
            불러오는 중에는 내지 않는다(아직 아무 사실도 없다). */}
        {loaded != null || loadFailed ? (
          <p
            role="status"
            aria-live="polite"
            data-save-status={saveStatus.state}
            className={`tr-num mt-2 inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[16px] font-extrabold ${
              saveStatus.tone === 'ok'
                ? 'border-[#4F9D3A]/40 bg-[#4F9D3A]/10 text-[#2F6322]'
                : saveStatus.tone === 'busy'
                  ? 'border-[#1F4E79]/40 bg-[#1F4E79]/10 text-[#1F4E79]'
                  : saveStatus.tone === 'warn'
                    ? 'border-[#F5A623] bg-[#F5A623]/15 text-[#B5651D]'
                    : 'border-[#B22A2A] bg-[#FDECEC] text-[#8B1F1F]'
            }`}
          >
            <span>{saveStatus.label}</span>
          </p>
        ) : null}
        {topic.guidance ? (
          <p className="mt-2 text-[15px] leading-[1.55] text-[#5A6B73] break-words">{topic.guidance}</p>
        ) : null}
      </header>

      <div className="p-4 sm:p-5 space-y-3">
        {loadFailed ? (
          <div className="flex flex-wrap items-center gap-3 rounded-xl border-2 border-[#F5A623] bg-[#F5A623]/10 px-4 py-3">
            <span className="text-[16px] font-extrabold text-[#B5651D] flex-1 min-w-[200px]">
              작성 내용을 불러오지 못했습니다 — 네트워크를 확인해 주세요.
            </span>
            <button
              type="button"
              onClick={() => void loadSubmission()}
              className="min-h-11 rounded-lg border-2 border-[#B5651D] px-4 text-[15px] font-bold text-[#B5651D]"
            >
              지금 다시 시도
            </button>
          </div>
        ) : loaded == null ? (
          <p className="text-[16px] text-[#5A6B73]">불러오는 중…</p>
        ) : (
          <>
            {badge ? (
              <div
                className={`flex items-center gap-2 rounded-xl px-4 py-3 text-[16px] font-extrabold ${
                  badge.tone === 'locked'
                    ? 'bg-[#1F4E79]/8 border border-[#1F4E79]/30 text-[#1F4E79]'
                    : 'bg-[#F5A623]/10 border border-[#F5A623]/40 text-[#B5651D]'
                }`}
              >
                <span aria-hidden="true">{badge.tone === 'locked' ? '🔒' : '🔓'}</span>
                <span>{badge.label}</span>
                {badge.tone === 'locked' && loaded.finalizedAt ? (
                  <span className="text-[14px] font-semibold opacity-80 tr-num">
                    {formatClock(loaded.finalizedAt)}
                  </span>
                ) : null}
              </div>
            ) : null}
            {loaded.status === 'final' ? (
              <div className="flex flex-wrap items-center gap-3">
                <p className="text-[15px] font-semibold text-[#5A6B73]">
                  잘못 눌렀다면 여기서 바로 다시 열 수 있습니다. 내용은 그대로 남습니다.
                </p>
                <button
                  type="button"
                  disabled={reopening}
                  onClick={() => void handleReopen()}
                  className="h-12 rounded-xl border-2 border-[#B5651D] bg-white px-4 text-[16px] font-bold text-[#B5651D] disabled:opacity-40"
                >
                  {reopening ? '여는 중…' : '다시 열기'}
                </button>
              </div>
            ) : null}
            {loaded.status !== 'final' && !topicOpen ? (
              <p className="rounded-xl border border-[#DCE7EE] bg-[#F1F7FA] px-4 py-2.5 text-[15px] font-semibold text-[#5A6B73]">
                이 꼭지는 마감되어 더 이상 저장할 수 없습니다.
              </p>
            ) : null}

            {/* 저장 실패분 — 대기 중이거나, 서버가 더 새것이라 조에게 묻는 중이거나.
                ★ 어느 쪽이든 **글은 이 기기에 남아 있다**는 말을 먼저 한다. 8.29에 조가
                  가장 불안해한 것이 「지금 내 글이 어디 있느냐」였다. */}
            {conflict ? (
              <div
                role="alert"
                className="rounded-xl border-2 border-[#B22A2A] bg-[#FDECEC] px-4 py-3"
              >
                <p className="text-[17px] font-extrabold text-[#8B1F1F]">
                  다른 기기에서 이 꼭지를 먼저 저장했습니다.
                </p>
                <p className="mt-1 text-[15px] font-semibold text-[#8B1F1F]">
                  내 내용으로 서버본을 자동으로 덮어쓰지 않았습니다. 아래 세 가지 중 하나를 골라 주세요.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void handleKeepServer()}
                    disabled={saving}
                    className="h-12 rounded-xl border-2 border-[#B22A2A] bg-white px-5 text-[16px] font-bold text-[#B22A2A] disabled:opacity-40"
                  >
                    서버본 유지
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleOverwrite()}
                    disabled={saving}
                    className="h-12 rounded-xl bg-[#B22A2A] px-5 text-[16px] font-bold text-white disabled:opacity-40"
                  >
                    {saving ? '저장 중…' : '내 내용으로 덮어쓰기'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setManualMerge(true);
                      setShowServerRows(true);
                    }}
                    className="h-12 rounded-xl border-2 border-[#B22A2A] bg-white px-5 text-[16px] font-bold text-[#B22A2A]"
                  >
                    수동 병합
                  </button>
                </div>
                {showServerRows ? (
                  <div className="mt-3 space-y-2 rounded-xl border border-[#E7BDBD] bg-white p-3">
                    <p className="text-[15px] font-bold text-[#8B1F1F] tr-num">
                      {`서버에 저장돼 있는 내용 ${conflict.serverRows.length}줄`}
                    </p>
                    <ol className="space-y-1.5">
                      {conflict.serverRows.map((serverRow, i) => (
                        <li
                          key={i}
                          className="text-[16px] leading-[1.55] text-[#1F2933] break-words"
                        >
                          <span className="font-bold text-[#5A6B73] tr-num">{`${i + 1}. `}</span>
                          {serverRow.name ? (
                            <b className="text-[#1F4E79]">{`${serverRow.name} `}</b>
                          ) : null}
                          {serverRow.content}
                        </li>
                      ))}
                    </ol>
                    <p className="text-[14px] font-semibold text-[#5A6B73]">
                      보기 전용입니다. 필요한 문장을 위 편집 칸에 옮겨 병합한 뒤 아래 버튼으로 저장하세요.
                    </p>
                    {manualMerge ? (
                      <button
                        type="button"
                        onClick={() => void handleManualMergeSave()}
                        disabled={saving}
                        className="min-h-12 w-full rounded-xl bg-[#1F4E79] px-5 text-[16px] font-bold text-white disabled:opacity-40"
                      >
                        {saving ? '저장 중…' : '병합한 내용 저장'}
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : queued ? (
              <div
                role="status"
                className="flex flex-wrap items-center gap-3 rounded-xl border-2 border-[#F5A623] bg-[#FFF4D6] px-4 py-3"
              >
                <span className="flex-1 min-w-[220px]">
                  <span className="block text-[17px] font-extrabold text-[#6B4B00] tr-num">
                    {`저장하지 못한 내용이 대기 중입니다 · ${queued.attempts}번째 시도`}
                  </span>
                  <span className="block text-[15px] font-semibold text-[#6B4B00]">
                    연결되면 자동으로 저장합니다. <b>글은 이 기기에 남아 있습니다.</b>
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => void attempt(queued, true)}
                  className="h-12 shrink-0 rounded-xl border-2 border-[#B5651D] bg-white px-4 text-[16px] font-bold text-[#B5651D]"
                >
                  지금 다시 시도
                </button>
              </div>
            ) : null}

            <div className="space-y-3">
              {rows.map((row, index) => (
                <div key={index} className="rounded-xl border border-[#C4D8E4] p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="w-9 h-9 shrink-0 rounded-lg bg-[#F1F7FA] border border-[#DCE7EE] grid place-items-center text-[16px] font-bold text-[#1F4E79]">
                      {index + 1}
                    </span>
                    {editable ? (
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => setRows((prev) => moveRow(prev, index, -1))}
                          disabled={!editorWritable || index === 0}
                          aria-label={`${topic.prompt} ${index + 1}번 위로`}
                          className="w-11 h-11 rounded-lg border border-[#DCE7EE] text-[#5A6B73] text-lg grid place-items-center disabled:opacity-30 focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-[#1F4E79]"
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          onClick={() => setRows((prev) => moveRow(prev, index, 1))}
                          disabled={!editorWritable || index === rows.length - 1}
                          aria-label={`${topic.prompt} ${index + 1}번 아래로`}
                          className="w-11 h-11 rounded-lg border border-[#DCE7EE] text-[#5A6B73] text-lg grid place-items-center disabled:opacity-30 focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-[#1F4E79]"
                        >
                          ↓
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            if (!editorWritable) return;
                            // 빈 줄은 그냥 지운다. 쓴 게 있을 때만 한 번 묻는다.
                            if (
                              row.content.trim().length > 0 &&
                              !window.confirm(`${index + 1}번 줄을 지웁니다. 되돌릴 수 없습니다.`)
                            ) {
                              return;
                            }
                            setRows((prev) => removeRow(prev, index));
                          }}
                          disabled={!editorWritable}
                          aria-label={`${topic.prompt} ${index + 1}번 삭제`}
                          className="w-11 h-11 rounded-lg border border-[#DCE7EE] text-[#5A6B73] text-xl grid place-items-center focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-[#1F4E79]"
                        >
                          ×
                        </button>
                      </div>
                    ) : null}
                  </div>
                  {/* 이름 칸 — 본문 왼쪽(좁은 화면에서는 위)에 둔다.
                      ★ 비워도 저장된다. 강제하지 않는다 — 8.29에 이름을 하나도 안 적은 조가
                        7건이었는데 문장 품질은 최상급이었다. 막으면 그 조가 멈춘다.
                      저장할 때 `(이름) 내용` 으로 합쳐 보내고 불러올 때 되파싱한다
                      (joinSpeaker / parseSpeaker). DB 형식은 그대로다. */}
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <input
                      type="text"
                      value={row.name}
                      readOnly={!editorWritable}
                      onChange={(e) =>
                        setRows((prev) =>
                          prev.map((r, i) => (i === index ? { ...r, name: e.target.value.slice(0, 20) } : r)),
                        )
                      }
                      aria-label={`${topic.prompt} ${index + 1}번 말한 사람`}
                      placeholder="이름"
                      className={`h-[46px] w-full shrink-0 rounded-xl border px-3 text-[17px] font-bold outline-none sm:w-[132px] ${
                        editorWritable
                          ? 'border-[#C4D8E4] focus:border-[#4F9D3A] focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-[#1F4E79] text-[#1F4E79]'
                          : 'border-[#DCE7EE] bg-[#F5F8FB] text-[#5A6B73]'
                      }`}
                    />
                  <textarea
                    value={row.content}
                    readOnly={!editorWritable}
                    onChange={(e) =>
                      setRows((prev) => prev.map((r, i) => (i === index ? { ...r, content: e.target.value } : r)))
                    }
                    /* 여러 줄을 한 번에 붙이면 줄마다 칸을 만들어 나눠 담는다.
                       조는 대부분 한글·워드에 써 두고 마지막에 옮긴다 — 통째로 한 칸에
                       들어가면 문장 열 개가 1건이 되어 발표 카드도 겹침 판정도 무너진다.
                       한 줄짜리는 손대지 않는다(기본 붙여넣기 유지). */
                    onPaste={(e) => {
                      if (!editorWritable) return;
                      const text = e.clipboardData.getData('text/plain');
                      const split = splitPastedRows(rows, index, text);
                      if (split.dropped > 0 && !split.applied) {
                        e.preventDefault();
                        setToast(`이미 ${MAX_SUBMISSION_ROWS}줄이라 더 넣을 수 없습니다 — ${split.dropped}줄이 들어가지 못했습니다.`);
                        return;
                      }
                      if (!split.applied) return;
                      e.preventDefault();
                      setRows(split.rows);
                      setToast(
                        split.dropped > 0
                          ? `${split.inserted}줄로 나눠 넣었습니다. ${MAX_SUBMISSION_ROWS}줄 상한이라 ${split.dropped}줄은 들어가지 못했습니다 — 확인해 주세요.`
                          : `${split.inserted}줄로 나눠 넣었습니다.`,
                      );
                    }}
                    rows={2}
                    placeholder="여기에 적습니다"
                    className={`w-full min-w-0 flex-1 rounded-xl border px-3 py-2.5 text-[17px] outline-none resize-y ${
                      editorWritable
                        ? 'border-[#C4D8E4] focus:border-[#4F9D3A] focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-[#1F4E79] text-[#1F2933]'
                        : 'border-[#DCE7EE] bg-[#F5F8FB] text-[#5A6B73]'
                    }`}
                  />
                  </div>
                  {/* 「근거 (선택)」 칸은 2026-08-28 통화에서 없애기로 정리됐다.
                      원인·배경을 별도 칸으로 두면 「써야 하나 말아야 하나·어떻게 써야 하나」가
                      또 하나 늘고, 범주를 늘리면 그 자체로 시끄러워진다는 판단이었다.
                      필요한 내용은 세 꼭지 본문에 함께 적는다.
                      ★ DB 열(submission_item.rationale)과 내보내기 처리는 그대로 둔다 —
                      화면에서만 뺀다. 되살릴 일이 생기면 이 블록만 복구하면 된다. */}
                </div>
              ))}
            </div>

            {/* 두 안내가 동시에 뜰 수 있다. 바깥이 space-y-3 이라 세로로 쌓이고
                버튼은 각자 flex-wrap 이라 좁은 화면에서도 겹치지 않는다. */}
            {showNameNotice ? (
              <div
                role="status"
                className="rounded-xl border-2 border-[#B5651D] bg-[#FFF4D6] px-4 py-3"
              >
                <p className="text-[17px] font-extrabold text-[#6B4B00] tr-num">
                  {`이름만 있는 줄이 ${nameOnly.length}개 있습니다.`}
                </p>
                <p className="mt-1 text-[15px] font-semibold text-[#6B4B00]">
                  이름 아래 줄에 내용을 적으면 누가 한 말인지 이어지지 않습니다.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {liftable > 0 ? (
                    <button
                      type="button"
                      onClick={handleLiftNames}
                      disabled={!editorWritable}
                      className="h-12 rounded-xl bg-[#8A4F08] px-5 text-[16px] font-bold text-white disabled:opacity-40"
                    >
                      이름 칸으로 옮기기
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => setNameNoticeAnswered(nameSignature)}
                    className="h-12 rounded-xl border-2 border-[#B5651D] bg-white px-5 text-[16px] font-bold text-[#B5651D]"
                  >
                    이대로 두기
                  </button>
                </div>
              </div>
            ) : null}

            {showLongNotice ? (
              <div
                role="status"
                className="rounded-xl border-2 border-[#B5651D] bg-[#FFF4D6] px-4 py-3"
              >
                <p className="text-[17px] font-extrabold text-[#6B4B00]">
                  {splittable.length > 0
                    ? '여러 분 말씀이 한 칸에 들어간 것 같습니다. 나눠 드릴까요?'
                    : '한 칸이 깁니다 — 한 분 말씀이 맞는지만 봐 주세요.'}
                </p>
                <p className="mt-1 text-[15px] font-semibold text-[#6B4B00] tr-num">
                  {`${LONG_ROW_CHARS}자가 넘는 칸 ${overlong.length}개`}
                  {splittable.length > 0 ? ` · 줄 단위로 나눌 수 있는 칸 ${splittable.length}개` : ''}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {splittable.length > 0 ? (
                    <button
                      type="button"
                      onClick={handleSplitLong}
                      disabled={!editorWritable}
                      className="h-12 rounded-xl bg-[#8A4F08] px-5 text-[16px] font-bold text-white disabled:opacity-40"
                    >
                      줄 단위로 나누기
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => setLongNoticeAnswered(longSignature)}
                    className="h-12 rounded-xl border-2 border-[#B5651D] bg-white px-5 text-[16px] font-bold text-[#B5651D]"
                  >
                    이대로 두기
                  </button>
                </div>
              </div>
            ) : null}

            {editable ? (
              <>
                <button
                  type="button"
                  onClick={() => setRows((prev) => addRow(prev))}
                  disabled={!editorWritable || rows.length >= MAX_SUBMISSION_ROWS}
                  className="w-full h-[52px] rounded-xl border border-dashed border-[#4F9D3A] text-[#2F6322] text-[18px] font-bold flex items-center justify-center gap-2 disabled:opacity-30"
                >
                  <span className="text-2xl leading-none">＋</span> 한 줄 더
                </button>
                {rows.length >= MAX_SUBMISSION_ROWS ? (
                  <p className="mt-2 text-center text-[15px] font-bold text-[#B5651D]">
                    한 꼭지에 최대 {MAX_SUBMISSION_ROWS}줄까지 넣을 수 있습니다.
                  </p>
                ) : null}

                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => void handleSave()}
                    disabled={saving || finalizing || !dirty || conflict != null}
                    className="h-14 rounded-2xl border-2 border-[#4F9D3A] bg-white text-[#2F6322] text-[18px] font-bold disabled:opacity-40"
                  >
                    {saving ? '저장 중…' : '저장'}
                  </button>
                  <button
                    ref={finalizeTriggerRef}
                    type="button"
                    onClick={() => setConfirmFinalize(true)}
                    disabled={saving || finalizing || conflict != null || !canFinalize(rows, loaded.status)}
                    className="h-14 rounded-2xl bg-[#1F4E79] text-white text-[18px] font-bold shadow-sm disabled:opacity-40 focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-[#F5A623]"
                  >
                    {finalizing ? '제출 중…' : '최종 제출'}
                  </button>
                </div>
                <p className="text-[14px] text-[#5A6B73] text-center tr-num">
                  {dirty
                    ? '저장하지 않은 변경이 있습니다.'
                    : savedAt
                      ? `마지막 저장 ${formatClock(savedAt)}`
                      : '아직 저장된 내용이 없습니다.'}
                </p>
              </>
            ) : null}
          </>
        )}
      </div>

      {confirmFinalize ? (
        <div className="fixed inset-0 z-40 bg-[#1F4E79]/55 backdrop-blur-[1px] flex items-center justify-center p-5">
          <div
            ref={finalizeDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={finalizeTitleId}
            aria-describedby={finalizeDescriptionId}
            className="w-full max-w-md bg-white rounded-2xl border border-[#DCE7EE] overflow-hidden shadow-2xl"
          >
            <div className="px-6 pt-6 pb-5 text-center">
              <div
                className="w-14 h-14 mx-auto rounded-2xl bg-[#1F4E79]/10 border border-[#1F4E79]/30 grid place-items-center text-3xl mb-4"
                aria-hidden="true"
              >
                🔒
              </div>
              <Eyebrow className="text-[#1F4E79] mb-2">Confirm</Eyebrow>
              <h4
                id={finalizeTitleId}
                className="text-[22px] font-extrabold text-[#1F4E79] leading-snug mb-1"
                style={{ letterSpacing: '-.01em' }}
              >
                최종 제출할까요?
              </h4>
              <p className="text-[16px] font-bold text-[#4F9D3A] mb-3 break-words">{topic.prompt}</p>
              {/* ★ 문구는 상수 하나에서만 나온다. 여기에 문자열을 다시 적으면 상수를
                  검사하는 테스트가 화면에 안 나가는 것을 재게 된다(예전에 그랬다). */}
              <p id={finalizeDescriptionId} className="text-[18px] font-bold text-[#1F2933] leading-relaxed">
                {FINALIZE_CONFIRM_MESSAGE}
              </p>
              <p className="text-[15px] text-[#5A6B73] mt-3 tr-num">
                지금 화면의 내용 {toSaveItems(rows).length}건이 그대로 제출됩니다.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3 p-5 pt-0">
              <button
                type="button"
                onClick={() => setConfirmFinalize(false)}
                className="h-[56px] rounded-2xl border border-[#C4D8E4] bg-white text-[#1F4E79] text-[19px] font-bold focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-[#1F4E79]"
              >
                더 다듬기
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfirmFinalize(false);
                  void handleFinalize();
                }}
                className="h-[56px] rounded-2xl bg-[#1F4E79] text-white text-[19px] font-bold shadow-sm focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-[#F5A623]"
              >
                최종 제출
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {toast ? (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-[#1F4E79] text-white text-[16px] font-bold rounded-full px-5 py-3 shadow-lg">
          {toast}
        </div>
      ) : null}
    </section>
  );
}

/**
 * 작성 매뉴얼 — 꼭지가 아직 안 열렸을 때도 보여야 한다. 조 모더레이터가 시작 전에
 * 읽어 두는 것이 이 화면의 절반이기 때문이다. 기본은 펼침이고 접으면 그 상태가 유지된다.
 */
function SubmissionGuide() {
  const [open, setOpen] = useState(() => {
    try {
      return sessionStorage.getItem('climate_vote_guide_collapsed') !== '1';
    } catch (error) {
      console.warn('[submission guide] preference storage unavailable', error);
      return true;
    }
  });
  const toggle = () => {
    const next = !open;
    setOpen(next);
    try {
      sessionStorage.setItem('climate_vote_guide_collapsed', next ? '0' : '1');
    } catch (error) {
      console.warn('[submission guide] preference storage unavailable', error);
    }
  };

  return (
    <section className="rounded-2xl border border-[#C4D8E4] bg-[#F1F7FA] overflow-hidden">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="w-full flex items-center gap-3 px-5 py-4 text-left"
      >
        <span className="text-[22px]" aria-hidden="true">📖</span>
        <span className="flex-1 min-w-0">
          <span className="block text-[19px] font-extrabold text-[#1F4E79]">작성 안내</span>
          <span className="block text-[14px] text-[#5A6B73]">시작 전에 한 번 읽어 주세요</span>
        </span>
        <span
          className={`h-3 w-3 shrink-0 border-b-2 border-r-2 border-[#5A6B73] transition-transform ${open ? 'rotate-45 -translate-y-0.5' : '-rotate-45 -translate-x-0.5'}`}
          aria-hidden="true"
        />
      </button>
      {open ? (
        <ol className="px-5 pb-5 space-y-3">
          {SUBMISSION_GUIDE.map((item, index) => (
            <li key={item.title} className="flex gap-3">
              <span className="w-7 h-7 shrink-0 rounded-lg bg-white border border-[#C4D8E4] grid place-items-center text-[14px] font-bold text-[#1F4E79] tr-num">
                {index + 1}
              </span>
              <span className="min-w-0">
                <span className="block text-[16px] font-bold text-[#1F2933]">{item.title}</span>
                <span className="block text-[15px] leading-[1.6] text-[#5A6B73]">{item.body}</span>
              </span>
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}

/** 꼭지 바로가기 — 세 구역이 세로로 길어 위아래로 오갈 일이 잦다. */
function TopicJump({ topics }: { topics: readonly Topic[] }) {
  const jump = (topicId: string) => {
    const target = document.getElementById(topicAnchorId(topicId));
    target?.focus({ preventScroll: true });
    target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  return (
    <nav aria-label="꼭지 바로가기" className="flex flex-wrap gap-2">
      {topics.map((topic) => (
        <button
          key={topic.id}
          type="button"
          onClick={() => jump(topic.id)}
          className="h-12 rounded-xl border border-[#C4D8E4] bg-white px-4 text-[16px] font-bold text-[#1F4E79] active:scale-[.99] transition focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-[#1F4E79]"
        >
          <span className="mr-1.5 text-[#2F6F25]" aria-hidden="true">{topic.ordinal}.</span>
          {topic.prompt}
        </button>
      ))}
    </nav>
  );
}

/**
 * 우리 조 산출물 내려받기.
 *
 * 본부 보드와 **같은 모델·같은 문서**를 쓴다(submission-report.ts). 조가 받아 본 문서와
 * 본부가 받아 본 문서의 형식이 갈리면, 같은 내용을 두고 어느 쪽이 맞는지 다투게 된다.
 *
 * 조 콘솔에는 본부 취합 RPC가 없으므로, 각 꼭지의 submission_get 결과를 모아
 * 본부 보드와 같은 행 모양(HqSubmissionRow)으로 바꾼 뒤 같은 빌더에 넣는다.
 */
function TeamDownload({
  access,
  fixtureMode = false,
  teamId,
  teamLabel,
  tableNo,
  topics,
  fixtureSubmissions,
}: {
  access: WorkshopAccess | null;
  /** Lab route only. When true, collect exclusively from fixtureSubmissions. */
  fixtureMode?: boolean;
  teamId: string;
  teamLabel: string;
  /** 현장 좌석 번호 — 내려받은 표의 「테이블」 칸에 들어간다. */
  tableNo?: string | null;
  topics: readonly Topic[];
  /**
   * 꼭지 id → 픽스처 제출물. 주면 `submission_get` 을 부르지 않는다.
   *
   * ★ 인쇄 문서는 **버튼을 누르기 전부터** 만들어 둔다(아래 useEffect). 그래서 이 값을
   *   안 받으면 픽스처 라우트가 화면을 여는 것만으로 운영 DB 로 읽기를 보낸다.
   */
  fixtureSubmissions?: Record<string, SubmissionGetResult>;
}) {
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 인쇄 전용 문서. 화면에는 안 보이고 종이에만 나간다.
  const [printReport, setPrintReport] = useState<SubmissionReport | null>(null);
  /**
   * 개별 형식을 몇 번 눌렀는가. 브라우저의 「여러 파일 내려받기」 차단은 **조용해서**
   * (`a.click()` 이 그대로 성공한다) 실패를 감지할 수 없다 — 누른 횟수만 세어 안내를 띄운다.
   */
  const [individualDownloads, setIndividualDownloads] = useState(0);

  const collect = async (): Promise<HqSubmissionRow[]> => {
    const rows: HqSubmissionRow[] = [];
    for (const topic of topics) {
      let got: SubmissionGetResult;
      if (fixtureMode) {
        got = fixtureSubmissions?.[topic.id] ?? { status: null, version: 0, items: [] };
      } else {
        if (!access) throw new Error('Workshop authorization is unavailable');
        got = await submissionGet(access, topic.id);
      }
      const items = got?.items ?? [];
      const base = {
        topic_id: topic.id,
        topic_ordinal: topic.ordinal,
        topic_prompt: topic.prompt,
        topic_status: topic.status,
        team_id: teamId,
        team_name: teamLabel,
        team_subgroup: null,
        table_no: tableNo ?? null,
        submission_id: null,
        submission_status: got?.status ?? null,
        submission_version: got?.version ?? null,
        submission_updated_at: got?.updated_at ?? null,
        submission_finalized_at: got?.finalized_at ?? null,
      } as const;
      if (items.length === 0) {
        rows.push({ ...base, item_ordinal: null, item_kind: null, item_content: null, item_rationale: null });
        continue;
      }
      for (const it of items) {
        rows.push({
          ...base,
          item_ordinal: it.ordinal,
          item_kind: it.kind,
          item_content: it.content,
          item_rationale: it.rationale,
        });
      }
    }
    return rows;
  };

  const save = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  /**
   * 인쇄 — 저장된 내용으로 문서를 만들어 그것만 찍는다.
   * 화면을 그대로 찍으면 안내문·빈 칸·버튼이 종이에 나온다.
   */
  /** 저장된 내용으로 인쇄 문서를 다시 만든다. 실패해도 화면은 그대로 둔다. */
  const refreshPrintReport = useCallback(async () => {
    try {
      setPrintReport(
        buildSubmissionReport(buildBoards(await collect()), {
          generatedAt: formatStamp(new Date()),
          scopeLabel: teamLabel,
        }),
      );
    } catch (caught) {
      console.error('[조 산출물 인쇄] 문서 준비 실패', caught);
    }
    // collect 는 topics·access·teamId 에만 기대므로 의존성을 그 셋으로 좁힌다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [access, fixtureMode, teamId, teamLabel, topics, fixtureSubmissions]);

  // 인쇄 문서는 **버튼을 누르기 전부터 DOM에 있어야 한다.**
  // 눌러야 만들어지게 두면 Ctrl+P·브라우저 인쇄 메뉴로 찍을 때 드러낼 것이 없어
  // 백지가 나간다 — 실제로 4쪽 전부 빈 종이가 나왔다.
  useEffect(() => {
    void refreshPrintReport();
    const onChanged = () => void refreshPrintReport();
    window.addEventListener(SUBMISSION_CHANGED, onChanged);
    return () => window.removeEventListener(SUBMISSION_CHANGED, onChanged);
  }, [refreshPrintReport]);

  /**
   * 인쇄 — 저장된 내용으로 문서를 다시 만든 뒤 그것만 찍는다.
   * 화면을 그대로 찍으면 안내문·빈 칸·버튼이 종이에 나온다.
   */
  const doPrint = async () => {
    setBusy(true);
    setError(null);
    try {
      await refreshPrintReport();
      setOpen(false);
      // 문서가 DOM에 붙은 다음에 인쇄창을 연다.
      await new Promise((resolve) => setTimeout(resolve, 150));
      window.print();
    } catch (caught) {
      console.error('[조 산출물 인쇄] 실패', caught);
      setError('인쇄 문서를 만들지 못했습니다 — 저장한 뒤 다시 시도해 주세요.');
    } finally {
      setBusy(false);
    }
  };

  /** 저장된 내용으로 보고서 모델을 만든다. 개별 내려받기와 「전부 받기」가 같은 문서를 쓰게 하는 자리다. */
  const buildReport = async (at: Date): Promise<SubmissionReport> =>
    buildSubmissionReport(buildBoards(await collect()), {
      generatedAt: formatStamp(at),
      scopeLabel: teamLabel,
    });

  const download = async (kind: 'docx' | 'csv' | 'txt') => {
    setBusy(true);
    setError(null);
    try {
      const report = await buildReport(new Date());
      if (kind === 'docx') save(await submissionReportBlob(report), reportFileName(report, 'docx'));
      else if (kind === 'csv')
        save(new Blob([reportToCsv(report)], { type: 'text/csv;charset=utf-8' }), reportFileName(report, 'csv'));
      else
        save(new Blob([reportToText(report)], { type: 'text/plain;charset=utf-8' }), reportFileName(report, 'txt'));
      setIndividualDownloads((n) => n + 1);
      setOpen(false);
    } catch (caught) {
      console.error('[조 산출물 내려받기] 실패', caught);
      setError('내려받지 못했습니다 — 저장한 뒤 다시 시도해 주세요.');
    } finally {
      setBusy(false);
    }
  };

  /**
   * 전부 받기 — 워드·엑셀·줄글을 ZIP 하나로 묶어 **다운로드 한 개**로 내보낸다.
   *
   * 세 형식을 연달아 누르면 브라우저가 「여러 파일 내려받기」를 물으며 두 번째부터 막을 수 있다.
   * `zip-store.ts` 가 45장 결과 이미지에서 쓴 것과 같은 우회다 — 한 파일이면 그 경계에 닿지 않는다.
   *
   * 세 파일은 **한 보고서 모델**에서 나온다. 형식마다 따로 만들면 시각이 갈려
   * 압축 안에서 파일명·머리글의 시각이 서로 다른 문서가 된다.
   */
  const downloadBundle = async () => {
    setBusy(true);
    setError(null);
    try {
      const at = new Date();
      const report = await buildReport(at);
      const docx = new Uint8Array(await (await submissionReportBlob(report)).arrayBuffer());
      const entries = buildTeamBundleEntries(report, {
        docx,
        csv: reportToCsv(report),
        txt: reportToText(report),
      });
      save(
        new Blob([buildZipArchive(entries, at)], { type: 'application/zip' }),
        teamBundleFileName(report)
      );
      setOpen(false);
    } catch (caught) {
      console.error('[조 산출물 전부 받기] 실패', caught);
      setError('내려받지 못했습니다 — 저장한 뒤 다시 시도해 주세요.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-2xl border border-[#DCE7EE] bg-white p-4 print:hidden">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h4 className="text-[17px] font-extrabold text-[#1F4E79]">우리 조 산출물 내려받기</h4>
          <p className="text-[14px] text-[#5A6B73]">
            저장한 내용을 그대로 받습니다. 아직 저장하지 않은 글은 담기지 않습니다.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="h-12 rounded-xl border border-[#C4D8E4] bg-white px-4 text-[16px] font-bold text-[#1F4E79]"
        >
          내려받기 ▾
        </button>
      </div>
      {open ? (
        <div className="mt-3 grid gap-2 sm:grid-cols-4">
          {/* 세 형식이 한 파일로 떨어진다 — 여러 개를 받을 때의 기본 동선이라 맨 앞·가로 전체다. */}
          <button
            type="button"
            data-testid="team-download-zip"
            disabled={busy}
            onClick={() => void downloadBundle()}
            className="h-14 rounded-xl bg-[#1F4E79] px-4 text-[17px] font-extrabold text-white disabled:opacity-40 sm:col-span-4"
          >
            전부 받기 (.zip)
            <span className="mt-0.5 block text-[13px] font-normal text-[#DCE7EE]">
              워드·엑셀·줄글 세 파일을 한 번에
            </span>
          </button>
          <button type="button" disabled={busy} onClick={() => void download('docx')}
            className="h-12 rounded-xl border border-[#C4D8E4] text-[15px] font-bold text-[#1F4E79] disabled:opacity-40">
            워드 (.docx)
          </button>
          <button type="button" disabled={busy} onClick={() => void download('csv')}
            className="h-12 rounded-xl border border-[#C4D8E4] text-[15px] font-bold text-[#1F4E79] disabled:opacity-40">
            엑셀 (.csv)
          </button>
          <button type="button" disabled={busy} onClick={() => void download('txt')}
            className="h-12 rounded-xl border border-[#C4D8E4] text-[15px] font-bold text-[#1F4E79] disabled:opacity-40">
            줄글 (.txt)
          </button>
          <button type="button" disabled={busy} onClick={() => void doPrint()}
            className="h-12 rounded-xl border border-[#C4D8E4] text-[15px] font-bold text-[#1F4E79] disabled:opacity-40">
            인쇄 · PDF로 저장
            <span className="mt-0.5 block text-[12px] font-normal text-[#5A6B73]">
              인쇄창에서 프린터 또는 「PDF로 저장」을 고르세요
            </span>
          </button>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="mt-3 rounded-lg bg-[#FFF4D6] px-3 py-2 text-[14px] font-bold text-[#6B4B00]">
          {error}
        </p>
      ) : null}
      {/*
        메뉴가 접힌 뒤에도 보이도록 `open` 밖에 둔다 — 내려받기를 누르면 메뉴가 닫히므로
        메뉴 안에 두면 정작 안내가 필요한 순간에 화면에서 사라진다.
      */}
      {shouldShowMultiDownloadHint(individualDownloads) ? (
        <p
          data-testid="team-download-multi-hint"
          className="mt-3 rounded-lg bg-[#EAF3F8] px-3 py-2 text-[14px] font-bold text-[#1F4E79]"
        >
          {MULTI_DOWNLOAD_HINT}
        </p>
      ) : null}
      {printReport ? <PrintableReport report={printReport} /> : null}
    </section>
  );
}

export default function SubmissionPanel({
  access,
  storageScope,
  teamLabel,
  tableNo,
  topics: sessionTopics,
  topicsFailed = false,
  onRetryTopics,
  fixtureTopics,
  fixtureSubmissions,
  fixtureMode = false,
  onUnsavedTopicsChange,
  onWorkSummaryChange,
}: {
  /** 실제 조 화면은 기기 세션의 불투명 토큰만 받는다. */
  access?: WorkshopAuthorization | null;
  /** 초안·큐 키에 쓰는 team.id. 접속코드·토큰을 넣지 않는다. */
  storageScope?: string;
  /** 내려받은 문서에 찍을 조 이름. 없으면 「우리 조」. */
  teamLabel?: string;
  /** 현장 좌석 번호. 내려받은 표의 「테이블」 칸에 들어간다. */
  tableNo?: string | null;
  /** HomeScreen의 단일 세션 상태에서 받은 꼭지 목록. 이 패널은 topic_list를 호출하지 않는다. */
  topics?: readonly Topic[] | null;
  /** 최초 목록을 아직 한 번도 받지 못한 채 재시도 중인가. */
  topicsFailed?: boolean;
  /** 공통 세션 상태를 즉시 다시 읽는 버튼 동작. */
  onRetryTopics?: () => void;
  /**
   * 픽스처 꼭지 목록. 주면 `topic_list` 를 부르지 않는다.
   *
   * 조 화면은 접속코드 뒤에 있어 브라우저 자동 검증이 불가능하고, 운영 DB 를 부르는
   * 것도 금지다. `HqSubmissionBoard` 의 `fixtureRows` 와 같은 관례로 네트워크를 건너뛴다
   * (`src/pages/[lang]/moderator/insights/submission-panel-lab.astro`).
   */
  fixtureTopics?: Topic[];
  /** 꼭지 id → 픽스처 제출물. 주면 그 꼭지는 `submission_get` 을 부르지 않는다. */
  fixtureSubmissions?: Record<string, SubmissionGetResult>;
  /** Lab route 전용 무네트워크 모드. fixture data가 있어도 이 값 없이는 live 대체로 쓰지 않는다. */
  fixtureMode?: boolean;
  /**
   * 저장 안 한 내용이 있는 꼭지 id 목록. 마감 배너(`DeadlineBanner`)가 받아 쓴다.
   *
   * 배너는 탭 **바깥**에 있어 이 패널의 형제다. 그래서 사실을 아는 쪽(여기)이 위로 올린다.
   */
  onUnsavedTopicsChange?: (topicIds: string[]) => void;
  /** 상단 상태 레일에 전달할 꼭지별 작업 요약. */
  onWorkSummaryChange?: (summary: WorkshopWorkSummary) => void;
}) {
  const topics = fixtureMode ? (fixtureTopics ?? []) : (sessionTopics ?? null);
  const activeStorageScope = storageScope ?? (fixtureMode ? 'fixture' : null);
  // 열어 둔 화면이 옛 코드인가 — 8.29 통짜 6건의 유력 원인이다. 조가 입력하는 화면이라
  // 여기(작성 탭)에 띄운다. 다른 탭에도 띄우려면 ModConsole 로 올려야 한다(이번 범위 밖).
  const staleBundle = useStaleBundle();

  // 꼭지 편집기들이 아는 사실을 한 맵으로 모은다. 패널이 숨겨져도 HomeScreen은 마지막
  // 요약을 유지하므로 다른 탭에서도 미저장·대기·충돌 상태가 사라지지 않는다.
  const [workByTopic, setWorkByTopic] = useState<Record<string, TopicWorkState>>({});
  const handleWorkStateChange = useCallback((topicId: string, next: TopicWorkState) => {
    setWorkByTopic((current) => {
      const previous = current[topicId];
      if (
        previous &&
        previous.unsaved === next.unsaved &&
        previous.queued === next.queued &&
        previous.conflict === next.conflict &&
        previous.saving === next.saving &&
        previous.failed === next.failed
      ) {
        return current;
      }
      return { ...current, [topicId]: next };
    });
  }, []);
  const workSummary = useMemo(() => summarizeTopicWork(workByTopic), [workByTopic]);
  useEffect(() => {
    onUnsavedTopicsChange?.(workSummary.unsavedTopicIds);
    onWorkSummaryChange?.(workSummary);
  }, [onUnsavedTopicsChange, onWorkSummaryChange, workSummary]);

  // 지난 회차 초안 청소 — 패널이 처음 뜰 때 한 번. `localStorage` 로 올라가면서
  // 초안이 기기에 눌러앉게 됐으므로, 유효기간(72h)이 지난 것은 여기서 버린다.
  // ★ 만료분만 지운다. 살아 있는 초안을 지우면 조가 쓰던 글을 대신 버리는 셈이다.
  useEffect(() => {
    const now = Date.now();
    for (const key of staleKeys(draftStore.keys(), (k) => draftStore.getItem(k), now)) {
      draftStore.removeItem(key);
    }
  }, []);

  if ((!fixtureMode && !access) || !activeStorageScope) {
    return <p className="text-[16px] text-[#5A6B73]">조 접속 후에 사용할 수 있습니다.</p>;
  }

  if (topicsFailed && topics == null) {
    return (
      <div className="flex flex-wrap items-center gap-3 rounded-xl border-2 border-[#F5A623] bg-[#F5A623]/10 px-4 py-3">
        <span className="text-[16px] font-extrabold text-[#B5651D] flex-1 min-w-[200px]">
          작성 화면을 불러오지 못했습니다 — 네트워크를 확인해 주세요.
        </span>
        <button
          type="button"
          onClick={onRetryTopics}
          className="min-h-11 rounded-lg border-2 border-[#B5651D] px-4 text-[15px] font-bold text-[#B5651D]"
        >
          지금 다시 시도
        </button>
      </div>
    );
  }

  if (topics == null) {
    return <p className="text-[16px] text-[#5A6B73]">불러오는 중…</p>;
  }

  // 준비 전에도 매뉴얼은 보여 준다 — 시작 전에 읽어 두는 것이 이 화면의 절반이다.
  if (topics.length === 0) {
    return (
      <div className="space-y-5">
        {staleBundle ? <StaleBundleBanner /> : null}
        <SubmissionGuide />
        <div className="rounded-2xl border border-[#DCE7EE] bg-[#F5F8FB] px-5 py-8 text-center">
          <p className="text-[17px] font-bold text-[#1F4E79]">작성 화면 준비 중입니다.</p>
          <button
            type="button"
            onClick={onRetryTopics}
            className="mt-4 min-h-12 rounded-xl border border-[#C4D8E4] bg-white px-5 text-[16px] font-bold text-[#1F4E79]"
          >
            새로고침
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {staleBundle ? <StaleBundleBanner /> : null}
      <SubmissionGuide />
      <TopicJump topics={topics} />
      {topics.map((topic) => (
        <TopicSection
          key={topic.id}
          access={access ?? null}
          fixtureMode={fixtureMode}
          storageScope={activeStorageScope}
          topic={topic}
          fixtureSubmission={fixtureSubmissions?.[topic.id]}
          onWorkStateChange={handleWorkStateChange}
        />
      ))}
      <TeamDownload
        access={access ?? null}
        fixtureMode={fixtureMode}
        teamId={activeStorageScope}
        teamLabel={teamLabel ?? '우리 조'}
        tableNo={tableNo}
        topics={topics}
        fixtureSubmissions={fixtureSubmissions}
      />
    </div>
  );
}
