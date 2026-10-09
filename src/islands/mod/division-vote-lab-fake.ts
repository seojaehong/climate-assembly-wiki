/**
 * 10/17 의결 미리보기(division-vote-lab) 전용 — 메모리 안 가짜 투표 서버와 운영팀 현황판 시연 상태.
 *
 * 서버로 나가는 요청이 없다. 실제 RPC 의 규칙 중 화면에 영향을 주는 둘만 흉내 낸다:
 *   - 같은 멱등키로 다시 만들면 같은 투표를 돌려준다
 *   - 상태는 draft → open → closed 로만 간다(같은 상태 요청은 그대로 성공)
 * 문장·수는 전부 지어낸 것이다.
 */
import type { BallotCreateInput, BallotListRow, BallotResults, BallotStatus } from '../../lib/deliberation';
import type { DivisionBallotApi } from './DivisionVotePanel';
import { DIVISION_VOTE_FIXTURE } from './division-vote-fixture';
import { applyBallotResults, beginVote, markBallotCreated, markBallotOpened, markMinority, setHandCount } from './division-vote-flow';
import { createMotion, initPrepState, setCardStatus, setGridMark, updateMotion, type PrepState, type RecsDivision } from './division-vote-logic';

type FakeBallot = {
  id: string;
  token: string;
  title: string;
  subgroup: string | null;
  statements: string[];
  status: BallotStatus;
  openedAtMs: number | null;
  createdAt: string;
};

const ORDER: Record<BallotStatus, number> = { draft: 0, open: 1, closed: 2, published: 3, archived: 4 };

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** voters = 가짜 제출 인원 상한. now 는 시험에서 주입. */
export function createFakeBallotApi(opts: { voters?: number; now?: () => number } = {}): DivisionBallotApi {
  const voters = opts.voters ?? 40;
  const now = opts.now ?? (() => Date.now());
  const byKey = new Map<string, FakeBallot>();
  const byId = new Map<string, FakeBallot>();
  let n = 0;

  const responses = (b: FakeBallot) => {
    if (b.status === 'draft' || b.openedAtMs === null) return 0;
    const live = Math.floor(((now() - b.openedAtMs) / 1000) * 2);
    return Math.min(voters, Math.max(0, live));
  };

  return {
    async create(input: BallotCreateInput, key: string) {
      const prior = byKey.get(key);
      if (prior) return { id: prior.id, token: prior.token };
      n += 1;
      const b: FakeBallot = {
        id: `lab-ballot-${n}`,
        token: `lab-token-${n}-${hash(key).toString(16)}`,
        title: input.title,
        subgroup: input.subgroup ?? null,
        statements: input.items.map((it) => it.statement),
        status: 'draft',
        openedAtMs: null,
        createdAt: new Date(now()).toISOString(),
      };
      byKey.set(key, b);
      byId.set(b.id, b);
      return { id: b.id, token: b.token };
    },
    async setStatus(id, status) {
      const b = byId.get(id);
      if (!b) throw new Error('ballot not in authorization scope');
      if (b.status === status) return { id, status };
      if (ORDER[status] <= ORDER[b.status]) throw new Error('invalid ballot transition');
      b.status = status;
      if (status === 'open') b.openedAtMs = now();
      return { id, status };
    },
    async statusOf(id) {
      return byId.get(id)?.status ?? null;
    },
    async list(): Promise<BallotListRow[]> {
      return [...byId.values()].map((b) => ({
        id: b.id,
        title: b.title,
        status: b.status,
        token: b.token,
        subgroup: b.subgroup,
        item_count: b.statements.length,
        response_count: responses(b),
        created_at: b.createdAt,
      }));
    },
    async results(token): Promise<BallotResults | null> {
      const b = [...byId.values()].find((x) => x.token === token);
      if (!b) return null;
      const total = Math.max(responses(b), Math.floor(voters * 0.9));
      return {
        id: b.id,
        title: b.title,
        status: b.status,
        subgroup: b.subgroup,
        responses: total,
        items: b.statements.map((statement, i) => {
          // 문장마다 다르게 — 가결·부결이 섞여 나오게.
          const yes = Math.round(total * (0.55 + (hash(`${token}:${i}`) % 45) / 100));
          const y = Math.min(total, yes);
          return { id: `${b.id}-i${i + 1}`, ordinal: i + 1, statement, scale: 2, n: total, avg: null, dist: { '1': total - y, '2': y } };
        }),
      };
    },
  };
}

/** 미리보기 전용 1분과 가상 원천(운영팀 현황판이 세 칸을 채우도록). */
export const LAB_DIVISION_1: RecsDivision = {
  division: 1,
  agenda: '예시 의제 — 가상 데이터',
  topics: [
    {
      no: '1-1',
      name: '예시 주제 마',
      written_by: '1조',
      raised_by: '1조 2조',
      cards: [
        { no: '1-1-1', title: '예시 제목 마-1 건물 에너지 진단', background: '• 예시', recs: [{ no: '1-1-1-1', text: '예시 권고입니다.' }], effect: '• 예시', schedule: '• 단기' },
        { no: '1-1-2', title: '예시 제목 마-2 공공건물 태양광', background: '• 예시', recs: [{ no: '1-1-2-1', text: '예시 권고입니다.' }], effect: '• 예시', schedule: '• 중기' },
      ],
    },
    {
      no: '1-2',
      name: '예시 주제 바',
      written_by: '2조',
      raised_by: '2조',
      cards: [
        { no: '1-2-1', title: '예시 제목 바-1 시민 에너지 협동조합', background: '• 예시', recs: [{ no: '1-2-1-1', text: '예시 권고입니다.' }], effect: '• 예시', schedule: '• 장기' },
        { no: '1-2-2', title: '예시 제목 바-2 이미 시행 중인 사업', background: '• 예시', recs: [{ no: '1-2-2-1', text: '예시 권고입니다.' }], effect: '• 예시', schedule: '• 단기' },
      ],
    },
  ],
};

export const LAB_OPS_SOURCES: RecsDivision[] = [LAB_DIVISION_1, ...DIVISION_VOTE_FIXTURE];

function mk(s: PrepState, cardNos: string[], title: string): PrepState {
  const r = createMotion(s, { cardNos, title, text: '' });
  if (!r.ok) throw new Error(r.error);
  return r.state;
}

function voted(s: PrepState, ids: string[], key: string, counts: [number, number][], openedAt: string, close: boolean): PrepState {
  const b = beginVote(s, ids, key);
  if (!b.ok) throw new Error(b.error);
  let x = markBallotOpened(markBallotCreated(b.state, key, { id: `lab-demo-${key}`, token: `lab-demo-token-${key}` }), key, openedAt);
  if (!close) return x;
  const rec = x.ballots[key];
  const r = applyBallotResults(
    x,
    key,
    {
      id: rec.ballotId as string,
      title: rec.title,
      status: 'closed',
      subgroup: rec.subgroup,
      responses: 40,
      items: rec.statements.map((statement, i) => ({ id: `d${i}`, ordinal: i + 1, statement, scale: 2, n: 40, avg: null, dist: { '1': counts[i][1], '2': counts[i][0] } })),
    },
    openedAt,
  );
  if (!r.ok) throw new Error(r.error);
  x = r.state;
  return x;
}

/** 운영팀 현황판 시연 — 1분과 진행 중, 2분과 참석 미입력, 3분과 소수 의견. */
export function labOpsStates(nowMs: number): Record<number, PrepState> {
  const ago = (min: number) => new Date(nowMs - min * 60_000).toISOString();
  const [d2, d3] = DIVISION_VOTE_FIXTURE;

  let s1 = initPrepState(LAB_DIVISION_1);
  s1 = { ...s1, attendance: { enrolled: 60, present: 48 } };
  s1 = mk(s1, ['1-1-1', '1-1-2'], '건물 에너지 진단과 공공건물 태양광 확대');
  s1 = mk(s1, ['1-2-1'], '시민 에너지 협동조합 지원');
  s1 = mk(s1, ['1-2-2'], '이미 시행 중인 사업');
  s1 = setCardStatus(s1, '1-2-2', { status: 'excluded' });
  s1 = voted(s1, ['1-1-안1'], 'a1', [[38, 6]], ago(14), true);
  s1 = setHandCount(s1, '1-1-안1', 1, { handYes: 2 });
  for (const team of ['1', '2', '3', '4'] as const) s1 = setGridMark(s1, '1-1-안1', team, 'effectiveness', 'met');
  s1 = setGridMark(s1, '1-1-안1', '5', 'effectiveness', 'unmet');
  s1 = setGridMark(s1, '1-1-안1', '1', 'equity', 'met');
  s1 = setGridMark(s1, '1-1-안1', '2', 'equity', 'unmet');
  s1 = voted(s1, ['1-2-안1'], 'a2', [[0, 0]], ago(3), false);

  let s2 = initPrepState(d2);
  s2 = mk(s2, ['2-1-1', '2-1-2'], '다회용기 보급과 회수 체계');
  s2 = mk(s2, ['2-1-3'], '보증금 제도 정비');
  s2 = mk(s2, ['2-4-1'], '지역 순환센터 설치');

  let s3 = initPrepState(d3);
  s3 = { ...s3, attendance: { enrolled: 58, present: 41 } };
  s3 = mk(s3, ['3-1-1'], '기후교육 확대');
  s3 = voted(s3, ['3-1-안1'], 'c1', [[20, 19]], ago(25), true);
  s3 = updateMotion(s3, '3-1-안1', { minorityOpinion: '예시 소수 의견 — 학교 밖 교육을 먼저 하자는 의견' });
  const m = markMinority(s3, '3-1-안1');
  if (m.ok) s3 = m.state;

  return { 1: s1, 2: s2, 3: s3 };
}
