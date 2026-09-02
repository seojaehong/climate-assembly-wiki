import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const tokens = readFileSync(new URL('./tokens.css', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const global = readFileSync(new URL('./global.css', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

describe('Phase C locale typography', () => {
  it('provides script-aware system font stacks without a new remote font request', () => {
    expect(tokens).toContain('html:lang(ja)');
    expect(tokens).toContain('"Hiragino Sans", "Yu Gothic UI"');
    expect(tokens).toContain('html:lang(zh)');
    expect(tokens).toContain('"PingFang SC", "Microsoft YaHei"');
    expect(tokens).toContain('html:lang(ar)');
    expect(tokens).toContain('"Noto Sans Arabic", "Segoe UI", Tahoma, Arial');
    expect(tokens).not.toMatch(/html:lang\((?:ja|zh|ar)\)[\s\S]*?url\(/);
  });

  it('does not apply Korean or Latin-tight tracking to Arabic body or headings', () => {
    expect(tokens).toMatch(/html:lang\(ar\)[\s\S]*?--tracking-tight: 0;[\s\S]*?--tracking-snug: 0;/);
    expect(global).toMatch(/html:lang\(ar\) body[\s\S]*?letter-spacing: normal;/);
    expect(global).toContain("html[dir='rtl'] body {\n  font-family: var(--font-body);");
  });
});
