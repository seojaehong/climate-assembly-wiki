import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import {
  buildPlatformCompliancePackage,
  discoverClimateVoteTables,
  runPlatformCompliancePackageCli,
  validatePlatformComplianceCatalog,
} from '../platform-compliance-package.mjs';

const reviewedAt = '2026-09-03T01:00:00.000Z';
const repositoryProfileTemplatePath = fileURLToPath(new URL(
  '../../docs/platform/compliance-institution-profile.template.json',
  import.meta.url,
));

function catalog() {
  return {
    schemaVersion: 1,
    datasets: [
      {
        id: 'staff-access',
        title: '운영자 접근',
        deploymentState: 'live',
        tables: ['membership'],
        storageLocations: ['managed_database'],
        purpose: '기관별 권한 확인',
        dataSubjects: ['staff'],
        dataClasses: ['staff_identity', 'audit_metadata'],
        ingress: ['staff_authentication'],
        internalUses: ['authorization'],
        egress: ['audit_export'],
        publicRelease: 'never',
      },
      {
        id: 'deliberation-content',
        title: '숙의 원문',
        deploymentState: 'live',
        tables: ['submission', 'submission_item'],
        storageLocations: ['managed_database'],
        purpose: '시민 발언 기록과 검수',
        dataSubjects: ['participant'],
        dataClasses: ['deliberation_content', 'political_opinion_candidate'],
        ingress: ['participant_submission'],
        internalUses: ['moderation', 'analysis'],
        egress: ['reviewed_publication'],
        publicRelease: 'human_review_only',
      },
    ],
  };
}

function mapping(datasetId, overrides = {}) {
  return {
    datasetId,
    recordClass: 'meeting_minutes',
    unitTaskCode: 'UNIT-001',
    retentionPeriod: '5y',
    retentionTrigger: '공론화 종료일',
    dispositionAction: 'institution_records_process',
    dispositionAuthority: '기관 기록관 승인 절차',
    destructionMethod: '승인된 논리 삭제와 백업 만료 확인',
    ...overrides,
  };
}

function profile(overrides = {}) {
  return {
    schemaVersion: 1,
    organizationCode: 'pilot-org',
    systemName: '공론화 SaaS',
    serviceTrack: 'managed_non_public',
    privacyDecision: {
      status: 'approved',
      reviewerRole: '개인정보 보호책임자 지정 역할',
      reviewedAt,
      lawfulBasisReference: '기관 승인 근거 문서 식별자',
      politicalOpinionClassification: 'sensitive_personal',
      audioBiometricClassification: 'not_collected',
      overseasTransferDecision: 'none',
      processorInventoryStatus: 'confirmed',
      noticeAndConsentStatus: 'confirmed',
    },
    recordsDecision: {
      status: 'approved',
      reviewerRole: '기록물관리 책임 역할',
      reviewedAt,
      scheduleAuthority: '기관 기록관리기준표 식별자',
      mappings: [mapping('staff-access'), mapping('deliberation-content')],
    },
    ...overrides,
  };
}

test('builds a complete data-flow, privacy, destruction, and records package without claiming certification', () => {
  const result = buildPlatformCompliancePackage({
    catalog: catalog(),
    profile: profile(),
    generatedAt: '2026-09-03T02:00:00.000Z',
  });

  expect(result.status).toBe('ready_for_institution_submission');
  expect(result.readyForInstitutionSubmission).toBe(true);
  expect(result.complianceCertified).toBe(false);
  expect(result.legalAssessmentPerformedByProduct).toBe(false);
  expect(result.databaseMutationExecuted).toBe(false);
  expect(result.summary).toEqual({
    datasetCount: 2,
    tableCount: 3,
    blockerCount: 0,
  });
  expect(result.dataFlows.find((flow) => flow.datasetId === 'deliberation-content')).toMatchObject({
    datasetId: 'deliberation-content',
    ingress: ['participant_submission'],
    schemaObjects: ['climate_vote.submission', 'climate_vote.submission_item'],
    storageLocations: ['managed_database'],
    publicRelease: 'human_review_only',
  });
  expect(result.retentionMappings.map((entry) => entry.datasetId)).toEqual([
    'deliberation-content',
    'staff-access',
  ]);
  expect(result.checksumSha256).toMatch(/^[0-9a-f]{64}$/);
});

test('keeps the package blocked while institution-owned privacy or records decisions are pending', () => {
  const pending = profile({
    privacyDecision: {
      status: 'pending',
      reviewerRole: null,
      reviewedAt: null,
      lawfulBasisReference: null,
      politicalOpinionClassification: 'pending',
      audioBiometricClassification: 'pending',
      overseasTransferDecision: 'pending',
      processorInventoryStatus: 'pending',
      noticeAndConsentStatus: 'pending',
    },
    recordsDecision: {
      status: 'pending',
      reviewerRole: null,
      reviewedAt: null,
      scheduleAuthority: null,
      mappings: [
        mapping('staff-access', {
          unitTaskCode: null,
          recordClass: 'pending',
          retentionPeriod: 'pending',
          retentionTrigger: null,
          dispositionAction: 'pending',
          dispositionAuthority: null,
          destructionMethod: null,
        }),
        mapping('deliberation-content', {
          unitTaskCode: null,
          recordClass: 'pending',
          retentionPeriod: 'pending',
          retentionTrigger: null,
          dispositionAction: 'pending',
          dispositionAuthority: null,
          destructionMethod: null,
        }),
      ],
    },
  });
  const result = buildPlatformCompliancePackage({
    catalog: catalog(),
    profile: pending,
    generatedAt: '2026-09-03T02:00:00.000Z',
  });

  expect(result.status).toBe('needs_institution_decisions');
  expect(result.readyForInstitutionSubmission).toBe(false);
  expect(result.blockers).toContain('privacy.review');
  expect(result.blockers).toContain('privacy.political_opinion_classification');
  expect(result.blockers).toContain('records.staff-access.retention_period');
  expect(result.blockers).toContain('records.deliberation-content.disposition_authority');
  expect(result.blockers).toContain('records.deliberation-content.destruction_method');
  expect(result.blockers).toContain('records.deliberation-content.record_class');
});

test('fails closed on missing, duplicate, or unknown retention mappings', () => {
  expect(() => buildPlatformCompliancePackage({
    catalog: catalog(),
    profile: profile({
      recordsDecision: { ...profile().recordsDecision, mappings: [mapping('staff-access')] },
    }),
    generatedAt: '2026-09-03T02:00:00.000Z',
  })).toThrow('Retention mapping set does not match catalog');

  expect(() => buildPlatformCompliancePackage({
    catalog: catalog(),
    profile: profile({
      recordsDecision: {
        ...profile().recordsDecision,
        mappings: [mapping('staff-access'), mapping('staff-access')],
      },
    }),
    generatedAt: '2026-09-03T02:00:00.000Z',
  })).toThrow('Duplicate retention mapping');

  expect(() => buildPlatformCompliancePackage({
    catalog: catalog(),
    profile: profile({
      recordsDecision: {
        ...profile().recordsDecision,
        mappings: [mapping('staff-access'), mapping('unknown')],
      },
    }),
    generatedAt: '2026-09-03T02:00:00.000Z',
  })).toThrow('Unknown retention mapping');
});

test('rejects contradictory approved decisions and unexpected fields', () => {
  expect(() => buildPlatformCompliancePackage({
    catalog: catalog(),
    profile: profile({
      privacyDecision: { ...profile().privacyDecision, reviewedAt: null },
    }),
    generatedAt: '2026-09-03T02:00:00.000Z',
  })).toThrow('Approved privacy decision is incomplete');

  expect(() => buildPlatformCompliancePackage({
    catalog: catalog(),
    profile: profile({
      recordsDecision: {
        ...profile().recordsDecision,
        mappings: [
          mapping('staff-access'),
          mapping('deliberation-content', { recordClass: 'pending' }),
        ],
      },
    }),
    generatedAt: '2026-09-03T02:00:00.000Z',
  })).toThrow('Approved records decision is incomplete');

  expect(() => validatePlatformComplianceCatalog({
    ...catalog(),
    unexpected: true,
  })).toThrow('Unexpected compliance catalog field');
});

test('rejects privacy or records approvals dated after package generation', () => {
  expect(() => buildPlatformCompliancePackage({
    catalog: catalog(),
    profile: profile({
      privacyDecision: { ...profile().privacyDecision, reviewedAt: '2026-09-03T03:00:00.000Z' },
    }),
    generatedAt: '2026-09-03T02:00:00.000Z',
  })).toThrow('Review timestamp follows package generation');
  expect(() => buildPlatformCompliancePackage({
    catalog: catalog(),
    profile: profile({
      recordsDecision: { ...profile().recordsDecision, reviewedAt: '2026-09-03T03:00:00.000Z' },
    }),
    generatedAt: '2026-09-03T02:00:00.000Z',
  })).toThrow('Review timestamp follows package generation');
});

test('discovers every climate_vote table created by migration SQL', () => {
  expect(discoverClimateVoteTables(`
    create table climate_vote.issue (id uuid);
    CREATE TABLE IF NOT EXISTS climate_vote.submission_item (id uuid);
    create table public.ignored (id uuid);
  `)).toEqual(['issue', 'submission_item']);
});

test('the repository catalog covers every current and planned climate_vote table', () => {
  const repositoryCatalog = JSON.parse(readFileSync(
    new URL('../../docs/platform/platform-compliance-catalog.json', import.meta.url),
    'utf8',
  ));
  expect(() => validatePlatformComplianceCatalog(repositoryCatalog, {
    verifyRepositoryCoverage: true,
  })).not.toThrow();
  const transientAudio = repositoryCatalog.datasets.find((dataset) => dataset.id === 'transient-audio-transcript');
  expect(transientAudio).toMatchObject({
    tables: [],
    storageLocations: ['browser_memory_only'],
    publicRelease: 'never',
  });
  expect(transientAudio.dataClasses).toContain('audio_or_biometric_candidate');
});

test('CLI uses the tracked catalog and creates a private pending package only once', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'platform-compliance-package-'));
  const profilePath = join(directory, 'profile.json');
  const jsonPath = join(directory, 'package.json');
  const markdownPath = join(directory, 'package.md');
  copyFileSync(repositoryProfileTemplatePath, profilePath);
  try {
    const receipt = await runPlatformCompliancePackageCli({
      argv: [
        '--profile', profilePath,
        '--json-output', jsonPath,
        '--markdown-output', markdownPath,
      ],
      generatedAt: '2026-09-03T02:00:00.000Z',
    });
    expect(receipt).toMatchObject({
      status: 'needs_institution_decisions',
      databaseMutationExecuted: false,
      credentialFieldSchemaIncluded: false,
    });
    expect(JSON.parse(readFileSync(jsonPath, 'utf8')).checksumSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(readFileSync(markdownPath, 'utf8')).toContain('기관 제출 준비 상태');
    expect(readFileSync(markdownPath, 'utf8')).toContain('flowchart LR');
    expect(readFileSync(markdownPath, 'utf8')).toContain('transient-audio-transcript');
    await expect(runPlatformCompliancePackageCli({
      argv: [
        '--profile', profilePath,
        '--json-output', jsonPath,
        '--markdown-output', markdownPath,
      ],
    })).rejects.toThrow('Output already exists');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('CLI refuses an institution profile kept inside the repository', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'platform-compliance-private-profile-'));
  const privateProfilePath = join(directory, 'profile.json');
  const jsonPath = join(directory, 'package.json');
  const markdownPath = join(directory, 'package.md');
  const repositoryOutputPath = fileURLToPath(new URL(
    '../../docs/platform/forbidden-compliance-package.json',
    import.meta.url,
  ));
  try {
    await expect(runPlatformCompliancePackageCli({
      argv: [
        '--profile', repositoryProfileTemplatePath,
        '--json-output', jsonPath,
        '--markdown-output', markdownPath,
      ],
    })).rejects.toThrow('Institution profile must remain outside the repository');
    expect(existsSync(jsonPath)).toBe(false);
    expect(existsSync(markdownPath)).toBe(false);

    copyFileSync(repositoryProfileTemplatePath, privateProfilePath);
    await expect(runPlatformCompliancePackageCli({
      argv: [
        '--profile', privateProfilePath,
        '--json-output', repositoryOutputPath,
        '--markdown-output', markdownPath,
      ],
    })).rejects.toThrow('Compliance package output must remain outside the repository');
    expect(existsSync(repositoryOutputPath)).toBe(false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
