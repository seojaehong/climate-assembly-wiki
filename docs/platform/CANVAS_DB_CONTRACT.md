# Canvas DB contract draft

Contract status: draft — explicit user approval required
Rollback status: not_rehearsed
Failure-mode status: source_verified_only

이 문서는 M1의 저장소 정본 후보이며 현재 DB에 적용된 계약이나 승인된 migration이 아니다.
`session`, `participant`, `agenda`, `agenda_link`, `agenda_edit_log`, `rounds`, `attendance`의
실제 live 스키마를 읽거나 변경하지 않았고, 아래 정책은 migration 작성 전 검토 대상이다.

## Policy matrix

| Table | Browser role | Operations | Required boundary |
| --- | --- | --- | --- |
| `session` | anon, authenticated | select | 공개 join은 제한된 session lookup만, staff는 `org_of_uid()` 조직 일치 |
| `participant` | anon | insert, update | session과 참여 token 범위, 다른 조직·token 행 접근 금지 |
| `agenda` | anon | insert | 선택 session 범위의 신규 제출만 허용 |
| `agenda` | authenticated | select, insert, update | `org_id = org_of_uid()` 및 session 상위 조직 일치 |
| `agenda_link` | authenticated | select, insert, delete | 양 끝 agenda와 session·org가 동일해야 함 |
| `agenda_edit_log` | authenticated | select, insert | 대상 agenda와 동일 org, append-only |
| `rounds` | authenticated | select, insert | 선택 session과 동일 org |
| `attendance` | none | none | anon/authenticated table 접근 회수, 허용 RPC만 실행 |

정책은 table GRANT와 RLS를 함께 요구한다. `USING (true)` 또는 `WITH CHECK (true)`는 완전 계약으로
인정하지 않는다. attendance RPC는 `SECURITY DEFINER`, 고정 `search_path`, PUBLIC EXECUTE 회수,
허용 role 명시 grant가 모두 있어야 한다.

## Write-path failure modes

| Path | Table | Failure handling |
| --- | --- | --- |
| 참여 등록 | `participant` | 오류를 화면에 노출하고 의제 insert를 진행하지 않음 |
| 시민 의제 추가 | `agenda` | 오류를 화면에 노출, 응답 불명확 시 중복 insert 금지 |
| 진행자 의제/실천과제 추가 | `agenda` | stable ID 재조회가 기대 payload와 같을 때만 commit 인정 |
| 이동·분류·부모·보관 | `agenda` | 응답 불명확 시 재실행하지 않고 snapshot reconcile |
| 연결/해제 | `agenda_link` | insert는 stable ID 재조회, delete는 snapshot reconcile |
| 본문 편집 | `agenda`, `agenda_edit_log` | stale-before 차단, audit stable ID 재시도, 비원자 경계 노출 |
| 투표 생성 | `rounds` | stable full UUID 재조회가 기대 payload와 같을 때만 URL 노출 |
| 출석 변경 | attendance RPC | RPC 오류 전파, 직접 table 쓰기 금지 |

위 failure-mode 표는 현재 source hardening을 설명한다. 정책과 migration을 승인하지 않았으므로
M1 acceptance를 충족했다는 뜻은 아니다.

## Rollback plan

1. 승인 전에는 migration을 생성·적용하지 않는다.
2. 승인된 forward migration마다 적용 직전 schema-only dump와 별도 rollback SQL을 만든다.
3. rollback은 신규 policy/GRANT/publication을 먼저 회수하고, 신규 쓰기를 중지한 뒤 실행한다.
4. 기존 live table을 삭제하거나 컬럼을 축소하는 rollback은 허용하지 않는다. additive contract만 되돌린다.
5. stage 환경에서 forward/rollback/forward와 Canvas read-only smoke test를 통과한 뒤 production 승인을 받는다.
6. production 적용·rollback은 사용자 승인, 백업 확인, 적용 직후 contract verifier 재실행을 요구한다.

현재 rollback SQL과 live rehearsal은 없으며, 이 초안 자체는 DB 변경 권한을 부여하지 않는다.
