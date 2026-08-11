import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import {
  buildPlatformAnalysisImportPlan,
  sealPlatformAnalysisImportPlan,
  verifyPlatformAnalysisImportPlan,
} from '../platform-analysis-import.mjs';

const TOPIC_ID = '11111111-1111-4111-8111-111111111111';

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
