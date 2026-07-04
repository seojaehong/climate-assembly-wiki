param(
  [string]$SpreadsheetId = "1m_GD3ohvDW1PXT8Gg3AoTxpf0voRdrJpz2a38PREBB8",
  [string]$PublicSummarySpreadsheetId = "19xrXFFmaP4bS3JB2o6HeYmDyYgZhK6ez8URAHFYcBss",
  [string]$NameQuestionTitle = "이름",
  [switch]$Watch,
  [int]$IntervalSeconds = 10
)

$ErrorActionPreference = "Stop"

if ($Watch) {
  if ($IntervalSeconds -lt 5) {
    throw "-IntervalSeconds must be 5 or greater."
  }
  $watchArgs = @(
    "-NoProfile", "-ExecutionPolicy", "Bypass",
    "-File", $MyInvocation.MyCommand.Path,
    "-SpreadsheetId", $SpreadsheetId,
    "-PublicSummarySpreadsheetId", $PublicSummarySpreadsheetId
  )
  Write-Host "Watching decision vote responses every $IntervalSeconds seconds. Press Ctrl+C to stop."
  while ($true) {
    $startedAt = Get-Date
    try {
      Write-Host "[$($startedAt.ToString("HH:mm:ss"))] Refreshing decision vote report..."
      pwsh @watchArgs
      if ($LASTEXITCODE -ne 0) {
        Write-Error "Refresh failed with exit code $LASTEXITCODE"
      }
    } catch {
      Write-Error $_
    }
    Start-Sleep -Seconds $IntervalSeconds
  }
}

$VoteSlots = @(
  [pscustomobject]@{
    Code = "V0"
    Title = "의제 통합 동의"
    FormId = "1QXrENjjmh7NcTF_9sm4aUPhnh1_WuAWvP4q80AdBM8s"
    QuestionId = "0b6a9799"
    NameQuestionId = "380be3dc"
    ResponseUrl = "https://docs.google.com/forms/d/e/1FAIpQLSc8NV9MvB52WM8IzQFJCGK3HJmZ8e_UOW4cbV6wd3MERohc-Q/viewform"
    EditUrl = "https://docs.google.com/forms/d/1QXrENjjmh7NcTF_9sm4aUPhnh1_WuAWvP4q80AdBM8s/edit"
    Options = @("동의", "동의하지 않음", "판단 유보")
  },
  [pscustomobject]@{
    Code = "V1A"
    Title = "감축분야 추가 의제 선정"
    FormId = "1YCMzcYk_XLD95_8MvzJAB4ReQKQs4nl7P18o9hBQTk4"
    QuestionId = "3323eced"
    NameQuestionId = "6c1868ed"
    ResponseUrl = "https://docs.google.com/forms/d/e/1FAIpQLSeyeycU58FPedk64L8E5QeDdvEETgVcnGwJDEC6NEZTrMGOtA/viewform"
    EditUrl = "https://docs.google.com/forms/d/1YCMzcYk_XLD95_8MvzJAB4ReQKQs4nl7P18o9hBQTk4/edit"
    Options = @("찬성", "반대", "판단 유보")
  },
  [pscustomobject]@{
    Code = "V1B"
    Title = "적응 의제 배분"
    FormId = "1bdEi3hN6p8qOqWGdJV3f8UK3g4wPDEtojjQakCpDTd4"
    QuestionId = "34c2e29e"
    NameQuestionId = "150bc490"
    ResponseUrl = "https://docs.google.com/forms/d/e/1FAIpQLSfN73ZpueVP0YHcPNiQeMxVdAwPsDUHU8sbG5oW-Bk20oXAUg/viewform"
    EditUrl = "https://docs.google.com/forms/d/1bdEi3hN6p8qOqWGdJV3f8UK3g4wPDEtojjQakCpDTd4/edit"
    Options = @("찬성", "반대", "판단 유보")
  }
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
  $gwsScript = Join-Path $env:APPDATA "npm\node_modules\@googleworkspace\cli\run-gws.js"
  if (Test-Path $gwsScript) {
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

function Clear-SheetRange {
  param(
    [string]$TargetSpreadsheetId,
    [string]$Range
  )
  Invoke-GwsJson -CommandArgs @(
    "sheets", "spreadsheets", "values", "clear",
    "--params", "{`"spreadsheetId`":`"$TargetSpreadsheetId`",`"range`":`"$Range`"}",
    "--json", "{}"
  ) | Out-Null
}

function Update-SheetRows {
  param(
    [string]$TargetSpreadsheetId,
    [string]$Range,
    [object[]]$Rows
  )
  $body = @{
    range = $Range
    majorDimension = "ROWS"
    values = $Rows
  } | ConvertTo-Json -Depth 16 -Compress
  Invoke-GwsJson -CommandArgs @(
    "sheets", "spreadsheets", "values", "update",
    "--params", "{`"spreadsheetId`":`"$TargetSpreadsheetId`",`"range`":`"$Range`",`"valueInputOption`":`"USER_ENTERED`"}",
    "--json", $body
  ) | Out-Null
}

function Get-ResponseAnswer {
  param(
    [object]$Response,
    [string]$QuestionId
  )
  if (-not $Response.answers) {
    return $null
  }
  $answer = $null
  if ($Response.answers.PSObject.Properties.Name -contains $QuestionId) {
    $answer = $Response.answers.$QuestionId
  } else {
    $answerProps = @($Response.answers.PSObject.Properties)
    if ($answerProps.Count -gt 0) {
      $answer = $answerProps[0].Value
    }
  }
  if ($answer -and $answer.textAnswers -and $answer.textAnswers.answers.Count -gt 0) {
    return [string]$answer.textAnswers.answers[0].value
  }
  return $null
}

function Get-QuestionIdByTitle {
  param(
    [string]$FormId,
    [string]$TitlePattern
  )
  $form = Invoke-GwsJson -CommandArgs @(
    "forms", "forms", "get",
    "--params", "{`"formId`":`"$FormId`"}"
  )
  foreach ($candidate in @($form.items)) {
    $title = ([string]$candidate.title).Trim()
    $question = $candidate.questionItem.question
    if ($question -and $title -like "*$TitlePattern*") {
      return [string]$question.questionId
    }
  }
  return $null
}

function Normalize-VoterName {
  param([string]$Name)
  return (($Name -replace "\s+", " ").Trim()).ToLowerInvariant()
}

$summaryRows = @()
$summaryRows += ,@("slot", "title", "option", "count", "responseUrl", "editUrl")

$guideRows = @()
$guideRows += ,@("key", "value")
$guideRows += ,@("refreshedAt", (Get-Date).ToString("s"))
$guideRows += ,@("resultSheet", "https://docs.google.com/spreadsheets/d/$SpreadsheetId/edit")
$guideRows += ,@("publicSummarySheet", "https://docs.google.com/spreadsheets/d/$PublicSummarySpreadsheetId/edit")
$guideRows += ,@("adminPage", "https://climate-assembly.org/0704-admin/")
$guideRows += ,@("voteStructurePage", "https://climate-assembly.org/0704-admin/vote-structure")

$reportSlots = @()

foreach ($slot in $VoteSlots) {
  $nameQuestionId = [string]$slot.NameQuestionId
  if ([string]::IsNullOrWhiteSpace($nameQuestionId)) {
    $nameQuestionId = Get-QuestionIdByTitle -FormId $slot.FormId -TitlePattern $NameQuestionTitle
  }
  $responses = Invoke-GwsJson -CommandArgs @(
    "forms", "forms", "responses", "list",
    "--params", "{`"formId`":`"$($slot.FormId)`",`"pageSize`":5000}"
  )
  $responseItems = @()
  if ($responses.PSObject.Properties.Name -contains "responses") {
    $responseItems = @($responses.responses)
  }

  $counts = @{}
  foreach ($option in $slot.Options) {
    $counts[$option] = 0
  }

  $candidateRows = @()
  foreach ($response in $responseItems) {
    $answer = Get-ResponseAnswer -Response $response -QuestionId $slot.QuestionId
    if ([string]::IsNullOrWhiteSpace($answer)) {
      continue
    }
    $participantName = Get-ResponseAnswer -Response $response -QuestionId $nameQuestionId
    $candidateRows += [pscustomobject]@{
      responseId = $response.responseId
      submittedAt = [datetime]$response.lastSubmittedTime
      participantName = $participantName
      answer = $answer
      voterKey = Normalize-VoterName -Name $participantName
    }
  }

  $dedupeEnabled = -not [string]::IsNullOrWhiteSpace($nameQuestionId)
  $latestByName = @{}
  $acceptedRows = @()
  if ($dedupeEnabled) {
    foreach ($row in $candidateRows) {
      if ([string]::IsNullOrWhiteSpace($row.voterKey)) {
        $acceptedRows += $row
        continue
      }
      if (-not $latestByName.ContainsKey($row.voterKey) -or $row.submittedAt -gt $latestByName[$row.voterKey].submittedAt) {
        $latestByName[$row.voterKey] = $row
      }
    }
    $acceptedRows += @($latestByName.Values)
  } else {
    $acceptedRows = @($candidateRows)
  }

  $acceptedIds = @{}
  foreach ($row in $acceptedRows) {
    $acceptedIds[$row.responseId] = $true
    $answer = $row.answer
    if (-not $counts.ContainsKey($answer)) {
      $counts[$answer] = 0
    }
    $counts[$answer]++
  }

  $rawRows = @()
  $rawRows += ,@("responseId", "submittedAt", "participantName", "answer", "dedupeStatus")
  foreach ($row in @($candidateRows | Sort-Object submittedAt)) {
    $status = if ($acceptedIds.ContainsKey($row.responseId)) { "counted" } else { "duplicate_dropped" }
    $rawRows += ,@($row.responseId, $row.submittedAt.ToString("o"), $row.participantName, $row.answer, $status)
  }

  Clear-SheetRange -TargetSpreadsheetId $SpreadsheetId -Range "$($slot.Code)!A:E"
  Update-SheetRows -TargetSpreadsheetId $SpreadsheetId -Range "$($slot.Code)!A1:E$($rawRows.Count)" -Rows $rawRows

  foreach ($option in $slot.Options) {
    $summaryRows += ,@($slot.Code, $slot.Title, $option, [int]$counts[$option], $slot.ResponseUrl, $slot.EditUrl)
  }

  $reportSlots += [pscustomobject]@{
    code = $slot.Code
    title = $slot.Title
    responseCount = ($rawRows.Count - 1)
    uniqueVoterCount = $acceptedRows.Count
    duplicateDroppedCount = (($rawRows.Count - 1) - $acceptedRows.Count)
    dedupeMode = if ($dedupeEnabled) { "name_latest_response" } else { "none_no_name_question" }
    nameQuestionId = $nameQuestionId
    counts = $counts
    responseUrl = $slot.ResponseUrl
    editUrl = $slot.EditUrl
  }
}

Clear-SheetRange -TargetSpreadsheetId $SpreadsheetId -Range "Summary!A:F"
Clear-SheetRange -TargetSpreadsheetId $SpreadsheetId -Range "Guide!A:B"
Update-SheetRows -TargetSpreadsheetId $SpreadsheetId -Range "Summary!A1:F$($summaryRows.Count)" -Rows $summaryRows
Update-SheetRows -TargetSpreadsheetId $SpreadsheetId -Range "Guide!A1:B$($guideRows.Count)" -Rows $guideRows
if (-not [string]::IsNullOrWhiteSpace($PublicSummarySpreadsheetId)) {
  Clear-SheetRange -TargetSpreadsheetId $PublicSummarySpreadsheetId -Range "Summary!A:F"
  Update-SheetRows -TargetSpreadsheetId $PublicSummarySpreadsheetId -Range "Summary!A1:F$($summaryRows.Count)" -Rows $summaryRows
}

if (-not (Test-Path "evaluation")) {
  New-Item -ItemType Directory -Path "evaluation" | Out-Null
}
if (-not (Test-Path "public/0704-admin")) {
  New-Item -ItemType Directory -Path "public/0704-admin" -Force | Out-Null
}

$report = [pscustomobject]@{
  refreshedAt = (Get-Date).ToString("o")
  spreadsheetId = $SpreadsheetId
  spreadsheetUrl = "https://docs.google.com/spreadsheets/d/$SpreadsheetId/edit"
  publicSummarySpreadsheetId = $PublicSummarySpreadsheetId
  publicSummaryCsvUrl = if ([string]::IsNullOrWhiteSpace($PublicSummarySpreadsheetId)) { $null } else { "https://docs.google.com/spreadsheets/d/$PublicSummarySpreadsheetId/gviz/tq?tqx=out:csv&sheet=Summary" }
  slots = $reportSlots
}

$reportPath = "evaluation/0704-decision-votes-report.json"
$publicReportPath = "public/0704-admin/decision-votes-report.json"
$reportJson = $report | ConvertTo-Json -Depth 12
$reportJson | Set-Content -Path $reportPath -Encoding UTF8
$reportJson | Set-Content -Path $publicReportPath -Encoding UTF8
$report | ConvertTo-Json -Depth 12

