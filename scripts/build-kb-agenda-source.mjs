import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outPath = path.join(root, 'public', 'workshop-graph', 'data', 'kb-agenda-surface.json');
const blockerPath = path.join(root, 'evaluation', 'kb-agenda-source-blocker.json');
const sources = ['overseas-cases', 'kei-expert-agenda', 'citizen-domestic', 'gyeonggi-citizens'];

function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const value = line.trim();
    if (!value || value.startsWith('#') || !value.includes('=')) continue;
    const index = value.indexOf('=');
    const key = value.slice(0, index).trim();
    let envValue = value.slice(index + 1).trim();
    if ((envValue.startsWith('"') && envValue.endsWith('"')) || (envValue.startsWith("'") && envValue.endsWith("'"))) {
      envValue = envValue.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = envValue;
  }
}

function cleanText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function slugify(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 90) || 'agenda';
}

function keywordsFrom(...values) {
  return [...new Set(values
    .flatMap((value) => cleanText(value).split(/[^\p{L}\p{N}]+/u))
    .filter((token) => token.length >= 2 && !/^\d+$/.test(token)))]
    .slice(0, 24);
}

function sourceLabel(source) {
  if (source === 'overseas-cases') return '해외 기후의회 권고';
  if (source === 'kei-expert-agenda') return 'KEI 전문가 의제 제안';
  if (source === 'citizen-domestic') return '국내 시민 제안';
  if (source === 'gyeonggi-citizens') return '경기도 기후도민총회';
  return source;
}

function writeBlocker(reason) {
  fs.mkdirSync(path.dirname(blockerPath), { recursive: true });
  const blocker = {
    generated_at: new Date().toISOString(),
    complete: false,
    reason,
    required_env: ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE or SUPABASE_SERVICE_ROLE_KEY'],
    source_table: 'public.kb_chunks',
    planned_sources: sources,
    contract: 'docs/agenda-source-public-export-contract-2026-06-25.md',
  };
  fs.writeFileSync(blockerPath, `${JSON.stringify(blocker, null, 2)}\n`, 'utf8');
  console.warn(`[kb-agenda-source] blocker: ${reason}`);
  console.warn(`[kb-agenda-source] wrote ${path.relative(root, blockerPath)}`);
}

loadEnv(path.join(root, '.env'));
loadEnv(path.join(root, '.env.local'));
const url = process.env.SUPABASE_URL || process.env.PUBLIC_SUPABASE_URL;
const serviceRole = process.env.SUPABASE_SERVICE_ROLE || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceRole) {
  writeBlocker('Service role credentials are unavailable; protected kb_chunks cannot be exported safely from this environment.');
  process.exit(0);
}

const supabase = createClient(url, serviceRole);
const rows = [];
const pageSize = 1000;
for (const source of sources) {
  for (let from = 0; ; from += pageSize) {
    const to = from + pageSize - 1;
    const { data, error } = await supabase
      .from('kb_chunks')
      .select('id,source,doc,ref_id,title,body,category')
      .eq('source', source)
      .order('id', { ascending: true })
      .range(from, to);
    if (error) throw new Error(`kb_chunks export failed for ${source}: ${error.message}`);
    const page = data || [];
    rows.push(...page);
    if (page.length < pageSize) break;
  }
}

const records = rows.map((row) => {
  const title = cleanText(row.title || `KB ${row.id}`);
  const slug = `${String(row.id).padStart(6, '0')}-${slugify(title)}`;
  const href = `/ko/agenda-source/kb/${slug}/`;
  const body = cleanText(row.body || '');
  return {
    id: `kb-${row.id}`,
    slug,
    title,
    source: 'kb-agenda-corpus',
    source_table: 'public.kb_chunks',
    source_kind: cleanText(row.source),
    source_label: sourceLabel(row.source),
    doc: cleanText(row.doc),
    ref_id: cleanText(row.ref_id),
    category: cleanText(row.category),
    working_group: cleanText(row.category || row.source),
    stage: cleanText(row.source),
    status: 'source_backed_unreviewed',
    status_label: '원천 기반·검수 필요',
    review_status: 'needs_review',
    publication_status: 'internal_static_export',
    href,
    source_backed_href: href,
    summary: body ? body.slice(0, 240) : title,
    original_excerpt: body.slice(0, 600),
    page_refs: [],
    ocr_found: false,
    keywords: keywordsFrom(title, row.category, row.source, row.doc),
  };
});

const output = {
  version: 1,
  generated_at: new Date().toISOString(),
  source: {
    table: 'public.kb_chunks',
    record_count: records.length,
    by_source: records.reduce((acc, record) => {
      acc[record.source_kind] = (acc[record.source_kind] || 0) + 1;
      return acc;
    }, {}),
    publication_gate: 'needs_review_before_public_claim',
  },
  records,
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(`[kb-agenda-source] wrote ${path.relative(root, outPath)} (${records.length} records)`);
