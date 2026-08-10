// 공론화 플랫폼 — 순수 네비게이션 로직 (React·Supabase 의존 없음, vitest 대상)
//
// 대전제(BUILD_SPEC §0): "메뉴 연결이 아니라 데이터 연결." 좌측 트리·브레드크럼·라우트는
// 전부 도메인 FK 트리(org → assembly → session → topic)를 그대로 반영한다. 이 모듈은
// 그 트리를 URL 경로와 왕복 변환하고(파싱·생성), 트리를 평탄화하며(렌더용), 활성 경로를
// 판정한다(브레드크럼). 화면 로직·데이터 페치는 여기 들어오지 않는다.
//
// ── URL 스코프 사다리 (o/c/f/s/t/view) — 스펙 미결정에 대한 결정 ──
// BUILD_SPEC §4-1의 경로는 `o/c/f/s/t`(스코프 5단) + view 인데, 도메인 트리는
// org→assembly→session→topic(4단)뿐이라 한 단이 남는다. 두 독법이 있다:
//   (A) f=회차(session), s=미실현       → §4-1 라벨 "f/<forum> 회차"에 부합
//   (B) s=회차(session), f=미실현/예약  → §4-1이 최심 경로를 문자 그대로
//        `.../s/<session>/t/<topic>` 로 적은 것에 부합
// 판별자: 우리가 만드는 topic URL이 §4-1의 리터럴 부분문자열 `.../s/<session>/t/<topic>`
// 를 재현하려면 s=session 이어야 한다 → (B) 채택. f 는 예약(미실현) 단으로 두고,
// 파서는 없는 단을 허용(tolerant)해 f 가 그냥 나타나지 않게 한다.
//   o=org · c=assembly(공론화) · f=예약 · s=session(회차) · t=discussion_topic(주제)
// 이 결정은 데이터 경로에 영향이 없고(트리는 4단 그대로), 병합 시 재확인 대상(미결).

/** 스코프 키 사다리 — 위계 순서. 파서·브레드크럼이 이 순서에 의존한다. */
export const SCOPE_KEYS = ['o', 'c', 'f', 's', 't'] as const;
export type ScopeKey = (typeof SCOPE_KEYS)[number];

/** 스코프별 뷰(아웃렛). 라우트 말미의 단일 세그먼트. */
export const VIEWS = ['design', 'record', 'vote', 'analyze', 'review', 'publish'] as const;
export type ViewName = (typeof VIEWS)[number];

/** 공개 게이트·검수를 여는 스코프 레벨(가장 깊은 선택). */
export type ScopeLevel = 'topic' | 'session' | 'assembly';

/**
 * 레벨 → 가능한 뷰 — **유일한 원천**. 좌측 트리·개요 카드·상단 탭이 전부 이 표를 읽는다
 * (하드코딩 메뉴 금지 대전제의 구체화). 후속 슬라이스는 여기만 고치면 화면 전체가 따라온다.
 *   topic  : 산출물·분석·검수·공개
 *   session: 산출물·회차투표·분석·공개(검수는 주제 스코프)
 *   assembly: 분석·공개(집계 스코프)
 */
export const VIEWS_FOR_LEVEL: Record<ScopeLevel, readonly ViewName[]> = {
  topic: ['record', 'analyze', 'review', 'publish'],
  session: ['design', 'record', 'vote', 'analyze', 'publish'],
  assembly: ['design', 'analyze', 'publish'],
};

/** 라우트 기저 접두사 — 정적 wiki와 네임스페이스 분리(BUILD_SPEC §4-3). */
export const PLATFORM_BASE = '/platform';

/** URL 경로에서 파싱한(또는 노드에서 만든) 스코프. 얕은 map + 선택적 view. */
export type Scope = Partial<Record<ScopeKey, string>> & { view?: ViewName };

/** 도메인 트리 노드의 종류 — DB 위계와 1:1. */
export type TreeNodeKind = 'org' | 'assembly' | 'session' | 'topic';

/** kind → 스코프 키. f(예약)는 현재 트리가 방출하지 않는다. */
export const KIND_TO_KEY: Record<TreeNodeKind, ScopeKey> = {
  org: 'o',
  assembly: 'c',
  session: 's',
  topic: 't',
};

/** orgTree()가 만드는 재귀 트리 노드. label 은 화면 표시용(prompt·title·slug 등 무엇이든). */
export interface TreeNode {
  kind: TreeNodeKind;
  /** DB 식별자 — slug 또는 uuid. 파서는 불투명 문자열로만 다룬다(discussion_topic엔 slug 없음). */
  id: string;
  /** Canonical database UUID used by RPCs when the route id is a human-readable slug. */
  dataId?: string;
  label: string;
  children: TreeNode[];
}

/** 평탄화 결과 — 좌측 트리를 depth 들여쓰기로 렌더하고, 클릭 시 scope 로 이동한다. */
export interface FlatNode {
  node: TreeNode;
  depth: number;
  /** 이 노드까지 도달하는 누적 스코프(조상 선택 포함). buildScopePath 에 그대로 넣는다. */
  scope: Scope;
}

function isScopeKey(seg: string): seg is ScopeKey {
  return (SCOPE_KEYS as readonly string[]).includes(seg);
}

export function isView(seg: string): seg is ViewName {
  return (VIEWS as readonly string[]).includes(seg);
}

/**
 * URL 경로 → 스코프. 기저 접두사(/platform)와 슬래시를 흡수하고, `key/id` 쌍을
 * 사다리 순서대로 읽는다. 없는 단은 그냥 건너뛴다(tolerant — f 예약 단 대응).
 * 말미의 view 세그먼트(record|vote|…)는 view 로 잡는다. 알 수 없는 세그먼트는 무시.
 */
export function parseScopePath(pathname: string): Scope {
  const raw = pathname.split('?')[0].split('#')[0];
  let segs = raw.split('/').filter(Boolean);
  // /platform 접두사 제거(있으면)
  if (segs[0] === 'platform') segs = segs.slice(1);

  const scope: Scope = {};
  let i = 0;
  while (i < segs.length) {
    const seg = segs[i];
    if (isScopeKey(seg) && i + 1 < segs.length) {
      scope[seg] = segs[i + 1];
      i += 2;
      continue;
    }
    if (isView(seg)) {
      scope.view = seg;
      i += 1;
      continue;
    }
    // 알 수 없는 세그먼트(키인데 뒤에 id 없음 등) — 무시하고 전진
    i += 1;
  }
  return scope;
}

/**
 * 스코프 → URL 경로. 사다리 순서대로 존재하는 `key/id` 만 이어 붙이고, view 가 있으면
 * 말미에 붙인다. parseScopePath 의 역(round-trip): parse(build(s)) === s(정규화).
 */
export function buildScopePath(scope: Scope): string {
  const parts: string[] = [];
  for (const key of SCOPE_KEYS) {
    const id = scope[key];
    if (id) parts.push(key, id);
  }
  if (scope.view) parts.push(scope.view);
  return parts.length ? `${PLATFORM_BASE}/${parts.join('/')}` : PLATFORM_BASE;
}

/**
 * 트리 평탄화 — 전위 순회로 depth 와 누적 scope 를 실어 준다.
 * 좌측 네비는 이 배열을 그대로 렌더(하드코딩 메뉴 아님)하고, 클릭 시 scope 로 이동한다.
 */
export function flattenTree(tree: TreeNode | null): FlatNode[] {
  const out: FlatNode[] = [];
  const walk = (node: TreeNode, depth: number, parentScope: Scope) => {
    const scope: Scope = { ...parentScope, [KIND_TO_KEY[node.kind]]: node.id };
    out.push({ node, depth, scope });
    for (const child of node.children) walk(child, depth + 1, scope);
  };
  if (tree) walk(tree, 0, {});
  return out;
}

/** 이 노드가 현재 스코프의 활성 경로 위에 있는가(그 단의 선택이 이 노드인가). */
export function isNodeOnPath(node: TreeNode, scope: Scope): boolean {
  return scope[KIND_TO_KEY[node.kind]] === node.id;
}

/**
 * 현재 스코프가 가리키는 트리 경로(루트→선택 리프)를 노드 배열로 반환.
 * 브레드크럼(=데이터 경로)의 원천. 루트(org)부터 시작해 scope 가 고르는 자식으로 하강한다.
 */
export function activePath(tree: TreeNode | null, scope: Scope): TreeNode[] {
  const path: TreeNode[] = [];
  let node: TreeNode | undefined = tree ?? undefined;
  while (node) {
    path.push(node);
    node = node.children.find((c) => isNodeOnPath(c, scope));
  }
  return path;
}

export interface Crumb {
  key: ScopeKey;
  id: string;
  label: string;
  kind: TreeNodeKind;
  /** 이 크럼까지의 스코프(클릭 시 상위로 좁히기). */
  scope: Scope;
}

/** 브레드크럼 — activePath 를 스코프·라벨을 실은 크럼 배열로. view 는 크럼에 넣지 않는다. */
export function breadcrumb(tree: TreeNode | null, scope: Scope): Crumb[] {
  const crumbs: Crumb[] = [];
  let acc: Scope = {};
  for (const node of activePath(tree, scope)) {
    const key = KIND_TO_KEY[node.kind];
    acc = { ...acc, [key]: node.id };
    crumbs.push({ key, id: node.id, label: node.label, kind: node.kind, scope: acc });
  }
  return crumbs;
}

/**
 * 스코프의 가장 깊은 선택 = 어떤 도메인 레벨(topic|session|assembly)인지 판정.
 * t → topic, s → session, c → assembly. 그 위(org만)면 null.
 * 공개 RPC(result_publish 의 scope 인자)와 뷰 탭이 공유한다.
 */
export function deepestScopeLevel(scope: Scope): { level: ScopeLevel | null; id: string | null } {
  if (scope.t) return { level: 'topic', id: scope.t };
  if (scope.s) return { level: 'session', id: scope.s };
  if (scope.c) return { level: 'assembly', id: scope.c };
  return { level: null, id: null };
}

/** Resolves the selected route node to the canonical database id required by scoped RPCs. */
export function deepestDataScopeTarget(
  tree: TreeNode | null,
  scope: Scope,
): { level: ScopeLevel | null; id: string | null } {
  const { level } = deepestScopeLevel(scope);
  if (!level) return { level: null, id: null };

  const expectedKind: TreeNodeKind = level === 'assembly' ? 'assembly' : level;
  const node = activePath(tree, scope).find((candidate) => candidate.kind === expectedKind);
  return { level, id: node?.dataId ?? null };
}

export interface TopicTarget {
  id: string;
  label: string;
}

export interface SessionTarget {
  id: string;
  label: string;
}

/** Resolves topic RPC targets for the selected topic or session scope. */
export function topicTargetsForScope(tree: TreeNode | null, scope: Scope): TopicTarget[] {
  const { level } = deepestScopeLevel(scope);
  const path = activePath(tree, scope);
  if (level === 'topic') {
    const topic = path.find((node) => node.kind === 'topic');
    return topic ? [{ id: topic.dataId ?? topic.id, label: topic.label }] : [];
  }
  if (level === 'session') {
    const session = path.find((node) => node.kind === 'session');
    return (session?.children ?? [])
      .filter((node) => node.kind === 'topic')
      .map((node) => ({ id: node.dataId ?? node.id, label: node.label }));
  }
  return [];
}

/** Resolves readiness RPC targets for the selected session or assembly scope. */
export function sessionTargetsForScope(tree: TreeNode | null, scope: Scope): SessionTarget[] {
  const { level } = deepestScopeLevel(scope);
  const path = activePath(tree, scope);
  if (level === 'session') {
    const session = path.find((node) => node.kind === 'session');
    return session ? [{ id: session.dataId ?? session.id, label: session.label }] : [];
  }
  if (level === 'assembly') {
    const assembly = path.find((node) => node.kind === 'assembly');
    return (assembly?.children ?? [])
      .filter((node) => node.kind === 'session')
      .map((node) => ({ id: node.dataId ?? node.id, label: node.label }));
  }
  return [];
}
