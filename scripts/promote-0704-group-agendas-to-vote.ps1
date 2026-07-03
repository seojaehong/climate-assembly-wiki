param(
  [string]$GroupAgendaFormId = "1hWBiDnSvVdelCAXbwgkk1H9w06LDUim0-FcTr5-tXHE",
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

function Get-TextAnswer {
  param(
    [object]$Response,
    [string]$QuestionId
  )
  if (-not $Response.answers -or -not ($Response.answers.PSObject.Properties.Name -contains $QuestionId)) {
    return ""
  }
  $answer = $Response.answers.$QuestionId
  if ($answer.textAnswers -and $answer.textAnswers.answers.Count -gt 0) {
    return [string]$answer.textAnswers.answers[0].value
  }
  return ""
}

function Normalize-AgendaText {
  param([string]$Text)
  $clean = ($Text -replace "\s+", " ").Trim()
  $clean = $clean.Trim(" .`t`r`n")
  if ($clean.Length -gt 90) {
    $clean = $clean.Substring(0, 90).Trim() + "..."
  }
  return $clean
}

$responses = Invoke-GwsJson -CommandArgs @(
  "forms", "forms", "responses", "list",
  "--params", "{`"formId`":`"$GroupAgendaFormId`",`"pageSize`":5000}"
)

$items = @()
if ($responses.PSObject.Properties.Name -contains "responses") {
  $items = @($responses.responses)
}

$latestByGroup = @{}
foreach ($response in $items) {
  $group = Get-TextAnswer -Response $response -QuestionId "2fc17f88"
  $agenda = Normalize-AgendaText -Text (Get-TextAnswer -Response $response -QuestionId "51bc9809")
  if ([string]::IsNullOrWhiteSpace($group) -or [string]::IsNullOrWhiteSpace($agenda)) {
    continue
  }
  $submitted = [datetime]$response.lastSubmittedTime
  if (-not $latestByGroup.ContainsKey($group) -or $submitted -gt $latestByGroup[$group].submittedAt) {
    $latestByGroup[$group] = [pscustomobject]@{
      group = $group
      agenda = $agenda
      submittedAt = $submitted
      responseId = $response.responseId
    }
  }
}

$choices = @($latestByGroup.Values |
  Sort-Object @{ Expression = { $_.group -eq "연구진" } }, @{ Expression = { [int](($_.group -replace "[^0-9]", "") -as [int]) } }, submittedAt |
  Select-Object -First $MaxChoices)

if ($choices.Count -eq 0) {
  [pscustomobject]@{
    applied = $false
    reason = "no_group_agenda_responses"
    groupAgendaFormId = $GroupAgendaFormId
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
  description = "조별 입력 의제를 정리해 만든 투표입니다."
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
  voteFormId = $VoteFormId
  voteQuestionId = $VoteQuestionId
  choiceCount = $choices.Count
  revisionId = $revisionId
  choices = @($choices | Select-Object group, agenda, submittedAt, responseId)
  nextCommand = "pwsh -NoProfile -ExecutionPolicy Bypass -File scripts\refresh-0704-agenda-vote.ps1"
} | ConvertTo-Json -Depth 8
