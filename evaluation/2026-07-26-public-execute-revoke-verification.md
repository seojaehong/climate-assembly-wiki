# PUBLIC EXECUTE 회수 라이브 검증

- 검증일: 2026-07-26 (Asia/Seoul)
- 대상: `20260726_revoke_public_execute_attendance.sql`
- 적용: 사용자가 Supabase SQL Editor에서 실행
- 개인정보 포함 여부: 없음 (실명·토큰·키를 조회하거나 기록하지 않음)

## 배경

PostgreSQL은 함수 생성 시 EXECUTE를 PUBLIC에 기본 부여하고, PUBLIC 경유 권한은
명명된 롤에서 회수해도 남는다. `20260725_attendance_roster_hq.sql`은
`from anon, authenticated`만 회수해 토큰 발급 함수가 인증 게이트 밖에 노출돼 있었다.

## 검증 방법

공개 anon 키로 PostgREST RPC를 호출해 권한 경계만 확인했다.
토큰을 실제로 발급받거나 명부를 조회하지 않았고, 쓰기 RPC는 호출하지 않았다.

## 결과

회수 대상 — 전부 차단:

| 함수 | 응답 |
|---|---|
| `attendance_issue_token` | `42501 permission denied for function` |
| `attendance_token_row` | `42501 permission denied for function` |
| `capture_round_attendance` | `PGRST202` (트리거 함수, 스키마 캐시 미노출) |

클라이언트 경로 — 회귀 없음:

| 함수 | 응답 | 의미 |
|---|---|---|
| `attendance_hq_summary` | 200, 집계 반환 | 공개 집계 정상 |
| `attendance_team_unlock` | 200 `null` | 틀린 PIN 정상 거부 |
| `attendance_roster` | `P0001 attendance authorization required` | 인증 게이트 정상 작동 |
| `mod_join` | 200 | 모더레이터 입장 정상 |
| `hq_teams` | 200 | /hq 그리드 정상 |

`attendance_roster`가 토큰 없이 인증 요구로 막히는 것이 핵심 확인이다.
회수 전에는 이 앞단(토큰 발급)이 열려 있어 게이트가 우회됐다.

## 부수 관찰

`hq_teams`가 `3분과 5조`를 첫 행으로 반환했다. 이 함수에는 `order by`가 없고
Postgres는 행 순서를 보장하지 않는다 — 같은 날 `57e0aef`에서 고친 `/hq` 카드
임의 순서 문제의 원인이 라이브에서 그대로 재현된 것이다.

## 남은 권한 과제

- `attendance_secret.hq_password` 미프로비저닝 — `docs/operations/hq-password-provisioning.md`
- 조 출석 PIN이 조 접속코드와 동일한 테스트값 — 운영 전 무작위 교체 필요
- 조 접속코드가 `MMDD+순번` 규칙이라 실효 키스페이스가 15 — 무작위 6자리 재발급 권장
- 인증 실패 카운터(15분 5회)에 자동 초기화·만료 정리가 없어 잠금 시 SQL 개입 필요
