import { DESIGN_BLUEPRINT_CONTRACT } from './platform-design-provisioning-plan.mjs';

const SCHEMA = 'climate_vote';
const EXECUTION_RPC = 'design_provision';
const RECONCILIATION_RPC = 'design_provisioning_status';
const DEFAULT_TIMEOUT_MS = 20_000;
const MAX_TIMEOUT_MS = 60_000;
const MAX_JSON_BYTES = 16 * 1024 * 1024;
const MAX_SOURCE_BYTES = DESIGN_BLUEPRINT_CONTRACT.limits.importBytes;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export const DESIGN_PROVISIONING_SUPABASE_ADAPTER_BOUNDARIES = Object.freeze({
  schema: SCHEMA,
  executionRpc: EXECUTION_RPC,
  reconciliationRpc: RECONCILIATION_RPC,
  timeoutMs: DEFAULT_TIMEOUT_MS,
  retries: 0,
  requiresAuthenticatedSession: true,
  activatesPrivileges: false,
  readsEnvironment: false,
});

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value, expected) {
  return isRecord(value)
    && Object.keys(value).sort().join('\u0000') === [...expected].sort().join('\u0000');
}

function isJsonValue(value, seen = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) {
    if (seen.has(value)) return false;
    const keys = Object.keys(value);
    if (Reflect.ownKeys(value).length !== value.length + 1
      || keys.length !== value.length
      || keys.some((key, index) => key !== String(index))) {
      return false;
    }
    seen.add(value);
    const valid = keys.every((key) => isJsonValue(value[key], seen));
    seen.delete(value);
    return valid;
  }
  if (!isRecord(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  if (seen.has(value)) return false;
  const keys = Object.keys(value);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(value).length !== keys.length
    || keys.some((key) => !descriptors[key]?.enumerable || !('value' in descriptors[key]))) {
    return false;
  }
  seen.add(value);
  const valid = keys.every(
    (key) => key.length > 0 && isJsonValue(descriptors[key].value, seen),
  );
  seen.delete(value);
  return valid;
}

function cloneJsonObject(value) {
  if (!isRecord(value) || !isJsonValue(value)) return null;
  const json = JSON.stringify(value);
  if (Buffer.byteLength(json, 'utf8') > MAX_JSON_BYTES) return null;
  return JSON.parse(json);
}

function validAuthorizationFence(value) {
  return exactKeys(value, [
    'approvalId',
    'authorizationRevision',
    'executionId',
    'kind',
    'schemaVersion',
  ])
    && value.schemaVersion === 1
    && value.kind === 'platform_design_provisioning_authorization_fence'
    && UUID_V4_PATTERN.test(value.approvalId ?? '')
    && UUID_V4_PATTERN.test(value.executionId ?? '')
    && SHA256_PATTERN.test(value.authorizationRevision ?? '');
}

function sourceBytesToPostgresHex(value) {
  if (!(value instanceof Uint8Array)
    || value.byteLength < 1
    || value.byteLength > MAX_SOURCE_BYTES) {
    return null;
  }
  return `\\x${Buffer.from(value.buffer, value.byteOffset, value.byteLength).toString('hex')}`;
}

function validateOptions(options) {
  if (!exactKeys(options, ['client']) && !exactKeys(options, ['client', 'timeoutMs'])) {
    throw new Error('Supabase design provisioning adapter options are invalid');
  }
  if (!isRecord(options.client) || typeof options.client.schema !== 'function') {
    throw new Error('Supabase design provisioning client is invalid');
  }
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_TIMEOUT_MS) {
    throw new Error('Supabase design provisioning timeout is invalid');
  }
  return { client: options.client, timeoutMs };
}

async function invokeRpc({ client, timeoutMs, rpcName, args, expectedRevision }) {
  let result;
  try {
    const schemaClient = client.schema(SCHEMA);
    if (!isRecord(schemaClient) || typeof schemaClient.rpc !== 'function') {
      throw new Error('invalid schema client');
    }
    const builder = schemaClient.rpc(rpcName, args);
    if (!isRecord(builder)
      || typeof builder.retry !== 'function'
      || typeof builder.abortSignal !== 'function') {
      throw new Error('invalid RPC builder');
    }
    const noRetryBuilder = builder.retry(false);
    if (!isRecord(noRetryBuilder) || typeof noRetryBuilder.abortSignal !== 'function') {
      throw new Error('invalid retry builder');
    }
    result = await noRetryBuilder.abortSignal(AbortSignal.timeout(timeoutMs));
  } catch {
    throw new Error('Supabase design provisioning RPC failed');
  }
  if (!isRecord(result)
    || !Object.prototype.hasOwnProperty.call(result, 'data')
    || !Object.prototype.hasOwnProperty.call(result, 'error')) {
    throw new Error('Supabase design provisioning RPC response is invalid');
  }
  if (result.error !== null) {
    throw new Error('Supabase design provisioning RPC failed');
  }
  const data = cloneJsonObject(result.data);
  if (!data || data.authorizationRevision !== expectedRevision) {
    throw new Error('Supabase design provisioning RPC response is invalid');
  }
  return data;
}

export function createSupabaseDesignProvisioningRpcAdapters(options) {
  const { client, timeoutMs } = validateOptions(options);

  const executionAdapter = Object.freeze({
    revisionFencedExecution: true,
    async execute(request) {
      if (!exactKeys(request, ['authorizationFence', 'plan', 'sourceBytes'])
        || !validAuthorizationFence(request.authorizationFence)) {
        throw new Error('Supabase design provisioning execution request is invalid');
      }
      const plan = cloneJsonObject(request.plan);
      const sourceBytes = sourceBytesToPostgresHex(request.sourceBytes);
      if (!plan || sourceBytes === null) {
        throw new Error('Supabase design provisioning execution request is invalid');
      }
      const authorizationFence = structuredClone(request.authorizationFence);
      return invokeRpc({
        client,
        timeoutMs,
        rpcName: EXECUTION_RPC,
        args: {
          p_plan: plan,
          p_source_bytes: sourceBytes,
          p_authorization_fence: authorizationFence,
        },
        expectedRevision: authorizationFence.authorizationRevision,
      });
    },
  });

  const reconciliationAdapter = Object.freeze({
    revisionFencedReconciliation: true,
    async reconcile(request) {
      if (!exactKeys(request, ['authorizationFence', 'query'])
        || !validAuthorizationFence(request.authorizationFence)) {
        throw new Error('Supabase design provisioning reconciliation request is invalid');
      }
      const query = cloneJsonObject(request.query);
      if (!query
        || query.approvalId !== request.authorizationFence.approvalId
        || query.executionId !== request.authorizationFence.executionId) {
        throw new Error('Supabase design provisioning reconciliation request is invalid');
      }
      const authorizationFence = structuredClone(request.authorizationFence);
      return invokeRpc({
        client,
        timeoutMs,
        rpcName: RECONCILIATION_RPC,
        args: {
          p_query: query,
          p_authorization_fence: authorizationFence,
        },
        expectedRevision: authorizationFence.authorizationRevision,
      });
    },
  });

  return Object.freeze({ executionAdapter, reconciliationAdapter });
}
