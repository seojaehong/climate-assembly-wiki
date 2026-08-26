# A5 login decorative mark accessibility evidence

## Outcome

The public `/platform/` login surface no longer exposes its decorative `P` mark as standalone text to assistive technology. The visible brand label, login heading, named form, input labels, status message, and skip-link target remain unchanged.

## Evidence

- Before the change, the deployed browser semantic snapshot exposed `generic: P` ahead of the visible brand label.
- A regression expectation for `aria-hidden="true"` failed against the previous component output and passed after the implementation.
- Focused `PlatformShell.test.ts`: 49 tests passed.
- Root suite: 65 files and 1,081 tests passed.
- Automation suite: 28 files and 496 tests passed.
- Astro check: 337 files, 0 errors, 0 warnings, and 49 existing hints.

## Boundaries

- No credentials were entered and no login was attempted.
- No database, Auth, membership, migration, GRANT, or production traffic setting was changed.
- This evidence does not claim an NVDA, VoiceOver, TalkBack, or formal KWCAG certification result. The tracked manual evaluation remains `needs_review` with its checks `not_run`.
