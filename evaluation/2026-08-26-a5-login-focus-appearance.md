# A5 로그인 키보드 초점 모양 검증

## 결론

공개 `/platform/` 로그인 화면의 키보드 순서·순환 함정 검증에 더해, 실제 Chromium 순회 중 각 필수 컨트롤의 초점 표시 모양과 인접 배경 대비를 자동 감사에 포함했다. 공개 배포 revision `f30f33fc4ea15e5f7fbbd97b4822361b7658e71d`에서 데스크톱·모바일 14개 감사 케이스가 모두 통과했고 자동 위반과 자동 판정 불가는 없었다.

실제 NVDA·VoiceOver·TalkBack 및 모바일 보조기기 평가는 수행하지 않았으므로 전체 접근성 상태와 KWCAG 6.1.2는 계속 `needs_review`다.

## 해소한 공백

기존 감사는 이메일 → 비밀번호 → 제출 → 접근성 안내 링크의 전·역방향 순서와 양 끝 경계 이탈을 입증했지만, 활성 요소가 눈에 보이는 초점 표시를 제공하는지는 판정하지 않았다. 이번 변경은 실제 `Tab` 순회 시 다음 computed style 근거를 컨트롤별로 기록하고 모두 만족해야 로그인 경로를 통과시킨다.

- 외곽선 스타일이 `none` 또는 `hidden`이 아닐 것
- 외곽선 너비가 2px 이상일 것
- 외곽선 색과 가장 가까운 불투명 인접 배경의 대비가 3:1 이상일 것
- 기록 필드: `outlineStyle`, `outlineWidthPx`, `outlineOffsetPx`, `outlineColor`, `adjacentBackgroundColor`, `contrastRatio`, `passed`

## 공개 배포 근거

- 생성 시각: `2026-08-26T13:11:57.860Z`
- 소스/배포 revision: `f30f33fc4ea15e5f7fbbd97b4822361b7658e71d`
- 대상: `#platform-email`, `#platform-password`, 제출 버튼, 접근성 안내 링크
- 데스크톱·모바일 공통: `solid`, 너비 2px, offset 3px
- 외곽선: `rgb(10, 107, 78)`
- 인접 배경: `rgb(255, 255, 255)`
- 대비: 6.51:1
- 감사 결과: 7개 경로 × 2개 profile = 14개 케이스 통과, violation 0건, incomplete 0건

근거 파일:

- `evaluation/platform-accessibility-audit.json`
- `evaluation/platform-accessibility-kwcag-coverage.json`

## 회귀 방지와 검토 결과

구현 전 schema·초점 모양·KWCAG mapping 기대를 추가해 집중 테스트 10건의 실패를 확인한 뒤 구현했다. `outline: none !important`가 순서 검증은 통과하지만 모양 검증은 실패하는 회귀를 고정했고, 코드 검토에서 색 대비 퇴행 공백을 발견해 흰 배경의 `#c0c0c0` 외곽선(1.82:1)도 실패하도록 별도 fixture를 추가했다. 최종 집중 테스트는 34건이 통과했다.

KWCAG 자동 근거 `keyboard-focus-appearance`는 6.1.2에만 연결했다. 자동 감사가 실제 보조기기 평가를 대신하지 않으므로 이 기준의 수동 상태는 변경하지 않았다.

## 검증

- 접근성 감사·KWCAG 집중 테스트: 34건 통과
- `PlatformShell` 집중 테스트: 49건 통과
- 루트 Vitest: 65개 파일, 1,081건 통과
- automation Linux CI: 28개 파일, 505건 통과
- Astro check(Node 20.20.2): 337개 파일, 오류 0건, 경고 0건, 기존 hint 49건
- 정적 빌드(Node 20.20.2): 7,914페이지 생성, 로컬 Pagefind 8,009페이지 색인
- [test CI run 32972535341](https://github.com/seojaehong/climate-assembly-wiki/actions/runs/32972535341): 성공
- [accessibility CI run 32972535306](https://github.com/seojaehong/climate-assembly-wiki/actions/runs/32972535306): 성공, 공개 감사 14/14 통과

Windows의 Node 24에서 `npm.cmd run build`는 prebuild 산출물을 갱신한 뒤 명시적 오류 없이 exit 1로 끝났다. 갱신된 생성 파일은 모두 현재 HEAD로 복원했고, 지원 경계인 Node 20.20.2의 직접 Astro 빌드로 성공을 재확인했다.

## 안전 경계와 잔여 작업

합성 로그인 fixture와 읽기 전용 공개 감사만 사용했다. 실제 credential·외부 Auth 제출·production DB·migration·GRANT·데이터 mutation은 실행하지 않았다. 다음 접근성 작업은 실제 스크린리더와 모바일 보조기기의 수동 평가다.
