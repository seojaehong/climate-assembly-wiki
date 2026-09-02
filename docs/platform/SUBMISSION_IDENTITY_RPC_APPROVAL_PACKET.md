# Submission identity read-only RPC 승인 패킷

상태: **production 변경 미승인**

대상: `pleyuknjnprsckssxvrh`의 `climate_vote` schema

목적: 8/29 분석 source UID를 현재 참조 가능한 `submission_item.id`에 exact match로 연결

## 현재 증거

- 배포된 exporter는 프로젝트 ref와 세션 slug를 고정하고 DB 쓰기 호출 없이 최소 원문 좌표만 만든다.
- 2026-09-03 live probe에서 service role의 `climate_vote.session` 직접 SELECT는 PostgreSQL
  `42501`·HTTP 403으로 거부됐고 private output은 생성되지 않았다.
- 같은 자격증명으로 읽을 수 있는 legacy snapshot은 22개였으며 `submission_item` collection을
  포함한 payload는 없었다.
- `submission_item_archive`는 삭제 전 item UUID를 보존하지 않는다. 이미 삭제된 과거 UUID는
  현재 자료에서 복구하거나 합성할 수 없다.

## 선택지

| 선택 | 권한 범위 | 판단 |
|---|---|---|
| service role에 5개 테이블 SELECT 부여 | session·topic·team·submission·item 전체 행을 직접 읽을 수 있음 | 범위가 넓어 채택하지 않음 |
| service-role-only read RPC | 지정 session slug에 연결된 현재 행의 최소 필드만 반환 | **권고** |
| platform snapshot 활성화 | snapshot 행과 외부 export를 새로 생성 | 별도 A6 mutation이며 이번 승인에 포함하지 않음 |

## 권고 RPC 계약

승인 뒤 별도 migration과 rollback을 작성한다. 이 패킷 자체에는 실행 SQL이 없다.

- 함수명: `climate_vote.platform_submission_identity_source(text)`
- 입력: exact session slug 하나
- 출력: schema version, session ID/slug, 활성 topic·team, archive되지 않은 submission,
  현재 `submission_item`의 ID·submission ID·ordinal·content
- 제외: join code, HQ token, 사용자·이메일, rationale, provenance 내부값, archive 원문,
  issue·투표·출석 데이터
- 실행 역할: `service_role`만 허용
- 방어: `SECURITY DEFINER`, 고정 `search_path`, `STABLE`, 20초 statement timeout,
  PUBLIC·anon·authenticated EXECUTE 명시 회수, JWT role 재검증, dynamic SQL 금지
- 데이터 동작: SELECT만 허용하며 table GRANT, INSERT, UPDATE, DELETE, snapshot 생성 없음
- 결과 상한: exporter가 10,000행·16MiB를 초과하면 파일 생성 전에 실패

## repository 준비 상태

`platform-submission-identity-export.mjs`는 기존 `direct_tables`와 명시적
`read_only_rpc` access method를 분리한다. RPC mode는 exact schema version과 root field만 받고,
추가 필드·원격 오류·다른 세션·중복 좌표·본문 불일치를 fail-closed한다. 자동 fallback은 없다.

승인·설치 뒤 실행 환경에는 다음 값을 명시한다.

```powershell
$env:PLATFORM_EXPORT_ACCESS_METHOD='read_only_rpc'
$env:PLATFORM_EXPORT_EXPECTED_PROJECT_REF='pleyuknjnprsckssxvrh'
```

## 적용 순서와 완료 증거

1. migration·rollback 초안과 checksum을 리뷰한다.
2. 적용 직전 대상 프로젝트 ref와 현재 함수 부재, 5개 테이블 ACL 미변경 기준을 기록한다.
3. 함수만 설치하고 PUBLIC·anon·authenticated deny, service role allow를 post-apply로 확인한다.
4. 잘못된 slug·일반 역할 거부와 지정 세션 service role 성공을 검증한다.
5. exporter로 저장소 밖 private 파일을 생성하고 `databaseMutationExecuted:false`를 확인한다.
6. 분석 원문과 현재 행을 조·topic/item ordinal·본문으로 exact match한다.
7. provenance map과 검수 전 import plan을 생성하되 실제 issue 적재는 별도 승인 전 중단한다.

완료 증거에는 migration commit, CI, 함수 ACL·속성, 호출 역할 allow/deny, 반환 건수,
private export의 SHA-256, provenance mapping 건수만 기록한다. 원문·UUID·자격증명은 공개 로그나
repository에 기록하지 않는다.

## rollback

rollback은 service role EXECUTE를 먼저 회수하고 정확한 함수 signature만 삭제한다. 테이블 ACL과
행은 변경하지 않는다. 함수 부재, 기존 5개 테이블 ACL 불변, exporter 재호출의 안전한 실패를
확인한다. private export는 별도 보존 정책에 따라 처리하며 rollback SQL이 삭제하지 않는다.

## 즉시 중단 조건

- 대상 project ref 또는 승인 migration checksum 불일치
- migration에 table GRANT나 데이터 mutation이 포함됨
- 일반 역할에서 함수 실행 가능
- 지정 세션 밖 행, archive 원문 또는 금지 필드가 응답에 포함됨
- 현재 원문과 분석 source가 exact match되지 않음
- 기존 파일 덮어쓰기 또는 repository 내부 출력 시도

## 승인 문구

> `pleyuknjnprsckssxvrh` 운영 DB에 service_role 전용
> `climate_vote.platform_submission_identity_source(text)` 읽기 함수의 migration·rollback 작성,
> 적용, post-apply 역할 검증과 8/29 private identity export 실행만 승인합니다. 테이블 GRANT,
> 데이터 변경, snapshot 생성, issue 적재, staff traffic 활성화는 승인하지 않습니다.
