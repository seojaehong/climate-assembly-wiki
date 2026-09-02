import { describe, expect, it } from 'vitest';
import {
  buildImplementationMutation,
  listImplementationIssues,
  verifyImplementationMutation,
} from './implementation-console-logic';

const ISSUE_ID = '31111111-1111-4111-8111-111111111111';

function resultBody(implementation?: object) {
  return {
    issues: [{
      id: ISSUE_ID,
      label: '대중교통 확대',
      review_status: 'reviewed',
      ...(implementation ? { implementation } : {}),
    }],
  };
}

describe('implementation console logic', () => {
  it('lists only identifiable reviewed issues from the published snapshot', () => {
    const issues = listImplementationIssues({
      issues: [
        { id: ISSUE_ID, label: '대중교통 확대', review_status: 'reviewed' },
        { id: '32111111-1111-4111-8111-111111111111', label: '초안', review_status: 'draft' },
        { id: '', label: '식별자 없음', review_status: 'reviewed' },
      ],
    });

    expect(issues).toEqual([{ id: ISSUE_ID, label: '대중교통 확대', implementation: null }]);
  });

  it('normalizes a valid institution response using the public implementation contract', () => {
    expect(buildImplementationMutation({
      issueId: ` ${ISSUE_ID} `,
      status: 'implemented',
      responsibleBody: ' 교통정책 담당기관 ',
      updatedAt: '2026-09-03T10:30',
      summary: ' 접근성 개선 조치를 완료했습니다. ',
      evidenceUrl: ' https://example.org/evidence ',
    })).toEqual({
      issue_id: ISSUE_ID,
      implementation: {
        status: 'implemented',
        responsible_body: '교통정책 담당기관',
        updated_at: new Date('2026-09-03T10:30').toISOString(),
        summary: '접근성 개선 조치를 완료했습니다.',
        evidence_url: 'https://example.org/evidence',
      },
    });
  });

  it('requires HTTPS evidence for final states and rejects URL credentials', () => {
    const base = {
      issueId: ISSUE_ID,
      status: 'implemented',
      responsibleBody: '교통정책 담당기관',
      updatedAt: '2026-09-03T10:30',
      summary: '접근성 개선 조치를 완료했습니다.',
      evidenceUrl: '',
    } as const;

    expect(() => buildImplementationMutation(base)).toThrow('근거 URL');
    expect(() => buildImplementationMutation({ ...base, evidenceUrl: 'http://example.org' })).toThrow('HTTPS');
    expect(() => buildImplementationMutation({ ...base, evidenceUrl: 'https://user:secret@example.org' })).toThrow('사용자 정보');
  });

  it('verifies the exact saved record in the public re-read', () => {
    const mutation = buildImplementationMutation({
      issueId: ISSUE_ID,
      status: 'in_progress',
      responsibleBody: '교통정책 담당기관',
      updatedAt: '2026-09-03T10:30',
      summary: '세부 이행을 진행하고 있습니다.',
      evidenceUrl: '',
    });

    expect(verifyImplementationMutation(resultBody(mutation.implementation), mutation)).toEqual({ ok: true });
    expect(verifyImplementationMutation(resultBody({ ...mutation.implementation, summary: '다른 설명' }), mutation))
      .toEqual({ ok: false, error: '공개 재조회 값이 저장 요청과 일치하지 않습니다.' });
  });
});
