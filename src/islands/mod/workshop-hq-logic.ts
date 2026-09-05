import {
  WorkshopHqConflictError,
  WorkshopHqDeadlineConflictError,
  type WorkshopDevice,
  type WorkshopHqStatus,
} from '../../lib/workshop-hq';

export type ReadinessItem = { label: string; value: string; ok: boolean };

export function readinessItems(status: WorkshopHqStatus): ReadinessItem[] {
  return [
    { label: '행사 세션', value: status.session_slug, ok: status.session_slug === '0912-deliberation' },
    { label: '조 편성', value: `${status.teams_total}개 조`, ok: status.teams_total === 15 },
    { label: '꼭지 준비', value: `${status.topic_total}개`, ok: status.topic_total === 6 },
    { label: '활성 기기', value: `${status.active_devices}대`, ok: status.active_devices <= status.teams_total * 2 },
  ];
}

export function groupWorkshopDevices(devices: WorkshopDevice[]): Map<string, WorkshopDevice[]> {
  const grouped = new Map<string, WorkshopDevice[]>();
  for (const device of [...devices].sort((a, b) => a.team_name.localeCompare(b.team_name, 'ko'))) {
    const rows = grouped.get(device.team_name) ?? [];
    rows.push(device);
    grouped.set(device.team_name, rows);
  }
  return grouped;
}

export function deviceIsStale(device: WorkshopDevice, nowMs: number): boolean {
  const seen = Date.parse(device.last_seen_at);
  return !Number.isFinite(seen) || nowMs - seen >= 120_000;
}

export function formatHqClock(value: string | null): string {
  if (!value) return '기록 없음';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '시각 확인 필요';
  return new Intl.DateTimeFormat('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(date);
}

export function topicStatusLabel(status: WorkshopHqStatus['topics'][number]['status']): string {
  if (status === 'draft') return '대기';
  if (status === 'open') return '진행 중';
  return '마감';
}

export function hqOperationErrorMessage(error: unknown): string {
  if (error instanceof WorkshopHqConflictError) {
    return '다른 운영자가 먼저 꼭지 상태를 바꿨습니다. 최신 상태를 다시 불러왔으니 확인 후 다시 시도해 주세요.';
  }
  if (error instanceof WorkshopHqDeadlineConflictError) {
    return '다른 운영자가 먼저 마감 시각을 바꿨습니다. 최신 시각을 확인 후 다시 시도해 주세요.';
  }
  if (error instanceof Error && error.message.includes('PGRST202')) {
    return '현장 운영 보안 migration이 아직 적용되지 않았습니다.';
  }
  return '운영 조작을 완료하지 못했습니다. 연결과 최신 상태를 확인한 뒤 다시 시도해 주세요.';
}
