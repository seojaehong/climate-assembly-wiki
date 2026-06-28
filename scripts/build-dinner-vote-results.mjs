import fs from "node:fs";

const [, , inputPath, outputPath, reportPath] = process.argv;

if (!inputPath || !outputPath) {
  console.error("Usage: node scripts/build-dinner-vote-results.mjs <gws-json> <out-json> [report-json]");
  process.exit(2);
}

const inputText = fs.readFileSync(inputPath, "utf8").replace(/^\uFEFF/, "");
const sheet = JSON.parse(inputText);
const rows = sheet.values || [];
const header = rows[0] || [];
const body = rows.slice(1);

const columnIndex = (name) => header.findIndex((value) => String(value || "").trim() === name);
const timestampIndex = columnIndex("타임스탬프");
const nameIndex = columnIndex("이름");
const choiceIndex = columnIndex("저녁식사 선택");

if (nameIndex < 0 || choiceIndex < 0) {
  console.error("Required columns not found: 이름, 저녁식사 선택");
  process.exit(1);
}

const choiceMeta = new Map([
  ["중국집", { id: "chinese", label: "중국집", color: "#dc2626", accent: "#fef2f2" }],
  ["삼겹살", { id: "pork", label: "삼겹살", color: "#d97706", accent: "#fff7ed" }],
  ["불참", { id: "absent", label: "불참", color: "#475569", accent: "#f8fafc" }],
]);

const latestByName = new Map();
const validRows = [];
const skippedRows = [];

for (const row of body) {
  const timestamp = String(row[timestampIndex] || "").trim();
  const name = String(row[nameIndex] || "").trim();
  const choice = String(row[choiceIndex] || "").trim();

  if (!choiceMeta.has(choice)) {
    if (row.some((cell) => String(cell || "").trim())) {
      skippedRows.push([timestamp, name, choice]);
    }
    continue;
  }

  const key = name || `무기명-${validRows.length + 1}`;
  const record = { timestamp, name: key, choice };
  validRows.push([timestamp, key, choice]);
  latestByName.set(key, record);
}

const duplicateNames = [...new Set(validRows.map((row) => row[1]))].filter((name) => {
  return validRows.filter((row) => row[1] === name).length > 1;
});

const choices = [...choiceMeta.values()].map((choice) => ({ ...choice, count: 0, names: [] }));
const choiceByLabel = new Map(choices.map((choice) => [choice.label, choice]));

for (const record of latestByName.values()) {
  const choice = choiceByLabel.get(record.choice);
  choice.count += 1;
  choice.names.push(record.name);
}

for (const choice of choices) {
  choice.names.sort((a, b) => a.localeCompare(b, "ko"));
}

const updatedAt = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
}).format(new Date()).replace(" ", "T") + "+09:00";

const result = {
  updated_at: updatedAt,
  source: {
    form_id: "1unIaSHFwm_qZj0M1b_sfRVjACgE-obQSKB-o7UfAlY8",
    spreadsheet_id: "1UMgk4pHgB33oI8eMVylQCIlvaBES_ez0nIIX4cDZcOg",
    sheet_name: "설문지 응답 시트1",
  },
  method: "화면에는 노출하지 않지만 같은 이름이 여러 번 응답한 경우 최신 유효 응답만 집계한다.",
  total_responses: body.length,
  valid_responses: validRows.length,
  unique_voters: latestByName.size,
  duplicate_names: duplicateNames,
  skipped_rows: skippedRows,
  choices,
  raw_rows: validRows,
};

fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`);

const summary = {
  updated_at: result.updated_at,
  total_responses: result.total_responses,
  valid_responses: result.valid_responses,
  unique_voters: result.unique_voters,
  choices: result.choices.map(({ label, count }) => ({ label, count })),
};

if (reportPath && fs.existsSync(reportPath)) {
  const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  report.verification = {
    ...(report.verification || {}),
    dinner_vote_refresh_command: "powershell -ExecutionPolicy Bypass -File scripts/refresh-dinner-vote-results.ps1 -Commit -Deploy",
    dinner_vote_manual_refresh: summary,
  };
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
}

console.log(JSON.stringify(summary, null, 2));
