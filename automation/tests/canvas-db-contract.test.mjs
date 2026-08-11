import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildCanvasDbContractEvidence, evaluateCanvasDbContract, parseCliArgs } from '../canvas-db-contract.mjs';

const sourceText = `
  sb.from('session').select('id');
  sb.from('participant').upsert({});
  sb.from('agenda').select('*'); sb.from('agenda').insert({}); sb.from('agenda').update({});
  sb.from('agenda_link').select('*'); sb.from('agenda_link').insert({}); sb.from('agenda_link').delete();
  sb.from('agenda_edit_log').select('*'); sb.from('agenda_edit_log').insert({});
  sb.from('rounds').select('*'); sb.from('rounds').insert({});
  channel.on('postgres_changes', { table: 'agenda' });
  channel.on('postgres_changes', { table: 'agenda_link' });
  ${[
    'attendance_team_unlock', 'attendance_team_unlock_by_code', 'attendance_hq_unlock',
    'attendance_roster', 'attendance_hq_summary', 'attendance_set', 'attendance_bulk_present',
    'attendance_finalize_absent', 'attendance_member_save', 'attendance_hq_audit',
    'attendance_hq_set_team_pin', 'attendance_hq_set_table_no', 'attendance_round_eligible_count',
  ].map((name) => `sb.rpc('${name}');`).join('\n')}
`;

const tableDefinitions = {
  session: 'id uuid primary key, slug text unique, org_id uuid references climate_vote.org(id)',
  participant: 'id uuid primary key, token text unique, session_id uuid references climate_vote.session(id), org_id uuid references climate_vote.org(id), name text, group_label text',
  agenda: 'id uuid primary key, session_id uuid references climate_vote.session(id), org_id uuid references climate_vote.org(id), text text, status text, x integer, y integer, created_by text, updated_at timestamptz',
  agenda_link: 'id uuid primary key, session_id uuid references climate_vote.session(id), org_id uuid references climate_vote.org(id), source_id uuid references climate_vote.agenda(id), target_id uuid references climate_vote.agenda(id), created_by text',
  agenda_edit_log: 'id uuid primary key, agenda_id uuid references climate_vote.agenda(id), org_id uuid references climate_vote.org(id), before text, after text, editor text',
  rounds: 'id text primary key, session_id uuid references climate_vote.session(id), org_id uuid references climate_vote.org(id), title text, type text, status text',
  attendance: 'id uuid primary key, assignment_id uuid unique references climate_vote.team_assignment(id), base_status text, updated_at timestamptz, org_id uuid references climate_vote.org(id)',
};

const access = [
  ['session', 'select', 'anon', 'exists (select 1 from climate_vote.session visible_session where visible_session.id = session.id)'],
  ['session', 'select', 'authenticated', 'org_id = climate_vote.org_of_uid()'],
  ['participant', 'insert', 'anon', 'exists (select 1 from climate_vote.session s where s.id = session_id)'],
  ['participant', 'update', 'anon', 'exists (select 1 from climate_vote.session s where s.id = session_id)'],
  ['agenda', 'select', 'authenticated', 'org_id = climate_vote.org_of_uid()'],
  ['agenda', 'insert', 'anon', 'exists (select 1 from climate_vote.session s where s.id = session_id)'],
  ['agenda', 'insert', 'authenticated', 'org_id = climate_vote.org_of_uid()'],
  ['agenda', 'update', 'authenticated', 'org_id = climate_vote.org_of_uid()'],
  ['agenda_link', 'select', 'authenticated', 'org_id = climate_vote.org_of_uid()'],
  ['agenda_link', 'insert', 'authenticated', 'org_id = climate_vote.org_of_uid()'],
  ['agenda_link', 'delete', 'authenticated', 'org_id = climate_vote.org_of_uid()'],
  ['agenda_edit_log', 'select', 'authenticated', 'org_id = climate_vote.org_of_uid()'],
  ['agenda_edit_log', 'insert', 'authenticated', 'org_id = climate_vote.org_of_uid()'],
  ['rounds', 'select', 'authenticated', 'org_id = climate_vote.org_of_uid()'],
  ['rounds', 'insert', 'authenticated', 'org_id = climate_vote.org_of_uid()'],
];

const publicRpcs = [
  'attendance_team_unlock', 'attendance_team_unlock_by_code', 'attendance_hq_unlock',
  'attendance_roster', 'attendance_hq_summary', 'attendance_set', 'attendance_bulk_present',
  'attendance_finalize_absent', 'attendance_member_save', 'attendance_hq_audit',
  'attendance_hq_set_team_pin', 'attendance_hq_set_table_no', 'attendance_round_eligible_count',
];

const rpcDefinitions = {
  attendance_token_row: ['p_token text', 'climate_vote.attendance_auth_session', 'select null::climate_vote.attendance_auth_session from climate_vote.attendance_auth_session'],
  attendance_team_unlock: ['p_code text, p_pin text', 'text', "select climate_vote.attendance_issue_token('team', null, 'actor')"],
  attendance_team_unlock_by_code: ['p_code text', 'text', "select climate_vote.attendance_issue_token('team', null, 'actor')"],
  attendance_hq_unlock: ['p_password text, p_actor text', 'text', "select climate_vote.attendance_issue_token('hq', null, 'actor')"],
  attendance_hq_summary: ['', 'table(value int)', 'select count(*)::int from climate_vote.attendance'],
  attendance_roster: ['p_token text', 'table(value int)', 'select 1 from climate_vote.attendance_token_row(p_token)'],
  attendance_set: ['p_token text, p_id uuid, p_action text, p_at timestamptz', 'void', 'select climate_vote.attendance_token_row(p_token)'],
  attendance_bulk_present: ['p_token text, p_ids uuid[]', 'int', "select climate_vote.attendance_set(p_token, null, 'present', now())"],
  attendance_finalize_absent: ['p_token text', 'int', 'select 1 from climate_vote.attendance_token_row(p_token)'],
  attendance_member_save: ['p_token text, p_id uuid, p_official text, p_name text, p_team uuid, p_active boolean', 'uuid', 'select null::uuid from climate_vote.attendance_token_row(p_token)'],
  attendance_hq_audit: ['p_token text, p_limit int', 'table(value int)', 'select 1 from climate_vote.attendance_token_row(p_token)'],
  attendance_hq_set_team_pin: ['p_token text, p_team uuid, p_pin text', 'void', 'select climate_vote.attendance_token_row(p_token)'],
  attendance_hq_set_table_no: ['p_token text, p_team uuid, p_no text', 'void', 'select climate_vote.attendance_token_row(p_token)'],
  attendance_round_eligible_count: ['p_round text', 'int', 'select count(*)::int from climate_vote.attendance'],
};

const migrationText = `
  ${Object.entries(tableDefinitions).map(([table, columns]) => `create table climate_vote.${table} (${columns});`).join('\n')}
  ${Object.keys(tableDefinitions).map((table) => `alter table climate_vote.${table} enable row level security;`).join('\n')}
  ${access.map(([table, operation, role, predicate], index) => {
    const clauses = operation === 'insert'
      ? `with check (${predicate})`
      : operation === 'update'
        ? `using (${predicate}) with check (${predicate})`
        : `using (${predicate})`;
    return `create policy p_${index} on climate_vote.${table} for ${operation} to ${role} ${clauses}; grant ${operation} on climate_vote.${table} to ${role};`;
  }).join('\n')}
  revoke all on climate_vote.attendance from anon, authenticated;
  ${[...publicRpcs, 'attendance_token_row'].map((name) => {
    const [args, returns, body] = rpcDefinitions[name];
    const argTypes = args.split(',').filter(Boolean).map((arg) => arg.trim().split(/\s+/).at(-1)).join(',');
    return `
    create function climate_vote.${name}(${args}) returns ${returns} language sql security definer
      set search_path = climate_vote, extensions, pg_temp as $$ ${body} $$;
    revoke execute on function climate_vote.${name}(${argTypes}) from public;
    ${name === 'attendance_token_row' ? '' : `grant execute on function climate_vote.${name}(${argTypes}) to anon;`}
  `;
  }).join('\n')}
  alter publication supabase_realtime add table climate_vote.agenda;
  alter publication supabase_realtime add table climate_vote.agenda_link;
  alter publication supabase_realtime add table climate_vote.attendance;
  alter table climate_vote.agenda replica identity full;
  alter table climate_vote.agenda_link replica identity full;
`;

const approvedContract = `
  Contract status: approved
  Failure-mode status: verified
  Rollback status: rehearsed
  ## Write-path failure modes
  ## Rollback plan
`;
describe('evaluateCanvasDbContract', () => {
  it('recognizes complete static patterns without issuing M1 approval', () => {
    const report = evaluateCanvasDbContract({ sourceText, migrationText, contractText: approvedContract });

    expect(report.blockers).toEqual(['verification.semantic_review_required']);
    expect(report.status).toBe('not_ready');
    expect(report.m1Complete).toBe(false);
    expect(report.staticAnalysisOnly).toBe(true);
    expect(report.canApproveM1).toBe(false);
    expect(report.tables.find((table) => table.table === 'agenda')).toMatchObject({
      migrationDefinition: true,
      missingColumns: [],
      missingConstraints: [],
      missingForeignKeys: [],
      rlsEnabled: true,
      staticAccessPattern: true,
      realtimePublished: true,
      realtimeReplicaIdentity: true,
    });
    expect(report.rpcs.every((rpc) => rpc.staticPatternComplete)).toBe(true);
  });

  it('ignores commented contracts and respects later destructive migration state', () => {
    const commentedSource = sourceText.split('\n').map((line) => `// ${line}`).join('\n');
    const commentedMigrations = migrationText.split('\n').map((line) => `-- ${line}`).join('\n');
    const sourceReport = evaluateCanvasDbContract({ sourceText: commentedSource, migrationText, contractText: approvedContract });
    const migrationReport = evaluateCanvasDbContract({ sourceText, migrationText: commentedMigrations, contractText: approvedContract });
    const reversedReport = evaluateCanvasDbContract({
      sourceText,
      migrationText: `${migrationText}
        alter table climate_vote.agenda disable row level security;
        drop policy p_4 on climate_vote.agenda;
        revoke select on climate_vote.session from authenticated;
        alter publication supabase_realtime drop table climate_vote.agenda;
        alter table climate_vote.agenda replica identity default;
        drop function climate_vote.attendance_roster(text);`,
      contractText: approvedContract,
    });

    expect(sourceReport.blockers).toContain('source.agenda.insert_missing');
    expect(migrationReport.blockers).toContain('migration.agenda.definition_missing');
    expect(reversedReport.blockers).toContain('migration.agenda.rls_missing');
    expect(reversedReport.blockers).toContain('migration.agenda.access_missing');
    expect(reversedReport.blockers).toContain('migration.agenda.realtime_missing');
    expect(reversedReport.blockers).toContain('migration.agenda.replica_identity_missing');
    expect(reversedReport.blockers).toContain('migration.session.access_missing');
    expect(reversedReport.blockers).toContain('migration.rpc.attendance_roster.contract_missing');
  });

  it('rejects permissive policies, missing grants, unsafe RPCs, and unapproved docs', () => {
    const unsafe = migrationText
      .replace(
        'create policy p_0 on climate_vote.session for select to anon using (exists (select 1 from climate_vote.session visible_session where visible_session.id = session.id))',
        'create policy p_0 on climate_vote.session for select to anon using (session_id is not null)',
      )
      .replace(
        'create policy p_7 on climate_vote.agenda for update to authenticated using (org_id = climate_vote.org_of_uid())',
        'create policy p_7 on climate_vote.agenda for update to authenticated using (true)',
      )
      .replace('grant select on climate_vote.session to authenticated;', '')
      .replace('function climate_vote.attendance_roster(p_token text)', 'function climate_vote.attendance_roster(p_token uuid)')
      .replace('from climate_vote.attendance_token_row(p_token)', 'from climate_vote.attendance');
    const report = evaluateCanvasDbContract({ sourceText, migrationText: unsafe, contractText: '## Rollback plan' });

    expect(report.blockers).toContain('migration.session.access_missing');
    expect(report.blockers).toContain('migration.agenda.access_missing');
    expect(report.blockers).toContain('migration.rpc.attendance_roster.contract_missing');
    expect(report.blockers.some((blocker) => blocker.startsWith('migration.rpc.'))).toBe(true);
    expect(report.blockers).toContain('approval.m1_contract_missing');
    expect(report.blockers).toContain('contract.failure_mode_matrix_missing');
  });

  it('flags newly introduced table operations that are absent from the reviewed matrix', () => {
    const report = evaluateCanvasDbContract({
      sourceText: `${sourceText}\nsb.from('agenda').delete();\nsb.from('new_canvas_table').insert({});`,
      migrationText,
      contractText: approvedContract,
    });

    expect(report.blockers).toContain('source.agenda.delete_unreviewed');
    expect(report.blockers).toContain('source.new_canvas_table.insert_unreviewed');
  });

  it('fails closed on the current repository gap without contacting the database', () => {
    const projectRoot = new URL('../../', import.meta.url);
    const sourcePaths = ['src/islands/CanvasBoard.tsx', 'src/islands/JoinForm.tsx', 'src/lib/attendance.ts'];
    const canvasDirectory = new URL('src/islands/canvas/', projectRoot);
    const currentSource = [
      ...sourcePaths.map((path) => readFileSync(new URL(path, projectRoot), 'utf8')),
      ...readdirSync(canvasDirectory).filter((name) => /\.(?:ts|tsx)$/.test(name)).map((name) => readFileSync(new URL(name, canvasDirectory), 'utf8')),
    ].join('\n');
    const migrationDirectory = new URL('supabase/migrations/', projectRoot);
    const migrationPath = fileURLToPath(migrationDirectory);
    const currentMigrations = readdirSync(migrationDirectory).filter((name) => name.endsWith('.sql')).sort()
      .map((name) => readFileSync(join(migrationPath, name), 'utf8')).join('\n');
    const contractText = readFileSync(new URL('docs/platform/CANVAS_DB_CONTRACT.md', projectRoot), 'utf8');
    const report = evaluateCanvasDbContract({ sourceText: currentSource, migrationText: currentMigrations, contractText });

    expect(report.status).toBe('not_ready');
    expect(report.m1Complete).toBe(false);
    expect(report.databaseAccess).toBe(false);
    expect(report.databaseMutationExecuted).toBe(false);
    expect(report.blockers).toContain('approval.m1_contract_missing');
    expect(report.blockers).toContain('migration.agenda.definition_missing');
  });
});

describe('parseCliArgs', () => {
  it('rejects missing, duplicate, and unknown CLI options', () => {
    expect(() => parseCliArgs(['--output-json'])).toThrow('Invalid --output-json option');
    expect(() => parseCliArgs(['--output-json', '--allow-dirty-source'])).toThrow('Invalid --output-json option');
    expect(() => parseCliArgs(['--output-json', 'a.json', '--output-json', 'b.json'])).toThrow('Invalid --output-json option');
    expect(() => parseCliArgs(['--unknown'])).toThrow('Unknown Canvas database contract option');
  });
});

describe('canvas database contract CLI', () => {
  it('treats a deleted tracked migration as a dirty audited source tree', () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'canvas-db-contract-git-'));
    const files = [
      'automation/canvas-db-contract.mjs',
      'docs/platform/CANVAS_DB_CONTRACT.md',
      'src/islands/CanvasBoard.tsx',
      'src/islands/JoinForm.tsx',
      'src/lib/attendance.ts',
      'src/islands/canvas/helper.ts',
      'supabase/migrations/001_contract.sql',
    ];
    try {
      for (const path of files) {
        const absolutePath = join(projectRoot, path);
        mkdirSync(resolve(absolutePath, '..'), { recursive: true });
        writeFileSync(absolutePath, path.endsWith('.md') ? 'Contract status: draft' : '', 'utf8');
      }
      execFileSync('git', ['init'], { cwd: projectRoot });
      execFileSync('git', ['config', 'user.email', 'contract@example.invalid'], { cwd: projectRoot });
      execFileSync('git', ['config', 'user.name', 'Contract Test'], { cwd: projectRoot });
      execFileSync('git', ['add', '.'], { cwd: projectRoot });
      execFileSync('git', ['commit', '-m', 'test fixture'], { cwd: projectRoot });
      rmSync(join(projectRoot, 'supabase/migrations/001_contract.sql'));

      expect(() => buildCanvasDbContractEvidence({ projectRoot })).toThrow(
        'Canvas database contract source tree is dirty',
      );
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it('writes non-identifying evidence and exits nonzero while the contract is incomplete', () => {
    const tempDirectory = mkdtempSync(join(tmpdir(), 'canvas-db-contract-'));
    const outputPath = join(tempDirectory, 'report.json');
    const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
    try {
      const result = spawnSync(
        process.execPath,
        [resolve(projectRoot, 'automation/canvas-db-contract.mjs'), '--output-json', outputPath, '--allow-dirty-source'],
        { cwd: projectRoot, encoding: 'utf8', env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot } },
      );
      const evidence = JSON.parse(readFileSync(outputPath, 'utf8'));

      expect(result.status).toBe(1);
      expect(result.stderr).toContain('Canvas database contract is not ready; see report artifact.');
      expect(evidence).toMatchObject({
        schemaVersion: 2,
        status: 'not_ready',
        m1Complete: false,
        staticAnalysisOnly: true,
        canApproveM1: false,
        databaseAccess: false,
        databaseMutationExecuted: false,
      });
      expect(evidence.blockerCount).toBeGreaterThan(0);
      expect(evidence.sourceCommit).toMatch(/^[0-9a-f]{40}$/);
      expect(evidence.sourceTreeSha256).toMatch(/^[0-9a-f]{64}$/);
      expect(evidence.sourcePaths.every((path) => !path.includes('.test.'))).toBe(true);
      expect(JSON.stringify(evidence)).not.toContain('SUPABASE');
    } finally {
      rmSync(tempDirectory, { recursive: true, force: true });
    }
  });
});
