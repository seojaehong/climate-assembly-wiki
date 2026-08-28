import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { sha256Hex, buildSealedPlanFiles } from './ontology-plan';
// CLI가 쓰는 그 함수. 두 경로가 같은 값을 내는지 여기서 못 박는다.
import { sealCanvasOntologyReviewPlan, buildCanvasOntologyReviewPlan } from '../../../automation/canvas-ontology-bridge.mjs';

const snapshot = {
  id: 'snap-1',
  source: 'climate_vote.submission_item',
  taken_at: '2026-08-29T07:00:00.000Z',
  payload: {
    agenda: [
      { id: '0829/t01/k1/i01', session_id: '0829-deliberation', text: '우리는 버스가 부족하다는 것을 확인하였다', status: 'active', kind: 'agenda', group_id: null, parent_id: null },
      { id: '0829/t01/k1/i01/r', session_id: '0829-deliberation', text: '군 노선 시간표를 함께 확인함', status: 'active', kind: 'agenda', group_id: null, parent_id: null },
      { id: '0829/t02/k1/i01', session_id: '0829-deliberation', text: '우리는 요금이 비싸다는 것을 확인하였다', status: 'active', kind: 'agenda', group_id: null, parent_id: null },
    ],
    agenda_link: [
      { id: '0829/t01/k1/i01~r', session_id: '0829-deliberation', source_id: '0829/t01/k1/i01/r', target_id: '0829/t01/k1/i01' },
    ],
  },
};

describe('sha256Hex', () => {
  // 브라우저 Web Crypto와 Node createHash가 같은 값을 내야 계획 체크섬이 맞는다.
  it('matches node createHash', async () => {
    for (const value of ['', 'abc', '한글 문장입니다', JSON.stringify(snapshot)]) {
      expect(await sha256Hex(value)).toBe(createHash('sha256').update(value).digest('hex'));
    }
  });
});

describe('buildSealedPlanFiles', () => {
  it('produces the same sealed plan the CLI produces', async () => {
    const files = await buildSealedPlanFiles(snapshot, '전체', '20260829-1615');
    const fromCli = sealCanvasOntologyReviewPlan({
      plan: buildCanvasOntologyReviewPlan(snapshot),
      snapshotSource: files.snapshot.text,
    });
    // 계획 본문이 한 글자도 다르면 안 된다 — 검수 큐가 체크섬으로 대조한다.
    expect(JSON.parse(files.plan.text)).toEqual(fromCli);
    expect(files.summary.planSha256).toBe(fromCli.integrity.planSha256);
  });

  it('hashes exactly the snapshot text it writes to the file', async () => {
    const files = await buildSealedPlanFiles(snapshot, '전체', '20260829-1615');
    const plan = JSON.parse(files.plan.text);
    expect(plan.integrity.snapshotSha256).toBe(await sha256Hex(files.snapshot.text));
  });

  it('starts every item as proposed and declares itself a dry run', async () => {
    const files = await buildSealedPlanFiles(snapshot, '전체', '20260829-1615');
    const plan = JSON.parse(files.plan.text);
    expect(plan.dryRun).toBe(true);
    expect(plan.databaseMutationExecuted).toBe(false);
    expect(plan.publicGraphWritten).toBe(false);
    expect(plan.requiresHumanReview).toBe(true);
    for (const node of plan.nodes) expect(node.reviewStatus).toBe('proposed');
    for (const rel of plan.relations) expect(rel.reviewStatus).toBe('proposed');
  });

  // 원문이 노드에 그대로 실려야 기각 시 되돌릴 수 있다.
  it('carries every sentence verbatim as sourceText', async () => {
    const files = await buildSealedPlanFiles(snapshot, '전체', '20260829-1615');
    const plan = JSON.parse(files.plan.text);
    expect(plan.nodes.map((n: { sourceText: string }) => n.sourceText)).toEqual([
      '우리는 버스가 부족하다는 것을 확인하였다',
      '군 노선 시간표를 함께 확인함',
      '우리는 요금이 비싸다는 것을 확인하였다',
    ]);
  });

  it('names the two files with the label and stamp', async () => {
    const files = await buildSealedPlanFiles(snapshot, '1분과', '20260829-1615');
    expect(files.snapshot.filename).toBe('온톨로지_1분과_20260829-1615_스냅샷.json');
    expect(files.plan.filename).toBe('온톨로지_1분과_20260829-1615_검수계획.json');
  });

  it('strips characters a filename cannot hold', async () => {
    const files = await buildSealedPlanFiles(snapshot, '1분과/2분과', '20260829-1615');
    expect(files.plan.filename).not.toContain('/');
  });
});
