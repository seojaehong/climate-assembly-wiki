import type { SubmissionItemInput } from '../../lib/deliberation';

/**
 * 저장 실패분 재전송 큐 — 순수 함수만. 저장소 접근도 네트워크 호출도 여기 없다.
 *
 * 8.29에 조가 글을 못 올린 세 번째 구멍이 「저장이 한 번 실패하면 그걸로 끝」이었다.
 * 실패한 저장을 큐에 얹어 두고 연결이 돌아오면 자동으로 다시 보낸다(A-D4).
 *
 * ★ `submission_save_v3` 의 서버 버전 비교가 최종 방어선이다. 큐는 최초
 *   저장 시점의 `baseVersion`과 `requestId`를 그대로 보존해 재전송한다.
 *   서버가 conflict를 돌려주면 **자동 덮어쓰기나 병합을 하지 않고** 조에게 묻는다.
 *
 * 설계 정본: `docs/02-design/features/submission-resilience-0912.design.md` §1.3.
 * 배선(마운트 확인·online 리스너·백오프 타이머)은 US-005 의 `SubmissionPanel.tsx` 몫이다.
 *
 * ★ 시계·온라인 여부는 전부 인자로 받는다(이 디렉터리 관례). 모듈 안에서
 *   `Date.now()` 도 `navigator.onLine` 도 부르지 않는다.
 */

/** 큐 키 접두사. 초안(`climate_vote_draft:`)과 겹치지 않게 갈라 둔다. */
export const QUEUE_KEY_PREFIX = 'climate_vote_queue:';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
let malformedQueueReported = false;

/**
 * 큐 키. **꼭지당 1건만** 산다 — 같은 꼭지에 새 실패가 오면 덮어쓴다.
 * 최신 것이 조의 의도이고, 큐가 쌓이면 전송 순서 문제가 생긴다.
 */
export function queueKey(storageScope: string, topicId: string): string {
  return `${QUEUE_KEY_PREFIX}${storageScope}:${topicId}`;
}

/** 재전송을 기다리는 저장 한 건. */
export type QueuedSave = {
  v: 2;
  topicId: string;
  /** `toSaveItems(rows)` 결과 그대로. 큐에서 다시 만들지 않는다. */
  items: SubmissionItemInput[];
  /** 이 저장이 딛고 선 서버 generation. */
  baseVersion: number;
  /** 동일 저장의 재전송을 서버가 한 번만 처리하도록 하는 멱등성 키. */
  requestId: string;
  queuedAtMs: number;
  /** 지금까지 실제로 보내 본 횟수. 오프라인이라 건너뛴 것은 세지 않는다. */
  attempts: number;
  nextAttemptAtMs: number;
};

/**
 * 백오프 계단. 마지막 값(300s)에서 멈추고 **무한 재시도**한다 —
 * 조가 화면을 열어 둔 동안은 포기하지 않는다.
 */
export const BACKOFF_STEPS_MS = [5_000, 15_000, 45_000, 120_000, 300_000] as const;

/**
 * `attempts` 번 실패한 뒤 다음 시도까지 기다릴 시간.
 *
 * ★ 세는 기준은 **1부터**다. 첫 실패(`attempts === 1`) 뒤 5초, 그다음 15초… 이고
 *   5번째 이후는 계속 300초다. `attempts` 가 0 이하거나 숫자가 아니면 첫 계단을 준다
 *   (아직 실패한 적이 없는데 시각을 물어보는 배선 실수로 무한 대기가 생기지 않게).
 */
export function nextBackoffMs(attempts: number): number {
  if (!Number.isFinite(attempts) || attempts <= 1) return BACKOFF_STEPS_MS[0];
  const index = Math.min(Math.floor(attempts), BACKOFF_STEPS_MS.length) - 1;
  return BACKOFF_STEPS_MS[index];
}

/**
 * 지금 재전송을 시도할 때인가.
 *
 * 오프라인이면 **시도 자체를 건너뛴다** — 보내 봐야 실패하고, 실패 횟수만 태워
 * 백오프가 쓸데없이 길어진다. 예정 시각과 정확히 같은 순간은 시도한다(경계 포함).
 */
export function shouldAttempt(q: QueuedSave, nowMs: number, online: boolean): boolean {
  if (!online) return false;
  return nowMs >= q.nextAttemptAtMs;
}

/**
 * 예전 `updated_at` 사전 조회 방식의 하위 호환 순수 함수.
 * 신규 토큰 경로는 TOCTOU 간격이 없는 서버 `expectedVersion` 비교를 쓴다.
 */
export function conflictVerdict(
  serverUpdatedAt: string | null | undefined,
  baseUpdatedAt: string | null | undefined,
): 'send' | 'conflict' {
  return (serverUpdatedAt ?? null) === (baseUpdatedAt ?? null) ? 'send' : 'conflict';
}

/** 큐 한 건 만들기. 첫 시도 시각은 `nextBackoffMs(1)` 뒤다. */
export function makeQueuedSave(input: {
  topicId: string;
  items: SubmissionItemInput[];
  baseVersion: number;
  requestId: string;
  nowMs: number;
  /** 이미 몇 번 실패한 건인가. 재적재 시 이어 센다. 기본 1(첫 실패). */
  attempts?: number;
}): QueuedSave {
  const attempts = input.attempts ?? 1;
  return {
    v: 2,
    topicId: input.topicId,
    items: input.items,
    baseVersion: input.baseVersion,
    requestId: input.requestId,
    queuedAtMs: input.nowMs,
    attempts,
    nextAttemptAtMs: input.nowMs + nextBackoffMs(attempts),
  };
}

/** 한 번 더 실패했다. 시도 횟수를 올리고 다음 시각을 다시 잡는다. */
export function withFailedAttempt(q: QueuedSave, nowMs: number): QueuedSave {
  const attempts = q.attempts + 1;
  return { ...q, attempts, nextAttemptAtMs: nowMs + nextBackoffMs(attempts) };
}

function isItem(value: unknown): value is SubmissionItemInput {
  if (typeof value !== 'object' || value === null) return false;
  const item = value as Partial<SubmissionItemInput>;
  return (
    typeof item.ordinal === 'number' &&
    Number.isSafeInteger(item.ordinal) &&
    item.ordinal > 0 &&
    (item.kind === 'core' || item.kind === 'extra') &&
    typeof item.content === 'string' &&
    (item.rationale === null || typeof item.rationale === 'string')
  );
}

/**
 * 보관 문자열 → 큐. 없거나·깨졌거나·한 항목이라도 모양이 틀리면 **통째로 null**.
 *
 * ★ 반쪽짜리 큐를 살려 보내면 안 된다. 전송은 items **전체 교체**라 항목이 하나
 *   빠진 채로 나가면 서버에 있던 그 항목이 사라진다. 반면 큐를 버려도 **글 자체는
 *   초안 봉투에 그대로 남아** 화면에 복원된다. 그래서 「살려 보내기」보다
 *   「버리기」가 언제나 안전하다. 이 판단을 나중에 되돌리지 말 것.
 *
 * 예외는 밖으로 던지지 않는다.
 */
export function readQueue(raw: string | null): QueuedSave | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    if (!malformedQueueReported) {
      malformedQueueReported = true;
      console.warn('[submission queue] malformed cached queue discarded; draft content is retained', error);
    }
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
  const q = parsed as Partial<QueuedSave>;
  if (q.v !== 2) return null;
  if (typeof q.topicId !== 'string' || q.topicId.length === 0) return null;
  if (!Array.isArray(q.items) || !q.items.every(isItem)) return null;
  if (typeof q.baseVersion !== 'number' || !Number.isSafeInteger(q.baseVersion) || q.baseVersion < 0) return null;
  if (typeof q.requestId !== 'string' || !UUID_PATTERN.test(q.requestId)) return null;
  if (typeof q.queuedAtMs !== 'number' || !Number.isFinite(q.queuedAtMs)) return null;
  if (typeof q.attempts !== 'number' || !Number.isSafeInteger(q.attempts) || q.attempts < 1) return null;
  if (typeof q.nextAttemptAtMs !== 'number' || !Number.isFinite(q.nextAttemptAtMs)) return null;
  return {
    v: 2,
    topicId: q.topicId,
    items: q.items,
    baseVersion: q.baseVersion,
    requestId: q.requestId,
    queuedAtMs: q.queuedAtMs,
    attempts: q.attempts,
    nextAttemptAtMs: q.nextAttemptAtMs,
  };
}

/** 큐 → 보관 문자열. */
export function writeQueue(q: QueuedSave): string {
  return JSON.stringify(q);
}
