import { createReadStream } from 'node:fs';
import { fileURLToPath } from 'node:url';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const FOLDER_MIME = 'application/vnd.google-apps.folder';

export async function ensureSubfolder({ drive, parentId, name }) {
  const escaped = name.replace(/'/g, "\\'");
  const q = `'${parentId}' in parents and name='${escaped}' and mimeType='${FOLDER_MIME}' and trashed=false`;
  const { data } = await drive.files.list({ q, fields: 'files(id,name)' });
  if (data.files.length > 0) return data.files[0].id;
  const { data: created } = await drive.files.create({
    requestBody: { name, mimeType: FOLDER_MIME, parents: [parentId] },
    fields: 'id'
  });
  return created.id;
}

export async function uploadFiles({ drive, folderId, files, maxRetries = 5, baseDelayMs = 1000 }) {
  const uploaded = [];
  for (const f of files) {
    let lastError;
    let done = false;
    for (let i = 0; i < maxRetries; i++) {
      try {
        const { data } = await drive.files.create({
          requestBody: { name: f.name, parents: [folderId] },
          media: { body: createReadStream(f.path) },
          fields: 'id,name'
        });
        uploaded.push(data);
        done = true;
        break;
      } catch (e) {
        lastError = e;
        if (i < maxRetries - 1) await sleep(baseDelayMs * 2 ** i);
      }
    }
    if (!done) throw lastError;
  }
  return uploaded;
}

// CLI mode
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { google } = await import('googleapis');
  const auth = new google.auth.GoogleAuth({
    credentials: JSON.parse(process.env.DRIVE_SA_JSON),
    scopes: ['https://www.googleapis.com/auth/drive']
  });
  const drive = google.drive({ version: 'v3', auth });
  const [parentId, workshopName, ts, ...filePaths] = process.argv.slice(2);
  const workshopFolder = await ensureSubfolder({ drive, parentId, name: workshopName });
  const tsFolder = await ensureSubfolder({ drive, parentId: workshopFolder, name: ts });
  const files = filePaths.map(p => ({ path: p, name: p.split('/').pop() }));
  const uploaded = await uploadFiles({ drive, folderId: tsFolder, files });
  console.log(JSON.stringify({ tsFolder, uploaded }));
}
