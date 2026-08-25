import { createHmac } from 'node:crypto';
import { writeFileSync } from 'node:fs';

const outputPath = process.argv[2];
const auditKey = process.env.SNAPSHOT_AUDIT_HMAC_KEY;
if (!outputPath) throw new Error('snapshot restore fixture output path is required');
if (typeof auditKey !== 'string' || auditKey.length < 32) {
  throw new Error('snapshot restore fixture audit key is invalid');
}

const ids = {
  org: '00000000-0000-4000-8000-000000000001',
  topic: '00000000-0000-4000-8000-000000000011',
  team: '00000000-0000-4000-8000-000000000021',
  submission: '00000000-0000-4000-8000-000000000031',
  item: '00000000-0000-4000-8000-000000000041',
  issue: '00000000-0000-4000-8000-000000000051',
  session: '00000000-0000-4000-8000-000000000061',
  ballot: '00000000-0000-4000-8000-000000000081',
  ballotItem: '00000000-0000-4000-8000-000000000091',
  response: '00000000-0000-4000-8000-0000000000a1',
  result: '00000000-0000-4000-8000-0000000000b1',
};
const timestamp = '2026-08-26T00:00:00.000Z';
const payload = {
  submission: [{
    id: ids.submission,
    topic_id: ids.topic,
    team_id: ids.team,
    status: 'final',
    finalized_at: timestamp,
    finalized_by: 'restore-rehearsal',
    archived_at: null,
    created_at: timestamp,
    updated_at: timestamp,
    org_id: ids.org,
  }],
  submission_item: [{
    id: ids.item,
    submission_id: ids.submission,
    ordinal: 1,
    kind: 'core',
    content: 'Synthetic restore rehearsal statement',
    rationale: null,
    provenance: {},
    created_at: timestamp,
  }],
  issue: [{
    id: ids.issue,
    topic_id: ids.topic,
    label: 'Synthetic restore issue',
    stance: 'neutral',
    frequency_class: 'mixed',
    summary: null,
    origin: 'human',
    review_status: 'draft',
    reviewed_by: null,
    reviewed_at: null,
    archived_at: null,
    org_id: ids.org,
    created_at: timestamp,
  }],
  issue_link: [{
    issue_id: ids.issue,
    item_id: ids.item,
    cluster_id: null,
    linked_by: 'human',
    created_at: timestamp,
  }],
  result_page: [{
    id: ids.result,
    scope: 'topic',
    scope_id: ids.topic,
    token: 'restore-result-token',
    title: 'Synthetic restore result',
    body: {},
    published_at: null,
    published_by: null,
    archived_at: null,
    org_id: ids.org,
    created_at: timestamp,
  }],
  ballot: [{
    id: ids.ballot,
    session_id: ids.session,
    title: 'Synthetic restore ballot',
    instructions: null,
    status: 'open',
    token: 'restore-ballot-token',
    created_by: 'restore-rehearsal',
    published_at: null,
    archived_at: null,
    created_at: timestamp,
    subgroup: null,
    org_id: ids.org,
  }],
  ballot_item: [{
    id: ids.ballotItem,
    ballot_id: ids.ballot,
    ordinal: 1,
    statement: 'Synthetic restore ballot item',
    description: null,
    scale: 5,
    required: true,
  }],
  ballot_response: [{
    id: ids.response,
    ballot_id: ids.ballot,
    client_id: 'restore-client-0001',
    answers: { [ids.ballotItem]: 3 },
    submitted_at: timestamp,
    org_id: ids.org,
  }],
  counts: { submission: 1, issue: 1, issue_link: 1, result_page: 1, ballot: 1 },
};
const platform = { id: 77, source: 'platform', payload };
const audit = {
  schemaVersion: 1,
  event: 'platform_snapshot_export',
  exportedAt: timestamp,
  repository: 'seojaehong/climate-assembly-wiki',
  runId: 'restore-rehearsal-fixture',
  commitSha: '0000000000000000000000000000000000000000',
  workflowRef: 'local/snapshot-restore-rehearsal',
  keyId: 'snapshot-restore-test-key',
  snapshotId: platform.id,
};
const digest = createHmac('sha256', auditKey).update(JSON.stringify({ ...audit, platform })).digest('hex');
writeFileSync(outputPath, JSON.stringify({
  platform,
  audit: {
    ...audit,
    integrity: { algorithm: 'hmac-sha256', target: 'platform+provenance', digest },
  },
}, null, 2), { encoding: 'utf8', flag: 'wx' });
