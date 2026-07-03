# 0704 Script-Based Vote Structure Check

검토 기준 파일:

- `2026-07-04_식순_의전형_jh베이스_v1.pptx`
- `20260702-기후시민회의 2차 의제 워크숍 진행 스크립트_v2_070317시.hwpx`

## 핵심 판단

현재 시스템의 기본 의제투표는 15:40~16:20 최종 의제 의결 단계에 맞다. 다만 스크립트에는 초반 의제 통합 논의가 흔들릴 경우 추가 판단 투표가 생길 수 있다. 따라서 0704 운영은 단일 투표가 아니라 `투표 슬롯` 구조로 본다.

## 식순 기준 운영 흐름

| 시간 | 식순/스크립트 단계 | 입력/출력 구조 |
| --- | --- | --- |
| 13:00~13:10 | 경과 리뷰, 1차 의제 결과, 통합 제안 | 화면 표출 중심 |
| 13:00~13:10 분기 | 교육 + 시민참여 의제 통합 동의 여부 확인 | 추가 투표 가능성 있음 |
| 통합 부결 시 | 감축분야 추가 의제 선정 찬반, 적응 의제 2개 배분 찬반 | 추가 투표 가능성 있음 |
| 13:10~13:40 | 국민제안 공유, 감축분야 전문가 발제 | 화면 표출 중심 |
| 13:40~14:10 | 대국민 접수 의제 검토 및 질문 만들기 조별 토론 | 시트입력: A/B 질문입력 |
| 14:10~14:20 | 휴식 및 질문 정리 | 출력: 질문 PDF |
| 14:20~14:50 | 외부자문단 질의응답 | 질문 PDF 기반 진행 |
| 14:50~15:30 | 의제 후보안 선정 조별 토론 | 시트입력: A/B 의제입력 |
| 15:30~15:40 | 휴식, 의제 후보 외부자문단 전달 | 출력: 의제 PDF |
| 15:40~16:20 | 최종 의제 의결 전체 토론 | 의제투표 Form + 버블레이스 |
| 16:20~16:30 | 전체 토론장 이동 및 발표 준비 | 결과 화면 정리 |

## 투표 슬롯 구조

### V0. 의제 통합 동의 투표

- 조건: 교육 의제와 시민참여 의제 통합에 명확한 반대 또는 우려가 있어 전체 확인이 필요할 때
- 질문 예시: `교육 의제와 시민참여 의제를 하나의 통합 의제로 다루는 데 동의하십니까?`
- 선택지 예시: `동의`, `동의하지 않음`, `판단 유보`
- 결과 활용: 동의면 감축 추가 의제 논의로 이동, 부결이면 V1A/V1B 판단으로 이동
- 응답 URL: `https://docs.google.com/forms/d/e/1FAIpQLSc8NV9MvB52WM8IzQFJCGK3HJmZ8e_UOW4cbV6wd3MERohc-Q/viewform`
- 편집 URL: `https://docs.google.com/forms/d/1QXrENjjmh7NcTF_9sm4aUPhnh1_WuAWvP4q80AdBM8s/edit`
- QR asset: `/0704-admin/decision-vote-v0-qr.png`

### V1A. 감축분야 추가 의제 선정 찬반

- 조건: 통합이 부결되었거나, 기존 의제 3개 구조에서 감축분야 보완 여부를 따로 확인해야 할 때
- 질문 예시: `감축분야 추가 의제를 선정하는 데 동의하십니까?`
- 선택지 예시: `찬성`, `반대`, `판단 유보`
- 결과 활용: 감축분야 추가 논의 지속 여부 결정
- 응답 URL: `https://docs.google.com/forms/d/e/1FAIpQLSeyeycU58FPedk64L8E5QeDdvEETgVcnGwJDEC6NEZTrMGOtA/viewform`
- 편집 URL: `https://docs.google.com/forms/d/1YCMzcYk_XLD95_8MvzJAB4ReQKQs4nl7P18o9hBQTk4/edit`
- QR asset: `/0704-admin/decision-vote-v1a-qr.png`

### V1B. 적응 의제 2개 배분 찬반

- 조건: 통합하지 않고 교육/시민참여 의제를 적응분과 안에서 구분해 다루는 방안을 확인해야 할 때
- 질문 예시: `기존 적응분야 의제 2개를 적응분과 내에서 구분해 다루는 데 동의하십니까?`
- 선택지 예시: `찬성`, `반대`, `판단 유보`
- 결과 활용: 기존 의제 유지/배분 방식 결정
- 응답 URL: `https://docs.google.com/forms/d/e/1FAIpQLSfN73ZpueVP0YHcPNiQeMxVdAwPsDUHU8sbG5oW-Bk20oXAUg/viewform`
- 편집 URL: `https://docs.google.com/forms/d/1bdEi3hN6p8qOqWGdJV3f8UK3g4wPDEtojjQakCpDTd4/edit`
- QR asset: `/0704-admin/decision-vote-v1b-qr.png`

### V2. 최종 감축·에너지전환 의제 선정

- 조건: 14:50~15:30 조별 의제 후보안 선정과 15:30~15:40 자문 의견 수합 이후
- 현재 시스템: 기존 `의제투표` Form과 `agenda-vote-0704` 버블레이스 사용
- 입력 원천: A/B 실시간 Sheet의 `A조 의제입력`, `B조 의제입력`
- 결과 활용: 최종 추가 의제 선정 및 발표

## 운영 원칙

1. V0/V1은 필요할 때만 열고, 기본 화면에는 “추가 판단 투표”로 묶어둔다.
2. V2는 현재 의제투표 Form을 그대로 사용한다.
3. 추가 판단 투표는 이미 별도 Form으로 분리되어 있으므로, 기존 의제투표 Form 선택지를 바꾸지 않는다.
4. 결과는 `0704 추가 판단 투표 결과` Sheet에 모은다: `https://docs.google.com/spreadsheets/d/1m_GD3ohvDW1PXT8Gg3AoTxpf0voRdrJpz2a38PREBB8/edit`
5. 결과 갱신 명령은 `pwsh -NoProfile -ExecutionPolicy Bypass -File scripts\refresh-0704-decision-votes.ps1` 이다.
6. 현장 담당자용 매뉴얼에는 복잡한 분기 설명을 넣지 않고, 진행자가 안내하는 QR만 사용하라고 안내한다.
