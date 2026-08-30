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
