import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  fileURLToPath(new URL('./SiteHeader.astro', import.meta.url)),
  'utf8',
).replace(/\r\n/g, '\n');
const footerSource = readFileSync(
  fileURLToPath(new URL('./SiteFooter.astro', import.meta.url)),
  'utf8',
).replace(/\r\n/g, '\n');
const searchSource = readFileSync(
  fileURLToPath(new URL('./SearchModal.astro', import.meta.url)),
  'utf8',
).replace(/\r\n/g, '\n');
const baseLayoutSource = readFileSync(
  fileURLToPath(new URL('../layouts/BaseLayout.astro', import.meta.url)),
  'utf8',
).replace(/\r\n/g, '\n');
const deprecatedBaseSource = readFileSync(
  fileURLToPath(new URL('../layouts/Base.astro', import.meta.url)),
  'utf8',
).replace(/\r\n/g, '\n');

describe('SiteHeader locale navigation contract', () => {
  it('recognizes every locale through the central registry', () => {
    expect(source).toContain("import { isSiteLocale, siteShellCopy } from '../lib/site-locales';");
    expect(source).toContain("const currentLang = isSiteLocale(segments[0]) ? segments[0] : 'ko';");
    expect(source).toContain('const shellCopy = siteShellCopy(currentLang);');
    expect(source).toContain('aria-label={shellCopy.openSearch}');
    expect(source).toContain('aria-label={shellCopy.openMenu}');
  });

  it('offers the language toggle in desktop and mobile navigation', () => {
    expect(source.match(/<LanguageToggle\s*\/>/g)).toHaveLength(2);
    expect(source.match(/data-search-trigger/g)).toHaveLength(2);
    expect(source).toContain('aria-label="Language / 언어"');
  });

  it('passes the localized theme label and mirrors desktop menus for RTL', () => {
    expect(source).toContain('<ThemeToggle label={shellCopy.themeToggle} />');
    expect(source).toContain(":global(html[dir='rtl']) .desktop-submenu");
  });

  it('uses one locale contract across the shared footer, search, and base layout', () => {
    expect(footerSource).toContain("const currentLang = isSiteLocale(segments[0]) ? segments[0] : 'ko';");
    expect(footerSource).toContain('const shellCopy = siteShellCopy(currentLang);');
    expect(searchSource).toContain('const shellCopy = siteShellCopy(lang);');
    expect(baseLayoutSource).toContain('const shellCopy = siteShellCopy(lang);');
    expect(baseLayoutSource).toContain('{shellCopy.skipToContent}');
    expect(deprecatedBaseSource).toContain('const shellCopy = siteShellCopy(lang);');
    expect(deprecatedBaseSource).toContain('{shellCopy.skipToContent}');
    expect(deprecatedBaseSource).toContain('<SearchModal lang={lang} />');
  });
});
