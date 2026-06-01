---
title: "Mentimeter 실전 셋업 쿡북 — 의제 14건 × 질문 풀 + 현장 운영"
slug: mentimeter-setup-cookbook
doc_type: guide
license: CC-BY-SA-4.0
last_updated: 2026-06-01
order: 87
---

## Mentimeter 실전 셋업 쿡북 — 14의제 질문 풀 + 현장 운영 매뉴얼

> 본 페이지는 [`/ko/doc/realtime-tools-for-moderators/`](/ko/doc/realtime-tools-for-moderators/)(도구 16종 선정)·[`/ko/doc/realtime-tools-implementation-guide/`](/ko/doc/realtime-tools-implementation-guide/)(오픈소스 vs 유료) 다음 단계인 **모더레이터용 실행 쿡북**이다. 분임 12명·본회의 200명 환경에서 Mentimeter(1순위)·Slido(예비)를 곧바로 띄울 수 있도록 계정 생성부터 질문 풀, 현장 장애 대응까지 한 문서로 정리한다.

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

### 2. 계정 생성 & 요금제 선택

#### 2.1 가입 절차

1. `mentimeter.com` 접속 → 우상단 **"Sign up"** 클릭.
2. **"Continue with Google"** 또는 이메일·비밀번호 입력. 조직 메일을 권장(권한 양도 용이).
3. 사용 목적 설문 — "Education / Work / Other" 중 **Work** 선택. (Education은 학교 이메일 도메인 전용 할인 트랙)
4. 가입 직후 Free 플랜으로 자동 진입.

#### 2.2 요금제 비교 (2026-06-01 기준, mentimeter.com/plans)

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

#### 2.3 권장 선택

- **2026 기후시민회의용 권장 = Basic ($168/년 일시불)**.
  - 7~11월 5개월만 쓰더라도 월할 분할 옵션이 없으므로 연 일시불이 필요.
  - 본회의 분과당 60명 × 3분과 = 180명 동시 응답 시나리오에서 Basic의 *무제한 참가자*면 충분.
  - 데이터 export(CSV)가 활성화되어야 권고안·아카이브에 정량 인용 가능.
- Pro($336/년)는 **Google Slides embed가 필수일 때만**. 운영진이 발표 자료를 Google Slides로 만들고 Mentimeter 질문을 슬라이드 내부에 끼워야 하면 Pro. 그렇지 않고 Mentimeter 자체 슬라이드로 운영하면 Basic으로 충분.

#### 2.4 결제 절차

1. 좌측 메뉴 **"Upgrade"** 클릭 → Basic 카드의 **"Upgrade now"**.
2. 결제: VISA·MASTER·AMEX 또는 PayPal. 한국 법인카드 가능.
3. 영수증은 입력한 청구지(Billing) 이메일로 자동 발송 — 영수증 보관 책임.
4. 결제 직후 Basic 기능 즉시 활성. **결제 완료 후 좌측 상단 본인 이름 옆에 "Basic" 뱃지 확인** 필수.

---

### 3. 첫 프레젠테이션 만들기 — 의제 v4-① 전력믹스 5문항 워크스루

#### 3.1 새 프레젠테이션 만들기

1. 대시보드 우상단 **"New presentation"** → 제목 입력: `2026 기후시민회의 4차 — 전력믹스 분임토의`.
2. 좌측 패널에 슬라이드가 생성된다. 우측 패널은 슬라이드 *유형 선택*.
3. 각 슬라이드 추가 시 **Type → Question type** 선택 → **Content** 탭에서 질문문 입력 → **Customize** 탭에서 응답 조건 조정.

#### 3.2 5문항 예시 (v4-① 전력믹스 = L1·L4·L5 매핑)

| # | 슬라이드 유형 | 질문문 | 운영 의도 |
|---|---|---|---|
| 1 | **Word Cloud** | "'전력믹스'라는 단어를 들으면 가장 먼저 떠오르는 한 단어는?" | 분임 시작 5분 — 모더레이터가 시민 인식 지도를 즉시 확인. |
| 2 | **Scales** (1~10) | "현재(2024) 한국 발전비중 — 원자력 31.7% · 석탄 28.1% · LNG 28.1% · 신재생 10.6%. 이 구조에 만족하시나요?" | 사전 인식 측정. 분임 종료 시 동일 질문 재시행해 *숙의 효과* 측정. |
| 3 | **Ranking** | "2030년까지 우선순위가 높은 순서로 정렬해 주세요: ①석탄 조기폐쇄 ②원전 확대 ③재생E 100GW 달성 ④LNG 동결 ⑤송전망 보강" | 의제 ①의 다섯 갈래를 시각화. 그래프가 자동으로 평균 순위를 보여준다. |
| 4 | **Multiple Choice** (다중선택 허용) | "재생E 100GW 확보의 가장 큰 걸림돌은?(2개 선택) — ①주민수용성 ②송전망 ③비용 ④계통안정성 ⑤정치적 의지 ⑥토지 부족" | L4·N9(송전망)로 토론을 자연스럽게 이어가는 사전 진단. |
| 5 | **Open Ended** | "오늘 토론에서 가장 인상 깊었던 한 문장은? (50자 이내)" | 분임 종료 마무리. 아카이브용 발언 수집. |

#### 3.3 응답 코드·QR 띄우기

- 우상단 **"Present"** 클릭 → 첫 화면에 **6자리 voting code** + **QR**이 자동 표시.
- 시민은 `menti.com` 접속 후 코드 입력하거나 QR 스캔. 별도 앱 설치·로그인 불필요.
- 응답이 들어오는 즉시 화면이 실시간 갱신. 모더레이터는 *↘ 화살표 키*로 다음 슬라이드 전환.

#### 3.4 결과 저장·내보내기

- 프레젠테이션 종료 후 좌측 메뉴 **"Results"** → **"Export"** → **PDF**(보고용)·**Excel**(원시 데이터) 선택. *Basic 이상에서만 가능.*
- 시민회의 아카이브 정책: 회기당 1 PDF + 1 Excel을 `wiki/assets/menti-export/sessionNN/`에 보관.

---

### 4. 질문 유형별 사용 가이드

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

### 5. ★ 의제 14건 × Mentimeter 질문 풀

각 의제마다 **2~3개 질문**(워드클라우드/척도/객관식/순위/주관식 중 혼합). 한국어 그대로 복붙해 Mentimeter Content 필드에 사용 가능. 의제 번호·매핑은 [`/ko/doc/agenda-matrix-v5/`](/ko/doc/agenda-matrix-v5/) 기준.

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

#### v4-⑨ [메타] 권고안 사후 이행점검 — 종합라운드

- **[Multiple Choice]** "권고안 이행점검 주체는? ①시민회의 재소집(연 1회) ②국회 상임위 ③환경부 ④감사원 ⑤독립 시민감시기구 신설"
- **[Open Ended]** "5년 뒤 우리 권고안이 '잘 이행되었다'고 평가할 단 하나의 지표는?"

#### v4-⑩ [메타] 국가→17개 광역 확산 — 종합라운드

- **[Scales 1~10]** "광역단위(시·도) 시민회의 의무화에 찬성 (1=반대, 10=찬성)"
- **[Ranking]** "광역 확산 시 가장 시급한 지역: 충남(석탄) / 호남(재생E) / 수도권(수요) / 경북(원전) / 강원(산림·풍력)"

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

→ **합계: v4-① 3문항 · ② 2 · ③ 3 · ④ 2 · ⑤ 3 · ⑥ 3 · ⑦ 2 · ⑧ 2 · ⑨ 2 · ⑩ 2 · ⑪ 3 · ⑫ 2 · ⑬ 3 · ⑭ 2 · ⑮ 3 = 35문항** (의제 15건; v4-⑨·⑩은 메타 의제이나 본 풀에 포함).

---

### 6. 현장 운영 체크리스트

#### 6.1 회의 1일 전

- [ ] Mentimeter 프레젠테이션 *복제본* 1개 별도 저장(편집 사고 대비).
- [ ] voting code 사전 발급 확인. QR PNG 다운로드해 인쇄물·슬라이드에 삽입.
- [ ] 회의장 Wi-Fi 비번·SSID 모더레이터 전체 공유.
- [ ] 시민에게 *"스마트폰을 가져오세요"* 사전 안내문 발송.
- [ ] 모바일 데이터로 voting code 입력 → 응답 → 결과 화면 갱신까지 1회 리허설.

#### 6.2 회의 1시간 전

- [ ] 메인 노트북 풀충전 + 보조배터리 1개.
- [ ] HDMI·USB-C 어댑터 동작 확인.
- [ ] 회의장 Wi-Fi 신호 4칸 이상. LTE/5G 폴백 핫스팟 1대 대기.
- [ ] Mentimeter 로그인 상태 확인 → 발표 모드 진입 1회 테스트(끄지 말고 그대로 유지).

#### 6.3 회의 5분 전

- [ ] 첫 슬라이드(voting code + QR)를 메인 스크린에 띄운 상태로 시민 입장 대기.
- [ ] *"menti.com 접속 → 6자리 코드 입력"* 한 줄 안내 칠판·구두 안내.
- [ ] 모더레이터 발표자 화면(presenter view)을 본인 노트북에 별도 띄움 — 응답 현황을 실시간 모니터.

#### 6.4 회의 중

- 첫 문항 응답률 50% 미만 → *"아직 응답 안 하신 분, 옆 분 도와주세요"* 부드러운 독려. 1분 후 강제 진행.
- 응답이 90초 이상 정체 → 다음 슬라이드로 넘어가고 결과는 사후 export로 보완.
- 워드클라우드에 부적절·욕설 응답 출현 → Mentimeter는 *Profanity filter* 자동(영어 기준), 한국어는 발표자 화면에서 **해당 응답 우클릭 → Hide** 가능. 운영자가 즉시 처리.

#### 6.5 회의 후

- [ ] **"Results" → "Export" → Excel + PDF** 동시 다운로드.
- [ ] 파일명 규칙: `menti_session-NN_의제명_YYYYMMDD.xlsx`.
- [ ] `wiki/assets/menti-export/sessionNN/` 폴더에 업로드.
- [ ] 핵심 결과 1~2개 차트는 위키 회기 페이지에 인용(`session/2026-MM-DD-*.md`).
- [ ] 다음 회기 전까지 *동일 척도 문항*은 반드시 보존 — 사전·사후 비교 데이터로 활용.

---

### 7. 장애 대응

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

### 8. Slido / 빠띠 대안 빠른 참조

| 항목 | Mentimeter (1순위) | Slido (2순위) | 빠띠 Parti (한국 표준) |
|---|---|---|---|
| 본사 | 스웨덴 | 슬로바키아 (Cisco 인수, 2021) | 한국 비영리 |
| 한국어 UI | 부분(시민 응답화면 한글 가능, 운영 UI 영어) | 부분(시민 응답화면 한글 가능) | **완전 한국어** |
| 핵심 강점 | 시각화 다양성·Word Cloud·100 Points | **Q&A 모더레이션·upvote**, Webex/Teams/Zoom 깊은 통합 | 한국 시민단체 운영 노하우·운영진 지원 |
| 동시 참가자 (무료) | 사실상 무제한(월 50명 cap) | 100명(1세션) | 무제한 |
| 동시 참가자 (유료 기본) | 무제한 (Basic $168/년) | 무제한 (Basic $12.5/월) | 무료 |
| 데이터 export | CSV/Excel/PDF (Basic+) | CSV/Excel (유료) | CSV (그룹 관리자) |
| 자체호스팅 | ❌ | ❌ | ❌ |
| 시민회의 권장 용도 | 분임·본회의 실시간 응답·시각화 | **본회의 Q&A 모더레이션·전문가 패널** | 회기 사이 *비실시간 토론·의제 누적* |
| 학습부담 | ★★(중) | ★★(중) | ★(저) |

**조합 권장**:
- 회기 *내부* 실시간 응답 → Mentimeter (1순위).
- 본회의 *전문가 발표 Q&A* → Slido (2순위, 무료 100명도 충분).
- 회기 *사이* 시민 발의·자유토론 → 빠띠 그룹.

세 도구를 회기마다 다 쓰지 말 것. 회기 단위로 1개 고정이 모더레이터 인지 부담을 최소화한다(이전 가이드 결론 유지).

---

### 9. 참고 문헌 (APA)

- Mentimeter. (2026). *Pricing — Free, Pro & Enterprise plans*. https://www.mentimeter.com/plans (accessed: 2026-06-01)
- Mentimeter Help Center. (n.d.). *What is included in the free account?* https://help.mentimeter.com/en/articles/1258367-what-is-included-in-the-free-account (accessed: 2026-06-01)
- Mentimeter Help Center. (n.d.). *How to use the Word Cloud slide*. https://help.mentimeter.com/en/articles/410469-how-to-use-the-word-cloud-slide (accessed: 2026-06-01)
- Mentimeter Help Center. (n.d.). *How to use Ranking slides*. https://help.mentimeter.com/en/articles/2780579-how-to-use-ranking-slides (accessed: 2026-06-01)
- Mentimeter Help Center. (n.d.). *Embed a Google Slides presentation into Mentimeter*. https://help.mentimeter.com/en/articles/6445389-embed-a-google-slides-presentation-into-mentimeter (accessed: 2026-06-01)
- Slido. (2026). *Audience Interaction Made Easy*. https://www.slido.com/ (accessed: 2026-06-01)
- Citizens' Assembly (Ireland). (2018). *Third report and recommendations on how the State can make Ireland a leader in tackling climate change*. https://citizensassembly.ie/ (accessed: 2026-06-01)
- Climate Assembly UK. (2020). *The path to net zero — Climate Assembly UK full report*. Participedia case 6080. https://participedia.net/case/6080 (accessed: 2026-06-01)
- Open Source Politics. (2020). *Une plateforme participative pour la Convention Citoyenne pour le Climat (Decidim + Jenparle + Provote)*. https://opensourcepolitics.eu/actualites/une-plateforme-participative-pour-la-convention-citoyenne-pour-le-climat/ (accessed: 2026-06-01)
- KNOCA. (n.d.). *French Citizens' Convention on the Climate*. https://www.knoca.eu/national-assemblies/french-citizens-convention-on-the-climate (accessed: 2026-06-01)
- Wikipedia. (2026). *Pol.is*. https://en.wikipedia.org/wiki/Pol.is (accessed: 2026-06-01)
- 빠띠(Parti) 협동조합. https://parti.coop (accessed: 2026-06-01)
- 본 위키 선행 페이지: [`/ko/doc/realtime-tools-for-moderators/`](/ko/doc/realtime-tools-for-moderators/) · [`/ko/doc/realtime-tools-implementation-guide/`](/ko/doc/realtime-tools-implementation-guide/) · [`/ko/doc/agenda-matrix-v5/`](/ko/doc/agenda-matrix-v5/)

---

*문서 끝. 본 쿡북은 2026-06-01 기준 mentimeter.com 공개 정보를 인용했다. Mentimeter 요금·기능은 분기마다 갱신될 수 있으므로 **결제 직전 mentimeter.com/plans 재확인 필수**. 7월 4일 4차 본회의 후 현장 운영 피드백을 반영해 v2 갱신 예정.*
