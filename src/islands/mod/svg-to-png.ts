/**
 * 결과 SVG(result-image.ts)를 PNG 파일로 내려받기 위한 브라우저 어댑터.
 * 외부 라이브러리를 쓰지 않고 `Image` + `canvas`만 쓴다.
 *
 * 결과물의 **이름 짓기도 여기서 한다**(`resultImageFileName` · `resultZipEntryName` ·
 * `resultZipFileName`). 치환 규칙을 한 곳에 모아 두려는 것이다 — 두 벌로 나뉘면 한쪽만 고쳐져
 * 한글이 사라지는 사고가 난다(US-015에서 실제로 밟은 함정).
 *
 * 이 모듈에서 순수한 부분(이름 짓기 3종 · `svgPixelSize`)만 테스트할 수 있다.
 * 나머지는 브라우저가 없으면 검증이 불가능하므로, 실패 경로를 전부 **문구가 있는 예외**로 모아
 * 호출부가 화면을 깨뜨리지 않고 안내할 수 있게 한다(`Image.onerror`는 예외를 던지지 않는다).
 *
 * 모듈 최상단에서 DOM을 만지지 않는다 — node 환경의 vitest가 이 파일을 import할 수 있어야 한다.
 */

/** 저장 배율. 1이면 1200px짜리 그림이 그대로 나와 인쇄·확대에서 뭉갠다. */
export const RESULT_IMAGE_SCALE = 2;

/** `Image.onload`도 `onerror`도 오지 않는 경우가 있다 — 없으면 '저장 중…'에서 영원히 멈춘다. */
const LOAD_TIMEOUT_MS = 10_000;

const UNSUPPORTED = '이 브라우저에서는 이미지 저장을 지원하지 않습니다.';
const CONVERT_FAILED = '이미지를 만들지 못했습니다.';

const FALLBACK_TEAM_NAME = '투표결과';

/**
 * 파일명에 쓸 수 없는 문자. **거부목록으로 적는다** — `[^\w]` 같은 허용목록을 쓰면
 * 한글이 통째로 밑줄로 바뀌어 '1분과 1조'가 '_____'가 된다.
 * 포함: 모든 공백류, Windows 금지 문자, 경로 분리자, C0 제어문자.
 */
const UNSAFE_FILENAME_CHARS = /[\s\/:*?"<>|\u0000-\u001F\u007F]/g;

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/**
 * 로컬 시각 기준 `YYYYMMDD-HHmm`. `toLocaleString`·`Intl`을 쓰지 않는다(환경마다 결과가 갈린다).
 * 로컬 getter만 쓰므로 `new Date(2026, 7, 29, 14, 32)`로 만든 값은 어느 타임존에서도 같게 찍힌다.
 */
function stamp(at: Date): string {
  return `${at.getFullYear()}${pad2(at.getMonth() + 1)}${pad2(at.getDate())}-${pad2(at.getHours())}${pad2(at.getMinutes())}`;
}

function safeSegment(value: string): string {
  return value
    .replace(UNSAFE_FILENAME_CHARS, '_')
    .replace(/_{2,}/g, '_')
    // 앞뒤의 밑줄·점을 떼어낸다. 점으로 시작하면 숨김 파일이 되고, 점으로 끝나면 Windows가 거부한다.
    .replace(/^[_.]+/, '')
    .replace(/[_.]+$/, '');
}

/**
 * 내려받기 파일명. `<조이름>_<회차>차_<YYYYMMDD-HHmm>.png`.
 *
 * `at`은 **저장한 시각**이다(호출부가 `new Date()`를 넘긴다). 마감 시각은 그림 안에
 * `마감 HH:MM`으로 이미 들어 있으므로 파일명까지 그걸 따라갈 이유가 없고, 같은 회차를 두 번
 * 저장해도 파일이 서로 덮어쓰지 않는다.
 *
 * 회차가 1보다 작으면 회차 조각을 넣지 않는다 — `teamRoundHistory`가 `?? 0`으로 0을 줄 수 있는데
 * 그대로 쓰면 '0차'라는 없는 회차가 파일명에 박힌다(result-image.ts와 같은 규칙).
 */
export function resultImageFileName(input: { teamName: string; sequence: number; at: Date }): string {
  const parts = [safeSegment(input.teamName) || FALLBACK_TEAM_NAME];
  if (input.sequence >= 1) parts.push(`${Math.floor(input.sequence)}차`);
  parts.push(stamp(input.at));
  return `${parts.join('_')}.png`;
}

/**
 * ZIP 안에 놓을 경로. `<조이름>/<회차>차_<제목>.png`.
 *
 * **각 조각을 따로 정리한 뒤 `/`로 잇는다** — 제목을 그대로 넣으면 제목 안의 슬래시('A/B 안')가
 * 폴더를 하나 더 만들어 조별 폴더 구조가 무너진다. 조 이름이 전부 걸러지는 경우에도 폴백을 써서
 * 앞이 비지 않게 한다(`/파일.png`는 절대 경로로 읽혀 아카이브를 통째로 거부하는 도구가 있다).
 *
 * 파일명 규칙은 `resultImageFileName`과 같은 치환기(`safeSegment`)를 쓴다 — 두 벌로 나뉘면
 * 한쪽만 고쳐져 한글이 사라지는 사고가 난다.
 */
export function resultZipEntryName(input: { teamName: string; sequence: number; title: string }): string {
  const folder = safeSegment(input.teamName) || FALLBACK_TEAM_NAME;
  const parts: string[] = [];
  if (input.sequence >= 1) parts.push(`${Math.floor(input.sequence)}차`);
  const title = safeSegment(input.title);
  if (title) parts.push(title);
  const file = parts.join('_') || FALLBACK_TEAM_NAME;
  return `${folder}/${file}.png`;
}

/** 전수 내려받기 ZIP의 파일명. 시각은 `resultImageFileName`과 같이 **저장한 때**다. */
export function resultZipFileName(at: Date): string {
  return `조별_투표결과_${stamp(at)}.zip`;
}

function pixelAttr(tag: string, name: string): number | null {
  // 앞의 `\s`가 `stroke-width="2"`를 `width`로 오인하는 것을 막는다.
  const matched = new RegExp(`\\s${name}="([^"]*)"`).exec(tag);
  if (!matched) return null;
  const value = Number.parseFloat(matched[1]);
  if (!Number.isFinite(value) || value <= 0) return null;
  return value;
}

/**
 * SVG 루트의 픽셀 크기. `viewBox`만 있고 픽셀 width/height가 없으면 **null**을 돌려준다 —
 * 그런 SVG를 `Image`에 실으면 고유 크기가 없어 canvas가 0x0이 되고, 저장된 PNG가 빈 파일이 된다.
 * (`naturalWidth`를 믿지 않고 문자열에서 읽는 이유: 브라우저 없이 테스트로 고정할 수 있어서다.)
 */
export function svgPixelSize(svg: string): { width: number; height: number } | null {
  const root = /<svg\b[^>]*>/.exec(svg);
  if (!root) return null;
  const width = pixelAttr(root[0], 'width');
  const height = pixelAttr(root[0], 'height');
  if (width == null || height == null) return null;
  return { width, height };
}

function loadSvgImage(svg: string): Promise<HTMLImageElement> {
  // `btoa`는 Latin1 밖(한글)에서 throw한다 — 반드시 encodeURIComponent 기반 data URL을 쓴다.
  // blob URL보다 브라우저 호환 범위가 넓고, 결과 SVG는 수 KB라 URL 길이도 문제되지 않는다.
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  return new Promise((resolve, reject) => {
    const image = new Image();
    const timer = setTimeout(() => {
      image.onload = null;
      image.onerror = null;
      reject(new Error(CONVERT_FAILED));
    }, LOAD_TIMEOUT_MS);
    image.onload = () => {
      clearTimeout(timer);
      resolve(image);
    };
    image.onerror = () => {
      clearTimeout(timer);
      reject(new Error(CONVERT_FAILED));
    };
    image.src = url;
  });
}

function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    if (typeof canvas.toBlob !== 'function') {
      reject(new Error(UNSUPPORTED));
      return;
    }
    // toBlob 호출을 executor 안에 둔다 — 오염된 canvas에서 던지는 동기 SecurityError가
    // 밖으로 새지 않고 reject로 이어진다.
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error(CONVERT_FAILED));
    }, 'image/png');
  });
}

/**
 * SVG 문자열을 PNG Blob으로 바꾼다. 실패하면 안내 문구가 담긴 Error를 던진다 —
 * 호출부는 잡아서 문구를 보여 주기만 하면 되고, 어떤 경우에도 화면이 멈추지 않아야 한다.
 */
export async function svgToPngBlob(svg: string, scale: number): Promise<Blob> {
  if (typeof document === 'undefined' || typeof Image === 'undefined') throw new Error(UNSUPPORTED);

  const size = svgPixelSize(svg);
  if (!size) throw new Error(CONVERT_FAILED);

  const factor = Number.isFinite(scale) && scale > 0 ? scale : RESULT_IMAGE_SCALE;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(size.width * factor);
  canvas.height = Math.round(size.height * factor);

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error(UNSUPPORTED);

  const image = await loadSvgImage(svg);
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvasToPngBlob(canvas);
}

/** Blob을 파일로 내려받는다. */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  // 문서에 붙지 않은 앵커의 click()을 무시하는 브라우저가 있다 — 붙였다가 곧바로 뗀다.
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // 바로 revoke하면 내려받기가 시작되기 전에 URL이 사라져 취소될 수 있다.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
