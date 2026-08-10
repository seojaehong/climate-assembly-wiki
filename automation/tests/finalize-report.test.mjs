import { readFileSync } from 'node:fs';
import { test, expect, vi } from 'vitest';
import yaml from 'js-yaml';
import {
  buildSummaryMarkdown,
  expectedCaptureSets,
  expectedCaptureTimestamps,
  loadFinalizeReport,
  parseDriveCredentials,
  resolveWorkshop,
  sendFinalizeNotification,
  writeFinalizeRow,
} from '../finalize-report.mjs';

test('rejects malformed Drive credentials without echoing secret content', () => {
  const secretFragment = 'private-key-sensitive';
  expect(() => parseDriveCredentials(`{"private_key":"${secretFragment}",`))
    .toThrow('Drive credentials JSON is invalid');
  try {
    parseDriveCredentials(`{"private_key":"${secretFragment}",`);
  } catch (error) {
    expect(error.message).not.toContain(secretFragment);
  }
});

test('alerts Discord after a failed finalize workflow step', () => {
  const workflowPath = new URL('../../.github/workflows/finalize.yml', import.meta.url);
  const workflow = yaml.load(readFileSync(workflowPath, 'utf8'));
  expect(workflow.concurrency.group).toContain('github.event.inputs.workshop');
  expect(workflow.concurrency.group).toContain("'7월_행사'");
  expect(workflow.concurrency.group).toContain("'2차_의제선정'");
  expect(workflow.concurrency['cancel-in-progress']).toBe(false);
  const steps = workflow.jobs.finalize.steps;
  const reportIndex = steps.findIndex((step) => step.name === 'Finalize report');
  const alertIndex = steps.findIndex((step) => step.name === 'Discord alert on failure');
  expect(reportIndex).toBeGreaterThan(-1);
  expect(alertIndex).toBeGreaterThan(reportIndex);
  expect(steps[alertIndex].if).toBe('failure()');
});

test('derives inclusive five-minute capture counts from workshop hours', () => {
  expect(expectedCaptureSets({ date: '2026-08-29', start_kst: '09:00', end_kst: '18:00' })).toBe(109);
  expect(expectedCaptureSets({ date: '2026-08-29', start_kst: '09:00', end_kst: '21:00' })).toBe(145);
});

test('derives exact UTC capture timestamps from the KST workshop schedule', () => {
  expect(expectedCaptureTimestamps({
    date: '2026-08-29',
    start_kst: '09:00',
    end_kst: '09:10',
  })).toEqual([
    '2026-08-29T00-00',
    '2026-08-29T00-05',
    '2026-08-29T00-10',
  ]);
});

test('summary markdown contains workshop name, set count, finalVotes', () => {
  const stats = { workshop: '2차_의제선정', date: '2026-08-29', captureSets: 105, snapshotCount: 530, finalVotes: 230 };
  const md = buildSummaryMarkdown(stats);
  expect(md).toContain('2차_의제선정');
  expect(md).toContain('2026-08-29');
  expect(md).toContain('105');
  expect(md).toContain('230');
});

test('summary marks final votes as uncollected instead of reporting a placeholder zero', () => {
  const md = buildSummaryMarkdown({
    workshop: '2차_의제선정',
    date: '2026-08-29',
    captureSets: 105,
    snapshotCount: 530,
    finalVotes: null,
  });
  expect(md).toContain('최종 표 수: 미집계');
  expect(md).not.toContain('최종 표 수: 0');
});

test('loads finalization counts from the Drive workshop archive', async () => {
  const list = vi.fn()
    .mockResolvedValueOnce({ data: { files: [{ id: 'workshop-1', name: '2차_의제선정' }] } })
    .mockResolvedValueOnce({
      data: {
        files: [
          { id: 'capture-1', name: '2026-08-29T00-00' },
          { id: 'capture-2', name: '2026-08-29T00-05' },
          { id: 'snapshots-1', name: 'snapshots' },
        ],
      },
    })
    .mockResolvedValueOnce({
      data: {
        files: [
          { id: 'board-1', name: 'page-board.png' },
          { id: 'event-1', name: 'page-event.png' },
          { id: 'race-1', name: 'page-race-40.png' },
          { id: 'bar-1', name: 'page-event-bar.png' },
        ],
      },
    })
    .mockResolvedValueOnce({
      data: {
        files: [
          { id: 'board-2', name: 'page-board.png' },
          { id: 'event-2', name: 'page-event.png' },
          { id: 'race-2', name: 'page-race-40.png' },
          { id: 'bar-2', name: 'page-event-bar.png' },
        ],
      },
    })
    .mockResolvedValueOnce({
      data: { files: [{ id: 'snapshot-1', name: '2026-08-29T00-00.json' }] },
    });

  const result = await loadFinalizeReport({
    drive: { files: { list } },
    parentId: 'archive-root',
    workshop: {
      name: '2차_의제선정',
      date: '2026-08-29',
      start_kst: '09:00',
      end_kst: '18:00',
    },
    expectedSets: 108,
    requiredCaptureFiles: [
      'page-board.png',
      'page-event.png',
      'page-race-40.png',
      'page-event-bar.png',
    ],
  });

  expect(result.stats).toEqual({
    workshop: '2차_의제선정',
    date: '2026-08-29',
    captureSets: 2,
    snapshotCount: 1,
    finalVotes: null,
    expectedSets: 108,
  });
  expect(result.markdown).toContain('캡쳐 set: 2');
  expect(result.markdown).toContain('스냅샷 건수: 1');
  expect(result.markdown).toContain('최종 표 수: 미집계');
  expect(result.status).toBe('issue');
});

test('sends a warning notification when finalization coverage has an issue', async () => {
  const fetchImpl = vi.fn().mockResolvedValue({ ok: true });
  await expect(sendFinalizeNotification({
    fetchImpl,
    webhook: 'https://example.test/webhook',
    status: 'issue',
    workshop: '2차_의제선정',
    markdown: 'summary',
  })).resolves.toEqual({ sent: true });
  expect(fetchImpl).toHaveBeenCalledWith('https://example.test/webhook', expect.objectContaining({
    method: 'POST',
    body: expect.stringContaining('⚠️ finalize: 2차_의제선정'),
  }));
});

test('rejects a failed Discord notification instead of silently succeeding', async () => {
  const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 503 });
  await expect(sendFinalizeNotification({
    fetchImpl,
    sleepImpl: vi.fn().mockResolvedValue(undefined),
    retryDelayMs: 1,
    webhook: 'https://example.test/webhook',
    status: 'ok',
    workshop: '2차_의제선정',
    markdown: 'summary',
  })).rejects.toThrow('finalize notification failed: HTTP 503');
});

test('retries a failed Discord notification once with a request timeout', async () => {
  const fetchImpl = vi.fn()
    .mockResolvedValueOnce({ ok: false, status: 503 })
    .mockResolvedValueOnce({ ok: true, status: 204 });
  const sleepImpl = vi.fn().mockResolvedValue(undefined);
  await expect(sendFinalizeNotification({
    fetchImpl,
    sleepImpl,
    retryDelayMs: 1,
    webhook: 'https://example.test/webhook',
    status: 'ok',
    workshop: '2차_의제선정',
    markdown: 'summary',
  })).resolves.toEqual({ sent: true });
  expect(fetchImpl).toHaveBeenCalledTimes(2);
  expect(fetchImpl.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  expect(sleepImpl).toHaveBeenCalledWith(1);
});

test('updates the existing workshop summary row instead of appending a duplicate', async () => {
  const get = vi.fn().mockResolvedValue({
    data: { values: [['date', 'workshop'], ['2026-08-29', '2차_의제선정']] },
  });
  const update = vi.fn().mockResolvedValue({ data: {} });
  const append = vi.fn();
  const sheets = { spreadsheets: { values: { get, update, append } } };

  await expect(writeFinalizeRow({
    sheets,
    spreadsheetId: 'sheet-1',
    stats: {
      date: '2026-08-29',
      workshop: '2차_의제선정',
      captureSets: 109,
      snapshotCount: 109,
      finalVotes: null,
    },
  })).resolves.toEqual({ action: 'updated', row: 2 });
  expect(update).toHaveBeenCalledWith(expect.objectContaining({
    range: '워크숍_아카이브!A2:E2',
    requestBody: { values: [['2026-08-29', '2차_의제선정', 109, 109, '']] },
  }));
  expect(append).not.toHaveBeenCalled();
});

test('appends a workshop summary when no matching row exists', async () => {
  const get = vi.fn().mockResolvedValue({ data: { values: [['date', 'workshop']] } });
  const update = vi.fn();
  const append = vi.fn().mockResolvedValue({ data: {} });
  const sheets = { spreadsheets: { values: { get, update, append } } };

  await expect(writeFinalizeRow({
    sheets,
    spreadsheetId: 'sheet-1',
    stats: {
      date: '2026-08-29',
      workshop: '2차_의제선정',
      captureSets: 109,
      snapshotCount: 109,
      finalVotes: null,
    },
  })).resolves.toEqual({ action: 'appended' });
  expect(append).toHaveBeenCalledWith(expect.objectContaining({
    range: '워크숍_아카이브!A:E',
    requestBody: { values: [['2026-08-29', '2차_의제선정', 109, 109, '']] },
  }));
  expect(update).not.toHaveBeenCalled();
});

test('rejects duplicate workshop summary rows without writing another row', async () => {
  const get = vi.fn().mockResolvedValue({
    data: {
      values: [
        ['date', 'workshop'],
        ['2026-08-29', '2차_의제선정'],
        ['2026-08-29', '2차_의제선정'],
      ],
    },
  });
  const update = vi.fn();
  const append = vi.fn();
  const sheets = { spreadsheets: { values: { get, update, append } } };

  await expect(writeFinalizeRow({
    sheets,
    spreadsheetId: 'sheet-1',
    stats: {
      date: '2026-08-29',
      workshop: '2차_의제선정',
      captureSets: 109,
      snapshotCount: 109,
      finalVotes: null,
    },
  })).rejects.toThrow('duplicate workshop archive rows: 2026-08-29 2차_의제선정');
  expect(update).not.toHaveBeenCalled();
  expect(append).not.toHaveBeenCalled();
});

test('flags missing sets when below 95% of expected', () => {
  const stats = { workshop: 'x', date: 'x', captureSets: 90, expectedSets: 108, snapshotCount: 500, finalVotes: 200 };
  const md = buildSummaryMarkdown(stats);
  expect(md).toMatch(/누락.*16\.7%|누락.*16%/);
});

test('does not flag when missing is within 5% threshold', () => {
  const stats = { workshop: 'x', date: 'x', captureSets: 104, expectedSets: 108, snapshotCount: 500, finalVotes: 200 };
  const md = buildSummaryMarkdown(stats);
  expect(md).not.toMatch(/누락/);
});

test('resolveWorkshop uses explicit name when provided', () => {
  const schedule = { workshops: [{ date: '2026-08-29', name: '2차' }] };
  const out = resolveWorkshop({ schedule, explicitName: '2차', now: new Date('2026-08-30T13:00:00Z') });
  expect(out?.name).toBe('2차');
});

test('resolveWorkshop auto-detects yesterday-KST workshop when name not given', () => {
  const schedule = { workshops: [{ date: '2026-08-29', name: '2차' }] };
  const out = resolveWorkshop({ schedule, explicitName: null, now: new Date('2026-08-29T19:00:00Z') });
  expect(out?.name).toBe('2차');
});

test('resolveWorkshop auto-detects today-KST workshop when running same day late evening', () => {
  const schedule = { workshops: [{ date: '2026-08-29', name: '2차' }] };
  const out = resolveWorkshop({ schedule, explicitName: null, now: new Date('2026-08-29T13:00:00Z') });
  expect(out?.name).toBe('2차');
});

test('resolveWorkshop returns null when no matching date', () => {
  const schedule = { workshops: [{ date: '2026-08-29', name: '2차' }] };
  const out = resolveWorkshop({ schedule, explicitName: null, now: new Date('2026-12-01T13:00:00Z') });
  expect(out).toBeNull();
});
