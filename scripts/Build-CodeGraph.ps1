param(
    [string]$SourceRepository = (Join-Path $PSScriptRoot '..'),
    [string]$SourceRef = 'HEAD',
    [string]$GraphifyExecutable = ''
)
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$sourceRoot = [IO.Path]::GetFullPath($SourceRepository)

# Analyze committed source only; never copy working files, credentials, or client storage.
$sourceSha = & git -C $sourceRoot rev-parse --verify "$SourceRef^{commit}"
if ($LASTEXITCODE -ne 0) { throw 'SourceRef must resolve to an existing commit.' }
$sourceSha = "$sourceSha".Trim()
$files = @(& git -C $sourceRoot ls-tree -r --name-only $sourceSha -- src tests)
if ($LASTEXITCODE -ne 0) { throw 'Cannot enumerate committed source.' }
$files = @($files | Where-Object { $_ -match '\.(?:ts|tsx|js|jsx|mjs|cjs)$' -and $_ -notmatch '(?:^|/)(?:node_modules|fixtures|uploads|storage|backups)(?:/|$)' })
if ($files.Count -eq 0) { throw 'No supported committed source files found under src/ or tests/.' }
foreach ($config in @('package.json', 'tsconfig.json')) {
    & git -C $sourceRoot cat-file -e "${sourceSha}:$config" 2>$null
    if ($LASTEXITCODE -eq 0) { $files += $config }
}
if (-not $GraphifyExecutable) {
    $command = Get-Command graphify -ErrorAction SilentlyContinue
    if ($command) { $GraphifyExecutable = $command.Source }
    else { $GraphifyExecutable = Join-Path $env:USERPROFILE '.local/bin/graphify.exe' }
}
if (-not (Test-Path -LiteralPath $GraphifyExecutable -PathType Leaf)) {
    throw 'Graphify CLI not found. Follow docs/GRAPHIFY.md to install the pinned release.'
}

# Unique directories keep previous graphs and other agents' files intact.
$runRoot = Join-Path $projectRoot ('work/graphify/' + $sourceSha.Substring(0,12) + '-' + [guid]::NewGuid().ToString('N').Substring(0,8))
$corpus = Join-Path $runRoot 'corpus'
[IO.Directory]::CreateDirectory($corpus) | Out-Null
$archive = Join-Path $runRoot 'source.zip'
& git -C $sourceRoot archive --format=zip "--output=$archive" $sourceSha -- @files
if ($LASTEXITCODE -ne 0) { throw 'Cannot archive the selected committed files.' }
Expand-Archive -LiteralPath $archive -DestinationPath $corpus
$manifest = [ordered]@{
    sourceCommit = $sourceSha
    requestedRef = $SourceRef
    generatedAtUtc = [DateTime]::UtcNow.ToString('o')
    mode = 'local-code-only-no-label'
    includesUncommittedChanges = $false
    files = $files
}
$manifest | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $runRoot 'SOURCE.json') -Encoding utf8
& $GraphifyExecutable extract $corpus --code-only --max-workers 1 --out $runRoot
if ($LASTEXITCODE -ne 0) { throw 'Graphify extraction failed; do not treat this run as complete.' }
# An archive nested in this worktree otherwise inherits the enclosing repo's
# HEAD stamp. Record the actual archived source commit before report generation.
$graphPath = Join-Path $runRoot 'graphify-out/graph.json'
$graph = Get-Content -LiteralPath $graphPath -Raw | ConvertFrom-Json
if ($graph.graph.graphify_version -ne '0.9.106') { throw 'This helper was verified with Graphify 0.9.106; inspect compatibility before using another version.' }
$graph | Add-Member -NotePropertyName built_at_commit -NotePropertyValue $sourceSha -Force
[IO.File]::WriteAllText($graphPath, ($graph | ConvertTo-Json -Depth 100), [Text.UTF8Encoding]::new($false))
& $GraphifyExecutable cluster-only $runRoot --no-label
if ($LASTEXITCODE -ne 0) { throw 'Graphify report/visualization failed; do not treat this run as complete.' }
Write-Host "Committed source: $sourceSha (working changes excluded)"
Write-Host "Manifest: $(Join-Path $runRoot 'SOURCE.json')"
Write-Host "Graph: $(Join-Path $runRoot 'graphify-out/graph.json')"
Write-Host "HTML: $(Join-Path $runRoot 'graphify-out/graph.html')"
