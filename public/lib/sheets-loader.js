// Google Sheets gviz CSV loader for /event-family pages.
// Pure functions only — DOM/fetch wiring stays in each page.

export function parseCSV(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else field += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else if (c === '\r') { /* skip */ }
      else field += c;
    }
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter(r => r.length > 0 && r.some(v => v !== ''));
}

const AGENDA_HEADERS = ['slot', 'name', 'short', 'color', 'c1', 'c2', 'c3', 'c4'];

export function csvToAgendas(csvText) {
  const rows = parseCSV(csvText);
  if (rows.length < 2) throw new Error('CSV empty');
  const header = rows[0].map(h => h.trim().toLowerCase());
  for (const k of AGENDA_HEADERS) {
    if (!header.includes(k)) throw new Error('missing header: ' + k);
  }
  const idx = Object.fromEntries(AGENDA_HEADERS.map(k => [k, header.indexOf(k)]));
  return rows.slice(1).map(r => ({
    slot: r[idx.slot]?.trim(),
    name: r[idx.name]?.trim(),
    short: r[idx.short]?.trim(),
    color: r[idx.color]?.trim(),
    scores: {
      c1: parseFloat(r[idx.c1]),
      c2: parseFloat(r[idx.c2]),
      c3: parseFloat(r[idx.c3]),
      c4: parseFloat(r[idx.c4]),
    },
  })).filter(a => a.slot && a.name);
}

const BOARD_HEADERS = ['id', 'date', 'group', 'speaker', 'content', 'status', 'domain', 'ts', 'keywords', 'override_yangdan'];

export function csvToBoardRows(csvText) {
  const rows = parseCSV(csvText);
  if (rows.length < 2) throw new Error('CSV empty');
  const header = rows[0].map(h => h.trim().toLowerCase());
  for (const k of BOARD_HEADERS) {
    if (!header.includes(k)) throw new Error('missing header: ' + k);
  }
  const idx = Object.fromEntries(BOARD_HEADERS.map(k => [k, header.indexOf(k)]));
  return rows.slice(1).map((r, i) => {
    const idRaw = (r[idx.id] ?? '').trim();
    const parsed = parseInt(idRaw, 10);
    const groupRaw = (r[idx.group] ?? '').trim();
    return {
      id: Number.isNaN(parsed) ? i + 1 : parsed,
      date: (r[idx.date] ?? '').trim(),
      group: groupRaw.replace(/조$/, ''),
      speaker: (r[idx.speaker] ?? '').trim(),
      content: (r[idx.content] ?? '').trim(),
      status: (r[idx.status] ?? '').trim(),
      domain: (r[idx.domain] ?? '').trim(),
      ts: (r[idx.ts] ?? '').trim(),
      keywords: (r[idx.keywords] ?? '').trim(),
      override_yangdan: (r[idx.override_yangdan] ?? '').trim(),
    };
  });
}

export function pickAgendas(local, sheet) {
  if (sheet == null) return { agendas: local, source: 'local' };
  if (sheet.length !== local.length) {
    return {
      agendas: local,
      source: 'local',
      reason: `row count mismatch: ${sheet.length} vs ${local.length}`,
    };
  }
  return { agendas: sheet, source: 'sheet' };
}

export function buildSheetUrl(sheetId, tab) {
  if (!sheetId) return null;
  const base = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv`;
  return tab ? `${base}&sheet=${encodeURIComponent(tab)}` : base;
}
