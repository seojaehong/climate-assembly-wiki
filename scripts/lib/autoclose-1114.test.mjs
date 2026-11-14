import { describe, expect, it, vi } from 'vitest';
import { GRACE_SEC, createAutoCloser, defaultMinutes, dueAt, kstHms, kstTimeToday, parseCloseMin, pickMinutes, showUrls } from './autoclose-1114.mjs';

const T0 = Date.parse('2026-11-14T05:10:00Z'); // 14:10:00 KST
const ballot = (status, extra = {}) => ({ id: 'b1', title: '전체회의 의결 의제1', status, item_count: 19, agenda: 1, ...extra });

function rig({ mode = 'test', cli = new Map(), closeStatus = 'closed', closeThrows = null, guardThrows = null, saved = null } = {}) {
  let t = T0;
  let store = saved;
  const calls = { close: 0, fake: 0, status: 0, guard: 0 };
  const closer = createAutoCloser({
    mode,
    now: () => t,
    cliMinutes: cli,
    load: () => (store ? JSON.parse(JSON.stringify(store)) : null),
    save: (s) => {
      store = JSON.parse(JSON.stringify(s));
    },
    guardFn: async () => {
      calls.guard += 1;
      if (guardThrows) throw new Error(guardThrows);
    },
    closeFn: async () => {
      calls.close += 1;
      if (closeThrows) throw new Error(closeThrows);
    },
    fakeCloseFn: async () => {
      calls.fake += 1;
    },
    statusFn: async () => {
      calls.status += 1;
      return closeStatus;
    },
  });
  return { closer, calls, set: (ms) => (t = ms), get store() { return store; } };
}

describe('계산', () => {
  it('기본 분 = 권고 수 × 90초', () => {
    expect(defaultMinutes(19)).toBe(28.5);
    expect(defaultMinutes(28)).toBe(42);
  });
  it('--close-min 읽기(소수 허용 · 잘못된 값 버림)', () => {
    const m = parseCloseMin('의제1=30,의제2=45, 3=0.5,의제4=0,의제5=abc');
    expect([...m]).toEqual([[1, 30], [2, 45], [3, 0.5]]);
  });
  it('마감 = 기준 + 분 + 15초 (+조정)', () => {
    expect(GRACE_SEC).toBe(15);
    expect(dueAt({ openedAt: T0, minutes: 30 })).toBe(T0 + 30 * 60000 + 15000);
    expect(dueAt({ openedAt: T0, minutes: 0.5, adjustSec: 60 })).toBe(T0 + 30000 + 60000 + 15000);
  });
  it('분 우선순위 = 화면 저장 > 명령줄 > 기본', () => {
    const cli = new Map([[1, 30]]);
    expect(pickMinutes({ saved: 25, cli, agenda: 1, itemCount: 19 }).minutes).toBe(25);
    expect(pickMinutes({ saved: null, cli, agenda: 1, itemCount: 19 }).minutes).toBe(30);
    expect(pickMinutes({ saved: null, cli, agenda: 2, itemCount: 28 }).minutes).toBe(42);
  });
  it('/show 주소 — 의제 순 · present · min 자리 순서, 토큰이 이상하면 뺀다', () => {
    const A = 'a'.repeat(32);
    const B = 'b'.repeat(32);
    const u = showUrls([{ agenda: 2, token: B, minutes: 42 }, { agenda: 1, token: A, minutes: 28.5 }, { agenda: 3, token: 'x', minutes: 30 }], { site: 'https://s', present: 164 });
    expect(u.one).toEqual([{ agenda: 1, url: `https://s/show?t=${A}&present=164&min=28.5` }, { agenda: 2, url: `https://s/show?t=${B}&present=164&min=42` }]);
    expect(u.all).toBe(`https://s/show?t=${A},${B}&present=164&min=28.5,42`);
    expect(u.allAuto).toBe(`${u.all}&auto=1`);
  });
  it('KST 시각 왕복', () => {
    const ms = kstTimeToday('14:10:05', T0);
    expect(ms).toBe(T0 + 5000);
    expect(kstHms(ms)).toBe('14:10:05');
  });
});

describe('자동 마감', () => {
  it('draft → open 을 본 시각이 기준, 예정 시각 전에는 안 닫고 지나면 한 번만 닫는다', async () => {
    const r = rig({ cli: new Map([[1, 1]]) });
    r.closer.observe([ballot('draft')]);
    r.set(T0 + 2000);
    r.closer.observe([ballot('open')]);
    const row = r.closer.view().rows[0];
    expect(row.openedAt).toBe(T0 + 2000);
    expect(row.uncertaintyMs).toBe(2000);
    expect(row.dueAt).toBe(T0 + 2000 + 60000 + 15000);
    r.set(row.dueAt - 1);
    expect(r.closer.tick()).toHaveLength(0);
    r.set(row.dueAt + 500);
    await Promise.all(r.closer.tick());
    expect(r.calls).toMatchObject({ guard: 1, close: 1, status: 1 });
    expect(r.closer.view().rows[0].result).toMatchObject({ ok: true, status: 'closed', kind: 'auto' });
    r.set(row.dueAt + 3000);
    expect(r.closer.tick()).toHaveLength(0); // 두 번째 없음
    expect(r.calls.close).toBe(1);
  });

  it('닫기 실패 — 재시도 없이 빨간 결과, 사람이 「지금 닫기」 누를 때마다 한 번', async () => {
    const r = rig({ cli: new Map([[1, 1]]), closeThrows: 'HTTP 500', closeStatus: 'open' });
    r.closer.observe([ballot('draft')]);
    r.closer.observe([ballot('open')]);
    r.set(T0 + 75000);
    await Promise.all(r.closer.tick());
    r.set(T0 + 90000);
    expect(r.closer.tick()).toHaveLength(0);
    expect(r.calls.close).toBe(1);
    const res = r.closer.view().rows[0].result;
    expect(res.ok).toBe(false);
    expect(res.error).toContain('HTTP 500');
    await r.closer.control('close', 'b1');
    expect(r.calls.close).toBe(2);
  });

  it('응답이 끊겨도 다시 읽어 closed 면 성공으로 본다', async () => {
    const r = rig({ cli: new Map([[1, 1]]), closeThrows: '응답 없음(8초)', closeStatus: 'closed' });
    r.closer.observe([ballot('draft')]);
    r.closer.observe([ballot('open')]);
    r.set(T0 + 75000);
    await Promise.all(r.closer.tick());
    expect(r.closer.view().rows[0].result).toMatchObject({ ok: true, status: 'closed', closeError: '응답 없음(8초)' });
  });

  it('끄기 · +1분 · -1분', async () => {
    const r = rig({ cli: new Map([[1, 1]]) });
    r.closer.observe([ballot('draft')]);
    r.closer.observe([ballot('open')]);
    await r.closer.control('enable', 'b1', false);
    r.set(T0 + 80000);
    expect(r.closer.tick()).toHaveLength(0);
    await r.closer.control('enable', 'b1', true);
    await r.closer.control('plus', 'b1');
    expect(r.closer.view().rows[0].dueAt).toBe(T0 + 60000 + 60000 + 15000);
    expect(r.closer.tick()).toHaveLength(0);
    await r.closer.control('minus', 'b1');
    // -1분으로 예정이 이미 지났으면 곧바로 닫지 않는다(사람이 「지금 닫기」)
    expect(r.closer.view().rows[0].missed).toBe(true);
    expect(r.closer.tick()).toHaveLength(0);
    expect(r.calls.close).toBe(0);
  });

  it('시연(fake) — 실제 닫기 · 안전장치 · 다시 읽기를 부르지 않는다', async () => {
    const r = rig({ mode: 'fake', cli: new Map([[1, 1]]) });
    r.closer.observe([ballot('draft')]);
    r.closer.observe([ballot('open')]);
    r.set(T0 + 75000);
    await Promise.all(r.closer.tick());
    await r.closer.control('close', 'b1');
    expect(r.calls).toMatchObject({ close: 0, guard: 0, status: 0 });
    expect(r.calls.fake).toBe(2); // 자동 1 + 「지금 닫기」 1
    expect(r.closer.view().rows[0].result).toMatchObject({ ok: true, fake: true });
  });

  it('안전장치에서 막히면 닫기를 부르지 않는다', async () => {
    const r = rig({ cli: new Map([[1, 1]]), guardThrows: '세션이 zz-dryrun- 이 아님' });
    r.closer.observe([ballot('draft')]);
    r.closer.observe([ballot('open')]);
    r.set(T0 + 75000);
    await Promise.all(r.closer.tick());
    expect(r.calls.close).toBe(0);
    expect(r.closer.view().rows[0].result).toMatchObject({ ok: false, calledRpc: false });
    expect(r.closer.view().rows[0].result.error).toContain('zz-dryrun');
  });

  it('진행판이 켜지기 전에 이미 열린 투표지는 걸지 않는다 — 연 시각을 넣으면 건다', async () => {
    const r = rig({ cli: new Map([[1, 1]]) });
    r.closer.observe([ballot('open')]);
    expect(r.closer.view().rows[0]).toMatchObject({ basis: 'unknown', dueAt: null });
    r.set(T0 + 600000);
    expect(r.closer.tick()).toHaveLength(0);
    await r.closer.control('openedAt', 'b1', kstHms(T0 + 590000));
    const row = r.closer.view().rows[0];
    expect(row).toMatchObject({ basis: 'manual', openedAt: T0 + 590000 });
    r.set(row.dueAt + 100);
    await Promise.all(r.closer.tick());
    expect(r.calls.close).toBe(1);
  });

  it('draft 를 본 지 30초가 넘어 열린 것을 보면(오차 큼) 걸지 않는다', () => {
    const r = rig();
    r.closer.observe([ballot('draft')]);
    r.set(T0 + 31000);
    r.closer.observe([ballot('open')]);
    expect(r.closer.view().rows[0].basis).toBe('unknown');
  });

  it('재시작 — 기준점은 유지, 시도 표시가 남아 있으면 다시 부르지 않는다, 켜지기 전에 지난 예정은 놓침 처리', async () => {
    const a = rig({ cli: new Map([[1, 1]]) });
    a.closer.observe([ballot('draft')]);
    a.closer.observe([ballot('open')]);
    // 재시작(같은 저장본) — 예정 전
    const b = rig({ cli: new Map([[1, 1]]), saved: a.store });
    b.closer.observe([ballot('open')]);
    expect(b.closer.view().rows[0].openedAt).toBe(T0);
    // 재시작 시점이 이미 예정 뒤
    const late = rig({ cli: new Map([[1, 1]]), saved: a.store });
    late.set(T0 + 100000);
    const c = createAutoCloser({ mode: 'test', now: () => T0 + 100000, cliMinutes: new Map([[1, 1]]), load: () => JSON.parse(JSON.stringify(a.store)),
      guardFn: async () => {}, closeFn: vi.fn(), statusFn: async () => 'closed' });
    c.observe([ballot('open')]);
    expect(c.tick()).toHaveLength(0);
    expect(c.view().rows[0].missed).toBe(true);
    // 시도 표시가 남은 저장본
    const tried = JSON.parse(JSON.stringify(a.store));
    tried.ballots.b1.attempted = true;
    const d = rig({ cli: new Map([[1, 1]]), saved: tried });
    d.closer.observe([ballot('open')]);
    d.set(T0 + 75000);
    expect(d.closer.tick()).toHaveLength(0);
    expect(d.calls.close).toBe(0);
  });

  it('사람이 /mod 에서 먼저 닫으면 부르지 않는다', () => {
    const r = rig({ cli: new Map([[1, 1]]) });
    r.closer.observe([ballot('draft')]);
    r.closer.observe([ballot('open')]);
    r.set(T0 + 30000);
    r.closer.observe([ballot('closed')]);
    r.set(T0 + 80000);
    expect(r.closer.tick()).toHaveLength(0);
    expect(r.closer.view().rows[0].closedBy).toBe('other');
  });

  it('닫힌 뒤 초안으로 되돌리면(리허설 복원) 지난 기록을 비우고, 다시 열면 다시 닫는다', async () => {
    const r = rig({ cli: new Map([[1, 1]]) });
    r.closer.observe([ballot('draft')]);
    r.closer.observe([ballot('open')]);
    r.set(T0 + 75000);
    await Promise.all(r.closer.tick());
    r.closer.observe([ballot('closed')]);
    r.set(T0 + 200000);
    r.closer.observe([ballot('draft')]);
    expect(r.closer.view().rows[0]).toMatchObject({ openedAt: null, attempted: false, result: null, closedBy: null });
    r.set(T0 + 201000);
    r.closer.observe([ballot('open')]);
    r.set(T0 + 201000 + 75000);
    await Promise.all(r.closer.tick());
    expect(r.calls.close).toBe(2);
  });

  it('잠자기 등으로 예정보다 60초 넘게 늦게 깨면 자동으로 닫지 않는다', () => {
    const r = rig({ cli: new Map([[1, 1]]) });
    r.closer.observe([ballot('draft')]);
    r.closer.observe([ballot('open')]);
    r.set(T0 + 75000 + 61000);
    expect(r.closer.tick()).toHaveLength(0);
    expect(r.closer.view().rows[0].missed).toBe(true);
  });
});
