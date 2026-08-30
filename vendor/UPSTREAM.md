# vendor/ — 파서 라이브러리 벤더링 기록

이 폴더의 두 패키지는 **npm 레지스트리가 아니라 저장소 안**에서 온다.
`package.json` 이 `file:./vendor/...` 로 가리키므로, 여기 있는 파일이 빠지면
CI 의 `npm install` 이 파서를 복원하지 못하고 행사 당일 문서 업로드가 멈춘다.

## 왜 벤더링했나

두 라이브러리 모두 **생후 5개월 · pre-1.0 · 버스팩터 1** 이다(판정 근거는
`../../20_스크립트/parsers/README.md`). npm 에서 unpublish 되거나 업스트림이
호환을 깨는 변경을 얹어도 우리 배포는 흔들리지 않아야 한다. 그래서
① 정확한 버전으로 고정하고(US-001) ② 우리 인터페이스로 감싸고(US-002~006)
③ 패키지 자체를 저장소 안에 복사한다(US-008).

## 패키지 목록

| 폴더 | 패키지 | 버전 | 라이선스 | 업스트림 |
|---|---|---|---|---|
| `rhwp-core-0.8.4/` | `@rhwp/core` | 0.8.4 | MIT | https://github.com/edwardkim/rhwp |
| `kordoc-4.12.0/` | `kordoc` | 4.12.0 | MIT | https://github.com/chrisryugj/kordoc |

### 레지스트리 원본과 integrity 해시

벤더링 **직전**(2026-08-30) 의 `package-lock.json` 에 적혀 있던 값이다.
`file:` 로 바꾸면 lock 의 해당 항목이 `"link": true` 로 바뀌면서 이 해시가 사라지므로
여기에 옮겨 적는다. 벤더 사본이 진짜 그 tarball 인지 의심스러우면 이 해시로 대조한다.

```
@rhwp/core 0.8.4
  resolved  https://registry.npmjs.org/@rhwp/core/-/core-0.8.4.tgz
  integrity sha512-Wr5HwQLzuGHHGfkJTvakRrB+BczyxnrRynwMBxDeoE2AxUU5z9GkqKhK+2Op9IS8Uq0KtA6c89PaCj1OA/QsfA==

kordoc 4.12.0
  resolved  https://registry.npmjs.org/kordoc/-/kordoc-4.12.0.tgz
  integrity sha512-72vqAJcAmVV52k9kf2u4/0ebFM3T96qvNvUIrXwoipjlAUK2pxJ6p4J+3qLLjsf7D2OwFH8nOBQbt2z5DLyRVw==
```

대조하는 법(네트워크가 필요하다 — 확인이 필요할 때만):

```bash
npm pack @rhwp/core@0.8.4          # 받은 tgz 를 풀어 vendor 폴더와 diff -r
npm view @rhwp/core@0.8.4 dist.integrity   # 위 해시와 같아야 한다
```

## 무엇을 복사했나 · 무엇을 뺐나

두 폴더 모두 `node_modules/` 에 설치돼 있던 패키지 내용을 **그대로** 복사했다
(`diff -r` 로 동일함을 확인). 다만 `kordoc/node_modules/` 는 뺐다 — 그것은
패키지 내용이 아니라 npm 이 만든 **설치 산출물**이고, `npm install` 이 다시 만든다.

| 폴더 | 파일 수 | 포함 | 비고 |
|---|---|---|---|
| `rhwp-core-0.8.4/` | 7 | `LICENSE` · `package.json` · `README.md` · `rhwp.js` · `rhwp.d.ts` · `rhwp_bg.wasm`(8.0MB) · `rhwp_bg.wasm.d.ts` | **NOTICE·THIRD_PARTY 가 원래 없다**(업스트림 tarball 에 미포함). LICENSE(MIT) 하나가 전부다 |
| `kordoc-4.12.0/` | 143 | `dist/` · `templates/` · `THIRD_PARTY/`(7개) · `LICENSE` · `NOTICE` · `package.json` · `README.md` | 업스트림 `files` 필드가 배포하는 것 전부 |

`.gitattributes` 의 `vendor/** -text` 가 줄끝 변환을 끈다. 이 저장소는
`core.autocrlf=true` 인 Windows 에서 돌아가므로, 그 규칙이 없으면 체크아웃할 때
`dist/*.js` 의 LF 가 CRLF 로 바뀌어 위 integrity 대조가 무의미해진다.

## 우리가 패치했나

**아직 없다.** 지금 두 폴더는 업스트림 tarball 과 한 바이트도 다르지 않다.

> ★ 규약 — 벤더 파일을 고치면 **무엇을·왜 고쳤는지 반드시 이 절에 적는다.**
> 적지 않은 패치는 다음 사람이 「업스트림 버그」로 오해해 되돌린다.
> 형식: `### <날짜> <파일> — <무엇을> / <왜> / <업스트림 이슈 URL 또는 "미보고">`

### rhwp 는 사실상 패치할 수 없다

`rhwp.js` 는 wasm-bindgen 이 생성한 글루 코드이고, 진짜 로직은
`rhwp_bg.wasm`(8.0MB 바이너리) 안에 있다. **JS 를 고쳐도 파싱 동작은 바뀌지 않는다.**
동작을 고치려면 업스트림 **Rust 저장소**(https://github.com/edwardkim/rhwp)에서
소스를 고쳐 `wasm-pack` 으로 다시 빌드해야 한다. 즉 rhwp 에 대한 우리의 선택지는
① 업스트림에 이슈·PR 을 내거나 ② 어댑터(`src/lib/parsers/rhwp-adapter.ts`)에서
우회하거나 ③ 엔진을 갈아끼우는 것뿐이다. ③ 을 가능하게 하려고 US-002 의
`ExtractResult` 인터페이스가 있다.

kordoc 은 순수 JS(`dist/` 는 tsup 번들 + `.map`)라 급하면 직접 고칠 수 있다.
다만 번들이라 소스맵을 따라가야 하고, 업스트림 TypeScript 소스는 GitHub 에 있다.

## 버전을 올리는 절차

1. `npm pack kordoc@<새버전>` 으로 tarball 을 받아 푼다
2. `vendor/kordoc-<새버전>/` 로 넣는다 (**옛 폴더는 새 것이 통과할 때까지 지우지 않는다**)
3. `package.json` 의 `file:` 경로를 새 폴더로 바꾼다
4. `.gitignore` 의 벤더 allowlist 경로(`!vendor/kordoc-<새버전>/dist/`)도 같이 바꾼다 —
   **잊으면 `dist/` 규칙이 다시 먹어 CI 에서만 깨진다**
5. `find vendor -type f | git check-ignore --stdin` 이 아무것도 출력하지 않는지 확인
6. `node scripts/verify-parsers.mjs` 가 25/25 로 통과하는지 확인
7. 이 파일의 표·해시·패치 기록을 갱신하고, 옛 폴더를 지운다

## 함정 기록

- **`.gitignore` 13행 `dist/` 가 `vendor/kordoc-4.12.0/dist/` 를 먹는다.** git 은 제외된
  **디렉터리 안**의 파일을 되살리지 못하므로 디렉터리(`!.../dist/`)를 먼저 풀고 내용(`!.../dist/**`)을 푼다.
  그리고 그 블록은 `.gitignore` **맨 끝**에 있어야 한다 — 뒤에 오는 규칙이 이긴다.
- **`npm install` 은 `file:` 의존성을 심볼릭 링크(Windows 는 junction)로 만든다.**
  `node_modules/kordoc` 이 `vendor/kordoc-4.12.0` 을 가리키는 링크가 된다는 뜻이다.
  그래서 `node_modules/kordoc` 을 지울 때 **재귀 삭제를 쓰면 벤더 원본이 지워진다.**
  링크는 `unlink` 로, 실제 디렉터리만 `rm -r` 로 지운다.
- **`postinstall` 의 prune 이 링크를 타고 `vendor/kordoc-4.12.0/node_modules/` 안을 지운다.**
  거기 들어가는 것은 설치 산출물뿐이라 문제 없고, `.gitignore` 가 추적하지 않는다.
- rhwp 의 WASM 은 `require.resolve('@rhwp/core/rhwp_bg.wasm')` 서브패스로 찾는다.
  `package.json` 에 `exports` 필드가 없어서 통하는 것이다 — 업스트림이 `exports` 를 넣으면 깨진다.
