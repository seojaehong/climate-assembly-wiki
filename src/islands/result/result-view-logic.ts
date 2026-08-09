/**
 * 공개 결과 페이지(/r/<token>) 순수 로직 — result_get RPC의 반환 body를 뷰모델로 변환한다.
 *
 * body 스키마는 supabase/migrations/platform_p2_analysis_review.sql 의
 *   · result_get(p_token)  → { scope, scope_id, title, published_at, body, hitl_notice } | null
 *   · result_publish(...)  가 적재하는 body:
 *       { scope, scope_id, title, hitl_notice, consensus_rule,
 *         issues[], reviewed_count, unclassified_count, generated_at }
 *     issue = { id, label, stance?, frequency_class?, summary?, review_status,
 *               topic_id, consensus_denominator, teams[] }
 * 와 1:1이다(손유지 타입 — 타입체커가 DB와의 일치를 검증하지 못하므로 스키마 변경 시 여기부터 맞출 것).
 *
 * ★ 설계 결정(합의 비율 분모): body.issues 는 archived_at is null 인 쟁점 전부(draft+reviewed)를 담는다.
 *   합의 비율 = 합의(consensus)로 분류된 쟁점 수 / 전체 쟁점 수(= issues.length). 이는 body가 제공하는
 *   유일한 집계 분모다. per-issue consensus_denominator 는 "이 쟁점 하나에 연결된 원문 군집 수"이므로
 *   합산하면 R2(멀티라벨 중복 계상)를 오히려 재현한다 → 집계 분모로 쓰지 않는다.
 * ★ body.issues 에는 review_status='draft'(미검수 AI 초안)도 섞인다. 게이트는 "reviewed ≥ 1"이지
 *   "전부 reviewed"가 아니다. 따라서 쟁점별 isReviewed 를 유지해 화면에서 검수 대기를 명시한다.
 */

export const STANCE_LABEL: Record<string, string> = {
  pro: '찬성',
  con: '반대',
  conditional: '조건부',
  concern: '우려',
  proposal: '대안·제안',
  neutral: '중립·불명',
};

export const FREQUENCY_LABEL: Record<string, string> = {
  consensus: '합의',
  majority: '다수의견',
  minority: '소수의견',
  mixed: '혼재',
};

export const SCOPE_LABEL: Record<string, string> = {
  topic: '주제',
  session: '세션',
  assembly: '전체 회의',
};

// ── 원시(raw) body 타입 — DB 반환을 방어적으로(전부 옵셔널) 받는다 ──

export type ResultIssueRaw = {
  id?: string;
  label?: string;
  stance?: string | null;
  frequency_class?: string | null;
  summary?: string | null;
  review_status?: string | null;
  topic_id?: string | null;
  consensus_denominator?: number | null;
  teams?: string[] | null;
};

export type ResultBody = {
  scope?: string | null;
  scope_id?: string | null;
  title?: string | null;
  hitl_notice?: string | null;
  consensus_rule?: string | null;
  issues?: ResultIssueRaw[] | null;
  reviewed_count?: number | null;
  unclassified_count?: number | null;
  generated_at?: string | null;
};

/** result_get 반환. 미공개/미존재면 RPC가 null을 반환한다. */
export type ResultGetResponse = {
  scope?: string | null;
  scope_id?: string | null;
  title?: string | null;
  published_at?: string | null;
  body?: ResultBody | null;
  hitl_notice?: string | null;
} | null;

// ── 뷰모델 ──

export type ViewIssue = {
  id: string;
  label: string;
  stance: string | null;
  stanceLabel: string | null;
  frequency: string | null;
  frequencyLabel: string | null;
  summary: string | null;
  teams: string[];
  teamCount: number;
  consensusDenominator: number | null;
  isConsensus: boolean;
  isReviewed: boolean;
};

export type ResultMatrix = {
  teams: string[];
  rows: Array<{ issue: ViewIssue; cells: boolean[] }>;
};

export type ResultStats = {
  issueCount: number;
  consensusCount: number;
  furtherCount: number;
  /** 0..1. issueCount=0이면 0. */
  consensusRatio: number;
  reviewedCount: number;
  unclassifiedCount: number;
  participatingTeams: number;
};

export type ResultView = {
  title: string;
  scope: string;
  scopeLabel: string;
  publishedAt: string | null;
  generatedAt: string | null;
  hitlNotice: string;
  consensusRule: string;
  issues: ViewIssue[];
  ranking: ViewIssue[];
  matrix: ResultMatrix;
  stats: ResultStats;
};

// HITL 고정 카피(스키마 body에도 실리지만, 누락 대비 폴백 상수로 보관한다).
export const HITL_NOTICE_FALLBACK =
  'AI는 초안을 만들고, 공개 여부와 최종 표현은 운영진이 결정합니다.';
export const HITL_RATIO_NOTICE =
  '합의 비율은 결정 그 자체가 아니라 판단을 돕는 근거입니다.';
export const CONSENSUS_RULE_FALLBACK =
  '합의도 분모 = 연결 원문의 cluster 기준(cluster_id 있으면 cluster, 없으면 distinct item). gongron R2 분모 팽창 보정.';

/**
 * URL 경로에서 토큰을 뽑는다. `/r/<token>`·`/r/<token>/`·`/r/`·`/r` 을 모두 방어.
 * 'r' 세그먼트 다음 세그먼트가 토큰. 없으면 null.
 */
export function tokenFromPath(pathname: string | null | undefined): string | null {
  if (!pathname) return null;
  const segs = pathname.split('/').filter((s) => s.length > 0);
  const rIdx = segs.indexOf('r');
  if (rIdx === -1) return null;
  const token = segs[rIdx + 1];
  return token && token.length > 0 ? token : null;
}

function normStance(stance: string | null | undefined): string | null {
  const s = (stance ?? '').trim();
  return s.length > 0 ? s : null;
}

function normFrequency(freq: string | null | undefined): string | null {
  const f = (freq ?? '').trim();
  return f.length > 0 ? f : null;
}

/** 쟁점 원시 데이터 → 뷰 쟁점. label 없으면 '(제목 없음)' 폴백. */
export function toViewIssue(raw: ResultIssueRaw): ViewIssue {
  const teams = Array.isArray(raw.teams)
    ? raw.teams.filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
    : [];
  const stance = normStance(raw.stance);
  const frequency = normFrequency(raw.frequency_class);
  const denom =
    typeof raw.consensus_denominator === 'number' && Number.isFinite(raw.consensus_denominator)
      ? raw.consensus_denominator
      : null;
  return {
    id: raw.id ?? '',
    label: (raw.label ?? '').trim() || '(제목 없음)',
    stance,
    stanceLabel: stance ? STANCE_LABEL[stance] ?? stance : null,
    frequency,
    frequencyLabel: frequency ? FREQUENCY_LABEL[frequency] ?? frequency : null,
    summary: (raw.summary ?? '').trim() || null,
    teams,
    teamCount: teams.length,
    consensusDenominator: denom,
    isConsensus: frequency === 'consensus',
    isReviewed: (raw.review_status ?? '') === 'reviewed',
  };
}

/**
 * 조×쟁점 커버리지 매트릭스. 세로=쟁점, 가로=조(전 쟁점 teams의 합집합, 분과·조 표준순 정렬).
 * cell = 해당 조가 이 쟁점을 제기했는가(issue.teams 포함 여부).
 */
export function buildMatrix(issues: ViewIssue[]): ResultMatrix {
  const teamSet = new Set<string>();
  for (const issue of issues) for (const t of issue.teams) teamSet.add(t);
  const teams = sortTeams([...teamSet]);
  const rows = issues.map((issue) => {
    const raised = new Set(issue.teams);
    return { issue, cells: teams.map((t) => raised.has(t)) };
  });
  return { teams, rows };
}

/** 조 이름을 분과·조 번호(숫자) 순으로. 파싱 실패분은 원문 사전순으로 뒤에 붙인다. */
export function sortTeams(names: string[]): string[] {
  const key = (name: string): [number, number, number] => {
    const sub = /(\d+)\s*분과/.exec(name);
    const jo = /(\d+)\s*조/.exec(name);
    return [
      sub ? Number.parseInt(sub[1], 10) : Number.MAX_SAFE_INTEGER,
      jo ? Number.parseInt(jo[1], 10) : Number.MAX_SAFE_INTEGER,
      0,
    ];
  };
  return [...names].sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    if (ka[0] !== kb[0]) return ka[0] - kb[0];
    if (ka[1] !== kb[1]) return ka[1] - kb[1];
    return a.localeCompare(b, 'ko');
  });
}

/** 쟁점 랭킹 — 제기 조 수 내림차순(동수면 분모 큰 것, 그다음 label 사전순). */
export function rankIssues(issues: ViewIssue[]): ViewIssue[] {
  return [...issues].sort((a, b) => {
    if (b.teamCount !== a.teamCount) return b.teamCount - a.teamCount;
    const da = a.consensusDenominator ?? 0;
    const db = b.consensusDenominator ?? 0;
    if (db !== da) return db - da;
    return a.label.localeCompare(b.label, 'ko');
  });
}

/**
 * result_get 반환 → 뷰모델. 미공개/미존재(null)면 null.
 * body나 issues가 비어도 유효한(빈) 뷰를 만든다(방어적) — 통계는 0으로.
 */
export function buildResultView(res: ResultGetResponse): ResultView | null {
  if (!res) return null;
  const body = res.body ?? {};
  const rawIssues = Array.isArray(body.issues) ? body.issues : [];
  const issues = rawIssues.map(toViewIssue);

  const issueCount = issues.length;
  const consensusCount = issues.filter((i) => i.isConsensus).length;
  const furtherCount = issueCount - consensusCount;
  const consensusRatio = issueCount > 0 ? consensusCount / issueCount : 0;

  const teamSet = new Set<string>();
  for (const issue of issues) for (const t of issue.teams) teamSet.add(t);

  const scope = (res.scope ?? body.scope ?? '').trim();

  return {
    title: (res.title ?? body.title ?? '').trim() || '숙의 결과',
    scope,
    scopeLabel: SCOPE_LABEL[scope] ?? scope ?? '',
    publishedAt: res.published_at ?? null,
    generatedAt: body.generated_at ?? null,
    hitlNotice: (res.hitl_notice ?? body.hitl_notice ?? '').trim() || HITL_NOTICE_FALLBACK,
    consensusRule: (body.consensus_rule ?? '').trim() || CONSENSUS_RULE_FALLBACK,
    issues,
    ranking: rankIssues(issues),
    matrix: buildMatrix(issues),
    stats: {
      issueCount,
      consensusCount,
      furtherCount,
      consensusRatio,
      reviewedCount:
        typeof body.reviewed_count === 'number'
          ? body.reviewed_count
          : issues.filter((i) => i.isReviewed).length,
      unclassifiedCount: typeof body.unclassified_count === 'number' ? body.unclassified_count : 0,
      participatingTeams: teamSet.size,
    },
  };
}

/** 합의 비율을 정수 %로. */
export function ratioToPercent(ratio: number): number {
  return Math.round(ratio * 100);
}
