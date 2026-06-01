---
title: "En-ROADS 한국어 종합 가이드 (v1.1)"
slug: comprehensive-guide
lang: ko
doc_type: tool
trust_label: author-verified
license: CC-BY-4.0
source: "En-ROADS User Guide & Technical Reference (Climate Interactive, MIT Sloan)"
last_updated: 2026-05-31
version: v1.1
date: 2026-05-31
---

# En-ROADS 한국어 자료집 v1

*Source: En-ROADS User Guide + Technical Reference (Climate Interactive, MIT Sloan, Ventana Systems, UMass Lowell), CC BY 4.0*
*Compiled by: 2026 한국 기후시민회의 모더레이터 준비팀*
*Date: 2026-05-31*

> 본 문서는 En-ROADS 공식 문서(User Guide 29p + Technical Reference 131p, 모두 CC BY 4.0)를 한국 기후시민회의 분임 모더레이터의 사전 학습용으로 재구성한 한국어 정리본이다. 원저작권은 Climate Interactive에 있으며, 인용 시 출처(URL 또는 페이지)를 반드시 병기한다. 영어 원문의 직역이 아니라 시민회의 운영 맥락에 맞게 재서술했으므로, 정밀한 인용이 필요하면 원문(영어)을 참조할 것.

---

## 0. 본 자료집의 목적과 한계

- **누구를 위함**: 2026년 한국 기후시민회의 본회의에 투입되는 분임 모더레이터, 의제팀, 운영지원 인력.
- **무엇을 위함**:
  (1) 18개 정책 레버를 시민에게 1~2분 안에 설명할 수 있는 기본 지식 확보,
  (2) En-ROADS 한국어 UI 자원봉사 번역 제안의 근거 자료,
  (3) 향후 LLM Wiki 기후 정책 페이지의 초안.
- **한계**:
  - 본 자료는 *공식 자료가 아니다*. Climate Interactive의 공식 한국어 번역이 출시되면 그것을 우선으로 한다.
  - 시뮬레이터 본체는 시간이 지나면 슬라이더 디폴트와 기본 가정이 갱신된다. 본 정리본은 2026년 5월 시점의 User Guide·Tech Ref 최신본을 기준으로 한다.
  - 한국 맥락 코멘트는 명시적으로 "한국 맥락" 표시를 한 부분에만 들어 있고, 원문 정리와 구분된다.
- **인용 방식**:
  - User Guide 인용: `(UG / coal)` `(UG / about)` 처럼 페이지 슬러그로 표시.
  - Technical Reference 인용: `(Tech Ref p.NN)` 으로 표시.
  - 라이선스: 본 문서의 원문 인용 부분은 모두 **Climate Interactive, CC BY 4.0** 라이선스 하에 있다.

---

## 1. En-ROADS란

### 1.1 한 문장 정의

> En-ROADS는 "전 지구적 에너지·토지이용·경제·정책 변화가 기후에 미치는 영향을 수초 내에 보여주는 대화형 시뮬레이션 모델"이다. (UG / about, Tech Ref p.4)

키워드 세 개로 요약하면: **글로벌 단일 모델**, **시스템 다이내믹스**, **수초 응답**.

### 1.2 개발 주체·연혁·버전

- **개발 주체**: Climate Interactive(주관), Ventana Systems(Tom Fiddaman), MIT Sloan(John Sterman 교수), UMass Lowell Climate Change Initiative(Juliette Rooney-Varga 교수). Homer Consulting, Pontifex Consulting 도 참여. (Tech Ref p.4)
- **모델 계보**: 먼저 개발된 국가 단위 시뮬레이터 **C-ROADS**의 후속작. C-ROADS는 "각 국가/지역이 약속한 감축이 전 지구 온도에 어떻게 더해지는가"를 보고, En-ROADS는 "전 지구적 정책·기술·소비 변화가 배출과 온도에 어떻게 작용하는가"를 본다. (UG / about)
- **버전**: 본 자료집 기준 Tech Ref 최종 갱신 *Last updated May 2026* (Tech Ref p.4). 시뮬레이터는 무료로 https://en-roads.climateinteractive.org 에서 접근 가능.

### 1.3 무엇을 할 수 있고 무엇은 할 수 없는가

**할 수 있는 것**
- 세금/보조금, 탄소가격, 에너지 효율, 전기화, 인구·경제 가정 등 **18개 레버(슬라이더)**를 한 번에 또는 조합하여 조정.
- 2100년까지 **전 지구 평균기온, CO₂ 농도, 에너지 믹스, GDP 영향, 해수면, 대기질, 작물수확** 등 100여 개 출력 그래프 실시간 갱신.
- 시나리오를 **고유 URL로 공유** → 워크숍·교실·정책토론에 그대로 활용.

**할 수 없는 것**
- **국가별 분해 불가**: En-ROADS는 전 지구 단일 모델이다. "한국이 2030년에 몇 톤 줄이나"는 답할 수 없다. 국가별 합산이 궁금하면 C-ROADS를 쓴다. (UG / about)
- **예측이 아님**: Tech Ref 6쪽 명시 — *"It is not intended as a tool for prediction or projections."* 미래 시나리오를 **탐색**하는 도구지 예언하는 도구가 아니다.
- **세분화 부족**: 산업별 미시 동학, 지역 차이, 단기 충격(전쟁·금융위기) 등은 단순화. 정밀 계산이 필요하면 IAM(통합평가모형) 컨소시엄 모델을 쓰라고 본인이 권한다. (UG / about)

### 1.4 다른 기후 시뮬레이터와의 차이

| 도구 | 단위 | 강점 | 한계 |
|---|---|---|---|
| **En-ROADS** | 전 지구 단일 | 대화형, 수초 응답, 정책 조합 탐색 | 국가별 분해 불가, 예측 아님 |
| **C-ROADS** | 국가/지역 그룹 | NDC 합산이 전 지구 온도로 어떻게 환산되는지 보기 좋음 | 에너지 시스템 디테일 부족 |
| **IAM (IPCC AR6 등)** | 다지역·다부문 | 정밀한 시나리오 산출, 학술 인용 가능 | 실행 시간 수 시간~수일, 비대화형 |

시민회의 분임 토론에서는 **En-ROADS**가 압도적으로 적합하다. 시민이 "그럼 이거 켜면?"이라고 물을 때 즉시 답이 나온다.

---

## 2. 시뮬레이터 사용법 (Tutorial 한국어판)

### 2.1 화면 구성

- **좌·우 그래프 패널**: 기본은 온도와 CO₂ 농도. 패널 상단 드롭다운으로 100여 개 그래프 중 선택. (UG / tutorial)
- **하단 슬라이더 영역**: 18개 레버. 각 슬라이더 좌측 작은 +/− 가 디폴트 값 기준의 강도를 보여준다.
- **상단 툴바**: Share(공유 URL), Settings(단위·언어), View Assumptions(가정 보기).

### 2.2 슬라이더 조작

- 슬라이더를 클릭하면 **상세 뷰**가 열린다. 여기서:
  - 정책 설명 (한 문단)
  - 단위 표시 및 직접 숫자 입력
  - "관련 그래프(Related Graphs)" 드롭다운으로 이 레버에 가장 직접 영향받는 그래프를 띄울 수 있다.
- 슬라이더는 모두 "현 상태(status quo) = 0"을 기준으로 움직인다. 예를 들어 석탄 슬라이더 0은 "현재 글로벌 석탄에 약 30% 보조금이 들어가 있는 상태"를 의미한다 — 0이 *중립*이 아님에 유의. (UG / coal)

### 2.3 시나리오 URL 공유

- 우측 상단 **Share Your Scenario** → 고유 URL이 생성된다.
- URL에는 (a) 모든 슬라이더 값, (b) 마지막으로 본 좌·우 그래프 종류가 인코딩되어 들어간다.
- 워크숍에서 분임별 시나리오를 공유 URL로 모으면, 진행자가 분임 결과를 한 화면에서 비교하기 쉽다.

**URL 파라미터 구조 (v1.1 패치 2026-05-31)** *[1차자료 추적 결과]*

En-ROADS 공식 User Guide에는 URL 파라미터의 ID 매핑표가 게시되어 있지 않다. 그러나 Cognizant AI Labs의 오픈소스 래퍼 `en-roads-py` (https://github.com/cognizant-ai-labs/en-roads-py) 소스코드 분석으로 다음 사실이 확정된다.

- **URL 형식**: `https://en-roads.climateinteractive.org/scenario.html?v={SDK_VERSION}&p{ID}={VALUE}&p{ID}={VALUE}…`
  (출처: `enroadspy/generate_url.py`의 `actions_to_url()` 함수 — 코드 원문 `template += f"&p{key}={val}"`)
- **`{ID}`의 정체**: SDK 내부 JavaScript 번들의 `var inputSpecs = [...]` 배열에 정의된 **정수형 고유 ID**. 슬라이더(UI) 1개가 종종 여러 입력 변수에 대응하므로 ID는 18개가 아니라 **수백 개 단위** (예: 알려진 BAD_SWITCH ID = 263).
- **`{VALUE}`**: 실수(예: 보조금/세금/연도). 단위는 변수마다 다름 — coal은 `tce`(석탄환산톤), oil은 `boe`, gas는 `mcf` 등.
- **확정된 변수명 리스트(부분, varId 기준)**: `en-roads-py` 의 `evolution/configs/old/allaction.json` 에 약 80여 개 액션 변수의 Vensim varId가 명시되어 있다. 대표 예:
  - `_source_subsidy_delivered_coal_tce` — 석탄 보조금/세금
  - `_carbon_tax_initial_target` — 탄소가격 초기 목표
  - `_source_subsidy_renewables_kwh` — 재생에너지 보조금
  - `_source_subsidy_nuclear_kwh` — 원자력 보조금
  - `_no_new_coal`, `_no_new_oil`, `_no_new_gas`, `_no_new_bio` — 신규 건설 중단 토글
  - `_target_accelerated_retirement_rate_electric_coal` — 석탄 조기폐쇄율
  - `_electric_standard_target`, `_emissions_performance_standard` — 청정전력기준·배출성능기준
  - `_electric_carrier_subsidy_transport` — 운송 전기화 보조금
  - `_annual_improvement_to_energy_efficiency_of_new_capital_stationary` — 건물·산업 효율
  - `_target_change_in_other_ghgs_for_ag` — 농업 비CO₂ 감축
  - (전체 ~80개 액션 + ~100개 디테일 변수 = 총 200여 개로 추정)
- **varId ↔ 정수 ID 매핑표**: **공식 미공개**. 매핑은 `enroadspy/en-roads-sdk-{버전}/packages/en-roads-core/dist/index.js`의 `inputSpecs` 배열에 들어 있고, 이 SDK는 Climate Interactive가 라이선스 신청자에게만 배포(`load_sdk.py`에서 비공개 다운로드 URL 사용).
- **권고**: 공식 매핑표가 공개되지 않은 현 시점에서 위키/번역 작업 시에는 (가) 시뮬레이터에서 슬라이더를 한 번에 하나씩 움직이고 URL을 캡처해 ID를 역추적하거나, (나) Climate Interactive에 SDK 접근을 신청한다 (en-roads-py README의 `daniel.young2@cognizant.com` 또는 Climate Interactive 공식 채널). v2에서 본 매핑표를 보강한다.

### 2.4 그래프 해석

핵심으로 봐야 할 그래프:
- **Global Temperature Change (전 지구 평균기온 변화)**: 2100년 기준 ℃ 상승 — 가장 자주 보게 될 한 줄 요약.
- **Greenhouse Gas Net Emissions**: 총 온실가스 순배출.
- **Kaya Identity Graphs**: 인구 × 1인당 GDP × 에너지 집약도 × 탄소 집약도 — 각 요소가 어떻게 변하는지 4개 작은 그래프로 분해해 보여준다. (UG / kaya)
- **Energy Supply by Source**: 에너지원별 공급 추이. 정책 효과를 시각적으로 가장 잘 보여준다.
- **Impacts**: 해수면, 작물수확, 폭염 사망, 산성화 등.

---

## 3. 베이스라인 시나리오와 기후 영향

### 3.1 베이스라인이 보여주는 결과

En-ROADS 베이스라인은 *"현 시점까지 도입·관측된 정책·기술 추세가 그대로 유지될 경우"*를 가정한다. 미국 IRA, 중국 "1+N" 프레임워크 등 이미 발효된 정책의 영향은 들어가 있지만, **각국 NDC와 넷제로 선언은 반영되지 않는다** — "약속은 변경되거나 미이행될 수 있다"는 보수적 입장 때문. (UG / baseline)

**베이스라인 2100년 주요 수치 (v1.1 패치 2026-05-31)**

| 지표 | 값 | 출처 / 비고 |
|---|---|---|
| 2100년 전 지구 평균기온 상승 | **+3.3 °C (+5.9 °F)** (산업화 이전 대비) | Climate Interactive 공식 블로그(June 2023 update, v23.6.0). 이전 v20.12 베이스라인은 +3.6 °C(+6.5 °F), 그 이전(2020년 이전)은 +4.1 °C(+7.3 °F). 경제피해함수(damage function) 도입으로 0.26 °C 하향. |
| 베이스라인 정의 | "현 정책·기술 추세 유지(IRA·중국 1+N 등 발효된 정책 반영, 각국 NDC·넷제로 *선언*은 미반영)" | UG/baseline. NGFS Current Policies Scenario와 정합 검증됨. |
| CO₂ 농도·해수면·연배출량 | **User Guide·Tech Ref에 2100년 단일 수치 미게시.** 시뮬레이터에서 직접 캡처 필요. | 시민회의 진행 시점에 좌·우 그래프 드롭다운에서 "Atmospheric CO₂ Concentration", "Sea Level Rise", "Greenhouse Gas Net Emissions" 선택 후 2100년 값 캡처. |

> **주의(버전 의존)**: En-ROADS는 매년 1~2회 모델 업데이트가 있으며, 그때마다 베이스라인 2100년 온도가 조정된다(예: 2020→2023 사이 −0.8 °C 변동). 시민회의 *당일* 시뮬레이터에서 최신값을 재확인하고 자료를 갱신한다. 본 표의 +3.3 °C는 v23.6.0(June 2023) 이후 2026년 5월 기준 가장 최근 공식 수치다. — 출처: Climate Interactive 블로그 "En-ROADS and C-ROADS June 2023: Baseline Scenario" 및 changelog v23.6.0.

### 3.2 모델링되는 영향(Impacts)

En-ROADS는 단지 "온도가 몇 ℃ 오른다"가 아니라 그 결과까지 추적한다. (UG / impacts)

| 영역 | 추적 변수 예 |
|---|---|
| 대기 | CO₂·CH₄·N₂O 농도, 복사강제력 |
| 극한기후 | 폭염 빈도, 폭염 사망, 허리케인 노출, 강 범람 위험 |
| 건강·경제 | 대기오염 노출, 작물수확 손실, GDP 손실, 매개 감염병 노출 |
| 해양 | 해수면 상승, 해양산성화, 북극 해빙 |
| 생태계 | 가뭄, 산불 위험, 건조지 확대, 종 멸종 위험 |

특히 **대기오염**은 석탄·석유·가스 연소와 직접 연결되어, "탈화석연료의 즉시 효과(공중보건)"를 시각적으로 보여주기 좋다. 시민회의 분임에서 "기후만이 아니라 미세먼지가 줄어듭니다" 같은 공편익(co-benefit) 메시지로 활용 가능.

---

## 4. 18개 레버 — 시민회의 분과별 매핑

> 각 레버: **① 정의 / ② 디폴트 가정 / ③ 한국 맥락 주의 / ④ 시민회의 의제와의 연관** 4단으로 정리.

### 감축분과 1 — 에너지 공급측 (7개)

#### 4.1 Coal 석탄 (UG / coal)
- **정의**: 석탄 채굴·연소를 억제(세금) 또는 장려(보조금)하는 슬라이더. 석탄은 화석연료 중 단위에너지당 CO₂가 가장 많다.
- **디폴트**: 약 **−30% 보조금**(즉 현재 글로벌 석탄에 보조금이 깔려 있다). 슬라이더 0%는 "세금=보조금" 상쇄점.
- **메커니즘**: 비용 변화 → ① 신규 발전소 투자, ② 기존 설비 가동률, ③ 조기 폐쇄 — 세 경로로 작동.
- **주의(원문)**: *풍선 짜기(balloon squeeze)* — 석탄만 누르면 가스 수요가 올라간다. 단독 사용보다 탄소가격과 묶어 쓰라고 권고.
- **한국 맥락**: 한국은 발전 부문에서 석탄 비중이 **28.1%(167.2 TWh, 2024년 발전량 기준)** *[v1.1 패치 — 한국전력거래소·산업부 2024 실적]*. 가스(28.1%, 167.2 TWh)와 공동 2위. 2023년 대비 발전량은 9.6% 감소 — 감소세 가시화. 시민회의에서 "석탄 조기폐쇄 연도"가 의제로 다뤄질 가능성이 크므로, 본 레버는 반드시 1번으로 시연.

#### 4.2 Oil 석유 (UG / oil)
- **정의**: 석유 시추·정제·소비를 억제/장려.
- **디폴트**: 현재 글로벌은 **순세금 +0~20%**(석유는 보조금보다 세금이 큰 거의 유일한 화석연료).
- **메커니즘**: 신규 인프라 투자·기존 설비 가동·약 30년 평균수명 인프라 폐기 결정에 영향.
- **주의**: 석유에만 세금을 매기면 석탄·가스 수요가 올라가므로 단독 효과는 제한적.
- **시민회의 연관**: 운송 전기화(4.10)와 묶어 토론.

#### 4.3 Natural Gas 천연가스 (UG / gas)
- **정의**: 발전·난방·산업용 가스의 채굴·연소 억제/장려.
- **디폴트**: **−25~−35% 보조금**. 가스 산업도 보조금 수혜.
- **메커니즘**: 신규 가스발전 투자·기존 설비 가동률·폐기 시점 3축.
- **주의**: 가스 억제 시 석탄 수요 반등 위험. 에너지 가격 상승의 저소득층 부담도 명시.
- **한국 맥락**: 한국 LNG 발전 비중 **28.1%(167.2 TWh, 2024년)** *[v1.1 — KPX 2024 실적]*. 2023년 대비 +6.0%로 증가. 석탄→가스→재생 단계 vs 석탄→재생 직행 논쟁의 핵심.

#### 4.4 Renewables 재생에너지 (UG / renewables)
- **정의**: 태양광·풍력·지열 등 무탄소 발전 확대.
- **디폴트**: **levelized cost의 25% 보조금**.
- **메커니즘**: 가격 하락 → 수요 증가 + 학습효과(누적 설치 → 단가↓)로 추가 성장.
- **주의**: 에너지가 싸지면 전체 수요가 늘어 효과 일부 상쇄(rebound). **전기화 정책과 묶어야 효과 극대화**.
- **한국 맥락**: 한국 신재생 발전 비중 **10.6%(63.2 TWh, 2024년)** — 사상 처음 10% 돌파. *[v1.1 — 산업부·KPX 2024 실적]* 2023년 대비 +11.7%로 최고 증가율. 신재생 내부 구성: 태양광 51.8% · 바이오 19.8% · 연료전지 11.8% · 수력 6.8% · 풍력 5.3% · IGCC 3.3%. 여전히 OECD 최하위권. 본 레버를 강하게 올리는 시나리오가 가장 직관적.

#### 4.5 Nuclear 원자력 (UG / nuclear)
- **정의**: 원전 건설 장려/억제. 무탄소이나 폐기물.
- **디폴트**: 약 **30% 보조금**(현 글로벌 평균).
- **메커니즘**: 세금·보조금이 통합된 단일 슬라이더. 정책 적용 후 **10년 단계적 도입 지연**.
- **주의**: 풍력·태양광과 달리 비용 학습효과가 거의 없어 상대적으로 비싸진다. 재생을 밀어내는 *crowding out* 위험.
- **한국 맥락**: 원자력 발전 비중 **31.7%(188.8 TWh, 2024년)** — **2024년 사상 처음 최대 발전원으로 등극**(석탄·가스 추월). *[v1.1 — 산업부·KPX 2024 실적]* 2023년 대비 +4.6%. 시민회의에서 가장 의견이 갈리는 레버 중 하나. **모더레이터는 옹호도 반대도 하지 말고 본 슬라이더로 시민이 직접 결과를 보게 한다**.

#### 4.6 New Zero-Carbon 신기술 (UG / newtech)
- **정의**: 핵융합·토륨·SMR 등 "아직 없는 저렴한 무탄소 발전" 가정.
- **디폴트**: 돌파(breakthrough) 연도=현재년, 상용화까지 20년, 초기 비용=석탄의 2배.
- **메커니즘**: 상용화 20년 + 개발 5년 + 건설 5년의 **장기 지연** 후 다른 에너지원과 경쟁.
- **주의**: 신기술도 재생·원전을 밀어내는 crowding out 가능. 시민이 "신기술 하나로 다 해결" 환상을 가질 때 본 레버의 지연을 보여주면 효과적.

#### 4.7 Bioenergy 바이오에너지 (UG / bioenergy)
- **정의**: 목재·작물·폐기물의 에너지화. 고체·액체·가스 형태.
- **디폴트**: 약 **15% 보조금**.
- **메커니즘**: 작물·폐기물 바이오는 순배출 0에 가깝지만, **목재 바이오는 재생 지연으로 순배출 +**.
- **주의(원문 강조)**: *"목재 바이오에너지 장려는 순 CO₂를 증가시킨다."* 직관과 반대되는 결과 — 시민회의에서 주의 깊게 설명.

---

### 감축분과 2 — 수요·전기화·가격 (5개)

#### 4.8 Carbon Pricing 탄소가격 (UG / carbonprice)
- **정의**: 전 지구 탄소가격(또는 청정전력 기준) 부과.
- **디폴트**: **0 ~ $5/tCO₂** 범위. (즉 거의 0에서 시작.)
- **메커니즘**: 가격↑ → 석탄 급감, 재생 상대비용↓. 전체 에너지 수요도 함께 감소.
- **주의(원문 강조)**: *"비용이 소비자에게 전가될 수 있으니, 저소득층 영향 최소화 설계 필요."* 정의로운 전환(Just Transition) 필수.
- **한국 맥락**: 한국 K-ETS는 무상할당 비율이 높아 사실상 매우 낮은 탄소가격. 본 레버를 50~100$/tCO₂로 올린 시나리오는 시민에게 *"이만큼 강해야 효과가 보인다"*는 감각을 준다.
- **시민회의 연관**: 가장 강력한 단일 레버. 거의 모든 분과 토론에서 등장 가능.

#### 4.9 Transport — Energy Efficiency 운송 에너지효율 (UG / transport_ee)
- **정의**: 차량·선박·항공의 효율 개선, 대중교통·자전거·도보 확대.
- **디폴트**: 연간 효율 개선율 **0~1%**(현상유지). 상향 시 1~2%, 2~3%.
- **주의**: 기존 차량 교체 지연. 보행·자전거 인프라가 저소득층 동네에 적게 깔리는 형평성 문제.

#### 4.10 Transport — Electrification 운송 전기화 (UG / transport_elec)
- **정의**: 전기차·전기버스·전기열차·수소 선박·항공 확대.
- **디폴트**: 전기차에 약 **7% 보조금**(현상유지).
- **주의**: 전기 자체가 무탄소여야 효과 발생. 리튬 채굴 환경 영향·접근성 불평등.
- **한국 맥락**: K 자동차 산업과 직결. 시민회의에서 "전기차 보조금"과 "충전 인프라"가 함께 다뤄질 가능성.

#### 4.11 Buildings & Industry — Energy Efficiency 건물·산업 효율 (UG / buildings_ee)
- **정의**: 단열, 가전·산업기계 효율.
- **디폴트**: 연간 효율 개선 **+1.0~+1.7%**.
- **주의**: 기존 자본 회전 지연. 저소득층·세입자의 초기 비용 접근성 제한.

#### 4.12 Buildings & Industry — Electrification 건물·산업 전기화 (UG / buildings_elec)
- **정의**: 가스·기름 보일러를 히트펌프·전기로 교체.
- **디폴트**: 보조금 **0~+5%** (현상유지).
- **주의**: 전기 그리드가 재생·무탄소화되어 있어야 의미. 기존 장비 퇴역까지 수십 년.

---

### 적응분과 — 구조·자연·기타 (6개)

#### 4.13 Population Growth 인구 (UG / population)
- **정의**: 인구 성장률 가정. 온실가스 증가의 근본 동인.
- **디폴트**: UN 중간 시나리오, 2100년 약 **100.0~104.0억 명** (10.0~10.4 *billion people*). *[v1.1 패치 2026-05-31 — 단위 정정]* 영어 원문 "10.0 to 10.4 billion"은 *10억 단위*이므로 한국어로는 "100~104억 명"이 정확. 슬라이더는 UN 중간(medium variant)에서 95% 확률범위 양 끝을 잡는다(UG/population 원문: *"the 95% probability range of population deviating from the United Nation's medium population growth path"*). UN World Population Prospects 2024 medium variant 2100년 추정은 약 102억 명으로, En-ROADS 디폴트 중앙값과 정합.
- **메커니즘**: 에너지 수요가 인구에 비례. 인구가 바뀌면 모든 에너지원이 같이 흔들림.
- **주의(원문 강조)**: **윤리적 접근** — 강제가 아닌 *여성 교육 확대·가족계획 접근성*. 효과는 수십 년에 걸쳐 서서히.

#### 4.14 Economic Growth 경제성장 (UG / econ_growth)
- **정의**: 1인당 GDP 성장률.
- **디폴트**: 장기 **1.2~1.9%**, 단기 **2.2~2.9%**.
- **메커니즘**: GDP↑ → 배출↑ / 기후악화 → GDP↓ (균형 루프).
- **주의**: 성장률을 낮추면 정부 적자·긴축으로 저소득층 타격. "탈성장"을 직접 추천하는 슬라이더가 아니라, 가정의 민감도를 보는 도구.

#### 4.15 Agricultural Emissions & Food 농업 배출·식생활 (UG / ag_emissions)
- **정의**: 축산·작물의 CH₄·N₂O 감축, 육류 소비·음식물 낭비 감소.
- **디폴트**: 메탄 집약도 매년 소폭 개선.
- **메커니즘**: 우수사례(GHG-효율적 축산·시비 관리) 30년 확산.
- **주의**: 농업 배출 완전 제거 불가. 쌀 등 필수작물 감축은 식량안보 위협.
- **한국 맥락**: 한국은 농업 배출 비중이 작지만 메탄(논·축산) 정책이 의제로 다뤄질 수 있음.

#### 4.16 Waste & Leakage 폐기물·누출 (UG / waste)
- **정의**: 매립지·폐수의 CH₄·N₂O, 화석연료 누출 메탄, 불소화학물질(F-gases).
- **디폴트**: 감축 잠재 **0~20%** 수준의 현상유지.
- **주의**: 100% 슬라이더로 올려도 불가피한 배출이 남음.

#### 4.17 Deforestation & Forest Degradation 산림파괴 (UG / deforestation)
- **정의**: 농지 확장 등 산림→타용도 전환. 성숙림 황폐화는 목재 수확.
- **디폴트**: 산림파괴율 **−1~0%** 감소(현상유지).
- **메커니즘**: 산림보호·식량체계 개선이 산림파괴↓.
- **주의(원문)**: *"화석연료 배출이 훨씬 크다"* — 산림만으로는 부족.

#### 4.18 Nature-based + Technological CDR 자연·기술 탄소제거 (UG / nature_based_removal, tech_removal)
*※ 본 슬라이더는 두 개로 분리되어 있다 — 시민회의 설명 시 둘로 쪼개서 보여주는 것을 권장.*

- **자연기반(Nature-based CDR)**:
  - 신규조림(afforestation), 산림복구, 농업 탄소격리, 바이오숯(biochar).
  - 디폴트: 2018년 영국 왕립학회 보고서 중간값. 바이오숯 최대 약 **3.5 GtCO₂/년**.
  - 주의: 산불·해충·벌목으로 다시 방출 가능. 화석연료 배출에 비해 규모 제한.
- **기술적(Technological CDR)**:
  - DACCS(직접공기포집·저장), 강화된 광물화(enhanced mineralization).
  - 디폴트: 최대 슬라이더 = **$1000/tCO₂ 보조금**. 왕립학회 2018년 기준.
  - 주의: 아직 파일럿 단계. 포집된 CO₂의 장기 저장 안정성이 관건.
- **공통 시민회의 메시지**: CDR은 *마지막에 남는 잔여 배출 처리용*이지 *감축을 미루는 핑계*가 아니다 — "moral hazard" 주의.

---

## 5. 모델 구조 개요 (Technical Reference 요약)

> Tech Ref(131p)의 목차 기반 13개 영역을 각 1단락 한국어 요약. 방정식은 옮기지 않는다. (Tech Ref Table of Contents, p.2)

1. **Demand (에너지 수요)** — 운송·건물·산업의 전기/비전기 에너지 수요를 인구·1인당 GDP·에너지 집약도로 산출. 자본재 빈티지별 효율 차이와 retrofit·은퇴를 추적.
2. **Supply (에너지 공급)** — 석탄·석유·가스·바이오·재생·원전·신기술 7개 공급원. 각각 자본 비용, 학습효과, 보완자산(예: 충전 인프라), 자원 가용성을 모형화.
3. **Market Clearing and Utilization (시장 청산·가동률)** — 공급-수요 가격 신호와 자본 가동률 결정. *목욕통 동학* 비유.
4. **Land Use, Land Use Change, and Forestry (토지이용·산림)** — 농지 수요, 바이오에너지 수확, 산림→농지 전환.
5. **Terrestrial Biosphere Carbon Cycle (육상생물권 탄소순환)** — 생물량·토양 탄소, 광합성·호흡, 토지·농업 기원 CO₂·CH₄·N₂O.
6. **Emissions (배출)** — 에너지 CO₂, 토지 CO₂, 산업 CH₄·N₂O·F-gases, 폐기물 CH₄·N₂O, 에어로졸. (Tech Ref p.5 Figure 1.1)
7. **Carbon Dioxide Removal / CDR (탄소제거)** — 자연기반·기술기반·BECCS·CCS 통합. 비용·잠재·누출 위험.
8. **Well-Mixed Greenhouse Gas Cycles (혼합 온실가스 순환)** — CO₂·CH₄·N₂O 농도와 복사강제력.
9. **Climate (기후)** — 농도→복사강제→온도 변화. 기후 민감도 가정.
10. **Ocean Systems (해양)** — 대기-해양 탄소·열 플럭스, 해수면, 해양산성화.
11. **Damage to GDP (GDP 피해)** — 온도 상승의 경제 영향(피드백).
12. **Other Impacts (기타 영향)** — 폭염·작물·종 멸종·해빙 등 환경·보건 지표.
13. **Initialization, Calibration, Model Testing (초기화·보정·검증)** — IAM·관측 데이터와의 정합 시험.

**핵심 메시지(원문)**: *"En-ROADS is a simple climate model and complements the other, more disaggregated models."* (Tech Ref p.4) — 단순한 모델이며, 정밀 모델을 *보완*하는 위치다.

---

## 6. 한국어 용어집 (영-한)

> Climate Interactive Glossary (UG / glossary) 및 본문 빈출어를 기준으로 작성. 한국어 권장 번역은 환경부·탄소중립기본법·IPCC 한국어판을 참고하되, 최종 권위 있는 번역은 환경부·기상청 공식 번역을 우선한다.

| 영어 | 한국어(권장) | 비고 |
|---|---|---|
| Afforestation | 신규조림 | 본래 숲이 없던 곳에 조성 |
| Reforestation | 재조림/산림복구 | 벌채·훼손지에 다시 |
| Anthropogenic | 인위적/인간기원 | |
| BECCS | 바이오에너지 CCS / 바이오에너지 탄소포집·저장 | |
| Biochar | 바이오숯 | |
| Biomass | 바이오매스/생물량 | |
| BOE | 석유환산배럴 | 에너지 단위 |
| Capital Stock Turnover | 자본재 회전 | "기존 설비 폐기·교체 주기" |
| Carbon Intensity | 탄소집약도 | 에너지 단위당 CO₂ |
| Carbon Pricing | 탄소가격 | |
| Cap-and-Trade | 배출권거래제 | 한국 K-ETS |
| Carbon Tax | 탄소세 | |
| CCS | 탄소포집·저장 | |
| CDR | 탄소제거 / 이산화탄소 제거 | "감축"과 구분 |
| Climate Sensitivity | 기후민감도 | CO₂ 2배에 따른 온도 상승 |
| Co-benefit | 공편익 | 기후 외 효과(예: 대기질) |
| Crop Yield | 작물수확량 | |
| DACCS | 직접공기포집·저장 | Direct Air CCS |
| Deforestation | 산림파괴/삼림훼손 | |
| Equity / Just Transition | 형평성 / 정의로운 전환 | |
| Energy Intensity | 에너지집약도 | GDP 단위당 에너지 |
| F-gases | 불소화학물질/불화가스 | HFC·PFC 등 |
| GHG | 온실가스 | |
| GtCO₂ | 기가톤 이산화탄소 | 10억 톤 |
| IAM | 통합평가모형 | |
| Kaya Identity | Kaya 항등식 | 인구·GDP·에너지·탄소 4요소 |
| Leakage (Methane) | 메탄 누출 | |
| Levelized Cost (LCOE) | 균등화발전비용 | |
| Mitigation | 감축 | "적응"과 구분 |
| Adaptation | 적응 | |
| Nature-based Solutions | 자연기반해법 | |
| NDC | 국가결정기여 | |
| Net Zero | 넷제로/탄소중립 | |
| Overshoot | 오버슈트 | 1.5℃ 초과 후 회귀 |
| Primary Energy Demand | 1차에너지 수요 | |
| Radiative Forcing | 복사강제(력) | |
| Renewables | 재생에너지 | |
| Retrofit | 개보수 | |
| Sea Level Rise | 해수면 상승 | |
| SMR | 소형모듈원자로 | |
| Stranded Assets | 좌초자산 | |
| Status Quo | 현상유지 | 슬라이더 0의 의미 |
| Subsidy | 보조금 | |
| Tax | 세금/조세 | |
| Tipping Point | 임계점 | |
| Vintage (Capital) | 빈티지(자본재 연식) | |
| Well-Mixed GHGs | 혼합 온실가스 | 대기 중 균질 분포 |
| Zero-Carbon | 무탄소 | |
| Electrification | 전기화 | |
| Hydrogen | 수소 | 운송·산업 적용 |
| Ocean Acidification | 해양산성화 | |
| Capacity Utilization | 가동률 | |
| Bathtub Dynamics | 목욕통 동학 | 누적 저량(stock) 비유 |
| Balloon Squeeze | 풍선 짜기 | 한 곳 누르면 다른 곳 부풀기 |

---

## 7. 시민회의 활용 시나리오

### 7.0 한국 2024 발전량 믹스 (시민 토론 배경 수치) *[v1.1 패치 2026-05-31]*

| 발전원 | 2024 발전량(TWh) | 비중 | 2023 대비 | 비고 |
|---|---|---|---|---|
| **원자력** | 188.8 | **31.7%** | +4.6% | 2024년 사상 처음 최대 발전원 등극 |
| **석탄** | 167.2 | 28.1% | −9.6% | 감소세 가시화 |
| **LNG(가스)** | 167.2 | 28.1% | +6.0% | 석탄과 공동 2위 |
| **신재생** | 63.2 | **10.6%** | +11.7% | 사상 첫 10% 돌파 |
| 기타(양수·집단 등) | (잔여) | ~1.5% | | |

- 출처: 산업통상자원부·한국전력거래소(KPX) 2024년 전력시장 실적(2025.5 발표). 단위: 발전량(TWh) 기준.
- 신재생 내부 구성(발전량 기준): 태양광 51.8% · 바이오 19.8% · 연료전지 11.8% · 수력 6.8% · 풍력 5.3% · IGCC 3.3% · 기타.
- **시민회의 활용**: 분임 토론에서 En-ROADS의 글로벌 비중과 한국 비중을 나란히 보여주면 "한국이 어디서 어디로 가야 하는가"를 시민이 직관적으로 잡는다. 단, **En-ROADS는 국가 분해 불가**(§1.3)이므로 한국 수치는 *외부 자료*로만 보여주고 시뮬레이터 본체와 혼동시키지 않는다.

### 7.1 분임 토론 화면 띄우기

- 분임당 1대의 노트북에 시뮬레이터를 띄우고, 모더레이터 또는 보조진행자가 "운전수" 역할.
- 시민이 슬라이더를 직접 만지게 한다 — *수동성에서 능동성으로 전환되는 핵심 순간*.
- 좌측 그래프는 항상 **온도 변화**, 우측은 토론 주제에 맞춰 변경 (예: 석탄 토론 시 → 에너지 믹스, 농업 토론 시 → 농업 CH₄).

### 7.2 시민에게 설명할 때 비유

- **목욕통 동학**: "수도꼭지(배출)를 잠가도 욕조(누적 CO₂)는 바로 안 빠진다. 마개(흡수원)도 같이 열어야 한다."
- **풍선 짜기**: "한쪽을 누르면 다른 쪽이 부푼다. 그래서 *한 가지 정책*만으로는 부족하고 조합이 필요하다."
- **자본 회전 지연**: "오늘 결정해도 도로 위 차가 다 바뀌는 데 15~20년 걸린다. 그래서 *지금* 결정해야 한다."
- **학습효과**: "태양광은 많이 깔수록 싸진다. 원전은 그렇지 않다."

### 7.3 정치적 중립 유지

- 모더레이터는 **특정 레버를 옹호하거나 비난하지 않는다**. 시민이 직접 슬라이더를 움직이고 결과를 본다.
- 단, 원문에 명시된 *과학적 사실*은 그대로 전달:
  - "목재 바이오에너지를 무조건 늘리면 순배출은 오히려 증가합니다." (UG / bioenergy)
  - "탄소가격은 저소득층 부담 완화 설계가 필요합니다." (UG / carbonprice)
  - "원자력과 재생에너지는 같이 늘리면 서로 밀어낼 수 있습니다." (UG / nuclear)
- 한국 특정 정책(탈원전·재가동 등)에 대해 *모더레이터 본인*의 입장은 절대 발설 금지.

---

## 8. 한국어 UI 자원봉사 번역 — 현 상황과 다음 단계

### 8.1 현재 상태

- En-ROADS 본체는 **비공개 코드**이나 모든 **방정식과 가정은 Tech Ref(131p)로 공개**되어 있다.
- UI 번역은 Climate Interactive가 **자원봉사 모델**로 운영. 2026년 5월 기준 약 22개 언어 지원.
- 한국어는 부분 번역 상태(슬라이더 라벨 일부 + 그래프 제목 일부). 본격 한국어판은 미공개.

### 8.2 우리 측 제안 요약

- 본 자료집을 **한국어 번역 후보 용어집**(§6)으로 활용.
- 2026 한국 기후시민회의를 *공식 테스트베드*로 제안 → 시민이 직접 쓰며 피드백.
- 환경부·탄소중립기본법 공식 한국어 용어와의 정합을 우리 측에서 1차 검수.
- 별도 문서 `CI_한국어번역_제안서_draft1.md` 에서 상세 제안.

### 8.3 다음 단계 (제안)

1. Climate Interactive 측에 공식 제안서 송부 (CC BY 4.0 라이선스 하에 우리가 만든 §6 용어집 첨부).
2. 본 자료집 v1을 한국어 위키(LLM Wiki) 페이지로 변환 — En-ROADS 한국어 첫 페이지.
3. 분임 모더레이터 사전 교육에서 본 자료집 §2·§4·§7 중심으로 1.5시간 워크숍.

---

## 9. 출처 및 인용 (CC BY 4.0)

### User Guide (29개 페이지)
- https://docs.climateinteractive.org/projects/en-roads/en/latest/guide/about.html
- https://docs.climateinteractive.org/projects/en-roads/en/latest/guide/tutorial.html
- https://docs.climateinteractive.org/projects/en-roads/en/latest/guide/structure.html
- https://docs.climateinteractive.org/projects/en-roads/en/latest/guide/baseline.html
- https://docs.climateinteractive.org/projects/en-roads/en/latest/guide/kaya.html
- https://docs.climateinteractive.org/projects/en-roads/en/latest/guide/background.html
- https://docs.climateinteractive.org/projects/en-roads/en/latest/guide/impacts.html
- https://docs.climateinteractive.org/projects/en-roads/en/latest/guide/coal.html
- https://docs.climateinteractive.org/projects/en-roads/en/latest/guide/oil.html
- https://docs.climateinteractive.org/projects/en-roads/en/latest/guide/gas.html
- https://docs.climateinteractive.org/projects/en-roads/en/latest/guide/bioenergy.html
- https://docs.climateinteractive.org/projects/en-roads/en/latest/guide/renewables.html
- https://docs.climateinteractive.org/projects/en-roads/en/latest/guide/nuclear.html
- https://docs.climateinteractive.org/projects/en-roads/en/latest/guide/newtech.html
- https://docs.climateinteractive.org/projects/en-roads/en/latest/guide/carbonprice.html
- https://docs.climateinteractive.org/projects/en-roads/en/latest/guide/transport_ee.html
- https://docs.climateinteractive.org/projects/en-roads/en/latest/guide/transport_elec.html
- https://docs.climateinteractive.org/projects/en-roads/en/latest/guide/buildings_ee.html
- https://docs.climateinteractive.org/projects/en-roads/en/latest/guide/buildings_elec.html
- https://docs.climateinteractive.org/projects/en-roads/en/latest/guide/population.html
- https://docs.climateinteractive.org/projects/en-roads/en/latest/guide/econ_growth.html
- https://docs.climateinteractive.org/projects/en-roads/en/latest/guide/ag_emissions.html
- https://docs.climateinteractive.org/projects/en-roads/en/latest/guide/waste.html
- https://docs.climateinteractive.org/projects/en-roads/en/latest/guide/deforestation.html
- https://docs.climateinteractive.org/projects/en-roads/en/latest/guide/nature_based_removal.html
- https://docs.climateinteractive.org/projects/en-roads/en/latest/guide/tech_removal.html
- https://docs.climateinteractive.org/projects/en-roads/en/latest/guide/glossary.html
- https://docs.climateinteractive.org/projects/en-roads/en/latest/guide/changelog.html

### Technical Reference
- `En-ROADS_Technical_Reference.pdf` (131p, Last updated May 2026, CC BY 4.0).
- 본 자료집에서 직접 인용한 페이지: p.2 (Table of Contents), p.4 (저자·서문), p.5 (Figure 1.1 모델 구조), p.6 (Purpose and Intended Use).

### v1.1 패치(2026-05-31)에서 추가된 1차자료

**En-ROADS URL 파라미터 구조 (§2.3)**
- Cognizant AI Labs, `en-roads-py` GitHub repository: https://github.com/cognizant-ai-labs/en-roads-py
  - `enroadspy/generate_url.py` — URL 인코딩 함수 `actions_to_url()` (raw: https://raw.githubusercontent.com/cognizant-ai-labs/en-roads-py/main/enroadspy/generate_url.py)
  - `enroadspy/__init__.py` — `inputSpecs` 로딩 로직, BAD_SWITCH=263, SDK 버전 정보
  - `evolution/configs/old/allaction.json` — 약 80개 Vensim varId 액션 변수 리스트
- Climate Interactive, SDEverywhere (참고): https://github.com/climateinteractive/SDEverywhere

**En-ROADS 베이스라인 2100년 수치 (§3.1)**
- Climate Interactive 블로그, "En-ROADS and C-ROADS June 2023: Baseline Scenario": https://www.climateinteractive.org/blog/en-roads-june-2023-baseline-scenario/
- Climate Interactive 블로그, "En-ROADS Updated with New Baseline Scenario" (2020-12): https://www.climateinteractive.org/blog/en-roads-updated-with-new-baseline-scenario/
- User Guide Changelog (v23.6.0 항목): https://docs.climateinteractive.org/projects/en-roads/en/latest/guide/changelog.html

**인구 디폴트 단위 정정 (§4.13)**
- En-ROADS User Guide / Population: https://docs.climateinteractive.org/projects/en-roads/en/latest/guide/population.html (원문 "10.0 to 10.4 billion")
- UN World Population Prospects 2024 medium variant (참고): https://population.un.org/wpp/

**한국 2024 발전량 믹스 (§4.1, §4.3, §4.4, §4.5, §7.0)**
- 산업통상자원부 보도자료(2025.5), "원자력, 2024년 최대 발전원 등극": 대한민국 정책브리핑 https://www.korea.kr/news/policyNewsView.do?newsId=148943045
- 한국전력거래소(KPX) 전력통계: https://epsis.kpx.or.kr/epsisnew/selectEkgeGepGesGrid.do?menuId=060102
- 한국전력거래소 공공데이터, "연료원별 시간대별 설비용량 및 전력거래량 2024-12-31": https://www.data.go.kr/data/15127395/fileData.do
- 투데이에너지(2025), "한국의 2024년 신재생에너지 발전 비중 첫 10% 돌파": https://www.todayenergy.kr/news/articleView.html?idxno=282967

### 미해결·후속 작업 로그 (v2 보강 대상)

1. **URL 정수 ID 매핑표**: SDK 비공개로 인해 varId(예: `_source_subsidy_delivered_coal_tce`) ↔ 정수 ID(예: 263) 완전 매핑표는 미확보. 향후 (a) Climate Interactive에 SDK 접근 신청, (b) 시뮬레이터에서 슬라이더 1개씩 이동 → URL 캡처로 역추적, 둘 중 한 경로로 v2에 부록 추가.
2. **베이스라인 2100년 CO₂ ppm·해수면·연배출량**: User Guide·Tech Ref·블로그 어디에도 단일 수치 미명시. 시민회의 당일 시뮬레이터 직접 캡처 후 v2 부록 갱신.
3. **한국 에너지믹스 — 1차에너지 기준**: 본 패치는 *발전량* 기준. 1차에너지(석유 수송 포함) 기준은 추가 별도 정리 필요. KEEI 에너지통계연보 최신판 인용 권장.

### 라이선스 고지
- 원저작권: © Climate Interactive, Ventana Systems, MIT Sloan, UMass Lowell. Licensed under **CC BY 4.0**.
- 본 한국어 정리본: 2026 한국 기후시민회의 모더레이터 준비팀이 CC BY 4.0 라이선스를 준수하여 재구성. 재사용 시 본 출처와 위 원문 URL을 함께 명시할 것.

---

*문서 끝. v1, 2026-05-31. 시민회의 진행 후 피드백을 받아 v2로 갱신 예정.*
