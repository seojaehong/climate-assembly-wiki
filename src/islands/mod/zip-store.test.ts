import { describe, it, expect } from 'vitest';
import { crc32, buildZipArchive, type ZipEntry } from './zip-store';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function bytes(text: string): Uint8Array {
  return encoder.encode(text);
}

function u16(archive: Uint8Array, offset: number): number {
  return archive[offset] | (archive[offset + 1] << 8);
}

function u32(archive: Uint8Array, offset: number): number {
  return (
    (archive[offset] | (archive[offset + 1] << 8) | (archive[offset + 2] << 16) | (archive[offset + 3] << 24)) >>> 0
  );
}

const LOCAL_SIG = 0x04034b50;
const CENTRAL_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;
const EOCD_SIZE = 22;
const LOCAL_HEADER_SIZE = 30;
const CENTRAL_HEADER_SIZE = 46;

/** EOCD는 항상 마지막 22바이트다(주석 없음). */
function eocdOffset(archive: Uint8Array): number {
  return archive.length - EOCD_SIZE;
}

const AT = new Date(2026, 7, 29, 14, 32, 30);

function build(entries: ZipEntry[], at: Date = AT): Uint8Array {
  return buildZipArchive(entries, at);
}

describe('crc32', () => {
  it('알려진 값과 일치한다', () => {
    expect(crc32(bytes(''))).toBe(0x00000000);
    expect(crc32(bytes('a'))).toBe(0xe8b7be43);
    expect(crc32(bytes('123456789'))).toBe(0xcbf43926);
  });

  it('최상위 비트가 서는 값도 부호 없는 정수로 돌려준다', () => {
    // 0xFF 한 바이트의 CRC는 0xFF000000이다. 부호 있는 32비트로 새면 음수가 되어
    // 헤더에 그대로 쓸 때 조용히 다른 바이트가 박힌다.
    const value = crc32(new Uint8Array([0xff]));
    expect(value).toBe(0xff000000);
    expect(value).toBeGreaterThan(0);
  });

  it('한글(UTF-8 다중 바이트)에서도 알려진 값과 일치한다', () => {
    expect(crc32(bytes('1분과 1조'))).toBe(0x734a2a60);
  });
});

describe('buildZipArchive', () => {
  it('빈 목록이면 EOCD만 있는 22바이트 아카이브를 만든다', () => {
    const archive = build([]);
    expect(archive.length).toBe(EOCD_SIZE);
    expect(u32(archive, 0)).toBe(EOCD_SIG);
    expect(u16(archive, 8)).toBe(0); // 이 디스크의 항목 수
    expect(u16(archive, 10)).toBe(0); // 전체 항목 수
    expect(u32(archive, 12)).toBe(0); // 중앙 디렉터리 크기
    expect(u32(archive, 16)).toBe(0); // 중앙 디렉터리 오프셋
  });

  it('로컬 헤더를 규격대로 쓴다 — 무압축·크기·CRC', () => {
    const data = bytes('hello zip');
    const archive = build([{ name: 'a.png', data }]);

    expect(u32(archive, 0)).toBe(LOCAL_SIG);
    expect(u16(archive, 8)).toBe(0); // compression method = store
    expect(u32(archive, 14)).toBe(crc32(data));
    expect(u32(archive, 18)).toBe(data.length); // 압축 크기
    expect(u32(archive, 22)).toBe(data.length); // 원본 크기
    expect(u16(archive, 26)).toBe(bytes('a.png').length);
    expect(u16(archive, 28)).toBe(0); // extra field 없음
  });

  it('UTF-8 플래그(비트 11)만 세우고 data descriptor 비트(3)는 세우지 않는다', () => {
    const archive = build([{ name: '1분과 1조/2차_석탄 감축.png', data: bytes('x') }]);
    const flag = u16(archive, 6);
    expect(flag & 0x0800).toBe(0x0800);
    // 비트 3을 세우면 크기를 데이터 뒤(data descriptor)에서 읽으라는 뜻이 되는데
    // 우리는 헤더에 이미 크기를 적었다 — 세우면 아카이브가 깨진다.
    expect(flag & 0x0008).toBe(0);
    expect(flag).toBe(0x0800);
  });

  it('한글 파일명을 UTF-8 바이트로 그대로 저장한다', () => {
    const name = '1분과 1조/2차_석탄 감축.png';
    const nameBytes = encoder.encode(name);
    const archive = build([{ name, data: bytes('x') }]);

    // 파일명 길이 필드는 **문자 수가 아니라 바이트 수**다. 한글에서 갈린다.
    expect(nameBytes.length).toBeGreaterThan(name.length);
    expect(u16(archive, 26)).toBe(nameBytes.length);

    const stored = archive.slice(LOCAL_HEADER_SIZE, LOCAL_HEADER_SIZE + nameBytes.length);
    expect(decoder.decode(stored)).toBe(name);
  });

  it('데이터를 그대로(무압축) 담아 되읽을 수 있다', () => {
    const name = 'a.png';
    const data = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff, 0x10]);
    const archive = build([{ name, data }]);
    const dataStart = LOCAL_HEADER_SIZE + bytes(name).length;
    expect(Array.from(archive.slice(dataStart, dataStart + data.length))).toEqual(Array.from(data));
  });

  it('중앙 디렉터리 항목이 각 로컬 헤더 오프셋을 정확히 가리킨다', () => {
    const entries: ZipEntry[] = [
      { name: '1분과 1조/1차_첫 질문.png', data: bytes('first-image-bytes') },
      { name: '2분과 3조/2차_두 번째.png', data: bytes('second') },
    ];
    const archive = build(entries);

    const eocd = eocdOffset(archive);
    expect(u32(archive, eocd)).toBe(EOCD_SIG);
    expect(u16(archive, eocd + 8)).toBe(2);
    expect(u16(archive, eocd + 10)).toBe(2);

    const cdSize = u32(archive, eocd + 12);
    const cdOffset = u32(archive, eocd + 16);
    expect(cdOffset + cdSize).toBe(eocd);

    // 중앙 디렉터리를 순회하며 각 항목이 가리키는 오프셋에 실제 로컬 헤더가 있는지 확인한다.
    // 오프셋 계산이 한 칸만 밀려도 어떤 압축 해제 도구에서는 열리고 어떤 도구에서는 안 열린다.
    let cursor = cdOffset;
    for (const entry of entries) {
      expect(u32(archive, cursor)).toBe(CENTRAL_SIG);
      const nameLength = u16(archive, cursor + 28);
      expect(nameLength).toBe(encoder.encode(entry.name).length);
      expect(u32(archive, cursor + 16)).toBe(crc32(entry.data));
      expect(u32(archive, cursor + 24)).toBe(entry.data.length);

      const localOffset = u32(archive, cursor + 42);
      expect(u32(archive, localOffset)).toBe(LOCAL_SIG);
      const localName = archive.slice(localOffset + LOCAL_HEADER_SIZE, localOffset + LOCAL_HEADER_SIZE + nameLength);
      expect(decoder.decode(localName)).toBe(entry.name);

      cursor += CENTRAL_HEADER_SIZE + nameLength;
    }
    expect(cursor).toBe(eocd);
  });

  it('DOS 날짜·시각을 넘겨받은 Date로 인코딩한다(2초 해상도)', () => {
    const archive = build([{ name: 'a.png', data: bytes('x') }], new Date(2026, 7, 29, 14, 32, 30));
    const time = u16(archive, 10);
    const date = u16(archive, 12);
    expect(time >> 11).toBe(14); // 시
    expect((time >> 5) & 0x3f).toBe(32); // 분
    expect((time & 0x1f) * 2).toBe(30); // 초(2초 단위)
    expect(((date >> 9) & 0x7f) + 1980).toBe(2026);
    expect((date >> 5) & 0x0f).toBe(8); // 월(1부터)
    expect(date & 0x1f).toBe(29);
  });

  it('1980년 이전 시각은 DOS 하한으로 고정한다', () => {
    // DOS 날짜는 1980년이 원점이라 그 이전을 그대로 쓰면 음수 연도가 되어 필드가 깨진다.
    const archive = build([{ name: 'a.png', data: bytes('x') }], new Date(1970, 0, 1, 0, 0, 0));
    expect(u16(archive, 10)).toBe(0);
    expect(u16(archive, 12)).toBe((1 << 5) | 1); // 1980-01-01
  });

  it('빈 데이터 항목도 CRC 0으로 담는다', () => {
    const archive = build([{ name: 'empty.png', data: new Uint8Array(0) }]);
    expect(u32(archive, 14)).toBe(0);
    expect(u32(archive, 18)).toBe(0);
    expect(u32(archive, 22)).toBe(0);
    expect(u16(archive, eocdOffset(archive) + 10)).toBe(1);
  });
});
