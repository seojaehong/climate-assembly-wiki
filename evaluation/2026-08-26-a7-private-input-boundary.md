# A7 원문·검수 입력 repository 격리 검증

## 구현 결과

`platform-result-source-plan.mjs`가 인증된 raw `issue-items` capture를 provenance/publication 두 모드 모두에서 repository 밖의 기존 일반 파일로만 받는다. publication 모드의 `reviews`도 같은 경계를 적용해 reviewer identity와 공개 결정이 source tree에 놓이지 않게 한다.

## 차단 경계

- 입력 경로를 절대경로와 실제 경로로 각각 해석한다.
- repository 내부 파일을 직접 지정하면 읽기 전에 거부한다.
- 저장소 밖 symlink/junction이 repository 내부를 가리켜도 실제 target 기준으로 거부한다.
- 누락 파일과 디렉터리는 민감 내용을 읽거나 출력하지 않고 `unavailable`로 거부한다.
- 검증을 통과한 repository 밖 일반 파일의 실제 경로를 JSON reader에 전달해 검사 뒤 symlink 대상 변경 가능성을 줄인다.
- 공개 결과 snapshot은 공개 데이터일 수 있어 기존 `--result` 동작을 유지한다.
- publication plan 출력의 repository 밖 no-overwrite·사용자 전용 파일 모드와 원문·검수자 비노출 stdout/error 경계는 유지한다.

## TDD·검증

- red: 외부 일반 파일·repository 직접 파일·junction 우회·누락 파일을 구분할 exported validator 부재를 1건 실패로 확인
- focused: `npm.cmd test -- --run tests/platform-result-source-plan.test.mjs` — 1개 파일, 24건 통과
- automation 전체: `npm.cmd test -- --run` — 27개 파일, 436건 통과
- root 전체: `npm.cmd exec vitest -- run` — 64개 파일, 1,077건 통과
- Astro: `npm.cmd run check` — 330개 파일, 오류 0건, 기존 hint 49건

## 비변경 범위

- production `result_page`, DB, RPC, migration, Drive, public 파일을 변경하지 않았다.
- 실제 시민 원문·reviewer identity·운영 credential을 읽거나 생성하지 않았다.
- 실제 source publication과 server-side atomic enforcement는 별도 사용자 승인 대상이다.
