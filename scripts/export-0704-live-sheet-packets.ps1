param(
  [string]$SpreadsheetId = "1aA0h2wUuKydj-RC7ZeD-bI-9C-7f1MQhe_78t7pA4JQ",
  [string]$QuestionOutputHtml = "public/0704-admin/live-sheet-questions-print.html",
  [string]$QuestionOutputPdf = "public/0704-admin/live-sheet-questions-print.pdf",
  [string]$AgendaOutputHtml = "public/0704-admin/live-sheet-agendas-print.html",
  [string]$AgendaOutputPdf = "public/0704-admin/live-sheet-agendas-print.pdf",
  [string]$AgendaBoardData = "public/agenda-board-0704/data.json",
  [string]$OutputReport = "evaluation/0704-live-sheet-packets-report.json",
  [string]$EmailTo = "kesica3@gmail.com",
  [string]$EmailFrom = "iceamericano9@gmail.com",
  [switch]$SendEmail,
  [switch]$UseSample,
  [switch]$Watch,
  [int]$IntervalSeconds = 30
)

$ErrorActionPreference = "Stop"

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent $scriptRoot

if ($Watch) {
  if ($SendEmail) {
    throw "-Watch and -SendEmail cannot be used together because it would send email every interval."
  }
  if ($IntervalSeconds -lt 5) {
    throw "-IntervalSeconds must be 5 or greater."
  }
  $watchArgs = @(
    "-NoProfile", "-ExecutionPolicy", "Bypass",
    "-File", $MyInvocation.MyCommand.Path,
    "-SpreadsheetId", $SpreadsheetId,
    "-QuestionOutputHtml", $QuestionOutputHtml,
    "-QuestionOutputPdf", $QuestionOutputPdf,
    "-AgendaOutputHtml", $AgendaOutputHtml,
    "-AgendaOutputPdf", $AgendaOutputPdf,
    "-AgendaBoardData", $AgendaBoardData,
    "-OutputReport", $OutputReport,
    "-EmailTo", $EmailTo,
    "-EmailFrom", $EmailFrom
  )
  if ($UseSample) {
    $watchArgs += "-UseSample"
  }
  Write-Host "Watching live Sheet packets every $IntervalSeconds seconds. Press Ctrl+C to stop."
  while ($true) {
    $startedAt = Get-Date
    try {
      Write-Host "[$($startedAt.ToString("HH:mm:ss"))] Refreshing live Sheet packets..."
      pwsh @watchArgs
      if ($LASTEXITCODE -ne 0) {
        Write-Error "Refresh failed with exit code $LASTEXITCODE"
      }
    } catch {
      Write-Error $_
    }
    Start-Sleep -Seconds $IntervalSeconds
  }
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

function Escape-Html {
  param([string]$Text)
  return [System.Net.WebUtility]::HtmlEncode($Text)
}

function Normalize-Text {
  param([string]$Text)
  return ($Text -replace "\s+", " ").Trim()
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

function Read-LiveSheetItems {
  param(
    [string[]]$Ranges,
    [string]$TextKind
  )
  $items = @()
  foreach ($range in $Ranges) {
    $rows = Read-SheetRange -Range $range
    foreach ($row in @($rows | Select-Object -Skip 1)) {
      if (-not $row) {
        continue
      }
      $number = if ($row.Count -gt 0) { [string]$row[0] } else { "" }
      $group = if ($row.Count -gt 1) { [string]$row[1] } else { "" }
      $text = if ($row.Count -gt 2) { Normalize-Text -Text ([string]$row[2]) } else { "" }
      $note = if ($row.Count -gt 3) { Normalize-Text -Text ([string]$row[3]) } else { "" }
      $speaker = if ($row.Count -gt 4) { Normalize-Text -Text ([string]$row[4]) } else { "" }
      if ([string]::IsNullOrWhiteSpace($text)) {
        continue
      }
      $items += [pscustomobject]@{
        number = $number
        group = if ([string]::IsNullOrWhiteSpace($group)) { $range.Split(" ")[0] } else { $group }
        text = $text
        note = $note
        speaker = $speaker
        writer = $speaker
        kind = $TextKind
      }
    }
  }
  return @($items)
}

function Build-PrintHtml {
  param(
    [string]$Title,
    [string]$Subtitle,
    [array]$Items,
    [string]$EmptyText
  )
  $generatedAt = (Get-Date).ToString("yyyy-MM-dd HH:mm")
  $livePollingScript = ""
  if ($Title -eq "0704 전문가 질의") {
    $livePollingScript = @'
<script>
const SHEET_ID = '1aA0h2wUuKydj-RC7ZeD-bI-9C-7f1MQhe_78t7pA4JQ';
const SHEETS = ['A조 질문입력', 'B조 질문입력'];
const POLL_MS = 5000;
function esc(s){return String(s ?? '').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));}
function parseCsv(text){
  const rows=[]; let row=[]; let cell=''; let quoted=false;
  for(let i=0;i<text.length;i++){
    const ch=text[i], next=text[i+1];
    if(ch === '"' && quoted && next === '"'){ cell+='"'; i++; continue; }
    if(ch === '"'){ quoted=!quoted; continue; }
    if(ch === ',' && !quoted){ row.push(cell); cell=''; continue; }
    if((ch === '\n' || ch === '\r') && !quoted){
      if(ch === '\r' && next === '\n') i++;
      row.push(cell); if(row.some(v=>v!=='')) rows.push(row); row=[]; cell=''; continue;
    }
    cell+=ch;
  }
  row.push(cell); if(row.some(v=>v!=='')) rows.push(row);
  return rows;
}
async function fetchSheetRows(sheetName){
  const url = 'https://docs.google.com/spreadsheets/d/' + SHEET_ID + '/gviz/tq?tqx=out:csv&sheet=' + encodeURIComponent(sheetName) + '&_=' + Date.now();
  const csv = await fetch(url, {cache:'no-store'}).then(r => {
    if(!r.ok) throw new Error(sheetName + ' HTTP ' + r.status);
    return r.text();
  });
  const rows = parseCsv(csv);
  const header = rows.shift() || [];
  const idx = name => header.indexOf(name);
  const speakerIdx = idx('발언자') >= 0 ? idx('발언자') : idx('입력자');
  const numberIdx = idx('번호'), groupIdx = idx('조'), textIdx = idx('질문'), noteIdx = idx('비고');
  return rows.map(row => ({
    number: row[numberIdx] || '',
    group: row[groupIdx] || sheetName.slice(0, 2),
    text: row[textIdx] || '',
    note: row[noteIdx] || '',
    speaker: row[speakerIdx] || ''
  })).filter(item => item.text.trim());
}
function renderRows(items){
  if(!items.length){
    return '<tr><td colspan="5" class="empty">아직 입력된 전문가 질의가 없습니다.</td></tr>';
  }
  return items.map(item => '<tr>' +
    '<td class="group">' + esc(item.group) + '</td>' +
    '<td class="num">' + esc(item.number) + '</td>' +
    '<td class="text">' + esc(item.text) + '</td>' +
    '<td class="note">' + esc(item.note) + '</td>' +
    '<td class="speaker">' + esc(item.speaker) + '</td>' +
  '</tr>').join('');
}
async function refreshLiveQuestions(){
  const items = (await Promise.all(SHEETS.map(fetchSheetRows))).flat();
  document.getElementById('rows').innerHTML = renderRows(items);
  document.getElementById('count').textContent = '건수: ' + items.length;
  document.getElementById('generated').textContent = 'Sheet 확인: ' + new Date().toLocaleString('ko-KR');
}
refreshLiveQuestions().catch(err => {
  document.getElementById('generated').textContent = 'Sheet 확인 실패: ' + err.message;
});
setInterval(refreshLiveQuestions, POLL_MS);
</script>
'@
  }
  $rows = ""
  if ($Items.Count -eq 0) {
    $rows = "<tr><td colspan=""5"" class=""empty"">$(Escape-Html -Text $EmptyText)</td></tr>"
  } else {
    foreach ($item in $Items) {
      $speaker = if ($item.PSObject.Properties.Name -contains "speaker") { $item.speaker } else { $item.writer }
      $rows += @"
<tr>
  <td class="group">$(Escape-Html -Text $item.group)</td>
  <td class="num">$(Escape-Html -Text $item.number)</td>
  <td class="text">$(Escape-Html -Text $item.text)</td>
  <td class="note">$(Escape-Html -Text $item.note)</td>
  <td class="speaker">$(Escape-Html -Text $speaker)</td>
</tr>
"@
    }
  }
  return @"
<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<title>$(Escape-Html -Text $Title)</title>
<style>
  @page{size:A4;margin:15mm}
  *{box-sizing:border-box}
  body{margin:0;color:#111827;font-family:"Noto Sans KR",Arial,sans-serif}
  .toolbar{position:sticky;top:0;display:flex;gap:8px;justify-content:flex-end;padding:10px 0;background:#fff}
  .toolbar a,.toolbar button{border:0;border-radius:8px;background:#111827;color:#fff;padding:8px 12px;font-weight:800;text-decoration:none}
  @media print{.toolbar{display:none}}
  h1{margin:0 0 6px;font-size:26px;letter-spacing:0}
  .meta{display:flex;gap:12px;margin-bottom:16px;color:#475569;font-weight:800}
  .subtitle{margin:0 0 12px;color:#334155;font-size:13px;font-weight:800}
  table{width:100%;border-collapse:collapse;table-layout:fixed}
  th{padding:9px 8px;border-top:2px solid #111827;border-bottom:1px solid #cbd5e1;background:#f8fafc;text-align:left;font-size:12px}
  td{padding:10px 8px;border-bottom:1px solid #e2e8f0;vertical-align:top;font-size:12px;line-height:1.55}
  .group{width:58px;font-weight:900;color:#0f766e}
  .num{width:42px;color:#64748b}
  .text{font-size:14px;font-weight:800}
  .note{width:120px;color:#475569}
  .speaker{width:105px;color:#0f172a;font-weight:900}
  .empty{padding:32px;text-align:center;color:#64748b;font-weight:900;background:#f8fafc}
</style>
</head>
<body>
  <div class="toolbar">
    <button onclick="window.print()">인쇄</button>
    <a href="/0704-admin/">관리자</a>
  </div>
  <h1>$(Escape-Html -Text $Title)</h1>
  <p class="subtitle">$(Escape-Html -Text $Subtitle)</p>
  <div class="meta"><span id="generated">생성: $generatedAt</span><span id="count">건수: $($Items.Count)</span></div>
  <table>
    <thead><tr><th class="group">조</th><th class="num">번호</th><th>내용</th><th class="note">비고</th><th class="speaker">발언자</th></tr></thead>
    <tbody id="rows">$rows</tbody>
  </table>
$livePollingScript
</body>
</html>
"@
}

Push-Location $repoRoot
try {
  if ($UseSample) {
    $questions = @(
      [pscustomobject]@{ number = "1"; group = "A조"; text = "산업 부문 탄소 감축 목표를 시민에게 설명할 때 가장 설득력 있는 근거는 무엇인가요?"; note = "전문가 질의"; speaker = "A조 시민"; writer = "A조 시민"; kind = "question" },
      [pscustomobject]@{ number = "2"; group = "A조"; text = "재생에너지 확대 과정에서 지역 주민 수용성을 높인 국내외 사례가 있을까요?"; note = "사례 요청"; speaker = "A조 시민"; writer = "A조 시민"; kind = "question" },
      [pscustomobject]@{ number = "1"; group = "B조"; text = "탄소 감축 정책이 취약계층 부담으로 이어지지 않게 설계하는 기준은 무엇인가요?"; note = "형평성"; speaker = "B조 시민"; writer = "B조 시민"; kind = "question" }
    )
    $agendas = @(
      [pscustomobject]@{ number = "1"; group = "A조"; text = "공공건물과 학교의 에너지 절감 실적을 공개하고 시민 참여형 절감 캠페인과 연계한다."; note = "투표 후보"; speaker = "A조 시민"; writer = "A조 시민"; kind = "agenda" },
      [pscustomobject]@{ number = "2"; group = "A조"; text = "생활권 교통 감축 행동에 참여한 시민에게 대중교통·공공시설 통합 인센티브를 제공한다."; note = "투표 후보"; speaker = "A조 시민"; writer = "A조 시민"; kind = "agenda" },
      [pscustomobject]@{ number = "1"; group = "B조"; text = "기업 탄소배출 정보와 감축 계획을 시민이 쉽게 확인하고 의견을 낼 수 있는 공개 플랫폼을 만든다."; note = "투표 후보"; speaker = "B조 시민"; writer = "B조 시민"; kind = "agenda" }
    )
  } else {
    $questions = Read-LiveSheetItems -Ranges @("'A조 질문입력'!A1:E80", "'B조 질문입력'!A1:E80") -TextKind "question"
    $agendas = Read-LiveSheetItems -Ranges @("'A조 의제입력'!A1:E80", "'B조 의제입력'!A1:E80") -TextKind "agenda"
  }

  $questionHtml = Build-PrintHtml `
    -Title "0704 전문가 질의" `
    -Subtitle "A/B조 기록모더레이터가 실시간 Sheet에 입력한 질문만 모은 인쇄본입니다." `
    -Items $questions `
    -EmptyText "아직 입력된 전문가 질의가 없습니다."
  $agendaHtml = Build-PrintHtml `
    -Title "0704 조별 의제 후보" `
    -Subtitle "A/B조 기록모더레이터가 실시간 Sheet에 입력한 의제 후보만 모은 인쇄본입니다." `
    -Items $agendas `
    -EmptyText "아직 입력된 의제 후보가 없습니다."

  $questionHtml | Set-Content -LiteralPath $QuestionOutputHtml -Encoding UTF8
  $agendaHtml | Set-Content -LiteralPath $AgendaOutputHtml -Encoding UTF8
  $agendaBoardDir = Split-Path -Parent $AgendaBoardData
  if (-not (Test-Path -LiteralPath $agendaBoardDir)) {
    New-Item -ItemType Directory -Path $agendaBoardDir -Force | Out-Null
  }
  $agendaBoardPayload = [pscustomobject]@{
    generatedAt = (Get-Date).ToString("o")
    spreadsheetId = $SpreadsheetId
    spreadsheetUrl = "https://docs.google.com/spreadsheets/d/$SpreadsheetId/edit"
    questionCount = $questions.Count
    agendaCount = $agendas.Count
    questions = @($questions)
    agendas = @($agendas)
  }
  $agendaBoardPayload | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $AgendaBoardData -Encoding UTF8
  $resolvedQuestionPdf = Export-HtmlToPdf -HtmlPath $QuestionOutputHtml -PdfPath $QuestionOutputPdf
  $resolvedAgendaPdf = Export-HtmlToPdf -HtmlPath $AgendaOutputHtml -PdfPath $AgendaOutputPdf

  $emailStatus = "dry_run"
  if ($SendEmail) {
    Send-GmailWithPdfAttachment `
      -From $EmailFrom `
      -To $EmailTo `
      -Subject "0704 전문가 질의 인쇄본" `
      -Body "A/B조 실시간 Sheet 입력 기준 전문가 질의 인쇄본입니다.`n`nSheet: https://docs.google.com/spreadsheets/d/$SpreadsheetId/edit" `
      -PdfPath $resolvedQuestionPdf `
      -AttachmentName "0704-expert-questions.pdf"
    Send-GmailWithPdfAttachment `
      -From $EmailFrom `
      -To $EmailTo `
      -Subject "0704 조별 의제 후보 인쇄본" `
      -Body "A/B조 실시간 Sheet 입력 기준 조별 의제 후보 인쇄본입니다.`n`nSheet: https://docs.google.com/spreadsheets/d/$SpreadsheetId/edit" `
      -PdfPath $resolvedAgendaPdf `
      -AttachmentName "0704-group-agendas.pdf"
    $emailStatus = "sent_with_pdf"
  }

  $report = [pscustomobject]@{
    generatedAt = (Get-Date).ToString("o")
    mode = if ($UseSample) { "sample" } else { "live_sheet" }
    spreadsheetId = $SpreadsheetId
    spreadsheetUrl = "https://docs.google.com/spreadsheets/d/$SpreadsheetId/edit"
    questionCount = $questions.Count
    agendaCount = $agendas.Count
    questionOutputHtml = $QuestionOutputHtml
    questionOutputPdf = $QuestionOutputPdf
    agendaOutputHtml = $AgendaOutputHtml
    agendaOutputPdf = $AgendaOutputPdf
    agendaBoardData = $AgendaBoardData
    emailTo = $EmailTo
    emailStatus = $emailStatus
  }
  $report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $OutputReport -Encoding UTF8
  $report | ConvertTo-Json -Depth 8
}
finally {
  Pop-Location
}
