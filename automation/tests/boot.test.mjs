import { test, expect } from 'vitest';
import yaml from 'js-yaml';
import { readFileSync } from 'node:fs';

test('schedule.yml parses with expected shape', () => {
  const d = yaml.load(readFileSync(new URL('../workshop-schedule.yml', import.meta.url), 'utf8'));
  expect(d.base_url).toBe('https://climate-assembly.org');
  expect(d.pages).toHaveLength(4);
  expect(d.workshops).toHaveLength(2);
  expect(new Date(d.workshops[0].date).toISOString().slice(0, 10)).toBe('2026-07-04');
  expect(new Date(d.workshops[1].date).toISOString().slice(0, 10)).toBe('2026-08-29');
});
