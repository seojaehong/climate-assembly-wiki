/**
 * 10/17 분과 의결 — 준비판 서버 공유 저장의 순수 규칙.
 *
 * 화면(DivisionVotePanel)은 분과마다 「칸(slot)」 하나를 들고 이 함수들로만 바꾼다.
 *   - 읽기(5초 폴링): 이 기기에 저장 안 된 고침이 있거나 저장 중이면 서버 값을 받지 않는다.
 *   - 저장: 판번호(version)를 함께 보낸다. 어긋나면(conflict) 서버의 최신 내용으로 **통째로** 바꾸고 알린다.
 *     섞어 합치지 않는다.
 *   - 서버에 아직 줄이 없으면(version 0) 이 기기 내용(저장소·가져오기)을 올린다.
 *   - ★ 서버 줄이 있는데 읽을 수 없으면 그 분과는 저장을 막는다 — 덮어쓰면 다른 화면의 작업이 사라진다.
 */

import type { DivisionPrepRow, DivisionPrepSaveResult } from '../../lib/division-prep';
import { DIVISION_PREP_MAX_BYTES } from '../../lib/division-prep';
import { lockedDivisionOf, migratePrep, type PrepState } from './division-vote-logic';

export type PrepSlot = {
  state: PrepState | null;
  /** 마지막으로 서버와 맞춘 판번호. 0 = 서버에 아직 없음. */
  version: number;
  updatedAt: string | null;
  updatedBy: string | null;
  /** 이 기기에서 고쳤고 아직 서버에 안 올라간 내용이 있다. */
  dirty: boolean;
  /** 저장 요청이 나가 있다. */
  saving: boolean;
  /** 서버 줄을 읽지 못했다 — 저장 금지. */
  unreadable: boolean;
};

export function emptySlot(state: PrepState | null = null): PrepSlot {
  return { state, version: 0, updatedAt: null, updatedBy: null, dirty: false, saving: false, unreadable: false };
}

export type SlotNotice = { tone: 'ok' | 'warn' | 'error'; text: string } | null;

export const CONFLICT_NOTICE = '다른 화면에서 먼저 고쳤습니다. 최신 내용으로 바꿨습니다.';

/** 「N분과」 → N. */
export function rowDivision(row: Pick<DivisionPrepRow, 'subgroup'>): number | null {
  return lockedDivisionOf(row.subgroup);
}

/**
 * 서버 줄 하나를 칸에 반영(첫 읽기·폴링 공용).
 * local = 이 기기 저장소에 있던 내용(서버가 비었을 때 올릴 씨앗).
 */
export function slotFromRow(prev: PrepSlot | undefined, row: DivisionPrepRow, local: PrepState | null): { slot: PrepSlot; notice: SlotNotice } {
  const division = rowDivision(row);
  // 이 기기 고침이 대기 중이면 서버 값을 받지 않는다(저장 결과가 판가름한다).
  if (prev && (prev.dirty || prev.saving)) return { slot: prev, notice: null };
  const meta = { updatedAt: row.updated_at, updatedBy: row.updated_by };

  if (!row.version || row.state === null || row.state === undefined) {
    const seed = prev?.state ?? local;
    // 서버가 비었다 — 이 기기 내용이 있으면 올린다.
    return {
      slot: { ...emptySlot(seed), ...meta, version: row.version || 0, dirty: !!seed },
      notice: null,
    };
  }

  const parsed = migratePrep(row.state);
  if (!parsed || (division !== null && parsed.division !== division)) {
    return {
      slot: { ...emptySlot(prev?.state ?? local), ...meta, version: row.version, unreadable: true },
      notice: {
        tone: 'error',
        text: `${row.subgroup} 서버 내용을 읽지 못했습니다. 이 분과는 서버에 저장하지 않습니다. 화면을 새로 고치거나 운영팀에 알리십시오.`,
      },
    };
  }
  if (prev && !prev.unreadable && prev.version === row.version && prev.state) {
    return { slot: { ...prev, ...meta }, notice: null };
  }
  return { slot: { ...emptySlot(parsed), ...meta, version: row.version }, notice: null };
}

/** 이 기기에서 고쳤다. */
export function slotEdited(prev: PrepSlot, next: PrepState): PrepSlot {
  return next === prev.state ? prev : { ...prev, state: next, dirty: true };
}

/** 저장을 보내도 되는가 — 고친 게 있고, 나가 있는 저장이 없고, 서버 줄을 읽을 수 있을 때. */
export function canSave(slot: PrepSlot): boolean {
  return slot.dirty && !slot.saving && !slot.unreadable && !!slot.state;
}

/**
 * 폴링해도 되는가 — 서버에 저장하는 분과(serverDivisions) 중 대기 중인 고침·저장이 없을 때.
 * 서버에 올리지 않는 칸(이 기기 전용·읽기 실패 줄)은 고침이 남아 있어도 폴링을 막지 않는다 —
 * 막으면 다른 분과 소식까지 영영 끊긴다.
 */
export function canPoll(slots: Record<number, PrepSlot>, serverDivisions?: Iterable<number>): boolean {
  const only = serverDivisions ? new Set(serverDivisions) : null;
  return Object.entries(slots).every(([d, s]) => (only && !only.has(Number(d))) || s.unreadable || (!s.dirty && !s.saving));
}

export function slotSaveStarted(prev: PrepSlot): PrepSlot {
  return { ...prev, saving: true };
}

/**
 * 저장 응답 반영. sent = 보낸 내용.
 * 보내는 사이에 또 고쳤으면 dirty 를 남겨 다음 저장이 새 판번호로 나간다.
 */
export function slotAfterSave(prev: PrepSlot, sent: PrepState, result: DivisionPrepSaveResult): { slot: PrepSlot; notice: SlotNotice } {
  if (result.ok) {
    return {
      slot: { ...prev, version: result.version, updatedAt: result.updated_at, saving: false, dirty: prev.state !== sent },
      notice: null,
    };
  }
  const current = result.current;
  const parsed = current.state === null || current.state === undefined ? null : migratePrep(current.state);
  if (!parsed) {
    return {
      slot: { ...prev, version: current.version, updatedAt: current.updated_at, updatedBy: current.updated_by, saving: false, dirty: false, unreadable: current.version > 0 },
      notice: { tone: 'error', text: `${current.subgroup} 서버 내용을 읽지 못해 저장을 멈췄습니다. 화면을 새로 고치십시오.` },
    };
  }
  return {
    slot: {
      state: parsed,
      version: current.version,
      updatedAt: current.updated_at,
      updatedBy: current.updated_by,
      dirty: false,
      saving: false,
      unreadable: false,
    },
    notice: { tone: 'warn', text: CONFLICT_NOTICE },
  };
}

/** 저장 요청 자체가 실패(네트워크 등) — 고침은 남겨 두고 다음에 다시 보낸다. */
export function slotSaveFailed(prev: PrepSlot): PrepSlot {
  return { ...prev, saving: false, dirty: true };
}

// ── 오류 판별 ─────────────────────────────────────────────────

export type PrepErrorKind = 'missing' | 'network' | 'denied' | 'other';

/**
 * 서버 함수가 아직 없거나(PostgREST PGRST202 「Could not find the function …」, Postgres 42883 「function … does not exist」),
 * 네트워크가 끊겼으면 이 기기 저장으로 내려간다. 권한·분과 문제는 따로 문구를 낸다.
 */
export function classifyPrepError(error: unknown): PrepErrorKind {
  const msg = String((error as { message?: unknown })?.message ?? error ?? '').toLowerCase();
  if (/could not find the function|does not exist|pgrst202|42883|schema cache|supabase client unavailable/.test(msg)) return 'missing';
  if (/failed to fetch|networkerror|network request failed|load failed|fetch failed|timeout|timed out|offline|econn/.test(msg)) return 'network';
  if (/scope|authorization|not allowed|permission|mismatch|invalid division|42501/.test(msg)) return 'denied';
  return 'other';
}

export function prepErrorText(kind: PrepErrorKind): string {
  if (kind === 'missing') return '서버 저장 기능이 아직 준비되지 않았습니다.';
  if (kind === 'network') return '서버에 연결하지 못했습니다.';
  if (kind === 'denied') return '이 조 코드로는 서버 저장을 쓸 수 없습니다.';
  return '서버 저장 중 오류가 났습니다.';
}

// ── 크기 ──────────────────────────────────────────────────────

export function prepByteSize(state: PrepState): number {
  return new TextEncoder().encode(JSON.stringify(state)).length;
}

export function prepTooLarge(state: PrepState, max = DIVISION_PREP_MAX_BYTES): boolean {
  return prepByteSize(state) > max;
}

// ── 상태 칩 ───────────────────────────────────────────────────

export type SyncMode = 'connecting' | 'server' | 'local';

export function hhmmss(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (x: number) => String(x).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** 상태 칩 문구 — 「저장됨 14:05:09」 / 「저장 중」 / 「서버 저장 안 됨」. */
export function chipText(mode: SyncMode, slot: PrepSlot | undefined, lastSaveFailed: boolean): { tone: 'ok' | 'busy' | 'warn'; text: string } {
  if (mode === 'connecting') return { tone: 'busy', text: '서버 연결 중' };
  if (mode === 'local' || !slot || slot.unreadable) return { tone: 'warn', text: '서버 저장 안 됨' };
  if (slot.saving || slot.dirty) return lastSaveFailed ? { tone: 'warn', text: '서버 저장 안 됨' } : { tone: 'busy', text: '저장 중' };
  return { tone: 'ok', text: slot.updatedAt ? `저장됨 ${hhmmss(slot.updatedAt)}` : '저장됨' };
}
