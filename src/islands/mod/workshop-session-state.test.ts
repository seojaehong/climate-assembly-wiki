import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Topic } from '../../lib/deliberation';
import {
  EMPTY_WORKSHOP_WORK_SUMMARY,
  addedTopics,
  isTextEditingControl,
  preserveEditorScrollAfterTopicInsertion,
  retryDelayMs,
  sameWorkshopTopics,
  sessionAfterFailedSync,
  sessionAfterSuccessfulSync,
  summarizeTopicWork,
  topicAnnouncement,
  type TopicWorkState,
  type WorkshopSessionState,
} from './workshop-session-state';

afterEach(() => {
  vi.unstubAllGlobals();
});

const topic = (id: string, ordinal: number): Topic => ({
  id,
  ordinal,
  block: 'am',
  prompt: `꼭지 ${ordinal}`,
  guidance: null,
  status: 'open',
});

describe('workshop topic synchronization', () => {
  it('limits automatic scroll restoration to text-editing controls', () => {
    expect(isTextEditingControl('textarea', null, false)).toBe(true);
    expect(isTextEditingControl('INPUT', 'text', false)).toBe(true);
    expect(isTextEditingControl('input', 'checkbox', false)).toBe(false);
    expect(isTextEditingControl('button', null, false)).toBe(false);
    expect(isTextEditingControl('div', null, true)).toBe(true);
  });

  it('restores both the commit shift and a later layout shift without overriding user intent', () => {
    class FakeHtmlElement {
      readonly tagName = 'TEXTAREA';
      readonly isContentEditable = false;

      closest(selector: string): FakeHtmlElement | null {
        return selector === '[data-workshop-editor-topic]' ? this : null;
      }
    }
    class FakeHtmlInputElement extends FakeHtmlElement {
      readonly type = 'text';
    }

    const active = new FakeHtmlElement();
    const frames: FrameRequestCallback[] = [];
    const listeners = new Map<string, (event: unknown) => void>();
    const scrollTo = vi.fn<(x: number, y: number) => void>();
    const fakeWindow = {
      scrollX: 8,
      scrollY: 240,
      scrollTo,
      requestAnimationFrame: vi.fn((callback: FrameRequestCallback) => {
        frames.push(callback);
        return frames.length;
      }),
      cancelAnimationFrame: vi.fn(),
      addEventListener: vi.fn((type: string, listener: EventListenerOrEventListenerObject) => {
        if (typeof listener === 'function') listeners.set(type, listener as (event: unknown) => void);
      }),
      removeEventListener: vi.fn((type: string) => {
        listeners.delete(type);
      }),
    };
    scrollTo.mockImplementation((x, y) => {
      fakeWindow.scrollX = x;
      fakeWindow.scrollY = y;
    });
    vi.stubGlobal('HTMLElement', FakeHtmlElement);
    vi.stubGlobal('HTMLInputElement', FakeHtmlInputElement);
    vi.stubGlobal('document', { activeElement: active });
    vi.stubGlobal('window', fakeWindow);

    const restoration = preserveEditorScrollAfterTopicInsertion();
    fakeWindow.scrollY = 249;
    restoration.restoreAfterCommit();
    expect(scrollTo).toHaveBeenLastCalledWith(8, 240);

    // commit 뒤 다음 frame에 생긴 scroll anchoring도 원래 위치로 되돌린다.
    fakeWindow.scrollY = 247;
    frames.shift()?.(16);
    expect(scrollTo).toHaveBeenLastCalledWith(8, 240);

    listeners.get('wheel')?.({} as Event);
    fakeWindow.scrollY = 260;
    restoration.restoreAfterCommit();
    expect(fakeWindow.scrollY).toBe(260);
  });

  it('uses 5/10/20/30 second retry backoff and caps there', () => {
    expect([1, 2, 3, 4, 5, 99].map(retryDelayMs)).toEqual([
      5_000,
      10_000,
      20_000,
      30_000,
      30_000,
      30_000,
    ]);
  });

  it('does not announce the first successful topic load', () => {
    const next = [topic('one', 1), topic('two', 2)];
    expect(addedTopics(null, next)).toEqual([]);
    expect(topicAnnouncement([])).toBeNull();
  });

  it('announces only topics added after the initial snapshot', () => {
    const next = [topic('one', 1), topic('two', 2), topic('three', 3)];
    const added = addedTopics(['one', 'two'], next);
    expect(added.map((item) => item.id)).toEqual(['three']);
    expect(topicAnnouncement(added)).toContain('꼭지③');
  });

  it('preserves the last good topics, clock offset and timestamp across failures', () => {
    const priorTopic = topic('one', 1);
    const prior: WorkshopSessionState = {
      topics: [priorTopic],
      serverClockOffsetMs: 12_000,
      lastSyncedAtMs: 50_000,
      connection: 'online',
      syncing: true,
      consecutiveFailures: 0,
      newTopicIds: [],
      newTopicAnnouncement: null,
    };

    const failed = sessionAfterFailedSync(prior, 2, false);
    expect(failed.topics).toBe(prior.topics);
    expect(failed.serverClockOffsetMs).toBe(12_000);
    expect(failed.lastSyncedAtMs).toBe(50_000);
    expect(failed.connection).toBe('retrying');
    expect(failed.consecutiveFailures).toBe(2);
  });

  it('takes topics and server time from one successful snapshot', () => {
    const next = [{ ...topic('one', 1), server_now: '1970-01-01T00:01:10.000Z' }];
    const current: WorkshopSessionState = {
      topics: null,
      serverClockOffsetMs: 0,
      lastSyncedAtMs: null,
      connection: 'idle',
      syncing: true,
      consecutiveFailures: 1,
      newTopicIds: [],
      newTopicAnnouncement: null,
    };

    const synced = sessionAfterSuccessfulSync(current, next, 60_000, []);
    expect(synced.topics).toBe(next);
    expect(synced.serverClockOffsetMs).toBe(10_000);
    expect(synced.lastSyncedAtMs).toBe(60_000);
    expect(synced.connection).toBe('online');
  });

  it('keeps the topic array reference when only response server_now changes', () => {
    const prior = [{ ...topic('one', 1), server_now: '2026-09-12T00:00:00Z' }];
    const next = [{ ...prior[0], server_now: '2026-09-12T00:00:05Z' }];
    expect(sameWorkshopTopics(prior, next)).toBe(true);

    const current: WorkshopSessionState = {
      topics: prior,
      serverClockOffsetMs: 0,
      lastSyncedAtMs: 0,
      connection: 'online',
      syncing: false,
      consecutiveFailures: 0,
      newTopicIds: [],
      newTopicAnnouncement: null,
    };
    expect(sessionAfterSuccessfulSync(current, next, 1_000, []).topics).toBe(prior);
    expect(sameWorkshopTopics(prior, [{ ...next[0], deadline_at: '2026-09-12T01:00:00Z' }])).toBe(false);
  });
});

describe('workshop work summary', () => {
  it('counts dirty, queued, conflict, saving and failed states without losing topic ids', () => {
    const states: Record<string, TopicWorkState> = {
      one: { unsaved: true, queued: false, conflict: false, saving: false, failed: false },
      two: { unsaved: false, queued: true, conflict: true, saving: false, failed: false },
      three: { unsaved: true, queued: false, conflict: false, saving: true, failed: true },
    };

    expect(summarizeTopicWork(states)).toEqual({
      unsavedTopicIds: ['one', 'three'],
      unsaved: 2,
      queued: 1,
      conflicts: 1,
      saving: 1,
      failed: 1,
    });
  });

  it('provides an immutable-looking empty value for the first paint', () => {
    expect(EMPTY_WORKSHOP_WORK_SUMMARY).toEqual({
      unsavedTopicIds: [],
      unsaved: 0,
      queued: 0,
      conflicts: 0,
      saving: 0,
      failed: 0,
    });
  });
});
