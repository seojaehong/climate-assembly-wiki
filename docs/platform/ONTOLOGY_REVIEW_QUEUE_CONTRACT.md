# Ontology review queue contract draft

Contract status: draft — explicit user approval required
Migration status: not_created
RLS status: not_applied
Seed status: local_dry_run_only

이 문서는 M3 온톨로지 검수 큐의 저장소 정본 후보다. 현재 Supabase schema를 읽거나 변경하지
않았으며, 아래 table·policy·RPC는 migration 작성 전 검토 대상이다. Canvas seed plan은 DB/API에
접근하지 않고 승인 전 행 형상만 만든다.

## Domain invariants

- 원 발화와 관계를 `source_uid`, `transcript_chunk_id`, `cited_uids`로 보존한다. Canvas 의제처럼
  전사 chunk가 없는 출처만 `transcript_chunk_id = null`을 허용한다.
- `node_kind`, `relation_type`, cluster의 대표 Issue는 source/AI가 선확정하지 않는다. 최초 상태는
  항상 `proposed`이며 사람이 `accepted`, `edited`, `rejected` 중 하나로 결정한다.
- `moderator_metadata`의 confidence/debug 값은 검수 보조 정보이며 시민 공개 결과에서 권위·점수로
  표시하지 않는다.
- `edited`는 사람이 label/text를 바꾼 경우에만 사용한다. `accepted`는 원 source 표현을 유지한다.
- reviewer와 reviewed timestamp는 결정 상태에서 함께 필요하다. `proposed`에는 둘 다 없어야 한다.
- node/relation/cluster 제외와 반려는 삭제하지 않고 출처 ID와 사유를 남긴다.

## Proposed storage model

| Table | Required fields | Constraints |
| --- | --- | --- |
| `ontology_review_batch` | `id uuid`, `org_id uuid`, `session_ids uuid[]`, `source_kind text`, `source_uid text`, `source_sha256 text`, `status text`, timestamps | `(org_id, source_kind, source_uid)` unique; session IDs nonempty/unique; source digest 64 lowercase hex; status `open, completed, archived` |
| `ontology_review_item` | `id text`, `batch_id uuid`, `org_id uuid`, `session_id uuid`, `item_type text`, `source_uid text`, `transcript_chunk_id text null`, `node_kind text null`, `label text null`, `source_text text null`, `text text null`, `relation_type text null`, `source_node_id text null`, `target_node_id text null`, `cited_uids text[]`, `moderator_metadata jsonb`, `review_status text`, `reviewer_id uuid null`, `reviewed_at timestamptz null` | primary key `(batch_id, id)`; `(batch_id, source_uid)` unique; item type `node, relation, cluster`; review status `proposed, accepted, edited, rejected`; `edited` is node-only and keeps immutable `source_text` beside editable `text`; cited UID nonempty/unique; proposed audit fields null; decided audit fields nonnull; item shape check by type |
| `ontology_review_event` | `id uuid`, `item_id text`, `batch_id uuid`, `org_id uuid`, `from_status text`, `to_status text`, `before jsonb`, `after jsonb`, `reviewer_id uuid`, `created_at timestamptz` | append-only; composite FK `(batch_id, item_id)`; item/batch/org must match; event ID unique; update/delete denied |
| `ontology_review_exclusion` | `id uuid`, `batch_id uuid`, `org_id uuid`, `session_id uuid`, `source_kind text`, `source_uid text`, `reason text`, `metadata jsonb`, `created_at timestamptz` | `(batch_id, source_kind, source_uid)` unique; append-only; source ID/reason required; same batch/org/session; update/delete denied |

`org_id`와 item `session_id`는 browser payload를 신뢰하지 않고 batch의 `session_ids`와 권위 있는 session 상위 경로에서
서버가 파생해야 한다. relation의 양 끝 node와 cluster member는 같은 batch·org·session이어야 한다.
Canvas seed는 batch 후보를 `source_kind = canvas_snapshot`,
`source_uid = canvas-snapshot:<snapshotId>`, `source_sha256 = source.snapshotSha256`로 매핑한다.

## RLS policy draft

| Role | Batch | Item | Event | Exclusion |
| --- | --- | --- | --- | --- |
| `anon` | none | none | none | none |
| `authenticated` staff | `org_id = org_of_uid()` select | 같은 org select; 승인된 moderator/HQ만 결정 RPC 사용 | 같은 org select | 같은 org select |
| browser direct write | none | none | none | none |
| approved server seed path | validated batch insert | proposed item bulk insert only | none | excluded provenance insert only |
| review RPC | batch 상태 확인 | compare-and-set decision | same transaction append | none |
| `service_role` | server adapter only | server adapter only | server adapter only | server adapter only |

모든 table은 RLS를 활성화하고 PUBLIC/anon/authenticated의 직접 INSERT/UPDATE/DELETE grant를
회수한다. 정책만 만들고 table grant를 열거나, grant만 열고 RLS를 생략한 상태는 승인하지 않는다.

## RPC draft

### `ontology_review_seed(p_source jsonb, p_items jsonb, p_exclusions jsonb)`

- `SECURITY DEFINER`, 고정 `search_path`, PUBLIC EXECUTE 회수, 승인된 server role만 실행한다.
- source digest·item ID·source UID·citation·동일 org/session 관계와 exclusion source/reason을 전체
  검증한 뒤 한 transaction으로 batch, proposed item, exclusion provenance를 함께 넣는다.
- 동일 source digest 재요청은 기존 batch의 행 전체가 기대 payload와 같을 때만 idempotent success로
  처리한다. 일부 일치나 다른 payload는 충돌로 종료한다.

### `ontology_review_decide(p_item_id text, p_expected_status text, p_decision jsonb)`

- staff membership과 batch org를 DB에서 대조한다.
- 현재 상태가 `p_expected_status`일 때만 item 결정과 event append를 한 transaction으로 처리한다.
- node kind/relation type/edited content와 reviewer·timestamp 불변식을 검증한다.
- accepted relation은 결정된 양 끝 node를, accepted cluster는 같은 cluster의 accepted `Issue` node를
  요구한다.

## Local seed dry-run

```powershell
Set-Location automation
npm.cmd run bridge:canvas-ontology -- --snapshot 'C:\approved\snapshot_42.json' --output-plan 'C:\approved\canvas-review-plan.json'
npm.cmd run bridge:canvas-ontology -- --snapshot 'C:\approved\snapshot_42.json' --seed-plan 'C:\approved\canvas-review-plan.json' --output-seed 'C:\approved\ontology-review-seed.json'
npm.cmd run bridge:canvas-ontology -- --snapshot 'C:\approved\snapshot_42.json' --seed-plan 'C:\approved\canvas-review-plan.json' --verify-seed 'C:\approved\ontology-review-seed.json'
```

두 번째 명령은 먼저 snapshot exact-byte checksum과 review plan canonical checksum을 검증한다.
출력은 `dryRun:true`, `databaseMutationExecuted:false`, `requiresApproval:true`이며 `public/` 아래 직접
출력을 거부한다. node/relation/cluster마다 future DB field와 moderator-only metadata를 만들고,
보관 agenda·비활성 endpoint 관계는 `excluded` provenance에만 남긴다. 세 번째 명령은 seed의
canonical self-checksum과 같은 snapshot·plan에서 재생성한 전체 seed가 일치하는지 확인한다.
self-checksum은 우발 변경 탐지용이며 외부 서명, 작성자 진위, 외부 시점 또는 승인자 인증을 제공하지 않는다.

## Failure modes

| Failure | Required behavior |
| --- | --- |
| snapshot/plan checksum mismatch | seed 파일 생성 전 종료 |
| source UID·node endpoint·cluster member 누락/중복 | DB/API 호출 없이 종료 |
| source가 kind/relation/review 결과를 선확정 | seed 생성 거부 |
| 일부 batch insert | transaction rollback; 부분 queue 금지 |
| 동시 검수 | expected status mismatch로 뒤 요청 거부 |
| item 결정 성공·event 실패 | 같은 transaction rollback |
| realtime payload 오류 | 검수 쓰기 잠금 후 정본 reload |

## Rollback and approval boundary

1. 현재 migration과 DB row는 만들지 않는다.
2. 사용자 승인 뒤 additive forward migration과 별도 rollback SQL을 함께 작성한다.
3. rollback은 seed/review RPC execute를 먼저 회수하고 새 검수를 중지한 뒤 table/policy를 되돌린다.
4. stage에서 forward/seed/role별 negative/review concurrency/rollback/forward를 rehearsing한다.
5. production 적용 전 schema-only backup, migration SHA, 승인자와 실행 run을 기록한다.

M3 완료 승격에는 contract 승인, migration/rollback 리뷰, stage semantic test, 역할별 RLS·RPC 검증이
모두 필요하다. 이 문서와 local seed plan만으로 DB contract 또는 M3 완료를 주장하지 않는다.
