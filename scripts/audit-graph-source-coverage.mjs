#!/usr/bin/env node
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const wikiRoot = resolve(__dirname, '..');
const projectRoot = resolve(wikiRoot, '..');
const originalDir = join(projectRoot, '00_입력자료', '20260607회의', '6.13_원본자료');
const transcriptionDir = join(projectRoot, '30_추출', '6.13_원본자료_음성');
const textDir = join(projectRoot, '30_추출', '6.13_원본자료_텍스트');
const dataDir = join(wikiRoot, 'public', 'workshop-graph', 'data');
const reportPath = join(wikiRoot, 'evaluation', 'graph-source-coverage-report.json');
const docPath = join(wikiRoot, 'docs', 'graph-source-coverage-audit-2026-06-25.md');

const sessionSpecs = [
  { tag: 'reg_A', label: '6/13 운영규정 A조', folder: '[토론 1] 운영규정 초안 토론_A조', graph: 'regulation-2026-06-13.json', graphScope: 'regulation' },
  { tag: 'reg_B', label: '6/13 운영규정 B조', folder: '[토론 1] 운영규정 초안 토론_B조', graph: 'regulation-2026-06-13.json', graphScope: 'regulation' },
  { tag: 'A_t21', label: '6/14 A조 토론2-1', folder: '260614_토론2-1_A조', graph: 'workshop-2026-06-13.json' },
  { tag: 'A_t22', label: '6/14 A조 토론2-2', folder: '260614_토론2-2_A조', graph: 'workshop-2026-06-13.json' },
  { tag: 'A_t23', label: '6/14 A조 토론2-3', folder: '260614_토론2-3_A조', graph: 'workshop-2026-06-13.json' },
  { tag: 'B_t1', label: '6/14 B조 토론1', folder: '20260614_[토론1] 기초발제 및 의제선정에 대한 조별토론_B조', graph: 'workshop-2026-06-13.json' },
  { tag: 'B_t2', label: '6/14 B조 토론2', folder: '20260614_[토론2] 의제선정 브레인스토밍_B조', graph: 'workshop-2026-06-13.json' },
  { tag: 'B_t3', label: '6/14 B조 토론3', folder: '20260614_[토론3] 의제선정 조별토론_B조', graph: 'workshop-2026-06-13.json' },
  { tag: '발표', label: '6/13 조별발표', folder: '260613_조별발표', graph: 'workshop-2026-06-13.json' },
  { tag: '정의전환', label: '6/14 정의로운전환', folder: '기후취약성괴정의로운전환녹음', graph: 'workshop-2026-06-13.json' },
  { tag: '환경4조', label: '6/14 환경교육 4조', folder: '환경교육_4조_(전문_소비생활-의제_청소년거버넌스)', graph: 'workshop-2026-06-13.json' },
  { tag: '토론4통합', label: '6/14 토론4 통합 운영', folder: '20260614_[토론4] 의제선정 및 운영규정안 마련', graph: 'workshop-2026-06-13.json', expectedInGraph: false },
  { tag: '음성002', label: '음성 002', folder: '음성 002', graph: 'workshop-2026-06-13.json', expectedInGraph: false },
];

const textSessionSpecs = [
  { tag: 'OA_t1', label: '6/13 운영규정 A조 텍스트', file: '(수정)260613_[토론1]운영규정 초안 토론_A조_회의내용 정리.md' },
  { tag: 'OB_t1', label: '6/13 운영규정 B조 텍스트', file: '260613_[토론1]운영규정 초안 토론_B조_회의내용 정리.md' },
  { tag: 'OZ_t1', label: '6/13 운영규정 통합 텍스트', file: '20260611-기후시민회의 운영규범 초안_(시민배포용)_최종4.md' },
  { tag: 'DA_t2', label: '6/14 A조 의제선정 텍스트', file: '260614_[토론2,3] 의제선정 브레인스토밍 및 조별 토론_A조_회의내용 정리.md' },
  { tag: 'DB_t2', label: '6/14 B조 의제선정 텍스트', file: '20260614_[토론2,3] 의제선정 브레인스토밍 및 조별 토론.md' },
  { tag: 'DZ_t2', label: '6/14 통합 의제선정 텍스트', file: '20260614_[토론4] 의제 선정 및 운영규정안 마련_통합 운영.md' },
];

function listFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter(entry => entry.isFile())
    .map(entry => {
      const path = join(dir, entry.name);
      const st = statSync(path);
      return {
        name: entry.name,
        path,
        rel: relative(projectRoot, path).replaceAll('\\', '/'),
        bytes: st.size,
        modified: st.mtime.toISOString(),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'ko'));
}

function sizeOrNull(path) {
  try {
    return statSync(path).size;
  } catch {
    return null;
  }
}

function transcriptionSummary(folder) {
  const dir = join(transcriptionDir, folder);
  const chunks = join(dir, 'chunks');
  const files = existsSync(dir) ? readdirSync(dir) : [];
  const chunkFiles = existsSync(chunks) ? readdirSync(chunks) : [];
  const mainJson = files.find(name => name.endsWith('.json') && !name.endsWith('.review.json'));
  const txt = files.find(name => name.endsWith('.txt'));
  const srt = files.find(name => name.endsWith('.srt'));
  const review = files.find(name => name.endsWith('.review.json'));
  const mp3Chunks = chunkFiles.filter(name => /^chunk_\d+\.mp3$/.test(name));
  const transcriptChunks = chunkFiles.filter(name => /^t_\d+\.json$/.test(name));
  const tmpChunks = chunkFiles.filter(name => name.endsWith('.tmp'));
  const status = !existsSync(dir) ? 'transcript_missing'
    : tmpChunks.length || sizeOrNull(join(dir, txt || '')) === 0 || sizeOrNull(join(dir, srt || '')) === 0 || transcriptChunks.length < mp3Chunks.length
      ? 'transcript_partial'
      : 'transcript_ready';
  return {
    folder,
    exists: existsSync(dir),
    dir: relative(projectRoot, dir).replaceAll('\\', '/'),
    main_json_bytes: mainJson ? sizeOrNull(join(dir, mainJson)) : null,
    txt_bytes: txt ? sizeOrNull(join(dir, txt)) : null,
    srt_bytes: srt ? sizeOrNull(join(dir, srt)) : null,
    review_json_bytes: review ? sizeOrNull(join(dir, review)) : null,
    chunks_mp3: mp3Chunks.length,
    chunks_transcript_json: transcriptChunks.length,
    chunks_tmp: tmpChunks,
    status,
  };
}

function readGraph(file) {
  const path = join(dataDir, file);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf8'));
}

function graphSessionCounts(graphFile) {
  const graph = readGraph(graphFile);
  if (!graph) return { nodes: 0, edges: 0, by_session: {}, by_prefix: {} };
  const nodes = graph.elements?.nodes || [];
  const edges = graph.elements?.edges || [];
  const bySession = {};
  const byPrefix = {};
  for (const node of nodes) {
    const data = node.data || {};
    const session = data.session || '(none)';
    bySession[session] = (bySession[session] || 0) + 1;
    const id = String(data.id || '');
    const prefix = id.includes('__') ? id.split('__')[0] : '(none)';
    byPrefix[prefix] = (byPrefix[prefix] || 0) + 1;
  }
  return { nodes: nodes.length, edges: edges.length, by_session: bySession, by_prefix: byPrefix };
}

function graphCountFor(spec, graphSummaries) {
  const summary = graphSummaries[spec.graph];
  if (!summary) return 0;
  if (spec.graphScope === 'regulation') return summary.nodes;
  return summary.by_session[spec.tag] || summary.by_prefix[spec.tag] || 0;
}

const originalFiles = listFiles(originalDir);
const textFiles = listFiles(textDir);
const graphFiles = ['workshop-2026-06-13.json', 'regulation-2026-06-13.json'];
const graphSummaries = Object.fromEntries(graphFiles.map(file => [file, graphSessionCounts(file)]));
const sessions = sessionSpecs.map(spec => {
  const transcription = transcriptionSummary(spec.folder);
  const graphNodes = graphCountFor(spec, graphSummaries);
  const graphStatus = graphNodes > 0 ? 'graph_represented' : (spec.expectedInGraph === false ? 'not_expected_in_current_graph' : 'graph_missing');
  const status = transcription.status === 'transcript_ready' && graphStatus === 'graph_represented'
    ? 'ready'
    : transcription.status === 'transcript_ready' && graphStatus !== 'graph_represented'
      ? 'ui_or_graph_gap'
      : 'needs_review';
  return { ...spec, transcription, graph_nodes: graphNodes, graph_status: graphStatus, status };
});

const issues = sessions.filter(row => row.status !== 'ready').map(row => ({
  tag: row.tag,
  label: row.label,
  status: row.status,
  transcription_status: row.transcription.status,
  graph_status: row.graph_status,
  note: row.tag === 'B_t2'
    ? 'B조 토론2는 그래프에 일부 반영되었지만 전사 상위 txt/srt가 0바이트이고 tmp 청크가 남아 있어 재확인이 필요합니다.'
    : row.tag === '토론4통합'
      ? '토론4 통합 운영은 원본 음성과 청크가 있으나 전사 산출물이 미완결이고 현재 통합 그래프 세션으로 노출되지 않습니다.'
      : '원본-전사-그래프 연결 상태 확인이 필요합니다.',
}));

const textSessions = textSessionSpecs.map(spec => {
  const filePath = join(textDir, spec.file);
  const graphNodes = graphSummaries['workshop-2026-06-13.json'].by_session[spec.tag] || graphSummaries['workshop-2026-06-13.json'].by_prefix[spec.tag] || 0;
  return {
    ...spec,
    exists: existsSync(filePath),
    path: relative(projectRoot, filePath).replaceAll('\\', '/'),
    bytes: sizeOrNull(filePath),
    graph_nodes: graphNodes,
    status: existsSync(filePath) && graphNodes > 0 ? 'ready' : 'needs_review',
  };
});

const report = {
  generated_at: new Date().toISOString(),
  original_dir: relative(projectRoot, originalDir).replaceAll('\\', '/'),
  transcription_dir: relative(projectRoot, transcriptionDir).replaceAll('\\', '/'),
  text_dir: relative(projectRoot, textDir).replaceAll('\\', '/'),
  data_dir: relative(projectRoot, dataDir).replaceAll('\\', '/'),
  original_file_count: originalFiles.length,
  original_files: originalFiles,
  text_file_count: textFiles.length,
  text_files: textFiles,
  graph_summaries: graphSummaries,
  sessions,
  text_sessions: textSessions,
  issues,
};

mkdirSync(dirname(reportPath), { recursive: true });
mkdirSync(dirname(docPath), { recursive: true });
writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

const sessionRows = sessions.map(row => `| ${row.label} | \`${row.tag}\` | ${row.transcription.status} | ${row.transcription.chunks_transcript_json}/${row.transcription.chunks_mp3} | ${row.transcription.txt_bytes ?? 'n/a'} | ${row.transcription.srt_bytes ?? 'n/a'} | ${row.graph_nodes} | ${row.status} |`).join('\n');
const textRows = textSessions.map(row => `| ${row.label} | \`${row.tag}\` | ${row.exists ? '있음' : '없음'} | ${row.bytes ?? 'n/a'} | ${row.graph_nodes} | ${row.status} |`).join('\n');
const issueRows = issues.map(row => `- **${row.label}** (\`${row.tag}\`): ${row.note}`).join('\n') || '- 특이사항 없음';
const graphRows = Object.entries(graphSummaries).map(([file, summary]) => `| ${file} | ${summary.nodes} | ${summary.edges} | ${Object.entries(summary.by_session).map(([k, v]) => `${k}:${v}`).join(', ')} |`).join('\n');
const doc = `# 6/13-14 원본-전사-그래프 커버리지 감사

생성 시각: ${report.generated_at}

## 결론

- 원본 폴더 파일 수: **${originalFiles.length}건**
- 텍스트 추출 파일 수: **${textFiles.length}건**
- 통합 그래프 \`workshop-2026-06-13.json\`: **${graphSummaries['workshop-2026-06-13.json'].nodes}노드 / ${graphSummaries['workshop-2026-06-13.json'].edges}엣지**
- B조는 \`B_t1/B_t2/B_t3\`로 통합 그래프에 존재한다. 다만 \`B_t2\`는 전사 산출물이 부분 상태라 발표 전 재확인이 필요하다.
- \`20260614_[토론4] 의제선정 및 운영규정안 마련\`은 원본 음성과 mp3 청크가 있으나 전사 산출물이 미완결이고 현재 통합 그래프 세션으로 노출되지 않는다.

## 주의 항목

${issueRows}

## 세션별 상태

| 세션 | 태그 | 전사 상태 | 전사 chunk/json | txt bytes | srt bytes | 그래프 노드 | 종합 |
|---|---:|---|---:|---:|---:|---:|---|
${sessionRows}

## 텍스트 세션별 상태

| 세션 | 태그 | 텍스트 | bytes | 그래프 노드 | 종합 |
|---|---:|---|---:|---:|---|
${textRows}

## 그래프 데이터 요약

| 파일 | 노드 | 엣지 | session 분포 |
|---|---:|---:|---|
${graphRows}

## 해석 기준

- \`ready\`: 전사 산출물과 그래프 반영이 모두 확인됨.
- \`needs_review\`: 전사 산출물 일부가 0바이트이거나 tmp 청크가 남아 있음.
- \`ui_or_graph_gap\`: 전사는 있으나 현재 공개 그래프 데이터 또는 UI에서 분리 노출되지 않음.
- 이 감사는 재전사나 DB 변경을 하지 않는 정적 점검이다.
`;
writeFileSync(docPath, doc, 'utf8');

console.log(`wrote ${relative(wikiRoot, reportPath).replaceAll('\\', '/')}`);
console.log(`wrote ${relative(wikiRoot, docPath).replaceAll('\\', '/')}`);
for (const issue of issues) console.log(`[needs-review] ${issue.tag}: ${issue.note}`);
