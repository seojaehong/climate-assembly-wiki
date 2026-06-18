import { test, expect, vi } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { uploadFiles, ensureSubfolder } from '../upload-to-drive.mjs';

const tmp = mkdtempSync(join(tmpdir(), 'up-'));
const fakeA = join(tmp, 'a.png');
const fakeB = join(tmp, 'b.png');
writeFileSync(fakeA, '');
writeFileSync(fakeB, '');

test('ensureSubfolder reuses existing folder', async () => {
  const list = vi.fn().mockResolvedValue({ data: { files: [{ id: 'f1', name: '12-30' }] } });
  const create = vi.fn();
  const drive = { files: { list, create } };
  const id = await ensureSubfolder({ drive, parentId: 'P', name: '12-30' });
  expect(id).toBe('f1');
  expect(create).not.toHaveBeenCalled();
});

test('ensureSubfolder creates when missing', async () => {
  const list = vi.fn().mockResolvedValue({ data: { files: [] } });
  const create = vi.fn().mockResolvedValue({ data: { id: 'new1' } });
  const drive = { files: { list, create } };
  const id = await ensureSubfolder({ drive, parentId: 'P', name: '12-30' });
  expect(id).toBe('new1');
  expect(create).toHaveBeenCalledTimes(1);
});

test('uploadFiles retries 5x then surfaces error', async () => {
  const create = vi.fn().mockRejectedValue(new Error('403 forbidden'));
  const drive = { files: { create } };
  await expect(uploadFiles({
    drive, folderId: 'F',
    files: [{ path: fakeA, name: 'a.png' }],
    maxRetries: 5, baseDelayMs: 1
  })).rejects.toThrow('403 forbidden');
  expect(create).toHaveBeenCalledTimes(5);
});

test('uploadFiles succeeds on first try for multiple files', async () => {
  const create = vi.fn()
    .mockResolvedValueOnce({ data: { id: 'a1', name: 'a.png' } })
    .mockResolvedValueOnce({ data: { id: 'b1', name: 'b.png' } });
  const drive = { files: { create } };
  const out = await uploadFiles({
    drive, folderId: 'F',
    files: [{ path: fakeA, name: 'a.png' }, { path: fakeB, name: 'b.png' }],
    maxRetries: 5, baseDelayMs: 1
  });
  expect(out).toHaveLength(2);
  expect(create).toHaveBeenCalledTimes(2);
});
