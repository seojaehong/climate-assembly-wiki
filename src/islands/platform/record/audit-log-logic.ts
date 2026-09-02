import type { PlatformAuditEvent } from '../../../lib/platform';

function shorten(value: string): string {
  if (value.length <= 16) return value;
  return `${value.slice(0, 8)}…${value.slice(-4)}`;
}

export function formatAuditActor(event: PlatformAuditEvent): string {
  return event.actor_user_id
    ? `${event.actor_role} · ${shorten(event.actor_user_id)}`
    : event.actor_role;
}

export function formatAuditResource(event: PlatformAuditEvent): string {
  return `${event.resource_type} · ${shorten(event.resource_id)}`;
}

function spreadsheetSafe(value: string): string {
  return /^[=+\-@]/.test(value) ? `'${value}` : value;
}

function csvCell(value: string | number | null): string {
  const text = spreadsheetSafe(value === null ? '' : String(value));
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function auditEventsToCsv(events: readonly PlatformAuditEvent[]): string {
  const columns = [
    'event_id', 'occurred_at', 'actor_role', 'actor_user_id', 'operation',
    'resource_type', 'resource_id', 'changed_fields', 'transaction_id',
  ];
  const rows = events.map((event) => [
    event.id,
    event.occurred_at,
    event.actor_role,
    event.actor_user_id,
    event.operation,
    event.resource_type,
    event.resource_id,
    event.changed_fields.join('|'),
    event.transaction_id,
  ].map(csvCell).join(','));
  return `\uFEFF${columns.join(',')}\r\n${rows.join('\r\n')}\r\n`;
}
