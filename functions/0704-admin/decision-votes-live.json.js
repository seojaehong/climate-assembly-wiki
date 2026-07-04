const PUBLIC_SUMMARY_SPREADSHEET_ID = '19xrXFFmaP4bS3JB2o6HeYmDyYgZhK6ez8URAHFYcBss';
const SUMMARY_CSV_URL = `https://docs.google.com/spreadsheets/d/${PUBLIC_SUMMARY_SPREADSHEET_ID}/gviz/tq?tqx=out:csv&sheet=Summary`;

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (char === '"' && inQuotes && next === '"') {
      cell += '"';
      i += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      row.push(cell);
      cell = '';
    } else if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') i += 1;
      row.push(cell);
      if (row.some((value) => value !== '')) rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += char;
    }
  }
  row.push(cell);
  if (row.some((value) => value !== '')) rows.push(row);
  return rows;
}

function buildReport(rows) {
  const header = rows[0] || [];
  const index = Object.fromEntries(header.map((name, column) => [name, column]));
  const slots = new Map();
  for (const row of rows.slice(1)) {
    const code = row[index.slot] || '';
    const title = row[index.title] || code;
    const option = row[index.option] || '';
    const count = Number(row[index.count] || 0) || 0;
    const responseUrl = row[index.responseUrl] || '';
    const editUrl = row[index.editUrl] || '';
    if (!code || !option) continue;
    if (!slots.has(code)) {
      slots.set(code, {
        code,
        title,
        responseCount: 0,
        uniqueVoterCount: 0,
        duplicateDroppedCount: 0,
        dedupeMode: 'name_latest_response_public_summary',
        counts: {},
        responseUrl,
        editUrl
      });
    }
    const slot = slots.get(code);
    slot.counts[option] = count;
    slot.responseCount += count;
    slot.uniqueVoterCount += count;
  }
  return {
    refreshedAt: new Date().toISOString(),
    spreadsheetId: PUBLIC_SUMMARY_SPREADSHEET_ID,
    publicSummaryCsvUrl: SUMMARY_CSV_URL,
    source: 'public_summary_sheet',
    slots: Array.from(slots.values())
  };
}

export async function onRequestGet() {
  const response = await fetch(`${SUMMARY_CSV_URL}&cachebust=${Date.now()}`, {
    cf: { cacheTtl: 0, cacheEverything: false }
  });
  if (!response.ok) {
    return Response.json(
      { error: `summary fetch failed: HTTP ${response.status}` },
      { status: 502, headers: { 'Cache-Control': 'no-store' } }
    );
  }
  const csv = await response.text();
  const report = buildReport(parseCsv(csv));
  return Response.json(report, {
    headers: {
      'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
      'Access-Control-Allow-Origin': '*'
    }
  });
}
