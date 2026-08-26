import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import {
  DESIGN_PROVISIONING_SUPABASE_ADAPTER_BOUNDARIES,
  createSupabaseDesignProvisioningRpcAdapters,
} from '../platform-design-provisioning-supabase-adapter.mjs';

function authorizationFence(overrides = {}) {
  return {
    schemaVersion: 1,
    kind: 'platform_design_provisioning_authorization_fence',
    approvalId: '30000000-0000-4000-8000-000000000001',
    executionId: '40000000-0000-4000-8000-000000000001',
    authorizationRevision: 'a'.repeat(64),
    ...overrides,
  };
}

function reconciliationQuery(overrides = {}) {
  return {
    schemaVersion: 1,
    kind: 'platform_design_provisioning_reconciliation_query',
    approvalId: '30000000-0000-4000-8000-000000000001',
    executionId: '40000000-0000-4000-8000-000000000001',
    approvedPlanChecksum: 'b'.repeat(64),
    executedPlanChecksum: 'c'.repeat(64),
    sourceBlueprintSha256: 'd'.repeat(64),
    sourceBlueprintBytes: 3,
    operationCount: 0,
    operations: [],
    containsSensitiveValues: false,
    ...overrides,
  };
}

function recordingClient(handler) {
  const calls = [];
  return {
    calls,
    client: {
      schema(schemaName) {
        return {
          rpc(rpcName, args) {
            const call = {
              schemaName,
              rpcName,
              args,
              retryEnabled: null,
              signal: null,
            };
            calls.push(call);
            return {
              retry(enabled) {
                call.retryEnabled = enabled;
                return this;
              },
              async abortSignal(signal) {
                call.signal = signal;
                return handler(call);
              },
            };
          },
        };
      },
    },
  };
}

test('declares the inactive authenticated Supabase RPC boundary', () => {
  expect(DESIGN_PROVISIONING_SUPABASE_ADAPTER_BOUNDARIES).toEqual({
    schema: 'climate_vote',
    executionRpc: 'design_provision',
    reconciliationRpc: 'design_provisioning_status',
    timeoutMs: 20_000,
    retries: 0,
    requiresAuthenticatedSession: true,
    activatesPrivileges: false,
    readsEnvironment: false,
  });
});

test('does not load environment credentials or construct a Supabase client', () => {
  const source = readFileSync(
    new URL('../platform-design-provisioning-supabase-adapter.mjs', import.meta.url),
    'utf8',
  );
  expect(source).not.toContain('process.env');
  expect(source).not.toContain('createClient');
  expect(source).not.toContain('@supabase/supabase-js');
});

test('maps fenced execution to the exact dormant RPC arguments and bytea encoding', async () => {
  const fence = authorizationFence();
  const plan = { schemaVersion: 1, planKind: 'platform_design_provisioning_plan' };
  const fixture = recordingClient(() => ({
    data: {
      status: 'completed',
      authorizationRevision: fence.authorizationRevision,
    },
    error: null,
  }));
  const { executionAdapter } = createSupabaseDesignProvisioningRpcAdapters({
    client: fixture.client,
  });

  expect(executionAdapter.revisionFencedExecution).toBe(true);
  await expect(executionAdapter.execute({
    plan,
    sourceBytes: new Uint8Array([0, 15, 255]),
    authorizationFence: fence,
  })).resolves.toEqual({
    status: 'completed',
    authorizationRevision: fence.authorizationRevision,
  });
  expect(fixture.calls).toHaveLength(1);
  expect(fixture.calls[0]).toMatchObject({
    schemaName: 'climate_vote',
    rpcName: 'design_provision',
    retryEnabled: false,
    args: {
      p_plan: plan,
      p_source_bytes: '\\x000fff',
      p_authorization_fence: fence,
    },
  });
  expect(fixture.calls[0].signal).toBeInstanceOf(AbortSignal);
});

test('maps reconciliation only when query and fence identities match exactly', async () => {
  const fence = authorizationFence();
  const query = reconciliationQuery();
  const fixture = recordingClient(() => ({
    data: { status: 'pending', authorizationRevision: fence.authorizationRevision },
    error: null,
  }));
  const { reconciliationAdapter } = createSupabaseDesignProvisioningRpcAdapters({
    client: fixture.client,
    timeoutMs: 1_000,
  });

  expect(reconciliationAdapter.revisionFencedReconciliation).toBe(true);
  await expect(reconciliationAdapter.reconcile({
    query,
    authorizationFence: fence,
  })).resolves.toEqual({
    status: 'pending',
    authorizationRevision: fence.authorizationRevision,
  });
  expect(fixture.calls).toHaveLength(1);
  expect(fixture.calls[0]).toMatchObject({
    schemaName: 'climate_vote',
    rpcName: 'design_provisioning_status',
    retryEnabled: false,
    args: {
      p_query: query,
      p_authorization_fence: fence,
    },
  });

  await expect(reconciliationAdapter.reconcile({
    query,
    authorizationFence: authorizationFence({
      executionId: '50000000-0000-4000-8000-000000000001',
    }),
  })).rejects.toThrow('Supabase design provisioning reconciliation request is invalid');
  expect(fixture.calls).toHaveLength(1);
});

test('rejects malformed adapters, options, fences, and source bytes before RPC access', async () => {
  expect(() => createSupabaseDesignProvisioningRpcAdapters()).toThrow(
    'Supabase design provisioning adapter options are invalid',
  );
  expect(() => createSupabaseDesignProvisioningRpcAdapters({ client: {} })).toThrow(
    'Supabase design provisioning client is invalid',
  );
  const fixture = recordingClient(() => ({ data: null, error: null }));
  expect(() => createSupabaseDesignProvisioningRpcAdapters({
    client: fixture.client,
    timeoutMs: 0,
  })).toThrow('Supabase design provisioning timeout is invalid');
  expect(() => createSupabaseDesignProvisioningRpcAdapters({
    client: fixture.client,
    unexpected: true,
  })).toThrow('Supabase design provisioning adapter options are invalid');

  const { executionAdapter } = createSupabaseDesignProvisioningRpcAdapters({
    client: fixture.client,
  });
  await expect(executionAdapter.execute({
    plan: {},
    sourceBytes: 'not-bytes',
    authorizationFence: authorizationFence(),
  })).rejects.toThrow('Supabase design provisioning execution request is invalid');
  await expect(executionAdapter.execute({
    plan: {},
    sourceBytes: new Uint8Array([1]),
    authorizationFence: authorizationFence({ extra: true }),
  })).rejects.toThrow('Supabase design provisioning execution request is invalid');
  await expect(executionAdapter.execute({
    plan: { operations: new Array(1) },
    sourceBytes: new Uint8Array([1]),
    authorizationFence: authorizationFence(),
  })).rejects.toThrow('Supabase design provisioning execution request is invalid');
  await expect(executionAdapter.execute({
    plan: {},
    sourceBytes: new Uint8Array(1_000_001),
    authorizationFence: authorizationFence(),
  })).rejects.toThrow('Supabase design provisioning execution request is invalid');
  expect(fixture.calls).toHaveLength(0);
});

test('fails closed on RPC errors, thrown values, and revision-mismatched responses without retry', async () => {
  const fence = authorizationFence();
  const secret = 'raw-server-detail-must-not-leak';
  const errorFixture = recordingClient(() => ({
    data: null,
    error: { message: secret, details: secret, hint: secret },
  }));
  const { executionAdapter: errorAdapter } = createSupabaseDesignProvisioningRpcAdapters({
    client: errorFixture.client,
  });
  const request = {
    plan: {},
    sourceBytes: new Uint8Array([1]),
    authorizationFence: fence,
  };
  let observedError;
  try {
    await errorAdapter.execute(request);
  } catch (error) {
    observedError = error;
  }
  expect(observedError).toBeInstanceOf(Error);
  expect(observedError.message).toBe('Supabase design provisioning RPC failed');
  expect(observedError.message).not.toContain(secret);
  expect(errorFixture.calls).toHaveLength(1);

  const thrownFixture = recordingClient(() => {
    throw new Error(secret);
  });
  const { executionAdapter: thrownAdapter } = createSupabaseDesignProvisioningRpcAdapters({
    client: thrownFixture.client,
  });
  await expect(thrownAdapter.execute(request)).rejects.toThrow(
    'Supabase design provisioning RPC failed',
  );
  expect(thrownFixture.calls).toHaveLength(1);

  const mismatchFixture = recordingClient(() => ({
    data: { status: 'completed', authorizationRevision: 'f'.repeat(64) },
    error: null,
  }));
  const { executionAdapter: mismatchAdapter } = createSupabaseDesignProvisioningRpcAdapters({
    client: mismatchFixture.client,
  });
  await expect(mismatchAdapter.execute(request)).rejects.toThrow(
    'Supabase design provisioning RPC response is invalid',
  );
  expect(mismatchFixture.calls).toHaveLength(1);
});

test('does not expose an unfenced execution or reconciliation method', () => {
  const fixture = recordingClient(() => ({ data: null, error: null }));
  const adapters = createSupabaseDesignProvisioningRpcAdapters({ client: fixture.client });
  expect(Object.keys(adapters).sort()).toEqual(['executionAdapter', 'reconciliationAdapter']);
  expect(Object.keys(adapters.executionAdapter).sort()).toEqual([
    'execute',
    'revisionFencedExecution',
  ]);
  expect(Object.keys(adapters.reconciliationAdapter).sort()).toEqual([
    'reconcile',
    'revisionFencedReconciliation',
  ]);
  expect(fixture.calls).toHaveLength(0);
});
