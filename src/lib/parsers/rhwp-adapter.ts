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

  return { units, warnings, charCount };
}
