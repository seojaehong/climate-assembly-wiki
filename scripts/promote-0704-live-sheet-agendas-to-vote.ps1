param(
  [string]$SpreadsheetId = "1aA0h2wUuKydj-RC7ZeD-bI-9C-7f1MQhe_78t7pA4JQ",
  [string]$VoteFormId = "1soeRdPzIv4l7Bs6JyJEbb4nzb7MCtmZEe2q8VFwmjgc",
  [string]$VoteQuestionId = "66dd7cab",
  [string]$VoteItemId = "3863dc5f",
  [int]$MaxChoices = 10,
  [switch]$Apply
)

$ErrorActionPreference = "Stop"

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
    $trimmed = $line.Trim()
    if (-not $started -and [string]::IsNullOrWhiteSpace($trimmed)) {
      continue
    }
    $started = $true
    $jsonLines += $line
    foreach ($char in $line.ToCharArray()) {
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

function Invoke-GwsJson {
  param([string[]]$CommandArgs)
  $gwsScript = Join-Path $env:APPDATA "npm\node_modules\@googleworkspace\cli\run-gws.js"
  if (-not (Test-Path -LiteralPath $gwsScript)) {
    throw "gws CLI script was not found at $gwsScript"
  }
  $psi = [System.Diagnostics.ProcessStartInfo]::new()
  $psi.FileName = "node.exe"
  $psi.UseShellExecute = $false
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.StandardOutputEncoding = [System.Text.Encoding]::UTF8
  $psi.StandardErrorEncoding = [System.Text.Encoding]::UTF8
  [void]$psi.ArgumentList.Add($gwsScript)
  foreach ($arg in $CommandArgs) {
    [void]$psi.ArgumentList.Add($arg)
  }
  $process = [System.Diagnostics.Process]::Start($psi)
  $stdout = $process.StandardOutput.ReadToEnd()
  $stderr = $process.StandardError.ReadToEnd()
  $process.WaitForExit()
  $output = @()
  if (-not [string]::IsNullOrWhiteSpace($stdout)) {
    $output += ($stdout -split "`r?`n")
  }
  if (-not [string]::IsNullOrWhiteSpace($stderr)) {
    $output += ($stderr -split "`r?`n")
  }
  if ($process.ExitCode -ne 0) {
    throw "gws failed ($($process.ExitCode)): $($output -join "`n")"
  }
  if (($output | Measure-Object).Count -eq 0) {
    return [pscustomobject]@{}
  }
  return Convert-GwsJson -Lines $output
}

function Normalize-AgendaText {
  param([string]$Text)
  $clean = ($Text -replace "\s+", " ").Trim().Trim(" .`t`r`n")
  if ($clean.Length -gt 90) {
    $clean = $clean.Substring(0, 90).Trim() + "..."
  }
  return $clean
}

function Read-SheetRange {
  param([string]$Range)
  $params = @{ spreadsheetId = $SpreadsheetId; range = $Range } | ConvertTo-Json -Compress
  $response = Invoke-GwsJson -CommandArgs @(
    "sheets", "spreadsheets", "values", "get",
    "--params", $params
  )
  if ($response.PSObject.Properties.Name -contains "values") {
    return @($response.values)
  }
  return @()
}

function Read-AgendaChoices {
  param([string[]]$Ranges)
  $items = @()
  foreach ($range in $Ranges) {
    $rows = Read-SheetRange -Range $range
    foreach ($row in @($rows | Select-Object -Skip 1)) {
      if (-not $row) {
        continue
      }
      $number = if ($row.Count -gt 0) { [string]$row[0] } else { "" }
      $group = if ($row.Count -gt 1) { [string]$row[1] } else { "" }
      $agenda = if ($row.Count -gt 2) { Normalize-AgendaText -Text ([string]$row[2]) } else { "" }
      if ([string]::IsNullOrWhiteSpace($agenda)) {
        continue
      }
      $items += [pscustomobject]@{
        group = $group
        number = $number
        agenda = $agenda
        sourceRange = $range
      }
    }
  }
  return @($items | Select-Object -First $MaxChoices)
}

$choices = Read-AgendaChoices -Ranges @("'A조 의제입력'!A1:E80", "'B조 의제입력'!A1:E80")

if ($choices.Count -eq 0) {
  [pscustomobject]@{
    applied = $false
    reason = "no_live_sheet_agendas"
    spreadsheetId = $SpreadsheetId
    voteFormId = $VoteFormId
  } | ConvertTo-Json -Depth 6
  exit 0
}

$options = @()
foreach ($choice in $choices) {
  $options += @{ value = $choice.agenda }
}

$item = @{
  itemId = $VoteItemId
  title = "오늘 논의 후 가장 우선적으로 다루어야 한다고 생각하는 의제를 하나 선택해주세요."
  description = "A/B조 실시간 Sheet 입력 의제를 정리해 만든 투표입니다."
  questionItem = @{
    question = @{
      questionId = $VoteQuestionId
      required = $true
      choiceQuestion = @{
        type = "RADIO"
        options = $options
      }
    }
  }
}

$requestBody = @{
  includeFormInResponse = $true
  requests = @(
    @{
      updateItem = @{
        item = $item
        location = @{ index = 0 }
        updateMask = "title,description,questionItem.question.choiceQuestion.options,questionItem.question.required"
      }
    }
  )
} | ConvertTo-Json -Depth 32 -Compress

if ($Apply) {
  $result = Invoke-GwsJson -CommandArgs @(
    "forms", "forms", "batchUpdate",
    "--params", "{`"formId`":`"$VoteFormId`"}",
    "--json", $requestBody
  )
  $revisionId = $result.form.revisionId
} else {
  $revisionId = $null
}

[pscustomobject]@{
  applied = [bool]$Apply
  spreadsheetId = $SpreadsheetId
  voteFormId = $VoteFormId
  voteQuestionId = $VoteQuestionId
  choiceCount = $choices.Count
  revisionId = $revisionId
  choices = @($choices)
  nextCommand = "pwsh -NoProfile -ExecutionPolicy Bypass -File scripts\refresh-0704-agenda-vote.ps1"
} | ConvertTo-Json -Depth 8
