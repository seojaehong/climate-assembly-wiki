import { describe, it, expect } from 'vitest';
import { resultImageFileName, resultZipEntryName, resultZipFileName, svgPixelSize } from './svg-to-png';
import { renderResultSvg } from './result-image';

/**
 * `at`은 항상 로컬 시각 생성자로 만든다(`new Date(2026, 7, 29, 14, 32)`).
 * ISO 문자열로 만들면 실행 환경 타임존에 따라 결과가 갈려 CI와 로컬이 다른 답을 낸다 —
 * 로컬 생성자 → 로컬 getter 왕복은 어느 타임존에서도 같은 값이 나온다.
 */
describe('resultImageFileName', () => {
  it('조 이름 · 회차 · 저장 시각을 규격대로 잇는다', () => {
    const name = resultImageFileName({
      teamName: '1분과 1조',
      sequence: 2,
      at: new Date(2026, 7, 29, 14, 32),
    });
    expect(name).toBe('1분과_1조_2차_20260829-1432.png');
  });

  it('한글을 그대로 남긴다 — 허용목록(\\w)으로 걸러내면 조 이름이 통째로 사라진다', () => {
    const name = resultImageFileName({
      teamName: '기후정의',
      sequence: 1,
      at: new Date(2026, 7, 29, 9, 5),
    });
    expect(name).toBe('기후정의_1차_20260829-0905.png');
  });

  it('공백은 밑줄 하나로 바꾸고 앞뒤 공백은 없앤다', () => {
    const name = resultImageFileName({
      teamName: '  3분과   5조 ',
      sequence: 3,
      at: new Date(2026, 7, 29, 14, 32),
    });
    expect(name).toBe('3분과_5조_3차_20260829-1432.png');
  });

  it('경로를 가르거나 저장을 막는 특수문자를 밑줄로 바꾼다', () => {
    const name = resultImageFileName({
      teamName: 'A/B:조*1?"<>|',
      sequence: 1,
      at: new Date(2026, 7, 29, 14, 32),
    });
    expect(name).toBe('A_B_조_1_1차_20260829-1432.png');
    expect(name).not.toContain('/');
    expect(name).not.toContain('\\');
    expect(name).not.toContain(':');
  });

  it('앞뒤에 남은 밑줄과 점을 떼어낸다 — 점으로 시작하는 파일은 숨김 파일이 된다', () => {
    const name = resultImageFileName({
      teamName: '.../1조...',
      sequence: 1,
      at: new Date(2026, 7, 29, 14, 32),
    });
    expect(name).toBe('1조_1차_20260829-1432.png');
  });

  it('회차가 1보다 작으면 회차 조각을 넣지 않는다 — 0차라는 투표는 없다', () => {
    expect(
      resultImageFileName({ teamName: '2분과 4조', sequence: 0, at: new Date(2026, 7, 29, 14, 32) }),
    ).toBe('2분과_4조_20260829-1432.png');
    expect(
      resultImageFileName({ teamName: '2분과 4조', sequence: -1, at: new Date(2026, 7, 29, 14, 32) }),
    ).toBe('2분과_4조_20260829-1432.png');
  });

  it('회차 1은 정상적으로 붙는다(경계)', () => {
    expect(
      resultImageFileName({ teamName: '2분과 4조', sequence: 1, at: new Date(2026, 7, 29, 14, 32) }),
    ).toBe('2분과_4조_1차_20260829-1432.png');
  });

  it('월·일·시·분을 두 자리로 채운다', () => {
    expect(
      resultImageFileName({ teamName: '1조', sequence: 1, at: new Date(2026, 0, 5, 0, 7) }),
    ).toBe('1조_1차_20260105-0007.png');
  });

  it('조 이름이 비었거나 특수문자뿐이면 폴백 이름을 쓴다 — 확장자만 남은 파일을 만들지 않는다', () => {
    expect(resultImageFileName({ teamName: '', sequence: 1, at: new Date(2026, 7, 29, 14, 32) })).toBe(
      '투표결과_1차_20260829-1432.png',
    );
    expect(
      resultImageFileName({ teamName: '   ', sequence: 2, at: new Date(2026, 7, 29, 14, 32) }),
    ).toBe('투표결과_2차_20260829-1432.png');
  });

  it('언제나 .png로 끝나고 줄바꿈·제어문자가 남지 않는다', () => {
    const name = resultImageFileName({
      teamName: '1분과\n1조\t가',
      sequence: 9,
      at: new Date(2026, 11, 31, 23, 59),
    });
    expect(name).toBe('1분과_1조_가_9차_20261231-2359.png');
    expect(name.endsWith('.png')).toBe(true);
  });
});

describe('svgPixelSize', () => {
  /**
   * 실제 렌더러 출력으로 확인한다. 렌더러가 픽셀 width/height를 잃으면(viewBox만 남기면)
   * canvas 크기가 0이 되어 저장된 PNG가 빈 파일이 되는데, 브라우저가 없어 육안으로 못 잡는다.
   */
  it('renderResultSvg 출력에서 픽셀 크기를 읽는다', () => {
    const svg = renderResultSvg({
      teamName: '1분과 1조',
      sequence: 2,
      title: '어떤 안을 고르시겠습니까?',
      closedAtLabel: '14:32',
      total: 12,
      results: [
        { option: '가안', count: 7 },
        { option: '나안', count: 5 },
      ],
    });
    const size = svgPixelSize(svg);
    expect(size).not.toBeNull();
    expect(size?.width).toBe(1200);
    expect(size?.height).toBeGreaterThan(0);
  });

  it('선택지가 늘면 읽어낸 높이도 함께 커진다', () => {
    const base = {
      teamName: '1조',
      sequence: 1,
      title: '질문',
      closedAtLabel: null,
      total: 10,
    };
    const two = svgPixelSize(
      renderResultSvg({ ...base, results: [{ option: 'A', count: 6 }, { option: 'B', count: 4 }] }),
    );
    const ten = svgPixelSize(
      renderResultSvg({
        ...base,
        results: Array.from({ length: 10 }, (_, i) => ({ option: `옵션${i}`, count: 1 })),
      }),
    );
    expect(two?.height).toBeGreaterThan(0);
    expect(ten?.height).toBeGreaterThan(two?.height ?? 0);
  });

  it('속성 순서와 px 단위에 흔들리지 않는다', () => {
    expect(svgPixelSize('<svg height="200px" width="100px" xmlns="http://www.w3.org/2000/svg"></svg>')).toEqual({
      width: 100,
      height: 200,
    });
  });

  it('viewBox만 있으면 null이다 — 고유 크기가 없으면 canvas가 0x0이 된다', () => {
    expect(svgPixelSize('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 700"></svg>')).toBeNull();
  });

  it('폭만 있거나 0 이하이면 null이다', () => {
    expect(svgPixelSize('<svg width="1200"></svg>')).toBeNull();
    expect(svgPixelSize('<svg width="0" height="700"></svg>')).toBeNull();
    expect(svgPixelSize('<svg width="1200" height="-4"></svg>')).toBeNull();
  });

  it('svg 루트가 없으면 null이다', () => {
    expect(svgPixelSize('<div width="10" height="10"></div>')).toBeNull();
    expect(svgPixelSize('')).toBeNull();
  });

  it('내부 요소의 stroke-width를 폭으로 착각하지 않는다', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><line stroke-width="2" /></svg>';
    expect(svgPixelSize(svg)).toEqual({ width: 800, height: 600 });
  });
});

describe('resultZipEntryName', () => {
  it('조별 폴더 아래에 회차·제목으로 파일을 놓는다', () => {
    expect(
      resultZipEntryName({ teamName: '1분과 1조', sequence: 2, title: '석탄 발전 감축 속도' }),
    ).toBe('1분과_1조/2차_석탄_발전_감축_속도.png');
  });

  it('폴더와 파일 이름을 각각 정리한 뒤 슬래시로 잇는다 — 제목의 경로 문자가 폴더를 새로 만들면 안 된다', () => {
    const name = resultZipEntryName({ teamName: '2분과 3조', sequence: 1, title: 'A/B 안 비교' });
    expect(name).toBe('2분과_3조/1차_A_B_안_비교.png');
    // 슬래시는 폴더 구분자 하나뿐이어야 한다.
    expect(name.split('/').length).toBe(2);
  });

  it('조 이름이 전부 걸러지는 문자여도 절대 경로가 되지 않는다', () => {
    // 앞이 비면 '/파일.png'가 되어 절대 경로로 읽히고, 압축 해제를 통째로 거부하는 도구가 있다.
    const name = resultZipEntryName({ teamName: '///', sequence: 1, title: '질문' });
    expect(name.startsWith('/')).toBe(false);
    expect(name).toBe('투표결과/1차_질문.png');
  });

  it('회차가 1보다 작으면 회차 조각을 빼고 제목만 쓴다', () => {
    expect(resultZipEntryName({ teamName: '1분과 1조', sequence: 0, title: '질문' })).toBe('1분과_1조/질문.png');
  });

  it('긴 제목을 잘라 경로 길이를 묶는다 — Windows 탐색기가 260자에서 압축 해제를 거부한다', () => {
    // 제목은 모더레이터가 현장에서 자유롭게 입력한다(입력창에도 DB에도 길이 제한이 없다).
    // 그대로 파일명에 넣으면 압축을 푸는 도구에 따라 열리고 안 열리는 아카이브가 된다.
    const long = '석탄 발전 감축 속도를 어느 정도로 할 것인가에 대한 우리 조의 의견'.repeat(4);
    const name = resultZipEntryName({ teamName: '1분과 1조', sequence: 2, title: long });

    expect(name.length).toBeLessThanOrEqual(80);
    expect(name.startsWith('1분과_1조/2차_')).toBe(true);
    expect(name.endsWith('.png')).toBe(true);
    // 자른 자리가 밑줄이면 '..._.png'가 된다.
    expect(name.endsWith('_.png')).toBe(false);
  });

  it('제목이 비어도 파일명이 비지 않는다', () => {
    expect(resultZipEntryName({ teamName: '1분과 1조', sequence: 3, title: '   ' })).toBe('1분과_1조/3차.png');
    expect(resultZipEntryName({ teamName: '1분과 1조', sequence: 0, title: '' })).toBe('1분과_1조/투표결과.png');
  });
});

describe('resultZipFileName', () => {
  it('저장 시각을 붙인 zip 이름을 만든다', () => {
    expect(resultZipFileName(new Date(2026, 7, 29, 14, 32))).toBe('조별_투표결과_20260829-1432.zip');
  });
});

describe('resultZipEntryName — 경로 분리자 봉쇄 (리뷰 지적)', () => {
  it('제목 안의 역슬래시가 ZIP 안에 하위 폴더를 만들지 않는다', () => {
    // U+005C는 Windows 경로 분리자다. 한국어 자판에서 ₩ 글리프로 보이지만 값은 역슬래시라
    // 모더레이터가 '재생에너지\\원자력'처럼 무심코 입력할 수 있다. 슬래시만 막으면 새는 구멍.
    const name = resultZipEntryName({
      teamName: '1분과 1조',
      sequence: 2,
      title: '재생에너지\\원자력 중 우선순위',
    });
    expect(name.split('/')).toHaveLength(2);
    expect(name.includes(String.fromCharCode(92))).toBe(false);
  });
});
