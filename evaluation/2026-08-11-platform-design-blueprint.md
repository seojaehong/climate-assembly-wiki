# A4 승인 전 설계 청사진 구현 증거

- 일자: 2026-08-11
- 범위: `/platform` 공론화 설계 화면의 로컬 청사진 작성·검증·미리보기·JSON export
- 비범위: DB/RPC 변경, 실제 공론화·회차·주제·조 생성, 브라우저 저장소, 운영 권한 활성화

## 구현 계약

- assembly → sessions → topics/teams 계층을 JSON에 그대로 보존한다.
- 실제 달력 날짜, 비감소 회차 순서, 주제 공백·중복, 조·참여자 양의 정수, 참여자보다 많은 조를 fail-closed한다.
- 회차 24개, 회차당 주제 50개·조 500개·참여자 100,000명, 전체 생성 항목 10,000개와 이름·주제 문자열 길이 예산을 적용해 과대 입력을 생성 전에 거부한다.
- 나머지 인원은 앞 조부터 한 명씩 배분해 계획 정원을 결정적으로 계산한다.
- 출력에는 `dryRun: true`, `databaseMutationExecuted: false`, `requiresApproval: true`를 고정한다.
- 검증 성공 전에는 JSON 다운로드 버튼을 제공하지 않고, 다운로드 실패는 로그와 접근 가능한 오류 상태로 노출한다.

## 실행 증거

- 집중 Vitest: `src/islands/platform/design/DesignConsole.test.ts`, `design-console-logic.test.ts` — 19건 통과
- 전체 Vitest: 57개 파일, 866건 통과
- Astro check: 오류 0건(기존 hint 49건)
- Node 20 Astro 정적 빌드: 7,913페이지 통과
- 빌드 로그: `evaluation/2026-08-11-platform-design-blueprint-build.log` (로컬 실행 로그, git 제외)
- 최종 diff 리뷰는 커밋 전 게이트에서 별도 실행한다.

## 남은 승인 경계

이 JSON은 승인 검토용 로컬 산출물이다. 실제 DB 생성, 저장·재편집, 초대·권한, 동시 수정 계약은 포함하지 않으며 사용자 승인 없는 migration이나 production mutation을 수행하지 않았다.
