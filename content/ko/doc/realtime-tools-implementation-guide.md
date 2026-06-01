---
title: "실시간 도구 구현 가이드 (오픈소스 vs 유료, 우리 사이트 도입 한계)"
slug: realtime-tools-implementation-guide
doc_type: reference
license: CC-BY-SA-4.0
last_updated: 2026-06-01
order: 86
---

## 실시간 도구 구현 가이드 — 오픈소스 vs 유료, 우리 사이트 도입 한계

### 0. 목적

앞 페이지 [`/ko/doc/realtime-tools-for-moderators/`](/ko/doc/realtime-tools-for-moderators/) 가 도구 목록과 권장 조합을 다룬다면, 본 페이지는 **실제 구현 방법·매뉴얼·우리 사이트(climate-assembly.org) 도입 한계**를 정리한다. 1인 운영·연간 5만원 예산이라는 현실 제약 위에서 어떤 도구를 어디까지 끌어올 수 있는지 판단하는 기준 문서다.

---

### 1. 오픈소스 vs 유료 매트릭스

| 도구 | 라이선스 | 자체호스팅 | 즉시 도입 |
|---|---|---|---|
| POL.IS | AGPLv3 | ✅ | Tier 1 |
| Decidim | AGPLv3 | ✅ | Tier 1 |
| Loomio | AGPLv3 | ✅ | 협동조합 가격 |
| 빠띠(Parti) | 비영리 무료 | ❌ SaaS | 한국 표준 |
| Mentimeter | 상용 SaaS | ❌ | 유료 $12/월 |
| Slido | 상용 SaaS | ❌ | 유료 $12.5/월 |
| Miro | 상용 | ❌ | 무료 3 보드 / $8~ |
| Mural | 상용 | ❌ | 동상 |
| FigJam | 상용 | ❌ | 동상 |
| Kahoot! | 상용 | ❌ | 무료 50명 |
| Poll Everywhere | 상용 | ❌ | 무료 40명 |
| CitizenLab | 상용 EU | ❌ | 유료 |
| 구글폼 + Sheets | 무료 (구글) | ❌ | 즉시 |

오픈소스 3종(POL.IS·Decidim·Loomio)은 모두 AGPLv3 — 자체 수정·재배포는 가능하나 SaaS 형태로 제공할 때 소스 공개 의무가 따른다. 우리 위키 운영 차원에서는 단순 자체호스팅 사용이므로 라이선스 부담은 없다.

---

### 2. POL.IS 자체호스팅 매뉴얼 (Tier 1)

**왜 POL.IS인가**: vTaiwan(대만)·핀란드 정부·Climate Assembly UK가 채택한 검증된 도구. 의견 클러스터링(머신러닝)이 들어가 있어 단순 투표·설문과 차원이 다르다. AGPLv3 무료.

**Docker Compose 절차**:

```bash
git clone https://github.com/compdemocracy/polis
cd polis
cp example.env .env
# .env 편집 (DOMAIN_OVERRIDE=polis.climate-assembly.org 등)
./CHANGEME-DOCKER-COMPOSE-PROD-letsencrypt-init.sh
docker compose up -d
```

**서버 요구사항**:

- VPS 4GB+ (DigitalOcean $6/월~, Vultr $12/월, AWS Lightsail)
- PostgreSQL 13+ (Docker 이미지 내장)
- 도메인: `polis.climate-assembly.org` (서브도메인 분리 권장)
- Let's Encrypt SSL 자동(스크립트 내장)

**소요 시간·난이도**:

- 첫 설치: 4~8시간 (DNS·SSL 포함)
- 익숙해진 후: 1시간 운영
- 난이도: ★★★ (Docker + Postgres + SSL 운영 경험 전제)
- 1인 운영: 가능하나 부담 — 자원봉사 1명 확보 권장

**우리 사이트 통합**:

- climate-assembly.org는 정적 Astro 사이트 → POL.IS는 동적 서버 — **별도 서브도메인 권장**(같은 호스트에 강제로 합치지 말 것)
- 위키 페이지에서는 POL.IS 대화방으로 **외부 링크**만 걸고, 결과(투표·클러스터 시각화)는 정기적으로 캡처·인용

---

### 3. Decidim 자체호스팅 매뉴얼

**왜 Decidim인가**: 스페인 바르셀로나 시민참여 표준, EU 시민참여 사실상 표준. AGPLv3. 다만 풀스택(제안·투표·예산·일정 통합)이라 무겁다.

```bash
# Docker 방식
docker run -d -p 3000:3000 decidim/decidim:latest
# 또는 Ruby on Rails 소스 빌드
```

**서버**: VPS 8GB+ (Rails 메모리 사용 큼), PostgreSQL + Redis 필요.

**소요 시간**: 1~2일 (Rails 의존성 복잡)
**난이도**: ★★★★ (Ruby on Rails 운영 경험 필요)
**1인 운영**: ❌ 추천 안 함

**대안**: Decidim 공식 SaaS 호스팅 파트너(월 $99~) 검토. 자체호스팅보다 비싸지만 1인 운영 환경에서는 합리적.

---

### 4. 빠띠(Parti) 활용 — Tier 1, 한국

**왜 빠띠인가**: 한국 시민참여 사실상 표준. 비영리 운영, 무료. 한국어 UI·한국 사례 풍부.

**절차**:

1. parti.coop 가입
2. "그룹" 만들기 — 예: `climate-assembly-2026`
3. 의제 등록·찬반 투표·자유토론 게시
4. 우리 위키에서 외부 링크로 안내

**한계**: SaaS만 제공, 자체호스팅 불가. 단 한국어 UI·운영진 지원이 잘 정비되어 있어 모더레이터·시민 모두 학습 부담이 가장 적다.

---

### 5. 구글폼 + Sheets 매뉴얼 (즉시, 김상규 1순위)

**왜 구글폼인가**: 무료, 즉시, 학습곡선 0. 김상규 강의(2026-05-31)에서 "가장 편함"으로 언급. climatevoice 시트 자동화와 동일한 워크플로.

**절차**:

1. 구글폼 생성 — 의제별 찬반·자유의견 문항
2. 응답을 구글 시트로 자동 연동
3. 시트에서 차트(PIE·BAR·시계열) 자동 생성
4. 회의장 대형 화면에 시트·차트 그대로 노출

**위키 통합**:

- 회기마다 구글폼 1개 + 시트 1개를 일관 명명(`session-NN-form`)
- 시트 데이터 → climate-assembly.org 위키에 표·차트로 인용

---

### 6. Mentimeter / Slido 유료 검토

**Mentimeter**:

- 무료: 2 질문/세션 — 시민회의용으로는 부족
- Basic $12/월: 무제한 질문 — 적정선
- Pro $25/월: 다중 사용자 운영팀
- 7~11월 5개월 × $12 ≈ **약 8만원 예산** (연 5만원 예산 약간 초과)

**Slido**:

- 무료: 100 참가자 1세션 — 본회의에는 부족하지만 분임토의에는 충분
- Basic $12.5/월

두 도구 모두 자체호스팅 불가. 결제 종료 시점 이후 데이터 export(CSV) 백업 필수.

---

### 7. 우리 사이트 도입 한계 (1인 운영 + 5만원/년)

| 도입 가능 | 도구 | 운영 부담 |
|---|---|---|
| 즉시 | 구글폼+Sheets · 빠띠 외부 링크 · POL.IS·Decidim 외부 링크 | ★ |
| 자원봉사 1~2명 확보 시 | POL.IS 자체호스팅 (별도 VPS) | ★★★ |
| 유료 결제 결정 시 | Mentimeter / Slido 5개월 × $12 | ★★ |
| 불가능 (M3까지) | Decidim 자체호스팅 · 다중 SaaS 동시 운영 | ★★★★ |

핵심 판단: **자체호스팅 = 자원봉사 확보 전 결정 금지**. 단일 운영자가 본업과 병행할 수 있는 한계는 SaaS 외부 링크 + 구글폼/Sheets 까지.

---

### 8. 권장 로드맵 (M3 6.30까지)

- **W04 (6.6~6.13)**: 구글폼 + Sheets로 분임 응답 시범 운영 (학습곡선 0, 즉시 검증)
- **W04**: 7.4 4차 회의용 Mentimeter Basic 결제 활성화 ($12)
- **W05~06**: 빠띠 그룹 개설 — climatevoice.kr와 별개로 우리 위키 토론 공간 확보
- **W10~12**: POL.IS 자체호스팅 검토 (자원봉사자 확보 시점에 한정)

---

### 9. 모더레이터 사전 학습 권고

| 도구 | 권장 학습시간 |
|---|---|
| Mentimeter / 빠띠 | 1~2시간 |
| POL.IS | 데모(pol.is/home) 1회 체험 |
| 구글폼 + Sheets | 30분 |

회의 직전 도구를 처음 만지는 일은 피한다. 본 위키 페이지를 모더레이터 워크숍(6.13~14) 사전배포 자료에 포함.

---

### 10. 운영진 미해결·우리 권고

김상규 강의(2026-05-31): "비주얼하게 만드는 거… 팁 주시면 좋겠다" — 운영진 차원의 시각화 도구가 미정 상태로 남았다.

**우리 권고 우선순위**:

1. **1순위: Mentimeter** — 안정성·검증, 모더레이터 학습 부담 낮음
2. **2순위: 빠띠** — 한국어 UI·무료·한국 사례 다수
3. **3순위: POL.IS** — 학술적 신뢰도·클러스터링 분석. 단 자체호스팅 부담

6.13~14 워크숍 시점에 운영진·모더레이터 합의로 1개 확정 권장. 도구 다중운영은 모더레이터 인지 부담을 증폭시키므로 회기 단위로 1개 고정한다.

---

### 11. 출처

- 김상규 2교시 강의 — [`/ko/doc/lecture-2-kim-sang-gyu/`](/ko/doc/lecture-2-kim-sang-gyu/)
- POL.IS — github.com/compdemocracy/polis
- Decidim — github.com/decidim/decidim
- 빠띠 — parti.coop
- vTaiwan — info.vtaiwan.tw
- Climate Assembly UK·코리아스픽스·환경운동연합 사례 — 본 위키 사례 페이지 참조
