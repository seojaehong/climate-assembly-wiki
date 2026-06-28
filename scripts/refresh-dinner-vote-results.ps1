param(
  [string]$SpreadsheetId = "1UMgk4pHgB33oI8eMVylQCIlvaBES_ez0nIIX4cDZcOg",
  [string]$Range = (-join ([char[]](0xC124, 0xBB38, 0xC9C0, 0x0020, 0xC751, 0xB2F5, 0x0020, 0xC2DC, 0xD2B8, 0x0031))),
  [switch]$Commit,
  [switch]$Deploy
)

$ErrorActionPreference = "Stop"

$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$OutputPath = Join-Path $Root "public/dinner-vote-0628/data/results.json"
$ReportPath = Join-Path $Root "evaluation/0628-participant-test-report.json"
$TempGwsJson = Join-Path $env:TEMP "0628-dinner-vote-gws.json"

Set-Location $Root

Write-Host "[0628 dinner] Reading Google Sheet through gws..."
$PreviousErrorActionPreference = $ErrorActionPreference
$ErrorActionPreference = "Continue"
$RawLines = & gws sheets +read --spreadsheet $SpreadsheetId --range $Range --format json 2>&1
$GwsExitCode = $LASTEXITCODE
$ErrorActionPreference = $PreviousErrorActionPreference

$RawText = ($RawLines | Out-String)
$JsonStart = $RawText.IndexOf("{")
if ($GwsExitCode -ne 0 -and $JsonStart -lt 0) {
  throw "[0628 dinner] gws sheet read failed with exit code $GwsExitCode"
}
if ($JsonStart -lt 0) {
  throw "[0628 dinner] gws did not return JSON."
}
Set-Content -LiteralPath $TempGwsJson -Value $RawText.Substring($JsonStart) -Encoding utf8

Write-Host "[0628 dinner] Building dinner result JSON..."
node scripts/build-dinner-vote-results.mjs $TempGwsJson $OutputPath $ReportPath
if ($LASTEXITCODE -ne 0) {
  throw "[0628 dinner] build-dinner-vote-results failed with exit code $LASTEXITCODE"
}

if ($Commit) {
  Write-Host "[0628 dinner] Committing refreshed dinner result..."
  git add public/dinner-vote-0628/data/results.json evaluation/0628-participant-test-report.json scripts/build-dinner-vote-results.mjs scripts/refresh-dinner-vote-results.ps1
  git commit -m "data: refresh dinner vote results"
  git pull --rebase --autostash
  git push
}

if ($Deploy) {
  Write-Host "[0628 dinner] Deploying public bundle to Cloudflare Pages..."
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

Write-Host "[0628 dinner] Done."
