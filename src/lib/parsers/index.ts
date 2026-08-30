/**
 * 문서 파서 통합 진입점.
 *
 * 호출부는 파일 바이트와 파일명만 넘긴다 — 뒤가 rhwp 인지 kordoc 인지 몰라도 된다.
 * 어느 경로로도 **던지지 않는다.** 열지 못하면 `units: []` 에 `ExtractWarning` 을
 * 담아 돌려준다(`types.ts` 의 계약).
 *
 * 판단 순서 (AC 는 순서를 정하지 않았다 — 여기 적어 고정한다):
 *   1. 확장자로 엔진을 고른다. 구형 `.doc` 과 모르는 확장자는 여기서 거절한다.
 *   2. 그 다음 크기를 본다. 어차피 거절할 파일에 20MB 한도를 먼저 들이대면
 *      「.docx 로 저장해 주세요」 같은 **쓸모 있는 안내가 크기 경고에 가려진다.**
 *      한도의 목적은 파싱 비용을 막는 것이므로, 파싱할 파일에만 걸면 충분하다.
 *   3. 엔진에 넘긴다.
 *
 * 20MB 근거 — 측정에서 119MB 파일은 메모리 한도로 죽었고 20MB 는 CPU 위험선이다
 * (`20_스크립트/parsers/README.md`, 측정일 2026-08-30).
 */
import { extractWithKordoc } from './kordoc-adapter';
import { extractWithRhwp } from './rhwp-adapter';

import type { ExtractEngine, ExtractResult, ExtractWarning } from './types';

/** 받아들이는 최대 바이트 수. 이 값을 **넘으면** 거절한다(같으면 통과). */
export const MAX_BYTES = 20 * 1024 * 1024;

/** 엔진별로 받는 확장자. 이 표에 없으면 거절이다. */
const ENGINE_BY_EXTENSION: Record<string, ExtractEngine> = {
  hwp: 'rhwp',
  hwpx: 'rhwp',
  docx: 'kordoc',
};

/**
 * 파일명에서 확장자만 소문자로 뽑는다. 경로가 붙어 있어도(`/` · `\` 둘 다) 마지막 조각만 본다.
 * 점이 없거나 `.hwp` 처럼 이름 없이 점으로 시작하면 빈 문자열이다.
 */
export function extensionOf(filename: string): string {
  const base = filename.split(/[/\\]/).pop() ?? '';
  const dot = base.lastIndexOf('.');
  if (dot <= 0) return '';
  return base.slice(dot + 1).toLowerCase();
}

/** 어느 엔진으로 보낼지, 아니면 왜 거절하는지. */
export type ExtractPlan =
  | { engine: ExtractEngine; warning?: undefined }
  | { engine: null; warning: ExtractWarning };

/**
 * 파일을 열기 **전에** 확장자와 크기만으로 판단한다. 순수 함수라 바이트 없이 시험할 수 있다.
 *
 * @param filename 원본 파일명(경로가 붙어 있어도 된다)
 * @param byteLength 파일 크기(바이트)
 */
export function planExtraction(filename: string, byteLength: number): ExtractPlan {
  const ext = extensionOf(filename);

  if (ext === 'doc') {
    return {
      engine: null,
      warning: {
        kind: 'unsupported',
        message:
          '구형 워드 문서(.doc)는 읽지 못합니다 — 다른 이름으로 저장해 .docx 로 올려 주세요.',
        detail: `parsers/index: .doc — ${filename}`,
      },
    };
  }

  const engine = ENGINE_BY_EXTENSION[ext];
  if (!engine) {
    return {
      engine: null,
      warning: {
        kind: 'unsupported',
        message: '읽을 수 없는 형식입니다 — .hwp · .hwpx · .docx 만 읽습니다.',
        detail: `parsers/index: ${ext ? `.${ext}` : '확장자 없음'} — ${filename}`,
      },
    };
  }

  if (byteLength > MAX_BYTES) {
    const mb = (byteLength / (1024 * 1024)).toFixed(1);
    return {
      engine: null,
      warning: {
        kind: 'too-large',
        message: `파일이 너무 큽니다 — 20MB 까지만 읽습니다 (이 파일 ${mb}MB).`,
        detail: `parsers/index: ${byteLength} bytes > ${MAX_BYTES} bytes — ${filename}`,
      },
    };
  }

  return { engine };
}

/** 거절 결과 하나를 만든다. 단위도 글자수도 없다 — 성공으로 위장하지 않는다. */
function refused(warning: ExtractWarning): ExtractResult {
  return { units: [], warnings: [warning], charCount: 0 };
}

/**
 * 문서 하나를 단위 배열로 바꾼다. 엔진 선택은 이 함수가 한다.
 *
 * @param buffer 원본 파일 바이트
 * @param filename 원본 파일명 — 엔진은 **확장자로** 고른다(내용 판정은 각 어댑터가 한 번 더 한다)
 */
export async function extractDocument(
  buffer: Uint8Array | ArrayBuffer,
  filename: string,
): Promise<ExtractResult> {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const plan = planExtraction(filename, bytes.byteLength);
  if (plan.engine === null) return refused(plan.warning);

  try {
    return plan.engine === 'rhwp' ? await extractWithRhwp(bytes) : await extractWithKordoc(bytes);
  } catch (error) {
    // 어댑터가 던지면 여기서 삼킨다 — 진입점의 계약은 「던지지 않는다」다.
    return refused({
      kind: 'unsupported',
      message: '문서를 열지 못했습니다.',
      detail: `parsers/index: ${plan.engine} — ${error instanceof Error ? error.message : String(error)}`,
    });
  }
}
