# Platform login main landmark evidence

## Outcome

The signed-out `/platform/` surface now places its named login form inside a native `main` landmark. The login form remains the skip-link target and retains its form role, accessible name, labels, busy state, and error/status relationships.

## Baseline observation

- Target: `https://climate-assembly.org/platform/`
- The browser accessibility tree exposed the root web area, the named `운영진 로그인` form, one level-one heading, two named textboxes, and the login button.
- No `main` landmark was present in the deployed baseline.
- The skip link resolved to `#platform-scope-content` and moved focus to the named login form.

## Responsive observation

- At a 360 × 800 CSS viewport, the document client and scroll widths were both 360px.
- The login form was 312px wide and both inputs and the button were 52px high.
- At a temporary 200% page scale, the visual viewport narrowed without adding document-level horizontal overflow.
- Temporary viewport and page-scale overrides were cleared after measurement.

## Change

- `src/islands/platform/PlatformShell.tsx`: changed the shared signed-out/loading `Centered` container from `div` to native `main`.
- `src/islands/platform/PlatformShell.test.ts`: added a static-render regression assertion that the login surface contains a `main` landmark while retaining the form contract.

## Scope boundary

This is browser accessibility-tree and responsive-layout evidence, not a completed NVDA, VoiceOver, or TalkBack evaluation. `evaluation/platform-accessibility-manual-evaluation.json` remains `needs_review`; no `not_run` check was changed or pre-filled.

## Verification

- Focused `PlatformShell` suite: 49 tests passed.
- Root suite: 65 files and 1,081 tests passed.
- Automation suite: 27 files and 482 tests passed. One production polling case first exceeded its 20-second limit, then passed alone and in the full rerun.
- Astro check: 335 files, 0 errors, 0 warnings, and 49 existing hints.
- Node 20 production build: 7,914 pages generated; the deployment revision writer completed successfully for the audited source commit.
- Clean preview accessibility audit: 6 routes × desktop/mobile, 12 cases passed, 0 violations, 0 incomplete checks. The report remains `needs_review` because the real assistive-technology surface is intentionally excluded.
- Generated audit report: `automation/.artifacts/platform-login-main-landmark-audit.json`.
- `git diff --check`: passed.
- Review: no blocking security, performance, correctness, or maintainability finding. The semantic change adds no data flow, authentication path, network operation, or runtime loop.
