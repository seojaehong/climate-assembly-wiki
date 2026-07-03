param(
  [string]$QuestionFormId = "1yktkA_XAMGcVt4mlnC-0Yc3d3N0N0YQ__Dk1TfdTaCc",
  [string]$OutputHtml = "public/0704-admin/expert-questions-print.html",
  [string]$OutputPdf = "public/0704-admin/expert-questions-print.pdf",
  [string]$OutputReport = "evaluation/0704-expert-questions-print-report.json",
  [string]$EmailTo = "kesica3@gmail.com",
  [string]$EmailFrom = "iceamericano9@gmail.com",
  [string]$Since = "2026-07-04T00:00:00+09:00",
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

function Normalize-Text {
  param([string]$Text)
  return ($Text -replace "\s+", " ").Trim()
}

$questions = @()
if ($UseSample) {
  $questions = @(
    [pscustomobject]@{ group = "2조"; submittedAt = "2026-07-04T14:04:12+09:00"; question = "에너지전환 의제를 다룰 때 시민들이 가장 먼저 이해해야 할 핵심 쟁점은 무엇인가요?"; responseId = "sample-question-001" },
    [pscustomobject]@{ group = "7조"; submittedAt = "2026-07-04T14:06:33+09:00"; question = "산업 부문 감축 정책이 일자리와 지역경제에 미치는 영향을 어떻게 설명하면 좋을까요?"; responseId = "sample-question-002" },
    [pscustomobject]@{ group = "12조"; submittedAt = "2026-07-04T14:08:20+09:00"; question = "재생에너지 확대 과정에서 주민 수용성을 높이기 위한 구체적인 정책 사례가 있을까요?"; responseId = "sample-question-003" }
  )
} else {
  $sinceTime = [datetimeoffset]::Parse($Since)
  $responses = Invoke-GwsJson -CommandArgs @(
    "forms", "forms", "responses", "list",
    "--params", "{`"formId`":`"$QuestionFormId`",`"pageSize`":5000}"
  )
  $responseItems = @()
  if ($responses.PSObject.Properties.Name -contains "responses") {
    $responseItems = @($responses.responses)
  }
  foreach ($response in $responseItems) {
    $submittedAt = [datetimeoffset]::Parse([string]$response.lastSubmittedTime)
    if ($submittedAt -lt $sinceTime) {
      continue
    }
    $question = Normalize-Text -Text (Get-TextAnswer -Response $response -QuestionId "4dc77064")
    if ([string]::IsNullOrWhiteSpace($question)) {
      continue
    }
    $questions += [pscustomobject]@{
      group = (Get-TextAnswer -Response $response -QuestionId "730cdc6b").Trim()
      submittedAt = [string]$response.lastSubmittedTime
      question = $question
      responseId = [string]$response.responseId
    }
  }
}

$questions = @($questions | Sort-Object submittedAt)
$generatedAt = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
$cards = if ($questions.Count -gt 0) {
  ($questions | ForEach-Object {
    @"
    <article class="q-card">
      <div class="q-meta"><span>$(Escape-Html $_.group)</span><span>$(Escape-Html $_.submittedAt)</span></div>
      <div class="q-text">$(Escape-Html $_.question)</div>
    </article>
"@
  }) -join "`n"
} else {
  "<div class=`"empty`">현재 인쇄할 전문가 질의가 없습니다.</div>"
}

$html = @"
<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>0704 전문가 질의 인쇄</title>
<style>
  body{margin:0;background:#f8fafc;color:#0f172a;font-family:"Noto Sans KR",system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
  main{width:min(920px,calc(100vw - 32px));margin:0 auto;padding:28px 0}
  h1{margin:0 0 6px;font-size:30px;line-height:1.2}
  .sub{margin:0 0 18px;color:#64748b;font-weight:800}
  .actions{display:flex;gap:8px;margin-bottom:18px}
  button,a{height:38px;border:0;border-radius:8px;background:#0f172a;color:#fff;font-weight:900;padding:0 14px;text-decoration:none;display:inline-flex;align-items:center;cursor:pointer}
  a{background:#eef2f7;color:#0f172a}
  .q-card{break-inside:avoid;margin:0 0 14px;padding:18px 20px;border:1px solid #dbe4ef;border-radius:12px;background:#fff;box-shadow:0 8px 24px rgba(15,23,42,.05)}
  .q-meta{display:flex;justify-content:space-between;gap:12px;margin-bottom:10px;color:#475569;font-size:13px;font-weight:900}
  .q-text{font-size:23px;line-height:1.5;font-weight:900;letter-spacing:0}
  .empty{border:1px solid #dbe4ef;background:#fff;border-radius:12px;padding:22px;font-weight:900}
  @media print{
    @page{size:A4;margin:13mm}
    body{background:#fff}
    main{width:auto;margin:0;padding:0}
    .actions{display:none}
    .q-card{box-shadow:none;border-color:#cbd5e1}
  }
</style>
</head>
<body>
<main>
  <div class="actions">
    <button onclick="window.print()">인쇄</button>
    <a href="/0704-admin/">관리자</a>
  </div>
  <h1>0704 전문가 질의</h1>
  <p class="sub">생성: $generatedAt · 질문 $($questions.Count)건</p>
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

$mailSubject = "[기후시민회의 7.4] 전문가 질문 인쇄본 $($questions.Count)건"
$mailLines = @()
$mailLines += "0704 전문가 질문 인쇄본"
$mailLines += "생성: $generatedAt"
$mailLines += "질문: $($questions.Count)건"
$mailLines += "인쇄 PDF: https://climate-assembly.org/0704-admin/expert-questions-print.pdf"
$mailLines += ""
if ($questions.Count -gt 0) {
  $i = 1
  foreach ($question in $questions) {
    $mailLines += "$i. [$($question.group)] $($question.question)"
    $mailLines += ""
    $i++
  }
} else {
  $mailLines += "현재 인쇄/공유할 전문가 질의가 없습니다."
}
$mailBody = $mailLines -join "`r`n"

$emailStatus = "dry_run"
if ($SendEmail) {
  Send-GmailWithPdfAttachment -From $EmailFrom -To $EmailTo -Subject $mailSubject -Body $mailBody -PdfPath $pdfPath -AttachmentName "0704-expert-questions-print.pdf"
  $emailStatus = "sent_with_pdf"
}

$report = [pscustomobject]@{
  generatedAt = (Get-Date).ToString("o")
  questionFormId = $QuestionFormId
  sample = [bool]$UseSample
  since = $Since
  questionCount = $questions.Count
  outputHtml = (Resolve-Path -LiteralPath $OutputHtml).Path
  outputPdf = $pdfPath
  emailTo = $EmailTo
  emailStatus = $emailStatus
  questions = $questions
}
$report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $OutputReport -Encoding UTF8
$report | ConvertTo-Json -Depth 8
