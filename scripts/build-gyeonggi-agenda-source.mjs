import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const projectRoot = path.resolve(root, '..');
const reviewPath = path.join(projectRoot, '10_작업산출물', '2026-06-22_경기의제_검토본.md');
const ocrJsonDir = path.join(projectRoot, '00_입력자료', '경기도 기후도민회의', 'evaluation', 'json');
const outPath = path.join(root, 'public', 'workshop-graph', 'data', 'gyeonggi-agenda-surface.json');

if (!fs.existsSync(reviewPath) || !fs.existsSync(ocrJsonDir)) {
  if (fs.existsSync(outPath)) {
    console.warn('[gyeonggi-agenda-source] source materials unavailable; keeping committed static surface');
    process.exit(0);
  }
  throw new Error(`Gyeonggi source materials are missing: ${reviewPath}`);
}

const GROUP_RE = /^##\s+(.+?)\s+—\s+최종선정\s+(\d+)\s+·\s+채택\s+(\d+)\s+·\s+미채택\s+(\d+)\s+·\s+2차상세\s+(\d+)건/m;
const STATUS_LABELS = [
  { marker: '**🏆 최종선정', status: 'final_selected', label: '최종선정' },
  { marker: '**✅ 3차 채택', status: 'third_adopted', label: '3차 채택' },
  { marker: '**❌ 3차 미채택', status: 'third_rejected', label: '3차 미채택' },
];

function cleanText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function slugify(value) {
  const ascii = cleanText(value)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return ascii || 'agenda';
}

function excerptAround(text, needle, max = 420) {
  const source = cleanText(text);
  const idx = source.indexOf(needle);
  if (idx < 0) return source.slice(0, max);
  const start = Math.max(0, idx - 120);
  const end = Math.min(source.length, idx + needle.length + 260);
  return source.slice(start, end);
}

function parseReview(markdown) {
  const sections = markdown.split(/\n(?=##\s+)/).filter(block => block.startsWith('## '));
  const records = [];
  for (const block of sections) {
    const header = block.match(GROUP_RE);
    if (!header) continue;
    const workingGroup = cleanText(header[1]);
    for (let i = 0; i < STATUS_LABELS.length; i += 1) {
      const current = STATUS_LABELS[i];
      const next = STATUS_LABELS[i + 1]?.marker;
      const start = block.indexOf(current.marker);
      if (start < 0) continue;
      const end = next ? block.indexOf(next, start + current.marker.length) : block.length;
      const chunk = block.slice(start, end < 0 ? block.length : end);
      const lines = chunk.split(/\r?\n/).filter(line => line.trim().startsWith('- '));
      for (const line of lines) {
        const title = cleanText(line.replace(/^-\s+/, ''));
        if (!title) continue;
        records.push({
          title,
          working_group: workingGroup,
          status: current.status,
          status_label: current.label,
          stage: current.status === 'final_selected' ? '성과보고 최종선정' : current.label,
        });
      }
    }
  }
  return records;
}

function loadOcrPages() {
  const files = fs.readdirSync(ocrJsonDir).filter(name => name.endsWith('.pages.json')).sort();
  const docs = [];
  for (const file of files) {
    const fullPath = path.join(ocrJsonDir, file);
    const data = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
    docs.push({
      file_name: data.file_name,
      json_file: file,
      pages: Array.isArray(data.pages) ? data.pages : [],
    });
  }
  return docs;
}

function findPageRefs(title, docs) {
  const variants = [
    title,
    title.replace(/\(.+?\)/g, '').trim(),
    title.split(/[/:]/)[0].trim(),
  ].filter(Boolean);
  const refs = [];
  for (const doc of docs) {
    for (const page of doc.pages) {
      const text = cleanText(page.text || '');
      if (!text) continue;
      const matched = variants.find(v => v.length >= 4 && text.includes(v));
      if (!matched) continue;
      refs.push({
        doc: doc.file_name,
        json: doc.json_file,
        page: page.page,
        ocr_status: page.needs_ocr ? 'ocr_required_or_low_text' : 'text_layer',
        text_chars: page.text_chars || text.length,
        excerpt: excerptAround(text, matched),
      });
      if (refs.length >= 5) return refs;
    }
  }
  return refs;
}

const review = fs.readFileSync(reviewPath, 'utf8');
const docs = loadOcrPages();
const parsed = parseReview(review);
const seen = new Map();
for (const item of parsed) {
  const key = `${item.working_group}::${item.title}`;
  if (!seen.has(key)) seen.set(key, item);
  else {
    const prev = seen.get(key);
    if (prev.status !== 'final_selected' && item.status === 'final_selected') seen.set(key, item);
  }
}

const records = [...seen.values()].map((item, index) => {
  const pageRefs = findPageRefs(item.title, docs);
  const slug = `${String(index + 1).padStart(3, '0')}-${slugify(item.title)}`;
  const href = `/ko/agenda-source/gyeonggi/${slug}/`;
  return {
    id: `gyeonggi-${String(index + 1).padStart(3, '0')}`,
    slug,
    title: item.title,
    source: 'gyeonggi-citizens-ocr',
    source_label: '경기도 기후도민총회 OCR',
    working_group: item.working_group,
    stage: item.stage,
    status: item.status,
    status_label: item.status_label,
    href,
    source_backed_href: href,
    summary: item.title,
    original_excerpt: pageRefs[0]?.excerpt || '',
    page_refs: pageRefs,
    ocr_found: pageRefs.length > 0,
    keywords: [...new Set([item.title, item.working_group].flatMap(text => cleanText(text).split(/[^\p{L}\p{N}]+/u)).filter(t => t.length >= 2))].slice(0, 24),
  };
});

const output = {
  version: 1,
  generated_at: new Date().toISOString(),
  source: {
    review_file: '10_작업산출물/2026-06-22_경기의제_검토본.md',
    ocr_json_dir: '00_입력자료/경기도 기후도민회의/evaluation/json',
    record_count: records.length,
    ocr_matched_count: records.filter(r => r.ocr_found).length,
    status_counts: records.reduce((acc, row) => {
      acc[row.status] = (acc[row.status] || 0) + 1;
      return acc;
    }, {}),
  },
  records,
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(`[gyeonggi-agenda-source] wrote ${path.relative(root, outPath)} (${output.source.record_count} records / ${output.source.ocr_matched_count} OCR matches)`);
