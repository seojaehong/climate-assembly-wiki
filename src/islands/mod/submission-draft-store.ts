import type { EditorRow } from './submission-panel-logic';

/**
 * 조별 산출물 초안(미저장분) 보관 계층 — 순수 함수 + 저장소 래퍼.
 *
 * 8.29에 글이 날아간 경로는 둘이었다. ① 탭을 닫거나 기기가 꺼지면 `sessionStorage`
 * 초안이 통째로 사라진다 ② 초안에 **언제 것인지·무엇 기준인지**가 없어 낡은 초안과
 * 최신 서버 내용을 구별할 수 없다. 여기서 봉투(`DraftEnvelope`)를 씌워 둘 다 막는다.
 *
 * 설계 정본: `docs/02-design/features/submission-resilience-0912.design.md` §1.2 (A-D1).
 * IndexedDB 는 쓰지 않는다 — 비동기라 `pickRestoredRows` 의 동기 계약이 깨진다.
 *
 * ★ 시계는 전부 인자로 받는다(이 디렉터리 관례). 모듈 안에서 `Date.now()` 를 부르지 않는다.
 */

/** 초안 키 접두사. `climate_vote_draft:${teamId}:${topicId}` 꼴이다. */
export const DRAFT_KEY_PREFIX = 'climate_vote_draft:';
export const DRAFT_RECOVERY_KEY_PREFIX = 'climate_vote_draft_recovery:';

/** 초안 유효기간 기본값 = 72시간. 회차가 지난 초안이 되살아나는 사고를 막는다. */
export const DRAFT_TTL_MS = 72 * 60 * 60 * 1000;

// Storage can fail on every keystroke in private/managed browsers. Report each tier/operation once
// per page, then continue through the documented local -> session -> memory fallback without
// flooding the console or exposing draft contents.
const reportedStorageFailures = new Set<string>();
function reportStorageFailureOnce(context: string, error: unknown): void {
  if (reportedStorageFailures.has(context)) return;
  reportedStorageFailures.add(context);
  console.warn(`[submission draft storage] ${context}; using the next safe fallback`, error);
}

/**
 * 보관된 초안 하나.
 *
 * `baseUpdatedAt` 은 이 초안이 딛고 선 서버 `updated_at` 이다. 재전송 큐(A-D5)가
 * 「내가 읽은 뒤에 남이 저장했는가」를 이 값으로 판정한다.
 */
export type DraftEnvelope = {
  v: 1;
  rows: EditorRow[];
  /** 초안을 보관한 시각(로컬 시계). 옛 모양에서 승격한 것은 0이며 만료로 보지 않는다. */
  savedAtMs: number;
  baseUpdatedAt: string | null;
  /** Token OCC generation. null means a legacy draft that predates version tracking. */
  baseVersion: number | null;
};

/**
 * 행 정규화 — `pickRestoredRows` 가 하던 위생 처리를 그대로 옮겨 왔다.
 *
 * ★ 이름 칸이 생기기 **전에** 보관된 초안은 `{content, rationale}` 뿐이라 `name` 이
 *   undefined 로 들어온다. 그대로 쓰면 controlled input 이 uncontrolled 로 바뀌어
 *   React 가 경고를 뱉는다. 여기서 메운다.
 *
 * 한 줄이라도 모양이 틀리면 **전체를 버린다** — 반쪽짜리 복원은 조가 쓴 것과
 * 다른 내용을 보여주게 되고, 그게 원문 훼손이다.
 */
function normalizeRows(value: unknown): EditorRow[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const rows = value
    .filter(
      (row): row is Partial<EditorRow> =>
        typeof row === 'object' && row !== null && typeof (row as EditorRow).content === 'string',
    )
    .map((row) => ({
      name: typeof row.name === 'string' ? row.name : '',
      content: row.content as string,
      rationale: typeof row.rationale === 'string' ? row.rationale : '',
    }));
  if (rows.length !== value.length || rows.length === 0) return null;
  return rows;
}

/**
 * 보관 문자열을 봉투로 되돌린다. **만료는 보지 않는다.**
 *
 * 옛 모양(EditorRow 배열이 그대로 들어 있는 값)도 받아 `savedAtMs:0` 으로 승격한다 —
 * 8.29처럼 배포를 건너온 탭이 있을 수 있다.
 */
function parseEnvelope(raw: string | null): DraftEnvelope | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    reportStorageFailureOnce('malformed cached draft discarded', error);
    return null; // 깨진 값 — 서버 내용으로 연다
  }
  // 옛 모양 승격
  if (Array.isArray(parsed)) {
    const rows = normalizeRows(parsed);
    return rows ? { v: 1, rows, savedAtMs: 0, baseUpdatedAt: null, baseVersion: null } : null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const env = parsed as Partial<DraftEnvelope>;
  if (env.v !== 1) return null;
  const rows = normalizeRows(env.rows);
  if (!rows) return null;
  // savedAtMs 가 깨져 있으면 0(= 만료 없음)으로 본다. 시각을 몰라서 글을 버리는 것보다
  // 남겨서 조에게 보여 주는 쪽이 낫다 — 이 PRD 전체가 「글을 잃지 않는다」에 걸려 있다.
  const savedAtMs =
    typeof env.savedAtMs === 'number' && Number.isFinite(env.savedAtMs) && env.savedAtMs > 0
      ? env.savedAtMs
      : 0;
  return {
    v: 1,
    rows,
    savedAtMs,
    baseUpdatedAt: typeof env.baseUpdatedAt === 'string' ? env.baseUpdatedAt : null,
    baseVersion:
      typeof env.baseVersion === 'number' && Number.isSafeInteger(env.baseVersion) && env.baseVersion >= 0
        ? env.baseVersion
        : null,
  };
}

export type LegacyDraftMigrationDecision = 'missing' | 'move' | 'duplicate' | 'conflict';

export type LegacyDraftRecoveryRecord = {
  v: 1;
  teamId: string;
  topicId: string;
  recoveredAtMs: number;
  /** Original draft bytes. The legacy join code and source key are never copied. */
  draftRaw: string;
};

function parseRecoveryRecord(raw: string | null): LegacyDraftRecoveryRecord | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const candidate = parsed as Partial<LegacyDraftRecoveryRecord>;
    if (candidate.v !== 1 || typeof candidate.teamId !== 'string' || !candidate.teamId
        || typeof candidate.topicId !== 'string' || !candidate.topicId
        || typeof candidate.recoveredAtMs !== 'number' || !Number.isFinite(candidate.recoveredAtMs)
        || typeof candidate.draftRaw !== 'string') return null;
    return {
      v: 1,
      teamId: candidate.teamId,
      topicId: candidate.topicId,
      recoveredAtMs: candidate.recoveredAtMs,
      draftRaw: candidate.draftRaw,
    };
  } catch (error) {
    reportStorageFailureOnce('malformed recovery copy preserved but not listed', error);
    return null;
  }
}

/**
 * Copy an ambiguous legacy draft to a join-code-free recovery slot. Repeated
 * migrations reuse an identical slot; divergent drafts always get separate
 * slots and are never overwritten.
 */
export function preserveLegacyDraftRecovery(
  storage: Pick<Storage, 'length' | 'key' | 'getItem' | 'setItem'>,
  teamId: string,
  topicId: string,
  draftRaw: string,
  nowMs: number,
): LegacyDraftRecoveryRecord {
  const prefix = `${DRAFT_RECOVERY_KEY_PREFIX}${teamId}:`;
  const existingKeys = Array.from({ length: storage.length }, (_, index) => storage.key(index))
    .filter((key): key is string => key !== null && key.startsWith(prefix));
  for (const key of existingKeys) {
    const existing = parseRecoveryRecord(storage.getItem(key));
    if (existing?.teamId === teamId && existing.topicId === topicId && existing.draftRaw === draftRaw) {
      return existing;
    }
  }

  const record: LegacyDraftRecoveryRecord = { v: 1, teamId, topicId, recoveredAtMs: nowMs, draftRaw };
  const serialized = JSON.stringify(record);
  let suffix = 1;
  let recoveryKey = `${prefix}${nowMs}-${suffix}`;
  while (storage.getItem(recoveryKey) !== null) {
    suffix += 1;
    recoveryKey = `${prefix}${nowMs}-${suffix}`;
  }
  storage.setItem(recoveryKey, serialized);
  if (storage.getItem(recoveryKey) !== serialized) {
    throw new Error('Legacy draft recovery copy could not be verified.');
  }
  return record;
}

/** List recoveries for one team without exposing the old join-code source key. */
export function listLegacyDraftRecoveries(
  storage: Pick<Storage, 'length' | 'key' | 'getItem'>,
  teamId: string,
): LegacyDraftRecoveryRecord[] {
  const prefix = `${DRAFT_RECOVERY_KEY_PREFIX}${teamId}:`;
  const records: LegacyDraftRecoveryRecord[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (!key?.startsWith(prefix)) continue;
    const record = parseRecoveryRecord(storage.getItem(key));
    if (record?.teamId === teamId) records.push(record);
  }
  return records.sort((left, right) => left.recoveredAtMs - right.recoveredAtMs);
}

function sameDraftContent(left: DraftEnvelope, right: DraftEnvelope): boolean {
  return JSON.stringify(left.rows) === JSON.stringify(right.rows);
}

/**
 * Decide whether a join-code draft can be removed after moving to a team id.
 * A timestamp or version alone never wins: if any recovery-relevant field
 * differs, both copies remain available for an explicit human choice.
 */
export function legacyDraftMigrationDecision(
  sourceRaw: string | null,
  targetRaw: string | null,
): LegacyDraftMigrationDecision {
  if (sourceRaw === null) return 'missing';
  if (targetRaw === null) return 'move';
  const source = parseEnvelope(sourceRaw);
  const target = parseEnvelope(targetRaw);
  if (!source || !target) return 'conflict';
  return source.savedAtMs === target.savedAtMs
    && source.baseVersion === target.baseVersion
    && source.baseUpdatedAt === target.baseUpdatedAt
    && sameDraftContent(source, target)
    ? 'duplicate'
    : 'conflict';
}

/** Move one legacy draft, deleting its source only after an exact verified copy. */
export function migrateLegacyDraft(
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>,
  sourceKey: string,
  targetKey: string,
): LegacyDraftMigrationDecision {
  const sourceRaw = storage.getItem(sourceKey);
  const decision = legacyDraftMigrationDecision(sourceRaw, storage.getItem(targetKey));
  if (decision === 'move' && sourceRaw !== null) {
    storage.setItem(targetKey, sourceRaw);
    if (storage.getItem(targetKey) !== sourceRaw) return 'conflict';
    storage.removeItem(sourceKey);
  } else if (decision === 'duplicate') {
    storage.removeItem(sourceKey);
  }
  return decision;
}

/**
 * 만료 판정. `savedAtMs === 0`(승격분·시각 불명)은 **만료로 보지 않는다.**
 *
 * 경계는 엄격 비교다 — 정확히 `nowMs - ttlMs` 인 초안은 아직 살아 있다.
 */
function isExpired(env: DraftEnvelope, nowMs: number, ttlMs: number): boolean {
  return env.savedAtMs > 0 && env.savedAtMs < nowMs - ttlMs;
}

/**
 * 보관 문자열 → 살아 있는 초안. 없거나·깨졌거나·만료면 null.
 */
export function readDraft(
  raw: string | null,
  nowMs: number,
  ttlMs: number = DRAFT_TTL_MS,
): DraftEnvelope | null {
  const env = parseEnvelope(raw);
  if (!env) return null;
  return isExpired(env, nowMs, ttlMs) ? null : env;
}

/** 초안 → 보관 문자열. */
export function writeDraft(
  rows: EditorRow[],
  baseUpdatedAt: string | null,
  nowMs: number,
  baseVersion: number | null = null,
): string {
  const env: DraftEnvelope = { v: 1, rows, savedAtMs: nowMs, baseUpdatedAt, baseVersion };
  return JSON.stringify(env);
}

/**
 * 지울 초안 키 — `climate_vote_draft:` 로 시작하는 키 중 **만료분만**.
 *
 * 깨진 값과 승격분(`savedAtMs:0`)은 돌려주지 않는다. 만료가 아닌 것을 지우면
 * 조가 쓰던 글을 대신 버리는 셈이다.
 */
export function staleKeys(
  allKeys: string[],
  readRaw: (key: string) => string | null,
  nowMs: number,
  ttlMs: number = DRAFT_TTL_MS,
): string[] {
  const out: string[] = [];
  for (const key of allKeys) {
    if (!key.startsWith(DRAFT_KEY_PREFIX)) continue;
    let raw: string | null;
    try {
      raw = readRaw(key);
    } catch (error) {
      reportStorageFailureOnce('stale-key read failed', error);
      continue;
    }
    const env = parseEnvelope(raw);
    if (env && isExpired(env, nowMs, ttlMs)) out.push(key);
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * 저장소 래퍼
 * ------------------------------------------------------------------ */

/** 브라우저 `Storage` 중 여기서 실제로 쓰는 것만. */
export type StorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  readonly length: number;
  key(index: number): string | null;
};

export type DraftStorageTier = 'local' | 'session' | 'memory';

export type DraftStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  /** 접근 가능한 모든 계층의 키 합집합. */
  keys(): string[];
  /** 마지막 쓰기가 실제로 안착한 계층. 조에게 「이 기기에만 남습니다」를 알릴 때 쓴다. */
  tier(): DraftStorageTier;
};

type Candidate = { name: DraftStorageTier; get: () => StorageLike | undefined };

/**
 * 기본 후보 = localStorage → sessionStorage.
 *
 * ★ 게터를 지연 호출한다. Safari 사생활 보호·기업 정책에서는 `globalThis.localStorage`
 *   **접근 자체가** 던지고, vitest 의 node 환경에서는 그냥 undefined 다. 둘을 같게 다룬다.
 */
function defaultCandidates(): Candidate[] {
  return [
    { name: 'local', get: () => (globalThis as { localStorage?: StorageLike }).localStorage },
    { name: 'session', get: () => (globalThis as { sessionStorage?: StorageLike }).sessionStorage },
  ];
}

function resolve(candidate: Candidate): StorageLike | null {
  try {
    return candidate.get() ?? null;
  } catch (error) {
    reportStorageFailureOnce(`${candidate.name} access failed`, error);
    return null;
  }
}

/**
 * 초안 저장소를 만든다. **어떤 경우에도 예외를 밖으로 던지지 않는다.**
 *
 * - 쓰기: localStorage → (QuotaExceededError·접근 차단) → sessionStorage → 메모리
 * - 읽기: 위 순서로 훑어 **처음 찾은 값**을 쓴다. 그래서 이 배포 이전에
 *   `sessionStorage` 에만 있던 초안도 그대로 살아난다(A-D1 승격 경로)
 * - 지우기: **모든 계층에서** 지운다. 한 곳만 지우면 낡은 초안이 다음 읽기에 되살아난다
 */
export function createDraftStorage(candidates: Candidate[] = defaultCandidates()): DraftStorage {
  const memory = new Map<string, string>();
  let lastTier: DraftStorageTier = 'memory';

  /** 주어진 계층들에서 키를 최선노력으로 지운다. 못 지워도 넘어간다. */
  const dropElsewhere = (targets: Candidate[], key: string) => {
    for (const candidate of targets) {
      const store = resolve(candidate);
      if (!store) continue;
      try {
        store.removeItem(key);
      } catch (error) {
        reportStorageFailureOnce(`${candidate.name} cleanup failed`, error);
      }
    }
  };

  return {
    getItem(key) {
      for (const candidate of candidates) {
        const store = resolve(candidate);
        if (!store) continue;
        try {
          const value = store.getItem(key);
          if (value !== null) return value;
        } catch (error) {
          reportStorageFailureOnce(`${candidate.name} read failed`, error);
        }
      }
      return memory.get(key) ?? null;
    },

    setItem(key, value) {
      for (const candidate of candidates) {
        const store = resolve(candidate);
        if (!store) continue;
        try {
          store.setItem(key, value);
          lastTier = candidate.name;
          // ★ 강등 대비 — 안착한 곳 말고는 전부 지운다. `setItem` 은 용량 초과 시
          //   원자적으로 실패하므로 **옛 값이 위 계층에 그대로 남는다.** 읽기가 위에서부터
          //   훑는 이상, 안 지우면 방금 쓴 새 초안이 옛 초안에 가려진다.
          dropElsewhere(candidates.filter((c) => c !== candidate), key);
          memory.delete(key);
          return;
        } catch (error) {
          reportStorageFailureOnce(`${candidate.name} write failed`, error);
        }
      }
      memory.set(key, value);
      lastTier = 'memory';
      dropElsewhere(candidates, key);
    },

    removeItem(key) {
      for (const candidate of candidates) {
        const store = resolve(candidate);
        if (!store) continue;
        try {
          store.removeItem(key);
        } catch (error) {
          reportStorageFailureOnce(`${candidate.name} removal failed`, error);
        }
      }
      memory.delete(key);
    },

    keys() {
      const out = new Set<string>();
      for (const candidate of candidates) {
        const store = resolve(candidate);
        if (!store) continue;
        try {
          for (let i = 0; i < store.length; i += 1) {
            const key = store.key(i);
            if (key !== null) out.add(key);
          }
        } catch (error) {
          reportStorageFailureOnce(`${candidate.name} key scan failed`, error);
        }
      }
      for (const key of memory.keys()) out.add(key);
      return [...out];
    },

    tier() {
      return lastTier;
    },
  };
}
