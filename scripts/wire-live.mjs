#!/usr/bin/env node
// wire-live.mjs
// v2 live_monitor.py 출력 JSON → wiki/public/live-graph/data.json 자동 변환
//
// usage (단일 입력):
//   node scripts/wire-live.mjs <path/to/{group}_{round}_live.json> [--push]
//
// usage (디렉터리 watch / latest pick):
//   node scripts/wire-live.mjs --dir <out_dir> [--match "*_live.json"] [--push]
//   (가장 최근 mtime 파일 자동 pick)
//
// usage (v2 직접 실행):
//   node scripts/wire-live.mjs --run-monitor --base <chunks_base> --group A조 --round 토론2-1 [--push]
//   (live_monitor.py reextract_once 호출 + 결과 wire)
//
// 옵션:
//   --push       : git add+commit+push (자동 라이브)
//   --commit-msg : 커밋 메시지 override

import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, basename, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WIKI_ROOT = resolve(__dirname, '..');
const DATA_DIR = join(WIKI_ROOT, 'public', 'workshop-graph', 'data');
const SOURCES_PATH = join(WIKI_ROOT, 'public', 'workshop-graph', 'sources.json');
const BUILDER = join(__dirname, 'build-ontology-page.mjs');

function updateSourcesJson({ id, label, category, dataFile }) {
  const s = JSON.parse(readFileSync(SOURCES_PATH, 'utf-8'));
  const existing = s.sources.findIndex(x => x.id === id);
  const entry = {
    id, category, label,
    data: `data/${dataFile}`,
    supportsView: ['2d'],
  };
  if (category === 'live') entry.polling_default_sec = 15;
  if (existing >= 0) s.sources[existing] = entry; else s.sources.push(entry);
  writeFileSync(SOURCES_PATH, JSON.stringify(s, null, 2));
  console.log(`✓ sources.json: ${existing >= 0 ? 'updated' : 'added'} ${id}`);
}

function parseArgs(argv) {
  const args = { positional: [], push: false, runMonitor: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--push') args.push = true;
    else if (a === '--run-monitor') args.runMonitor = true;
    else if (a === '--dir') args.dir = argv[++i];
    else if (a === '--match') args.match = argv[++i];
    else if (a === '--base') args.base = argv[++i];
    else if (a === '--group') args.group = argv[++i];
    else if (a === '--round') args.round = argv[++i];
    else if (a === '--commit-msg') args.commitMsg = argv[++i];
    else if (a === '--id') args.id = argv[++i];
    else if (a === '--label') args.label = argv[++i];
    else if (a === '--category') args.category = argv[++i];
    else args.positional.push(a);
  }
  return args;
}

function pickLatest(dir, matchGlob) {
  const re = matchGlob
    ? new RegExp('^' + matchGlob.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$')
    : /_live\.json$/;
  const files = readdirSync(dir)
    .filter(f => re.test(f))
    .map(f => ({ name: f, full: join(dir, f), mtime: statSync(join(dir, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  if (!files.length) throw new Error(`No matching files in ${dir} (pattern: ${matchGlob || '*_live.json'})`);
  return files[0].full;
}

function runMonitor({ base, group, round }) {
  if (!base || !group || !round) {
    throw new Error('--run-monitor requires --base --group --round');
  }
  const tmpOut = join(WIKI_ROOT, '.tmp-live');
  const py = `
import sys, os, json
sys.path.insert(0, r'${resolve(WIKI_ROOT, '..', '20_스크립트', 'analysis').replace(/\\/g, '/')}')
sys.path.insert(0, r'${resolve(WIKI_ROOT, '..', '20_스크립트', 'transcription').replace(/\\/g, '/')}')
from live_monitor import reextract_once
from run_quality_pilot import make_aistudio_llm
key = os.environ.get('AISTUDIO_API_KEY') or os.environ.get('GEMINI_API_KEY')
if not key:
    sys.exit('AISTUDIO_API_KEY/GEMINI_API_KEY required')
llm = make_aistudio_llm(key, 'gemini-2.5-flash')
# 입력: chunks 폴더에서 live_chunks 형식 ({seq, ts, text}) 구성
import glob
chunks = []
for f in sorted(glob.glob(os.path.join(r'${base}', 'chunks', 't_*.json'))):
    d = json.load(open(f, encoding='utf-8'))
    seq = int(os.path.basename(f)[2:-5])
    segs = d.get('segments', [])
    text = ' '.join(s.get('text','') for s in segs).strip()
    if text:
        chunks.append({'seq': seq, 'ts': 0, 'text': text})
res = reextract_once(chunks, {'date': '260623', 'group': '${group}', 'round': '${round}'}, llm, r'${tmpOut}')
print('JSON_PATH:' + res['paths']['json'])
`;
  const out = execSync(`python -c "${py.replace(/\n/g, ';').replace(/"/g, '\\"')}"`, {
    cwd: WIKI_ROOT, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'inherit'],
  });
  const match = out.match(/JSON_PATH:(.+)/);
  if (!match) throw new Error('live_monitor 출력 경로 찾기 실패');
  return match[1].trim();
}

function build(src, args) {
  // 새 sources에 등록 (id는 파일명 stem 또는 args.id)
  const stem = basename(src).replace(/\.json$/, '').replace(/[^\w가-힣-]/g, '_');
  const id = args.id || stem;
  const category = args.category || (stem.includes('live') ? 'live' : stem.includes('regulation') ? 'regulation' : 'workshop');
  const dataFile = `${id}.json`;
  const dst = join(DATA_DIR, dataFile);
  const cmd = `node "${BUILDER}" "${src}" "${dst}" ${category}`;
  console.log('→ ' + cmd);
  execSync(cmd, { stdio: 'inherit' });
  updateSourcesJson({ id, label: args.label || id, category, dataFile });
}

function gitPush(commitMsg) {
  console.log('→ git add + commit + push');
  execSync('git add public/workshop-graph/data public/workshop-graph/sources.json', { cwd: WIKI_ROOT, stdio: 'inherit' });
  const msg = commitMsg || `chore(live): data.json 갱신 (${new Date().toISOString()})`;
  try {
    execSync(`git commit -m "${msg}"`, { cwd: WIKI_ROOT, stdio: 'inherit' });
    execSync('git push', { cwd: WIKI_ROOT, stdio: 'inherit' });
  } catch (e) {
    console.log('git commit failed (no changes or other error):', e.message);
  }
}

function main() {
  const args = parseArgs(process.argv);
  let src;
  if (args.runMonitor) {
    src = runMonitor(args);
  } else if (args.dir) {
    src = pickLatest(args.dir, args.match);
    console.log(`pick latest: ${src}`);
  } else if (args.positional[0]) {
    src = args.positional[0];
  } else {
    console.error('usage: node wire-live.mjs <file> | --dir <dir> | --run-monitor --base <chunks-base> --group <g> --round <r>');
    process.exit(1);
  }
  build(src, args);
  if (args.push) gitPush(args.commitMsg);
  console.log(`✓ wire done. URL: https://climate-assembly.org/workshop-graph/?source=${args.id || basename(src).replace(/\.json$/, '')}`);
}

main();
