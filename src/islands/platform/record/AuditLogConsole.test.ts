import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import AuditLogConsole from './AuditLogConsole';

describe('AuditLogConsole', () => {
  it('renders an accessible, selected-organization audit surface', () => {
    const html = renderToStaticMarkup(createElement(AuditLogConsole, {
      organization: { id: 'org-1', label: '테스트 기관' },
    }));

    expect(html).toContain('테스트 기관 사용자 행위 감사로그');
    expect(html).toContain('aria-label="감사로그 새로고침"');
    expect(html).toContain('CSV 내보내기');
    expect(html).toContain('role="status"');
    expect(html).toContain('감사로그를 불러오는 중입니다.');
  });

  it('does not persist audit data or accept an organization id in the RPC call', () => {
    const source = readFileSync(new URL('./AuditLogConsole.tsx', import.meta.url), 'utf8');
    expect(source).toContain('platformAuditList(nextCursor, PAGE_SIZE)');
    expect(source).not.toContain('localStorage');
    expect(source).not.toContain('sessionStorage');
    expect(source).not.toMatch(/platformAuditList\([^)]*organization\.id/);
  });
});
