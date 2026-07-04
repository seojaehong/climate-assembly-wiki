param(
  [string]$ResetMarkerPath = "evaluation/0704-vote-reset.json",
  [string]$AgendaFormId = "1soeRdPzIv4l7Bs6JyJEbb4nzb7MCtmZEe2q8VFwmjgc",
  [string]$AgendaSpreadsheetId = "1wbAwRa7ynC12SanI7VJWc-fMea_NmOPVvIAKBLt5Wrw",
  [string]$DecisionSpreadsheetId = "1m_GD3ohvDW1PXT8Gg3AoTxpf0voRdrJpz2a38PREBB8",
  [string]$DecisionPublicSummarySpreadsheetId = "19xrXFFmaP4bS3JB2o6HeYmDyYgZhK6ez8URAHFYcBss",
  [switch]$SkipSupabase
)

$ErrorActionPreference = "Stop"
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)

$SupabaseUrl = "https://pleyuknjnprsckssxvrh.supabase.co"
$SupabaseKey = "sb_publishable_OVwo9zs5i6xl5iFykM6zJQ_GWFcf5zn"
$SupabaseRounds = @("D0704-V0", "D0704-V1A", "D0704-V1B")

function Convert-GwsJson {
  param([string[]]$Lines)
  $jsonStart = -1
  for ($i = 0; $i -lt $Lines.Count; $i++) {
    $trimmed = ([string]$Lines[$i]).TrimStart()
    if ($trimmed.StartsWith("{") -or $trimmed.StartsWith("[")) {
      $jsonStart = $i
      break
    }
  }
  if ($jsonStart -lt 0) {
    throw "gws did not return JSON. Output: $($Lines -join "`n")"
  }
  return ($Lines[$jsonStart..($Lines.Count - 1)] -join "`n") | ConvertFrom-Json
}

function Invoke-GwsJson {
  param([string[]]$CommandArgs)
  $gwsScript = Join-Path $env:APPDATA "npm\node_modules\@googleworkspace\cli\run-gws.js"
  if (Test-Path -LiteralPath $gwsScript) {
    $output = & node.exe $gwsScript @CommandArgs 2>&1
  } else {
    $output = & gws @CommandArgs 2>&1
  }
  if ($LASTEXITCODE -ne 0) {
    throw "gws failed ($LASTEXITCODE): $($output -join "`n")"
  }
  if (($output | Measure-Object).Count -eq 0) {
    return [pscustomobject]@{}
  }
  return Convert-GwsJson -Lines $output
}

function Get-FormResponseCount {
  param([string]$FormId)
  $responses = Invoke-GwsJson -CommandArgs @(
    "forms", "forms", "responses", "list",
    "--params", (@{ formId = $FormId; pageSize = 5000 } | ConvertTo-Json -Compress)
  )
  if ($responses.PSObject.Properties.Name -contains "responses") {
    return @($responses.responses).Count
  }
  return 0
}

function Get-SupabaseVoteCount {
  $ids = $SupabaseRounds -join ","
  $headers = @{
    apikey = $SupabaseKey
    Authorization = "Bearer $SupabaseKey"
  }
  $rows = Invoke-RestMethod -Uri "$SupabaseUrl/rest/v1/cv_votes?select=id&round_id=in.($ids)" -Headers $headers -Method Get
  return @($rows).Count
}

function Clear-SupabaseVotes {
  if ($SkipSupabase) {
    return [pscustomobject]@{ skipped = $true; deleted = $null }
  }
  $before = Get-SupabaseVoteCount
  $ids = $SupabaseRounds -join ","
  $headers = @{
    apikey = $SupabaseKey
    Authorization = "Bearer $SupabaseKey"
    Prefer = "return=representation"
  }
  $deletedRows = Invoke-RestMethod -Uri "$SupabaseUrl/rest/v1/cv_votes?round_id=in.($ids)" -Headers $headers -Method Delete
  $after = Get-SupabaseVoteCount
  return [pscustomobject]@{
    skipped = $false
    before = $before
    deleted = @($deletedRows).Count
    after = $after
  }
}

function Invoke-RefreshScript {
  param([string[]]$CommandArgs)
  $output = & pwsh @CommandArgs 2>&1
  if ($LASTEXITCODE -ne 0) {
    throw "refresh script failed ($LASTEXITCODE): $($output -join "`n")"
  }
  return ($output | Out-String)
}

if (-not (Test-Path -LiteralPath "evaluation")) {
  New-Item -ItemType Directory -Path "evaluation" | Out-Null
}

$resetAt = Get-Date
$resetAtUtc = $resetAt.ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
$marker = [pscustomobject]@{
  resetAt = $resetAt.ToString("o")
  resetAtUtc = $resetAtUtc
  scope = @(
    "0704 agenda vote Google Form responses after baseline only",
    "0704 decision vote Google Forms responses after baseline only",
    "0704 Supabase D0704-V0/D0704-V1A/D0704-V1B votes"
  )
  note = "Google Forms API cannot delete responses via gws; refresh scripts ignore responses at or before this timestamp."
}
$marker | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $ResetMarkerPath -Encoding UTF8

$before = [ordered]@{
  agendaFormResponses = Get-FormResponseCount -FormId $AgendaFormId
  supabaseVotes = Get-SupabaseVoteCount
}

$supabaseReset = Clear-SupabaseVotes

$agendaRefresh = Invoke-RefreshScript -CommandArgs @(
  "-NoProfile", "-ExecutionPolicy", "Bypass",
  "-File", "scripts\refresh-0704-agenda-vote.ps1",
  "-FormId", $AgendaFormId,
  "-SpreadsheetId", $AgendaSpreadsheetId,
  "-ResetMarkerPath", $ResetMarkerPath
)

$decisionRefresh = Invoke-RefreshScript -CommandArgs @(
  "-NoProfile", "-ExecutionPolicy", "Bypass",
  "-File", "scripts\refresh-0704-decision-votes.ps1",
  "-SpreadsheetId", $DecisionSpreadsheetId,
  "-PublicSummarySpreadsheetId", $DecisionPublicSummarySpreadsheetId,
  "-ResetMarkerPath", $ResetMarkerPath
)

$agendaReport = $agendaRefresh | ConvertFrom-Json
$decisionReport = $decisionRefresh | ConvertFrom-Json

$after = [ordered]@{
  agendaCountedResponses = [int]$agendaReport.responseCount
  agendaUniqueVoters = [int]$agendaReport.uniqueVoterCount
  decisionSlots = @($decisionReport.slots | ForEach-Object {
    [pscustomobject]@{
      code = $_.code
      responseCount = [int]$_.responseCount
      uniqueVoterCount = [int]$_.uniqueVoterCount
    }
  })
  supabaseVotes = Get-SupabaseVoteCount
}

$report = [pscustomobject]@{
  resetAt = $resetAt.ToString("o")
  resetAtUtc = $resetAtUtc
  resetMarkerPath = $ResetMarkerPath
  before = $before
  supabaseReset = $supabaseReset
  after = $after
  agendaSpreadsheetUrl = "https://docs.google.com/spreadsheets/d/$AgendaSpreadsheetId/edit"
  decisionSpreadsheetUrl = "https://docs.google.com/spreadsheets/d/$DecisionSpreadsheetId/edit"
  publicSummarySpreadsheetUrl = "https://docs.google.com/spreadsheets/d/$DecisionPublicSummarySpreadsheetId/edit"
}

$reportPath = "evaluation/0704-vote-reset-report.json"
$report | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $reportPath -Encoding UTF8
$report | ConvertTo-Json -Depth 12
