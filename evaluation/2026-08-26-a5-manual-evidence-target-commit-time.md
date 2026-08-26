# A5 수동 접근성 pass 대상 commit 사건순서 검증

## 구현 결과

수동 평가 evidence가 최종 `pass`일 때 repository에서 대상 commit의 Git committer timestamp를 읽고, 14개 case의 `testedAt`이 모두 그 시각 이상인지 검사한다. 템플릿 생성 이후라는 기존 조건만 맞춘 채 대상 commit이 생기기 전 평가했다고 기록한 pass는 거부한다.

## TDD 경계

- RED: 모든 82개 검사를 pass로 채운 evidence의 평가시각이 대상 commit보다 1ms 빨라도 기존 target verifier가 성공했다.
- GREEN: 같은 evidence는 `predates its target commit`으로 실패한다.
- 대상 commit 시각과 정확히 같은 평가시각은 허용한다.
- CLI 격리 Git fixture가 commit 시각을 직접 해석해 backdated pass를 거부하고, commit 이후 정상 evidence-only 갱신은 허용한다.
- 오류에는 commit hash, 평가자, 관찰 메모, 변경 경로를 출력하지 않는다.

## 현재 증거 상태

- 추적 수동 평가: 14개 케이스·82개 검사 모두 `not_run`
- 선언 상태: `needs_review`
- `certificationClaimed:false`
- Git committer timestamp는 repository 사건순서만 증명하며 실제 배포 완료시각·원격 revision·독립된 시각 권위를 증명하지 않는다.
- 실제 스크린리더·모바일 보조기기 평가와 품질인증은 완료되지 않았다.

## 검증

- focused: `npm.cmd test -- --run tests/platform-accessibility-manual-evidence.test.mjs` — 1개 파일, 15건 통과
- 수동·KWCAG 연동 집중: 2개 파일, 22건 통과
- automation 전체: 27개 파일, 445건 통과
- 루트 전체: 64개 파일, 1,077건 통과
- Astro check: 330개 파일, 오류·경고 0건, 기존 hint 49건

## 비변경 범위

production DB, Auth, membership, RLS, GRANT, 공개 데이터와 배포 상태를 읽거나 변경하지 않았다.
