/**
 * 통합 진입점 시험 — **실제 문서를 읽지 않는다.**
 *
 * 거절 경로는 엔진을 부르기 전에 끝나므로 WASM 도 kordoc 도 필요 없다. 실제 문서로 낸
 * 숫자(hwpx 164단위 · hwp 842단위 + 누락경고 · docx 865단위)는 `scripts/verify-parsers.mjs` 몫이다.
 */
import { describe, expect, it } from 'vitest';

import { MAX_BYTES, extensionOf, extractDocument, planExtraction } from './index';

describe('extensionOf', () => {
  it('대소문자를 가리지 않는다', () => {
    expect(extensionOf('보고서.HWPX')).toBe('hwpx');
    expect(extensionOf('a.DocX')).toBe('docx');
  });

  it('경로가 붙어 있어도 마지막 조각만 본다 — 슬래시·역슬래시 둘 다', () => {
    expect(extensionOf('C:\\입력자료\\1조.hwp')).toBe('hwp');
    expect(extensionOf('/tmp/a.b.c/1조.docx')).toBe('docx');
  });

  it('점이 없거나 점으로 시작하면 빈 문자열이다', () => {
    expect(extensionOf('README')).toBe('');
    expect(extensionOf('.hwp')).toBe('');
  });
});

describe('planExtraction', () => {
  it('.hwp·.hwpx 는 rhwp 로, .docx 는 kordoc 으로 보낸다', () => {
    expect(planExtraction('a.hwp', 10).engine).toBe('rhwp');
    expect(planExtraction('a.hwpx', 10).engine).toBe('rhwp');
    expect(planExtraction('a.docx', 10).engine).toBe('kordoc');
  });

  it('구형 .doc 은 거절하고 「.docx 로 올려 주세요」를 안내한다', () => {
    const plan = planExtraction('2026 결과보고서.doc', 10);
    expect(plan.engine).toBeNull();
    expect(plan.warning?.kind).toBe('unsupported');
    expect(plan.warning?.message).toContain('다른 이름으로 저장해 .docx 로 올려 주세요');
  });

  it('모르는 확장자는 unsupported 로 거절한다', () => {
    for (const name of ['a.pdf', 'a.txt', 'a.zip', 'README', 'a.hwpxx']) {
      const plan = planExtraction(name, 10);
      expect(plan.engine, name).toBeNull();
      expect(plan.warning?.kind, name).toBe('unsupported');
    }
  });

  it('20MB 는 통과하고 그것을 넘으면 too-large 로 거절한다', () => {
    expect(MAX_BYTES).toBe(20 * 1024 * 1024);
    expect(planExtraction('a.hwpx', MAX_BYTES).engine).toBe('rhwp');

    const plan = planExtraction('a.hwpx', MAX_BYTES + 1);
    expect(plan.engine).toBeNull();
    expect(plan.warning?.kind).toBe('too-large');
    expect(plan.warning?.message).toContain('20MB');
  });

  it('크기보다 확장자를 먼저 본다 — 안내 문구가 크기 경고에 가리지 않게', () => {
    const plan = planExtraction('a.doc', MAX_BYTES + 1);
    expect(plan.warning?.kind).toBe('unsupported');
  });
});

describe('extractDocument', () => {
  const bytes = new Uint8Array(8);

  it('거절할 때는 단위도 글자수도 없다 — 성공으로 위장하지 않는다', async () => {
    const result = await extractDocument(bytes, 'a.doc');
    expect(result.units).toEqual([]);
    expect(result.charCount).toBe(0);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].kind).toBe('unsupported');
  });

  it('모르는 확장자·너무 큰 파일도 던지지 않고 경고로 돌려준다', async () => {
    expect((await extractDocument(bytes, 'a.pdf')).warnings[0].kind).toBe('unsupported');
    // 한도를 넘기려면 실제로 그만큼 잡아야 한다(0으로 찬 21MB — 곧 버린다).
    const big = new Uint8Array(MAX_BYTES + 1);
    expect((await extractDocument(big, 'a.hwpx')).warnings[0].kind).toBe('too-large');
  });

  it('ArrayBuffer 를 받아도 같은 판단을 한다', async () => {
    const result = await extractDocument(new ArrayBuffer(8), 'a.doc');
    expect(result.warnings[0].kind).toBe('unsupported');
  });
});
