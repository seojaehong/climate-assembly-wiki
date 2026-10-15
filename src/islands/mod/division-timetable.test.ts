import { describe, it, expect } from 'vitest';
import { DECISION_TIMETABLE, currentTimetableBlock } from './division-timetable';

const kst = (hm: string, date = '2026-10-17') => new Date(`${date}T${hm}:00+09:00`);

describe('currentTimetableBlock', () => {
  it('finds the block on the event day (KST)', () => {
    expect(currentTimetableBlock(kst('11:10'))?.id).toBe('merge1');
    expect(currentTimetableBlock(kst('14:29'))?.id).toBe('merge2');
    expect(currentTimetableBlock(kst('15:00'))?.id).toBe('edit');
    expect(currentTimetableBlock(kst('16:44'))?.id).toBe('final');
  });
  it('is null in breaks, outside the day, and on other days', () => {
    for (const hm of ['11:05', '12:30', '14:30', '16:05', '16:45']) expect(currentTimetableBlock(kst(hm))).toBeNull();
    expect(currentTimetableBlock(kst('11:30', '2026-10-15'))).toBeNull();
  });
  it('uses KST, not the machine clock zone', () => {
    expect(currentTimetableBlock(new Date('2026-10-17T02:30:00Z'))?.id).toBe('merge1'); // 11:30 KST
  });
  it('blocks are ordered and do not overlap', () => {
    for (let i = 1; i < DECISION_TIMETABLE.length; i++) expect(DECISION_TIMETABLE[i - 1].end <= DECISION_TIMETABLE[i].start).toBe(true);
  });
});
