/**
 * 배포 감지 드라이런 — **열어 둔 화면이 옛 코드인 것을 실제로 잡는가.** 쓰기 없음.
 *
 *   node scripts/verify-stale-bundle.mjs                      (빌드 산출물 + 판정 규칙)
 *   node scripts/verify-stale-bundle.mjs --base https://climate-assembly.org
 *
 * 무엇을 재는가 — 프록시가 아니라 산출물을 잰다
 *   ① 빌드된 번들 안에 **이 빌드의 커밋 40자가 실제로 박혀 있는가**(dist/_astro/*.js 를 뒤진다).
 *      박히지 않으면 감지는 조용히 꺼진다 — 이게 이 수정에서 가장 조용히 깨질 수 있는 지점이다.
 *   ② 그 값이 postbuild 가 쓴 `dist/deployment-revision.json` 과 **같은가**.
 *      같아야 정상 배포에서 「최신인데 낡았다」는 거짓 경보가 안 뜬다.
 *   ③ 매니페스트를 한 글자만 바꾸면 **낡음으로 판정되는가**(그리고 같으면 안 뜨는가).
 *   ④ dev 서버·404·schema 가 다른 응답에는 **뜨지 않는가**(모르면 조용히 있는다).
 *   ⑤ (--base 를 주면) 실제 배포된 매니페스트를 읽어 같은 판정을 돌린다. GET 뿐이다.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const DIST = join(ROOT, 'dist');
const argv = process.argv.slice(2);
const arg = (n, d = null) => {
  const i = argv.indexOf(`--${n}`);
  return i === -1 ? d : argv[i + 1];
};
const BASE = arg('base', null);

const FULL_COMMIT = /^[0-9a-f]{40}$/;

/** `src/islands/mod/deploy-revision.ts` 의 판정 규칙과 같은 것. */
const parseRevisionManifest = (raw) => {
  if (typeof raw !== 'object' || raw === null) return null;
  if (raw.schemaVersion !== 1) return null;
  if (typeof raw.sourceCommit !== 'string') return null;
  const c = raw.sourceCommit.trim().toLowerCase();
  return FULL_COMMIT.test(c) ? c : null;
};
const isStaleBundle = (running, served) => (!running || !served ? false : running !== served);

let pass = 0;
let fail = 0;
const check = (label, fn) => {
  try {
    const d = fn();
    pass += 1;
    console.log(`  PASS  ${label}${d ? ` — ${d}` : ''}`);
  } catch (e) {
    fail += 1;
    console.log(`  FAIL  ${label} — ${e.message}`);
  }
};
const checkAsync = async (label, fn) => {
  try {
    const d = await fn();
    pass += 1;
    console.log(`  PASS  ${label}${d ? ` — ${d}` : ''}`);
  } catch (e) {
    fail += 1;
    console.log(`  FAIL  ${label} — ${e.message}`);
  }
};
const must = (c, m) => {
  if (!c) throw new Error(m);
};

console.log('\n배포 감지 드라이런 · 쓰기 없음\n');

// ── ① · ② 빌드 산출물 ────────────────────────────────────────
let bakedRevision = null;
let manifestRevision = null;

if (!existsSync(DIST)) {
  console.log('  SKIP  dist/ 가 없다 — 먼저 `npx astro build` (Node 20). 판정 규칙만 잰다.\n');
} else {
  check('postbuild 매니페스트가 있고 해석된다', () => {
    const raw = JSON.parse(readFileSync(join(DIST, 'deployment-revision.json'), 'utf8'));
    manifestRevision = parseRevisionManifest(raw);
    must(manifestRevision, `해석 실패: ${JSON.stringify(raw).slice(0, 80)}`);
    return manifestRevision.slice(0, 12);
  });

  check('★ 번들 안에 이 빌드의 커밋이 실제로 박혀 있다', () => {
    must(manifestRevision, '매니페스트를 못 읽어 대조할 수 없다');
    const files = [];
    const walk = (dir) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (name.endsWith('.js')) files.push(p);
      }
    };
    walk(join(DIST, '_astro'));
    const hits = files.filter((f) => readFileSync(f, 'utf8').includes(manifestRevision));
    must(
      hits.length > 0,
      `${files.length}개 js 어디에도 커밋 ${manifestRevision.slice(0, 12)} 이 없다 — vite.define 이 안 먹었다(감지가 조용히 꺼진다)`,
    );
    bakedRevision = manifestRevision;
    return `js ${files.length}개 중 ${hits.length}개에 박힘`;
  });

  check('★ 번들의 커밋 = 매니페스트의 커밋 (정상 배포에서 거짓 경보 없음)', () => {
    must(bakedRevision && manifestRevision, '둘 중 하나를 못 읽었다');
    must(!isStaleBundle(bakedRevision, manifestRevision), '같은 배포인데 낡음으로 판정된다');
    return '판정: 최신';
  });
}

// ── ③ 버전이 바뀌면 잡는가 ───────────────────────────────────
const A = 'a'.repeat(40);
const B = `${'a'.repeat(39)}b`; // 마지막 한 글자만 다르다

check('★ 배포가 바뀌면 낡음으로 잡는다', () => {
  must(isStaleBundle(A, B), '한 글자 다른 커밋을 못 잡았다');
  return `${A.slice(0, 8)}… vs ${B.slice(0, 8)}…b → 띠 표시`;
});

check('같은 배포면 뜨지 않는다', () => {
  must(!isStaleBundle(A, A), '같은데 떴다');
  return null;
});

check('★ 8.29 시나리오 — 14:50 배포 전 번들이 16:00에 확인하면 잡힌다', () => {
  // 조가 오후 초입에 연 탭(옛 커밋) · 서버는 14:50 배포(새 커밋)
  const openedBefore = '267d5be'.padEnd(40, '0');
  const deployedAt1450 = '616a688'.padEnd(40, '0');
  must(isStaleBundle(openedBefore, deployedAt1450), '이 상황을 못 잡으면 이 수정은 의미가 없다');
  // ★ 「처음 받아온 값을 기준」으로 삼았다면 기준이 새 커밋이 되어 못 잡는다.
  must(!isStaleBundle(deployedAt1450, deployedAt1450), '기준을 서버 값으로 잡으면 못 잡는다(반례)');
  return '탭 유지 → 배포 → 복귀 = 잡힘';
});

// ── ④ 모르면 조용히 ──────────────────────────────────────────
check('dev 서버가 HTML 을 돌려주면 뜨지 않는다', () => {
  must(parseRevisionManifest('<!doctype html>') === null, 'HTML 을 커밋으로 읽었다');
  must(!isStaleBundle(A, parseRevisionManifest('<!doctype html>')), '떴다');
  return null;
});

check('schema 가 다르거나 커밋이 짧으면 뜨지 않는다', () => {
  must(parseRevisionManifest({ schemaVersion: 2, sourceCommit: A }) === null, 'schema 2 를 받았다');
  must(parseRevisionManifest({ schemaVersion: 1, sourceCommit: 'abc' }) === null, '짧은 커밋을 받았다');
  must(parseRevisionManifest({ schemaVersion: 1 }) === null, 'sourceCommit 없이 받았다');
  return '3가지 다 무시';
});

check('번들에 커밋이 안 박혔으면(=감지 불가) 절대 뜨지 않는다', () => {
  must(!isStaleBundle(null, A), '기준 없이 떴다');
  must(!isStaleBundle('', A), '빈 값으로 떴다');
  return null;
});

check('★ 화면 코드가 이 규칙과 같다', () => {
  const ts = readFileSync(resolve(ROOT, 'src/islands/mod/deploy-revision.ts'), 'utf8');
  must(/schemaVersion !== 1/.test(ts), 'schemaVersion 검사가 없다');
  must(/\^\[0-9a-f\]\{40\}\$/.test(ts), '40자 커밋 검사가 없다');
  must(/if \(!running \|\| !served\) return false/.test(ts), '모를 때 조용히 있는 규칙이 없다');
  const panel = readFileSync(resolve(ROOT, 'src/islands/mod/SubmissionPanel.tsx'), 'utf8');
  must(/visibilitychange/.test(panel), '탭 복귀 시 재확인이 없다 — 8.29 동선을 놓친다');
  must(/suppressUnloadGuard = true/.test(panel), '새로고침 버튼이 이탈 경고를 풀지 않는다');
  return 'schema · 40자 · 무지시 침묵 · 탭 복귀 · 이탈 경고 해제';
});

// ── ⑤ 실제 배포 (선택) ───────────────────────────────────────
if (BASE) {
  await checkAsync(`실제 배포 매니페스트를 읽는다 (${BASE})`, async () => {
    const res = await fetch(`${BASE}/deployment-revision.json`, { cache: 'no-store' });
    must(res.ok, `HTTP ${res.status}`);
    const served = parseRevisionManifest(await res.json());
    must(served, '해석 실패');
    must(!isStaleBundle(served, served), '자기 자신과 달랐다');
    must(isStaleBundle(`${served.slice(0, 39)}${served[39] === 'a' ? 'b' : 'a'}`, served), '한 글자 바꿔도 안 잡혔다');
    return `${served.slice(0, 12)} · 같으면 침묵 · 한 글자 다르면 띠`;
  });
}

console.log(`\n결과: ${pass} PASS · ${fail} FAIL  (${pass}/${pass + fail})\n`);
process.exit(fail === 0 ? 0 : 1);
