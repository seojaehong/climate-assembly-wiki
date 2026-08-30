import { readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * kordoc 의 무거운 optional 의존성을 설치 직후 지운다.
 *
 * ★ `npm install --omit=optional` 을 쓰면 안 된다 — 그 플래그는 트리 전체에 걸리므로
 * rollup/esbuild/lightningcss 의 플랫폼 네이티브 바이너리까지 같이 빠지고
 * `astro build` 가 "Cannot find module '@rollup/rollup-win32-x64-msvc'" 로 죽는다.
 * 그래서 평범한 `npm install` 로 받은 뒤 여기서 무거운 것만 골라 지운다.
 *
 * PDF·OCR·이미지 변환 기능은 우리가 쓰지 않는다(DOCX 텍스트 추출만 쓴다).
 *
 * ★ 최상위 `sharp`·`@img` 는 지우지 않는다 — kordoc 이 아니라 **astro 의 이미지 서비스**가
 * 가져온 것이고(astro 0.34.5 / kordoc ^0.35 라 kordoc 사본은 따로 중첩된다),
 * 지우면 빌드가 `Rollup failed to resolve import "sharp"` 로 죽는다. kordoc 쪽 사본만 지운다.
 */
const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** 트리 어디에 있든 지울 패키지. 실제 무게가 있는 것만 적는다(설치 시 수백 MB). */
const HEAVY_OPTIONALS = [
  'onnxruntime-node',
  'onnxruntime-web',
  'onnxruntime-common',
  'pdfjs-dist',
  '@hyzyla/pdfium',
  '@huggingface/transformers',
];

/** kordoc 아래 중첩 사본일 때만 지울 패키지(최상위 것은 astro 가 쓴다). */
const KORDOC_NESTED_ONLY = ['sharp', '@img'];

const EPERM_RETRIES = 3;

/** node_modules 를 재귀로 훑어 중첩 사본까지 모두 찾는다. */
function findPackageDirs(nodeModulesDir, found = []) {
  let entries;
  try {
    entries = readdirSync(nodeModulesDir, { withFileTypes: true });
  } catch {
    return found;
  }

  for (const entry of entries) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    const entryPath = join(nodeModulesDir, entry.name);

    if (HEAVY_OPTIONALS.includes(entry.name)) {
      found.push(entryPath);
      continue;
    }

    if (entry.name.startsWith('@')) {
      for (const scoped of readdirSync(entryPath, { withFileTypes: true })) {
        if (!scoped.isDirectory() && !scoped.isSymbolicLink()) continue;
        const scopedPath = join(entryPath, scoped.name);
        if (HEAVY_OPTIONALS.includes(`${entry.name}/${scoped.name}`)) {
          found.push(scopedPath);
          continue;
        }
        findPackageDirs(join(scopedPath, 'node_modules'), found);
      }
      continue;
    }

    findPackageDirs(join(entryPath, 'node_modules'), found);
  }

  return found;
}

/** OneDrive 가 파일을 물고 있으면 EPERM 이 난다 — 몇 번 다시 시도한다. */
function removeWithRetry(targetPath) {
  for (let attempt = 1; attempt <= EPERM_RETRIES; attempt += 1) {
    try {
      rmSync(targetPath, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
      return;
    } catch (error) {
      if (attempt === EPERM_RETRIES) throw error;
    }
  }
}

function directorySizeBytes(targetPath) {
  let total = 0;
  const stack = [targetPath];
  while (stack.length > 0) {
    const current = stack.pop();
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const entryPath = join(current, entry.name);
      if (entry.isDirectory()) stack.push(entryPath);
      else if (entry.isFile()) {
        try {
          total += statSync(entryPath).size;
        } catch {
          /* 지워지는 중일 수 있다 */
        }
      }
    }
  }
  return total;
}

/** kordoc 이 자기 밑에 따로 받은 sharp 사본. 최상위 것은 건드리지 않는다. */
function findKordocNestedDirs() {
  const kordocModules = join(PROJECT_ROOT, 'node_modules', 'kordoc', 'node_modules');
  const found = [];
  for (const name of KORDOC_NESTED_ONLY) {
    const candidate = join(kordocModules, name);
    try {
      statSync(candidate);
      found.push(candidate);
    } catch {
      /* 없으면 지날 일 없다 */
    }
  }
  return found;
}

const targets = [
  ...findPackageDirs(join(PROJECT_ROOT, 'node_modules')),
  ...findKordocNestedDirs(),
];

if (targets.length === 0) {
  console.log('prune-kordoc-optionals: 지울 것 0개 (이미 깨끗하다)');
  process.exit(0);
}

let removed = 0;
let freedBytes = 0;
const failures = [];

for (const target of targets) {
  const size = directorySizeBytes(target);
  try {
    removeWithRetry(target);
    removed += 1;
    freedBytes += size;
    console.log(`  지움 ${target.slice(PROJECT_ROOT.length + 1)} (${(size / 1024 / 1024).toFixed(1)}MB)`);
  } catch (error) {
    failures.push(`${target}: ${error.message}`);
  }
}

console.log(
  `prune-kordoc-optionals: ${removed}/${targets.length} 개 제거 · ${(freedBytes / 1024 / 1024).toFixed(1)}MB 회수`,
);

if (failures.length > 0) {
  console.error(`prune-kordoc-optionals: ${failures.length} 개 실패`);
  for (const failure of failures) console.error(`  ${failure}`);
  process.exit(1);
}
