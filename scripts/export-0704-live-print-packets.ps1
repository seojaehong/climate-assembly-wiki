param(
  [switch]$SendEmail,
  [switch]$UseSample
)

$ErrorActionPreference = "Stop"

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent $scriptRoot

Push-Location $repoRoot
try {
  $expertArgs = @(
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-File", "scripts\export-0704-expert-questions.ps1"
  )
  $agendaArgs = @(
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-File", "scripts\export-0704-group-agendas.ps1"
  )

  if ($SendEmail) {
    $expertArgs += "-SendEmail"
    $agendaArgs += "-SendEmail"
  }
  if ($UseSample) {
    $expertArgs += "-UseSample"
    $agendaArgs += "-UseSample"
  }

  Write-Host "[0704] Refreshing expert question print packet from live Form responses..."
  & pwsh @expertArgs
  if ($LASTEXITCODE -ne 0) {
    throw "Expert question export failed with exit code $LASTEXITCODE."
  }

  Write-Host "[0704] Refreshing group agenda print packet from live Form responses..."
  & pwsh @agendaArgs
  if ($LASTEXITCODE -ne 0) {
    throw "Group agenda export failed with exit code $LASTEXITCODE."
  }

  $expertReport = Get-Content -Raw -Encoding UTF8 "evaluation\0704-expert-questions-print-report.json" | ConvertFrom-Json
  $agendaReport = Get-Content -Raw -Encoding UTF8 "evaluation\0704-group-agendas-print-report.json" | ConvertFrom-Json

  $summary = [pscustomobject]@{
    generatedAt = (Get-Date).ToString("o")
    mode = if ($UseSample) { "sample" } else { "live" }
    email = if ($SendEmail) { "sent" } else { "dry_run" }
    expertQuestionCount = $expertReport.questionCount
    groupAgendaCount = $agendaReport.agendaCount
    expertPdf = $expertReport.outputPdf
    groupAgendaPdf = $agendaReport.outputPdf
  }

  $summaryPath = "evaluation\0704-live-print-packets-report.json"
  $summary | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $summaryPath -Encoding UTF8
  $summary | ConvertTo-Json -Depth 6
}
finally {
  Pop-Location
}
