# Phase C 테넌트 데이터주권 라우팅 계약

## 목적

한국 공공 테넌트는 국내 CSAP 적격 데이터 평면에, 해외 테넌트는 별도 해외 데이터 평면에
고정한다. 브라우저 위치·IP·언어로 리전을 추측하지 않고 승인된 테넌트 등록부만 사용한다.

## 불변식

- 알 수 없는 테넌트는 연결하지 않는다.
- 한국 계약 주체는 `kr_public_csap`, 그 밖의 계약 주체는 `international` 트랙에만 배정한다.
- application/API origin은 리전 간 공유하지 않는다.
- DB·object storage·backup은 같은 국가에 두며 교차 리전 복제와 backup을 허용하지 않는다.
- 암호화 키는 리전 로컬 범위로 관리한다.
- 중앙 라우팅 계층은 참여자 신원·숙의 원문·음성·전사·감사로그·backup을 저장하지 않는다.
- 출력에는 자격증명·token·secret을 포함하지 않으며 실제 DB, DNS, 인프라를 변경하지 않는다.

## 생성 절차

1. `data-residency-profile.template.json`을 저장소 밖으로 복사한다.
2. 인프라 적격성, origin, 저장·backup 국가, 운영 책임 역할을 기관·계약 책임자가 확정한다.
3. 테넌트별 계약 국가, 홈 리전, 승인 역할·시각을 등록한다.
4. 전체 검토를 승인한 뒤 아래처럼 저장소 밖의 불변 출력 경로로 생성한다.

```powershell
node automation/platform-data-residency-plan.mjs `
  --profile C:\private\data-residency-profile.json `
  --output C:\private\data-residency-plan.json
```

생성기는 입력·출력을 저장소 안에 둘 수 없으며 기존 출력 파일을 덮어쓰지 않는다. 결정이
남아 있으면 `readyForIsolatedDeployment:false`와 구체적인 `blockers`를 보존한다.

## 적용 경계

생성된 계획은 배포 입력이지 배포 증거가 아니다. 실제 완료 판정에는 리전별 별도 인프라,
DNS·Auth·DB·storage·backup 설정, 허용/거부 E2E, 재해복구 시험, 기관 검토가 각각 필요하다.
이 절차는 migration 또는 운영 데이터 조작 승인을 대신하지 않는다.
