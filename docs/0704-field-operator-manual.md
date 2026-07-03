# 0704 현장 운영 사용매뉴얼

대상: 기록모더레이터 A, 기록모더레이터 B, 출력·메일 담당자  
목표: 질문 입력, 의제 후보 입력, 인쇄본 출력, 의제투표, 버블레이스 확인까지 현장에서 빠르게 처리한다. 최종 PPT 보완은 별도 작업이다.

## 1. 공통 진입

- 관리자 페이지: https://climate-assembly.org/0704-admin/
- 비밀번호: `climate2026`
- 현장 매뉴얼: https://climate-assembly.org/0704-admin/operator-manual.html
- A/B 실시간 입력 Sheet: https://docs.google.com/spreadsheets/d/1aA0h2wUuKydj-RC7ZeD-bI-9C-7f1MQhe_78t7pA4JQ/edit

관리자 페이지에서 각 URL 옆의 복사 버튼을 눌러 카카오톡이나 화면 공유용 메시지에 붙여넣는다.

## 2. 기록모더레이터 A/B 역할

기록모더레이터는 Google Sheet 하나만 열어두면 된다.

- A조 담당자: `A조 질문입력`, `A조 의제입력` 탭 사용
- B조 담당자: `B조 질문입력`, `B조 의제입력` 탭 사용
- 질문 입력: 전문가에게 물어볼 질문만 한 문장씩 입력
- 의제 입력: 투표 후보가 될 의제 문장만 입력
- 빈 줄은 그대로 두어도 된다. 출력 스크립트는 내용이 있는 줄만 읽는다.

권장 입력 방식:

1. 조별 질문 만들기 시간에는 `질문입력` 탭에만 입력한다.
2. 의제 후보가 확정되는 시간에는 `의제입력` 탭에만 입력한다.
3. 중간 수정이 필요하면 같은 셀을 바로 고친다.
4. 출력 담당자에게 "질문 갱신" 또는 "의제 갱신"이라고 말한다.

## 3. 출력·메일 담당자 역할

출력 담당자는 관리자 페이지와 작업 PC의 PowerShell을 사용한다.

작업 폴더:

```powershell
cd "C:\Users\iceam\OneDrive\_30_컨설팅\2026\기후회의모더레이터\wiki"
```

질문·의제 PDF를 한 번에 최신화:

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File scripts\export-0704-live-sheet-packets.ps1
```

질문·의제 PDF를 최신화하고 메일까지 발송:

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File scripts\export-0704-live-sheet-packets.ps1 -SendEmail
```

생성되는 파일:

- 질문 PDF: https://climate-assembly.org/0704-admin/live-sheet-questions-print.pdf
- 의제 PDF: https://climate-assembly.org/0704-admin/live-sheet-agendas-print.pdf
- 실행 보고서: `evaluation/0704-live-sheet-packets-report.json`

인쇄 순서:

1. PowerShell에서 갱신 명령 실행
2. 관리자 페이지에서 `Sheet 질문 PDF` 또는 `Sheet 의제 PDF` 열기
3. 브라우저 새로고침
4. 인쇄
5. 필요하면 `-SendEmail` 명령으로 `kesica3@gmail.com`에 PDF 발송

## 4. 의제투표 전환

A/B Sheet의 `의제입력` 탭에 후보가 들어오면 투표 Form 선택지로 반영한다.

먼저 미리보기:

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File scripts\promote-0704-live-sheet-agendas-to-vote.ps1
```

문제가 없으면 실제 반영:

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File scripts\promote-0704-live-sheet-agendas-to-vote.ps1 -Apply
```

그 다음 투표 결과 Sheet를 갱신:

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File scripts\refresh-0704-agenda-vote.ps1
```

결과 화면:

- 버블레이스: https://climate-assembly.org/agenda-vote-0704/index.html?sheet=1wbAwRa7ynC12SanI7VJWc-fMea_NmOPVvIAKBLt5Wrw
- Scores Sheet: https://docs.google.com/spreadsheets/d/1wbAwRa7ynC12SanI7VJWc-fMea_NmOPVvIAKBLt5Wrw/edit

## 5. 참여자에게 보낼 URL

- 탄소 감축 질문: https://docs.google.com/forms/d/e/1FAIpQLSeH8fIX-Mjha32u1osfa_aQ2fM8OxAWUCg6_kZsFF33WsCaqA/viewform
- 조별 의제 입력: https://docs.google.com/forms/d/e/1FAIpQLSf6irdECaMygffockxbuSxhsCxOG9WExkxHhtspZT4FhlmouQ/viewform
- 의제투표: https://docs.google.com/forms/d/e/1FAIpQLSf9-AIDhnd0cy8Dfu-xXOgz6cQINjpA-tLzHdM2Ypk8qU_eMA/viewform
- 17~18시 소감발표: https://docs.google.com/forms/d/e/1FAIpQLSccOoHa2gSgIm2EUGqq4zrzkBpr1C6ptsx9HpfYdYLjebINmg/viewform

## 6. 화면 발표 URL

- 온톨로지 그래프: https://climate-assembly.org/workshop-graph-0704/index.html?source=participant-open-questions&mode=showcase&count=50&edgeLabels=on&theme=light&tone=calm
- Miro식 포스트잇: https://climate-assembly.org/miro-0704/index.html
- 분석 기준: https://climate-assembly.org/analysis-criteria-0704/index.html
- 의제투표 버블레이스: https://climate-assembly.org/agenda-vote-0704/index.html?sheet=1wbAwRa7ynC12SanI7VJWc-fMea_NmOPVvIAKBLt5Wrw

## 7. 내일 체크포인트

- 기록모더레이터 A/B가 실시간 Sheet를 열 수 있는지 확인한다.
- 출력 담당자 PC에서 PowerShell 명령이 실행되는지 확인한다.
- 질문 PDF와 의제 PDF가 열리고 인쇄 가능한지 확인한다.
- 의제 후보가 들어온 뒤 `promote` 미리보기 결과를 보고 `-Apply`를 붙인다.
- 투표 후 `refresh-0704-agenda-vote.ps1`을 실행하고 버블레이스를 새로고침한다.

