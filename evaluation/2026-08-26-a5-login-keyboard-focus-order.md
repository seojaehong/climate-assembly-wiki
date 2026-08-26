# A5 로그인 키보드 포커스 순서 자동 감사

## 결론

공개 `/platform/` 로그인 화면의 키보드 초점 순서를 실제 Chromium의 `Tab`·`Shift+Tab`으로 검증하는 자동 감사를 추가했다. 공개 배포 `86a86fbcdf906ca3455e73c08dd3ca2403d1b574`에서 desktop·mobile 모두 다음 순서와 역순을 정확히 통과했고, 마지막·첫 컨트롤 밖의 감사 경계까지 이동해 순환 초점 함정이 아님을 확인했다.

1. `#platform-email`
2. `#platform-password`
3. `button[type="submit"]`
4. `a[href="/platform/accessibility/"]`

전체 자동 감사 상태는 수동 스크린리더·모바일 보조기기 평가가 남아 있어 `needs_review`이며 접근성 인증을 주장하지 않는다.

## 구현 범위

- `platform-login` 경로에 합성 비제출 입력값과 필수 키보드 초점 순서를 선언했다.
- 감사기는 각 selector의 존재·가시성·활성 상태, 정방향·역방향 실제 활성 요소, 양 끝 경계 이탈을 기록한다.
- 활성 요소 증거에는 tag·id·type·role·href pathname만 남기고 입력값과 URL query는 기록하지 않는다.
- 감사용 앞·뒤 경계 버튼은 axe·layout 검사 뒤 브라우저 DOM에만 임시 삽입하고 `finally`에서 제거한다. 제품 source와 공개 DOM 산출물은 바꾸지 않는다.
- 잘못된 순서와 마지막→처음/처음→마지막 강제 순환을 각각 실패시키는 회귀를 추가했다.
- KWCAG 2.2 자동 증거 `keyboard-focus-order`를 6.1.1(키보드 사용 보장), 6.1.2(초점 이동과 표시)에 연결했다. 두 항목은 수동 증거가 남아 있어 계속 `needs_review`다.
- 접근성 설명과 운영 runbook을 실제 자동 감사 범위에 맞게 갱신했다.

## 검토에서 발견해 보정한 사항

- 처음의 브라우저 기본 초점 이탈 판정은 마지막 컨트롤이 아닌지만 확인해 순환 함정을 성공으로 오인할 수 있었다. 명시적 경계 sentinel 도달을 요구하도록 바꾸고, trapped fixture로 실패를 고정했다.
- Linux Chromium의 브라우저 chrome 이동 차이를 제거하기 위해 문서 경계 sentinel을 사용하도록 바꿨다.
- 최소 테스트 fixture의 작은 도움말 링크가 모바일 axe `target-size` 위반을 만들었다. 로그인 제품 UI와 같은 터치 크기·간격을 fixture에 적용해 키보드 계약과 axe 계약을 함께 만족시켰다.

## 검증 증거

- 집중 테스트: `automation/tests/platform-accessibility-audit.test.mjs`, `platform-accessibility-kwcag-coverage.test.mjs` 31건 통과
- 루트 전체: 65개 파일, 1,081건 통과
- automation 전체: 28개 파일, 502건 통과
- Astro check: 337개 파일, 오류 0건, 경고 0건, 기존 hint 49건
- Astro build: 7,914 pages, Pagefind 8,009 pages
- GitHub `test`: [run 32970121852](https://github.com/seojaehong/climate-assembly-wiki/actions/runs/32970121852) 통과
- GitHub `Platform accessibility audit`: [run 32970121766](https://github.com/seojaehong/climate-assembly-wiki/actions/runs/32970121766) 통과
- 공개 revision probe: `86a86fbcdf906ca3455e73c08dd3ca2403d1b574` exact match
- 공개 Chromium 감사: 7개 경로 × 2개 profile = 14개 케이스 전부 통과, violation 0건, incomplete 0건
- 공식 자동 감사: `evaluation/platform-accessibility-audit.json`
- 공식 KWCAG 매핑: `evaluation/platform-accessibility-kwcag-coverage.json`

## 안전 경계

- 로그인 제출은 실행하지 않는다. 합성 `.invalid` 값만 사용하고 Auth origin은 브라우저 내부 fixture로 차단한다.
- 실제 credential, 외부 Auth, production DB·migration·GRANT·데이터 mutation은 사용하지 않았다.
- 자동 axe·키보드 검증은 NVDA·VoiceOver·TalkBack 및 실제 모바일 보조기기 평가를 대체하지 않는다.

## 커밋

- `77b52ed` `feat: audit login keyboard focus order`
- `f7238c6` `fix: distinguish browser focus exit from traps`
- `310ba84` `fix: make focus boundary audit deterministic`
- `54ac3e6` `chore: expose focus audit failure evidence`
- `688bc36` `chore: expose profile focus audit evidence`
- `86a86fb` `test: size keyboard audit touch targets`
