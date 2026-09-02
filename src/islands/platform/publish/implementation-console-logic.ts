import implementationStatusContract from '../../result/implementation-status-contract.json';

export const IMPLEMENTATION_STATUSES = [
  'under_review',
  'planned',
  'in_progress',
  'implemented',
  'not_pursued',
] as const;

export type ImplementationStatus = (typeof IMPLEMENTATION_STATUSES)[number];

export interface ImplementationRecord {
  status: ImplementationStatus;
  responsible_body: string;
  updated_at: string;
  summary: string;
  evidence_url: string | null;
}

export interface ImplementationMutation {
  issue_id: string;
  implementation: ImplementationRecord;
}

export interface ImplementationFormInput {
  issueId: string;
  status: string;
  responsibleBody: string;
  updatedAt: string;
  summary: string;
  evidenceUrl: string;
}

export interface PublishedImplementationIssue {
  id: string;
  label: string;
  implementation: ImplementationRecord | null;
}

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isImplementationStatus(value: string): value is ImplementationStatus {
  return IMPLEMENTATION_STATUSES.some((status) => status === value);
}

function requiredText(value: string, label: string, maxLength: number): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label}을(를) 입력해 주세요.`);
  if (normalized.length > maxLength) throw new Error(`${label}은(는) ${maxLength}자 이하여야 합니다.`);
  return normalized;
}

function canonicalTimestamp(value: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error('기관 갱신 시각을 입력해 주세요.');
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) throw new Error('기관 갱신 시각 형식을 확인해 주세요.');
  const canonical = date.toISOString();
  const pattern = new RegExp(implementationStatusContract.record.timestampPattern);
  if (canonical.length > implementationStatusContract.record.timestampMaxLength || !pattern.test(canonical)) {
    throw new Error('기관 갱신 시각은 UTC 표준 시각으로 변환할 수 있어야 합니다.');
  }
  return canonical;
}

function evidenceUrl(value: string, required: boolean): string | null {
  const normalized = value.trim();
  if (!normalized) {
    if (required) throw new Error('이 상태에는 공개 근거 URL이 필요합니다.');
    return null;
  }
  if (normalized.length > implementationStatusContract.record.evidenceUrlMaxLength) {
    throw new Error(`근거 URL은 ${implementationStatusContract.record.evidenceUrlMaxLength}자 이하여야 합니다.`);
  }
  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    throw new Error('근거 URL 형식을 확인해 주세요.');
  }
  if (url.protocol !== implementationStatusContract.record.evidenceProtocol) {
    throw new Error('근거 URL은 HTTPS 주소여야 합니다.');
  }
  if (!implementationStatusContract.record.evidenceCredentialsAllowed && (url.username || url.password)) {
    throw new Error('근거 URL에는 사용자 정보를 포함할 수 없습니다.');
  }
  return url.href;
}

function parseImplementation(value: unknown): ImplementationRecord | null {
  if (!isObject(value)) return null;
  const status = typeof value.status === 'string' ? value.status : '';
  if (!isImplementationStatus(status)) return null;
  const responsibleBody = typeof value.responsible_body === 'string' ? value.responsible_body : '';
  const updatedAt = typeof value.updated_at === 'string' ? value.updated_at : '';
  const summary = typeof value.summary === 'string' ? value.summary : '';
  const evidence = typeof value.evidence_url === 'string' ? value.evidence_url : '';
  try {
    return buildImplementationMutation({
      issueId: 'snapshot',
      status,
      responsibleBody,
      updatedAt,
      summary,
      evidenceUrl: evidence,
    }).implementation;
  } catch {
    return null;
  }
}

export function listImplementationIssues(body: unknown): PublishedImplementationIssue[] {
  if (!isObject(body) || !Array.isArray(body.issues)) return [];
  return body.issues.flatMap((value): PublishedImplementationIssue[] => {
    if (!isObject(value) || value.review_status !== 'reviewed') return [];
    const id = typeof value.id === 'string' ? value.id.trim() : '';
    const label = typeof value.label === 'string' ? value.label.trim() : '';
    if (!id || !label) return [];
    return [{ id, label, implementation: parseImplementation(value.implementation) }];
  });
}

export function buildImplementationMutation(input: ImplementationFormInput): ImplementationMutation {
  const issueId = requiredText(input.issueId, '권고', 200);
  if (!isImplementationStatus(input.status)) throw new Error('이행 상태를 선택해 주세요.');
  const state = implementationStatusContract.states[input.status];
  return {
    issue_id: issueId,
    implementation: {
      status: input.status,
      responsible_body: requiredText(
        input.responsibleBody,
        '책임 기관',
        implementationStatusContract.record.responsibleBodyMaxLength,
      ),
      updated_at: canonicalTimestamp(input.updatedAt),
      summary: requiredText(
        input.summary,
        '공개 설명',
        implementationStatusContract.record.summaryMaxLength,
      ),
      evidence_url: evidenceUrl(input.evidenceUrl, state.evidenceRequired),
    },
  };
}

export function verifyImplementationMutation(
  body: unknown,
  expected: ImplementationMutation,
): { ok: true } | { ok: false; error: string } {
  const issue = listImplementationIssues(body).find((candidate) => candidate.id === expected.issue_id);
  if (!issue) return { ok: false, error: '공개 재조회에서 대상 권고를 찾지 못했습니다.' };
  if (JSON.stringify(issue.implementation) !== JSON.stringify(expected.implementation)) {
    return { ok: false, error: '공개 재조회 값이 저장 요청과 일치하지 않습니다.' };
  }
  return { ok: true };
}
