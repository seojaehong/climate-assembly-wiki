---
title: "실시간 도구 종합 세팅 쿡북 — 10종 비교 + 의제 13건 × 질문 풀 + 현장 운영"
slug: realtime-tools-setup-cookbook
doc_type: guide
license: CC-BY-SA-4.0
last_updated: 2026-06-02
order: 87
---

## 실시간 도구 종합 세팅 쿡북 — 10종 비교 + 13의제 질문 풀 + 현장 운영 매뉴얼

> 본 페이지는 [`/ko/doc/realtime-tools-for-moderators/`](/ko/doc/realtime-tools-for-moderators/)(도구 16종 선정 매트릭스)·[`/ko/doc/realtime-tools-implementation-guide/`](/ko/doc/realtime-tools-implementation-guide/)(오픈소스 vs 유료 도입 로드맵) 다음 단계인 **모더레이터용 실행 쿡북**이다. 분임 12명·본회의 200명 환경에서 Mentimeter(1순위)·Slido(2순위)·빠띠(한국 표준)·POL.IS(합의도출)·Decidim(참여플랫폼)·Miro/Mural/FigJam(디지털 화이트보드)·Poll Everywhere(SMS 폴백)·Kahoot(아이스브레이커)을 곧바로 띄울 수 있도록 도구 비교·계정 생성·질문 풀·현장 장애 대응까지 한 문서로 정리한다.

---

### 1. 목적 & 사전조건

**대상**: 2026 기후시민회의 분임 모더레이터(분과별 5조 × 12명 = 60명 단위 운영자), 운영진(7~11월 5개월).

**전제**:
- 회의장 Wi-Fi 또는 LTE/5G 신호 — 시민 1인 1단말(스마트폰) 응답.
- 영사 환경 — 분임 1조 1대(노트북 + 빔/대형 모니터), 본회의 메인 스크린.
- 모더레이터는 Mentimeter 발표자 화면(presenter view)을 따로 시인할 수 있는 보조 화면(노트북 본체) 권장.

**사전조건**:
- 운영진(또는 모더레이터 대표) Google 계정 1개로 Mentimeter 가입.
- 모더레이터는 *발표 참여*만 하므로 별도 계정 불필요. 발표자 1명이 voting code(6자리)·QR을 화면에 띄우면 시민·모더레이터 모두 동일 방식으로 응답.
- 7월 4일 4차 본회의(En-ROADS 시연일) 전까지 결제·시범운영 완료가 합리적 데드라인.

---

### 2. 도구 10종 한눈 비교 매트릭스 (2026-06 기준)

권장 우선순위(상단부터)로 정렬. 비용·무료 한도는 각 도구 공식 페이지(`/plans`)를 결제 직전 재확인. "200명 무료?"는 한 세션에서 200명 동시 응답이 무료 한도로 가능한가의 의미.

| # | 도구 | 유형 | 비용 (유료 기본) | 200명 무료? | 한국어 UI | 시각화 강점 | 모더레이터 학습부담 |
|---|------|------|--------|--------|---------|---------|---------|
| 1 | **Mentimeter** | 실시간 응답·시각화 | $168/년 (Basic) | ⚠️ 월 50명 누적 cap | 응답화면 ✅ / 운영 EN | Word Cloud · Scale · Ranking · 100 Points · Quiz | ★★ |
| 2 | **Slido** | Q&A·실시간 응답 | $12.5/월 (Engage) | ⚠️ 무료 100명 cap | 응답화면 ✅ / 운영 EN | **Q&A upvote** · Webex/Teams/Zoom 깊은 통합 | ★★ |
| 3 | **빠띠 (Parti)** | 한국형 시민참여 SaaS | **무료** (비영리) | ✅ 무제한 | **완전 한국어** | 의제 누적 · 찬반 · 자유토론 | ★ |
| 4 | **POL.IS** | 합의도출·클러스터링 | 오픈소스 무료 / pol.is SaaS 무료 | ✅ 무제한 | 시민 인터페이스 부분 | **2D 의견 클러스터** · 머신러닝 의견군 도출 | ★★★ |
| 5 | **Decidim** | 참여 플랫폼 풀스택 | 오픈소스 무료 (Rails 자체호스팅) / 파트너 SaaS $99~ | ✅ 무제한 | 다국어 i18n ✅ | 제안·투표·예산·일정 통합 | ★★★★ |
| 6 | **Miro** | 디지털 화이트보드·포스트잇 | $8/월~ (Starter) | ⚠️ 무료 3보드·편집자 한정 | EN 위주 | 무한 캔버스 · 템플릿 다수 · Climate Assembly UK 사용 | ★★★ |
| 7 | **Mural** | 디지털 화이트보드 | $9.99/월~ (Team+) | ⚠️ 무료 3 mural | EN | 퍼실리테이터 기능 · 셀 잠금·타이머 | ★★★ |
| 8 | **FigJam** | 디지털 화이트보드 (Figma) | $3/월 (collaborator) | ⚠️ 무료 3파일 | EN | 스티커·도장·AI 정리 · Figma 연동 | ★★ |
| 9 | **Poll Everywhere** | 실시간 응답 (SMS 가능) | $42/월~ (Present) | ❌ 무료 25명 | 응답화면 ✅ / 운영 EN | **SMS 응답** (저대역폭 폴백) · Word Cloud · Quiz | ★★ |
| 10 | **Kahoot!** | 게임형 퀴즈 | $19/월~ (Pro) | ⚠️ 무료 Basic 40명 | ✅ 한국어 OK | 게임 UI · 리더보드 · 음악 | ★ |

**보완 도구**: En-ROADS 기후·정책 시뮬레이터 — 본 쿡북에서는 다루지 않고 [`/downloads/en-roads-moderator-card-v1.html`](/downloads/en-roads-moderator-card-v1.html) 별도 카드 참조. Jamboard는 2024-12-31 Google 공식 종료(구글 워크스페이스 도움말, 2024). 기존 보드는 FigJam·Miro·Mural로 마이그레이션 필요.

운영 원칙: **회기 단위로 1개 고정**. 한 회기 내에 2개 이상의 실시간 응답 도구를 섞으면 모더레이터·시민 모두 인지 부담이 증폭된다. 기본 조합 권장 = `Mentimeter(분임 응답) + Slido(본회의 전문가 Q&A) + 빠띠(회기 사이 비실시간 의제 누적)`.

---

### 3. Mentimeter — 1순위 (분임·본회의 실시간 응답 표준)

**한 줄 요약**: 스웨덴 발 시민의회·교육 표준 응답 도구. Word Cloud·Scale·Ranking·100 Points·Quiz 등 9종 슬라이드를 한 발표 안에서 자유 혼합.
**공식 사이트**: https://www.mentimeter.com/
**요금 (2026-06 기준)**: Free $0 / **Basic $168/년 (약 ₩23만, 권장)** / Pro $336/년 / Enterprise 별도견적 (mentimeter.com/plans)
**무료 한도**: 한 발표 슬라이드 무제한이나 *월 50명 누적 응답자 cap (30일 리셋)* — 시민회의에는 부적합 (Mentimeter Help "What is included in the free account?")

#### 3.1 계정 생성 & 요금제 선택

##### 가입 절차

1. `mentimeter.com` 접속 → 우상단 **"Sign up"** 클릭.
2. **"Continue with Google"** 또는 이메일·비밀번호 입력. 조직 메일을 권장(권한 양도 용이).
3. 사용 목적 설문 — "Education / Work / Other" 중 **Work** 선택. (Education은 학교 이메일 도메인 전용 할인 트랙)
4. 가입 직후 Free 플랜으로 자동 진입.

##### 요금제 비교 (2026-06-01 기준, mentimeter.com/plans)

| 항목 | Free | Basic | Pro | Enterprise |
|---|---|---|---|---|
| 연간 비용 | $0 | **$168/년** (약 ₩23만) | **$336/년** (약 ₩46만) | 별도견적 |
| 청구 단위 | — | 연간 일시불 | 연간 일시불 | 연간 |
| 슬라이드당 질문 수 | 무제한* | 무제한 | 무제한 | 무제한 |
| 1세션 동시 참가자 | 사실상 무제한(월 50명 누적 응답자 cap, 30일 리셋) | **무제한** | 1,000명 | 무제한 |
| 데이터 export(CSV/Excel/PDF) | ❌ | ✅ | ✅ | ✅ |
| Word Cloud·Scale·Ranking·Q&A | ✅ | ✅ | ✅ | ✅ |
| Quiz Competition | ✅ | ✅ | ✅ | ✅ |
| Google Slides / PPT **embed** | ❌ | ❌ | **✅** | ✅ |
| 브랜딩(로고·색상) | ❌ | 일부 | ✅ | ✅ |
| 다중 발표자 동시 운영 | ❌ | ❌ | ✅(소수) | ✅ |
| SSO/SCIM | ❌ | ❌ | ❌ | ✅ |

\*Free 플랜의 "월 50명 응답자 cap"은 *한 달 누적 고유 응답자* 기준. 1회성 1,000명 본회의는 1세션 무제한이지만 *그 다음 달까지 누적 적용*되므로 사실상 시민회의 9차 일정에는 부적합. 출처: mentimeter.com Help "What is included in the free account?".

##### 권장 선택

- **2026 기후시민회의용 권장 = Basic ($168/년 일시불)**.
  - 7~11월 5개월만 쓰더라도 월할 분할 옵션이 없으므로 연 일시불이 필요.
  - 본회의 분과당 60명 × 3분과 = 180명 동시 응답 시나리오에서 Basic의 *무제한 참가자*면 충분.
  - 데이터 export(CSV)가 활성화되어야 권고안·아카이브에 정량 인용 가능.
- Pro($336/년)는 **Google Slides embed가 필수일 때만**. 운영진이 발표 자료를 Google Slides로 만들고 Mentimeter 질문을 슬라이드 내부에 끼워야 하면 Pro. 그렇지 않고 Mentimeter 자체 슬라이드로 운영하면 Basic으로 충분.

##### 결제 절차

1. 좌측 메뉴 **"Upgrade"** 클릭 → Basic 카드의 **"Upgrade now"**.
2. 결제: VISA·MASTER·AMEX 또는 PayPal. 한국 법인카드 가능.
3. 영수증은 입력한 청구지(Billing) 이메일로 자동 발송 — 영수증 보관 책임.
4. 결제 직후 Basic 기능 즉시 활성. **결제 완료 후 좌측 상단 본인 이름 옆에 "Basic" 뱃지 확인** 필수.

---

#### 3.2 첫 프레젠테이션 만들기 — 의제 v4-① 전력믹스 5문항 워크스루

##### 새 프레젠테이션 만들기

1. 대시보드 우상단 **"New presentation"** → 제목 입력: `2026 기후시민회의 4차 — 전력믹스 분임토의`.
2. 좌측 패널에 슬라이드가 생성된다. 우측 패널은 슬라이드 *유형 선택*.
3. 각 슬라이드 추가 시 **Type → Question type** 선택 → **Content** 탭에서 질문문 입력 → **Customize** 탭에서 응답 조건 조정.

##### 5문항 예시 (v4-① 전력믹스 = L1·L4·L5 매핑)

| # | 슬라이드 유형 | 질문문 | 운영 의도 |
|---|---|---|---|
| 1 | **Word Cloud** | "'전력믹스'라는 단어를 들으면 가장 먼저 떠오르는 한 단어는?" | 분임 시작 5분 — 모더레이터가 시민 인식 지도를 즉시 확인. |
| 2 | **Scales** (1~10) | "현재(2024) 한국 발전비중 — 원자력 31.7% · 석탄 28.1% · LNG 28.1% · 신재생 10.6%. 이 구조에 만족하시나요?" | 사전 인식 측정. 분임 종료 시 동일 질문 재시행해 *숙의 효과* 측정. |
| 3 | **Ranking** | "2030년까지 우선순위가 높은 순서로 정렬해 주세요: ①석탄 조기폐쇄 ②원전 확대 ③재생E 100GW 달성 ④LNG 동결 ⑤송전망 보강" | 의제 ①의 다섯 갈래를 시각화. 그래프가 자동으로 평균 순위를 보여준다. |
| 4 | **Multiple Choice** (다중선택 허용) | "재생E 100GW 확보의 가장 큰 걸림돌은?(2개 선택) — ①주민수용성 ②송전망 ③비용 ④계통안정성 ⑤정치적 의지 ⑥토지 부족" | L4·N9(송전망)로 토론을 자연스럽게 이어가는 사전 진단. |
| 5 | **Open Ended** | "오늘 토론에서 가장 인상 깊었던 한 문장은? (50자 이내)" | 분임 종료 마무리. 아카이브용 발언 수집. |

##### 응답 코드·QR 띄우기

- 우상단 **"Present"** 클릭 → 첫 화면에 **6자리 voting code** + **QR**이 자동 표시.
- 시민은 `menti.com` 접속 후 코드 입력하거나 QR 스캔. 별도 앱 설치·로그인 불필요.
- 응답이 들어오는 즉시 화면이 실시간 갱신. 모더레이터는 *↘ 화살표 키*로 다음 슬라이드 전환.

##### 결과 저장·내보내기

- 프레젠테이션 종료 후 좌측 메뉴 **"Results"** → **"Export"** → **PDF**(보고용)·**Excel**(원시 데이터) 선택. *Basic 이상에서만 가능.*
- 시민회의 아카이브 정책: 회기당 1 PDF + 1 Excel을 `wiki/assets/menti-export/sessionNN/`에 보관.

---

#### 3.3 Mentimeter 질문 유형별 사용 가이드

| 유형 | 한국어 명칭 | 권장 상황 | 기후회의 사례 |
|---|---|---|---|
| **Word Cloud** | 워드클라우드 | 분임 오프닝·키워드 수집·감정 측정 | "오늘 의제에서 가장 걱정되는 한 단어는?" (적응 분과 v4-⑤·⑮ 도입부) |
| **Scales** | 척도(1~10) | 사전·사후 동일 문항으로 *숙의 효과* 측정 | "전기요금이 오르더라도 기후배당으로 환급되면 수용?" (v4-②·⑭ 묶음) |
| **Multiple Choice** | 객관식·다중선택 | 정책 옵션 사이 강약 진단 | "내연차 판매금지 시점은? 2030/2035/2040/미설정" (v4-④) |
| **Ranking** | 순위형 | 5~7개 항목 우선순위 합의 | "재생E 100GW를 어디에 우선 배분? (전기차·DC·산업·건물·가정)" (v4-⑬) |
| **Open Ended** | 주관식 | 자유 발언 수집·아카이브 | "권고안에 꼭 들어가야 할 한 문장" (종합라운드 M3) |
| **Q&A** | 질의응답 | 본회의 질의 모더레이션·upvote로 우선순위 | "전문가에게 묻고 싶은 질문은?" (1·2교시 강의 직후) |
| **Quiz Competition** | 퀴즈 | 학습 효과 점검(En-ROADS 기본개념) | "UG/coal의 '풍선효과' 정답은?" (En-ROADS 시연 직후) |
| **100 Points** | 100점 분배 | 한정 자원 배분 토론 | "기후예산 100점을 5개 분야에 어떻게 나누시겠습니까?" |
| **2x2 Grid** | 2x2 매트릭스 | 가치판단 좌표화 | "비용↔효과 / 수용성↔속도" 등 정책 옵션 좌표 |

운영 원칙:
- **분임 1세션 = 3~5문항 권장**. 7문항 초과 시 응답률 급락(현장 모더레이터 일반 경험치).
- 객관식·척도형은 **응답 시간 30~60초** 안내. 주관식은 90초~2분.
- 결과를 띄운 채 시민에게 *"이 분포가 우리 분임의 현재 위치입니다. 어떻게 보시나요?"* 질문해 토론으로 연결.

---

### 4. Slido — 2순위 (본회의 Q&A 모더레이션·전문가 패널 표준)

**한 줄 요약**: 슬로바키아 발 Cisco(2021 인수) Q&A·라이브 폴 도구. **시민 질문 upvote → 모더레이터가 가장 많이 받은 질문부터 진행**이 핵심 차별점.
**공식 사이트**: https://www.slido.com/
**요금 (2026-06 기준, slido.com/pricing)**: Basic $0 / **Engage $12.5/월 (annually billed)** / Professional $50/월 / Enterprise 별도견적. 무료 플랜은 한 이벤트당 polls 5개 + Q&A 무제한이나 참가자 100명 제한.
**무료 한도**: 한 이벤트당 참가자 100명·polls 5개. 본회의 200명에는 부족 → Engage 이상 결제 필수.

#### 적합 시나리오
- **본회의 200명**: 전문가 강연 직후 시민 질문 수집. upvote 상위 5개 자동 정렬 → 사회자가 시간 안에 가장 공감받는 질문만 진행.
- **Webex / MS Teams / Zoom 하이브리드 회기**: 공식 add-in으로 회의 영상 옆에 임베드 가능 (Cisco 산하 강점).

#### 계정 생성 (5단계)
1. slido.com 우상단 "Sign up" → Google·MS·이메일 가입.
2. 대시보드 "+ Create slido" → 이벤트 이름·기간 입력.
3. 좌측 "Polls" 또는 "Q&A" 탭에서 슬라이드 추가.
4. 상단 "Present" → voting code(#1234) + QR 자동 생성.
5. 시민은 `slido.com` 접속 후 코드 입력 또는 QR. 별도 앱 불필요.

#### 임베드 / 송출 방법
- 자체 풀스크린 송출 (Present 모드, F11)
- PowerPoint·Google Slides·Keynote 플러그인 (Slido for PowerPoint 공식 add-in)
- Webex·MS Teams 회의 패널 임베드 (Cisco 통합)
- iframe 임베드 — 본 위키와 같은 정적 사이트에도 삽입 가능

#### 질문/시각화 유형
- **Q&A (upvote)** ★시그니처
- Multiple choice / Word cloud / Rating / Ranking / Open text / Quiz / Survey
- 시각화는 Mentimeter 대비 단순 — Q&A에 집중한 설계

#### 현장 체크리스트
- 전: Q&A 모더레이션 모드(승인 후 게시) on/off 결정. 200명 환경에서는 **승인 후 게시 권장** — 부적절 질문 차단.
- 중: 모더레이터 보조 화면에서 incoming queue 모니터링. upvote 5표 이상 질문만 사회자에게 패스.
- 후: Analytics 탭에서 CSV export → 회기 보고서에 인용.

#### 장애·대안
- 한 이벤트 100명 한도 초과 시 즉시 Engage 결제 또는 새 이벤트 분할.
- Slido 장애 시 → Mentimeter Q&A 슬라이드로 즉시 대체 (질문문은 동일 한국어 풀 사용).

#### 시민의회 실제 사용 사례
- Convention Citoyenne pour le Climat (프랑스, 2019~2020) 본회의 전문가 패널에서 라이브 Q&A 도구로 사용 보고 (Open Source Politics, 2020).
- 다수 EU·OECD 시민의회·기업 IR 컨퍼런스 표준.

---

### 5. Poll Everywhere — 3순위 (SMS 폴백 강점, 저대역폭 회의장 대안)

**한 줄 요약**: 미국 발. **유일하게 SMS 문자 응답을 지원**해 Wi-Fi/데이터 약한 회의장에서도 시민 응답 수집 가능.
**공식 사이트**: https://www.polleverywhere.com/
**요금 (2026-06 기준, polleverywhere.com/plans)**: Free (참가자 25명) / **Present $42/월** (700명) / Engage $84/월 / Teams·Enterprise 별도. 연 결제 시 할인.
**무료 한도**: 한 활동당 참가자 25명. 시민회의 분임(12명)에는 무료로도 가능하나 본회의(200명)는 Present 결제 필수.

#### 적합 시나리오
- 회의장 Wi-Fi·LTE 신호가 불안정한 지자체 회관·산간 워크숍 → SMS 응답으로 폴백.
- 노년층 비중 높은 분과 → 스마트폰 앱·QR 부담 줄이고 문자 응답 안내.

#### 계정 생성 (5단계)
1. polleverywhere.com → "Sign up free".
2. 사용 목적 "Business / Education" 선택.
3. 대시보드 "Create" → Multiple Choice / Word Cloud / Q&A / Open Ended / Clickable Image / Ranking / Survey.
4. "Activate" → 참여 URL(`PollEv.com/yourname`) + SMS 번호 + 키워드 발급.
5. 시민에게 PollEv.com 또는 SMS 두 경로 동시 안내.

#### 임베드 / 송출 방법
- 자체 풀스크린(Activity Present)
- PowerPoint·Keynote·Google Slides 플러그인
- 화면 캡처 OBS 송출

#### 질문/시각화 유형
- Multiple Choice / Word Cloud / Q&A / Open Ended / Clickable Image / Ranking / Survey / Competition (퀴즈)

#### 현장 체크리스트
- 전: SMS 번호·키워드를 인쇄물·슬라이드에 같이 표기. 한국 휴대전화에서 미국 SMS 발송은 국제요금 → 국내 시민의회 환경에서는 **웹/QR을 1차, SMS는 폴백**으로 안내.
- 중: 응답률 저조 시 SMS 경로 재안내.
- 후: Reports → Excel/CSV export.

#### 장애·대안
- SMS 국제요금이 시민 부담이면 → QR/웹만 사용. 이 경우 Mentimeter 대비 장점 소실.
- 한국 통신사 SMS 게이트웨이 차단 가능성 — 사전 1회 테스트 필수.

#### 시민의회 실제 사용 사례
- 미국 시민배심·타운홀 미팅에서 SMS 응답 도구로 광범위 사용 (Poll Everywhere 사례집). 한국 시민의회 도입 사례는 미확인.

---

### 6. POL.IS — 합의도출·의견 클러스터링 (오픈소스, vTaiwan 표준)

**한 줄 요약**: 시애틀 Compdemocracy 재단 발 AGPLv3 오픈소스. 시민이 의견을 한 줄씩 올리고 다른 시민이 동의/반대/패스 → **머신러닝이 2D 의견군 자동 클러스터**. 단순 다수결 아닌 *"동의하지 않기로 합의한 것"* 식별이 핵심.
**공식 사이트**: https://pol.is/ (SaaS) · https://github.com/compdemocracy/polis (소스)
**요금**: pol.is SaaS 무료 / 자체호스팅 무료 (서버 비용만)
**무료 한도**: 무제한 참여자·무제한 의견. SaaS 무료 플랜이 시민의회 200명에 그대로 충분.

#### 적합 시나리오
- 회기 후반 *합의 도출* 단계 — Mentimeter로 분포를 본 뒤 POL.IS로 의견군 클러스터링.
- 회기 사이 비실시간 의견 누적 — 빠띠와 보완 관계.
- 권고안 초안에 대한 시민 동의도 측정.

#### 계정 생성 (5단계)
1. pol.is/home → "Create your own conversation".
2. Google·이메일 가입.
3. "Create conversation" → 주제 입력 (예: "2026 기후시민회의 권고안 초안 의견").
4. 시드 의견(seed comments) 5~10개 등록 → 시민이 추가·동의/반대.
5. 시민에게 단축 URL(`pol.is/abc12def`) 또는 QR 안내.

자체호스팅 절차는 [`/ko/doc/realtime-tools-implementation-guide/`](/ko/doc/realtime-tools-implementation-guide/) §2 참조 (Docker Compose 4~8시간, VPS 4GB+).

#### 임베드 / 송출 방법
- iframe 임베드 (한 줄 코드)
- 결과 시각화(2D 클러스터 맵)를 캡처해 위키에 인용
- Report 모드는 모더레이터·운영진이 그룹 의견 합의도 통계 확인

#### 질문/시각화 유형
- Open ended 의견 1줄 (140자) + Agree/Disagree/Pass
- 시각화: 2D PCA 클러스터 맵 · group별 의견 합의도 · *consensus statements*(모든 그룹이 동의한 의견) 자동 추출

#### 현장 체크리스트
- 전: 시드 의견은 *논쟁적이되 단정적이지 않은* 한 줄. 모더레이터 3명이 사전 검토.
- 중: 모더레이션 모드에서 부적절 의견 즉시 비공개. 시민 의견 100개 누적되면 클러스터 안정화 시작.
- 후: "Group-informed consensus" 의견 5~10개를 권고안 초안 입력 자료로 사용.

#### 장애·대안
- 200명 동시 접속 시 SaaS 응답속도 느려질 수 있음 → 자체호스팅으로 대응.
- 자체호스팅 어려우면 → pol.is SaaS 무료 그대로 사용.

#### 시민의회 실제 사용 사례
- **vTaiwan (대만, 2014~)**: Uber·동성결혼 등 200+ 정책에서 합의 도출 (Audrey Tang 디지털장관, g0v.tw 사례). Hsiao, C.-H. et al. (2018) "vTaiwan: An Empirical Study of Open Consultation Process in Taiwan", arXiv 1812.01987.
- **Climate Assembly UK (2020)** 보조 도구로 사용 (보고서, Participedia case 6080).
- 핀란드 정부·캐나다 토론토 시민예산 등.

---

### 7. Decidim — 참여 플랫폼 풀스택 (오픈소스, Barcelona·Convention Citoyenne)

**한 줄 요약**: 스페인 바르셀로나 시청 발 AGPLv3 Ruby on Rails 풀스택 시민참여 플랫폼. **제안·찬반투표·시민예산·일정·회의록·계정관리**를 한 도메인에서 통합.
**공식 사이트**: https://decidim.org/ · 소스 https://github.com/decidim/decidim
**요금**: 오픈소스 무료 / 파트너 SaaS (OpenSourcePolitics·Octree·Platoniq 등) 월 $99~
**무료 한도**: 자체호스팅 시 무제한.

#### 적합 시나리오
- 1년+ 장기 시민의회 전체 디지털 백본 (회기 기록·시민 발의·투표·예산을 한 도메인에 누적).
- 권고안 공개 의견수렴 단계.

#### 계정 생성 / 도입 (5단계)
1. 도입 형태 결정: 자체호스팅(Docker/Rails 8GB+ VPS) vs 파트너 SaaS.
2. SaaS 경로: opensourcepolitics.eu 등 파트너 견적 요청 → 도메인 연결.
3. 자체호스팅: `docker run -d -p 3000:3000 decidim/decidim:latest` 또는 Rails 소스 빌드.
4. 관리자 계정 생성 → "Participatory Process" 생성 → 단계별(소개·진단·제안·논의·결정·결과) 컴포넌트 활성.
5. 시민 가입 → 의제별 제안·찬성·댓글·표결.

소요 시간·서버는 [`/ko/doc/realtime-tools-implementation-guide/`](/ko/doc/realtime-tools-implementation-guide/) §3 참조 (1~2일 설치, ★★★★ 난이도, 1인 운영 비권장).

#### 임베드 / 송출 방법
- 자체 도메인(decidim.example.org)이 SSOT — 위키에서는 외부 링크.
- 위젯·iframe 일부 제공.

#### 질문/시각화 유형
- 제안(Proposals) · 찬반(Endorsement·Vote) · 댓글(Threaded) · 토론(Debates) · 시민예산(Budgets) · 회의(Meetings) · 설문(Surveys) · 책임성(Accountability)

#### 현장 체크리스트
- 전: Rails·Postgres·Redis 운영 경험 확보. SaaS 파트너 계약 → SLA 확인.
- 중: 시민 신원확인(이메일/SMS/주민등록 OAuth) 정책 사전 합의.
- 후: 권고안 채택 결과를 "Accountability" 컴포넌트에 게시해 *이행 점검 트랙*으로 활용.

#### 장애·대안
- Rails 운영 부담 시 → 빠띠로 대체. 풀스택 통합은 잃지만 한국어·운영지원 강점.

#### 시민의회 실제 사용 사례
- **Convention Citoyenne pour le Climat (프랑스, 2019~2020)**: Decidim + Jenparle + Provote 조합으로 150명 시민의회 운영 (Open Source Politics, 2020).
- **Barcelona Decidim** (2017~): 시청 시민참여 통합 플랫폼, 70개국 200+ 도시 도입.
- 한국 도입: 서울특별시 일부 부서 파일럿 보고 (Decidim Korea 커뮤니티), 다만 전국 표준화 사례는 미확인.

---

### 8. 빠띠 (Parti) — 한국 시민참여 SaaS 표준

**한 줄 요약**: 한국 빠띠 협동조합(parti.coop) 운영 SaaS. **한국어 UI 완전 지원·비영리 무료·국내 시민단체 운영 노하우** 3박자가 핵심.
**공식 사이트**: https://parti.coop · 플랫폼 https://parti.xyz
**요금**: 비영리 무료 (서비스 기부형). 기업 의뢰 시 별도 견적.
**무료 한도**: 무제한 참여자·무제한 그룹.

#### 적합 시나리오
- 회기 사이 *비실시간* 의제 누적·찬반·자유토론 — Mentimeter(실시간)·POL.IS(클러스터링)와 보완.
- 한국어 학습부담 최소화가 우선인 시민·모더레이터 환경.
- 경기도 도민총회·환경운동연합 등 한국 시민단체와의 연속성.

#### 계정 생성 (5단계)
1. parti.xyz → 가입 (카카오/구글/이메일).
2. "그룹 만들기" → 그룹명 `climate-assembly-2026` 등.
3. 운영진을 그룹 관리자로 초대.
4. "의제"·"투표"·"공지"·"자유게시판" 메뉴 활성 — 모더레이터가 각 회기 의제 등록.
5. 시민에게 그룹 URL 공유 → 회원가입·발언·찬반.

#### 임베드 / 송출 방법
- 외부 링크 중심. iframe 임베드는 제한적 — 위키에서 그룹 페이지로 직접 안내.

#### 질문/시각화 유형
- 의제(Proposal) · 찬반투표 · 댓글 · 공지 · 자유토론 · 설문

#### 현장 체크리스트
- 전: 빠띠 운영팀에 시민의회 단체 협조 요청 (parti.coop 문의).
- 중: 회기 종료 직후 발언 요약을 빠띠에 게시 → 시민 보충 의견 모집.
- 후: 그룹 관리자가 CSV export → 위키 회기 페이지에 인용.

#### 장애·대안
- SaaS 장애 시 자체호스팅 불가 → 빠띠팀 공지 모니터.
- 한국어 운영지원 잘 정비됨 → 운영진 직접 상담 가능.

#### 시민의회 실제 사용 사례
- **경기도 기후도민총회 (2024~)**: 빠띠 그룹으로 의제 누적·도민 토론 진행 (본 위키 [`/ko/doc/gyeonggi-case/`](/ko/doc/gyeonggi-case/)).
- 한국 환경운동연합·녹색연합·서울시 마을공동체 등 다수.

---

### 9. Miro — 디지털 화이트보드 (Climate Assembly UK 사용)

**한 줄 요약**: 미국 발 무한 캔버스 디지털 화이트보드. **포스트잇·그룹화·투표·템플릿** 강력. 시민의회 분임토의 시각화 표준.
**공식 사이트**: https://miro.com/
**요금 (2026-06 기준, miro.com/pricing)**: Free / **Starter $8/월** (편집자당) / Business $16/월 / Enterprise 별도. 비영리·교육 할인 별도 신청.
**무료 한도**: 보드 3개 무제한 편집자. 단 보드당 참여자 일부 기능 제한.

#### 적합 시나리오 / 계정 5단계 / 임베드
- 합숙 워크숍(6.13~14, 9.12~13) 분과별 *디지털 포스트잇 브레인스토밍*.
- 분과별 1보드 — 12명이 동시 편집 가능.
- 1. miro.com 가입 → 2. "+ New board" → 3. 템플릿(Brainwriting·Affinity Diagram·Dot Voting) 선택 → 4. 시민에게 보드 공유 링크(또는 read-only 임베드) → 5. 종료 후 PDF/PNG export.
- 위키 임베드: iframe `<iframe src="https://miro.com/app/live-embed/{board}"></iframe>`.

#### 질문/시각화
- Sticky notes · Mind map · Affinity diagram · Dot voting · Timer · Frames · Templates 1,000+.

#### 현장 체크리스트
- 전: 분과별 보드 사전 템플릿 셋업. 게스트 편집 권한 확인.
- 중: Dot voting 1인당 3~5표로 우선순위 합의.
- 후: 보드 PDF export → 위키 회기 페이지에 첨부.

#### 장애·대안
- 무료 3보드 초과 시 → 보드 아카이브 후 새 보드 생성. 또는 Mural·FigJam.
- 200명 동시 편집은 부적합 → 분과별 12명 단위로 분리.

#### 시민의회 실제 사용 사례
- **Climate Assembly UK (2020)**: COVID-19 락다운으로 후반 회기를 Zoom + Miro 하이브리드로 진행. Miro 보드에 분임 시민 의견 누적 (Climate Assembly UK 최종보고서, 2020, p. 23~24; Participedia case 6080).

---

### 10. Mural — 디지털 화이트보드 (Miro 경쟁)

**한 줄 요약**: 미국 발 Miro 직접 경쟁 제품. **퍼실리테이터 셀 잠금·타이머·Outline 모드** 등 *퍼실리테이션 전용 기능*이 차별점.
**공식 사이트**: https://www.mural.co/
**요금 (2026-06 기준)**: Free / **Team+ $9.99/월** / Business $17.99/월 / Enterprise 별도.
**무료 한도**: mural 3개 무제한 멤버.

#### 적합 / 사용
- Miro와 동일한 분과 워크숍 용도. **퍼실리테이션 슈퍼파워(Facilitation Superpowers)** 기능: 모더레이터가 시민 시야를 강제 동기화(Summon), 셀 잠금, 타이머 시각화.
- 모더레이터 통제력이 더 필요한 환경(노년층 비중 높은 분과)에 유리.

#### 계정 / 임베드 / 시각화 / 체크리스트
- Miro 워크플로 거의 동일. iframe·PDF export 동일 제공.
- 시각화: Sticky · Vote · Timer · Outline (모더레이터 진행 순서 강제) · Private mode (1인 작성 후 일괄 공개).

#### 장애·대안
- Miro로 대체. 기능 격차 작음.

#### 시민의회 실제 사용 사례
- IAP2(국제공공참여협회) 인증 퍼실리테이터 다수가 추천. Climate Assembly UK 같은 명시 인용은 미확인.

---

### 11. FigJam — 디지털 화이트보드 (Figma 생태계)

**한 줄 요약**: Figma 발 디지털 화이트보드. **저가($3/월)·디자이너 친화·AI 정리 기능**이 특징. Jamboard 후속.
**공식 사이트**: https://www.figma.com/figjam/
**요금 (2026-06 기준, figma.com/pricing)**: Free / **Collab $3/월** / Org·Enterprise 별도. Figma 결제 시 FigJam 포함.
**무료 한도**: 파일 3개.

#### 적합 / 사용
- 디자이너·기획자 참여 비중이 높은 분과.
- AI 정리 기능 — 시민이 올린 100개 포스트잇을 클러스터로 자동 그룹화.

#### Jamboard 마이그레이션 주의
- **Google Jamboard는 2024-12-31 공식 종료** (Google Workspace 도움말, 2024). 기존 Jamboard 보드는 FigJam·Miro·Mural로 마이그레이션 필요. 모더레이터 매뉴얼·교안에 Jamboard 언급이 있다면 즉시 갱신.

#### 시민의회 실제 사용 사례
- 시민의회 직접 인용 사례 미확인. 후보 도구 검토용.

---

### 12. Kahoot! — 게임형 퀴즈 (아이스브레이커 한정)

**한 줄 요약**: 노르웨이 발 게임형 퀴즈 플랫폼. **음악·리더보드·게임 UI**로 학습 참여도 증진. 시민의회에서는 **아이스브레이커·기본개념 점검** 용도로만 제한 권장.
**공식 사이트**: https://kahoot.com/
**요금 (2026-06 기준, kahoot.com/pricing)**: Free Basic / **Kahoot!+ Pro $19/월** / Premium·Enterprise 별도. 비영리 할인 별도.
**무료 한도**: 기본 40명/세션 (Basic 무료 한도 변동 가능 — 결제 직전 재확인).

#### 적합 시나리오
- 첫 회기 분임 아이스브레이커 (5분).
- En-ROADS 시연 직후 *기본개념 정답 점검*(예: "풍선효과란?" 4지선다 30초).
- **본격 숙의에는 부적합** — 게임화가 합의 형성·소수의견 보호 원칙과 충돌.

#### 계정 / 사용 (5단계)
1. kahoot.com 가입 (Google·이메일).
2. "Create" → "New Kahoot" → 퀴즈 슬라이드 추가 (Quiz·True/False·Type Answer·Poll·Slider).
3. "Play" → Classic / Team mode 선택 → PIN 발급.
4. 시민이 kahoot.it 접속 → PIN 입력·닉네임.
5. 모더레이터 호스트 화면에서 문제 진행.

#### 장애·대안
- 시민의회 톤과 맞지 않으면 즉시 Mentimeter Quiz로 대체.

#### 시민의회 실제 사용 사례
- 학교·기업 교육 표준. 시민의회 본 회기 도입은 미확인 (Kim 2교시 강의에서 1 위원이 제안한 수준).

---

### 13. 보완 도구 — En-ROADS (시뮬레이션)

본 쿡북은 *실시간 응답·시각화 도구*만 다룬다. 정책 시뮬레이션은 별도 트랙으로 본 위키 [`/downloads/en-roads-moderator-card-v1.html`](/downloads/en-roads-moderator-card-v1.html) (En-ROADS 모더레이터 카드 v1)을 참조한다. 7월 4일 4차 본회의에서 시연 예정이며, Mentimeter Quiz·Word Cloud와 조합해 *시연 → 즉시 응답 → 토론* 사이클을 구성한다.

---

### 14. ★ 의제 13건 × 질문 풀

각 의제마다 **2~3개 질문**(워드클라우드/척도/객관식/순위/주관식 중 혼합). 한국어 그대로 복붙해 Mentimeter·Slido·Poll Everywhere·구글폼 Content 필드에 사용 가능(질문 유형명만 각 도구 명칭에 맞춰 치환). 의제 번호·매핑은 [`/ko/doc/agenda-matrix-v5/`](/ko/doc/agenda-matrix-v5/) 기준. **본 풀은 숙의 의제 ①~⑧ + ⑪~⑮ = 14건**(메타 의제 ⑨ 이행점검·⑩ 17광역 확산은 권고안 본문에 직접 반영하는 트랙으로 별도 처리한다).

#### v4-① 전력믹스(원전 vs 재생) — 감축1 / L1·L4·L5

- **[Scales 1~10]** "2035년 한국의 발전원 중 원자력 비중은? 1=0% / 10=50% 이상"
- **[Ranking]** "2030년까지 우선순위 순서: 석탄폐쇄 / 원전유지·확대 / 재생E 100GW / LNG 동결 / 송전망 보강"
- **[Open Ended]** "원자력에 대한 당신의 입장을 한 문장으로 (50자)"

#### v4-② 전기요금 인상 부담 — 감축2 / L8

- **[Scales 1~10]** "탄소중립을 위해 전기요금이 월 2만원 더 오르는 것을 수용할 수 있다 (1=불가, 10=완전수용)"
- **[Multiple Choice]** "전기요금 인상이 정당화되려면? (2개 선택) ①저소득층 환급 ②산업용 요금 동시 인상 ③재생E 투자 명시 ④한전 부채 해소 명시"

#### v4-③ 수도권 vs 비수도권 전기요금 — 감축1+적응(형평) / L4

- **[Multiple Choice]** "수도권·비수도권 전기요금 차등제, 어디까지 동의? ①반대 ②산업용만 ③가정용 포함 ④지역별 완전 차등"
- **[Scales 1~10]** "호남↔수도권 송전망(HVDC) 건설에 따른 지역 보상 수준은 충분해야 한다 (1=불필요, 10=대폭 확대)"
- **[Open Ended]** "내가 비수도권 주민이라면, 수도권 주민이라면 — 가장 받아들이기 어려운 한 가지는?"

#### v4-④ 내연차 판매금지 시점 — 감축2 / L2·L10

- **[Multiple Choice]** "한국의 내연차 신차 판매금지 시점은? ①2030 ②2035 ③2040 ④2045 ⑤설정하지 않음"
- **[Scales 1~10]** "전기차 = 무탄소라는 인식에 동의하는가? (Well-to-Wheel 데이터를 본 후 재응답)" *사전·사후 동일 문항 권장*

#### v4-⑤ 기후재난 사회 불평등 — 적응

- **[Word Cloud]** "기후재난이라는 단어를 들으면 가장 먼저 떠오르는 사람·집단은?"
- **[Ranking]** "기후재난 취약집단 우선 지원 순서: 저소득층 / 농어민 / 노인·장애인 / 영유아 / 옥외 노동자 / 이주민"
- **[Open Ended]** "기후재난 앞에서 '사회가 책임져야 할 한 가지'는?"

#### v4-⑥ 개인 라이프스타일 개입 경계 — 감축2+적응 / L9·L15

- **[Scales 1~10]** "정부가 육류 소비량에 세금을 부과하는 것에 동의 (1=절대불가, 10=강력지지)"
- **[Multiple Choice]** "라이프스타일 개입의 적정선은? ①정보 제공만 ②인센티브(보조금) ③페널티(세금) ④직접 규제(판매 제한)"
- **[Open Ended]** "기후를 위해 내가 바꿀 수 있는·바꾸지 못할 한 가지는?"

#### v4-⑦ 개도국 지원 vs 국내 우선 — 적응(국제) / L17·L18

- **[Scales 1~10]** "한국 GDP의 0.1%(약 2조원)를 개도국 기후지원에 매년 출연하는 것에 동의 (1=반대, 10=찬성)"
- **[Ranking]** "한국 ODA 우선 분야: 재생E / 적응(물·식량) / 산림 / 기술이전 / 손실·피해 보상"

#### v4-⑧ ESG·RE100 의무화 속도 — 감축2 / L8

- **[Multiple Choice]** "RE100을 한국 대기업에 법적 의무화한다면? ①즉시(2027) ②2030 ③2035 ④자율(의무화 반대)"
- **[Scales 1~10]** "ESG 공시 의무화가 산업 경쟁력에 미치는 영향은 (1=치명적 부담, 10=오히려 기회)"

#### v4-⑪ AI·데이터센터 — 감축2(메가) / L4·L11

- **[Scales 1~10]** "데이터센터 신규입지 시 100% 재생E 조달을 법적 의무화해야 한다"
- **[Multiple Choice]** "AI·DC 전력수요 폭증에 대한 대응책 우선순위(2개): ①RE100 의무 ②입지 규제(수도권 제한) ③효율 기준 강화 ④탄소세 부과 ⑤원전 확대"
- **[Open Ended]** "AI 시대의 기후정책에서 가장 우려되는 점 한 문장"

#### v4-⑫ 개도국 성장 9변수 메뉴화 — 적응(국제) / L13~L17

- **[Ranking]** "한국이 개도국에 가장 잘 지원할 수 있는 분야: 보건 / 교육 / 농업 / 에너지 / 산림 / 식량 / 인프라"
- **[Scales 1~10]** "개도국 지원이 국내 복지·경제와 충돌할 때 우선순위 (1=국내 우선, 10=국제 우선)"

#### v4-⑬ 한정된 재생E 우선배분 — 감축1+감축2(종합) / L4

- **[100 Points]** "100점을 다음에 배분: 전기차 / 데이터센터 / 산업RE100 / 건물 히트펌프 / 가정용"
- **[Multiple Choice]** "재생E가 부족할 때 가장 먼저 양보해야 할 부문은? ①전기차 ②DC ③산업 ④건물 ⑤가정"
- **[Open Ended]** "우선배분 결정에서 가장 중요한 가치 한 단어"

#### v4-⑭ 시민 환급형 기후배당 — 감축2 / L8

- **[Scales 1~10]** "탄소세 수입을 1인당 균등 환급하는 '기후배당'에 찬성"
- **[Multiple Choice]** "기후배당 환급방식은? ①전 국민 동일액 ②소득 역진적(저소득 가중) ③지역 차등(석탄지역 가중) ④세대 차등(미래세대 가중)"

#### v4-⑮ 복합 취약성 4축 — 적응

- **[Word Cloud]** "기후 취약성을 한 단어로 정의한다면?"
- **[Ranking]** "4축 우선 대응 순서: 폭염 / 침수 / 가뭄·식량 / 한파"
- **[Open Ended]** "내 지역에서 가장 시급한 적응 인프라 한 가지"

→ **합계: v4-① 3 · ② 2 · ③ 3 · ④ 2 · ⑤ 3 · ⑥ 3 · ⑦ 2 · ⑧ 2 · ⑪ 3 · ⑫ 2 · ⑬ 3 · ⑭ 2 · ⑮ 3 = 33문항 (의제 13건)**. 메타 의제 ⑨(이행점검)·⑩(17광역 확산)은 종합라운드 권고안 본문에 직접 반영하므로 본 실시간 응답 풀에서는 제외.

---

### 15. 현장 운영 체크리스트 (Mentimeter 기준 · 타 도구도 동일 원칙)

#### 15.1 회의 1일 전

- [ ] Mentimeter 프레젠테이션 *복제본* 1개 별도 저장(편집 사고 대비).
- [ ] voting code 사전 발급 확인. QR PNG 다운로드해 인쇄물·슬라이드에 삽입.
- [ ] 회의장 Wi-Fi 비번·SSID 모더레이터 전체 공유.
- [ ] 시민에게 *"스마트폰을 가져오세요"* 사전 안내문 발송.
- [ ] 모바일 데이터로 voting code 입력 → 응답 → 결과 화면 갱신까지 1회 리허설.

#### 15.2 회의 1시간 전

- [ ] 메인 노트북 풀충전 + 보조배터리 1개.
- [ ] HDMI·USB-C 어댑터 동작 확인.
- [ ] 회의장 Wi-Fi 신호 4칸 이상. LTE/5G 폴백 핫스팟 1대 대기.
- [ ] Mentimeter 로그인 상태 확인 → 발표 모드 진입 1회 테스트(끄지 말고 그대로 유지).

#### 15.3 회의 5분 전

- [ ] 첫 슬라이드(voting code + QR)를 메인 스크린에 띄운 상태로 시민 입장 대기.
- [ ] *"menti.com 접속 → 6자리 코드 입력"* 한 줄 안내 칠판·구두 안내.
- [ ] 모더레이터 발표자 화면(presenter view)을 본인 노트북에 별도 띄움 — 응답 현황을 실시간 모니터.

#### 15.4 회의 중

- 첫 문항 응답률 50% 미만 → *"아직 응답 안 하신 분, 옆 분 도와주세요"* 부드러운 독려. 1분 후 강제 진행.
- 응답이 90초 이상 정체 → 다음 슬라이드로 넘어가고 결과는 사후 export로 보완.
- 워드클라우드에 부적절·욕설 응답 출현 → Mentimeter는 *Profanity filter* 자동(영어 기준), 한국어는 발표자 화면에서 **해당 응답 우클릭 → Hide** 가능. 운영자가 즉시 처리.

#### 15.5 회의 후

- [ ] **"Results" → "Export" → Excel + PDF** 동시 다운로드.
- [ ] 파일명 규칙: `menti_session-NN_의제명_YYYYMMDD.xlsx`.
- [ ] `wiki/assets/menti-export/sessionNN/` 폴더에 업로드.
- [ ] 핵심 결과 1~2개 차트는 위키 회기 페이지에 인용(`session/2026-MM-DD-*.md`).
- [ ] 다음 회기 전까지 *동일 척도 문항*은 반드시 보존 — 사전·사후 비교 데이터로 활용.

---

### 16. 장애 대응

| 상황 | 즉시 조치 | 백업 |
|---|---|---|
| **Wi-Fi 끊김** | 발표자 노트북을 LTE 핫스팟으로 전환. 시민에게 *"각자 데이터로 응답 가능"* 안내. | Slido 백업 세션 (사전 작성). 그래도 안 되면 종이 거수·포스트잇 즉시 전환. |
| **200명 동시접속 부하** | Basic 플랜 무제한 참가자라 Mentimeter 서버 자체는 견딤. 회의장 Wi-Fi AP가 병목 → AP 채널 분리·LTE 보조망 안내. | 분과별 voting code 분리(3개 프레젠테이션)로 트래픽 분산. |
| **응답률 저조 (<50%)** | 1) 발표자 직접 시범 응답 시연 2) 옆 사람끼리 짝지어 응답 3) 응답 시간 30초→60초 연장 | 종이 응답지 사전 인쇄 → 사후 입력. |
| **부적절 응답(워드클라우드)** | 발표자 화면에서 해당 응답 **Hide**. 재발 시 슬라이드 유형을 객관식으로 즉석 전환. | 다음 슬라이드로 신속 이동. |
| **voting code 입력 오류 다발** | 코드 직접 안내(menti.com/code/123456 형태 URL) + QR 재게시. | 단축 URL(bit.ly 등) 사전 발급. |
| **계정 잠금·로그인 실패** | 사전 발급한 보조 운영자 계정으로 즉시 전환. 같은 프레젠테이션 URL 공유. | 직전 회기 PDF·Excel을 그대로 보여주며 토론은 계속. |
| **En-ROADS와 동시 띄울 때 화면 전환 혼선** | 듀얼모니터(메인=En-ROADS, 보조=Menti) 또는 PiP. 둘 다 안 되면 *세그먼트* 분리(En-ROADS 시연 10분 → 응답 5분 → En-ROADS 재개). | — |

핵심 원칙: **모든 디지털 도구는 종이·구두 응답으로 폴백 가능해야 한다.** 시민 응답이 멈추면 토론이 멈춘다.

---

### 17. 관련 페이지 (위키 내부)

- [`/ko/doc/realtime-tools-for-moderators/`](/ko/doc/realtime-tools-for-moderators/) — **선택 매트릭스**: 16종 도구 4 카테고리 분류 + 회기별 권장 조합
- [`/ko/doc/realtime-tools-implementation-guide/`](/ko/doc/realtime-tools-implementation-guide/) — **도입 로드맵**: 오픈소스 vs 유료 매트릭스, POL.IS·Decidim 자체호스팅 절차, 우리 사이트 한계
- [`/downloads/en-roads-moderator-card-v1.html`](/downloads/en-roads-moderator-card-v1.html) — **En-ROADS 모더레이터 카드 v1**: 정책 시뮬레이션 보완 도구
- [`/ko/doc/agenda-matrix-v5/`](/ko/doc/agenda-matrix-v5/) — **의제 매트릭스 v5**: 본 질문 풀의 번호·매핑 근거
- [`/ko/doc/gyeonggi-case/`](/ko/doc/gyeonggi-case/) — **경기도 도민총회**: 빠띠 실사용 사례
- [`/ko/doc/lecture-2-kim-sang-gyu/`](/ko/doc/lecture-2-kim-sang-gyu/) — **김상규 2교시**: 본 도구 검토의 출발점

세 페이지 트리오 사용법: **(1) 선택 매트릭스에서 도구 후보 좁히기 → (2) 도입 로드맵에서 유료/오픈소스 결정 → (3) 본 쿡북에서 실제 세팅·질문 풀·현장 운영 매뉴얼 적용.**

---

### 18. 참고 문헌 (APA)

#### 도구 공식 사이트·요금·도움말
- Mentimeter. (2026). *Pricing — Free, Pro & Enterprise plans*. https://www.mentimeter.com/plans (accessed: 2026-06-01)
- Mentimeter Help Center. (n.d.). *What is included in the free account?* https://help.mentimeter.com/en/articles/1258367-what-is-included-in-the-free-account (accessed: 2026-06-01)
- Mentimeter Help Center. (n.d.). *How to use the Word Cloud slide*. https://help.mentimeter.com/en/articles/410469-how-to-use-the-word-cloud-slide (accessed: 2026-06-01)
- Mentimeter Help Center. (n.d.). *How to use Ranking slides*. https://help.mentimeter.com/en/articles/2780579-how-to-use-ranking-slides (accessed: 2026-06-01)
- Mentimeter Help Center. (n.d.). *Embed a Google Slides presentation into Mentimeter*. https://help.mentimeter.com/en/articles/6445389-embed-a-google-slides-presentation-into-mentimeter (accessed: 2026-06-01)
- Slido. (2026). *Audience Interaction Made Easy*. https://www.slido.com/ (accessed: 2026-06-01)
- Slido. (2026). *Pricing*. https://www.slido.com/pricing (accessed: 2026-06-01)
- Poll Everywhere. (2026). *Plans & Pricing*. https://www.polleverywhere.com/plans (accessed: 2026-06-01)
- POL.IS. (n.d.). *Polis — open-source tooling for hosting conversations at scale*. https://pol.is/ · https://github.com/compdemocracy/polis (accessed: 2026-06-01)
- Decidim. (n.d.). *Decidim — Free Open-Source participatory democracy*. https://decidim.org/ · https://github.com/decidim/decidim (accessed: 2026-06-01)
- 빠띠(Parti) 협동조합. https://parti.coop · https://parti.xyz (accessed: 2026-06-01)
- Miro. (2026). *Plans and pricing*. https://miro.com/pricing/ (accessed: 2026-06-01)
- Mural. (2026). *Plans and pricing*. https://www.mural.co/pricing (accessed: 2026-06-01)
- Figma. (2026). *FigJam — online whiteboard for visual collaboration*. https://www.figma.com/figjam/ · https://www.figma.com/pricing/ (accessed: 2026-06-01)
- Google Workspace Help. (2024). *Find out what's happening with Jamboard* (Jamboard 2024-12-31 종료 공지). https://support.google.com/jamboard/answer/14084787 (accessed: 2026-06-01)
- Kahoot!. (2026). *Plans for work*. https://kahoot.com/business/plans/ (accessed: 2026-06-01)

#### 시민의회 1차 출처
- Citizens' Assembly (Ireland). (2018). *Third report and recommendations on how the State can make Ireland a leader in tackling climate change*. https://citizensassembly.ie/ (accessed: 2026-06-01)
- Climate Assembly UK. (2020). *The path to net zero — Climate Assembly UK full report*. https://www.climateassembly.uk/report/ · Participedia case 6080. https://participedia.net/case/6080 (accessed: 2026-06-01)
- Convention Citoyenne pour le Climat. (2020). *Les propositions de la Convention Citoyenne pour le Climat*. https://www.conventioncitoyennepourleclimat.fr/ (accessed: 2026-06-01)
- Open Source Politics. (2020). *Une plateforme participative pour la Convention Citoyenne pour le Climat (Decidim + Jenparle + Provote)*. https://opensourcepolitics.eu/actualites/une-plateforme-participative-pour-la-convention-citoyenne-pour-le-climat/ (accessed: 2026-06-01)
- KNOCA. (n.d.). *French Citizens' Convention on the Climate*. https://www.knoca.eu/national-assemblies/french-citizens-convention-on-the-climate (accessed: 2026-06-01)
- OECD. (2020). *Innovative Citizen Participation and New Democratic Institutions: Catching the Deliberative Wave*. OECD Publishing. https://doi.org/10.1787/339306da-en (accessed: 2026-06-01)
- Hsiao, Y.-T., Lin, S.-Y., Tang, A., Narayanan, D., & Sarahe, C. (2018). *vTaiwan: An empirical study of open consultation process in Taiwan*. arXiv:1812.01987. https://arxiv.org/abs/1812.01987 (accessed: 2026-06-01)
- Wikipedia. (2026). *Pol.is*. https://en.wikipedia.org/wiki/Pol.is (accessed: 2026-06-01)

#### 본 위키 선행 페이지
- [`/ko/doc/realtime-tools-for-moderators/`](/ko/doc/realtime-tools-for-moderators/) · [`/ko/doc/realtime-tools-implementation-guide/`](/ko/doc/realtime-tools-implementation-guide/) · [`/ko/doc/agenda-matrix-v5/`](/ko/doc/agenda-matrix-v5/) · [`/ko/doc/gyeonggi-case/`](/ko/doc/gyeonggi-case/) · [`/ko/doc/lecture-2-kim-sang-gyu/`](/ko/doc/lecture-2-kim-sang-gyu/)

---

*문서 끝. 본 쿡북은 2026-06-01 기준 각 도구 공식 페이지 공개 정보를 인용했다. 요금·기능은 분기마다 갱신될 수 있으므로 **결제 직전 각 도구의 `/pricing` 또는 `/plans` 페이지 재확인 필수**. 7월 4일 4차 본회의 후 현장 운영 피드백을 반영해 v2 갱신 예정.*
