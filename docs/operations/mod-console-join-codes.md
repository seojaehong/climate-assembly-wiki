# 모더레이터 콘솔 조 접속코드 운영

## 책임과 생성 위치

- 책임자: 행사 전 세션을 준비하는 본부 운영 담당자
- 생성 위치: `scripts/seed-0829-teams.mjs`
- 조 번호 기준: `scripts/seed-0829-lib.mjs`의 `OFFICIAL_TEAM_ROSTER`
- 브라우저 역할: `/mod/`와 `/v/`는 이미 발급된 코드를 입력할 뿐 코드를 만들지 않는다.

## 정상 발급 규칙

접속코드는 `행사일 MMDD + 공식 전체 조 순번 NN`의 6자리다.

- 2026-07-25 행사 전체 1번 조: `072501`
- 2026-08-29 행사 1분과 1조: `082901`
- 2026-08-29 행사 2분과 1조: `082906`
- 2026-08-29 행사 3분과 5조: `082915`

날짜는 스크립트를 실행한 날짜가 아니라 `SESSION_DATE`에 선언된 행사일에서 파생한다. 재실행 시점이 달라도 같은 세션의 코드는 바뀌지 않는다.

## 운영 명령

새 세션과 누락 조 생성 계획 확인:

```powershell
node scripts/seed-0829-teams.mjs --dry-run
```

현재 배포 환경의 서비스 역할 키에는 `climate_vote.session`/`team` 직접 권한이 없다. 따라서 아래 명령으로 관리자용 단일 트랜잭션을 출력한 뒤 Supabase SQL Editor에서 본부 운영 담당자가 실행한다.

```powershell
node scripts/seed-0829-teams.mjs --print-seed-sql
```

이미 존재하는 15개 조의 코드를 정상 규칙에 맞추기 위한 관리자용 단일 트랜잭션 출력:

```powershell
node scripts/seed-0829-teams.mjs --print-sync-sql
```

출력된 SQL은 Supabase SQL Editor에서 본부 운영 담당자가 실행한다. SQL은 공식 15개 조 존재 여부와 코드 충돌을 먼저 검사하고, 하나의 트랜잭션에서 갱신·검증한다. 검사나 갱신이 실패하면 전체가 롤백된다. 서비스 역할 키에 테이블 권한을 추가하는 방식은 DB 권한 변경 승인을 받은 뒤에만 사용한다.

## 유출 시 예외

날짜 기반 코드는 현장 배부용 식별자이며 강한 비밀번호가 아니다. 특정 조 코드가 외부에 유출됐을 때만 무작위 예외 코드를 발급한다.

```powershell
node scripts/rotate-join-code.mjs "1분과 1조" --dry-run
node scripts/rotate-join-code.mjs "1분과 1조" --print-sql
```

`--print-sql`이 만든 단일 트랜잭션을 Supabase SQL Editor에서 실행한다.
