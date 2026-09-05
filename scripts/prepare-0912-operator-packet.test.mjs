import { createHash } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CANONICAL_0912_OPERATOR_BINDING_PATHS } from './0912-operator-evidence.mjs';
import {
  OperatorPacketPreparationError,
  prepare0912OperatorPacket,
  runPrepare0912OperatorPacketCli,
} from './prepare-0912-operator-packet.mjs';

const SOURCE_COMMIT = 'a'.repeat(40);
const TARGET_REVISION = 'b'.repeat(40);
const RELEASE_RUN_ID = '11111111-1111-4111-8111-111111111111';
const PRODUCTION_ENVIRONMENT = Object.freeze({
  id: 'climate-assembly-production',
  webOrigin: 'https://climate-assembly.org',
  supabaseProjectRef: 'abcdefghijklmnopqrst',
  databaseTlsSpkiSha256: '9'.repeat(64),
  organizationId: '22222222-2222-4222-8222-222222222222',
  assemblyId: '33333333-3333-4333-8333-333333333333',
  sessionId: '44444444-4444-4444-8444-444444444444',
  sessionSlug: '0912-deliberation',
});

function seedBindings(root) {
  for (const path of CANONICAL_0912_OPERATOR_BINDING_PATHS) {
    const absolutePath = resolve(root, path);
    mkdirSync(dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, `fixture:${path}`, 'utf8');
  }
}

function writeEnvironment(root, path = '.tmp-verify/0912-operator/environment.json') {
  const absolutePath = resolve(root, path);
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, JSON.stringify(PRODUCTION_ENVIRONMENT), 'utf8');
  return path;
}

function packetArguments(environmentPath, outputPath = '.tmp-verify/0912-operator/packet.json') {
  return [
    '--output', outputPath,
    '--release-run-id', RELEASE_RUN_ID,
    '--source-commit', SOURCE_COMMIT,
    '--target-revision', TARGET_REVISION,
    '--environment', environmentPath,
  ];
}

describe('9/12 operator packet preparation', () => {
  it('binds every canonical receipt and release artifact without manual path entry', () => {
    const root = mkdtempSync(join(tmpdir(), '0912-operator-prepare-'));
    try {
      seedBindings(root);
      const packet = prepare0912OperatorPacket({
        root,
        releaseRunId: RELEASE_RUN_ID,
        sourceCommit: SOURCE_COMMIT,
        targetRevision: TARGET_REVISION,
        productionEnvironment: PRODUCTION_ENVIRONMENT,
      });

      expect(packet.artifactBindings).toHaveLength(68);
      expect(packet.artifactBindings.map(({ path }) => path))
        .toEqual(CANONICAL_0912_OPERATOR_BINDING_PATHS);
      expect(packet.artifactBindings[0].sha256).toBe(createHash('sha256')
        .update(`fixture:${CANONICAL_0912_OPERATOR_BINDING_PATHS[0]}`)
        .digest('hex'));
      expect(packet.status).toBe('not_run');
      expect(packet.attestation).toBeNull();
      expect(packet.releaseRunId).toBe(RELEASE_RUN_ID);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('fails closed when one canonical artifact is absent or the run ID is invalid', () => {
    const root = mkdtempSync(join(tmpdir(), '0912-operator-prepare-missing-'));
    try {
      expect(() => prepare0912OperatorPacket({
        root,
        releaseRunId: RELEASE_RUN_ID,
        sourceCommit: SOURCE_COMMIT,
        targetRevision: TARGET_REVISION,
        productionEnvironment: PRODUCTION_ENVIRONMENT,
      })).toThrow(OperatorPacketPreparationError);
      expect(() => prepare0912OperatorPacket({
        root,
        releaseRunId: 'not-a-run-id',
        sourceCommit: SOURCE_COMMIT,
        targetRevision: TARGET_REVISION,
        productionEnvironment: PRODUCTION_ENVIRONMENT,
      })).toThrow('release_run_id_invalid');
      expect(() => prepare0912OperatorPacket({
        root,
        releaseRunId: RELEASE_RUN_ID,
        sourceCommit: SOURCE_COMMIT,
        targetRevision: TARGET_REVISION,
        productionEnvironment: {
          ...PRODUCTION_ENVIRONMENT,
          sessionId: PRODUCTION_ENVIRONMENT.assemblyId,
        },
      })).toThrow('production_environment_invalid');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects canonical evidence reached through a directory junction or symlink', () => {
    const root = mkdtempSync(join(tmpdir(), '0912-operator-prepare-link-root-'));
    const external = mkdtempSync(join(tmpdir(), '0912-operator-prepare-link-external-'));
    try {
      seedBindings(root);
      rmSync(resolve(root, 'evaluation'), { recursive: true, force: true });
      symlinkSync(external, resolve(root, 'evaluation'), process.platform === 'win32' ? 'junction' : 'dir');

      expect(() => prepare0912OperatorPacket({
        root,
        releaseRunId: RELEASE_RUN_ID,
        sourceCommit: SOURCE_COMMIT,
        targetRevision: TARGET_REVISION,
        productionEnvironment: PRODUCTION_ENVIRONMENT,
      })).toThrow('artifact_path_unsafe');
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(external, { recursive: true, force: true });
    }
  });

  it('rejects an oversized artifact and an oversized aggregate binding set', () => {
    const root = mkdtempSync(join(tmpdir(), '0912-operator-prepare-size-'));
    try {
      seedBindings(root);
      writeFileSync(
        resolve(root, CANONICAL_0912_OPERATOR_BINDING_PATHS[0]),
        Buffer.alloc((4 * 1024 * 1024) + 1, 0x61),
      );
      expect(() => prepare0912OperatorPacket({
        root,
        releaseRunId: RELEASE_RUN_ID,
        sourceCommit: SOURCE_COMMIT,
        targetRevision: TARGET_REVISION,
        productionEnvironment: PRODUCTION_ENVIRONMENT,
      })).toThrow('artifact_not_regular_file');

      for (const path of CANONICAL_0912_OPERATOR_BINDING_PATHS) {
        writeFileSync(resolve(root, path), Buffer.alloc(510 * 1024, 0x62));
      }
      expect(() => prepare0912OperatorPacket({
        root,
        releaseRunId: RELEASE_RUN_ID,
        sourceCommit: SOURCE_COMMIT,
        targetRevision: TARGET_REVISION,
        productionEnvironment: PRODUCTION_ENVIRONMENT,
      })).toThrow('artifact_total_size_exceeded');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects unsafe output parents without writing through them', () => {
    const root = mkdtempSync(join(tmpdir(), '0912-operator-output-link-root-'));
    const external = mkdtempSync(join(tmpdir(), '0912-operator-output-link-external-'));
    try {
      seedBindings(root);
      const environmentPath = writeEnvironment(root);
      const linkedOutput = resolve(root, '.tmp-verify/0912-operator/linked-output');
      mkdirSync(dirname(linkedOutput), { recursive: true });
      symlinkSync(external, linkedOutput, process.platform === 'win32' ? 'junction' : 'dir');
      expect(() => runPrepare0912OperatorPacketCli(
        packetArguments(environmentPath, '.tmp-verify/0912-operator/linked-output/packet.json'),
        root,
      )).toThrow('output_path_unsafe');
      expect(() => readFileSync(resolve(external, 'packet.json'))).toThrow();
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(external, { recursive: true, force: true });
    }
  });

  it('never overwrites an input artifact or environment, even with force', () => {
    const root = mkdtempSync(join(tmpdir(), '0912-operator-output-collision-'));
    try {
      seedBindings(root);
      const environmentPath = writeEnvironment(root);
      const originalEnvironment = readFileSync(resolve(root, environmentPath), 'utf8');
      expect(() => runPrepare0912OperatorPacketCli([
        ...packetArguments(environmentPath, environmentPath),
        '--force',
      ], root)).toThrow('output_overlaps_input');
      expect(readFileSync(resolve(root, environmentPath), 'utf8')).toBe(originalEnvironment);

      const protectedPath = CANONICAL_0912_OPERATOR_BINDING_PATHS[0];
      const originalArtifact = readFileSync(resolve(root, protectedPath), 'utf8');
      expect(() => runPrepare0912OperatorPacketCli([
        '--template-output', protectedPath,
        '--force',
      ], root)).toThrow('output_overlaps_input');
      expect(readFileSync(resolve(root, protectedPath), 'utf8')).toBe(originalArtifact);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('parses CLI arguments strictly and replaces only an ordinary output with force', () => {
    const root = mkdtempSync(join(tmpdir(), '0912-operator-cli-'));
    try {
      expect(() => runPrepare0912OperatorPacketCli(['--unknown', 'value'], root))
        .toThrow('arguments_invalid');
      expect(() => runPrepare0912OperatorPacketCli(['--force', '--force'], root))
        .toThrow('argument_duplicate');
      expect(() => runPrepare0912OperatorPacketCli(['--help', '--force'], root))
        .toThrow('help_arguments_invalid');

      expect(() => runPrepare0912OperatorPacketCli([
        '--template-output', 'package.json',
        '--force',
      ], root)).toThrow('output_path_not_allowed');

      const outputPath = '.tmp-verify/0912-operator/generated-template.json';
      expect(runPrepare0912OperatorPacketCli(['--template-output', outputPath], root)).toBe(0);
      expect(() => runPrepare0912OperatorPacketCli(['--template-output', outputPath], root))
        .toThrow('output_exists');
      expect(runPrepare0912OperatorPacketCli([
        '--template-output', outputPath,
        '--force',
      ], root)).toBe(0);
      expect(JSON.parse(readFileSync(resolve(root, outputPath), 'utf8')).schemaVersion).toBe(2);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
