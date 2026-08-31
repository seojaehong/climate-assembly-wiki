import { describe, it, expect } from 'vitest';
import type { EditorRow } from './submission-panel-logic';
import {
  DRAFT_KEY_PREFIX,
  DRAFT_TTL_MS,
  createDraftStorage,
  readDraft,
  staleKeys,
  writeDraft,
  type StorageLike,
} from './submission-draft-store';

const NOW = 1_756_000_000_000; // 고정 시각 — 이 모듈은 Date.now() 를 부르지 않는다

function row(over: Partial<EditorRow> = {}): EditorRow {
  return { name: '', content: '버스 배차를 늘려야 한다', rationale: '', ...over };
}

/** 테스트용 메모리 Storage. 실제 브라우저 Storage 계약(length·key)을 흉내낸다. */
function fakeStorage(init: Record<string, string> = {}): StorageLike & { dump(): Record<string, string> } {
  const map = new Map(Object.entries(init));
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
    get length() {
      return map.size;
    },
    key: (i) => [...map.keys()][i] ?? null,
    dump: () => Object.fromEntries(map),
  };
}

describe('readDraft — 봉투 읽기', () => {
  it('없는 값·깨진 JSON 은 null', () => {
    expect(readDraft(null, NOW)).toBeNull();
    expect(readDraft('', NOW)).toBeNull();
    expect(readDraft('{내용', NOW)).toBeNull();
  });

  it('v1 봉투를 그대로 돌려준다', () => {
    const raw = writeDraft([row()], '2026-08-31T10:00:00Z', NOW);
    expect(readDraft(raw, NOW)).toEqual({
      v: 1,
      rows: [row()],
      savedAtMs: NOW,
      baseUpdatedAt: '2026-08-31T10:00:00Z',
    });
  });

  it('writeDraft → readDraft 왕복에서 savedAtMs 가 보존된다', () => {
    const env = readDraft(writeDraft([row()], null, NOW), NOW);
    expect(env?.savedAtMs).toBe(NOW);
    expect(env?.baseUpdatedAt).toBeNull();
  });

  it('옛 모양(EditorRow 배열)을 savedAtMs:0 으로 승격한다', () => {
    const raw = JSON.stringify([{ name: '가', content: '내용', rationale: '근거' }]);
    expect(readDraft(raw, NOW)).toEqual({
      v: 1,
      rows: [{ name: '가', content: '내용', rationale: '근거' }],
      savedAtMs: 0,
      baseUpdatedAt: null,
    });
  });

  it('★ 이름 칸이 생기기 전의 옛 초안도 name 을 메워 받는다', () => {
    const raw = JSON.stringify([{ content: '내용', rationale: '근거' }]);
    expect(readDraft(raw, NOW)?.rows).toEqual([{ name: '', content: '내용', rationale: '근거' }]);
  });

  it('봉투 안의 행에도 같은 위생 처리가 걸린다', () => {
    const raw = JSON.stringify({ v: 1, rows: [{ content: '내용' }], savedAtMs: NOW, baseUpdatedAt: null });
    expect(readDraft(raw, NOW)?.rows).toEqual([{ name: '', content: '내용', rationale: '' }]);
  });

  it('한 줄이라도 모양이 틀리면 전체를 버린다', () => {
    const raw = JSON.stringify([{ content: '내용' }, { rationale: '근거만' }]);
    expect(readDraft(raw, NOW)).toBeNull();
  });

  it('빈 배열·v 가 다른 봉투·객체가 아닌 값은 null', () => {
    expect(readDraft('[]', NOW)).toBeNull();
    expect(readDraft(JSON.stringify({ v: 2, rows: [row()] }), NOW)).toBeNull();
    expect(readDraft('"글자"', NOW)).toBeNull();
    expect(readDraft('null', NOW)).toBeNull();
  });

  it('baseUpdatedAt 이 문자열이 아니면 null 로 눕힌다', () => {
    const raw = JSON.stringify({ v: 1, rows: [row()], savedAtMs: NOW, baseUpdatedAt: 12 });
    expect(readDraft(raw, NOW)?.baseUpdatedAt).toBeNull();
  });
});

describe('readDraft — 만료(TTL 기본 72시간)', () => {
  it('기본 TTL 은 72시간이다', () => {
    expect(DRAFT_TTL_MS).toBe(72 * 60 * 60 * 1000);
  });

  it('TTL 안쪽 초안은 살아 있다', () => {
    const raw = writeDraft([row()], null, NOW - DRAFT_TTL_MS + 1);
    expect(readDraft(raw, NOW)).not.toBeNull();
  });

  it('★ 경계 — 정확히 nowMs - ttlMs 인 초안은 아직 만료가 아니다', () => {
    const raw = writeDraft([row()], null, NOW - DRAFT_TTL_MS);
    expect(readDraft(raw, NOW)).not.toBeNull();
  });

  it('1ms 라도 더 오래면 만료다', () => {
    const raw = writeDraft([row()], null, NOW - DRAFT_TTL_MS - 1);
    expect(readDraft(raw, NOW)).toBeNull();
  });

  it('ttlMs 를 직접 줄 수 있다', () => {
    const raw = writeDraft([row()], null, NOW - 10_000);
    expect(readDraft(raw, NOW, 5_000)).toBeNull();
    expect(readDraft(raw, NOW, 20_000)).not.toBeNull();
  });

  it('★ savedAtMs===0 인 승격분은 만료로 보지 않는다', () => {
    const raw = JSON.stringify([row()]);
    expect(readDraft(raw, NOW, 1)).not.toBeNull();
  });

  it('savedAtMs 가 깨져 있으면 0 으로 보아 살려 둔다', () => {
    const raw = JSON.stringify({ v: 1, rows: [row()], savedAtMs: 'x', baseUpdatedAt: null });
    const env = readDraft(raw, NOW, 1);
    expect(env?.savedAtMs).toBe(0);
  });
});

describe('staleKeys', () => {
  const expired = writeDraft([row()], null, NOW - DRAFT_TTL_MS - 1);
  const fresh = writeDraft([row()], null, NOW - 1000);

  it('만료된 초안 키만 돌려준다', () => {
    const store: Record<string, string> = {
      [`${DRAFT_KEY_PREFIX}082901:t1`]: expired,
      [`${DRAFT_KEY_PREFIX}082901:t2`]: fresh,
    };
    expect(staleKeys(Object.keys(store), (k) => store[k] ?? null, NOW)).toEqual([
      `${DRAFT_KEY_PREFIX}082901:t1`,
    ]);
  });

  it('접두사가 다른 키는 만료여도 건드리지 않는다 — 큐 키를 지우면 안 된다', () => {
    const store: Record<string, string> = {
      'climate_vote_queue:082901:t1': expired,
      climate_vote_guide_collapsed: '1',
    };
    expect(staleKeys(Object.keys(store), (k) => store[k] ?? null, NOW)).toEqual([]);
  });

  it('깨진 값과 승격분(savedAtMs:0)은 돌려주지 않는다', () => {
    const store: Record<string, string> = {
      [`${DRAFT_KEY_PREFIX}a:1`]: '{깨짐',
      [`${DRAFT_KEY_PREFIX}a:2`]: JSON.stringify([row()]),
    };
    expect(staleKeys(Object.keys(store), (k) => store[k] ?? null, NOW)).toEqual([]);
  });

  it('readRaw 가 던져도 예외가 새 나가지 않는다', () => {
    expect(
      staleKeys([`${DRAFT_KEY_PREFIX}a:1`], () => {
        throw new Error('접근 차단');
      }, NOW),
    ).toEqual([]);
  });

  it('ttlMs 를 직접 줄 수 있다', () => {
    const store: Record<string, string> = { [`${DRAFT_KEY_PREFIX}a:1`]: fresh };
    expect(staleKeys(Object.keys(store), (k) => store[k] ?? null, NOW, 500)).toEqual([
      `${DRAFT_KEY_PREFIX}a:1`,
    ]);
  });
});

describe('createDraftStorage — 계층 폴백', () => {
  it('localStorage 가 살아 있으면 거기 쓴다', () => {
    const local = fakeStorage();
    const session = fakeStorage();
    const store = createDraftStorage([
      { name: 'local', get: () => local },
      { name: 'session', get: () => session },
    ]);
    store.setItem('k', 'v');
    expect(local.dump()).toEqual({ k: 'v' });
    expect(session.dump()).toEqual({});
    expect(store.tier()).toBe('local');
    expect(store.getItem('k')).toBe('v');
  });

  it('QuotaExceededError 면 sessionStorage 로 내려간다', () => {
    const local = fakeStorage();
    local.setItem = () => {
      const err = new Error('quota');
      err.name = 'QuotaExceededError';
      throw err;
    };
    const session = fakeStorage();
    const store = createDraftStorage([
      { name: 'local', get: () => local },
      { name: 'session', get: () => session },
    ]);
    store.setItem('k', 'v');
    expect(session.dump()).toEqual({ k: 'v' });
    expect(store.tier()).toBe('session');
  });

  it('★ 강등되면 위 계층의 옛 값을 지운다 — 안 지우면 새 초안이 옛 초안에 가린다', () => {
    // localStorage 에 v1 이 이미 있고, v2 쓰기가 용량 초과로 실패하는 상황.
    // setItem 은 원자적으로 실패해 v1 이 남으므로, 읽기가 위에서부터 훑으면 v1 이 나온다.
    const local = fakeStorage({ k: 'v1' });
    local.setItem = () => {
      const err = new Error('quota');
      err.name = 'QuotaExceededError';
      throw err;
    };
    const session = fakeStorage();
    const store = createDraftStorage([
      { name: 'local', get: () => local },
      { name: 'session', get: () => session },
    ]);
    store.setItem('k', 'v2');
    expect(store.getItem('k')).toBe('v2');
    expect(local.dump()).toEqual({});
    expect(session.dump()).toEqual({ k: 'v2' });
  });

  it('★ 메모리까지 떨어져도 위 계층의 옛 값이 남지 않는다', () => {
    const local = fakeStorage({ k: 'v1' });
    local.setItem = () => {
      throw new Error('nope');
    };
    const store = createDraftStorage([{ name: 'local', get: () => local }]);
    store.setItem('k', 'v2');
    expect(store.getItem('k')).toBe('v2');
    expect(local.dump()).toEqual({});
  });

  it('★ 승격(session → local)에서도 사본이 둘로 갈라지지 않는다', () => {
    const local = fakeStorage();
    const session = fakeStorage({ k: 'old' });
    const store = createDraftStorage([
      { name: 'local', get: () => local },
      { name: 'session', get: () => session },
    ]);
    store.setItem('k', 'new');
    expect(local.dump()).toEqual({ k: 'new' });
    expect(session.dump()).toEqual({});
    expect(store.getItem('k')).toBe('new');
  });

  it('★ 접근 자체가 던지는 브라우저(사생활 보호)도 같게 다룬다', () => {
    const session = fakeStorage();
    const store = createDraftStorage([
      {
        name: 'local',
        get: () => {
          throw new Error('SecurityError');
        },
      },
      { name: 'session', get: () => session },
    ]);
    store.setItem('k', 'v');
    expect(session.dump()).toEqual({ k: 'v' });
  });

  it('둘 다 없으면 메모리로 떨어지고 예외를 던지지 않는다', () => {
    const store = createDraftStorage([
      { name: 'local', get: () => undefined },
      { name: 'session', get: () => undefined },
    ]);
    expect(() => store.setItem('k', 'v')).not.toThrow();
    expect(store.getItem('k')).toBe('v');
    expect(store.tier()).toBe('memory');
    expect(store.keys()).toEqual(['k']);
  });

  it('둘 다 던져도 메모리로 살아남는다', () => {
    const bust = (): StorageLike => {
      const s = fakeStorage();
      s.setItem = () => {
        throw new Error('nope');
      };
      return s;
    };
    const store = createDraftStorage([
      { name: 'local', get: bust },
      { name: 'session', get: bust },
    ]);
    store.setItem('k', 'v');
    expect(store.getItem('k')).toBe('v');
    expect(store.tier()).toBe('memory');
  });

  it('★ 이 배포 이전에 sessionStorage 에만 있던 초안을 읽어 온다', () => {
    const local = fakeStorage();
    const session = fakeStorage({ [`${DRAFT_KEY_PREFIX}082901:t1`]: JSON.stringify([row()]) });
    const store = createDraftStorage([
      { name: 'local', get: () => local },
      { name: 'session', get: () => session },
    ]);
    const raw = store.getItem(`${DRAFT_KEY_PREFIX}082901:t1`);
    expect(readDraft(raw, NOW)?.rows).toEqual([row()]);
  });

  it('지우기는 모든 계층에서 지운다 — 한 곳만 지우면 낡은 초안이 되살아난다', () => {
    const local = fakeStorage({ k: 'old' });
    const session = fakeStorage({ k: 'older' });
    const store = createDraftStorage([
      { name: 'local', get: () => local },
      { name: 'session', get: () => session },
    ]);
    store.removeItem('k');
    expect(local.dump()).toEqual({});
    expect(session.dump()).toEqual({});
    expect(store.getItem('k')).toBeNull();
  });

  it('keys() 는 접근 가능한 계층의 합집합이다', () => {
    const local = fakeStorage({ a: '1' });
    const session = fakeStorage({ a: '1', b: '2' });
    const store = createDraftStorage([
      { name: 'local', get: () => local },
      { name: 'session', get: () => session },
    ]);
    store.setItem('c', '3'); // local 로 들어간다
    expect(store.keys().sort()).toEqual(['a', 'b', 'c']);
  });

  it('읽기·지우기·훑기가 던지는 계층이 있어도 예외가 새 나가지 않는다', () => {
    const broken: StorageLike = {
      getItem: () => {
        throw new Error('x');
      },
      setItem: () => {
        throw new Error('x');
      },
      removeItem: () => {
        throw new Error('x');
      },
      get length(): number {
        throw new Error('x');
      },
      key: () => null,
    };
    const store = createDraftStorage([{ name: 'local', get: () => broken }]);
    expect(() => store.setItem('k', 'v')).not.toThrow();
    expect(store.getItem('k')).toBe('v'); // 메모리로 떨어진 값
    expect(store.keys()).toEqual(['k']);
    expect(() => store.removeItem('k')).not.toThrow();
    expect(store.getItem('k')).toBeNull();
  });

  it('기본 후보(브라우저 전역)로 만들어도 node 환경에서 죽지 않는다', () => {
    const store = createDraftStorage();
    expect(() => store.setItem('k', 'v')).not.toThrow();
    expect(store.getItem('k')).toBe('v');
  });
});
