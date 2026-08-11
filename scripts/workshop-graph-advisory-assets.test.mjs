import { expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  advisoryAssetSummary,
  parseGraphAdvisoryAssets,
  renderGraphAdvisoryAssets,
} from '../public/workshop-graph/graph-advisory-assets.js';

test('normalizes review-required recommendation candidates with minority and source provenance', () => {
  const assets = parseGraphAdvisoryAssets({
    recommendations: [{
      kind: 'recommendation_candidate',
      review_status: 'draft',
      rec_id: 'rec-1',
      title: '재생에너지 확대 조건 검토',
      summary: '참여자 발화를 바탕으로 만든 검토 후보입니다.',
      was_derived_from: ['utterance-1', 'utterance-2'],
      minority: [{
        minority_id: 'minority-1',
        title: '비용 부담 우려',
        text: '비용 완화 조건이 필요합니다.',
        cited_uids: ['utterance-3'],
      }],
    }],
    quality: {
      validity_label: 'official-5indicators',
      reliability: true,
      limitations_notice: '사람 검수 전 품질 신호입니다.',
      cited_uids: ['quality-source-1'],
    },
  });

  expect(assets.requiresHumanReview).toBe(true);
  expect(assets.recommendations).toEqual([{
    id: 'rec-1',
    title: '재생에너지 확대 조건 검토',
    summary: '참여자 발화를 바탕으로 만든 검토 후보입니다.',
    timeSpan: null,
    provenance: {
      sourceUids: ['utterance-1', 'utterance-2'],
      transcriptChunkIds: [],
      citedUids: [],
    },
    minorityConcerns: [{
      id: 'minority-1',
      title: '비용 부담 우려',
      text: '비용 완화 조건이 필요합니다.',
      provenance: {
        sourceUids: [],
        transcriptChunkIds: [],
        citedUids: ['utterance-3'],
      },
    }],
  }]);
  expect(assets.quality).toEqual({
    label: 'official-5indicators',
    sourceReliabilityFlag: true,
    limitationsNotice: '사람 검수 전 품질 신호입니다.',
    provenance: {
      sourceUids: [],
      transcriptChunkIds: [],
      citedUids: ['quality-source-1'],
    },
  });
});

test('rejects decision-like, uncited, and duplicate provenance inputs', () => {
  const base = {
    kind: 'recommendation_candidate',
    review_status: 'draft',
    rec_id: 'rec-1',
    title: '검토 후보',
    cited_uids: ['utterance-1'],
  };

  expect(() => parseGraphAdvisoryAssets({ recommendations: [{ ...base, kind: 'decision' }] }))
    .toThrow('Invalid recommendation candidate');
  const { kind: omittedKind, review_status: omittedReviewStatus, ...implicitCandidate } = base;
  expect(omittedKind).toBe('recommendation_candidate');
  expect(omittedReviewStatus).toBe('draft');
  expect(() => parseGraphAdvisoryAssets({ recommendations: [implicitCandidate] }))
    .toThrow('Invalid recommendation candidate');
  expect(() => parseGraphAdvisoryAssets({ recommendations: [{ ...base, cited_uids: [] }] }))
    .toThrow('Recommendation candidate requires cited sources');
  expect(() => parseGraphAdvisoryAssets({ recommendations: [{ ...base, cited_uids: ['utterance-1', 'utterance-1'] }] }))
    .toThrow('Duplicate cited source');
  expect(() => parseGraphAdvisoryAssets({ recommendations: [base, base] }))
    .toThrow('Duplicate recommendation id');
  expect(() => parseGraphAdvisoryAssets({
    recommendations: [{
      ...base,
      minority: [
        { minority_id: 'same-id', title: '첫 우려', text: '첫 우려 내용', cited_uids: ['utterance-2'] },
        { minority_id: 'same-id', title: '둘째 우려', text: '둘째 우려 내용', cited_uids: ['utterance-3'] },
      ],
    }],
  })).toThrow('Duplicate minority concern id');
  expect(() => parseGraphAdvisoryAssets({
    recommendations: [{
      ...base,
      minority: [{ title: '식별자 없는 우려', cited_uids: ['utterance-2'] }],
    }],
  })).toThrow('Invalid minority concern id');
  expect(() => parseGraphAdvisoryAssets({
    recommendations: [{
      ...base,
      minority: [{ minority_id: 'minority-1', title: '내용 없는 우려', cited_uids: ['utterance-2'] }],
    }],
  })).toThrow('Invalid minority concern text');
  expect(() => parseGraphAdvisoryAssets({
    recommendations: [{ ...base, cited_uids: ['raw transcript sentence with spaces'] }],
  })).toThrow('Invalid cited source');
  expect(() => parseGraphAdvisoryAssets({
    recommendations: [{ ...base, cited_uids: ['010-1234-5678'] }],
  })).toThrow('Invalid cited source');
  expect(() => parseGraphAdvisoryAssets({
    recommendations: [{
      ...base,
      cited_uids: [
        '6ba7b810-9dad-41d1-80b4-00c04fd430c8',
        '6BA7B810-9DAD-41D1-80B4-00C04FD430C8',
      ],
    }],
  })).toThrow('Duplicate cited source');
});

test('rejects ambiguous quality metadata instead of presenting it as a DQI signal', () => {
  expect(() => parseGraphAdvisoryAssets({ quality: { conclusion: 'internal extraction note' } }))
    .toThrow('Invalid quality signal');
  expect(() => parseGraphAdvisoryAssets({
    quality: { validity_label: 'official-5indicators', limitations_notice: '', cited_uids: ['quality-source-1'] },
  })).toThrow('Invalid quality limitations notice');
  expect(() => parseGraphAdvisoryAssets({
    quality: { validity_label: 'truth-score', limitations_notice: '검토 필요', cited_uids: ['quality-source-1'] },
  })).toThrow('Invalid quality signal');
  expect(() => parseGraphAdvisoryAssets({
    quality: { validity_label: 'review-signal', limitations_notice: '검토 필요' },
  })).toThrow('Quality signal requires cited sources');
});

test('treats absent advisory assets as an empty read-only model', () => {
  expect(parseGraphAdvisoryAssets({ recommendations: null })).toEqual({
    recommendations: [],
    quality: null,
    requiresHumanReview: false,
  });
});

test('presents candidates and quality as non-decisional review-required signals', () => {
  const assets = parseGraphAdvisoryAssets({
    recommendations: [{
      kind: 'recommendation_candidate',
      review_status: 'draft',
      rec_id: 'rec-1',
      title: '<검토 후보>',
      summary: '아직 결정이 아닙니다.',
      was_derived_from: ['source-1'],
      transcript_chunk_ids: ['chunk-1'],
      cited_uids: ['citation-1'],
      minority: [{
        minority_id: 'minority-1',
        title: '반대 우려',
        text: '비용 조건',
        cited_uids: ['source-2'],
      }],
    }],
    quality: {
      label: 'exploratory-text-metric',
      reliability: false,
      limitations_notice: '원문 맥락 검수가 필요합니다.',
      was_derived_from: ['quality-source-1'],
    },
  });

  expect(advisoryAssetSummary(assets)).toEqual({
    metaLabels: ['권고 후보 1건', '품질 신호'],
    buttonLabel: '권고 후보·품질 신호 1',
  });
  const html = renderGraphAdvisoryAssets(assets);
  expect(html).toContain('사람 검수 필요');
  expect(html).toContain('권고 후보');
  expect(html).toContain('품질 신호');
  expect(html).toContain('&lt;검토 후보&gt;');
  expect(html).toContain('소수 우려 1건');
  expect(html).toContain('반대 우려');
  expect(html).toContain('출처 UID 1건');
  expect(html).toContain('전사 chunk ID 1건');
  expect(html).toContain('인용 UID 1건');
  expect(html).not.toContain('합의·권고');
  expect(html).not.toContain('진실 점수');
});

test('wires normalized advisory assets into the production graph without blocking graph load', () => {
  const html = readFileSync('public/workshop-graph/index.html', 'utf8');

  expect(html).toContain("import { advisoryAssetSummary, parseGraphAdvisoryAssets, renderGraphAdvisoryAssets } from './graph-advisory-assets.js';");
  expect(html).toContain('parseGraphAdvisoryAssets(mt)');
  expect(html).toContain("console.error('Failed to parse graph advisory assets', error)");
  expect(html).toContain('OntologyChrome.updateAdvisory');
  expect(html).toContain('updateAssetsButton(advisoryAssets)');
  expect(html).toContain('renderGraphAdvisoryAssets(assets)');
  expect(html).toContain('currentMetaAssets = hasAssets ? assets : null');
  expect(html).toContain("side.dataset.content = 'advisory'");
  expect(html).toContain("side.dataset.content = 'overview'");
  expect(html).toContain("side.dataset.content = 'node'");
  expect(html).toContain("if (hasAssets && side?.dataset.content === 'advisory' && !side.classList.contains('collapsed'))");
  expect(html).toContain("else if (!hasAssets && side?.dataset.content === 'advisory')");
  expect(html).toContain("if (side.dataset.content === 'advisory' && !side.classList.contains('collapsed')) return;");
});
