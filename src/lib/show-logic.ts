/**
 * 11/14 최종 의결 「표출 화면」(/show, 무대 대형 스크린) — 순수 계산만 둔다.
 * 가결선 · 참여율 · 가결 판정 · 남은 시간(타이머). 그리기는 src/islands/show/ShowScreen.tsx.
 *
 * 가결 기준은 운영규정의 「참석자 3분의 2 이상 찬성」이다. 퍼센트 분모도 참석 P(시안 「참석자 174명 기준」).
 * 투표 저장값은 1 = 반대, 2 = 찬성(ballot-pager-logic.ts YES/NO) — 찬성 수는 dist["2"] 이다.
 */

/** 참석 P명의 3분의 2 이상 = ceil(2P/3)표. */
export function passThreshold(present: number): number {
  if (!Number.isFinite(present) || present <= 0) return 0;
  return Math.ceil((2 * present) / 3);
}

/**
 * URL present 값 — 양의 정수(숫자만)일 때만 그 값, 아니면 null.
 * 명단 수로 조용히 바꾸지 않는다(「174명」 같은 오타가 가결 판정을 바꾸지 않게). null 이면 화면이 빨간 안내를 띄우고 가결 기준·판정을 숨긴다.
 */
export function parsePresent(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  const s = raw.trim();
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/** 진행·실시간 화면의 분모 — 출석이 있으면 출석, 없으면 명단(「명단 기준」으로 적는다). */
export function liveDenominator(present: number | null, roster: number): { n: number; label: string; byRoster: boolean } {
  if (present != null) return { n: present, label: `참석 ${present}명`, byRoster: false };
  const r = Math.max(0, roster);
  return { n: r, label: `명단 ${r}명 기준`, byRoster: true };
}

/** 제출이 출석보다 많으면 출석 인원을 잘못 넣었을 가능성이 크다. 출석이 없으면 판단하지 않는다. */
export function submittedExceedsPresent(present: number | null, submitted: ReadonlyArray<number>): boolean {
  if (present == null) return false;
  return submitted.some((s) => s > present);
}

// ── 상태 문구(서버 상태 + 표출 노트북 타이머) ─────────────────────────────

export type BallotStatus = 'draft' | 'open' | 'closed' | 'published';

const STATUS_TEXT: Record<BallotStatus, string> = {
  draft: '투표 시작 전',
  open: '투표 진행 중',
  closed: '투표 마감',
  published: '결과 공개',
};

function isBallotStatus(s: string): s is BallotStatus {
  return s === 'draft' || s === 'open' || s === 'closed' || s === 'published';
}

/**
 * 「투표 마감」은 서버 상태가 closed 일 때만. 노트북 타이머가 0 이 되어도 서버가 open 이면 「시간 종료」.
 * 알 수 없는 상태는 빈 문자열.
 */
export function statusText(status: string, timeUp: boolean): string {
  if (!isBallotStatus(status)) return '';
  if (status === 'open' && timeUp) return '시간 종료';
  return STATUS_TEXT[status];
}

/** QR 은 서버 상태가 open 일 때만 보인다. */
export function showQr(status: string): boolean {
  return status === 'open';
}

/** 시계 칸 — 서버가 마감·공개면 「마감」, 타이머만 0 이면 「시간 종료」, 아니면 mm:ss. */
export function clockDisplay(status: string, remainingMs: number, durationMs: number): { text: string; ended: boolean } {
  if (status === 'closed' || status === 'published') return { text: '마감', ended: true };
  if (remainingMs <= 0 && durationMs > 0) return { text: '시간 종료', ended: true };
  return { text: clockText(remainingMs), ended: false };
}

/** 참여율(%) = 제출 / 참석, 반올림. 참석 0 이면 0. */
export function participationPct(submitted: number, present: number): number {
  if (present <= 0) return 0;
  return Math.round((submitted / present) * 100);
}

/** 찬성 수 — dist 의 키 "2"(0표면 키가 없다). */
export function yesCount(dist: Record<string, number> | null | undefined): number {
  const v = dist?.['2'];
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

export type ItemOutcome = { yes: number; pct: number; passed: boolean; barPct: number };

export function itemOutcome(dist: Record<string, number> | null | undefined, present: number): ItemOutcome {
  const yes = yesCount(dist);
  const ratio = present > 0 ? (yes / present) * 100 : 0;
  return {
    yes,
    pct: Math.round(ratio),
    passed: present > 0 && yes >= passThreshold(present),
    barPct: Math.min(100, ratio),
  };
}

export type AgendaOutcome = { passed: number; failed: number; avgPct: number };

export function agendaOutcome(dists: ReadonlyArray<Record<string, number> | null | undefined>, present: number): AgendaOutcome {
  if (dists.length === 0) return { passed: 0, failed: 0, avgPct: 0 };
  let passed = 0;
  let sumRatio = 0;
  for (const d of dists) {
    const o = itemOutcome(d, present);
    if (o.passed) passed += 1;
    sumRatio += present > 0 ? yesCount(d) / present : 0;
  }
  return { passed, failed: dists.length - passed, avgPct: Math.round((sumRatio / dists.length) * 100) };
}

/** 표출 화면의 의제 이름(시안 · 사무국 안내의 긴 이름). 투표지 제목은 짧은 이름이라 따로 둔다. */
export const AGENDA_FULL_NAMES: Record<1 | 2 | 3, string> = {
  1: '기업이 온실가스를 감축하도록 촉진하는 방안',
  2: '일회용품 줄이기 등 자원순환을 강화하는 방안',
  3: '기후시민 의식제고를 위한 교육 및 참여 활성화 방안',
};

// ── 남은 투표 시간(표출 화면 브라우저 안에서만 돈다) ─────────────────────────

/** 기본 시간 = 권고 수 × 1분 30초. */
export function defaultDurationSec(items: number): number {
  return Math.max(0, items) * 90;
}

/**
 * 타이머 상태. 1초씩 빼지 않고 「멈춘 시점의 남은 ms」와 「흐르기 시작한 시각」만 둔다 —
 * 탭이 느려지거나 잠깐 가려져도 벽시계 기준으로 맞는다.
 */
export type TimerState = { durationMs: number; pausedRemainingMs: number; runningSince: number | null };

export function initialTimer(durationSec: number): TimerState {
  const ms = Math.max(0, durationSec) * 1000;
  return { durationMs: ms, pausedRemainingMs: ms, runningSince: null };
}

export function timerRemainingMs(t: TimerState, now: number): number {
  const elapsed = t.runningSince == null ? 0 : now - t.runningSince;
  return Math.max(0, t.pausedRemainingMs - elapsed);
}

/** Space — 시작/일시정지. */
export function toggleTimer(t: TimerState, now: number): TimerState {
  if (t.runningSince == null) return { ...t, runningSince: now };
  return { ...t, pausedRemainingMs: timerRemainingMs(t, now), runningSince: null };
}

/** ↑/↓ — 남은 시간 ±초(흐르는 중이면 흐름 유지). 0 아래로 내려가지 않는다. */
export function adjustTimer(t: TimerState, deltaSec: number, now: number): TimerState {
  const next = Math.max(0, timerRemainingMs(t, now) + deltaSec * 1000);
  return { ...t, pausedRemainingMs: next, runningSince: t.runningSince == null ? null : now };
}

/** R — 처음 시간으로, 멈춤. */
export function resetTimer(t: TimerState): TimerState {
  return { ...t, pausedRemainingMs: t.durationMs, runningSince: null };
}

/**
 * 타이머 저장(F5 · 새로고침에 살아남게). 저장값의 전체 시간이 지금 계산한 전체 시간과 다르거나(min= 이 바뀜)
 * maxAgeMs 보다 오래됐으면(리허설 때 남은 값) 버린다.
 */
export function serializeTimer(t: TimerState, now: number): string {
  return JSON.stringify({ v: 1, durationMs: t.durationMs, pausedRemainingMs: t.pausedRemainingMs, runningSince: t.runningSince, savedAt: now });
}

export const TIMER_MAX_AGE_MS = 3 * 60 * 60 * 1000;

export function restoreTimer(raw: string | null | undefined, durationMs: number, now: number, maxAgeMs = TIMER_MAX_AGE_MS): TimerState | null {
  if (!raw) return null;
  let p: unknown;
  try {
    p = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!p || typeof p !== 'object') return null;
  const o = p as Record<string, unknown>;
  const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
  if (o.v !== 1 || !num(o.durationMs) || !num(o.pausedRemainingMs) || !num(o.savedAt)) return null;
  if (o.runningSince !== null && !num(o.runningSince)) return null;
  if (o.durationMs !== durationMs) return null;
  if (now - (o.savedAt as number) > maxAgeMs || (o.savedAt as number) > now + 60_000) return null;
  const paused = Math.max(0, Math.min(o.pausedRemainingMs as number, durationMs * 10));
  const since = o.runningSince as number | null;
  if (since != null && since > now) return null;
  return { durationMs, pausedRemainingMs: paused, runningSince: since };
}

export function timerStorageKey(tokens: ReadonlyArray<string>): string {
  return `show_timer_${tokens.join(',')}`;
}

/** 남은 ms → 「mm:ss」(초는 올림 — 0:00.4 는 00:01). */
export function clockText(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

// ── 남은 시간 알림(5분 · 3분 · 1분 · 30초) · 10초 카운트다운 · 종료 ─────────────

/** 알림을 띄우는 남은 시간(초). */
export const CUE_MARKS_SEC = [300, 180, 60, 30] as const;
/** 알림 띠가 보이는 시간(타이머 시간). */
export const CUE_SHOW_MS = 6000;
/** 이 초부터 큰 카운트다운. */
export const COUNTDOWN_SEC = 10;

export type TimeCue =
  | { kind: 'none' }
  | { kind: 'notice'; sec: number; text: string }
  | { kind: 'count'; n: number }
  | { kind: 'ended'; text: string };

function markText(sec: number): string {
  return `남은 시간 ${sec >= 60 ? `${sec / 60}분` : `${sec}초`}`;
}

/**
 * 진행 화면의 알림 — 타이머 상태만으로 정한다(「이미 띄웠음」 같은 기억을 두지 않는다).
 * · notice: 타이머가 흐르는 중에 남은 시간이 기준(5분 · 3분 · 1분 · 30초)을 「이번에 흐르면서」 지난 뒤 CUE_SHOW_MS 동안.
 *   일시정지하면 사라지고, 다시 시작해도 이미 지난 기준은 다시 띄우지 않는다(멈춘 시점 남은 시간 > 기준일 때만).
 *   ↓ 로 기준을 건너뛰어도 띄우지 않는다. ↑ 로 기준 위로 되돌렸다가 다시 지나면 그때 다시 띄운다(실제로 다시 지났으므로).
 * · count: 흐르는 중이고 남은 시간이 10초 이하(시계와 같은 올림 — 00:10 일 때 10).
 * · ended: 남은 시간 0(서버가 아직 열려 있음) — 「투표 시간이 끝났습니다」.
 * 서버가 마감 · 공개면 아무것도 띄우지 않는다(시계가 「마감」).
 */
export function timeCue(t: TimerState, now: number, status: string): TimeCue {
  if (status === 'closed' || status === 'published' || t.durationMs <= 0) return { kind: 'none' };
  const remaining = timerRemainingMs(t, now);
  if (remaining <= 0) return { kind: 'ended', text: '투표 시간이 끝났습니다' };
  const running = t.runningSince != null;
  if (!running) return { kind: 'none' };
  if (remaining <= COUNTDOWN_SEC * 1000) return { kind: 'count', n: Math.ceil(remaining / 1000) };
  for (const sec of CUE_MARKS_SEC) {
    const mark = sec * 1000;
    if (t.pausedRemainingMs > mark && remaining <= mark && remaining > mark - CUE_SHOW_MS) {
      return { kind: 'notice', sec, text: markText(sec) };
    }
  }
  return { kind: 'none' };
}

/**
 * 화면별 알림 — 타이머가 보이는 화면(진행 1 · 영상 V · 실시간 순환 4)은 모두 같은 timeCue 를 그린다.
 * 화면이 알림을 따로 기억하지 않으므로 PgDn 으로 오가도 같은 시각엔 같은 알림(중복 · 누락 없음). 결과 화면(2 · 3)은 없음.
 */
export function screenCue(mode: ShowMode, cue: TimeCue): TimeCue {
  return mode.view === 'detail' || mode.view === 'summary' ? { kind: 'none' } : cue;
}

// ── 시연(더미) — /show?demo=1|2|3&speed=<배속>. DB 를 읽지 않는다 ─────────────────

/** 시연 의제별 권고안 수(실제와 같게). */
export const DEMO_ITEMS: Record<1 | 2 | 3, number> = { 1: 19, 2: 28, 3: 23 };
export const DEMO_PRESENT = 174;
/** 시연 끝 제출 수(가상). */
const DEMO_FINAL: Record<1 | 2 | 3, number> = { 1: 158, 2: 149, 3: 161 };

/** 1배속으로 보여 줄 구간(남은 시간 ms 기준 [아래, 위]) — 시작 직후 · 알림 앞뒤 · 마지막 33초. */
export function demoSlowZones(durationMs: number): Array<[number, number]> {
  const z: Array<[number, number]> = [[0, 33_000]];
  for (const sec of [300, 180, 60]) {
    const m = sec * 1000;
    if (m < durationMs) z.push([m - CUE_SHOW_MS - 1000, m + 2000]);
  }
  z.push([Math.max(0, durationMs - 3000), durationMs]);
  return z.sort((a, b) => a[0] - b[0]);
}

/**
 * 시연 배속 — 벽시계 dt 동안 타이머를 몇 ms 흘릴지. 남은 시간이 1배속 구간 안이면 1배, 밖이면 speed 배.
 * 구간 경계를 넘을 때는 경계까지 나눠 계산한다(한 틱이 길어도 알림을 건너뛰지 않게). 0 아래(종료 뒤)는 1배.
 */
export function demoAdvanceMs(remainingMs: number, dtMs: number, speed: number, durationMs: number): number {
  if (dtMs <= 0) return 0;
  const sp = Math.max(1, speed);
  const zones = demoSlowZones(durationMs);
  let r = remainingMs;
  let wall = dtMs;
  let adv = 0;
  while (wall > 0 && r > 0) {
    const slow = zones.some(([lo, hi]) => r > lo && r <= hi);
    const rate = slow ? 1 : sp;
    // 다음 경계(현재 r 아래에서 가장 가까운 구간 끝 · 0).
    let next = 0;
    for (const [lo, hi] of zones) {
      if (lo < r && lo > next) next = lo;
      if (hi < r && hi > next) next = hi;
    }
    const need = (r - next) / rate;
    if (need >= wall) {
      adv += wall * rate;
      r -= wall * rate;
      wall = 0;
    } else {
      adv += r - next;
      r = next;
      wall -= need;
    }
  }
  return adv + wall; // 0 에 닿은 뒤 남은 벽시계는 1배
}

export type DemoLive = { status: string; title: string; items: number; started: number; submitted: number; in_progress: number; roster: number; at: string };

function logistic01(p: number, c: number, k: number): number {
  const f = (x: number) => 1 / (1 + Math.exp(-k * (x - c)));
  return (f(p) - f(0)) / (f(1) - f(0));
}

/**
 * 시연 수 — 진행 비율 p(0~1, 타이머 시간 기준)의 단조 곡선. 투표 시작은 초반에 빠르게, 제출은 막판에 대부분.
 * 시작 전(begun=false)이면 draft · 0명. 같은 p 면 늘 같은 값(무작위 없음).
 */
export function demoLiveCounts(no: 1 | 2 | 3, p: number, begun: boolean, present = DEMO_PRESENT): DemoLive {
  const items = DEMO_ITEMS[no];
  const title = `전체회의 의결 의제${no} 시연`;
  const base = { title, items, roster: present, at: '' };
  if (!begun) return { ...base, status: 'draft', started: 0, submitted: 0, in_progress: 0 };
  const x = Math.min(1, Math.max(0, p));
  const fin = Math.min(present, DEMO_FINAL[no]);
  const startFin = Math.min(present, fin + 9);
  // 살짝 고르지 않게(단조 유지: 1 + 0.008·17·cos > 0).
  const w = x + 0.008 * Math.sin(17 * x);
  const st = startFin * (1 - Math.exp(-w / 0.07)) / (1 - Math.exp(-1 / 0.07));
  const subCurve = 0.88 * logistic01(w, 0.5, 9) + 0.12 * Math.max(0, (w - 0.9) / 0.1);
  const submitted = Math.max(0, Math.min(fin, Math.floor(fin * Math.min(1, subCurve))));
  const started = Math.max(submitted, Math.min(startFin, Math.floor(st)));
  return { ...base, status: 'open', started, submitted, in_progress: started - submitted };
}

// ── URL ─────────────────────────────────────────────────────────────

export type ShowParams = {
  tokens: string[];
  present: string | null;
  minutes: number | null;
  motion: boolean;
  /** 시연 의제(demo=1|2|3) — DB 없이 가상 수로 돈다. 그 밖 값이면 null. */
  demo: 1 | 2 | 3 | null;
  /** 시연 배속(1~600, 기본 1). 알림 앞뒤 · 마지막 33초는 늘 1배속. */
  speed: number;
};

/** /show?t=<토큰>[,<토큰>,<토큰>]&present=<참석>&min=<분>[&motion=0]. 토큰은 32자 영숫자만. motion=0 = 움직임 끔(저사양 노트북). 시연: /show?demo=1&speed=60 */
export function parseShowParams(search: string): ShowParams {
  const q = new URLSearchParams(search);
  const tokens = (q.get('t') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => /^[A-Za-z0-9]{32}$/.test(s));
  const minRaw = Number(q.get('min'));
  const minutes = q.get('min') != null && Number.isFinite(minRaw) && minRaw > 0 ? minRaw : null;
  const d = q.get('demo');
  const demo = d === '1' || d === '2' || d === '3' ? (Number(d) as 1 | 2 | 3) : null;
  const spRaw = Number(q.get('speed'));
  const speed = q.get('speed') != null && Number.isFinite(spRaw) && spRaw >= 1 ? Math.min(600, spRaw) : 1;
  return { tokens, present: q.get('present'), minutes, motion: q.get('motion') !== '0', demo, speed };
}

// ── 읽기 실패 ───────────────────────────────────────────────────────

/** 한 번 읽기에 걸 수 있는 최대 시간. 넘으면 실패로 보고 다음 주기로 넘어간다(화면은 마지막 값 유지). */
export const POLL_TIMEOUT_MS = 8000;
/** 마지막 성공이 이보다 오래되면 「연결 확인 중 · 마지막 갱신 N초 전」. */
export const STALE_AFTER_MS = 10000;

export class PollTimeoutError extends Error {
  constructor() {
    super('poll timeout');
    this.name = 'PollTimeoutError';
  }
}

export function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new PollTimeoutError()), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

/** 서버가 「없는 토큰」이라고 답한 것과 연결 실패(네트워크 · 시간 초과)를 가른다. */
export function classifyLoadError(e: unknown): 'not_found' | 'network' {
  const msg = (e as { message?: unknown } | null)?.message;
  if (typeof msg === 'string' && /ballot not found|ballot token required/i.test(msg)) return 'not_found';
  return 'network';
}

/** 마지막 성공(없으면 읽기 시작 시각)에서 지난 초. STALE_AFTER_MS 를 넘었을 때만 숫자, 아니면 null. */
export function staleSeconds(lastOk: number | null, startedAt: number, now: number): number | null {
  const base = Math.max(lastOk ?? 0, startedAt);
  const age = now - base;
  return age > STALE_AFTER_MS ? Math.floor(age / 1000) : null;
}

// ── 무선 프레젠터(PageDown/PageUp) ─────────────────────────────────────

/**
 * 의제 하나 주소 — PageDown 은 진행(1) → 실시간 순환(4) → 영상(V) → 진행, PageUp 은 거꾸로.
 * 순환 안에서도 판이 아니라 화면을 바꾼다(판은 8초마다 저절로, 또는 ←/→).
 * 결과 화면(2·3)에서는 아무것도 하지 않는다 — 프레젠터로는 결과 화면에 들어가지도 나오지도 않는다.
 */
export function clickerStep(m: ShowMode, delta: 1 | -1): ShowMode {
  if (m.view === 'detail' || m.view === 'summary') return m;
  const order: ShowMode[] = [
    { view: 'live', video: false },
    { view: 'rotate', video: m.video },
    { view: 'live', video: true },
  ];
  const at = m.view === 'rotate' ? 1 : m.video ? 2 : 0;
  return order[(at + delta + order.length) % order.length];
}

// ── 실시간 순환 화면(투표율만 — 찬반은 결과 발표 때 공개) ─────────────────────

/** 투표율(%) = 제출 / 참석, 반올림, 100 상한. 참석 0 이면 0. */
export function turnoutPct(submitted: number, present: number): number {
  if (present <= 0) return 0;
  return Math.min(100, Math.round((submitted / present) * 100));
}

export type OverallTurnout = { submitted: number; capacity: number; pct: number; inProgress: number };

/** 전체 투표율 = 의제별 제출 합 / (참석 × 의제 수). 「지금 투표 중」 = in_progress 합. */
export function overallTurnout(
  lives: ReadonlyArray<{ submitted: number; in_progress: number }>,
  present: number,
): OverallTurnout {
  const submitted = lives.reduce((s, l) => s + Math.max(0, l.submitted), 0);
  const inProgress = lives.reduce((s, l) => s + Math.max(0, l.in_progress), 0);
  const capacity = Math.max(0, present) * lives.length;
  return { submitted, capacity, pct: turnoutPct(submitted, capacity), inProgress };
}

/** 의제별 막대 — 제출 길이와 투표 시작 표시선 위치(%, 100 에서 자른다). */
export function turnoutBar(submitted: number, started: number, present: number): { submittedPct: number; startedPct: number } {
  if (present <= 0) return { submittedPct: 0, startedPct: 0 };
  return {
    submittedPct: Math.min(100, (submitted / present) * 100),
    startedPct: Math.min(100, (started / present) * 100),
  };
}

export type RotationPanel = 'overall' | 'agendas' | 'single';

/** 의제 하나 주소 = 전체 투표율 → 그 의제 큰 판. 종합 주소 = 전체 투표율 → 의제별 투표율. */
export function rotationPanels(agendaCount: number): RotationPanel[] {
  return agendaCount > 1 ? ['overall', 'agendas'] : ['overall', 'single'];
}

/** ←/→ — 끝에서 처음으로 돌아 나간다. */
export function stepPanel(index: number, count: number, delta: number): number {
  if (count <= 0) return 0;
  return (((index + delta) % count) + count) % count;
}

// ── 의제 하나 주소의 화면 전환 ───────────────────────────────────────────

/** view: 진행(live) · 결과 상세 · 결과 요약 · 실시간 순환(rotate). video: 진행 화면을 영상 모드로 그리는가. */
export type ShowMode = { view: 'live' | 'detail' | 'summary' | 'rotate'; video: boolean };

/**
 * 1 진행(영상 켜 두었으면 영상) · 2 결과 상세 · 3 결과 요약 · 4 실시간(다시 4 = 진행) ·
 * V 진행 화면에서는 영상 켜고 끄기, 다른 화면에서는 영상으로 돌아오기.
 */
export function showModeKey(m: ShowMode, key: '1' | '2' | '3' | '4' | 'V'): ShowMode {
  switch (key) {
    case '1':
      return { view: 'live', video: m.video };
    case '2':
      return { view: 'detail', video: m.video };
    case '3':
      return { view: 'summary', video: m.video };
    case '4':
      return { view: m.view === 'rotate' ? 'live' : 'rotate', video: m.video };
    case 'V':
      return m.view === 'live' ? { view: 'live', video: !m.video } : { view: 'live', video: true };
    default:
      return m;
  }
}
