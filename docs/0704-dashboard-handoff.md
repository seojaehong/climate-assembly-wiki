# 0704 Dashboard Handoff

## Working Rule

Keep the 7.4 operating dashboard separate from the 0628 test archive. Do not mutate the original 0628 paths unless explicitly requested.

## Current 0704 Paths

- Admin: `/0704-admin/index.html`
- Ontology: `/workshop-graph-0704/index.html?source=participant-open-questions&mode=showcase&count=50&edgeLabels=on&theme=light&tone=calm`
- Miro-style post-it board: `/miro-0704/index.html`
- Analysis criteria: `/analysis-criteria-0704/index.html`
- Response QR asset: `/0704-admin/google-form-qr.png`

Admin password:

```text
climate2026
```

## What Changed From 0628

- Removed the dinner RSVP/result card from the admin dashboard.
- Added a 7.4 "additional vote" slot in the admin dashboard.
- Copied the ontology, Miro board, and analysis criteria pages to 0704-specific paths.
- Updated 0704 internal admin-return and data URLs.
- Added robots exclusions for the 0704 operating paths.

## Pending Input

The additional vote cannot be finalized until the operator provides:

- vote title
- vote options
- whether name/team is required
- duplicate response rule
- result visualization preference

Until then the admin page shows the vote slot as pending.

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
```

Both commands should return no matches.
