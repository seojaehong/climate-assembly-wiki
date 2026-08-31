# scripts/ — 에이전트용 메모

## 의존성 설치 — `npm install --omit=optional` 를 쓰지 말 것

이 저장소에서 `--omit=optional` 은 **빌드를 깬다.** 그 플래그는 트리 전체에 걸리므로
rollup·esbuild·lightningcss 의 플랫폼 네이티브 바이너리(전부 optionalDependencies)까지 함께 빠지고,
`astro build` 가 이렇게 죽는다:

```
Cannot find module '@rollup/rollup-win32-x64-msvc'
```

무거운 optional 의존성(kordoc 이 끌고 오는 onnxruntime·transformers·pdfjs 등 ~700MB)은
평범한 `npm install` 로 받은 뒤 `postinstall` 훅의 `scripts/prune-kordoc-optionals.mjs` 가 지운다.
CI(`deploy.yml`)와 Cloudflare 도 평범한 `npm install` 을 쓰므로 같은 경로로 정리된다.

## `sharp` 는 kordoc 것이 아니라 astro 것이다

최상위 `node_modules/sharp` 와 `node_modules/@img` 는 **astro 이미지 서비스**가 쓴다 — 지우면
`Rollup failed to resolve import "sharp"` 로 빌드가 죽는다.
kordoc 은 다른 버전대(^0.35)를 요구해 `node_modules/kordoc/node_modules/` 아래 사본이 따로 생기고,
지워도 되는 것은 **그 중첩 사본뿐**이다.

## Node 버전

빌드·스크립트는 Node 20 포터블로만 돌린다. Node 24 에서는 `astro build` 가 출력 없이 죽는다.

```bash
export PATH="$HOME/tools/node-v20.18.0-win-x64:$PATH"
```

## OneDrive · EPERM

저장소가 OneDrive 안에 있어 `node_modules` 삭제가 EPERM 으로 실패한다. 파일을 지우는 스크립트는
재시도를 넣을 것(`rmSync` 의 `maxRetries` 만으로는 부족해 바깥에서 한 번 더 감싼다).

## `verify-*.mjs` 규약

- **숫자로 낸다.** 「정상 동작 확인」은 검증이 아니다. 마지막 줄은 `N PASS · M FAIL (N/N)`.
- **DB 에 쓰지 않는다.** 원본 문서·백업본은 읽기만 한다.
- **규칙을 `.mjs` 에 베껴 적지 않는다.** esbuild 로 `.ts` 를 그 자리에서 변환해 불러온다.
  사본이 갈라지면 스크립트가 「자기 자신」을 검증하게 된다.
- **기대값은 임계치가 아니라 실측 상수로 박는다**(`SQL_MEASURED`·`SPLIT_MEASURED` 꼴).
  「100개 이상」만 재면 164 가 163 이 돼도 안 걸린다. 상수 옆에 **언제·무엇으로 쟀는지**를 적는다.

## ★ `verify-parsers.mjs` — 모듈을 두 번 불러오지 말 것

진입점(`src/lib/parsers/index.ts`)과 어댑터(`rhwp-adapter.ts`)를 **따로** 불러오면 같은
모듈의 사본이 둘 생긴다. rhwp 는 WASM 초기화 가드를 모듈 스코프에 두므로 사본마다 따로
초기화된다. 그래서 하나의 `esbuild.build({ stdin, bundle: true, packages: 'external' })` 로
필요한 것을 **전부 재수출**해 한 번에 말아 올린다:

```js
"export { extractDocument, planExtraction, MAX_BYTES } from './src/lib/parsers/index';"
"export { extractWithRhwp } from './src/lib/parsers/rhwp-adapter';"
```

`resolveDir` 는 저장소 루트, 결과는 `node_modules/.cache/verify-parsers/bundle.mjs` 에 쓰고
`pathToFileURL()` 로 import 한다. 상대 import 는 안으로 말리고 bare 지정자는 밖에 남는다.

## 저장소 밖 실문서 — 읽기 전용

`../00_입력자료/` · `../10_작업산출물/` 의 원본은 **옮기지도 고치지도 않는다.**
114MB `.hwp` 도 rhwp 로 0.6초에 읽히므로 크기 때문에 건너뛸 이유는 없다(`--fast` 는 선택).

## 손유지 타입 ↔ SQL 대조는 정규식으로 싸게 된다 — 2026-09-01 (US-009)

`src/lib/deliberation.ts` · `hq-submissions.ts` 는 스스로 **손유지 타입**이라고 밝힌다 — DB 와의
일치를 타입체커가 검증하지 못한다. 그래서 `returns table` 컬럼을 빠뜨리거나 `p_deadline_at` 을
`p_deadline` 으로 잘못 적어도 **tsc 는 통과하고, 틀린 것은 행사 당일 PGRST202/42883 로 드러난다.**

`verify-topic-contract.mjs` 가 그 구멍을 메우는 최소 형태다. **도커도 DB 도 필요 없다** —
마이그레이션 `.sql` 과 `.ts` 를 각각 정규식으로 읽어 **이름 집합을 비교하고 N/N 으로 찍는다**
(`topic_list 컬럼 8/8` · `topic_set_deadline 인자 3/3`). 새 RPC 를 `src/lib/*.ts` 에 붙일 때 복제할 것.

- 뽑는 자리는 두 곳뿐이다: SQL 의 `returns table(...)` / `create ... function f(...)` 인자 목록,
  TS 의 `export type X = { ... }` / `.rpc('f', { ... })` 객체 키
- TS 쪽 본문에서 **주석을 먼저 지운다.** 안 지우면 JSDoc 안의 `deadline_at:` 같은 낱말이 필드로 잡힌다
- ★ **이름만 보고 타입은 안 본다.** `timestamptz` ↔ `string` 대응은 정규식으로 판정할 수 없다.
  「선택 필드인가(`?:`)」처럼 **의미가 걸린 것만** 따로 못 박는다(배포·DB 적용 순서 분리가 걸려 있다)
- 이 대조는 `supabase/verify/*_contract.sql`(서버가 실제로 어떻게 도나)을 **대체하지 않는다.**
  서버가 멀쩡해도 이름 하나가 어긋나면 화면은 여전히 죽는다 — 두 개를 다 둔다
