# 0704 Dashboard Handoff

## Working Rule

Keep the 7.4 operating dashboard separate from the 0628 test archive. Do not mutate the original 0628 paths unless explicitly requested.

## Current 0704 Paths

- Admin: `/0704-admin/index.html`
- Ontology: `/workshop-graph-0704/index.html?source=participant-open-questions&mode=showcase&count=50&edgeLabels=on&theme=light&tone=calm`
- Miro-style post-it board: `/miro-0704/index.html`
- Analysis criteria: `/analysis-criteria-0704/index.html`
- Response QR asset: `/0704-admin/google-form-qr.png`
- Agenda vote Form response: `https://docs.google.com/forms/d/e/1FAIpQLSf9-AIDhnd0cy8Dfu-xXOgz6cQINjpA-tLzHdM2Ypk8qU_eMA/viewform`
- Agenda vote Form edit: `https://docs.google.com/forms/d/1soeRdPzIv4l7Bs6JyJEbb4nzb7MCtmZEe2q8VFwmjgc/edit`
- Agenda vote Scores Sheet: `https://docs.google.com/spreadsheets/d/1wbAwRa7ynC12SanI7VJWc-fMea_NmOPVvIAKBLt5Wrw/edit`
- Agenda vote bubble race: `/agenda-vote-0704/index.html?sheet=1wbAwRa7ynC12SanI7VJWc-fMea_NmOPVvIAKBLt5Wrw`
- Agenda vote QR asset: `/0704-admin/agenda-vote-qr.png`
- Group agenda input Form response: `https://docs.google.com/forms/d/e/1FAIpQLSf6irdECaMygffockxbuSxhsCxOG9WExkxHhtspZT4FhlmouQ/viewform`
- Group agenda input Form edit: `https://docs.google.com/forms/d/1hWBiDnSvVdelCAXbwgkk1H9w06LDUim0-FcTr5-tXHE/edit`
- Group agenda input Sheet: `https://docs.google.com/spreadsheets/d/1JCW6-r86Jr9uJWH4kc0GINe4R7u0EbPgIvbxMaRtZwY/edit`
- Group agenda QR asset: `/0704-admin/group-agenda-qr.png`
- Reflection Form response: `https://docs.google.com/forms/d/e/1FAIpQLSccOoHa2gSgIm2EUGqq4zrzkBpr1C6ptsx9HpfYdYLjebINmg/viewform`
- Reflection Form edit: `https://docs.google.com/forms/d/1mxwgRD-IHocgAIsisgr9v9-9J-wotjgmHqRDK1NlLyI/edit`
- Reflection Sheet: `https://docs.google.com/spreadsheets/d/1HK4B_CilVyEbQgtDuZnnMPgUW0naDT3VAYt2Shh8qms/edit`
- Reflection QR asset: `/0704-admin/reflection-qr.png`
- Group agenda print PDF: `/0704-admin/group-agendas-print.pdf`
- Group agenda print HTML preview: `/0704-admin/group-agendas-print.html`
- Expert question print PDF: `/0704-admin/expert-questions-print.pdf`
- Expert question print HTML preview: `/0704-admin/expert-questions-print.html`

Admin password:

```text
climate2026
```

## What Changed From 0628

- Removed the dinner RSVP/result card from the admin dashboard.
- Added a concrete 7.4 agenda vote card in the admin dashboard.
- Created a separate 7.4 agenda vote Form and Scores Sheet.
- Created separate group agenda input and reflection Forms/Sheets.
- Copied the previous bubble race viewer to `/agenda-vote-0704/` and connected it to the Scores Sheet through the `sheet` query parameter.
- Added a 17:00-18:00 final sharing card for the post-it and ontology presentation flow.
- Copied the ontology, Miro board, and analysis criteria pages to 0704-specific paths.
- Updated 0704 internal admin-return and data URLs.
- Added robots exclusions for the 0704 operating paths.

## Agenda Vote Setup

The 7.4 agenda vote Form currently has one required multiple-choice question:

- 기후재정확보와 지자체 자발적 참여 방안
- 전 생애주기 탄소중립 교육체계 구축
- 시민의식 개선 및 참여 활성화 방안
- 시민참여 기반 기후 거버넌스 강화
- 자원순환형 배달 문화 조성 및 생활폐기물 감축
- 에너지 절약 및 온실가스 배출 감축
- 친환경 도시 인프라·에너지 전환 및 기후위기 적응
- 대중교통 친환경 교통전환 방안

The bubble race reads the public `Scores` tab from the agenda vote Sheet every five seconds. Keep this header order:

```csv
slot,name,short,color,c1,c2,c3,c4
```

If the vote is treated as a simple priority vote, put the same normalized result value into `c1`, `c2`, `c3`, and `c4`. The existing bubble page expects values in the 1-5 visual range.

The repository now includes a bridge script that reads Google Form responses through the Forms API and writes both raw responses and normalized scores into the Google Sheet:

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File scripts\refresh-0704-agenda-vote.ps1
```

This script updates:

- `FormResponses!A:C`: response id, submitted time, selected agenda
- `Scores!A:H`: bubble-race rows
- `Guide!D:E`: last refresh status

Google's public Forms API does not expose the same UI-only "link responses to spreadsheet" button, so this scripted bridge is the current source-of-truth connection. It was run successfully on 2026-07-03 18:41 KST with 0 responses. The public `Scores` CSV endpoint then showed projector-friendly sample scores from 4.9 down by 0.5.

The group agenda and reflection Forms have their own bridge:

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File scripts\refresh-0704-input-forms.ps1
```

This script updates:

- Group agenda Sheet `Responses!A:D`: response id, submitted time, group, agenda text
- Reflection Sheet `Responses!A:E`: response id, submitted time, group, reflection, question
- Both `Guide` tabs: last refresh status

When the group agenda responses are ready, promote the latest agenda from each group into the agenda vote Form choices:

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File scripts\promote-0704-group-agendas-to-vote.ps1
pwsh -NoProfile -ExecutionPolicy Bypass -File scripts\promote-0704-group-agendas-to-vote.ps1 -Apply
```

The first command is a dry-run preview. The second command actually replaces the vote Form choices. After applying, refresh the agenda vote Scores Sheet:

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File scripts\refresh-0704-agenda-vote.ps1
```

The agenda vote refresh script now reads the current vote Form choices dynamically. This prevents the bubble race from staying stuck on the old 8 fixed choices after the Form options are changed.

Operational flow:

1. Each group enters an agenda candidate through the group agenda QR.
2. Run `refresh-0704-input-forms.ps1` to copy group responses into the Sheet.
3. Preview and apply `promote-0704-group-agendas-to-vote.ps1` to update the agenda vote Form choices.
4. Run `refresh-0704-agenda-vote.ps1` once so the bubble race receives the new choices with sample scores.
5. Participants vote through the agenda vote QR.
6. Run `refresh-0704-agenda-vote.ps1` during or after voting. The script writes normalized scores to the `Scores` tab.
7. The bubble race reads `Scores` and displays higher scores farther right and higher on the stage.
8. One hour later, each group enters reflections through the reflection QR for the post-it/ontology presentation.

## Previous Vote Pattern Found In Repo

The 6/14 workshop record in `public/workshop-graph/inputs/06_조숙의_통합.md` shows the older flow:

- group agenda selection and grouping;
- agenda selection by 5-point scale;
- final top agenda candidates shown with rank and average score.

`public/workshop-graph/data/workshop-2026-06-13.json` also records the facilitation logic as A/B group agenda candidates being combined and narrowed by electronic voting. The 7.4 setup keeps the same operating pattern, but separates it into: group agenda input Form, agenda vote Form, and bubble-race result page.

## GWS CLI Status

`gws` is connected and usable for Forms, Sheets, and Drive. On 2026-07-03, the Drive discovery cache was corrupted at `~/.config/gws/cache/drive_v3.json`; the corrupt file was moved aside and regenerated by `gws`.

The following editor permissions were applied through `gws drive permissions create` for `kesica3@gmail.com`:

- group agenda Form and Sheet;
- reflection Form and Sheet;
- agenda vote Form and Scores Sheet.

## Fast Expert Question Print And Email

For the external advisor Q&A block, the fastest route is:

1. Participants submit the carbon-reduction question Form.
2. Run the export script.
3. Open `/0704-admin/expert-questions-print.pdf` and print.
4. Add `-SendEmail` to forward the same question list to `kesica3@gmail.com`.

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File scripts\export-0704-expert-questions.ps1
pwsh -NoProfile -ExecutionPolicy Bypass -File scripts\export-0704-expert-questions.ps1 -UseSample
pwsh -NoProfile -ExecutionPolicy Bypass -File scripts\export-0704-expert-questions.ps1 -SendEmail
```

The script reads the carbon-reduction question Form directly through Forms API, filters non-empty question values, writes the print HTML and A4 PDF, and creates `evaluation/0704-expert-questions-print-report.json`.

Because this Form was reused from the 0628 test, the script defaults to `-Since 2026-07-04T00:00:00+09:00` so old responses are not printed. Override `-Since` only for investigation.

## Fast Agenda Candidate Print And Email

For the agenda vote setup, the fastest route is:

1. Each group submits the group agenda Form.
2. Run the export script.
3. Open `/0704-admin/group-agendas-print.pdf` and print.
4. Add `-SendEmail` to forward the same agenda candidate list to `kesica3@gmail.com`.

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File scripts\export-0704-group-agendas.ps1
pwsh -NoProfile -ExecutionPolicy Bypass -File scripts\export-0704-group-agendas.ps1 -UseSample
pwsh -NoProfile -ExecutionPolicy Bypass -File scripts\export-0704-group-agendas.ps1 -SendEmail
```

The script reads the group agenda Form directly through Forms API, filters non-empty agenda candidates, writes the print HTML and A4 PDF, and creates `evaluation/0704-group-agendas-print-report.json`.

Current note: Gmail sending needs an OAuth token with Gmail scope. The current token was re-authenticated with `gmail.send` on 2026-07-03. If sending fails with insufficient scopes, run:

```powershell
gws auth login --scopes https://www.googleapis.com/auth/forms.responses.readonly,https://www.googleapis.com/auth/gmail.send,https://www.googleapis.com/auth/drive,https://www.googleapis.com/auth/spreadsheets
```

## Schedule Check

The 2026-07-04 moderator manual places the group session from 17:00 to 18:00.

- 17:00-17:05: introduce group discussion
- 17:05-17:35: share group impressions and explore stakeholders related to the selected agenda
- 17:35-17:50: full-group sharing
- 17:50-17:55: survey
- 17:55-18:00: close

Recommendation: put the additional agenda vote inside the 17:50-17:55 survey block. It comes after the agenda discussion and before closing, so it should not interrupt the main facilitation flow.

## Verification Commands

```powershell
rg -n "0628|0628-admin|workshop-graph-0628-test|miro-0628-test|analysis-criteria-0628|dinner|저녁" public\0704-admin public\workshop-graph-0704 public\miro-0704 public\analysis-criteria-0704
rg -n "dinner-vote-0628|dinner-rsvp|저녁식사" public\0704-admin public\workshop-graph-0704 public\miro-0704 public\analysis-criteria-0704
Invoke-WebRequest "http://127.0.0.1:4321/agenda-vote-0704/index.html?sheet=1wbAwRa7ynC12SanI7VJWc-fMea_NmOPVvIAKBLt5Wrw" -UseBasicParsing
pwsh -NoProfile -ExecutionPolicy Bypass -File scripts\refresh-0704-agenda-vote.ps1
pwsh -NoProfile -ExecutionPolicy Bypass -File scripts\refresh-0704-input-forms.ps1
pwsh -NoProfile -ExecutionPolicy Bypass -File scripts\promote-0704-group-agendas-to-vote.ps1
pwsh -NoProfile -ExecutionPolicy Bypass -File scripts\export-0704-expert-questions.ps1
pwsh -NoProfile -ExecutionPolicy Bypass -File scripts\export-0704-group-agendas.ps1
```

Both commands should return no matches.
