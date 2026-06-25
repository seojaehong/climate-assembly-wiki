import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const agendaDir = path.join(root, 'content', 'ko', 'agenda');
const agendas65Path = path.join(root, 'src', 'data', 'agendas-65.json');
const similarityPath = path.join(root, 'src', 'data', 'network', 'agenda-similarity.json');
const outPath = path.join(root, 'public', 'workshop-graph', 'data', 'agenda-surface.json');

function stripQuotes(value) {
  return String(value ?? '').trim().replace(/^['"]|['"]$/g, '');
}

function parseInlineList(value) {
  const raw = String(value ?? '').trim();
  if (!raw.startsWith('[') || !raw.endsWith(']')) return [];
  return raw
    .slice(1, -1)
    .split(',')
    .map(item => stripQuotes(item).trim())
    .filter(Boolean)
    .map(item => {
      const n = Number(item);
      return Number.isFinite(n) ? n : item;
    });
}

function parseFrontmatter(markdown) {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return { data: {}, body: markdown };
  const data = {};
  for (const line of match[1].split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!m) continue;
    const [, key, value] = m;
    if (value.trim().startsWith('[')) data[key] = parseInlineList(value);
    else {
      const n = Number(value.trim());
      data[key] = Number.isFinite(n) && value.trim() !== '' ? n : stripQuotes(value);
    }
  }
  return { data, body: markdown.slice(match[0].length) };
}

function sectionText(body, heading) {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rx = new RegExp(`^##\\s+${escaped}\\s*\\r?\\n([\\s\\S]*?)(?=\\r?\\n##\\s+|$)`, 'm');
  const match = body.match(rx);
  if (!match) return '';
  return cleanText(match[1]);
}

function cleanText(value) {
  return String(value ?? '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[*_`>#-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function fallbackSummary(body) {
  return cleanText(
    body
      .split(/\r?\n/)
      .filter(line => line.trim() && !line.trim().startsWith('#'))
      .slice(0, 5)
      .join(' ')
  );
}

function truncate(value, max = 520) {
  const text = cleanText(value);
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function tokenize(value) {
  return [...new Set(
    cleanText(value)
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .map(token => token.trim())
      .filter(token => token.length >= 2 && !/^\d+$/.test(token))
  )];
}

function loadWikiEntries() {
  if (!fs.existsSync(agendaDir)) return new Map();
  const entries = new Map();
  for (const file of fs.readdirSync(agendaDir).filter(name => name.endsWith('.md')).sort()) {
    const fullPath = path.join(agendaDir, file);
    const markdown = fs.readFileSync(fullPath, 'utf8');
    const { data, body } = parseFrontmatter(markdown);
    const id = Number(data.id);
    if (!Number.isFinite(id) || id <= 0) {
      console.warn(`[agenda-surface] skip ${file}: non-production agenda id`);
      continue;
    }
    const slug = data.slug || file.replace(/^\d+-/, '').replace(/\.md$/, '');
    entries.set(id, {
      id,
      title: data.title || '',
      slug,
      href: null,
      summary: truncate(sectionText(body, '한 줄 요약') || fallbackSummary(body), 420),
      related_agendas: Array.isArray(data.related_agendas) ? data.related_agendas.map(Number).filter(Number.isFinite) : [],
      wiki_source: 'internal-draft-agenda-md',
    });
  }
  return entries;
}

function buildSimilarityMap(similarity) {
  const byId = new Map();
  const push = (source, target, weight) => {
    const s = Number(source);
    const t = Number(target);
    const w = Number(weight ?? 0);
    if (!Number.isFinite(s) || !Number.isFinite(t)) return;
    if (!byId.has(s)) byId.set(s, []);
    byId.get(s).push({ id: t, weight: Number.isFinite(w) ? w : 0 });
  };
  const edgeSets = [
    ...(Array.isArray(similarity.edges_backbone) ? similarity.edges_backbone : []),
    ...(Array.isArray(similarity.edges) ? similarity.edges : []),
  ];
  for (const edge of edgeSets) {
    push(edge.source, edge.target, edge.weight ?? edge.similarity ?? edge.value);
    push(edge.target, edge.source, edge.weight ?? edge.similarity ?? edge.value);
  }
  const result = new Map();
  for (const [id, list] of byId.entries()) {
    const unique = new Map();
    for (const item of list) {
      const prev = unique.get(item.id);
      if (!prev || item.weight > prev.weight) unique.set(item.id, item);
    }
    result.set(
      id,
      [...unique.values()]
        .sort((a, b) => b.weight - a.weight || a.id - b.id)
        .slice(0, 5)
        .map(item => item.id)
    );
  }
  return result;
}

const agendas65 = JSON.parse(fs.readFileSync(agendas65Path, 'utf8'));
const similarity = JSON.parse(fs.readFileSync(similarityPath, 'utf8'));
const wikiEntries = loadWikiEntries();
const similarityMap = buildSimilarityMap(similarity);
const wikiIds = new Set(wikiEntries.keys());
const ids = new Set([
  ...agendas65.map(item => Number(item.id)).filter(Number.isFinite),
  ...wikiIds,
]);

const agendaMap = new Map();
for (const id of [...ids].sort((a, b) => a - b)) {
  const base = agendas65.find(item => Number(item.id) === id) || {};
  const wiki = wikiEntries.get(id) || {};
  const title = wiki.title || base.agenda_name || base.title || `의제 ${id}`;
  const summary = wiki.summary || truncate(base.summary || base.current_situation || base.proposed_policy || '', 420);
  const related = [...new Set((wiki.related_agendas || []).map(Number).filter(Number.isFinite))];
  const similar = [...new Set((similarityMap.get(id) || []).filter(nextId => nextId !== id))];
  const keywords = tokenize([
    title,
    base.domain,
    base.big_category,
    summary,
    base.current_situation,
    base.proposed_policy,
    base.expected_effect,
  ].filter(Boolean).join(' ')).slice(0, 36);
  agendaMap.set(id, {
    id,
    title,
    slug: wiki.slug || null,
    href: null,
    source_backed_href: null,
    big_category: base.big_category || '',
    domain: base.domain || '',
    summary,
    current_situation: truncate(base.current_situation || '', 520),
    proposed_policy: truncate(base.proposed_policy || '', 520),
    expected_effect: truncate(base.expected_effect || '', 520),
    related_agendas: related,
    similar_agendas: similar,
    keywords,
    has_wiki: wikiIds.has(id),
    source_status: wikiIds.has(id) ? 'internal_draft_unlinked' : 'matrix_only_unlinked',
    source: wiki.wiki_source || 'agenda-matrix-65',
  });
}

for (const agenda of agendaMap.values()) {
  for (const relId of agenda.related_agendas) {
    if (!agendaMap.has(relId)) {
      console.warn(`[agenda-surface] agenda ${agenda.id} has missing related_agenda ${relId}`);
    }
  }
}

const out = {
  version: 1,
  generated_at: new Date().toISOString(),
  source: {
    wiki_agenda_count: wikiEntries.size,
    agenda_count: agendaMap.size,
    inputs: [
      'internal draft markdown, links excluded',
      'src/data/agendas-65.json',
      'src/data/network/agenda-similarity.json',
    ],
  },
  agendas: [...agendaMap.values()],
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(out, null, 2)}\n`, 'utf8');
console.log(`[agenda-surface] wrote ${path.relative(root, outPath)} (${out.source.wiki_agenda_count} wiki / ${out.source.agenda_count} agendas)`);
