param(
  [string]$AgendaFormId = "1hWBiDnSvVdelCAXbwgkk1H9w06LDUim0-FcTr5-tXHE",
  [string]$AgendaSpreadsheetId = "1JCW6-r86Jr9uJWH4kc0GINe4R7u0EbPgIvbxMaRtZwY",
  [string]$ReflectionFormId = "1mxwgRD-IHocgAIsisgr9v9-9J-wotjgmHqRDK1NlLyI",
  [string]$ReflectionSpreadsheetId = "1HK4B_CilVyEbQgtDuZnnMPgUW0naDT3VAYt2Shh8qms"
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

function Update-SheetRows {
  param(
    [string]$SpreadsheetId,
    [array]$Rows,
    [array]$GuideRows
  )
  $responseRange = "Responses!A1:Z$($Rows.Count)"
  $body = @{ range = $responseRange; majorDimension = "ROWS"; values = $Rows } | ConvertTo-Json -Depth 16 -Compress
  Invoke-GwsJson -CommandArgs @(
    "sheets", "spreadsheets", "values", "update",
    "--params", "{`"spreadsheetId`":`"$SpreadsheetId`",`"range`":`"$responseRange`",`"valueInputOption`":`"USER_ENTERED`"}",
    "--json", $body
  ) | Out-Null

  $guideRange = "Guide!A1:B$($GuideRows.Count)"
  $guideBody = @{ range = $guideRange; majorDimension = "ROWS"; values = $GuideRows } | ConvertTo-Json -Depth 16 -Compress
  Invoke-GwsJson -CommandArgs @(
    "sheets", "spreadsheets", "values", "update",
    "--params", "{`"spreadsheetId`":`"$SpreadsheetId`",`"range`":`"$guideRange`",`"valueInputOption`":`"USER_ENTERED`"}",
    "--json", $guideBody
  ) | Out-Null
}

function Read-FormResponses {
  param([string]$FormId)
  $responses = Invoke-GwsJson -CommandArgs @(
    "forms", "forms", "responses", "list",
    "--params", "{`"formId`":`"$FormId`",`"pageSize`":5000}"
  )
  if ($responses.PSObject.Properties.Name -contains "responses") {
    return @($responses.responses)
  }
  return @()
}

$agendaRows = @()
$agendaRows += ,@("responseId", "submittedAt", "group", "agenda")
$agendaResponses = Read-FormResponses -FormId $AgendaFormId
foreach ($response in $agendaResponses) {
  $agendaRows += ,@(
    $response.responseId,
    $response.lastSubmittedTime,
    (Get-TextAnswer -Response $response -QuestionId "2fc17f88"),
    (Get-TextAnswer -Response $response -QuestionId "51bc9809")
  )
}
$agendaGuide = @()
$agendaGuide += ,@("metric", "value")
$agendaGuide += ,@("refreshedAt", (Get-Date).ToString("s"))
$agendaGuide += ,@("responseCount", ($agendaRows.Count - 1))
$agendaGuide += ,@("formId", $AgendaFormId)
$agendaGuide += ,@("flow", "group agenda input -> operator summary -> agenda vote choices")
Update-SheetRows -SpreadsheetId $AgendaSpreadsheetId -Rows $agendaRows -GuideRows $agendaGuide

$reflectionRows = @()
$reflectionRows += ,@("responseId", "submittedAt", "group", "reflection", "question")
$reflectionResponses = Read-FormResponses -FormId $ReflectionFormId
foreach ($response in $reflectionResponses) {
  $reflectionRows += ,@(
    $response.responseId,
    $response.lastSubmittedTime,
    (Get-TextAnswer -Response $response -QuestionId "09d5b108"),
    (Get-TextAnswer -Response $response -QuestionId "2df9b8e2"),
    (Get-TextAnswer -Response $response -QuestionId "2499f5c7")
  )
}
$reflectionGuide = @()
$reflectionGuide += ,@("metric", "value")
$reflectionGuide += ,@("refreshedAt", (Get-Date).ToString("s"))
$reflectionGuide += ,@("responseCount", ($reflectionRows.Count - 1))
$reflectionGuide += ,@("formId", $ReflectionFormId)
$reflectionGuide += ,@("flow", "one-hour later group reflection -> post-it/ontology presentation")
Update-SheetRows -SpreadsheetId $ReflectionSpreadsheetId -Rows $reflectionRows -GuideRows $reflectionGuide

[pscustomobject]@{
  refreshedAt = (Get-Date).ToString("o")
  agendaResponseCount = $agendaRows.Count - 1
  reflectionResponseCount = $reflectionRows.Count - 1
  agendaSpreadsheetId = $AgendaSpreadsheetId
  reflectionSpreadsheetId = $ReflectionSpreadsheetId
} | ConvertTo-Json -Depth 6
