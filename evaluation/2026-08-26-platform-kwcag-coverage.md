# A5 KWCAG 2.2 기준별 증거 커버리지 검증

- 기준: `KS X OT0003:2022` 한국형 웹 콘텐츠 접근성 지침 2.2
- 기준 출처: [WebWatch 심사 기준 및 KWCAG 2.2 원문](https://www.webwatch.or.kr/WA/010301.html?MenuCD=130)
- 원문 PDF SHA-256: `c5a139dc548bf018115d142847b69b7017953f5987fc50534c81e6b175402f13`
- 소스 commit: `d27788a3022a464095eb8e430340e21a80e77f28`
- GitHub Actions: [Platform accessibility audit 32894750675](https://github.com/seojaehong/climate-assembly-wiki/actions/runs/32894750675)
- CI KWCAG JSON SHA-256: `b65f29400efcff035e73c4a1c9bf1b877b59364733ef2d7518e8a941e9c9bba1`

## 구현 결과

`automation/platform-accessibility-kwcag-coverage.mjs`는 KWCAG 2.2의 33개 검사항목 ID·순서·이름을 고정하고, 각 항목을 실제 자동 감사 계약과 수동 평가 검사 ID에 연결한다. 항목 누락·중복·순서 변경, 존재하지 않는 증거 참조, 미커밋 자동 감사 소스를 거부한다.

자동 증거는 다음 네 경계를 별도로 판정한다.

1. axe-core WCAG 2.2 AA 자동 판정 부분집합
2. 본문 바로가기 링크의 실제 초점 이동
3. 데스크톱·모바일 수평 넘침과 최소 본문 폭
4. 명명된 가로 스크롤 영역의 키보드 조작

수동 평가 템플릿은 기존 6개 제품 표면에 `KWCAG 2.2 표면 간 공통 검수`를 추가했다. 데스크톱·모바일 스크린리더 환경에서 대체 텍스트, 멀티미디어, 색·대비, 키보드·초점, 시간제한, 깜빡임, 포인터, 도움, 오류·레이블, 인증, 마크업, 웹 애플리케이션 호환성을 명시적으로 확인하도록 14개 케이스·82개 필수 검사로 확장했다.

## 검증 결과

- Node 20 clean CI 정적 빌드: 통과
- Chromium 자동 감사: 12개 케이스 모두 통과
- axe 위반: 0건
- axe 자동 판정 불가: 0건
- 자동 증거 계약: 4개 모두 `pass`
- KWCAG 기준 매핑: 33개 항목, 미매핑 0건
- 수동 평가: 82개 모두 `not_run`
- 최종 상태: `needs_review`
- `certificationClaimed`: `false`

CI에서 업로드한 `platform-accessibility-kwcag-coverage.json`과 추적 산출물 `evaluation/platform-accessibility-kwcag-coverage.json`은 byte SHA-256가 일치한다. 자동 검사 통과를 품질인증 완료로 표시하지 않으며, 실제 보조기술 수동 평가가 끝나기 전에는 모든 KWCAG 항목을 `needs_review`로 유지한다.

## 변경 경계

이 작업은 감사 코드·CI·평가 템플릿과 추적 산출물만 변경했다. production DB, Auth, membership, RLS, GRANT, 공개 데이터와 배포 상태는 변경하지 않았다.

## 접근성 성명 공개 연결

- 소스 commit: `10ae40d`
- `/platform/accessibility/`에 `evaluation/platform-accessibility-kwcag-coverage.json` 링크를 추가했다.
- 성명은 KWCAG 2.2 33개 검사항목이 자동·수동 증거에 모두 매핑됐지만, 수동 평가 82개가 미실행이므로 모두 `needs_review`임을 화면에 명시한다.
- 자동 증거는 품질인증 획득·전수 준수를 의미하지 않는다는 경계를 같은 상태 영역에 놓았다.
- 커밋된 소스의 정적 미리보기에서 Chromium 12개 케이스가 모두 통과했고, axe 위반 0건·자동 판정 불가 0건을 확인했다.
- 접근성 자동화 집중 34건, PlatformShell 49건, automation 전체 27개 파일·420건, 루트 전체 64개 파일·1,060건이 통과했다. Astro check는 330개 파일 오류 0건·기존 hint 49건이다.
- 로컬 Node 24의 `astro build`는 기존 환경 문제로 정적 파일 생성 후 exit 1을 반환했다. 생성된 정적 미리보기로 브라우저 검증했으며, clean Node CI 빌드를 최종 증거로 남긴다.
- 로컬 브라우저 증거: `.artifacts/platform-accessibility-a5-statement.json`
- 로컬 KWCAG 매핑 증거: `.artifacts/platform-accessibility-a5-statement-kwcag.json`

## 수동 평가 관찰 증거 강화

- 기존 게이트는 `pass`에 관찰 메모가 없어도 전체 통과를 허용했다.
- 변경 후 `pass`, `fail`, `blocked`로 실행한 모든 검사는 보조기술로 확인한 관찰 메모가 필수다.
- `not_run`에 메모를 미리 넣어 기대 결과를 실제 관찰처럼 남기는 경로도 거부한다.
- 현재 추적 파일은 14개 케이스·82개 검사 모두 `not_run`, `notes:null`으로 새 계약을 통과하고 상태는 `needs_review`를 유지한다.
- 집중 수동·KWCAG 검증 20건, automation 전체 27개 파일·421건, 루트 전체 64개 파일·1,060건이 통과했다. Astro check는 330개 파일 오류 0건·기존 hint 49건이다.
- production DB, Auth, membership, RLS, GRANT, 배포 상태는 변경하지 않았다.
