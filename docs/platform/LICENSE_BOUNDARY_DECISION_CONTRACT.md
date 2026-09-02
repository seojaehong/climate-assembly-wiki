# Phase C 코드·콘텐츠 라이선스 경계 결정 계약

## 현재 상태

루트 `LICENSE`와 README는 저장소 전체를 CC BY-SA 4.0으로 표현하지만, 루트
`package.json`에는 코드용 SPDX license가 없다. 콘텐츠 schema는 CC BY-SA 4.0을 강제하고,
En-ROADS 파생 자료는 CC BY 4.0, vendored `@rhwp/core`와 `kordoc`은 MIT 및 별도 고지 파일을
사용한다. 따라서 현재 선언을 SaaS 코드의 최종 라이선스 결정으로 간주하지 않는다.

Creative Commons는 소프트웨어에 CC 라이선스를 권장하지 않고 FSF 또는 OSI가 제공하는
소프트웨어 라이선스를 사용하도록 안내한다. AGPL은 네트워크 서버에서 수정된 프로그램을
사용하는 이용자가 해당 수정본의 소스를 받을 수 있도록 설계됐다. 실제 선택에는 다음 공식
자료와 권리자 검토를 사용한다.

- https://creativecommons.org/faq/
- https://www.gnu.org/licenses/agpl-3.0.en.html
- https://spdx.org/licenses/

## 결정 범위

- `open_source_agpl`: 코드에 AGPL-3.0-only 또는 AGPL-3.0-or-later 중 하나를 선택한다.
- `dual_license`: 같은 AGPL 선택과 별도 상용 라이선스 제공 주체를 확정한다.
- 콘텐츠의 현행 CC-BY-SA-4.0은 이 결정 패키지에서 유지한다.
- 제3자 자료와 vendored 패키지의 원 라이선스·NOTICE·THIRD_PARTY 범위는 보존한다.

`AGPL-3.0-only`와 `AGPL-3.0-or-later`는 서로 다른 선택이다. 생성기는 둘 중 하나를 추천하거나
법률적 양립성을 판단하지 않는다.

## 생성 절차

1. `license-boundary-decision.template.json`을 저장소 밖으로 복사한다.
2. 저작권 소유·기여자 재라이선스 권한·제3자 고지를 각각 담당 역할이 검토한다.
3. 전략과 software license를 확정하고, dual license이면 상용 라이선스 제공 역할도 기록한다.
4. 전체 결정 검토 후 저장소 밖의 새 출력 경로로 계획을 생성한다.

```powershell
node automation/platform-license-boundary-plan.mjs `
  --profile C:\private\license-boundary-decision.json `
  --output C:\private\license-boundary-plan.json
```

입력과 출력은 저장소 안에 둘 수 없고 기존 출력은 덮어쓰지 않는다. 생성 결과에는 현재
라이선스·README·content schema·직접 의존성·제3자 고지 파일의 해시가 포함된다.

## 적용 경계

`readyForLicenseChangeReview:true`는 변경 검토를 시작할 입력이 갖춰졌다는 뜻일 뿐, 권리 부여나
재라이선스 완료를 의미하지 않는다. 생성기는 `LICENSE`, package metadata, DB를 변경하지 않는다.
실제 변경은 권리자·기여자 권한과 제3자 고지를 확인한 별도 승인 PR에서 수행한다.
