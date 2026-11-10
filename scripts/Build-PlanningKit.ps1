$ErrorActionPreference = 'Stop'
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$outputRoot = Join-Path $projectRoot 'outputs'
[System.IO.Directory]::CreateDirectory($outputRoot) | Out-Null
$utf8 = [System.Text.UTF8Encoding]::new($false)
$documents = @(
    'README.md', 'PRODUCT.md', 'GLOSSARY.md', 'docs/PRD.md',
    'docs/SCREENS.md', 'DESIGN.md', 'docs/DATA_MODEL.md',
    'docs/WORKFLOWS.md', 'docs/ARCHITECTURE.md',
    'docs/SECURITY_OPERATIONS.md', 'docs/DATA_LIFECYCLE.md',
    'docs/MIGRATION.md', 'docs/ROADMAP.md', 'docs/REVIEW_PROTOCOL.md',
    'GEMINI.md', 'AGENTS.md', 'docs/PROMPTS.md',
    'docs/adr/0001-matter-and-proceeding.md',
    'docs/adr/0002-financial-subledger.md',
    'docs/PLAN_REVIEW.md', 'docs/START_HERE.md', 'docs/ANTIGRAVITY.md',
    'docs/GIT_WORKFLOW.md', '.github/PULL_REQUEST_TEMPLATE.md', 'docs/AGENCY_AGENTS.md'
)
$taskDocuments = @(Get-ChildItem -LiteralPath (Join-Path $projectRoot 'docs/tasks') -Filter '*.md' -File | Sort-Object Name | ForEach-Object { [System.IO.Path]::GetRelativePath($projectRoot, $_.FullName).Replace('\','/') })
$skillDocuments = @(Get-ChildItem -LiteralPath (Join-Path $projectRoot '.agents/skills') -Filter 'SKILL.md' -File -Recurse -Force | Sort-Object FullName | ForEach-Object { [System.IO.Path]::GetRelativePath($projectRoot, $_.FullName).Replace('\','/') })
$documents += $taskDocuments
$documents += $skillDocuments
$archiveFiles = $documents + @(
    '.gitignore', '.gitattributes', '.githooks/pre-push', '.github/workflows/planning-validation.yml',
    'scripts/Add-TaskGitInstructions.ps1', 'scripts/Build-TaskPromptIndex.ps1',
    'scripts/Validate-AntigravityKit.ps1', 'scripts/Build-PlanningKit.ps1',
    'scripts/Update-AgencyAgentPrompts.ps1', 'scripts/Validate-AgencyAgentRouting.ps1', 'docs/AGENCY_AGENT_ROUTING.json'
)
$broken = [System.Collections.Generic.List[string]]::new()
$linkCount = 0
$bundle = [System.Text.StringBuilder]::new()
[void]$bundle.AppendLine('# LawOffice OS — Complete Implementation and Review Plan')
[void]$bundle.AppendLine()
[void]$bundle.AppendLine('November 10, 2026 — Planning documentation only. Codex plans and reviews; Gemini implements incrementally. Local links point to canonical project references. The described targets and tests have not yet been executed. Documentation is in English; the intended application remains Arabic RTL.')
[void]$bundle.AppendLine()
foreach ($relativePath in $documents) {
    $sourcePath = Join-Path $projectRoot $relativePath
    if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) { throw "Missing source: $relativePath" }
    $body = [System.IO.File]::ReadAllText($sourcePath)
    if ([string]::IsNullOrWhiteSpace($body)) { throw "Empty source: $relativePath" }
    if ($body.Contains([char]0xFFFD)) { throw "Encoding error: $relativePath" }
    $fences = [regex]::Matches($body, '(?m)^```').Count
    if (($fences % 2) -ne 0) { throw "Unbalanced code fences: $relativePath" }
    $sourceDir = [System.IO.Path]::GetDirectoryName($sourcePath)
    foreach ($match in [regex]::Matches($body, '\[[^\]]+\]\(([^)\s]+)\)')) {
        $href = $match.Groups[1].Value
        if ($href -match '^(https?://|#|mailto:)') { continue }
        $plainPath = ($href -split '#', 2)[0]
        $targetPath = [System.IO.Path]::GetFullPath((Join-Path $sourceDir $plainPath))
        $linkCount++
        if (-not (Test-Path -LiteralPath $targetPath)) { $broken.Add("$relativePath -> $href") }
    }
    $rewritten = [regex]::Replace($body, '\[([^\]]+)\]\(([^)\s]+)\)', {
        param($match)
        $href = $match.Groups[2].Value
        if ($href -match '^(https?://|#|mailto:)') { return $match.Value }
        $parts = $href -split '#', 2
        $absoluteTarget = [System.IO.Path]::GetFullPath((Join-Path $sourceDir $parts[0]))
        $newHref = [System.IO.Path]::GetRelativePath($outputRoot, $absoluteTarget).Replace('\', '/')
        if ($parts.Count -gt 1) { $newHref += '#' + $parts[1] }
        return '[' + $match.Groups[1].Value + '](' + $newHref + ')'
    })
    [void]$bundle.AppendLine('---')
    [void]$bundle.AppendLine()
    [void]$bundle.AppendLine('Source: `' + $relativePath + '`')
    [void]$bundle.AppendLine()
    [void]$bundle.AppendLine($rewritten)
}
if ($broken.Count -gt 0) { throw ('Broken local links: ' + ($broken -join '; ')) }
$masterPath = Join-Path $outputRoot 'LawOffice-OS-Master-Plan.md'
[System.IO.File]::WriteAllText($masterPath, $bundle.ToString().TrimEnd([char[]]"`r`n") + "`n", $utf8)
$promptBundle = [System.Text.StringBuilder]::new()
$promptIndex = [System.IO.File]::ReadAllText((Join-Path $projectRoot 'docs/PROMPTS.md'))
$promptIndex = [regex]::Replace($promptIndex, '\[([^\]]+)\]\(([^)\s]+)\)', {
    param($match)
    $href = $match.Groups[2].Value
    if ($href -match '^(https?://|#|mailto:)') { return $match.Value }
    $absoluteTarget = [System.IO.Path]::GetFullPath((Join-Path (Join-Path $projectRoot 'docs') $href))
    $newHref = [System.IO.Path]::GetRelativePath($outputRoot, $absoluteTarget).Replace('\','/')
    return '[' + $match.Groups[1].Value + '](' + $newHref + ')'
})
[void]$promptBundle.AppendLine($promptIndex)
foreach ($taskDocument in $taskDocuments) {
    [void]$promptBundle.AppendLine()
    [void]$promptBundle.AppendLine('---')
    [void]$promptBundle.AppendLine()
    [void]$promptBundle.AppendLine([System.IO.File]::ReadAllText((Join-Path $projectRoot $taskDocument)))
}
[System.IO.File]::WriteAllText((Join-Path $outputRoot 'LawOffice-OS-Gemini-Prompts.md'), $promptBundle.ToString().TrimEnd([char[]]"`r`n") + "`n", $utf8)
[System.IO.File]::WriteAllText((Join-Path $outputRoot 'LawOffice-OS-Antigravity-T01.md'), [System.IO.File]::ReadAllText((Join-Path $projectRoot 'docs/tasks/T01.md')), $utf8)
[System.IO.File]::WriteAllText((Join-Path $outputRoot 'LawOffice-OS-Start-Here.md'), [System.IO.File]::ReadAllText((Join-Path $projectRoot 'docs/START_HERE.md')), $utf8)
Add-Type -AssemblyName System.IO.Compression
$zipPath = Join-Path $outputRoot 'LawOffice-OS-Planning-Kit.zip'
$zipFile = [System.IO.File]::Open($zipPath, [System.IO.FileMode]::Create)
$archive = [System.IO.Compression.ZipArchive]::new($zipFile, [System.IO.Compression.ZipArchiveMode]::Create, $false, $utf8)
try {
    foreach ($relativePath in $archiveFiles) {
        $entry = $archive.CreateEntry($relativePath.Replace('\', '/'))
        $entry.LastWriteTime = [System.DateTimeOffset]::Parse('2026-11-10T00:00:00+00:00')
        $destination = $entry.Open()
        try {
            $sourceBytes = [System.IO.File]::ReadAllBytes((Join-Path $projectRoot $relativePath))
            $destination.Write($sourceBytes, 0, $sourceBytes.Length)
        } finally { $destination.Dispose() }
    }
} finally { $archive.Dispose(); $zipFile.Dispose() }
$checkZip = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
try {
    if ($checkZip.Entries.Count -ne $archiveFiles.Count) { throw 'ZIP entry mismatch' }
    foreach ($entry in $checkZip.Entries) {
        $stream = $entry.Open()
        $copy = [System.IO.MemoryStream]::new()
        try {
            $stream.CopyTo($copy)
            $original = [System.IO.File]::ReadAllBytes((Join-Path $projectRoot $entry.FullName))
            $sha = [System.Security.Cryptography.SHA256]::Create()
            try {
                $one = [Convert]::ToHexString($sha.ComputeHash($original))
                $two = [Convert]::ToHexString($sha.ComputeHash($copy.ToArray()))
                if ($one -ne $two) { throw ('ZIP hash mismatch: ' + $entry.FullName) }
            } finally { $sha.Dispose() }
        } finally { $stream.Dispose(); $copy.Dispose() }
    }
} finally { $checkZip.Dispose() }
$report = [ordered]@{
    scope = 'Planning documents only; no application tests executed'
    documentationLanguage = 'English'
    applicationLocale = 'Arabic RTL / ar-EG / Africa/Cairo'
    sourceDocuments = $documents.Count
    taskCards = $taskDocuments.Count
    projectSkills = $skillDocuments.Count
    agencyProfiles = ([System.IO.File]::ReadAllText((Join-Path $projectRoot 'docs/AGENCY_AGENT_ROUTING.json')) | ConvertFrom-Json -AsHashtable).profiles.Count
    localLinksChecked = $linkCount
    brokenLinks = $broken.Count
    codeFences = 'Balanced'
    encoding = 'UTF-8 checked'
    zipEntries = $archiveFiles.Count
    zipSourceHashes = 'All match'
    outputs = @(Get-ChildItem -LiteralPath $outputRoot -File | Where-Object { $_.Name -notin @('Planning-Validation.json','Translation-Validation.json') } | Select-Object Name, Length)
}
$reportJson = $report | ConvertTo-Json -Depth 4
[System.IO.File]::WriteAllText((Join-Path $outputRoot 'Planning-Validation.json'), $reportJson, $utf8)
$reportJson
