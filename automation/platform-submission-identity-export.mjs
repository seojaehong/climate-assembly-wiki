import { existsSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validatePlatformAnalysisImportPrivateOutputPath } from './platform-analysis-import.mjs';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SESSION_SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,78}[a-z0-9])?$/;
const PROJECT_REF_PATTERN = /^[a-z0-9]{20}$/;
const PAGE_SIZE = 500;
const MAX_ROWS = 10_000;
const MAX_JSON_BYTES = 16 * 1024 * 1024;
const ACCESS_METHODS = new Set(['direct_tables', 'read_only_rpc']);
const RPC_SOURCE_FIELDS = new Set([
  'schemaVersion', 'sessions', 'topics', 'teams', 'submissions', 'items',
]);

function requireUuid(value, label) {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) throw new Error(`Invalid ${label}`);
  return value.toLowerCase();
}

function requireText(value, label) {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`Invalid ${label}`);
  return value;
}

function requirePositiveInteger(value, label) {
  if (!Number.isInteger(value) || value < 1) throw new Error(`Invalid ${label}`);
  return value;
}

function requireSessionSlug(value) {
  if (typeof value !== 'string' || !SESSION_SLUG_PATTERN.test(value)) {
    throw new Error('Invalid session slug');
  }
  return value;
}

function requireIsoTimestamp(value) {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
    throw new Error('Invalid export timestamp');
  }
  return value;
}

function requireUniqueRows(rows, key, label) {
  const seen = new Set();
  for (const row of rows) {
    const value = key(row);
    if (seen.has(value)) throw new Error(`Duplicate ${label}`);
    seen.add(value);
  }
}

export function buildSubmissionIdentityExport({
  sourceProjectRef,
  sourceAccessMethod,
  sessionSlug,
  exportedAt,
  sessions,
  topics,
  teams,
  submissions,
  items,
}) {
  if (typeof sourceProjectRef !== 'string' || !PROJECT_REF_PATTERN.test(sourceProjectRef)) {
    throw new Error('Invalid source project ref');
  }
  if (!ACCESS_METHODS.has(sourceAccessMethod)) throw new Error('Invalid source access method');
  const selectedSessionSlug = requireSessionSlug(sessionSlug);
  const selectedExportedAt = requireIsoTimestamp(exportedAt);
  if (!Array.isArray(sessions) || sessions.length !== 1) {
    throw new Error('Expected exactly one session');
  }
  const session = sessions[0];
  const sessionId = requireUuid(session?.id, 'session UUID');
  if (session?.slug !== selectedSessionSlug) throw new Error('Session slug does not match export target');
  if (![topics, teams, submissions, items].every(Array.isArray)) {
    throw new Error('Invalid submission identity source rows');
  }

  const topicById = new Map(topics.map((topic) => {
    const id = requireUuid(topic?.id, 'topic UUID');
    if (requireUuid(topic?.session_id, 'topic session UUID') !== sessionId) {
      throw new Error('Topic belongs to another session');
    }
    return [id, { id, ordinal: requirePositiveInteger(topic?.ordinal, 'topic ordinal') }];
  }));
  const teamById = new Map(teams.map((team) => {
    const id = requireUuid(team?.id, 'team UUID');
    if (requireUuid(team?.session_id, 'team session UUID') !== sessionId) {
      throw new Error('Team belongs to another session');
    }
    if (team?.status !== 'active') throw new Error('Identity export contains an inactive team');
    return [id, { id, name: requireText(team?.name, 'team name') }];
  }));
  requireUniqueRows(topics, (row) => requireUuid(row.id, 'topic UUID'), 'topic UUID');
  requireUniqueRows(topics, (row) => requirePositiveInteger(row.ordinal, 'topic ordinal'), 'topic ordinal');
  requireUniqueRows(teams, (row) => requireUuid(row.id, 'team UUID'), 'team UUID');
  requireUniqueRows(teams, (row) => requireText(row.name, 'team name'), 'team name');

  const submissionById = new Map(submissions.map((submission) => {
    const id = requireUuid(submission?.id, 'submission UUID');
    const topicId = requireUuid(submission?.topic_id, 'submission topic UUID');
    const teamId = requireUuid(submission?.team_id, 'submission team UUID');
    if (!topicById.has(topicId) || !teamById.has(teamId)) {
      throw new Error('Submission belongs to another session');
    }
    if (submission?.archived_at != null) throw new Error('Identity export contains an archived submission');
    return [id, { id, topicId, teamId }];
  }));
  requireUniqueRows(submissions, (row) => requireUuid(row.id, 'submission UUID'), 'submission UUID');
  requireUniqueRows(
    submissions,
    (row) => JSON.stringify([
      requireUuid(row.topic_id, 'submission topic UUID'),
      requireUuid(row.team_id, 'submission team UUID'),
    ]),
    'submission topic and team coordinates',
  );

  const exportedRows = items.map((item) => {
    const itemId = requireUuid(item?.id, 'submission item UUID');
    const submissionId = requireUuid(item?.submission_id, 'item submission UUID');
    const submission = submissionById.get(submissionId);
    if (!submission) throw new Error('Submission item belongs to another session');
    const topic = topicById.get(submission.topicId);
    const team = teamById.get(submission.teamId);
    return {
      topic_id: topic.id,
      topic_ordinal: topic.ordinal,
      team_name: team.name,
      item_id: itemId,
      item_ordinal: requirePositiveInteger(item?.ordinal, 'submission item ordinal'),
      item_content: requireText(item?.content, 'submission item content'),
      cluster_id: null,
    };
  });
  if (exportedRows.length === 0) throw new Error('No submission items found for the selected session');
  requireUniqueRows(exportedRows, (row) => row.item_id, 'submission item UUID');
  requireUniqueRows(
    exportedRows,
    (row) => JSON.stringify([row.team_name, row.topic_ordinal, row.item_ordinal]),
    'submission item coordinates',
  );
  exportedRows.sort((left, right) => (
    left.topic_ordinal - right.topic_ordinal
    || left.team_name.localeCompare(right.team_name, 'ko')
    || left.item_ordinal - right.item_ordinal
  ));
  return {
    schemaVersion: 1,
    identityScope: 'current_submission_item',
    historicalArchiveIncluded: false,
    sourceProjectRef,
    sourceAccessMethod,
    sessionId,
    sessionSlug: selectedSessionSlug,
    exportedAt: selectedExportedAt,
    rowCount: exportedRows.length,
    submissions: exportedRows,
  };
}

async function readPages(resource, queryPage) {
  const rows = [];
  for (let offset = 0; offset < MAX_ROWS; offset += PAGE_SIZE) {
    const { data, error } = await queryPage(offset, offset + PAGE_SIZE - 1);
    if (error) throw new Error(`Read-only export failed for ${resource}`);
    if (!Array.isArray(data)) throw new Error(`Invalid read-only export response for ${resource}`);
    rows.push(...data);
    if (data.length < PAGE_SIZE) return rows;
  }
  throw new Error(`Read-only export exceeded the row limit for ${resource}`);
}

export async function readSubmissionIdentitySource({ client, sessionSlug }) {
  const selectedSessionSlug = requireSessionSlug(sessionSlug);
  const sessions = await readPages('session', (from, to) => client
    .schema('climate_vote')
    .from('session')
    .select('id,slug')
    .eq('slug', selectedSessionSlug)
    .order('id')
    .range(from, to));
  if (sessions.length !== 1) throw new Error('Expected exactly one session');
  const sessionId = requireUuid(sessions[0]?.id, 'session UUID');
  const [topics, teams] = await Promise.all([
    readPages('discussion_topic', (from, to) => client
      .schema('climate_vote')
      .from('discussion_topic')
      .select('id,session_id,ordinal')
      .eq('session_id', sessionId)
      .is('archived_at', null)
      .order('ordinal')
      .range(from, to)),
    readPages('team', (from, to) => client
      .schema('climate_vote')
      .from('team')
      .select('id,session_id,name,status')
      .eq('session_id', sessionId)
      .eq('status', 'active')
      .order('name')
      .order('id')
      .range(from, to)),
  ]);
  const topicIds = topics.map((topic) => requireUuid(topic?.id, 'topic UUID'));
  if (topicIds.length === 0) throw new Error('No topics found for the selected session');
  const submissions = await readPages('submission', (from, to) => client
    .schema('climate_vote')
    .from('submission')
    .select('id,topic_id,team_id,archived_at')
    .in('topic_id', topicIds)
    .is('archived_at', null)
    .order('id')
    .range(from, to));
  const submissionIds = submissions.map((submission) => requireUuid(submission?.id, 'submission UUID'));
  if (submissionIds.length === 0) throw new Error('No submissions found for the selected session');
  const items = await readPages('submission_item', (from, to) => client
    .schema('climate_vote')
    .from('submission_item')
    .select('id,submission_id,ordinal,content')
    .in('submission_id', submissionIds)
    .order('submission_id')
    .order('ordinal')
    .range(from, to));
  return { sessions, topics, teams, submissions, items };
}

export async function readSubmissionIdentitySourceFromRpc({ client, sessionSlug }) {
  const selectedSessionSlug = requireSessionSlug(sessionSlug);
  const { data, error } = await client
    .schema('climate_vote')
    .rpc('platform_submission_identity_source', { p_session_slug: selectedSessionSlug });
  if (error) throw new Error('Read-only identity RPC failed');
  if (!data || typeof data !== 'object' || Array.isArray(data)
    || data.schemaVersion !== 1
    || Object.keys(data).some((field) => !RPC_SOURCE_FIELDS.has(field))
    || ![data.sessions, data.topics, data.teams, data.submissions, data.items].every(Array.isArray)) {
    throw new Error('Invalid read-only RPC response');
  }
  return {
    sessions: data.sessions,
    topics: data.topics,
    teams: data.teams,
    submissions: data.submissions,
    items: data.items,
  };
}

function targetProjectRef(url, expectedProjectRef) {
  if (typeof expectedProjectRef !== 'string' || !PROJECT_REF_PATTERN.test(expectedProjectRef)) {
    throw new Error('Expected Supabase project ref is missing or invalid');
  }
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('Supabase URL is invalid');
  }
  if (parsed.protocol !== 'https:' || parsed.hostname !== `${expectedProjectRef}.supabase.co`) {
    throw new Error('Supabase URL does not match the expected project ref');
  }
  return expectedProjectRef;
}

function parseArguments(argv) {
  const options = {};
  const argumentsWithValues = new Map([
    ['--session-slug', 'sessionSlug'],
    ['--output', 'outputPath'],
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const property = argumentsWithValues.get(argv[index]);
    if (!property || index + 1 >= argv.length || options[property] != null) {
      throw new Error('Invalid submission identity export arguments');
    }
    options[property] = argv[index + 1];
    index += 1;
  }
  if (!options.sessionSlug || !options.outputPath) throw new Error('Missing submission identity export arguments');
  return options;
}

function writePrivateExport(path, value) {
  const outputPath = validatePlatformAnalysisImportPrivateOutputPath(path);
  if (existsSync(outputPath)) throw new Error('Submission identity export already exists');
  const temporaryPath = `${outputPath}.${process.pid}.tmp`;
  const source = `${JSON.stringify(value, null, 2)}\n`;
  if (Buffer.byteLength(source, 'utf8') > MAX_JSON_BYTES) {
    throw new Error('Submission identity export exceeds the size limit');
  }
  try {
    writeFileSync(temporaryPath, source, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    renameSync(temporaryPath, outputPath);
  } catch (error) {
    if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
    throw new Error('Submission identity export could not be written', { cause: error });
  }
}

export async function runSubmissionIdentityExportCli({
  argv,
  environment,
  createClient,
  exportedAt = new Date().toISOString(),
}) {
  const options = parseArguments(argv);
  const url = environment.SUPABASE_URL;
  const serviceRoleKey = environment.SUPABASE_SERVICE_ROLE_KEY ?? environment.SUPABASE_SERVICE_ROLE;
  if (typeof url !== 'string' || url.length === 0 || typeof serviceRoleKey !== 'string' || serviceRoleKey.length === 0) {
    throw new Error('Submission identity export credentials are missing');
  }
  const projectRef = targetProjectRef(url, environment.PLATFORM_EXPORT_EXPECTED_PROJECT_REF);
  const accessMethod = environment.PLATFORM_EXPORT_ACCESS_METHOD ?? 'direct_tables';
  if (!ACCESS_METHODS.has(accessMethod)) throw new Error('Submission identity export access method is invalid');
  const client = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const source = accessMethod === 'read_only_rpc'
    ? await readSubmissionIdentitySourceFromRpc({ client, sessionSlug: options.sessionSlug })
    : await readSubmissionIdentitySource({ client, sessionSlug: options.sessionSlug });
  const exported = buildSubmissionIdentityExport({
    sourceProjectRef: projectRef,
    sourceAccessMethod: accessMethod,
    sessionSlug: options.sessionSlug,
    exportedAt,
    ...source,
  });
  writePrivateExport(options.outputPath, exported);
  return {
    status: 'exported',
    projectRef,
    sessionSlug: exported.sessionSlug,
    rowCount: exported.rowCount,
    accessMethod,
    databaseMutationExecuted: false,
  };
}

const isCli = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  try {
    const { createClient } = await import('@supabase/supabase-js');
    const result = await runSubmissionIdentityExportCli({
      argv: process.argv.slice(2),
      environment: process.env,
      createClient,
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Submission identity export failed');
    process.exitCode = 1;
  }
}
