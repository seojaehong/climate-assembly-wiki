import { test, expect, afterEach } from 'vitest';
import { mkdirSync, existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { exportSnapshots, sanitizeLabel } from '../export-snapshots-onedrive.mjs';

// ── helpers ─────────────────────────────────────────────────────────────────

function makeTmpDir(suffix = '') {
  const dir = join(tmpdir(), `cv-export-test-${Date.now()}${suffix}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function makeClient(rows = []) {
  return {
    schema: () => ({
      from: () => ({
        select: () => ({
          order: () => Promise.resolve({ data: rows, error: null }),
        }),
      }),
    }),
  };
}

function makeErrorClient(message = 'db error', code = '42501') {
  return {
    schema: () => ({
      from: () => ({
        select: () => ({
          order: () => Promise.resolve({ data: null, error: { message, code } }),
        }),
      }),
    }),
  };
}

const SAMPLE_ROWS = [
  {
    id: 1,
    label: 'baseline-2026-06-15-post-cleanup',
    source: 'manual',
    taken_at: '2026-06-15T14:44:17.360261+00:00',
    votes_count: 126,
    rounds_count: 16,
    archive_log_count: 0,
    payload: { votes: [], rounds: [] },
  },
  {
    id: 2,
    label: 'VERIFY_additive_agenda_keys',
    source: 'verify',
    taken_at: '2026-06-21T14:07:26.318834+00:00',
    votes_count: 126,
    rounds_count: 17,
    archive_log_count: 0,
    payload: { votes: [], rounds: [] },
  },
  {
    id: 3,
    label: 'TEST_task2_automation',
    source: 'cron',
    taken_at: '2026-06-21T14:19:57.019597+00:00',
    votes_count: 126,
    rounds_count: 17,
    archive_log_count: 0,
    payload: { votes: [], rounds: [] },
  },
];

// temp dirs to clean up
const tmpDirs = [];
afterEach(() => {
  for (const d of tmpDirs.splice(0)) {
    try { rmSync(d, { recursive: true, force: true }); } catch {}
  }
});

// ── sanitizeLabel ────────────────────────────────────────────────────────────

test('sanitizeLabel: alphanumeric + hyphen + underscore + 한글 pass through', () => {
  expect(sanitizeLabel('baseline-2026_cleanup')).toBe('baseline-2026_cleanup');
  expect(sanitizeLabel('기후시민회의-테스트')).toBe('기후시민회의-테스트');
});

test('sanitizeLabel: special chars → underscore', () => {
  expect(sanitizeLabel('test/path\\file:name')).toBe('test_path_file_name');
  expect(sanitizeLabel('hello world!')).toBe('hello_world_');
});

test('sanitizeLabel: null/undefined → "unlabeled"', () => {
  expect(sanitizeLabel(null)).toBe('unlabeled');
  expect(sanitizeLabel(undefined)).toBe('unlabeled');
});

test('sanitizeLabel: truncates at 64 chars', () => {
  const long = 'a'.repeat(100);
  expect(sanitizeLabel(long).length).toBe(64);
});

// ── exportSnapshots: new files created ──────────────────────────────────────

test('(a) 새 스냅샷 3건 → 파일 3개 생성, exported=3, skipped=0', async () => {
  const outDir = makeTmpDir('-new');
  tmpDirs.push(outDir);

  const result = await exportSnapshots({ client: makeClient(SAMPLE_ROWS), outDir });

  expect(result.exported).toBe(3);
  expect(result.skipped).toBe(0);
  expect(result.files).toHaveLength(3);

  // 파일 존재 확인
  for (const fname of result.files) {
    expect(existsSync(join(outDir, fname))).toBe(true);
  }

  // 파일명 패턴: snapshot_<id>_<sanitized-label>.json
  expect(result.files[0]).toMatch(/^snapshot_1_baseline-2026-06-15-post-cleanup\.json$/);
  expect(result.files[1]).toMatch(/^snapshot_2_VERIFY_additive_agenda_keys\.json$/);
});

test('파일 내용에 원본 row 전체가 직렬화됨', async () => {
  const outDir = makeTmpDir('-content');
  tmpDirs.push(outDir);

  await exportSnapshots({ client: makeClient([SAMPLE_ROWS[0]]), outDir });
  const fname = `snapshot_1_${sanitizeLabel(SAMPLE_ROWS[0].label)}.json`;
  const written = JSON.parse(readFileSync(join(outDir, fname), 'utf8'));

  expect(written.id).toBe(1);
  expect(written.votes_count).toBe(126);
  expect(written.payload).toEqual({ votes: [], rounds: [] });
});

// ── exportSnapshots: idempotency (append-only invariant) ────────────────────

test('(b) 기존 파일이 원본과 같을 때만 skip — 덮어쓰기 없음 (append-only 불변식)', async () => {
  const outDir = makeTmpDir('-idem');
  tmpDirs.push(outDir);

  // 1차 실행
  const r1 = await exportSnapshots({ client: makeClient(SAMPLE_ROWS), outDir });
  expect(r1.exported).toBe(3);
  expect(r1.skipped).toBe(0);

  // sentinel: 파일 1의 내용을 임의로 변경
  const fname1 = join(outDir, r1.files[0]);
  const originalContent = readFileSync(fname1, 'utf8');
  const SENTINEL = '{"sentinel": "must-not-be-overwritten"}';
  writeFileSync(fname1, SENTINEL, 'utf8');

  // 2차 실행 (동일 rows, 기존 파일 변조)
  await expect(
    exportSnapshots({ client: makeClient(SAMPLE_ROWS), outDir })
  ).rejects.toThrow('existing snapshot export does not match source row');

  // sentinel 내용이 그대로 — 오류가 나도 덮어쓰기 없음 검증
  const afterContent = readFileSync(fname1, 'utf8');
  expect(afterContent).toBe(SENTINEL);
  expect(afterContent).not.toBe(originalContent);
});

test('기존 파일이 원본과 정확히 같으면 전체를 skip한다', async () => {
  const outDir = makeTmpDir('-matching');
  tmpDirs.push(outDir);

  const first = await exportSnapshots({ client: makeClient(SAMPLE_ROWS), outDir });
  expect(first.exported).toBe(3);

  const second = await exportSnapshots({ client: makeClient(SAMPLE_ROWS), outDir });
  expect(second.exported).toBe(0);
  expect(second.skipped).toBe(3);
  expect(second.files).toHaveLength(0);
});

test('일부 파일만 존재할 때 — 없는 것만 새로 씀', async () => {
  const outDir = makeTmpDir('-partial');
  tmpDirs.push(outDir);

  // id=1 만 미리 내보내기
  await exportSnapshots({ client: makeClient([SAMPLE_ROWS[0]]), outDir });

  // 3건 전체로 재실행
  const r = await exportSnapshots({ client: makeClient(SAMPLE_ROWS), outDir });
  expect(r.exported).toBe(2);   // id=2,3
  expect(r.skipped).toBe(1);    // id=1
});

// ── exportSnapshots: outDir 자동 생성 ───────────────────────────────────────

test('outDir 이 없으면 자동 생성', async () => {
  const outDir = join(tmpdir(), `cv-export-new-${Date.now()}`);
  tmpDirs.push(outDir);

  expect(existsSync(outDir)).toBe(false);
  const r = await exportSnapshots({ client: makeClient([SAMPLE_ROWS[0]]), outDir });
  expect(existsSync(outDir)).toBe(true);
  expect(r.exported).toBe(1);
});

// ── exportSnapshots: DB 오류 시 throw ────────────────────────────────────────

test('Supabase SELECT 오류 시 throw', async () => {
  const outDir = makeTmpDir('-err');
  tmpDirs.push(outDir);

  await expect(
    exportSnapshots({ client: makeErrorClient('permission denied', '42501'), outDir })
  ).rejects.toThrow('snapshots SELECT failed: permission denied (code: 42501)');
});

// ── exportSnapshots: empty table ─────────────────────────────────────────────

test('rows 0건 → exported=0, skipped=0', async () => {
  const outDir = makeTmpDir('-empty');
  tmpDirs.push(outDir);

  const r = await exportSnapshots({ client: makeClient([]), outDir });
  expect(r.exported).toBe(0);
  expect(r.skipped).toBe(0);
  expect(r.files).toHaveLength(0);
});
