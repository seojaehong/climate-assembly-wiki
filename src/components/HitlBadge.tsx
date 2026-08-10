import type { HitlStatus } from '../lib/hitl-status';

export interface HitlBadgeProps {
  status: HitlStatus;
}

/** Renders the shared visible and assistive label for human-in-the-loop review state. */
export default function HitlBadge({ status }: HitlBadgeProps) {
  return (
    <span
      aria-label={`${status.label}: ${status.description}`}
      style={{
        display: 'inline-block',
        border: `2px solid ${status.border}`,
        borderRadius: 999,
        padding: '2px 10px',
        color: status.foreground,
        background: status.background,
        fontSize: 13,
        fontWeight: 800,
        lineHeight: 1.35,
        whiteSpace: 'nowrap',
      }}
    >
      {status.label}
    </span>
  );
}
