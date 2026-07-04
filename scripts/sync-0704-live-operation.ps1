param(
  [switch]$PromoteVoteChoices,
  [switch]$SendEmail,
  [switch]$Deploy,
  [switch]$SkipPrint,
  [switch]$SkipVotes,
  [string]$OutputReport = "evaluation/0704-live-operation-sync-report.json"
)

$ErrorActionPreference = "Stop"

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent $scriptRoot
$steps = @()

function Invoke-Step {
  param(
    [string]$Name,
    [scriptblock]$Action
  )
  $started = Get-Date
  try {
    $output = & $Action 2>&1
    if ($LASTEXITCODE -ne 0) {
      throw "$Name failed with exit code $LASTEXITCODE. Output: $($output -join "`n")"
    }
    $script:steps += [pscustomobject]@{
      name = $Name
      status = "ok"
      startedAt = $started.ToString("o")
      finishedAt = (Get-Date).ToString("o")
      output = ($output -join "`n")
    }
  } catch {
    $script:steps += [pscustomobject]@{
      name = $Name
      status = "failed"
      startedAt = $started.ToString("o")
      finishedAt = (Get-Date).ToString("o")
      error = $_.Exception.Message
    }
    throw
  }
}

Push-Location $repoRoot
try {
  Invoke-Step -Name "ensure_form_fields" -Action {
    pwsh -NoProfile -ExecutionPolicy Bypass -File scripts\ensure-0704-form-field-setup.ps1 -Apply
  }

  Invoke-Step -Name "refresh_input_forms" -Action {
    pwsh -NoProfile -ExecutionPolicy Bypass -File scripts\refresh-0704-input-forms.ps1
  }

  if (-not $SkipPrint) {
    Invoke-Step -Name "export_live_sheet_packets" -Action {
      $args = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "scripts\export-0704-live-sheet-packets.ps1")
      if ($SendEmail) {
        $args += "-SendEmail"
      }
      pwsh @args
    }
  }

  if ($PromoteVoteChoices) {
    Invoke-Step -Name "promote_live_sheet_agendas_to_vote" -Action {
      pwsh -NoProfile -ExecutionPolicy Bypass -File scripts\promote-0704-live-sheet-agendas-to-vote.ps1 -Apply
    }
  }

  if (-not $SkipVotes) {
    Invoke-Step -Name "refresh_agenda_vote" -Action {
      pwsh -NoProfile -ExecutionPolicy Bypass -File scripts\refresh-0704-agenda-vote.ps1
    }
    Invoke-Step -Name "refresh_decision_votes" -Action {
      pwsh -NoProfile -ExecutionPolicy Bypass -File scripts\refresh-0704-decision-votes.ps1
    }
  }

  if ($Deploy) {
    Invoke-Step -Name "deploy_public_pages" -Action {
      Copy-Item -Path public\* -Destination dist -Recurse -Force
      $deployOutput = npm.cmd exec --yes --package wrangler@4.30.0 -- wrangler pages deploy dist --project-name climate-assembly-wiki --branch main --commit-dirty=true --skip-caching 2>&1
      $deployCode = $LASTEXITCODE
      $deployText = $deployOutput -join "`n"
      if (($deployCode -ne 0) -and ($deployText -notmatch "Deployment complete")) {
        throw "Wrangler deploy failed with exit code $deployCode. Output: $deployText"
      }
      $global:LASTEXITCODE = 0
      $deployOutput
    }
  }

  $report = [pscustomobject]@{
    generatedAt = (Get-Date).ToString("o")
    promoteVoteChoices = [bool]$PromoteVoteChoices
    sendEmail = [bool]$SendEmail
    deploy = [bool]$Deploy
    skipPrint = [bool]$SkipPrint
    skipVotes = [bool]$SkipVotes
    steps = $steps
  }
  $report | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $OutputReport -Encoding UTF8
  $report | ConvertTo-Json -Depth 10
}
finally {
  Pop-Location
}
