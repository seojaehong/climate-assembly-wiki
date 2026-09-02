import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { expect, test } from 'vitest';
import { buildPlatformAnalysisProvenanceMap } from '../platform-analysis-provenance-map.mjs';

const TOPIC_ID = '11111111-1111-4111-8111-111111111111';

const source = (overrides = {}) => ({
  uid: '1분과 1조/k1/i01',
  team: '1분과 1조',
  topic: '배경과 문제',
  topic_no: 1,
  text: '원문 한 줄',
  ...overrides,
});

const submission = (overrides = {}) => ({
  topic_id: TOPIC_ID,
  topic_ordinal: 1,
  team_name: '1분과 1조',
  item_id: '21111111-1111-4111-8111-111111111111',
  item_ordinal: 1,
  item_content: '원문 한 줄',
  ...overrides,
});

test('maps analysis UIDs to exact submission item UUIDs without inventing text', () => {
  expect(buildPlatformAnalysisProvenanceMap({
    topicId: TOPIC_ID,
    analysisSources: [source(), source({ uid: '1분과 1조/k1/i02', text: '둘째 원문' })],
    submissionRows: [submission(), submission({
      item_id: '22111111-1111-4111-8111-111111111111',
      item_ordinal: 2,
      item_content: '둘째 원문',
    })],
  })).toEqual({
    schemaVersion: 1,
    topicId: TOPIC_ID,
    sourceMappings: [
      {
        sourceUid: '1분과 1조/k1/i01',
        itemId: '21111111-1111-4111-8111-111111111111',
        clusterId: null,
      },
      {
        sourceUid: '1분과 1조/k1/i02',
        itemId: '22111111-1111-4111-8111-111111111111',
        clusterId: null,
      },
    ],
  });
});

test('filters one topic while requiring every selected source to match exactly', () => {
  const otherTopicId = '12222222-2222-4222-8222-222222222222';
  const result = buildPlatformAnalysisProvenanceMap({
    topicId: TOPIC_ID,
    analysisSources: [source(), source({ uid: '1분과 1조/k2/i01', topic_no: 2, text: '바라는 변화' })],
    submissionRows: [
      submission(),
      submission({
        topic_id: otherTopicId,
        topic_ordinal: 2,
        item_id: '23333333-3333-4333-8333-333333333333',
        item_content: '바라는 변화',
      }),
    ],
  });
  expect(result.sourceMappings).toHaveLength(1);
  expect(result.sourceMappings[0].sourceUid).toBe('1분과 1조/k1/i01');
});

test('fails closed on missing item IDs, text drift, duplicate keys, and malformed UIDs', () => {
  expect(() => buildPlatformAnalysisProvenanceMap({
    topicId: TOPIC_ID,
    analysisSources: [source()],
    submissionRows: [submission({ item_id: undefined })],
  })).toThrow('submission item UUID');
  expect(() => buildPlatformAnalysisProvenanceMap({
    topicId: TOPIC_ID,
    analysisSources: [source()],
    submissionRows: [submission({ item_content: '다른 원문' })],
  })).toThrow('source text does not match');
  expect(() => buildPlatformAnalysisProvenanceMap({
    topicId: TOPIC_ID,
    analysisSources: [source(), source()],
    submissionRows: [submission()],
  })).toThrow('Duplicate analysis source UID');
  expect(() => buildPlatformAnalysisProvenanceMap({
    topicId: TOPIC_ID,
    analysisSources: [source({ uid: '임의 UID' })],
    submissionRows: [submission()],
  })).toThrow('analysis source UID');
});

test('CLI keeps private inputs and generated provenance outside the repository', () => {
  const directory = mkdtempSync(join(tmpdir(), 'platform-analysis-provenance-'));
  const modulePath = fileURLToPath(new URL('../platform-analysis-provenance-map.mjs', import.meta.url));
  try {
    const analysisPath = join(directory, 'analysis-sources.json');
    const submissionsPath = join(directory, 'submission-export.json');
    const outputPath = join(directory, 'provenance.json');
    writeFileSync(analysisPath, JSON.stringify([source()]), 'utf8');
    writeFileSync(submissionsPath, JSON.stringify({ submissions: [submission()] }), 'utf8');
    const result = spawnSync(process.execPath, [
      modulePath,
      '--analysis-sources', analysisPath,
      '--submission-export', submissionsPath,
      '--topic-id', TOPIC_ID,
      '--output', outputPath,
    ], { encoding: 'utf8' });
    expect(result.status).toBe(0);
    expect(JSON.parse(readFileSync(outputPath, 'utf8')).sourceMappings).toHaveLength(1);
    expect(result.stdout).toContain('"mappingCount":1');

    const repositoryInput = fileURLToPath(new URL('../fixtures/0829-submissions.json', import.meta.url));
    const rejected = spawnSync(process.execPath, [
      modulePath,
      '--analysis-sources', repositoryInput,
      '--submission-export', submissionsPath,
      '--topic-id', TOPIC_ID,
      '--output', join(directory, 'rejected.json'),
    ], { encoding: 'utf8' });
    expect(rejected.status).toBe(1);
    expect(rejected.stderr).toContain('outside the repository');
    expect(rejected.stderr).not.toContain(repositoryInput);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
