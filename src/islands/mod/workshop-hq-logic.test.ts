import { describe, expect, it } from 'vitest';
import {
  deviceIsStale,
  groupWorkshopDevices,
  hqOperationErrorMessage,
  readinessItems,
  topicStatusLabel,
} from './workshop-hq-logic';
import { WorkshopHqConflictError, WorkshopHqDeadlineConflictError } from '../../lib/workshop-hq';
import type { WorkshopDevice, WorkshopHqStatus } from '../../lib/workshop-hq';

const status: WorkshopHqStatus = {
  session_id: 's1', session_slug: '0912-deliberation', session_title: '9/12 숙의', org_name: '기후시민회의',
  topic_total: 6, topic_open: 1, topic_closed: 0, next_topic_id: 'tp2', next_topic_ordinal: 2,
  next_topic_prompt: '초안', teams_total: 15, active_devices: 2, teams_online: 1,
  submissions_draft: 1, submissions_final: 0, last_activity_at: '2026-09-12T04:00:00Z', topics: [],
};

function device(teamName: string, lastSeenAt: string): WorkshopDevice {
  return { token_hash: `${teamName}-hash`, team_id: teamName, team_name: teamName, device_id: `${teamName}-device`,
    device_label: 'Windows · Chrome', last_seen_at: lastSeenAt, expires_at: '2026-09-13T13:00:00Z' };
}

describe('workshop HQ visibility logic', () => {
  it('reports the fixed readiness invariants separately', () => {
    expect(readinessItems(status)).toEqual([
      { label: '행사 세션', value: '0912-deliberation', ok: true },
      { label: '조 편성', value: '15개 조', ok: true },
      { label: '꼭지 준비', value: '6개', ok: true },
      { label: '활성 기기', value: '2대', ok: true },
    ]);
  });

  it('groups devices in team-name order without exposing tokens', () => {
    const grouped = groupWorkshopDevices([
      device('2분과 1조', '2026-09-12T03:59:00Z'),
      device('1분과 1조', '2026-09-12T04:00:00Z'),
    ]);
    expect([...grouped.keys()]).toEqual(['1분과 1조', '2분과 1조']);
    expect(JSON.stringify(grouped)).not.toContain('accessToken');
  });

  it('marks devices stale after two minutes', () => {
    const now = Date.parse('2026-09-12T04:03:00Z');
    expect(deviceIsStale(device('1조', '2026-09-12T04:01:01Z'), now)).toBe(false);
    expect(deviceIsStale(device('1조', '2026-09-12T04:01:00Z'), now)).toBe(true);
  });

  it('translates server states and simultaneous-control conflicts into operator language', () => {
    expect(topicStatusLabel('draft')).toBe('대기');
    expect(topicStatusLabel('open')).toBe('진행 중');
    expect(topicStatusLabel('closed')).toBe('마감');

    const topicConflict = new WorkshopHqConflictError({
      status: 'conflict',
      topic_id: 'topic-1',
      current_status: 'closed',
      expected_status: 'open',
    });
    const deadlineConflict = new WorkshopHqDeadlineConflictError({
      status: 'conflict',
      topic_id: 'topic-1',
      deadline_at: '2026-09-12T06:00:00Z',
      expected_deadline_at: null,
    });

    expect(hqOperationErrorMessage(topicConflict)).toContain('다른 운영자');
    expect(hqOperationErrorMessage(deadlineConflict)).toContain('마감 시각');
    expect(hqOperationErrorMessage(new Error('PGRST202: missing function'))).toContain('migration');
    expect(hqOperationErrorMessage(new Error('unexpected'))).not.toContain('unexpected');
  });
});
