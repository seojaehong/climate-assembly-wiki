/**
 * export-snapshots-onedrive.mjs
 * OneDrive append-only snapshot export — off-Supabase durability layer
 *
 * USAGE
 * ─────
 * # 1회 실행 (수동)
 * cd automation
 * ONEDRIVE_EXPORT_DIR="C:/Users/iceam/OneDrive/기후시민회의_스냅샷" \
 *   SUPABASE_URL=<url> SUPABASE_SERVICE_ROLE_KEY=<key> \
 *   node export-snapshots-onedrive.mjs
 *
 * # Windows 작업 스케줄러 예시 (워크숍 당일 30분마다)
 *   프로그램: node
 *   인자:     C:\Users\iceam\dev\climate-assembly-wiki\automation\export-snapshots-onedrive.mjs
 *   시작 위치: C:\Users\iceam\dev\climate-assembly-wiki\automation
 *   환경변수:  ONEDRIVE_EXPORT_DIR, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *
 * APPEND-ONLY 보장
 * ────────────────
 * 각 스냅샷은 snapshot_<id>_<sanitized-label>.json 으로 저장.
 * 파일이 이미 존재하면 skip(덮어쓰기 없음).
 * 파일 쓰기는 .tmp → rename 방식으로 원자적 처리 (반쪽 파일 방지).
 *
 * ENV VARS
 * ────────
 * ONEDRIVE_EXPORT_DIR        내보낼 폴더 (기본: <script 위치>/../.vote-snapshots)
 * SUPABASE_URL               Supabase 프로젝트 URL
 * SUPABASE_SERVICE_ROLE_KEY  service_role JWT (우선). 없으면 SUPABASE_SERVICE_ROLE 사용.
 *                            snapshot-db.mjs + RUNBOOK은 SUPABASE_SERVICE_ROLE 명칭 사용.
 *
 * PREREQ: service_role이 climate_vote 스키마에 USAGE + snapshots에 SELECT 권한 보유.
 *         (supabase/migrations/20260621143355_grant_service_role_snapshots_read.sql 적용 필요)
 */

import { fileURLToPath } from 'node:url';
import { existsSync, mkdirSync, writeFileSync, renameSync } from 'node:fs';
import { join, resolve } from 'node:path';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

/**
 * label을 파일명 안전 문자열로 변환.
 * 한글·영문·숫자·하이픈·언더스코어만 허용, 나머지는 '_'로 대체.
 * @param {string|null} label
 * @returns {string}
 */
export function sanitizeLabel(label) {
  if (!label) return 'unlabeled';
  return label.replace(/[^a-zA-Z0-9가-힣\-_]/g, '_').slice(0, 64);
}

/**
 * Supabase client로 climate_vote.snapshots 를 SELECT하고
 * outDir에 append-only JSON 파일로 내보낸다.
 *
 * @param {{ client: object, outDir: string }} opts
 *   client  - supabase-js createClient 인스턴스 (service_role)
 *   outDir  - 내보낼 폴더 경로 (존재하지 않으면 생성)
 * @returns {Promise<{ exported: number, skipped: number, outDir: string, files: string[] }>}
 */
export async function exportSnapshots({ client, outDir }) {
  mkdirSync(outDir, { recursive: true });

  const { data: rows, error } = await client
    .schema('climate_vote')
    .from('snapshots')
    .select('*')
    .order('id');

  if (error) {
    throw new Error(`snapshots SELECT failed: ${error.message} (code: ${error.code})`);
  }

  let exported = 0;
  let skipped = 0;
  const files = [];

  for (const row of rows) {
    const filename = `snapshot_${row.id}_${sanitizeLabel(row.label)}.json`;
    const outPath = join(outDir, filename);

    if (existsSync(outPath)) {
      skipped++;
      continue;
    }

    // 원자적 쓰기: .tmp → rename
    const tmpPath = outPath + '.tmp';
    writeFileSync(tmpPath, JSON.stringify(row, null, 2), 'utf8');
    renameSync(tmpPath, outPath);

    exported++;
    files.push(filename);
  }

  return { exported, skipped, outDir, files };
}

// ── CLI 진입점 ─────────────────────────────────────────────────────────────────
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { createClient } = await import('@supabase/supabase-js');

  const url = process.env.SUPABASE_URL;
  // RUNBOOK·snapshot-db.mjs 은 SUPABASE_SERVICE_ROLE 사용; 로컬 쉘은 _KEY suffix 사용.
  // 두 이름 모두 허용 — SUPABASE_SERVICE_ROLE_KEY 우선, 없으면 SUPABASE_SERVICE_ROLE.
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_ROLE;
  if (!url || !key) {
    console.error('오류: SUPABASE_URL 과 SUPABASE_SERVICE_ROLE_KEY (또는 SUPABASE_SERVICE_ROLE) 환경변수가 필요합니다.');
    process.exit(1);
  }

  const outDir = resolve(
    process.env.ONEDRIVE_EXPORT_DIR ??
    join(__dirname, '..', '.vote-snapshots')
  );

  const client = createClient(url, key);
  const result = await exportSnapshots({ client, outDir });

  console.log(JSON.stringify({
    status: 'ok',
    exported: result.exported,
    skipped: result.skipped,
    outDir: result.outDir,
    files: result.files,
  }, null, 2));
}
