/**
 * rhwp 어댑터 — HWP/HWPX 를 「문단 하나 · 표 셀 문단 하나」 단위로 뽑는다.
 *
 * 왜 rhwp 인가 (실측 2026-08-30, `20_스크립트/parsers/README.md`):
 * 같은 `결과보고서_A조.hwp` 를 kordoc 으로 뽑으면 803단위·최대 3,219자였고,
 * 200자 넘는 덩어리가 전체 글자의 58.3% 를 차지했다. rhwp 구조 API 로는
 * 1,256단위·최대 204자·1.8% 였다. 표 하나가 발언 10개를 삼키지 않는다.
 *
 * ★ `@rhwp/core` 는 WASM 이다. 브라우저 예제만 문서화돼 있어 Node 초기화는
 *   여기에서 직접 한다 — 패키지 안 `rhwp_bg.wasm` 바이트를 읽어 default export 에
 *   `{ module_or_path }` 로 넘긴다. 초기화는 프로세스당 한 번만 하고 캐시한다.
 *
 * ★ 순회 순서·예외 처리는 측정 스크립트 `20_스크립트/parsers/measurement/rhwp_units.mjs`
 *   와 한 줄씩 같게 유지한다. 164단위·최대 95자라는 판정 숫자가 이 순회에 묶여 있다.
 */

import type { ExtractResult, ExtractWarning, ExtractedUnit } from './types';

/** 문단 하나에 달린 컨트롤(표)을 몇 개까지 훑을지. 측정 스크립트와 같은 값. */
const MAX_CONTROLS_PER_PARAGRAPH = 8;

type RhwpModule = typeof import('@rhwp/core');
type HwpDocument = InstanceType<RhwpModule['HwpDocument']>;

let rhwpReady: Promise<RhwpModule> | null = null;

/**
 * WASM 을 초기화하고 모듈을 돌려준다. 두 번째 호출부터는 캐시된 약속을 준다.
 *
 * `node:module`·`node:fs/promises` 를 동적으로 부르는 이유는 이 파일이
 * 브라우저 번들에 딸려 들어가도 최상위에서 터지지 않게 하기 위해서다.
 */
async function loadRhwp(): Promise<RhwpModule> {
  if (rhwpReady) return rhwpReady;

  rhwpReady = (async () => {
    const mod = (await import('@rhwp/core')) as RhwpModule;
    const { createRequire } = await import('node:module');
    const { readFile } = await import('node:fs/promises');
    const require = createRequire(import.meta.url);

    let wasmPath: string;
    try {
      wasmPath = require.resolve('@rhwp/core/rhwp_bg.wasm');
    } catch {
      // 서브패스 해석이 막히면 엔트리 옆에서 찾는다.
      const { dirname, join } = await import('node:path');
      wasmPath = join(dirname(require.resolve('@rhwp/core')), 'rhwp_bg.wasm');
    }

    await mod.default({ module_or_path: await readFile(wasmPath) });
    return mod;
  })();

  return rhwpReady;
}

/** 표 크기 JSON 이 판(version)마다 다른 이름을 써서 셋 다 본다. */
function cellCountOf(dimensionsJson: string): number {
  const dim = JSON.parse(dimensionsJson) as Record<string, number | undefined>;
  if (typeof dim.cellCount === 'number') return dim.cellCount;
  const rows = dim.rows ?? dim.rowCount ?? dim.nRows ?? 0;
  const cols = dim.cols ?? dim.colCount ?? dim.nCols ?? 0;
  return rows * cols;
}

/** 공백만 있는 단위는 버린다. */
function pushUnit(
  units: ExtractedUnit[],
  rawText: string,
  provenance: ExtractedUnit['provenance'],
): void {
  const text = (rawText ?? '').trim();
  if (text.length === 0) return;
  units.push({ text, provenance });
}

/**
 * 구조 API 로 본문 문단과 표 셀 문단을 각각 개별 단위로 뽑는다.
 *
 * ★ 이 경로는 중첩표(표 안의 표)를 통째로 놓친다(실측: `d_speakers` 19,056자 중 절반).
 *   US-004 에서 `getTextFileText()` 경로와 글자수를 대조해 경고를 올릴 예정이다.
 */
function collectUnits(doc: HwpDocument): ExtractedUnit[] {
  const units: ExtractedUnit[] = [];
  const sectionCount = doc.getSectionCount();

  for (let section = 0; section < sectionCount; section += 1) {
    let paragraphCount = 0;
    try {
      paragraphCount = doc.getParagraphCount(section);
    } catch {
      continue;
    }

    for (let para = 0; para < paragraphCount; para += 1) {
      // 1) 본문 문단
      let length = 0;
      try {
        length = doc.getParagraphLength(section, para);
      } catch {
        length = 0;
      }
      if (length > 0) {
        let text = '';
        try {
          text = doc.getTextRange(section, para, 0, length);
        } catch {
          text = '';
        }
        pushUnit(units, text, { engine: 'rhwp', section, para });
      }

      // 2) 이 문단에 달린 표들의 셀 문단
      for (let control = 0; control < MAX_CONTROLS_PER_PARAGRAPH; control += 1) {
        let cellCount = 0;
        try {
          cellCount = cellCountOf(doc.getTableDimensions(section, para, control));
        } catch {
          break; // 더 이상 컨트롤이 없다
        }

        for (let cell = 0; cell < cellCount; cell += 1) {
          let cellParagraphCount = 0;
          try {
            cellParagraphCount = doc.getCellParagraphCount(section, para, control, cell);
          } catch {
            continue;
          }

          for (let cellPara = 0; cellPara < cellParagraphCount; cellPara += 1) {
            let cellLength = 0;
            try {
              cellLength = doc.getCellParagraphLength(section, para, control, cell, cellPara);
            } catch {
              continue;
            }
            if (cellLength <= 0) continue;

            let text = '';
            try {
              text = doc.getTextInCell(section, para, control, cell, cellPara, 0, cellLength);
            } catch {
              text = '';
            }
            pushUnit(units, text, { engine: 'rhwp', section, para, control, cell, cellPara });
          }
        }
      }
    }
  }

  return units;
}

/** 구조 API 가 놓친 글자가 이 비율을 넘으면 경고한다. */
const MISSING_CONTENT_RATIO = 0.05;

/**
 * `getTextFileText()` 의 반환값을 실제 문자열로 푼다.
 *
 * ★ 반환값은 평문이 아니라 **JSON 인코딩된 문자열**이다 — 첫 글자와 끝 글자가 `"` 이고
 *   개행이 진짜 개행이 아니라 역슬래시 이스케이프 2문자로 들어 있다(두 시험 문서 모두
 *   `JSON.parse` 성공: hwpx 2,261→2,002자 · A조 hwp 28,504→25,320자). 판(version)에 따라
 *   따옴표 없이 올 수도 있어, 실패하면 리터럴 이스케이프만 치환하는 쪽으로 물러선다.
 */
export function unwrapTextFileText(raw: string): string {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === 'string') return parsed;
  } catch {
    // 아래 폴백으로 간다
  }
  return raw
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\n')
    .replace(/\\t/g, '\t');
}

/**
 * 숫자 HTML 엔티티를 디코드한다.
 *
 * 실측에서 나온 것은 전부 숫자 엔티티였다 — hwpx `&#8212;`, A조 `&#8199;`·`&#61580;`
 * (사용자정의 영역 = 윙딩 불릿). 이름 엔티티(`&amp;` 등)는 관측되지 않아 건드리지 않는다.
 */
export function decodeNumericEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (whole, digits: string) => codePointOr(whole, Number(digits)))
    .replace(/&#[xX]([0-9a-fA-F]+);/g, (whole, hex: string) =>
      codePointOr(whole, Number.parseInt(hex, 16)),
    );
}

/** 코드포인트 범위를 벗어나면 원문을 그대로 둔다. */
function codePointOr(whole: string, codePoint: number): string {
  if (!Number.isFinite(codePoint) || codePoint < 0 || codePoint > 0x10ffff) return whole;
  try {
    return String.fromCodePoint(codePoint);
  } catch {
    return whole;
  }
}

/**
 * 두 경로의 글자수를 견줄 수 있게 공백을 모두 턴다.
 *
 * 구조 API 쪽 단위는 이미 `trim()` 돼 있고 전문 쪽은 문단 개행·들여쓰기를 품고 있어,
 * 공백을 그대로 두면 서식 차이가 「누락」으로 둔갑한다.
 */
export function comparableLength(text: string): number {
  return text.replace(/\s/g, '').length;
}

/**
 * 구조 API 로 뽑은 글자수와 전문(`getTextFileText`) 글자수를 대조해 누락을 판정한다.
 *
 * ★ **한 방향으로만 본다** — 전문이 구조보다 많을 때만 경고한다. 실측(2026-08-30):
 *   - `결과보고서_A조.hwp` 구조 10,321자 · 전문 17,601자 → **41.4% 누락**(중첩표를 통째로 놓친다)
 *   - `정책권고안_양식초안.hwpx` 구조 2,030자 · 전문 1,309자 → 구조 쪽이 **더 많다**
 *   두 번째처럼 구조가 더 많은 경우는 누락이 아니다(전문 경로가 표를 덜 싣는다). PRD 의 AC 는
 *   「차이가 5% 를 넘으면」이라 절대값으로 읽히지만, 그대로 하면 멀쩡한 hwpx 에 55% 누락 경고가
 *   떠서 경고 자체가 무의미해진다. 그래서 방향을 하나로 좁혔다.
 *
 * @param structuralText 구조 API 단위를 이어 붙인 문자열
 * @param rawTextFileText `getTextFileText()` 의 날 반환값
 * @returns 누락이면 경고, 아니면 `null`
 */
export function checkMissingContent(
  structuralText: string,
  rawTextFileText: string,
): ExtractWarning | null {
  const fullText = decodeNumericEntities(unwrapTextFileText(rawTextFileText));
  const structural = comparableLength(structuralText);
  const full = comparableLength(fullText);
  if (full === 0) return null;

  const missing = full - structural;
  if (missing <= 0 || missing / full <= MISSING_CONTENT_RATIO) return null;

  const percent = ((missing / full) * 100).toFixed(1);
  return {
    kind: 'missing-content',
    message:
      `구조 API 로 뽑은 ${structural.toLocaleString('en-US')}자가 ` +
      `전문 ${full.toLocaleString('en-US')}자보다 ${missing.toLocaleString('en-US')}자(${percent}%) 적습니다. ` +
      '중첩표(표 안의 표)는 구조 API 가 놓칩니다.',
    detail:
      `structuralChars=${structural} textFileChars=${full} ` +
      `missingChars=${missing} missingRatio=${(missing / full).toFixed(4)} ` +
      `threshold=${MISSING_CONTENT_RATIO}`,
  };
}

/**
 * HWP/HWPX 버퍼에서 단위를 뽑는다.
 *
 * @param buffer 원본 파일 바이트
 */
export async function extractWithRhwp(
  buffer: Uint8Array | ArrayBuffer,
): Promise<ExtractResult> {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const warnings: ExtractWarning[] = [];

  const mod = await loadRhwp();
  const doc = new mod.HwpDocument(bytes);

  const units = collectUnits(doc);
  const charCount = units.reduce((sum, unit) => sum + unit.text.length, 0);

  // 누락 검사 — 전문 경로를 한 번 더 돌려 글자수를 견준다.
  let rawTextFileText = '';
  try {
    rawTextFileText = doc.getTextFileText();
  } catch {
    rawTextFileText = '';
  }
  if (rawTextFileText.length > 0) {
    const warning = checkMissingContent(units.map((unit) => unit.text).join('\n'), rawTextFileText);
    if (warning) warnings.push(warning);
  }

  return { units, warnings, charCount };
}
