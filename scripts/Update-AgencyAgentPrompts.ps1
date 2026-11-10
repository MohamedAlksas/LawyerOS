$ErrorActionPreference = 'Stop'
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$routing = [System.IO.File]::ReadAllText((Join-Path $projectRoot 'docs/AGENCY_AGENT_ROUTING.json')) | ConvertFrom-Json -AsHashtable
foreach ($taskId in $routing.tasks.Keys) {
    $task = $routing.tasks[$taskId]
    $promptPath = Join-Path $projectRoot ('docs/tasks/' + $taskId + '.md')
    $body = [System.IO.File]::ReadAllText($promptPath).Replace("`r`n", "`n")
    $lines = [System.Collections.Generic.List[string]]::new()
    $lines.Add('Agency Agent assignment (required):')
    $lines.Add('- Read docs/AGENCY_AGENTS.md and the task entry in docs/AGENCY_AGENT_ROUTING.json before editing.')
    $lead = $routing.profiles[$task.lead]
    $lines.Add('- Lead implementer: use the ' + $task.lead + ' skill/profile. Read ' + $lead.source + ' and verify its YAML name is ' + $lead.metadataName + '.')
    foreach ($supportName in $task.support) {
        $support = $routing.profiles[$supportName]
        $lines.Add('- Supporting specialist: use the ' + $supportName + ' skill/profile for its scoped pass. Read ' + $support.source + ' and verify its YAML name is ' + $support.metadataName + '.')
    }
    $lines.Add('- Task focus: ' + $task.focus)
    $lines.Add('- Expand ~ to the current user home. A skill name is its frontmatter name, not its folder name. Read the installed files in full; do not infer activation from a directory listing. If a required profile is missing/unreadable or has the wrong name, stop dependent implementation and report the exact name/path. Do not install profiles or silently substitute one.')
    $lines.Add('- Keep the lead role for implementation. Apply supporting profiles as sequential scoped passes (or report actual supported delegation if explicitly authorized); do not claim separate agents were spawned just because profiles were read. Preserve the approved LawOffice stack, task scope, project skills, and Codex review ownership over generic persona suggestions.')
    $lines.Add('- Before submission, apply the named supporting profiles to the relevant changed behavior and record concrete findings/actions and tests. Record each role, actual metadata name, resolved SKILL.md path, content SHA-256, and how its guidance was applied. Loading a profile is not test evidence or Codex acceptance. Do not self-approve or merge main.')
    $lines.Add('End Agency Agent assignment.')
    $section = ($lines -join "`n") + "`n`n"
    $pattern = '(?ms)^Agency Agent assignment \(required\):\n.*?^End Agency Agent assignment\.\n*'
    $body = [regex]::Replace($body, $pattern, '')
    $marker = '```text' + "`n"
    $position = $body.IndexOf($marker, [StringComparison]::Ordinal)
    if ($position -lt 0) { throw ('Missing task prompt fence: ' + $taskId) }
    $body = $body.Insert($position + $marker.Length, $section)
    [System.IO.File]::WriteAllText($promptPath, $body, [System.Text.UTF8Encoding]::new($false))
}
'Agency Agent lead/support assignments are current for all routed tasks.'
