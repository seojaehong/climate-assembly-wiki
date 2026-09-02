import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import {
  buildSubmissionIdentityExport,
  readSubmissionIdentitySource,
  readSubmissionIdentitySourceFromRpc,
  runSubmissionIdentityExportCli,
} from '../platform-submission-identity-export.mjs';
import { buildPlatformAnalysisProvenanceMap } from '../platform-analysis-provenance-map.mjs';

const ids = {
  session: '11111111-1111-4111-8111-111111111111',
  topic: '21111111-1111-4111-8111-111111111111',
  team: '31111111-1111-4111-8111-111111111111',
  submission: '41111111-1111-4111-8111-111111111111',
  item: '51111111-1111-4111-8111-111111111111',
};

function sourceRows(overrides = {}) {
  return {
    sessions: [{ id: ids.session, slug: '0829-deliberation' }],
    topics: [{ id: ids.topic, session_id: ids.session, ordinal: 1 }],
    teams: [{ id: ids.team, session_id: ids.session, name: '1분과 1조', status: 'active' }],
    submissions: [{
      id: ids.submission,
      topic_id: ids.topic,
      team_id: ids.team,
      archived_at: null,
    }],
    items: [{
      id: ids.item,
      submission_id: ids.submission,
      ordinal: 1,
      content: '원문 한 줄',
    }],
    ...overrides,
  };
}

test('builds the minimal provenance export and sorts by source coordinates', () => {
  const result = buildSubmissionIdentityExport({
    sourceProjectRef: 'pleyuknjnprsckssxvrh',
    sourceAccessMethod: 'direct_tables',
    sessionSlug: '0829-deliberation',
    exportedAt: '2026-09-03T00:00:00.000Z',
    ...sourceRows(),
  });
  expect(result).toEqual({
    schemaVersion: 1,
    identityScope: 'current_submission_item',
    historicalArchiveIncluded: false,
    sourceProjectRef: 'pleyuknjnprsckssxvrh',
    sourceAccessMethod: 'direct_tables',
    sessionId: ids.session,
    sessionSlug: '0829-deliberation',
    exportedAt: '2026-09-03T00:00:00.000Z',
    rowCount: 1,
    submissions: [{
      topic_id: ids.topic,
      topic_ordinal: 1,
      team_name: '1분과 1조',
      item_id: ids.item,
      item_ordinal: 1,
      item_content: '원문 한 줄',
      cluster_id: null,
    }],
  });
  expect(JSON.stringify(result)).not.toContain('join_code');
  expect(JSON.stringify(result)).not.toContain('rationale');
  expect(buildPlatformAnalysisProvenanceMap({
    topicId: ids.topic,
    analysisSources: [{
      uid: '1분과 1조/k1/i1',
      team: '1분과 1조',
      topic: '배경과 문제',
      topic_no: 1,
      text: '원문 한 줄',
    }],
    submissionRows: result.submissions,
  }).sourceMappings).toEqual([{
    sourceUid: '1분과 1조/k1/i1',
    itemId: ids.item,
    clusterId: null,
  }]);
});

test('fails closed on cross-session rows, archived submissions, and duplicate coordinates', () => {
  expect(() => buildSubmissionIdentityExport({
    sourceProjectRef: 'pleyuknjnprsckssxvrh',
    sourceAccessMethod: 'direct_tables',
    sessionSlug: '0829-deliberation',
    exportedAt: '2026-09-03T00:00:00.000Z',
    ...sourceRows({ topics: [{ id: ids.topic, session_id: ids.team, ordinal: 1 }] }),
  })).toThrow('another session');
  expect(() => buildSubmissionIdentityExport({
    sourceProjectRef: 'pleyuknjnprsckssxvrh',
    sourceAccessMethod: 'direct_tables',
    sessionSlug: '0829-deliberation',
    exportedAt: '2026-09-03T00:00:00.000Z',
    ...sourceRows({
      submissions: [{
        id: ids.submission,
        topic_id: ids.topic,
        team_id: ids.team,
        archived_at: '2026-09-03T00:00:00.000Z',
      }],
    }),
  })).toThrow('archived submission');
  expect(() => buildSubmissionIdentityExport({
    sourceProjectRef: 'pleyuknjnprsckssxvrh',
    sourceAccessMethod: 'direct_tables',
    sessionSlug: '0829-deliberation',
    exportedAt: '2026-09-03T00:00:00.000Z',
    ...sourceRows({
      items: [sourceRows().items[0], {
        ...sourceRows().items[0],
        id: '52222222-2222-4222-8222-222222222222',
      }],
    }),
  })).toThrow('submission item coordinates');
});

function fakeClient(rowsByTable, calls) {
  return {
    schema(schema) {
      calls.push(['schema', schema]);
      return {
        from(table) {
          calls.push(['from', table]);
          const builder = {
            select(columns) { calls.push(['select', table, columns]); return builder; },
            eq(column, value) { calls.push(['eq', table, column, value]); return builder; },
            is(column, value) { calls.push(['is', table, column, value]); return builder; },
            in(column, value) { calls.push(['in', table, column, value]); return builder; },
            order(column) { calls.push(['order', table, column]); return builder; },
            range(from, to) {
              calls.push(['range', table, from, to]);
              return Promise.resolve({ data: rowsByTable[table] ?? [], error: null });
            },
          };
          return builder;
        },
      };
    },
  };
}

test('reads only the selected session hierarchy with SELECT queries', async () => {
  const rows = sourceRows();
  const calls = [];
  const result = await readSubmissionIdentitySource({
    client: fakeClient({
      session: rows.sessions,
      discussion_topic: rows.topics,
      team: rows.teams,
      submission: rows.submissions,
      submission_item: rows.items,
    }, calls),
    sessionSlug: '0829-deliberation',
  });
  expect(result.items).toEqual(rows.items);
  expect(calls.filter(([operation]) => operation === 'from').map(([, table]) => table)).toEqual([
    'session', 'discussion_topic', 'team', 'submission', 'submission_item',
  ]);
  expect(calls.some(([operation]) => ['insert', 'update', 'delete', 'rpc'].includes(operation))).toBe(false);
  expect(calls.filter(([operation]) => operation === 'schema').every(([, schema]) => schema === 'climate_vote')).toBe(true);
  expect(calls).toContainEqual(['order', 'submission', 'id']);
});

test('read failures do not expose database error details', async () => {
  const client = {
    schema() {
      return {
        from() {
          const builder = {
            select() { return builder; },
            eq() { return builder; },
            order() { return builder; },
            range() {
              return Promise.resolve({
                data: null,
                error: { message: 'private row value', code: '42501' },
              });
            },
          };
          return builder;
        },
      };
    },
  };
  await expect(readSubmissionIdentitySource({
    client,
    sessionSlug: '0829-deliberation',
  })).rejects.toThrow('Read-only export failed for session');
  try {
    await readSubmissionIdentitySource({ client, sessionSlug: '0829-deliberation' });
  } catch (error) {
    expect(error.message).not.toContain('private row value');
    expect(error.message).not.toContain('42501');
  }
});

test('reads the same validated source through the service-role-only RPC adapter', async () => {
  const rows = sourceRows();
  const calls = [];
  const client = {
    schema(schema) {
      calls.push(['schema', schema]);
      return {
        rpc(name, args) {
          calls.push(['rpc', name, args]);
          return Promise.resolve({
            data: {
              schemaVersion: 1,
              sessions: rows.sessions,
              topics: rows.topics,
              teams: rows.teams,
              submissions: rows.submissions,
              items: rows.items,
            },
            error: null,
          });
        },
      };
    },
  };
  await expect(readSubmissionIdentitySourceFromRpc({
    client,
    sessionSlug: '0829-deliberation',
  })).resolves.toEqual(rows);
  expect(calls).toEqual([
    ['schema', 'climate_vote'],
    ['rpc', 'platform_submission_identity_source', { p_session_slug: '0829-deliberation' }],
  ]);
});

test('RPC adapter rejects extra fields and hides remote failure details', async () => {
  const clientFor = (result) => ({
    schema() {
      return { rpc: () => Promise.resolve(result) };
    },
  });
  await expect(readSubmissionIdentitySourceFromRpc({
    client: clientFor({
      data: { schemaVersion: 1, ...sourceRows(), privateField: 'must not pass' },
      error: null,
    }),
    sessionSlug: '0829-deliberation',
  })).rejects.toThrow('Invalid read-only RPC response');
  try {
    await readSubmissionIdentitySourceFromRpc({
      client: clientFor({ data: null, error: { code: '42501', message: 'private detail' } }),
      sessionSlug: '0829-deliberation',
    });
  } catch (error) {
    expect(error.message).toBe('Read-only identity RPC failed');
    expect(error.message).not.toContain('private detail');
    expect(error.message).not.toContain('42501');
  }
});

test('CLI requires an exact project ref and writes the private export outside the repository', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'platform-submission-identity-export-'));
  const outputPath = join(directory, 'submission-items.json');
  const calls = [];
  const rows = sourceRows();
  const createClientCalls = [];
  const createClient = (...args) => {
    createClientCalls.push(args);
    return fakeClient({
      session: rows.sessions,
      discussion_topic: rows.topics,
      team: rows.teams,
      submission: rows.submissions,
      submission_item: rows.items,
    }, calls);
  };
  try {
    const result = await runSubmissionIdentityExportCli({
      argv: ['--session-slug', '0829-deliberation', '--output', outputPath],
      environment: {
        SUPABASE_URL: 'https://pleyuknjnprsckssxvrh.supabase.co',
        SUPABASE_SERVICE_ROLE_KEY: 'private-test-key',
        PLATFORM_EXPORT_EXPECTED_PROJECT_REF: 'pleyuknjnprsckssxvrh',
      },
      createClient,
      exportedAt: '2026-09-03T00:00:00.000Z',
    });
    expect(result).toEqual({
      status: 'exported',
      projectRef: 'pleyuknjnprsckssxvrh',
      sessionSlug: '0829-deliberation',
      rowCount: 1,
      accessMethod: 'direct_tables',
      databaseMutationExecuted: false,
    });
    expect(JSON.parse(readFileSync(outputPath, 'utf8')).submissions[0].item_id).toBe(ids.item);
    expect(createClientCalls[0][1]).toBe('private-test-key');
    await expect(runSubmissionIdentityExportCli({
      argv: ['--session-slug', '0829-deliberation', '--output', join(directory, 'wrong.json')],
      environment: {
        SUPABASE_URL: 'https://anotherprojectrefxxx.supabase.co',
        SUPABASE_SERVICE_ROLE_KEY: 'private-test-key',
        PLATFORM_EXPORT_EXPECTED_PROJECT_REF: 'pleyuknjnprsckssxvrh',
      },
      createClient,
    })).rejects.toThrow('does not match');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('CLI uses the RPC adapter only when the access method is explicit', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'platform-submission-identity-rpc-export-'));
  const outputPath = join(directory, 'submission-items.json');
  const rows = sourceRows();
  const calls = [];
  const createClient = () => ({
    schema(schema) {
      calls.push(['schema', schema]);
      return {
        rpc(name, args) {
          calls.push(['rpc', name, args]);
          return Promise.resolve({ data: { schemaVersion: 1, ...rows }, error: null });
        },
      };
    },
  });
  try {
    const result = await runSubmissionIdentityExportCli({
      argv: ['--session-slug', '0829-deliberation', '--output', outputPath],
      environment: {
        SUPABASE_URL: 'https://pleyuknjnprsckssxvrh.supabase.co',
        SUPABASE_SERVICE_ROLE_KEY: 'private-test-key',
        PLATFORM_EXPORT_EXPECTED_PROJECT_REF: 'pleyuknjnprsckssxvrh',
        PLATFORM_EXPORT_ACCESS_METHOD: 'read_only_rpc',
      },
      createClient,
      exportedAt: '2026-09-03T00:00:00.000Z',
    });
    expect(result.accessMethod).toBe('read_only_rpc');
    expect(calls.some(([operation]) => operation === 'rpc')).toBe(true);
    expect(calls.some(([operation]) => operation === 'from')).toBe(false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
