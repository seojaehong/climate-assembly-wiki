/**
 * append-log.mjs — K1 (llmwiki-uplift)
 *
 * Detects changed .md files in the wiki (via git diff HEAD), reads their
 * last_updated frontmatter, and prepends draft log entries to wiki/log.md.
 *
 * Format (strict, lint target):
 *   YYYY-MM-DD HH:MM | [ingest|update|session|lint] | <path> | <description>
 *
 * Behavior:
 *   - If git is unavailable, falls back to comparing mtime (current build run).
 *   - If log.md doesn't exist, seeds it with header + first entry.
 *   - Always prepends (newest at top).
 *   - Deduplicates: won't append the same path+date combo twice in one run.
 *
 * Run: node scripts/append-log.mjs (from wiki/ directory)
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import matter from 'gray-matter';

const __filename = fileURLToPath(import.meta.url);
const __dir = dirname(__filename);
const WIKI_ROOT = resolve(__dir, '..');
const LOG_OUT = join(WIKI_ROOT, 'log.md');
const CONTENT_KO = join(WIKI_ROOT, 'content', 'ko');

const LOG_HEADER = `<!-- APPEND-ONLY. Newest entries at top. -->
<!-- Format: YYYY-MM-DD HH:MM | [ingest|update|session|lint] | <path> | <description> -->
<!-- DO NOT reorder or delete lines — this is a content changelog, not a git log. -->

`;

/** Get ISO-like timestamp for now: YYYY-MM-DD HH:MM */
function nowStamp() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Try to get changed .md files from git diff HEAD. Returns array of relative paths. */
function getChangedFiles() {
  try {
    const out = execSync('git diff --name-only HEAD', {
      cwd: WIKI_ROOT,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return out.split('\n').filter(f => f.endsWith('.md') && f.includes('content/'));
  } catch {
    return null; // git unavailable or clean index
  }
}

/** Fallback: files modified within the last 5 minutes */
function getRecentlyModifiedFiles() {
  const now = Date.now();
  const cutoff = 5 * 60 * 1000; // 5 minutes
  const results = [];

  function walk(dir, prefix) {
    try {
      const entries = readdirSync(dir);
      for (const entry of entries) {
        const full = join(dir, entry);
        const rel = prefix ? `${prefix}/${entry}` : entry;
        const st = statSync(full);
        if (st.isDirectory()) {
          walk(full, rel);
        } else if (entry.endsWith('.md') && now - st.mtimeMs < cutoff) {
          results.push(`content/ko/${rel}`);
        }
      }
    } catch { /* skip */ }
  }

  walk(CONTENT_KO, '');
  return results;
}

/** Determine event type from file path or frontmatter */
function inferType(filePath, data) {
  if (filePath.includes('/session/')) return 'session';
  if (filePath.includes('/agenda/')) return 'update';
  return 'update';
}

/** Normalize a date value (may be JS Date object from YAML) to YYYY-MM-DD string. */
function normalizeDate(val) {
  if (!val) return '';
  if (val instanceof Date) {
    const pad = n => String(n).padStart(2, '0');
    return `${val.getFullYear()}-${pad(val.getMonth() + 1)}-${pad(val.getDate())}`;
  }
  return String(val);
}

/** Build a log line from a file path */
function buildLogLine(relPath, timestamp) {
  const fullPath = join(WIKI_ROOT, relPath);
  let data = {};
  try {
    const raw = readFileSync(fullPath, 'utf-8');
    ({ data } = matter(raw));
  } catch { /* use empty data */ }

  const type = inferType(relPath, data);
  const lastUpdated = normalizeDate(data.last_updated);
  const desc = data.title
    ? `${data.title}${lastUpdated ? ` (last_updated: ${lastUpdated})` : ''}`
    : `${relPath} updated`;

  return `${timestamp} | ${type} | ${relPath} | ${desc}`;
}

// --- Main ---
const timestamp = nowStamp();

// Prefer git diff; fall back to mtime scan
let changed = getChangedFiles();
if (!changed || changed.length === 0) {
  changed = getRecentlyModifiedFiles();
}

// Filter out index.md and log.md themselves
changed = changed.filter(f => !f.endsWith('index.md') && !f.endsWith('log.md'));

// Also add a build marker line (always)
const buildLine = `${timestamp} | lint | wiki/index.md | wiki:reindex + wiki:log prebuild run`;

const newLines = [buildLine];
for (const file of changed) {
  newLines.push(buildLogLine(file, timestamp));
}

// Read existing log or seed
let existing = '';
if (existsSync(LOG_OUT)) {
  existing = readFileSync(LOG_OUT, 'utf-8');
  // Strip header if present (we'll re-prepend)
  if (existing.startsWith('<!-- APPEND-ONLY')) {
    const firstEntry = existing.indexOf('\n\n') + 2;
    existing = existing.slice(firstEntry);
  }
}

// Deduplicate: skip lines that already appear in existing
const toAdd = newLines.filter(line => !existing.includes(line));

if (toAdd.length === 0) {
  console.log('[append-log] No new entries to add (all deduplicated).');
} else {
  const combined = LOG_HEADER + toAdd.join('\n') + '\n' + existing;
  writeFileSync(LOG_OUT, combined, 'utf-8');
  console.log(`[append-log] wiki/log.md updated — ${toAdd.length} new line(s) prepended.`);
}
