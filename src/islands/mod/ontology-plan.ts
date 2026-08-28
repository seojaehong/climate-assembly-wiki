// 순수 로직 공유 모듈(.mjs). CLI와 화면이 **같은 코드**를 써야 한다.
import {
  buildCanvasOntologyReviewPlan,
  unsignedPlanOf,
  canonicalPlanForHash,
  attachPlanIntegrity,
} from '../../../automation/canvas-ontology-plan.mjs';

/**
 * 검수 계획을 화면에서 바로 만든다 — 터미널 없이.
 *
 * 지금까지 본부는 스냅샷 파일만 받고, 검수 계획은 사람이 터미널에서
 * `node automation/canvas-ontology-bridge.mjs --snapshot … --output-plan …` 을 쳐서 만들었다.
 * 행사장에서 총괄모더레이터가 할 수 있는 일이 아니다. 같은 순수 로직을 브라우저에서 돌려
 * **스냅샷과 계획 두 파일을 한 번에** 내려받게 한다. 검수 큐는 그 둘을 그대로 받는다.
 *
 * 해시만 환경마다 다르다 — Node는 createHash(동기), 브라우저는 Web Crypto(비동기).
 * 그래서 공유 모듈은 해시를 갖지 않고, 정본 문자열을 만드는 것과 붙이는 것만 제공한다.
 */

/** Web Crypto SHA-256 → 소문자 16진수. Node의 createHash('sha256').digest('hex')와 같은 값. */
export async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export type SealedPlanFiles = {
  snapshot: { filename: string; text: string; mimeType: string };
  plan: { filename: string; text: string; mimeType: string };
  /** 화면에 보여줄 요약 — 노드·관계·묶음 수와 계획 해시 앞자리. */
  summary: { nodes: number; relations: number; clusters: number; planSha256: string };
};

/** 파일명에 못 쓰는 글자를 걷어낸다. */
function safe(segment: string): string {
  return segment.replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, '').trim();
}

/**
 * 스냅샷 → 봉인된 검수 계획. 스냅샷 **원문 문자열**을 그대로 해시하므로,
 * 나중에 검수 큐가 같은 파일인지 대조할 수 있다(한 글자만 달라도 어긋난다).
 *
 * @param snapshot ontology-snapshot.ts 가 만든 스냅샷 객체
 * @param label 파일명에 넣을 이름(예: 「1분과」·「전체」)
 * @param stamp 파일명에 넣을 시각 문자열. 호출부가 넘긴다(여기서 시계를 읽지 않는다).
 */
export async function buildSealedPlanFiles(
  snapshot: unknown,
  label: string,
  stamp: string
): Promise<SealedPlanFiles> {
  // 스냅샷 파일에 담기는 문자열과 해시 대상 문자열이 **반드시 같아야 한다.**
  // 서로 다르면 검수 큐가 「스냅샷이 계획과 맞지 않는다」며 거부한다.
  const snapshotText = JSON.stringify(snapshot, null, 2);
  const draft = buildCanvasOntologyReviewPlan(snapshot);

  const unsigned = unsignedPlanOf(draft);
  const snapshotSha256 = await sha256Hex(snapshotText);
  const planSha256 = await sha256Hex(canonicalPlanForHash(unsigned, snapshotSha256));
  const sealed = attachPlanIntegrity(unsigned, snapshotSha256, planSha256);

  const base = `온톨로지_${safe(label) || '전체'}_${safe(stamp)}`;
  return {
    snapshot: {
      filename: `${base}_스냅샷.json`,
      text: snapshotText,
      mimeType: 'application/json',
    },
    plan: {
      filename: `${base}_검수계획.json`,
      text: JSON.stringify(sealed, null, 2),
      mimeType: 'application/json',
    },
    summary: {
      nodes: sealed.nodes.length,
      relations: sealed.relations.length,
      clusters: sealed.clusters.length,
      planSha256,
    },
  };
}
