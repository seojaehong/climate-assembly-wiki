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

/** URL present 값(양의 정수)이 있으면 그것, 아니면 명단 인원. */
export function resolvePresent(raw: string | null | undefined, roster: number): number {
  const n = Number(raw);
  if (raw != null && raw.trim() !== '' && Number.isInteger(n) && n > 0) return n;
  return Math.max(0, roster);
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

/** 남은 ms → 「mm:ss」(초는 올림 — 0:00.4 는 00:01). */
export function clockText(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

// ── URL ─────────────────────────────────────────────────────────────

export type ShowParams = { tokens: string[]; present: string | null; minutes: number | null };

/** /show?t=<토큰>[,<토큰>,<토큰>]&present=<참석>&min=<분>. 토큰은 32자 영숫자만. */
export function parseShowParams(search: string): ShowParams {
  const q = new URLSearchParams(search);
  const tokens = (q.get('t') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => /^[A-Za-z0-9]{32}$/.test(s));
  const minRaw = Number(q.get('min'));
  const minutes = q.get('min') != null && Number.isFinite(minRaw) && minRaw > 0 ? minRaw : null;
  return { tokens, present: q.get('present'), minutes };
}
