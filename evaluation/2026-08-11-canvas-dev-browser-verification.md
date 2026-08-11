# Canvas development browser verification

- Date: 2026-08-11 KST
- Surface: `/ko/moderator/canvas/`
- Runtime: Node.js 20.19.5, Astro 5.18.2, Vite 6.4.3
- Browser: headless Chromium via Playwright CLI
- Mutation boundary: read-only; no login, insert, update, delete, or RPC mutation was performed

## Reproduction

The development page returned HTML, but its Vite client and React hydration assets returned HTTP 500. The server reported `Missing field moduleType` from `builtin:vite-react-refresh-wrapper`. The installed dependency graph mixed Astro's Vite 6 runtime with React/Tailwind integration dependencies that resolved to Vite 7 and Vite 8/Rolldown.

The deterministic failure probe was:

```powershell
Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:4327/@vite/client' -TimeoutSec 10
```

Before the fix it returned HTTP 500.

The repeatable browser gate is:

```powershell
& 'C:\Program Files\nodejs\npx.cmd' --yes --package node@20.19.5 node automation/verify-canvas-browser.mjs --base-url http://127.0.0.1:4328 --output-json evaluation/2026-08-11-canvas-dev-browser-evidence.json --screenshot evaluation/2026-08-11-canvas-dev-browser.png
```

It fails if the audited source tree is dirty, the Vite client or document is not HTTP 200, the expected Supabase reads are not 2xx, the realtime-ready or login boundary is absent, an unauthenticated agenda node is draggable, or a browser page error occurs. POST/PUT/PATCH/DELETE requests are aborted before transmission and reported as failed write attempts.

## Fix and verification

- Pinned Astro 5.18.2, `@astrojs/react` 4.4.2, and `@tailwindcss/vite` 4.1.6 so the development integrations share Vite 6.
- Marked the groups and heatmap JSON data islands explicitly `is:inline` so Astro's dependency scanner does not parse their generated data as JavaScript entries.
- Replaced the missing direct Pretendard font URL with the official dynamic-subset stylesheet.
- Re-ran a cold `astro dev --force` startup. The previous dependency-scan errors did not recur.
- The Vite client and canvas document both returned HTTP 200.
- Chromium rendered the production `CanvasBoard`, live agenda snapshot, React Flow canvas, `실시간 연결됨` status, and the moderator login boundary.
- The unauthenticated agenda node did not have React Flow's `draggable` class, confirming the read-only interaction gate in the rendered browser DOM.
- Supabase session, agenda, and agenda-link reads returned HTTP 200. No write request was sent.

The only remaining browser console error was the repository-wide missing `/favicon.ico` request. It does not affect CanvasBoard assets, hydration, realtime state, or write gating.

## Artifact

- Machine-readable evidence: `evaluation/2026-08-11-canvas-dev-browser-evidence.json`
- Screenshot: `evaluation/2026-08-11-canvas-dev-browser.png`
- Reusable verifier: `automation/verify-canvas-browser.mjs`
- Audited source commit: `e40cfa94dce11cff4614e60b3af361e54bfab02f` (the following evidence-only commit does not change the audited source)
- CI contract: the root dependency graph is locked in `package-lock.json`, and the GitHub test workflow performs a Node 20 `npm ci`, forced cold Astro startup, and this browser verifier for Canvas-related changes.
