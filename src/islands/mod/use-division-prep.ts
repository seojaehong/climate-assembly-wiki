import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DivisionPrepGetResult, DivisionPrepSaveResult } from '../../lib/division-prep';
import {
  canPoll,
  canSave,
  classifyPrepError,
  emptySlot,
  prepErrorText,
  prepTooLarge,
  rowDivision,
  slotAfterSave,
  slotEdited,
  slotFromRow,
  slotSaveFailed,
  slotSaveStarted,
  type PrepSlot,
  type SlotNotice,
  type SyncMode,
} from './division-prep-sync';
import { divisionLabel, type PrepState } from './division-vote-logic';

/**
 * 준비판 공유 저장 훅 — 규칙은 division-prep-sync.ts(순수, 시험됨)에 있고 여기는 타이머·순서만 맡는다.
 *
 * - 고침 → 800ms 뒤 저장(판번호 동봉). 투표 진행 사실(commitFact)은 기다리지 않고 바로 저장.
 * - 분과마다 저장은 한 번에 하나(줄 세움). 충돌이면 서버 최신으로 통째로 바꾸고 알린다.
 * - 5초마다 읽기(대기 중인 고침·저장이 없을 때만). 서버를 못 쓰면 이 기기 저장으로 내려가고 30초마다 다시 붙어 본다.
 * - 이 기기 저장소에는 늘 사본을 둔다(오프라인 대비).
 */

export type PrepApi = {
  get(): Promise<DivisionPrepGetResult>;
  save(subgroup: string, expectedVersion: number, state: PrepState, label: string): Promise<DivisionPrepSaveResult>;
};

const SAVE_DEBOUNCE_MS = 800;
const POLL_MS = 5000;
const LOCAL_RETRY_MS = 30000;
const SAVE_RETRY_MS = 5000;

export type DivisionPrep = {
  slots: Record<number, PrepSlot>;
  mode: SyncMode;
  /** 이 기기 저장으로 내려간 까닭(배너 문구). */
  localReason: string | null;
  lastSaveFailed: boolean;
  /** 마지막 읽기가 성공했는가(운영팀 현황판의 연결 상태). null = 아직 모름. */
  connected: boolean | null;
  /** 서버 시각 - 이 기기 시각(ms). */
  serverOffsetMs: number;
  notice: SlotNotice;
  setNotice: (n: SlotNotice) => void;
  getState: (division: number) => PrepState | null;
  edit: (division: number, fn: (s: PrepState) => PrepState) => void;
  replace: (division: number, state: PrepState) => void;
  commitFact: (division: number, fn: (s: PrepState) => PrepState) => Promise<PrepState>;
};

export function useDivisionPrep({
  api,
  initial,
  persistLocal,
  label,
}: {
  api: PrepApi | null;
  initial: () => Record<number, PrepState>;
  persistLocal: (state: PrepState) => void;
  label: string;
}): DivisionPrep {
  const slotsRef = useRef<Record<number, PrepSlot> | null>(null);
  if (slotsRef.current === null) {
    const init = initial();
    slotsRef.current = Object.fromEntries(Object.entries(init).map(([d, s]) => [Number(d), emptySlot(s)]));
  }
  const [slots, setSlotsState] = useState<Record<number, PrepSlot>>(slotsRef.current);
  const [mode, setMode] = useState<SyncMode>(api ? 'connecting' : 'local');
  const modeRef = useRef<SyncMode>(mode);
  const [localReason, setLocalReason] = useState<string | null>(null);
  const [lastSaveFailed, setLastSaveFailed] = useState(false);
  const [connected, setConnected] = useState<boolean | null>(null);
  const [serverOffsetMs, setServerOffsetMs] = useState(0);
  const [notice, setNotice] = useState<SlotNotice>(null);
  /** 서버 줄을 받은 분과 — 이 분과들만 서버에 저장한다. */
  const serverDivisions = useRef<Set<number>>(new Set());
  const queues = useRef<Map<number, Promise<unknown>>>(new Map());
  const timers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());
  const labelRef = useRef(label);
  labelRef.current = label;
  const persistRef = useRef(persistLocal);
  persistRef.current = persistLocal;
  const apiRef = useRef(api);
  apiRef.current = api;

  const setModeBoth = (m: SyncMode) => {
    modeRef.current = m;
    setMode(m);
  };

  /** 칸 바꾸기 — ref 를 먼저 바꿔 비동기 흐름이 늘 최신을 보게 하고, 바뀐 상태는 저장소에 사본을 남긴다. */
  const setSlot = useCallback((division: number, fn: (prev: PrepSlot) => PrepSlot) => {
    const all = slotsRef.current as Record<number, PrepSlot>;
    const prev = all[division] ?? emptySlot(null);
    const next = fn(prev);
    if (next === prev) return;
    slotsRef.current = { ...all, [division]: next };
    if (next.state && next.state !== prev.state) persistRef.current(next.state);
    setSlotsState(slotsRef.current);
  }, []);

  const enqueue = useCallback(<T,>(division: number, task: () => Promise<T>): Promise<T> => {
    const prev = queues.current.get(division) ?? Promise.resolve();
    const run = prev.then(task, task);
    queues.current.set(
      division,
      run.catch(() => undefined),
    );
    return run;
  }, []);

  const serverWritable = (division: number) =>
    !!apiRef.current && modeRef.current === 'server' && serverDivisions.current.has(division);

  /** 한 번 저장. 줄 안에서만 부른다. */
  const saveOnce = useCallback(
    async (division: number): Promise<void> => {
      const a = apiRef.current;
      const slot = slotsRef.current?.[division];
      if (!a || !slot || !serverWritable(division) || !canSave(slot) || !slot.state) return;
      const sent = slot.state;
      if (prepTooLarge(sent)) {
        setLastSaveFailed(true);
        setNotice({ tone: 'error', text: `${divisionLabel(division)} 내용이 너무 커서 서버에 저장하지 못했습니다. 운영팀에 알리십시오.` });
        return;
      }
      setSlot(division, slotSaveStarted);
      try {
        const res = await a.save(divisionLabel(division), slot.version, sent, labelRef.current);
        const after = slotAfterSave((slotsRef.current as Record<number, PrepSlot>)[division], sent, res);
        setSlot(division, () => after.slot);
        if (after.notice) setNotice(after.notice);
        setLastSaveFailed(false);
        setConnected(true);
      } catch (error) {
        console.error('[division prep] save failed', error);
        setSlot(division, slotSaveFailed);
        setLastSaveFailed(true);
        setConnected(false);
        const t = timers.current.get(division);
        if (t) clearTimeout(t);
        timers.current.set(division, setTimeout(() => void enqueue(division, () => saveOnce(division)), SAVE_RETRY_MS));
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [enqueue, setSlot],
  );

  const scheduleSave = useCallback(
    (division: number, delay = SAVE_DEBOUNCE_MS) => {
      if (!serverWritable(division)) return;
      const t = timers.current.get(division);
      if (t) clearTimeout(t);
      timers.current.set(
        division,
        setTimeout(() => {
          timers.current.delete(division);
          void enqueue(division, () => saveOnce(division));
        }, delay),
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [enqueue, saveOnce],
  );

  /** 서버 읽기 결과 반영. */
  const applyGet = useCallback(
    (res: DivisionPrepGetResult) => {
      const t = Date.parse(res.server_now);
      if (!Number.isNaN(t)) setServerOffsetMs(t - Date.now());
      for (const row of res.rows ?? []) {
        const d = rowDivision(row);
        if (d === null) continue;
        serverDivisions.current.add(d);
        const prev = slotsRef.current?.[d];
        const { slot, notice: n } = slotFromRow(prev, row, prev?.state ?? null);
        setSlot(d, () => slot);
        if (n) setNotice(n);
        if (canSave(slot)) scheduleSave(d, 0);
      }
    },
    [scheduleSave, setSlot],
  );

  // 첫 읽기 + 이 기기 저장 모드에서 다시 붙어 보기
  useEffect(() => {
    if (!api) {
      setModeBoth('local');
      return undefined;
    }
    let cancelled = false;
    let retry: ReturnType<typeof setTimeout> | null = null;
    const attempt = async () => {
      try {
        const res = await api.get();
        if (cancelled) return;
        setModeBoth('server');
        setLocalReason(null);
        setConnected(true);
        applyGet(res);
      } catch (error) {
        if (cancelled) return;
        console.warn('[division prep] get failed — local mode', error);
        setModeBoth('local');
        setConnected(false);
        setLocalReason(prepErrorText(classifyPrepError(error)));
        retry = setTimeout(() => void attempt(), LOCAL_RETRY_MS);
      }
    };
    void attempt();
    return () => {
      cancelled = true;
      if (retry) clearTimeout(retry);
    };
  }, [api, applyGet]);

  // 5초 폴링(서버 모드, 대기 중인 고침·저장이 없을 때만)
  useEffect(() => {
    if (!api || mode !== 'server') return undefined;
    let busy = false;
    const id = setInterval(async () => {
      if (busy || !canPoll(slotsRef.current as Record<number, PrepSlot>, serverDivisions.current)) return;
      busy = true;
      try {
        const res = await api.get();
        // 읽는 사이에 고쳤으면 slotFromRow 가 그 칸을 건드리지 않는다.
        applyGet(res);
        setConnected(true);
      } catch (error) {
        console.warn('[division prep] poll failed', error);
        setConnected(false);
      } finally {
        busy = false;
      }
    }, POLL_MS);
    return () => clearInterval(id);
  }, [api, mode, applyGet]);

  // 화면을 떠날 때(탭 전환 = 언마운트) 기다리던 저장을 바로 보낸다.
  useEffect(() => {
    const t = timers.current;
    return () => {
      for (const [division, timer] of t) {
        clearTimeout(timer);
        void enqueue(division, () => saveOnce(division));
      }
      t.clear();
    };
  }, [enqueue, saveOnce]);

  const getState = useCallback((division: number) => slotsRef.current?.[division]?.state ?? null, []);

  const edit = useCallback(
    (division: number, fn: (s: PrepState) => PrepState) => {
      const cur = slotsRef.current?.[division];
      if (!cur?.state) return;
      const next = fn(cur.state);
      if (next === cur.state) return;
      setSlot(division, (prev) => slotEdited(prev, next));
      scheduleSave(division);
    },
    [scheduleSave, setSlot],
  );

  const replace = useCallback(
    (division: number, state: PrepState) => {
      setSlot(division, (prev) => ({ ...(prev ?? emptySlot(null)), state, dirty: true }));
      scheduleSave(division);
    },
    [scheduleSave, setSlot],
  );

  /**
   * 투표 진행 사실 저장 — fn 을 최신 상태에 적용하고 곧바로 저장한다.
   * 충돌하면 서버 최신에 fn 을 다시 적용해 다시 저장한다(최대 3번). fn 은 같은 사실을 두 번 적어도
   * 같은 결과가 나오는 함수여야 한다(markBallotCreated 등).
   * 서버를 못 쓰면 이 기기에 남기고 그 상태를 돌려준다 — 흐름은 멈추지 않는다.
   */
  const commitFact = useCallback(
    (division: number, fn: (s: PrepState) => PrepState): Promise<PrepState> =>
      enqueue(division, async () => {
        const pending = timers.current.get(division);
        if (pending) {
          clearTimeout(pending);
          timers.current.delete(division);
        }
        for (let attempt = 0; attempt < 3; attempt += 1) {
          const slot = (slotsRef.current as Record<number, PrepSlot>)[division];
          if (!slot?.state) throw new Error('준비 내용이 없습니다.');
          const next = fn(slot.state);
          if (next !== slot.state) setSlot(division, (prev) => slotEdited(prev, next));
          const cur = (slotsRef.current as Record<number, PrepSlot>)[division];
          const a = apiRef.current;
          if (!a || !serverWritable(division) || !canSave(cur) || !cur.state) return cur.state as PrepState;
          const sent = cur.state;
          if (prepTooLarge(sent)) {
            setLastSaveFailed(true);
            setNotice({ tone: 'error', text: `${divisionLabel(division)} 내용이 너무 커서 서버에 저장하지 못했습니다.` });
            return sent;
          }
          setSlot(division, slotSaveStarted);
          let res: DivisionPrepSaveResult;
          try {
            res = await a.save(divisionLabel(division), cur.version, sent, labelRef.current);
          } catch (error) {
            console.error('[division prep] fact save failed', error);
            setSlot(division, slotSaveFailed);
            setLastSaveFailed(true);
            setConnected(false);
            timers.current.set(division, setTimeout(() => void enqueue(division, () => saveOnce(division)), SAVE_RETRY_MS));
            return sent;
          }
          const after = slotAfterSave((slotsRef.current as Record<number, PrepSlot>)[division], sent, res);
          setSlot(division, () => after.slot);
          setLastSaveFailed(false);
          setConnected(true);
          if (res.ok) {
            if (after.slot.dirty) scheduleSave(division);
            return after.slot.state as PrepState;
          }
          if (after.notice) setNotice(after.notice);
          if (after.slot.unreadable) return sent;
          // 충돌 — 서버 최신에 다시 적용(다음 바퀴)
        }
        return ((slotsRef.current as Record<number, PrepSlot>)[division]?.state ?? null) as PrepState;
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [enqueue, saveOnce, scheduleSave, setSlot],
  );

  return useMemo(
    () => ({
      slots,
      mode,
      localReason,
      lastSaveFailed,
      connected,
      serverOffsetMs,
      notice,
      setNotice,
      getState,
      edit,
      replace,
      commitFact,
    }),
    [slots, mode, localReason, lastSaveFailed, connected, serverOffsetMs, notice, getState, edit, replace, commitFact],
  );
}

