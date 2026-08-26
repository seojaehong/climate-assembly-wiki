# Analysis import bounded input contract

## Outcome

The local analysis-core importer now fails closed before JSON parsing when a private analysis, provenance map, or review plan is empty, exceeds 16MiB, or changes byte size between the pre-read stat and completed read. A newly generated plan must also fit the same boundary before it is written. Repeated CLI options are rejected instead of silently selecting the final value.

## Threat and correctness boundary

- The importer synchronously reads sensitive external JSON and previously had no file-size boundary.
- A damaged or accidentally selected very large file could therefore consume unbounded process memory before semantic validation.
- Repeating `--analysis`, `--provenance-map`, `--verify-plan`, `--output`, or `--force` previously made command intent ambiguous because the final occurrence won.
- Size and duplicate-option errors contain only the input role or option name. They do not include paths, recommendation text, identifiers, or file bytes.

## Implementation

- `automation/platform-analysis-import.mjs`
  - applies one 16MiB boundary to all three private JSON input roles;
  - checks filesystem size before reading and exact byte count after reading;
  - checks the serialized plan before writing so every generated plan remains readable by verification mode;
  - keeps malformed JSON errors separate from unavailable-file and size-boundary errors;
  - rejects repeated valued options and repeated `--force` during argument parsing.
- `automation/tests/platform-analysis-import.test.mjs`
  - proves a 16MiB + 1 byte analysis is rejected before plan creation without echoing content;
  - proves a valid near-limit analysis cannot create an oversized, unverifiable plan;
  - proves duplicate `--analysis` is rejected without echoing either path.

## Scope boundary

This change reads only synthetic temporary files in tests. It does not access the real 8/29 analysis output, Supabase, credentials, RPCs, public payloads, or publication state. Actual source-to-item mapping and the first human review remain pending external inputs.

## Verification

- Focused importer suite: 22 tests passed.
- Automation suite: 27 files and 485 tests passed.
- Root suite: 65 files and 1,081 tests passed.
- Astro check: 335 files, 0 errors, 0 warnings, and 49 existing hints.
- `git diff --check`: passed.
- Security, performance, correctness, and maintainability review found no blocking issue after the generated-plan boundary was added.
