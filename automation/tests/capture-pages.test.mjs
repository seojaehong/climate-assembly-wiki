import { test, expect, beforeAll, afterAll } from 'vitest';
import { capturePages } from '../capture-pages.mjs';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let outDir;
beforeAll(() => { outDir = mkdtempSync(join(tmpdir(), 'cap-')); });
afterAll(() => { rmSync(outDir, { recursive: true, force: true }); });

test('captures 4 pages from data:url stub to PNG', async () => {
  const pages = [
    { id: 'a', path: 'data:text/html,<h1>A</h1>' },
    { id: 'b', path: 'data:text/html,<h1>B</h1>' },
    { id: 'c', path: 'data:text/html,<h1>C</h1>' },
    { id: 'd', path: 'data:text/html,<h1>D</h1>' }
  ];
  const result = await capturePages({ baseUrl: '', pages, outDir });
  expect(result.success).toHaveLength(4);
  for (const p of result.success) {
    expect(existsSync(join(outDir, `page-${p.id}.png`))).toBe(true);
  }
}, 60000);

test('skips failing page, continues others', async () => {
  const pages = [
    { id: 'ok', path: 'data:text/html,<h1>OK</h1>' },
    { id: 'bad', path: 'http://127.0.0.1:1/never' }
  ];
  const result = await capturePages({ baseUrl: '', pages, outDir, pageTimeoutMs: 500, waitUntil: 'load' });
  expect(result.success.map(p => p.id)).toContain('ok');
  expect(result.failed.map(p => p.id)).toContain('bad');
}, 30000);
