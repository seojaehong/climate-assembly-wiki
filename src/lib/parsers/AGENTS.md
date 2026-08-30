# src/lib/parsers — 어댑터 작업 규칙

문서 파서(rhwp·kordoc)를 우리 인터페이스 뒤로 감추는 자리다. 판정 근거는
`20_스크립트/parsers/README.md`(측정일 2026-08-30) — **재조사하지 말 것.**

## 이 폴더의 `.ts` 가 지켜야 할 import 규칙

`scripts/verify-parsers.mjs` 는 어댑터를 **esbuild 로 그 자리에서 변환해 불러온다.**
변환본은 `node_modules/.cache/verify-parsers/*.mjs` 에 쓰이므로 원본과 위치가 다르다. 따라서:

- 쓸 수 있는 것 — **bare 지정자**(`kordoc`·`@rhwp/core`) · `node:` 내장 · `import type`
- 쓰면 깨지는 것 — **상대경로 값 import**. 변환본 자리에 그 파일이 없어 스크립트가 죽는다
  (`./types` 는 타입 전용이라 esbuild 가 지워 없어진다 — 그래서 괜찮다)
- `data:` URL import 는 쓰지 않는다. bare 지정자가 해석되지 않고 `import.meta.url` 이
  그 data URL 이 된다. `verify-name-reparse.mjs` 의 수법은 **의존성 없는 파일 전용**이다

## 계약 — `types.ts`

`extract*` 는 **던지지 않는다.** 열지 못하면 `units: []` · `charCount: 0` 에
`ExtractWarning` 을 담아 돌려준다. 「성공으로 위장하지 않는다」가 이 폴더의 규칙이다.

## kordoc 함정

- ★ **동기 판정기는 DOCX 를 hwpx 라고 답한다.** `detectFormat`·`isHwpxFile` 은 zip 서명만
  본다(실측: `0829_조별산출물_전수.docx` → `"hwpx"`). zip 안 종류를 알려면 **비동기
  `detectZipFormat()`** 을 써야 한다(`"hwpx"|"xlsx"|"docx"|"unknown"`). OLE2 계열 `.hwp` 는
  동기 `isOldHwpFile()` 로 걸린다
- **DOCX 블록에는 `pageNumber` 가 없다**(실측 730블록 중 0개). 워드는 쪽 번호를 매기는
  포맷이 아니다 — `provenance.page` 는 kordoc 이 준 블록에만 채운다
- `IRCell.blocks` 가 있으면 그쪽이 정본이고 `IRCell.text` 는 그것의 평탄화 사본이다.
  둘 다 담으면 같은 글이 두 번 세어진다
- `parse()` 는 성공/실패를 `success` 로 가른다. 실패의 `code` 는 `ErrorCode` union —
  `ENCRYPTED`·`DRM_PROTECTED` 만 우리 `encrypted` 로 옮기고 나머지는 `unsupported` 다

## rhwp 함정

- 순회 순서를 `20_스크립트/parsers/measurement/rhwp_units.mjs` 와 같게 유지한다.
  판정 숫자(164단위·최대 95자)가 그 순회에 묶여 있다
- `getTableDimensions` 는 「표가 아님」과 「그런 컨트롤 없음」을 **같은 오류 문구**로 준다
- `getTextFileText()` 반환값은 평문이 아니다 — **JSON 문자열로 감싼 것**이라 앞뒤에 `"` 가
  붙고 개행이 역슬래시 이스케이프 2문자다(실측: 진짜 제어문자 0개 · 백슬래시 3,182개)

## 시험

- `*.test.ts` 는 **실제 문서를 읽지 않는다**(원본이 저장소 밖 `00_입력자료`·`10_작업산출물`).
  대역 블록·대역 문서로 규칙만 못박는다
- 실제 문서 숫자는 `node scripts/verify-parsers.mjs` 가 낸다. `N PASS · M FAIL (N/N)` 로 끝난다
- Node 20 포터블 필수 — `export PATH="$HOME/tools/node-v20.18.0-win-x64:$PATH"`
