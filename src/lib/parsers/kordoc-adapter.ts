/**
 * kordoc 어댑터 — **DOCX 전용**.
 *
 * 한글(HWP/HWPX)은 이 어댑터로 처리하지 않는다. 같은 `결과보고서_A조.hwp` 를
 * kordoc 으로 뽑으면 803단위·최대 3,219자였고 200자 넘는 덩어리가 전체 글자의
 * 58.3% 를 먹었다(rhwp 는 최대 204자·1.8%). 한 블록에 발언자 7~10명이 뭉치는
 * 그 모양이 조가 손대야 하는 횟수를 80~100회로 밀어올린다.
 * 실측 근거는 `20_스크립트/parsers/README.md` (측정일 2026-08-30).
 * 워드에는 대안이 없으므로 DOCX 만 여기서 맡는다.
 *
 * ★ 이 파일이 지켜야 할 import 규칙 — `scripts/verify-parsers.mjs` 는 이 `.ts` 를
 *   esbuild 로 그 자리에서 변환해 불러온다. 그래서 여기에는 **bare 지정자
 *   (`kordoc`) · `node:` 내장 · 타입 전용 import** 만 둔다. 상대경로 값 import 를
 *   넣으면 변환본이 옮겨진 자리에서 해석되지 않아 검증 스크립트가 죽는다.
 */
import { detectZipFormat, isOldHwpFile, isZipFile, parse } from 'kordoc';
import type { IRBlock, ParseResult } from 'kordoc';

import type { ExtractResult, ExtractedUnit, ExtractWarning } from './types';

/**
 * 블록 하나를 단위로 옮긴다. 표는 셀마다, 중첩 블록은 원문 순서대로 파고든다.
 *
 * ★ 여기서 **줄을 더 쪼개지 않는다.** kordoc 은 문단이 여럿인 평문 셀을 `\n` 으로
 *   이어 붙인 `IRCell.text` 하나로 준다. 그것을 다시 가르는 것은 2차 분해 규칙이고,
 *   그 규칙은 실측에서 값어치가 음수라 만들지 않기로 확정됐다
 *   (`README.md` 「왜 2차 분해 규칙을 버렸나」). 셀 하나 = 단위 하나로 둔다.
 *
 * ★ `page` 는 kordoc 이 `pageNumber` 를 준 블록에만 채운다. DOCX 는 쪽 번호를
 *   매기지 않는 포맷이라 실측에서 730블록 전부 `pageNumber` 가 없었다.
 */
function pushBlock(block: IRBlock, units: ExtractedUnit[]): void {
  const provenance = { engine: 'kordoc' as const, ...(block.pageNumber != null ? { page: block.pageNumber } : {}) };

  if (block.text && block.text.trim()) units.push({ text: block.text, provenance });

  if (block.table) {
    for (const row of block.table.cells) {
      for (const cell of row) {
        // 셀 안에 중첩 표·다중 블록이 있으면 그쪽이 정본이다(`text` 는 그것의 평탄화 사본).
        if (cell.blocks && cell.blocks.length > 0) {
          for (const child of cell.blocks) pushBlock(child, units);
        } else if (cell.text && cell.text.trim()) {
          units.push({ text: cell.text, provenance });
        }
      }
    }
    for (const child of block.table.captionBlocks ?? []) pushBlock(child, units);
  }

  for (const child of block.children ?? []) pushBlock(child, units);
}

/** 블록 목록을 단위 목록으로. 빈 문자열·공백만 있는 것은 버린다. */
export function collectKordocUnits(blocks: IRBlock[]): ExtractedUnit[] {
  const units: ExtractedUnit[] = [];
  for (const block of blocks) pushBlock(block, units);
  return units;
}

/** 실패 결과를 우리 경고로 옮긴다. 암호 문서를 「빈 문서 성공」으로 위장하지 않는다. */
export function warningForFailure(result: Extract<ParseResult, { success: false }>): ExtractWarning {
  if (result.code === 'ENCRYPTED' || result.code === 'DRM_PROTECTED') {
    return {
      kind: 'encrypted',
      message: '암호(또는 DRM)가 걸린 문서라 열 수 없습니다. 보호를 푼 뒤 다시 올려 주세요.',
      detail: `${result.code}: ${result.error}`,
    };
  }
  return {
    kind: 'unsupported',
    message: 'kordoc 이 이 문서를 열지 못했습니다.',
    detail: `${result.code ?? 'UNKNOWN'}: ${result.error}`,
  };
}

function refuse(message: string, detail: string): ExtractResult {
  return { units: [], warnings: [{ kind: 'unsupported', message, detail }], charCount: 0 };
}

/**
 * DOCX 바이트를 `ExtractResult` 로 바꾼다.
 *
 * 던지지 않는다 — 열지 못하면 `units` 를 비우고 warning 으로 알린다(`types.ts` 의 계약).
 *
 * ★ 종류 판정은 **`detectZipFormat`(비동기)** 으로 한다. 동기 판정기
 *   `detectFormat`·`isHwpxFile` 은 zip 서명만 보기 때문에 **DOCX 를 hwpx 라고 답한다**
 *   (실측: `0829_조별산출물_전수.docx` → `detectFormat`=`"hwpx"`). 그 둘로 걸렀다가는
 *   워드 파일을 전부 거절하게 된다.
 */
export async function extractWithKordoc(buffer: Uint8Array): Promise<ExtractResult> {
  const bytes = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;

  if (isOldHwpFile(bytes)) {
    return refuse('한글 문서(.hwp)는 이 경로로 읽지 않습니다 — rhwp 어댑터가 맡습니다.', 'kordoc-adapter: hwp');
  }
  if (!isZipFile(bytes)) {
    return refuse('워드 문서(.docx)가 아닙니다.', 'kordoc-adapter: not a zip container');
  }
  const zipFormat = await detectZipFormat(bytes);
  if (zipFormat !== 'docx') {
    const what = zipFormat === 'hwpx' ? '한글 문서(.hwpx)는 이 경로로 읽지 않습니다 — rhwp 어댑터가 맡습니다.' : '워드 문서(.docx)가 아닙니다.';
    return refuse(what, `kordoc-adapter: ${zipFormat}`);
  }

  let result: ParseResult;
  try {
    result = await parse(bytes);
  } catch (error) {
    return refuse('kordoc 이 이 문서를 열지 못했습니다.', error instanceof Error ? error.message : String(error));
  }

  if (!result.success) return { units: [], warnings: [warningForFailure(result)], charCount: 0 };

  const units = collectKordocUnits(result.blocks);
  const charCount = units.reduce((sum, unit) => sum + unit.text.length, 0);
  return { units, warnings: [], charCount };
}
