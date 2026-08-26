# A7 이행추적 Publish Plan

## 목적

현재 공개된 `result_get` snapshot과 관계 기관 이행 응답을 로컬에서 결속해, 승인 후 원자적으로 게시할 전체 `result_page.body` 후보를 만든다. 이 도구는 DB, RPC, 공개 페이지를 변경하지 않는다.

## 입력

- `--result`: 현재 공개된 `result_get` 응답 캡처
- `--responses`: 같은 scope를 대상으로 운영진이 검수한 이행 응답

응답 파일은 scope·scope ID·관찰 시각과 한 개 이상의 응답을 포함한다. 각 응답에는 다음 값이 필요하다.

- 공개 snapshot 안의 `issue_id`
- 허용 상태
- 책임 기관, 갱신 시각, 공개 설명
- 역할형 검수자 ID와 검수 시각
- 완료 또는 미이행 사유 공개 상태의 HTTPS 근거 URL

관찰 시각은 공개 시각보다 빠를 수 없고, `updated_at <= reviewed_at <= observed_at` 순서를 지켜야 한다. 중복·범위 밖 쟁점, 잘못된 상태·URL·검수자, 잘못된 시각 순서는 plan 생성 전에 거부한다.

허용 상태와 완료 상태의 근거 필수 규칙은 웹 표시와 같은 `src/islands/result/implementation-status-contract.json`에서 읽는다. preflight는 계약 schema·fallback·메타데이터·색상 형식뿐 아니라 책임 기관·설명·시각·근거 URL의 공용 record 제약도 시작 시 검증한다. 웹과 preflight는 canonical UTC 시각과 credential 없는 HTTPS 근거 URL만 유효한 이행 정보로 인정한다.

## 출력

schema-v2 plan은 현재 body와 다음 body의 SHA-256, 변경 쟁점별 전후 이행값 SHA-256, 역할형 검수자·시각, 전체 `atomicResultBody`를 보존한다. 또한 `implementation-status-contract.json`의 schema와 canonical SHA-256을 결속한다. 갱신하지 않은 쟁점은 현재 snapshot에서 그대로 복사하되, 최종 body의 모든 기존 이행값도 동일 공개 계약으로 다시 검증한다. 현재 verifier는 identity가 없는 legacy schema-v1 plan과 checksum을 다시 계산한 contract identity drift를 거부한다.

다음 안전 경계를 항상 포함한다.

- `dryRun: true`
- `databaseMutationExecuted: false`
- `publicPayloadWritten: false`
- `requiresApproval: true`

canonical self-checksum과 전체 입력 재생성 검증은 우발적 편집을 탐지하지만 외부 서명, 검수자 인증, 게시 승인이 아니다.

## 명령

```powershell
cd automation
npm.cmd run plan:platform-implementations -- --result <result.json> --responses <responses.json> --output <plan.json>
node platform-implementation-plan.mjs --result <result.json> --responses <responses.json> --verify-plan <plan.json>
```

CLI는 기존 출력 파일을 덮어쓰지 않는다. 실제 기관 응답과 plan은 `public/`에 두거나 승인 없이 커밋하지 않는다.

## 남은 승인 항목

현재 `result_publish`는 DB 쟁점에서 body를 새로 조립하므로 이 plan을 소비하지 않는다. 실제 게시에는 이행 응답 저장 위치, 기관·검수자 인증, evidence URL 보존 정책, atomic publish RPC와 migration에 대한 명시적 사용자 승인이 필요하다.
