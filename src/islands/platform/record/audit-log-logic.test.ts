import { describe, expect, it } from 'vitest';
import type { PlatformAuditEvent } from '../../../lib/platform';
import { auditEventsToCsv, formatAuditActor, formatAuditResource } from './audit-log-logic';

const event: PlatformAuditEvent = {
  id: '42',
  occurred_at: '2026-09-03T01:02:03.000Z',
  actor_user_id: '11111111-1111-4111-8111-111111111111',
  actor_role: 'authenticated',
  operation: 'update',
  resource_type: 'discussion_topic',
  resource_id: '22222222-2222-4222-8222-222222222222',
  changed_fields: ['prompt', 'status'],
  transaction_id: '99',
};

describe('audit log presentation', () => {
  it('formats actor and resource metadata without inventing display names', () => {
    expect(formatAuditActor(event)).toBe('authenticated · 11111111…1111');
    expect(formatAuditResource(event)).toBe('discussion_topic · 22222222…2222');
    expect(formatAuditActor({ ...event, actor_user_id: null, actor_role: 'anon' })).toBe('anon');
  });

  it('exports a spreadsheet-safe UTF-8 CSV containing metadata only', () => {
    const csv = auditEventsToCsv([{ ...event, resource_id: '=cmd|danger' }]);
    expect(csv.startsWith('\uFEFFevent_id,occurred_at,actor_role,actor_user_id,operation,resource_type,resource_id,changed_fields,transaction_id')).toBe(true);
    expect(csv).toContain("'" + '=cmd|danger');
    expect(csv).toContain('prompt|status');
    expect(csv).not.toContain('before_values');
    expect(csv).not.toContain('after_values');
  });
});
