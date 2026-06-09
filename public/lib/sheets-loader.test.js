import { describe, test, expect } from 'vitest';
import { parseCSV, csvToAgendas, buildSheetUrl, pickAgendas } from './sheets-loader.js';

describe('parseCSV', () => {
  test('returns empty array for empty input', () => {
    expect(parseCSV('')).toEqual([]);
  });

  test('parses single row with comma-separated fields', () => {
    expect(parseCSV('a,b,c')).toEqual([['a', 'b', 'c']]);
  });

  test('parses multiple rows split by LF', () => {
    expect(parseCSV('a,b\nc,d')).toEqual([['a', 'b'], ['c', 'd']]);
  });

  test('handles CRLF row separators', () => {
    expect(parseCSV('a,b\r\nc,d')).toEqual([['a', 'b'], ['c', 'd']]);
  });

  test('preserves commas inside double-quoted fields', () => {
    expect(parseCSV('"a,b",c')).toEqual([['a,b', 'c']]);
  });

  test('handles escaped double quotes inside quoted field', () => {
    expect(parseCSV('"He said ""hi""",x')).toEqual([['He said "hi"', 'x']]);
  });

  test('skips fully-empty rows', () => {
    expect(parseCSV('a,b\n,,\nc,d')).toEqual([['a', 'b'], ['c', 'd']]);
  });
});

describe('csvToAgendas', () => {
  const validHeader = 'slot,name,short,color,c1,c2,c3,c4';

  test('throws when fewer than 2 rows', () => {
    expect(() => csvToAgendas('')).toThrow(/empty/i);
    expect(() => csvToAgendas(validHeader)).toThrow(/empty/i);
  });

  test('throws when required header missing', () => {
    expect(() => csvToAgendas('slot,name,short,color,c1,c2,c3\nA,N,S,#000,1,1,1'))
      .toThrow(/missing header: c4/);
  });

  test('parses valid CSV into agenda objects with parsed scores', () => {
    const csv = `${validHeader}\n감축1,전력믹스,전력,#3FA9F5,2.8,2.3,2.9,2.7`;
    expect(csvToAgendas(csv)).toEqual([{
      slot: '감축1',
      name: '전력믹스',
      short: '전력',
      color: '#3FA9F5',
      scores: { c1: 2.8, c2: 2.3, c3: 2.9, c4: 2.7 },
    }]);
  });

  test('filters rows where slot or name is empty', () => {
    const csv = `${validHeader}
감축1,전력믹스,전력,#3FA9F5,2.8,2.3,2.9,2.7
,empty슬롯,x,#000,1,1,1,1
감축2,,emptyname,#000,2,2,2,2`;
    const result = csvToAgendas(csv);
    expect(result).toHaveLength(1);
    expect(result[0].slot).toBe('감축1');
  });

  test('trims whitespace around values', () => {
    const csv = `${validHeader}\n  감축1  , 전력  ,단축,#3FA9F5,2.0,2.0,2.0,2.0`;
    const result = csvToAgendas(csv);
    expect(result[0].slot).toBe('감축1');
    expect(result[0].name).toBe('전력');
  });

  test('header matching is case-insensitive', () => {
    const csv = `SLOT,NAME,SHORT,COLOR,C1,C2,C3,C4\n감축1,전력,단축,#3FA9F5,2,2,2,2`;
    const result = csvToAgendas(csv);
    expect(result).toHaveLength(1);
  });
});

describe('pickAgendas', () => {
  const local = [{ slot: 'L1' }, { slot: 'L2' }];

  test('returns local when sheet is null', () => {
    expect(pickAgendas(local, null)).toEqual({ agendas: local, source: 'local' });
  });

  test('returns sheet when row count matches local', () => {
    const sheet = [{ slot: 'S1' }, { slot: 'S2' }];
    expect(pickAgendas(local, sheet)).toEqual({ agendas: sheet, source: 'sheet' });
  });

  test('returns local with mismatch reason when row count differs', () => {
    const sheet = [{ slot: 'S1' }];
    expect(pickAgendas(local, sheet)).toEqual({
      agendas: local,
      source: 'local',
      reason: 'row count mismatch: 1 vs 2',
    });
  });

  test('returns local when sheet is empty array', () => {
    expect(pickAgendas(local, [])).toEqual({
      agendas: local,
      source: 'local',
      reason: 'row count mismatch: 0 vs 2',
    });
  });
});

describe('buildSheetUrl', () => {
  test('builds gviz CSV URL with sheet ID only', () => {
    expect(buildSheetUrl('ABC123')).toBe(
      'https://docs.google.com/spreadsheets/d/ABC123/gviz/tq?tqx=out:csv'
    );
  });

  test('appends &sheet= when tab name provided', () => {
    expect(buildSheetUrl('ABC123', 'Scores')).toBe(
      'https://docs.google.com/spreadsheets/d/ABC123/gviz/tq?tqx=out:csv&sheet=Scores'
    );
  });

  test('URL-encodes tab names with spaces', () => {
    expect(buildSheetUrl('ABC123', 'My Tab')).toBe(
      'https://docs.google.com/spreadsheets/d/ABC123/gviz/tq?tqx=out:csv&sheet=My%20Tab'
    );
  });

  test('returns null when sheet ID is missing or empty', () => {
    expect(buildSheetUrl('')).toBeNull();
    expect(buildSheetUrl(null)).toBeNull();
    expect(buildSheetUrl(undefined)).toBeNull();
  });
});
