// 스코프별 뷰 플레이스홀더 — record·vote·analyze·review·publish
//
// BUILD_SPEC §4 산출물 5: "검수/결과의 실제 구현은 후속 슬라이스가 채운다 — 여기선
// 라우팅·마운트 지점만." 각 패널은 제목 + "이 스코프의 <X>" + 데이터 로드 골격만 둔다.
// 실제 issue CRUD·공개는 후속 검수 콘솔/결과 페이지 슬라이스(BUILD_SPEC §5 4·5단계).

import { useEffect, useState } from 'react';
import { type Scope, type ViewName, deepestScopeLevel, VIEWS_FOR_LEVEL } from './platform-nav-logic';
import ReviewConsole from './review/ReviewConsole';
import PublishConsole from './publish/PublishConsole';
import { buildPublicationScopeKey } from './publish/publish-console-logic';

const NAVY = '#1F4E79';
const TEAL = '#135C73';
const MUTED = '#5A6B73';
const LINE = '#6B7D88';

const VIEW_META: Record<ViewName, { title: string; noun: string; icon: string; hint: string }> = {
  record: { title: '기록', noun: '조별 산출물·발언', icon: '📝', hint: '조 콘솔 제출물(submission)을 이 스코프에서 모아 봅니다.' },
  vote: { title: '투표', noun: '회차 투표(ballot)', icon: '🗳️', hint: '회차 단위 무기명 투표 집계를 이 스코프에서 봅니다.' },
  analyze: { title: '분석', noun: '쟁점(issue)·합의도', icon: '📊', hint: '분석코어가 적재한 쟁점과 cluster 분모를 이 스코프에서 봅니다.' },
  review: { title: '검수', noun: '쟁점 4×6·링크·병합', icon: '🔎', hint: '사람 검수(HITL): issue 확정·원문 연결·병합. 후속 슬라이스가 채웁니다.' },
  publish: { title: '공개', noun: '결과 페이지(/r/token)', icon: '📢', hint: '검수 완료(reviewed ≥1) 스코프를 발행하고 공개 조회를 재검증합니다.' },
};

function scopeLabel(scope: Scope): string {
  const { level } = deepestScopeLevel(scope);
  if (level === 'topic') return '주제';
  if (level === 'session') return '회차';
  if (level === 'assembly') return '공론화';
  return '기관';
}

/**
 * 스코프 뷰 아웃렛. view 가 없으면 스코프 개요(자식 안내), 있으면 해당 패널.
 * 데이터 로드 골격: 마운트 시 "로드 대상 스코프"를 표시하고, 실제 페치는 후속 구현.
 */
export default function ScopeOutlet({ scope, publishScopeId }: { scope: Scope; publishScopeId?: string | null }) {
  const view = scope.view;
  if (!view) return <ScopeOverview scope={scope} />;
  return <ViewPanel view={view} scope={scope} publishScopeId={publishScopeId} />;
}

function ScopeOverview({ scope }: { scope: Scope }) {
  const { level } = deepestScopeLevel(scope);
  const views: readonly ViewName[] = level ? VIEWS_FOR_LEVEL[level] : [];

  return (
    <div>
      <div style={{ fontFamily: 'monospace', fontSize: 12, letterSpacing: '.14em', color: TEAL, textTransform: 'uppercase', marginBottom: 8 }}>
        Scope · {scopeLabel(scope)}
      </div>
      <h2 style={{ fontSize: 24, fontWeight: 800, color: NAVY, margin: '0 0 6px', letterSpacing: '-.01em' }}>
        이 {scopeLabel(scope)}에서 무엇을 볼까요?
      </h2>
      <p style={{ color: MUTED, fontSize: 15, margin: '0 0 20px' }}>
        {level ? '아래 뷰를 선택하면 이 스코프로 좁혀진 데이터가 열립니다.' : '좌측 트리에서 기관 아래 항목을 선택하세요.'}
      </p>
      {views.length > 0 ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(180px,1fr))', gap: 12 }}>
          {views.map((v) => (
            <div key={v} style={{ border: `2px solid ${LINE}`, borderRadius: 14, padding: '16px 18px', background: '#fff' }}>
              <div style={{ fontSize: 26, marginBottom: 6 }} aria-hidden="true">{VIEW_META[v].icon}</div>
              <div style={{ fontSize: 18, fontWeight: 800, color: NAVY }}>{VIEW_META[v].title}</div>
              <div style={{ fontSize: 13, color: MUTED, marginTop: 4 }}>{VIEW_META[v].noun}</div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ViewPanel({ view, scope, publishScopeId }: { view: ViewName; scope: Scope; publishScopeId?: string | null }) {
  const meta = VIEW_META[view];
  const { level, id } = deepestScopeLevel(scope);

  // 검수 뷰는 주제(topic) 스코프에서 실제 검수 콘솔을 마운트한다(핵심 화면).
  // 그 외 레벨에서는 placeholder 를 유지한다(검수는 주제 스코프 전용 — VIEWS_FOR_LEVEL).
  if (view === 'review') {
    return <ReviewConsole topicId={level === 'topic' ? id : null} />;
  }

  if (view === 'publish') {
    const resolvedScopeId = publishScopeId === undefined ? id : publishScopeId;
    return (
      <PublishConsole
        key={buildPublicationScopeKey(level, resolvedScopeId)}
        scope={level}
        scopeId={resolvedScopeId}
      />
    );
  }

  // 데이터 로드 골격 — 마운트 시 "이 스코프의 무엇을 로드할지"만 확정한다.
  // 실제 RPC 페치(issueList 등)는 후속 검수 콘솔/결과 슬라이스가 이 자리에서 연결한다.
  const [mountedAt] = useState(() => Date.now());
  useEffect(() => {
    // no-op: 마운트 지점 표식. 후속 슬라이스가 이 effect 에서 platform.ts 래퍼를 호출한다.
  }, [view, id]);

  return (
    <div>
      <div style={{ fontFamily: 'monospace', fontSize: 12, letterSpacing: '.14em', color: TEAL, textTransform: 'uppercase', marginBottom: 8 }}>
        {scopeLabel(scope)} · {meta.title}
      </div>
      <h2 style={{ fontSize: 24, fontWeight: 800, color: NAVY, margin: '0 0 6px', letterSpacing: '-.01em' }}>
        <span aria-hidden="true" style={{ marginRight: 8 }}>{meta.icon}</span>
        이 {scopeLabel(scope)}의 {meta.noun}
      </h2>
      <p style={{ color: MUTED, fontSize: 15, margin: '0 0 18px' }}>{meta.hint}</p>

      <div style={{ border: `2px dashed ${TEAL}`, borderRadius: 14, padding: '22px 20px', background: '#F1F7FA' }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: NAVY, marginBottom: 8 }}>데이터 로드 골격 (마운트 지점)</div>
        <ul style={{ margin: 0, paddingLeft: 18, color: MUTED, fontSize: 14, lineHeight: 1.7 }}>
          <li>스코프 레벨: <b style={{ color: NAVY }}>{level ?? '(미선택)'}</b></li>
          <li>스코프 id: <code style={{ color: NAVY }}>{id ?? '—'}</code></li>
          <li>연결 예정 래퍼: <code style={{ color: NAVY }}>{wrapperHint(view)}</code></li>
        </ul>
      </div>
      <p style={{ marginTop: 12, fontSize: 12, color: '#9ca3af' }} aria-hidden="true">mounted {new Date(mountedAt).toLocaleTimeString('ko-KR')}</p>
    </div>
  );
}

function wrapperHint(view: ViewName): string {
  switch (view) {
    case 'record': return 'submission_get / topic_list';
    case 'vote': return 'ballot RPC (P2 이후)';
    case 'analyze': return 'issueList(code, topicId)';
    case 'review': return 'issueList / issueUpsert / issueLinkSet / issueMerge / issueReview';
    case 'publish': return 'resultPublish / resultUnpublish / resultGet';
  }
}
