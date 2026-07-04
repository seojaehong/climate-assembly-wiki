# 0704 버블레이스 더미 연동 점검

생성: 2026-07-04 10:30 KST

## 결론

- `/agenda-vote-0704/index.html?demo=full`은 `data-demo-full.json`을 정상 사용한다.
- 더미 모드에서는 `SHEET_ID`가 `null`로 고정되어 라이브 Sheet 대신 샘플 JSON만 표시한다.
- 라이브 모드에서는 `?sheet=1wbAwRa7ynC12SanI7VJWc-fMea_NmOPVvIAKBLt5Wrw` 기준으로 `Scores` 탭을 5초마다 폴링한다.
- 관리자 페이지에는 라이브 버블레이스와 샘플 버블레이스 버튼이 모두 연결되어 있다.

## 더미 데이터

- 후보 수: 10건
- 페이즈: `pre`, `c1`, `c2`, `c3`, `c4`, `total`
- 더미 참여자 수 표시: 64명
- 점수 범위: 1.0~4.9

상위 3개 더미 결과:

1. 공공건물·학교 에너지: 4.69
2. 시민 인센티브: 4.55
3. 기업 감축 공개: 4.29

## 브라우저 점검

- URL: `https://climate-assembly.org/agenda-vote-0704/?demo=full&v=manualcheck`
- 페이지 타이틀: `7.4 의제투표 결과 — 2026 기후시민회의`
- 상태 표시: `DEMO`
- SVG: 1개
- Circle: 30개
- Text: 48개
- 후보명 렌더링: 확인

## 테스트

- `npm.cmd exec -- vitest run scripts/decision-vote-console.test.mjs`
- 결과: 1개 파일, 11개 테스트 통과

## 운영 URL

- 샘플 버블레이스: `https://climate-assembly.org/agenda-vote-0704/index.html?demo=full`
- 라이브 버블레이스: `https://climate-assembly.org/agenda-vote-0704/index.html?sheet=1wbAwRa7ynC12SanI7VJWc-fMea_NmOPVvIAKBLt5Wrw`
