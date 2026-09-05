# 9/12–13 구현 검증 보고서

- 최종 검증 소스: `484bf4425fb7136f98bfbaa6e1a6f8fe3bbbe63d`
- 브랜치: `codex/0912-readiness-hardening`
- 판정: 로컬 구현 검증 완료, 운영 개통은 `not_ready`
- 안전 경계: 운영 DB 연결·변경 0건, 배포 0건, 합성 브라우저 리허설만 수행

## 구현 결과

1. 현장 사용성
   - 조 화면에 연결·저장·오프라인 대기·충돌·복구 상태를 눈에 보이는 상태 레일로 통합했다.
   - 새 꼭지가 열려도 작성 내용, 포커스, 스크롤을 보존하고 새 꼭지로 이동할 수 있는 안내를 제공한다.
   - 기존 초안과 대기열은 시민 입력을 보존한 채 안전하게 이전하며, 내구 저장을 확인한 뒤에만 재사용 가능한 접속코드를 제거한다.
   - HQ 비밀번호는 글자 수가 아니라 UTF-8 바이트 제한까지 입력 단계에서 설명한다.

2. 기능 신뢰성
   - 저장·라운드·투표·HQ 제어·분류 작업에 멱등키와 예상 버전·상태 검사를 적용했다.
   - 활성 라운드, 조별 기기 한도, 공유 인증 제한, 이름 있는 운영자 인증의 동시 요청을 DB에서 직렬화했다.
   - 로그아웃은 서버 폐기를 확인한 뒤에만 로컬 토큰을 제거하고, 실패 시 복구 가능한 상태를 유지한다.
   - P1~P4 마이그레이션, 롤백 거부 조건, 토큰 전환, 감사 이력 보존을 일회용 PostgreSQL 16에서 검증한다.

3. 릴리스 안전성
   - 운영 증거는 source commit, target revision, releaseRunId, 승인된 공개키 서명, 파일 SHA-256에 결속된다.
   - 운영 패킷 작성은 stage·backup·최종 경로를 사용하는 파일시스템 트랜잭션으로 만들고 기존 파일을 덮어쓰지 않는다.
   - Windows 체크아웃을 WSL에서 검증할 때 CRLF만으로 전체 소스가 dirty로 오인되지 않도록 Git 정규화 규칙을 고정했다. 실제 내용 변경은 계속 차단한다.
   - 운영 승인·백업·복원·현장 기기·수동 보조기술 증거가 없으면 최종 보고서는 fail-closed로 `not_ready`를 유지한다.

## 최종 검증 매트릭스

| 검증 | 결과 | 근거 |
|---|---:|---|
| 루트 Vitest | 124개 파일, 2,220개 통과 | `.tmp-verify/final2-npm-test.log` |
| Automation Vitest | 37개 파일, 599개 통과 | `.tmp-verify/final-npm-test-automation.log` |
| Astro/TypeScript | 507개 파일, 오류 0건, 힌트 58건 | `.tmp-verify/release-final-astro-check.log` |
| 프로덕션 빌드 | 2,628개 모듈, 9,493페이지, Pagefind 9,579페이지 | `.tmp-verify/release-final-astro-build.log` |
| 배포 리비전 파일 | HEAD와 일치 | `.tmp-verify/release-final-revision.log` |
| 정적 추적성 | 요구사항 14/14 통과 | `evaluation/0912-13-traceability-report.json` |
| RPC·클라이언트 계약 | RPC 86개, 호출 63개, 행위 seam 135개, 구형 권한 회수 52개 | `.tmp-verify/verify-0912-static-contract.log` |
| 일회용 PostgreSQL 16 | release 모드 통과, manifest 74개 완료 시점 재검증 | `evaluation/0912-p1a-postgres-report.json` |
| A4 번들 | 산출물 20개, checksum 검증 통과, 운영 적용 미승인 | `.tmp-verify/final-a4-bundle-verify.log` |
| 조 화면 브라우저 리허설 | 11/11 통과 | `evaluation/0912-13-field-rehearsal.json` |
| HQ 브라우저 리허설 | 8/8 통과 | `evaluation/0912-13-hq-rehearsal.json` |
| 자동 접근성 | 23개 경로 × 2개 화면, 46/46 통과, 위반·미완료 0건 | `evaluation/0912-hq-dashboard-accessibility.json` |
| 수동 접근성 증거 | 22개 사례·118개 확인 항목 미실행 | `.tmp-verify/final-manual-accessibility.log` |

PostgreSQL 검증은 `targetManifestSha256=25de673ce62d2a7d3b713fa7af07a525e1d33067a81b32def4e681052d58dceb`로 74개 입력을 결속했고, 완료 시 같은 manifest를 다시 계산해 일치시켰다. 생성한 Docker 컨테이너와 임시 seed 파일은 종료 후 남지 않았다.

첫 루트 전체 테스트는 빌드와 동시에 실행되어 암호화 기반 장시간 테스트 2건이 제한 시간에 걸렸다. 해당 2건은 단독으로 통과했고, 부하를 제거한 최종 전체 실행에서도 2,220개가 모두 통과했다. 최종 판정에는 두 번째 전체 실행을 사용한다.

## 운영 개통 전 중단 조건

다음 항목은 로컬 합성 검증으로 대체하지 않았다.

- 운영 마이그레이션과 단계별 데이터 변경의 명시 승인
- 15개 조 명단 정본과 개인 HQ 운영자 계정 확인
- 실제 배포 리비전·운영 ACL inventory·edge 직접 probe
- 행사 노트북·모바일·현장 네트워크 리허설
- 스크린리더와 모바일 보조기술 수동 평가
- 새 운영 백업 생성과 격리 복원 대조

따라서 구현은 계획대로 작동하도록 검증됐지만, 이 보고서만으로 운영 개통을 승인하지 않는다.
