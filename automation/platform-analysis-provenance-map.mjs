import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  validatePlatformAnalysisImportPrivateInputPath,
  validatePlatformAnalysisImportPrivateOutputPath,
} from './platform-analysis-import.mjs';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SOURCE_UID_PATTERN = /^(?<team>.+)\/k(?<topicOrdinal>[1-9]\d*)\/i(?<itemOrdinal>\d+)$/u;
const SOURCE_FIELDS = new Set(['uid', 'team', 'topic', 'topic_no', 'text']);
const MAX_JSON_BYTES = 16 * 1024 * 1024;

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

function sourceCoordinates(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some((field) => !SOURCE_FIELDS.has(field))) {
    throw new Error('Invalid analysis source fields');
  }
  const uid = requireText(value.uid, 'analysis source UID');
  const match = SOURCE_UID_PATTERN.exec(uid);
  if (!match?.groups) throw new Error('Invalid analysis source UID');
  const team = requireText(value.team, 'analysis source team');
  const topicOrdinal = requirePositiveInteger(value.topic_no, 'analysis source topic ordinal');
  const itemOrdinal = requirePositiveInteger(
    Number.parseInt(match.groups.itemOrdinal, 10),
    'analysis source item ordinal',
  );
  if (match.groups.team !== team || Number.parseInt(match.groups.topicOrdinal, 10) !== topicOrdinal) {
    throw new Error('Analysis source UID does not match its coordinates');
  }
  requireText(value.topic, 'analysis source topic');
  return { uid, team, topicOrdinal, itemOrdinal, text: requireText(value.text, 'analysis source text') };
}

function submissionCoordinates(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid submission export row');
  }
  return {
    topicId: requireUuid(value.topic_id, 'submission topic UUID'),
    topicOrdinal: requirePositiveInteger(value.topic_ordinal, 'submission topic ordinal'),
    team: requireText(value.team_name, 'submission team'),
    itemId: requireUuid(value.item_id, 'submission item UUID'),
    itemOrdinal: requirePositiveInteger(value.item_ordinal, 'submission item ordinal'),
    text: requireText(value.item_content, 'submission item content'),
    clusterId: value.cluster_id == null ? null : requireUuid(value.cluster_id, 'submission cluster UUID'),
  };
}

function coordinateKey({ team, topicOrdinal, itemOrdinal }) {
  return JSON.stringify([team, topicOrdinal, itemOrdinal]);
}

export function buildPlatformAnalysisProvenanceMap({ topicId, analysisSources, submissionRows }) {
  const selectedTopicId = requireUuid(topicId, 'topicId');
  if (!Array.isArray(analysisSources) || analysisSources.length === 0) {
    throw new Error('Analysis sources must be a non-empty array');
  }
  if (!Array.isArray(submissionRows) || submissionRows.length === 0) {
    throw new Error('Submission export must be a non-empty array');
  }

  const submissionsByCoordinate = new Map();
  for (const rawSubmission of submissionRows) {
    const submissionRow = submissionCoordinates(rawSubmission);
    const key = coordinateKey(submissionRow);
    if (submissionsByCoordinate.has(key)) throw new Error('Duplicate submission coordinates');
    submissionsByCoordinate.set(key, submissionRow);
  }

  const seenUids = new Set();
  const sourceMappings = [];
  for (const rawSource of analysisSources) {
    const analysisSource = sourceCoordinates(rawSource);
    if (seenUids.has(analysisSource.uid)) throw new Error('Duplicate analysis source UID');
    seenUids.add(analysisSource.uid);
    const submissionRow = submissionsByCoordinate.get(coordinateKey(analysisSource));
    if (!submissionRow) throw new Error('Missing submission row for analysis source');
    if (submissionRow.text !== analysisSource.text) {
      throw new Error('Analysis source text does not match submission item content');
    }
    if (submissionRow.topicId !== selectedTopicId) continue;
    sourceMappings.push({
      sourceUid: analysisSource.uid,
      itemId: submissionRow.itemId,
      clusterId: submissionRow.clusterId,
    });
  }
  if (sourceMappings.length === 0) throw new Error('No analysis sources matched the selected topic');
  return { schemaVersion: 1, topicId: selectedTopicId, sourceMappings };
}

function readPrivateJson(path, label) {
  const resolvedPath = validatePlatformAnalysisImportPrivateInputPath(path, label);
  const expectedBytes = statSync(resolvedPath).size;
  if (expectedBytes < 1 || expectedBytes > MAX_JSON_BYTES) throw new Error(`Invalid ${label} input size`);
  const source = readFileSync(resolvedPath);
  if (source.length !== expectedBytes) throw new Error(`${label} input changed while reading`);
  try {
    return JSON.parse(source.toString('utf8'));
  } catch {
    throw new Error(`Invalid ${label} JSON`);
  }
}

function submissionRows(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object' && !Array.isArray(value) && Array.isArray(value.submissions)) {
    return value.submissions;
  }
  throw new Error('Invalid submission export JSON');
}

function parseArguments(argv) {
  const options = {};
  const valueArguments = new Map([
    ['--analysis-sources', 'analysisSourcesPath'],
    ['--submission-export', 'submissionExportPath'],
    ['--topic-id', 'topicId'],
    ['--output', 'outputPath'],
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--force') {
      if (options.force === true) throw new Error('Duplicate --force argument');
      options.force = true;
      continue;
    }
    const property = valueArguments.get(argument);
    if (!property || index + 1 >= argv.length || options[property] != null) {
      throw new Error(property ? `Duplicate ${argument} argument` : 'Invalid provenance map arguments');
    }
    options[property] = argv[index + 1];
    index += 1;
  }
  if (!options.analysisSourcesPath || !options.submissionExportPath || !options.topicId || !options.outputPath) {
    throw new Error('Missing provenance map arguments');
  }
  return options;
}

export function runPlatformAnalysisProvenanceMapCli(argv) {
  const options = parseArguments(argv);
  const analysisSources = readPrivateJson(options.analysisSourcesPath, 'analysis sources');
  const exportedSubmissions = submissionRows(readPrivateJson(options.submissionExportPath, 'submission export'));
  const outputPath = validatePlatformAnalysisImportPrivateOutputPath(options.outputPath);
  if (existsSync(outputPath) && options.force !== true) throw new Error('Provenance map output already exists');
  const provenanceMap = buildPlatformAnalysisProvenanceMap({
    topicId: options.topicId,
    analysisSources,
    submissionRows: exportedSubmissions,
  });
  const outputSource = `${JSON.stringify(provenanceMap, null, 2)}\n`;
  if (Buffer.byteLength(outputSource, 'utf8') > MAX_JSON_BYTES) {
    throw new Error('Generated provenance map exceeds the size limit');
  }
  writeFileSync(outputPath, outputSource, {
    encoding: 'utf8',
    flag: options.force === true ? 'w' : 'wx',
    mode: 0o600,
  });
  return { status: 'generated', mappingCount: provenanceMap.sourceMappings.length };
}

const isCli = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  try {
    process.stdout.write(`${JSON.stringify(runPlatformAnalysisProvenanceMapCli(process.argv.slice(2)))}\n`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Provenance map generation failed');
    process.exitCode = 1;
  }
}
