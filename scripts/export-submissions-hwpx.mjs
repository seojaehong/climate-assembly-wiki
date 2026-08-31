/**
 * 조별 산출물 → 한글(.hwpx) 내보내기 — **실데이터를 넣어 실제 파일을 만든다.**
 *
 *   node scripts/export-submissions-hwpx.mjs
 *   node scripts/export-submissions-hwpx.mjs --rows <경로.json> --out <경로.hwpx> --md <경로.md>
 *   node scripts/export-submissions-hwpx.mjs --stamp "2026-08-29 14:05"   # 시각 고정(재현용)
 *
 * 무엇을 하는가 — 화면이 쓰는 모델(`buildBoards` → `buildSubmissionReport`)을 그대로 태워
 * `reportToMarkdown()` 으로 마크다운을 만들고, kordoc `markdownToHwpx()` 로 .hwpx 를 쓴다.
 * **모델도 마크다운도 여기서 새로 만들지 않는다** — 렌더러만 하나 더 붙인 것이다
 * (한글 설계 §6 「모델은 하나, 렌더러만 늘린다」).
 *
 * ★ 규칙을 이 파일에 베껴 적지 않는다 — esbuild 로 `.ts` 를 그 자리에서 말아 올려 import 한다.
 *   `verify-name-reparse.mjs` 의 `data:` URL 수법은 여기서 통하지 않는다:
 *   `buildBoards`·`buildSubmissionReport` 는 다른 모듈을 **값으로** 물고 오므로
 *   `transform` 만으로는 `./hq-submission-board-logic` 이 확장자 없이 남는다.
 *   그래서 `verify-parsers.mjs` 와 같이 **하나의 번들**(`bundle: true`, `packages: 'external'`)
 *   로 재수출해 `node_modules/.cache/` 안 실제 `.mjs` 로 쓰고 `pathToFileURL()` 로 부른다.
 *
 * ★ kordoc 은 Node 전용이다(`zlib`·`crypto` 를 정적 import 한다). 브라우저 번들에 넣지 말 것 —
 *   그래서 이 층(스크립트)에서만 kordoc 을 부르고, `submission-report-markdown.ts` 는
 *   kordoc 을 모른다.
 *
 * 쓰기 — 만드는 것은 지정한 출력 파일뿐이다(기본값은 `.gitignore` 된 `output/`).
 * DB 에 접속하지 않는다.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { markdownToHwpx } from 'kordoc';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const CACHE = resolve(ROOT, 'node_modules/.cache/export-submissions-hwpx');

/** 8.29 실데이터 픽스처 — 화면 검증 라우트(submission-lab)가 쓰는 것과 같은 파일. */
const DEFAULT_ROWS = resolve(ROOT, 'automation/fixtures/0829-submissions.json');
const DEFAULT_OUT_DIR = resolve(ROOT, 'output');

/**
 * 화면이 쓰는 모듈을 **한 번에** 말아 올린다. 상대 import 는 안으로 말리고
 * bare 지정자(`kordoc` 등)는 밖에 남는다. 같은 모듈을 두 번 부르지 않는다.
 */
export async function loadReportBundle() {
  const entry = [
    "export { buildBoards } from './src/islands/mod/hq-submission-board-logic';",
    "export { buildSubmissionReport, formatStamp } from './src/islands/mod/submission-report';",
    "export { reportToMarkdown, countMarkdownTableRows } from './src/islands/mod/submission-report-markdown';",
  ].join('\n');
  mkdirSync(CACHE, { recursive: true });
  const out = resolve(CACHE, 'bundle.mjs');
  const result = await build({
    stdin: {
      contents: entry,
      resolveDir: ROOT,
      loader: 'ts',
      sourcefile: 'export-submissions-hwpx-entry.ts',
    },
    bundle: true,
    platform: 'node',
    format: 'esm',
    packages: 'external',
    write: false,
  });
  writeFileSync(out, result.outputFiles[0].text, 'utf8');
  return import(pathToFileURL(out).href);
}

/** 파일명에 못 쓰는 글자를 뗀다 — `submission-report.ts` 의 safeName 과 같은 규칙. */
function safeName(value) {
  return value.replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, ' ').trim();
}

/** 「기후시민회의_조별산출물_전체15개조_20260829-1405.hwpx」 */
export function hwpxFileName(report, ext) {
  const stamp = report.generatedAt.replace(/[-: ]/g, '').replace(/^(\d{8})(\d{4})$/, '$1-$2');
  const scope = safeName(report.scopeLabel).replace(/\s+/g, '') || '전체';
  return `기후시민회의_조별산출물_${scope}_${stamp}.${ext}`;
}

/**
 * 행 배열 → { report, markdown, hwpx }.
 *
 * `rows` 는 본부 화면이 RPC 에서 받는 것과 같은 모양(HqSubmissionRow[])이다.
 * 아무것도 파일로 쓰지 않는다 — 쓰기는 호출부(`main`)가 한다.
 */
export async function buildHwpxExport(rows, opts = {}) {
  const mod = opts.bundle ?? (await loadReportBundle());
  const boards = mod.buildBoards(rows);
  const teamCount = new Set(rows.map((r) => r.team_id)).size;
  const report = mod.buildSubmissionReport(boards, {
    generatedAt: opts.generatedAt ?? mod.formatStamp(new Date()),
    scopeLabel: opts.scopeLabel ?? `전체 ${teamCount}개 조`,
  });
  const markdown = mod.reportToMarkdown(report);
  const hwpx = await markdownToHwpx(markdown);
  return {
    report,
    markdown,
    hwpx,
    markdownTableRows: mod.countMarkdownTableRows(markdown),
  };
}

const argv = process.argv.slice(2);
const arg = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? null : (argv[i + 1] ?? fallback);
};

async function main() {
  const rowsPath = resolve(ROOT, arg('rows') ?? DEFAULT_ROWS);
  const rows = JSON.parse(readFileSync(rowsPath, 'utf8'));
  if (!Array.isArray(rows)) throw new Error(`행 배열이 아니다: ${rowsPath}`);

  const built = await buildHwpxExport(rows, {
    generatedAt: arg('stamp') ?? undefined,
    scopeLabel: arg('scope') ?? undefined,
  });

  const outPath = resolve(ROOT, arg('out') ?? resolve(DEFAULT_OUT_DIR, hwpxFileName(built.report, 'hwpx')));
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, Buffer.from(built.hwpx));

  const mdArg = arg('md');
  let mdPath = null;
  if (mdArg) {
    mdPath = resolve(ROOT, mdArg);
    mkdirSync(dirname(mdPath), { recursive: true });
    writeFileSync(mdPath, built.markdown, 'utf8');
  }

  console.log('조별 산출물 → 한글(.hwpx) 내보내기');
  console.log(`  입력   ${rowsPath}  (행 ${rows.length}건)`);
  console.log(`  모델   꼭지 ${built.report.topics.length} · 항목(카드) ${built.report.totalNotes}건`);
  console.log(`  마크다운  ${built.markdown.length}자 · 표 데이터 행 ${built.markdownTableRows}`);
  console.log(`  출력   ${outPath}  (${Buffer.from(built.hwpx).length}바이트)`);
  if (mdPath) console.log(`  마크다운 사본  ${mdPath}`);
}

if (resolve(process.argv[1] ?? '') === resolve(fileURLToPath(import.meta.url))) {
  await main();
}
