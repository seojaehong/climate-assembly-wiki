/**
 * 한글(.hwpx) 적합성 게이트 — **실제 파일을 만들고 되읽어 숫자를 낸다. DB 에 쓰지 않는다.**
 *
 *   node scripts/verify-hangul.mjs
 *   node scripts/verify-hangul.mjs --keep     # 만든 .hwpx·.md 를 지우지 않는다
 *
 * 무엇을 재는가 — 「변환이 됐다」가 아니라 **카드가 몇 장 들어갔고 몇 장이 되나오는지**를 센다.
 *
 *   G1  컨테이너  kordoc `validateHwpx()` 가 ok:true 이고 issues 0.
 *                 (한컴오피스/한컴독스가 열기를 거부하는 결함을 미리 잡는 검사셋)
 *   G2  카드 수 보존  `parseHwpx()` 로 되읽어 표의 **데이터 행 수**와 **칸 글자**를
 *                 원본 모델·마크다운과 대조한다. 한 장이라도 줄면 실패다
 *                 (회의자료 260811 불변식 — 어떤 내보내기에서도 카드 수가 줄면 안 된다).
 *   G2b 미제출 조  한 조의 항목을 비운 판으로 한 번 더 돌려, 「※ 미제출 N개 조 — 이름」
 *                 한 줄이 한글 파일 안에 **글자 그대로** 남는지 본다.
 *   G3  한글이 실제로 여는가 — **사람이 수동으로 한다.** COM 자동화(`pyhwpx`)는 앱 창이 떠
 *                 루프를 멈추므로 이 스크립트에서 실행하지 않는다. 절차는 `verify_hangul.py`.
 *
 * ★ 내보내기 규칙을 여기에 베껴 적지 않는다 — `scripts/export-submissions-hwpx.mjs` 를
 *   **자식 프로세스로 실제 실행**해 나온 파일을 검사한다. 검사 대상이 곧 운영 경로다.
 *
 * 만드는 것은 `.gitignore` 된 `output/` 안의 임시 파일뿐이고 끝나면 지운다(`--keep` 로 남긴다).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseHwpx, validateHwpx } from 'kordoc';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const argv = process.argv.slice(2);
const KEEP = argv.includes('--keep');

const EXPORTER = resolve(HERE, 'export-submissions-hwpx.mjs');
const ROWS = resolve(ROOT, 'automation/fixtures/0829-submissions.json');
const OUT = resolve(ROOT, 'output');
/** 시각을 박아 파일 이름·문서 머리글이 실행마다 흔들리지 않게 한다. */
const STAMP = '2026-08-29 14:05';

/**
 * 실측 상수 — 2026-09-01, `automation/fixtures/0829-submissions.json` 로 잼.
 * 「N개 이상」이 아니라 실측값이다. 픽스처가 바뀌면 여기를 같이 고친다.
 */
const MEASURED = {
  rows: 65, // 픽스처 행 수
  cards: 65, // 모델 항목(카드) 수
  topics: 3, // 꼭지 수
  tables: 9, // 분과 표 수 (꼭지 3 × 분과)
  columns: 4, // 순번·이름·내용·근거
};

let pass = 0;
let fail = 0;
const check = (label, fn) => {
  try {
    const detail = fn();
    pass += 1;
    console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`);
  } catch (e) {
    fail += 1;
    console.log(`  FAIL  ${label} — ${e.message}`);
  }
};
const must = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

/**
 * 마크다운 표 한 줄을 칸으로 쪼갠다 — kordoc 파서와 같은 규칙을 **정규식 없이** 옮긴 것.
 * 앞뒤 파이프를 버리고(`.slice(1, -1)`), 이스케이프된 파이프는 글자로 되돌린다.
 */
const BACKSLASH = String.fromCharCode(92);
function splitMarkdownRow(line) {
  const inner = line.trim().slice(1, -1);
  const cells = [];
  let cur = '';
  for (let i = 0; i < inner.length; i += 1) {
    const ch = inner[i];
    if (ch === BACKSLASH && inner[i + 1] === '|') {
      cur += '|';
      i += 1;
    } else if (ch === '|') {
      cells.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  cells.push(cur.trim());
  return cells;
}

/** 마크다운 전문에서 표 줄만 걸러 칸 배열로. 구분선(`|---|`)은 버린다. */
function markdownTableCells(markdown) {
  const out = [];
  for (const line of markdown.split('\n')) {
    if (!line.startsWith('|')) continue;
    const cells = splitMarkdownRow(line);
    if (cells.every((c) => /^:?-{3,}:?$/.test(c))) continue;
    out.push(cells);
  }
  return out;
}

/** 내보내기 스크립트를 **실제로 돌려** .hwpx 와 마크다운 사본을 만든다. */
function runExport(tag, rowsPath) {
  const hwpxPath = resolve(OUT, `_verify-hangul-${tag}.hwpx`);
  const mdPath = resolve(OUT, `_verify-hangul-${tag}.md`);
  mkdirSync(OUT, { recursive: true });
  const stdout = execFileSync(
    process.execPath,
    [EXPORTER, '--rows', rowsPath, '--out', hwpxPath, '--md', mdPath, '--stamp', STAMP],
    { cwd: ROOT, encoding: 'utf8' }
  );
  return { hwpxPath, mdPath, stdout };
}

/** 되읽은 문서에서 표만 뽑는다. */
function tablesOf(parsed) {
  return parsed.blocks.filter((b) => b.type === 'table' && b.table);
}

console.log('\n한글(.hwpx) 적합성 게이트 · 8.29 실데이터 · DB 쓰기 없음\n');

// ── 준비 — 정상판 ────────────────────────────────────────────────
const rows = JSON.parse(readFileSync(ROWS, 'utf8'));
console.log(`  픽스처 ${ROWS}  (행 ${rows.length}건)`);

const main = runExport('main', ROWS);
const mainBytes = readFileSync(main.hwpxPath);
const mainMarkdown = readFileSync(main.mdPath, 'utf8');
const mainBuffer = mainBytes.buffer.slice(mainBytes.byteOffset, mainBytes.byteOffset + mainBytes.byteLength);
console.log(`  생성   ${main.hwpxPath}  (${mainBytes.length}바이트)\n`);

check(`픽스처 행 수 = 실측 ${MEASURED.rows}`, () => {
  must(rows.length === MEASURED.rows, `${rows.length}건 (실측 ${MEASURED.rows})`);
  return `${rows.length}/${MEASURED.rows}`;
});

// ── G1 — 컨테이너 검증 ──────────────────────────────────────────
const validation = await validateHwpx(mainBytes);
check('★ G1 kordoc validateHwpx() 가 ok:true 이고 issues 0', () => {
  must(validation.ok === true, `ok=${validation.ok}`);
  must(
    validation.issues.length === 0,
    `issues ${validation.issues.length}건 — ${validation.issues.map((i) => `${i.path ?? ''} ${i.message}`).join(' / ')}`
  );
  return `ok=true · issues 0/0 · zip 엔트리 ${validation.entryCount}개`;
});

// ── G2 — 되읽기 대조 ────────────────────────────────────────────
const parsed = await parseHwpx(mainBuffer);
check('되읽기가 성공한다 (parseHwpx)', () => {
  must(parsed.success === true, `success=${parsed.success}`);
  return `블록 ${parsed.blocks.length}개`;
});

const tables = tablesOf(parsed);
const mdCells = markdownTableCells(mainMarkdown);
/** 표 머리(순번·이름·내용·근거)를 뺀 데이터 행만. */
const mdDataRows = mdCells.filter((cells) => cells[0] !== '순번');
const hwpxDataRows = tables.flatMap((b) => b.table.cells.slice(1).map((r) => r.map((c) => c.text)));

check(`★ G2 표 데이터 행 수 = 항목 수 (원본 ${MEASURED.cards})`, () => {
  must(
    mdDataRows.length === MEASURED.cards,
    `마크다운 표 데이터 행 ${mdDataRows.length} (실측 ${MEASURED.cards})`
  );
  must(
    hwpxDataRows.length === MEASURED.cards,
    `되읽은 표 데이터 행 ${hwpxDataRows.length} (실측 ${MEASURED.cards})`
  );
  return `마크다운 ${mdDataRows.length}/${MEASURED.cards} · 한글 되읽기 ${hwpxDataRows.length}/${MEASURED.cards}`;
});

check(`표 개수·칸 수가 유지된다 (표 ${MEASURED.tables} · ${MEASURED.columns}칸)`, () => {
  must(tables.length === MEASURED.tables, `표 ${tables.length}개 (실측 ${MEASURED.tables})`);
  const badCols = tables.filter((b) => b.table.cols !== MEASURED.columns);
  must(badCols.length === 0, `${MEASURED.columns}칸이 아닌 표 ${badCols.length}개`);
  const headers = tables.map((b) => b.table.cells[0].map((c) => c.text).join('|'));
  const wrong = headers.filter((h) => h !== '순번|이름|내용|근거');
  must(wrong.length === 0, `표 머리가 다른 표 ${wrong.length}개 — ${wrong[0]}`);
  return `표 ${tables.length}/${MEASURED.tables} · 전부 ${MEASURED.columns}칸 · 머리 9/9 동일`;
});

check('★ G2 칸 글자가 한 자도 달라지지 않는다 (마크다운 ↔ 한글 되읽기)', () => {
  let same = 0;
  for (let i = 0; i < mdDataRows.length; i += 1) {
    const want = mdDataRows[i];
    const got = hwpxDataRows[i];
    must(got != null, `${i + 1}번째 행이 되읽기에 없다`);
    must(
      want.length === got.length,
      `${i + 1}번째 행 칸 수 ${want.length} → ${got.length}`
    );
    for (let c = 0; c < want.length; c += 1) {
      must(
        want[c] === got[c],
        `${i + 1}행 ${c + 1}칸이 달라졌다\n      전 ${JSON.stringify(want[c])}\n      후 ${JSON.stringify(got[c])}`
      );
      same += 1;
    }
  }
  return `${same}/${mdDataRows.length * MEASURED.columns}칸 동일`;
});

check(`꼭지 제목이 전부 문서에 남는다 (꼭지 ${MEASURED.topics})`, () => {
  const headings = parsed.blocks.filter((b) => b.type === 'heading');
  const h2 = headings.filter((b) => b.level === 2);
  must(h2.length === MEASURED.topics, `꼭지 헤딩 ${h2.length}개 (실측 ${MEASURED.topics})`);
  for (const b of h2) must((b.text ?? '').trim().length > 0, '빈 꼭지 제목');
  return `헤딩 ${headings.length}개 · 그중 꼭지(##) ${h2.length}/${MEASURED.topics} — ${h2.map((b) => b.text).join(' / ')}`;
});

check('안내 문구가 그대로 실린다 (잠정 산출물 표시)', () => {
  const text = parsed.markdown;
  const notice = '본 자료는 조가 작성한 원문 그대로이며, 문구 정리·통합은 이후 절차에서 이루어집니다.';
  must(text.includes(notice), '안내 문구가 없어졌다');
  return '1/1';
});

// ── G2b — 미제출 조 표기 ────────────────────────────────────────
/**
 * 픽스처에는 미제출 조가 하나도 없다(65건 전부 내용 있음) → 한 조의 꼭지1 항목을 **비워** 만든다.
 * ★ 행을 지우면 안 된다 — `buildBoards` 는 행에서 조 자리를 만들므로, 행을 지우면 그 조가
 *   꼭지에서 통째로 사라져 「미제출」이 아니라 「없는 조」가 된다(`hq-submission-board-logic.ts:103`).
 */
const SILENT_TEAM = '1분과 2조';
const silentRows = rows.map((r) =>
  r.team_name === SILENT_TEAM && r.topic_ordinal === 1 ? { ...r, item_content: '' } : r
);
const silentCards = silentRows.filter((r) => (r.item_content ?? '').trim().length > 0).length;
const silentRowsPath = resolve(OUT, '_verify-hangul-silent.json');
mkdirSync(OUT, { recursive: true });
writeFileSync(silentRowsPath, JSON.stringify(silentRows), 'utf8');

const silent = runExport('silent', silentRowsPath);
const silentBytes = readFileSync(silent.hwpxPath);
const silentBuffer = silentBytes.buffer.slice(
  silentBytes.byteOffset,
  silentBytes.byteOffset + silentBytes.byteLength
);
const silentParsed = await parseHwpx(silentBuffer);
const silentMarkdown = readFileSync(silent.mdPath, 'utf8');

check('★ 미제출 조 표기가 한글 파일에 글자 그대로 남는다', () => {
  const dropped = MEASURED.cards - silentCards;
  must(dropped > 0, `미제출 판을 못 만들었다 — 비운 항목 ${dropped}건`);
  const line = `※ 미제출 1개 조 — ${SILENT_TEAM}`;
  must(silentMarkdown.includes(line), `마크다운에 없다: ${line}`);
  must(silentParsed.success === true, '미제출 판 되읽기 실패');
  must(silentParsed.markdown.includes(line), `한글 되읽기에 없다: ${line}`);
  return `「${line}」 · 비운 항목 ${dropped}건`;
});

check('★ 미제출 판에서도 남은 카드가 한 장도 안 준다', () => {
  const want = silentCards;
  const silentTables = tablesOf(silentParsed);
  const got = silentTables.reduce((sum, b) => sum + (b.table.rows - 1), 0);
  must(got === want, `카드 ${want}장 → 되읽기 ${got}장`);
  return `${got}/${want}장`;
});

const silentValidation = await validateHwpx(silentBytes);
check('미제출 판도 G1 을 통과한다', () => {
  must(silentValidation.ok === true, `ok=${silentValidation.ok}`);
  must(silentValidation.issues.length === 0, `issues ${silentValidation.issues.length}건`);
  return `ok=true · issues 0/0`;
});

// ── G3 — 사람 몫 ────────────────────────────────────────────────
console.log('');
console.log('  G3(한글이 실제로 여는지)는 이 스크립트가 하지 않는다 — COM 자동화는 앱 창이 떠');
console.log('  루프를 멈춘다. 절차는 scripts/verify_hangul.py 머리말을 볼 것 (사람이 수동 실행).');

// ── 뒷정리 ──────────────────────────────────────────────────────
if (!KEEP) {
  for (const p of [main.hwpxPath, main.mdPath, silent.hwpxPath, silent.mdPath, silentRowsPath]) {
    if (existsSync(p)) rmSync(p, { force: true });
  }
  console.log('\n  만든 임시 파일 5개를 지웠다 (--keep 으로 남길 수 있다).');
} else {
  console.log(`\n  --keep — ${OUT} 에 남겼다.`);
}

console.log(`\n결과: ${pass} PASS · ${fail} FAIL  (${pass}/${pass + fail})\n`);
process.exit(fail === 0 ? 0 : 1);
