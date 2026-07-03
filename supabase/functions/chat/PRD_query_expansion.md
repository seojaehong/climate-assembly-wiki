# PRD — 그득이 챗봇 쿼리 확장 (터스 질의 recall 개선)

작성 2026-07-04. 대상 실행자: **Codex (병렬 작업)**. 이 문서만으로 clean-context에서 구현 가능하도록 자기완결.

---

## 0. 배경 / 목표

**그득이**는 기후시민회의 "의제 선정" 지원 RAG 챗봇. Supabase **edge function `chat`** (Deno) 하나로 동작.
파이프라인: 질문 → OpenAI 임베딩(text-embedding-3-large, 1536d) → RPC `match_kb`(코사인 top-k) → **유사도 게이트 FLOOR=0.47** → 통과 시 LLM(gemini→nvidia→anthropic 체인)이 <자료> 근거로만 답 → 인용 검증.

**측정된 현황(72문항 eval):** 온토픽 ~93%, 네거티브(범위밖) 100% abstain.
**남은 실패 = 1~2단어 터스 질의**: "감축 군집"(0.382), "쿨링로드"(0.333), "작업중지권"(0.385) 등. 내용은 KB에 있으나 짧은 질의가 임베딩상 확산돼 top_similarity가 FLOOR(0.47) 아래로 떨어져 거부됨.

**목표:** 짧은/터스 질의를 임베딩 전에 **완전한 질문으로 확장**해 top_similarity를 끌어올려 recall 개선. **단, false-positive(주차장·점심 등)와 전제함정은 절대 재발하지 않게.**

---

## 1. 대상 파일 / 배포

- 소스(아카이브·SoT): `wiki/supabase/functions/chat/index.ts` (이 저장소).
- 실제 배포처: Supabase project `pleyuknjnprsckssxvrh`(labor_money)의 edge function `chat`. **현재 v16.**
- 배포 방법: Codex는 `index.ts`만 수정 + 테스트 스크립트 작성까지. **실제 배포·검증은 핸드오프**(오너가 Supabase MCP `deploy_edge_function`으로 배포). Codex가 supabase CLI 접근이 되면 직접 `supabase functions deploy chat --no-verify-jwt` 가능하나, **verify_jwt=false 반드시 유지**.
- ⚠️ Deno 런타임(Node 아님). 외부 의존성 추가 금지(기존 `jsr:@supabase/*`만).

---

## 2. 현재 코드 컨텍스트 (수정 지점)

`index.ts` 내 관련 구간(요약):

```ts
const FLOOR = 0.47;
// ... getSecrets(sb) → SECRETS 테이블 app_secrets 에서 키 로드
// K(name) = Deno.env.get(name) ?? sec[name] ?? null   // 키 접근자
// keys.GEMINI = K("GEMINI_API_KEY"), GEMINI_MODEL = K("GEMINI_MODEL") ?? "gemini-2.5-flash"

// Deno.serve 안:
q = String(body.query ?? "").trim();
const k = body.k ?? 10;
// ↓↓↓ [여기] 임베딩 직전. 확장 로직 삽입 지점 ↓↓↓
const er = await fetch("https://api.openai.com/v1/embeddings", { ... input: q });
const embedding = (await er.json()).data[0].embedding as number[];
const { data: hits } = await sb.rpc("match_kb", { query_embedding: embedding, match_count: k, source_filter: source });
const rows = ...; const top = rows[0]?.similarity ?? 0;
if (!rows.length || top < FLOOR) { /* abstain */ }
```

`runLLM("gemini", model, keys, userText)` 로 Gemini 호출 패턴이 이미 있음(참고). 확장은 별도 경량 함수로.

---

## 3. 설계 (구현 명세)

### 3.1 트리거 — 짧은 질의에만
- 조건: `q.replace(/\s/g,"").length <= 12` **또는** 공백 토큰 수 `<= 2`.
- 한국어 터스는 붙여쓰기 많음("감축군집","쿨링로드") → **글자 수 기준**이 주. 긴 질의는 확장 스킵(현행 유지, 레이턴시 보호).

### 3.2 확장 방법 — Gemini 경량 호출
- `keys.GEMINI` 있으면 gemini-2.5-flash로 확장. 없으면 확장 스킵(폴백).
- 프롬프트(system): "너는 기후시민회의 '의제 선정' 자료 검색을 돕는다. 사용자의 짧은 검색어를, 자료 검색에 적합한 **완전한 한국어 질문 한 문장**으로만 바꿔라. 규칙: 의미를 추가하거나 왜곡하지 말 것. 원래 없는 주제·수치·고유명사를 지어내지 말 것. **검색어가 기후 의제·정책·사례와 무관해 보이면(예: 주차·점심·화장실·일정) 바꾸지 말고 원문 그대로 반환**. 오직 바뀐 질문 문장만 출력."
- user: 원문 질의.
- `temperature:0, thinkingConfig:{thinkingBudget:0}`, responseMimeType 텍스트. 타임아웃 8s.
- 반환 = 확장 문자열(trim). 실패/빈값 → 원문 사용.

### 3.3 임베딩·검색 — max-of-both (회귀 금지 핵심)
확장이 **절대 기존 성능을 떨어뜨리지 않도록**:
1. 원문 `q`로 임베딩+match_kb → `rowsRaw`, `topRaw`.
2. 확장이 발생했고 확장문 ≠ 원문이면, 확장문으로도 임베딩+match_kb → `rowsExp`, `topExp`.
3. **`topExp > topRaw`인 경우에만** 확장 결과(`rowsExp`)를 채택. 아니면 원문 결과 사용.
   → 확장이 도움될 때만 반영, 손해면 무시. (게이트 판정·LLM 컨텍스트는 채택된 rows로)
- 비용: 짧은 질의만 임베딩 2회 + match_kb 2회. 긴 질의는 현행 1회. OpenAI 임베딩 $0.00013/1K토큰이라 무시할 수준.

### 3.4 안전장치 (필수)
- 확장문은 **검색 임베딩에만** 사용. LLM에 넘기는 `userText`의 "질문:" 부분과 로깅 `query`는 **원문 q 유지**(사용자가 실제 물은 것).
- FLOOR 0.47 그대로. LLM 근거판정(found=false) 2차 방어 그대로.
- 환경플래그 `QUERY_EXPANSION`(app_secrets 또는 env): 값이 `"off"`면 확장 전체 비활성(현행 동작). 기본 on. → 문제 시 즉시 롤백 가능.
- 확장 실패는 답변을 막지 않는다(try/catch, 원문 폴백).
- (선택) `chat_logs`에 `expanded_query` 컬럼 있으면 기록. 없으면 스킵(스키마 변경 불필요, 무시).

---

## 4. 수용 기준 (검증 가능)

엔드포인트: `POST https://pleyuknjnprsckssxvrh.supabase.co/functions/v1/chat`
헤더: `Content-Type: application/json`, `apikey: <ANON>`, `Authorization: Bearer <ANON>`
ANON = `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBsZXl1a25qbnByc2Nrc3N4dnJoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMzOTEyMjQsImV4cCI6MjA4ODk2NzIyNH0.fP_OG2ZpP7KDtPebY4Wp20mMWlVMn5KQad7UpJ4hx08`
바디 `{"query": "..."}` → 응답 `{found, answer, top_similarity, citations[]}`. (한국어 바디는 python json.dumps로 인코딩, bash 직접보간 금지)

**A. 터스 recall 회복 (목표: 아래 전부 found=true):**
- "감축 군집", "적응 군집", "쿨링로드", "작업중지권", "배출권거래제", "정의로운전환", "다회용기", "탄소국경조정"

**B. false-positive/전제함정 무회귀 (아래 전부 found=false 유지 — 가장 중요):**
- "주차장 위치", "화장실 어디", "오늘 점심 메뉴", "의결정족수 몇 명", "2026 총 예산", "오늘 우리가 최종 선정한 3개 의제가 뭐야", "우리 의제 3개 실천과제 알려줘"

**C. 기존 온토픽 무회귀:** `scratchpad/eval_set.json`(72문항, 있으면) 재측정 시 온토픽 pass가 확장 전(≈93%) 대비 **하락 0**, 목표 상승. 네거티브 100% 유지.

**D. 레이턴시:** 짧은 질의 p50 < 5s(확장 1콜 추가분 포함).

**E. 폴백:** `QUERY_EXPANSION=off` 설정 시 확장 전 동작과 동일(회귀 0).

→ **B가 하나라도 깨지면 실패**(전제함정/로지스틱스가 확장으로 살아나면 안 됨). 확장 프롬프트의 "무관하면 원문 반환" 규칙 + max-of-both가 이를 막아야 함.

---

## 5. 산출물
1. 수정된 `wiki/supabase/functions/chat/index.ts` (확장 로직 + 플래그 + 안전장치).
2. 테스트 스크립트 `scratchpad/test_query_expansion.py` (A/B/C 자동 검증, pass/fail 출력).
3. 짧은 변경 요약(무엇을·어디에·왜) — 리뷰·배포용.

배포·prod 검증은 오너 핸드오프. **verify_jwt=false 유지, FLOOR 0.47 유지, 무료 우선 체인 유지.**
