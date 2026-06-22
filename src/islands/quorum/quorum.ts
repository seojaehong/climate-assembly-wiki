/**
 * quorum.ts — 정족수 순수 함수 모듈
 *
 * 규칙 (2026 기후시민회의 운영규정 기준):
 *   - 회의 성립: 재적 과반수 출석 (출석 M > 재적 N / 2)
 *   - 의결(채택): 출석 2/3 이상 찬성 (찬성 V ≥ ⌈2M/3⌉)
 *   - 기획단·분과·전체회의 모두 동일 기준
 *   - 75% 기준은 2026-06-14 부결된 수정안 — 사용 금지
 *
 * 수식 근거:
 *   - 성립 임계: Math.floor(N/2) + 1  ← "과반수(majority)" = N/2 초과 → 최솟값
 *     (⌈N/2⌉+1 은 홀수 N에서 오버카운트. N=9: floor(9/2)+1=5 ✓, ceil(9/2)+1=6 ✗)
 *   - 성립 판정: 2*M > N  (부동소수점 없이 정확한 정수 비교)
 *   - 의결 임계: Math.floor((2*M + 2) / 3)  ← ⌈2M/3⌉ 의 정수 등가식
 *     (M=3→2, M=4→3, M=5→4, M=6→4, M=9→6, M=10→7 검증됨)
 */

export interface QuorumInput {
  /** 재적(정원) N — 회의 종류별 전원 수 */
  enrolled: number;
  /** 출석 M — 실제 참석 수 */
  present: number;
  /** 찬성 V — 가결 여부 계산 시에만; undefined = 투표 전 */
  yeas?: number;
}

export interface QuorumResult {
  /** 회의 성립 여부 (출석 > 재적/2) */
  established: boolean;
  /** 성립에 필요한 최소 출석 수 (= floor(N/2)+1) */
  establishThreshold: number;
  /** 성립까지 부족한 인원 (성립 시 0) */
  shortfall: number;
  /** 가결에 필요한 최소 찬성 수 (= ceil(2*M/3), 미성립 시 null) */
  decisionThreshold: number | null;
  /** 가결 여부 (yeas 제공 + 성립 시에만 계산; 그 외 null) */
  passed: boolean | null;
  /** 성립까지 출석 진행률 0–1 */
  establishProgress: number;
  /** 의결까지 찬성 진행률 0–1 (yeas 없거나 미성립 시 null) */
  decisionProgress: number | null;
}

/**
 * computeQuorum — 정족수 계산 순수 함수
 *
 * @throws RangeError — N < 1, M < 0, V < 0, M > N
 */
export function computeQuorum(input: QuorumInput): QuorumResult {
  const { enrolled: N, present: M, yeas: V } = input;

  if (!Number.isInteger(N) || N < 1) throw new RangeError(`enrolled must be ≥ 1, got ${N}`);
  if (!Number.isInteger(M) || M < 0) throw new RangeError(`present must be ≥ 0, got ${M}`);
  if (M > N) throw new RangeError(`present (${M}) > enrolled (${N})`);
  if (V !== undefined && (!Number.isInteger(V) || V < 0)) throw new RangeError(`yeas must be ≥ 0, got ${V}`);
  if (V !== undefined && V > M) throw new RangeError(`yeas (${V}) > present (${M})`);

  // 성립 임계: floor(N/2) + 1 = "N보다 큰 최솟값" 의 정수 해
  const establishThreshold = Math.floor(N / 2) + 1;

  // 성립 판정: 2*M > N (부동소수점 무관 정수 비교)
  const established = 2 * M > N;

  // 부족 인원
  const shortfall = established ? 0 : establishThreshold - M;

  // 의결 임계: ⌈2M/3⌉ = floor((2M+2)/3)
  const decisionThreshold = established ? Math.floor((2 * M + 2) / 3) : null;

  // 가결 여부
  const passed = (established && V !== undefined && decisionThreshold !== null)
    ? V >= decisionThreshold
    : null;

  // 진행률
  const establishProgress = Math.min(M / establishThreshold, 1);
  const decisionProgress = (established && V !== undefined && decisionThreshold !== null)
    ? Math.min(V / decisionThreshold, 1)
    : null;

  return {
    established,
    establishThreshold,
    shortfall,
    decisionThreshold,
    passed,
    establishProgress,
    decisionProgress,
  };
}
