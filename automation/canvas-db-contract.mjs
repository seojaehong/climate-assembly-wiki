import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const FIXED_SOURCE_PATHS = [
  'src/islands/CanvasBoard.tsx',
  'src/islands/JoinForm.tsx',
  'src/lib/attendance.ts',
];
const SOURCE_DIRECTORY = 'src/islands/canvas';
const MIGRATION_DIRECTORY = 'supabase/migrations';
const CONTRACT_MODULE_PATH = 'automation/canvas-db-contract.mjs';
const CONTRACT_DOCUMENT_PATH = 'docs/platform/CANVAS_DB_CONTRACT.md';

const ATTENDANCE_RPC_CONTRACTS = {
  attendance_token_row: { args: ['text'], returns: 'climate_vote\\.attendance_auth_session', scope: 'attendance_auth_session' },
  attendance_team_unlock: { args: ['text', 'text'], returns: 'text', scope: 'attendance_issue_token' },
  attendance_team_unlock_by_code: { args: ['text'], returns: 'text', scope: 'attendance_issue_token' },
  attendance_hq_unlock: { args: ['text', 'text'], returns: 'text', scope: 'attendance_issue_token' },
  attendance_hq_summary: { args: [], returns: 'table', scope: 'climate_vote\\.attendance' },
  attendance_roster: { args: ['text'], returns: 'table', scope: 'attendance_token_row' },
  attendance_set: { args: ['text', 'uuid', 'text', 'timestamptz'], returns: 'void', scope: 'attendance_token_row' },
  attendance_bulk_present: { args: ['text', 'uuid[]'], returns: 'int', scope: 'attendance_set' },
  attendance_finalize_absent: { args: ['text'], returns: 'int', scope: 'attendance_token_row' },
  attendance_member_save: { args: ['text', 'uuid', 'text', 'text', 'uuid', 'boolean'], returns: 'uuid', scope: 'attendance_token_row' },
  attendance_hq_audit: { args: ['text', 'int'], returns: 'table', scope: 'attendance_token_row' },
  attendance_hq_set_team_pin: { args: ['text', 'uuid', 'text'], returns: 'void', scope: 'attendance_token_row' },
  attendance_hq_set_table_no: { args: ['text', 'uuid', 'text'], returns: 'void', scope: 'attendance_token_row' },
  attendance_round_eligible_count: { args: ['text'], returns: 'int', scope: 'climate_vote\\.(?:attendance|round_attendance_snapshot)' },
};

const TABLE_CONTRACTS = [
  {
    table: 'session',
    sourceOperations: ['select'],
    columns: [['id', 'uuid'], ['slug', 'text'], ['org_id', 'uuid']],
    constraints: [['id_primary_key', 'id\\s+uuid[^,;]*primary\\s+key'], ['slug_unique', 'slug\\s+text[^,;]*unique']],
    foreignKeys: [['org_id', 'org']],
    access: [{ operation: 'select', roles: ['anon', 'authenticated'] }],
  },
  {
    table: 'participant',
    sourceOperations: ['upsert'],
    columns: [['id', 'uuid'], ['token', 'text'], ['session_id', 'uuid'], ['org_id', 'uuid'], ['name', 'text'], ['group_label', 'text']],
    constraints: [['id_primary_key', 'id\\s+uuid[^,;]*primary\\s+key'], ['token_unique', 'token\\s+text[^,;]*unique']],
    foreignKeys: [['session_id', 'session'], ['org_id', 'org']],
    access: [
      { operation: 'insert', roles: ['anon'] },
      { operation: 'update', roles: ['anon'] },
    ],
  },
  {
    table: 'agenda',
    sourceOperations: ['select', 'insert', 'update'],
    columns: [['id', 'uuid'], ['session_id', 'uuid'], ['org_id', 'uuid'], ['text', 'text'], ['status', 'text'], ['x', '(?:integer|int|numeric|double\\s+precision)'], ['y', '(?:integer|int|numeric|double\\s+precision)'], ['created_by', 'text'], ['updated_at', 'timestamptz']],
    constraints: [['id_primary_key', 'id\\s+uuid[^,;]*primary\\s+key']],
    foreignKeys: [['session_id', 'session'], ['org_id', 'org']],
    access: [
      { operation: 'select', roles: ['authenticated'] },
      { operation: 'insert', roles: ['anon', 'authenticated'] },
      { operation: 'update', roles: ['authenticated'] },
    ],
    sourceRealtime: true,
    realtimePublication: true,
  },
  {
    table: 'agenda_link',
    sourceOperations: ['select', 'insert', 'delete'],
    columns: [['id', 'uuid'], ['session_id', 'uuid'], ['org_id', 'uuid'], ['source_id', 'uuid'], ['target_id', 'uuid'], ['created_by', 'text']],
    constraints: [['id_primary_key', 'id\\s+uuid[^,;]*primary\\s+key']],
    foreignKeys: [
      ['session_id', 'session'],
      ['org_id', 'org'],
      ['source_id', 'agenda'],
      ['target_id', 'agenda'],
    ],
    access: [
      { operation: 'select', roles: ['authenticated'] },
      { operation: 'insert', roles: ['authenticated'] },
      { operation: 'delete', roles: ['authenticated'] },
    ],
    sourceRealtime: true,
    realtimePublication: true,
  },
  {
    table: 'agenda_edit_log',
    sourceOperations: ['select', 'insert'],
    columns: [['id', 'uuid'], ['agenda_id', 'uuid'], ['org_id', 'uuid'], ['before', 'text'], ['after', 'text'], ['editor', 'text']],
    constraints: [['id_primary_key', 'id\\s+uuid[^,;]*primary\\s+key']],
    foreignKeys: [['agenda_id', 'agenda'], ['org_id', 'org']],
    access: [
      { operation: 'select', roles: ['authenticated'] },
      { operation: 'insert', roles: ['authenticated'] },
    ],
  },
  {
    table: 'rounds',
    sourceOperations: ['select', 'insert'],
    columns: [['id', 'text'], ['session_id', 'uuid'], ['org_id', 'uuid'], ['title', 'text'], ['type', 'text'], ['status', 'text']],
    constraints: [['id_primary_key', 'id\\s+text[^,;]*primary\\s+key']],
    foreignKeys: [['session_id', 'session'], ['org_id', 'org']],
    access: [
      { operation: 'select', roles: ['authenticated'] },
      { operation: 'insert', roles: ['authenticated'] },
    ],
  },
  {
    table: 'attendance',
    sourceOperations: [],
    columns: [['id', 'uuid'], ['assignment_id', 'uuid'], ['base_status', 'text'], ['updated_at', 'timestamptz'], ['org_id', 'uuid']],
    constraints: [['id_primary_key', 'id\\s+uuid[^,;]*primary\\s+key'], ['assignment_unique', 'assignment_id\\s+uuid[^,;]*unique']],
    foreignKeys: [['assignment_id', 'team_assignment'], ['org_id', 'org']],
    access: [],
    realtimePublication: true,
    privateRpc: true,
  },
];

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stripSourceComments(value) {
  return value.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function stripSqlComments(value) {
  return value.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--.*$/gm, '');
}

function hasSourceOperation(sourceText, table, operation) {
  return new RegExp(
    String.raw`\.from\(\s*['"]${escapeRegExp(table)}['"]\s*\)(?:(?!\.from\().){0,1200}?\.${escapeRegExp(operation)}\s*\(`,
    's',
  ).test(sourceText);
}

function hasRealtimeSource(sourceText, table) {
  return new RegExp(
    String.raw`\.on\(\s*['"]postgres_changes['"]\s*,(?:(?!\.on\().){0,700}?table\s*:\s*['"]${escapeRegExp(table)}['"]`,
    's',
  ).test(sourceText);
}

function hasRpcSource(sourceText, functionName) {
  return new RegExp(String.raw`\.rpc\(\s*['"]${escapeRegExp(functionName)}['"]`, 's').test(sourceText);
}

function sqlStatements(migrationText) {
  return stripSqlComments(migrationText).match(/(?:[^;$]|\$(?:[a-z_]*)\$[\s\S]*?\$(?:[a-z_]*)\$)+;/gi) ?? [];
}

function policyName(statement) {
  return statement.match(/create\s+policy\s+(?:"([^"]+)"|([a-z0-9_]+))/i)?.slice(1).find(Boolean) ?? null;
}

function tableState(migrationText, table) {
  const escaped = escapeRegExp(table);
  const state = {
    definition: null,
    schemaStatements: [],
    rlsEnabled: false,
    realtimePublished: false,
    realtimeReplicaIdentity: false,
    policies: new Map(),
    grants: new Map(),
    directRevokedRoles: new Set(),
    removedColumns: new Set(),
    constraintsInvalidated: false,
  };
  for (const statement of sqlStatements(migrationText)) {
    if (new RegExp(String.raw`^\s*create\s+table\s+(?:if\s+not\s+exists\s+)?climate_vote\.${escaped}\b`, 'i').test(statement)) {
      state.definition = statement;
      state.schemaStatements = [statement];
    }
    if (new RegExp(String.raw`^\s*drop\s+table\s+(?:if\s+exists\s+)?climate_vote\.${escaped}\b`, 'i').test(statement)) {
      state.definition = null;
      state.rlsEnabled = false;
      state.realtimePublished = false;
      state.realtimeReplicaIdentity = false;
      state.policies.clear();
      state.grants.clear();
      state.directRevokedRoles.clear();
      state.schemaStatements = [];
      state.removedColumns.clear();
      state.constraintsInvalidated = false;
    }
    if (new RegExp(String.raw`^\s*alter\s+table\s+climate_vote\.${escaped}\s+add\s+(?:column\s+)?`, 'i').test(statement)) {
      state.schemaStatements.push(statement);
      const addedColumn = statement.match(/\badd\s+(?:column\s+)?(?:if\s+not\s+exists\s+)?([a-z0-9_]+)/i)?.[1];
      if (addedColumn) state.removedColumns.delete(addedColumn.toLowerCase());
    }
    const droppedColumn = statement.match(new RegExp(
      String.raw`^\s*alter\s+table\s+climate_vote\.${escaped}\s+drop\s+(?:column\s+)?(?:if\s+exists\s+)?([a-z0-9_]+)`,
      'i',
    ));
    if (droppedColumn) state.removedColumns.add(droppedColumn[1].toLowerCase());
    if (new RegExp(String.raw`^\s*alter\s+table\s+climate_vote\.${escaped}\s+drop\s+constraint\b`, 'i').test(statement)) {
      state.constraintsInvalidated = true;
    }
    if (new RegExp(String.raw`alter\s+table\s+climate_vote\.${escaped}\s+enable\s+row\s+level\s+security`, 'i').test(statement)) {
      state.rlsEnabled = true;
    }
    if (new RegExp(String.raw`alter\s+table\s+climate_vote\.${escaped}\s+disable\s+row\s+level\s+security`, 'i').test(statement)) {
      state.rlsEnabled = false;
    }
    if (new RegExp(String.raw`alter\s+publication\s+supabase_realtime\s+add\s+table\s+climate_vote\.${escaped}\b`, 'i').test(statement)) {
      state.realtimePublished = true;
    }
    if (new RegExp(String.raw`alter\s+publication\s+supabase_realtime\s+drop\s+table\s+climate_vote\.${escaped}\b`, 'i').test(statement)) {
      state.realtimePublished = false;
    }
    if (/^\s*drop\s+publication\s+(?:if\s+exists\s+)?supabase_realtime\b/i.test(statement)) {
      state.realtimePublished = false;
    }
    const replicaIdentity = statement.match(new RegExp(
      String.raw`alter\s+table\s+climate_vote\.${escaped}\s+replica\s+identity\s+(full|default|nothing)\b`,
      'i',
    ));
    if (replicaIdentity) state.realtimeReplicaIdentity = replicaIdentity[1].toLowerCase() === 'full';
    if (new RegExp(String.raw`create\s+policy\b[\s\S]*?\bon\s+climate_vote\.${escaped}\b`, 'i').test(statement)) {
      const name = policyName(statement);
      if (name) state.policies.set(name.toLowerCase(), statement);
    }
    const droppedPolicy = statement.match(new RegExp(
      String.raw`drop\s+policy\s+(?:if\s+exists\s+)?(?:"([^"]+)"|([a-z0-9_]+))\s+on\s+climate_vote\.${escaped}\b`,
      'i',
    ));
    if (droppedPolicy) state.policies.delete((droppedPolicy[1] ?? droppedPolicy[2]).toLowerCase());
    const alteredPolicy = statement.match(new RegExp(
      String.raw`alter\s+policy\s+(?:"([^"]+)"|([a-z0-9_]+))\s+on\s+climate_vote\.${escaped}\b`,
      'i',
    ));
    if (alteredPolicy) state.policies.delete((alteredPolicy[1] ?? alteredPolicy[2]).toLowerCase());

    const privilege = statement.match(/^\s*(grant|revoke)\s+([a-z,\s]+)\s+on\s+(?:table\s+)?([\s\S]+?)\s+(to|from)\s+([a-z_,\s]+)\s*;/i);
    if (privilege) {
      const targetList = privilege[3];
      if (!new RegExp(String.raw`\bclimate_vote\.${escaped}\b`, 'i').test(targetList)) continue;
      const operations = privilege[2].toLowerCase().split(',').map((value) => value.trim());
      const roles = privilege[5].toLowerCase().split(',').map((value) => value.trim());
      for (const role of roles) {
        if (privilege[1].toLowerCase() === 'revoke' && operations.includes('all')) {
          state.directRevokedRoles.add(role);
          state.grants.delete(role);
          continue;
        }
        const current = state.grants.get(role) ?? new Set();
        for (const operation of operations) {
          if (privilege[1].toLowerCase() === 'grant') current.add(operation);
          else current.delete(operation);
        }
        state.grants.set(role, current);
      }
    }
  }
  return state;
}

function definitionHasColumn(definition, column, typePattern) {
  return new RegExp(
    String.raw`(?:\(|,|add\s+(?:column\s+)?(?:if\s+not\s+exists\s+)?)\s*${escapeRegExp(column)}\s+${typePattern}\b`,
    'i',
  ).test(definition ?? '');
}

function definitionHasForeignKey(definition, column, targetTable) {
  return new RegExp(
    String.raw`\b${escapeRegExp(column)}\b(?:(?!,).){0,300}?references\s+climate_vote\.${escapeRegExp(targetTable)}\b`,
    'is',
  ).test(definition ?? '') || new RegExp(
    String.raw`foreign\s+key\s*\(\s*${escapeRegExp(column)}\s*\)\s*references\s+climate_vote\.${escapeRegExp(targetTable)}\b`,
    'i',
  ).test(definition ?? '');
}

function policySupports(policy, operation, role) {
  const operationAllowed = new RegExp(String.raw`\bfor\s+(?:all|${operation})\b`, 'i').test(policy);
  const roleAllowed = new RegExp(String.raw`\bto\s+(?:[^;]*,\s*)?${escapeRegExp(role)}\b`, 'i').test(policy);
  const using = operation === 'update'
    ? policy.match(/\busing\s*\(([\s\S]*?)\)\s*with\s+check/i)?.[1] ?? ''
    : policy.match(/\busing\s*\(([\s\S]*?)\)\s*;/i)?.[1] ?? '';
  const withCheck = policy.match(/\bwith\s+check\s*\(([\s\S]*?)\)\s*;/i)?.[1] ?? '';
  const usingRequired = operation === 'select' || operation === 'update' || operation === 'delete';
  const checkRequired = operation === 'insert' || operation === 'update';
  if (!operationAllowed || !roleAllowed || (usingRequired && !using) || (checkRequired && !withCheck)) return false;
  if (/^\s*true\s*$/i.test(using) || /^\s*true\s*$/i.test(withCheck)) return false;
  const predicates = `${using} ${withCheck}`;
  return role === 'authenticated'
    ? /\borg_id\s*=\s*climate_vote\.org_of_uid\s*\(\s*\)/i.test(predicates) && !/\bor\b/i.test(predicates)
    : /\bexists\s*\(/i.test(predicates)
      && /\b(?:session|session_id)\b/i.test(predicates)
      && !/\bis\s+not\s+null\b/i.test(predicates)
      && !/\bor\b/i.test(predicates);
}

function accessFinding(state, requirements) {
  const missing = [];
  for (const requirement of requirements) {
    for (const role of requirement.roles) {
      const grant = state.grants.get(role)?.has(requirement.operation) === true;
      const policy = [...state.policies.values()].some((value) => policySupports(value, requirement.operation, role));
      if (!grant || !policy) missing.push(`${role}.${requirement.operation}`);
    }
  }
  return { complete: missing.length === 0, missing };
}

function sourceRpcNames(sourceText) {
  return [...sourceText.matchAll(/\.rpc\(\s*['"]([a-z0-9_]+)['"]/gi)].map((match) => match[1]);
}

function sourceTableOperations(sourceText) {
  const operations = [];
  for (const match of sourceText.matchAll(/\.from\(\s*['"]([a-z0-9_]+)['"]\s*\)([\s\S]{0,1200}?)(?=\.from\(|$)/gi)) {
    const operation = match[2].match(/\.(select|insert|update|upsert|delete)\s*\(/i)?.[1]?.toLowerCase();
    if (operation) operations.push({ table: match[1], operation });
  }
  return operations;
}

function functionPrivileges(migrationText, functionName, expectedArgs) {
  const roles = new Set();
  let publicRevoked = false;
  const signaturePattern = expectedArgs.map((type) => escapeRegExp(type)).join('\\s*,\\s*');
  const targetPattern = new RegExp(
    String.raw`\bclimate_vote\.${escapeRegExp(functionName)}\s*\(\s*${signaturePattern}\s*\)`,
    'i',
  );
  for (const statement of sqlStatements(migrationText)) {
    if (new RegExp(
      String.raw`^\s*(?:create\s+(?:or\s+replace\s+)?|drop\s+(?:if\s+exists\s+)?)function\s+climate_vote\.${escapeRegExp(functionName)}\b`,
      'i',
    ).test(statement)) {
      roles.clear();
      publicRevoked = false;
    }
    const privilege = statement.match(/^\s*(grant|revoke)\s+execute\s+on\s+function\s+([\s\S]+?)\s+(to|from)\s+([a-z_,\s]+)\s*;/i);
    if (!privilege || !targetPattern.test(privilege[2])) continue;
    for (const role of privilege[4].toLowerCase().split(',').map((value) => value.trim())) {
      if (privilege[1].toLowerCase() === 'grant') roles.add(role);
      else roles.delete(role);
      if (role === 'public' && privilege[1].toLowerCase() === 'revoke') publicRevoked = true;
      if (role === 'public' && privilege[1].toLowerCase() === 'grant') publicRevoked = false;
    }
  }
  return { roles, publicRevoked };
}

function definitionArgTypes(definition, functionName) {
  const args = definition.match(new RegExp(
    String.raw`function\s+climate_vote\.${escapeRegExp(functionName)}\s*\(([^)]*)\)`,
    'i',
  ))?.[1] ?? '';
  if (!args.trim()) return [];
  return args.split(',').map((argument) => {
    const withoutDefault = argument.replace(/\s+default\s+[\s\S]*$/i, '').trim();
    return withoutDefault.split(/\s+/).at(-1)?.toLowerCase() ?? '';
  });
}

function functionContract(migrationText, functionName, internalOnly) {
  const escaped = escapeRegExp(functionName);
  const expected = ATTENDANCE_RPC_CONTRACTS[functionName];
  let definition = '';
  for (const statement of sqlStatements(migrationText)) {
    if (new RegExp(String.raw`^\s*create\s+(?:or\s+replace\s+)?function\s+climate_vote\.${escaped}\b`, 'i').test(statement)) {
      definition = statement;
    }
    if (new RegExp(String.raw`^\s*drop\s+function\s+(?:if\s+exists\s+)?climate_vote\.${escaped}\b`, 'i').test(statement)) {
      definition = '';
    }
  }
  const securityDefiner = /\bsecurity\s+definer\b/i.test(definition);
  const safeSearchPath = /\bset\s+search_path\s*=\s*climate_vote\s*,(?:\s*extensions\s*,)?\s*pg_temp\b/i.test(definition);
  const signature = expected ? definitionArgTypes(definition, functionName) : [];
  const signatureMatches = expected ? JSON.stringify(signature) === JSON.stringify(expected.args) : false;
  const returnMatches = expected ? new RegExp(String.raw`\breturns\s+${expected.returns}\b`, 'i').test(definition) : false;
  const scopeMatches = expected ? new RegExp(expected.scope, 'i').test(definition) : false;
  const privileges = functionPrivileges(migrationText, functionName, expected?.args ?? []);
  const publicRevoked = privileges.publicRevoked;
  const anonGranted = privileges.roles.has('anon');
  const authGranted = privileges.roles.has('authenticated');
  const executable = internalOnly ? !anonGranted && !authGranted : anonGranted || authGranted;
  return {
    staticPatternComplete: Boolean(definition) && signatureMatches && returnMatches && scopeMatches
      && securityDefiner && safeSearchPath && publicRevoked && executable,
    definition: Boolean(definition),
    signatureMatches,
    returnMatches,
    scopeMatches,
    securityDefiner,
    safeSearchPath,
    publicRevoked,
    allowedRoleGranted: executable,
  };
}

function contractDocumentStatus(contractText) {
  return {
    approved: /Contract status:\s*approved\b/i.test(contractText),
    rollbackPlan: /Rollback status:\s*rehearsed\b/i.test(contractText) && /## Rollback plan\b/i.test(contractText),
    failureModeMatrix: /Failure-mode status:\s*verified\b/i.test(contractText) && /## Write-path failure modes\b/i.test(contractText),
  };
}

/** Evaluates ordered repository evidence without connecting to Supabase or mutating data. */
export function evaluateCanvasDbContract({ sourceText, migrationText, contractText = '' }) {
  if (typeof sourceText !== 'string' || typeof migrationText !== 'string' || typeof contractText !== 'string') {
    throw new Error('Canvas database contract inputs must be strings');
  }
  const cleanSource = stripSourceComments(sourceText);
  const blockers = [];
  const sourceInventory = sourceTableOperations(cleanSource);
  const expectedSourcePairs = new Set(TABLE_CONTRACTS.flatMap((contract) => (
    contract.sourceOperations.map((operation) => `${contract.table}.${operation}`)
  )));
  for (const entry of sourceInventory) {
    if (!expectedSourcePairs.has(`${entry.table}.${entry.operation}`)) {
      blockers.push(`source.${entry.table}.${entry.operation}_unreviewed`);
    }
  }
  const attendanceRpcNames = [...new Set(sourceRpcNames(cleanSource).filter((name) => name.startsWith('attendance_')))];
  const tables = TABLE_CONTRACTS.map((contract) => {
    const requiredSourceOperations = contract.sourceOperations;
    const sourceOperations = requiredSourceOperations.filter((operation) => hasSourceOperation(cleanSource, contract.table, operation));
    for (const operation of requiredSourceOperations) {
      if (!sourceOperations.includes(operation)) blockers.push(`source.${contract.table}.${operation}_missing`);
    }
    const sourceRealtime = contract.sourceRealtime ? hasRealtimeSource(cleanSource, contract.table) : null;
    if (contract.sourceRealtime && !sourceRealtime) blockers.push(`source.${contract.table}.realtime_missing`);

    const state = tableState(migrationText, contract.table);
    const schemaText = state.schemaStatements.join('\n');
    const missingColumns = contract.columns
      .filter(([column, typePattern]) => (
        state.removedColumns.has(column) || !definitionHasColumn(schemaText, column, typePattern)
      ))
      .map(([column, typePattern]) => `${column}:${typePattern}`);
    const missingConstraints = contract.constraints
      .filter(([, pattern]) => state.constraintsInvalidated || !new RegExp(pattern, 'i').test(schemaText))
      .map(([label]) => label);
    const missingForeignKeys = contract.foreignKeys
      .filter(([column, target]) => !definitionHasForeignKey(schemaText, column, target))
      .map(([column, target]) => `${column}->${target}`);
    const access = contract.privateRpc
      ? {
          complete: ['anon', 'authenticated'].every((role) => (
            state.directRevokedRoles.has(role) && (state.grants.get(role)?.size ?? 0) === 0
          )),
          missing: [],
        }
      : accessFinding(state, contract.access);
    if (!state.definition) blockers.push(`migration.${contract.table}.definition_missing`);
    if (missingColumns.length) blockers.push(`migration.${contract.table}.columns_missing`);
    if (missingConstraints.length) blockers.push(`migration.${contract.table}.constraints_missing`);
    if (missingForeignKeys.length) blockers.push(`migration.${contract.table}.foreign_keys_missing`);
    if (!state.rlsEnabled) blockers.push(`migration.${contract.table}.rls_missing`);
    if (!access.complete) blockers.push(`migration.${contract.table}.access_missing`);
    if (contract.realtimePublication && !state.realtimePublished) blockers.push(`migration.${contract.table}.realtime_missing`);
    if (contract.sourceRealtime && !state.realtimeReplicaIdentity) blockers.push(`migration.${contract.table}.replica_identity_missing`);
    return {
      table: contract.table,
      requiredSourceOperations,
      sourceOperations,
      sourceRealtime,
      migrationDefinition: Boolean(state.definition),
      missingColumns,
      missingConstraints,
      missingForeignKeys,
      rlsEnabled: state.rlsEnabled,
      staticAccessPattern: access.complete,
      missingAccess: access.missing,
      realtimePublished: contract.realtimePublication ? state.realtimePublished : null,
      realtimeReplicaIdentity: contract.sourceRealtime ? state.realtimeReplicaIdentity : null,
    };
  });

  const rpcNames = [...new Set([...attendanceRpcNames, 'attendance_token_row'])];
  const rpcs = rpcNames.map((name) => ({
    name,
    sourceCall: name === 'attendance_token_row' ? null : hasRpcSource(cleanSource, name),
    ...functionContract(migrationText, name, name === 'attendance_token_row'),
  }));
  for (const rpc of rpcs) {
    if (!rpc.staticPatternComplete) blockers.push(`migration.rpc.${rpc.name}.contract_missing`);
  }

  const document = contractDocumentStatus(contractText);
  if (!document.approved) blockers.push('approval.m1_contract_missing');
  if (!document.rollbackPlan) blockers.push('contract.rollback_plan_missing');
  if (!document.failureModeMatrix) blockers.push('contract.failure_mode_matrix_missing');
  blockers.push('verification.semantic_review_required');
  return {
    status: 'not_ready',
    m1Complete: false,
    staticAnalysisOnly: true,
    canApproveM1: false,
    analysisLimitations: [
      'SQL and RLS semantics require manual and stage verification.',
      'Source inventory recognizes literal Supabase table builders only.',
      'RPC body pattern matches do not prove authorization or mutation behavior.',
    ],
    databaseAccess: false,
    databaseMutationExecuted: false,
    contractDocument: document,
    sourceInventory,
    tables,
    rpcs,
    blockers,
  };
}

export function parseCliArgs(argv) {
  const options = { outputJson: 'evaluation/canvas-db-contract.json', allowDirtySource: false };
  let outputSeen = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--allow-dirty-source') {
      options.allowDirtySource = true;
      continue;
    }
    if (argument === '--output-json') {
      if (outputSeen || !argv[index + 1] || argv[index + 1].startsWith('--')) {
        throw new Error('Invalid --output-json option');
      }
      outputSeen = true;
      options.outputJson = argv[index + 1];
      index += 1;
      continue;
    }
    throw new Error('Unknown Canvas database contract option');
  }
  return options;
}

function sourcePaths(projectRoot) {
  const found = [];
  const walk = (relativeDirectory) => {
    for (const entry of readdirSync(resolve(projectRoot, relativeDirectory), { withFileTypes: true })) {
      const path = `${relativeDirectory}/${entry.name}`;
      if (entry.isDirectory()) walk(path);
      else if (/\.(?:ts|tsx)$/.test(entry.name) && !/\.test\.(?:ts|tsx)$/.test(entry.name)) found.push(path);
    }
  };
  walk(SOURCE_DIRECTORY);
  return [...FIXED_SOURCE_PATHS, ...found].sort();
}

function readContractInputs(projectRoot) {
  const migrationPaths = readdirSync(resolve(projectRoot, MIGRATION_DIRECTORY))
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .map((name) => `${MIGRATION_DIRECTORY}/${name}`);
  const sources = sourcePaths(projectRoot);
  return {
    sourceText: sources.map((path) => readFileSync(resolve(projectRoot, path), 'utf8')).join('\n'),
    migrationText: migrationPaths.map((path) => readFileSync(resolve(projectRoot, path), 'utf8')).join('\n'),
    contractText: readFileSync(resolve(projectRoot, CONTRACT_DOCUMENT_PATH), 'utf8'),
    migrationPaths,
    sources,
  };
}

function contractTreeSha256(projectRoot, paths) {
  const hash = createHash('sha256');
  for (const path of [...paths].sort()) {
    hash.update(path);
    hash.update('\0');
    hash.update(readFileSync(resolve(projectRoot, path)));
    hash.update('\0');
  }
  return hash.digest('hex');
}

/** Builds a provenance-bound diagnostic report from repository files only. */
export function buildCanvasDbContractEvidence({ projectRoot, allowDirtySource = false }) {
  const { sourceText, migrationText, contractText, migrationPaths, sources } = readContractInputs(projectRoot);
  const hashedPaths = [CONTRACT_MODULE_PATH, CONTRACT_DOCUMENT_PATH, ...sources, ...migrationPaths];
  const statusPaths = [CONTRACT_MODULE_PATH, CONTRACT_DOCUMENT_PATH, ...FIXED_SOURCE_PATHS, SOURCE_DIRECTORY, MIGRATION_DIRECTORY];
  const statusOutput = execFileSync(
    'git',
    ['status', '--porcelain', '--untracked-files=all', '--', ...statusPaths],
    { cwd: projectRoot, encoding: 'utf8' },
  );
  if (statusOutput.trim() && !allowDirtySource) throw new Error('Canvas database contract source tree is dirty');
  const evaluation = evaluateCanvasDbContract({ sourceText, migrationText, contractText });
  return {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: projectRoot, encoding: 'utf8' }).trim(),
    sourceTreeClean: !statusOutput.trim(),
    sourceTreeSha256: contractTreeSha256(projectRoot, hashedPaths),
    sourcePaths: sources,
    contractDocumentPath: CONTRACT_DOCUMENT_PATH,
    migrationDirectory: MIGRATION_DIRECTORY,
    migrationFileCount: migrationPaths.length,
    blockerCount: evaluation.blockers.length,
    ...evaluation,
  };
}

function runCli() {
  const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const options = parseCliArgs(process.argv.slice(2));
  const outputPath = resolve(projectRoot, options.outputJson);
  const report = buildCanvasDbContractEvidence({ projectRoot, allowDirtySource: options.allowDirtySource });
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ reportPath: relative(projectRoot, outputPath), status: report.status, blockerCount: report.blockerCount }));
  if (report.status !== 'ready') {
    console.error('Canvas database contract is not ready; see report artifact.');
    process.exitCode = 1;
  }
}

const isCli = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isCli) {
  try {
    runCli();
  } catch (error) {
    console.error('Canvas database contract verification failed.');
    console.error(error instanceof Error ? error.message : 'Unknown verification error');
    process.exitCode = 1;
  }
}
