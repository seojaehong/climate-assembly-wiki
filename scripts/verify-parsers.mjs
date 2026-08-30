/**
 * 파서 어댑터 드라이런 — **실제 문서를 넣어 숫자를 낸다. 아무것도 쓰지 않는다.**
 *
 *   node scripts/verify-parsers.mjs
 *   node scripts/verify-parsers.mjs --texts    # 뽑힌 첫 단위들을 더 길게 찍는다
 *
 * 무엇을 재는가 — 「테스트가 통과했다」가 아니라 **단위가 몇 개 나오고 무엇이 거절되는지**를 센다.
 * 지금 담긴 것은 US-005(kordoc·DOCX 전용)다. US-004·006 의 실측이 US-007 에서 여기로 합쳐진다.
 *
 * ★ 대조 대상은 **어댑터 그 자체**다. 규칙을 이 파일에 베껴 적지 않는다 —
 *   esbuild 로 `src/lib/parsers/*.ts` 를 변환해 불러온다. 다만 `verify-name-reparse.mjs`
 *   가 쓰는 `data:` URL 수법은 여기서 통하지 않는다: 어댑터는 `kordoc`·`@rhwp/core` 같은
 *   bare 지정자를 import 하는데 data: URL 모듈에서는 그것이 해석되지 않는다.
 *   그래서 변환본을 **저장소 안 실제 `.mjs` 파일**(`node_modules/.cache/`)로 쓰고
 *   `pathToFileURL()` 로 불러온다 — 그 자리에서는 node_modules 를 거슬러 올라가 찾는다.
 *
 * 쓰기 없음 — 원본 문서는 읽기만 하고 DB 에 접속조차 하지 않는다.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { transform } from 'esbuild';

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);

/** 시험용 실제 문서 — 저장소 밖 원본을 **읽기만** 한다(옮기지도 고치지도 않는다). */
const DOCX = resolve(HERE, '../../10_작업산출물/2026-08-29_조별산출물_전수/0829_조별산출물_전수.docx');
const HWPX = resolve(HERE, '../../00_입력자료/기후시민회의_정책권고안_(양식_초안)_20260811203741.hwpx');
const HWP = resolve(
  HERE,
  '../../00_입력자료/★20260613 기후시민회의 의제숙의워크숍 결과보고서_발화자 추가_A조.hwp',
);

const CACHE = resolve(HERE, '../node_modules/.cache/verify-parsers');

/** 어댑터 `.ts` 를 그 자리에서 변환해 불러온다(형만 벗긴다 — 규칙은 손대지 않는다). */
async function loadAdapter(name) {
  const src = readFileSync(resolve(HERE, `../src/lib/parsers/${name}.ts`), 'utf8');
  const { code } = await transform(src, { loader: 'ts', format: 'esm' });
  mkdirSync(CACHE, { recursive: true });
  const out = resolve(CACHE, `${name}.mjs`);
  writeFileSync(out, code, 'utf8');
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

console.log('\n파서 어댑터 드라이런 · 실제 문서 · 쓰기 없음\n');

// ── US-005 · kordoc 어댑터 (DOCX 전용) ──────────────────────────
const { extractWithKordoc } = await loadAdapter('kordoc-adapter');

const t0 = Date.now();
const docx = await extractWithKordoc(readFileSync(DOCX));
const ms = Date.now() - t0;
const lens = docx.units.map((u) => u.text.length).sort((a, b) => a - b);

console.log(`  ── US-005 kordoc · ${DOCX.split(/[\/]/).pop()} ─────────`);
console.log(
  `     ${ms}ms · 단위 ${docx.units.length} · ${docx.charCount}자 · 중앙값 ${lens[lens.length >> 1]} · 최대 ${lens[lens.length - 1]} · 경고 ${docx.warnings.length}`,
);
console.log('     첫 5개 단위:');
docx.units.slice(0, 5).forEach((u, i) => {
  const t = u.text.replace(/\n/g, '⏎');
  console.log(`       ${i + 1}. ${JSON.stringify(argv.includes('--texts') ? t : t.slice(0, 70))}`);
});
console.log('');

check('★ 실제 DOCX 에서 단위가 나온다 (100개 이상)', () => {
  must(docx.warnings.length === 0, `경고가 붙었다: ${JSON.stringify(docx.warnings)}`);
  must(docx.units.length >= 100, `단위 ${docx.units.length}개`);
  return `${docx.units.length}단위 · ${docx.charCount}자`;
});

check('★ 한국어가 깨지지 않는다 — 치환문자(U+FFFD)·물음표 뭉침 0', () => {
  const broken = docx.units.filter((u) => /\uFFFD/.test(u.text));
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

check('★ charCount 가 단위 글자수의 합과 정확히 같다', () => {
  const sum = docx.units.reduce((a, u) => a + u.text.length, 0);
  must(sum === docx.charCount, `합 ${sum} ≠ charCount ${docx.charCount}`);
  return `${sum}자`;
});

check('★ 모든 단위의 provenance.engine 이 kordoc 이고, 공백만 있는 단위가 없다', () => {
  const wrong = docx.units.filter((u) => u.provenance?.engine !== 'kordoc');
  must(wrong.length === 0, `engine 이 kordoc 이 아닌 단위 ${wrong.length}개`);
  const blank = docx.units.filter((u) => u.text.trim() === '');
  must(blank.length === 0, `공백만 있는 단위 ${blank.length}개`);
  return `${docx.units.length}/${docx.units.length}`;
});

// 거절 경로는 먼저 돌려 두고 아래에서 센다(check 는 동기 함수만 받는다).
const refusedHwpx = await extractWithKordoc(readFileSync(HWPX));
const refusedHwp = await extractWithKordoc(readFileSync(HWP));
const refusedJunk = await extractWithKordoc(Buffer.from('이건 문서가 아니다. zip 도 OLE2 도 아니다.'));

/** 거절이란: 단위 0 · charCount 0 · unsupported 경고 하나. 성공으로 위장하지 않는다. */
const refuses = (result, what) => () => {
  must(result.units.length === 0, `${what} 인데 단위가 ${result.units.length}개 나왔다`);
  must(result.charCount === 0, `${what} 인데 charCount ${result.charCount}`);
  must(result.warnings.length === 1, `경고가 ${result.warnings.length}개`);
  must(result.warnings[0].kind === 'unsupported', `경고 종류 ${result.warnings[0].kind}`);
  return `units 0 · ${JSON.stringify(result.warnings[0].detail)}`;
};

check('★ HWPX 를 넣으면 거절한다 — units 를 비우고 unsupported 를 올린다', refuses(refusedHwpx, 'hwpx'));
check('★ HWP 를 넣으면 거절한다 — units 를 비우고 unsupported 를 올린다', refuses(refusedHwp, 'hwp'));
check('★ 문서가 아닌 바이트를 넣어도 던지지 않고 거절한다', refuses(refusedJunk, '쓰레기 바이트'));

console.log(`\n${pass} PASS · ${fail} FAIL (${pass}/${pass + fail})\n`);
process.exit(fail === 0 ? 0 : 1);
