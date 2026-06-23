# Official Climatevoice Crosscheck - 2026-06-23

## Scope

Checked the official notice surface at `https://climatevoice.kr/notice/list.do` with the AJAX notice endpoint used by the page.

Primary page requested by the user:

- `https://climatevoice.kr/notice/list.do?category=&pageNo=2&contentNo=7`

## Official Notices Found

The notice list currently exposes two populated pages. Relevant items:

- `contentNo=11`, 2026-06-08: agenda intake notice for the Climate Citizens Assembly.
- `contentNo=12`, 2026-06-08: agenda registration event notice.
- `contentNo=9`, orientation video notice.
- `contentNo=8`, agenda proposal social notice.
- `contentNo=7`, agenda proposal notice requested by the user.
- `contentNo=5`, climate assembly video notice.
- `contentNo=4`, climate policy participation video notice.
- `contentNo=3`, 2026-05-16 launch ceremony notice.
- `contentNo=13`, 2026-01-28 K-climate public sphere forum notice.

## Site Consistency Findings

- Official launch notice describes the citizens panel as `220명 규모`; the public home page used `200명`.
- Official notices describe the project as a national permanent climate public sphere / citizen deliberation body; the home page used stronger "citizens decide" wording and "climate citizens assembly" wording.
- Official notices describe policy recommendations by the end of the year; the home page used a fixed November statement.
- The deliberation ontology guide correctly frames the tool as support for deliberation, not AI-made consensus. It still used a fixed `200명` phrase, so the phrase was generalized.

## Changes Made

- Home page public description and stats now use `220명 규모`.
- Process copy now says recommendations are prepared by the end of 2026 instead of a fixed November outcome.
- Home page now links to official agenda proposal, official notice list, launch ceremony notice, and K-climate public sphere forum notice.
- `/ko/workshop-graph/` now redirects to the canonical `/workshop-graph/` app to avoid the broken iframe rendering seen in Chrome.
- The guide keeps the "Ontology + Habermas" framing and avoids consensus-generation framing.

## Remaining Notes

- Raw workshop transcripts and graph data may contain `200명` because they are source utterances or internal workshop assumptions. Those were intentionally left unchanged.
- Official notice pages are JavaScript-rendered and loaded through an AJAX endpoint, so future automated sync should call the AJAX endpoint rather than scraping the initial HTML only.
