import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  new URL('../../supabase/migrations/20260912_s23_division_progress_board.sql', import.meta.url),
  'utf8',
);

describe('9/12 agenda progress migration contract', () => {
  it('creates a separate append-only model and all three RPCs', () => {
    for (const name of ['agenda_item', 'agenda_source_utterance', 'agenda_assignment_event', 'agenda_progress_event']) {
      expect(sql).toContain(`create table if not exists climate_vote.${name}`);
      expect(sql).toContain(`alter table climate_vote.${name} enable row level security`);
    }
    expect(sql).toContain('agenda_board_v1');
    expect(sql).toContain('agenda_assignment_set_v1');
    expect(sql).toContain('agenda_progress_write_v1');
    expect(sql).toContain('agenda_assignment_event_append_only');
    expect(sql).toContain('agenda_progress_event_append_only');
    expect(sql).toContain('before truncate on climate_vote.agenda_progress_event');
    expect(sql).not.toMatch(/delete\s+from\s+climate_vote\.(discussion_topic|submission)/i);
    expect(sql).not.toMatch(/update\s+climate_vote\.(discussion_topic|submission)/i);
  });

  it('seeds exactly 9/8/8 stable agenda identifiers', () => {
    expect(sql.match(/'91210000-0000-4000-8000-[0-9]{12}'/g)).toHaveLength(9);
    expect(sql.match(/'91220000-0000-4000-8000-[0-9]{12}'/g)).toHaveLength(8);
    expect(sql.match(/'91230000-0000-4000-8000-[0-9]{12}'/g)).toHaveLength(8);
    expect(sql).toContain("expected 9/8/8 agenda distribution");
  });

  it('keeps direct table access closed and grants only token RPCs', () => {
    expect(sql).toMatch(/revoke all on climate_vote\.agenda_item[\s\S]+from public, anon, authenticated/i);
    expect(sql).toContain('grant execute on function climate_vote.agenda_board_v1(text,text) to anon, authenticated');
    expect(sql).toContain("if v_auth.scope<>'hq'");
    expect(sql).toContain("v_auth.team_id is distinct from p_team_id");
    expect(sql).toContain('cross-division assignment denied');
    expect(sql).toContain('agenda progress token session mismatch');
    expect(sql).toContain("'agenda-progress:'||p_topic_id::text");
  });
});
