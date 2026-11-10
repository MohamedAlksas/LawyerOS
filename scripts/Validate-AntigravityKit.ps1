$ErrorActionPreference = 'Stop'
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$taskIds = @('T01','T02','T03','T04','T05','T06','T07','T08','T09','T10','T11','T12','T13','T14','T15a','T15b','T15c','T16','T17','T18','T19','T20','T21')
$skillFiles = @(Get-ChildItem -LiteralPath (Join-Path $projectRoot '.agents/skills') -Filter SKILL.md -File -Recurse -Force)
if ($skillFiles.Count -ne 7) { throw 'Expected seven project skills.' }
$errors = [System.Collections.Generic.List[string]]::new()
foreach ($skill in $skillFiles) {
    $body = [System.IO.File]::ReadAllText($skill.FullName)
    $frontmatter = [regex]::Match($body, '\A---\r?\nname: ([a-z0-9-]+)\r?\ndescription: ([^\r\n]+)\r?\n---')
    if (-not $frontmatter.Success) { $errors.Add('Invalid frontmatter: ' + $skill.FullName); continue }
    if ($frontmatter.Groups[1].Value -ne $skill.Directory.Name) { $errors.Add('Skill name/folder mismatch: ' + $skill.FullName) }
    if ($body -match '\b(?:TODO|TBD)\b|C:/Users/|C:\\Users\\') { $errors.Add('Unfinished or host-specific skill: ' + $skill.FullName) }
    foreach ($link in [regex]::Matches($body, '\[[^\]]+\]\(([^)\s]+)\)')) {
        $target = Join-Path $skill.DirectoryName $link.Groups[1].Value
        if (-not (Test-Path -LiteralPath $target)) { $errors.Add('Missing skill reference: ' + $target) }
    }
}
$taskChecks = foreach ($taskId in $taskIds) {
    $body = [System.IO.File]::ReadAllText((Join-Path $projectRoot ('docs/tasks/' + $taskId + '.md')))
    if ([regex]::Matches($body, '(?m)^```').Count -ne 2 -or $body -notmatch '(?m)^```text\s*$') { $errors.Add('Expected one text prompt: ' + $taskId) }
    if ($body -match '\[(?:Txx|TXX|commit/snapshot|accepted task|paths necessary|one behavior)\]') { $errors.Add('Unfilled template: ' + $taskId) }
    $namedSkills = @([regex]::Matches($body, '\.agents/skills/([a-z0-9-]+)/SKILL\.md') | ForEach-Object { $_.Groups[1].Value } | Select-Object -Unique)
    if ($namedSkills -notcontains 'lawoffice-delivery') { $errors.Add('Missing delivery skill: ' + $taskId) }
    foreach ($namedSkill in $namedSkills) {
        if (-not (Test-Path -LiteralPath (Join-Path $projectRoot ('.agents/skills/' + $namedSkill + '/SKILL.md')))) { $errors.Add('Missing named skill for ' + $taskId + ': ' + $namedSkill) }
    }
    $position = [array]::IndexOf($taskIds, $taskId)
    $previous = if ($position -eq 0) { $null } else { $taskIds[$position - 1] }
    if ($previous -and -not $body.Contains('docs/reviews/' + $previous + '-review.md')) { $errors.Add('Wrong predecessor: ' + $taskId) }
    if ($previous -and -not $body.Contains('ACCEPTED')) { $errors.Add('Missing acceptance gate: ' + $taskId) }
    if (-not $body.Contains('docs/reviews/' + $taskId + '-submission.md')) { $errors.Add('Wrong submission path: ' + $taskId) }
    if (-not $body.Contains('https://github.com/MohamedAlksas/LawyerOS.git') -or -not $body.Contains('docs/GIT_WORKFLOW.md')) { $errors.Add('Missing canonical Git workflow: ' + $taskId) }
    $branchMatch = [regex]::Match($body, 'Use the dedicated branch (feature/[a-z0-9/-]+)\.')
    if (-not $branchMatch.Success) { $errors.Add('Missing exact feature branch: ' + $taskId) }
    if ($body -notmatch 'NOT RUN' -or $body -notmatch '(?i)stop') { $errors.Add('Missing evidence/stop condition: ' + $taskId) }
    [ordered]@{ task=$taskId; predecessor=$previous; branch=$branchMatch.Groups[1].Value; skills=$namedSkills; submission=('docs/reviews/' + $taskId + '-submission.md') }
}
if (@(Get-ChildItem -LiteralPath (Join-Path $projectRoot 'docs/tasks') -Filter '*.md' -File).Count -ne $taskIds.Count) { $errors.Add('Unexpected task-card count') }
if ($errors.Count -gt 0) { throw ($errors -join '; ') }
[System.IO.Directory]::CreateDirectory((Join-Path $projectRoot 'outputs')) | Out-Null
$report = [ordered]@{
    scope = 'Task instructions, skill metadata/references, prerequisite chain, submission gates; no app execution'
    result = 'PASS'
    taskCards = $taskIds.Count
    skills = $skillFiles.Count
    missingSkillFiles = 0
    invalidPredecessors = 0
    unfinishedTemplates = 0
    independentForwardTest = 'Read-only: T01 has no predecessor task but requires the integrated planning baseline; T14 stops without accepted T13; T18/T19 do not authorize unknown live targets'
    antigravityRuntimeDiscovery = 'NOT RUN: no Antigravity session operated'
    pythonSkillCreatorValidator = 'NOT RUN: WindowsApps Python launcher unavailable; frontmatter, names, references and scoped behavior checked independently'
    checks = $taskChecks
}
$json = $report | ConvertTo-Json -Depth 6
[System.IO.File]::WriteAllText((Join-Path $projectRoot 'outputs/Prompt-Skill-Validation.json'), $json, [System.Text.UTF8Encoding]::new($false))
[pscustomobject]@{ TaskCards=$taskIds.Count; ProjectSkills=$skillFiles.Count; Result='PASS'; Issues=$errors.Count }
