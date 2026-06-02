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

## Google Sheet 샘플 연동 절차

샘플 데이터(`sample-agenda-questions.csv`)를 Google Sheets에 올려 end-to-end 연동을 테스트하는 절차입니다.

1. `public/sample/sample-agenda-questions.csv` 파일을 Google Sheets에서 열기
   - Google Sheets → 파일 → 가져오기 → 업로드
2. 파일 → 공유 → 웹에 게시 선택
   - 시트: "시트1 (또는 전체 문서)"
   - 형식: "쉼표로 구분된 값(.csv)"
   - "게시" 클릭
3. 생성된 URL 복사 (예: `https://docs.google.com/spreadsheets/d/…/pub?gid=0&single=true&output=csv`)
4. Cloudflare Pages 환경 변수에 추가:
   ```
   PUBLIC_LIVE_SHEET_CSV_URL = <복사한 URL>
   ```
5. 재배포 후 `/ko/moderator/live/` 접속 → "🔗 Google Sheet" 소스 선택
6. Google Sheet 임의 셀 수정 → 30초 후 대시보드에 자동 반영 확인
   - "마지막 갱신: HH:MM:SS" 상태 표시로 확인

**참고**: 환경 변수 미설정 시 "Google Sheet" 선택 시 안내 패널이 표시됩니다.

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

## 인사이트 도구 사용법

### 도구 1 — 의제×키워드 히트맵 (`/ko/moderator/insights/heatmap`)

18개 의제 영역(행)과 63개 키워드(열)의 빈도 교차표를 SVG 히트맵으로 표시합니다.

- **셀 호버**: 해당 영역×키워드 빈도 수치 툴팁
- **셀 클릭**: 우측 패널에 해당 의제 목록 + 문맥 발췌
- **영역 필터**: 상단 셀렉트에서 감축/적응/혼합 선택
- **선택 해제**: "선택 해제" 버튼 또는 같은 셀 재클릭
- 키워드 색상 범례: 좌하단 비리디스 그라디언트 바 (0회~최대 회)
- 워크숍 현장에서는 특정 주제(예: "재생")가 몇 개 영역에 걸쳐 있는지 빠르게 확인하는 용도

### 도구 2 — 네트워크 클러스터 분석 (`/ko/moderator/insights/clusters`)

6개 네트워크(감축·현황 / 감축·정책 / 감축·기대효과 / 적응·현황 / 적응·정책 / 적응·기대효과)를 탭으로 전환합니다.

- **탭 클릭**: 해당 네트워크 클러스터 카드 전환
- **카드 "관련 의제 N건" 클릭**: 해당 클러스터 Row 참조에 매핑된 의제 카드 확장
- **Row 칩**: 전배석 분석 PDF의 Row 번호 (Row N = 의제 id N)
- **URL 해시**: `#network=감축-현황&cluster=0` 형태로 딥링크 가능

### 시뮬레이션 데이터 선택 가이드

대시보드 상단의 데이터 소스 선택 바에서 목적에 따라 선택하세요.

| 옵션 | 행수 | 용도 |
|------|------|------|
| 📊 더미 데이터 (104행) | 104 | 과거 워크숍 그대로의 실제 페이스 확인용. 전체 흐름과 전문가 분포를 확인할 때 사용. |
| 🌱 의제 샘플 (5행) | 5 | 빠른 데이터 흐름 확인용 (약 5분). UI 작동 여부만 확인할 때 사용. |
| 🌳 의제 샘플 15조 (30행) | 30 | **6.13 워크숍 실전 페이스 시뮬레이션용 — 권장.** 15개 분임조 × 2질문, 14:00~15:42 (15분 휴식 포함), 약 90분 풀세션 추정. 운영 리허설 기본 데이터. |
| 🔗 Google Sheet | 실시간 | **본방용.** 실제 워크숍 당일 사무국이 입력하는 Google Sheets에 연결. 30초마다 자동 갱신. |

> 기본 선택은 🌳 의제 샘플 15조입니다. sessionStorage에 이전 선택이 저장된 경우 그 값이 복원됩니다. 기본값으로 되돌리려면 브라우저 개발자 도구 → Application → sessionStorage → `mod-sim-state` 항목을 삭제하세요.

---

## 데이터 파이프라인 재생성

의제나 PDF 분석 결과가 업데이트된 경우 스크립트를 재실행:

```bash
cd wiki
python3 scripts/build-network-data.py
```

출력 파일:
- `src/data/agendas-65.json` — 65건 의제
- `src/data/domain-keyword-matrix.json` — 18×63 행렬
- `src/data/network/clusters.json` — 21개 클러스터
- `src/data/network/cluster-to-agendas.json` — Row 참조 매핑

---

## 미해결: 진짜 force-directed 네트워크

### 블로커

현재 클러스터 페이지는 전배석 분석의 **클러스터명·Row 참조·서술**만 정적으로 표시합니다.
D3.js force-directed 그래프(키워드 노드 + 공동출현 엣지)를 구현하려면 **엣지 데이터**가 필요합니다:

- 키워드 간 공동출현 행렬 (edge list: keyword_A, keyword_B, weight)
- 또는 원본 Gephi 파일 (.gexf)
- 또는 R/Python igraph 객체 export

### 요청 템플릿 (전배석에게 전달)

> 안녕하세요, 전배석 선생님.
>
> 기후시민회의 모더레이터 시각화 도구를 구현하고 있습니다.
> 5월 29일 분석 결과(네트워크 기반 의미분석)를 바탕으로 인터랙티브 네트워크 그래프를 추가하고 싶습니다.
>
> 다음 중 하나를 공유해 주실 수 있을까요?
> 1. Gephi 원본 파일 (.gexf) — 6개 네트워크 각각
> 2. 엣지 리스트 CSV (keyword_A, keyword_B, cooccurrence_weight)
> 3. R igraph 또는 Python networkx 객체 (pickle/RDS)
>
> 파일이 크거나 공유가 어려운 경우, 각 네트워크별 Top 50 엣지만 추출한 CSV도 충분합니다.

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
