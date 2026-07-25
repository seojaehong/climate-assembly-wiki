import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync('supabase/migrations/20260725_attendance_roster_hq.sql', 'utf8');
const rollback = readFileSync('supabase/rollbacks/20260725_BEFORE_attendance_roster_hq.sql', 'utf8');

describe('attendance migration security contract', () => {
  it('keeps votes anonymous and adds only roster-side relations', () => {
    expect(migration).not.toMatch(/alter\s+table\s+climate_vote\.votes/i);
    expect(migration).toContain('create table if not exists climate_vote.assembly_member');
    expect(migration).toContain('create table if not exists climate_vote.attendance_audit_log');
    expect(migration).toContain('create table if not exists climate_vote.round_attendance_snapshot');
  });

  it('protects private tables and exposes only aggregate HQ data publicly', () => {
    for (const table of [
      'assembly_member',
      'team_assignment',
      'attendance',
      'attendance_audit_log',
      'attendance_secret',
      'attendance_auth_session',
    ]) {
      expect(migration).toContain(`alter table climate_vote.${table} enable row level security`);
    }
    expect(migration).toContain('revoke all on climate_vote.assembly_member');
    const publicSummary = migration.slice(
      migration.indexOf('create or replace function climate_vote.attendance_hq_summary()'),
      migration.indexOf('create or replace function climate_vote.attendance_roster('),
    );
    expect(publicSummary).toContain('roster_total int');
    expect(publicSummary).not.toMatch(/member_name|official_id/i);
  });

  it('stores only hashes and applies rate limits and expiring random sessions', () => {
    expect(migration).toContain('secret_hash text not null');
    expect(migration).toContain('attendance_pin_hash text');
    expect(migration).toContain("gen_random_bytes(32)");
    expect(migration).toContain("now() + interval '8 hours'");
    expect(migration).toContain('if v_failures >= 5 then return null');
    expect(migration).not.toMatch(/insert into climate_vote\.attendance_secret[\s\S]*values\s*\([^)]*,\s*'[^']+'\)/i);
  });

  it('has a corresponding rollback for every new relation', () => {
    for (const table of [
      'round_attendance_snapshot',
      'attendance_auth_attempt',
      'attendance_auth_session',
      'attendance_secret',
      'attendance_audit_log',
      'attendance',
      'team_assignment',
      'assembly_member',
    ]) {
      expect(rollback).toContain(`drop table if exists climate_vote.${table}`);
    }
  });
});
