# A6 off-DB export 무결성 검증

## 결론

OneDrive 수동 snapshot exporter는 이제 같은 이름의 기존 파일을 무조건 성공 처리하지 않는다. 현재 Supabase source row의 JSON 직렬화와 byte 단위로 정확히 일치하는 경우에만 `skip`하고, 다른 내용이 있으면 기존 파일과 source row를 모두 보존한 채 실패한다.

## TDD 증거

- 기존 파일을 sentinel JSON으로 바꾼 뒤 재실행하면 성공하던 동작을 실패 테스트로 먼저 재현했다.
- 구현 후 같은 경로가 `existing snapshot export does not match source row` 오류로 중단됨을 확인했다.
- 충돌 오류에는 snapshot ID, label, payload, 파일 경로를 포함하지 않는다.
- 원본과 정확히 같은 기존 파일 3개는 재실행 시 `exported=0`, `skipped=3`으로 유지된다.
- 충돌 파일은 오류 뒤에도 sentinel 내용이 그대로여서 덮어쓰지 않았음을 확인했다.

## 검증 결과

- 집중: `npm.cmd test -- --run tests/export-snapshots-onedrive.test.mjs` — 1개 파일, 12건 통과
- automation 전체: `npm.cmd test -- --run` — 27개 파일, 422건 통과
- 루트 전체: `npm.cmd exec vitest -- run` — 64개 파일, 1,060건 통과
- 정적 검사: `npm.cmd run check` — 330개 파일, 오류 0건, 기존 hint 49건

## 안전 경계

- 실제 Supabase와 OneDrive에 연결하지 않았다.
- 운영 snapshot, Drive 파일, credential을 읽거나 변경하지 않았다.
- 이번 검증은 기존 파일과 현재 source row의 동일성을 확인할 뿐 HMAC 서명, PITR/WAL, 운영 감사로그를 대체하지 않는다.
