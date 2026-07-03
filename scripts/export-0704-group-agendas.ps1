param(
  [string]$GroupAgendaFormId = "1hWBiDnSvVdelCAXbwgkk1H9w06LDUim0-FcTr5-tXHE",
  [string]$OutputHtml = "public/0704-admin/group-agendas-print.html",
  [string]$OutputPdf = "public/0704-admin/group-agendas-print.pdf",
  [string]$OutputReport = "evaluation/0704-group-agendas-print-report.json",
  [string]$EmailTo = "kesica3@gmail.com",
  [string]$EmailFrom = "iceamericano9@gmail.com",
  [switch]$SendEmail,
  [switch]$UseSample
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

function Escape-Html {
  param([string]$Text)
  return [System.Net.WebUtility]::HtmlEncode($Text)
}

function ConvertTo-Base64Url {
  param([string]$Text)
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($Text)
  return [Convert]::ToBase64String($bytes).TrimEnd("=").Replace("+", "-").Replace("/", "_")
}

function ConvertBytesTo-Base64Url {
  param([byte[]]$Bytes)
  return [Convert]::ToBase64String($Bytes).TrimEnd("=").Replace("+", "-").Replace("/", "_")
}

function ConvertTo-MimeBase64 {
  param([byte[]]$Bytes)
  return [Convert]::ToBase64String($Bytes, [System.Base64FormattingOptions]::InsertLineBreaks)
}

function ConvertTo-EncodedWord {
  param([string]$Text)
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($Text)
  return "=?UTF-8?B?$([Convert]::ToBase64String($bytes))?="
}

function Get-GmailAccessToken {
  $credentials = Invoke-GwsJson -CommandArgs @("auth", "export", "--unmasked")
  $tokenResponse = Invoke-RestMethod -Method Post -Uri "https://oauth2.googleapis.com/token" -ContentType "application/x-www-form-urlencoded" -Body @{
    client_id = [string]$credentials.client_id
    client_secret = [string]$credentials.client_secret
    refresh_token = [string]$credentials.refresh_token
    grant_type = "refresh_token"
  }
  if (-not $tokenResponse.access_token) {
    throw "Google OAuth token refresh did not return an access token."
  }
  return [string]$tokenResponse.access_token
}

function Send-GmailWithPdfAttachment {
  param(
    [string]$From,
    [string]$To,
    [string]$Subject,
    [string]$Body,
    [string]$PdfPath,
    [string]$AttachmentName
  )
  if (-not (Test-Path -LiteralPath $PdfPath)) {
    throw "Attachment PDF does not exist: $PdfPath"
  }
  $boundary = "----=_0704_$([guid]::NewGuid().ToString("N"))"
  $encodedSubject = ConvertTo-EncodedWord -Text $Subject
  $encodedBody = ConvertTo-MimeBase64 -Bytes ([System.Text.Encoding]::UTF8.GetBytes($Body))
  $encodedAttachment = ConvertTo-MimeBase64 -Bytes ([System.IO.File]::ReadAllBytes($PdfPath))
  $rawMessage = @"
From: $From
To: $To
Subject: $encodedSubject
MIME-Version: 1.0
Content-Type: multipart/mixed; boundary="$boundary"

--$boundary
Content-Type: text/plain; charset=UTF-8
Content-Transfer-Encoding: base64

$encodedBody
--$boundary
Content-Type: application/pdf; name="$AttachmentName"
Content-Disposition: attachment; filename="$AttachmentName"
Content-Transfer-Encoding: base64

$encodedAttachment
--$boundary--
"@
  $rawBytes = [System.Text.Encoding]::UTF8.GetBytes(($rawMessage -replace "`r?`n", "`r`n"))
  $accessToken = Get-GmailAccessToken
  $payload = @{ raw = ConvertBytesTo-Base64Url -Bytes $rawBytes } | ConvertTo-Json -Compress
  Invoke-RestMethod -Method Post -Uri "https://gmail.googleapis.com/gmail/v1/users/me/messages/send" -Headers @{
    Authorization = "Bearer $accessToken"
  } -ContentType "application/json; charset=utf-8" -Body $payload | Out-Null
}

function Get-ChromePath {
  $candidates = @(
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "$env:ProgramFiles(x86)\Google\Chrome\Application\chrome.exe",
    "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
    "$env:ProgramFiles(x86)\Microsoft\Edge\Application\msedge.exe"
  )
  foreach ($candidate in $candidates) {
    if (Test-Path -LiteralPath $candidate) {
      return $candidate
    }
  }
  throw "Chrome or Edge executable was not found. Cannot render PDF."
}

function Export-HtmlToPdf {
  param(
    [string]$HtmlPath,
    [string]$PdfPath
  )
  $chrome = Get-ChromePath
  $resolvedHtml = (Resolve-Path -LiteralPath $HtmlPath).Path
  $pdfDir = Split-Path -Parent $PdfPath
  if (-not (Test-Path -LiteralPath $pdfDir)) {
    New-Item -ItemType Directory -Path $pdfDir | Out-Null
  }
  $resolvedPdf = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($PdfPath)
  if (Test-Path -LiteralPath $resolvedPdf) {
    Remove-Item -LiteralPath $resolvedPdf -Force
  }
  $uri = [System.Uri]::new($resolvedHtml).AbsoluteUri
  $args = @(
    "--headless=new",
    "--disable-gpu",
    "--no-pdf-header-footer",
    "--print-to-pdf=$resolvedPdf",
    $uri
  )
  $process = Start-Process -FilePath $chrome -ArgumentList $args -Wait -PassThru -WindowStyle Hidden
  if ($process.ExitCode -ne 0) {
    throw "Chrome PDF export failed with exit code $($process.ExitCode)."
  }
  if (-not (Test-Path -LiteralPath $resolvedPdf)) {
    throw "Chrome PDF export did not create $resolvedPdf."
  }
  return $resolvedPdf
}

function Normalize-Agenda {
  param([string]$Text)
  return ($Text -replace "\s+", " ").Trim()
}

function Get-GroupOrder {
  param([string]$Group)
  if ($Group -eq "연구진") {
    return 999
  }
  $number = ($Group -replace "[^0-9]", "")
  if ([string]::IsNullOrWhiteSpace($number)) {
    return 998
  }
  return [int]$number
}

$agendas = @()
if ($UseSample) {
  $agendas = @(
    [pscustomobject]@{ group = "1조"; submittedAt = "2026-07-04T15:21:12+09:00"; agenda = "공공건물과 학교의 에너지 절약 실천을 의무화하고 절감 효과를 시민에게 공개하는 방안"; responseId = "sample-agenda-001" },
    [pscustomobject]@{ group = "2조"; submittedAt = "2026-07-04T15:23:40+09:00"; agenda = "탄소 감축 행동에 참여한 시민에게 교통비나 공공시설 이용 혜택을 제공하는 통합 인센티브 제도"; responseId = "sample-agenda-002" },
    [pscustomobject]@{ group = "3조"; submittedAt = "2026-07-04T15:25:09+09:00"; agenda = "기업의 탄소배출 정보와 감축 계획을 시민이 쉽게 확인하고 의견을 낼 수 있는 공개 플랫폼"; responseId = "sample-agenda-003" },
    [pscustomobject]@{ group = "연구진"; submittedAt = "2026-07-04T15:26:33+09:00"; agenda = "조별 의제를 권고안 문장으로 전환하기 위한 우선순위와 실행가능성 기준 정리"; responseId = "sample-agenda-004" }
  )
} else {
  $responses = Invoke-GwsJson -CommandArgs @(
    "forms", "forms", "responses", "list",
    "--params", "{`"formId`":`"$GroupAgendaFormId`",`"pageSize`":5000}"
  )
  $responseItems = @()
  if ($responses.PSObject.Properties.Name -contains "responses") {
    $responseItems = @($responses.responses)
  }
  foreach ($response in $responseItems) {
    $group = (Get-TextAnswer -Response $response -QuestionId "2fc17f88").Trim()
    $agenda = Normalize-Agenda -Text (Get-TextAnswer -Response $response -QuestionId "51bc9809")
    if ([string]::IsNullOrWhiteSpace($group) -or [string]::IsNullOrWhiteSpace($agenda)) {
      continue
    }
    $agendas += [pscustomobject]@{
      group = $group
      submittedAt = [string]$response.lastSubmittedTime
      agenda = $agenda
      responseId = [string]$response.responseId
    }
  }
}

$agendas = @($agendas | Sort-Object @{ Expression = { Get-GroupOrder -Group $_.group } }, submittedAt)
$generatedAt = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
$cards = if ($agendas.Count -gt 0) {
  ($agendas | ForEach-Object {
    @"
    <article class="agenda-card">
      <div class="agenda-meta"><span>$(Escape-Html $_.group)</span><span>$(Escape-Html $_.submittedAt)</span></div>
      <div class="agenda-text">$(Escape-Html $_.agenda)</div>
    </article>
"@
  }) -join "`n"
} else {
  "<div class=`"empty`">현재 인쇄할 조별 의제 후보가 없습니다.</div>"
}

$html = @"
<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>0704 조별 의제 후보 인쇄</title>
<style>
  body{margin:0;background:#f8fafc;color:#0f172a;font-family:"Noto Sans KR",system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
  main{width:min(920px,calc(100vw - 32px));margin:0 auto;padding:28px 0}
  h1{margin:0 0 6px;font-size:30px;line-height:1.2}
  .sub{margin:0 0 18px;color:#64748b;font-weight:800}
  .actions{display:flex;gap:8px;margin-bottom:18px}
  button,a{height:38px;border:0;border-radius:8px;background:#0f172a;color:#fff;font-weight:900;padding:0 14px;text-decoration:none;display:inline-flex;align-items:center;cursor:pointer}
  a{background:#eef2f7;color:#0f172a}
  .agenda-card{break-inside:avoid;margin:0 0 14px;padding:18px 20px;border:1px solid #dbe4ef;border-radius:12px;background:#fff;box-shadow:0 8px 24px rgba(15,23,42,.05)}
  .agenda-meta{display:flex;justify-content:space-between;gap:12px;margin-bottom:10px;color:#475569;font-size:13px;font-weight:900}
  .agenda-text{font-size:23px;line-height:1.5;font-weight:900;letter-spacing:0}
  .empty{border:1px solid #dbe4ef;background:#fff;border-radius:12px;padding:22px;font-weight:900}
  @media print{
    @page{size:A4;margin:13mm}
    body{background:#fff}
    main{width:auto;margin:0;padding:0}
    .actions{display:none}
    .agenda-card{box-shadow:none;border-color:#cbd5e1}
  }
</style>
</head>
<body>
<main>
  <div class="actions">
    <button onclick="window.print()">인쇄</button>
    <a href="/0704-admin/">관리자</a>
  </div>
  <h1>0704 조별 의제 후보</h1>
  <p class="sub">생성: $generatedAt · 의제 후보 $($agendas.Count)건</p>
  $cards
</main>
</body>
</html>
"@

$outputDir = Split-Path -Parent $OutputHtml
if (-not (Test-Path -LiteralPath $outputDir)) {
  New-Item -ItemType Directory -Path $outputDir | Out-Null
}
Set-Content -LiteralPath $OutputHtml -Value $html -Encoding UTF8
$pdfPath = Export-HtmlToPdf -HtmlPath $OutputHtml -PdfPath $OutputPdf

$reportDir = Split-Path -Parent $OutputReport
if (-not (Test-Path -LiteralPath $reportDir)) {
  New-Item -ItemType Directory -Path $reportDir | Out-Null
}

$mailSubject = "[기후시민회의 7.4] 조별 의제 후보 인쇄본 $($agendas.Count)건"
$mailLines = @()
$mailLines += "0704 조별 의제 후보"
$mailLines += "생성: $generatedAt"
$mailLines += "의제 후보: $($agendas.Count)건"
$mailLines += "인쇄 PDF: https://climate-assembly.org/0704-admin/group-agendas-print.pdf"
$mailLines += ""
if ($agendas.Count -gt 0) {
  $i = 1
  foreach ($agenda in $agendas) {
    $mailLines += "$i. [$($agenda.group)] $($agenda.agenda)"
    $mailLines += ""
    $i++
  }
} else {
  $mailLines += "현재 인쇄/공유할 조별 의제 후보가 없습니다."
}
$mailBody = $mailLines -join "`r`n"

$emailStatus = "dry_run"
if ($SendEmail) {
  Send-GmailWithPdfAttachment -From $EmailFrom -To $EmailTo -Subject $mailSubject -Body $mailBody -PdfPath $pdfPath -AttachmentName "0704-group-agendas-print.pdf"
  $emailStatus = "sent_with_pdf"
}

$report = [pscustomobject]@{
  generatedAt = (Get-Date).ToString("o")
  groupAgendaFormId = $GroupAgendaFormId
  sample = [bool]$UseSample
  agendaCount = $agendas.Count
  outputHtml = (Resolve-Path -LiteralPath $OutputHtml).Path
  outputPdf = $pdfPath
  emailTo = $EmailTo
  emailStatus = $emailStatus
  agendas = $agendas
}
$report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $OutputReport -Encoding UTF8
$report | ConvertTo-Json -Depth 8
