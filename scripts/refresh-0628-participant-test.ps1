param(
  [string]$CsvUrl = "https://docs.google.com/spreadsheets/d/1T31pzPV8JHeqyCuGUq0M28e81-cCujOC_V8mMFACG20/gviz/tq?tqx=out:csv&sheet=Form%20Responses%201",
  [switch]$Commit,
  [switch]$Deploy
)

$ErrorActionPreference = "Stop"

$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$GraphPath = Join-Path $Root "public/workshop-graph-0628-test/data/participant-open-questions.json"
$ReportPath = Join-Path $Root "evaluation/0628-participant-test-report.json"
$TempCsv = Join-Path $env:TEMP "0628-participant-responses.csv"

Set-Location $Root

function Invoke-Checked {
  param(
    [Parameter(Mandatory = $true)]
    [scriptblock]$Command,
    [Parameter(Mandatory = $true)]
    [string]$Label
  )
  & $Command
  if ($LASTEXITCODE -ne 0) {
    throw "[0628] $Label failed with exit code $LASTEXITCODE"
  }
}

Write-Host "[0628] Downloading linked Google Sheet CSV..."
try {
  Invoke-WebRequest -Uri $CsvUrl -OutFile $TempCsv -UseBasicParsing
} catch {
  throw "[0628] Sheet CSV download failed. Check Google Sheet sharing/publish settings. $($_.Exception.Message)"
}

Write-Host "[0628] Refreshing graph JSON from linked Google Sheet..."
Invoke-Checked -Label "Graph JSON refresh" -Command {
  node scripts/build-participant-question-ontology.mjs --csv $TempCsv --out $GraphPath
}

Write-Host "[0628] Updating evaluation report counts..."
Invoke-Checked -Label "Evaluation report update" -Command {
  node -e @"
const fs = require('fs');
const graphPath = process.argv[1];
const reportPath = process.argv[2];
const graph = JSON.parse(fs.readFileSync(graphPath, 'utf8'));
const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
const counts = graph.meta.counts;
report.generated_at = new Date().toISOString();
report.graph_data = {
  ...(report.graph_data || {}),
  path: 'public/workshop-graph-0628-test/data/participant-open-questions.json',
  rows: counts.rows,
  responses: counts.responses,
  impression_responses: counts.impression_responses,
  question_responses: counts.question_responses,
  nodes: counts.nodes,
  edges: counts.edges,
  similarity_edges: counts.similarity_edges,
  similarity_clusters: counts.similarity_clusters,
  link_candidates: counts.link_candidates,
  frequency_terms: (graph.meta.frequency_terms || []).length,
  keyword_nodes: counts.keyword_nodes,
  theory_lens_nodes: counts.theory_lens_nodes,
  theory_lens_edges: counts.theory_lens_edges
};
report.verification = {
  ...(report.verification || {}),
  data_generation_command: 'powershell -ExecutionPolicy Bypass -File scripts/refresh-0628-participant-test.ps1',
  data_generation_result: 'rows=' + counts.rows + ' responses=' + counts.responses + ' nodes=' + counts.nodes + ' edges=' + counts.edges,
  actual_sheet_refresh: true
};
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
"@ $GraphPath $ReportPath
}

Write-Host "[0628] Current graph counts:"
Invoke-Checked -Label "Graph count print" -Command {
  node -e @"
const fs = require('fs');
const graph = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
console.log(JSON.stringify(graph.meta.counts, null, 2));
"@ $GraphPath
}

if ($Commit) {
  Write-Host "[0628] Committing refreshed graph/report..."
  git add public/workshop-graph-0628-test/data/participant-open-questions.json evaluation/0628-participant-test-report.json
  git commit -m "data: refresh 0628 participant responses"
  git pull --rebase --autostash
  git push
}

if ($Deploy) {
  Write-Host "[0628] Deploying public bundle to Cloudflare Pages..."
  $Hash = git rev-parse HEAD
  $Msg = git log -1 --pretty=%s
  $Site = Join-Path $env:TEMP "climate-assembly-0628-pages"
  if (Test-Path $Site) { Remove-Item -LiteralPath $Site -Recurse -Force }
  New-Item -ItemType Directory -Path $Site | Out-Null
  robocopy public $Site /E /NFL /NDL /NJH /NJS /NP | Out-Null
  @'
<!doctype html>
<meta charset="utf-8">
<meta http-equiv="refresh" content="0; url=/0628-admin/index.html">
<title>0628 참여단 테스트</title>
<a href="/0628-admin/index.html">0628 참여단 테스트 관리자</a>
'@ | Set-Content -LiteralPath (Join-Path $Site "index.html") -Encoding utf8
  @'
/ /0628-admin/index.html 302
/vote-614/* /vote-admin-614/:splat 301
/vote-614 /vote-admin-614/ 301
'@ | Set-Content -LiteralPath (Join-Path $Site "_redirects") -Encoding utf8
  npm.cmd exec --yes --package wrangler@latest -- wrangler pages deploy $Site --project-name climate-assembly-wiki --branch main --commit-hash $Hash --commit-message $Msg --commit-dirty=true --skip-caching
}

Write-Host "[0628] Done."
