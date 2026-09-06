import { describe, expect, it } from 'vitest';
import { Packer } from 'docx';
import {
  REPORT_HOLD_NOTICE,
  REPORT_TITLE,
  ballotReportFileName,
  buildBallotReportDoc,
  buildBallotReportModel,
  formatGeneratedAt,
  pngPixelSize,
} from './ballot-report-docx';
import type { BallotResults, SubmissionGetResult, Topic } from '../../lib/deliberation';

/** 유효한 1x1 PNG(투명) — pngPixelSize와 docx 임베드가 모두 받아들이는 최소 픽스처. */
const PNG_1x1_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

function png1x1(): ArrayBuffer {
  const buf = Buffer.from(PNG_1x1_B64, 'base64');
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

/** 임의 크기의 PNG 헤더(서명 + IHDR 24바이트)를 만든다 — 크기 파싱만 검증할 때 쓴다. */
function pngHeader(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width, false);
  view.setUint32(20, height, false);
  return bytes;
}

function results(overrides: Partial<BallotResults> = {}): BallotResults {
  return {
    id: 'b-1',
    title: '폐회 일괄 투표 — 권고안 지지도',
    status: 'closed',
    responses: 12,
    items: [
      {
        id: 'i-1',
        ordinal: 1,
        statement: '석탄 발전을 2035년까지 단계적으로 감축한다',
        scale: 5,
        n: 12,
        avg: 4.25,
        dist: { '1': 0, '2': 1, '3': 2, '4': 3, '5': 6 },
      },
      {
        id: 'i-2',
        ordinal: 2,
        statement: '신규 도로 건설을 중단한다',
        scale: 2,
        n: 0,
        avg: null,
        dist: {},
      },
    ],
    ...overrides,
  };
}

function topic(overrides: Partial<Topic> = {}): Topic {
  return {
    id: 't-1',
    ordinal: 1,
    block: 'am',
    prompt: '우리 지역 에너지 전환의 우선 과제는?',
    guidance: null,
    status: 'open',
    ...overrides,
  };
}

function submission(overrides: Partial<SubmissionGetResult> = {}): SubmissionGetResult {
  return {
    id: 's-1',
    status: 'final',
    items: [
      { ordinal: 1, kind: 'core', content: '태양광 보급 확대', rationale: '설치 여력이 크다' },
      { ordinal: 2, kind: 'extra', content: '단열 개보수', rationale: null },
    ],
    ...overrides,
  };
}

describe('formatGeneratedAt — 로컬 getter 기반(YYYY-MM-DD HH:mm)', () => {
  it('자릿수를 0으로 채운다', () => {
    expect(formatGeneratedAt(new Date(2026, 7, 8, 9, 5))).toBe('2026-08-08 09:05');
    expect(formatGeneratedAt(new Date(2026, 11, 31, 23, 59))).toBe('2026-12-31 23:59');
  });
});

describe('ballotReportFileName', () => {
  it('투표결과보고서_<제목>_<YYYYMMDD>.docx 꼴로 만든다 (공백→밑줄)', () => {
    expect(ballotReportFileName({ title: '폐회 일괄 투표', at: new Date(2026, 7, 29, 14, 32) })).toBe(
      '투표결과보고서_폐회_일괄_투표_20260829.docx',
    );
  });

  it('경로 분리자·Windows 금지 문자를 걸러낸다', () => {
    const name = ballotReportFileName({ title: 'A/B: "안"?', at: new Date(2026, 7, 29) });
    expect(name).not.toMatch(/[\\/:*?"<>|]/);
    expect(name.endsWith('_20260829.docx')).toBe(true);
  });

  it('제목이 전부 걸러지면 폴백을 쓴다', () => {
    expect(ballotReportFileName({ title: '///', at: new Date(2026, 7, 29) })).toBe(
      '투표결과보고서_투표_20260829.docx',
    );
  });

  it('아주 긴 제목은 60자에서 자른다 (Windows 260자 경로 방지)', () => {
    const name = ballotReportFileName({ title: '가'.repeat(200), at: new Date(2026, 7, 29) });
    expect(name.length).toBeLessThan(100);
    expect(name).toContain('가'.repeat(60));
    expect(name).not.toContain('가'.repeat(61));
  });
});

describe('buildBallotReportModel', () => {
  it('§1 개요 — 투표 제목·대상·의제 수·제출 수·상태를 담는다', () => {
    const model = buildBallotReportModel({ results: results(), generatedAtLabel: '2026-08-08 14:00' });
    expect(model.title).toBe(REPORT_TITLE);
    expect(model.ballotTitle).toBe('폐회 일괄 투표 — 권고안 지지도');
    expect(model.generatedAtLabel).toBe('2026-08-08 14:00');
    expect(model.overview).toEqual([
      { label: '투표 제목', value: '폐회 일괄 투표 — 권고안 지지도' },
      { label: '대상', value: '세션 전체' },
      { label: '의제 수', value: '2개' },
      { label: '제출 수', value: '12명' },
      { label: '상태', value: '마감됨' },
    ]);
  });

  it('§1 대상 — 분과 한정 투표는 분과명을 적고, 표지 부제에도 병기한다', () => {
    const model = buildBallotReportModel({
      results: results({ subgroup: '1분과' }),
      generatedAtLabel: 'x',
    });
    expect(model.overview.find((row) => row.label === '대상')?.value).toBe('1분과');
    expect(model.ballotTitle).toBe('폐회 일괄 투표 — 권고안 지지도 — 1분과');
  });

  it('§1 대상 — subgroup null(전체)·키 없음(S4 미적용 DB) 모두 세션 전체로 적는다', () => {
    const explicitNull = buildBallotReportModel({
      results: results({ subgroup: null }),
      generatedAtLabel: 'x',
    });
    expect(explicitNull.overview.find((row) => row.label === '대상')?.value).toBe('세션 전체');
    expect(explicitNull.ballotTitle).toBe('폐회 일괄 투표 — 권고안 지지도');

    // results() 기본값은 subgroup 키 자체가 없다 — S4 미적용 DB 응답과 동일한 형태.
    const missingKey = buildBallotReportModel({ results: results(), generatedAtLabel: 'x' });
    expect('subgroup' in results()).toBe(false);
    expect(missingKey.overview.find((row) => row.label === '대상')?.value).toBe('세션 전체');
  });

  it('§2 문항 — ballot-logic 척도 라벨 · 표 · 비율 · 계 행을 만든다', () => {
    const model = buildBallotReportModel({ results: results(), generatedAtLabel: 'x' });
    const first = model.items[0];
    expect(first.heading).toBe('의제 1. 석탄 발전을 2035년까지 단계적으로 감축한다');
    expect(first.meta).toBe('5점 척도 · 응답 12건 · 평균 4.25');
    expect(first.rows).toHaveLength(6); // 값 5 + 계
    expect(first.rows[0]).toEqual({ label: '1 (전혀 동의하지 않습니다)', count: '0', pct: '0%' });
    expect(first.rows[4]).toEqual({ label: '5 (매우 동의합니다)', count: '6', pct: '50%' });
    expect(first.rows[5]).toEqual({ label: '계', count: '12', pct: '100%', emphasis: true });
  });

  it('응답 0건 문항 — 평균 — · 계 비율 —로 적고 NaN을 흘리지 않는다', () => {
    const model = buildBallotReportModel({ results: results(), generatedAtLabel: 'x' });
    const second = model.items[1];
    expect(second.meta).toBe('2점 척도 · 응답 0건 · 평균 —');
    expect(second.rows[0]).toEqual({ label: '1 (반대)', count: '0', pct: '0%' });
    expect(second.rows[1]).toEqual({ label: '2 (찬성)', count: '0', pct: '0%' });
    expect(second.rows[2]).toEqual({ label: '계', count: '0', pct: '—', emphasis: true });
    expect(JSON.stringify(model)).not.toContain('NaN');
  });

  it('§3 — 산출물이 있으면 주제별 항목(구분·내용·근거)을 담는다', () => {
    const model = buildBallotReportModel({
      results: results(),
      generatedAtLabel: 'x',
      topics: [{ topic: topic(), submission: submission() }],
    });
    expect(model.topics).not.toBeNull();
    expect(model.topics![0].heading).toBe('우리 지역 에너지 전환의 우선 과제는?');
    expect(model.topics![0].statusLabel).toBe('제출 완료');
    expect(model.topics![0].rows).toEqual([
      { kindLabel: '핵심', content: '태양광 보급 확대', rationale: '설치 여력이 크다' },
      { kindLabel: '보충', content: '단열 개보수', rationale: '—' },
    ]);
  });

  it('§3 — 산출물이 없거나(topics 미제공) 전부 빈 제출이면 섹션 자체를 만들지 않는다', () => {
    const withoutTopics = buildBallotReportModel({ results: results(), generatedAtLabel: 'x' });
    expect(withoutTopics.topics).toBeNull();

    const emptySubmission = buildBallotReportModel({
      results: results(),
      generatedAtLabel: 'x',
      topics: [{ topic: topic(), submission: { status: null, items: [] } }],
    });
    expect(emptySubmission.topics).toBeNull();
  });

  it('하단 고정 문구(HITL)를 항상 담는다', () => {
    const model = buildBallotReportModel({ results: results(), generatedAtLabel: 'x' });
    expect(model.footer).toBe(REPORT_HOLD_NOTICE);
    expect(model.footer).toBe('본 자료는 잠정 집계이며, 최종 수치는 운영진 검수 후 확정됩니다.');
  });

  it('상태 라벨은 ballot-panel-logic과 같은 문구를 쓴다 (published=결과 공개됨)', () => {
    const model = buildBallotReportModel({
      results: results({ status: 'published' }),
      generatedAtLabel: 'x',
    });
    expect(model.overview.find((row) => row.label === '상태')?.value).toBe('결과 공개됨');
  });
});

describe('buildBallotReportModel — 문항 id를 이미지 맵 키로 싣는다', () => {
  it('각 §2 섹션에 results item id를 그대로 담는다', () => {
    const model = buildBallotReportModel({ results: results(), generatedAtLabel: 'x' });
    expect(model.items.map((i) => i.id)).toEqual(['i-1', 'i-2']);
  });
});

describe('pngPixelSize — IHDR에서 픽셀 크기를 읽는다', () => {
  it('빅엔디안 width/height를 그대로 읽는다', () => {
    expect(pngPixelSize(pngHeader(2400, 1600))).toEqual({ width: 2400, height: 1600 });
  });

  it('실제 1x1 PNG도 읽는다', () => {
    expect(pngPixelSize(new Uint8Array(png1x1()))).toEqual({ width: 1, height: 1 });
  });

  it('24바이트 미만·서명 불일치·IHDR 아님·0 이하 크기는 null(표만 폴백)', () => {
    expect(pngPixelSize(new Uint8Array(23))).toBeNull();
    const badSig = pngHeader(10, 10);
    badSig[0] = 0x00;
    expect(pngPixelSize(badSig)).toBeNull();
    const badType = pngHeader(10, 10);
    badType[12] = 0x00; // 'I' → 0 : IHDR 아님
    expect(pngPixelSize(badType)).toBeNull();
    expect(pngPixelSize(pngHeader(0, 10))).toBeNull();
  });
});

describe('buildBallotReportDoc — 결과 이미지 임베드(word/media 포함 분기)', () => {
  it('§3 포함/미포함 모델 모두 Document를 던지지 않고 만든다', () => {
    const base = buildBallotReportModel({ results: results(), generatedAtLabel: '2026-08-08 14:00' });
    expect(() => buildBallotReportDoc(base)).not.toThrow();
    const withTopics = buildBallotReportModel({
      results: results(),
      generatedAtLabel: '2026-08-08 14:00',
      topics: [{ topic: topic(), submission: submission() }],
    });
    expect(() => buildBallotReportDoc(withTopics)).not.toThrow();
  });

  it('이미지 맵이 없으면 패키지에 word/media가 없다 (표만)', async () => {
    const model = buildBallotReportModel({ results: results(), generatedAtLabel: 'x' });
    const buf = await Packer.toBuffer(buildBallotReportDoc(model));
    expect(buf.includes('word/media/')).toBe(false);
  });

  it('이미지 맵이 있으면 패키지에 word/media 이미지가 들어간다', async () => {
    const model = buildBallotReportModel({ results: results(), generatedAtLabel: 'x' });
    const itemImages = new Map<string, ArrayBuffer>([['i-1', png1x1()]]);
    const buf = await Packer.toBuffer(buildBallotReportDoc(model, { itemImages }));
    expect(buf.includes('word/media/')).toBe(true);
  });

  it('맵에 있어도 PNG가 아니면(크기 파싱 실패) 그 문항은 표만 — 이미지가 안 들어간다', async () => {
    const model = buildBallotReportModel({ results: results(), generatedAtLabel: 'x' });
    const notPng = new Uint8Array([1, 2, 3, 4]).buffer;
    const itemImages = new Map<string, ArrayBuffer>([['i-1', notPng]]);
    const buf = await Packer.toBuffer(buildBallotReportDoc(model, { itemImages }));
    expect(buf.includes('word/media/')).toBe(false);
  });
});
