// 공론화 SaaS 플랫폼 — 앱 셸 (BUILD_SPEC §4-2)
//
// 좌: 데이터 트리 네비(orgTree 결과를 재귀 렌더 — 하드코딩 메뉴 아님).
// 상: 브레드크럼(=데이터 경로). 우: 스코프 콘텐츠 아웃렛.
// 노드 선택 = 스코프 좁히기. URL = 데이터 경로(o/c/f/s/t/view).
//
// 미로그인 → 로그인 카드. 로그인 → 셸. Auth 미설정 DB 에서도 마운트는 통과하고,
// 런타임 실패는 전부 notice 문구로 흡수한다(예외를 화면 밖으로 던지지 않는다).
// 색·타이포는 /mod 콘솔 톤 준용.

import { useEffect, useState, useCallback } from 'react';
import {
  parseScopePath,
  buildScopePath,
  flattenTree,
  breadcrumb,
  isNodeOnPath,
  deepestScopeLevel,
  deepestDataScopeTarget,
  topicTargetsForScope,
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
  type AuthSessionInfo,
  type PlatformResult,
} from '../../lib/platform';
import ScopeOutlet from './ScopeViews';

const NAVY = '#1F4E79';
export const PLATFORM_ACCENT = '#135C73';
export const PLATFORM_CONTROL_BORDER = '#6B7D88';
const TEAL = PLATFORM_ACCENT;
const INK = '#1F2933';
const MUTED = '#5A6B73';
const LINE = '#DCE7EE';
const BG = '#F5F8FB';
const PANEL = '#F1F7FA';

function currentScope(): Scope {
  if (typeof window === 'undefined') return {};
  return parseScopePath(window.location.pathname);
}

export default function PlatformShell() {
  // undefined = 확인 중, null = 미로그인, 값 = 로그인됨
  const [session, setSession] = useState<AuthSessionInfo | null | undefined>(undefined);
  const [authNotice, setAuthNotice] = useState<string | null>(null);
  const [scope, setScope] = useState<Scope>({});

  // 세션 확인 + 변화 구독. 마운트 시 현재 URL 로 스코프 초기화.
  useEffect(() => {
    setScope(currentScope());
    let alive = true;
    getSession().then((r) => {
      if (!alive) return;
      setSession(r.data ?? null);
      if (r.notice) setAuthNotice(r.notice);
    });
    const off = onAuthChange(() => {
      getSession().then((r) => alive && setSession(r.data ?? null));
    });
    const onPop = () => setScope(currentScope());
    window.addEventListener('popstate', onPop);
    return () => {
      alive = false;
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
    return <LoginCard notice={authNotice} onSignedIn={(s) => { setSession(s); setAuthNotice(null); }} />;
  }
  return <AppShell session={session} scope={scope} navigate={navigate} />;
}

// ── 로그인 카드 ─────────────────────────────────────────────────────────

export function LoginCard({ notice, onSignedIn }: { notice: string | null; onSignedIn: (s: AuthSessionInfo) => void }) {
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (event: React.SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!email.trim() || !pw) return;
    setBusy(true);
    setErr(null);
    const r = await platformSignIn(email.trim(), pw);
    setBusy(false);
    if (r.data) onSignedIn(r.data);
    else setErr(r.notice ?? '로그인에 실패했습니다.');
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
          <a href="/platform/accessibility/" style={{ color: PLATFORM_ACCENT, fontWeight: 700, textDecoration: 'underline', textUnderlineOffset: 3 }}>
            접근성 성명 및 피드백
          </a>
        </p>
      </form>
    </Centered>
  );
}

// ── 앱 셸(로그인 후) ────────────────────────────────────────────────────

function AppShell({ session, scope, navigate }: { session: AuthSessionInfo; scope: Scope; navigate: (s: Scope) => void }) {
  const [tree, setTree] = useState<TreeNode | null>(null);
  const [treeNotice, setTreeNotice] = useState<string | null>(null);
  const [loadingTree, setLoadingTree] = useState(true);
  const [logoutBusy, setLogoutBusy] = useState(false);
  const [logoutNotice, setLogoutNotice] = useState<string | null>(null);
  const publishTarget = deepestDataScopeTarget(tree, scope);
  const scopedTopics = topicTargetsForScope(tree, scope);

  // org 파생(org_of_uid) → orgTree. org_id 는 클라이언트가 주장하지 않는다(서버 파생).
  useEffect(() => {
    let alive = true;
    setLoadingTree(true);
    (async () => {
      const orgs = await myOrgs();
      if (!alive) return;
      if (!orgs.data || orgs.data.length === 0) {
        setTreeNotice(orgs.notice ?? '소속 기관이 없습니다.');
        setLoadingTree(false);
        return;
      }
      const org = orgs.data[0];
      const t = await orgTree(org.id);
      if (!alive) return;
      setTree(t.data);
      setTreeNotice(t.notice);
      setLoadingTree(false);
      // URL 에 org 스코프가 없으면 기본으로 org 루트를 채운다(데이터 경로 시작점).
      if (!scope.o) navigate({ o: org.id });
    })();
    return () => { alive = false; };
    // scope.o 변화로 재실행하지 않도록 마운트 1회만.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const logout = async () => {
    if (logoutBusy) return;
    await completeSignOut(signOut, setLogoutBusy, setLogoutNotice);
  };

  return (
    <div style={{ minHeight: '100vh', background: BG, display: 'flex', flexDirection: 'column', fontFamily: "Pretendard, system-ui, sans-serif" }}>
      {/* 상단 바 + 브레드크럼(=데이터 경로) */}
      <header style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '12px 20px', borderBottom: `2px solid ${LINE}`, background: PANEL }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: TEAL, display: 'grid', placeItems: 'center', color: '#fff', fontWeight: 800 }}>P</div>
          <span style={{ fontFamily: 'monospace', fontSize: 12, letterSpacing: '.14em', color: MUTED, textTransform: 'uppercase' }}>공론화 플랫폼</span>
        </div>
        <BreadcrumbNav tree={tree} scope={scope} navigate={navigate} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <a href="/platform/accessibility/" style={{ fontSize: 13, fontWeight: 700, color: PLATFORM_ACCENT, textDecoration: 'underline', textUnderlineOffset: 3 }}>접근성</a>
          <span style={{ fontSize: 13, color: MUTED }}>{session.email ?? session.userId.slice(0, 8)}</span>
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

      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        {/* 좌: 데이터 트리 네비 */}
        <aside style={{ width: 288, borderRight: `2px solid ${LINE}`, background: '#fff', padding: '16px 10px', overflowY: 'auto' }}>
          <div style={{ fontFamily: 'monospace', fontSize: 11, letterSpacing: '.14em', color: MUTED, textTransform: 'uppercase', padding: '0 8px 10px' }}>데이터 트리</div>
          <DataTreeNavigation tree={tree} scope={scope} loading={loadingTree} notice={treeNotice} navigate={navigate} />
        </aside>

        {/* 우: 스코프 콘텐츠 아웃렛 + 뷰 전환 탭 */}
        <main id="platform-scope-content" tabIndex={-1} style={{ flex: 1, minWidth: 0, padding: '24px 28px', overflowY: 'auto' }}>
          <ViewTabs scope={scope} navigate={navigate} />
          <ScopeOutlet scope={scope} publishScopeId={publishTarget.id} scopedTopics={scopedTopics} />
        </main>
      </div>
    </div>
  );
}

export async function completeSignOut(
  action: () => Promise<PlatformResult<true>>,
  onBusyChange: (busy: boolean) => void,
  onNotice: (notice: string | null) => void,
): Promise<void> {
  onBusyChange(true);
  onNotice(null);
  try {
    const result = await action();
    if (result.notice) {
      console.error('Failed to sign out', result.notice);
      onNotice(result.notice);
    }
  } catch (error: unknown) {
    console.error('Failed to sign out', error);
    onNotice('로그아웃 중 예상하지 못한 오류가 발생했습니다.');
  } finally {
    onBusyChange(false);
  }
}

export function LogoutNotice({ notice }: { notice: string | null }) {
  if (!notice) return null;
  return <p id="platform-logout-notice" role="alert" style={{ margin: 0, padding: '8px 20px', color: '#B91C1C', background: '#FFF7F7', fontSize: 14 }}>{notice}</p>;
}

export function BreadcrumbNav({ tree, scope, navigate }: { tree: TreeNode | null; scope: Scope; navigate: (s: Scope) => void }) {
  const crumbs = breadcrumb(tree, scope);
  return (
    <nav aria-label="브레드크럼" style={{ flex: 1, minWidth: 0, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 4 }}>
      {crumbs.length === 0 ? (
        <span style={{ color: MUTED, fontSize: 14 }}>데이터 경로 없음</span>
      ) : crumbs.map((crumb, index) => (
        <span key={crumb.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          {index > 0 ? <span style={{ color: '#C4D8E4' }}>/</span> : null}
          <button
            type="button"
            aria-current={index === crumbs.length - 1 ? 'location' : undefined}
            onClick={() => navigate(scope.view ? { ...crumb.scope, view: scope.view } : crumb.scope)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, fontWeight: index === crumbs.length - 1 ? 800 : 600, color: index === crumbs.length - 1 ? NAVY : PLATFORM_ACCENT, padding: '2px 4px' }}
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
                onClick={() => navigate(scope.view ? { ...nodeScope, view: scope.view } : nodeScope)}
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
  const { level } = deepestScopeLevel(scope);
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
  return ({ record: '기록', vote: '투표', analyze: '분석', review: '검수', publish: '공개' } as Record<string, string>)[v] ?? v;
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
