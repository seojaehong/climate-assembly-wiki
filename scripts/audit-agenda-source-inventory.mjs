import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
// ★ Node 20 에서 supabase-js 가 WebSocket 을 못 찾아 죽는다 — createClient 앞에서 막는다.
import './lib/node-ws-shim.mjs';
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

function envCredentials() {
  loadEnv(path.join(root, '.env'));
  loadEnv(path.join(root, '.env.local'));
  return {
    url: process.env.PUBLIC_SUPABASE_URL,
    anonKey: process.env.PUBLIC_SUPABASE_ANON_KEY,
  };
}

async function readSupabaseAgendaCorpus() {
  const { url, anonKey } = envCredentials();
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

async function postEdgeFunction(name, body) {
  const { url, anonKey } = envCredentials();
  if (!url || !anonKey) {
    return {
      ok: false,
      status: 0,
      error: 'PUBLIC_SUPABASE_URL or PUBLIC_SUPABASE_ANON_KEY is missing',
      data: null,
    };
  }
  const response = await fetch(`${url}/functions/v1/${name}`, {
    method: 'POST',
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text.slice(0, 500) };
  }
  return {
    ok: response.ok,
    status: response.status,
    error: response.ok ? null : JSON.stringify(data).slice(0, 500),
    data,
  };
}

async function readProtectedKnowledgeBase() {
  const { url, anonKey } = envCredentials();
  if (!url || !anonKey) {
    return {
      available: false,
      rawTable: 'public.kb_chunks',
      directAnonRows: null,
      expectedSourcesFromInventory: {
        'overseas-cases': 1025,
        'kei-expert-agenda': 65,
        'citizen-domestic': 108,
      },
      searches: [],
      error: 'PUBLIC_SUPABASE_URL or PUBLIC_SUPABASE_ANON_KEY is missing',
    };
  }

  const supabase = createClient(url, anonKey);
  const { data: directRows, error: directError, count: directCount } = await supabase
    .from('kb_chunks')
    .select('id,source,title,category', { count: 'exact' })
    .limit(5);

  const searchCases = [
    {
      label: 'overseas-sentinel',
      body: { query: '해외 기후의회 권고 재생에너지', k: 5, source: 'overseas-cases' },
    },
    {
      label: 'overseas-wide-cap',
      body: { query: '기후 시민의회 정책 권고 에너지 교통 건물 농업', k: 1200, source: 'overseas-cases' },
    },
    {
      label: 'gyeonggi-sentinel',
      body: { query: '경기도 최종 선정 정책', k: 5, source: 'gyeonggi-citizens' },
    },
  ];
  const searches = [];
  for (const item of searchCases) {
    const result = await postEdgeFunction('kb-search', item.body);
    const matches = Array.isArray(result.data?.matches) ? result.data.matches : [];
    searches.push({
      label: item.label,
      function: 'kb-search',
      status: result.status,
      ok: result.ok,
      source: item.body.source,
      requestedK: item.body.k,
      matchCount: matches.length,
      error: result.error,
      sample: matches.slice(0, 3).map((match) => ({
        id: match.id,
        source: match.source,
        doc: match.doc,
        ref_id: match.ref_id,
        title: match.title,
        category: match.category,
      })),
    });
  }

  return {
    available: searches.some((search) => search.ok && search.matchCount > 0),
    rawTable: 'public.kb_chunks',
    directAnonRows: Array.isArray(directRows) ? directRows.length : null,
    directAnonCount: directCount,
    directAnonError: directError?.message || null,
    directPolicy: 'RLS intentionally blocks anon direct SELECT; service_role edge functions read this table.',
    expectedSourcesFromInventory: {
      'overseas-cases': 1025,
      'kei-expert-agenda': 65,
      'citizen-domestic': 108,
    },
    searches,
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

function readKbSurface() {
  const surface = readJson('public/workshop-graph/data/kb-agenda-surface.json', { records: [], source: {} });
  const records = Array.isArray(surface.records) ? surface.records : [];
  return {
    available: records.length > 0,
    file: 'public/workshop-graph/data/kb-agenda-surface.json',
    total: records.length,
    bySource: countBy(records, 'source_kind'),
    withSourceBackedHref: records.filter((record) => String(record.source_backed_href || '').startsWith('/ko/agenda-source/kb/')).length,
    reviewStatus: countBy(records, 'review_status'),
    publicationStatus: countBy(records, 'publication_status'),
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
  const kbSearches = report.protectedKnowledgeBase.searches
    .map((search) => `- ${search.label}: ${search.ok ? '성공' : '실패'} · source=${search.source} · 요청 ${search.requestedK}건 · 반환 ${search.matchCount}건`)
    .join('\n') || '- 검색 검증 없음';
  const kbSurfaceSources = Object.entries(report.kbAgendaSurface.bySource)
    .map(([key, value]) => `- ${key}: ${value}건`)
    .join('\n') || '- export 없음';

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
- 이 테이블은 공개용 보조 코퍼스이며, 해외의제 천건 단위 원천은 여기서 확인되지 않는다.

### Supabase 보호 KB 코퍼스

- raw table: \`${report.protectedKnowledgeBase.rawTable}\`
- anon 직접 SELECT 행수: ${report.protectedKnowledgeBase.directAnonRows}
- anon 직접 count: ${report.protectedKnowledgeBase.directAnonCount}
- 정책: ${report.protectedKnowledgeBase.directPolicy}

문서상 기대 source:

- overseas-cases: ${report.protectedKnowledgeBase.expectedSourcesFromInventory['overseas-cases']}건
- kei-expert-agenda: ${report.protectedKnowledgeBase.expectedSourcesFromInventory['kei-expert-agenda']}건
- citizen-domestic: ${report.protectedKnowledgeBase.expectedSourcesFromInventory['citizen-domestic']}건

edge function 검색 검증:

${kbSearches}

해석:

- 해외의제 천건 단위 데이터는 \`agenda_corpus\`가 아니라 보호된 \`kb_chunks\`/edge function 검색 경로에 있다.
- anon 직접 SELECT는 RLS로 차단되어야 하며, 현재 직접 행수는 ${report.protectedKnowledgeBase.directAnonRows}건이다.
- \`kb-search\`는 \`source=overseas-cases\`로 해외 권고를 반환한다. 다만 검색 endpoint는 top-k 검색 표면이라 전체 1025건의 공개 위키 페이지 생성 근거로 바로 쓰면 안 된다.
- 공개 위키에 연결하려면 service_role batch export 또는 검수 완료 view/RPC가 필요하다.

### 보호 KB source-backed export

- 파일: \`${report.kbAgendaSurface.file}\`
- export 건수: ${report.kbAgendaSurface.total}건
- source-backed href 보유: ${report.kbAgendaSurface.withSourceBackedHref}건

source 분포:

${kbSurfaceSources}

해석:

- 이 export는 service role 기반 source-backed 정적 산출물이다.
- 현재 \`review_status\`는 검수 필요 상태이므로 "공개 검수 완료 위키"가 아니라 "원천 기반 검토 자료"로 표시해야 한다.
- 그래프와 페이지는 이 파일을 읽을 수 있지만, 발표/공개 문구에서는 전체 검수 완료처럼 말하면 안 된다.

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

1. Supabase 해외의제 실제 저장 위치는 보호된 \`public.kb_chunks\`로 확인했다. 다음은 공개용 view/RPC 또는 service_role batch export 확정이다.
2. \`kb_chunks\`에서 공개 가능한 해외의제 source-backed export를 만들기 위한 service_role batch 또는 reviewed RPC를 확정한다.
3. 공개용 source-backed shape 확정: \`id\`, \`source_type\`, \`title\`, \`summary\`, \`origin_url\`, \`document_ref\`, \`review_status\`, \`publication_status\`.
4. 해외의제와 경기도 OCR을 같은 surface 계약으로 export.
5. \`/ko/agenda-source/{source}/{id}/\` 페이지 디자인 QA.
6. 그래프 카드에는 검수 완료 원천만 연결.
`;
}

async function main() {
  fs.mkdirSync(evaluationDir, { recursive: true });
  fs.mkdirSync(docsDir, { recursive: true });
  const report = {
    generatedAt: new Date().toISOString(),
    verdict: {
      complete: false,
      reason: 'Overseas thousand-scale agenda data is verified as a protected kb_chunks/edge-function source, but it is not yet exported as reviewed public wiki pages; Gyeonggi OCR pages are first-pass source-backed records, not fully manual-QAed wiki pages.',
    },
    supabaseAgendaCorpus: await readSupabaseAgendaCorpus(),
    protectedKnowledgeBase: await readProtectedKnowledgeBase(),
    kbAgendaSurface: readKbSurface(),
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
