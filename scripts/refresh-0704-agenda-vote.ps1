param(
  [string]$FormId = "1soeRdPzIv4l7Bs6JyJEbb4nzb7MCtmZEe2q8VFwmjgc",
  [string]$SpreadsheetId = "1wbAwRa7ynC12SanI7VJWc-fMea_NmOPVvIAKBLt5Wrw",
  [string]$QuestionId = "66dd7cab"
)

$ErrorActionPreference = "Stop"

$Options = @(
  [pscustomobject]@{ Slot = "1"; Name = "기후재정확보와 지자체 자발적 참여 방안"; Short = "기후재정·지자체"; Color = "#06b6d4" },
  [pscustomobject]@{ Slot = "2"; Name = "전 생애주기 탄소중립 교육체계 구축"; Short = "탄소중립 교육체계"; Color = "#f97316" },
  [pscustomobject]@{ Slot = "3"; Name = "시민의식 개선 및 참여 활성화 방안"; Short = "시민의식·참여"; Color = "#06b6d4" },
  [pscustomobject]@{ Slot = "4"; Name = "시민참여 기반 기후 거버넌스 강화"; Short = "기후 거버넌스"; Color = "#f97316" },
  [pscustomobject]@{ Slot = "5"; Name = "자원순환형 배달 문화 조성 및 생활폐기물 감축"; Short = "자원순환·폐기물"; Color = "#a855f7" },
  [pscustomobject]@{ Slot = "6"; Name = "에너지 절약 및 온실가스 배출 감축"; Short = "에너지·온실가스"; Color = "#f97316" },
  [pscustomobject]@{ Slot = "7"; Name = "친환경 도시 인프라·에너지 전환 및 기후위기 적응"; Short = "친환경도시·기후적응"; Color = "#a855f7" },
  [pscustomobject]@{ Slot = "8"; Name = "대중교통 친환경 교통전환 방안"; Short = "대중교통 전환"; Color = "#06b6d4" }
)

function Convert-GwsJson {
  param([string[]]$Lines)
  $jsonStart = -1
  for ($i = 0; $i -lt $Lines.Count; $i++) {
    $trimmed = $Lines[$i].TrimStart()
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
  $output = & gws @CommandArgs 2>&1
  if ($LASTEXITCODE -ne 0) {
    throw "gws failed ($LASTEXITCODE): $($output -join "`n")"
  }
  if (($output | Measure-Object).Count -eq 0) {
    return [pscustomobject]@{}
  }
  return Convert-GwsJson -Lines $output
}

$responses = Invoke-GwsJson -CommandArgs @(
  "forms", "forms", "responses", "list",
  "--params", "{`"formId`":`"$FormId`",`"pageSize`":5000}"
)

$counts = @{}
foreach ($option in $Options) {
  $counts[$option.Name] = 0
}

$rawRows = @()
$rawRows += ,@("responseId", "submittedAt", "selectedAgenda")
$responseItems = @()
if ($responses.PSObject.Properties.Name -contains "responses") {
  $responseItems = @($responses.responses)
}

foreach ($response in $responseItems) {
  $answer = $null
  if ($response.answers -and ($response.answers.PSObject.Properties.Name -contains $QuestionId)) {
    $answer = $response.answers.$QuestionId
  }
  $selected = $null
  if ($answer -and $answer.textAnswers -and $answer.textAnswers.answers.Count -gt 0) {
    $selected = [string]$answer.textAnswers.answers[0].value
  }
  if ([string]::IsNullOrWhiteSpace($selected)) {
    continue
  }
  if (-not $counts.ContainsKey($selected)) {
    $counts[$selected] = 0
  }
  $counts[$selected]++
  $rawRows += ,@($response.responseId, $response.lastSubmittedTime, $selected)
}

$maxCount = 0
foreach ($key in $counts.Keys) {
  if ($counts[$key] -gt $maxCount) {
    $maxCount = $counts[$key]
  }
}

$scoreRows = @()
$scoreRows += ,@("slot", "name", "short", "color", "c1", "c2", "c3", "c4")
$optionIndex = 0
foreach ($option in $Options) {
  $count = [int]$counts[$option.Name]
  if ($maxCount -gt 0) {
    $rawScore = 1 + (3.9 * $count / $maxCount)
    $score = [math]::Min([double]4.9, [math]::Max([double]1.0, [double]([math]::Round($rawScore * 2) / 2)))
  } else {
    $score = [math]::Max([double]1.0, [double]([math]::Round((4.9 - 0.5 * $optionIndex) * 10) / 10))
  }
  $scoreRows += ,@($option.Slot, $option.Name, $option.Short, $option.Color, $score, $score, $score, $score)
  $optionIndex++
}

$summaryRows = @()
$summaryRows += ,@("metric", "value")
$summaryRows += ,@("refreshedAt", (Get-Date).ToString("s"))
$summaryRows += ,@("responseCount", ($rawRows.Count - 1))
$summaryRows += ,@("maxCount", $maxCount)
$summaryRows += ,@("formId", $FormId)
$summaryRows += ,@("questionId", $QuestionId)

$scoreBody = @{ range = "Scores!A1:H9"; majorDimension = "ROWS"; values = $scoreRows } | ConvertTo-Json -Depth 12 -Compress
Invoke-GwsJson -CommandArgs @(
  "sheets", "spreadsheets", "values", "update",
  "--params", "{`"spreadsheetId`":`"$SpreadsheetId`",`"range`":`"Scores!A1:H9`",`"valueInputOption`":`"USER_ENTERED`"}",
  "--json", $scoreBody
) | Out-Null

$rawBody = @{ range = "FormResponses!A1:C$($rawRows.Count)"; majorDimension = "ROWS"; values = $rawRows } | ConvertTo-Json -Depth 12 -Compress
Invoke-GwsJson -CommandArgs @(
  "sheets", "spreadsheets", "values", "update",
  "--params", "{`"spreadsheetId`":`"$SpreadsheetId`",`"range`":`"FormResponses!A1:C$($rawRows.Count)`",`"valueInputOption`":`"USER_ENTERED`"}",
  "--json", $rawBody
) | Out-Null

$summaryBody = @{ range = "Guide!D1:E6"; majorDimension = "ROWS"; values = $summaryRows } | ConvertTo-Json -Depth 12 -Compress
Invoke-GwsJson -CommandArgs @(
  "sheets", "spreadsheets", "values", "update",
  "--params", "{`"spreadsheetId`":`"$SpreadsheetId`",`"range`":`"Guide!D1:E6`",`"valueInputOption`":`"USER_ENTERED`"}",
  "--json", $summaryBody
) | Out-Null

$report = [pscustomobject]@{
  refreshedAt = (Get-Date).ToString("o")
  responseCount = ($rawRows.Count - 1)
  maxCount = $maxCount
  spreadsheetId = $SpreadsheetId
  formId = $FormId
  scores = $scoreRows[1..($scoreRows.Count - 1)]
}

$report | ConvertTo-Json -Depth 8
