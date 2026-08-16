import accessPlanContract from './access-plan-contract.json';

export const STAFF_ROLES = ['org_admin', 'operator', 'hq', 'facilitator'] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export interface InvitationDraft {
  email: string;
  role: StaffRole;
}

export interface MembershipDraft {
  userId: string;
  role: StaffRole;
}

export interface OrganizationRef {
  id: string;
  label: string;
}

export interface OrganizationAccessPlan {
  schemaVersion: 1;
  kind: 'platform-organization-access-plan';
  organization: OrganizationRef;
  invitations: InvitationDraft[];
  memberships: MembershipDraft[];
  dryRun: true;
  authAccountsCreated: false;
  invitationsSent: false;
  databaseMutationExecuted: false;
  requiresApproval: true;
}

export type AccessPlanResult =
  | { ok: true; plan: OrganizationAccessPlan; error: null }
  | { ok: false; plan: null; error: string };

function validateAccessPlanContract(): void {
  if (
    accessPlanContract.schemaVersion !== 1
    || accessPlanContract.kind !== 'platform-organization-access-plan'
    || JSON.stringify(accessPlanContract.roles) !== JSON.stringify(STAFF_ROLES)
    || accessPlanContract.maxBytes !== 256 * 1024
    || accessPlanContract.boundaries.dryRun !== true
    || accessPlanContract.boundaries.authAccountsCreated !== false
    || accessPlanContract.boundaries.invitationsSent !== false
    || accessPlanContract.boundaries.databaseMutationExecuted !== false
    || accessPlanContract.boundaries.requiresApproval !== true
  ) {
    throw new Error('Organization access plan contract is invalid');
  }
}

validateAccessPlanContract();

export const ACCESS_PLAN_IMPORT_BYTES = accessPlanContract.maxBytes;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isRole(value: string): value is StaffRole {
  return (STAFF_ROLES as readonly string[]).includes(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length && actual.every((key, index) => key === sortedExpected[index]);
}

function canonicalEmail(value: string): string | null {
  const email = value.trim().toLowerCase();
  return email.length >= 3 && email.length <= 200 && EMAIL_PATTERN.test(email) ? email : null;
}

function canonicalUuid(value: string): string | null {
  const uuid = value.trim().toLowerCase();
  return UUID_PATTERN.test(uuid) ? uuid : null;
}

export function buildOrganizationAccessPlan(input: {
  organization: OrganizationRef | null;
  invitations: readonly InvitationDraft[];
  memberships: readonly MembershipDraft[];
}): AccessPlanResult {
  const orgId = canonicalUuid(input.organization?.id ?? '');
  const orgLabel = input.organization?.label.trim() ?? '';
  if (!orgId || !orgLabel) return { ok: false, plan: null, error: '기관의 canonical ID와 이름을 확인할 수 없습니다.' };

  const invitations: InvitationDraft[] = [];
  const invitationKeys = new Set<string>();
  for (const draft of input.invitations) {
    const email = canonicalEmail(draft.email);
    if (!email || !isRole(draft.role)) return { ok: false, plan: null, error: '초대 이메일과 역할을 확인하세요.' };
    const key = `${email}:${draft.role}`;
    if (invitationKeys.has(key)) return { ok: false, plan: null, error: '같은 이메일과 역할의 초대가 중복되었습니다.' };
    invitationKeys.add(key);
    invitations.push({ email, role: draft.role });
  }

  const memberships: MembershipDraft[] = [];
  const membershipKeys = new Set<string>();
  for (const draft of input.memberships) {
    const userId = canonicalUuid(draft.userId);
    if (!userId || !isRole(draft.role)) return { ok: false, plan: null, error: '기존 Auth 사용자 ID와 역할을 확인하세요.' };
    const key = `${userId}:${draft.role}`;
    if (membershipKeys.has(key)) return { ok: false, plan: null, error: '같은 사용자와 역할의 membership 계획이 중복되었습니다.' };
    membershipKeys.add(key);
    memberships.push({ userId, role: draft.role });
  }

  if (invitations.length + memberships.length === 0) {
    return { ok: false, plan: null, error: '초대 또는 membership 계획을 한 건 이상 추가하세요.' };
  }

  return {
    ok: true,
    error: null,
    plan: {
      schemaVersion: 1,
      kind: 'platform-organization-access-plan',
      organization: { id: orgId, label: orgLabel },
      invitations,
      memberships,
      dryRun: true,
      authAccountsCreated: false,
      invitationsSent: false,
      databaseMutationExecuted: false,
      requiresApproval: true,
    },
  };
}

/** Revalidates a downloaded approval plan before restoring it into the current organization workspace. */
export function parseOrganizationAccessPlanImport(
  content: string,
  expectedOrganization: OrganizationRef | null,
): AccessPlanResult {
  let value: unknown;
  try {
    value = JSON.parse(content) as unknown;
  } catch {
    return { ok: false, plan: null, error: '접근 계획 JSON 형식 또는 내용이 올바르지 않습니다.' };
  }

  const topLevelKeys = [
    'authAccountsCreated', 'databaseMutationExecuted', 'dryRun', 'invitations', 'invitationsSent',
    'kind', 'memberships', 'organization', 'requiresApproval', 'schemaVersion',
  ] as const;
  if (!isRecord(value) || !hasExactKeys(value, topLevelKeys)) {
    return { ok: false, plan: null, error: '접근 계획 JSON 형식 또는 내용이 올바르지 않습니다.' };
  }
  if (
    value.schemaVersion !== 1
    || value.kind !== 'platform-organization-access-plan'
    || value.dryRun !== true
    || value.authAccountsCreated !== false
    || value.invitationsSent !== false
    || value.databaseMutationExecuted !== false
    || value.requiresApproval !== true
    || !isRecord(value.organization)
    || !hasExactKeys(value.organization, ['id', 'label'])
    || typeof value.organization.id !== 'string'
    || typeof value.organization.label !== 'string'
    || !Array.isArray(value.invitations)
    || !Array.isArray(value.memberships)
  ) {
    return { ok: false, plan: null, error: '접근 계획 JSON 형식 또는 내용이 올바르지 않습니다.' };
  }

  const invitations: InvitationDraft[] = [];
  for (const item of value.invitations) {
    if (!isRecord(item) || !hasExactKeys(item, ['email', 'role'])
      || typeof item.email !== 'string' || typeof item.role !== 'string' || !isRole(item.role)) {
      return { ok: false, plan: null, error: '접근 계획 JSON 형식 또는 내용이 올바르지 않습니다.' };
    }
    invitations.push({ email: item.email, role: item.role });
  }

  const memberships: MembershipDraft[] = [];
  for (const item of value.memberships) {
    if (!isRecord(item) || !hasExactKeys(item, ['role', 'userId'])
      || typeof item.userId !== 'string' || typeof item.role !== 'string' || !isRole(item.role)) {
      return { ok: false, plan: null, error: '접근 계획 JSON 형식 또는 내용이 올바르지 않습니다.' };
    }
    memberships.push({ userId: item.userId, role: item.role });
  }

  const importedOrganization = { id: value.organization.id, label: value.organization.label };
  const result = buildOrganizationAccessPlan({ organization: importedOrganization, invitations, memberships });
  if (!result.ok) return { ok: false, plan: null, error: '접근 계획 JSON 형식 또는 내용이 올바르지 않습니다.' };

  const expectedId = canonicalUuid(expectedOrganization?.id ?? '');
  const expectedLabel = expectedOrganization?.label.trim() ?? '';
  if (!expectedId || !expectedLabel || result.plan.organization.id !== expectedId || result.plan.organization.label !== expectedLabel) {
    return { ok: false, plan: null, error: '현재 기관과 다른 접근 계획입니다.' };
  }

  const canonicalPlan = result.plan;
  if (
    importedOrganization.id !== canonicalPlan.organization.id
    || importedOrganization.label !== canonicalPlan.organization.label
    || JSON.stringify(value.invitations) !== JSON.stringify(canonicalPlan.invitations)
    || JSON.stringify(value.memberships) !== JSON.stringify(canonicalPlan.memberships)
  ) {
    return { ok: false, plan: null, error: '접근 계획 JSON 형식 또는 내용이 올바르지 않습니다.' };
  }
  return { ok: true, plan: canonicalPlan, error: null };
}

export function accessPlanFilename(organization: OrganizationRef): string {
  const safeLabel = organization.label.trim().replace(/[^0-9A-Za-z가-힣_-]+/g, '-').replace(/^-+|-+$/g, '') || 'organization';
  return `${safeLabel}_${organization.id}_access-plan.json`;
}
