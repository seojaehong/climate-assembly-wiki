import type { Ballot, BallotItem } from '../../lib/ballot';
import { createSafeBrowserStorage } from '../../lib/safe-browser-storage';

/** URL 쿼리에서 ballot 토큰(`?t=...`)을 파싱한다. 없거나 공백뿐이면 null. */
export function parseBallotUrl(search: string): { token: string } | null {
  const params = new URLSearchParams(search);
  const raw = params.get('t');
  if (!raw) return null;
  const token = raw.trim();
  if (!token) return null;
  return { token };
}

/**
 * 척도별 버튼 라벨(값 1..scale 순서). 합니다체 짧은 문구.
 * - 2: 반대/찬성 이진
 * - 4: 동의 4단계(중간 '보통' 없음 — 강제 선택형)
 * - 5: 동의 5단계('보통입니다' 포함)
 * - 7: 찬반 7단계
 * 스키마 check 제약이 (2,4,5,7)만 허용하지만, 방어적으로 그 외 값은 숫자 라벨로 폴백한다.
 */
export function scaleLabels(scale: number): string[] {
  switch (scale) {
    case 2:
      return ['반대', '찬성'];
    case 4:
      return ['동의하지 않습니다', '다소 동의하지 않습니다', '다소 동의합니다', '동의합니다'];
    case 5:
      return ['전혀 동의하지 않습니다', '동의하지 않습니다', '보통입니다', '동의합니다', '매우 동의합니다'];
    case 7:
      return [
        '매우 반대합니다',
        '반대합니다',
        '다소 반대합니다',
        '보통입니다',
        '다소 찬성합니다',
        '찬성합니다',
        '매우 찬성합니다',
      ];
    default:
      return Array.from({ length: Math.max(0, Math.floor(scale)) }, (_, i) => String(i + 1));
  }
}

export type ChoiceTone = 'yes' | 'no' | 'neutral';
export type BallotChoice = { value: number; label: string; tone: ChoiceTone };

/**
 * 화면에 보일 선택지 순서(10/14 voter-2). 분과 의결(2점 척도)은 안내문 「찬성 또는 반대」·세리머니와 같게
 * 찬성을 위로 올린다. 저장값은 그대로(1=반대, 2=찬성) — 집계·세리머니가 그 값에 기대고 있다.
 */
export function ballotChoices(scale: number, decision: boolean): BallotChoice[] {
  const labels = scaleLabels(scale);
  const list = labels.map((label, i) => ({ value: i + 1, label, tone: 'neutral' as ChoiceTone }));
  if (decision && scale === 2) {
    return [
      { value: 2, label: labels[1], tone: 'yes' },
      { value: 1, label: labels[0], tone: 'no' },
    ];
  }
  return list;
}

/** 확인 창에 보일 「선택: 찬성」 — 분과 의결 1문항일 때만. 아니면 null(개수 문구만). */
export function decisionChoiceOf(items: readonly BallotItem[], answers: Record<string, number>, decision: boolean): BallotChoice | null {
  if (!decision || items.length !== 1 || items[0].scale !== 2) return null;
  const v = answers[items[0].id];
  return ballotChoices(2, true).find((c) => c.value === v) ?? null;
}

/**
 * /b 참여자 헤더의 분과 뱃지 문구. subgroup 있으면 '1분과 의견조사', 없으면 null(표시 없음).
 * S4 미적용 DB에서는 subgroup 키 자체가 없다(undefined) — 그때도 null이라 기존 화면 그대로다.
 */
export function subgroupVoteBadge(subgroup: string | null | undefined, decision = false): string | null {
  const s = subgroup?.trim();
  return s ? `${s} ${decision ? '의결' : '의견조사'}` : null;
}

/**
 * /b 화면 문구. 10/17 분과 의결 투표(isDivisionDecisionBallot)면 「의견조사」 대신 「투표」로 쓴다.
 * 일반 다의제 투표는 지금 문구 그대로다.
 */
export type VoterCopy = {
  eyebrow: string;
  doneTitle: string;
  doneBody: string;
  closedTitle: string;
  resultsEyebrow: string;
  evidence: string;
};

export const SURVEY_EVIDENCE_BOUNDARY =
  '이름·개인정보는 저장하지 않으며, 브라우저 기기 식별값으로 중복을 줄이는 비구속 현장 의견조사입니다. 공식 의사결정이나 참여 인원 산정의 단독 근거로 사용할 수 없습니다.';
export const DECISION_EVIDENCE_BOUNDARY =
  '운영규정에 따라 참석자 3분의 2 이상 찬성하면 가결됩니다. 부결되면 다시 투표합니다.';

export function voterCopy(decision: boolean): VoterCopy {
  if (decision) {
    return {
      eyebrow: '분과 의결 투표',
      doneTitle: '투표가 제출되었습니다',
      doneBody: '참여해 주셔서 감사합니다. 결과는 투표 마감 후 현장에서 발표합니다.',
      closedTitle: '투표가 마감되었습니다',
      resultsEyebrow: '투표 마감됨 · 결과',
      evidence: DECISION_EVIDENCE_BOUNDARY,
    };
  }
  return {
    eyebrow: '다의제 현장 의견조사',
    doneTitle: '의견이 제출되었습니다',
    doneBody: '참여해 주셔서 감사합니다. 결과는 의견조사 마감 후 공개됩니다.',
    closedTitle: '의견조사가 마감되었습니다',
    resultsEyebrow: '의견조사 마감됨 · 결과',
    evidence: SURVEY_EVIDENCE_BOUNDARY,
  };
}

/** 유효 범위(1..scale) 안의 답변인지. */
function hasValidAnswer(item: BallotItem, answers: Record<string, number>): boolean {
  const v = answers[item.id];
  return typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= item.scale;
}

/** 응답한 문항 수(진행률 "n/전체 응답" 분자). */
export function answeredCount(items: BallotItem[], answers: Record<string, number>): number {
  return items.filter((item) => hasValidAnswer(item, answers)).length;
}

/**
 * 제출 가능 여부 — required 문항 전부에 유효 답변이 있어야 true.
 * (ballot_submit의 서버 가드와 동일 조건. optional 문항은 비워도 된다.)
 */
export function isComplete(items: BallotItem[], answers: Record<string, number>): boolean {
  return items.filter((item) => item.required).every((item) => hasValidAnswer(item, answers));
}

// ── 로컬 제출 기록 ──────────────────────────────────────────────────
// 제출 성공/중복 확인 시 localStorage에 시각을 남겨, 재진입(QR 재스캔)하면
// 서버 왕복 없이 즉시 완료 화면을 띄운다. 키는 ballot별로 분리한다.

function localSubmitKey(ballotId: string): string {
  return `cv_ballot_${ballotId}`;
}

const localSubmitStorage = createSafeBrowserStorage('localStorage');

/** Whether the local completion marker will survive a page reload. */
export function isLocalSubmitStoragePersistent(): boolean {
  return localSubmitStorage.isPersistent();
}

/** 실명 투표(s28) — 이 기기에서 낸 조·이름·고른 값. 새로고침 뒤에도 「○○ 님 — 찬성으로 제출」을 다시 보인다. */
export type LocalVoter = { team: string; name: string; choice: string | null };

export function recordLocalVoter(ballotId: string, voter: LocalVoter): void {
  localSubmitStorage.setItem(`${localSubmitKey(ballotId)}_voter`, JSON.stringify(voter));
}

export function getLocalVoter(ballotId: string): LocalVoter | null {
  const raw = localSubmitStorage.getItem(`${localSubmitKey(ballotId)}_voter`);
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<LocalVoter>;
    return typeof v.team === 'string' && typeof v.name === 'string'
      ? { team: v.team, name: v.name, choice: typeof v.choice === 'string' ? v.choice : null }
      : null;
  } catch {
    return null;
  }
}

/** 완료 문구 — 「1분과 3조 홍길동 님 — 찬성으로 제출되었습니다」. */
export function namedDoneText(v: LocalVoter): string {
  return v.choice ? `${v.team} ${v.name} 님 — ${v.choice}${euro(v.choice)} 제출되었습니다` : `${v.team} ${v.name} 님 — 제출되었습니다`;
}

/** 조사 「으로/로」 — 받침이 있으면(ㄹ 제외) 「으로」. 찬성으로 · 반대로. */
function euro(word: string): string {
  const code = word.charCodeAt(word.length - 1) - 0xac00;
  if (code < 0 || code > 11171) return '로';
  const jong = code % 28;
  return jong !== 0 && jong !== 8 ? '으로' : '로';
}

/** 이 디바이스의 제출 기록(ISO 시각). 없으면 null. SSR(localStorage 없음)은 null. */
export function getLocalSubmit(ballotId: string): string | null {
  return localSubmitStorage.getItem(localSubmitKey(ballotId));
}

/** 제출 완료를 기록한다(ISO 시각). SSR에서는 no-op. */
export function recordLocalSubmit(ballotId: string, now: Date = new Date()): void {
  localSubmitStorage.setItem(localSubmitKey(ballotId), now.toISOString());
}

// ── 화면 상태 전이 ──────────────────────────────────────────────────

/**
 * 화면에 표시할 상태. ballot은 로딩 중이면 undefined, 없거나 비공개면 null.
 * - invalid: 토큰 없음/투표 없음(비공개 포함)
 * - loading: 조회 중
 * - active: open + 미제출 → 투표 화면
 * - done: open + 이 디바이스 제출됨 → 완료 화면(결과는 공개 전)
 * - closed: 마감(closed) → 마감 안내(결과 비공개)
 * - published: 공개(published) → 결과 요약 화면
 */
export type BallotScreen = 'invalid' | 'loading' | 'active' | 'done' | 'closed' | 'published';

export function resolveBallotScreen(input: {
  hasToken: boolean;
  ballot: Ballot | null | undefined;
  /** 이 디바이스가 제출을 마쳤는지(이번 세션 제출 or 로컬 기록 or 서버 duplicate). */
  submitted: boolean;
}): BallotScreen {
  if (!input.hasToken) return 'invalid';
  if (input.ballot === undefined) return 'loading';
  if (input.ballot === null) return 'invalid';
  if (input.ballot.status === 'published') return 'published';
  if (input.ballot.status === 'closed') return 'closed';
  if (input.submitted) return 'done';
  return 'active';
}

/** 완료 화면의 수동 새로고침 안내 문구. open이면 진행 중 안내, 아니면 null(화면이 전환됨). */
export function refreshNoticeMessage(ballot: Ballot): string | null {
  if (ballot.status !== 'open') return null;
  return '아직 투표가 진행 중입니다. 마감 후 다시 확인해 주세요.';
}
