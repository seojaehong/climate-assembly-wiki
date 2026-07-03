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
    [pscustomobject]@{ group = "2조"; submittedAt = "2026-07-04T14:04:12+09:00"; question = "에너지전환 의제를 다룰 때 시민들이 가장 먼저 이해해야 할 핵심 쟁점은 무엇인가요?"; impression = "감축 분야가 중요하다는 점은 이해했지만 생활과 어떻게 연결되는지 궁금했습니다."; responseId = "sample-question-001" },
    [pscustomobject]@{ group = "7조"; submittedAt = "2026-07-04T14:06:33+09:00"; question = "산업 부문 감축 정책이 일자리와 지역경제에 미치는 영향을 어떻게 설명하면 좋을까요?"; impression = "감축 필요성과 정의로운 전환이 함께 논의되어야 한다고 느꼈습니다."; responseId = "sample-question-002" },
    [pscustomobject]@{ group = "12조"; submittedAt = "2026-07-04T14:08:20+09:00"; question = "재생에너지 확대 과정에서 주민 수용성을 높이기 위한 구체적인 정책 사례가 있을까요?"; impression = "실행 가능한 사례를 듣고 의제를 더 구체화하고 싶습니다."; responseId = "sample-question-003" }
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
      impression = Normalize-Text -Text (Get-TextAnswer -Response $response -QuestionId "4e5df035")
      responseId = [string]$response.responseId
    }
  }
}

$questions = @($questions | Sort-Object submittedAt)
$generatedAt = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
$cards = if ($questions.Count -gt 0) {
  ($questions | ForEach-Object {
    $impressionHtml = ""
    if (-not [string]::IsNullOrWhiteSpace($_.impression)) {
      $impressionHtml = "<div class=`"impression`"><b>소감</b><span>$(Escape-Html $_.impression)</span></div>"
    }
    @"
    <article class="q-card">
      <div class="q-meta"><span>$(Escape-Html $_.group)</span><span>$(Escape-Html $_.submittedAt)</span></div>
      <div class="q-text">$(Escape-Html $_.question)</div>
      $impressionHtml
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
  .impression{margin-top:14px;padding-top:12px;border-top:1px solid #e2e8f0;color:#334155;font-size:14px;line-height:1.55}
  .impression b{display:block;margin-bottom:4px;color:#0f172a}
  .impression span{white-space:pre-wrap}
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
$mailLines += "0704 전문가 질의"
$mailLines += "생성: $generatedAt"
$mailLines += "질문: $($questions.Count)건"
$mailLines += "인쇄 PDF: https://climate-assembly.org/0704-admin/expert-questions-print.pdf"
$mailLines += ""
if ($questions.Count -gt 0) {
  $i = 1
  foreach ($question in $questions) {
    $mailLines += "$i. [$($question.group)] $($question.question)"
    if (-not [string]::IsNullOrWhiteSpace($question.impression)) {
      $mailLines += "   소감: $($question.impression)"
    }
    $mailLines += ""
    $i++
  }
} else {
  $mailLines += "현재 인쇄/공유할 전문가 질의가 없습니다."
}
$mailBody = $mailLines -join "`r`n"

$emailStatus = "dry_run"
if ($SendEmail) {
  $rawMessage = "From: $EmailFrom`r`nTo: $EmailTo`r`nSubject: $mailSubject`r`nMIME-Version: 1.0`r`nContent-Type: text/plain; charset=UTF-8`r`n`r`n$mailBody"
  $raw = ConvertTo-Base64Url -Text $rawMessage
  Invoke-GwsJson -CommandArgs @(
    "gmail", "users", "messages", "send",
    "--params", "{`"userId`":`"me`"}",
    "--json", (@{ raw = $raw } | ConvertTo-Json -Compress)
  ) | Out-Null
  $emailStatus = "sent"
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
