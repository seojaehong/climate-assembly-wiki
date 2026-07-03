param(
  [string]$FormId = "1soeRdPzIv4l7Bs6JyJEbb4nzb7MCtmZEe2q8VFwmjgc",
  [string]$SpreadsheetId = "1wbAwRa7ynC12SanI7VJWc-fMea_NmOPVvIAKBLt5Wrw",
  [string]$QuestionId = "66dd7cab",
  [string]$NameQuestionTitle = "이름"
)

$ErrorActionPreference = "Stop"

$FallbackOptions = @(
  [pscustomobject]@{ Slot = "1"; Name = "기후재정확보와 지자체 자발적 참여 방안"; Short = "기후재정·지자체"; Color = "#06b6d4" },
  [pscustomobject]@{ Slot = "2"; Name = "전 생애주기 탄소중립 교육체계 구축"; Short = "탄소중립 교육체계"; Color = "#f97316" },
  [pscustomobject]@{ Slot = "3"; Name = "시민의식 개선 및 참여 활성화 방안"; Short = "시민의식·참여"; Color = "#06b6d4" },
  [pscustomobject]@{ Slot = "4"; Name = "시민참여 기반 기후 거버넌스 강화"; Short = "기후 거버넌스"; Color = "#f97316" },
  [pscustomobject]@{ Slot = "5"; Name = "자원순환형 배달 문화 조성 및 생활폐기물 감축"; Short = "자원순환·폐기물"; Color = "#a855f7" },
  [pscustomobject]@{ Slot = "6"; Name = "에너지 절약 및 온실가스 배출 감축"; Short = "에너지·온실가스"; Color = "#f97316" },
  [pscustomobject]@{ Slot = "7"; Name = "친환경 도시 인프라·에너지 전환 및 기후위기 적응"; Short = "친환경도시·기후적응"; Color = "#a855f7" },
  [pscustomobject]@{ Slot = "8"; Name = "대중교통 친환경 교통전환 방안"; Short = "대중교통 전환"; Color = "#06b6d4" }
)

$Palette = @("#06b6d4", "#f97316", "#a855f7", "#22c55e", "#ef4444", "#0f172a", "#14b8a6", "#f59e0b", "#6366f1", "#ec4899")

$KnownShortLabels = @{
  "기후재정확보와 지자체 자발적 참여 방안" = "기후재정·지자체"
  "전 생애주기 탄소중립 교육체계 구축" = "탄소중립 교육체계"
  "시민의식 개선 및 참여 활성화 방안" = "시민의식·참여"
  "시민참여 기반 기후 거버넌스 강화" = "기후 거버넌스"
  "자원순환형 배달 문화 조성 및 생활폐기물 감축" = "자원순환·폐기물"
  "에너지 절약 및 온실가스 배출 감축" = "에너지·온실가스"
  "친환경 도시 인프라·에너지 전환 및 기후위기 적응" = "친환경도시·기후적응"
  "대중교통 친환경 교통전환 방안" = "대중교통 전환"
}

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

function Get-ShortLabel {
  param([string]$Text)
  $clean = ($Text -replace "\s+", " ").Trim()
  if ($KnownShortLabels.ContainsKey($clean)) {
    return $KnownShortLabels[$clean]
  }
  if ($clean.Length -le 18) {
    return $clean
  }
  return $clean.Substring(0, 18).Trim() + "..."
}

function Get-VoteOptions {
  param(
    [string]$VoteFormId,
    [string]$VoteQuestionId
  )
  $form = Invoke-GwsJson -CommandArgs @(
    "forms", "forms", "get",
    "--params", "{`"formId`":`"$VoteFormId`"}"
  )
  $item = $null
  foreach ($candidate in @($form.items)) {
    $question = $candidate.questionItem.question
    if ($question -and $question.questionId -eq $VoteQuestionId) {
      $item = $candidate
      break
    }
  }
  if (-not $item -or -not $item.questionItem.question.choiceQuestion.options) {
    Write-Warning "Could not read live vote options from Form. Falling back to built-in options."
    return $FallbackOptions
  }

  $liveOptions = @()
  $index = 0
  foreach ($option in @($item.questionItem.question.choiceQuestion.options)) {
    $name = ([string]$option.value).Trim()
    if ([string]::IsNullOrWhiteSpace($name)) {
      continue
    }
    $liveOptions += [pscustomobject]@{
      Slot = [string]($index + 1)
      Name = $name
      Short = Get-ShortLabel -Text $name
      Color = $Palette[$index % $Palette.Count]
    }
    $index++
  }
  if ($liveOptions.Count -eq 0) {
    return $FallbackOptions
  }
  return $liveOptions
}

function Get-QuestionIdByTitle {
  param(
    [string]$VoteFormId,
    [string]$TitlePattern
  )
  $form = Invoke-GwsJson -CommandArgs @(
    "forms", "forms", "get",
    "--params", "{`"formId`":`"$VoteFormId`"}"
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

function Get-TextAnswer {
  param(
    [object]$Response,
    [string]$TargetQuestionId
  )
  if ([string]::IsNullOrWhiteSpace($TargetQuestionId) -or -not $Response.answers) {
    return ""
  }
  if (-not ($Response.answers.PSObject.Properties.Name -contains $TargetQuestionId)) {
    return ""
  }
  $answer = $Response.answers.$TargetQuestionId
  if ($answer -and $answer.textAnswers -and $answer.textAnswers.answers.Count -gt 0) {
    return ([string]$answer.textAnswers.answers[0].value).Trim()
  }
  return ""
}

function Normalize-VoterName {
  param([string]$Name)
  return (($Name -replace "\s+", " ").Trim()).ToLowerInvariant()
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

$responses = Invoke-GwsJson -CommandArgs @(
  "forms", "forms", "responses", "list",
  "--params", "{`"formId`":`"$FormId`",`"pageSize`":5000}"
)

$Options = Get-VoteOptions -VoteFormId $FormId -VoteQuestionId $QuestionId
$NameQuestionId = Get-QuestionIdByTitle -VoteFormId $FormId -TitlePattern $NameQuestionTitle

$counts = @{}
foreach ($option in $Options) {
  $counts[$option.Name] = 0
}

$candidateRows = @()
$responseItems = @()
if ($responses.PSObject.Properties.Name -contains "responses") {
  $responseItems = @($responses.responses)
}

foreach ($response in $responseItems) {
  $participantName = Get-TextAnswer -Response $response -TargetQuestionId $NameQuestionId
  $answer = Get-TextAnswer -Response $response -TargetQuestionId $QuestionId
  $selected = $null
  if (-not [string]::IsNullOrWhiteSpace($answer)) {
    $selected = [string]$answer
  }
  if ([string]::IsNullOrWhiteSpace($selected)) {
    continue
  }
  $candidateRows += [pscustomobject]@{
    responseId = $response.responseId
    submittedAt = [datetime]$response.lastSubmittedTime
    participantName = $participantName
    selectedAgenda = $selected
    voterKey = Normalize-VoterName -Name $participantName
  }
}

$dedupeEnabled = -not [string]::IsNullOrWhiteSpace($NameQuestionId)
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
  $selected = $row.selectedAgenda
  if (-not $counts.ContainsKey($selected)) {
    $counts[$selected] = 0
  }
  $counts[$selected]++
}

$rawRows = @()
$rawRows += ,@("responseId", "submittedAt", "participantName", "selectedAgenda", "dedupeStatus")
foreach ($row in @($candidateRows | Sort-Object submittedAt)) {
  $status = if ($acceptedIds.ContainsKey($row.responseId)) { "counted" } else { "duplicate_dropped" }
  $rawRows += ,@($row.responseId, $row.submittedAt.ToString("o"), $row.participantName, $row.selectedAgenda, $status)
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
    $score = 0
  }
  $scoreRows += ,@($option.Slot, $option.Name, $option.Short, $option.Color, $score, $score, $score, $score)
  $optionIndex++
}

$summaryRows = @()
$summaryRows += ,@("metric", "value")
$summaryRows += ,@("refreshedAt", (Get-Date).ToString("s"))
$summaryRows += ,@("responseCount", ($rawRows.Count - 1))
$summaryRows += ,@("uniqueVoterCount", $acceptedRows.Count)
$summaryRows += ,@("duplicateDroppedCount", (($rawRows.Count - 1) - $acceptedRows.Count))
$summaryRows += ,@("dedupeMode", $(if ($dedupeEnabled) { "name_latest_response" } else { "none_no_name_question" }))
$summaryRows += ,@("maxCount", $maxCount)
$summaryRows += ,@("formId", $FormId)
$summaryRows += ,@("questionId", $QuestionId)
$summaryRows += ,@("nameQuestionId", $NameQuestionId)
$summaryRows += ,@("optionCount", $Options.Count)

Clear-SheetRange -TargetSpreadsheetId $SpreadsheetId -Range "Scores!A:H"
Clear-SheetRange -TargetSpreadsheetId $SpreadsheetId -Range "FormResponses!A:E"

$scoreRange = "Scores!A1:H$($scoreRows.Count)"
$scoreBody = @{ range = $scoreRange; majorDimension = "ROWS"; values = $scoreRows } | ConvertTo-Json -Depth 12 -Compress
Invoke-GwsJson -CommandArgs @(
  "sheets", "spreadsheets", "values", "update",
  "--params", "{`"spreadsheetId`":`"$SpreadsheetId`",`"range`":`"$scoreRange`",`"valueInputOption`":`"USER_ENTERED`"}",
  "--json", $scoreBody
) | Out-Null

$rawBody = @{ range = "FormResponses!A1:E$($rawRows.Count)"; majorDimension = "ROWS"; values = $rawRows } | ConvertTo-Json -Depth 12 -Compress
Invoke-GwsJson -CommandArgs @(
  "sheets", "spreadsheets", "values", "update",
  "--params", "{`"spreadsheetId`":`"$SpreadsheetId`",`"range`":`"FormResponses!A1:E$($rawRows.Count)`",`"valueInputOption`":`"USER_ENTERED`"}",
  "--json", $rawBody
) | Out-Null

$summaryBody = @{ range = "Guide!D1:E11"; majorDimension = "ROWS"; values = $summaryRows } | ConvertTo-Json -Depth 12 -Compress
Invoke-GwsJson -CommandArgs @(
  "sheets", "spreadsheets", "values", "update",
  "--params", "{`"spreadsheetId`":`"$SpreadsheetId`",`"range`":`"Guide!D1:E11`",`"valueInputOption`":`"USER_ENTERED`"}",
  "--json", $summaryBody
) | Out-Null

$report = [pscustomobject]@{
  refreshedAt = (Get-Date).ToString("o")
  responseCount = ($rawRows.Count - 1)
  uniqueVoterCount = $acceptedRows.Count
  duplicateDroppedCount = (($rawRows.Count - 1) - $acceptedRows.Count)
  dedupeMode = if ($dedupeEnabled) { "name_latest_response" } else { "none_no_name_question" }
  maxCount = $maxCount
  spreadsheetId = $SpreadsheetId
  formId = $FormId
  nameQuestionId = $NameQuestionId
  scores = $scoreRows[1..($scoreRows.Count - 1)]
}

$report | ConvertTo-Json -Depth 8
