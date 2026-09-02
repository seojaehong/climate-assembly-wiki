import { describe, it, expect } from 'vitest';
import {
  parseScopePath,
  buildScopePath,
  flattenTree,
  activePath,
  breadcrumb,
  isNodeOnPath,
  isView,
  deepestScopeLevel,
  deepestViewScopeLevel,
  deepestDataScopeTarget,
  topicTargetsForScope,
  sessionTargetsForScope,
  sessionTopicGroupsForScope,
  scopePathContext,
  scopeWithValidView,
  SCOPE_KEYS,
  VIEWS,
  VIEWS_FOR_LEVEL,
  type Scope,
  type TreeNode,
} from './platform-nav-logic';

// ── 픽스처 트리: org → assembly → session → topic ──────────────────────
// discussion_topic 은 slug 가 없다 → id 는 uuid 도 될 수 있음(불투명 문자열로만 다룸).
const tree: TreeNode = {
  kind: 'org',
  id: 'kcrc',
  dataId: 'org-uuid',
  label: '한국갈등해결센터',
  children: [
    {
      kind: 'assembly',
      id: 'climate-2026',
      dataId: 'assembly-uuid',
      label: '2026 기후시민회의',
      children: [
        {
          kind: 'session',
          id: 'r5',
          dataId: 'session-uuid-5',
          label: '제5차 회의',
          children: [
            { kind: 'topic', id: 't-uuid-1', dataId: 't-uuid-1', label: '에너지 전환', children: [] },
            { kind: 'topic', id: 't-uuid-2', dataId: 't-uuid-2', label: '수송 부문', children: [] },
          ],
        },
        { kind: 'session', id: 'r6', dataId: 'session-uuid-6', label: '제6차 회의', children: [] },
      ],
    },
  ],
};

describe('parseScopePath', () => {
  it('/platform 접두사와 슬래시를 흡수한다', () => {
    expect(parseScopePath('/platform')).toEqual({});
    expect(parseScopePath('/platform/')).toEqual({});
  });

  it('key/id 쌍을 사다리대로 파싱한다', () => {
    expect(parseScopePath('/platform/o/kcrc/c/climate-2026/s/r5/t/t-uuid-1')).toEqual({
      o: 'kcrc',
      c: 'climate-2026',
      s: 'r5',
      t: 't-uuid-1',
    });
  });

  it('말미 view 세그먼트를 view 로 잡는다', () => {
    expect(parseScopePath('/platform/o/kcrc/c/climate-2026/s/r5/t/t-uuid-1/review')).toEqual({
      o: 'kcrc',
      c: 'climate-2026',
      s: 'r5',
      t: 't-uuid-1',
      view: 'review',
    });
  });

  it('없는 단(f 예약)을 건너뛴다 — tolerant', () => {
    // f 없이 c → s 로 바로 내려가도 파싱된다
    expect(parseScopePath('/platform/o/kcrc/s/r5')).toEqual({ o: 'kcrc', s: 'r5' });
  });

  it('접두사 없는 경로도 파싱한다', () => {
    expect(parseScopePath('/o/kcrc/c/climate-2026')).toEqual({ o: 'kcrc', c: 'climate-2026' });
  });

  it('id 없는 꼬리 키·미지 세그먼트는 무시한다', () => {
    expect(parseScopePath('/platform/o/kcrc/t')).toEqual({ o: 'kcrc' });
    expect(parseScopePath('/platform/o/kcrc/garbage/x')).toEqual({ o: 'kcrc' });
  });

  it('query·hash 를 떼어낸다', () => {
    expect(parseScopePath('/platform/o/kcrc?tab=1#x')).toEqual({ o: 'kcrc' });
  });
});

describe('buildScopePath', () => {
  it('스코프를 사다리 순서 경로로 만든다', () => {
    const s: Scope = { o: 'kcrc', c: 'climate-2026', s: 'r5', t: 't-uuid-1', view: 'analyze' };
    expect(buildScopePath(s)).toBe('/platform/o/kcrc/c/climate-2026/s/r5/t/t-uuid-1/analyze');
  });

  it('빈 스코프는 기저 경로', () => {
    expect(buildScopePath({})).toBe('/platform');
  });

  it('parse ∘ build 왕복이 스코프를 보존한다', () => {
    const cases: Scope[] = [
      { o: 'kcrc' },
      { o: 'kcrc', view: 'access' },
      { o: 'kcrc', c: 'climate-2026' },
      { o: 'kcrc', c: 'climate-2026', s: 'r5', t: 't-uuid-2' },
      { o: 'kcrc', c: 'climate-2026', s: 'r5', t: 't-uuid-2', view: 'publish' },
      { o: 'kcrc', c: 'climate-2026', s: 'r5', view: 'design' },
    ];
    for (const s of cases) expect(parseScopePath(buildScopePath(s))).toEqual(s);
  });

  it('키 순서와 무관하게 사다리 순서로 직렬화한다', () => {
    const s: Scope = { t: 't-uuid-1', o: 'kcrc', s: 'r5', c: 'climate-2026' };
    expect(buildScopePath(s)).toBe('/platform/o/kcrc/c/climate-2026/s/r5/t/t-uuid-1');
  });
});

describe('flattenTree', () => {
  it('전위 순회로 depth 와 누적 scope 를 실어 준다', () => {
    const flat = flattenTree(tree);
    expect(flat.map((f) => [f.node.kind, f.depth])).toEqual([
      ['org', 0],
      ['assembly', 1],
      ['session', 2],
      ['topic', 3],
      ['topic', 3],
      ['session', 2],
    ]);
  });

  it('리프의 누적 scope 가 조상 선택을 전부 담는다', () => {
    const flat = flattenTree(tree);
    const topic1 = flat.find((f) => f.node.id === 't-uuid-1')!;
    expect(topic1.scope).toEqual({ o: 'kcrc', c: 'climate-2026', s: 'r5', t: 't-uuid-1' });
  });

  it('null 트리는 빈 배열', () => {
    expect(flattenTree(null)).toEqual([]);
  });

  it('누적 scope 는 buildScopePath 로 바로 라우팅 가능하다', () => {
    const flat = flattenTree(tree);
    const topic2 = flat.find((f) => f.node.id === 't-uuid-2')!;
    expect(buildScopePath(topic2.scope)).toBe('/platform/o/kcrc/c/climate-2026/s/r5/t/t-uuid-2');
  });
});

describe('isNodeOnPath', () => {
  it('그 단의 선택이 이 노드면 true', () => {
    const scope: Scope = { o: 'kcrc', c: 'climate-2026', s: 'r5' };
    expect(isNodeOnPath(tree, scope)).toBe(true); // org
    expect(isNodeOnPath(tree.children[0], scope)).toBe(true); // assembly
    expect(isNodeOnPath(tree.children[0].children[1], scope)).toBe(false); // r6 세션은 미선택
  });
});

describe('activePath', () => {
  it('루트→선택 리프 노드 경로를 반환한다', () => {
    const scope: Scope = { o: 'kcrc', c: 'climate-2026', s: 'r5', t: 't-uuid-2' };
    expect(activePath(tree, scope).map((n) => n.id)).toEqual([
      'kcrc',
      'climate-2026',
      'r5',
      't-uuid-2',
    ]);
  });

  it('부분 스코프는 도달 가능한 데까지만', () => {
    expect(activePath(tree, { o: 'kcrc', c: 'climate-2026' }).map((n) => n.id)).toEqual([
      'kcrc',
      'climate-2026',
    ]);
  });

  it('null 트리는 빈 경로', () => {
    expect(activePath(null, { o: 'kcrc' })).toEqual([]);
  });
});

describe('breadcrumb', () => {
  it('데이터 경로를 라벨·누적 스코프와 함께 만든다', () => {
    const scope: Scope = { o: 'kcrc', c: 'climate-2026', s: 'r5', t: 't-uuid-1' };
    const crumbs = breadcrumb(tree, scope);
    expect(crumbs.map((c) => c.label)).toEqual([
      '한국갈등해결센터',
      '2026 기후시민회의',
      '제5차 회의',
      '에너지 전환',
    ]);
    // 마지막 크럼의 스코프는 전체, 첫 크럼은 org 만
    expect(crumbs[0].scope).toEqual({ o: 'kcrc' });
    expect(crumbs[3].scope).toEqual(scope);
  });
});

describe('deepestScopeLevel', () => {
  it('가장 깊은 선택의 레벨·id 를 판정한다', () => {
    expect(deepestScopeLevel({ o: 'k', c: 'a', s: 'r5', t: 't1' })).toEqual({ level: 'topic', id: 't1' });
    expect(deepestScopeLevel({ o: 'k', c: 'a', s: 'r5' })).toEqual({ level: 'session', id: 'r5' });
    expect(deepestScopeLevel({ o: 'k', c: 'a' })).toEqual({ level: 'assembly', id: 'a' });
    expect(deepestScopeLevel({ o: 'k' })).toEqual({ level: null, id: null });
  });
});

describe('deepestViewScopeLevel', () => {
  it('기관 루트만 접근 관리 navigation scope로 판정한다', () => {
    expect(deepestViewScopeLevel({ o: 'k' })).toEqual({ level: 'org', id: 'k' });
    expect(deepestViewScopeLevel({})).toEqual({ level: null, id: null });
  });
});

describe('scopePathContext', () => {
  it('활성 데이터 경로의 canonical ID와 표시명을 계층별로 보존한다', () => {
    expect(scopePathContext(tree, {
      o: 'kcrc', c: 'climate-2026', s: 'r5', t: 't-uuid-1',
    })).toEqual({
      org: { id: 'org-uuid', label: '한국갈등해결센터' },
      assembly: { id: 'assembly-uuid', label: '2026 기후시민회의' },
      session: { id: 'session-uuid-5', label: '제5차 회의' },
      topic: { id: 't-uuid-1', label: '에너지 전환' },
    });
  });
});

describe('scopeWithValidView', () => {
  it('대상 스코프가 지원하는 현재 보기는 보존한다', () => {
    expect(scopeWithValidView({ o: 'k', c: 'a', s: 'r5' }, 'publish')).toEqual({
      o: 'k', c: 'a', s: 'r5', view: 'publish',
    });
  });

  it('대상 스코프가 지원하지 않는 보기와 기관 루트의 보기는 제거한다', () => {
    expect(scopeWithValidView({ o: 'k', c: 'a', s: 'r5' }, 'review')).toEqual({
      o: 'k', c: 'a', s: 'r5',
    });
    expect(scopeWithValidView({ o: 'k' }, 'publish')).toEqual({ o: 'k' });
  });

  it('기관 루트의 접근 관리만 보존한다', () => {
    expect(scopeWithValidView({ o: 'k' }, 'access')).toEqual({ o: 'k', view: 'access' });
    expect(scopeWithValidView({ o: 'k', c: 'a' }, 'access')).toEqual({ o: 'k', c: 'a' });
  });
});

describe('deepestDataScopeTarget', () => {
  it('라우트 slug 대신 RPC가 요구하는 DB UUID를 반환한다', () => {
    expect(deepestDataScopeTarget(tree, { o: 'kcrc', c: 'climate-2026' }))
      .toEqual({ level: 'assembly', id: 'assembly-uuid' });
    expect(deepestDataScopeTarget(tree, { o: 'kcrc', c: 'climate-2026', s: 'r5' }))
      .toEqual({ level: 'session', id: 'session-uuid-5' });
    expect(deepestDataScopeTarget(tree, { o: 'kcrc', c: 'climate-2026', s: 'r5', t: 't-uuid-1' }))
      .toEqual({ level: 'topic', id: 't-uuid-1' });
  });

  it('트리가 아직 없으면 slug를 UUID로 오인하지 않는다', () => {
    expect(deepestDataScopeTarget(null, { o: 'kcrc', c: 'climate-2026', s: 'r5' }))
      .toEqual({ level: 'session', id: null });
  });
});

describe('topicTargetsForScope', () => {
  it('선택한 회차의 주제를 표시명과 canonical UUID로 반환한다', () => {
    expect(topicTargetsForScope(tree, { o: 'kcrc', c: 'climate-2026', s: 'r5' })).toEqual([
      { id: 't-uuid-1', label: '에너지 전환' },
      { id: 't-uuid-2', label: '수송 부문' },
    ]);
  });
});

describe('sessionTargetsForScope', () => {
  it('선택한 회차를 표시명과 canonical UUID로 반환한다', () => {
    expect(sessionTargetsForScope(tree, { o: 'kcrc', c: 'climate-2026', s: 'r5' })).toEqual([
      { id: 'session-uuid-5', label: '제5차 회의' },
    ]);
  });

  it('선택한 공론화의 직속 회차를 트리 순서대로 반환한다', () => {
    expect(sessionTargetsForScope(tree, { o: 'kcrc', c: 'climate-2026' })).toEqual([
      { id: 'session-uuid-5', label: '제5차 회의' },
      { id: 'session-uuid-6', label: '제6차 회의' },
    ]);
  });
});

describe('sessionTopicGroupsForScope', () => {
  it('공론화의 회차와 주제를 canonical UUID·표시명으로 보존한다', () => {
    expect(sessionTopicGroupsForScope(tree, { o: 'kcrc', c: 'climate-2026' })).toEqual([
      {
        id: 'session-uuid-5',
        label: '제5차 회의',
        topics: [
          { id: 't-uuid-1', label: '에너지 전환' },
          { id: 't-uuid-2', label: '수송 부문' },
        ],
      },
      { id: 'session-uuid-6', label: '제6차 회의', topics: [] },
    ]);
  });
});

describe('VIEWS_FOR_LEVEL (단일 원천)', () => {
  it('모든 레벨의 뷰가 VIEWS 부분집합이다(오타 뷰명 차단)', () => {
    for (const level of ['org', 'topic', 'session', 'assembly'] as const) {
      for (const v of VIEWS_FOR_LEVEL[level]) {
        expect(VIEWS).toContain(v);
      }
    }
  });
  it('검수(review)는 주제 스코프에만, 공개(publish)는 전 레벨에 있다', () => {
    expect(VIEWS_FOR_LEVEL.org).toEqual(['access', 'record']);
    expect(VIEWS_FOR_LEVEL.topic).toContain('review');
    expect(VIEWS_FOR_LEVEL.session).not.toContain('review');
    expect(VIEWS_FOR_LEVEL.assembly).not.toContain('review');
    expect(VIEWS_FOR_LEVEL.topic).toContain('publish');
    expect(VIEWS_FOR_LEVEL.session).toContain('publish');
    expect(VIEWS_FOR_LEVEL.assembly).toContain('publish');
    expect(VIEWS_FOR_LEVEL.topic).not.toContain('design');
    expect(VIEWS_FOR_LEVEL.session).toContain('design');
    expect(VIEWS_FOR_LEVEL.assembly).toContain('design');
    expect(VIEWS_FOR_LEVEL.assembly).toContain('record');
  });
});

describe('isView / SCOPE_KEYS', () => {
  it('알려진 view 만 인정', () => {
    expect(isView('review')).toBe(true);
    expect(isView('publish')).toBe(true);
    expect(isView('design')).toBe(true);
    expect(isView('access')).toBe(true);
    expect(isView('nope')).toBe(false);
  });
  it('사다리 키 순서 고정', () => {
    expect(SCOPE_KEYS).toEqual(['o', 'c', 'f', 's', 't']);
  });
});
