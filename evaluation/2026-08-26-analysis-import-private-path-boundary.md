# 분석코어 import 민감 파일 repository 격리 검증

## 구현 결과

`platform-analysis-import.mjs`가 실제 시민 분석 산출과 provenance ID, 검수 전 candidate plan을 repository·`public/`·Git 밖에서만 취급한다.

## 입력 경계

- `--analysis`, `--provenance-map`, `--verify-plan`은 존재하는 일반 파일이어야 한다.
- 입력 symlink/junction은 실제 target으로 해석하고 repository 내부 target을 읽기 전에 거부한다.
- 검증된 실제 파일 경로를 JSON reader에 전달한다.
- 누락·디렉터리·접근 불가 입력은 원문·ID·경로를 출력하지 않고 `unavailable`로 중단한다.

## 출력 경계

- `--output`의 실제 상위 디렉터리는 repository 밖이어야 한다.
- repository 내부 직접 출력과 repository 내부를 가리키는 junction parent를 쓰기 전에 거부한다.
- 기존 출력 교체는 symlink·hard-link가 아닌 단일-link 일반 파일만 허용한다.
- 새 plan은 사용자 전용 파일 모드와 기존 no-overwrite 기본값으로 기록한다.

## TDD·검증

- red: 외부 파일 허용, repository 직접 입력·출력, junction 우회, 누락 입력을 구분할 exported validator 부재를 1건 실패로 확인했다.
- focused: `npm.cmd test -- --run tests/platform-analysis-import.test.mjs` — 1개 파일, 18건 통과
- automation 전체: 27개 파일·438건 통과
- 루트 전체: 64개 파일·1,077건 통과
- Astro: 330개 파일, 오류·경고 0건, 기존 hint 49건

## 비변경 범위

- 실제 8/29 분석 산출·시민 원문·production credential을 읽거나 생성하지 않았다.
- Supabase, DB, API, public asset, 배포 상태를 변경하지 않았다.
- issue 적재와 사람 검수 실행은 실물 산출 확보와 별도 승인 뒤 범위다.
