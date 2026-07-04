param(
  [switch]$Apply
)

$ErrorActionPreference = "Stop"

$VoteForms = @(
  [pscustomobject]@{
    Label = "agenda"
    FormId = "1soeRdPzIv4l7Bs6JyJEbb4nzb7MCtmZEe2q8VFwmjgc"
    InsertIndex = 1
  },
  [pscustomobject]@{
    Label = "decision_v0"
    FormId = "1QXrENjjmh7NcTF_9sm4aUPhnh1_WuAWvP4q80AdBM8s"
    InsertIndex = 1
  },
  [pscustomobject]@{
    Label = "decision_v1a"
    FormId = "1YCMzcYk_XLD95_8MvzJAB4ReQKQs4nl7P18o9hBQTk4"
    InsertIndex = 1
  },
  [pscustomobject]@{
    Label = "decision_v1b"
    FormId = "1bdEi3hN6p8qOqWGdJV3f8UK3g4wPDEtojjQakCpDTd4"
    InsertIndex = 1
  }
)

$ReflectionForm = [pscustomobject]@{
  Label = "reflection"
  FormId = "1mxwgRD-IHocgAIsisgr9v9-9J-wotjgmHqRDK1NlLyI"
  GroupItemId = "5a1a8e4c"
  GroupQuestionId = "09d5b108"
}

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

function Get-Form {
  param([string]$FormId)
  return Invoke-GwsJson -CommandArgs @(
    "forms", "forms", "get",
    "--params", "{`"formId`":`"$FormId`"}"
  )
}

function Test-HasNameItem {
  param([object]$Form)
  foreach ($item in @($Form.items)) {
    $title = ([string]$item.title).Trim()
    $question = $item.questionItem.question
    if ($question -and $title -eq "이름") {
      return $true
    }
  }
  return $false
}

function New-NameItemRequest {
  param([int]$Index)
  return @{
    createItem = @{
      item = @{
        title = "이름"
        description = "중복 응답 확인용입니다. 현장에서는 동일 이름의 마지막 응답만 집계합니다."
        questionItem = @{
          question = @{
            required = $true
            textQuestion = @{
              paragraph = $false
            }
          }
        }
      }
      location = @{
        index = $Index
      }
    }
  }
}

function Invoke-FormBatchUpdate {
  param(
    [string]$FormId,
    [object[]]$Requests
  )
  if ($Requests.Count -eq 0) {
    return $null
  }
  $body = @{
    includeFormInResponse = $true
    requests = $Requests
  } | ConvertTo-Json -Depth 32 -Compress
  if (-not $Apply) {
    return $null
  }
  return Invoke-GwsJson -CommandArgs @(
    "forms", "forms", "batchUpdate",
    "--params", "{`"formId`":`"$FormId`"}",
    "--json", $body
  )
}

$voteReports = @()
foreach ($voteForm in $VoteForms) {
  $form = Get-Form -FormId $voteForm.FormId
  $hasName = Test-HasNameItem -Form $form
  $requests = @()
  if (-not $hasName) {
    $requests += New-NameItemRequest -Index $voteForm.InsertIndex
  }
  $result = Invoke-FormBatchUpdate -FormId $voteForm.FormId -Requests $requests
  $voteReports += [pscustomobject]@{
    label = $voteForm.Label
    formId = $voteForm.FormId
    hadNameField = $hasName
    addedNameField = (-not $hasName)
    applied = [bool]($Apply -and $requests.Count -gt 0)
    revisionId = if ($result -and $result.form) { $result.form.revisionId } else { $form.revisionId }
  }
}

$reflectionForm = Get-Form -FormId $ReflectionForm.FormId
$groupItem = $null
foreach ($item in @($reflectionForm.items)) {
  $title = ([string]$item.title).Trim()
  $question = $item.questionItem.question
  if ($item.itemId -eq $ReflectionForm.GroupItemId -or ($question -and $question.questionId -eq $ReflectionForm.GroupQuestionId) -or $title -eq "조를 선택해주세요.") {
    $groupItem = $item
    break
  }
}
if (-not $groupItem) {
  throw "Reflection group item was not found."
}

$targetGroups = @()
for ($i = 1; $i -le 17; $i++) {
  $targetGroups += "$($i)조"
}

$currentGroups = @($groupItem.questionItem.question.choiceQuestion.options | ForEach-Object { [string]$_.value })
$groupNeedsUpdate = (@($targetGroups | Where-Object { $_ -notin $currentGroups }).Count -gt 0) -or ($currentGroups.Count -ne $targetGroups.Count)

$reflectionRequests = @()
if ($groupNeedsUpdate) {
  $groupItemId = [string]$groupItem.itemId
  $groupQuestionId = [string]$groupItem.questionItem.question.questionId
  $reflectionRequests += @{
    updateItem = @{
      item = @{
        itemId = $groupItemId
        title = "조를 선택해주세요."
        questionItem = @{
          question = @{
            questionId = $groupQuestionId
            required = $true
            choiceQuestion = @{
              type = "RADIO"
              options = @($targetGroups | ForEach-Object { @{ value = $_ } })
            }
          }
        }
      }
      location = @{ index = 0 }
      updateMask = "title,questionItem.question.choiceQuestion.options,questionItem.question.required"
    }
  }
}
$reflectionResult = Invoke-FormBatchUpdate -FormId $ReflectionForm.FormId -Requests $reflectionRequests

[pscustomobject]@{
  applied = [bool]$Apply
  voteForms = $voteReports
  reflection = [pscustomobject]@{
    formId = $ReflectionForm.FormId
    previousGroupCount = $currentGroups.Count
    targetGroupCount = $targetGroups.Count
    updatedGroups = $groupNeedsUpdate
    groups = $targetGroups
    revisionId = if ($reflectionResult -and $reflectionResult.form) { $reflectionResult.form.revisionId } else { $reflectionForm.revisionId }
  }
} | ConvertTo-Json -Depth 12
