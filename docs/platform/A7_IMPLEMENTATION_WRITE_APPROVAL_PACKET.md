# A7 기관 이행조치 직접 등록 — migration 초안 승인 패킷

## 현재 구현

플랫폼의 `공개` 화면에서 새로 발행한 결과 또는 같은 스코프의 기존 공개 토큰을 `result_get`으로 재조회·검증한 결과에 한해, 검수 완료 권고를 선택하여 다음 기관 답변을 직접 입력할 수 있다. 기존 URL 입력은 현재 사이트의 `/r/<32자리 hex>`만 허용하고 외부 origin, URL credential, query, fragment를 거부한다.

- 이행 상태: 기관 검토 중, 이행 계획 수립, 이행 중, 이행 완료, 미이행 사유 공개
- 책임 기관
- 기관 갱신 시각
- 공개 설명
- 공개 근거 HTTPS URL

화면 검증은 공개 결과와 승인 전 publish plan이 사용하는 `implementation-status-contract.json`을 그대로 사용한다. 저장 성공 응답만으로 완료 처리하지 않고 `/r/<token>`의 `result_get`을 다시 호출해 권고별 공개 값이 요청과 정확히 같은지 확인한다.

## 아직 동작하지 않는 경계

클라이언트는 아래 휴면 RPC 계약까지 연결되어 있으나, 해당 DB 함수는 만들거나 적용하지 않았다.

```text
climate_vote.result_implementation_upsert(
  p_token text,
  p_result_token text,
  p_issue_id uuid,
  p_implementation jsonb
)
```

RPC가 없으면 화면은 저장 성공을 가장하지 않고 `A7 migration 승인 후 사용할 수 있습니다`라고 표시한다. 운영 DB·Auth·GRANT·실데이터 변경은 없다.

## migration 초안에 고정할 불변식

승인되면 다음 조건으로 SQL 초안·rollback·PostgreSQL 16 검증을 함께 작성한다.

1. HQ capability 토큰을 `attendance_token_row(p_token)`으로 검증하고 `scope = 'hq'`만 허용한다.
2. 공개 토큰으로 찾은 결과 페이지의 기관과 선택된 기관 컨텍스트가 일치해야 하며 내부 result UUID를 브라우저에 새로 노출하지 않는다.
3. 공개 중이며 archive되지 않은 `result_page`만 갱신한다.
4. `p_issue_id`는 해당 결과 snapshot의 `body.issues` 안에 있고 `review_status = 'reviewed'`여야 한다.
5. 허용 필드는 `status`, `responsible_body`, `updated_at`, `summary`, `evidence_url`뿐이며 길이·canonical UTC·HTTPS·URL credential 금지 규칙을 서버에서도 재검증한다.
6. `implemented`, `not_pursued`에는 근거 URL을 필수로 한다.
7. 이행조치는 현재 값 덮어쓰기만 하지 않고 권고별 append-only 사건으로 보존한다. 취소·정정도 새 사건이며 누가·언제 변경했는지 남긴다.
8. 한 트랜잭션에서 사건을 추가하고 대상 issue의 `implementation`만 교체하며 나머지 snapshot은 그대로 보존한다.
9. 이후 `result_publish`가 같은 권고를 재발행할 때 마지막 유효 사건을 새 snapshot에 합쳐, 재발행으로 이행조치가 사라지지 않게 한다.
10. A6 감사로그에는 행 전체 값이나 설명 본문 없이 이행 사건 및 `result_page`의 변경 필드 메타데이터만 남긴다.
11. `security definer`, 고정 `search_path`, `PUBLIC` revoke, `anon/authenticated` 명시 grant를 적용한다.
12. 동시 수정 충돌을 막기 위해 대상 `result_page`를 잠그고, 성공 후 공개 재조회가 가능한 결과 식별자·권고 식별자·서버 갱신 시각만 반환한다.

## 필요한 승인

다음 문구로 승인하면 **migration 파일 초안 작성만** 진행한다.

> A7 기관 이행조치 저장 RPC migration 초안 작성을 승인합니다.

초안 작성 승인은 운영 Supabase 적용 승인이 아니다. 실제 적용은 SQL·rollback·검증 결과를 검토한 뒤 별도로 승인한다.
