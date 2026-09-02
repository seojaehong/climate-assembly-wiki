import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import {
  buildPublicIdentityPlan,
  runPublicIdentityPlanCli,
} from '../platform-public-identity-plan.mjs';

const reviewedAt = '2026-09-03T01:00:00.000Z';
const templatePath = fileURLToPath(new URL(
  '../../docs/platform/public-identity-institution-profile.template.json',
  import.meta.url,
));

function readyProfile(overrides = {}) {
  return {
    schemaVersion: 1,
    organizationCode: 'pilot-org',
    systemName: '공론화 SaaS',
    deploymentMode: 'self_hosted_supabase',
    federationMode: 'saml2',
    authBaseUrl: 'https://auth.pilot.example.go.kr/auth/v1',
    applicationOrigin: 'https://deliberation.pilot.example.go.kr',
    idpMetadata: {
      sourceKind: 'https_url',
      sourceReference: 'https://idp.pilot.example.go.kr/metadata',
      expectedEntityId: 'https://idp.pilot.example.go.kr/entity',
      certificateFingerprintSha256: 'a'.repeat(64),
      reviewedAt,
      refreshOwnerRole: '기관 인증 연계 책임 역할',
    },
    identityMapping: {
      nameIdFormat: 'persistent',
      immutableSubjectAttribute: 'name_id',
      emailAttribute: 'mail',
      accountLinking: 'preprovisioned_exact_subject',
      jitProvisioning: false,
      defaultMembershipRole: null,
    },
    assertionPolicy: {
      responseSigned: true,
      assertionSigned: true,
      encryptedAssertions: 'required',
      requireAudience: true,
      requireDestination: true,
      requireRecipient: true,
      requireInResponseTo: true,
      rejectReplay: true,
      clockSyncOwnerRole: '기관 인프라 시간동기화 책임 역할',
    },
    gatewayDecision: {
      status: 'not_applicable',
      ownerRole: null,
      reference: null,
    },
    review: {
      status: 'approved',
      reviewerRole: '기관 인증 연계 승인 역할',
      reviewedAt,
    },
    ...overrides,
  };
}

test('builds a ready self-hosted SAML plan without granting application membership', () => {
  const result = buildPublicIdentityPlan({
    profile: readyProfile(),
    generatedAt: '2026-09-03T02:00:00.000Z',
  });

  expect(result.status).toBe('ready_for_institution_integration');
  expect(result.readyForInstitutionIntegration).toBe(true);
  expect(result.databaseMutationExecuted).toBe(false);
  expect(result.authProviderRegistered).toBe(false);
  expect(result.credentialFieldSchemaIncluded).toBe(false);
  expect(result.serviceProvider).toEqual({
    entityId: 'https://auth.pilot.example.go.kr/auth/v1/sso/saml/metadata',
    metadataUrl: 'https://auth.pilot.example.go.kr/auth/v1/sso/saml/metadata',
    assertionConsumerServiceUrl: 'https://auth.pilot.example.go.kr/auth/v1/sso/saml/acs',
    applicationOrigin: 'https://deliberation.pilot.example.go.kr',
  });
  expect(result.authorizationBoundary).toEqual({
    membershipProvisioning: 'separate_approved_workflow',
    externalAttributesGrantApplicationRole: false,
    defaultMembershipRole: null,
  });
  expect(result.blockers).toEqual([]);
  expect(result.checksumSha256).toMatch(/^[0-9a-f]{64}$/);

  const trailingSlash = buildPublicIdentityPlan({
    profile: readyProfile({ authBaseUrl: 'https://auth.pilot.example.go.kr/auth/v1/' }),
    generatedAt: '2026-09-03T02:00:00.000Z',
  });
  expect(trailingSlash.serviceProvider).toEqual(result.serviceProvider);
});

test('keeps every institution-owned decision visible as a blocker', () => {
  const profile = JSON.parse(readFileSync(templatePath, 'utf8'));
  const result = buildPublicIdentityPlan({
    profile,
    generatedAt: '2026-09-03T02:00:00.000Z',
  });

  expect(result.status).toBe('needs_institution_identity_decisions');
  expect(result.readyForInstitutionIntegration).toBe(false);
  expect(result.blockers).toContain('deployment_mode');
  expect(result.blockers).toContain('federation_mode');
  expect(result.blockers).toContain('idp_metadata.source');
  expect(result.blockers).toContain('identity_mapping.account_linking');
  expect(result.blockers).toContain('assertion_policy.encrypted_assertions');
  expect(result.blockers).toContain('institution_review');
});

test('requires an approved gateway decision for GPKI federation', () => {
  expect(() => buildPublicIdentityPlan({
    profile: readyProfile({
      federationMode: 'gpki_via_saml_gateway',
      gatewayDecision: { status: 'pending', ownerRole: null, reference: null },
    }),
    generatedAt: '2026-09-03T02:00:00.000Z',
  })).toThrow('GPKI gateway decision is incomplete');

  const result = buildPublicIdentityPlan({
    profile: readyProfile({
      federationMode: 'gpki_via_saml_gateway',
      gatewayDecision: {
        status: 'approved',
        ownerRole: '기관 GPKI 연계 책임 역할',
        reference: '기관 GPKI-SAML 게이트웨이 승인 문서 식별자',
      },
    }),
    generatedAt: '2026-09-03T02:00:00.000Z',
  });
  expect(result.readyForInstitutionIntegration).toBe(true);
  expect(result.federationBoundary).toMatchObject({
    mode: 'gpki_via_saml_gateway',
    directGpkiCertificateProcessing: false,
    gatewayRequired: true,
  });
});

test('rejects unsafe assertion, provisioning, and role-mapping policies', () => {
  for (const profile of [
    readyProfile({
      assertionPolicy: { ...readyProfile().assertionPolicy, rejectReplay: false },
    }),
    readyProfile({
      identityMapping: { ...readyProfile().identityMapping, jitProvisioning: true },
    }),
    readyProfile({
      identityMapping: { ...readyProfile().identityMapping, defaultMembershipRole: 'org_admin' },
    }),
    readyProfile({
      idpMetadata: {
        ...readyProfile().idpMetadata,
        sourceReference: 'https://idp.pilot.example.go.kr/metadata?token=secret',
      },
    }),
  ]) {
    expect(() => buildPublicIdentityPlan({
      profile,
      generatedAt: '2026-09-03T02:00:00.000Z',
    })).toThrow();
  }
});

test('rejects review or metadata evidence dated after plan generation', () => {
  for (const profile of [
    readyProfile({ review: { ...readyProfile().review, reviewedAt: '2026-09-03T03:00:00.000Z' } }),
    readyProfile({
      idpMetadata: { ...readyProfile().idpMetadata, reviewedAt: '2026-09-03T03:00:00.000Z' },
    }),
  ]) {
    expect(() => buildPublicIdentityPlan({
      profile,
      generatedAt: '2026-09-03T02:00:00.000Z',
    })).toThrow('Review timestamp follows plan generation');
  }
});

test('CLI creates private output once and rejects repository inputs or outputs', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'platform-public-identity-'));
  const privateProfilePath = join(directory, 'profile.json');
  const outputPath = join(directory, 'plan.json');
  const repositoryOutputPath = fileURLToPath(new URL(
    '../../docs/platform/forbidden-public-identity-plan.json',
    import.meta.url,
  ));
  copyFileSync(templatePath, privateProfilePath);
  try {
    const receipt = await runPublicIdentityPlanCli({
      argv: ['--profile', privateProfilePath, '--output', outputPath],
      generatedAt: '2026-09-03T02:00:00.000Z',
    });
    expect(receipt).toMatchObject({
      status: 'needs_institution_identity_decisions',
      databaseMutationExecuted: false,
      authProviderRegistered: false,
      credentialFieldSchemaIncluded: false,
    });
    expect(existsSync(outputPath)).toBe(true);
    await expect(runPublicIdentityPlanCli({
      argv: ['--profile', privateProfilePath, '--output', outputPath],
    })).rejects.toThrow('Output already exists');
    await expect(runPublicIdentityPlanCli({
      argv: ['--profile', templatePath, '--output', join(directory, 'second.json')],
    })).rejects.toThrow('Institution identity profile must remain outside the repository');
    await expect(runPublicIdentityPlanCli({
      argv: ['--profile', privateProfilePath, '--output', repositoryOutputPath],
    })).rejects.toThrow('Identity plan output must remain outside the repository');
    expect(existsSync(repositoryOutputPath)).toBe(false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
