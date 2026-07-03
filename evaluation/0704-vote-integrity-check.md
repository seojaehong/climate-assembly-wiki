# 0704 Vote Integrity Check

Generated: 2026-07-04 00:28 KST

## Scope

This check covers the live 0704 vote pipeline:

- Final agenda vote: Google Form -> `scripts/refresh-0704-agenda-vote.ps1` -> Google Sheet `Scores` -> `/agenda-vote-0704/`
- Conditional decision votes: Google Forms V0/V1A/V1B -> `scripts/refresh-0704-decision-votes.ps1` -> Google Sheet `Summary` and `public/0704-admin/decision-votes-report.json` -> `/0704-admin/vote-structure`

## Console Evidence

| Check | Result |
| --- | --- |
| Agenda Form is published and accepting responses | PASS |
| Agenda Form question is required | PASS |
| Agenda Form response count after refresh | 0 |
| Agenda Sheet `Scores` after refresh | all agenda score cells are `0` |
| Decision V0/V1A/V1B Forms are published and accepting responses | PASS |
| Decision V0/V1A/V1B questions are required | PASS |
| Decision V0/V1A/V1B response counts after refresh | 0 / 0 / 0 |
| Decision result JSON generated | PASS |

## Operational Verdict

| Requirement | Verdict | Reason |
| --- | --- | --- |
| Actual votes accumulate into the console/result data | PARTIAL | Google Forms responses are read correctly by the refresh scripts. The browser result screen does not pull Google Forms directly; it depends on the refresh bridge. |
| Live update without operator/Codex action | PARTIAL | `/agenda-vote-0704/` polls the Google Sheet, but Forms -> Sheet requires `scripts/refresh-0704-agenda-vote.ps1`. Use a scheduled loop during voting. |
| Vote completion by attendee count | NOT GUARANTEED | Current Forms do not collect verified identity. The system can compare response count to an announced target, but cannot prove every attendee voted. |
| Duplicate vote prevention | NOT GUARANTEED | Current Forms use `emailCollectionType: DO_NOT_COLLECT`; Google account one-response restriction is not active, and there is no participant token field. |
| Result preservation | PASS | Google Forms keep raw responses, Sheets keep refreshed rows, and decision votes also write `evaluation/0704-decision-votes-report.json` plus public JSON. |
| Zero-response display safety | PASS | Live agenda refresh now writes `0` scores when response count is `0`; sample scores are isolated to `?demo=full`. |

## Field Recommendation

For today's Google Forms setup, treat completion as "response count reached the announced attendee target" rather than "all named attendees have voted." If strict duplicate blocking is required, choose one of these before opening the vote:

1. Google login mode: collect verified email and limit to one response. This is strict but can slow field voting.
2. Participant token mode: add a required participant code field and deduplicate by code in the refresh script. This is field-friendly and does not require Google login.
3. Supabase token mode: use a vote session table with a unique key for participant and round. This is the strongest route for future operation.

## Commands Run

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File scripts\refresh-0704-agenda-vote.ps1
pwsh -NoProfile -ExecutionPolicy Bypass -File scripts\refresh-0704-decision-votes.ps1
gws forms forms get --params '{"formId":"1soeRdPzIv4l7Bs6JyJEbb4nzb7MCtmZEe2q8VFwmjgc"}' --format json
gws forms forms get --params '{"formId":"1QXrENjjmh7NcTF_9sm4aUPhnh1_WuAWvP4q80AdBM8s"}' --format json
gws forms forms get --params '{"formId":"1YCMzcYk_XLD95_8MvzJAB4ReQKQs4nl7P18o9hBQTk4"}' --format json
gws forms forms get --params '{"formId":"1bdEi3hN6p8qOqWGdJV3f8UK3g4wPDEtojjQakCpDTd4"}' --format json
gws sheets spreadsheets values get --params '{"spreadsheetId":"1wbAwRa7ynC12SanI7VJWc-fMea_NmOPVvIAKBLt5Wrw","range":"Scores!A1:H10"}' --format json
gws sheets spreadsheets values get --params '{"spreadsheetId":"1m_GD3ohvDW1PXT8Gg3AoTxpf0voRdrJpz2a38PREBB8","range":"Summary!A1:F20"}' --format json
```

