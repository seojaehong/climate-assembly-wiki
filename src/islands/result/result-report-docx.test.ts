import { describe, expect, it } from 'vitest';
import { Packer } from 'docx';
import JSZip from 'jszip';
import {
  RESULT_REPORT_TITLE,
  buildResultReportDoc,
  buildResultReportModel,
  formatGeneratedAt,
  formatPublishedDate,
  resultReportBlob,
  resultReportFileName,
} from './result-report-docx';
import { buildResultView } from './result-view-logic';
import type { ResultGetResponse, ResultIssueRaw } from './result-view-logic';

function issue(over: Partial<ResultIssueRaw> = {}): ResultIssueRaw {
  return {
    id: over.id ?? 'i1',
    label: over.label ?? '쟁점',
    stance: over.stance ?? null,
    frequency_class: over.frequency_class ?? null,
    summary: over.summary ?? null,
    review_status: over.review_status ?? 'reviewed',
    origin: over.origin ?? undefined,
    topic_id: over.topic_id ?? 't1',
    consensus_denominator: 'consensus_denominator' in over ? over.consensus_denominator : 0,
    teams: over.teams ?? [],
    implementation: over.implementation ?? undefined,
    source_references: over.source_references ?? undefined,
  };
}

function response(issues: ResultIssueRaw[], over: Record<string, unknown> = {}): ResultGetResponse {
  return {
    scope: 'session',
    scope_id: 's1',
    title: '제5차 기후시민회의 — 에너지 전환 숙의',
    published_at: '2026-08-29T05:00:00.000Z',
    hitl_notice: 'AI는 초안을 만들고, 공개 여부와 최종 표현은 운영진이 결정합니다.',
    body: {
      scope: 'session',
      title: '제5차 기후시민회의 — 에너지 전환 숙의',
      consensus_rule: '합의도 분모 = cluster 기준.',
      issues,
      reviewed_count: issues.filter((i) => i.review_status === 'reviewed').length,
      unclassified_count: 3,
      generated_at: '2026-08-29T04:30:00.000Z',
      ...over,
    },
  };
}

function view(issues: ResultIssueRaw[], over: Record<string, unknown> = {}) {
  const v = buildResultView(response(issues, over));
  if (!v) throw new Error('view is null');
  return v;
}

describe('formatPublishedDate — 로컬 getter 기반(YYYY-MM-DD)', () => {
  it('ISO를 날짜로 찍는다', () => {
    // 2026-08-29T05:00Z 는 KST(+9)에서 08-29 14:00 → 로컬 날짜 08-29.
    expect(formatPublishedDate('2026-08-29T05:00:00.000Z')).toMatch(/^2026-08-\d{2}$/);
  });
  it('null·빈문자·잘못된 값은 —(NaN 흘리지 않음)', () => {
    expect(formatPublishedDate(null)).toBe('—');
    expect(formatPublishedDate('')).toBe('—');
    expect(formatPublishedDate('garbage')).toBe('—');
  });
});

describe('formatGeneratedAt — ballot 정본을 재수출한다', () => {
  it('자릿수를 0으로 채운다', () => {
    expect(formatGeneratedAt(new Date(2026, 7, 8, 9, 5))).toBe('2026-08-08 09:05');
  });
});

describe('resultReportFileName', () => {
  it('숙의결과보고서_<제목>_<YYYYMMDD>.docx 꼴로 만든다 (공백→밑줄)', () => {
    expect(resultReportFileName({ title: '제5차 회의', at: new Date(2026, 7, 29, 14, 32) })).toBe(
      '숙의결과보고서_제5차_회의_20260829.docx',
    );
  });
  it('경로 분리자·Windows 금지 문자를 걸러낸다', () => {
    const name = resultReportFileName({ title: 'A/B: "안"?', at: new Date(2026, 7, 29) });
    expect(name).not.toMatch(/[\\/:*?"<>|]/);
    expect(name.endsWith('_20260829.docx')).toBe(true);
  });
  it('제목이 전부 걸러지면 폴백을 쓴다', () => {
    expect(resultReportFileName({ title: '///', at: new Date(2026, 7, 29) })).toBe(
      '숙의결과보고서_숙의결과_20260829.docx',
    );
  });
  it('아주 긴 제목은 60자에서 자른다', () => {
    const name = resultReportFileName({ title: '가'.repeat(200), at: new Date(2026, 7, 29) });
    expect(name).toContain('가'.repeat(60));
    expect(name).not.toContain('가'.repeat(61));
  });
});

describe('buildResultReportModel — 표지·§1 개요', () => {
  it('표지에 보고서명·주제·공개일·검수 배지를 담는다', () => {
    const model = buildResultReportModel({
      view: view([issue({ frequency_class: 'consensus' })]),
      generatedAtLabel: '2026-08-29 14:00',
    });
    expect(model.title).toBe(RESULT_REPORT_TITLE);
    expect(model.subject).toBe('제5차 기후시민회의 — 에너지 전환 숙의');
    expect(model.generatedAtLabel).toBe('2026-08-29 14:00');
    expect(model.publishedAtLabel).toMatch(/^2026-08-\d{2}$/);
    expect(model.reviewBadge).toBe('검수 완료 1 / 전체 1');
  });

  it('§1 개요 — 대상 스코프·쟁점 수·참여 조·합의 쟁점 수·미분류 수', () => {
    const model = buildResultReportModel({
      view: view([
        issue({ id: 'i1', frequency_class: 'consensus', teams: ['1분과 1조', '1분과 2조'] }),
        issue({ id: 'i2', frequency_class: 'majority', teams: ['1분과 1조'] }),
      ]),
      generatedAtLabel: 'x',
    });
    expect(model.overview).toEqual([
      { label: '대상 스코프', value: '세션 단위' },
      { label: '쟁점 수', value: '2개' },
      { label: '참여 조', value: '2개' },
      { label: '합의 쟁점 수', value: '1개' },
      { label: '미분류 수', value: '3건' },
      { label: '이행 정보 등록', value: '0 / 2' },
    ]);
  });
});

describe('buildResultReportModel — §2 쟁점별', () => {
  it('빈도·방향 한국어 라벨·요약·제기 조·원문 군집·검수 상태를 담는다', () => {
    const model = buildResultReportModel({
      view: view([
        issue({
          id: 'i1',
          label: '석탄 감축',
          frequency_class: 'consensus',
          stance: 'pro',
          summary: '대다수 조가 지지',
          consensus_denominator: 4,
          teams: ['1분과 1조', '1분과 2조'],
          review_status: 'reviewed',
        }),
      ]),
      generatedAtLabel: 'x',
    });
    const sec = model.issues[0];
    expect(sec.label).toBe('석탄 감축');
    expect(sec.frequencyLabel).toBe('합의');
    expect(sec.stanceLabel).toBe('찬성');
    expect(sec.summary).toBe('대다수 조가 지지');
    expect(sec.teams).toEqual(['1분과 1조', '1분과 2조']);
    expect(sec.clusterLabel).toBe('원문 군집 4건');
    expect(sec.reviewLabel).toBe('검수 완료');
    expect(sec.reviewDescription).toBe('운영진이 원문과 대조해 공개 가능한 표현으로 확정했습니다.');
    expect(sec.reviewForeground).toBe('#2F6F25');
    expect(sec.reviewBackground).toBe('#E3F1E6');
    expect(sec.reviewBorder).toBe('#2F6F25');
  });

  it('요약 없음·미검수 AI 초안·빈도/방향 없음은 폴백 라벨로 적는다', () => {
    const model = buildResultReportModel({
      view: view([issue({ id: 'i1', review_status: 'draft', summary: null, consensus_denominator: null })]),
      generatedAtLabel: 'x',
    });
    const sec = model.issues[0];
    expect(sec.frequencyLabel).toBe('—');
    expect(sec.stanceLabel).toBe('—');
    expect(sec.summary).toBe('요약이 아직 작성되지 않았습니다.');
    expect(sec.clusterLabel).toBe('—');
    expect(sec.reviewLabel).toBe('검수 대기 · 초안');
    expect(sec.reviewDescription).toContain('출처 정보가 없는 초안');
    expect(sec.reviewForeground).toBe('#8A4F08');
    expect(sec.reviewBackground).toBe('#FEF6E7');
    expect(sec.reviewBorder).toBe('#F5A623');
  });

  it('사람 수정본과 보관 상태의 설명·톤을 공용 계약 그대로 보존한다', () => {
    const model = buildResultReportModel({
      view: view([
        issue({ id: 'human', review_status: 'draft', origin: 'human' }),
        issue({ id: 'archived', review_status: 'archived', origin: 'ai' }),
      ]),
      generatedAtLabel: 'x',
    });
    const human = model.issues.find((item) => item.label === '쟁점' && item.reviewLabel.includes('사람'));
    const archived = model.issues.find((item) => item.reviewLabel === '보관');

    expect(human).toMatchObject({
      reviewLabel: '검수 대기 · 사람 수정본',
      reviewDescription: '사람이 수정했지만 변경 후 원문 재검수가 필요한 초안입니다.',
      reviewForeground: '#B91C1C',
      reviewBackground: '#FDECEC',
      reviewBorder: '#B91C1C',
    });
    expect(archived).toMatchObject({
      reviewLabel: '보관',
      reviewDescription: '현재 공개 및 검수 대상에서 제외된 쟁점입니다.',
      reviewForeground: '#5A6B73',
      reviewBackground: '#ECEFF1',
      reviewBorder: '#6B7D88',
    });
  });

  it('이행 상태·설명·책임기관·갱신일·근거 URL을 공용 모델에 보존한다', () => {
    const model = buildResultReportModel({
      view: view([issue({
        implementation: {
          status: 'implemented',
          responsible_body: '기후정책 담당기관',
          updated_at: '2026-08-12T00:00:00.000Z',
          summary: '관계 기관이 이행 완료 근거를 공개했습니다.',
          evidence_url: 'https://example.org/implementation-evidence',
        },
      })]),
      generatedAtLabel: 'x',
    });

    expect(model.issues[0]).toMatchObject({
      implementationLabel: '이행 완료',
      implementationDescription: '관계 기관의 공개 근거에서 이행 완료를 확인했습니다.',
      implementationResponsibleBody: '기후정책 담당기관',
      implementationSummary: '관계 기관이 이행 완료 근거를 공개했습니다.',
      implementationEvidenceUrl: 'https://example.org/implementation-evidence',
    });
    expect(model.issues[0].implementationUpdatedAtLabel).toMatch(/^2026-08-\d{2}$/);
  });

  it('§2는 랭킹 순서(제기 조 많은 순)로 싣는다', () => {
    const model = buildResultReportModel({
      view: view([
        issue({ id: 'i1', label: '적음', teams: ['A'] }),
        issue({ id: 'i2', label: '많음', teams: ['A', 'B', 'C'] }),
      ]),
      generatedAtLabel: 'x',
    });
    expect(model.issues.map((i) => i.label)).toEqual(['많음', '적음']);
  });

  it('공개검수된 원문과 쟁점·원문 bookmark를 보고서 모델에 보존한다', () => {
    const model = buildResultReportModel({
      view: view([issue({
        id: 'issue-reviewed',
        label: '대중교통 확대',
        source_references: [{
          reference_key: 'public-source-001',
          team_name: '1분과 1조',
          ordinal: 1,
          kind: 'core',
          excerpt: '대중교통 노선을 확대해야 합니다.',
          content_sha256: 'a'.repeat(64),
          publication_status: 'reviewed',
          reviewed_at: '2026-08-26T00:00:00.000Z',
          reviewer_role: 'hq',
        }],
      })]),
      generatedAtLabel: 'x',
    });

    expect(model.issues[0]).toMatchObject({
      issueBookmark: 'result_issue_1',
      sourceReferencesValid: true,
      sourceReferences: [{
        sourceBookmark: 'result_source_1_1',
        teamName: '1분과 1조',
        ordinal: 1,
        kindLabel: '핵심',
        excerpt: '대중교통 노선을 확대해야 합니다.',
        contentSha256: 'a'.repeat(64),
        reviewedAtLabel: expect.stringMatching(/^2026-08-\d{2}$/),
        reviewerRoleLabel: 'HQ',
      }],
    });
    expect(model.sourceReferenceCount).toBe(1);
  });

  it('미검수 원문은 본문을 버리고 확인 필요 상태만 보고서 모델에 남긴다', () => {
    const model = buildResultReportModel({
      view: view([issue({
        id: 'issue-draft',
        review_status: 'draft',
        source_references: [{
          reference_key: 'public-source-001',
          team_name: '1분과 1조',
          ordinal: 1,
          kind: 'core',
          excerpt: '문서에 노출되면 안 되는 미검수 원문',
          content_sha256: 'a'.repeat(64),
          publication_status: 'reviewed',
          reviewed_at: '2026-08-26T00:00:00.000Z',
          reviewer_role: 'hq',
        }],
      })]),
      generatedAtLabel: 'x',
    });

    expect(model.issues[0]).toMatchObject({
      sourceReferencesValid: false,
      sourceReferences: [],
    });
    expect(JSON.stringify(model)).not.toContain('문서에 노출되면 안 되는 미검수 원문');
    expect(model.sourceReferenceCount).toBe(0);
  });
});

describe('buildResultReportModel — §3 매트릭스·§4 정리', () => {
  it('조·쟁점이 있으면 매트릭스를 만든다(세로 쟁점 × 가로 조)', () => {
    const model = buildResultReportModel({
      view: view([
        issue({ id: 'i1', label: '쟁점A', teams: ['1분과 1조'] }),
        issue({ id: 'i2', label: '쟁점B', teams: ['1분과 1조', '1분과 2조'] }),
      ]),
      generatedAtLabel: 'x',
    });
    expect(model.matrix).not.toBeNull();
    expect(model.matrix!.teams).toEqual(['1분과 1조', '1분과 2조']);
    const rowA = model.matrix!.rows.find((r) => r.label === '쟁점A')!;
    expect(rowA.cells).toEqual([true, false]);
  });

  it('제기 조가 하나도 없으면 §3 매트릭스를 만들지 않는다(빈 표 방지)', () => {
    const model = buildResultReportModel({
      view: view([issue({ id: 'i1', teams: [] })]),
      generatedAtLabel: 'x',
    });
    expect(model.matrix).toBeNull();
  });

  it('§4 — 합의 쟁점은 함께 확인된 것, 나머지는 더 논의할 것으로 가른다', () => {
    const model = buildResultReportModel({
      view: view([
        issue({ id: 'i1', label: '합의점', frequency_class: 'consensus' }),
        issue({ id: 'i2', label: '미결점', frequency_class: 'majority' }),
      ]),
      generatedAtLabel: 'x',
    });
    expect(model.takeaways.consensus).toEqual(['합의점']);
    expect(model.takeaways.further).toEqual(['미결점']);
    expect(model.takeaways.nextSteps).toContain('중간 정리');
  });

  it('하단에 HITL 문구와 분모 규칙을 담는다', () => {
    const model = buildResultReportModel({
      view: view([issue({ frequency_class: 'consensus' })]),
      generatedAtLabel: 'x',
    });
    expect(model.hitlNotice).toContain('운영진이 결정합니다');
    expect(model.consensusRule).toBe('합의도 분모 = cluster 기준.');
  });
});

describe('buildResultReportDoc — 문서 생성(이미지 없이 표만)', () => {
  it('일반 모델을 던지지 않고 만든다', () => {
    const model = buildResultReportModel({
      view: view([
        issue({ id: 'i1', label: '쟁점A', frequency_class: 'consensus', stance: 'pro', teams: ['1분과 1조'] }),
        issue({ id: 'i2', label: '쟁점B', frequency_class: 'majority', teams: ['1분과 1조', '1분과 2조'] }),
      ]),
      generatedAtLabel: '2026-08-29 14:00',
    });
    expect(() => buildResultReportDoc(model)).not.toThrow();
  });

  it('이미지가 없으므로 패키지에 word/media가 없다 (표만)', async () => {
    const model = buildResultReportModel({
      view: view([issue({ id: 'i1', frequency_class: 'consensus', teams: ['1분과 1조'] })]),
      generatedAtLabel: 'x',
    });
    const buf = await Packer.toBuffer(buildResultReportDoc(model));
    expect(buf.includes('word/media/')).toBe(false);
  });

  it('원문 필드가 없는 기존 payload는 기존 §3 매트릭스·§4 정리 번호를 유지한다', async () => {
    const model = buildResultReportModel({
      view: view([issue({ id: 'i1', frequency_class: 'consensus', teams: ['1분과 1조'] })]),
      generatedAtLabel: 'x',
    });
    const buf = await Packer.toBuffer(buildResultReportDoc(model));
    const zip = await JSZip.loadAsync(buf);
    const documentXml = await zip.file('word/document.xml')?.async('string');

    expect(model.sourceReferenceCount).toBe(0);
    expect(documentXml).toContain('3. 조 × 쟁점 커버리지');
    expect(documentXml).toContain('4. 정리');
    expect(documentXml).not.toContain('공개 검수된 근거 원문');
  });

  it('공용 HITL 설명과 상태별 글자·배경·경계 색상을 document.xml에 직렬화한다', async () => {
    const model = buildResultReportModel({
      view: view([issue({ id: 'archived', review_status: 'archived', origin: 'ai' })]),
      generatedAtLabel: 'x',
    });
    const buf = await Packer.toBuffer(buildResultReportDoc(model));
    const zip = await JSZip.loadAsync(buf);
    const documentXml = await zip.file('word/document.xml')?.async('string');

    expect(documentXml).toBeDefined();
    expect(documentXml).toContain('현재 공개 및 검수 대상에서 제외된 쟁점입니다.');
    expect(documentXml).toContain('w:color w:val="5A6B73"');
    expect(documentXml).toContain('w:shd w:fill="ECEFF1"');
    expect(documentXml).toContain('w:color="6B7D88"');
  });

  it('이행 상태와 공개 근거를 document.xml에 직렬화한다', async () => {
    const model = buildResultReportModel({
      view: view([issue({
        implementation: {
          status: 'not_pursued',
          responsible_body: '기후정책 담당기관',
          updated_at: '2026-08-12T00:00:00.000Z',
          summary: '대안 정책을 우선 추진한다는 사유를 공개했습니다.',
          evidence_url: 'https://example.org/not-pursued-evidence',
        },
      })]),
      generatedAtLabel: 'x',
    });
    const buf = await Packer.toBuffer(buildResultReportDoc(model));
    const zip = await JSZip.loadAsync(buf);
    const documentXml = await zip.file('word/document.xml')?.async('string');

    expect(documentXml).toContain('미이행 사유 공개');
    expect(documentXml).toContain('대안 정책을 우선 추진한다는 사유를 공개했습니다.');
    expect(documentXml).toContain('https://example.org/not-pursued-evidence');
  });

  it('승인 원문을 쟁점과 왕복하는 DOCX bookmark·internal hyperlink로 직렬화한다', async () => {
    const model = buildResultReportModel({
      view: view([issue({
        id: 'issue-reviewed',
        label: '대중교통 확대',
        source_references: [{
          reference_key: 'public-source-001',
          team_name: '1분과 1조',
          ordinal: 1,
          kind: 'core',
          excerpt: '대중교통 노선을 확대해야 합니다.',
          content_sha256: 'a'.repeat(64),
          publication_status: 'reviewed',
          reviewed_at: '2026-08-26T00:00:00.000Z',
          reviewer_role: 'hq',
        }],
      })]),
      generatedAtLabel: 'x',
    });
    const buf = await Packer.toBuffer(buildResultReportDoc(model));
    const zip = await JSZip.loadAsync(buf);
    const documentXml = await zip.file('word/document.xml')?.async('string');

    expect(documentXml).toContain('공개 검수된 근거 원문');
    expect(documentXml).toContain('대중교통 노선을 확대해야 합니다.');
    expect(documentXml).toContain('w:name="result_issue_1"');
    expect(documentXml).toContain('w:name="result_source_1_1"');
    expect(documentXml).toContain('w:anchor="result_source_1_1"');
    expect(documentXml).toContain('w:anchor="result_issue_1"');
    expect(documentXml).toContain('원문 근거 1건으로 이동');
    expect(documentXml).toContain('쟁점으로 돌아가기');
    expect(documentXml).toContain('4. 정리');
    expect(documentXml).not.toContain('5. 정리');
  });

  it('잘못된 원문 묶음은 DOCX에서 원문 없이 확인 필요 안내만 직렬화한다', async () => {
    const model = buildResultReportModel({
      view: view([issue({
        review_status: 'draft',
        source_references: [{
          reference_key: 'public-source-001',
          team_name: '1분과 1조',
          ordinal: 1,
          kind: 'core',
          excerpt: '문서에 노출되면 안 되는 미검수 원문',
          content_sha256: 'a'.repeat(64),
          publication_status: 'reviewed',
          reviewed_at: '2026-08-26T00:00:00.000Z',
          reviewer_role: 'hq',
        }],
      })]),
      generatedAtLabel: 'x',
    });
    const buf = await Packer.toBuffer(buildResultReportDoc(model));
    const zip = await JSZip.loadAsync(buf);
    const documentXml = await zip.file('word/document.xml')?.async('string');

    expect(documentXml).toContain('근거 원문 공개 정보 확인 필요');
    expect(documentXml).not.toContain('문서에 노출되면 안 되는 미검수 원문');
    expect(documentXml).not.toContain('공개 검수된 근거 원문');
  });

  it('퇴화 모델(쟁점 0·조 0·공개일 null·요약 없음)도 표만으로 정상 생성된다', async () => {
    const degenerate = buildResultView(response([], { reviewed_count: 0 } as Record<string, unknown>));
    // reviewed_count=0 이라도 뷰모델은 만들어진다(공개 게이트는 DB에서 이미 통과).
    if (!degenerate) throw new Error('view is null');
    // published_at null 로 덮어써 퇴화 케이스 확인.
    const model = buildResultReportModel({
      view: { ...degenerate, publishedAt: null },
      generatedAtLabel: 'x',
    });
    expect(model.matrix).toBeNull();
    expect(model.issues).toHaveLength(0);
    expect(model.publishedAtLabel).toBe('—');
    expect(() => buildResultReportDoc(model)).not.toThrow();
    const buf = await Packer.toBuffer(buildResultReportDoc(model));
    expect(buf.includes('word/media/')).toBe(false);
    expect(buf.byteLength).toBeGreaterThan(0);
  });

  it('resultReportBlob 은 Blob 을 돌려준다', async () => {
    const model = buildResultReportModel({
      view: view([issue({ frequency_class: 'consensus' })]),
      generatedAtLabel: 'x',
    });
    const blob = await resultReportBlob(model);
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBeGreaterThan(0);
  });
});
