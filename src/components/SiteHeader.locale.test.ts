import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  fileURLToPath(new URL('./SiteHeader.astro', import.meta.url)),
  'utf8',
).replace(/\r\n/g, '\n');

describe('SiteHeader locale navigation contract', () => {
  it('recognizes every locale through the central registry', () => {
    expect(source).toContain("import { isSiteLocale } from '../lib/site-locales';");
    expect(source).toContain("const currentLang = isSiteLocale(segments[0]) ? segments[0] : 'ko';");
  });

  it('offers the language toggle in desktop and mobile navigation', () => {
    expect(source.match(/<LanguageToggle\s*\/>/g)).toHaveLength(2);
    expect(source).toContain('aria-label="Language / 언어"');
  });
});
