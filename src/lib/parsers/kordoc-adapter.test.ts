/**
 * kordoc 어댑터 시험 — 실제 파일 없이 도는 부분만 여기서 못박는다.
 *
 * 실측 숫자(진짜 docx 의 단위 수·한국어 보존)는 저장소 밖 `10_작업산출물` 을 읽어야 해서
 * `scripts/verify-parsers.mjs` 가 맡는다. 여기서는 블록을 단위로 옮기는 규칙과
 * 실패를 경고로 옮기는 규칙만 본다.
 */
import { describe, expect, it } from 'vitest';

import { collectKordocUnits, warningForFailure } from './kordoc-adapter';

import type { IRBlock } from 'kordoc';

const cell = (text: string, blocks?: IRBlock[]) => ({ text, colSpan: 1, rowSpan: 1, ...(blocks ? { blocks } : {}) });

describe('collectKordocUnits', () => {
  it('문단·헤딩을 각각 개별 단위로 옮기고 engine 을 kordoc 으로 찍는다', () => {
    const units = collectKordocUnits([
      { type: 'heading', text: '1분과 1조', level: 2 },
      { type: 'paragraph', text: '기후교육이 부족하다.' },
    ]);
    expect(units.map((u) => u.text)).toEqual(['1분과 1조', '기후교육이 부족하다.']);
    expect(units.every((u) => u.provenance.engine === 'kordoc')).toBe(true);
  });

  it('빈 문자열·공백만 있는 블록은 버린다', () => {
    const units = collectKordocUnits([
      { type: 'paragraph', text: '' },
      { type: 'paragraph', text: '   \n  ' },
      { type: 'separator' },
      { type: 'image' },
      { type: 'paragraph', text: '남는 것' },
    ]);
    expect(units.map((u) => u.text)).toEqual(['남는 것']);
  });

  it('표는 셀마다 단위 하나로 옮긴다 — 표 하나가 한 덩어리가 되지 않는다', () => {
    const units = collectKordocUnits([
      {
        type: 'table',
        table: {
          rows: 2,
          cols: 2,
          hasHeader: true,
          cells: [
            [cell('꼭지'), cell('내용')],
            [cell('배경'), cell('(박서준) 환경교육이 지루하다.')],
          ],
        },
      },
    ]);
    expect(units).toHaveLength(4);
    expect(units[3]?.text).toBe('(박서준) 환경교육이 지루하다.');
  });

  it('셀 안에 중첩 블록이 있으면 평탄화 사본(text)이 아니라 그쪽을 쓴다 — 같은 글이 두 번 세어지지 않는다', () => {
    const units = collectKordocUnits([
      {
        type: 'table',
        table: {
          rows: 1,
          cols: 1,
          hasHeader: false,
          cells: [
            [
              cell('첫 줄\n둘째 줄', [
                { type: 'paragraph', text: '첫 줄' },
                { type: 'paragraph', text: '둘째 줄' },
              ]),
            ],
          ],
        },
      },
    ]);
    expect(units.map((u) => u.text)).toEqual(['첫 줄', '둘째 줄']);
  });

  it('표 캡션을 잃지 않는다 — 평범한 글자 캡션은 caption 문자열로만 온다', () => {
    const units = collectKordocUnits([
      {
        type: 'table',
        table: {
          rows: 1,
          cols: 1,
          hasHeader: false,
          caption: '표 1. 조별 산출물',
          cells: [[cell('내용')]],
        },
      },
    ]);
    expect(units.map((u) => u.text)).toEqual(['내용', '표 1. 조별 산출물']);
  });

  it('captionBlocks 가 있으면 평탄화 사본(caption)을 겹쳐 담지 않는다', () => {
    const units = collectKordocUnits([
      {
        type: 'table',
        table: {
          rows: 1,
          cols: 1,
          hasHeader: false,
          caption: '표 1. 조별 산출물',
          captionBlocks: [{ type: 'paragraph', text: '표 1. 조별 산출물' }],
          cells: [[cell('내용')]],
        },
      },
    ]);
    expect(units.map((u) => u.text)).toEqual(['내용', '표 1. 조별 산출물']);
  });

  it('중첩 리스트 항목(children)까지 파고든다', () => {
    const units = collectKordocUnits([
      { type: 'list', text: '상위', children: [{ type: 'list', text: '하위' }] },
    ]);
    expect(units.map((u) => u.text)).toEqual(['상위', '하위']);
  });

  it('kordoc 이 페이지 번호를 준 블록만 page 를 채운다 (DOCX 는 주지 않는다)', () => {
    const units = collectKordocUnits([
      { type: 'paragraph', text: '쪽 있음', pageNumber: 3 },
      { type: 'paragraph', text: '쪽 없음' },
    ]);
    expect(units[0]?.provenance.page).toBe(3);
    expect(units[1]?.provenance.page).toBeUndefined();
  });
});

describe('warningForFailure', () => {
  it('암호·DRM 문서는 encrypted 로 올린다 — 빈 성공으로 위장하지 않는다', () => {
    for (const code of ['ENCRYPTED', 'DRM_PROTECTED'] as const) {
      const w = warningForFailure({ success: false, fileType: 'docx', code, error: 'locked' });
      expect(w.kind).toBe('encrypted');
      expect(w.detail).toContain(code);
    }
  });

  it('그 밖의 실패는 unsupported 로 올리고 코드를 detail 에 남긴다', () => {
    const w = warningForFailure({ success: false, fileType: 'unknown', code: 'CORRUPTED', error: 'bad zip' });
    expect(w.kind).toBe('unsupported');
    expect(w.detail).toBe('CORRUPTED: bad zip');
  });
});
