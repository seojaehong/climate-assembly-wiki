/**
 * 무압축(store) ZIP을 직접 만든다. 외부 라이브러리를 쓰지 않는다.
 *
 * 왜 ZIP인가: 45장(15조 x 3회차)을 순차 개별 다운로드로 내보내면 브라우저가 10개쯤에서
 * "여러 파일 내려받기"를 차단한다. 한 파일로 묶으면 그 경계에 걸리지 않는다.
 *
 * 왜 store(압축 없음)인가: PNG는 이미 압축돼 있어 deflate로 다시 줄여도 거의 안 줄고,
 * 압축기를 직접 쓰면 검증할 수 없는 코드가 늘어난다. store는 규격이 짧아 테스트로 고정할 수 있다.
 *
 * 이 모듈은 순수하다 — DOM도 `Date.now()`도 쓰지 않는다(시각은 인자로 받는다).
 * 규격 근거: PKWARE APPNOTE 4.3.6(로컬 헤더) / 4.3.12(중앙 디렉터리) / 4.3.16(EOCD).
 */

/** ZIP 안에 담을 파일 하나. `name`은 `조이름/파일명.png`처럼 `/`로 폴더를 표현한다. */
export interface ZipEntry {
  name: string;
  data: Uint8Array;
}

const LOCAL_SIG = 0x04034b50;
const CENTRAL_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;

const LOCAL_HEADER_SIZE = 30;
const CENTRAL_HEADER_SIZE = 46;
const EOCD_SIZE = 22;

/** 2.0 = store/deflate를 읽을 수 있는 최소 버전. */
const VERSION = 20;

/**
 * general purpose bit 11 — 파일명이 UTF-8이라는 신고.
 * 이것이 없으면 압축 해제기가 이름을 CP437로 읽어 한글 조 이름이 깨진다.
 * **비트 3(data descriptor)은 절대 세우지 않는다** — 크기를 헤더에 미리 적기 때문이다.
 */
const FLAG_UTF8 = 0x0800;

const ZIP_EPOCH_YEAR = 1980;
/** 32비트 필드라 4GB를 넘길 수 없고, 항목 수도 16비트다(zip64 미지원). */
const MAX_ENTRIES = 0xffff;
const MAX_SIZE = 0xffffffff;

let crcTable: Uint32Array | null = null;

function getCrcTable(): Uint32Array {
  if (crcTable) return crcTable;
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let value = i;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? (value >>> 1) ^ 0xedb88320 : value >>> 1;
    }
    table[i] = value >>> 0;
  }
  crcTable = table;
  return table;
}

/**
 * CRC-32(IEEE 802.3, 다항식 0xEDB88320). **부호 없는 정수**를 돌려준다 —
 * JavaScript의 비트 연산은 부호 있는 32비트라 `>>> 0`을 빼먹으면 음수가 새어 나가고
 * 헤더에 다른 바이트가 박혀 "CRC 불일치"로 아카이브가 거부된다.
 */
export function crc32(bytes: Uint8Array): number {
  const table = getCrcTable();
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc = (crc >>> 8) ^ table[(crc ^ bytes[i]) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** DOS 날짜·시각(각 16비트). 초는 2초 해상도이고, 1980년 이전은 하한으로 고정한다. */
function dosDateTime(at: Date): { time: number; date: number } {
  const year = at.getFullYear();
  if (!Number.isFinite(year) || year < ZIP_EPOCH_YEAR) {
    return { time: 0, date: (1 << 5) | 1 };
  }
  const time = (at.getHours() << 11) | (at.getMinutes() << 5) | (at.getSeconds() >> 1);
  const date = ((year - ZIP_EPOCH_YEAR) << 9) | ((at.getMonth() + 1) << 5) | at.getDate();
  return { time, date };
}

function writeU16(view: DataView, offset: number, value: number): void {
  view.setUint16(offset, value, true);
}

function writeU32(view: DataView, offset: number, value: number): void {
  view.setUint32(offset, value >>> 0, true);
}

/**
 * 무압축 ZIP 바이트를 만든다. `at`은 항목의 수정 시각으로 쓰인다(호출부가 `new Date()`를 넘긴다).
 * 항목 순서는 입력 그대로 유지된다.
 *
 * 폴더 항목(0바이트 `조이름/`)은 만들지 않는다 — 이름에 `/`가 있으면 압축 해제기가 폴더를
 * 알아서 만들고, 굳이 넣으면 오히려 깨진 아카이브를 만들기 쉽다.
 *
 * 반환 타입을 `Uint8Array<ArrayBuffer>`로 좁힌 것은 호출부가 `new Blob([archive])`를
 * 캐스팅 없이 쓸 수 있게 하려는 것이다(`SharedArrayBuffer` 위의 뷰는 BlobPart가 아니다).
 */
export function buildZipArchive(entries: ZipEntry[], at: Date): Uint8Array<ArrayBuffer> {
  if (entries.length > MAX_ENTRIES) {
    throw new Error(`한 번에 ${MAX_ENTRIES}개까지만 묶을 수 있습니다.`);
  }

  const encoder = new TextEncoder();
  const { time, date } = dosDateTime(at);
  const prepared = entries.map((entry) => ({
    nameBytes: encoder.encode(entry.name),
    data: entry.data,
    crc: crc32(entry.data),
  }));

  const localSize = prepared.reduce(
    (sum, entry) => sum + LOCAL_HEADER_SIZE + entry.nameBytes.length + entry.data.length,
    0,
  );
  const centralSize = prepared.reduce((sum, entry) => sum + CENTRAL_HEADER_SIZE + entry.nameBytes.length, 0);
  const total = localSize + centralSize + EOCD_SIZE;
  if (total > MAX_SIZE) {
    throw new Error('내려받을 파일이 너무 큽니다. 조를 나눠 내려받아 주세요.');
  }

  const archive = new Uint8Array(total);
  const view = new DataView(archive.buffer);

  // 1) 로컬 헤더 + 데이터. 각 항목의 오프셋을 **헤더를 쓰기 전에** 기록해 둔다.
  const offsets: number[] = [];
  let cursor = 0;
  for (const entry of prepared) {
    offsets.push(cursor);
    writeU32(view, cursor, LOCAL_SIG);
    writeU16(view, cursor + 4, VERSION);
    writeU16(view, cursor + 6, FLAG_UTF8);
    writeU16(view, cursor + 8, 0); // compression method = store
    writeU16(view, cursor + 10, time);
    writeU16(view, cursor + 12, date);
    writeU32(view, cursor + 14, entry.crc);
    writeU32(view, cursor + 18, entry.data.length); // 압축 크기 = 원본 크기
    writeU32(view, cursor + 22, entry.data.length);
    writeU16(view, cursor + 26, entry.nameBytes.length);
    writeU16(view, cursor + 28, 0); // extra field 없음
    cursor += LOCAL_HEADER_SIZE;
    archive.set(entry.nameBytes, cursor);
    cursor += entry.nameBytes.length;
    archive.set(entry.data, cursor);
    cursor += entry.data.length;
  }

  // 2) 중앙 디렉터리.
  const centralOffset = cursor;
  prepared.forEach((entry, index) => {
    writeU32(view, cursor, CENTRAL_SIG);
    writeU16(view, cursor + 4, VERSION); // version made by
    writeU16(view, cursor + 6, VERSION); // version needed
    writeU16(view, cursor + 8, FLAG_UTF8);
    writeU16(view, cursor + 10, 0); // compression method = store
    writeU16(view, cursor + 12, time);
    writeU16(view, cursor + 14, date);
    writeU32(view, cursor + 16, entry.crc);
    writeU32(view, cursor + 20, entry.data.length);
    writeU32(view, cursor + 24, entry.data.length);
    writeU16(view, cursor + 28, entry.nameBytes.length);
    writeU16(view, cursor + 30, 0); // extra field 길이
    writeU16(view, cursor + 32, 0); // 파일 주석 길이
    writeU16(view, cursor + 34, 0); // 시작 디스크 번호
    writeU16(view, cursor + 36, 0); // 내부 속성
    writeU32(view, cursor + 38, 0); // 외부 속성
    writeU32(view, cursor + 42, offsets[index]);
    cursor += CENTRAL_HEADER_SIZE;
    archive.set(entry.nameBytes, cursor);
    cursor += entry.nameBytes.length;
  });

  // 3) EOCD. 주석이 없으므로 아카이브의 마지막 22바이트다.
  writeU32(view, cursor, EOCD_SIG);
  writeU16(view, cursor + 4, 0); // 이 디스크 번호
  writeU16(view, cursor + 6, 0); // 중앙 디렉터리가 시작하는 디스크
  writeU16(view, cursor + 8, prepared.length);
  writeU16(view, cursor + 10, prepared.length);
  writeU32(view, cursor + 12, centralSize);
  writeU32(view, cursor + 16, centralOffset);
  writeU16(view, cursor + 20, 0); // 아카이브 주석 길이

  return archive;
}
