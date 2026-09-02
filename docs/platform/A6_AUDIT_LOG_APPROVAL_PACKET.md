# A6 사용자 행위 감사로그 승인 패킷

상태: **production 미적용 초안**
대상 migration: `supabase/migrations/platform_p4_audit_log.sql`
rollback: `supabase/rollbacks/platform_p4_audit_log_BEFORE.sql`

## 목적

플랫폼의 기관·권한·설계·기록·투표·분석·공개 자원이 바뀔 때 같은 PostgreSQL transaction 안에서
감사 이벤트를 남긴다. 애플리케이션이 변경 뒤 별도 로그 RPC를 호출하지 않으므로, 성공한 변경과
감사 이벤트가 분리되지 않는다.

## 기록 범위

다음 15개 table의 INSERT·UPDATE·DELETE를 기록한다.

- 기관·접근: `org`, `membership`, `invitation`
- 설계·운영: `assembly`, `session`, `discussion_topic`, `team`, `design_provisioning_operation`
- 기록·분석·공개: `submission`, `submission_item`, `issue`, `issue_link`, `result_page`
- 투표 설계: `ballot`, `ballot_item`

`ballot_response`와 `votes`는 참가자와 응답의 연결 가능성을 만들지 않기 위해 이 사용자 행위
감사 table에 넣지 않는다. 익명 응답은 기존 집계·snapshot 복구 계약으로 다룬다. 출석은 기존
`attendance_audit_log`가 별도로 보존한다.

감사 이벤트에는 다음 metadata만 저장한다.

- 기관 ID, 이벤트 ID, transaction ID, 발생 시각
- `auth.uid()`와 해당 기관의 현재 staff role. Auth 사용자가 아니면 JWT role 또는 DB 실행 role
- 동작 종류, table 이름, resource ID, 바뀐 column 이름

행의 이전·이후 값, 시민 원문, 투표 응답, 이메일, 초대 token, join code, 비밀번호, Auth token은
저장하지 않는다. UPDATE는 실제 값이 달라진 column 이름만 기록한다.

## 격리·권한

- 감사 table은 RLS를 활성화하고 public·anon·authenticated·authenticator·service_role의 직접
  table 권한을 모두 회수한다.
- 조회 RPC `platform_audit_list(after_id, limit)`는 `org_id`를 받지 않는다.
  `auth.uid()`와 P1C 선택 context에서 `org_of_uid()`가 기관을 파생한다.
- 선택 기관의 active `org_admin|operator|hq`만 조회할 수 있다. `facilitator`와 익명 사용자는 거부한다.
- 한 번에 1~500건을 ID cursor 방식으로 최신순 조회한다. 응답에는 `org_id`도 포함하지 않는다.
- 기관 화면의 기록 뷰는 메모리에서만 페이지를 합치며 브라우저 저장소를 사용하지 않는다.
  CSV는 spreadsheet formula injection을 막고 화면에 불러온 metadata만 내보낸다.

## 적용 전 필수 조건

아래 항목은 각각 현재상태 증거가 있어야 한다. 하나라도 없으면 적용하지 않는다.

1. P1→P1C→P2→P3 migration이 대상 DB에 적용되어 있다.
2. A2 backfill 뒤 감사 대상의 모든 직접 `org_id`가 채워져 있다. migration preflight가 NULL 행을
   table별로 세어 하나라도 있으면 전체 transaction을 실패시킨다.
3. P1C staff Auth·membership·선택 기관 context와 schema USAGE가 활성화되어 있다.
4. 기관이 감사로그 보존기간·접근 책임자·off-DB export 위치·폐기 승인 절차를 확정했다.
5. 적용 창, 실행자, 승인자, rollback 책임자와 incident 연락 경로가 기록되어 있다.

## 적용·검증 순서

이 문서는 적용 승인이 아니다. 별도 production DB schema 변경 승인을 받은 실행자가 다음 순서로
진행한다.

1. count-only A2 readiness와 대상 11개 직접 `org_id` NULL 건수를 기록한다.
2. transaction 안에서 `platform_p4_audit_log.sql`을 적용한다.
3. 객체 owner, 함수 `SECURITY DEFINER`·고정 `search_path`·`row_security=off`, 15개 capture trigger,
   table/RPC ACL과 immutable trigger를 읽기 전용으로 확인한다.
4. 별도 시험 기관에서 insert→update→delete를 실행해 metadata만 같은 transaction으로 남는지 확인한다.
5. 서로 다른 두 기관 계정과 facilitator 계정으로 allow/deny를 확인한다.
6. 첫 off-DB append-only export를 만들고 건수·최소/최대 event ID·checksum을 운영 기록에 남긴다.

CI의 PostgreSQL 16 rehearsal은 `supabase/verify/platform_audit_test.sql`로 문법·함수 본문·owner와
고정 함수 설정·15개 BEFORE trigger, table/column/identity-sequence 직접 접근 차단, 자식 resource의
기관 파생, cross-org 이동 거부, 변경 column, 행 값 비노출, cursor pagination, 기관 격리,
facilitator 거부, 변조 거부와 populated rollback 거부를 검사한다. 이는 production 적용 증거가 아니다.

## rollback·보존

감사 table에 한 행이라도 있으면 rollback은 `platform_audit_rollback_requires_retention_plan`으로
중단한다. 운영 rollback 전에 반드시 승인된 보존 위치로 export하고 checksum과 행 범위를 대조한 뒤,
기관의 보존·폐기 결정에 따라 별도 데이터 계획을 수행해야 한다. migration rollback 파일은 감사
데이터를 자동 삭제하거나 우회하지 않는다.

## 알려진 경계

- 기존 join-code·HQ capability RPC는 Supabase Auth 사용자 ID가 없으므로 actor는 `anon` 또는 해당
  JWT/DB role로 기록될 수 있다. named actor 증거는 A1 staff Auth 전환 뒤에 완성된다.
- provider PITR/WAL 설정과 production platform snapshot 활성화는 별도 A6 운영 통제다.
- production DB/Auth/GRANT/data 변경은 이 패킷 작성으로 실행되지 않았다.

## 승인 기록

| 항목 | 값 |
|---|---|
| migration 적용 승인 | 미승인 |
| staff RPC 활성 승인 | 미승인 |
| 감사로그 보존기간 | 기관 결정 대기 |
| off-DB export 위치 | 기관 결정 대기 |
| production DB mutation | 0건 |
