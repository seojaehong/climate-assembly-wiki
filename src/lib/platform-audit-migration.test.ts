import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync('supabase/migrations/platform_p4_audit_log.sql', 'utf8');
const rollback = readFileSync('supabase/rollbacks/platform_p4_audit_log_BEFORE.sql', 'utf8');

describe('A6 platform audit migration contract', () => {
  it('is an explicitly dormant, append-only audit package', () => {
    expect(migration).toContain('Draft only. Do not apply without separate production approval.');
    expect(migration).toContain('create table climate_vote.platform_audit_event');
    expect(migration).toContain('create trigger platform_audit_event_immutable');
    expect(migration).toContain('create trigger platform_audit_event_no_truncate');
    expect(migration).toContain("raise exception 'platform audit events are append-only'");
    expect(migration).toContain('alter table climate_vote.platform_audit_event enable row level security');
    expect(migration).toContain('revoke all on climate_vote.platform_audit_event from public, anon, authenticated, authenticator, service_role');
    expect(migration).toMatch(/revoke all on sequence climate_vote\.platform_audit_event_id_seq\s+from public, anon, authenticated, authenticator, service_role/);
  });

  it('records metadata atomically without copying row values or accepting an org claim', () => {
    expect(migration).toContain('create or replace function climate_vote.platform_audit_row_change()');
    expect(migration).toContain('to_jsonb(new)');
    expect(migration).toContain('to_jsonb(old)');
    expect(migration).toContain('changed_fields');
    expect(migration).not.toMatch(/before_values|after_values|old_values|new_values/);
    expect(migration).not.toMatch(/\b(row_data|payload|snapshot)\s+jsonb\s+not null/);
    expect(migration).not.toMatch(/platform_audit_list\s*\([^)]*p_org/i);
  });

  it('covers platform mutations and resolves child rows through their tenant parent', () => {
    for (const table of [
      'org', 'membership', 'invitation', 'assembly', 'session', 'discussion_topic',
      'team', 'submission', 'submission_item', 'ballot', 'ballot_item', 'issue',
      'issue_link', 'result_page', 'design_provisioning_operation',
    ]) {
      expect(migration).toContain(`on climate_vote.${table}`);
    }
    expect(migration).toContain("when 'submission_item' then");
    expect(migration).toContain("when 'ballot_item' then");
    expect(migration).toContain("when 'issue_link' then");
    expect(migration).toContain("tg_table_name in ('submission', 'ballot', 'issue')");
    expect(migration).toContain('platform audit refuses cross-organization resource move');
  });

  it('exposes only a selected-org, privileged, bounded read RPC', () => {
    expect(migration).toContain('create or replace function climate_vote.platform_audit_list(');
    expect(migration).toContain('v_org_id := climate_vote.org_of_uid()');
    expect(migration).toMatch(/m\.role in \('org_admin', 'operator', 'hq'\)/);
    expect(migration).toContain('greatest(1, least(coalesce(p_limit, 100), 500))');
    expect(migration).toContain('grant execute on function climate_vote.platform_audit_list(bigint, integer) to authenticated');
    expect(migration).toContain("'id', visible.id::text");
    expect(migration).toContain("'transaction_id', visible.transaction_id::text");
    expect(migration).toMatch(/revoke all on function climate_vote\.platform_audit_list\(bigint, integer\)\s+from public, anon, authenticator, service_role/);
  });

  it('has a rollback that refuses to discard existing evidence', () => {
    expect(rollback).toContain("raise exception 'platform_audit_rollback_requires_retention_plan'");
    expect(rollback).toContain('drop table if exists climate_vote.platform_audit_event');
    expect(rollback).toContain('drop function if exists climate_vote.platform_audit_list(bigint, integer)');
  });
});
