# A7 원문 공개 publish preflight 검증

## 구현 결과

기존 비공개 provenance plan과 호환성을 유지하면서 `--reviews` 공개 모드를 추가했다. 공개 모드는 캡처된 결과·원문 그래프·운영진 결정을 대조해 승인된 원문만 포함한 전체 `result_page.body` 후보를 만든다. 실행 결과는 항상 `dryRun:true`, `databaseMutationExecuted:false`, `publicPayloadWritten:false`, `requiresApproval:true`다.

## 안전·무결성 경계

- 모든 연결된 issue/item 쌍에 `reviewed|withheld` 결정 하나를 요구한다. 일부 갱신이나 알 수 없는 항목은 허용하지 않는다.
- 공개 발췌는 공백을 암묵적으로 정리하지 않고 canonical source 문자열과 정확히 같아야 한다. SHA-256은 그 문자열의 정확한 UTF-8 bytes로 계산한다.
- 공개 대상 쟁점은 검수 완료여야 하고 검수자는 `auth-user:<uuid>`, 역할은 `org_admin|hq`여야 한다.
- 검수 시각은 결과 발행 이후, 리뷰 관찰 시각 이전의 canonical UTC여야 한다.
- 보류 결정은 발췌를 `null`로 강제해 plan에 원문을 남기지 않는다.
- 공개 record는 UI/DOCX와 공유하는 exact 9필드 계약을 사용한다. 검수자 identity는 공개 body에서 제외하고 비공개 patch에만 보존한다.
- 원문을 포함하는 publication plan은 실제 경로 해석 뒤 repository 밖에만 no-overwrite·사용자 전용 모드로 기록한다. CLI stdout/error에는 원문이나 검수자 ID를 출력하지 않는다.
- 인증 `issue-items`와 검수 결정 입력도 실제 경로가 repository 밖인 기존 일반 파일일 때만 읽는다. repository 내부 직접 경로와 내부를 가리키는 symlink/junction, 누락 파일은 내용을 읽기 전에 거부한다.
- 전체 body의 전후 SHA-256, 세 입력의 canonical SHA-256, plan self-checksum과 현재 입력 재생성 검증을 제공한다.

## 검증

- TDD red: 공개 plan export 부재를 테스트 수집 실패로 확인
- 집중: `npm.cmd test -- --run tests/platform-result-source-plan.test.mjs` — 1개 파일, 24건 통과
- automation 전체: `npm.cmd test -- --run` — 27개 파일, 436건 통과
- 루트 전체: `npm.cmd exec vitest -- run` — 64개 파일, 1,077건 통과
- Astro: `npm.cmd run check` — 330개 파일, 오류 0건, 기존 hint 49건
- 기존 provenance CLI 생성·검증·no-overwrite 회귀 통과

## 승인 경계

- 실제 원문·검수 입력으로 publication plan을 생성하지 않았다.
- production `result_page`, DB, RPC, migration, public 파일, Drive를 변경하지 않았다.
- plan은 운영 검토 후보이며 외부 서명·검수자 인증·게시 승인 증거가 아니다.
- atomic publish RPC와 public read 경계의 서버 검증은 별도 사용자 승인 후 구현 대상이다.
