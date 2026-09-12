export const AGENDA_STATUSES = [
  'waiting',
  'discussing',
  'drafting',
  'team_confirmed',
  'submitted',
] as const;

export type AgendaStatus = (typeof AGENDA_STATUSES)[number];

export const AGENDA_STATUS_LABELS: Readonly<Record<AgendaStatus, string>> = {
  waiting: '대기',
  discussing: '논의 중',
  drafting: '초안 작성',
  team_confirmed: '조 확인',
  submitted: '제출 완료',
};

export const AGENDA_STATUS_STYLES: Readonly<Record<AgendaStatus, string>> = {
  waiting: 'border-[#CBD5E1] bg-[#F8FAFC] text-[#475569]',
  discussing: 'border-[#38BDF8] bg-[#E0F2FE] text-[#075985]',
  drafting: 'border-[#F59E0B] bg-[#FEF3C7] text-[#92400E]',
  team_confirmed: 'border-[#A78BFA] bg-[#F3E8FF] text-[#6B21A8]',
  submitted: 'border-[#34D399] bg-[#D1FAE5] text-[#065F46]',
};

export type AgendaProgressAction =
  | 'start'
  | 'save'
  | 'confirm'
  | 'submit'
  | 'revision_request'
  | 'reopen';

export function nextAgendaStatus(
  current: AgendaStatus,
  action: AgendaProgressAction,
  hasDraft: boolean,
): AgendaStatus | null {
  switch (action) {
    case 'start':
      return current === 'waiting' || current === 'discussing' ? 'discussing' : null;
    case 'save':
      return hasDraft && current !== 'submitted' ? 'drafting' : null;
    case 'confirm':
      return hasDraft && current === 'drafting' ? 'team_confirmed' : null;
    case 'submit':
      return hasDraft && current === 'team_confirmed' ? 'submitted' : null;
    case 'revision_request':
      return current === 'team_confirmed' || current === 'submitted' ? 'drafting' : null;
    case 'reopen':
      return current === 'team_confirmed' || current === 'submitted' ? 'drafting' : null;
  }
}

export function statusCounts(statuses: readonly AgendaStatus[]): Record<AgendaStatus, number> {
  const counts: Record<AgendaStatus, number> = {
    waiting: 0,
    discussing: 0,
    drafting: 0,
    team_confirmed: 0,
    submitted: 0,
  };
  for (const status of statuses) counts[status] += 1;
  return counts;
}

export function subgroupSortKey(subgroup: string): number {
  const match = /^(\d+)분과$/.exec(subgroup.trim());
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}
