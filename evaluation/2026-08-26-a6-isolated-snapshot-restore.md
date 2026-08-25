# A6 격리 snapshot 복원 rehearsal

## 범위

- 합성 데이터만 포함한 HMAC 서명 archive 생성
- 현재 `driver_pass1.sql` migration chain을 PostgreSQL 16의 일회성 `verify` 데이터베이스에 적용
- archive 밖 조직·주제·조·회차 부모를 합성 fixture로 생성
- 대상 8개 collection을 실제 테이블에 복원하고 DB 제약과 collection별 건수 확인
- 전체 transaction rollback 뒤 대상 테이블 잔존 행 확인

운영 Supabase, Drive, credential, 시민 데이터에는 접근하지 않았다.

## 로컬 실행 결과

- 준비 상태: `restore_rehearsal_prepared`
- 실제 DB 실행 상태: `restore_rehearsal_passed`
- 복원 행: submission 1, submission_item 1, issue 1, issue_link 1, result_page 1, ballot 1, ballot_item 1, ballot_response 1
- rollback 뒤 대상 테이블 잔존 행: 0
- 실행 데이터베이스: PostgreSQL 16, database `verify`

## 안전 경계

- API와 SQL 생성기 모두 database 이름이 정확히 `verify`일 때만 진행한다.
- SQL은 대상 테이블에 기존 행이 있으면 삽입 전에 실패한다.
- 서명 키는 SQL과 결과 요약에 포함하지 않는다.
- 복원 성공 결과를 출력한 뒤에도 transaction을 rollback하고 잔존 행을 다시 검사한다.
- 합성 부모는 FK·check·unique·trigger 실행 가능성을 확인하기 위한 것으로 원래 부모 데이터 복구를 증명하지 않는다.
- PITR/WAL, 운영 감사로그, 운영 환경 복원은 이번 범위가 아니다.

## 재현 경로

- `automation/snapshot-db.mjs`
- `automation/tests/snapshot-db.test.mjs`
- `automation/tests/fixtures/create-snapshot-restore-archive.mjs`
- `.github/workflows/test.yml`
