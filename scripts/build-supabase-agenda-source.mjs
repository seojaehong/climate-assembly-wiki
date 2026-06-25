import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outPath = path.join(root, 'public', 'workshop-graph', 'data', 'supabase-agenda-surface.json');

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
  const slug = cleanText(value)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 90);
  return slug || 'agenda';
}

function keywordsFrom(...values) {
  return [...new Set(values
    .flatMap((value) => cleanText(value).split(/[^\p{L}\p{N}]+/u))
    .filter((token) => token.length >= 2 && !/^\d+$/.test(token)))]
    .slice(0, 24);
}

async function readAgendaCorpus() {
  loadEnv(path.join(root, '.env'));
  loadEnv(path.join(root, '.env.local'));
  const url = process.env.PUBLIC_SUPABASE_URL;
  const anonKey = process.env.PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error('PUBLIC_SUPABASE_URL or PUBLIC_SUPABASE_ANON_KEY is missing');
  }
  const supabase = createClient(url, anonKey);
  const { data, error, count } = await supabase
    .from('agenda_corpus')
    .select('id,source,ref_id,title,category', { count: 'exact' })
    .order('id', { ascending: true })
    .limit(2000);
  if (error) throw new Error(`agenda_corpus read failed: ${error.message}`);
  return { rows: data || [], count: count ?? (data || []).length };
}

const { rows, count } = await readAgendaCorpus();
const records = rows.map((row) => {
  const source = cleanText(row.source || 'agenda-corpus');
  const refId = cleanText(row.ref_id || row.id);
  const title = cleanText(row.title || `의제 ${refId}`);
  const slug = `${String(row.id).padStart(4, '0')}-${slugify(title)}`;
  const href = `/ko/agenda-source/supabase/${slug}/`;
  return {
    id: `supabase-${row.id}`,
    slug,
    title,
    source: 'supabase-agenda-corpus',
    source_table: 'public.agenda_corpus',
    source_label: 'Supabase 공개 의제 코퍼스',
    source_kind: source,
    ref_id: refId,
    category: cleanText(row.category || ''),
    working_group: cleanText(row.category || source),
    stage: source,
    status: 'public_corpus',
    status_label: '공개 코퍼스',
    href,
    source_backed_href: href,
    summary: title,
    original_excerpt: title,
    page_refs: [],
    ocr_found: false,
    keywords: keywordsFrom(title, row.category, source),
  };
});

const bySource = records.reduce((acc, row) => {
  acc[row.source_kind] = (acc[row.source_kind] || 0) + 1;
  return acc;
}, {});
const byCategory = records.reduce((acc, row) => {
  const key = row.category || '(blank)';
  acc[key] = (acc[key] || 0) + 1;
  return acc;
}, {});

const output = {
  version: 1,
  generated_at: new Date().toISOString(),
  source: {
    table: 'public.agenda_corpus',
    record_count: records.length,
    db_count: count,
    by_source: bySource,
    by_category: byCategory,
    limitation: 'Current public anon read path exposes agenda_corpus only. Overseas thousand-scale agenda data is not verified here.',
  },
  records,
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(`[supabase-agenda-source] wrote ${path.relative(root, outPath)} (${records.length} records)`);
if (records.length < 1000) {
  console.warn('[supabase-agenda-source] warning: public agenda_corpus is below overseas-thousand scale; check the actual table/view/RPC before claiming completion.');
}
