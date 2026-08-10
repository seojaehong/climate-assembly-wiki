import { fileURLToPath } from 'node:url';

const FOLDER_MIME = 'application/vnd.google-apps.folder';
const CAPTURE_FOLDER_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}$/;
const SNAPSHOT_FILE_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}\.json$/;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function listDrivePage({ drive, params, sleepImpl, retryDelayMs }) {
  let lastError;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await drive.files.list(params, { timeout: 20_000 });
    } catch (error) {
      lastError = error;
      if (attempt === 0) await sleepImpl(retryDelayMs);
    }
  }
  throw lastError;
}

async function listAllDriveFiles({ drive, q, sleepImpl, retryDelayMs }) {
  const files = [];
  let pageToken;
  do {
    const { data } = await listDrivePage({
      drive,
      params: {
        q,
        fields: 'nextPageToken,files(id,name)',
        pageSize: 1000,
        ...(pageToken ? { pageToken } : {}),
      },
      sleepImpl,
      retryDelayMs,
    });
    if (!Array.isArray(data?.files)) {
      throw new Error('Drive list response did not include files');
    }
    files.push(...data.files);
    pageToken = data.nextPageToken;
  } while (pageToken);
  return files;
}

export async function inspectWorkshopArchive({
  drive,
  parentId,
  workshop,
  requiredCaptureFiles = [],
  expectedCaptureTimestamps = [],
  sleepImpl = sleep,
  retryDelayMs = 1000,
}) {
  const escapedWorkshop = workshop.replace(/'/g, "\\'");
  const workshopFolders = await listAllDriveFiles({
    drive,
    q: `'${parentId}' in parents and name='${escapedWorkshop}' and mimeType='${FOLDER_MIME}' and trashed=false`,
    sleepImpl,
    retryDelayMs,
  });
  if (workshopFolders.length !== 1) {
    throw new Error(`expected one workshop folder, found ${workshopFolders.length}: ${workshop}`);
  }
  const workshopId = workshopFolders[0].id;
  const children = await listAllDriveFiles({
    drive,
    q: `'${workshopId}' in parents and mimeType='${FOLDER_MIME}' and trashed=false`,
    sleepImpl,
    retryDelayMs,
  });
  const captureFolders = children.filter((file) => CAPTURE_FOLDER_PATTERN.test(file.name));
  const captureNames = new Set(captureFolders.map((file) => file.name));
  if (captureNames.size !== captureFolders.length) {
    throw new Error(`duplicate capture folder timestamp: ${workshop}`);
  }
  const expectedNames = new Set(expectedCaptureTimestamps);
  if (expectedNames.size !== expectedCaptureTimestamps.length) {
    throw new Error(`duplicate expected capture timestamp: ${workshop}`);
  }
  const unexpected = captureFolders
    .map((file) => file.name)
    .filter((name) => expectedNames.size > 0 && !expectedNames.has(name));
  if (unexpected.length > 0) {
    throw new Error(`unexpected capture timestamp: ${unexpected.join(', ')}`);
  }
  if (requiredCaptureFiles.length > 0) {
    for (const captureFolder of captureFolders) {
      const captureFiles = await listAllDriveFiles({
        drive,
        q: `'${captureFolder.id}' in parents and trashed=false`,
        sleepImpl,
        retryDelayMs,
      });
      const missing = [];
      for (const requiredName of requiredCaptureFiles) {
        const matches = captureFiles.filter((file) => file.name === requiredName).length;
        if (matches === 0) missing.push(requiredName);
        if (matches > 1) {
          throw new Error(`duplicate capture file ${captureFolder.name}: ${requiredName}`);
        }
      }
      if (missing.length > 0) {
        throw new Error(`incomplete capture set ${captureFolder.name}: ${missing.join(', ')}`);
      }
    }
  }
  const captureSets = captureFolders.length;
  const snapshotFolders = children.filter((file) => file.name === 'snapshots');
  if (snapshotFolders.length !== 1) {
    throw new Error(`expected one snapshots folder, found ${snapshotFolders.length}: ${workshop}`);
  }
  const snapshots = await listAllDriveFiles({
    drive,
    q: `'${snapshotFolders[0].id}' in parents and trashed=false`,
    sleepImpl,
    retryDelayMs,
  });
  const snapshotFiles = snapshots.filter((file) => SNAPSHOT_FILE_PATTERN.test(file.name));
  const snapshotNames = new Set(snapshotFiles.map((file) => file.name));
  if (snapshotNames.size !== snapshotFiles.length) {
    throw new Error(`duplicate snapshot timestamp: ${workshop}`);
  }
  const snapshotCount = snapshotFiles.length;
  if (snapshotCount === 0) {
    throw new Error(`snapshot archive is empty: ${workshop}`);
  }
  return { captureSets, snapshotCount };
}

export function evaluateCoverage({ actual, expected }) {
  if (!Number.isSafeInteger(expected) || expected <= 0) {
    throw new Error(`invalid expected capture count: ${expected}`);
  }
  if (!Number.isSafeInteger(actual) || actual < 0) {
    throw new Error(`invalid actual capture count: ${actual}`);
  }
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
  const { expectedCaptureTimestamps, loadSchedule } = await import('../lib/schedule.mjs');
  const workshop = process.argv[2];
  const parentId = process.env.DRIVE_PARENT_ID;
  if (!workshop || !parentId) {
    console.error('usage: DRIVE_PARENT_ID=<id> verify-drive.mjs <workshop-name> [expected=109]');
    process.exit(1);
  }
  const auth = new google.auth.GoogleAuth({
    credentials: JSON.parse(process.env.DRIVE_SA_JSON),
    scopes: ['https://www.googleapis.com/auth/drive.readonly']
  });
  const drive = google.drive({ version: 'v3', auth });
  const schedule = await loadSchedule();
  const scheduledWorkshop = schedule.workshops.find((entry) => entry.name === workshop);
  if (!scheduledWorkshop) throw new Error(`workshop is not in schedule: ${workshop}`);
  const expectedTimestamps = expectedCaptureTimestamps(scheduledWorkshop);
  const expected = process.argv[3] ? parseInt(process.argv[3], 10) : expectedTimestamps.length;
  const archive = await inspectWorkshopArchive({
    drive,
    parentId,
    workshop,
    requiredCaptureFiles: schedule.pages.map((page) => `page-${page.id}.png`),
    expectedCaptureTimestamps: expectedTimestamps,
  });
  const result = evaluateCoverage({ actual: archive.captureSets, expected });
  console.log(JSON.stringify({ ...result, snapshotCount: archive.snapshotCount }, null, 2));
  if (result.status === 'issue') process.exit(2);
}
