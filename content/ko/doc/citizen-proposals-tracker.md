---
slug: citizen-proposals-tracker
title: "시민 발의 의제 트래커 (climatevoice.kr 실시간 연동)"
doc_type: case
order: 6
license: CC-BY-SA-4.0
last_updated: 2026-06-01
---

# 시민 발의 의제 트래커

> **메타데이터**
> - 외부 출처: [climatevoice.kr/opinion/list.do](https://climatevoice.kr/opinion/list.do) (국가기후위기대응위원회 공식 포털)
> - 라이브 시트: [Google Sheets](https://docs.google.com/spreadsheets/d/1cEA11mDIKGb_UCZP1iaMmtDYUMJuKoZqEhFKwo7u2HE)
> - 갱신 주기: 매주 월요일 08:00 KST (자동)
> - 신뢰 등급: author-verified

## 개요

공식 포털 **climatevoice.kr**에 시민이 발의한 의제를 실시간으로 집계합니다. 매주 월요일 자동 수집·태깅·시각화하여, 모더레이터가 시민 의지의 흐름을 한눈에 파악할 수 있도록 합니다. 자동화 스크립트(`20_스크립트/climatevoice_scraper/`)는 Windows Task Scheduler로 매주 실행되며, 수집 결과는 위 구글 시트에 누적 저장됩니다.

## 현재 수치 (2026-06-01 기준)

- **총 발의: 31건**
- 날짜 범위: 2026-05-15 ~ 2026-05-31
- 분과별 분포:
  - 감축1(에너지·전력): 5건
  - 감축2(산업·수송·건물): 7건
  - 적응(자연·도시): 3건
  - 메타(거버넌스·문화): 14건
  - 미분류: 3건
- 좋아요 1개 이상 의제: 5건

## 라이브 시트

[구글 시트 열기 →](https://docs.google.com/spreadsheets/d/1cEA11mDIKGb_UCZP1iaMmtDYUMJuKoZqEhFKwo7u2HE/edit)

시트는 두 개 탭으로 구성됩니다.

### `climatevoice` 탭 — 원자료

31건 시민 발의 의제의 한글 헤더 18~19컬럼 누적본. 매주 월요일 08:00에 자동 갱신됩니다.

### `대시보드` 탭 — 시각화

- **5개 카드**: 총 발의 / 신규 / 갱신 / 유지 / 좋아요 1+
- **4 차트**: 분과별 분포 · En-ROADS 레버 TOP 10 · 좋아요 TOP 10 의제 · 최근 14일 신규 의제
- **3 스코어카드**: 수집 현황·신규/갱신/유지 지표
- **히트맵**: 분과 × En-ROADS 레버 격자

## 좋아요 1+ 의제 (위키 페이지 시드 대상)

현재 시점에서 시민의 호응을 1건 이상 받은 의제는 다음 6건입니다 — 향후 개별 위키 페이지로 확장 예정입니다.

- **citizen-1** — 웹사이트 탄소발자국 인식
- **citizen-6** — 분리수거 편의 개선
- **citizen-18** — 그린존(공동주택 무인 중고거래)
- **citizen-26** — 웹 리소스 최적화 가이드라인
- **citizen-27** — 도심 나무 그늘 / 쿨링로드
- **citizen-31** — 일상에서의 웹사이트 탄소

## 운영 메커니즘

- **크롤러**: `climatevoice.kr/opinion/list.do?pageNo=N` AJAX endpoint를 순회하며 페이지별 의제 목록·상세·좋아요 수를 파싱.
- **자동 실행**: 매주 월요일 08:00 Windows Task Scheduler 호출 → `climatevoice_scraper` 스크립트 실행 → Google Sheets API로 시트 업서트.
- **컬럼 구조**: 의제ID / 제목 / 등록일 / 작성자(마스킹) / 카테고리 / 본문 / 좋아요 / En-ROADS 레버(자동 태깅) / 모더레이터_레버보정(수동) / 분과(매트릭스 v5) / 모더레이터메모(수동) 등.
- **수동 컬럼 보존**: 모더레이터 보정 컬럼(O, P)은 자동 갱신 시 **절대 덮어쓰지 않습니다**. 모더레이터가 한 번 입력한 보정·메모는 영구 보존됩니다.

## 모더레이터·연구 의제(master)와의 관계

본 트래커는 **공식 시민 발의 input 풀**이고, [위키 의제(/ko/agenda/)](/ko/agenda/)는 모더레이터·운영진이 정리한 **master 의제 15건**입니다. 두 트랙은 명확히 분리되어 운영됩니다 (**A안**).

```
공식 시민 발의 (이 트래커, climatevoice.kr 시트, 31건+)
    │
    ↓ 6.13~14 기획참여단 워크숍에서 선정·통합
    ↓
위키 의제 master (/ko/agenda/, 15건)
    │
    ↓ 본회의 6회차에서 분과별 종합라운드 진행
```

### 위키 의제 master 15건 빠른 링크

| 분과 | 의제 |
|---|---|
| 감축1 | [01 핵발전 vs 재생E](/ko/agenda/01-nuclear-vs-renewable/) · [02 전기요금](/ko/agenda/02-electricity-price/) · [03 지자체 GHG](/ko/agenda/03-seoul-metro-gap/) · [04 내연기관 퇴출](/ko/agenda/04-ice-vehicle-phaseout/) |
| 감축2 | [11 AI 데이터센터](/ko/agenda/11-ai-datacenter/) · [12 개도국 9변수](/ko/agenda/12-developing-9vars/) · [13 재생E 제로섬](/ko/agenda/13-renewable-zerosum/) |
| 적응 | [05 기후불평등](/ko/agenda/05-climate-injustice/) · [06 생활규제](/ko/agenda/06-lifestyle-regulation/) · [07 개도국 지원](/ko/agenda/07-developing-country-support/) · [08 ESG/RE100](/ko/agenda/08-esg-re100/) |
| 메타 | [09 이행 점검권](/ko/agenda/09-implementation-monitoring/) · [10 광역→기초 다층 확산](/ko/agenda/10-national-to-local/) · [14 기후배당](/ko/agenda/14-climate-dividend/) · [15 복합취약성](/ko/agenda/15-compound-vulnerability/) |

## 의제 매트릭스 v5와의 연결

[의제 매트릭스 v5](/ko/doc/agenda-matrix-v5/) — 18개 En-ROADS 레버 × 3분과 격자.

시민 발의 의제는 매트릭스 v5에서 ⚪ 빈칸으로 표시된 영역 — **가스·신기술·바이오·건물효율·인구·폐기물** 등 — 을 채우는 후보 풀로 운영됩니다. 트래커는 단순 집계가 아니라 매트릭스 보완을 위한 **콘텐츠 파이프라인**입니다.

## 데이터 인용 시 출처 표기

- **원자료**: 국가기후위기대응위원회 climatevoice.kr (공식 포털, 공공저작권 추정)
- **가공·태깅·시각화**: climate-assembly.org 운영팀 (CC BY-SA 4.0)

본 페이지에서 인용된 수치·분류·시각화 결과를 재사용하실 때는 위 두 출처를 함께 표기해 주세요.

## 시트 공개 권한 (운영 메모)

> ⚠️ **운영자 안내**: 본 페이지의 구글 시트 링크가 방문자에게 정상 표시되려면 시트의 공유 설정이 **"링크가 있는 모든 사용자: 보기 권한"** 이상이어야 합니다.
>
> - **보기 권한**: 일반 위키 방문자 (전체 공개 권장)
> - **편집 권한**: 모더레이터 보정 컬럼(O, P) 작업자 (모더레이터 팀만)
>
> 시민 발의 자체가 공공 자료이므로, 보기 권한 전체 공개는 라이선스·프라이버시 측면에서 문제 없습니다(작성자명은 이미 마스킹 처리됨).
