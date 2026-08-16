import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(new URL('../../supabase/migrations/platform_p1c_org_selection.sql', import.meta.url), 'utf8');
const rollback = readFileSync(new URL('../../supabase/rollbacks/platform_p1c_org_selection_BEFORE.sql', import.meta.url), 'utf8');

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
    expect(migration.match(/using \(org_id = climate_vote\.org_of_uid\(\)\)/g)).toHaveLength(5);
    expect(executableSql(migration)).not.toMatch(/using \(org_id in \(select m\.org_id/);
  });

  it('keeps staff table activation grants disabled in the draft', () => {
    expect(executableSql(migration)).not.toMatch(/grant select on climate_vote\.membership/);
    expect(migration).toContain('Activation grants remain intentionally disabled in this draft.');
  });

  it('provides a rollback that restores the prior fail-closed multi-org behavior', () => {
    expect(rollback).toContain("raise exception 'user belongs to multiple orgs — explicit org selection required (Phase 2 org_select)'");
    expect(rollback).toContain('drop table if exists climate_vote.org_context');
    expect(rollback).toContain('using (org_id in (select m.org_id from climate_vote.membership m');
  });
});
