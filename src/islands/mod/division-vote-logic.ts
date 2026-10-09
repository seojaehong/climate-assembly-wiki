/**
 * 10/17 토론회 「분과 의결」 — 순수 로직. React·DOM·fetch 의존이 없어 vitest로 그대로 검증한다.
 *
 * 설계: 10_작업산출물/2026-10-04_1017토론회_준비/01_설계_1017의결화면.md §1·§2(1단계)
 *
 * - 준비판: 권고 제목 카드에 처리 상태를 붙이고, 같은 주제 안 카드끼리만 「의결안」으로 묶는다.
 * - 투표 열기: 고른 의결안을 기존 ballot_create_v3 페이로드(scale 2, subgroup 「N분과」)로 바꾼다.
 * - 세리머니: 재적 R·참석 M·찬성 V 로 가결을 판정한다(운영규정 §16③, quorum.ts 정수식 재사용).
 *
 * ★ 원천 데이터(recs_1017.json)는 저장소에 넣지 않는다 — 공개 저장소·공개 배포라 번들에 실리면
 *   누구나 내려받는다. 화면이 「JSON 가져오기」로 받아 브라우저 저장소에만 둔다.
 */

import { computeQuorum } from '../quorum/quorum';
import type {
  BallotCreateInput,
  BallotCreateResult,
  BallotItemInput,
  BallotResults,
} from '../../lib/deliberation';
import { MAX_BALLOT_ITEMS, MAX_STATEMENT_LENGTH } from './ballot-panel-logic';

// ── 원천 데이터 모양 (recs_1017.json) ─────────────────────────

export type RecsRec = { no: string; text: string; note?: string };
export type RecsCard = {
  no: string;
  /** 빈 문자열이면 「제목 없음」 카드. */
  title: string;
  background: string;
  recs: RecsRec[];
  effect: string;
  schedule: string;
};
export type RecsTopic = {
  no: string;
  name: string;
  written_by: string;
  raised_by: string;
  cards: RecsCard[];
};
export type RecsDivision = { division: number; agenda: string; topics: RecsTopic[] };

// ── 카드 처리 상태 ───────────────────────────────────────────

/** 저장값은 ASCII. 한국어는 CARD_STATUS_LABELS 에만 둔다. 배열 순서 = 화면 버튼 순서. */
export const CARD_STATUSES = ['keep', 'excluded', 'merged', 'transferred', 'homework', 'adopt-pending'] as const;
export type CardStatus = (typeof CARD_STATUSES)[number];

export const CARD_STATUS_LABELS: Record<CardStatus, string> = {
  keep: '유지',
  excluded: '시행중-제외',
  merged: '통합',
  transferred: '이관',
  homework: '숙제',
  'adopt-pending': '미완성-선채택',
};

/** 10/3 결정 — 2분과 2-14~2-17 은 논의에서 빼고 다음 시민단 숙제로 넘긴다. */
export const HOMEWORK_TOPICS: readonly string[] = ['2-14', '2-15', '2-16', '2-17'];

export type CardState = {
  status: CardStatus;
  /** merged = 묶인 안 번호, transferred = 「N분과」. 그 밖에는 없다. */
  target?: string;
};

export function initialCardStatus(topicNo: string): CardStatus {
  return HOMEWORK_TOPICS.includes(topicNo) ? 'homework' : 'keep';
}

export function isUntitled(card: Pick<RecsCard, 'title'>): boolean {
  return card.title.trim().length === 0;
}

/** 카드 상태 한 줄 표기. 예: 「통합 → 1-1-안1」, 「이관 → 3분과」. */
export function cardStatusText(state: CardState): string {
  const label = CARD_STATUS_LABELS[state.status];
  if ((state.status === 'merged' || state.status === 'transferred') && state.target) {
    return `${label} → ${state.target}`;
  }
  return label;
}

// ── 5개 권고 수준 (운영규정 §17②) ────────────────────────────

export const CRITERIA = ['effectiveness', 'equity', 'acceptability', 'sustainability', 'feasibility'] as const;
export type Criterion = (typeof CRITERIA)[number];
export const CRITERION_LABELS: Record<Criterion, string> = {
  effectiveness: '효과성',
  equity: '형평성',
  acceptability: '사회적 수용성',
  sustainability: '지속가능성',
  feasibility: '실행가능성',
};

/** 조별 판정 한 칸. 빈칸은 키 자체를 두지 않는다. */
export type Mark = 'met' | 'unmet';
export const MARK_LABELS: Record<Mark, string> = { met: '충족', unmet: '미충족' };

/** 권고 수준 표의 줄 — 조1~조5. 저장 키는 '1'..'5'. */
export const TEAM_NOS = ['1', '2', '3', '4', '5'] as const;
export type TeamNo = (typeof TEAM_NOS)[number];

/** 조 → 기준 → 충족/미충족. */
export type CriteriaGrid = Partial<Record<TeamNo, Partial<Record<Criterion, Mark>>>>;

// ── 준비판 상태 ──────────────────────────────────────────────

/**
 * 안 하나의 투표 한 차례(1차·2차). 투표 자체의 진행 상태는 PrepState.ballots[requestId] 에 있고
 * 여기는 이 안의 결과만 둔다. 재적·참석은 마감 때 값을 박아 둔다(뒤에 참석이 바뀌어도 판정이 흔들리지 않게).
 */
export type MotionRound = {
  round: number;
  /** PrepState.ballots 의 키 = ballot_create_v3 멱등키. */
  requestId: string;
  /** 이 차수에 쓴 안 제목(2차에서 문구를 고쳐도 1차 제목이 남는다). */
  title: string;
  onlineYes: number | null;
  onlineNo: number | null;
  handYes: number;
  handNo: number;
  enrolled: number | null;
  present: number | null;
  verdict: 'passed' | 'failed' | 'invalid' | null;
  closedAt: string | null;
};

export type Motion = {
  /** `${topicNo}-안${k}`. k 는 주제 안에서 1부터, 지운 번호를 다시 쓰지 않는다. */
  id: string;
  topicNo: string;
  /** 원 카드 번호(자리 순서). */
  cardNos: string[];
  title: string;
  text: string;
  /** 조별 권고 수준 판정(5×5). */
  grid: CriteriaGrid;
  /** 기준별 「최종 판정」 직접 지정. 있으면 다수결보다 앞선다. */
  override: Partial<Record<Criterion, Mark>>;
  otherOpinion: string;
  minorityOpinion: string;
  /** 'minority' = 부결 뒤 소수 의견으로 기록하고 닫음. */
  resolution: 'minority' | null;
  /** 부결 뒤 「문구 고쳐 2차 투표」를 고른 상태. 2차 투표가 시작되면 false 로 돌아간다. */
  revote: boolean;
  rounds: MotionRound[];
};

export type BallotStage = 'creating' | 'draft' | 'open' | 'closed';

/** 운영 서버에 만든(또는 만드는 중인) 투표 하나. 키 = 멱등키. */
export type BallotRecord = {
  requestId: string;
  /** create 에 보낸 내용 그대로 — 재시도는 같은 키·같은 내용이어야 서버가 같은 투표를 돌려준다. */
  title: string;
  instructions: string;
  subgroup: string;
  statements: string[];
  /** statements 와 같은 순서(문항 번호 = 자리 + 1). */
  motionIds: string[];
  round: number;
  stage: BallotStage;
  ballotId: string | null;
  token: string | null;
  openedAt: string | null;
  closedAt: string | null;
};

export type Attendance = { enrolled: number | null; present: number | null };

export const PREP_VERSION = 2;

/** 내보내기 파일 한 개로 다른 기기에서 그대로 이어 쓸 수 있게 원천 사본까지 담는다. */
export type PrepState = {
  v: typeof PREP_VERSION;
  division: number;
  source: RecsDivision;
  cards: Record<string, CardState>;
  motions: Motion[];
  attendance: Attendance;
  ballots: Record<string, BallotRecord>;
};

export function initPrepState(source: RecsDivision): PrepState {
  const cards: Record<string, CardState> = {};
  for (const topic of source.topics) {
    for (const card of topic.cards) cards[card.no] = { status: initialCardStatus(topic.no) };
  }
  return {
    v: PREP_VERSION,
    division: source.division,
    source,
    cards,
    motions: [],
    attendance: { enrolled: null, present: null },
    ballots: {},
  };
}

export function newMotionFields(): Pick<Motion, 'grid' | 'override' | 'otherOpinion' | 'minorityOpinion' | 'resolution' | 'revote' | 'rounds'> {
  return { grid: {}, override: {}, otherOpinion: '', minorityOpinion: '', resolution: null, revote: false, rounds: [] };
}

export function divisionLabel(division: number): string {
  return `${division}분과`;
}

/** 브라우저 저장소 키. 분과마다 따로 둔다. */
/** 조 분과 「N분과」 → N. 분과가 없거나(운영진) 모양이 다르면 null = 잠그지 않음. */
export function lockedDivisionOf(subgroup: string | null | undefined): number | null {
  const m = /^\s*([1-9])분과\s*$/.exec(subgroup ?? '');
  return m ? Number(m[1]) : null;
}

export const PREP_STORAGE_PREFIX = 'climate_1017_prep_v1';
export function prepStorageKey(division: number): string {
  return `${PREP_STORAGE_PREFIX}:${division}`;
}
export const PREP_DIVISION_KEY = `${PREP_STORAGE_PREFIX}:division`;

export function setCardStatus(state: PrepState, cardNo: string, next: CardState): PrepState {
  if (!(cardNo in state.cards)) return state;
  const clean: CardState = { status: next.status };
  if ((next.status === 'merged' || next.status === 'transferred') && next.target?.trim()) {
    clean.target = next.target.trim();
  }
  return { ...state, cards: { ...state.cards, [cardNo]: clean } };
}

/** 카드 번호 → 주제 번호. 번호 문자열을 쪼개지 않고 원천 구조에서 찾는다. */
export function topicOfCard(source: RecsDivision, cardNo: string): string | null {
  for (const topic of source.topics) {
    if (topic.cards.some((card) => card.no === cardNo)) return topic.no;
  }
  return null;
}

export type CombineCheck =
  | { ok: true; topicNo: string }
  | { ok: false; reason: 'empty' | 'unknown-card' | 'mixed-topic'; topics?: string[] };

/** 10/3 결정 — 통합은 같은 주제 안에서만. 다른 주제 카드가 섞이면 거절한다. */
export function canCombine(source: RecsDivision, cardNos: readonly string[]): CombineCheck {
  if (cardNos.length === 0) return { ok: false, reason: 'empty' };
  const topics: string[] = [];
  for (const no of cardNos) {
    const topic = topicOfCard(source, no);
    if (!topic) return { ok: false, reason: 'unknown-card' };
    if (!topics.includes(topic)) topics.push(topic);
  }
  if (topics.length > 1) return { ok: false, reason: 'mixed-topic', topics };
  return { ok: true, topicNo: topics[0] };
}

export function combineFailureText(check: CombineCheck): string | null {
  if (check.ok) return null;
  if (check.reason === 'empty') return '카드를 1개 이상 고르십시오.';
  if (check.reason === 'unknown-card') return '목록에 없는 카드가 섞였습니다.';
  return `다른 주제(${(check.topics ?? []).join(' · ')})의 카드는 한 안으로 묶을 수 없습니다.`;
}

export function nextMotionId(state: PrepState, topicNo: string): string {
  const prefix = `${topicNo}-안`;
  let max = 0;
  for (const motion of state.motions) {
    if (motion.topicNo !== topicNo || !motion.id.startsWith(prefix)) continue;
    const k = Number(motion.id.slice(prefix.length));
    if (Number.isInteger(k) && k > max) max = k;
  }
  return `${prefix}${max + 1}`;
}

/** 원천 목록 순서로 카드 번호를 정렬한다(고른 순서가 아니라 자리 순서). */
function orderCardNos(source: RecsDivision, cardNos: readonly string[]): string[] {
  const order: string[] = [];
  for (const topic of source.topics) for (const card of topic.cards) order.push(card.no);
  return [...new Set(cardNos)].sort((a, b) => order.indexOf(a) - order.indexOf(b));
}

export type CreateMotionResult = { ok: true; state: PrepState; motion: Motion } | { ok: false; error: string };

/**
 * 의결안 만들기. 카드가 2개 이상이면 그 카드들의 상태를 「통합 → 안 번호」로 바꾼다.
 * 1개짜리 안은 카드 상태를 건드리지 않는다(유지·미완성-선채택 등 그대로).
 */
export function createMotion(
  state: PrepState,
  input: { cardNos: readonly string[]; title: string; text: string },
): CreateMotionResult {
  const check = canCombine(state.source, input.cardNos);
  if (!check.ok) return { ok: false, error: combineFailureText(check) ?? '' };
  const excluded = input.cardNos.filter((no) => state.cards[no]?.status === 'excluded');
  if (excluded.length > 0) {
    return { ok: false, error: `시행중-제외 카드(${excluded.join(', ')})는 의결안에 넣을 수 없습니다.` };
  }
  const title = input.title.trim();
  if (!title) return { ok: false, error: '안 제목을 입력하십시오.' };
  const cardNos = orderCardNos(state.source, input.cardNos);
  const motion: Motion = {
    id: nextMotionId(state, check.topicNo),
    topicNo: check.topicNo,
    cardNos,
    title,
    text: input.text.trim(),
    ...newMotionFields(),
  };
  let cards = state.cards;
  if (cardNos.length > 1) {
    cards = { ...cards };
    for (const no of cardNos) cards[no] = { status: 'merged', target: motion.id };
  }
  return { ok: true, motion, state: { ...state, cards, motions: sortMotions(state.source, [...state.motions, motion]) } };
}

/** 주제 순서 → 같은 주제 안에서는 안 번호 순. */
export function sortMotions(source: RecsDivision, motions: Motion[]): Motion[] {
  const topicOrder = source.topics.map((topic) => topic.no);
  const k = (motion: Motion) => Number(motion.id.slice(`${motion.topicNo}-안`.length)) || 0;
  return [...motions].sort(
    (a, b) => topicOrder.indexOf(a.topicNo) - topicOrder.indexOf(b.topicNo) || k(a) - k(b),
  );
}

export function updateMotion(
  state: PrepState,
  id: string,
  patch: Partial<Pick<Motion, 'title' | 'text' | 'otherOpinion' | 'minorityOpinion'>>,
): PrepState {
  return {
    ...state,
    motions: state.motions.map((motion) => (motion.id === id ? { ...motion, ...patch } : motion)),
  };
}

/** 투표를 한 번이라도 시작한 안은 지우지 않는다(결과·투표 기록이 사라진다). */
export function canDeleteMotion(motion: Pick<Motion, 'rounds'>): boolean {
  return motion.rounds.length === 0;
}

/** 안을 지우면 「통합 → 그 안」 이던 카드를 「유지」로 되돌린다. 투표가 시작된 안은 그대로 둔다. */
export function deleteMotion(state: PrepState, id: string): PrepState {
  const target = state.motions.find((m) => m.id === id);
  if (!target || !canDeleteMotion(target)) return state;
  const cards = { ...state.cards };
  for (const [no, card] of Object.entries(cards)) {
    if (card.status === 'merged' && card.target === id) cards[no] = { status: 'keep' };
  }
  return { ...state, cards, motions: state.motions.filter((motion) => motion.id !== id) };
}

// ── 권고 수준 표(조1~조5 × 5개 기준) ─────────────────────────

export type CriterionResult = 'met' | 'unmet' | 'tie' | 'none';
export const CRITERION_RESULT_LABELS: Record<CriterionResult, string> = {
  met: '충족',
  unmet: '미충족',
  tie: '동수',
  none: '-',
};

/** 칸 하나 바꾸기. mark=null 이면 빈칸으로. 없는 조·기준은 무시한다. */
export function setGridMark(state: PrepState, motionId: string, team: TeamNo, criterion: Criterion, mark: Mark | null): PrepState {
  if (!TEAM_NOS.includes(team) || !CRITERIA.includes(criterion)) return state;
  return {
    ...state,
    motions: state.motions.map((m) => {
      if (m.id !== motionId) return m;
      const row = { ...(m.grid[team] ?? {}) };
      if (mark) row[criterion] = mark;
      else delete row[criterion];
      const grid = { ...m.grid };
      if (Object.keys(row).length > 0) grid[team] = row;
      else delete grid[team];
      return { ...m, grid };
    }),
  };
}

/** 최종 판정 직접 지정. mark=null 이면 지정을 지우고 다수결로 돌아간다. */
export function setCriterionOverride(state: PrepState, motionId: string, criterion: Criterion, mark: Mark | null): PrepState {
  if (!CRITERIA.includes(criterion)) return state;
  return {
    ...state,
    motions: state.motions.map((m) => {
      if (m.id !== motionId) return m;
      const override = { ...m.override };
      if (mark) override[criterion] = mark;
      else delete override[criterion];
      return { ...m, override };
    }),
  };
}

/** 다수결 줄 — 채운 칸 중 충족이 많으면 충족, 미충족이 많으면 미충족, 같으면 동수, 다 비면 「-」. */
export function teamMajority(grid: CriteriaGrid, criterion: Criterion): CriterionResult {
  let met = 0;
  let unmet = 0;
  for (const team of TEAM_NOS) {
    const v = grid[team]?.[criterion];
    if (v === 'met') met += 1;
    else if (v === 'unmet') unmet += 1;
  }
  if (met === 0 && unmet === 0) return 'none';
  if (met > unmet) return 'met';
  if (unmet > met) return 'unmet';
  return 'tie';
}

/** 기준 하나의 최종 판정. 직접 정한 값이 있으면 그것이 이긴다. */
export function finalCriterion(motion: Pick<Motion, 'grid' | 'override'>, criterion: Criterion): { value: CriterionResult; direct: boolean } {
  const direct = motion.override[criterion];
  if (direct) return { value: direct, direct: true };
  return { value: teamMajority(motion.grid, criterion), direct: false };
}

/** 최종 판정이 「충족」인 기준 수. */
export function criteriaCount(motion: Pick<Motion, 'grid' | 'override'>): number {
  return CRITERIA.filter((key) => finalCriterion(motion, key).value === 'met').length;
}

// ── 시행중-제외 ──────────────────────────────────────────────

/** 안의 원 카드가 전부 「시행중-제외」면 그 안은 제외 — 투표에 올리지 않는다. */
export function motionExcluded(state: Pick<PrepState, 'cards'>, motion: Pick<Motion, 'cardNos'>): boolean {
  return motion.cardNos.length > 0 && motion.cardNos.every((no) => state.cards[no]?.status === 'excluded');
}

/** 시행중-제외 카드 번호(원천 자리 순서). */
export function excludedCardNos(state: Pick<PrepState, 'source' | 'cards'>): string[] {
  const out: string[] = [];
  for (const topic of state.source.topics) {
    for (const card of topic.cards) if (state.cards[card.no]?.status === 'excluded') out.push(card.no);
  }
  return out;
}

/** 상태별 카드 수(6종 전부, 0도 자리를 지킨다). */
export function statusTally(state: PrepState): Record<CardStatus, number> {
  const tally = Object.fromEntries(CARD_STATUSES.map((s) => [s, 0])) as Record<CardStatus, number>;
  for (const card of Object.values(state.cards)) tally[card.status] += 1;
  return tally;
}

// ── JSON 내보내기·가져오기 ────────────────────────────────────

export function serializePrep(state: PrepState): string {
  return JSON.stringify(state, null, 2);
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const isStr = (x: unknown): x is string => typeof x === 'string';
const optStr = (x: unknown): string | null => (x === undefined || x === null ? '' : isStr(x) ? x : null);

function readRec(x: unknown): RecsRec | null {
  if (!isObj(x) || !isStr(x.no) || !isStr(x.text)) return null;
  const rec: RecsRec = { no: x.no, text: x.text };
  if (isStr(x.note)) rec.note = x.note;
  return rec;
}

function readCard(x: unknown): RecsCard | null {
  if (!isObj(x) || !isStr(x.no) || !isStr(x.title) || !Array.isArray(x.recs)) return null;
  const background = optStr(x.background);
  const effect = optStr(x.effect);
  const schedule = optStr(x.schedule);
  if (background === null || effect === null || schedule === null) return null;
  const recs = x.recs.map(readRec);
  if (recs.some((r) => r === null)) return null;
  return { no: x.no, title: x.title, background, recs: recs as RecsRec[], effect, schedule };
}

function readTopic(x: unknown): RecsTopic | null {
  if (!isObj(x) || !isStr(x.no) || !isStr(x.name) || !Array.isArray(x.cards)) return null;
  const written = optStr(x.written_by);
  const raised = optStr(x.raised_by);
  if (written === null || raised === null) return null;
  const cards = x.cards.map(readCard);
  if (cards.some((c) => c === null)) return null;
  return { no: x.no, name: x.name, written_by: written, raised_by: raised, cards: cards as RecsCard[] };
}

function readDivision(x: unknown): RecsDivision | null {
  if (!isObj(x) || !Number.isInteger(x.division) || (x.division as number) < 1) return null;
  if (!isStr(x.agenda) || !Array.isArray(x.topics)) return null;
  const topics = x.topics.map(readTopic);
  if (topics.some((t) => t === null)) return null;
  return { division: x.division as number, agenda: x.agenda, topics: topics as RecsTopic[] };
}

const isMark = (x: unknown): x is Mark => x === 'met' || x === 'unmet';
const optCount = (x: unknown): number | null | undefined =>
  x === null || x === undefined ? null : typeof x === 'number' && Number.isInteger(x) && x >= 0 ? x : undefined;
const optIso = (x: unknown): string | null | undefined => (x === null || x === undefined ? null : isStr(x) ? x : undefined);

function readGrid(x: unknown): CriteriaGrid | null {
  if (x === undefined) return {};
  if (!isObj(x)) return null;
  const grid: CriteriaGrid = {};
  for (const [team, row] of Object.entries(x)) {
    if (!TEAM_NOS.includes(team as TeamNo) || !isObj(row)) return null;
    const clean: Partial<Record<Criterion, Mark>> = {};
    for (const [k, v] of Object.entries(row)) {
      if (!CRITERIA.includes(k as Criterion)) return null;
      if (v === null || v === undefined) continue;
      if (!isMark(v)) return null;
      clean[k as Criterion] = v;
    }
    if (Object.keys(clean).length > 0) grid[team as TeamNo] = clean;
  }
  return grid;
}

function readOverride(x: unknown): Partial<Record<Criterion, Mark>> | null {
  if (x === undefined) return {};
  if (!isObj(x)) return null;
  const out: Partial<Record<Criterion, Mark>> = {};
  for (const [k, v] of Object.entries(x)) {
    if (!CRITERIA.includes(k as Criterion)) return null;
    if (v === null || v === undefined) continue;
    if (!isMark(v)) return null;
    out[k as Criterion] = v;
  }
  return out;
}

function readRound(x: unknown): MotionRound | null {
  if (!isObj(x) || !Number.isInteger(x.round) || (x.round as number) < 1) return null;
  if (!isStr(x.requestId) || !isStr(x.title)) return null;
  const onlineYes = optCount(x.onlineYes);
  const onlineNo = optCount(x.onlineNo);
  const handYes = optCount(x.handYes);
  const handNo = optCount(x.handNo);
  const enrolled = optCount(x.enrolled);
  const present = optCount(x.present);
  const closedAt = optIso(x.closedAt);
  if ([onlineYes, onlineNo, handYes, handNo, enrolled, present, closedAt].some((v) => v === undefined)) return null;
  const verdict = x.verdict ?? null;
  if (verdict !== null && verdict !== 'passed' && verdict !== 'failed' && verdict !== 'invalid') return null;
  return {
    round: x.round as number,
    requestId: x.requestId,
    title: x.title,
    onlineYes: onlineYes as number | null,
    onlineNo: onlineNo as number | null,
    handYes: (handYes as number | null) ?? 0,
    handNo: (handNo as number | null) ?? 0,
    enrolled: enrolled as number | null,
    present: present as number | null,
    verdict: verdict as MotionRound['verdict'],
    closedAt: closedAt as string | null,
  };
}

/**
 * v1 → v2: 기준 체크칸(true/false 5개)은 「최종 판정 직접 지정」으로 옮긴다.
 * ★ true 만 「충족」으로 옮기고 false 는 빈칸으로 둔다 — v1 은 처음부터 전부 false 였으므로
 *   false 를 「미충족」으로 옮기면 손대지 않은 안이 전부 「직접 정함 미충족」이 된다.
 */
function readMotion(x: unknown, source: RecsDivision, v: 1 | 2): Motion | null {
  if (!isObj(x) || !isStr(x.id) || !isStr(x.topicNo) || !isStr(x.title) || !isStr(x.text)) return null;
  if (!Array.isArray(x.cardNos) || !x.cardNos.every(isStr)) return null;
  const check = canCombine(source, x.cardNos as string[]);
  if (!check.ok || check.topicNo !== x.topicNo) return null;
  const base = { id: x.id, topicNo: x.topicNo, cardNos: [...(x.cardNos as string[])], title: x.title, text: x.text };
  if (v === 1) {
    if (!isObj(x.criteria)) return null;
    const override: Partial<Record<Criterion, Mark>> = {};
    for (const key of CRITERIA) if (x.criteria[key] === true) override[key] = 'met';
    return { ...base, ...newMotionFields(), override };
  }
  const grid = readGrid(x.grid);
  const override = readOverride(x.override);
  const other = optStr(x.otherOpinion);
  const minority = optStr(x.minorityOpinion);
  if (!grid || !override || other === null || minority === null) return null;
  const resolution = x.resolution ?? null;
  if (resolution !== null && resolution !== 'minority') return null;
  if (x.revote !== undefined && typeof x.revote !== 'boolean') return null;
  const rawRounds = x.rounds ?? [];
  if (!Array.isArray(rawRounds)) return null;
  const rounds = rawRounds.map(readRound);
  if (rounds.some((r) => r === null)) return null;
  return {
    ...base,
    grid,
    override,
    otherOpinion: other,
    minorityOpinion: minority,
    resolution: resolution as Motion['resolution'],
    revote: x.revote === true,
    rounds: rounds as MotionRound[],
  };
}

const BALLOT_STAGES: readonly BallotStage[] = ['creating', 'draft', 'open', 'closed'];

function readBallot(key: string, x: unknown): BallotRecord | null {
  if (!isObj(x) || x.requestId !== key || !isStr(x.title) || !isStr(x.subgroup)) return null;
  const instructions = optStr(x.instructions);
  if (instructions === null) return null;
  if (!Array.isArray(x.statements) || !x.statements.every(isStr)) return null;
  if (!Array.isArray(x.motionIds) || !x.motionIds.every(isStr)) return null;
  if (x.statements.length !== x.motionIds.length || x.motionIds.length === 0) return null;
  if (!Number.isInteger(x.round) || (x.round as number) < 1) return null;
  if (!BALLOT_STAGES.includes(x.stage as BallotStage)) return null;
  const ballotId = optIso(x.ballotId);
  const token = optIso(x.token);
  const openedAt = optIso(x.openedAt);
  const closedAt = optIso(x.closedAt);
  if ([ballotId, token, openedAt, closedAt].some((v) => v === undefined)) return null;
  // 서버가 투표를 돌려준 뒤 단계(draft 이후)에는 id·token 이 꼭 있어야 한다.
  if (x.stage !== 'creating' && (!ballotId || !token)) return null;
  return {
    requestId: key,
    title: x.title,
    instructions,
    subgroup: x.subgroup,
    statements: [...(x.statements as string[])],
    motionIds: [...(x.motionIds as string[])],
    round: x.round as number,
    stage: x.stage as BallotStage,
    ballotId: ballotId as string | null,
    token: token as string | null,
    openedAt: openedAt as string | null,
    closedAt: closedAt as string | null,
  };
}

function readAttendance(x: unknown): Attendance | null {
  if (x === undefined) return { enrolled: null, present: null };
  if (!isObj(x)) return null;
  const enrolled = optCount(x.enrolled);
  const present = optCount(x.present);
  if (enrolled === undefined || present === undefined) return null;
  return { enrolled, present };
}

function readPrep(x: Record<string, unknown>): PrepState | null {
  if ((x.v !== 1 && x.v !== PREP_VERSION) || !Number.isInteger(x.division)) return null;
  const v = x.v as 1 | 2;
  const source = readDivision(x.source);
  if (!source || source.division !== x.division) return null;
  if (!isObj(x.cards) || !Array.isArray(x.motions)) return null;
  const base = initPrepState(source);
  const cards: Record<string, CardState> = { ...base.cards };
  for (const [no, raw] of Object.entries(x.cards)) {
    if (!(no in cards)) return null;
    if (!isObj(raw) || !CARD_STATUSES.includes(raw.status as CardStatus)) return null;
    if (raw.target !== undefined && !isStr(raw.target)) return null;
    cards[no] = raw.target ? { status: raw.status as CardStatus, target: raw.target as string } : { status: raw.status as CardStatus };
  }
  const motions = x.motions.map((m) => readMotion(m, source, v));
  if (motions.some((m) => m === null)) return null;
  const ids = (motions as Motion[]).map((m) => m.id);
  if (new Set(ids).size !== ids.length) return null;
  const attendance = v === 1 ? base.attendance : readAttendance(x.attendance);
  if (!attendance) return null;
  const ballots: Record<string, BallotRecord> = {};
  if (v === 2 && x.ballots !== undefined) {
    if (!isObj(x.ballots)) return null;
    for (const [key, raw] of Object.entries(x.ballots)) {
      const b = readBallot(key, raw);
      if (!b || b.motionIds.some((id) => !ids.includes(id))) return null;
      ballots[key] = b;
    }
  }
  // 안의 차수가 가리키는 투표가 있어야 한다(없으면 진행 상태를 알 수 없다).
  for (const m of motions as Motion[]) {
    if (m.rounds.some((r) => !ballots[r.requestId])) return null;
  }
  return {
    v: PREP_VERSION,
    division: source.division,
    source,
    cards,
    motions: sortMotions(source, motions as Motion[]),
    attendance,
    ballots,
  };
}

/** 모양이 무엇이든(서버 줄·저장소·파일) 준비판으로 읽는다. v1 은 v2 로 옮긴다. 못 읽으면 null. */
export function migratePrep(x: unknown): PrepState | null {
  return isObj(x) ? readPrep(x) : null;
}

export type ParsedImport =
  | { kind: 'recs'; divisions: RecsDivision[] }
  | { kind: 'state'; state: PrepState }
  | { kind: 'error'; message: string };

/**
 * 가져오기 파일 판독. 배열이면 원천(recs_1017.json), `v` 가 있는 객체면 준비판 내보내기.
 * ★ 한 줄이라도 모양이 틀리면 통째로 거절한다 — 반쪽만 읽으면 카드가 조용히 사라진다.
 */
export function parseImport(text: string): ParsedImport {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { kind: 'error', message: 'JSON 파일이 아닙니다.' };
  }
  if (Array.isArray(raw)) {
    const divisions = raw.map(readDivision);
    if (divisions.length === 0 || divisions.some((d) => d === null)) {
      return { kind: 'error', message: '권고안 원천 파일의 모양이 맞지 않습니다.' };
    }
    const nos = (divisions as RecsDivision[]).map((d) => d.division);
    if (new Set(nos).size !== nos.length) return { kind: 'error', message: '같은 분과가 두 번 들어 있습니다.' };
    return { kind: 'recs', divisions: divisions as RecsDivision[] };
  }
  if (isObj(raw) && 'v' in raw) {
    const state = readPrep(raw);
    return state ? { kind: 'state', state } : { kind: 'error', message: '준비판 파일의 모양이 맞지 않습니다.' };
  }
  return { kind: 'error', message: '알 수 없는 파일입니다.' };
}

/** 저장소에서 읽은 값. 깨졌으면 null(화면은 「가져오기」 안내로 돌아간다). */
export function readStoredPrep(text: string | null): PrepState | null {
  if (!text) return null;
  const parsed = parseImport(text);
  return parsed.kind === 'state' ? parsed.state : null;
}

export function exportFileName(division: number, at: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const stamp = `${at.getFullYear()}${p(at.getMonth() + 1)}${p(at.getDate())}-${p(at.getHours())}${p(at.getMinutes())}`;
  return `1017_의결준비_${division}분과_${stamp}.json`;
}

// ── 투표 열기 (ballot_create_v3) ──────────────────────────────

export const DIVISION_BALLOT_SCALE = 2 as const;

/** 투표 문항 문장 = 「안 번호 + 안 제목」. 문안 전체는 300자 제한에 걸려 넣지 않는다. */
export function motionStatement(motion: Pick<Motion, 'id' | 'title'>): string {
  return `${motion.id} ${motion.title.trim()}`;
}

export type DivisionBallotPlan = {
  payload: BallotCreateInput & { instructions: string | null; subgroup: string; items: BallotItemInput[] };
  /** 화면 경고. 비어 있지 않으면 만들기 버튼을 막는다. */
  problems: string[];
};

/**
 * 의결안을 투표 묶음으로 나눈다. 주제 순서를 지키고 한 주제를 두 묶음으로 쪼개지 않는다.
 * 다음 주제를 더하면 size 를 넘을 때 새 묶음을 연다. 한 주제가 size 보다 크면 그 주제만으로 한 묶음.
 * size = 1 이면 안 하나씩, Infinity 면 전체 한 번.
 */
export function batchMotions(motions: readonly Motion[], size: number): Motion[][] {
  if (size <= 1) return motions.map((m) => [m]);
  const topics: Motion[][] = [];
  for (const m of motions) {
    const last = topics[topics.length - 1];
    if (last && last[0].topicNo === m.topicNo) last.push(m);
    else topics.push([m]);
  }
  const batches: Motion[][] = [];
  for (const group of topics) {
    const last = batches[batches.length - 1];
    if (last && last.length + group.length <= size) last.push(...group);
    else batches.push([...group]);
  }
  return batches;
}

/** 묶음 이름 — 「1-1~1-4」 또는 「1-2」. 투표 제목에 붙어 투표 목록에서 서로 구분된다. */
export function batchLabel(batch: readonly Motion[]): string {
  if (batch.length === 0) return '';
  const first = batch[0].topicNo;
  const last = batch[batch.length - 1].topicNo;
  if (batch.length === 1) return batch[0].id;
  return first === last ? first : `${first}~${last}`;
}

export function buildDivisionBallot(division: number, motions: readonly Motion[], label?: string): DivisionBallotPlan {
  const subgroup = divisionLabel(division);
  const problems: string[] = [];
  if (motions.length === 0) problems.push('투표에 넣을 의결안을 1개 이상 고르십시오.');
  if (motions.length > MAX_BALLOT_ITEMS) {
    problems.push(`한 투표에 담을 수 있는 안은 ${MAX_BALLOT_ITEMS}개입니다(지금 ${motions.length}개). 나눠서 여십시오.`);
  }
  const items: BallotItemInput[] = motions.map((motion, index) => ({
    ordinal: index + 1,
    statement: motionStatement(motion),
    scale: DIVISION_BALLOT_SCALE,
    required: true,
  }));
  items.forEach((item) => {
    if (item.statement.length > MAX_STATEMENT_LENGTH) {
      problems.push(`${item.statement.slice(0, 12)}… 문장이 ${MAX_STATEMENT_LENGTH}자를 넘습니다.`);
    }
  });
  return {
    payload: {
      title: label ? `${subgroup} 의결 ${label}` : `${subgroup} 의결`,
      instructions: '안마다 찬성 또는 반대를 고릅니다.',
      items,
      subgroup,
    },
    problems,
  };
}

/** 네트워크를 주입받는 연결부 — 실제 RPC 대신 목으로 시험한다. */
export async function openDivisionBallot(
  create: (input: BallotCreateInput, idempotencyKey: string) => Promise<BallotCreateResult>,
  plan: DivisionBallotPlan,
  idempotencyKey: string,
): Promise<BallotCreateResult> {
  if (plan.problems.length > 0) throw new Error(plan.problems[0]);
  return create(plan.payload, idempotencyKey);
}

// ── 세리머니 판정 ─────────────────────────────────────────────

export type Verdict =
  | { kind: 'invalid'; message: string }
  | { kind: 'no-quorum'; establishThreshold: number; shortfall: number }
  | { kind: 'decided'; passed: boolean; yeas: number; present: number; threshold: number };

const isCount = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0;

/** 재적·참석만으로 본 성립 여부. computeQuorum 이 던지는 경우를 먼저 걸러 문구로 돌려준다. */
export function attendanceCheck(
  enrolled: number,
  present: number,
): { kind: 'invalid'; message: string } | { kind: 'ok'; established: boolean; establishThreshold: number; shortfall: number; decisionThreshold: number | null } {
  if (!isCount(enrolled) || enrolled < 1) return { kind: 'invalid', message: '재적 인원을 1 이상으로 입력하십시오.' };
  if (!isCount(present)) return { kind: 'invalid', message: '참석 인원을 0 이상으로 입력하십시오.' };
  if (present > enrolled) return { kind: 'invalid', message: '참석 인원이 재적보다 많습니다.' };
  const q = computeQuorum({ enrolled, present });
  return {
    kind: 'ok',
    established: q.established,
    establishThreshold: q.establishThreshold,
    shortfall: q.shortfall,
    decisionThreshold: q.decisionThreshold,
  };
}

/** 운영규정 §16③ — 재적 과반수 참석 + 참석자 3분의 2 이상 찬성. 분모는 참석 M. */
export function decideMotion(enrolled: number, present: number, yeas: number): Verdict {
  const att = attendanceCheck(enrolled, present);
  if (att.kind === 'invalid') return att;
  if (!att.established) {
    return { kind: 'no-quorum', establishThreshold: att.establishThreshold, shortfall: att.shortfall };
  }
  if (!isCount(yeas)) return { kind: 'invalid', message: '찬성 수를 0 이상으로 입력하십시오.' };
  if (yeas > present) return { kind: 'invalid', message: '찬성 수가 참석 인원보다 많습니다.' };
  const q = computeQuorum({ enrolled, present, yeas });
  return { kind: 'decided', passed: q.passed === true, yeas, present, threshold: q.decisionThreshold ?? 0 };
}

/**
 * 찬성·반대를 함께 받는 판정(온라인 + 거수 합계). 찬성+반대가 참석보다 많으면 판정하지 않는다 —
 * 참석 인원을 잘못 넣었거나 표가 겹친 것이다. 나머지는 decideMotion 과 같다.
 */
export function decideVote(enrolled: number, present: number, yeas: number, nays: number): Verdict {
  const base = decideMotion(enrolled, present, yeas);
  if (base.kind !== 'decided') return base;
  if (!isCount(nays)) return { kind: 'invalid', message: '반대 수를 0 이상으로 입력하십시오.' };
  if (yeas + nays > present) {
    return { kind: 'invalid', message: `찬성·반대 합계(${yeas + nays})가 참석 인원(${present})보다 많습니다. 참석 인원을 확인하십시오.` };
  }
  return base;
}

/** 「가결선: 찬성 N표 이상 (참석 M명의 3분의 2)」. 정족수가 안 되면 그 사유. */
export function passLineText(enrolled: number | null, present: number | null): string {
  if (enrolled === null || present === null) return '재적과 참석 인원을 넣으십시오.';
  const att = attendanceCheck(enrolled, present);
  if (att.kind === 'invalid') return att.message;
  if (!att.established) {
    return `정족수 미달 — 재적 ${enrolled}명의 과반수인 ${att.establishThreshold}명 이상이 참석해야 합니다(${att.shortfall}명 부족).`;
  }
  return `가결선: 찬성 ${att.decisionThreshold}표 이상 (참석 ${present}명의 3분의 2)`;
}

/** 투표를 시작해도 되는 참석 상태인가 — 둘 다 넣었고 재적 과반수가 참석. */
export function attendanceReady(att: Attendance): boolean {
  if (att.enrolled === null || att.present === null) return false;
  const c = attendanceCheck(att.enrolled, att.present);
  return c.kind === 'ok' && c.established;
}

export function attendanceText(enrolled: number, present: number): string {
  const att = attendanceCheck(enrolled, present);
  if (att.kind === 'invalid') return att.message;
  if (!att.established) {
    return `정족수 미달입니다. 재적 ${enrolled}명의 과반수인 ${att.establishThreshold}명 이상이 참석해야 합니다(${att.shortfall}명 부족).`;
  }
  return `의결 성립 · 재적 ${enrolled}명 중 ${present}명 참석 · 찬성 ${att.decisionThreshold}표 이상이면 가결`;
}

// ── 세리머니 진행 ─────────────────────────────────────────────

export type CeremonyItem = {
  key: string;
  /** 안 번호(예: 1-1-안1). 실제 투표 결과에서는 문항 번호. */
  label: string;
  title: string;
  yeas: number;
  /** 저장된 결과로 공개할 때만 — 반대 합계·그 투표의 재적/참석·차수. 없으면 세리머니 전체 값을 쓴다. */
  nays?: number;
  enrolled?: number;
  present?: number;
  round?: number;
};

/** 세리머니 항목 하나의 판정. 항목에 재적·참석이 박혀 있으면 그것을 쓴다. */
export function ceremonyVerdict(item: CeremonyItem, enrolled: number, present: number): Verdict {
  const e = item.enrolled ?? enrolled;
  const p = item.present ?? present;
  return item.nays === undefined ? decideMotion(e, p, item.yeas) : decideVote(e, p, item.yeas, item.nays);
}

export type CeremonyPhase = 'intro' | 'title' | 'bar' | 'line' | 'verdict' | 'summary';
export type CeremonyStep = { phase: CeremonyPhase; index: number };

export const CEREMONY_START: CeremonyStep = { phase: 'intro', index: 0 };

/** 「다음」 한 번 = 한 단계. 안마다 제목 → 막대 → 기준선 → 도장, 끝나면 요약판. */
export function advanceCeremony(step: CeremonyStep, total: number): CeremonyStep {
  switch (step.phase) {
    case 'intro':
      return total > 0 ? { phase: 'title', index: 0 } : { phase: 'summary', index: 0 };
    case 'title':
      return { phase: 'bar', index: step.index };
    case 'bar':
      return { phase: 'line', index: step.index };
    case 'line':
      return { phase: 'verdict', index: step.index };
    case 'verdict':
      return step.index + 1 < total ? { phase: 'title', index: step.index + 1 } : { phase: 'summary', index: step.index };
    default:
      return step;
  }
}

/** 「이전 안」 — 앞 안의 판정 화면으로. 첫 안이면 시작 화면. */
export function rewindCeremony(step: CeremonyStep, total: number): CeremonyStep {
  if (step.phase === 'intro') return step;
  if (step.phase === 'summary') return total > 0 ? { phase: 'verdict', index: total - 1 } : CEREMONY_START;
  return step.index > 0 ? { phase: 'verdict', index: step.index - 1 } : CEREMONY_START;
}

/** 단계별로 무엇이 보이는가 — 화면이 판단하지 않게 여기서 정한다. */
export function ceremonyReveal(phase: CeremonyPhase): { bar: boolean; line: boolean; stamp: boolean } {
  const order: CeremonyPhase[] = ['title', 'bar', 'line', 'verdict'];
  const at = order.indexOf(phase);
  return { bar: at >= 1, line: at >= 2, stamp: at >= 3 };
}

export type CeremonySummary = {
  passed: CeremonyItem[];
  failed: CeremonyItem[];
  invalid: CeremonyItem[];
};

export function summarizeCeremony(items: readonly CeremonyItem[], enrolled: number, present: number): CeremonySummary {
  const out: CeremonySummary = { passed: [], failed: [], invalid: [] };
  for (const item of items) {
    const v = ceremonyVerdict(item, enrolled, present);
    if (v.kind !== 'decided') out.invalid.push(item);
    else if (v.passed) out.passed.push(item);
    else out.failed.push(item);
  }
  return out;
}

/** 막대 길이·기준선 자리(0~1). 분모는 참석 M. */
export function barRatio(yeas: number, present: number): number {
  if (!(present > 0) || !(yeas >= 0)) return 0;
  return Math.min(yeas / present, 1);
}

export function thresholdRatio(threshold: number, present: number): number {
  if (!(present > 0)) return 0;
  return Math.min(threshold / present, 1);
}

// ── 결과 원천 ─────────────────────────────────────────────────

/** 연습 모드 가짜 찬성 수 — 참석의 절반~전원. 가결·부결이 섞여 나오게 둔다. rng 는 주입. */
export function fakeYeas(present: number, rng: () => number): number {
  if (!isCount(present) || present === 0) return 0;
  const low = Math.floor(present / 2);
  const span = present - low;
  const r = Math.min(Math.max(rng(), 0), 0.999999);
  return low + Math.floor(r * (span + 1));
}

export function practiceItems(motions: readonly Motion[], yeasById: Record<string, number>): CeremonyItem[] {
  return motions.map((motion) => ({
    key: motion.id,
    label: motion.id,
    title: motion.title,
    yeas: yeasById[motion.id] ?? 0,
  }));
}

/**
 * 실제 투표 결과 → 세리머니 항목. scale 2 는 값 1=반대·2=찬성(ballot-logic.ts scaleLabels).
 * 문장 앞의 안 번호는 떼어 라벨로 쓴다(motionStatement 의 역).
 */
export function ballotCeremonyItems(results: BallotResults): CeremonyItem[] {
  return [...results.items]
    .sort((a, b) => a.ordinal - b.ordinal)
    .map((item) => {
      const match = /^(\S+-안\d+)\s+(.*)$/s.exec(item.statement);
      return {
        key: item.id,
        label: match ? match[1] : `${item.ordinal}번`,
        title: match ? match[2] : item.statement,
        yeas: Number(item.dist?.['2'] ?? 0) || 0,
      };
    });
}
