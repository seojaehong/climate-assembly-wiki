import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(new URL('../../supabase/migrations/platform_p1c_org_selection.sql', import.meta.url), 'utf8');
const rollback = readFileSync(new URL('../../supabase/rollbacks/platform_p1c_org_selection_BEFORE.sql', import.meta.url), 'utf8');
const activationRollback = readFileSync(new URL('../../supabase/rollbacks/platform_p1c_org_selection_activation_BEFORE.sql', import.meta.url), 'utf8');
const verificationDriver = readFileSync(new URL('../../supabase/verify/driver_pass1.sql', import.meta.url), 'utf8');
const semanticRehearsal = readFileSync(new URL('../../supabase/verify/org_selection_test.sql', import.meta.url), 'utf8');
const postApplyVerification = readFileSync(new URL('../../supabase/verify/org_selection_post_apply.sql', import.meta.url), 'utf8');
const testWorkflow = readFileSync(new URL('../../.github/workflows/test.yml', import.meta.url), 'utf8');

function executableSql(source) {
  return source.replace(/^\s*--.*$/gm, '');
}

describe('A2 organization selection migration draft', () => {
  it('binds an opaque tab token to the authenticated user and Supabase session', () => {
    expect(migration).toContain('create table if not exists climate_vote.org_context');
    expect(migration).toContain('token_hash bytea primary key');
    expect(migration).toContain("v_session_text := nullif(auth.jwt() ->> 'session_id', '')");
    expect(migration).toContain("v_headers ->> 'x-platform-org-context'");
    expect(migration).toContain("extensions.digest(v_token::text, 'sha256')");
    expect(migration).toContain('c.user_id = auth.uid()');
    expect(migration).toContain('c.session_id = climate_vote.auth_session_id()');
    expect(migration).toContain("expires_at timestamptz not null default (now() + interval '12 hours')");
    expect(migration).toContain('and c.expires_at > current_timestamp');
    expect(migration).toContain('where c.expires_at <= clock_timestamp()');
  });

  it('returns only active memberships and rejects an unowned organization selection', () => {
    expect(migration).toContain('create or replace function climate_vote.my_orgs()');
    expect(migration).toContain('create or replace function climate_vote.org_select(p_org uuid)');
    expect(migration).toContain("m.status = 'active'");
    expect(migration).toContain("o.status = 'active'");
    expect(migration).toContain("raise exception 'organization selection is not allowed'");
  });

  it('requires one selected organization in multi-membership RLS policies', () => {
    expect(migration).toContain("raise exception 'organization selection required'");
    for (const table of ['assembly', 'session', 'discussion_topic', 'submission', 'ballot']) {
      expect(migration).toContain(`alter table climate_vote.${table} enable row level security`);
    }
    expect(migration.match(/using \(org_id = climate_vote\.org_of_uid\(\)\)/g)).toHaveLength(5);
    expect(executableSql(migration)).not.toMatch(/using \(org_id in \(select m\.org_id/);
  });

  it('keeps staff table activation grants disabled in the draft', () => {
    expect(executableSql(migration)).not.toMatch(/grant select on climate_vote\.membership/);
    expect(executableSql(migration)).not.toMatch(/grant usage on schema climate_vote to authenticated/);
    expect(migration).toContain('-- grant usage on schema climate_vote to authenticated;');
    expect(migration).toContain('-- grant select, insert, update on climate_vote.assembly');
    expect(migration).toContain('Activation grants remain intentionally disabled in this draft.');
  });

  it('provides a rollback that restores the prior fail-closed multi-org behavior', () => {
    expect(rollback).toContain("raise exception 'user belongs to multiple orgs — explicit org selection required (Phase 2 org_select)'");
    expect(rollback).toContain('drop table if exists climate_vote.org_context');
    expect(rollback).toContain('using (org_id in (select m.org_id from climate_vote.membership m');
    expect(activationRollback).toContain('revoke select, insert, update, delete on');
    expect(activationRollback).toContain('revoke select, insert, update, delete on climate_vote.membership');
    expect(activationRollback).not.toContain('revoke usage on schema climate_vote');
  });

  it('keeps the migration and rollback in the throwaway PostgreSQL rehearsal contract', () => {
    expect(verificationDriver.indexOf('platform_p1_tenancy.sql'))
      .toBeLessThan(verificationDriver.indexOf('platform_p1c_org_selection.sql'));
    expect(verificationDriver.indexOf('platform_p1c_org_selection.sql'))
      .toBeLessThan(verificationDriver.indexOf('platform_p2_analysis_review.sql'));
    expect(semanticRehearsal).toContain("perform climate_vote.org_of_uid()");
    expect(semanticRehearsal).toContain("P1C accepted a context token from another Auth session");
    expect(semanticRehearsal).toContain("P1C accepted a context token from another user");
    expect(semanticRehearsal).toContain("P1C accepted an expired organization context token");
    expect(semanticRehearsal).toContain("P1C organization selection did not prune expired contexts");
    expect(semanticRehearsal).toContain("P1C RLS exposed an organization outside the selected context");
    expect(semanticRehearsal).toContain("P1C RLS did not isolate every staff table to the selected organization");
    expect(semanticRehearsal).toContain("P1C allowed an operator insert outside the selected organization");
    expect(semanticRehearsal).toContain("P1C allowed a facilitator insert");
    expect(semanticRehearsal).toContain('\\set expect_staff_grants on');
    expect(semanticRehearsal).toContain('\\i /tmp/platform_p1c_org_selection_activation_BEFORE.sql');
    expect(semanticRehearsal).toContain('\\set expect_staff_grants off');
    expect(semanticRehearsal).toContain('\\i /tmp/platform_p1c_org_selection_BEFORE.sql');
    expect(semanticRehearsal).toContain('=== P1C ORG SELECTION REHEARSAL PASSED ===');
  });

  it('provides a read-only post-apply verifier for dormant and activated staff grants', () => {
    expect(postApplyVerification).toContain('expect_staff_grants');
    expect(postApplyVerification).toContain("current_setting('platform.verify_expect_staff_grants')::boolean");
    expect(postApplyVerification).toContain("c.relname in ('org_context', 'assembly', 'session', 'discussion_topic', 'submission', 'ballot')");
    expect(postApplyVerification).toContain("('discussion_topic', 'topic_tenant_write', 'ALL')");
    expect(postApplyVerification).toContain('if v_count <> 10 then');
    expect(postApplyVerification).toContain("p.roles = array['authenticated'::name]");
    expect(postApplyVerification).toContain("regexp_replace(p.qual, E'\\\\s+', '', 'g')");
    expect(postApplyVerification).toContain("v_expected_qual := '(org_id=org_of_uid())'");
    expect(postApplyVerification).toContain('m.org_id=%I.org_id');
    expect(postApplyVerification).toContain('tenant policy definition is unsafe');
    expect(postApplyVerification).toContain("has_schema_privilege('authenticated', 'climate_vote', 'USAGE')");
    expect(postApplyVerification).toContain('if v_expect_staff_grants');
    expect(postApplyVerification).toContain("has_table_privilege('authenticated', 'climate_vote.membership', 'SELECT')");
    expect(postApplyVerification).toContain("has_table_privilege('authenticated', format('climate_vote.%I', v_table), 'DELETE')");
    expect(postApplyVerification).toContain("'database_mutation_executed', false");
    expect(postApplyVerification).toContain('=== P1C ORG SELECTION POST-APPLY VERIFICATION PASSED ===');

    const executableVerification = executableSql(postApplyVerification);
    expect(executableVerification).not.toMatch(/\binsert\s+into\b/i);
    expect(executableVerification).not.toMatch(/\bupdate\s+climate_vote\b/i);
    expect(executableVerification).not.toMatch(/\bdelete\s+from\b/i);
    expect(executableVerification).not.toMatch(/\balter\s+table\b/i);
    expect(executableVerification).not.toMatch(/^\s*(?:grant|revoke)\s+/im);
  });

  it('runs the P1C semantic and weakened-policy gates in CI', () => {
    expect(testWorkflow).toContain("- 'supabase/**'");
    expect(testWorkflow).toContain('Verify P1C organization selection semantics');
    expect(testWorkflow).toContain('-v verify_function_bodies=on -f /tmp/driver_pass1.sql');
    expect(testWorkflow).toContain('alter policy assembly_tenant_read on climate_vote.assembly using (true)');
    expect(testWorkflow).toContain('grep -q "tenant policy definition is unsafe"');
    expect(testWorkflow).toContain('-f /tmp/org_selection_test.sql');
  });
});
