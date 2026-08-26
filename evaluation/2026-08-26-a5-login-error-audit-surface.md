# A5 로그인 실패 접근성 감사 표면 검증

## 결론

로그인 실패 복구 계약을 정적 컴포넌트 회귀에만 두지 않고 실제 Chromium 접근성 감사 경로에 편입했다. current checkout 리비전의 로컬 프리뷰에서 7개 경로와 desktop/mobile 2개 profile, 총 14개 감사 케이스가 모두 통과했으며 axe violation과 incomplete는 각각 0건이다.

자동화 범위는 실제 스크린리더 및 모바일 보조기기 수동 평가를 포함하지 않는다. 따라서 감사 결과는 `needs_review`이며 수동 평가 기록의 `not_run` 상태를 변경하지 않는다.

## 발견한 공백과 회귀 우선 검증

- 기존 감사는 로그인 전 정적 화면을 검사했지만 인증 실패 후 동적으로 나타나는 alert와 포커스 복구 상태를 axe 실행 전에 만들지 않았다.
- 먼저 generic post-navigation interaction 회귀와 기본 login-error route 기대를 추가했고, 구현 전 집중 테스트에서 19건 중 2건이 의도대로 실패했다.
- `PlatformShell` 정적 계약도 접근성 설명에 로그인 실패 감사 표면이 명시될 때까지 실패하도록 고정했다.

## 구현 경계

- `platform-login-error` 감사 경로는 합성 `.invalid` 이메일과 비밀번호만 사용한다.
- configured Supabase origin의 모든 요청을 브라우저 route로 가로채 token 요청은 합성 400, 나머지는 합성 500으로 종료한다.
- 외부 Supabase, 실제 credential, Auth 계정, membership, production DB 및 migration에는 접근하거나 변경하지 않는다.
- submit 후 `#platform-login-error[role=alert]` 표시와 비밀번호 입력 포커스 복귀를 기다린 뒤 axe를 실행한다.
- 두 입력이 같은 alert를 설명으로 참조하고 `aria-invalid=true`인지, alert가 atomic인지, 비밀번호가 계속 masked인지, 두 control이 다시 활성화됐는지 확인한다.

## 검증 증거

| 검증 | 결과 |
| --- | --- |
| 감사기 집중 테스트 | 19/19 통과 |
| PlatformShell 집중 테스트 | 49/49 통과 |
| 루트 전체 테스트 | 65 files, 1,081 tests 통과 |
| automation 전체 테스트 | 28 files, 497 tests 통과 |
| Astro check | 337 files, errors 0, warnings 0, 기존 hints 49 |
| Astro build | Node 20.20.2, 7,914 pages, Pagefind 8,009 pages, exit 0 |
| 실제 Chromium 감사 | 7 routes, 2 profiles, 14/14 cases 통과 |
| axe 결과 | violations 0, incomplete 0 |
| target revision | `e7e9ec51503caceca775a2dd52135d9332164203` verified |

## 검토

- 보안: 합성 요청 fixture는 Supabase origin을 외부로 보내지 않고 원시 credential을 사용하지 않는다.
- 정확성: interaction hook은 navigation 뒤, ready selector 및 axe 감사 전에 실행되며 React focus effect 완료를 명시적으로 기다린다.
- 성능: 기존 감사 행렬에 desktop/mobile 각 1건만 추가하며 모든 대기는 상한이 있다.
- 유지보수성: generic optional hook과 versioned fixture 이름을 사용해 다른 동적 상태도 동일 경계로 추가할 수 있다.
- 잔여 범위: 자동 axe 감사는 NVDA·VoiceOver·TalkBack의 실제 announcement 순서와 모바일 보조기기 조작성을 증명하지 않는다.
