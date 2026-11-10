# 의결 결과 파일 `result/v2` 계약 (정본)

- 작성 2026-11-10. 11/14 제9차 전체회의 권고안 70건 의결 → 16:30 세리머니 공개.
- 이 문서가 정본이다. 만드는 쪽(`scripts/export-result-v2.mjs`)과 읽는 쪽(세리머니 로더)이 모두 이 문서를 따른다.
  출발점은 `20_투표_최종안.md` ④-5이고, 달라진 점은 맨 끝 「④-5와 달라진 점」에 모았다.
- 규칙의 실행 정본은 `scripts/lib/result-v2.mjs` 의 `validateResultV2()` 다. 문서와 코드가 어긋나면 코드를 고치고 이 문서를 같은 커밋에서 고친다.

## 1. 파일 세 개

| 파일 | 뜻 | 세리머니가 읽나 |
| --- | --- | --- |
| `result_v2.json` | 결과 본문(UTF-8, JSON) | 읽는다 |
| `result_v2.json.sha256` | `<64자리 hex>␠␠result_v2.json` 한 줄 | 읽고 본문과 대조한다 |
| `result_v2_요약.txt` | 검증자가 소리 내어 대조하는 글(의제별 가결 · 부결 번호, 건별 표수, 뺀 표 사유 · 목록, 직접 입력 목록, 합계). 실명이 들어 있다 | 읽지 않는다 |

같은 폴더의 `raw/agenda<N>.json` 은 DB 에서 읽은 원자료(실명 포함)다. 세리머니로 넘기지 않는다.

`result_v2.json` 은 임시 파일에 쓴 뒤 이름을 바꿔 놓는다. 반쯤 쓴 파일은 생기지 않는다.
검사에 하나라도 실패하면 새 파일을 만들지 않고 이전 파일도 건드리지 않는다(종료 코드 2).

## 2. 모양

```json
{
  "schema": "result/v2",
  "example": true,
  "rehearsal": false,
  "status": "확정",
  "rule": "재적 과반수의 출석과 출석자 3분의 2 이상의 찬성",
  "generated_at": "2026-11-14T16:05:00+09:00",
  "agendas": [
    { "no": 1, "name": "(의제 이름)", "count": 19, "enrolled": 204, "present": 160,
      "threshold": 107, "established": true, "method": "휴대폰+서면",
      "confirmed": true, "confirmed_at": "2026-11-14T14:48:00+09:00", "signer": "(검증자)" }
  ],
  "items": [
    { "no": "1-1", "agenda": 1, "title": "(권고 제목)", "yes": 151, "nay": 4, "abstain": 5,
      "verdict": "가결", "corrected": null }
  ],
  "report_mode": "present_only",
  "report": { "status": "발표" },
  "summary": { "total": 70, "passed": 69, "failed": 1, "not_established": 0, "pending": 0 }
}
```

숫자는 예시다(재적 204 · 출석 160 은 최종안의 예시값).

### 2-1. 맨 위

| 키 | 형 | 규칙 |
| --- | --- | --- |
| `schema` | 문자열 | 정확히 `"result/v2"` |
| `example` | 참/거짓 | 예시 파일이면 `true`. 실전 공개 모드의 로더는 `true` 를 거부한다 |
| `rehearsal` | 참/거짓 | 리허설 · 연습 투표지로 만든 파일이면 `true`. 실전 공개 모드의 로더는 `true` 를 거부한다. `example` 과 따로 본다 |
| `status` | `"확정"` · `"일부 확정"` · `"미확정"` | 의제 전부 `confirmed` = 확정, 하나도 없음 = 미확정, 그 사이 = 일부 확정 |
| `rule` | 문자열 | 운영규정 【회의 성립 및 의결정족수】 ⑤ 원문. 조 번호를 넣지 않는다 |
| `generated_at` | ISO(+09:00) | 파일을 만든 시각 |
| `agendas` | 배열 | 의제 번호 순 |
| `items` | 배열 | 의제 → 권고 번호 순(투표지 문항 순서) |
| `report_mode` | `"vote"` · `"present_only"` | 보고서 승인 표결을 했나 / 발표만 했나 |
| `report` | 객체 | 2-4 |
| `summary` | 객체 | `items` 에서 다시 센 값과 같아야 한다 |

### 2-2. `agendas[]`

| 키 | 형 | 규칙 |
| --- | --- | --- |
| `no` | 정수 | 1 · 2 · 3 |
| `name` | 문자열 | 의제 이름 |
| `count` | 정수 | 그 의제의 권고 건수. 실전 파일은 19 · 28 · 23 이어야 만들어진다 |
| `enrolled` | 정수 > 0 | 재적 |
| `present` | 정수 > 0 | 출석(그 의제 투표지를 열기 직전 값). `present ≤ enrolled` |
| `threshold` | 정수 | 가결 기준 찬성 표수 = 출석 × 2/3 **올림** = `floor((2 × present + 2) / 3)` |
| `established` | 참/거짓 | 회의 성립 = 재적 과반수 출석 = `2 × present > enrolled` |
| `method` | 문자열 | 「휴대폰」 「휴대폰+서면」 등 |
| `confirmed` | 참/거짓 | 검증자가 6항목 대조를 끝내고 서명했나 |
| `confirmed_at` | ISO(+09:00) 또는 null | `confirmed` 이면 필수 |
| `signer` | 문자열 또는 null | `confirmed` 이면 필수 |

### 2-3. `items[]`

| 키 | 형 | 규칙 |
| --- | --- | --- |
| `no` | 문자열 | 「1-1」 모양. 파일 안에서 중복 없음 |
| `agenda` | 정수 | `agendas[].no` 중 하나 |
| `title` | 문자열 | 투표지 문항의 제목(「-안1」 앞 번호를 뗀 것) |
| `yes` · `nay` | 정수 ≥ 0 또는 null | 찬성 · 반대. **확정되지 않은 의제는 null** |
| `abstain` | 정수 ≥ 0 또는 null | `present − yes − nay`. 투표지를 내지 않은 사람 · 재집계에서 뺀 표(4-3, 미응답 건이 있어 통째로 뺀 휴대폰 표 포함) · 서면 집계표의 빈 칸이 모두 여기 든다. 11/14 은 기권을 받지 않으므로(11/10 결정) 휴대폰 유효표에는 누르지 않은 건이 없다 |
| `verdict` | 닫힌 목록 | 2-5 |
| `corrected` | null | 공개 뒤 정정 자리(지금은 늘 null) |

### 2-4. `report`

- `report_mode = "present_only"` → `report = { "status": "발표" }` 뿐.
- `report_mode = "vote"` → `{ status: "확정"|"미확정", yes, nay, abstain, present, enrolled, threshold, established, verdict, confirmed_at, signer }`.
  계산은 의제와 같다. 미확정이면 `yes` · `nay` · `abstain` 은 null, `verdict` 는 「미확정」.

### 2-5. 판정 `verdict` — 닫힌 목록 `가결` · `부결` · `불성립` · `미확정`

```
confirmed 아님                → 미확정   (표수 null)
confirmed, established 아님   → 불성립   (찬성이 기준을 넘어도)
confirmed, yes ≥ threshold    → 가결
confirmed, yes < threshold    → 부결
```

## 3. 읽는 쪽(세리머니 로더)이 반드시 할 것

1. `result_v2.json.sha256` 의 hex 와 본문 바이트의 sha256 이 같은지 본다. 다르면 읽지 않는다.
2. 아래 검사를 모두 통과해야 쓴다(만드는 쪽 `validateResultV2()` 와 같은 규칙). 하나라도 어긋나면 화면에 숫자를 내지 않고 정지 화면으로 간다.
   - `schema` · `rule` 이 위 값과 같다. `example` · `rehearsal` 은 참/거짓.
   - 의제마다 `threshold` · `established` 를 다시 계산해 같다. `0 < present ≤ enrolled`.
   - 의제마다 `items` 수 = `count`. 번호 중복 없음.
   - 확정 의제의 건마다 `yes + nay ≤ present`, `abstain = present − yes − nay`, `verdict` 가 2-5 로 다시 계산한 값과 같다.
   - 미확정 의제의 건은 표수가 null 이고 `verdict = "미확정"`.
   - `verdict` 가 닫힌 목록 밖이면 거부.
   - `status` · `summary` 가 다시 계산한 값과 같다.
3. 실전 공개 모드에서는 `example = true` 또는 `rehearsal = true` 인 파일을 거부한다(리허설 모드에서는 받는다).
4. `status = "일부 확정"` 이면 `confirmed = true` 인 의제만 공개한다. 미확정 의제는 「확인 중」으로만 둔다.
5. 분모 표시는 의제마다 `enrolled` · `present` · `threshold` 를 쓴다. 세 의제가 같으면 한 줄로 보여도 된다.
6. 화면 용어는 「출석」 「찬성」 (「참석」 「동의」 아님).

검사 명령(만드는 쪽 도구를 그대로 쓸 수 있다):

```bash
node scripts/export-result-v2.mjs --verify <폴더>/result_v2.json     # sha256 + 전 규칙, 실패면 종료 코드 2
sha256sum -c result_v2.json.sha256                                   # 해시만 (Git Bash)
```

## 4. 만드는 쪽

### 4-1. 명령

```bash
# 운영 DB 읽기만. 운영자 접속 토큰(64자리)은 환경 변수로만 받는다(명령 줄 · 로그에 남기지 않는다).
CV_ACCESS_TOKEN=<토큰> node scripts/export-result-v2.mjs --list                                  # 투표지 id 찾기
CV_ACCESS_TOKEN=<토큰> node scripts/export-result-v2.mjs --config <설정.json> --out <폴더>       # 만들기
node scripts/export-result-v2.mjs --config <설정.json> --out <폴더> --source file --raw-dir <폴더>/raw  # 저장한 원자료로 다시
```

- 토큰은 `/mod` 에 로그인한 노트북의 개발자 도구에서 `JSON.parse(localStorage.climate_vote_mod_session_v1).accessToken`. 스크립트는 로그인(토큰 발급)을 하지 않는다 — 발급은 접속 세션 행을 쓰는 일이라서다.
- 읽는 RPC(쓰기 없음): `ballot_named_responses_v2(p_token, p_ballot_id)` 한 장에 한 번(세 장 동시에), `--list` 는 `ballot_list_v2(p_token)`.
- 익명 키만으로 읽을 수 있는 `ballot_results(p_token)` 은 투표지가 `published` 일 때만 값을 준다(마감 `closed` 상태에서는 null, 11/10 실측). 공개(published)로 바꾸면 시민 휴대폰에 결과 화면이 뜨므로 이 경로는 쓰지 않는다.
- `--out` 은 저장소 밖(또는 무시되는 `.tmp/`)이어야 한다. `raw/` 에 실명이 들어 있다.

### 4-2. 설정 파일

```json
{
  "rehearsal": false,
  "example": false,
  "enrolled": 204,
  "report": { "mode": "present_only" },
  "agendas": [
    { "no": 1, "name": "기업 온실가스 감축 촉진", "count": 19, "ballot_id": "<uuid>", "present": 160,
      "method": "휴대폰+서면", "paper_file": "paper1.json", "attendance_file": "attend.json",
      "confirmed": true, "signer": "<검증자>", "confirmed_at": "2026-11-14T14:48:00+09:00" }
  ]
}
```

- `paper_file`(선택): 서면 집계표 `{ "ballots": 3, "items": { "1-1": { "yes": 3, "nay": 0 } } }`. 없는 번호는 0. 찬성 + 반대가 서면 투표지 수를 넘으면 거부.
- `attendance_file`(선택): 출석부 `[{ "team": "1분과 3조", "name": "…" }]`. 주면 출석부에 없는 (조, 이름)의 표를 뺀다. 직접 입력 표도 같다 — 출석부를 줄 때는 직접 입력자를 그 조 · 이름으로 출석부에 적어야 센다.
- `present`(출석)에는 직접 입력으로 투표한 사람도 들어 있어야 한다. 빠지면 4-4 의 「휴대폰 제출자 + 서면 > 출석」으로 파일이 만들어지지 않는다.
- `confirmed: false` 인 의제는 서명 없이도 파일에 들어간다(표수 null). 확정되면 설정만 고쳐 다시 돌린다(같은 명령, 1분 안).
- 보고서 승인 표결을 했다면 `"report": { "mode": "vote", "present": …, "yes": …, "nay": …, "confirmed": true, "signer": …, "confirmed_at": … }` 또는 `"ballot_id"`(1문항 투표지를 같은 방식으로 다시 센다).

### 4-3. 공식 수치 = 재집계

시스템 집계(dist)를 그대로 쓰지 않는다. 휴대폰 응답을 제출 시각 순으로 보며 아래 순서로 거른다.

1. 이름 없음 → 뺀다(「이름 없음」)
2. 같은 이름(공백 · 대소문자 무시)이 이미 나왔음 → 뒤의 것을 뺀다(「중복」). 조는 보지 않는다. 명단에서 고른 이름과 직접 입력한 이름에 같은 규칙이고, 직접 입력끼리도 같다 — 먼저 낸 것 하나만 남는다
3. 출석부를 줬는데 (조, 이름)이 없음 → 뺀다(「출석부 없음」). 이 이름은 나온 것으로 본다
4. 투표지의 건 하나라도 찬성(2) · 반대(1)가 아님(안 누름 · 다른 값) → 그 응답을 통째로 뺀다(「미응답 건 있음」). 누른 건도 세지 않는다. 이 이름은 나온 것으로 본다 — 뒤에 같은 이름으로 낸 완전한 응답은 2번 「중복」이다(재투표 불가, 11/10 결정). 파일은 거부하지 않고 만든다

(조, 이름) 짝이 명단(세션 명단 전원, 투표지 분과 지정 없음)에 없는 응답은 「직접 입력」이다. 11/10 결정으로 **빼지 않고 센다**.
명단 대조는 저장된 `voter_in_roster` 가 아니라 원자료의 지금 명단으로 한다.

남은 표의 찬성(값 2) · 반대(값 1)에 서면 집계표를 더한 것이 `yes` · `nay` 다.
요약 txt 에 적는 것:

- 뺀 표 사유별 수 · 목록(조 · 이름 · 제출 시각, 「미응답 건 있음」은 누르지 않은 번호)과 시스템 dist(찬/반) — 둘의 차이가 뺀 표로 다 설명되는지 검증자가 본다
- 직접 입력 목록 — 의제마다 늘 적는다(0건이어도). 줄마다 조 입력값 · 이름 · 제출 시각 · 유효/뺀 표(사유), 같은 이름이 명단의 다른 조에 있으면 「명단에는 ○○」. 검증자가 대리 · 지어낸 이름이 없는지 한 줄씩 본다

이름은 요약 txt 와 `raw/` 에만 있다. `result_v2.json` 에는 이름이 없다.

### 4-4. 거부(파일을 만들지 않는다, 종료 코드 2)

- 확정인데 `signer` 없음 · `confirmed_at` 이 ISO(+09:00) 아님
- 확정인데 투표지가 아직 `open`
- `present ≤ 0` · `present > enrolled`
- 건마다 찬성 + 반대 > 출석, 또는 휴대폰 제출자(유효 + 미응답으로 뺀 사람) + 서면 투표지 > 출석(판정 못 함). 사람 수로 센다 — 직접 입력자도 든다
- 투표지 건수 ≠ 설정 `count`, 번호 중복, 다른 의제 번호, 찬반(2점) 아닌 문항, 번호를 읽을 수 없는 문항
- 원자료 투표지 id ≠ 설정 `ballot_id`
- 투표지에 분과 지정(`subgroup`)이 남아 있음 — 11/14 투표지는 전원 투표라 분과 지정이 없어야 한다. 남아 있으면 서버가 명단을 그 분과로 좁혀 다른 분과 시민은 조를 고를 수 없어 투표하지 못한다(제출도 서버가 거부, 11/10 결정)
- 실전(`rehearsal: false`)인데 의제 1 · 2 · 3 이 19 · 28 · 23건이 아님
- 서면 집계표에 없는 번호 · 찬성 + 반대 > 서면 투표지 수
- 만든 파일이 3절의 검사를 통과하지 못함(자기 검사)

### 4-5. 시간

- 가상 원자료(3장 × 200명 × 70건)로 파일 만들기 50ms · 명령 전체 약 1초(11/10 실측, 로컬).
- 운영 RPC 왕복은 한 번에 약 0.3초(11/10, 잘못된 토큰으로 실측 — 오류 응답 시간). 세 장을 동시에 읽는다.
- 11/14 실제 투표지 · 운영자 토큰으로는 아직 재지 않았다. 11/13 리허설 세션에서 잰다.

## 5. ④-5와 달라진 점

| ④-5 | 이 계약 | 왜 |
| --- | --- | --- |
| 표수 키 `yes` · `nay` 와 본문 설명의 `no` 가 섞임 | `yes` · `nay` · `abstain` 으로 통일 | 한 키 이름 |
| `example` 만 있음 | `example` 과 별도로 `rehearsal` | 리허설 파일이 실전 공개로 새지 않게 |
| `report` 가 null 또는 객체 | `report_mode` + `report.status` | 발표만 한 경우와 표결한 경우를 로더가 갈라 읽게 |
| `verdict` 값 목록 없음 | 닫힌 목록 4개, 미확정 의제 표수는 null | 검증 안 된 숫자가 화면에 나가지 않게 |
| `summary` 세 칸 | `not_established` · `pending` 추가 | 불성립 · 미확정을 세려고 |
| — | `generated_at`, `items[].title` | 검증 · 표시용 |
| 파일 해시 언급 없음 | 곁 파일 `.sha256` | 본문 안에 자기 해시를 넣을 수 없다 |
| 명단에 없는 (조, 이름)은 뺀다 | 직접 입력도 센다, 요약에 직접 입력 목록 | 11/10 주최 결정 |
| 누르지 않은 건 = 그 건 기권 | 누르지 않은 건이 있는 응답은 통째로 뺀다(기권 불인정) | 11/10 주최 결정 |
