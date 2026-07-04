param(
  [string]$SpreadsheetId = "1aA0h2wUuKydj-RC7ZeD-bI-9C-7f1MQhe_78t7pA4JQ",
  [string]$VoteFormId = "1soeRdPzIv4l7Bs6JyJEbb4nzb7MCtmZEe2q8VFwmjgc",
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
  return $Text.Trim()
}

function Is-SelectedAgendaNote {
  param([string]$Note)
  return -not [string]::IsNullOrWhiteSpace($Note) -and ($Note -match "선정|1위|2위|1순위|2순위")
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
      $note = if ($row.Count -gt 3) { [string]$row[3] } else { "" }
      if ([string]::IsNullOrWhiteSpace($agenda)) {
        continue
      }
      if (-not (Is-SelectedAgendaNote -Note $note)) {
        continue
      }
      $items += [pscustomobject]@{
        group = $group
        number = $number
        agenda = $agenda
        note = $note
        sourceRange = $range
      }
    }
  }
  return @($items | Select-Object -First $MaxChoices)
}

function Get-Form {
  Invoke-GwsJson -CommandArgs @(
    "forms", "forms", "get",
    "--params", "{`"formId`":`"$VoteFormId`"}"
  )
}

$choices = Read-AgendaChoices -Ranges @("'A조 의제입력'!A1:E80", "'B조 의제입력'!A1:E80")

if ($choices.Count -eq 0) {
  [pscustomobject]@{
    applied = $false
    reason = "no_selected_live_sheet_agendas"
    spreadsheetId = $SpreadsheetId
    voteFormId = $VoteFormId
  } | ConvertTo-Json -Depth 6
  exit 0
}

$requests = @()
$form = Get-Form
$itemCount = @($form.items).Count
for ($i = $itemCount - 1; $i -ge 0; $i--) {
  $requests += @{
    deleteItem = @{
      location = @{ index = $i }
    }
  }
}

$requests += @{
  createItem = @{
    location = @{ index = 0 }
    item = @{
      title = "이름"
      description = "중복 응답 확인용입니다. 동일 이름의 마지막 응답만 집계합니다."
      questionItem = @{
        question = @{
          required = $true
          textQuestion = @{}
        }
      }
    }
  }
}

$index = 1
foreach ($choice in $choices) {
  $requests += @{
    createItem = @{
      location = @{ index = $index }
      item = @{
        title = $choice.agenda
        description = "$($choice.group) $($choice.number)번 의제입니다. 1점은 낮음, 5점은 높음입니다."
        questionItem = @{
          question = @{
            required = $true
            scaleQuestion = @{
              low = 1
              high = 5
              lowLabel = "낮음"
              highLabel = "높음"
            }
          }
        }
      }
    }
  }
  $index++
}

$requestBody = @{
  includeFormInResponse = $true
  requests = $requests
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
  mode = "agenda_scale_1_to_5"
  spreadsheetId = $SpreadsheetId
  voteFormId = $VoteFormId
  agendaQuestionCount = $choices.Count
  revisionId = $revisionId
  choices = @($choices)
  nextCommand = "pwsh -NoProfile -ExecutionPolicy Bypass -File scripts\refresh-0704-agenda-vote.ps1"
} | ConvertTo-Json -Depth 8
