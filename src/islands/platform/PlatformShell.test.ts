import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { BreadcrumbNav, completeSignOut, DataTreeNavigation, LoginCard, LogoutNotice, PLATFORM_ACCENT, PLATFORM_CONTROL_BORDER, ViewTabs } from './PlatformShell';
import type { TreeNode } from './platform-nav-logic';
import ScopeOutlet from './ScopeViews';
import ReviewConsole, { completeReviewLoad, loadReviewData, REVIEW_STATUS_GREEN, ReviewIssueChoice, ReviewSourceCard, SourceReferenceList } from './review/ReviewConsole';
import type { IssueViewModel, ReviewItem } from './review/review-console-logic';
import { resolveHitlStatus } from '../../lib/hitl-status';
import type { IssueItemsResult, IssueListResult, PlatformResult } from '../../lib/platform';

const tree: TreeNode = {
  kind: 'org',
  id: 'org',
  label: '기관',
  children: [{
    kind: 'assembly',
    id: 'assembly',
    label: '공론화',
    children: [{ kind: 'session', id: 'session', label: '1회차', children: [] }],
  }],
};

const navigate = () => undefined;

function channel(hex: string, start: number): number {
  return Number.parseInt(hex.slice(start, start + 2), 16) / 255;
}

function luminance(hex: string): number {
  const linear = [channel(hex, 1), channel(hex, 3), channel(hex, 5)].map((value) =>
    value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
  );
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}

function contrastRatio(a: string, b: string): number {
  const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (lighter + 0.05) / (darker + 0.05);
}

describe('PlatformShell accessibility', () => {
  it('회차 설계 뷰를 canonical 회차 대상으로 연결한다', () => {
    const html = renderToStaticMarkup(createElement(ScopeOutlet, {
      navigate,
      scope: { c: 'assembly-1', s: 'session-1', view: 'design' },
      scopedSessions: [{ id: 'session-uuid-1', label: '제1차 회의' }],
    }));

    expect(html).toContain('운영 준비도');
    expect(html).not.toContain('데이터 로드 골격');
  });

  it('스코프 개요가 키보드 링크와 고대비 2px 경계를 제공한다', () => {
    const html = renderToStaticMarkup(createElement(ScopeOutlet, {
      scope: { o: 'org-1', c: 'assembly-1' },
      navigate,
    }));

    expect(html).toContain('color:#135C73');
    expect(html).toContain('border:2px solid #6B7D88');
    expect(html).toContain('href="/platform/o/org-1/c/assembly-1/design"');
    expect(html).toContain('href="/platform/o/org-1/c/assembly-1/record"');
    expect(html).toContain('href="/platform/o/org-1/c/assembly-1/analyze"');
    expect(html).toContain('href="/platform/o/org-1/c/assembly-1/publish"');
    expect(html).not.toMatch(/border:(?:1|1\.5)px/);
  });

  it('주제 분석 보기가 플레이스홀더 대신 실제 분석 콘솔을 연다', () => {
    const html = renderToStaticMarkup(createElement(ScopeOutlet, {
      navigate,
      scope: { o: 'org', c: 'assembly', s: 'session', t: 'topic-1', view: 'analyze' },
      scopedTopics: [{ id: 'topic-1', label: '에너지 전환' }],
    }));

    expect(html).toContain('이 주제의 쟁점 분석');
    expect(html).toContain('주제 분석 불러오기');
    expect(html).toContain('analysis-join-code');
    expect(html).not.toContain('데이터 로드 골격');
  });

  it('회차 분석이 포함 주제를 집계하는 실제 분석 콘솔을 연다', () => {
    const html = renderToStaticMarkup(createElement(ScopeOutlet, {
      navigate,
      scope: { o: 'org', c: 'assembly', s: 'session', view: 'analyze' },
      scopedTopics: [
        { id: 'topic-1', label: '에너지 전환' },
        { id: 'topic-2', label: '수송 부문' },
      ],
    }));

    expect(html).toContain('이 회차의 쟁점 분석');
    expect(html).toContain('2개 주제');
    expect(html).toContain('analysis-join-code');
    expect(html).not.toContain('데이터 로드 골격');
  });

  it('공론화 분석이 회차별 코드 입력을 갖춘 실제 분석 콘솔을 연다', () => {
    const html = renderToStaticMarkup(createElement(ScopeOutlet, {
      navigate,
      scope: { o: 'org', c: 'assembly', view: 'analyze' },
      scopedSessionTopics: [{
        id: 'session-1',
        label: '제1차 회의',
        topics: [{ id: 'topic-1', label: '에너지 전환' }],
      }],
    }));

    expect(html).toContain('이 공론화의 쟁점 분석');
    expect(html).toContain('제1차 회의 참여 코드');
    expect(html).not.toContain('데이터 로드 골격');
  });

  it('공론화 기록이 회차별 코드 입력을 갖춘 실제 기록 콘솔을 연다', () => {
    const html = renderToStaticMarkup(createElement(ScopeOutlet, {
      navigate,
      scope: { o: 'org', c: 'assembly', view: 'record' },
      scopedSessionTopics: [{
        id: 'session-1',
        label: '제1차 회의',
        topics: [{ id: 'topic-1', label: '에너지 전환' }],
      }],
    }));

    expect(html).toContain('이 공론화의 조별 기록');
    expect(html).toContain('제1차 회의 참여 코드');
    expect(html).not.toContain('데이터 로드 골격');
  });

  it('주제와 회차 기록 보기가 실제 원문 기록 콘솔을 연다', () => {
    const topicHtml = renderToStaticMarkup(createElement(ScopeOutlet, {
      navigate,
      scope: { o: 'org', c: 'assembly', s: 'session', t: 'topic-1', view: 'record' },
      scopedTopics: [{ id: 'topic-1', label: '에너지 전환' }],
    }));
    const sessionHtml = renderToStaticMarkup(createElement(ScopeOutlet, {
      navigate,
      scope: { o: 'org', c: 'assembly', s: 'session', view: 'record' },
      scopedTopics: [
        { id: 'topic-1', label: '에너지 전환' },
        { id: 'topic-2', label: '수송 부문' },
      ],
    }));

    expect(topicHtml).toContain('이 주제의 조별 기록');
    expect(sessionHtml).toContain('이 회차의 조별 기록');
    expect(sessionHtml).toContain('2개 주제');
    expect(topicHtml).not.toContain('데이터 로드 골격');
    expect(sessionHtml).not.toContain('데이터 로드 골격');
  });

  it('활성 canonical 경로를 모든 기록 콘솔의 export context로 전달한다', () => {
    const shellSource = readFileSync(new URL('./PlatformShell.tsx', import.meta.url), 'utf8');
    const outletSource = readFileSync(new URL('./ScopeViews.tsx', import.meta.url), 'utf8');

    expect(shellSource).toContain('const scopedPath = scopePathContext(tree, scope);');
    expect(shellSource).toContain('scopeContext={scopedPath}');
    expect(outletSource.match(/context=\{scopeContext\}/g)).toHaveLength(2);
  });

  it('회차 투표 보기가 플레이스홀더 대신 실제 집계 콘솔을 연다', () => {
    const html = renderToStaticMarkup(createElement(ScopeOutlet, {
      navigate,
      scope: { o: 'org', c: 'assembly', s: 'session', view: 'vote' },
      scopedTopics: [{ id: 'topic-1', label: '에너지 전환' }],
    }));

    expect(html).toContain('이 회차의 투표 집계');
    expect(html).toContain('회차 투표 불러오기');
    expect(html).toContain('vote-join-code');
    expect(html).not.toContain('데이터 로드 골격');
  });

  it('검수 콘솔이 고대비 색·2px 경계·브라우저 포커스 표시를 유지한다', () => {
    const html = renderToStaticMarkup(createElement(ReviewConsole, { topicId: null }));
    const formHtml = renderToStaticMarkup(createElement(ReviewConsole, { topicId: 'topic-1', items: [] }));
    const source = readFileSync(new URL('./review/ReviewConsole.tsx', import.meta.url), 'utf8');

    expect(html).toContain('border:2px dashed #135C73');
    expect(formHtml).toContain('aria-busy="false"');
    expect(formHtml).toContain('for="review-join-code"');
    expect(formHtml).toContain('id="review-join-code"');
    for (const controlId of ['review-issue-label', 'review-frequency', 'review-stance', 'review-summary', 'review-cluster-id']) {
      expect(source).toContain(`htmlFor="${controlId}"`);
      expect(source).toContain(`id="${controlId}"`);
    }
    expect(source).toContain('aria-label="병합할 원본 쟁점"');
    expect(source).toContain('aria-label="병합 대상 쟁점"');
    expect(source).toContain('aria-label="선택 원문을 이동할 대상 쟁점"');
    expect(source).toContain('서로 다르면 데이터 손실을 막기 위해 이동을 차단합니다.');
    expect(source).not.toContain('원문별 cluster 개별 보존은 불가(미결)');
    expect(source).not.toMatch(/border:\s*['`]?1(?:\.5)?px/);
    expect(source).not.toContain("outline: 'none'");
    expect(source).not.toContain('#23B2C3');
    expect(source).not.toContain('#B5651D');
    expect(source).toContain('const generation = requestGeneration.current + 1;');
    expect(source).toContain('requestGeneration.current = generation;');
    expect(source).toContain('() => requestGeneration.current === generation && currentTopicId.current === topicId');
    expect(source).toContain("if (requestGeneration.current === generation && currentTopicId.current === topicId) setCode('');");
    expect(source).toContain('return () => { requestGeneration.current += 1; };');
    expect(contrastRatio(REVIEW_STATUS_GREEN, '#E3F1E6')).toBeGreaterThanOrEqual(4.5);
  });

  it('쟁점 선택 상태를 보조기기와 화면에 함께 표시한다', () => {
    const vm: IssueViewModel = {
      id: 'issue-1', label: '재생에너지 확대', stance: 'proposal', frequencyClass: 'consensus',
      summary: null, origin: 'human', reviewStatus: 'reviewed', reviewedBy: 'operator',
      frequencyBadge: '합의', stanceBadge: '대안·제안', hitl: resolveHitlStatus({ reviewStatus: 'reviewed', origin: 'human' }),
      linkedItemCount: 2, consensusDenominator: 2, reviewable: false,
    };
    const activeHtml = renderToStaticMarkup(createElement(ReviewIssueChoice, { vm, active: true, onSelect: () => undefined }));
    const inactiveHtml = renderToStaticMarkup(createElement(ReviewIssueChoice, { vm, active: false, onSelect: () => undefined }));

    expect(activeHtml).toContain('aria-pressed="true"');
    expect(activeHtml).toContain('선택됨');
    expect(activeHtml).toContain('검수 완료');
    expect(activeHtml).toContain('class="sr-only">: 운영진이 원문과 대조해 공개 가능한 표현으로 확정했습니다.</span>');
    expect(activeHtml).not.toContain('aria-label="검수 완료');
    expect(inactiveHtml).toContain('aria-pressed="false"');
    expect(inactiveHtml).not.toContain('선택됨');
  });

  it('선택 쟁점에서 연결 원문의 안정된 앵커로 이동한다', () => {
    const source: ReviewItem = {
      itemId: 'item-1', submissionId: 'submission-1', ordinal: 2, teamName: '1분과 2조',
      kind: 'core', content: '지역 주도 전환이 필요하다', rationale: '실행력 확보',
      issueIds: ['issue-1'],
      links: [{ issueId: 'issue-1', clusterId: null, linkedBy: 'ai' }],
    };
    const linksHtml = renderToStaticMarkup(createElement(SourceReferenceList, { items: [source] }));
    const cardHtml = renderToStaticMarkup(createElement(ReviewSourceCard, {
      item: source,
      checked: false,
      onToggle: () => undefined,
    }));

    expect(linksHtml).toContain('aria-label="연결 원문 바로가기"');
    expect(linksHtml).toContain('href="#source-item-item-1"');
    expect(linksHtml).toContain('1분과 2조 · 핵심 2번 원문');
    expect(cardHtml).toContain('id="source-item-item-1"');
    expect(cardHtml).toContain('tabindex="-1"');
    expect(cardHtml).toContain('aria-label="1분과 2조 · 핵심 2번 원문 선택"');
  });

  it('로그인 폼이 입력 이름과 상태 메시지를 보조기기에 제공한다', () => {
    const html = renderToStaticMarkup(createElement(LoginCard, {
      notice: '인증 설정을 확인해 주세요.',
      onSignedIn: () => undefined,
    }));

    expect(html).toContain('<form');
    expect(html).toContain('id="platform-scope-content"');
    expect(html).toContain('tabindex="-1"');
    expect(html).toContain('aria-label="운영진 로그인"');
    expect(html).toContain('for="platform-email"');
    expect(html).toContain('id="platform-email"');
    expect(html).toContain('for="platform-password"');
    expect(html).toContain('id="platform-password"');
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('type="submit"');
    expect(html).not.toContain('outline:none');
    expect(html).toContain('border:2px solid #6B7D88');
    expect(html).not.toContain('border:1px');
  });

  it('접근성 성명의 건너뛰기 대상이 프로그램 방식으로 초점을 받을 수 있다', () => {
    const source = readFileSync(new URL('../../pages/platform/accessibility.astro', import.meta.url), 'utf8');

    expect(source).toContain('<main id="main-content" tabindex="-1">');
    expect(source).toContain('axe-core 기반 WCAG 2.2 AA 자동검사');
    expect(source).toContain('evaluation/platform-accessibility-audit.json');
    expect(source).toContain('evaluation/platform-accessibility-responsive-audit.json');
    expect(source).toContain('데스크톱 1440×1000과 모바일 360×800 뷰포트에서 가로 넘침도 함께 검사합니다.');
    expect(source).toContain('자동검사는 공식 품질인증이나 전수 수동평가를 대체하지 않습니다.');
    expect(source).toContain('인증 셸과 공개 결과의 자동감사는 읽기 전용 브라우저 fixture를 사용');
    expect(source).toContain('스크린리더와 실제 모바일 보조기기 평가는 수동 확인이 필요합니다.');
  });

  it('스코프 보기 내비게이션이 현재 보기를 한 곳에서만 표시한다', () => {
    const html = renderToStaticMarkup(createElement(ViewTabs, {
      scope: { o: 'org', c: 'assembly', s: 'session', t: 'topic', view: 'review' },
      navigate: () => undefined,
    }));

    expect(html).toContain('<nav');
    expect(html).toContain('aria-label="스코프 보기"');
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    expect(html).toContain('검수');
    expect(html).toContain('border:2px solid #6B7D88');
    expect(html).not.toContain('border:1px');
  });

  it('주요 액센트 위 흰색 일반 텍스트가 AA 명암비를 충족한다', () => {
    expect(contrastRatio(PLATFORM_ACCENT, '#FFFFFF')).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(PLATFORM_ACCENT, '#F1F7FA')).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(PLATFORM_CONTROL_BORDER, '#FFFFFF')).toBeGreaterThanOrEqual(3);
  });

  it('브레드크럼과 데이터 트리가 현재 위치를 각각 한 곳에서 알린다', () => {
    const scope = { o: 'org', c: 'assembly', s: 'session' };
    const breadcrumbHtml = renderToStaticMarkup(createElement(BreadcrumbNav, { tree, scope, navigate: () => undefined }));
    const treeHtml = renderToStaticMarkup(createElement(DataTreeNavigation, {
      tree,
      scope,
      loading: false,
      notice: null,
      navigate: () => undefined,
    }));

    expect(breadcrumbHtml).toContain('aria-label="브레드크럼"');
    expect(breadcrumbHtml.match(/aria-current="location"/g)).toHaveLength(1);
    expect(treeHtml.match(/aria-current="location"/g)).toHaveLength(1);
  });

  it('모바일 셸을 단일 열로 재배치하고 터치 높이를 보장한다', () => {
    const shellSource = readFileSync(new URL('./PlatformShell.tsx', import.meta.url), 'utf8');
    const globalStyles = readFileSync(new URL('../../styles/global.css', import.meta.url), 'utf8');
    const loginHtml = renderToStaticMarkup(createElement(LoginCard, { notice: null, onSignedIn: () => undefined }));
    const breadcrumbHtml = renderToStaticMarkup(createElement(BreadcrumbNav, {
      tree,
      scope: { o: 'org', c: 'assembly', s: 'session' },
      navigate: () => undefined,
    }));

    expect(loginHtml).toMatch(/href="\/platform\/accessibility\/"[^>]*min-height:24px/);
    expect(breadcrumbHtml.match(/min-height:24px/g)).toHaveLength(3);
    expect(breadcrumbHtml).toContain('class="platform-shell-breadcrumb"');
    expect(shellSource).toContain('className="platform-shell-actions"');
    expect(shellSource).toContain('className="platform-shell-body"');
    expect(shellSource).toContain('className="platform-shell-tree"');
    expect(shellSource).toContain('className="platform-shell-content"');
    expect(globalStyles).toContain('@media (max-width: 720px)');
    expect(globalStyles).toContain('flex: 1 0 100% !important;');
    expect(globalStyles).toContain('flex-direction: column;');
    expect(globalStyles).toContain('width: 100% !important;');
    expect(globalStyles).toContain('padding: 20px 16px !important;');
  });

  it('데이터 트리 로딩과 빈 상태를 live region으로 알린다', () => {
    const loadingHtml = renderToStaticMarkup(createElement(DataTreeNavigation, {
      tree: null,
      scope: {},
      loading: true,
      notice: null,
      navigate: () => undefined,
    }));
    const emptyHtml = renderToStaticMarkup(createElement(DataTreeNavigation, {
      tree: null,
      scope: {},
      loading: false,
      notice: '소속 기관이 없습니다.',
      navigate: () => undefined,
    }));

    expect(loadingHtml).toContain('role="status"');
    expect(loadingHtml).toContain('aria-live="polite"');
    expect(emptyHtml).toContain('role="status"');
    expect(emptyHtml).toContain('aria-live="polite"');
  });

  it('로그아웃 실패를 알리고 busy 상태를 항상 해제한다', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const busyChanges: boolean[] = [];
    const notices: Array<string | null> = [];

    try {
      await completeSignOut(
        async () => ({ data: null, notice: '로그아웃에 실패했습니다.' }),
        (busy) => busyChanges.push(busy),
        (notice) => notices.push(notice),
      );
      await completeSignOut(
        async () => { throw new Error('network'); },
        (busy) => busyChanges.push(busy),
        (notice) => notices.push(notice),
      );
    } finally {
      errorLog.mockRestore();
    }

    const alertHtml = renderToStaticMarkup(createElement(LogoutNotice, { notice: notices.at(-1) ?? null }));
    expect(busyChanges).toEqual([true, false, true, false]);
    expect(notices).toEqual([
      null,
      '로그아웃에 실패했습니다.',
      null,
      '로그아웃 중 예상하지 못한 오류가 발생했습니다.',
    ]);
    expect(alertHtml).toContain('role="alert"');
  });
});

describe('ReviewConsole loading', () => {
  const listResult: IssueListResult = {
    topic_id: 'topic-1',
    issues: [],
    unclassified_count: 1,
    reviewed_count: 0,
  };
  const itemsResult: IssueItemsResult = {
    topic_id: 'topic-1',
    items: [{
      id: 'item-1',
      content: '지역 주도 전환이 필요하다',
      rationale: null,
      kind: 'core',
      ordinal: 1,
      team_id: 'team-1',
      team_name: '1분과 1조',
      submission_id: 'submission-1',
      links: [],
      unclassified: true,
    }],
  };

  it('쟁점과 원문을 같은 주제·참여 코드 범위에서 함께 불러온다', async () => {
    const listLoader = vi.fn().mockResolvedValue({ data: listResult, notice: null });
    const itemsLoader = vi.fn().mockResolvedValue({ data: itemsResult, notice: null });

    const loaded = await loadReviewData('JOIN-1', 'topic-1', listLoader, itemsLoader);

    expect(listLoader).toHaveBeenCalledWith('JOIN-1', 'topic-1');
    expect(itemsLoader).toHaveBeenCalledWith('JOIN-1', 'topic-1');
    expect(loaded.notice).toBeNull();
    expect(loaded.data?.list).toEqual(listResult);
    expect(loaded.data?.items?.[0]?.itemId).toBe('item-1');
  });

  it('한 응답이 data와 notice를 모두 누락하면 로그하고 부분 결과만 표시한다', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const loaded = await loadReviewData(
      'JOIN-1',
      'topic-1',
      async () => ({ data: listResult, notice: null }),
      async () => ({ data: null, notice: null }),
    );

    expect(log).toHaveBeenCalledWith('Review issue items request returned no data or notice');
    expect(loaded.data?.list).toEqual(listResult);
    expect(loaded.data?.items).toBeNull();
    expect(loaded.notice).toBe('원문 목록을 불러오지 못했습니다.');
    log.mockRestore();
  });

  it('더 이상 현재 요청이 아니면 늦은 응답과 busy 해제를 반영하지 않는다', async () => {
    let current = true;
    let resolveResult!: (value: PlatformResult<{ list: IssueListResult | null; items: ReviewItem[] | null }>) => void;
    const action = () => new Promise<PlatformResult<{ list: IssueListResult | null; items: ReviewItem[] | null }>>((resolve) => {
      resolveResult = resolve;
    });
    const busy: boolean[] = [];
    const data: Array<{ list: IssueListResult | null; items: ReviewItem[] | null } | null> = [];
    const notices: Array<string | null> = [];

    const pending = completeReviewLoad(
      action,
      (value) => busy.push(value),
      (value) => data.push(value),
      (value) => notices.push(value),
      () => current,
    );
    current = false;
    resolveResult({ data: { list: listResult, items: [] }, notice: null });
    const loaded = await pending;

    expect(loaded).toBe(false);
    expect(busy).toEqual([true]);
    expect(data).toEqual([null]);
    expect(notices).toEqual([null]);
  });

  it('예상하지 못한 예외를 로그하고 alert용 notice로 바꾼다', async () => {
    const error = new Error('network down');
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const busy: boolean[] = [];
    const notices: Array<string | null> = [];

    const loaded = await completeReviewLoad(
      async () => { throw error; },
      (value) => busy.push(value),
      () => undefined,
      (value) => notices.push(value),
    );

    expect(loaded).toBe(false);
    expect(log).toHaveBeenCalledWith('Failed to load review data', error);
    expect(busy).toEqual([true, false]);
    expect(notices.at(-1)).toContain('예상하지 못한 오류');
    log.mockRestore();
  });
});
