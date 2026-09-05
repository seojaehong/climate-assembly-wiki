import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { topicList, type Topic, type WorkshopAccess } from '../../lib/deliberation';
import { clockOffsetMs } from './topic-countdown';

/** 정상 상태에서도 꼭지 개방·마감 변경을 놓치지 않는 현장 폴링 주기. */
export const WORKSHOP_POLL_MS = 5_000;
const RETRY_DELAYS_MS = [5_000, 10_000, 20_000, 30_000] as const;

export type WorkshopConnection = 'idle' | 'online' | 'retrying' | 'offline';

export type WorkshopSessionState = {
  /** 마지막으로 정상 수신한 목록. 재조회 실패 때도 지우지 않는다. */
  topics: Topic[] | null;
  /** 서버 시각 - 기기 시각. DeadlineBanner와 같은 스냅샷에서 나온 값이다. */
  serverClockOffsetMs: number;
  lastSyncedAtMs: number | null;
  connection: WorkshopConnection;
  syncing: boolean;
  consecutiveFailures: number;
  newTopicIds: string[];
  newTopicAnnouncement: string | null;
};

export type TopicWorkState = {
  unsaved: boolean;
  queued: boolean;
  conflict: boolean;
  saving: boolean;
  failed: boolean;
};

export type WorkshopWorkSummary = {
  unsavedTopicIds: string[];
  unsaved: number;
  queued: number;
  conflicts: number;
  saving: number;
  failed: number;
};

export const EMPTY_WORKSHOP_WORK_SUMMARY: WorkshopWorkSummary = {
  unsavedTopicIds: [],
  unsaved: 0,
  queued: 0,
  conflicts: 0,
  saving: 0,
  failed: 0,
};

/** 첫 실패부터 5/10/20/30초, 그 뒤에는 30초로 고정한다. */
export function retryDelayMs(consecutiveFailures: number): number {
  if (!Number.isFinite(consecutiveFailures) || consecutiveFailures <= 1) return RETRY_DELAYS_MS[0];
  const index = Math.min(Math.floor(consecutiveFailures) - 1, RETRY_DELAYS_MS.length - 1);
  return RETRY_DELAYS_MS[index];
}

/** `previousIds === null`은 최초 정상 로드라 알리지 않는다. */
export function addedTopics(previousIds: readonly string[] | null, next: readonly Topic[]): Topic[] {
  if (previousIds === null) return [];
  const seen = new Set(previousIds);
  return next.filter((topic) => !seen.has(topic.id));
}

const ORDINAL_MARKS = ['①', '②', '③', '④', '⑤', '⑥'];

const TEXT_INPUT_TYPES = new Set(['text', 'search', 'email', 'url', 'tel', 'password', 'number']);
export const EDITOR_SCROLL_SETTLE_FRAMES = 6;

export type EditorScrollRestoration = {
  /** React가 신규 꼭지를 DOM에 반영한 직후, paint 전에 호출한다. */
  restoreAfterCommit: () => void;
  cancel: () => void;
};

/** Only an actively edited text control warrants restoring the exact workshop scroll position. */
export function isTextEditingControl(
  tagName: string,
  inputType: string | null,
  contentEditable: boolean,
): boolean {
  if (contentEditable) return true;
  if (tagName.toUpperCase() === 'TEXTAREA') return true;
  return tagName.toUpperCase() === 'INPUT' && TEXT_INPUT_TYPES.has((inputType ?? 'text').toLowerCase());
}

/**
 * Preserve the user's exact viewport while React inserts a newly opened topic.
 *
 * This is intentionally narrower than a general scroll lock: it runs only when focus is inside a
 * workshop text editor, and any wheel/touch/pointer or page-key intent cancels it. React의 layout
 * effect에서 먼저 복원하고, 짧은 settle 구간 동안 후속 layout shift도 같은 위치로 되돌린다.
 */
export function preserveEditorScrollAfterTopicInsertion(): EditorScrollRestoration {
  const noop = () => undefined;
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return { restoreAfterCommit: noop, cancel: noop };
  }
  const active = document.activeElement;
  if (!(active instanceof HTMLElement) || !active.closest('[data-workshop-editor-topic]')) {
    return { restoreAfterCommit: noop, cancel: noop };
  }
  const inputType = active instanceof HTMLInputElement ? active.type : null;
  if (!isTextEditingControl(active.tagName, inputType, active.isContentEditable)) {
    return { restoreAfterCommit: noop, cancel: noop };
  }

  const scrollX = window.scrollX;
  const scrollY = window.scrollY;
  let cancelled = false;
  let settleFrame: number | null = null;
  let framesRemaining = EDITOR_SCROLL_SETTLE_FRAMES;

  const removeIntentListeners = () => {
    window.removeEventListener('wheel', cancelForUserIntent, true);
    window.removeEventListener('touchmove', cancelForUserIntent, true);
    window.removeEventListener('pointerdown', cancelForUserIntent, true);
    window.removeEventListener('keydown', cancelForPageKey, true);
    window.removeEventListener('scroll', restoreAfterCommit, true);
  };
  const cancel = () => {
    cancelled = true;
    if (settleFrame !== null) window.cancelAnimationFrame(settleFrame);
    settleFrame = null;
    removeIntentListeners();
  };
  function cancelForUserIntent() {
    cancel();
  }
  function cancelForPageKey(event: KeyboardEvent) {
    if (event.key === 'PageUp' || event.key === 'PageDown') cancel();
  }
  function restoreAfterCommit() {
    if (cancelled || document.activeElement !== active) return;
    if (window.scrollX !== scrollX || window.scrollY !== scrollY) {
      window.scrollTo(scrollX, scrollY);
    }
  }
  function settle() {
    settleFrame = null;
    restoreAfterCommit();
    framesRemaining -= 1;
    if (cancelled || framesRemaining <= 0) {
      removeIntentListeners();
      return;
    }
    settleFrame = window.requestAnimationFrame(settle);
  }

  window.addEventListener('wheel', cancelForUserIntent, { capture: true, passive: true });
  window.addEventListener('touchmove', cancelForUserIntent, { capture: true, passive: true });
  window.addEventListener('pointerdown', cancelForUserIntent, { capture: true, passive: true });
  window.addEventListener('keydown', cancelForPageKey, true);
  // CSS·폰트·브라우저 scroll anchoring이 commit 뒤 한두 frame 늦게 움직이는 경우도 잡는다.
  window.addEventListener('scroll', restoreAfterCommit, true);
  settleFrame = window.requestAnimationFrame(settle);
  return { restoreAfterCommit, cancel };
}

export function topicAnnouncement(topics: readonly Topic[]): string | null {
  if (topics.length === 0) return null;
  if (topics.length === 1) {
    const item = topics[0];
    const mark = ORDINAL_MARKS[item.ordinal - 1] ?? String(item.ordinal);
    return `새 꼭지${mark}가 열렸습니다.`;
  }
  return `새 꼭지 ${topics.length}개가 열렸습니다.`;
}

/**
 * 편집기 관점에서 같은 꼭지 목록인가. `server_now`는 매 응답마다 달라지는 응답 메타데이터라
 * 비교에서 뺀다. 참조를 보존해야 TeamDownload가 5초마다 제출물 전체를 다시 읽지 않는다.
 */
export function sameWorkshopTopics(left: readonly Topic[] | null, right: readonly Topic[]): boolean {
  if (left === null || left.length !== right.length) return false;
  return left.every((topic, index) => {
    const next = right[index];
    return (
      topic.id === next.id &&
      topic.ordinal === next.ordinal &&
      topic.block === next.block &&
      topic.prompt === next.prompt &&
      topic.guidance === next.guidance &&
      topic.status === next.status &&
      topic.deadline_at === next.deadline_at
    );
  });
}

export function summarizeTopicWork(states: Readonly<Record<string, TopicWorkState>>): WorkshopWorkSummary {
  const summary: WorkshopWorkSummary = {
    unsavedTopicIds: [],
    unsaved: 0,
    queued: 0,
    conflicts: 0,
    saving: 0,
    failed: 0,
  };

  for (const [topicId, state] of Object.entries(states).sort(([a], [b]) => a.localeCompare(b))) {
    if (state.unsaved) {
      summary.unsaved += 1;
      summary.unsavedTopicIds.push(topicId);
    }
    if (state.queued) summary.queued += 1;
    if (state.conflict) summary.conflicts += 1;
    if (state.saving) summary.saving += 1;
    if (state.failed) summary.failed += 1;
  }
  return summary;
}

export function sessionAfterSuccessfulSync(
  current: WorkshopSessionState,
  topics: Topic[],
  syncedAtMs: number,
  newlyAdded: readonly Topic[],
): WorkshopSessionState {
  const serverNow = topics.find((topic) => topic.server_now)?.server_now;
  const stableTopics = sameWorkshopTopics(current.topics, topics) ? current.topics : topics;
  return {
    ...current,
    topics: stableTopics,
    serverClockOffsetMs:
      serverNow === undefined
        ? current.serverClockOffsetMs
        : clockOffsetMs(serverNow, syncedAtMs),
    lastSyncedAtMs: syncedAtMs,
    connection: 'online',
    syncing: false,
    consecutiveFailures: 0,
    newTopicIds:
      newlyAdded.length > 0 ? newlyAdded.map((topic) => topic.id) : current.newTopicIds,
    newTopicAnnouncement:
      newlyAdded.length > 0 ? topicAnnouncement(newlyAdded) : current.newTopicAnnouncement,
  };
}

/** 실패는 연결 표지만 바꾸고, 마지막 정상 topics·시각·오프셋은 그대로 둔다. */
export function sessionAfterFailedSync(
  current: WorkshopSessionState,
  consecutiveFailures: number,
  browserOffline: boolean,
): WorkshopSessionState {
  return {
    ...current,
    connection: browserOffline ? 'offline' : 'retrying',
    syncing: false,
    consecutiveFailures,
  };
}

const EMPTY_SESSION_STATE: WorkshopSessionState = {
  topics: null,
  serverClockOffsetMs: 0,
  lastSyncedAtMs: null,
  connection: 'idle',
  syncing: false,
  consecutiveFailures: 0,
  newTopicIds: [],
  newTopicAnnouncement: null,
};

type UseWorkshopSessionStateOptions = {
  access: WorkshopAccess | null;
  /** 테스트·미리보기에서는 네트워크 없이 같은 상태 모듈을 쓴다. */
  fixtureTopics?: readonly Topic[];
  /** 단위 격리용 주입 지점. 실제 화면은 `topicList`를 쓴다. */
  loadTopics?: (access: WorkshopAccess) => Promise<Topic[]>;
};

export type WorkshopSessionController = WorkshopSessionState & {
  refresh: () => void;
  clearNewTopicAnnouncement: () => void;
};

/**
 * 조 화면의 꼭지·마감·서버 시각을 한 번만 읽는 깊은 상태 모듈.
 *
 * DeadlineBanner와 SubmissionPanel은 이 모듈의 같은 `topics`를 받는다. 실패하면 마지막
 * 정상 목록을 보존하고, focus·visibility·online 이벤트는 예약된 타이머보다 먼저 다시 읽는다.
 */
export function useWorkshopSessionState({
  access,
  fixtureTopics,
  loadTopics = topicList,
}: UseWorkshopSessionStateOptions): WorkshopSessionController {
  const [state, setState] = useState<WorkshopSessionState>(EMPTY_SESSION_STATE);
  const requestRefreshRef = useRef<() => void>(() => undefined);
  const pendingScrollRestoreRef = useRef<(() => void) | null>(null);
  // 토큰 교환 뒤 어댑터가 바뀌어도 폴링 수명주기를 매 렌더마다 초기화하지 않는다.
  const loadTopicsRef = useRef(loadTopics);
  loadTopicsRef.current = loadTopics;
  const accessRef = useRef(access);
  accessRef.current = access;
  const accessKey = access?.accessToken ?? null;

  const refresh = useCallback(() => requestRefreshRef.current(), []);
  const clearNewTopicAnnouncement = useCallback(() => {
    setState((current) => ({
      ...current,
      newTopicIds: [],
      newTopicAnnouncement: null,
    }));
  }, []);

  // 신규 꼭지를 포함한 React commit이 끝난 직후, 브라우저가 paint하기 전에 정확한 위치로 복원한다.
  useLayoutEffect(() => {
    const restore = pendingScrollRestoreRef.current;
    pendingScrollRestoreRef.current = null;
    restore?.();
  }, [state.topics]);

  useEffect(() => {
    setState(EMPTY_SESSION_STATE);
    if (!accessKey && !fixtureTopics) {
      requestRefreshRef.current = () => undefined;
      return;
    }

    let alive = true;
    let timeout: ReturnType<typeof setTimeout> | null = null;
    let inFlight = false;
    let immediateAfterFlight = false;
    let failures = 0;
    let hasSuccessfulSnapshot = false;
    const seenTopicIds = new Set<string>();
    let scrollRestoration: EditorScrollRestoration = {
      restoreAfterCommit: () => undefined,
      cancel: () => undefined,
    };

    const clearTimer = () => {
      if (timeout !== null) clearTimeout(timeout);
      timeout = null;
    };

    let run: () => Promise<void>;
    const schedule = (delayMs: number) => {
      clearTimer();
      timeout = setTimeout(() => void run(), delayMs);
    };

    run = async () => {
      if (!alive) return;
      if (inFlight) {
        immediateAfterFlight = true;
        return;
      }

      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        failures += 1;
        setState((current) => sessionAfterFailedSync(current, failures, true));
        schedule(retryDelayMs(failures));
        return;
      }

      inFlight = true;
      setState((current) => ({ ...current, syncing: true }));
      let nextDelayMs = WORKSHOP_POLL_MS;

      try {
        const currentAccess = accessRef.current;
        let list: Topic[];
        if (fixtureTopics) {
          list = [...fixtureTopics];
        } else {
          if (!currentAccess) throw new Error('Workshop authorization is unavailable');
          list = await loadTopicsRef.current(currentAccess);
        }
        if (!alive) return;

        const previousIds = hasSuccessfulSnapshot ? [...seenTopicIds] : null;
        const newlyAdded = addedTopics(previousIds, list);
        for (const topic of list) seenTopicIds.add(topic.id);
        hasSuccessfulSnapshot = true;
        failures = 0;
        const syncedAtMs = Date.now();
        if (newlyAdded.length > 0) {
          scrollRestoration.cancel();
          scrollRestoration = preserveEditorScrollAfterTopicInsertion();
          pendingScrollRestoreRef.current = scrollRestoration.restoreAfterCommit;
        }
        setState((current) => sessionAfterSuccessfulSync(current, list, syncedAtMs, newlyAdded));
      } catch (caught) {
        if (!alive) return;
        failures += 1;
        nextDelayMs = retryDelayMs(failures);
        console.warn('[조 세션 동기화] 꼭지 목록을 다시 읽지 못했습니다.', caught);
        const browserOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
        setState((current) => sessionAfterFailedSync(current, failures, browserOffline));
      } finally {
        inFlight = false;
        if (!alive) return;
        if (immediateAfterFlight) {
          immediateAfterFlight = false;
          void run();
        } else if (!fixtureTopics) {
          schedule(nextDelayMs);
        }
      }
    };

    const requestImmediate = () => {
      if (!alive) return;
      clearTimer();
      if (inFlight) {
        immediateAfterFlight = true;
        return;
      }
      void run();
    };
    requestRefreshRef.current = requestImmediate;

    const onFocus = () => requestImmediate();
    const onVisible = () => {
      if (document.visibilityState === 'visible') requestImmediate();
    };
    const onOnline = () => requestImmediate();
    const onOffline = () => {
      setState((current) => ({ ...current, connection: 'offline', syncing: false }));
    };

    if (!fixtureTopics) {
      window.addEventListener('focus', onFocus);
      window.addEventListener('online', onOnline);
      window.addEventListener('offline', onOffline);
      document.addEventListener('visibilitychange', onVisible);
    }
    void run();

    return () => {
      alive = false;
      clearTimer();
      scrollRestoration.cancel();
      pendingScrollRestoreRef.current = null;
      requestRefreshRef.current = () => undefined;
      if (!fixtureTopics) {
        window.removeEventListener('focus', onFocus);
        window.removeEventListener('online', onOnline);
        window.removeEventListener('offline', onOffline);
        document.removeEventListener('visibilitychange', onVisible);
      }
    };
  }, [accessKey, fixtureTopics]);

  return { ...state, refresh, clearNewTopicAnnouncement };
}
