import type { BallotItemInput, BallotScale, BallotStatus } from '../../lib/deliberation';

/**
 * 다의제 투표(ballot) 패널의 순수 로직 — 상태 전이 가드, 생성 폼 검증, 결과 분포 계산.
 * 서버 규칙(20260808_s2_ballot_multi_agenda.sql)의 UI측 거울이다: RPC가 마지막 방어선이고,
 * 여기서는 사용자가 그 방어선에 부딪히기 전에 버튼 자체를 막는다.
 */

export const BALLOT_SCALES: readonly BallotScale[] = [2, 4, 5, 7] as const;
export const MAX_BALLOT_ITEMS = 20;
export const MAX_STATEMENT_LENGTH = 300;
export const MAX_TITLE_LENGTH = 200;

/** ballot_set_status의 v_order와 동일한 순서표. */
const STATUS_ORDER: Record<BallotStatus, number> = {
  draft: 0,
  open: 1,
  closed: 2,
  published: 3,
  archived: 4,
};

/**
 * 전이 가능 여부 — RPC 규칙 그대로: 앞으로만(순서 증가), draft로는 못 돌아간다.
 * 미지의 상태 값(스키마 확장 등)은 전부 거부한다.
 */
export function canTransition(from: BallotStatus, to: BallotStatus): boolean {
  const fromOrder = STATUS_ORDER[from];
  const toOrder = STATUS_ORDER[to];
  if (fromOrder == null || toOrder == null) return false;
  if (to === 'draft') return false;
  return toOrder > fromOrder;
}

export type BallotAction = {
  to: 'open' | 'closed' | 'published';
  label: string;
  /** 확인 다이얼로그 본문 — 역행 불가를 반드시 못박는다. */
  confirm: string;
};

/**
 * 현재 상태에서 콘솔이 제시하는 다음 한 걸음(인접 전이만).
 * published 이후에는 운영 버튼이 없다(archived는 콘솔 밖 운영).
 */
export function primaryAction(status: BallotStatus): BallotAction | null {
  if (status === 'draft') {
    return {
      to: 'open',
      label: '투표 시작',
      confirm: '투표를 시작할까요? 시작하면 참가자가 QR로 접속해 제출할 수 있습니다.',
    };
  }
  if (status === 'open') {
    return {
      to: 'closed',
      label: '투표 마감',
      confirm: '투표를 마감할까요? 마감 후 재개할 수 없습니다.',
    };
  }
  if (status === 'closed') {
    return {
      to: 'published',
      label: '결과 공개',
      confirm: '결과를 공개할까요? 공개 후에는 참가자 화면에도 결과가 보이며 되돌릴 수 없습니다.',
    };
  }
  return null;
}

export function ballotStatusLabel(status: BallotStatus): string {
  switch (status) {
    case 'draft':
      return '초안';
    case 'open':
      return '진행 중';
    case 'closed':
      return '마감됨';
    case 'published':
      return '결과 공개됨';
    case 'archived':
      return '보관됨';
    default:
      return status;
  }
}

export function scaleLabel(scale: BallotScale): string {
  return scale === 2 ? '찬반(2점)' : `${scale}점 척도`;
}

// ── 생성 폼 ──────────────────────────────────────────────────

export type BallotFormItem = { statement: string; scale: BallotScale };

export type BallotFormResult =
  | { ok: true; title: string; items: BallotItemInput[] }
  | { ok: false; error: string };

export function emptyBallotFormItem(): BallotFormItem {
  return { statement: '', scale: 5 };
}

/**
 * 생성 폼 검증 → ballot_create p_items 페이로드.
 * RPC와 같은 한계(1~20개, 문장 필수)를 클라이언트에서 먼저 잡고,
 * 몇 번째 줄이 문제인지 사람 말로 알려 준다.
 */
export function validateBallotForm(title: string, items: BallotFormItem[]): BallotFormResult {
  const trimmedTitle = title.trim();
  if (!trimmedTitle) return { ok: false, error: '투표 제목을 입력해 주세요.' };
  if (trimmedTitle.length > MAX_TITLE_LENGTH) {
    return { ok: false, error: `제목은 ${MAX_TITLE_LENGTH}자 이내로 입력해 주세요.` };
  }
  if (items.length < 1) return { ok: false, error: '의제를 1개 이상 추가해 주세요.' };
  if (items.length > MAX_BALLOT_ITEMS) {
    return { ok: false, error: `의제는 최대 ${MAX_BALLOT_ITEMS}개까지 담을 수 있습니다.` };
  }

  const trimmed = items.map((item) => ({ ...item, statement: item.statement.trim() }));
  const blankIndex = trimmed.findIndex((item) => item.statement.length === 0);
  if (blankIndex >= 0) return { ok: false, error: `${blankIndex + 1}번 의제 문장을 입력해 주세요.` };
  const longIndex = trimmed.findIndex((item) => item.statement.length > MAX_STATEMENT_LENGTH);
  if (longIndex >= 0) {
    return { ok: false, error: `${longIndex + 1}번 의제 문장이 너무 깁니다(${MAX_STATEMENT_LENGTH}자 이내).` };
  }
  const badScaleIndex = trimmed.findIndex((item) => !BALLOT_SCALES.includes(item.scale));
  if (badScaleIndex >= 0) {
    return { ok: false, error: `${badScaleIndex + 1}번 의제의 척도가 올바르지 않습니다(2·4·5·7점만 가능).` };
  }

  return {
    ok: true,
    title: trimmedTitle,
    items: trimmed.map((item, index) => ({
      ordinal: index + 1,
      statement: item.statement,
      scale: item.scale,
      required: true,
    })),
  };
}

// ── 분과 스코프(S4) 라벨 ─────────────────────────────────────
// subgroup은 null(=세션 전체)일 수도, S4 미적용 DB라 키 자체가 없을 수도(undefined) 있다.
// 두 경우 모두 '전체'로 간주한다 — 코드가 DB보다 먼저 배포돼도 표시가 깨지지 않는다.

/** 목록·초안 카드·결과 화면의 분과 배지. 예: '1분과 한정' / '전체'. */
export function subgroupBadgeLabel(subgroup: string | null | undefined): string {
  const s = subgroup?.trim();
  return s ? `${s} 한정` : '전체';
}

/** §1 개요 「대상」 값·표지 병기용. 예: '1분과' / '세션 전체'. */
export function subgroupTargetLabel(subgroup: string | null | undefined): string {
  const s = subgroup?.trim();
  return s ? s : '세션 전체';
}

/**
 * QR 풀스크린의 오배포 방지 배너. 분과 한정 투표에만 문구를 낸다 —
 * 세 분과가 세 장소에서 동시에 QR을 띄우므로, 화면만 보고 어느 분과 QR인지 알 수 있어야 한다.
 */
export function qrSubgroupNotice(subgroup: string | null | undefined): string | null {
  const s = subgroup?.trim();
  return s ? `이 QR은 ${s} 전용입니다` : null;
}

/**
 * 세션 팀 목록(hq_teams)에서 고유 분과 목록을 뽑는다 — 생성 폼 「대상」 선택지.
 * 총괄 모더레이터 1명이 한 콘솔에서 1·2·3분과 투표를 전부 만들 수 있어야 하므로,
 * 내 분과만이 아니라 세션의 모든 분과를 낸다.
 *
 * - subgroup이 null/공백인 팀은 제외한다(분과 없는 운영 팀).
 * - '1분과' < '2분과' < '10분과' 자연 정렬(숫자 비교).
 * - 내 분과(mySubgroup)는 맨 앞에 둔다 — 목록에 없어도(팀 데이터가 어긋나도) 포함해,
 *   기존 「내 분과」 옵션이 절대 사라지지 않게 한다.
 */
export function sessionSubgroups(
  teams: ReadonlyArray<{ name: string; subgroup: string | null | undefined }>,
  mySubgroup: string | null | undefined,
): string[] {
  const seen = new Set<string>();
  for (const team of teams) {
    const s = team.subgroup?.trim();
    if (s) seen.add(s);
  }
  const sorted = [...seen].sort((a, b) => a.localeCompare(b, 'ko', { numeric: true }));
  const mine = mySubgroup?.trim();
  if (!mine) return sorted;
  return [mine, ...sorted.filter((s) => s !== mine)];
}

// ── 참가자 URL·결과 분포 ─────────────────────────────────────

/** 참가자 진입 URL. QR과 수기 입력 안내가 같은 문자열을 쓴다. */
export function ballotUrl(origin: string, token: string): string {
  return `${origin}/b?t=${token}`;
}

export type DistRow = { value: number; count: number; pct: number };

/**
 * 문항 분포를 1..scale 전 구간으로 펼친다 — 응답이 0인 값도 행으로 나와야
 * 척도 막대가 빠진 칸 없이 그려진다. pct 분모는 이 문항의 응답 수(n)다.
 */
export function distRows(scale: number, dist: Record<string, number> | null | undefined): DistRow[] {
  const source = dist ?? {};
  const rows = Array.from({ length: Math.max(0, scale) }, (_, index) => {
    const value = index + 1;
    const count = source[String(value)] ?? 0;
    return { value, count, pct: 0 };
  });
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  if (total <= 0) return rows;
  return rows.map((row) => ({ ...row, pct: Math.round((row.count / total) * 100) }));
}
