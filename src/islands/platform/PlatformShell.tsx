// 공론화 SaaS 플랫폼 — 앱 셸 (BUILD_SPEC §4-2)
//
// 좌: 데이터 트리 네비(orgTree 결과를 재귀 렌더 — 하드코딩 메뉴 아님).
// 상: 브레드크럼(=데이터 경로). 우: 스코프 콘텐츠 아웃렛.
// 노드 선택 = 스코프 좁히기. URL = 데이터 경로(o/c/f/s/t/view).
//
// 미로그인 → 로그인 카드. 로그인 → 셸. Auth 미설정 DB 에서도 마운트는 통과하고,
// 런타임 실패는 전부 notice 문구로 흡수한다(예외를 화면 밖으로 던지지 않는다).
// 색·타이포는 /mod 콘솔 톤 준용.

import { useEffect, useRef, useState, useCallback } from 'react';
import {
  parseScopePath,
  buildScopePath,
  flattenTree,
  breadcrumb,
  isNodeOnPath,
  deepestViewScopeLevel,
  deepestDataScopeTarget,
  topicTargetsForScope,
  sessionTargetsForScope,
  sessionTopicGroupsForScope,
  scopePathContext,
  scopeWithValidView,
  VIEWS_FOR_LEVEL,
  type Scope,
  type TreeNode,
} from './platform-nav-logic';
import {
  getSession,
  onAuthChange,
  platformSignIn,
  signOut,
  myOrgs,
  orgTree,
  selectOrg,
  type AuthSessionInfo,
  type OrgRef,
  type PlatformResult,
} from '../../lib/platform';
import ScopeOutlet from './ScopeViews';
import { HQ_ACTOR_KEY, HQ_TOKEN_KEY } from '../mod/hq-gate-logic';
import { PLATFORM_ORG_CONTEXT_KEY, storePlatformOrgContextToken } from '../../lib/supabase';

const NAVY = '#1F4E79';
export const PLATFORM_ACCENT = '#135C73';
export const PLATFORM_CONTROL_BORDER = '#6B7D88';
const TEAL = PLATFORM_ACCENT;
const INK = '#1F2933';
const MUTED = '#5A6B73';
const LINE = '#DCE7EE';
const BG = '#F5F8FB';
const PANEL = '#F1F7FA';
const ACCESSIBILITY_LINK_STYLE: React.CSSProperties = {
  display: 'inline-flex',
  minHeight: 24,
  alignItems: 'center',
  color: PLATFORM_ACCENT,
  fontWeight: 700,
  textDecoration: 'underline',
  textUnderlineOffset: 3,
};

export interface PlatformOperationLock {
  current: boolean;
}

export interface PlatformSessionStorage {
  removeItem(key: string): void;
}

/** Clears legacy HQ credentials when the authenticated platform user signs out. */
export function clearPlatformSessionCredentials(
  storage: PlatformSessionStorage | null | undefined,
  onError: (error: unknown) => void,
): boolean {
  if (!storage) return true;
  try {
    storage.removeItem(HQ_TOKEN_KEY);
    storage.removeItem(HQ_ACTOR_KEY);
    storage.removeItem(PLATFORM_ORG_CONTEXT_KEY);
    return true;
  } catch (error: unknown) {
    onError(error);
    return false;
  }
}

/** Acquires a synchronous lock before the first await so one platform action cannot be submitted twice. */
export async function runExclusivePlatformOperation(
  lock: PlatformOperationLock,
  action: () => Promise<void>,
  onBusyChange: (busy: boolean) => void,
): Promise<boolean> {
  if (lock.current) return false;
  lock.current = true;
  onBusyChange(true);
  try {
    await action();
    return true;
  } finally {
    lock.current = false;
    onBusyChange(false);
  }
}

function currentScope(): Scope {
  if (typeof window === 'undefined') return {};
  return parseScopePath(window.location.pathname);
}

/** Applies only the latest session read so an older auth response cannot replace a newer state. */
export async function completeAuthSessionLoad(
  action: () => Promise<PlatformResult<AuthSessionInfo | null>>,
  isCurrent: () => boolean,
  onSession: (session: AuthSessionInfo | null) => void,
  onNotice: (notice: string | null) => void,
): Promise<void> {
  try {
    const result = await action();
    if (!isCurrent()) return;
    if (result.notice) {
      onSession(null);
      onNotice(result.notice);
      return;
    }
    onSession(result.data ?? null);
    onNotice(null);
  } catch (error: unknown) {
    if (!isCurrent()) return;
    console.error('Failed to load platform auth session', error);
    onSession(null);
    onNotice('인증 세션을 확인하는 중 예상하지 못한 오류가 발생했습니다.');
  }
}

export default function PlatformShell() {
  // undefined = 확인 중, null = 미로그인, 값 = 로그인됨
  const [session, setSession] = useState<AuthSessionInfo | null | undefined>(undefined);
  const [authNotice, setAuthNotice] = useState<string | null>(null);
  const [scope, setScope] = useState<Scope>({});
  const authGeneration = useRef(0);
  const signOutBoundaryNotice = useRef<string | null>(null);

  // 세션 확인 + 변화 구독. 마운트 시 현재 URL 로 스코프 초기화.
  useEffect(() => {
    setScope(currentScope());
    const refreshSession = () => {
      const generation = authGeneration.current + 1;
      authGeneration.current = generation;
      void completeAuthSessionLoad(
        getSession,
        () => authGeneration.current === generation,
        (nextSession) => {
          if (nextSession) signOutBoundaryNotice.current = null;
          setSession(nextSession);
        },
        (notice) => setAuthNotice(notice ?? signOutBoundaryNotice.current),
      );
    };
    refreshSession();
    const off = onAuthChange(refreshSession);
    const onPop = () => setScope(currentScope());
    window.addEventListener('popstate', onPop);
    return () => {
      authGeneration.current += 1;
      off();
      window.removeEventListener('popstate', onPop);
    };
  }, []);

  // 클라이언트 라우팅 — pushState 로 데이터 경로 이동, 셸 재렌더.
  const navigate = useCallback((next: Scope) => {
    const url = buildScopePath(next);
    if (typeof window !== 'undefined') window.history.pushState({}, '', url);
    setScope(next);
  }, []);

  if (session === undefined) {
    return <Centered><p role="status" aria-live="polite" style={{ color: MUTED, fontSize: 16 }}>불러오는 중…</p></Centered>;
  }
  if (session === null) {
    return <LoginCard notice={authNotice} onSignedIn={(s) => {
      authGeneration.current += 1;
      signOutBoundaryNotice.current = null;
      setSession(s);
      setAuthNotice(null);
    }} />;
  }
  return (
    <AppShell
      key={session.userId}
      session={session}
      scope={scope}
      navigate={navigate}
      onSignedOut={(notice) => {
        authGeneration.current += 1;
        signOutBoundaryNotice.current = notice;
        setSession(null);
        setAuthNotice(notice);
        navigate({});
      }}
    />
  );
}

// ── 로그인 카드 ─────────────────────────────────────────────────────────

export function LoginCard({ notice, onSignedIn }: { notice: string | null; onSignedIn: (s: AuthSessionInfo) => void }) {
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const operationLock = useRef(false);

  const submit = async (event: React.SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!email.trim() || !pw || busy || operationLock.current) return;
    await runExclusivePlatformOperation(operationLock, async () => {
      setErr(null);
      try {
        const r = await platformSignIn(email.trim(), pw);
        if (r.data) onSignedIn(r.data);
        else setErr(r.notice ?? '로그인에 실패했습니다.');
      } catch (error: unknown) {
        console.error('Failed to sign in', error);
        setErr('로그인 중 예상하지 못한 오류가 발생했습니다.');
      }
    }, setBusy);
  };

  const field: React.CSSProperties = {
    width: '100%', boxSizing: 'border-box', height: 52, padding: '0 16px', fontSize: 16,
    border: `2px solid ${PLATFORM_CONTROL_BORDER}`, borderRadius: 12, marginBottom: 12, color: INK,
  };

  return (
    <Centered>
      <form
        id="platform-scope-content"
        tabIndex={-1}
        aria-label="운영진 로그인"
        aria-busy={busy}
        onSubmit={submit}
        style={{ width: '100%', maxWidth: 420, background: '#fff', border: `2px solid ${LINE}`, borderRadius: 24, padding: '40px 32px', boxShadow: '0 8px 24px -16px rgba(31,78,121,.18)' }}
      >
        <div style={{ width: 48, height: 48, borderRadius: 16, background: TEAL, display: 'grid', placeItems: 'center', color: '#fff', fontWeight: 800, fontSize: 24, margin: '0 auto 20px' }}>P</div>
        <div style={{ fontFamily: 'monospace', fontSize: 12, letterSpacing: '.14em', color: TEAL, textTransform: 'uppercase', textAlign: 'center', marginBottom: 6 }}>공론화 플랫폼</div>
        <h1 style={{ fontSize: 26, fontWeight: 800, color: NAVY, textAlign: 'center', margin: '0 0 6px', letterSpacing: '-.02em' }}>운영진 로그인</h1>
        <p style={{ fontSize: 14, color: MUTED, textAlign: 'center', margin: '0 0 24px' }}>기관 계정(Supabase Auth)으로 로그인합니다.</p>

        <label htmlFor="platform-email" style={{ display: 'block', color: NAVY, fontSize: 14, fontWeight: 700, marginBottom: 6 }}>
          이메일
        </label>
        <input
          id="platform-email"
          type="email"
          disabled={busy}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="operator@example.org"
          style={field}
          autoComplete="username"
          aria-invalid={Boolean(err)}
          aria-describedby={err ? 'platform-login-error' : notice ? 'platform-login-notice' : undefined}
        />
        <label htmlFor="platform-password" style={{ display: 'block', color: NAVY, fontSize: 14, fontWeight: 700, marginBottom: 6 }}>
          비밀번호
        </label>
        <input
          id="platform-password"
          type="password"
          disabled={busy}
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          placeholder="비밀번호"
          style={field}
          autoComplete="current-password"
          aria-invalid={Boolean(err)}
          aria-describedby={err ? 'platform-login-error' : notice ? 'platform-login-notice' : undefined}
        />

        {err ? <p id="platform-login-error" role="alert" style={{ color: '#B91C1C', fontSize: 14, fontWeight: 600, margin: '2px 0 12px' }}>{err}</p> : null}
        {notice && !err ? <p id="platform-login-notice" role="status" aria-live="polite" style={{ color: '#8A4F08', fontSize: 13, margin: '2px 0 12px' }}>{notice}</p> : null}

        <button
          type="submit"
          disabled={busy || !email.trim() || !pw}
          style={{ width: '100%', height: 52, borderRadius: 12, border: 'none', color: '#fff', fontSize: 17, fontWeight: 700, cursor: busy ? 'default' : 'pointer', background: busy || !email.trim() || !pw ? '#9ca3af' : TEAL }}
        >
          {busy ? '로그인 중…' : '로그인'}
        </button>
        <p style={{ fontSize: 12, color: MUTED, textAlign: 'center', marginTop: 16 }}>
          플랫폼 스키마 미적용 상태에서는 로그인이 동작하지 않을 수 있습니다(빌드·마운트는 정상).
        </p>
        <p style={{ fontSize: 13, textAlign: 'center', margin: '10px 0 0' }}>
          <a href="/platform/accessibility/" style={ACCESSIBILITY_LINK_STYLE}>
            접근성 성명 및 피드백
          </a>
        </p>
      </form>
    </Centered>
  );
}

// ── 앱 셸(로그인 후) ────────────────────────────────────────────────────

/** Reloads the organization tree for the current user and rejects stale cross-user responses. */
export async function completeOrganizationTreeLoad(
  organizationsAction: () => ReturnType<typeof myOrgs>,
  treeAction: (orgId: string) => ReturnType<typeof orgTree>,
  isCurrent: () => boolean,
  currentScopeOrgId: string | null | undefined,
  onTree: (tree: TreeNode | null) => void,
  onNotice: (notice: string | null) => void,
  onLoadingChange: (loading: boolean) => void,
  onNavigate: (scope: Scope) => void,
  onOrganizations: (organizations: OrgRef[]) => void = () => undefined,
): Promise<void> {
  onTree(null);
  onNotice(null);
  onLoadingChange(true);
  try {
    const organizations = await organizationsAction();
    if (!isCurrent()) return;
    if (organizations.notice || !organizations.data || organizations.data.length === 0) {
      onOrganizations([]);
      onNotice(organizations.notice ?? '소속 기관이 없습니다.');
      onLoadingChange(false);
      return;
    }

    onOrganizations(organizations.data);
    const selectedOrganizations = organizations.data.filter((organization) => organization.selected);
    const organization = organizations.data.length === 1 ? organizations.data[0] : selectedOrganizations[0];
    if (!organization || selectedOrganizations.length > 1) {
      onNotice('여러 기관에 소속되어 있습니다. 사용할 기관을 선택해 주세요.');
      onLoadingChange(false);
      return;
    }
    const treeResult = await treeAction(organization.id);
    if (!isCurrent()) return;
    if (treeResult.notice || !treeResult.data) {
      onNotice(treeResult.notice ?? '기관 데이터 트리를 확인하지 못했습니다.');
      onLoadingChange(false);
      return;
    }

    onTree({ ...treeResult.data, id: organization.id, dataId: organization.id, label: organization.name });
    onNotice(null);
    onLoadingChange(false);
    if (currentScopeOrgId !== organization.id) onNavigate({ o: organization.id });
  } catch (error: unknown) {
    if (!isCurrent()) return;
    console.error('Failed to load platform organization tree', error);
    onTree(null);
    onNotice('기관 데이터 트리를 불러오는 중 예상하지 못한 오류가 발생했습니다.');
    onLoadingChange(false);
  }
}

export async function completeOrganizationSelection(
  action: () => ReturnType<typeof selectOrg>,
  isCurrent: () => boolean,
  onBusyChange: (busy: boolean) => void,
  onNotice: (notice: string | null) => void,
  storeContext: (token: string) => boolean = storePlatformOrgContextToken,
): Promise<boolean> {
  onBusyChange(true);
  onNotice(null);
  try {
    const result = await action();
    if (!isCurrent()) return false;
    if (result.notice || !result.data) {
      const notice = result.notice ?? '기관 선택 응답을 확인하지 못했습니다.';
      console.error('Failed to select platform organization', notice);
      onNotice(notice);
      onBusyChange(false);
      return false;
    }
    if (!storeContext(result.data.contextToken)) {
      const notice = '기관 선택 컨텍스트를 현재 탭에 저장하지 못했습니다.';
      console.error('Failed to store platform organization context');
      onNotice(notice);
      onBusyChange(false);
      return false;
    }
    onBusyChange(false);
    return true;
  } catch (error: unknown) {
    if (!isCurrent()) return false;
    console.error('Failed to select platform organization', error);
    onNotice('기관을 선택하는 중 예상하지 못한 오류가 발생했습니다.');
    onBusyChange(false);
    return false;
  }
}

function AppShell({
  session,
  scope,
  navigate,
  onSignedOut,
}: {
  session: AuthSessionInfo;
  scope: Scope;
  navigate: (s: Scope) => void;
  onSignedOut: (notice: string | null) => void;
}) {
  const [tree, setTree] = useState<TreeNode | null>(null);
  const [treeNotice, setTreeNotice] = useState<string | null>(null);
  const [loadingTree, setLoadingTree] = useState(true);
  const [organizations, setOrganizations] = useState<OrgRef[]>([]);
  const [selectingOrg, setSelectingOrg] = useState(false);
  const [logoutBusy, setLogoutBusy] = useState(false);
  const [logoutNotice, setLogoutNotice] = useState<string | null>(null);
  const organizationSelectionLock = useRef(false);
  const logoutLock = useRef(false);
  const organizationGeneration = useRef(0);
  const publishTarget = deepestDataScopeTarget(tree, scope);
  const scopedTopics = topicTargetsForScope(tree, scope);
  const scopedSessions = sessionTargetsForScope(tree, scope);
  const scopedSessionTopics = sessionTopicGroupsForScope(tree, scope);
  const scopedPath = scopePathContext(tree, scope);

  const loadOrganizationTree = useCallback(() => {
    const generation = organizationGeneration.current + 1;
    organizationGeneration.current = generation;
    void completeOrganizationTreeLoad(
      myOrgs,
      orgTree,
      () => organizationGeneration.current === generation,
      scope.o,
      setTree,
      setTreeNotice,
      setLoadingTree,
      navigate,
      setOrganizations,
    );
  }, [navigate, scope.o]);

  useEffect(() => {
    loadOrganizationTree();
    return () => { organizationGeneration.current += 1; };
  }, [session.userId, loadOrganizationTree]);

  const chooseOrganization = async (orgId: string) => {
    if (!orgId) return;
    await runExclusivePlatformOperation(
      organizationSelectionLock,
      async () => {
        const generation = organizationGeneration.current + 1;
        organizationGeneration.current = generation;
        const selected = await completeOrganizationSelection(
          () => selectOrg(orgId),
          () => organizationGeneration.current === generation,
          () => undefined,
          setTreeNotice,
        );
        if (selected) loadOrganizationTree();
      },
      setSelectingOrg,
    );
  };

  const logout = async () => {
    if (logoutBusy || logoutLock.current) return;
    await runExclusivePlatformOperation(
      logoutLock,
      async () => {
        const signedOut = await completeSignOut(signOut, setLogoutNotice);
        if (signedOut) {
          const credentialsCleared = clearPlatformSessionCredentials(
            typeof window === 'undefined' ? null : window.sessionStorage,
            (error) => console.error('Failed to clear platform session credentials', error),
          );
          onSignedOut(credentialsCleared ? null : '로그아웃했지만 브라우저의 HQ 인증 정보를 지우지 못했습니다. 이 탭을 닫아 주세요.');
        }
      },
      setLogoutBusy,
    );
  };

  return (
    <div style={{ minHeight: '100vh', background: BG, display: 'flex', flexDirection: 'column', fontFamily: "Pretendard, system-ui, sans-serif" }}>
      {/* 상단 바 + 브레드크럼(=데이터 경로) */}
      <header className="platform-shell-header" style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '12px 20px', borderBottom: `2px solid ${LINE}`, background: PANEL }}>
        <div className="platform-shell-brand" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: TEAL, display: 'grid', placeItems: 'center', color: '#fff', fontWeight: 800 }}>P</div>
          <span style={{ fontFamily: 'monospace', fontSize: 12, letterSpacing: '.14em', color: MUTED, textTransform: 'uppercase' }}>공론화 플랫폼</span>
        </div>
        <BreadcrumbNav tree={tree} scope={scope} navigate={navigate} />
        <div className="platform-shell-actions" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <OrganizationSelector
            organizations={organizations}
            busy={selectingOrg}
            onSelect={(orgId) => void chooseOrganization(orgId)}
          />
          <a href="/platform/accessibility/" style={{ ...ACCESSIBILITY_LINK_STYLE, fontSize: 13 }}>접근성</a>
          <span style={{ minWidth: 0, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 13, color: MUTED }}>{session.email ?? session.userId.slice(0, 8)}</span>
          <button
            type="button"
            onClick={() => void logout()}
            disabled={logoutBusy}
            aria-describedby={logoutNotice ? 'platform-logout-notice' : undefined}
            style={{ fontSize: 13, fontWeight: 600, color: NAVY, background: '#fff', border: `2px solid ${PLATFORM_CONTROL_BORDER}`, borderRadius: 8, padding: '6px 12px', cursor: logoutBusy ? 'default' : 'pointer' }}
          >
            {logoutBusy ? '로그아웃 중…' : '로그아웃'}
          </button>
        </div>
      </header>

      <LogoutNotice notice={logoutNotice} />

      <div className="platform-shell-body" style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        {/* 좌: 데이터 트리 네비 */}
        <aside className="platform-shell-tree" style={{ width: 288, borderRight: `2px solid ${LINE}`, background: '#fff', padding: '16px 10px', overflowY: 'auto' }}>
          <div style={{ fontFamily: 'monospace', fontSize: 11, letterSpacing: '.14em', color: MUTED, textTransform: 'uppercase', padding: '0 8px 10px' }}>데이터 트리</div>
          <DataTreeNavigation tree={tree} scope={scope} loading={loadingTree} notice={treeNotice} navigate={navigate} />
        </aside>

        {/* 우: 스코프 콘텐츠 아웃렛 + 뷰 전환 탭 */}
        <main className="platform-shell-content" id="platform-scope-content" tabIndex={-1} style={{ flex: 1, minWidth: 0, padding: '24px 28px', overflowY: 'auto' }}>
          <ViewTabs scope={scope} navigate={navigate} />
          <ScopeOutlet
            scope={scope}
            navigate={navigate}
            publishScopeId={publishTarget.id}
            scopedTopics={scopedTopics}
            scopedSessions={scopedSessions}
            scopedSessionTopics={scopedSessionTopics}
            scopeContext={scopedPath}
          />
        </main>
      </div>
    </div>
  );
}

export function OrganizationSelector({
  organizations,
  busy,
  onSelect,
}: {
  organizations: OrgRef[];
  busy: boolean;
  onSelect: (orgId: string) => void;
}) {
  if (organizations.length === 0) return null;
  if (organizations.length === 1) {
    return <span style={{ fontSize: 13, color: NAVY, fontWeight: 700 }}>{organizations[0].name}</span>;
  }
  const selected = organizations.find((organization) => organization.selected)?.id ?? '';
  return (
    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: NAVY, fontSize: 13, fontWeight: 700 }}>
      기관
      <select
        aria-label="사용할 기관"
        value={selected}
        disabled={busy}
        onChange={(event) => onSelect(event.target.value)}
        style={{ minHeight: 36, maxWidth: 180, border: `2px solid ${PLATFORM_CONTROL_BORDER}`, borderRadius: 8, background: '#fff', color: INK, padding: '4px 8px' }}
      >
        <option value="">선택 필요</option>
        {organizations.map((organization) => (
          <option key={organization.id} value={organization.id}>{organization.name}</option>
        ))}
      </select>
    </label>
  );
}

export async function completeSignOut(
  action: () => Promise<PlatformResult<true>>,
  onNotice: (notice: string | null) => void,
): Promise<boolean> {
  onNotice(null);
  try {
    const result = await action();
    if (result.notice || result.data !== true) {
      const failureNotice = result.notice ?? '로그아웃 응답을 확인하지 못했습니다.';
      console.error('Failed to sign out', failureNotice);
      onNotice(failureNotice);
      return false;
    }
    return true;
  } catch (error: unknown) {
    console.error('Failed to sign out', error);
    onNotice('로그아웃 중 예상하지 못한 오류가 발생했습니다.');
    return false;
  }
}

export function LogoutNotice({ notice }: { notice: string | null }) {
  if (!notice) return null;
  return <p id="platform-logout-notice" role="alert" style={{ margin: 0, padding: '8px 20px', color: '#B91C1C', background: '#FFF7F7', fontSize: 14 }}>{notice}</p>;
}

export function BreadcrumbNav({ tree, scope, navigate }: { tree: TreeNode | null; scope: Scope; navigate: (s: Scope) => void }) {
  const crumbs = breadcrumb(tree, scope);
  return (
    <nav className="platform-shell-breadcrumb" aria-label="브레드크럼" style={{ flex: 1, minWidth: 0, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 4 }}>
      {crumbs.length === 0 ? (
        <span style={{ color: MUTED, fontSize: 14 }}>데이터 경로 없음</span>
      ) : crumbs.map((crumb, index) => (
        <span key={crumb.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          {index > 0 ? <span style={{ color: '#C4D8E4' }}>/</span> : null}
          <button
            type="button"
            aria-current={index === crumbs.length - 1 ? 'location' : undefined}
            onClick={() => navigate(scopeWithValidView(crumb.scope, scope.view))}
            style={{ background: 'none', border: 'none', cursor: 'pointer', minHeight: 24, fontSize: 14, fontWeight: index === crumbs.length - 1 ? 800 : 600, color: index === crumbs.length - 1 ? NAVY : PLATFORM_ACCENT, padding: '2px 4px' }}
          >
            {crumb.label}
          </button>
        </span>
      ))}
      {scope.view ? <span style={{ marginLeft: 6, fontSize: 12, fontFamily: 'monospace', color: TEAL, textTransform: 'uppercase' }}>· {scope.view}</span> : null}
    </nav>
  );
}

export function DataTreeNavigation({ tree, scope, loading, notice, navigate }: { tree: TreeNode | null; scope: Scope; loading: boolean; notice: string | null; navigate: (s: Scope) => void }) {
  const flat = flattenTree(tree);
  if (loading) {
    return <p role="status" aria-live="polite" style={{ color: MUTED, fontSize: 14, padding: '8px' }}>트리 불러오는 중…</p>;
  }
  if (flat.length === 0) {
    return (
      <div role="status" aria-live="polite" style={{ padding: 8 }}>
        <p style={{ color: '#8A4F08', fontSize: 13, lineHeight: 1.6 }}>{notice ?? '표시할 공론화가 없습니다.'}</p>
        <p style={{ color: MUTED, fontSize: 12, marginTop: 8 }}>스키마·시드 적용 후 이 자리에 org → 공론화 → 회차 → 주제 트리가 뜹니다.</p>
      </div>
    );
  }
  return (
    <>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {flat.map(({ node, depth, scope: nodeScope }) => {
          const active = isNodeOnPath(node, scope);
          const isLeafSelected = active && sameLevel(nodeScope, scope);
          return (
            <li key={`${node.kind}:${node.id}`}>
              <button
                type="button"
                aria-current={isLeafSelected ? 'location' : undefined}
                onClick={() => navigate(scopeWithValidView(nodeScope, scope.view))}
                style={{
                  width: '100%', textAlign: 'left', cursor: 'pointer',
                  padding: '8px 10px', paddingLeft: 10 + depth * 16,
                  border: 'none', borderRadius: 8,
                  background: isLeafSelected ? '#E4F2F6' : active ? '#F1F7FA' : 'transparent',
                  color: active ? NAVY : INK,
                  fontSize: 14, fontWeight: active ? 700 : 500,
                  display: 'flex', alignItems: 'center', gap: 8,
                }}
              >
                <span aria-hidden="true" style={{ fontSize: 12, opacity: .8 }}>{kindIcon(node.kind)}</span>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{node.label}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {notice ? <p role="status" aria-live="polite" style={{ color: '#8A4F08', fontSize: 12, padding: 8 }}>{notice}</p> : null}
    </>
  );
}

// 스코프에 맞춘 뷰 전환 탭 — 선택 노드의 레벨에 따라 가능한 뷰만 노출.
// 레벨→뷰 표는 nav-logic 의 VIEWS_FOR_LEVEL 단일 원천을 읽는다(개요 카드와 동일 표).
export function ViewTabs({ scope, navigate }: { scope: Scope; navigate: (s: Scope) => void }) {
  const { level } = deepestViewScopeLevel(scope);
  if (!level) return null;
  const views = VIEWS_FOR_LEVEL[level];
  const base: Scope = { ...scope };
  delete base.view;
  return (
    <nav aria-label="스코프 보기" style={{ display: 'flex', gap: 6, marginBottom: 20, borderBottom: `2px solid ${LINE}`, paddingBottom: 12, flexWrap: 'wrap' }}>
      <button
        type="button"
        aria-current={!scope.view ? 'page' : undefined}
        onClick={() => navigate(base)}
        style={tabStyle(!scope.view)}
      >개요</button>
      {views.map((v) => (
        <button
          key={v}
          type="button"
          aria-current={scope.view === v ? 'page' : undefined}
          onClick={() => navigate({ ...base, view: v })}
          style={tabStyle(scope.view === v)}
        >
          {viewLabel(v)}
        </button>
      ))}
    </nav>
  );
}

function tabStyle(active: boolean): React.CSSProperties {
  return {
    padding: '8px 16px', borderRadius: 999, cursor: 'pointer',
    border: active ? `2px solid ${TEAL}` : `2px solid ${PLATFORM_CONTROL_BORDER}`,
    background: active ? TEAL : '#fff', color: active ? '#fff' : MUTED,
    fontSize: 14, fontWeight: active ? 700 : 600,
  };
}

function viewLabel(v: string): string {
  return ({ access: '접근 관리', record: '기록', vote: '투표', analyze: '분석', review: '검수', publish: '공개' } as Record<string, string>)[v] ?? v;
}

function kindIcon(kind: TreeNode['kind']): string {
  return ({ org: '🏛', assembly: '🗂', session: '📅', topic: '💬' } as Record<string, string>)[kind] ?? '•';
}

// 두 스코프의 "노드 경로 부분"이 같은지(가장 깊은 선택이 동일 노드인지) — 리프 하이라이트용.
function sameLevel(a: Scope, b: Scope): boolean {
  return a.o === b.o && a.c === b.c && a.f === b.f && a.s === b.s && a.t === b.t;
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: '100vh', background: BG, display: 'grid', placeItems: 'center', padding: 24, fontFamily: "Pretendard, system-ui, sans-serif" }}>
      {children}
    </div>
  );
}
