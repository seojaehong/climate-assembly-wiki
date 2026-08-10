import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { BreadcrumbNav, completeSignOut, DataTreeNavigation, LoginCard, LogoutNotice, PLATFORM_ACCENT, PLATFORM_CONTROL_BORDER, ViewTabs } from './PlatformShell';
import type { TreeNode } from './platform-nav-logic';
import ScopeOutlet from './ScopeViews';
import ReviewConsole, { REVIEW_STATUS_GREEN, ReviewIssueChoice, ReviewSourceCard, SourceReferenceList } from './review/ReviewConsole';
import type { IssueViewModel, ReviewItem } from './review/review-console-logic';
import { resolveHitlStatus } from '../../lib/hitl-status';

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
      scope: { c: 'assembly-1', s: 'session-1', view: 'design' },
      scopedSessions: [{ id: 'session-uuid-1', label: '제1차 회의' }],
    }));

    expect(html).toContain('운영 준비도');
    expect(html).not.toContain('데이터 로드 골격');
  });

  it('스코프 개요가 고대비 액센트와 2px 경계만 사용한다', () => {
    const html = renderToStaticMarkup(createElement(ScopeOutlet, { scope: { c: 'assembly-1' } }));

    expect(html).toContain('color:#135C73');
    expect(html).toContain('border:2px solid #6B7D88');
    expect(html).not.toMatch(/border:(?:1|1\.5)px/);
  });

  it('주제 분석 보기가 플레이스홀더 대신 실제 분석 콘솔을 연다', () => {
    const html = renderToStaticMarkup(createElement(ScopeOutlet, {
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

  it('주제와 회차 기록 보기가 실제 원문 기록 콘솔을 연다', () => {
    const topicHtml = renderToStaticMarkup(createElement(ScopeOutlet, {
      scope: { o: 'org', c: 'assembly', s: 'session', t: 'topic-1', view: 'record' },
      scopedTopics: [{ id: 'topic-1', label: '에너지 전환' }],
    }));
    const sessionHtml = renderToStaticMarkup(createElement(ScopeOutlet, {
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

  it('회차 투표 보기가 플레이스홀더 대신 실제 집계 콘솔을 연다', () => {
    const html = renderToStaticMarkup(createElement(ScopeOutlet, {
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
    expect(source).not.toMatch(/border:\s*['`]?1(?:\.5)?px/);
    expect(source).not.toContain("outline: 'none'");
    expect(source).not.toContain('#23B2C3');
    expect(source).not.toContain('#B5651D');
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
    expect(activeHtml).toContain('aria-label="검수 완료: 운영진이 원문과 대조해 공개 가능한 표현으로 확정했습니다."');
    expect(inactiveHtml).toContain('aria-pressed="false"');
    expect(inactiveHtml).not.toContain('선택됨');
  });

  it('선택 쟁점에서 연결 원문의 안정된 앵커로 이동한다', () => {
    const source: ReviewItem = {
      itemId: 'item-1', submissionId: 'submission-1', ordinal: 2, teamName: '1분과 2조',
      kind: 'core', content: '지역 주도 전환이 필요하다', rationale: '실행력 확보',
      issueIds: ['issue-1'], clusterId: null,
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
