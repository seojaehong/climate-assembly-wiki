---
slug: moderator-live-setup
title: 모더레이터 라이브 대시보드 운영 가이드
draft: true
doc_type: guide
order: 99
license: CC-BY-SA-4.0
last_updated: "2026-06-02"
---

# 모더레이터 라이브 대시보드 운영 가이드

> draft: true — 이 문서는 공개되지 않습니다. 라이브 대시보드 운영 준비 전 리허설 체크리스트로 활용하세요.

---

## 1. Google Sheets 컬럼 스키마

라이브 연동 시 Google Sheets의 첫 행(헤더)은 반드시 아래 컬럼명을 사용해야 합니다.

| 컬럼명 | 설명 | 예시 |
|--------|------|------|
| `순번` | 발언 순서 (정수) | 1, 2, 3 … |
| `지역` | 시민 지역명 | 서울, 부산(미래) |
| `분임` | 분임조 번호 또는 명칭 | 4, 미래 |
| `답변자` | 배정 전문가 이름 (공인) | 김형준, 공통 |
| `내용` | 시민 발언 내용 (익명화 완료본) | "(시민A) 감축 목표가…" |
| `예정시간` | 예정 발언 시각 (HH:MM) | 14:38 |
| `상태` | 모더레이터가 실시간 입력 | pending / 진행중 / 완료 |

### 상태 컬럼 입력 가이드 (모더레이터용)

- `pending` — 아직 발언 전 (기본값)
- `진행중` — 현재 마이크 앞 시민
- `완료` — 발언 종료, 전문가 응답 완료

---

## 2. Google Sheets → CSV 공개 절차

1. Google Sheets 열기 → 파일 → 공유 → 웹에 게시
2. "쉼표로 구분된 값(.csv)" 선택 → 게시
3. 생성된 URL 복사 (예: `https://docs.google.com/spreadsheets/d/.../pub?gid=0&single=true&output=csv`)
4. Cloudflare Pages 환경 변수에 추가:
   ```
   PUBLIC_LIVE_SHEET_CSV_URL = <복사한 URL>
   ```
5. `src/pages/[lang]/moderator/live.astro` 상단 TODO 블록의 주석을 해제하고 JSON import를 교체:
   ```ts
   const SHEET_CSV_URL = import.meta.env.PUBLIC_LIVE_SHEET_CSV_URL;
   const data = await fetch(SHEET_CSV_URL).then(r => r.text()).then(parseCSV);
   ```

---

## 3. PII 처리 옵션 3가지

### 옵션 A: 사전 익명화 (현재 방식)
- 모더레이터 또는 사무국이 Sheets에 입력 전 이름을 (시민A), (시민B)로 변환
- 가장 안전 — URL 추측으로 접근해도 원본 이름 없음
- 단점: 실시간 입력 시 익명화 수작업 필요

### 옵션 B: Private Fetch (서버사이드)
- Sheets를 비공개로 유지, Google Service Account로 서버에서만 읽기
- Cloudflare Worker 또는 Astro SSR Edge로 구현
- 장점: PII가 브라우저에 전달되지 않음 / 단점: 추가 인프라 필요

### 옵션 C: Unguessable URL (현재 방식 + 추가 보안)
- `/moderator/live/` URL 자체를 추측 불가능하게 변경
- 예: `/moderator/x7k9p2/live/` (무작위 세그먼트)
- robots noindex + 비링크 상태에서 실질적 보안 충분
- 단점: URL 변경 시 참여자 재공유 필요

---

## 4. 리허설 체크리스트

### D-7 (워크숍 1주 전)
- [ ] Google Sheets 스키마 확인 (위 컬럼명 일치 여부)
- [ ] "웹에 게시" CSV URL 생성 및 테스트 curl
- [ ] `PUBLIC_LIVE_SHEET_CSV_URL` Cloudflare 환경변수 등록
- [ ] 시뮬레이션 데이터로 `/ko/moderator/live/` 작동 확인

### D-3 (3일 전)
- [ ] 실제 Sheets 데이터로 교체 후 빌드 테스트
- [ ] 노트북(발표용) 브라우저에서 URL 접속 확인
- [ ] 프로젝터 해상도에서 텍스트 가독성 확인 (최소 3m 거리)
- [ ] 키보드 단축키 테스트: Space(재생), →(다음), ←(이전)

### D-1 (전날)
- [ ] 익명화 최종 확인 — 실제 이름이 내용 컬럼에 없는지 검토
- [ ] 배터리 / 전원 연결 확인
- [ ] 백업 URL (인쇄본 또는 별도 기기) 준비

### 워크숍 당일
- [ ] 페이지 열고 일차/채널 필터 설정
- [ ] 속도 1x 확인 (기본 10초 간격)
- [ ] 비상 시: 브라우저 새로고침 → sessionStorage에서 위치 복원됨

---

## 5. 향후 프로덕션 전환 포인트

`live.astro` 상단 `is:inline` 스크립트의 TODO 블록을 찾아 교체:

```ts
// BEFORE (시뮬레이션)
const data = simQuestions;

// AFTER (Google Sheets 실시간)
const SHEET_CSV_URL = import.meta.env.PUBLIC_LIVE_SHEET_CSV_URL;
const data = await fetch(SHEET_CSV_URL).then(r => r.text()).then(parseCSV);
```

`parseCSV` 유틸리티는 헤더 행 기반으로 JSON 배열을 반환하는 단순 파서면 충분합니다 (Papa Parse 또는 직접 구현 30줄).
