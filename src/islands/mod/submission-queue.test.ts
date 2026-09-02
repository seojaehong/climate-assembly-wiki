import { describe, it, expect } from 'vitest';
import type { SubmissionItemInput } from '../../lib/deliberation';
import {
  BACKOFF_STEPS_MS,
  QUEUE_KEY_PREFIX,
  conflictVerdict,
  makeQueuedSave,
  nextBackoffMs,
  queueKey,
  readQueue,
  shouldAttempt,
  withFailedAttempt,
  writeQueue,
  type QueuedSave,
} from './submission-queue';

const NOW = 1_756_000_000_000; // 고정 시각 — 이 모듈은 Date.now() 를 부르지 않는다

function item(over: Partial<SubmissionItemInput> = {}): SubmissionItemInput {
  return { ordinal: 1, kind: 'core', content: '버스 배차를 늘려야 한다', rationale: null, ...over };
}

function queued(over: Partial<QueuedSave> = {}): QueuedSave {
  return {
    v: 1,
    code: '082901',
    topicId: 'topic-1',
    items: [item()],
    baseUpdatedAt: '2026-09-01T00:00:00.000Z',
    queuedAtMs: NOW,
    attempts: 1,
    nextAttemptAtMs: NOW + 5_000,
    ...over,
  };
}

describe('queueKey — 꼭지당 1건', () => {
  it('접두사 + 코드 + 꼭지 id', () => {
    expect(queueKey('082901', 'topic-1')).toBe('climate_vote_queue:082901:topic-1');
    expect(queueKey('082901', 'topic-1').startsWith(QUEUE_KEY_PREFIX)).toBe(true);
  });

  it('같은 꼭지는 같은 키다 — 새 실패가 옛 것을 덮어쓴다', () => {
    expect(queueKey('082901', 'topic-1')).toBe(queueKey('082901', 'topic-1'));
  });

  it('꼭지가 다르면 키가 갈린다', () => {
    expect(queueKey('082901', 'topic-1')).not.toBe(queueKey('082901', 'topic-2'));
    expect(queueKey('082901', 'topic-1')).not.toBe(queueKey('082902', 'topic-1'));
  });

  it('초안 키(climate_vote_draft:)와 겹치지 않는다', () => {
    expect(queueKey('082901', 'topic-1').startsWith('climate_vote_draft:')).toBe(false);
  });
});

describe('nextBackoffMs — 5s·15s·45s·120s·300s 그 뒤 300s 유지', () => {
  it('계단을 순서대로 오른다', () => {
    expect(nextBackoffMs(1)).toBe(5_000);
    expect(nextBackoffMs(2)).toBe(15_000);
    expect(nextBackoffMs(3)).toBe(45_000);
    expect(nextBackoffMs(4)).toBe(120_000);
    expect(nextBackoffMs(5)).toBe(300_000);
  });

  it('마지막 계단에서 멈춘다 — 포기하지 않는다', () => {
    expect(nextBackoffMs(6)).toBe(300_000);
    expect(nextBackoffMs(50)).toBe(300_000);
    expect(nextBackoffMs(9_999)).toBe(300_000);
  });

  it('0·음수·NaN 은 첫 계단 — 무한 대기가 생기지 않게', () => {
    expect(nextBackoffMs(0)).toBe(5_000);
    expect(nextBackoffMs(-3)).toBe(5_000);
    expect(nextBackoffMs(Number.NaN)).toBe(5_000);
    expect(nextBackoffMs(Number.POSITIVE_INFINITY)).toBe(5_000);
  });

  it('계단이 설계 정본과 같다', () => {
    expect([...BACKOFF_STEPS_MS]).toEqual([5_000, 15_000, 45_000, 120_000, 300_000]);
  });
});

describe('shouldAttempt — 오프라인이면 시도조차 안 한다', () => {
  it('online 이 false 면 시각과 무관하게 false', () => {
    const q = queued({ nextAttemptAtMs: NOW - 60_000 });
    expect(shouldAttempt(q, NOW, false)).toBe(false);
  });

  it('예정 시각 전이면 false', () => {
    expect(shouldAttempt(queued({ nextAttemptAtMs: NOW + 1 }), NOW, true)).toBe(false);
  });

  it('예정 시각과 정확히 같으면 시도한다(경계 포함)', () => {
    expect(shouldAttempt(queued({ nextAttemptAtMs: NOW }), NOW, true)).toBe(true);
  });

  it('예정 시각이 지났으면 시도한다', () => {
    expect(shouldAttempt(queued({ nextAttemptAtMs: NOW - 1 }), NOW, true)).toBe(true);
  });
});

describe('conflictVerdict — 조용한 덮어쓰기를 막는다', () => {
  it('같으면 send', () => {
    expect(conflictVerdict('2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z')).toBe('send');
  });

  it('다르면 conflict — 그 사이 누가 저장했다', () => {
    expect(conflictVerdict('2026-09-01T00:05:00.000Z', '2026-09-01T00:00:00.000Z')).toBe('conflict');
  });

  it('양쪽 다 없으면 send — 오프라인에서 처음 쓴 조가 막히지 않는다', () => {
    expect(conflictVerdict(null, null)).toBe('send');
    expect(conflictVerdict(undefined, null)).toBe('send');
    expect(conflictVerdict(null, undefined)).toBe('send');
    expect(conflictVerdict(undefined, undefined)).toBe('send');
  });

  it('내가 백지로 알고 있는데 서버에 값이 생겼으면 conflict', () => {
    expect(conflictVerdict('2026-09-01T00:00:00.000Z', null)).toBe('conflict');
    expect(conflictVerdict('2026-09-01T00:00:00.000Z', undefined)).toBe('conflict');
  });

  it('서버가 비었는데 내가 값을 딛고 있으면 conflict', () => {
    expect(conflictVerdict(null, '2026-09-01T00:00:00.000Z')).toBe('conflict');
    expect(conflictVerdict(undefined, '2026-09-01T00:00:00.000Z')).toBe('conflict');
  });
});

describe('makeQueuedSave · withFailedAttempt', () => {
  it('첫 실패는 attempts 1, 5초 뒤 시도', () => {
    const q = makeQueuedSave({
      code: '082901',
      topicId: 'topic-1',
      items: [item()],
      baseUpdatedAt: null,
      nowMs: NOW,
    });
    expect(q.v).toBe(1);
    expect(q.attempts).toBe(1);
    expect(q.queuedAtMs).toBe(NOW);
    expect(q.nextAttemptAtMs).toBe(NOW + 5_000);
    expect(q.baseUpdatedAt).toBeNull();
  });

  it('실패를 이어 세면 계단을 이어 오른다', () => {
    const q = makeQueuedSave({
      code: '082901',
      topicId: 'topic-1',
      items: [item()],
      baseUpdatedAt: null,
      nowMs: NOW,
      attempts: 3,
    });
    expect(q.nextAttemptAtMs).toBe(NOW + 45_000);
  });

  it('withFailedAttempt 는 횟수를 올리고 시각을 다시 잡는다', () => {
    const next = withFailedAttempt(queued({ attempts: 1 }), NOW + 5_000);
    expect(next.attempts).toBe(2);
    expect(next.nextAttemptAtMs).toBe(NOW + 5_000 + 15_000);
  });

  it('withFailedAttempt 는 원본을 바꾸지 않는다', () => {
    const q = queued({ attempts: 1 });
    withFailedAttempt(q, NOW);
    expect(q.attempts).toBe(1);
  });

  it('실패가 쌓여도 items·baseUpdatedAt 은 그대로다 — 글은 변하지 않는다', () => {
    let q = queued({ attempts: 1 });
    for (let i = 0; i < 10; i += 1) q = withFailedAttempt(q, NOW);
    expect(q.items).toEqual([item()]);
    expect(q.baseUpdatedAt).toBe('2026-09-01T00:00:00.000Z');
    expect(q.nextAttemptAtMs).toBe(NOW + 300_000);
  });
});

describe('readQueue / writeQueue — 왕복', () => {
  it('쓴 것을 그대로 되읽는다', () => {
    const q = queued();
    expect(readQueue(writeQueue(q))).toEqual(q);
  });

  it('여러 항목·kind extra·rationale 문자열도 살아남는다', () => {
    const q = queued({
      items: [item(), item({ ordinal: 2, kind: 'extra', rationale: '통계 근거' })],
      baseUpdatedAt: null,
    });
    expect(readQueue(writeQueue(q))).toEqual(q);
  });

  it('없는 값·깨진 JSON 은 null', () => {
    expect(readQueue(null)).toBeNull();
    expect(readQueue('')).toBeNull();
    expect(readQueue('{내용')).toBeNull();
  });

  it('객체가 아니면 null', () => {
    expect(readQueue('"문자열"')).toBeNull();
    expect(readQueue('12')).toBeNull();
    expect(readQueue('null')).toBeNull();
    expect(readQueue('[]')).toBeNull();
  });

  it('버전이 다르면 null', () => {
    expect(readQueue(JSON.stringify({ ...queued(), v: 2 }))).toBeNull();
    const noVersion = { ...queued() } as Partial<QueuedSave>;
    delete noVersion.v;
    expect(readQueue(JSON.stringify(noVersion))).toBeNull();
  });

  it('code·topicId 가 없거나 빈 문자열이면 null', () => {
    expect(readQueue(JSON.stringify({ ...queued(), code: '' }))).toBeNull();
    expect(readQueue(JSON.stringify({ ...queued(), code: 82901 }))).toBeNull();
    expect(readQueue(JSON.stringify({ ...queued(), topicId: '' }))).toBeNull();
  });

  it('숫자 칸이 깨졌으면 null', () => {
    expect(readQueue(JSON.stringify({ ...queued(), queuedAtMs: '어제' }))).toBeNull();
    expect(readQueue(JSON.stringify({ ...queued(), attempts: null }))).toBeNull();
    expect(readQueue(JSON.stringify({ ...queued(), nextAttemptAtMs: undefined }))).toBeNull();
  });

  it('baseUpdatedAt 은 문자열이나 null 만 받는다', () => {
    expect(readQueue(JSON.stringify({ ...queued(), baseUpdatedAt: null }))?.baseUpdatedAt).toBeNull();
    expect(readQueue(JSON.stringify({ ...queued(), baseUpdatedAt: 17 }))).toBeNull();
    // 아예 없는 것도 null 로는 못 본다 — 큐가 무엇을 딛고 섰는지 모르면 대조를 못 한다
    const missing = { ...queued() } as Partial<QueuedSave>;
    delete missing.baseUpdatedAt;
    expect(readQueue(JSON.stringify(missing))).toBeNull();
  });

  it('★ 항목이 하나라도 틀리면 통째로 버린다 — 반쪽 전송이 서버 항목을 지운다', () => {
    expect(readQueue(JSON.stringify({ ...queued(), items: 'core' }))).toBeNull();
    expect(readQueue(JSON.stringify({ ...queued(), items: [item(), { content: '이름만' }] }))).toBeNull();
    expect(
      readQueue(JSON.stringify({ ...queued(), items: [item({ kind: 'bogus' as 'core' })] })),
    ).toBeNull();
    expect(
      readQueue(JSON.stringify({ ...queued(), items: [item({ ordinal: 'first' as unknown as number })] })),
    ).toBeNull();
    expect(
      readQueue(JSON.stringify({ ...queued(), items: [item({ rationale: 3 as unknown as string })] })),
    ).toBeNull();
  });

  it('빈 items 는 그대로 받는다 — 판정은 배선의 몫이다', () => {
    expect(readQueue(JSON.stringify({ ...queued(), items: [] }))?.items).toEqual([]);
  });

  it('모르는 칸은 버리고 계약된 칸만 남긴다', () => {
    const parsed = readQueue(JSON.stringify({ ...queued(), 딴것: '섞임' }));
    expect(parsed).not.toBeNull();
    expect(Object.keys(parsed as QueuedSave).sort()).toEqual(
      ['attempts', 'baseUpdatedAt', 'code', 'items', 'nextAttemptAtMs', 'queuedAtMs', 'topicId', 'v'].sort(),
    );
  });
});
