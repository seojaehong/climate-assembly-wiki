# 0704 Dashboard Scenario Fit Check

Generated: 2026-07-03

## Verdict

The dashboard is structurally fit for the 2026-07-04 field scenario after clarifying one important route: default expert-question collection is the A/B live Sheet, not the participant carbon-question Form. The Form remains available as a direct QR fallback when the facilitator explicitly announces it.

## Scenario Fit Matrix

| Scenario | Primary UI | Data Source | Output | Fit |
|---|---|---|---|---|
| Expert question collection | A/B 실시간 Sheet 입력 | `A조 질문입력`, `B조 질문입력` tabs | `live-sheet-questions-print.pdf` | Fit |
| Expert question backup QR | 탄소 감축 질문 Form | Google Form response Sheet | Form-based expert-question print packet | Backup only |
| Group agenda candidate input | A/B 실시간 Sheet 입력 | `A조 의제입력`, `B조 의제입력` tabs | `live-sheet-agendas-print.pdf` | Fit |
| Group agenda backup QR | 조별 의제 입력 Form | Group agenda response Sheet | Form-based group agenda packet | Backup only |
| Final agenda vote | 의제투표 Form | `Scores` Sheet | Bubble-race result page | Fit |
| Conditional decision votes | 추가투표 슬롯 / 투표 구조 | V0, V1A, V1B Forms and result JSON | Admin-only result modal with response counts | Fit |
| 17~18 reflection sharing | 17~18시 소감발표 Form | Reflection response Sheet | Miro-style post-it and ontology screens | Fit |
| Result capture | 투표 구조 result modal and bubble-race page | Published JSON or Sheet CSV | Screen capture by operator or Claude | Fit |

## Operational Notes

- QR tabs are projection-oriented: QR tiles open a large modal rather than sending the operator away from the page.
- Conditional vote results are admin preview screens. They show response counts and option bars, but should not be shown to participants before the facilitator closes voting.
- Previous Supabase regulation-vote screens remain a visual reference for result cards and response-count disclosure. The 0704 live path stays on Google Form plus Sheet unless a new Supabase write path is explicitly approved.
- If new Sheet data arrives after a PDF tab is opened, regenerate the packet and refresh the PDF tab before printing.

## Remaining Field Actions

- Confirm which conditional vote slot, if any, is actually announced.
- After expert questions or agenda candidates are entered, run the corresponding refresh/export script before printing.
- Before revealing any result page, confirm the expected response count with the facilitator.
