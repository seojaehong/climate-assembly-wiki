# A5 접근성 감사 배포 revision artifact 결속

## 구현 결과

정상 `npm run build`의 postbuild가 배포 디렉터리에 `deployment-revision.json`을 생성한다. manifest는 schema version과 전체 source commit만 포함하며 public `_headers`에서 no-store로 고정한다. 접근성 감사 CLI는 브라우저를 열기 전에 같은 origin의 manifest를 조회해 checkout SHA와 정확히 일치할 때만 `targetRevision.status: verified`를 기록한다.

## TDD 경계

- RED: 기존 감사 보고서는 배포 artifact가 source commit을 노출하지 않아 항상 `targetRevision:not_verified`였다.
- revision 선택 우선순위는 `CF_PAGES_COMMIT_SHA`, `GITHUB_SHA`, 로컬 checkout이다.
- authoritative 환경 SHA가 있으면 전체 40자 형식이 아닌 값을 checkout으로 fallback하지 않고 거부한다.
- writer는 고정된 `dist/deployment-revision.json` 밖의 경로를 거부한다.
- verifier는 same-origin 최종 URL, HTTP 성공, JSON MIME, 256 byte 상한, exact `{schemaVersion,sourceCommit}`, schema v1, 소문자 전체 SHA를 강제한다.
- redirect, HTML, 추가 field, malformed·다른 SHA와 forged target state를 브라우저 감사 전에 거부한다.
- KWCAG 커버리지 게이트도 verified target revision과 source commit의 exact match를 독립적으로 재검증한다.
- 수동 backup Cloudflare 배포도 공개 ResultView 자산 probe 뒤 exact revision verifier를 실행한다.

## 경계

- manifest에는 시민 데이터, 환경값, branch, build log, credential을 포함하지 않는다.
- 이 결과는 현재 정적 artifact와 Git source commit의 결속이며 Cloudflare 계정 소유권, 독립 timestamp, 실제 스크린리더·모바일 보조기기 평가를 증명하지 않는다.
- production DB, Auth, membership, RLS, GRANT와 시민 데이터는 읽거나 변경하지 않았다.

## 검증

- revision writer focused: 1개 파일, 4건 통과
- Chromium audit focused: 1개 파일, 18건 통과
- Chromium audit·Cloudflare 배포 연동: 2개 파일, 25건 통과
- postbuild 직접 실행: schema v1 manifest와 현재 전체 HEAD 기록 확인
- automation 전체: 27개 파일, 448건 통과
- 루트 전체: 65개 파일, 1,081건 통과
- Astro check: 333개 파일, 오류·경고 0건, 기존 hint 49건
- 로컬 Node 24 Astro build는 기존 route 수집 단계 nonzero가 재현되어 postbuild를 직접 검증했다. 정본 Node 20 build·전체 CI와 사용자 도메인 exact revision은 push 후 확인한다.
