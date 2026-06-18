import { fileURLToPath } from 'node:url';

export function evaluateCoverage({ actual, expected }) {
  const missing = expected - actual;
  const pct = (missing / expected) * 100;
  return {
    status: pct > 5 ? 'issue' : 'ok',
    actual,
    expected,
    missing,
    missingPct: pct
  };
}

// CLI mode
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { google } = await import('googleapis');
  const workshop = process.argv[2];
  const expected = parseInt(process.argv[3] || '108', 10);
  if (!workshop) {
    console.error('usage: verify-drive.mjs <workshop-name> [expected=108]');
    process.exit(1);
  }
  const auth = new google.auth.GoogleAuth({
    credentials: JSON.parse(process.env.DRIVE_SA_JSON),
    scopes: ['https://www.googleapis.com/auth/drive.readonly']
  });
  const drive = google.drive({ version: 'v3', auth });
  const { data: parent } = await drive.files.list({
    q: `name='${workshop.replace(/'/g, "\\'")}' and trashed=false`,
    fields: 'files(id,name)'
  });
  if (parent.files.length === 0) {
    console.error(`workshop folder not found: ${workshop}`);
    process.exit(1);
  }
  const { data: children } = await drive.files.list({
    q: `'${parent.files[0].id}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: 'files(id,name)'
  });
  const actual = children.files.filter(f => f.name !== 'snapshots' && f.name !== 'report').length;
  const result = evaluateCoverage({ actual, expected });
  console.log(JSON.stringify(result, null, 2));
  if (result.status === 'issue') process.exit(2);
}
