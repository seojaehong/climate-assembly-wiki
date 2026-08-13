# A7 이행추적 공개 표시 계약

## 목적

공개 결과의 권고별 이행 정보를 웹 화면, 표 대체본, DOCX에서 같은 의미로 표시한다. 시민회의 권고는 자문이며, 이 상태는 관계 기관이 공개한 응답을 정리한 것으로 정책 효과를 판정하지 않는다.

## 선택 입력

`result_get` 쟁점은 선택적으로 `implementation`을 가질 수 있다.

```json
{
  "status": "in_progress",
  "responsible_body": "기후정책 담당기관",
  "updated_at": "2026-08-12T00:00:00.000Z",
  "summary": "공개된 계획에 따라 세부 이행을 진행 중입니다.",
  "evidence_url": "https://example.org/evidence"
}
```

허용 상태는 `under_review`, `planned`, `in_progress`, `implemented`, `not_pursued`다. 모든 등록 상태에는 책임 기관, 유효한 갱신 시각, 공개 설명이 필요하다. `implemented`와 `not_pursued`에는 HTTPS 근거 URL이 필수다. URL이 제공되면 사용자 정보가 없는 HTTPS URL이어야 한다.

상태 label·설명·색상·추적 여부·근거 필수 여부의 단일 정본은 `src/islands/result/implementation-status-contract.json`이다. 웹 뷰 모델과 승인 전 publish plan은 이 파일을 함께 소비한다.

## Fail-closed 표시

- 필드가 없으면 `이행 정보 미등록`으로 표시하고 등록 건수에 포함하지 않는다.
- 상태나 필수값이 잘못되면 `이행 정보 확인 필요`로 표시하고 원 값을 공개하지 않는다.
- 유효한 상태만 등록 건수에 포함한다.
- 웹 패널, 접근 가능한 표, DOCX는 같은 검증된 뷰 모델을 사용한다.

## 승인 경계

이 변경은 선택 필드를 읽는 프런트엔드 계약과 보고서 표현만 추가한다. RPC, DB 스키마, migration, 실제 시민 데이터, 공개 snapshot은 변경하지 않는다. 실제 이행 정보 게시에는 데이터 소유자, 갱신 책임, 근거 검수, atomic publish payload에 대한 별도 사용자 승인이 필요하다.

승인 전 payload 검증 절차는 [이행추적 publish plan](./IMPLEMENTATION_PUBLISH_PLAN.md)에 정의한다.
