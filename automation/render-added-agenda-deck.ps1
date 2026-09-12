param([Parameter(Mandatory=$true)][string]$Directory)
$ErrorActionPreference = 'Stop'
$taskDir = (Resolve-Path -LiteralPath $Directory).Path
$pptxPath = Join-Path $taskDir '0912_분과별_추가주제_회의용.pptx'
$pdfPath = Join-Path $taskDir '0912_분과별_추가주제_회의용.pdf'
$renderPath = Join-Path $taskDir 'rendered'
New-Item -ItemType Directory -Path $renderPath -Force | Out-Null
$app = New-Object -ComObject PowerPoint.Application
$presentation = $null
$overflow = @()
$asciiDir = Join-Path $env:TEMP ('climate-deck-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $asciiDir | Out-Null
$asciiPptx = Join-Path $asciiDir 'deck.pptx'
$asciiPdf = Join-Path $asciiDir 'deck.pdf'
Copy-Item -LiteralPath $pptxPath -Destination $asciiPptx
try {
    $presentation = $app.Presentations.Open($asciiPptx, 0, 0, 0)
    foreach ($slide in $presentation.Slides) {
        foreach ($shape in $slide.Shapes) {
            if ($shape.HasTextFrame -eq -1 -and $shape.TextFrame2.HasText -eq -1) {
                $height = $shape.TextFrame2.TextRange.BoundHeight
                $width = $shape.TextFrame2.TextRange.BoundWidth
                if ($height -gt $shape.Height + 3 -or $width -gt $shape.Width + 3) {
                    $overflow += [pscustomobject]@{ slide=$slide.SlideIndex; shape=$shape.Name; boxHeight=$shape.Height; textHeight=$height; boxWidth=$shape.Width; textWidth=$width }
                }
            }
        }
    }
    $presentation.SaveAs($asciiPptx, 24, -1)
    $presentation.SaveAs($asciiPdf, 32)
    $asciiRender = Join-Path $asciiDir 'rendered'
    New-Item -ItemType Directory -Path $asciiRender | Out-Null
    $presentation.Export($asciiRender, 'PNG', 1600, 900)
    Get-ChildItem -LiteralPath $asciiRender -File | Copy-Item -Destination $renderPath
    Copy-Item -LiteralPath $asciiPptx -Destination $pptxPath
    Copy-Item -LiteralPath $asciiPdf -Destination $pdfPath
    [pscustomobject]@{ slides=$presentation.Slides.Count; overflow=@($overflow); pdf=$pdfPath; renderDirectory=$renderPath } | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $taskDir 'render-validation.json') -Encoding utf8
    Write-Output "Rendered $($presentation.Slides.Count) slides; overflow candidates: $($overflow.Count)"
} finally {
    if ($null -ne $presentation) { $presentation.Close() }
    # Never quit the application: other user presentations may be open.
    [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($app)
}
