/**
 * 배포 감지 — **열어 둔 화면이 옛 코드를 돌고 있는가.**
 *
 * 2026-08-29 행사에서 통짜 6건이 들어온 유력 원인이다(근거등급 B). 조는 오후 초입에
 * `/r/<조>` 를 열어 탭을 켜 둔 채 한글·워드에서 작업하다가 16시대에 붙여넣었다.
 * 그 사이 14:50 에 줄 분해를 배포했지만 **이미 열려 있는 화면에는 새 코드가 내려가지
 * 않는다.** 그리고 우리 화면에는 그 사실을 알리는 장치가 아예 없었다.
 *
 * 방식 — 번들에 박아 둔 커밋(`__DEPLOY_REVISION__`, astro.config.mjs 의 vite.define)과
 * 서버가 지금 내주는 `/deployment-revision.json` 을 견준다.
 *
 * ★ 「처음 받아온 값을 기준으로 삼는」 방식은 쓰지 않는다. 조 콘솔은 탭을 옮길 때마다
 *   이 구역이 다시 마운트된다 — 14:00 에 연 화면이 16:00 에 산출물 탭을 처음 누르면
 *   첫 조회가 **새 버전**을 돌려주고, 그걸 기준으로 잡으면 낡은 번들이 「최신」이 된다.
 *   고치려는 그 상황이 그대로 통과한다. 기준은 반드시 **돌고 있는 번들 자신**이어야 한다.
 */

export const REVISION_MANIFEST_PATH = '/deployment-revision.json';

/** 확인 주기. 조가 두 시간 켜 두는 화면이라 짧을 필요는 없다. */
export const REVISION_POLL_MS = 90_000;

const FULL_COMMIT = /^[0-9a-f]{40}$/;

/**
 * 번들에 박힌 커밋. 빌드 때 astro.config.mjs 가 넣는다(CF_PAGES_COMMIT_SHA →
 * GITHUB_SHA → git rev-parse HEAD — postbuild 매니페스트와 같은 해석 순서).
 * 못 넣었으면 빈 문자열이고, 그러면 감지 자체를 접는다(엉뚱한 띠를 띄우느니 없는 편이 낫다).
 */
export function runningRevision(): string | null {
  const baked = typeof __DEPLOY_REVISION__ === 'string' ? __DEPLOY_REVISION__ : '';
  return FULL_COMMIT.test(baked) ? baked : null;
}

/**
 * 매니페스트 해석. `schemaVersion:1` + 40자 커밋만 받는다.
 * dev 서버·정적 호스팅 오류는 HTML 이나 404 를 돌려주므로 여기서 전부 null 이 된다.
 */
export function parseRevisionManifest(raw: unknown): string | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const m = raw as { schemaVersion?: unknown; sourceCommit?: unknown };
  if (m.schemaVersion !== 1) return null;
  if (typeof m.sourceCommit !== 'string') return null;
  const commit = m.sourceCommit.trim().toLowerCase();
  return FULL_COMMIT.test(commit) ? commit : null;
}

/**
 * 띠를 띄울 것인가. **둘 다 확실할 때만** true — 모르면 조용히 있는다.
 * 조가 입력 중인 화면에 근거 없는 「새로고침하세요」를 띄우는 쪽이 더 나쁘다.
 */
export function isStaleBundle(running: string | null, served: string | null): boolean {
  if (!running || !served) return false;
  return running !== served;
}

/** 매니페스트를 한 번 읽는다. 실패는 전부 null — 감지는 어디까지나 부가 기능이다. */
export async function fetchServedRevision(
  fetchImpl: typeof fetch = fetch,
  path: string = REVISION_MANIFEST_PATH,
): Promise<string | null> {
  try {
    // no-store — `public/_headers` 가 서버 쪽에도 같은 것을 걸어 두었다.
    const res = await fetchImpl(path, { cache: 'no-store', headers: { accept: 'application/json' } });
    if (!res.ok) return null;
    return parseRevisionManifest(await res.json());
  } catch {
    return null;
  }
}
