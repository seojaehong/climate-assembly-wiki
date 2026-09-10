#!/usr/bin/env node

import { createHash, randomUUID } from 'node:crypto';
import { access, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

function parseArgs(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith('--') || value === undefined) {
      throw new Error('Usage: rotate-workshop-join-codes.mjs --session-slug <slug> --output <private-path>');
    }
    values.set(key.slice(2), value);
  }
  return values;
}

function required(value, label) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${label} is required`);
  }
  return value.trim();
}

async function assertAbsent(filePath) {
  try {
    await access(filePath);
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') return;
    throw error;
  }
  throw new Error(`Refusing to overwrite existing output: ${filePath}`);
}

async function postRpc({ baseUrl, apiKey, rpc, body }) {
  const response = await fetch(`${baseUrl}/rest/v1/rpc/${rpc}`, {
    method: 'POST',
    headers: {
      apikey: apiKey,
      Authorization: `Bearer ${apiKey}`,
      'Content-Profile': 'climate_vote',
      'Accept-Profile': 'climate_vote',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${rpc} failed with HTTP ${response.status}`);
  }
  return text === '' ? null : JSON.parse(text);
}

function unwrapToken(value) {
  if (typeof value === 'string' && value.length > 0) return value;
  if (value && typeof value === 'object' && typeof value.token === 'string') return value.token;
  throw new Error('HQ login returned no token');
}

function validateRotation(value) {
  if (!value || typeof value !== 'object' || value.status !== 'rotated' || !Array.isArray(value.codes)) {
    throw new Error('Join-code rotation returned an invalid response');
  }
  if (value.codes.length !== 15) {
    throw new Error(`Expected 15 rotated teams, received ${value.codes.length}`);
  }
  const codes = value.codes.map((row) => {
    if (!row || typeof row !== 'object'
      || typeof row.team_id !== 'string'
      || typeof row.team_name !== 'string'
      || typeof row.join_code !== 'string'
      || !/^\d{6}$/.test(row.join_code)) {
      throw new Error('Join-code rotation returned a malformed team row');
    }
    return {
      teamId: row.team_id,
      teamName: row.team_name,
      tableNo: typeof row.table_no === 'string' ? row.table_no : null,
      joinCode: row.join_code,
    };
  });
  if (new Set(codes.map((row) => row.joinCode)).size !== codes.length) {
    throw new Error('Join-code rotation returned duplicate codes');
  }
  return codes;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const sessionSlug = required(args.get('session-slug'), '--session-slug');
  const outputPath = path.resolve(required(args.get('output'), '--output'));
  const baseUrl = required(process.env.SUPABASE_URL, 'SUPABASE_URL');
  const apiKey = required(process.env.SUPABASE_ANON_KEY, 'SUPABASE_ANON_KEY');
  const operator = required(process.env.CLIMATE_HQ_OPERATOR, 'CLIMATE_HQ_OPERATOR');
  const password = required(process.env.CLIMATE_HQ_PASSWORD, 'CLIMATE_HQ_PASSWORD');
  const requestId = randomUUID();

  await assertAbsent(outputPath);
  let token = null;
  try {
    token = unwrapToken(await postRpc({
      baseUrl,
      apiKey,
      rpc: 'attendance_hq_unlock_named',
      body: { p_operator: operator, p_password: password },
    }));
    const rotation = await postRpc({
      baseUrl,
      apiKey,
      rpc: 'workshop_hq_rotate_join_codes',
      body: {
        p_token: token,
        p_session_slug: sessionSlug,
        p_confirmation: `ROTATE ${sessionSlug}`,
        p_idempotency_key: requestId,
      },
    });
    const codes = validateRotation(rotation);
    const payload = `${JSON.stringify({
      generatedAt: new Date().toISOString(),
      sessionSlug,
      rotationRequestId: requestId,
      codes,
    }, null, 2)}\n`;
    const temporaryPath = `${outputPath}.${randomUUID()}.tmp`;
    await writeFile(temporaryPath, payload, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    await rename(temporaryPath, outputPath);
    const sha256 = createHash('sha256').update(payload).digest('hex').toUpperCase();
    process.stdout.write(`${JSON.stringify({ status: 'rotated', teamCount: codes.length, outputPath, sha256 })}\n`);
  } finally {
    if (token !== null) {
      try {
        await postRpc({
          baseUrl,
          apiKey,
          rpc: 'workshop_hq_logout_v2',
          body: { p_token: token },
        });
      } catch (error) {
        process.stderr.write(`HQ logout warning: ${error instanceof Error ? error.message : String(error)}\n`);
      }
    }
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
