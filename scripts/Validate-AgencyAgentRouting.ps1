#requires -Version 7.0
param([switch]$VerifyInstalled)

$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$manifestPath = Join-Path $projectRoot 'docs/AGENCY_AGENT_ROUTING.json'
if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) { throw "Missing routing manifest: $manifestPath" }
$manifest = [IO.File]::ReadAllText($manifestPath) | ConvertFrom-Json -AsHashtable
$taskIds = @('T01','T02','T03','T04','T05','T06','T07','T08','T09','T10','T11','T12','T13','T14','T15a','T15b','T15c','T16','T17','T18','T19','T20','T21')
$errors = [Collections.Generic.List[string]]::new()
$profiles = $manifest.profiles
$tasks = $manifest.tasks
if ($manifest.schemaVersion -ne 1) { $errors.Add('Expected schemaVersion 1.') }
if ($profiles -isnot [Collections.IDictionary] -or $profiles.Count -eq 0) { throw 'Expected a nonempty profiles map.' }
if ($tasks -isnot [Collections.IDictionary]) { throw 'Expected a tasks map.' }
if ($tasks.Count -ne $taskIds.Count) { $errors.Add('Expected exactly 23 routed tasks.') }
foreach ($taskId in $tasks.Keys) { if ($taskId -notin $taskIds) { $errors.Add("Unexpected routed task: $taskId") } }
$installedProof = [Collections.Generic.List[object]]::new()
$validProfiles = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
foreach ($slug in ($profiles.Keys | Sort-Object)) {
    $profile = $profiles[$slug]
    if ($slug -notmatch '^agency-[a-z0-9]+(?:-[a-z0-9]+)*$') { $errors.Add("Invalid Agency Agent slug: $slug"); continue }
    if ($profile -isnot [Collections.IDictionary]) { $errors.Add("Invalid profile record: $slug"); continue }
    if ($profile.folder -notmatch '^[a-z0-9]+(?:-[a-z0-9]+)*$') { $errors.Add("Invalid installed folder for $slug"); continue }
    $expectedSource = '~/.gemini/config/skills/' + $profile.folder + '/SKILL.md'
    if ($profile.source -cne $expectedSource) { $errors.Add("Nonportable or mismatched source for $slug"); continue }
    if ($profile.metadataName -cne $slug) { $errors.Add("metadataName must equal profile slug: $slug"); continue }
    if ($profile.observedSha256 -notmatch '^[0-9a-fA-F]{64}$') { $errors.Add("Invalid observedSha256 for $slug") }
    if ([string]::IsNullOrWhiteSpace($profile.purpose)) { $errors.Add("Missing purpose for $slug") }
    [void]$validProfiles.Add($slug)
    if (-not $VerifyInstalled) { continue }
    $userProfileRoot = [Environment]::GetFolderPath([Environment+SpecialFolder]::UserProfile)
    $installedPath = Join-Path (Join-Path $userProfileRoot '.gemini/config/skills') ($profile.folder + '/SKILL.md')
    if (-not (Test-Path -LiteralPath $installedPath -PathType Leaf)) { $errors.Add("Required installed profile is missing: $installedPath"); continue }
    $body = [IO.File]::ReadAllText($installedPath)
    $frontmatter = [regex]::Match($body, '\A\uFEFF?---\r?\n(?<metadata>[\s\S]*?)\r?\n---(?:\r?\n|$)')
    $nameMatch = [regex]::Match($frontmatter.Groups['metadata'].Value, '(?m)^name:\s*(?<value>[^\r\n]+?)\s*$')
    if (-not $frontmatter.Success -or -not $nameMatch.Success) { $errors.Add("Missing frontmatter name: $installedPath"); continue }
    $metadataName = $nameMatch.Groups['value'].Value.Trim()
    if ($metadataName.StartsWith('"') -and $metadataName.EndsWith('"')) {
        try { $metadataName = $metadataName | ConvertFrom-Json } catch { $errors.Add("Invalid quoted frontmatter name: $installedPath"); continue }
    } elseif ($metadataName.StartsWith("'") -and $metadataName.EndsWith("'")) { $metadataName = $metadataName.Substring(1, $metadataName.Length - 2).Replace("''", "'") }
    if ($metadataName -cne $profile.metadataName) { $errors.Add("Installed frontmatter name mismatch: $installedPath"); continue }
    $actualSha = (Get-FileHash -LiteralPath $installedPath -Algorithm SHA256).Hash.ToLowerInvariant()
    $installedProof.Add([ordered]@{ slug=$slug; source=$profile.source; metadataName=$metadataName; observedSha256=$profile.observedSha256; actualSha256=$actualSha; hashChanged=($actualSha -ine $profile.observedSha256); result='PASS' })
}
$cardProof = [Collections.Generic.List[object]]::new()
foreach ($taskId in $taskIds) {
    if (-not $tasks.Contains($taskId)) { $errors.Add("Missing routing task: $taskId"); continue }
    $routing = $tasks[$taskId]
    if ($routing -isnot [Collections.IDictionary]) { $errors.Add("Invalid routing record: $taskId"); continue }
    if ($routing.support -isnot [array]) { $errors.Add("Support must be an array for $taskId") }
    $support = @($routing.support)
    $assigned = @($routing.lead) + $support
    if (-not $validProfiles.Contains([string]$routing.lead)) { $errors.Add("Unknown or invalid lead for $taskId") }
    if ($support.Count -gt 2) { $errors.Add("More than two support profiles for $taskId") }
    if (@($assigned | Sort-Object -Unique).Count -ne $assigned.Count) { $errors.Add("Repeated lead/support for $taskId") }
    foreach ($slug in $support) { if (-not $validProfiles.Contains([string]$slug)) { $errors.Add("Unknown or invalid support for ${taskId}: $slug") } }
    if ([string]::IsNullOrWhiteSpace($routing.focus)) { $errors.Add("Missing routing focus for $taskId") }
    $cardPath = Join-Path $projectRoot ('docs/tasks/' + $taskId + '.md')
    if (-not (Test-Path -LiteralPath $cardPath -PathType Leaf)) { $errors.Add("Missing task card: $taskId"); continue }
    $card = [IO.File]::ReadAllText($cardPath)
    $prompt = [regex]::Match($card, '(?ms)^```text\r?\n(?<body>.*?)^```\s*$')
    $sectionMatches = [regex]::Matches($prompt.Groups['body'].Value, '(?ms)^Agency Agent assignment \(required\):\r?\n(?<body>.*?)^End Agency Agent assignment\.\s*$')
    if (-not $prompt.Success -or $sectionMatches.Count -ne 1) { $errors.Add("Expected one delimited Agency Agent section inside the text prompt: $taskId"); continue }
    $section = $sectionMatches[0].Groups['body'].Value
    $declaredRoles = [regex]::Matches($section, '(?m)^- (?<role>Lead implementer|Supporting specialist): use the (?<slug>agency-[a-z0-9]+(?:-[a-z0-9]+)*) skill/profile[^\r\n]*? Read (?<source>~/.gemini/config/skills/[^\s]+/SKILL\.md) and verify its YAML name is (?<metadata>agency-[a-z0-9]+(?:-[a-z0-9]+)*)\.\s*$')
    $declaredLeadCount = @($declaredRoles | Where-Object { $_.Groups['role'].Value -ceq 'Lead implementer' }).Count
    if ($declaredRoles.Count -ne $assigned.Count -or $declaredLeadCount -ne 1) { $errors.Add("Incorrect declared lead/support count in $taskId") }
    $namedSlugs = @([regex]::Matches($section, '\bagency-[a-z0-9]+(?:-[a-z0-9]+)*\b') | ForEach-Object Value | Sort-Object -Unique)
    foreach ($slug in $assigned) {
        if ($slug -notin $namedSlugs) { $errors.Add("Missing assigned profile in ${taskId}: $slug") }
        if ($validProfiles.Contains([string]$slug) -and -not $section.Contains($profiles[$slug].source)) { $errors.Add("Missing matching profile source in ${taskId}: $slug") }
        $rolePrefix = if ($slug -ceq $routing.lead) { 'Lead implementer' } else { 'Supporting specialist' }
        $roleLines = @($declaredRoles | Where-Object { $_.Groups['role'].Value -ceq $rolePrefix -and $_.Groups['slug'].Value -ceq $slug })
        if ($roleLines.Count -ne 1 -or ($validProfiles.Contains([string]$slug) -and ($roleLines[0].Groups['source'].Value -cne $profiles[$slug].source -or $roleLines[0].Groups['metadata'].Value -cne $profiles[$slug].metadataName))) { $errors.Add("Role/profile/source pairing mismatch in ${taskId}: $slug") }
    }
    foreach ($slug in $namedSlugs) { if ($slug -notin $assigned) { $errors.Add("Unassigned or unidentified Agency Agent in ${taskId}: $slug") } }
    $sourcePaths = @([regex]::Matches($section, '~?[/\\]\.gemini[/\\]config[/\\]skills[/\\][^\s`"<>]+[/\\]SKILL\.md') | ForEach-Object Value | Sort-Object -Unique)
    $expectedSources = @($assigned | Where-Object { $validProfiles.Contains([string]$_) } | ForEach-Object { $profiles[$_].source })
    foreach ($source in $sourcePaths) { if ($source -cnotin $expectedSources) { $errors.Add("Unexpected installed-skill source in ${taskId}: $source") } }
    $cardProof.Add([ordered]@{ task=$taskId; lead=$routing.lead; support=$support; focus=$routing.focus; result='PASS' })
}
$actualCards = @(Get-ChildItem -LiteralPath (Join-Path $projectRoot 'docs/tasks') -Filter '*.md' -File | ForEach-Object BaseName)
if ($actualCards.Count -ne 23 -or @($actualCards | Where-Object { $_ -notin $taskIds }).Count) { $errors.Add('Expected exactly the 23 task cards, excluding a parent T15 card.') }
if ($errors.Count -gt 0) { throw ($errors -join [Environment]::NewLine) }
$report = [ordered]@{
    schemaVersion=1; result='PASS'; mode=$(if ($VerifyInstalled) { 'installed-profile-verification' } else { 'portable-manifest-and-cards' })
    scope='Agency Agent routing and optional installed-profile proof only; no application tests or runtime agent execution'
    taskCards=$cardProof.Count; profiles=$profiles.Count; checks=$cardProof.ToArray()
    installedProfiles=$(if ($VerifyInstalled) { $installedProof.ToArray() } else { @() })
    installedProfileChecks=$(if ($VerifyInstalled) { 'PASS: metadata names and actual hashes read; observed hash drift is informational' } else { 'NOT RUN: use -VerifyInstalled on the implementation machine' })
    antigravityRuntimeExecution='NOT RUN: profile routing does not prove automatic agent loading or spawning'
    projectSkills='Validated separately by Validate-AntigravityKit.ps1; Agency profiles do not replace the seven project skills'
}
$outputRoot = Join-Path $projectRoot 'outputs'
[IO.Directory]::CreateDirectory($outputRoot) | Out-Null
$reportName = if ($VerifyInstalled) { 'Agency-Agent-Installed-Validation.json' } else { 'Agency-Agent-Validation.json' }
[IO.File]::WriteAllText((Join-Path $outputRoot $reportName), ($report | ConvertTo-Json -Depth 8), [Text.UTF8Encoding]::new($false))
[pscustomobject]@{ Result='PASS'; Mode=$report.mode; TaskCards=$cardProof.Count; Profiles=$profiles.Count; Report=('outputs/' + $reportName) }
