import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { linkSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import {
  buildPlatformAnalysisImportPlan,
  sealPlatformAnalysisImportPlan,
  validatePlatformAnalysisImportPrivateInputPath,
  validatePlatformAnalysisImportPrivateOutputPath,
  verifyPlatformAnalysisImportPlan,
} from '../platform-analysis-import.mjs';

const TOPIC_ID = '11111111-1111-4111-8111-111111111111';
const minoritySourceHash = (value) => createHash('sha256').update(value, 'utf8').digest('hex');
const canonicalValue = (value) => {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalValue(value[key])]));
  }
  return value;
};
const recommendationSourceHash = (value) => minoritySourceHash(JSON.stringify(canonicalValue(value)));

test('keeps raw analysis inputs and review plans outside the repository', () => {
  const directory = mkdtempSync(join(tmpdir(), 'platform-analysis-private-paths-'));
  const externalInput = join(directory, 'analysis.json');
  const externalOutput = join(directory, 'plan.json');
  const hardLinkedOutput = join(directory, 'hard-linked-plan.json');
  const repositoryInput = fileURLToPath(new URL('../platform-analysis-import.mjs', import.meta.url));
  const repositoryLink = join(directory, 'repository-link');
  try {
    writeFileSync(externalInput, '{}', 'utf8');
    symlinkSync(dirname(repositoryInput), repositoryLink, process.platform === 'win32' ? 'junction' : 'dir');

    expect(validatePlatformAnalysisImportPrivateInputPath(externalInput, 'analysis')).toBe(externalInput);
    expect(validatePlatformAnalysisImportPrivateOutputPath(externalOutput)).toBe(externalOutput);
    linkSync(externalInput, hardLinkedOutput);
    expect(() => validatePlatformAnalysisImportPrivateOutputPath(hardLinkedOutput))
      .toThrow('unavailable');
    expect(() => validatePlatformAnalysisImportPrivateInputPath(repositoryInput, 'analysis'))
      .toThrow('outside the repository');
    expect(() => validatePlatformAnalysisImportPrivateInputPath(
      join(repositoryLink, 'platform-analysis-import.mjs'),
      'provenance map',
    )).toThrow('outside the repository');
    expect(() => validatePlatformAnalysisImportPrivateInputPath(
      join(directory, 'missing.json'),
      'analysis',
    )).toThrow('unavailable');
    expect(() => validatePlatformAnalysisImportPrivateOutputPath(
      join(dirname(repositoryInput), 'private-plan.json'),
    )).toThrow('outside the repository');
    expect(() => validatePlatformAnalysisImportPrivateOutputPath(
      join(repositoryLink, 'private-plan.json'),
    )).toThrow('outside the repository');

    const cli = spawnSync(process.execPath, [
      repositoryInput,
      '--analysis', repositoryInput,
      '--provenance-map', externalInput,
      '--output', externalOutput,
    ], { encoding: 'utf8' });
    expect(cli.status).toBe(1);
    expect(cli.stderr).toContain('analysis input must remain outside the repository');
    expect(cli.stderr).not.toContain(repositoryInput);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('builds review-required issue drafts with source provenance and minority concerns', () => {
  const plan = buildPlatformAnalysisImportPlan({
    topicId: TOPIC_ID,
    analysis: {
      meta: {
        recommendations: [{
          rec_id: 'rec-1',
          title: '재생에너지 비중 확대',
          summary: '확대 필요성이 반복 제기됐다.',
          stance: 'proposal',
          frequency_class: 'consensus',
          was_derived_from: ['utterance-1', 'utterance-2'],
          minority: [{
            minority_id: 'minority-1',
            title: '전기요금 부담 우려',
            text: '비용 부담 완화 조건이 필요하다.',
            cited_uids: ['utterance-3'],
          }],
        }],
        quality: {
          validity_label: 'official-5indicators',
          reliability: true,
          limitations_notice: '모더레이터 검토 전 품질 신호입니다.',
        },
      },
    },
    sourceMappings: [
      { sourceUid: 'utterance-1', itemId: '21111111-1111-4111-8111-111111111111', clusterId: '31111111-1111-4111-8111-111111111111' },
      { sourceUid: 'utterance-2', itemId: '22111111-1111-4111-8111-111111111111', clusterId: '31111111-1111-4111-8111-111111111111' },
      { sourceUid: 'utterance-3', itemId: '23111111-1111-4111-8111-111111111111', clusterId: null },
    ],
  });

  expect(plan).toMatchObject({
    schemaVersion: 1,
    topicId: TOPIC_ID,
    dryRun: true,
    databaseMutationExecuted: false,
    requiresHumanReview: true,
    qualityContext: {
      label: 'official-5indicators',
      sourceReliabilityFlag: true,
      limitationsNotice: '모더레이터 검토 전 품질 신호입니다.',
    },
  });
  expect(plan.candidates).toHaveLength(2);
  expect(plan.candidates[0]).toMatchObject({
    externalId: 'rec-1',
    parentExternalId: null,
    issue: {
      label: '재생에너지 비중 확대',
      stance: 'proposal',
      frequencyClass: 'consensus',
      origin: 'ai',
      reviewStatus: 'draft',
    },
    provenance: { citedUids: ['utterance-1', 'utterance-2'] },
  });
  expect(plan.candidates[0].links.flatMap((link) => link.sourceUids)).toEqual(['utterance-1', 'utterance-2']);
  expect(plan.candidates[1]).toMatchObject({
    externalId: 'rec-1:minority-1',
    parentExternalId: 'rec-1',
    issue: {
      label: '전기요금 부담 우려',
      stance: 'concern',
      frequencyClass: 'minority',
      origin: 'ai',
      reviewStatus: 'draft',
    },
    provenance: { citedUids: ['utterance-3'] },
  });
});

test('adapts the real analysis-core recommendation shape only with explicit candidate mappings', () => {
  const recommendation = {
    rec_id: 'rec_0',
    title: '',
    proposal_id: 'Proposal_000',
    was_derived_from: ['260829/A조/토론1/c000s0000'],
    time_span: { start: 12.5, end: 30.0 },
    minority: ['전환 비용과 지역 부담을 함께 검토해야 합니다.'],
  };
  const plan = buildPlatformAnalysisImportPlan({
    topicId: TOPIC_ID,
    analysis: { recommendations: [recommendation] },
    sourceMappings: [
      {
        sourceUid: '260829/A조/토론1/c000s0000',
        transcriptChunkId: 'chunk-main',
        itemId: '21111111-1111-4111-8111-111111111111',
        clusterId: null,
      },
      {
        sourceUid: '260829/A조/토론1/c001s0000',
        transcriptChunkId: 'chunk-minority',
        itemId: '22111111-1111-4111-8111-111111111111',
        clusterId: null,
      },
    ],
    provenanceSchemaVersion: 2,
    candidateMappings: [{
      recommendationId: 'rec_0',
      title: '재생에너지 전환 조건 검토',
      sourceRecommendationSha256: recommendationSourceHash(recommendation),
      minorityMappings: [{
        index: 0,
        minorityId: 'minority-cost',
        title: '전환 비용·지역 부담 우려',
        sourceTextSha256: minoritySourceHash('전환 비용과 지역 부담을 함께 검토해야 합니다.'),
        citedUids: ['260829/A조/토론1/c001s0000'],
      }],
    }],
  });

  expect(plan.candidates).toHaveLength(2);
  expect(plan.candidates[0]).toMatchObject({
    externalId: 'rec_0',
    issue: { label: '재생에너지 전환 조건 검토', reviewStatus: 'draft' },
    provenance: {
      citedUids: ['260829/A조/토론1/c000s0000'],
      timeSpan: { start: 12.5, end: 30.0 },
      candidateMappingApplied: true,
      sourceRecommendationSha256: recommendationSourceHash(recommendation),
    },
  });
  expect(plan.candidates[1]).toMatchObject({
    externalId: 'rec_0:minority-cost',
    issue: {
      label: '전환 비용·지역 부담 우려',
      summary: '전환 비용과 지역 부담을 함께 검토해야 합니다.',
      stance: 'concern',
      frequencyClass: 'minority',
      reviewStatus: 'draft',
    },
    provenance: {
      citedUids: ['260829/A조/토론1/c001s0000'],
      candidateMappingApplied: true,
      minoritySourceTextSha256: minoritySourceHash('전환 비용과 지역 부담을 함께 검토해야 합니다.'),
    },
  });
});

test('creates and verifies an analysis-core import plan through provenance map schema v2', () => {
  const directory = mkdtempSync(join(tmpdir(), 'platform-analysis-core-import-'));
  try {
    const analysisPath = join(directory, 'analysis.json');
    const mappingPath = join(directory, 'provenance.json');
    const outputPath = join(directory, 'plan.json');
    const recommendation = {
      rec_id: 'rec_0', title: '', was_derived_from: ['source-main'],
      time_span: { start: 1.0, end: 4.0 }, minority: ['비용 우려'],
    };
    writeFileSync(analysisPath, JSON.stringify({ recommendations: [recommendation] }), 'utf8');
    writeFileSync(mappingPath, JSON.stringify({
      schemaVersion: 2,
      topicId: TOPIC_ID,
      sourceMappings: [
        {
          sourceUid: 'source-main', transcriptChunkId: 'chunk-main',
          itemId: '21111111-1111-4111-8111-111111111111', clusterId: null,
        },
        {
          sourceUid: 'source-minority', transcriptChunkId: 'chunk-minority',
          itemId: '22111111-1111-4111-8111-111111111111', clusterId: null,
        },
      ],
      candidateMappings: [{
        recommendationId: 'rec_0', title: '재생에너지 조건 검토',
        sourceRecommendationSha256: recommendationSourceHash(recommendation),
        minorityMappings: [{
          index: 0,
          minorityId: 'minority-cost',
          title: '비용 우려',
          sourceTextSha256: minoritySourceHash('비용 우려'),
          citedUids: ['source-minority'],
        }],
      }],
    }), 'utf8');

    const modulePath = fileURLToPath(new URL('../platform-analysis-import.mjs', import.meta.url));
    const created = spawnSync(process.execPath, [
      modulePath, '--analysis', analysisPath, '--provenance-map', mappingPath, '--output', outputPath,
    ], { encoding: 'utf8' });
    expect(created.status).toBe(0);
    expect(created.stdout).toContain('2 candidates; database mutation: false');
    const verified = spawnSync(process.execPath, [
      modulePath, '--analysis', analysisPath, '--provenance-map', mappingPath, '--verify-plan', outputPath,
    ], { encoding: 'utf8' });
    expect(verified.status).toBe(0);
    expect(verified.stdout).toContain('2 candidates; database mutation: false');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('applies schema v2 provenance rules even when candidate mappings are empty', () => {
  const analysis = {
    recommendations: [{
      rec_id: 'rec-titled',
      title: '기존 제목 후보',
      cited_uids: ['source-main'],
      time_span: { start: 2, end: 5 },
      minority: [{
        minority_id: 'minority-1',
        title: '기존 소수 우려',
        cited_uids: ['source-minority'],
      }],
    }],
  };
  const withoutChunks = [
    { sourceUid: 'source-main', itemId: '21111111-1111-4111-8111-111111111111', clusterId: null },
    { sourceUid: 'source-minority', itemId: '22111111-1111-4111-8111-111111111111', clusterId: null },
  ];
  expect(() => buildPlatformAnalysisImportPlan({
    topicId: TOPIC_ID,
    analysis,
    sourceMappings: withoutChunks,
    candidateMappings: [],
    provenanceSchemaVersion: 2,
  })).toThrow('Invalid transcriptChunkId');

  const plan = buildPlatformAnalysisImportPlan({
    topicId: TOPIC_ID,
    analysis,
    sourceMappings: withoutChunks.map((mapping, index) => ({
      ...mapping,
      transcriptChunkId: index === 0 ? 'chunk-main' : 'chunk-minority',
    })),
    candidateMappings: [],
    provenanceSchemaVersion: 2,
  });
  expect(plan.candidates[0].provenance).toMatchObject({ timeSpan: { start: 2, end: 5 } });
  expect(plan.candidates[0].provenance.sources[0].transcriptChunkId).toBe('chunk-main');
});

test('fails closed when analysis-core candidate mappings are missing or do not match', () => {
  const sourceMappings = [
    {
      sourceUid: 'source-main', transcriptChunkId: 'chunk-main',
      itemId: '21111111-1111-4111-8111-111111111111', clusterId: null,
    },
    {
      sourceUid: 'source-minority', transcriptChunkId: 'chunk-minority',
      itemId: '22111111-1111-4111-8111-111111111111', clusterId: null,
    },
  ];
  const recommendation = {
    rec_id: 'rec_0', title: '', was_derived_from: ['source-main'], minority: ['비용 우려'],
  };
  expect(() => buildPlatformAnalysisImportPlan({
    topicId: TOPIC_ID, analysis: { recommendations: [recommendation] }, sourceMappings,
  })).toThrow('Invalid issue label');
  expect(() => buildPlatformAnalysisImportPlan({
    topicId: TOPIC_ID,
    analysis: { recommendations: [{ ...recommendation, title: '검토 후보' }] },
    sourceMappings,
  })).toThrow('String minority concern requires a candidate mapping');
  expect(() => buildPlatformAnalysisImportPlan({
    topicId: TOPIC_ID,
    analysis: { recommendations: [recommendation] },
    sourceMappings,
    provenanceSchemaVersion: 2,
    candidateMappings: [{
      recommendationId: 'rec_0', title: '검토 후보',
      sourceRecommendationSha256: recommendationSourceHash(recommendation),
      minorityMappings: [
        {
          index: 0,
          minorityId: 'minority-cost',
          title: '비용 우려',
          sourceTextSha256: minoritySourceHash('비용 우려'),
          citedUids: ['source-minority'],
        },
        {
          index: 1,
          minorityId: 'minority-unused',
          title: '없는 우려',
          sourceTextSha256: minoritySourceHash('없는 우려'),
          citedUids: ['source-minority'],
        },
      ],
    }],
  })).toThrow('Unused minority mapping');
  expect(() => buildPlatformAnalysisImportPlan({
    topicId: TOPIC_ID,
    analysis: { recommendations: [recommendation] },
    sourceMappings,
    provenanceSchemaVersion: 2,
    candidateMappings: [{
      recommendationId: 'rec_0',
      title: '검토 후보',
      sourceRecommendationSha256: recommendationSourceHash(recommendation),
      minorityMappings: [{
        index: 0,
        minorityId: 'minority-cost',
        title: '비용 우려',
        sourceTextSha256: minoritySourceHash('다른 우려'),
        citedUids: ['source-minority'],
      }],
    }],
  })).toThrow('Minority mapping source text mismatch');
  expect(() => buildPlatformAnalysisImportPlan({
    topicId: TOPIC_ID,
    analysis: { recommendations: [{ ...recommendation, time_span: { start: 3, end: 2 } }] },
    sourceMappings,
    provenanceSchemaVersion: 2,
    candidateMappings: [{
      recommendationId: 'rec_0',
      title: '검토 후보',
      sourceRecommendationSha256: recommendationSourceHash({ ...recommendation, time_span: { start: 3, end: 2 } }),
      minorityMappings: [{
        index: 0,
        minorityId: 'minority-cost',
        title: '비용 우려',
        sourceTextSha256: minoritySourceHash('비용 우려'),
        citedUids: ['source-minority'],
      }],
    }],
  })).toThrow('Invalid recommendation time span');
  expect(() => buildPlatformAnalysisImportPlan({
    topicId: TOPIC_ID,
    analysis: { recommendations: [{ ...recommendation, time_span: { start: 1, end: 2 } }] },
    sourceMappings,
    provenanceSchemaVersion: 2,
    candidateMappings: [{
      recommendationId: 'rec_0',
      title: '검토 후보',
      sourceRecommendationSha256: recommendationSourceHash(recommendation),
      minorityMappings: [{
        index: 0,
        minorityId: 'minority-cost',
        title: '비용 우려',
        sourceTextSha256: minoritySourceHash('비용 우려'),
        citedUids: ['source-minority'],
      }],
    }],
  })).toThrow('Candidate mapping source recommendation mismatch');
  const blankMinorityRecommendation = { ...recommendation, minority: ['   '] };
  expect(() => buildPlatformAnalysisImportPlan({
    topicId: TOPIC_ID,
    analysis: { recommendations: [blankMinorityRecommendation] },
    sourceMappings,
    provenanceSchemaVersion: 2,
    candidateMappings: [{
      recommendationId: 'rec_0',
      title: '검토 후보',
      sourceRecommendationSha256: recommendationSourceHash(blankMinorityRecommendation),
      minorityMappings: [{
        index: 0,
        minorityId: 'minority-cost',
        title: '비용 우려',
        sourceTextSha256: minoritySourceHash('   '),
        citedUids: ['source-minority'],
      }],
    }],
  })).toThrow('Invalid minority concern');
  expect(() => buildPlatformAnalysisImportPlan({
    topicId: TOPIC_ID,
    analysis: { recommendations: [recommendation] },
    sourceMappings: sourceMappings.map(({ transcriptChunkId, ...mapping }, index) => (
      index === 0 ? mapping : { transcriptChunkId, ...mapping }
    )),
    provenanceSchemaVersion: 2,
    candidateMappings: [{
      recommendationId: 'rec_0',
      title: '검토 후보',
      sourceRecommendationSha256: recommendationSourceHash(recommendation),
      minorityMappings: [{
        index: 0,
        minorityId: 'minority-cost',
        title: '비용 우려',
        sourceTextSha256: minoritySourceHash('비용 우려'),
        citedUids: ['source-minority'],
      }],
    }],
  })).toThrow('Invalid transcriptChunkId');
});

test('rejects missing citation mappings instead of producing a partial import plan', () => {
  expect(() => buildPlatformAnalysisImportPlan({
    topicId: TOPIC_ID,
    analysis: {
      recommendations: [{
        rec_id: 'rec-missing',
        title: '출처가 필요한 권고 후보',
        was_derived_from: ['utterance-missing'],
      }],
    },
    sourceMappings: [],
  })).toThrow('Missing source mapping for cited source');
});

test('rejects uncited analysis candidates', () => {
  expect(() => buildPlatformAnalysisImportPlan({
    topicId: TOPIC_ID,
    analysis: { recommendations: [{ rec_id: 'rec-uncited', title: '출처 없는 후보' }] },
    sourceMappings: [],
  })).toThrow('Every analysis candidate requires at least one cited source');
});

test('rejects analysis output that claims a reviewed decision', () => {
  expect(() => buildPlatformAnalysisImportPlan({
    topicId: TOPIC_ID,
    analysis: {
      recommendations: [{
        rec_id: 'rec-decision',
        title: 'AI가 확정했다고 주장한 결정',
        kind: 'decision',
        review_status: 'reviewed',
        cited_uids: ['utterance-1'],
      }],
    },
    sourceMappings: [{ sourceUid: 'utterance-1', itemId: '21111111-1111-4111-8111-111111111111', clusterId: null }],
  })).toThrow('Analysis import accepts recommendation candidates only');
});

test('rejects invalid topic and item identifiers before creating a plan', () => {
  const input = {
    topicId: TOPIC_ID,
    analysis: {
      recommendations: [{
        rec_id: 'rec-valid',
        title: '유효한 후보',
        cited_uids: ['utterance-1'],
      }],
    },
    sourceMappings: [{ sourceUid: 'utterance-1', itemId: '21111111-1111-4111-8111-111111111111', clusterId: null }],
  };
  expect(() => buildPlatformAnalysisImportPlan({ ...input, topicId: 'not-a-uuid' })).toThrow('Invalid topicId');
  expect(() => buildPlatformAnalysisImportPlan({
    ...input,
    sourceMappings: [{ ...input.sourceMappings[0], itemId: 'not-a-uuid' }],
  })).toThrow('Invalid itemId');
});

test('rejects duplicate recommendation and source identifiers', () => {
  const recommendation = {
    rec_id: 'rec-duplicate',
    title: '중복 후보',
    cited_uids: ['utterance-1'],
  };
  const mapping = { sourceUid: 'utterance-1', itemId: '21111111-1111-4111-8111-111111111111', clusterId: null };
  expect(() => buildPlatformAnalysisImportPlan({
    topicId: TOPIC_ID,
    analysis: { recommendations: [recommendation, recommendation] },
    sourceMappings: [mapping],
  })).toThrow('Duplicate recommendation id');
  expect(() => buildPlatformAnalysisImportPlan({
    topicId: TOPIC_ID,
    analysis: { recommendations: [recommendation] },
    sourceMappings: [mapping, mapping],
  })).toThrow('Duplicate source mapping');
});

test('rejects issue fields that cannot satisfy the platform schema', () => {
  const build = (overrides) => buildPlatformAnalysisImportPlan({
    topicId: TOPIC_ID,
    analysis: {
      recommendations: [{
        rec_id: 'rec-schema',
        title: '스키마 검증 후보',
        cited_uids: ['utterance-1'],
        ...overrides,
      }],
    },
    sourceMappings: [{ sourceUid: 'utterance-1', itemId: '21111111-1111-4111-8111-111111111111', clusterId: null }],
  });
  expect(() => build({ stance: 'agree' })).toThrow('Invalid stance');
  expect(() => build({ frequency_class: 'unanimous' })).toThrow('Invalid frequency class');
  expect(() => build({ title: '가'.repeat(201) })).toThrow('Issue label must be 1 to 200 characters');
  expect(() => build({ summary: { text: 'invalid' } })).toThrow('Invalid issue summary');
});

test('rejects empty plans and duplicate candidate provenance', () => {
  expect(() => buildPlatformAnalysisImportPlan({
    topicId: TOPIC_ID,
    analysis: { recommendations: [] },
    sourceMappings: [],
  })).toThrow('Analysis contains no recommendation candidates');

  const mapping = { sourceUid: 'utterance-1', itemId: '21111111-1111-4111-8111-111111111111', clusterId: null };
  expect(() => buildPlatformAnalysisImportPlan({
    topicId: TOPIC_ID,
    analysis: {
      recommendations: [{
        rec_id: 'rec-duplicate-citation',
        title: '중복 출처 후보',
        cited_uids: ['utterance-1', 'utterance-1'],
      }],
    },
    sourceMappings: [mapping],
  })).toThrow('Duplicate cited source');

  expect(() => buildPlatformAnalysisImportPlan({
    topicId: TOPIC_ID,
    analysis: {
      recommendations: [{
        rec_id: 'rec-duplicate-minority',
        title: '소수 우려 식별자 검증',
        cited_uids: ['utterance-1'],
        minority: [
          { minority_id: 'same', title: '첫 우려', cited_uids: ['utterance-1'] },
          { minority_id: 'same', title: '둘째 우려', cited_uids: ['utterance-1'] },
        ],
      }],
    },
    sourceMappings: [mapping],
  })).toThrow('Duplicate candidate id');
});

test('writes a dry-run plan through the CLI without database credentials or mutation', () => {
  const directory = mkdtempSync(join(tmpdir(), 'platform-analysis-import-'));
  try {
    const analysisPath = join(directory, 'analysis.json');
    const mappingPath = join(directory, 'provenance.json');
    const outputPath = join(directory, 'plan.json');
    const analysisSource = JSON.stringify({
      meta: {
        recommendations: [{
          rec_id: 'rec-cli',
          title: 'CLI 초안 후보',
          cited_uids: ['utterance-cli'],
          time_span: { start: 1, end: 2 },
        }],
      },
    });
    const provenanceSource = JSON.stringify({
      schemaVersion: 1,
      topicId: TOPIC_ID,
      sourceMappings: [{
        sourceUid: 'utterance-cli',
        itemId: '21111111-1111-4111-8111-111111111111',
        clusterId: null,
      }],
    });
    writeFileSync(analysisPath, analysisSource, 'utf8');
    writeFileSync(mappingPath, provenanceSource, 'utf8');

    const modulePath = fileURLToPath(new URL('../platform-analysis-import.mjs', import.meta.url));
    const result = spawnSync(process.execPath, [
      modulePath,
      '--analysis', analysisPath,
      '--provenance-map', mappingPath,
      '--output', outputPath,
    ], { encoding: 'utf8' });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('1 candidates; database mutation: false');
    const plan = JSON.parse(readFileSync(outputPath, 'utf8'));
    expect(plan).toMatchObject({
      schemaVersion: 2,
      dryRun: true,
      databaseMutationExecuted: false,
      requiresHumanReview: true,
      integrity: {
        kind: 'self-checksum',
        algorithm: 'sha256',
        analysisSha256: createHash('sha256').update(analysisSource).digest('hex'),
        provenanceMapSha256: createHash('sha256').update(provenanceSource).digest('hex'),
      },
    });
    expect(plan.integrity.planSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(plan.candidates[0].provenance).not.toHaveProperty('timeSpan');
    expect(JSON.stringify(plan)).not.toMatch(/service.role|token|credential/i);

    const verification = spawnSync(process.execPath, [
      modulePath,
      '--verify-plan', outputPath,
      '--analysis', analysisPath,
      '--provenance-map', mappingPath,
    ], { encoding: 'utf8' });
    expect(verification.status).toBe(0);
    expect(verification.stdout).toContain('Analysis import plan verified (1 candidates; database mutation: false)');

    plan.candidates[0].issue.label = '변조된 후보';
    writeFileSync(outputPath, JSON.stringify(plan), 'utf8');
    const tampered = spawnSync(process.execPath, [
      modulePath,
      '--verify-plan', outputPath,
      '--analysis', analysisPath,
      '--provenance-map', mappingPath,
    ], { encoding: 'utf8' });
    expect(tampered.status).toBe(1);
    expect(tampered.stderr).toContain('Analysis import plan checksum mismatch');
    expect(tampered.stderr).not.toContain('변조된 후보');

    const overwrite = spawnSync(process.execPath, [
      modulePath,
      '--analysis', analysisPath,
      '--provenance-map', mappingPath,
      '--output', outputPath,
    ], { encoding: 'utf8' });
    expect(overwrite.status).toBe(1);
    expect(overwrite.stderr).toContain('Output already exists; use --force to replace it');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('rejects a recomputed checksum when the sealed plan no longer matches its inputs', () => {
  const analysis = {
    recommendations: [{
      rec_id: 'rec-resealed',
      title: '원래 후보',
      cited_uids: ['utterance-1'],
    }],
  };
  const provenanceMap = {
    schemaVersion: 1,
    topicId: TOPIC_ID,
    sourceMappings: [{
      sourceUid: 'utterance-1',
      itemId: '21111111-1111-4111-8111-111111111111',
      clusterId: null,
    }],
  };
  const analysisSource = JSON.stringify(analysis);
  const provenanceMapSource = JSON.stringify(provenanceMap);
  const basePlan = buildPlatformAnalysisImportPlan({
    topicId: provenanceMap.topicId,
    analysis,
    sourceMappings: provenanceMap.sourceMappings,
  });
  const reorderedPlan = Object.fromEntries(Object.entries(structuredClone(basePlan)).reverse());
  const normallySealed = sealPlatformAnalysisImportPlan({ plan: basePlan, analysisSource, provenanceMapSource });
  const reorderedSealed = sealPlatformAnalysisImportPlan({
    plan: reorderedPlan,
    analysisSource,
    provenanceMapSource,
  });
  expect(reorderedSealed.integrity.planSha256).toBe(normallySealed.integrity.planSha256);
  expect(verifyPlatformAnalysisImportPlan({
    plan: reorderedSealed,
    analysis,
    provenanceMap,
    analysisSource,
    provenanceMapSource,
  })).toEqual({ candidateCount: 1, databaseMutationExecuted: false });

  basePlan.candidates[0].issue.label = 'checksum까지 다시 계산한 변조';
  const resealed = sealPlatformAnalysisImportPlan({ plan: basePlan, analysisSource, provenanceMapSource });

  expect(() => verifyPlatformAnalysisImportPlan({
    plan: resealed,
    analysis,
    provenanceMap,
    analysisSource,
    provenanceMapSource,
  })).toThrow('Analysis import plan does not match its inputs');

  expect(() => verifyPlatformAnalysisImportPlan({
    plan: resealed,
    analysis,
    provenanceMap,
    analysisSource: `${analysisSource}\n`,
    provenanceMapSource,
  })).toThrow('Analysis input hash mismatch');

  expect(() => verifyPlatformAnalysisImportPlan({
    plan: resealed,
    analysis,
    provenanceMap,
    analysisSource,
    provenanceMapSource: `${provenanceMapSource}\n`,
  })).toThrow('Provenance map hash mismatch');
});

test('fails closed on malformed CLI input without echoing its contents', () => {
  const directory = mkdtempSync(join(tmpdir(), 'platform-analysis-import-malformed-'));
  try {
    const analysisPath = join(directory, 'analysis.json');
    const mappingPath = join(directory, 'provenance.json');
    const outputPath = join(directory, 'plan.json');
    writeFileSync(analysisPath, '{"secret":"must-not-echo"', 'utf8');
    writeFileSync(mappingPath, '{}', 'utf8');
    const modulePath = fileURLToPath(new URL('../platform-analysis-import.mjs', import.meta.url));
    const result = spawnSync(process.execPath, [
      modulePath,
      '--analysis', analysisPath,
      '--provenance-map', mappingPath,
      '--output', outputPath,
    ], { encoding: 'utf8' });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Cannot parse analysis JSON');
    expect(result.stderr).not.toContain('must-not-echo');

    writeFileSync(analysisPath, JSON.stringify({
      recommendations: [{
        rec_id: 'rec-private',
        title: '후보',
        stance: 'private-value-must-not-echo',
        cited_uids: ['source-private'],
      }],
    }), 'utf8');
    writeFileSync(mappingPath, JSON.stringify({
      schemaVersion: 1,
      topicId: TOPIC_ID,
      sourceMappings: [{
        sourceUid: 'source-private',
        itemId: '21111111-1111-4111-8111-111111111111',
      }],
    }), 'utf8');
    const validJsonMalformed = spawnSync(process.execPath, [
      modulePath,
      '--analysis', analysisPath,
      '--provenance-map', mappingPath,
      '--output', outputPath,
    ], { encoding: 'utf8' });
    expect(validJsonMalformed.status).toBe(1);
    expect(validJsonMalformed.stderr).toContain('Invalid stance');
    expect(validJsonMalformed.stderr).not.toContain('private-value-must-not-echo');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('supports top-level recommendations with quality metadata in meta', () => {
  const plan = buildPlatformAnalysisImportPlan({
    topicId: TOPIC_ID,
    analysis: {
      recommendations: [{
        rec_id: 'rec-mixed-layout',
        title: '혼합 레이아웃 후보',
        cited_uids: ['utterance-1'],
      }],
      meta: {
        quality: {
          validity_label: 'review-signal',
          limitations_notice: '사람 검토가 필요합니다.',
        },
      },
    },
    sourceMappings: [{ sourceUid: 'utterance-1', itemId: '21111111-1111-4111-8111-111111111111', clusterId: null }],
  });

  expect(plan.candidates).toHaveLength(1);
  expect(plan.qualityContext).toMatchObject({
    label: 'review-signal',
    limitationsNotice: '사람 검토가 필요합니다.',
  });
});

test('deduplicates import links by item while preserving source UIDs and rejects cluster conflicts', () => {
  const analysis = {
    recommendations: [{
      rec_id: 'rec-same-item',
      title: '동일 원문 매핑 후보',
      cited_uids: ['utterance-1', 'utterance-1-alias'],
    }],
  };
  const sharedItemId = '21111111-1111-4111-8111-111111111111';
  const sharedClusterId = '31111111-1111-4111-8111-111111111111';
  const plan = buildPlatformAnalysisImportPlan({
    topicId: TOPIC_ID,
    analysis,
    sourceMappings: [
      { sourceUid: 'utterance-1', transcriptChunkId: 'chunk-001', itemId: sharedItemId, clusterId: sharedClusterId },
      { sourceUid: 'utterance-1-alias', itemId: sharedItemId, clusterId: sharedClusterId },
    ],
  });

  expect(plan.candidates[0].provenance.citedUids).toEqual(['utterance-1', 'utterance-1-alias']);
  expect(plan.candidates[0].provenance.sources).toEqual([
    { sourceUid: 'utterance-1', transcriptChunkId: 'chunk-001', itemId: sharedItemId, clusterId: sharedClusterId },
    { sourceUid: 'utterance-1-alias', transcriptChunkId: 'utterance-1-alias', itemId: sharedItemId, clusterId: sharedClusterId },
  ]);
  expect(plan.candidates[0].links).toEqual([{
    sourceUids: ['utterance-1', 'utterance-1-alias'],
    itemId: sharedItemId,
    clusterId: sharedClusterId,
    linkedBy: 'ai',
  }]);

  expect(() => buildPlatformAnalysisImportPlan({
    topicId: TOPIC_ID,
    analysis,
    sourceMappings: [
      { sourceUid: 'utterance-1', itemId: sharedItemId, clusterId: sharedClusterId },
      { sourceUid: 'utterance-1-alias', itemId: sharedItemId, clusterId: '32111111-1111-4111-8111-111111111111' },
    ],
  })).toThrow('Conflicting cluster mappings for cited item');
});
