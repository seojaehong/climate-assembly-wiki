/**
 * 8.29 조별 산출물 → 온톨로지 검수 플랜 어댑터.
 *
 * 이미 있는 캔버스 온톨로지 파이프라인(canvas-ontology-bridge.mjs)을 그대로 쓰기 위해,
 * 조가 쓴 줄(climate_vote.submission_item)을 그 브리지가 먹는 스냅샷 모양으로 바꾼다.
 * 온톨로지 로직을 새로 만들지 않는다 — 입구만 붙인다.
 *
 * ── 왜 이 형태인가 (회의자료 260811이 규정한 것) ──
 *   「조별 결과 임의 통합 등은 하지 말 것」(분과 총괄모더레이터 주의사항)
 *   「원 발언과 결과물 추적 가능하게 기록」 / 「임의 변경, 소수의견 삭제」(기록 모더레이터)
 *   「총괄모더레이터 잠정 구조화 제시 (문장 신작 금지) → 시민의 검토·수정」(16:25 분과 공유)
 *
 * 이 어댑터가 지키는 것
 *   1. 조가 쓴 한 줄 = 노드 하나. 합치지 않는다. 노드 수 = 항목 수, 언제나.
 *   2. sourceText에 원문을 그대로 싣는다. 브리지는 reject 시 label/text를 sourceText로 되돌린다.
 *   3. **묶음을 만들지 않는다** — group_id를 비워 보낸다. AI가 미리 묶어놓고 시작하면
 *      그 묶음이 기정사실이 된다. 묶기는 검수 단계에서 사람이 한다.
 *   4. 근거(rationale)는 본문에 붙여 쓰지 않고 **별도 노드 + 링크**로 둔다.
 *      한 줄로 이어붙이면 시민이 쓴 두 문장이 하나로 뭉개진다.
 *   5. 조·꼭지·순번을 노드 id에 실어 되짚을 수 있게 한다(id가 곧 출처).
 *
 * id 규격  `0829/t{조순번 2자리}/k{꼭지순번}/i{항목순번}` (+ 근거는 `/r`)
 */

/** 노드 id에서 출처를 되짚는다. 4범주 구조화가 「몇 개 조인가」를 세려면 이게 필요하다. */
export function parseSubmissionNodeId(id) {
  const m = /^0829\/t(\d{2})\/k(\d)\/i(\d{2})(\/r)?$/.exec(String(id));
  if (!m) return null;
  return {
    teamOrdinal: Number(m[1]),
    topicOrdinal: Number(m[2]),
    itemOrdinal: Number(m[3]),
    isRationale: Boolean(m[4]),
  };
}

export function submissionNodeId({ teamOrdinal, topicOrdinal, itemOrdinal, isRationale = false }) {
  const id = `0829/t${String(teamOrdinal).padStart(2, '0')}/k${topicOrdinal}/i${String(itemOrdinal).padStart(2, '0')}`;
  return isRationale ? `${id}/r` : id;
}

/**
 * hq_submissions 행 배열 → 캔버스 스냅샷 모양.
 *
 * @param rows hq_submissions RPC 반환 행(또는 같은 모양). 내용이 빈 행은 조 자리 표시일 뿐이라 버린다.
 * @param opts.sessionSlug 스냅샷 session_id로 쓸 값
 * @param opts.takenAt ISO 시각 — 호출부가 넘긴다(스냅샷은 재현 가능해야 하므로 여기서 시계를 읽지 않는다)
 */
export function submissionsToCanvasSnapshot(rows, { sessionSlug = '0829-deliberation', takenAt } = {}) {
  if (!Array.isArray(rows)) throw new Error('submissions rows must be an array');
  if (!takenAt) throw new Error('takenAt is required — 스냅샷 시각은 호출부가 정한다');

  const teamOrdinals = new Map();
  const orderedTeams = [...new Set(rows.map((r) => r.team_name))].sort((a, b) => {
    const pa = /^(\d+)분과 (\d+)조$/.exec(a);
    const pb = /^(\d+)분과 (\d+)조$/.exec(b);
    if (!pa || !pb) return String(a).localeCompare(String(b));
    return Number(pa[1]) - Number(pb[1]) || Number(pa[2]) - Number(pb[2]);
  });
  orderedTeams.forEach((name, index) => teamOrdinals.set(name, index + 1));

  const agenda = [];
  const agenda_link = [];

  for (const row of rows) {
    const content = String(row.item_content ?? '').trim();
    if (!content) continue; // 아직 아무것도 안 쓴 조 — 자리만 있는 행
    const base = {
      teamOrdinal: teamOrdinals.get(row.team_name),
      topicOrdinal: Number(row.topic_ordinal),
      itemOrdinal: Number(row.item_ordinal),
    };
    const id = submissionNodeId(base);
    agenda.push({
      id,
      session_id: sessionSlug,
      text: content,
      status: 'active',
      kind: 'agenda',
      // ⚠️ group_id를 채우지 않는다. 미리 묶어 보내면 그 묶음이 기정사실이 된다.
      group_id: null,
      parent_id: null,
    });

    const rationale = String(row.item_rationale ?? '').trim();
    if (!rationale) continue;
    const rid = submissionNodeId({ ...base, isRationale: true });
    agenda.push({
      id: rid,
      session_id: sessionSlug,
      text: rationale,
      status: 'active',
      kind: 'agenda',
      group_id: null,
      parent_id: null,
    });
    // 본문 ← 근거. 관계 이름은 비워 보낸다(브리지가 후보 전체를 달아준다) —
    // 「이건 근거다」라고 단정하는 것도 판단이며, 그 판단은 사람이 한다.
    agenda_link.push({
      id: `${id}~r`,
      session_id: sessionSlug,
      source_id: rid,
      target_id: id,
    });
  }

  if (agenda.length === 0) throw new Error('조가 쓴 항목이 하나도 없다 — 스냅샷을 만들 수 없다');

  return {
    id: `0829-submissions-${takenAt}`,
    source: 'climate_vote.submission_item',
    taken_at: takenAt,
    payload: { agenda, agenda_link },
  };
}

/**
 * 4범주 잠정 구조화의 「공통 / 차이」 판정 재료.
 *
 * 회의자료 「단순 합산하지 말고 네 범주로 구조화」의 <1>공통 <2>차이는 결국
 * **한 묶음에 몇 개 조가 들어 있는가**로 갈린다. 묶음 자체는 사람이 만들지만,
 * 만들어진 묶음이 공통인지 차이인지 세는 것은 기계가 해도 판단이 아니다(세기일 뿐).
 *
 * @param memberNodeIds 묶음에 든 노드 id들
 * @returns { teams: number[], category: '공통' | '차이' } — 조가 2개 이상이면 공통
 */
export function clusterSpread(memberNodeIds) {
  const teams = [...new Set(
    memberNodeIds
      .map((id) => parseSubmissionNodeId(String(id).replace(/^canvas-agenda:/, '')))
      .filter(Boolean)
      .map((parsed) => parsed.teamOrdinal)
  )].sort((a, b) => a - b);
  return { teams, category: teams.length >= 2 ? '공통' : '차이' };
}

/**
 * 보존 불변식 — 「모이되 모으지 않는다」를 숫자로 증명한다.
 * 조가 쓴 항목 수와 플랜의 노드 수가 같아야 하고, 어떤 검수 결정도 이 수를 줄이지 못한다.
 */
export function preservationCheck({ submittedCount, plan }) {
  const contentNodes = plan.nodes.filter((node) => !String(node.sourceAgendaId).endsWith('/r'));
  return {
    submitted: submittedCount,
    nodes: contentNodes.length,
    deleted: submittedCount - contentNodes.length,
    ok: contentNodes.length === submittedCount,
  };
}
