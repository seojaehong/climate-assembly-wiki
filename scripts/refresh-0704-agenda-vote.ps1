param(
  [string]$FormId = "1soeRdPzIv4l7Bs6JyJEbb4nzb7MCtmZEe2q8VFwmjgc",
  [string]$SpreadsheetId = "1wbAwRa7ynC12SanI7VJWc-fMea_NmOPVvIAKBLt5Wrw",
  [string]$NameQuestionTitle = "이름",
  [string]$ResetMarkerPath = "evaluation/0704-vote-reset.json",
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
    "-FormId", $FormId,
    "-SpreadsheetId", $SpreadsheetId,
    "-NameQuestionTitle", $NameQuestionTitle,
    "-ResetMarkerPath", $ResetMarkerPath
  )
  Write-Host "Watching agenda vote responses every $IntervalSeconds seconds. Press Ctrl+C to stop."
  while ($true) {
    $startedAt = Get-Date
    try {
      Write-Host "[$($startedAt.ToString("HH:mm:ss"))] Refreshing agenda vote Scores..."
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

$Palette = @("#06b6d4", "#f97316", "#a855f7", "#22c55e", "#ef4444", "#0f172a", "#14b8a6", "#f59e0b", "#6366f1", "#ec4899")

$FallbackOptions = @(
  [pscustomobject]@{ Slot = "1"; Name = "의제 후보 1"; Short = "의제 후보 1"; Color = "#06b6d4"; QuestionId = "" }
)

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
  $jsonLines = @()
  $depth = 0
  $started = $false
  foreach ($line in $Lines[$jsonStart..($Lines.Count - 1)]) {
    $trimmed = ([string]$line).Trim()
    if (-not $started -and [string]::IsNullOrWhiteSpace($trimmed)) {
      continue
    }
    $started = $true
    $jsonLines += $line
    foreach ($char in ([string]$line).ToCharArray()) {
      if ($char -eq "{" -or $char -eq "[") {
        $depth++
      } elseif ($char -eq "}" -or $char -eq "]") {
        $depth--
      }
    }
    if ($started -and $depth -le 0) {
      break
    }
  }
  return ($jsonLines -join "`n") | ConvertFrom-Json
}

function ConvertTo-ProcessArgument {
  param([string]$Value)
  if ($null -eq $Value) {
    return '""'
  }
  $escaped = $Value -replace '\\', '\\' -replace '"', '\"'
  return '"' + $escaped + '"'
}

function Invoke-GwsJson {
  param([string[]]$CommandArgs)
  $gwsScript = Join-Path $env:APPDATA "npm\node_modules\@googleworkspace\cli\run-gws.js"
  if (-not (Test-Path -LiteralPath $gwsScript)) {
    throw "gws CLI script was not found at $gwsScript"
  }
  $psi = [System.Diagnostics.ProcessStartInfo]::new()
  $psi.FileName = "node.exe"
  $psi.Arguments = (@($gwsScript) + $CommandArgs | ForEach-Object { ConvertTo-ProcessArgument $_ }) -join " "
  $psi.UseShellExecute = $false
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.StandardOutputEncoding = [System.Text.Encoding]::UTF8
  $psi.StandardErrorEncoding = [System.Text.Encoding]::UTF8
  $process = [System.Diagnostics.Process]::Start($psi)
  $stdout = $process.StandardOutput.ReadToEnd()
  $stderr = $process.StandardError.ReadToEnd()
  $process.WaitForExit()
  $exitCode = $process.ExitCode
  $output = @()
  if (-not [string]::IsNullOrWhiteSpace($stdout)) {
    $output += ($stdout -split "`r?`n")
  }
  if (-not [string]::IsNullOrWhiteSpace($stderr)) {
    $output += ($stderr -split "`r?`n")
  }
  if ($exitCode -ne 0) {
    throw "gws failed ($exitCode): $($output -join "`n")"
  }
  if (($output | Measure-Object).Count -eq 0) {
    return [pscustomobject]@{}
  }
  return Convert-GwsJson -Lines $output
}

function Get-ShortLabel {
  param(
    [string]$Text,
    [string]$Description = ""
  )
  $clean = ($Text -replace "\s+", " ").Trim()
  $groupPrefix = ""
  if ($Description -match "(A조|B조)") {
    $groupPrefix = "($($Matches[1])) "
  }
  if ($clean -match "인센티브 중심.*기업.*감축") {
    return "${groupPrefix}기업 인센티브 감축방안"
  }
  if ($clean -match "재생에너지.*사용.*생산|재생에너지.*생산.*확대") {
    return "${groupPrefix}재생에너지 생산·사용 확대"
  }
  if ($clean -match "재건축|리모델링") {
    return "${groupPrefix}재건축·리모델링 탄소감축"
  }
  if ($clean -match "지역 특성.*탄소 절감|지자체 평가|인센티브 제공") {
    return "${groupPrefix}지역맞춤 탄소절감 방안"
  }
  if ($clean.Length -le 18) {
    return "$groupPrefix$clean"
  }
  return "$groupPrefix$($clean.Substring(0, 18).Trim())..."
}

function Get-Form {
  Invoke-GwsJson -CommandArgs @(
    "forms", "forms", "get",
    "--params", "{`"formId`":`"$FormId`"}"
  )
}

function Get-AgendaScaleQuestions {
  param([object]$Form)
  $items = @()
  $index = 0
  foreach ($candidate in @($Form.items)) {
    $title = ([string]$candidate.title).Trim()
    $question = $candidate.questionItem.question
    if (-not $question) {
      continue
    }
    if ($title -eq $NameQuestionTitle) {
      continue
    }
    if ($question.scaleQuestion) {
      $description = ([string]$candidate.description).Trim()
      $items += [pscustomobject]@{
        Slot = [string]($index + 1)
        Name = $title
        Short = Get-ShortLabel -Text $title -Description $description
        Color = $Palette[$index % $Palette.Count]
        QuestionId = [string]$question.questionId
        scoreSum = 0.0
        scoreCount = 0
        averageScore = 0.0
      }
      $index++
    }
  }
  if ($items.Count -eq 0) {
    Write-Warning "Could not read scaleQuestion agenda items from Form. Falling back to built-in options."
    return $FallbackOptions
  }
  return $items
}

function Get-QuestionIdByTitle {
  param(
    [object]$Form,
    [string]$TitlePattern
  )
  foreach ($candidate in @($Form.items)) {
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

function Get-ResponseListParams {
  param([string]$TargetFormId)
  $params = @{
    formId = $TargetFormId
    pageSize = 5000
  }
  if (Test-Path -LiteralPath $ResetMarkerPath) {
    $markerText = Get-Content -LiteralPath $ResetMarkerPath -Raw
    $match = [regex]::Match($markerText, '"resetAtUtc"\s*:\s*"([^"]+)"')
    if ($match.Success) {
      $params.filter = "timestamp > $($match.Groups[1].Value)"
    }
  }
  return $params | ConvertTo-Json -Compress
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

$form = Get-Form
$Options = Get-AgendaScaleQuestions -Form $form
$NameQuestionId = Get-QuestionIdByTitle -Form $form -TitlePattern $NameQuestionTitle

$responses = Invoke-GwsJson -CommandArgs @(
  "forms", "forms", "responses", "list",
  "--params", (Get-ResponseListParams -TargetFormId $FormId)
)

$responseItems = @()
if ($responses.PSObject.Properties.Name -contains "responses") {
  $responseItems = @($responses.responses)
}

$candidateRows = @()
foreach ($response in $responseItems) {
  $participantName = Get-TextAnswer -Response $response -TargetQuestionId $NameQuestionId
  $scoreMap = @{}
  $hasAnyScore = $false
  foreach ($option in $Options) {
    $raw = Get-TextAnswer -Response $response -TargetQuestionId $option.QuestionId
    $score = 0.0
    if ([double]::TryParse($raw, [ref]$score)) {
      $scoreMap[$option.QuestionId] = $score
      $hasAnyScore = $true
    }
  }
  if (-not $hasAnyScore) {
    continue
  }
  $candidateRows += [pscustomobject]@{
    responseId = $response.responseId
    submittedAt = [datetime]$response.lastSubmittedTime
    participantName = $participantName
    voterKey = Normalize-VoterName -Name $participantName
    scores = $scoreMap
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
  foreach ($option in $Options) {
    if ($row.scores.ContainsKey($option.QuestionId)) {
      $option.scoreSum += [double]$row.scores[$option.QuestionId]
      $option.scoreCount += 1
    }
  }
}

foreach ($option in $Options) {
  if ($option.scoreCount -gt 0) {
    $option.averageScore = [math]::Round(($option.scoreSum / $option.scoreCount), 2)
  } else {
    $option.averageScore = 0
  }
}

$rawRows = @()
$rawHeader = @("responseId", "submittedAt", "participantName", "dedupeStatus")
$rawHeader += @($Options | ForEach-Object { $_.Short })
$rawRows += ,$rawHeader
foreach ($row in @($candidateRows | Sort-Object submittedAt)) {
  $status = if ($acceptedIds.ContainsKey($row.responseId)) { "counted" } else { "duplicate_dropped" }
  $line = @($row.responseId, $row.submittedAt.ToString("o"), $row.participantName, $status)
  foreach ($option in $Options) {
    $line += $(if ($row.scores.ContainsKey($option.QuestionId)) { $row.scores[$option.QuestionId] } else { "" })
  }
  $rawRows += ,@($line)
}

$scoreRows = @()
$scoreRows += ,@("slot", "name", "short", "color", "score")
foreach ($option in $Options) {
  $score = [double]$option.averageScore
  $scoreRows += ,@($option.Slot, $option.Name, $option.Short, $option.Color, $score)
}

$summaryRows = @()
$summaryRows += ,@("metric", "value")
$summaryRows += ,@("refreshedAt", (Get-Date).ToString("s"))
$summaryRows += ,@("responseCount", ($rawRows.Count - 1))
$summaryRows += ,@("uniqueVoterCount", $acceptedRows.Count)
$summaryRows += ,@("duplicateDroppedCount", (($rawRows.Count - 1) - $acceptedRows.Count))
$summaryRows += ,@("dedupeMode", $(if ($dedupeEnabled) { "name_latest_response" } else { "none_no_name_question" }))
$summaryRows += ,@("voteMode", "scale_average")
$summaryRows += ,@("formId", $FormId)
$summaryRows += ,@("nameQuestionId", $NameQuestionId)
$summaryRows += ,@("optionCount", $Options.Count)

Clear-SheetRange -TargetSpreadsheetId $SpreadsheetId -Range "Scores!A:H"
Clear-SheetRange -TargetSpreadsheetId $SpreadsheetId -Range "FormResponses!A:Z"

$scoreRange = "Scores!A1:E$($scoreRows.Count)"
$scoreBody = @{ range = $scoreRange; majorDimension = "ROWS"; values = $scoreRows } | ConvertTo-Json -Depth 12 -Compress
Invoke-GwsJson -CommandArgs @(
  "sheets", "spreadsheets", "values", "update",
  "--params", "{`"spreadsheetId`":`"$SpreadsheetId`",`"range`":`"$scoreRange`",`"valueInputOption`":`"USER_ENTERED`"}",
  "--json", $scoreBody
) | Out-Null

$rawRange = "FormResponses!A1:$([char](64 + $rawRows[0].Count))$($rawRows.Count)"
$rawBody = @{ range = $rawRange; majorDimension = "ROWS"; values = $rawRows } | ConvertTo-Json -Depth 12 -Compress
Invoke-GwsJson -CommandArgs @(
  "sheets", "spreadsheets", "values", "update",
  "--params", "{`"spreadsheetId`":`"$SpreadsheetId`",`"range`":`"$rawRange`",`"valueInputOption`":`"USER_ENTERED`"}",
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
  voteMode = "scale_average"
  spreadsheetId = $SpreadsheetId
  formId = $FormId
  nameQuestionId = $NameQuestionId
  resetMarkerPath = $ResetMarkerPath
  resetAtUtc = if (Test-Path -LiteralPath $ResetMarkerPath) { ([regex]::Match((Get-Content -LiteralPath $ResetMarkerPath -Raw), '"resetAtUtc"\s*:\s*"([^"]+)"')).Groups[1].Value } else { $null }
  scores = $scoreRows[1..($scoreRows.Count - 1)]
}

$report | ConvertTo-Json -Depth 8
