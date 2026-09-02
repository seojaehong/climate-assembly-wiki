import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import {
  buildDataResidencyPlan,
  runDataResidencyPlanCli,
} from '../platform-data-residency-plan.mjs';

const approvedAt = '2026-09-03T03:00:00.000Z';
const templatePath = fileURLToPath(new URL(
  '../../docs/platform/data-residency-profile.template.json',
  import.meta.url,
));

function readyProfile(overrides = {}) {
  return {
    schemaVersion: 1,
    routingMode: 'tenant_registry',
    regions: [
      {
        id: 'kr-public',
        track: 'kr_public_csap',
        applicationOrigin: 'https://kr.example.com',
        apiOrigin: 'https://api.kr.example.com',
        dataLocationCountry: 'KR',
        objectStorageCountry: 'KR',
        backupCountry: 'KR',
        providerEligibility: 'csap_eligible',
        crossRegionReplication: false,
        encryptionKeyScope: 'region_local',
        operationalOwnerRole: '한국 공공 리전 운영 책임 역할',
      },
      {
        id: 'eu-primary',
        track: 'international',
        applicationOrigin: 'https://eu.example.com',
        apiOrigin: 'https://api.eu.example.com',
        dataLocationCountry: 'DE',
        objectStorageCountry: 'DE',
        backupCountry: 'DE',
        providerEligibility: 'commercially_approved',
        crossRegionReplication: false,
        encryptionKeyScope: 'region_local',
        operationalOwnerRole: '유럽 리전 운영 책임 역할',
      },
    ],
    tenantAssignments: [
      {
        organizationCode: 'korea-pilot',
        homeRegionId: 'kr-public',
        contractCountryCode: 'KR',
        status: 'approved',
        approvedByRole: '한국 계약·데이터 책임 역할',
        approvedAt,
      },
      {
        organizationCode: 'eu-pilot',
        homeRegionId: 'eu-primary',
        contractCountryCode: 'DE',
        status: 'approved',
        approvedByRole: '유럽 계약·데이터 책임 역할',
        approvedAt,
      },
    ],
    review: {
      status: 'approved',
      reviewerRole: '글로벌 데이터주권 승인 역할',
      reviewedAt: approvedAt,
    },
    ...overrides,
  };
}

test('builds an isolated Korean-public and international tenant routing plan', () => {
  const result = buildDataResidencyPlan({
    profile: readyProfile(),
    generatedAt: '2026-09-03T04:00:00.000Z',
  });

  expect(result.status).toBe('ready_for_isolated_deployment');
  expect(result.readyForIsolatedDeployment).toBe(true);
  expect(result.databaseMutationExecuted).toBe(false);
  expect(result.infrastructureProvisioned).toBe(false);
  expect(result.dnsChanged).toBe(false);
  expect(result.routingBoundary).toEqual({
    mode: 'tenant_registry',
    routingInput: 'approved_tenant_registry_only',
    clientIpOrBrowserLocaleRouting: false,
    centralControlPlaneStoresParticipantData: false,
    unknownTenantBehavior: 'deny',
  });
  expect(result.dataBoundary).toMatchObject({
    crossRegionReplication: false,
    crossRegionBackup: false,
    encryptionKeyScope: 'region_local',
  });
  expect(result.regions[0].assignedOrganizationCodes).toEqual(['korea-pilot']);
  expect(result.regions[1].assignedOrganizationCodes).toEqual(['eu-pilot']);
  expect(result.blockers).toEqual([]);
  expect(result.checksumSha256).toMatch(/^[0-9a-f]{64}$/);
});

test('keeps deployment and institution decisions visible in the template plan', () => {
  const result = buildDataResidencyPlan({
    profile: JSON.parse(readFileSync(templatePath, 'utf8')),
    generatedAt: '2026-09-03T04:00:00.000Z',
  });

  expect(result.status).toBe('needs_residency_decisions');
  expect(result.readyForIsolatedDeployment).toBe(false);
  expect(result.blockers).toContain('routing_mode');
  expect(result.blockers).toContain('regions.kr-public.provider_eligibility');
  expect(result.blockers).toContain('regions.global-primary.data_location_country');
  expect(result.blockers).toContain('residency_review');
});

test('rejects cross-region storage, replication, and provider-track mismatches', () => {
  const base = readyProfile();
  const unsafeRegions = [
    { ...base.regions[0], crossRegionReplication: true },
    { ...base.regions[0], backupCountry: 'US' },
    { ...base.regions[0], providerEligibility: 'commercially_approved' },
    { ...base.regions[1], dataLocationCountry: 'KR', objectStorageCountry: 'KR', backupCountry: 'KR' },
  ];
  for (const unsafeRegion of unsafeRegions) {
    const regions = unsafeRegion.track === 'kr_public_csap'
      ? [unsafeRegion, base.regions[1]]
      : [base.regions[0], unsafeRegion];
    expect(() => buildDataResidencyPlan({
      profile: readyProfile({ regions }),
      generatedAt: '2026-09-03T04:00:00.000Z',
    })).toThrow();
  }
});

test('rejects routing by the wrong jurisdiction, unknown region, and duplicate origins', () => {
  const base = readyProfile();
  for (const profile of [
    readyProfile({
      tenantAssignments: [{ ...base.tenantAssignments[0], homeRegionId: 'eu-primary' }],
    }),
    readyProfile({
      tenantAssignments: [{ ...base.tenantAssignments[0], homeRegionId: 'missing-region' }],
    }),
    readyProfile({
      regions: [base.regions[0], { ...base.regions[1], apiOrigin: base.regions[0].applicationOrigin }],
    }),
  ]) {
    expect(() => buildDataResidencyPlan({
      profile,
      generatedAt: '2026-09-03T04:00:00.000Z',
    })).toThrow();
  }
});

test('rejects incomplete approvals and future approval evidence', () => {
  const base = readyProfile();
  expect(() => buildDataResidencyPlan({
    profile: readyProfile({
      tenantAssignments: [{ ...base.tenantAssignments[0], approvedByRole: null }],
    }),
    generatedAt: '2026-09-03T04:00:00.000Z',
  })).toThrow('Approved tenant assignment is incomplete');

  expect(() => buildDataResidencyPlan({
    profile: readyProfile({
      review: { ...base.review, reviewedAt: '2026-09-03T05:00:00.000Z' },
    }),
    generatedAt: '2026-09-03T04:00:00.000Z',
  })).toThrow('Approval timestamp follows plan generation');
});

test('CLI writes a private immutable plan and refuses repository paths', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'platform-residency-'));
  const privateProfilePath = join(directory, 'profile.json');
  const outputPath = join(directory, 'plan.json');
  const readyPath = join(directory, 'ready.json');
  const repositoryOutputPath = fileURLToPath(new URL(
    '../../docs/platform/forbidden-residency-plan.json',
    import.meta.url,
  ));
  copyFileSync(templatePath, privateProfilePath);
  writeFileSync(readyPath, JSON.stringify(readyProfile()), 'utf8');
  try {
    const receipt = await runDataResidencyPlanCli({
      argv: ['--profile', privateProfilePath, '--output', outputPath],
      generatedAt: '2026-09-03T04:00:00.000Z',
    });
    expect(receipt).toMatchObject({
      status: 'needs_residency_decisions',
      databaseMutationExecuted: false,
      infrastructureProvisioned: false,
      dnsChanged: false,
    });
    expect(existsSync(outputPath)).toBe(true);
    await expect(runDataResidencyPlanCli({
      argv: ['--profile', privateProfilePath, '--output', outputPath],
    })).rejects.toThrow('Output already exists');
    await expect(runDataResidencyPlanCli({
      argv: ['--profile', templatePath, '--output', join(directory, 'second.json')],
    })).rejects.toThrow('Data residency profile must remain outside the repository');
    await expect(runDataResidencyPlanCli({
      argv: ['--profile', readyPath, '--output', repositoryOutputPath],
    })).rejects.toThrow('Residency plan output must remain outside the repository');
    expect(existsSync(repositoryOutputPath)).toBe(false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
