import { test, expect, vi } from 'vitest';
import { evaluateCoverage, inspectWorkshopArchive } from '../scripts/verify-drive.mjs';

test('counts capture sets and snapshot JSON files from one workshop archive', async () => {
  const list = vi.fn()
    .mockResolvedValueOnce({ data: { files: [{ id: 'workshop-1', name: '2차_의제선정' }] } })
    .mockResolvedValueOnce({
      data: {
        files: [
          { id: 'capture-1', name: '2026-08-29T00-00' },
          { id: 'capture-2', name: '2026-08-29T00-05' },
          { id: 'snapshots-1', name: 'snapshots' },
          { id: 'report-1', name: 'report' },
          { id: 'notes-1', name: 'operator-notes' },
        ],
      },
    })
    .mockResolvedValueOnce({
      data: {
        files: [
          { id: 'snapshot-1', name: '2026-08-29T00-00.json' },
          { id: 'snapshot-2', name: '2026-08-29T00-05.json' },
          { id: 'note-1', name: 'README.json' },
        ],
      },
    });

  await expect(inspectWorkshopArchive({
    drive: { files: { list } },
    parentId: 'archive-root',
    workshop: '2차_의제선정',
  })).resolves.toEqual({ captureSets: 2, snapshotCount: 2 });
});

test('counts every Drive page before reporting archive totals', async () => {
  const list = vi.fn()
    .mockResolvedValueOnce({
      data: { files: [{ id: 'workshop-1', name: '2차_의제선정' }], nextPageToken: 'workshop-next' },
    })
    .mockResolvedValueOnce({ data: { files: [] } })
    .mockResolvedValueOnce({
      data: {
        files: [
          { id: 'capture-1', name: '2026-08-29T00-00' },
          { id: 'snapshots-1', name: 'snapshots' },
        ],
        nextPageToken: 'children-next',
      },
    })
    .mockResolvedValueOnce({
      data: { files: [{ id: 'capture-2', name: '2026-08-29T00-05' }] },
    })
    .mockResolvedValueOnce({
      data: {
        files: [{ id: 'snapshot-1', name: '2026-08-29T00-00.json' }],
        nextPageToken: 'snapshots-next',
      },
    })
    .mockResolvedValueOnce({
      data: { files: [{ id: 'snapshot-2', name: '2026-08-29T00-05.json' }] },
    });

  await expect(inspectWorkshopArchive({
    drive: { files: { list } },
    parentId: 'archive-root',
    workshop: '2차_의제선정',
  })).resolves.toEqual({ captureSets: 2, snapshotCount: 2 });
});

test('rejects a workshop archive with no snapshot JSON files', async () => {
  const list = vi.fn()
    .mockResolvedValueOnce({ data: { files: [{ id: 'workshop-1', name: '2차_의제선정' }] } })
    .mockResolvedValueOnce({
      data: { files: [{ id: 'capture-1', name: '2026-08-29T00-00' }, { id: 'snapshots-1', name: 'snapshots' }] },
    })
    .mockResolvedValueOnce({ data: { files: [{ id: 'note-1', name: 'README.txt' }] } });

  await expect(inspectWorkshopArchive({
    drive: { files: { list } },
    parentId: 'archive-root',
    workshop: '2차_의제선정',
  })).rejects.toThrow('snapshot archive is empty: 2차_의제선정');
});

test('rejects ambiguous duplicate workshop folders', async () => {
  const list = vi.fn().mockResolvedValueOnce({
    data: {
      files: [
        { id: 'workshop-1', name: '2차_의제선정' },
        { id: 'workshop-2', name: '2차_의제선정' },
      ],
    },
  });

  await expect(inspectWorkshopArchive({
    drive: { files: { list } },
    parentId: 'archive-root',
    workshop: '2차_의제선정',
  })).rejects.toThrow('expected one workshop folder, found 2: 2차_의제선정');
});

test('rejects a capture folder that is missing a required page image', async () => {
  const list = vi.fn()
    .mockResolvedValueOnce({ data: { files: [{ id: 'workshop-1', name: '2차_의제선정' }] } })
    .mockResolvedValueOnce({
      data: { files: [{ id: 'capture-1', name: '2026-08-29T00-00' }, { id: 'snapshots-1', name: 'snapshots' }] },
    })
    .mockResolvedValueOnce({
      data: {
        files: [
          { id: 'board-1', name: 'page-board.png' },
          { id: 'event-1', name: 'page-event.png' },
          { id: 'race-1', name: 'page-race-40.png' },
        ],
      },
    });

  await expect(inspectWorkshopArchive({
    drive: { files: { list } },
    parentId: 'archive-root',
    workshop: '2차_의제선정',
    requiredCaptureFiles: [
      'page-board.png',
      'page-event.png',
      'page-race-40.png',
      'page-event-bar.png',
    ],
  })).rejects.toThrow('incomplete capture set 2026-08-29T00-00: page-event-bar.png');
});

test('rejects duplicate capture folder timestamps', async () => {
  const list = vi.fn()
    .mockResolvedValueOnce({ data: { files: [{ id: 'workshop-1', name: '2차_의제선정' }] } })
    .mockResolvedValueOnce({
      data: {
        files: [
          { id: 'capture-1', name: '2026-08-29T00-00' },
          { id: 'capture-2', name: '2026-08-29T00-00' },
          { id: 'snapshots-1', name: 'snapshots' },
        ],
      },
    });

  await expect(inspectWorkshopArchive({
    drive: { files: { list } },
    parentId: 'archive-root',
    workshop: '2차_의제선정',
  })).rejects.toThrow('duplicate capture folder timestamp: 2차_의제선정');
});

test('rejects duplicate snapshot timestamps', async () => {
  const list = vi.fn()
    .mockResolvedValueOnce({ data: { files: [{ id: 'workshop-1', name: '2차_의제선정' }] } })
    .mockResolvedValueOnce({ data: { files: [{ id: 'snapshots-1', name: 'snapshots' }] } })
    .mockResolvedValueOnce({
      data: {
        files: [
          { id: 'snapshot-1', name: '2026-08-29T00-00.json' },
          { id: 'snapshot-2', name: '2026-08-29T00-00.json' },
        ],
      },
    });

  await expect(inspectWorkshopArchive({
    drive: { files: { list } },
    parentId: 'archive-root',
    workshop: '2차_의제선정',
  })).rejects.toThrow('duplicate snapshot timestamp: 2차_의제선정');
});

test('retries one transient Drive list failure before reporting archive totals', async () => {
  const list = vi.fn()
    .mockRejectedValueOnce(new Error('temporary network failure'))
    .mockResolvedValueOnce({ data: { files: [{ id: 'workshop-1', name: '2차_의제선정' }] } })
    .mockResolvedValueOnce({ data: { files: [{ id: 'snapshots-1', name: 'snapshots' }] } })
    .mockResolvedValueOnce({
      data: { files: [{ id: 'snapshot-1', name: '2026-08-29T00-00.json' }] },
    });
  const sleepImpl = vi.fn().mockResolvedValue(undefined);

  await expect(inspectWorkshopArchive({
    drive: { files: { list } },
    parentId: 'archive-root',
    workshop: '2차_의제선정',
    sleepImpl,
    retryDelayMs: 1,
  })).resolves.toEqual({ captureSets: 0, snapshotCount: 1 });
  expect(sleepImpl).toHaveBeenCalledWith(1);
  expect(list.mock.calls[0][1]).toEqual({ timeout: 20_000 });
});

test('rejects a complete capture folder outside the expected workshop timestamps', async () => {
  const list = vi.fn()
    .mockResolvedValueOnce({ data: { files: [{ id: 'workshop-1', name: '2차_의제선정' }] } })
    .mockResolvedValueOnce({
      data: { files: [{ id: 'capture-1', name: '2026-08-28T23-55' }, { id: 'snapshots-1', name: 'snapshots' }] },
    })
    .mockResolvedValueOnce({
      data: { files: [{ id: 'board-1', name: 'page-board.png' }] },
    })
    .mockResolvedValueOnce({
      data: { files: [{ id: 'snapshot-1', name: '2026-08-29T00-00.json' }] },
    });

  await expect(inspectWorkshopArchive({
    drive: { files: { list } },
    parentId: 'archive-root',
    workshop: '2차_의제선정',
    requiredCaptureFiles: ['page-board.png'],
    expectedCaptureTimestamps: ['2026-08-29T00-00'],
  })).rejects.toThrow('unexpected capture timestamp: 2026-08-28T23-55');
});

test('within 5% missing → ok', () => {
  expect(evaluateCoverage({ actual: 104, expected: 108 }).status).toBe('ok');
});

test('exact 5% missing → ok (boundary)', () => {
  expect(evaluateCoverage({ actual: 103, expected: 108 }).status).toBe('ok');
});

test('over 5% missing → issue', () => {
  const r = evaluateCoverage({ actual: 100, expected: 108 });
  expect(r.status).toBe('issue');
  expect(r.missing).toBe(8);
});

test('perfect coverage → ok with missing 0', () => {
  expect(evaluateCoverage({ actual: 108, expected: 108 })).toEqual(
    expect.objectContaining({ status: 'ok', missing: 0, missingPct: 0 })
  );
});

test('over-capture (actual > expected) → ok, missing negative', () => {
  expect(evaluateCoverage({ actual: 110, expected: 108 }).status).toBe('ok');
});

test('rejects invalid coverage counts instead of returning a false ok', () => {
  expect(() => evaluateCoverage({ actual: 10, expected: 0 })).toThrow('invalid expected capture count: 0');
  expect(() => evaluateCoverage({ actual: Number.NaN, expected: 108 })).toThrow('invalid actual capture count: NaN');
});
