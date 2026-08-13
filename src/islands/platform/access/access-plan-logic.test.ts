import { describe, expect, it, vi } from 'vitest';
import { completeAccessPlanDownload } from './AccessConsole';
import { accessPlanFilename, buildOrganizationAccessPlan } from './access-plan-logic';

const organization = { id: '11111111-1111-4111-8111-111111111111', label: '기후 시민회의' };

describe('buildOrganizationAccessPlan', () => {
  it('canonical organization과 승인 전 mutation 경계를 보존한다', () => {
    const result = buildOrganizationAccessPlan({
      organization,
      invitations: [{ email: ' Staff@Example.COM ', role: 'operator' }],
      memberships: [{ userId: '22222222-2222-4222-8222-222222222222', role: 'facilitator' }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(result.plan).toMatchObject({
      schemaVersion: 1,
      kind: 'platform-organization-access-plan',
      organization,
      invitations: [{ email: 'staff@example.com', role: 'operator' }],
      memberships: [{ userId: '22222222-2222-4222-8222-222222222222', role: 'facilitator' }],
      dryRun: true,
      authAccountsCreated: false,
      invitationsSent: false,
      databaseMutationExecuted: false,
      requiresApproval: true,
    });
  });

  it('기관·항목 누락과 잘못된 입력을 fail-closed 처리한다', () => {
    expect(buildOrganizationAccessPlan({ organization: null, invitations: [], memberships: [] }).ok).toBe(false);
    expect(buildOrganizationAccessPlan({ organization, invitations: [], memberships: [] }).ok).toBe(false);
    expect(buildOrganizationAccessPlan({ organization, invitations: [{ email: 'bad', role: 'operator' }], memberships: [] }).ok).toBe(false);
    expect(buildOrganizationAccessPlan({ organization, invitations: [], memberships: [{ userId: 'bad', role: 'hq' }] }).ok).toBe(false);
  });

  it('동일 이메일·사용자와 역할의 중복을 거부한다', () => {
    expect(buildOrganizationAccessPlan({
      organization,
      invitations: [{ email: 'staff@example.com', role: 'operator' }, { email: 'STAFF@example.com', role: 'operator' }],
      memberships: [],
    }).ok).toBe(false);
    expect(buildOrganizationAccessPlan({
      organization,
      invitations: [],
      memberships: [
        { userId: '22222222-2222-4222-8222-222222222222', role: 'hq' },
        { userId: '22222222-2222-4222-8222-222222222222', role: 'hq' },
      ],
    }).ok).toBe(false);
  });

  it('기관 label과 canonical ID를 파일명에 보존한다', () => {
    expect(accessPlanFilename(organization)).toBe('기후-시민회의_11111111-1111-4111-8111-111111111111_access-plan.json');
  });
});

describe('completeAccessPlanDownload', () => {
  const result = buildOrganizationAccessPlan({ organization, invitations: [{ email: 'staff@example.com', role: 'org_admin' }], memberships: [] });
  if (!result.ok) throw new Error(result.error);

  it('성공 상태를 반환한다', () => {
    const downloader = vi.fn();
    expect(completeAccessPlanDownload(result.plan, downloader)).toEqual({ ok: true, message: '검증된 접근 계획 JSON을 다운로드했습니다.' });
    expect(downloader).toHaveBeenCalledWith(result.plan);
  });

  it('다운로드 예외를 로그하고 오류 상태를 반환한다', () => {
    const error = new Error('download failed');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(completeAccessPlanDownload(result.plan, () => { throw error; })).toEqual({ ok: false, message: '접근 계획을 다운로드하지 못했습니다. 다시 시도하세요.' });
    expect(consoleError).toHaveBeenCalledWith('Failed to download organization access plan', error);
    consoleError.mockRestore();
  });
});
