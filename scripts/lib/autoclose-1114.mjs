/**
 * 11/14 의결 — 진행판 「자동 마감」 판단(순수 로직 + 주입한 닫기 함수). 서버 · 화면은 scripts/chase-1114.mjs.
 *
 * 마감 예정 = 기준점(투표지가 open 이 된 시각) + 분 + 15초.
 *   기준점: DB 에 연 시각 열이 없다(ballot 표 = published_at · archived_at 뿐, 11/14 실측). 그래서 진행판이
 *   draft → open 을 처음 본 시각을 쓴다. 오차 = 마지막으로 draft 를 본 시각과의 차(폴링 간격).
 *   진행판이 켜지기 전에 이미 열려 있었거나 오차가 30초를 넘으면 자동으로 걸지 않는다 — 사람이 연 시각을 넣는다.
 * 닫기는 한 번만 시도한다. 시도 표시(attempted)를 먼저 저장하고 부른다(재시작해도 두 번 부르지 않게).
 * 닫은 뒤에는 상태를 다시 읽어 closed 인지 본다(응답이 끊겨도 닫혔을 수 있다 — 시간 초과는 실패가 아니다).
 * 자동 재시도 없음. 실패하면 화면에 빨간 경고 + 「지금 닫기」(사람이 누를 때마다 한 번).
 */

export const GRACE_SEC = 15;
/** 이 이상 늦게 깨어나면(노트북 잠자기 등) 자동으로 닫지 않고 사람에게 넘긴다. */
export const LATE_LIMIT_MS = 60_000;
/** draft → open 관측 오차가 이보다 크면 기준점으로 쓰지 않는다. */
export const MAX_UNCERTAINTY_MS = 30_000;

/** 「의제1=30,의제2=45,3=35」 → Map(의제 번호 → 분). 0 보다 큰 수(소수 허용)만. */
export function parseCloseMin(text) {
  const out = new Map();
  for (const part of String(text ?? '').split(',')) {
    const m = /^\s*(?:의제\s*)?([1-9])\s*=\s*([0-9]+(?:\.[0-9]+)?)\s*$/.exec(part);
    if (!m) continue;
    const v = Number(m[2]);
    if (Number.isFinite(v) && v > 0) out.set(Number(m[1]), v);
  }
  return out;
}

/** /show 기본과 같다 — 권고 수 × 90초(분 단위). */
export function defaultMinutes(itemCount) {
  return (Math.max(0, Number(itemCount) || 0) * 90) / 60;
}

export function validMinutes(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 && n <= 600 ? n : null;
}

/** 타이머 끝(기준 + 분 + 조정). */
export function timerEndAt({ openedAt, minutes, adjustSec = 0 }) {
  if (!Number.isFinite(openedAt) || !Number.isFinite(minutes)) return null;
  return openedAt + minutes * 60_000 + (Number(adjustSec) || 0) * 1000;
}

/** 자동 마감 예정 = 타이머 끝 + 15초. */
export function dueAt(p) {
  const end = timerEndAt(p);
  return end == null ? null : end + GRACE_SEC * 1000;
}

/** 분 고르기 — 화면 저장값(투표지별) > 명령줄(의제별) > 권고 수 × 90초. */
export function pickMinutes({ saved, cli, agenda, itemCount }) {
  if (validMinutes(saved)) return { minutes: Number(saved), source: '화면 저장' };
  const c = agenda != null ? cli?.get?.(agenda) : undefined;
  if (validMinutes(c)) return { minutes: Number(c), source: '명령줄 --close-min' };
  return { minutes: defaultMinutes(itemCount), source: '기본(권고 수 × 90초)' };
}

/** KST 「HH:MM:SS」 → 오늘(KST) 그 시각의 ms. 잘못되면 null. */
export function kstTimeToday(hms, now = Date.now()) {
  const m = /^\s*(\d{1,2}):(\d{2})(?::(\d{2}))?\s*$/.exec(String(hms ?? ''));
  if (!m) return null;
  const [h, mi, s] = [Number(m[1]), Number(m[2]), Number(m[3] ?? 0)];
  if (h > 23 || mi > 59 || s > 59) return null;
  const k = new Date(now + 9 * 3600_000);
  const day = Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate());
  return day + ((h * 60 + mi) * 60 + s) * 1000 - 9 * 3600_000;
}

export function kstHms(ms) {
  if (!Number.isFinite(ms)) return '';
  const k = new Date(ms + 9 * 3600_000);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(k.getUTCHours())}:${p(k.getUTCMinutes())}:${p(k.getUTCSeconds())}`;
}

/**
 * @param o.mode 'live' | 'test' | 'fake' — fake 면 closeFn 을 부르지 않고 fakeCloseFn 만(시연 · --lan).
 * @param o.closeFn async (ballotId) => 응답   (실전 · 시험: ballot_set_status_v2 'closed')
 * @param o.fakeCloseFn async (ballotId) => void
 * @param o.statusFn async (ballotId) => 'open'|'closed'|... (닫은 뒤 다시 읽기, 캐시 없이)
 * @param o.guardFn async (ballotId) => void — 통과 못 하면 throw(세션 확인). fake 에서는 부르지 않는다.
 * @param o.load () => 저장 상태 | null,  o.save (state) => void,  o.log (entry) => void
 * @param o.cliMinutes Map(의제 → 분)
 * @param o.openedAtOf? (ballotId) => ms | null — 출처가 연 시각을 알면(시연) 그것을 쓴다
 */
export function createAutoCloser(o) {
  const now = o.now ?? (() => Date.now());
  const startedAt = now();
  const loaded = o.load?.() ?? null;
  const st = { ballots: loaded?.ballots && typeof loaded.ballots === 'object' ? loaded.ballots : {} };
  const inflight = new Set();
  const persist = () => {
    try {
      o.save?.(st);
    } catch {
      /* 저장 실패가 마감 판단을 바꾸지 않는다 */
    }
  };
  const log = (e) => {
    try {
      o.log?.({ at: new Date(now()).toISOString(), ...e });
    } catch {
      /* 기록 실패 무시 */
    }
  };
  const entry = (id) => {
    if (!st.ballots[id]) {
      st.ballots[id] = { openedAt: null, basis: null, uncertaintyMs: null, lastDraftAt: null, minutes: null, adjustSec: 0, enabled: true,
        attempted: false, result: null, closedBy: null, missed: false, status: null };
    }
    return st.ballots[id];
  };
  const meta = new Map(); // id → { agenda, title, itemCount }

  function rowDue(id) {
    const e = st.ballots[id];
    const m = meta.get(id) ?? {};
    const { minutes } = pickMinutes({ saved: e?.minutes, cli: o.cliMinutes, agenda: m.agenda, itemCount: m.itemCount });
    return e?.openedAt == null ? null : dueAt({ openedAt: e.openedAt, minutes, adjustSec: e.adjustSec });
  }

  /** 투표지 목록(초안 포함, 캐시 없이)을 본다. */
  function observe(list, at = now()) {
    let changed = false;
    for (const b of list ?? []) {
      meta.set(b.id, { agenda: b.agenda ?? null, title: b.title ?? '', itemCount: Number(b.item_count) || 0 });
      const e = entry(b.id);
      const prev = e.status;
      if (b.status === 'draft') {
        e.lastDraftAt = at;
        changed = true; // lastDraftAt 를 저장해 둬야 재시작 뒤에도 오차를 잴 수 있다
      } else if (b.status === 'open' && e.openedAt == null && e.basis !== 'unknown') {
        const known = o.openedAtOf?.(b.id);
        if (Number.isFinite(known)) {
          Object.assign(e, { openedAt: known, basis: 'source', uncertaintyMs: 0 });
        } else if (e.lastDraftAt != null && at - e.lastDraftAt <= MAX_UNCERTAINTY_MS) {
          Object.assign(e, { openedAt: at, basis: 'observed', uncertaintyMs: at - e.lastDraftAt });
        } else {
          Object.assign(e, { basis: 'unknown', uncertaintyMs: e.lastDraftAt == null ? null : at - e.lastDraftAt });
        }
        log({ event: 'opened', ballot: b.id, agenda: b.agenda ?? null, basis: e.basis, uncertaintyMs: e.uncertaintyMs, openedAt: e.openedAt });
        changed = true;
      } else if ((b.status === 'closed' || b.status === 'published') && prev === 'open' && !e.closedBy) {
        e.closedBy = e.attempted ? 'auto' : 'other';
        log({ event: 'closed_seen', ballot: b.id, agenda: b.agenda ?? null, by: e.closedBy });
        changed = true;
      }
      if (prev !== b.status) changed = true;
      e.status = b.status;
    }
    if (changed) persist();
  }

  async function attempt(id, kind) {
    if (inflight.has(id)) return { ok: false, status: 'busy', error: '앞 닫기가 아직 끝나지 않았습니다' };
    const e = entry(id);
    inflight.add(id);
    const m = meta.get(id) ?? {};
    const at = now();
    e.attempted = true; // 부르기 전에 남긴다
    e.attemptAt = at;
    persist();
    let error = null;
    let called = false;
    try {
      if (o.mode === 'fake') {
        await o.fakeCloseFn?.(id);
      } else {
        await o.guardFn(id);
        called = true;
        await o.closeFn(id);
      }
    } catch (err) {
      error = String(err?.message ?? err).slice(0, 200);
    }
    let status = null;
    if (o.mode === 'fake') status = error ? 'open' : 'closed';
    else if (called) {
      try {
        status = await o.statusFn(id);
      } catch (err) {
        status = 'unknown';
        error = error ?? `다시 읽기 실패: ${String(err?.message ?? err).slice(0, 160)}`;
      }
    } else status = e.status ?? 'unknown'; // 안전장치에서 막힘 — 닫기를 부르지 않았다
    const ok = status === 'closed' || status === 'published';
    e.result = { ok, kind, status, error: ok ? null : error, closeError: error, at: now(), fake: o.mode === 'fake', calledRpc: called, lateMs: at - (rowDue(id) ?? at) };
    if (ok) {
      e.closedBy = kind === 'manual' ? 'manual' : 'auto';
      e.status = status;
    }
    persist();
    log({ event: 'close', kind, ballot: id, agenda: m.agenda ?? null, mode: o.mode, ok, status, error: e.result.error, closeError: error, calledRpc: called, lateMs: e.result.lateMs });
    inflight.delete(id);
    return e.result;
  }

  /** 예정 시각이 된 투표지를 닫는다(한 번만). 끝난 약속(Promise) 목록을 돌려준다(시험용). */
  function tick(at = now()) {
    const fired = [];
    for (const [id, e] of Object.entries(st.ballots)) {
      if (e.status !== 'open' || !e.enabled || e.attempted || e.missed || e.openedAt == null) continue;
      const due = rowDue(id);
      if (due == null || at < due) continue;
      if (due < startedAt || at - due > LATE_LIMIT_MS) {
        e.missed = true; // 켜지기 전에 지났거나 너무 늦게 깸 — 사람이 「지금 닫기」
        persist();
        log({ event: 'missed', ballot: id, agenda: meta.get(id)?.agenda ?? null, lateMs: at - due });
        continue;
      }
      fired.push(attempt(id, 'auto'));
    }
    return fired;
  }

  /** 사람 조작. */
  async function control(action, id, value) {
    const e = st.ballots[id];
    if (!e) return { ok: false, error: '모르는 투표지' };
    const m = meta.get(id) ?? {};
    switch (action) {
      case 'minutes': {
        const v = value === '' || value == null ? null : validMinutes(value);
        if (value !== '' && value != null && v == null) return { ok: false, error: '분은 0 보다 크고 600 이하' };
        e.minutes = v;
        e.missed = false;
        break;
      }
      case 'plus':
        e.adjustSec = (Number(e.adjustSec) || 0) + 60;
        e.missed = false;
        break;
      case 'minus':
        e.adjustSec = (Number(e.adjustSec) || 0) - 60;
        break;
      case 'enable':
        e.enabled = !!value;
        break;
      case 'openedAt': {
        const ms = typeof value === 'number' ? value : kstTimeToday(value, now());
        if (!Number.isFinite(ms) || ms > now() + 5000) return { ok: false, error: '연 시각(KST 시:분:초)이 잘못됐거나 미래' };
        Object.assign(e, { openedAt: ms, basis: 'manual', uncertaintyMs: null, missed: false });
        break;
      }
      case 'close':
        log({ event: 'manual_close_pressed', ballot: id, agenda: m.agenda ?? null });
        return attempt(id, 'manual');
      default:
        return { ok: false, error: '모르는 조작' };
    }
    // 조작 결과 예정 시각이 이미 지났으면 곧바로 닫지 않는다 — 사람이 「지금 닫기」.
    const due = rowDue(id);
    if (e.status === 'open' && !e.attempted && due != null && due <= now()) e.missed = true;
    persist();
    log({ event: 'control', action, ballot: id, agenda: m.agenda ?? null, value: action === 'openedAt' ? e.openedAt : value ?? null });
    return { ok: true };
  }

  function view(at = now()) {
    const rows = [];
    for (const [id, m] of meta) {
      const e = st.ballots[id];
      if (!e) continue;
      const pick = pickMinutes({ saved: e.minutes, cli: o.cliMinutes, agenda: m.agenda, itemCount: m.itemCount });
      const end = e.openedAt == null ? null : timerEndAt({ openedAt: e.openedAt, minutes: pick.minutes, adjustSec: e.adjustSec });
      const due = end == null ? null : end + GRACE_SEC * 1000;
      rows.push({
        id, agenda: m.agenda, title: m.title, itemCount: m.itemCount, status: e.status,
        minutes: pick.minutes, minutesSource: pick.source, savedMinutes: e.minutes,
        openedAt: e.openedAt, basis: e.basis, uncertaintyMs: e.uncertaintyMs, adjustSec: e.adjustSec || 0,
        enabled: e.enabled, timerEndAt: end, dueAt: due, remainingMs: due == null ? null : due - at,
        attempted: e.attempted, missed: e.missed, result: e.result, closedBy: e.closedBy, busy: inflight.has(id),
      });
    }
    rows.sort((a, b) => (a.agenda ?? 99) - (b.agenda ?? 99) || String(a.title).localeCompare(String(b.title)));
    return { mode: o.mode, graceSec: GRACE_SEC, rows };
  }

  return { observe, tick, control, view, attempt, _state: st };
}
