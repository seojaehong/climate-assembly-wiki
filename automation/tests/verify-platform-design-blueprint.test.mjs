import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ACCESS_PLAN_ROUTE,
  DESIGN_BLUEPRINT_ROUTE,
  PUBLISH_CONSOLE_ROUTE,
  REVIEW_CONSOLE_ROUTE,
  isDatabaseMutationRequest,
  validateDownloadedAccessPlan,
  validateDownloadedBlueprint,
} from '../verify-platform-design-blueprint.mjs';

const validAccessPlan = {
  schemaVersion: 1,
  kind: 'platform-organization-access-plan',
  organization: { id: '00000000-0000-4000-8000-000000000002', label: '내 기관' },
  invitations: [{ email: 'staff@example.invalid', role: 'org_admin' }],
  memberships: [{ userId: '00000000-0000-4000-8000-000000000001', role: 'hq' }],
  dryRun: true,
  authAccountsCreated: false,
  invitationsSent: false,
  databaseMutationExecuted: false,
  requiresApproval: true,
};

const validBlueprint = {
  schemaVersion: 4,
  kind: 'platform-design-blueprint',
  dryRun: true,
  databaseMutationExecuted: false,
  requiresApproval: true,
  assembly: {
    title: '기후 공론화 2026',
    slug: 'climate-2026',
    purpose: '감축과 적응의 실행 조건을 시민과 함께 검토한다.',
    mode: 'vote',
    config: { readiness: ['topics_open', 'teams_active'] },
  },
  sessions: [
    {
      ordinal: 1,
      title: '감축 숙의',
      slug: 'mitigation-session',
      heldOn: '2026-09-12',
      topics: [{ ordinal: 1, prompt: '감축 경로' }],
      teams: [{ ordinal: 1, name: '1조', plannedCapacity: 12 }],
    },
    {
      ordinal: 2,
      title: '적응 숙의',
      slug: 'adaptation-session',
      heldOn: '2026-09-13',
      topics: [{ ordinal: 1, prompt: '적응 정책' }],
      teams: [{ ordinal: 1, name: '1조', plannedCapacity: 10 }],
    },
  ],
  stats: { sessionCount: 2, topicCount: 2, teamCount: 2, participantCount: 22 },
};

describe('validateDownloadedBlueprint', () => {
  it('accepts the production multi-session dry-run contract', () => {
    expect(validateDownloadedBlueprint(validBlueprint)).toEqual({
      sessionCount: 2,
      topicCount: 2,
      teamCount: 2,
      participantCount: 22,
    });
  });

  it('rejects an export that can mutate data or bypass approval', () => {
    expect(() => validateDownloadedBlueprint({
      ...validBlueprint,
      databaseMutationExecuted: true,
    })).toThrow('Downloaded blueprint violates the approval boundary');
    expect(() => validateDownloadedBlueprint({
      ...validBlueprint,
      requiresApproval: false,
    })).toThrow('Downloaded blueprint violates the approval boundary');
  });

  it('rejects hierarchy damage even when the declared stats are unchanged', () => {
    const damaged = structuredClone(validBlueprint);
    damaged.sessions[1].topics = [];
    expect(() => validateDownloadedBlueprint(damaged)).toThrow('Downloaded blueprint hierarchy does not match the verified input');
  });

  it('rejects readiness policy damage even when the hierarchy is unchanged', () => {
    const damaged = structuredClone(validBlueprint);
    damaged.assembly.config.readiness = ['topics_open', 'roster_loaded'];
    expect(() => validateDownloadedBlueprint(damaged)).toThrow('Downloaded blueprint hierarchy does not match the verified input');
  });
});

describe('validateDownloadedAccessPlan', () => {
  it('accepts the organization-bound non-mutating plan', () => {
    expect(validateDownloadedAccessPlan(validAccessPlan)).toEqual({ invitationCount: 1, membershipCount: 1 });
  });

  it('rejects mutation, delivery, organization, and payload drift', () => {
    expect(() => validateDownloadedAccessPlan({ ...validAccessPlan, invitationsSent: true }))
      .toThrow('Downloaded access plan violates the approval boundary');
    expect(() => validateDownloadedAccessPlan({
      ...validAccessPlan,
      organization: { ...validAccessPlan.organization, id: '00000000-0000-4000-8000-000000000099' },
    })).toThrow('Downloaded access plan organization does not match the authenticated fixture');
    expect(() => validateDownloadedAccessPlan({
      ...validAccessPlan,
      memberships: [{ ...validAccessPlan.memberships[0], role: 'operator' }],
    })).toThrow('Downloaded access plan membership does not match the verified input');
  });
});

describe('isDatabaseMutationRequest', () => {
  it('allows fixture read RPCs but blocks REST mutations', () => {
    expect(isDatabaseMutationRequest('POST', '/rest/v1/rpc/org_of_uid')).toBe(false);
    expect(isDatabaseMutationRequest('POST', '/rest/v1/rpc/readiness_check')).toBe(false);
    expect(isDatabaseMutationRequest('DELETE', '/rest/v1/rpc/readiness_check')).toBe(true);
    expect(isDatabaseMutationRequest('GET', '/rest/v1/assembly')).toBe(false);
    expect(isDatabaseMutationRequest('POST', '/rest/v1/assembly')).toBe(true);
    expect(isDatabaseMutationRequest('PATCH', '/rest/v1/session')).toBe(true);
    expect(isDatabaseMutationRequest('DELETE', '/rest/v1/discussion_topic')).toBe(true);
  });
});

describe('design blueprint browser CI contract', () => {
  it('runs the real authenticated interaction after the preview is ready', () => {
    const workflow = readFileSync(
      new URL('../../.github/workflows/platform-accessibility.yml', import.meta.url),
      'utf8',
    );
    expect(DESIGN_BLUEPRINT_ROUTE).toBe('/platform/o/00000000-0000-4000-8000-000000000002/c/audit-assembly/design');
    expect(ACCESS_PLAN_ROUTE).toBe('/platform/o/00000000-0000-4000-8000-000000000002/access');
    expect(REVIEW_CONSOLE_ROUTE).toContain('/t/00000000-0000-4000-8000-000000000005/review');
    expect(PUBLISH_CONSOLE_ROUTE).toContain('/t/00000000-0000-4000-8000-000000000005/publish');
    expect(workflow).toContain('node verify-platform-design-blueprint.mjs');
    expect(workflow).toContain('Verify auth, access, design, review, and publish interactions');
    expect(workflow).toContain('.artifacts/platform-design-blueprint-browser.json');
    expect(workflow.indexOf('Start preview server')).toBeLessThan(
      workflow.indexOf('node verify-platform-design-blueprint.mjs'),
    );
    const verifier = readFileSync(
      new URL('../verify-platform-design-blueprint.mjs', import.meta.url),
      'utf8',
    );
    expect(verifier).toContain("page.setViewportSize({ width: 360, height: 800 })");
    expect(verifier).toContain("getByRole('region', { name: '설계 청사진 회차별 구성 표' })");
    expect(verifier).toContain("blueprintTableRegion.press('End')");
    expect(verifier).toContain('button.click();\n      button.click();');
    expect(verifier).toContain("getByRole('button', { name: '검수 경합 주제 B', exact: true })");
    expect(verifier).toContain('reviewRequests.length === 1');
    expect(verifier).toContain("getByText('검수 완료로 확정했습니다.', { exact: true }).count() === 0");
    expect(verifier).toContain('publishRequests.length === 1');
    expect(verifier).toContain('unpublishRequests.length === 1');
    expect(verifier).toContain("getByLabel('공개 결과 제목').isDisabled()");
    expect(verifier).toContain('loginRequests.length === 1');
    expect(verifier).toContain("getByRole('form', { name: '운영진 로그인' })");
    expect(verifier).toContain('element.requestSubmit();');
    expect(verifier).toContain('verifyPlatformSessionIsolation({ browser, origin, timeoutMs })');
    expect(verifier).toContain('verifyPlatformAccessPlan({ browser, origin, timeoutMs })');
    expect(verifier).toContain("getByRole('heading', { name: '승인 전 접근 계획' })");
    expect(verifier).toContain("getByRole('alert').filter({ hasText: '같은 이메일과 역할의 초대가 중복되었습니다.' })");
    expect(verifier).toContain('localDraftClearedOnReload');
    expect(verifier).toContain("getByLabel('HQ 인증 토큰').count() === 0");
    expect(verifier).toContain("getByLabel('공개 결과 제목').count() === 0");
    expect(verifier).toContain("sessionStorage.getItem('climate_vote_hq_attendance_token') === null");
    expect(verifier).toContain("sessionStorage.getItem('climate_vote_hq_gate_actor') === null");
    expect(verifier).toContain("pathname.replace(/\\/+$/, '') === '/platform'");
    expect(verifier).toContain('logoutRequests.length !== 1');
    expect(verifier).toContain('schemaVersion: 9');
  });
});
