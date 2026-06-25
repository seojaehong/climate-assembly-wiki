import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const evaluationDir = path.join(root, 'evaluation');
const docsDir = path.join(root, 'docs');
const reportPath = path.join(evaluationDir, 'agenda-source-inventory.json');
const docPath = path.join(docsDir, 'agenda-source-inventory-2026-06-25.md');

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

function readJson(relativePath, fallback) {
  const fullPath = path.join(root, relativePath);
  if (!fs.existsSync(fullPath)) return fallback;
  return JSON.parse(fs.readFileSync(fullPath, 'utf8'));
}

function countBy(rows, key) {
  const out = {};
  for (const row of rows) {
    const value = String(row?.[key] || '(blank)');
    out[value] = (out[value] || 0) + 1;
  }
  return out;
}

async function readSupabaseAgendaCorpus() {
  loadEnv(path.join(root, '.env'));
  loadEnv(path.join(root, '.env.local'));
  const url = process.env.PUBLIC_SUPABASE_URL;
  const anonKey = process.env.PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    return {
      available: false,
      table: 'public.agenda_corpus',
      error: 'PUBLIC_SUPABASE_URL or PUBLIC_SUPABASE_ANON_KEY is missing',
      total: 0,
      bySource: {},
      byCategory: {},
      sample: [],
    };
  }

  const supabase = createClient(url, anonKey);
  const { data, error, count } = await supabase
    .from('agenda_corpus')
    .select('id,source,ref_id,title,category', { count: 'exact' })
    .order('id', { ascending: true })
    .limit(2000);

  if (error) {
    return {
      available: false,
      table: 'public.agenda_corpus',
      error: error.message,
      total: 0,
      bySource: {},
      byCategory: {},
      sample: [],
    };
  }

  const rows = data || [];
  return {
    available: true,
    table: 'public.agenda_corpus',
    total: count ?? rows.length,
    fetched: rows.length,
    bySource: countBy(rows, 'source'),
    byCategory: countBy(rows, 'category'),
    sample: rows.slice(0, 8),
  };
}

function readGyeonggiSurface() {
  const surface = readJson('public/workshop-graph/data/gyeonggi-agenda-surface.json', { records: [], source: {} });
  const records = Array.isArray(surface.records) ? surface.records : [];
  return {
    available: records.length > 0,
    file: 'public/workshop-graph/data/gyeonggi-agenda-surface.json',
    total: records.length,
    ocrMatched: records.filter((record) => record.ocr_found).length,
    withSourceBackedHref: records.filter((record) => String(record.source_backed_href || '').startsWith('/ko/agenda-source/gyeonggi/')).length,
    byStatus: countBy(records, 'status_label'),
    source: surface.source || {},
    sample: records.slice(0, 8).map((record) => ({
      id: record.id,
      title: record.title,
      status_label: record.status_label,
      working_group: record.working_group,
      ocr_found: Boolean(record.ocr_found),
      source_backed_href: record.source_backed_href,
    })),
  };
}

function readInternalDraftSurface() {
  const surface = readJson('public/workshop-graph/data/agenda-surface.json', { agendas: [], source: {} });
  const agendas = Array.isArray(surface.agendas) ? surface.agendas : [];
  return {
    file: 'public/workshop-graph/data/agenda-surface.json',
    total: agendas.length,
    internalDraftCount: agendas.filter((agenda) => agenda.source === 'internal-draft-agenda-md').length,
    exposedInternalHrefCount: agendas.filter((agenda) => String(agenda.href || agenda.source_backed_href || '').includes('/ko/agenda/')).length,
    source: surface.source || {},
  };
}

function buildMarkdown(report) {
  const corpusSources = Object.entries(report.supabaseAgendaCorpus.bySource)
    .map(([key, value]) => `- ${key}: ${value}건`)
    .join('\n') || '- 확인된 source 없음';
  const corpusCategories = Object.entries(report.supabaseAgendaCorpus.byCategory)
    .map(([key, value]) => `- ${key}: ${value}건`)
    .join('\n') || '- 확인된 category 없음';
  const gyeonggiStatus = Object.entries(report.gyeonggiOcrSurface.byStatus)
    .map(([key, value]) => `- ${key}: ${value}건`)
    .join('\n') || '- 확인된 status 없음';

  return `# 공식 의제 DB 인벤토리 감사

작성일: ${report.generatedAt.slice(0, 10)}

## 결론

현재 홈페이지에 연결 가능한 공식 의제 원천은 아직 완성형 DB가 아니다. 내부 가안 링크는 그래프 카드에서 제외되어야 하며, 공개 페이지와 그래프 카드는 Supabase 공개 검수 데이터와 경기도 OCR 원문 기반 데이터만 사용해야 한다.

## 현재 확인된 원천

### Supabase 공개 의제 코퍼스

- 테이블: \`${report.supabaseAgendaCorpus.table}\`
- 접근 상태: ${report.supabaseAgendaCorpus.available ? '읽기 가능' : '읽기 불가'}
- 확인 건수: ${report.supabaseAgendaCorpus.total}건
- 가져온 건수: ${report.supabaseAgendaCorpus.fetched || 0}건

source 분포:

${corpusSources}

category 분포:

${corpusCategories}

해석:

- 현재 anon 공개 경로에서 확인되는 Supabase 의제 코퍼스는 ${report.supabaseAgendaCorpus.total}건이다.
- 사용자가 언급한 해외의제 천건 단위 데이터는 현재 이 공개 테이블/권한 경로에서는 확인되지 않는다.
- 따라서 해외의제 천건을 홈페이지 위키에 연결하려면 실제 테이블명, 공개 view/RPC, 검수 상태 필드가 먼저 확정되어야 한다.

### 경기도 OCR 의제 surface

- 파일: \`${report.gyeonggiOcrSurface.file}\`
- 추출 건수: ${report.gyeonggiOcrSurface.total}건
- OCR 매칭: ${report.gyeonggiOcrSurface.ocrMatched}건
- source-backed href 보유: ${report.gyeonggiOcrSurface.withSourceBackedHref}건

상태 분포:

${gyeonggiStatus}

해석:

- 현재 경기도 OCR 페이지는 원천 기반 페이지의 1차 구현이다.
- 전체 OCR 안건이 모두 수작업 검수된 상태는 아니다.
- 페이지 발췌와 OCR 매칭은 자동화 산출물이므로 발표 전 수동 QA가 필요하다.

### 내부 가안 surface

- 파일: \`${report.internalDraftSurface.file}\`
- surface 건수: ${report.internalDraftSurface.total}건
- 내부 가안 source 건수: ${report.internalDraftSurface.internalDraftCount}건
- 공개 \`/ko/agenda/\` href 노출 건수: ${report.internalDraftSurface.exposedInternalHrefCount}건

해석:

- 내부 가안은 공식 원문 DB로 보지 않는다.
- 그래프 카드에서 내부 가안 링크가 노출되지 않는 현재 방향이 맞다.

## 다음 작업

1. Supabase 해외의제 실제 저장 위치 확인: 테이블명, 스키마, RLS, 공개 view/RPC.
2. 공개용 source-backed shape 확정: \`id\`, \`source_type\`, \`title\`, \`summary\`, \`origin_url\`, \`document_ref\`, \`review_status\`, \`publication_status\`.
3. 해외의제와 경기도 OCR을 같은 surface 계약으로 export.
4. \`/ko/agenda-source/{source}/{id}/\` 페이지 디자인 QA.
5. 그래프 카드에는 검수 완료 원천만 연결.
`;
}

async function main() {
  fs.mkdirSync(evaluationDir, { recursive: true });
  fs.mkdirSync(docsDir, { recursive: true });
  const report = {
    generatedAt: new Date().toISOString(),
    verdict: {
      complete: false,
      reason: 'Supabase overseas thousand-scale agenda data is not verified on the current public read path; Gyeonggi OCR pages are first-pass source-backed records, not fully manual-QAed wiki pages.',
    },
    supabaseAgendaCorpus: await readSupabaseAgendaCorpus(),
    gyeonggiOcrSurface: readGyeonggiSurface(),
    internalDraftSurface: readInternalDraftSurface(),
  };
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  fs.writeFileSync(docPath, buildMarkdown(report), 'utf8');
  console.log(`[agenda-source-inventory] wrote ${path.relative(root, reportPath)}`);
  console.log(`[agenda-source-inventory] wrote ${path.relative(root, docPath)}`);
  console.log(`[agenda-source-inventory] complete=${report.verdict.complete} supabase=${report.supabaseAgendaCorpus.total} gyeonggi=${report.gyeonggiOcrSurface.total}`);
}

main().catch((error) => {
  console.error('[agenda-source-inventory] failed', error);
  process.exitCode = 1;
});
