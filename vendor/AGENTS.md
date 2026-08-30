# vendor — 저장소 안에 둔 서드파티 패키지

`@rhwp/core`·`kordoc` 은 npm 이 아니라 여기서 온다(`package.json` 의 `file:./vendor/...`).
**무엇을·왜 넣었는지, 버전 올리는 절차, 패치 기록은 `UPSTREAM.md` 에 있다.**
이 파일은 「벤더 폴더를 건드리면 저장소의 어디가 같이 움직이나」만 적는다.

## 벤더 폴더를 추가·개명·삭제할 때 함께 고쳐야 하는 곳 (5군데)

| 파일 | 무엇을 | 잊으면 |
|---|---|---|
| `package.json` | `dependencies` 의 `file:./vendor/<폴더>` 경로 | `npm install` 이 EEXIST/ENOENT 로 죽는다 |
| `.gitignore` 맨 끝 | `!vendor/<폴더>/dist/` + `!vendor/<폴더>/dist/**` | 13행의 `dist/` 가 다시 먹어 **CI 에서만** 깨진다 |
| `tsconfig.json` 의 `exclude` | `"vendor"` 가 들어 있는지 | `tsc` 가 **힙 부족으로 죽는다**(아래) |
| `.gitattributes` | `vendor/** -text` 가 유효한 경로인지 | Windows 에서 줄끝이 CRLF 로 바뀌어 업스트림 tarball 과 diff 가 난다 |
| `UPSTREAM.md` | 표·integrity 해시·패치 기록 | 다음 사람이 사본의 출처를 못 믿는다 |

확인은 한 줄이다 — 아무것도 출력되지 않아야 한다:

```bash
find vendor -type f | git check-ignore --stdin
```

## ★ 함정 1 — 벤더링하면 `tsc` 가 힙 부족으로 죽는다

`tsconfig.json` 의 `exclude` 에 있는 `"node_modules"` 는 **최상위 하나만** 가리킨다.
벤더 폴더는 `node_modules` 밖이라 TS 루트 파일 집합에 통째로 들어오고, 거기에
`npm install` 이 만든 `vendor/kordoc-4.12.0/node_modules/@types/node/**` 가 딸려 오면
`@types/node` 사본이 둘이 되어 `FATAL ERROR: Ineffective mark-compacts near heap limit`
(4GB 소진, 약 170초)로 끝난다. **실제로 겪었다(2026-08-30, US-008).**
`exclude` 에 `"vendor"` 를 넣으면 0초대로 통과한다 — `exclude` 는 루트 집합만 줄이고
`import` 로 딸려오는 `kordoc/dist/index.d.ts` 타입은 그대로 살아 있다.

`vitest.config.ts` 는 `include: ['src/**/*.test.ts', 'scripts/**/*.test.mjs']` 로
범위를 먼저 좁혀 놓아 이 문제가 없다. **`include` 로 좁힌 설정은 손대지 말 것.**

## ★ 함정 2 — `node_modules/kordoc` 은 링크다. 재귀 삭제하면 원본이 날아간다

`npm install` 은 `file:` 의존성을 **junction/symlink** 로 만든다(실측:
`node_modules/kordoc` → `vendor/kordoc-4.12.0`, `node_modules/@rhwp/core` →
`vendor/rhwp-core-0.8.4`). MSYS 의 `rm -rf` 는 junction 안으로 들어가므로
**벤더 원본을 지운다.** 지울 일이 있으면 `lstat` 으로 먼저 갈라라:

```js
const st = lstatSync(p);
if (st.isSymbolicLink()) unlinkSync(p);            // 링크는 unlink
else rmSync(p, { recursive: true, force: true });  // 실디렉터리만 재귀
```

같은 이유로 `postinstall` 의 `scripts/prune-kordoc-optionals.mjs` 는 링크를 타고
`vendor/kordoc-4.12.0/node_modules/` 안의 `sharp`·`@img` 를 지운다. 그건 설치 산출물이라
문제 없고 `.gitignore` 의 `vendor/**/node_modules/` 가 추적을 막는다.

## ★ 함정 3 — `.gitignore` 에서 디렉터리를 먼저 풀어야 한다

git 은 **제외된 디렉터리 안**의 파일을 `!` 로 되살리지 못한다. 그래서 순서가 둘이다:
`!vendor/kordoc-4.12.0/dist/`(디렉터리) → `!vendor/kordoc-4.12.0/dist/**`(내용).
그리고 이 블록은 `.gitignore` **맨 끝**에 있어야 한다 — 뒤에 오는 규칙이 이긴다
(`dist_*/`·`dist.bak.*` 가 파일 아래쪽에 있다).

## 벤더 파일을 고쳤나

`UPSTREAM.md` 의 「우리가 패치했나」 절에 **반드시** 적는다. 지금은 업스트림 tarball 과
한 바이트도 다르지 않다(`diff -r` 로 확인). 참고로 **rhwp 는 사실상 패치 불가**다 —
로직이 `rhwp_bg.wasm`(8.0MB) 안에 있고 `rhwp.js` 는 wasm-bindgen 글루일 뿐이다.

## 검사

벤더 경로로 바뀌어도 어댑터가 도는지는 이 하나로 본다(2026-08-30 기준 **25/25** · 2.8초):

```bash
export PATH="$HOME/tools/node-v20.18.0-win-x64:$PATH"
node scripts/verify-parsers.mjs
```
