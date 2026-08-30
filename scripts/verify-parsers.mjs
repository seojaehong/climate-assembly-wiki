/**
 * 파서 어댑터 드라이런 — **실제 문서를 넣어 숫자를 낸다. 아무것도 쓰지 않는다.**
 *
 *   node scripts/verify-parsers.mjs
 *   node scripts/verify-parsers.mjs --texts    # 뽑힌 첫 단위들을 더 길게 찍는다
 *   node scripts/verify-parsers.mjs --fast     # 114MB A조 hwp(US-004 증거)를 건너뛴다
 *
 * 무엇을 재는가 — 「테스트가 통과했다」가 아니라 **단위가 몇 개 나오고 무엇이 거절되는지**를 센다.
 * US-003(rhwp 구조 API) · US-004(누락 검사) · US-005(kordoc) · US-006(진입점) · US-007(641건 회귀)
 * 의 실측을 **이 스크립트 하나로** 모았다.
 *
 * ★ 대조 대상은 **어댑터 그 자체**다. 규칙을 이 파일에 베껴 적지 않는다 —
 *   esbuild 로 `src/lib/parsers/*.ts` 를 변환해 불러온다. 다만 `verify-name-reparse.mjs`
 *   가 쓰는 `data:` URL 수법은 여기서 통하지 않는다: 어댑터는 `kordoc`·`@rhwp/core` 같은
 *   bare 지정자를 import 하는데 data: URL 모듈에서는 그것이 해석되지 않는다.
 *   그래서 변환본을 **저장소 안 실제 `.mjs` 파일**(`node_modules/.cache/`)로 쓰고
 *   `pathToFileURL()` 로 불러온다 — 그 자리에서는 node_modules 를 거슬러 올라가 찾는다.
 *
 * ★ 그리고 **한 번만 말아 올린다.** `index.ts` 는 어댑터를 상대경로로 값 import 하므로
 *   `transform` 으로는 못 불러오고(`./rhwp-adapter` 가 확장자 없이 남는다) `bundle: true` 가
 *   필요하다. 어댑터를 그와 **따로** 한 번 더 불러오면 같은 모듈의 사본이 둘이 되어 WASM
 *   초기화 가드가 갈라진다. 그래서 진입점·어댑터·줄 분해 규칙을 **하나의 번들**로 재수출한다.
 *
 * 쓰기 없음 — 원본 문서와 백업본은 읽기만 하고 DB 에 접속조차 하지 않는다.
 */
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const argv = process.argv.slice(2);
const FAST = argv.includes('--fast');

/** 시험용 실제 문서 — 저장소 밖 원본을 **읽기만** 한다(옮기지도 고치지도 않는다). */
const DOCX = resolve(ROOT, '../10_작업산출물/2026-08-29_조별산출물_전수/0829_조별산출물_전수.docx');
const HWPX = resolve(ROOT, '../00_입력자료/기후시민회의_정책권고안_(양식_초안)_20260811203741.hwpx');
/** US-004 의 증거 문서. **119,689,216바이트** — 진입점의 20MB 한도에 막히므로 어댑터를 직접 부른다. */
const HWP_BIG = resolve(
  ROOT,
  '../00_입력자료/★20260613 기후시민회의 의제숙의워크숍 결과보고서_발화자 추가_A조.hwp',
);
/** US-006 의 `.hwp` 라우팅용. 1.9MB 라 진입점을 그대로 통과한다. */
const HWP_SMALL = resolve(ROOT, '../00_입력자료/★20260613 기후시민회의 의제숙의워크숍 결과.hwp');
/** 8.29 행사 산출물 백업본 — 641건 item_content 가 들어 있다. */
const BACKUP = resolve(ROOT, '../10_작업산출물/2026-08-29_산출물_백업/latest.json');

const CACHE = resolve(ROOT, 'node_modules/.cache/verify-parsers');

/**
 * 진입점·어댑터·줄 분해 규칙을 **한 번에** 말아 올린다(형만 벗기는 게 아니라 상대 import 를
 * 안으로 말아 넣는다). `packages: 'external'` 이라 `kordoc`·`@rhwp/core` 는 밖에 남아
 * node_modules 에서 그대로 풀린다.
 */
async function loadBundle() {
  const entry = [
    "export { extractDocument, planExtraction, extensionOf, MAX_BYTES } from './src/lib/parsers/index';",
    "export { extractWithRhwp } from './src/lib/parsers/rhwp-adapter';",
    "export { extractWithKordoc } from './src/lib/parsers/kordoc-adapter';",
    "export { splitSubmissionLines } from './src/islands/mod/submission-panel-logic';",
  ].join('\n');
  mkdirSync(CACHE, { recursive: true });
  const out = resolve(CACHE, 'bundle.mjs');
  const result = await build({
    stdin: { contents: entry, resolveDir: ROOT, loader: 'ts', sourcefile: 'verify-parsers-entry.ts' },
    bundle: true,
    platform: 'node',
    format: 'esm',
    packages: 'external',
    write: false,
  });
  writeFileSync(out, result.outputFiles[0].text, 'utf8');
  return import(pathToFileURL(out).href);
}

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
const must = (c, m) => {
  if (!c) throw new Error(m);
};
const lenStats = (units) => {
  const lens = units.map((u) => u.text.length).sort((a, b) => a - b);
  return { median: lens[lens.length >> 1] ?? 0, max: lens[lens.length - 1] ?? 0 };
};

console.log('\n파서 어댑터 드라이런 · 실제 문서 · 쓰기 없음\n');

const {
  extractDocument,
  planExtraction,
  extractWithRhwp,
  extractWithKordoc,
  splitSubmissionLines,
  MAX_BYTES,
} = await loadBundle();

// ── US-003 · rhwp 어댑터 (구조 API 로 셀 문단 추출) ──────────────
//
// ★ 기준 숫자는 `20_스크립트/parsers/measurement/rhwp_units.json` 의 저장 실측과 같은
//   순회에서 나온다(f_form.hwpx 164단위). README 표의 「1,256단위」는 다른 파이프라인 수치다.
const RHWP_HWPX = { units: 164, body: 84, cells: 80, chars: 2707, maxOver200: 0 };

const tHwpx = Date.now();
const hwpx = await extractWithRhwp(readFileSync(HWPX));
const msHwpx = Date.now() - tHwpx;
const hwpxStats = lenStats(hwpx.units);

console.log(`  ── US-003 rhwp · ${HWPX.split(/[/\\]/).pop()} ─────────`);
console.log(
  `     ${msHwpx}ms · 단위 ${hwpx.units.length} · ${hwpx.charCount}자 · 중앙값 ${hwpxStats.median} · 최대 ${hwpxStats.max} · 경고 ${hwpx.warnings.length}`,
);
console.log('     첫 5개 단위:');
hwpx.units.slice(0, 5).forEach((u, i) => {
  const t = u.text.replace(/\n/g, '⏎');
  console.log(`       ${i + 1}. ${JSON.stringify(argv.includes('--texts') ? t : t.slice(0, 70))}`);
});
console.log('');

check('★ US-003 HWPX 가 100단위 이상으로 나오고 200자 초과 단위가 0개다', () => {
  must(hwpx.units.length >= 100, `단위 ${hwpx.units.length}개 — 100 미만`);
  must(
    hwpx.units.length === RHWP_HWPX.units,
    `단위 ${hwpx.units.length} ≠ 저장 실측 ${RHWP_HWPX.units} — 순회가 갈렸다`,
  );
  const over = hwpx.units.filter((u) => u.text.length > 200);
  must(over.length === RHWP_HWPX.maxOver200, `200자 초과 ${over.length}개`);
  return `${hwpx.units.length}단위 · 최대 ${hwpxStats.max}자 · 200자 초과 ${over.length}개`;
});

check('★ US-003 본문 문단과 표 셀 문단이 각각 개별 단위로 나온다', () => {
  const cells = hwpx.units.filter((u) => u.provenance?.cell !== undefined);
  const body = hwpx.units.filter((u) => u.provenance?.cell === undefined);
  must(cells.length === RHWP_HWPX.cells, `셀 단위 ${cells.length} ≠ ${RHWP_HWPX.cells}`);
  must(body.length === RHWP_HWPX.body, `본문 단위 ${body.length} ≠ ${RHWP_HWPX.body}`);
  return `본문 ${body.length} · 셀 ${cells.length}`;
});

check('★ US-003 provenance 결측 0 · engine 전부 rhwp · 공백만 있는 단위 0', () => {
  const noSection = hwpx.units.filter((u) => typeof u.provenance?.section !== 'number');
  const noPara = hwpx.units.filter((u) => typeof u.provenance?.para !== 'number');
  must(noSection.length === 0, `section 없는 단위 ${noSection.length}개`);
  must(noPara.length === 0, `para 없는 단위 ${noPara.length}개`);
  const cells = hwpx.units.filter((u) => u.provenance?.cell !== undefined);
  const badCell = cells.filter(
    (u) => typeof u.provenance.control !== 'number' || typeof u.provenance.cellPara !== 'number',
  );
  must(badCell.length === 0, `control·cellPara 가 빠진 셀 단위 ${badCell.length}개`);
  const wrong = hwpx.units.filter((u) => u.provenance?.engine !== 'rhwp');
  must(wrong.length === 0, `engine 이 rhwp 가 아닌 단위 ${wrong.length}개`);
  const blank = hwpx.units.filter((u) => u.text.trim() === '');
  must(blank.length === 0, `공백만 있는 단위 ${blank.length}개`);
  return `section/para ${hwpx.units.length}/${hwpx.units.length} · 셀 control/cell ${cells.length}/${cells.length}`;
});

check('★ US-003 charCount 가 단위 글자수의 합과 정확히 같다', () => {
  const sum = hwpx.units.reduce((a, u) => a + u.text.length, 0);
  must(sum === hwpx.charCount, `합 ${sum} ≠ charCount ${hwpx.charCount}`);
  must(sum === RHWP_HWPX.chars, `${sum}자 ≠ 실측 ${RHWP_HWPX.chars}자`);
  return `${sum}자`;
});

// ── US-004 · 누락 검사 (두 경로 글자수 대조) ────────────────────
//
// ★ 이 검사는 **진입점이 아니라 어댑터를 직접** 부른다. 증거 문서가 119,689,216바이트라
//   `extractDocument` 의 20MB 한도에 먼저 걸린다(US-006 이 그렇게 설계됐다).
check('★ US-004 멀쩡한 HWPX 에는 누락 경고가 붙지 않는다', () => {
  must(hwpx.warnings.length === 0, `경고가 붙었다: ${JSON.stringify(hwpx.warnings)}`);
  return '경고 0건';
});

if (FAST) {
  console.log('  SKIP  ★ US-004 중첩표 누락 경고 (--fast — 114MB A조 hwp 를 건너뛴다)\n');
} else {
  const tBig = Date.now();
  const big = await extractWithRhwp(readFileSync(HWP_BIG));
  const msBig = Date.now() - tBig;
  const bigWarn = big.warnings.find((w) => w.kind === 'missing-content');

  console.log(`  ── US-004 rhwp · ${HWP_BIG.split(/[/\\]/).pop()} ─────────`);
  console.log(
    `     ${msBig}ms · 단위 ${big.units.length} · ${big.charCount}자 · 경고 ${big.warnings.length}`,
  );
  if (bigWarn) console.log(`     경고 문구: ${bigWarn.message}`);
  console.log('');

  check('★ US-004 중첩표를 놓친 HWP 에서 missing-content 경고가 실제로 뜬다', () => {
    must(big.warnings.length === 1, `경고가 ${big.warnings.length}개`);
    must(bigWarn, `missing-content 가 아니다: ${JSON.stringify(big.warnings[0])}`);
    // 메시지가 두 수치를 **모두** 적는지 — 「빠졌다」만 말하면 고칠 수가 없다.
    const nums = bigWarn.message.match(/[\d,]{3,}/g) ?? [];
    must(nums.length >= 2, `메시지에 수치가 ${nums.length}개뿐: ${bigWarn.message}`);
    return `단위 ${big.units.length} · 경고 1건 · 수치 ${nums.slice(0, 2).join(' vs ')}`;
  });

  check('★ US-004 경고가 떠도 뽑을 수 있는 것은 뽑는다 (units 를 비우지 않는다)', () => {
    must(big.units.length >= 800, `단위 ${big.units.length}개 — 저장 실측 842 에 못 미친다`);
    const wrong = big.units.filter((u) => u.provenance?.engine !== 'rhwp');
    must(wrong.length === 0, `engine 이 rhwp 가 아닌 단위 ${wrong.length}개`);
    return `${big.units.length}단위 · ${big.charCount}자`;
  });
}

// ── US-005 · kordoc 어댑터 (DOCX 전용) ──────────────────────────
const t0 = Date.now();
const docx = await extractWithKordoc(readFileSync(DOCX));
const ms = Date.now() - t0;
const docxStats = lenStats(docx.units);

console.log(`  ── US-005 kordoc · ${DOCX.split(/[/\\]/).pop()} ─────────`);
console.log(
  `     ${ms}ms · 단위 ${docx.units.length} · ${docx.charCount}자 · 중앙값 ${docxStats.median} · 최대 ${docxStats.max} · 경고 ${docx.warnings.length}`,
);
console.log('     첫 5개 단위:');
docx.units.slice(0, 5).forEach((u, i) => {
  const t = u.text.replace(/\n/g, '⏎');
  console.log(`       ${i + 1}. ${JSON.stringify(argv.includes('--texts') ? t : t.slice(0, 70))}`);
});
console.log('');

check('★ US-005 실제 DOCX 에서 단위가 나온다 (100개 이상)', () => {
  must(docx.warnings.length === 0, `경고가 붙었다: ${JSON.stringify(docx.warnings)}`);
  must(docx.units.length >= 100, `단위 ${docx.units.length}개`);
  return `${docx.units.length}단위 · ${docx.charCount}자`;
});

check('★ US-005 한국어가 깨지지 않는다 — 치환문자(U+FFFD)·물음표 뭉침 0', () => {
  const broken = docx.units.filter((u) => /�/.test(u.text));
  must(broken.length === 0, `치환문자 ${broken.length}개 — 예: ${JSON.stringify(broken[0]?.text.slice(0, 40))}`);
  const hangul = docx.units.filter((u) => /[가-힣]/.test(u.text));
  must(hangul.length > docx.units.length / 2, `한글이 든 단위 ${hangul.length}/${docx.units.length}`);
  // 문서에 실제로 있는 문자열이 온전히 살아 있는지 눈으로 고른 표본으로 확인한다.
  const joined = docx.units.map((u) => u.text).join(String.fromCharCode(0));
  for (const probe of ['기후시민회의', '분과', '꼭지']) {
    must(joined.includes(probe), `표본 문자열이 사라졌다: ${probe}`);
  }
  return `치환문자 0 · 한글 단위 ${hangul.length}/${docx.units.length} · 표본 3/3 보존`;
});

check('★ US-005 charCount 가 단위 글자수의 합과 정확히 같다', () => {
  const sum = docx.units.reduce((a, u) => a + u.text.length, 0);
  must(sum === docx.charCount, `합 ${sum} ≠ charCount ${docx.charCount}`);
  return `${sum}자`;
});

check('★ US-005 모든 단위의 provenance.engine 이 kordoc 이고, 공백만 있는 단위가 없다', () => {
  const wrong = docx.units.filter((u) => u.provenance?.engine !== 'kordoc');
  must(wrong.length === 0, `engine 이 kordoc 이 아닌 단위 ${wrong.length}개`);
  const blank = docx.units.filter((u) => u.text.trim() === '');
  must(blank.length === 0, `공백만 있는 단위 ${blank.length}개`);
  return `${docx.units.length}/${docx.units.length}`;
});

// 거절 경로는 먼저 돌려 두고 아래에서 센다(check 는 동기 함수만 받는다).
const refusedHwpx = await extractWithKordoc(readFileSync(HWPX));
const refusedHwp = await extractWithKordoc(readFileSync(HWP_SMALL));
const refusedJunk = await extractWithKordoc(Buffer.from('이건 문서가 아니다. zip 도 OLE2 도 아니다.'));

/** 거절이란: 단위 0 · charCount 0 · unsupported 경고 하나. 성공으로 위장하지 않는다. */
const refuses = (result, what, kind = 'unsupported') => () => {
  must(result.units.length === 0, `${what} 인데 단위가 ${result.units.length}개 나왔다`);
  must(result.charCount === 0, `${what} 인데 charCount ${result.charCount}`);
  must(result.warnings.length === 1, `경고가 ${result.warnings.length}개`);
  must(result.warnings[0].kind === kind, `경고 종류 ${result.warnings[0].kind} ≠ ${kind}`);
  return `units 0 · ${JSON.stringify(result.warnings[0].detail ?? result.warnings[0].message)}`;
};

check('★ US-005 HWPX 를 넣으면 거절한다 — units 를 비우고 unsupported 를 올린다', refuses(refusedHwpx, 'hwpx'));
check('★ US-005 HWP 를 넣으면 거절한다 — units 를 비우고 unsupported 를 올린다', refuses(refusedHwp, 'hwp'));
check('★ US-005 문서가 아닌 바이트를 넣어도 던지지 않고 거절한다', refuses(refusedJunk, '쓰레기 바이트'));

// ── US-006 · 통합 진입점 (확장자 → 크기 → 엔진) ─────────────────
const routedHwpx = await extractDocument(readFileSync(HWPX), '정책권고안.hwpx');
const routedHwp = await extractDocument(readFileSync(HWP_SMALL), '결과.hwp');
const routedDocx = await extractDocument(readFileSync(DOCX), '조별산출물.docx');
const routedDoc = await extractDocument(readFileSync(DOCX), '조별산출물.doc');
const routedPdf = await extractDocument(Buffer.from('%PDF-1.7'), '보고서.pdf');
const routedJunk = await extractDocument(Buffer.from('이건 hwp 가 아니다'), '가짜.hwp');

console.log(`\n  ── US-006 진입점 라우팅 ─────────`);
console.log(
  `     .hwpx → ${routedHwpx.units.length}단위 ${routedHwpx.charCount}자 · .hwp → ${routedHwp.units.length}단위 ${routedHwp.charCount}자 · .docx → ${routedDocx.units.length}단위 ${routedDocx.charCount}자\n`,
);

check('★ US-006 .hwpx 는 rhwp 로, .docx 는 kordoc 으로 간다 — 어댑터 직접 호출과 같은 수가 나온다', () => {
  must(
    routedHwpx.units.length === hwpx.units.length && routedHwpx.charCount === hwpx.charCount,
    `hwpx 가 다르다 — 진입점 ${routedHwpx.units.length}/${routedHwpx.charCount} vs 어댑터 ${hwpx.units.length}/${hwpx.charCount}`,
  );
  must(
    routedDocx.units.length === docx.units.length && routedDocx.charCount === docx.charCount,
    `docx 가 다르다 — 진입점 ${routedDocx.units.length}/${routedDocx.charCount} vs 어댑터 ${docx.units.length}/${docx.charCount}`,
  );
  must(routedHwpx.units.every((u) => u.provenance.engine === 'rhwp'), 'hwpx 가 rhwp 로 안 갔다');
  must(routedDocx.units.every((u) => u.provenance.engine === 'kordoc'), 'docx 가 kordoc 으로 안 갔다');
  return `hwpx ${routedHwpx.units.length}단위 · docx ${routedDocx.units.length}단위 — 어댑터와 동일`;
});

check('★ US-006 .hwp 도 rhwp 로 간다 (구형 OLE2)', () => {
  must(routedHwp.units.length > 0, `단위가 ${routedHwp.units.length}개`);
  must(routedHwp.units.every((u) => u.provenance.engine === 'rhwp'), 'rhwp 로 안 갔다');
  return `${routedHwp.units.length}단위 · ${routedHwp.charCount}자 · ${(statSync(HWP_SMALL).size / 1024 / 1024).toFixed(1)}MB`;
});

check('★ US-006 .doc 는 거절하고 「.docx 로 올려 주세요」를 말한다', () => {
  const w = routedDoc.warnings[0];
  must(routedDoc.units.length === 0, `단위가 ${routedDoc.units.length}개 나왔다`);
  must(w?.kind === 'unsupported', `경고 종류 ${w?.kind}`);
  must(w.message.includes('.docx'), `안내가 없다: ${w.message}`);
  must(w.message.includes('다른 이름으로 저장'), `안내가 없다: ${w.message}`);
  // 진짜 docx 바이트를 `.doc` 이름으로 넣어도 막힌다 — 확장자로 판단한다.
  return JSON.stringify(w.message);
});

check('★ US-006 알 수 없는 확장자와 내용이 어긋난 파일은 던지지 않고 unsupported 로 거절한다', () => {
  must(routedPdf.warnings[0]?.kind === 'unsupported', `pdf 경고 ${routedPdf.warnings[0]?.kind}`);
  must(routedPdf.units.length === 0, 'pdf 에서 단위가 나왔다');
  must(routedJunk.warnings[0]?.kind === 'unsupported', `가짜 hwp 경고 ${routedJunk.warnings[0]?.kind}`);
  must(routedJunk.units.length === 0, '가짜 hwp 에서 단위가 나왔다');
  return `.pdf · 내용이 hwp 가 아닌 .hwp — 둘 다 unsupported`;
});

check('★ US-006 20MB 경계 — 정확히 20MB 는 통과, 1바이트 더는 too-large', () => {
  must(MAX_BYTES === 20 * 1024 * 1024, `한도가 ${MAX_BYTES}`);
  const atCap = planExtraction('큰.hwpx', MAX_BYTES);
  const overCap = planExtraction('큰.hwpx', MAX_BYTES + 1);
  must(atCap.engine === 'rhwp', `${MAX_BYTES}바이트가 막혔다`);
  must(overCap.engine === null && overCap.warning.kind === 'too-large', `초과가 안 막혔다`);
  return `${MAX_BYTES} 통과 · ${MAX_BYTES + 1} too-large`;
});

check('★ US-006 US-004 의 증거 문서(114MB)는 진입점에서 too-large 로 막힌다', () => {
  const size = statSync(HWP_BIG).size;
  const plan = planExtraction('A조.hwp', size);
  must(plan.engine === null && plan.warning.kind === 'too-large', `${size}바이트가 안 막혔다`);
  // ★ 그래서 US-004 의 누락 검사는 진입점이 아니라 어댑터를 직접 부른다(위 참조).
  return `${size}바이트(${(size / 1024 / 1024).toFixed(1)}MB) → too-large`;
});

// ── US-007 · 8.29 산출물 641건 회귀 ─────────────────────────────
//
// 파서 도입이 **기존 저장 규칙을 건드리지 않았다**는 증거다.
// ★ 아래 상수는 2026-08-30 에 `latest.json` 을 `splitSubmissionLines` 로 돌려 얻은 실측이다.
//   같은 규칙 파일(`src/islands/mod/submission-panel-logic.ts`)은 이 브랜치에서 **한 줄도
//   바뀌지 않았다**(`git diff main -- <그 파일>` 이 비어 있다). 즉 이 숫자가 「기존」이고,
//   아래 검사는 파서 6개 story 를 얹은 지금도 같은 숫자가 나오는지를 묻는다.
const SPLIT_MEASURED = { rows: 641, splitCount: 50, outTotal: 848, charsIn: 63444 };

/** 항목 하나 → 저장될 항목들. 줄이 1개면 원문 그대로(트림도 안 한다) — 서버 규칙과 같다. */
const splitItem = (content) => {
  const lines = splitSubmissionLines(content);
  return lines.length >= 2 ? lines : [content];
};

const backup = JSON.parse(readFileSync(BACKUP, 'utf8'));
const items = (backup.submissions ?? []).filter(
  (r) => typeof r.item_content === 'string' && r.item_content.length > 0,
);

console.log(`\n  ── US-007 8.29 산출물 회귀 · ${BACKUP.split(/[/\\]/).pop()} ─────────`);
console.log(`     항목 ${items.length}건 · ${items.reduce((a, r) => a + r.item_content.length, 0)}자\n`);

check('★ US-007 백업본에 641건 item_content 가 그대로 있다', () => {
  must(items.length === SPLIT_MEASURED.rows, `항목 ${items.length}건 ≠ ${SPLIT_MEASURED.rows}건`);
  const chars = items.reduce((a, r) => a + r.item_content.length, 0);
  must(chars === SPLIT_MEASURED.charsIn, `${chars}자 ≠ 실측 ${SPLIT_MEASURED.charsIn}자`);
  return `${items.length}건 · ${chars}자`;
});

check('★ US-007 쪼개지는 항목 수가 파서 도입 전과 같다 (50건 → 848행)', () => {
  const out = items.map((r) => splitItem(r.item_content));
  const splitCount = out.filter((parts) => parts.length >= 2).length;
  const outTotal = out.reduce((a, parts) => a + parts.length, 0);
  must(
    splitCount === SPLIT_MEASURED.splitCount,
    `쪼개진 항목 ${splitCount}건 ≠ 기존 ${SPLIT_MEASURED.splitCount}건 — 규칙이 움직였다`,
  );
  must(
    outTotal === SPLIT_MEASURED.outTotal,
    `결과 행 ${outTotal} ≠ 기존 ${SPLIT_MEASURED.outTotal} — 규칙이 움직였다`,
  );
  return `641건 중 ${splitCount}건이 쪼개져 ${outTotal}행`;
});

check('★ US-007 쪼개도 글자를 잃지 않는다 — 공백 제외 641건 전부 보존', () => {
  const strip = (s) => s.replace(/\s+/g, '');
  const before = strip(items.map((r) => r.item_content).join(''));
  const after = strip(items.flatMap((r) => splitItem(r.item_content)).join(''));
  must(after.length === before.length, `${before.length}자 → ${after.length}자 (유실)`);
  must(after === before, '순서·내용이 달라졌다');
  return `공백 제외 ${before.length}자 보존`;
});

check('★ US-007 멱등 — 이미 나뉜 것을 한 번 더 넣어도 그대로다', () => {
  const once = items.flatMap((r) => splitItem(r.item_content));
  const twice = once.flatMap((c) => splitItem(c));
  must(
    twice.length === once.length && twice.every((v, i) => v === once[i]),
    `${once.length}행 → ${twice.length}행`,
  );
  return `${once.length}행이 두 번 돌려도 그대로`;
});

check('★ US-007 줄 분해 규칙 원문이 파서 도입으로 바뀌지 않았다', () => {
  const ts = readFileSync(resolve(ROOT, 'src/islands/mod/submission-panel-logic.ts'), 'utf8');
  const m = ts.match(/export function splitSubmissionLines[\s\S]{0,240}?\n}/);
  must(m, 'splitSubmissionLines 를 못 찾았다');
  must(m[0].includes('split(/\\r?\\n/)'), '줄 자르기 정규식이 다르다');
  must(m[0].includes('.trim()'), 'trim 이 없다');
  must(m[0].includes('l.length > 0'), '빈 줄 제거가 없다');
  // 파서는 저장 규칙을 import 하지 않는다 — 두 세계가 섞이면 여기서 걸린다.
  for (const f of ['index.ts', 'rhwp-adapter.ts', 'kordoc-adapter.ts']) {
    const src = readFileSync(resolve(ROOT, `src/lib/parsers/${f}`), 'utf8');
    must(!src.includes('submission-panel-logic'), `${f} 가 저장 규칙을 끌어다 쓴다`);
    must(!src.includes('splitSubmissionLines'), `${f} 가 splitSubmissionLines 를 부른다`);
  }
  return '\\r?\\n · trim · 빈 줄 제거 · 파서 3개 모두 저장 규칙과 무관';
});

console.log(`\n${pass} PASS · ${fail} FAIL (${pass}/${pass + fail})\n`);
process.exit(fail === 0 ? 0 : 1);
