#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WIKI_ROOT = resolve(__dirname, '..');
const DEFAULT_OUT = join(WIKI_ROOT, 'public', 'workshop-graph-0628-test', 'data', 'participant-open-questions.json');
const SOURCES_PATH = join(WIKI_ROOT, 'public', 'workshop-graph-0628-test', 'sources.json');

const QUESTION_COLUMNS = [
  {
    key: 'impression',
    kindKo: '소감',
    hubId: 'Question_impression',
    hubLabel: '소감',
    candidates: [
      '소감',
      '참여 소감',
      '오늘 소감',
      '회의 소감',
      '워크숍 소감',
      '기후시민회의 운영 관련 질문',
      '운영 관련 질문',
      '운영 질문',
      'q_impression',
      'impression',
      'q_operation',
      'operation',
    ],
  },
  {
    key: 'question',
    kindKo: '질문',
    hubId: 'Question_question',
    hubLabel: '질문',
    candidates: [
      '질문',
      '궁금한 점',
      '남기고 싶은 질문',
      '감축의제 질문',
      '감축 의제 질문',
      '감축 관련 질문',
      '감축 질문',
      'q_question',
      'question',
      'q_mitigation',
      'mitigation',
    ],
  },
];

const GROUP_COLUMNS = ['조', '우리 조', '테이블', '분임', 'group'];
const TIMESTAMP_COLUMNS = ['타임스탬프', 'timestamp', 'Timestamp', '제출시간'];
const STOPWORDS = new Set([
  '그리고', '그러면', '그래서', '하지만', '또는', '또한', '대한', '관련', '위한', '위해',
  '있는', '있나요', '있을까요', '있습니까', '어떻게', '어디까지', '무엇', '어떤', '이번', '오늘',
  '기후', '시민', '회의', '질문', '의제', '운영', '감축', '관련해서', '부분', '생각',
  '합니다', '했습니다', '습니다', '었습니다', '었습니', '있습니', '했습니', '하나요',
  '되나요', '인가요', '정하나', '것인가', '수있는', '해주세요', '궁금합니다', '필요',
  '가능', '정책', '방안',
]);

const DOMAIN_TERMS = [
  '기획참여단', '숙의참여단', '모더레이터', '소수의견', '회의록', '권고안', '현장토론',
  '온라인', '절차', '의제수정', '역할', '최종판단', '재생에너지', '전기요금',
  '대중교통', '온실가스', '건물에너지', '소상공인', '중소기업', '농어촌', '도시',
  '부담', '지원', '규제', '전환', '효율', '폐기물', '일회용품',
];

const THEORY_LENSES = [
  {
    id: 'lens_public_sphere',
    label: '공론장 연결성',
    model: '변형 하버마스',
    description: '현장·온라인·조별 논의가 하나의 공론장으로 연결되는지 본다.',
    patterns: [/온라인|현장|공론장|공개|공유|같이 보|연결|전체/],
  },
  {
    id: 'lens_procedural_legitimacy',
    label: '절차 정당성',
    model: '숙의 민주주의',
    description: '의제 조정, 우선순위, 최종 판단의 절차가 납득 가능한지 본다.',
    patterns: [/절차|기준|우선순위|최종 판단|결정 이후|어디까지|반영 비율|조정/],
  },
  {
    id: 'lens_role_boundary',
    label: '역할 경계',
    model: '거버넌스 분석',
    description: '참여단, 기획참여단, 연구진, 모더레이터의 권한과 책임 경계를 본다.',
    patterns: [/역할|기획참여단|숙의참여단|연구진|모더레이터|누가|개입/],
  },
  {
    id: 'lens_discourse_quality',
    label: '숙의 품질',
    model: '담론윤리 변형',
    description: '질문이 명확히 정리되고 유사 의견이 묶이며 논의가 깊어지는지 본다.',
    patterns: [/질문|핵심|정리|묶|비슷한|이해|논의|토론|명확|선명/],
  },
  {
    id: 'lens_inclusion',
    label: '포용·대표성',
    model: '사회적 대표성',
    description: '소수의견과 우려가 배제되지 않고 권고안까지 이동하는지 본다.',
    patterns: [/소수의견|우려|배제|포함|대표|권고안|발언 부담|남겨/],
  },
  {
    id: 'lens_trust_transparency',
    label: '신뢰·투명성',
    model: '제도 신뢰',
    description: '검토 기준, 공개 범위, 기록 방식이 신뢰를 만드는지 본다.',
    patterns: [/검토|공개|투명|기록|회의록|기준 공유|설명|신뢰/],
  },
  {
    id: 'lens_emotional_safety',
    label: '발언 안정성',
    model: '참여 심리',
    description: '참여자가 부담을 낮추고 안전하게 말할 수 있는 조건을 본다.',
    patterns: [/부담|편안|안심|말하기|발언|소외|긴장|안전/],
  },
  {
    id: 'lens_knowledge_mediation',
    label: '전문성 매개',
    model: '지식사회학',
    description: '전문가·연구진 해석이 시민 언어와 어떻게 연결되는지 본다.',
    patterns: [/연구진|전문|검토|자료|근거|해석|설명|데이터/],
  },
];

function parseArgs(argv) {
  const args = {
    csv: null,
    csvUrl: null,
    out: DEFAULT_OUT,
    sourceId: 'participant-open-questions',
    label: '참여단 주관식 — 소감/질문',
    threshold: 0.08,
    updateSources: false,
    includeKeywordNodes: false,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--csv') args.csv = argv[++i];
    else if (a === '--csv-url') args.csvUrl = argv[++i];
    else if (a === '--out') args.out = resolve(argv[++i]);
    else if (a === '--source-id') args.sourceId = argv[++i];
    else if (a === '--label') args.label = argv[++i];
    else if (a === '--threshold') args.threshold = Number(argv[++i]);
    else if (a === '--update-sources') args.updateSources = true;
    else if (a === '--no-update-sources') args.updateSources = false;
    else if (a === '--include-keyword-nodes') args.includeKeywordNodes = true;
    else if (a === '--help') {
      console.log(`Usage:
  node scripts/build-participant-question-ontology.mjs --csv <responses.csv>
  node scripts/build-participant-question-ontology.mjs --csv-url <google_sheet_csv_url>

Expected columns:
  타임스탬프, 조, 소감, 질문
Aliases:
  기후시민회의 운영 관련 질문 -> 소감
  감축의제 질문 -> 질문`);
      process.exit(0);
    }
  }
  return args;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (c === '"') {
        inQuotes = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (c !== '\r') {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((v) => String(v).trim() !== ''));
}

function csvToObjects(text) {
  const rows = parseCsv(text);
  if (rows.length < 2) return [];
  const header = rows[0].map((h) => String(h || '').trim());
  return rows.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])));
}

async function readCsv(args) {
  if (args.csvUrl) {
    const res = await fetch(args.csvUrl);
    if (!res.ok) throw new Error(`CSV URL failed: ${res.status} ${res.statusText}`);
    return await res.text();
  }
  if (!args.csv) throw new Error('Provide --csv or --csv-url');
  return readFileSync(resolve(args.csv), 'utf8');
}

function pickColumn(row, candidates) {
  for (const key of candidates) {
    if (Object.prototype.hasOwnProperty.call(row, key)) return row[key];
  }
  const normalized = Object.fromEntries(Object.keys(row).map((k) => [k.replace(/\s+/g, '').toLowerCase(), k]));
  for (const key of candidates) {
    const hit = normalized[key.replace(/\s+/g, '').toLowerCase()];
    if (hit) return row[hit];
  }
  return '';
}

function normalizeGroup(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return raw.endsWith('조') ? raw : `${raw}조`;
}

function tokenize(text) {
  const compactText = String(text || '').replace(/\s+/g, '');
  const rawTokens = String(text || '')
    .toLowerCase()
    .replace(/[^\p{Script=Hangul}a-z0-9\s]/gu, ' ')
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean);
  const tokens = rawTokens
    .map((t) => t.replace(/(은|는|이|가|을|를|과|와|도|만|에서|으로|에게|인가요|하나요|할까요|되나요|있나요)$/u, ''))
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t));
  for (const term of DOMAIN_TERMS) {
    if (compactText.includes(term)) tokens.push(term);
  }
  const compact = rawTokens.join('');
  const grams = [];
  for (let i = 0; i < compact.length - 1; i += 1) grams.push(compact.slice(i, i + 2));
  for (let i = 0; i < compact.length - 2; i += 1) grams.push(compact.slice(i, i + 3));
  return [...new Set([...tokens, ...grams.filter((g) => !STOPWORDS.has(g))])];
}

function jaccard(a, b) {
  const A = new Set(a);
  const B = new Set(b);
  const union = new Set([...A, ...B]);
  if (!union.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter += 1;
  return inter / union.size;
}

function isAnalysisTerm(term) {
  const clean = String(term || '').trim();
  const isDomainTerm = DOMAIN_TERMS.includes(clean);
  if (clean.length < 3 || STOPWORDS.has(clean)) return false;
  if (!isDomainTerm && clean.length < 4) return false;
  if (!isDomainTerm && /[습같였졌]/.test(clean)) return false;
  if (!isDomainTerm && /[은는이가을를와과의에로도만]$/.test(clean)) return false;
  if (/(습니다|습니까|하나요|인가요|되나요|있나요|했습니|었습니)$/.test(clean)) return false;
  if (DOMAIN_TERMS.some((domain) => domain !== clean && domain.includes(clean))) return false;
  return true;
}

function topTerms(responses, limit = 24) {
  const freq = new Map();
  for (const r of responses) {
    for (const t of r.tokens) freq.set(t, (freq.get(t) || 0) + 1);
  }
  return [...freq.entries()]
    .filter(([term, n]) => n >= 2 && isAnalysisTerm(term))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ko'))
    .slice(0, limit)
    .map(([term, count]) => ({ term, count }));
}

function buildSimilarityEdges(responses, threshold) {
  const edges = [];
  for (let i = 0; i < responses.length; i += 1) {
    for (let j = i + 1; j < responses.length; j += 1) {
      if (responses[i].questionKey !== responses[j].questionKey) continue;
      const sim = jaccard(responses[i].tokens, responses[j].tokens);
      if (sim >= threshold) edges.push({ source: responses[i].id, target: responses[j].id, weight: sim });
    }
  }
  return edges.sort((a, b) => b.weight - a.weight);
}

function buildMetricEdges(responses, simEdges, terms) {
  const metricEdges = new Map();
  const topTermSet = new Set(terms.map((t) => t.term));
  const keyFor = (a, b) => [a, b].sort().join('::');
  for (const e of simEdges) {
    metricEdges.set(keyFor(e.source, e.target), { source: e.source, target: e.target, weight: e.weight });
  }
  for (let i = 0; i < responses.length; i += 1) {
    for (let j = i + 1; j < responses.length; j += 1) {
      const sameQuestion = responses[i].questionKey === responses[j].questionKey;
      const sharedTerms = sameQuestion ? responses[i].tokens.filter((t) => topTermSet.has(t) && responses[j].tokens.includes(t)) : [];
      const sharedLenses = (responses[i].lenses || []).filter((id) => (responses[j].lenses || []).includes(id));
      if (!sharedTerms.length) continue;
      const key = keyFor(responses[i].id, responses[j].id);
      const existing = metricEdges.get(key);
      const weight = Math.min(1, (existing?.weight || 0) + sharedTerms.length * 0.08 + sharedLenses.length * 0.12);
      metricEdges.set(key, { source: responses[i].id, target: responses[j].id, weight });
    }
  }
  for (let i = 0; i < responses.length; i += 1) {
    for (let j = i + 1; j < responses.length; j += 1) {
      const sharedLenses = (responses[i].lenses || []).filter((id) => (responses[j].lenses || []).includes(id));
      if (!sharedLenses.length) continue;
      const key = keyFor(responses[i].id, responses[j].id);
      const existing = metricEdges.get(key);
      const weight = Math.min(1, (existing?.weight || 0) + sharedLenses.length * 0.12);
      metricEdges.set(key, { source: responses[i].id, target: responses[j].id, weight });
    }
  }
  return [...metricEdges.values()];
}

function centrality(nodes, edges) {
  const ids = nodes.map((n) => n.id);
  const adj = Object.fromEntries(ids.map((id) => [id, []]));
  for (const e of edges) {
    adj[e.source]?.push({ id: e.target, weight: e.weight });
    adj[e.target]?.push({ id: e.source, weight: e.weight });
  }

  const degree = {};
  for (const id of ids) {
    degree[id] = adj[id].reduce((sum, e) => sum + e.weight, 0);
  }
  const maxDegree = Math.max(1, ...Object.values(degree));
  const degreeCentrality = Object.fromEntries(ids.map((id) => [id, degree[id] / maxDegree]));

  const betweenness = Object.fromEntries(ids.map((id) => [id, 0]));
  const closeness = Object.fromEntries(ids.map((id) => [id, 0]));
  for (const s of ids) {
    const stack = [];
    const pred = Object.fromEntries(ids.map((id) => [id, []]));
    const sigma = Object.fromEntries(ids.map((id) => [id, 0]));
    const dist = Object.fromEntries(ids.map((id) => [id, -1]));
    sigma[s] = 1;
    dist[s] = 0;
    const queue = [s];
    while (queue.length) {
      const v = queue.shift();
      stack.push(v);
      for (const { id: w } of adj[v]) {
        if (dist[w] < 0) {
          queue.push(w);
          dist[w] = dist[v] + 1;
        }
        if (dist[w] === dist[v] + 1) {
          sigma[w] += sigma[v];
          pred[w].push(v);
        }
      }
    }
    const reachable = ids.filter((id) => id !== s && dist[id] > 0);
    if (reachable.length) {
      const sumDist = reachable.reduce((sum, id) => sum + dist[id], 0);
      closeness[s] = sumDist ? reachable.length / sumDist : 0;
    }
    const delta = Object.fromEntries(ids.map((id) => [id, 0]));
    while (stack.length) {
      const w = stack.pop();
      for (const v of pred[w]) {
        delta[v] += (sigma[v] / sigma[w]) * (1 + delta[w]);
      }
      if (w !== s) betweenness[w] += delta[w];
    }
  }
  const maxBetweenness = Math.max(1, ...Object.values(betweenness));
  const maxCloseness = Math.max(1, ...Object.values(closeness));
  let pagerank = Object.fromEntries(ids.map((id) => [id, 1 / Math.max(1, ids.length)]));
  const damping = 0.85;
  for (let iter = 0; iter < 42; iter += 1) {
    const next = Object.fromEntries(ids.map((id) => [id, (1 - damping) / Math.max(1, ids.length)]));
    for (const id of ids) {
      const links = adj[id];
      const weightSum = links.reduce((sum, e) => sum + e.weight, 0);
      if (!weightSum) {
        const share = damping * pagerank[id] / Math.max(1, ids.length);
        ids.forEach((target) => { next[target] += share; });
        continue;
      }
      for (const link of links) {
        next[link.id] += damping * pagerank[id] * (link.weight / weightSum);
      }
    }
    pagerank = next;
  }
  const maxPagerank = Math.max(1e-9, ...Object.values(pagerank));
  return {
    degree: degreeCentrality,
    betweenness: Object.fromEntries(ids.map((id) => [id, betweenness[id] / maxBetweenness])),
    closeness: Object.fromEntries(ids.map((id) => [id, closeness[id] / maxCloseness])),
    pagerank: Object.fromEntries(ids.map((id) => [id, pagerank[id] / maxPagerank])),
  };
}

function buildSimilarityClusters(responses, simEdges) {
  const parent = Object.fromEntries(responses.map((r) => [r.id, r.id]));
  const find = (id) => {
    let cur = id;
    while (parent[cur] !== cur) {
      parent[cur] = parent[parent[cur]];
      cur = parent[cur];
    }
    return cur;
  };
  const union = (a, b) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };
  simEdges.forEach((edge) => union(edge.source, edge.target));
  const grouped = new Map();
  responses.forEach((r) => {
    const root = find(r.id);
    if (!grouped.has(root)) grouped.set(root, []);
    grouped.get(root).push(r);
  });
  const clusters = [...grouped.values()]
    .filter((members) => members.length > 1)
    .sort((a, b) => b.length - a.length || a[0].id.localeCompare(b[0].id))
    .map((members, index) => {
      const tokenFreq = new Map();
      members.forEach((r) => {
        r.tokens.forEach((token) => tokenFreq.set(token, (tokenFreq.get(token) || 0) + 1));
      });
      const topTokens = [...tokenFreq.entries()]
        .filter(([token, count]) => count >= 2 && isAnalysisTerm(token))
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ko'))
        .slice(0, 5)
        .map(([term, count]) => ({ term, count }));
      const labelSource = topTokens[0]?.term || members[0].text;
      return {
        id: `sim_cluster_${index + 1}`,
        label: compactDisplayLabel(labelSource, '유사 묶음'),
        size: members.length,
        question_keys: [...new Set(members.map((r) => r.questionKey))],
        groups: [...new Set(members.map((r) => r.group).filter(Boolean))],
        top_terms: topTokens,
        members: members.map((r) => r.id),
      };
    });
  const assignment = {};
  clusters.forEach((cluster) => {
    cluster.members.forEach((id) => {
      assignment[id] = cluster.id;
    });
  });
  return { clusters, assignment };
}

function buildLinkCandidates(responses, simEdges, limit = 24) {
  const existing = new Set(simEdges.map((e) => [e.source, e.target].sort().join('::')));
  const candidates = [];
  for (let i = 0; i < responses.length; i += 1) {
    for (let j = i + 1; j < responses.length; j += 1) {
      const a = responses[i];
      const b = responses[j];
      const key = [a.id, b.id].sort().join('::');
      if (existing.has(key)) continue;
      const similarity = jaccard(a.tokens, b.tokens);
      const sharedLenses = a.lenses.filter((lens) => b.lenses.includes(lens));
      const sharedTokens = a.tokens.filter((token) => b.tokens.includes(token) && isAnalysisTerm(token));
      const sameQuestionBonus = a.questionKey === b.questionKey ? 0.04 : 0;
      const score = Math.min(1, similarity * 0.62 + sharedLenses.length * 0.14 + Math.min(4, sharedTokens.length) * 0.025 + sameQuestionBonus);
      if (score < 0.22) continue;
      candidates.push({
        source: a.id,
        source_label: responseLabel(a.text, a.questionKey),
        target: b.id,
        target_label: responseLabel(b.text, b.questionKey),
        relation: 'linkCandidate',
        label: '연결 후보',
        score: Number(score.toFixed(4)),
        similarity: Number(similarity.toFixed(4)),
        shared_lenses: sharedLenses,
        shared_terms: [...new Set(sharedTokens)].slice(0, 8),
        reason: sharedLenses.length ? '공유 분석렌즈와 부분 유사성이 함께 나타남' : '공유 표현과 구조적 유사성이 나타남',
      });
    }
  }
  return candidates.sort((a, b) => b.score - a.score || a.source.localeCompare(b.source)).slice(0, limit);
}

const LABEL_PATTERNS = [
  [/용어.*통일/, '용어 통일 필요'],
  [/트럼프|미국.*안하는데|왜 우리는.*해야/, '국제 형평성 문제'],
  [/에너지 전환 전력|전환 전력/, '에너지 전환 전략'],
  [/2분과.*5도|1\.?5도|5도/, '분과·온도목표 쟁점'],
  [/현재.*우리나라.*위치|연도별.*부문별.*감축 목표|구체적 감축 목표/, '부문별 감축목표 확인'],
  [/탄소중립.*저탄소.*차이|저탄소.*차이|탄소중립과 저탄소/, '탄소중립·저탄소 구분'],
  [/내가 실천.*탄소 감축|실천하고 있는 탄소 감축/, '개인 실천 감축행동'],
  [/감축비용|감축 비용/, '감축비용 설명 방식'],
  [/피해를 보는 산업|노동자.*보호|산업과 노동자/, '전환 피해 산업·노동자 보호'],
  [/넷제로.*탄소 중립|넷제로와 탄소/, '넷제로·탄소중립 구분'],
  [/지속가능한 삶|탄소감축.*기후행동|기후행동/, '지속가능한 기후행동'],
  [/전력이나 산업.*실행주체|정부나 기업.*시민|시민들이 논의.*어렵/, '전력·산업 의제 시민숙의'],
  [/없음|없다|궁금함|패스합니다|^\?+$|^-$/u, '질문 미기재'],
  [/감사합니다|유용한 정보|좋았음|좋았다|완전 좋았다/, '긍정적 참여 소감'],
  [/운영 모더레이터.*운영 실제|모더레이터 활동.*방법|방법적 강의/, '모더레이터 실습 요구'],
  [/8월에 다시|전략회의|자리.*또 있어야/, '후속 전략회의 요구'],
  [/포스트잇.*큰 사이즈|큰 사이즈.*준비/, '큰 포스트잇 요청'],
  [/구체적인 것을 알게|준비에 도움/, '구체적 준비 도움'],
  [/열정적으로 참여|많이배웠|많이 배웠/, '참여 열정에서 학습'],
  [/강의 길게|실습시간|모더래이터 교육|모더레이터 교육/, '모더레이터 교육 확대'],
  [/한번 더|자리 한번 더|감의빼고요/, '추가 교육 자리 요구'],
  [/새로 알게|새로 알게된것/, '새로운 정보 학습'],
  [/긴장됩니다|긴장/, '참여 긴장감'],
  [/돌발 상황.*대응|사전 지식.*습득/, '돌발상황 대응 준비'],
  [/의제 범위.*조정.*기준|조정할 수 있는 기준/, '의제 범위 조정 기준'],
  [/역할.*겹칠.*최종 판단|역할이 겹칠 때/, '역할 겹침 시 최종 판단 주체'],
  [/소수의견.*회의록|소수의견.*권고안/, '소수의견 기록·권고안 반영'],
  [/온라인.*현장.*반영 비율|현장토론.*반영 비율/, '온라인·현장 의견 반영 비율'],
  [/모더레이터.*원문.*유지|원문 표현.*유지/, '모더레이터 원문 유지 범위'],
  [/의제.*수정.*절차|결정 이후.*수정/, '의제 수정 절차'],
  [/질문.*우선순위.*기준|우선순위는 어떤 기준/, '질문 우선순위 기준'],
  [/연구진.*검토.*공개|검토 결과.*공개/, '연구진 검토 결과 공개 범위'],
  [/우려사항.*권고안.*표시|우려사항은 최종 권고안/, '우려사항 권고안 별도 표시'],
  [/의제 범위.*넓게.*조별|조별로 나누니|의제 범위가 구체화/, '조별 논의로 의제 범위 구체화'],
  [/역할.*구분.*설명|역할을 구분/, '참여단·기획참여단 역할 구분'],
  [/소수의견.*기록.*발언 부담|발언 부담.*줄/, '소수의견 기록으로 발언 부담 완화'],
  [/온라인 의견.*현장 의견.*공정|같이 보는 방식/, '온라인·현장 의견 병행 검토'],
  [/긴 발언.*정리|핵심이 잘 보/, '모더레이터 정리로 핵심 파악'],
  [/의제.*고정.*토론 중 조정|토론 중 조정/, '토론 중 의제 조정 가능성'],
  [/비슷한 내용.*묶어|질문이 많이.*묶어|비슷한 질문.*묶어/, '유사 질문 묶음 효과'],
  [/연구진.*검토 기준|검토 기준.*공유/, '연구진 검토 기준 공유 필요'],
  [/우려사항.*따로 모아|쟁점이 더 선명/, '우려사항 분리로 쟁점 명확화'],
  [/역할 차이.*분명|역할 차이를 더 분명/, '참여단 역할 차이 명확화'],
  [/조별 논의.*전체 의제.*기준|전체 의제로 올라가는 기준/, '조별 질문의 전체 의제화 기준'],
  [/소수의견.*반복.*쟁점|별도 쟁점으로 승격/, '반복 소수의견의 쟁점화 기준'],
  [/조별 토론 결과.*다를 때|공통분모.*정리/, '조별 차이의 공통분모 정리'],
  [/현장에 참석하지 못한 사람|참석하지 못한 사람의 의견/, '비참석자 의견 보완 방식'],
  [/조마다 다른 관점|공론장 전체가 더 풍부/, '조별 관점으로 공론장 확장'],
  [/발언이 짧아도 화면에 남|참여했다는 느낌/, '짧은 발언의 기록 효과'],
  [/발언을 요약할 때.*해석|해석이 과도하게/, '요약 시 해석 개입 통제'],
  [/전문 용어.*시민 언어|시민 언어로 다시/, '전문용어의 시민 언어화'],
  [/전문가 설명.*시민 의견.*충돌|어떤 절차로 조정/, '전문가·시민 의견 충돌 조정'],
  [/권고안까지 이어지는 기록|참여 동기가 커/, '권고안 연계 기록 동기'],
  [/우려사항과 반대의견|같은 범주로 처리/, '우려·반대의견 분류 기준'],
  [/현장 발언.*사전 질문|함께 연결/, '현장 발언·사전 질문 연결'],
  [/토론 시간이 부족|질문 우선순위.*결정/, '시간 부족 시 질문 우선순위'],
  [/역할과 책임.*먼저 정리|혼선이 줄/, '역할·책임 선정리 효과'],
  [/연구진이 판단하는 부분|참여단이 결정하는 부분/, '연구진 판단·참여단 결정 구분'],
  [/우려와 제안을 분리|논의 자원처럼/, '우려·제안 분리 효과'],
  [/모더레이터 개입 범위|발언자 신뢰/, '모더레이터 개입 범위 명확화'],
  [/온라인으로 제출한 질문|같은 무게로 다뤄/, '온라인 질문의 동등 반영'],
  [/회의록.*원문.*요약|원문과 요약이 함께/, '회의록 원문·요약 병기'],
  [/권고안 문장.*원래 표현|원래 표현을 일부/, '권고안 내 원문 표현 반영'],
  [/조별 결과.*전체 공론장|다시 연결하는 장치/, '조별 결과의 전체 연결'],
  [/연구진이 만든 요약.*다시 검토|다시 검토할 기회/, '연구진 요약 재검토 기회'],
];

const LABEL_STOP_PHRASES = [
  '기후시민회의', '숙의참여단과', '숙의참여단', '기획참여단의', '기획참여단이',
  '참여단과', '참여단', '관련해서', '어디까지', '어떻게', '어떤', '누가',
  '하나요', '인가요', '되나요', '있나요', '필요한가요', '좋았습니다',
  '느껴졌습니다', '같습니다', '들었습니다',
];

const CONNECTIVE_ENDINGS = [
  '수 있는', '할 수 있는', '때', '에서', '으로', '와', '과', '은', '는', '이', '가',
  '어떤', '어떻게', '누가', '어디까지',
];

function compactDisplayLabel(text, fallbackKind = '') {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return fallbackKind || '응답';
  for (const [pattern, label] of LABEL_PATTERNS) {
    if (pattern.test(clean)) return label;
  }
  let label = clean
    .replace(/[?？!！.。]+$/g, '')
    .replace(/기획참여단과 숙의참여단의/g, '참여단 간')
    .replace(/기획참여단의|숙의참여단의|참여단의/g, '')
    .replace(/할 수 있나요|할 수 있는지|할 수 있는|수 있는/g, '가능성')
    .replace(/해야 하나요|해야 하는지|해야 하는/g, '필요성')
    .replace(/어디까지인가요|어디까지/g, '범위')
    .replace(/어떻게 남겨지나요|어떻게/g, '방식')
    .replace(/누가 하나요|누가/g, '주체')
    .replace(/어떤 기준으로 정하나요|어떤 기준/g, '기준')
    .replace(/무엇인가요|무엇인지|무엇/g, '내용')
    .replace(/인가요|하나요|되나요|있나요|나요$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  for (const phrase of LABEL_STOP_PHRASES) {
    label = label.replaceAll(phrase, '');
  }
  label = label.replace(/\s+/g, ' ').replace(/\s+의\s+/g, ' ').replace(/^[,·\s]+|[,·\s]+$/g, '').trim();
  if (!label) label = fallbackKind || clean;
  let words = label.split(/\s+/).filter(Boolean);
  while (words.length > 1 && CONNECTIVE_ENDINGS.includes(words.at(-1))) words = words.slice(0, -1);
  label = words.join(' ');
  if (label.length <= 18) return label;
  const cutPoints = [' 기준', ' 범위', ' 방식', ' 주체', ' 절차', ' 필요성', ' 가능성', ' 반영', ' 공개', ' 공유'];
  for (const point of cutPoints) {
    const idx = label.indexOf(point);
    if (idx > 4 && idx + point.length <= 20) return label.slice(0, idx + point.length).trim();
  }
  return `${label.slice(0, 17).trim()}…`;
}

function responseLabel(text, questionKey = '') {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  const label = compactDisplayLabel(clean, questionKey === 'question' ? '질문' : '소감');
  if (label && label !== clean) return label;
  if (clean.length <= 18 && !/[?？]$/.test(clean)) return clean;
  return label;
}

function detectTheoryLenses(text) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  const hits = THEORY_LENSES
    .filter((lens) => lens.patterns.some((pattern) => pattern.test(clean)))
    .map((lens) => lens.id);
  if (hits.length) return [...new Set(hits)].slice(0, 3);
  return ['lens_discourse_quality'];
}

function buildGraph(rows, args) {
  const responses = [];
  rows.forEach((row, rowIndex) => {
    const group = normalizeGroup(pickColumn(row, GROUP_COLUMNS));
    const timestamp = String(pickColumn(row, TIMESTAMP_COLUMNS) || '').trim();
    QUESTION_COLUMNS.forEach((q) => {
      const answer = String(pickColumn(row, q.candidates) || '').trim();
      if (!answer) return;
      responses.push({
        id: `resp_${q.key}_${responses.length + 1}`,
        rowIndex: rowIndex + 1,
        questionKey: q.key,
        questionLabel: q.hubLabel,
        group,
        timestamp,
        text: answer,
        tokens: tokenize(answer),
        lenses: detectTheoryLenses(answer),
      });
    });
  });

  const simEdges = buildSimilarityEdges(responses, args.threshold);
  const terms = topTerms(responses);
  const metricEdges = buildMetricEdges(responses, simEdges, terms);
  const metrics = centrality(responses, metricEdges);
  const similarityClusters = buildSimilarityClusters(responses, simEdges);
  const linkCandidates = buildLinkCandidates(responses, simEdges);
  const linkCandidatesByNode = {};
  linkCandidates.forEach((candidate) => {
    [candidate.source, candidate.target].forEach((id) => {
      if (!linkCandidatesByNode[id]) linkCandidatesByNode[id] = [];
      linkCandidatesByNode[id].push({
        node_id: id === candidate.source ? candidate.target : candidate.source,
        label: id === candidate.source ? candidate.target_label : candidate.source_label,
        score: candidate.score,
        reason: candidate.reason,
      });
    });
  });
  const frequencyByTerm = Object.fromEntries(terms.map((t) => [t.term, t.count]));
  const termById = new Map(terms.map((t, i) => [t.term, `term_${i + 1}`]));
  const now = new Date().toISOString();

  const nodes = [];
  for (const q of QUESTION_COLUMNS) {
    nodes.push({
      data: {
        id: q.hubId,
        label: q.hubLabel,
        kind: 'Group',
        kindKo: '문항',
        text: q.hubLabel,
        session: 'participant-test',
        deg: responses.filter((r) => r.questionKey === q.key).length,
        isolated: false,
        meta: { question_key: q.key },
      },
    });
  }
  for (const lens of THEORY_LENSES) {
    const count = responses.filter((r) => r.lenses.includes(lens.id)).length;
    if (!count) continue;
    nodes.push({
      data: {
        id: lens.id,
        label: lens.label,
        kind: 'Value',
        kindKo: '분석렌즈',
        text: `${lens.model}: ${lens.description}`,
        session: 'analysis-method',
        deg: count,
        isolated: false,
        meta: {
          model: lens.model,
          description: lens.description,
          theory_lens: true,
        },
      },
    });
  }
  for (const r of responses) {
    nodes.push({
      data: {
        id: r.id,
        node_id: r.id,
        label: responseLabel(r.text, r.questionKey),
        kind: r.questionKey === 'impression' ? 'Claim' : 'Issue',
        kindKo: r.questionKey === 'impression' ? '소감' : '질문',
        text: r.text,
        session: r.group || '참여단',
        cited: [r.id],
        cited_uids: [r.id],
        deg: simEdges.filter((e) => e.source === r.id || e.target === r.id).length + 1,
        isolated: false,
        meta: {
          row_index: r.rowIndex,
          question_key: r.questionKey,
          question_label: r.questionLabel,
          group: r.group,
          timestamp: r.timestamp,
          tokens: r.tokens,
          lenses: r.lenses,
          similarity_cluster: similarityClusters.assignment[r.id] || null,
          link_candidates: (linkCandidatesByNode[r.id] || []).slice(0, 5),
          centrality: {
            degree: Number(metrics.degree[r.id]?.toFixed(4) || 0),
            betweenness: Number(metrics.betweenness[r.id]?.toFixed(4) || 0),
            closeness: Number(metrics.closeness[r.id]?.toFixed(4) || 0),
            pagerank: Number(metrics.pagerank[r.id]?.toFixed(4) || 0),
          },
          analysis: {
            frequency: r.tokens
              .filter((token) => frequencyByTerm[token])
              .map((token) => ({ term: token, count: frequencyByTerm[token] }))
              .sort((a, b) => b.count - a.count || a.term.localeCompare(b.term, 'ko'))
              .slice(0, 8),
            degree: Number(metrics.degree[r.id]?.toFixed(4) || 0),
            betweenness: Number(metrics.betweenness[r.id]?.toFixed(4) || 0),
            closeness: Number(metrics.closeness[r.id]?.toFixed(4) || 0),
            pagerank: Number(metrics.pagerank[r.id]?.toFixed(4) || 0),
            similarity_cluster: similarityClusters.assignment[r.id] || null,
            theory_lens: r.lenses,
            link_candidates: (linkCandidatesByNode[r.id] || []).slice(0, 5),
          },
        },
      },
    });
  }
  if (args.includeKeywordNodes) {
    for (const t of terms) {
      nodes.push({
        data: {
          id: termById.get(t.term),
          label: t.term,
          kind: 'Value',
          kindKo: '공통키워드',
          text: `${t.term} (${t.count})`,
          session: 'keyword',
          deg: t.count,
          isolated: false,
          meta: { count: t.count },
        },
      });
    }
  }

  const edges = [];
  for (const r of responses) {
    const hub = QUESTION_COLUMNS.find((q) => q.key === r.questionKey).hubId;
    edges.push({
      data: {
        id: `q_${edges.length + 1}`,
        source: hub,
        target: r.id,
        rel: 'raisesIssue',
        relKo: '응답',
        weight: 1,
        meta: { question_key: r.questionKey },
      },
    });
    for (const lensId of r.lenses) {
      const lens = THEORY_LENSES.find((l) => l.id === lensId);
      if (!lens) continue;
      edges.push({
        data: {
          id: `lens_${edges.length + 1}`,
          source: r.id,
          target: lens.id,
          rel: 'framesThrough',
          relKo: '분석렌즈',
          weight: 0.72,
          meta: {
            model: lens.model,
            lens: lens.label,
          },
        },
      });
    }
    if (args.includeKeywordNodes) {
      for (const token of r.tokens) {
        const termId = termById.get(token);
        if (!termId) continue;
        edges.push({
          data: {
            id: `kw_${edges.length + 1}`,
            source: r.id,
            target: termId,
            rel: 'hasKeyword',
            relKo: '키워드',
            weight: 0.4,
            meta: { token },
          },
        });
      }
    }
  }
  simEdges.forEach((e, i) => {
    edges.push({
      data: {
        id: `sim_${i + 1}`,
        source: e.source,
        target: e.target,
        rel: 'similarTo',
        relKo: '유사',
        weight: Number(e.weight.toFixed(4)),
        meta: { similarity: Number(e.weight.toFixed(4)) },
      },
    });
  });

  const responseById = Object.fromEntries(responses.map((r) => [r.id, r]));
  const topBy = (metric) => responses
    .map((r) => ({ id: r.id, label: responseLabel(r.text, r.questionKey), group: r.group, question_key: r.questionKey, value: Number(metrics[metric][r.id]?.toFixed(4) || 0) }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 10);

  return {
    elements: { nodes, edges },
    meta: {
      variant: 'participant-open-questions',
      generated_at: now,
      source: args.csvUrl ? 'google-sheet-csv' : 'local-csv',
      threshold: args.threshold,
      counts: {
        rows: rows.length,
        responses: responses.length,
        impression_responses: responses.filter((r) => r.questionKey === 'impression').length,
        question_responses: responses.filter((r) => r.questionKey === 'question').length,
        nodes: nodes.length,
        edges: edges.length,
        similarity_edges: simEdges.length,
        similarity_clusters: similarityClusters.clusters.length,
        link_candidates: linkCandidates.length,
        keyword_nodes: args.includeKeywordNodes ? terms.length : 0,
        theory_lens_nodes: THEORY_LENSES.filter((lens) => responses.some((r) => r.lenses.includes(lens.id))).length,
        theory_lens_edges: responses.reduce((sum, r) => sum + r.lenses.length, 0),
      },
      theory_lenses: THEORY_LENSES.map((lens) => ({
        id: lens.id,
        label: lens.label,
        model: lens.model,
        count: responses.filter((r) => r.lenses.includes(lens.id)).length,
        description: lens.description,
      })).filter((lens) => lens.count > 0),
      methodology: {
        title: '변형 하버마스 + 사회과학 분석 렌즈',
        summary: '응답을 정책 쟁점 구조로 강제하지 않고, 숙의 과정의 절차 정당성, 역할 경계, 포용성, 공론장 연결성, 신뢰, 발언 안정성, 전문성 매개로 읽는다.',
        relation_logic: '문항 연결은 응답 관계, 유사 연결은 텍스트 유사성, 분석렌즈 연결은 사회과학적 해석 범주, 중심성은 유사성+공유 렌즈 네트워크에서 계산한다.',
        metrics: {
          frequency: '응답 토큰의 반복 노출을 집계한다.',
          degree: '유사성·공유 렌즈 네트워크에서 직접 연결 강도를 본다.',
          betweenness: '서로 다른 응답 묶음을 이어주는 매개 노드를 본다.',
          closeness: '전체 응답군에 의미상 가까운 노드를 본다.',
          pagerank: '중요한 노드와 연결된 응답을 더 높게 본다.',
          similarity_cluster: '직접 유사 엣지로 연결된 응답 묶음을 본다.',
          link_candidate: '아직 확정 엣지는 아니지만 공유 렌즈와 부분 유사성이 높은 연결 후보를 본다.',
        },
      },
      frequency_terms: terms,
      centrality: {
        degree_top: topBy('degree'),
        betweenness_top: topBy('betweenness'),
        closeness_top: topBy('closeness'),
        pagerank_top: topBy('pagerank'),
      },
      similarity_clusters: similarityClusters.clusters,
      link_candidates: linkCandidates,
      similarity_edges: simEdges.slice(0, 20).map((e) => ({
        source: e.source,
        source_label: responseLabel(responseById[e.source]?.text, responseById[e.source]?.questionKey),
        target: e.target,
        target_label: responseLabel(responseById[e.target]?.text, responseById[e.target]?.questionKey),
        similarity: Number(e.weight.toFixed(4)),
      })),
      advisory_notice: '참여단 주관식 응답을 현장 검토용으로 구조화한 임시 온톨로지입니다. 최종 해석이나 합의가 아닙니다.',
    },
  };
}

function updateSources(args) {
  const dataFile = args.out.startsWith(join(WIKI_ROOT, 'public', 'workshop-graph', 'data'))
    ? args.out.slice(join(WIKI_ROOT, 'public', 'workshop-graph').length + 1).replace(/\\/g, '/')
    : `data/${args.sourceId}.json`;
  const sources = JSON.parse(readFileSync(SOURCES_PATH, 'utf8'));
  sources.categories = {
    ...(sources.categories || {}),
    participant: '참여단 테스트',
  };
  const entry = {
    id: args.sourceId,
    category: 'participant',
    label: args.label,
    data: dataFile,
    supportsView: ['2d'],
  };
  const idx = sources.sources.findIndex((s) => s.id === args.sourceId);
  if (idx >= 0) sources.sources[idx] = entry;
  else sources.sources.push(entry);
  const formatted = JSON.stringify(sources, null, 2)
    .replace(/"supportsView": \[\n\s+"2d",\n\s+"3d"\n\s+\]/g, '"supportsView": ["2d", "3d"]')
    .replace(/"supportsView": \[\n\s+"2d"\n\s+\]/g, '"supportsView": ["2d"]');
  writeFileSync(SOURCES_PATH, `${formatted}\n`);
}

async function main() {
  const args = parseArgs(process.argv);
  const csv = await readCsv(args);
  const rows = csvToObjects(csv);
  const graph = buildGraph(rows, args);
  mkdirSync(dirname(args.out), { recursive: true });
  writeFileSync(args.out, `${JSON.stringify(graph, null, 2)}\n`);
  if (args.updateSources) updateSources(args);
  console.log(`[participant-ontology] rows=${graph.meta.counts.rows} responses=${graph.meta.counts.responses} nodes=${graph.meta.counts.nodes} edges=${graph.meta.counts.edges}`);
  console.log(`[participant-ontology] out=${args.out}`);
}

main().catch((err) => {
  console.error(`[participant-ontology] ${err.message}`);
  process.exit(1);
});
