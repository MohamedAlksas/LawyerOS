$ErrorActionPreference = 'Stop'
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$routing = [System.IO.File]::ReadAllText((Join-Path $projectRoot 'docs/AGENCY_AGENT_ROUTING.json')) | ConvertFrom-Json -AsHashtable
$agentRoot = Join-Path $projectRoot $routing.executionPolicy.agentRoot
[IO.Directory]::CreateDirectory($agentRoot) | Out-Null
foreach ($slug in ($routing.profiles.Keys | Sort-Object)) {
    $profile = $routing.profiles[$slug]
    $description = ('LawOffice OS delegated specialist. ' + $profile.purpose) | ConvertTo-Json -Compress
    $definition = @"
---
name: $slug
description: $description
tools:
  - view_file
  - grep_search
  - run_command
  - replace_file_content
mainAgent: false
subagent: true
model: inherit
commandExecutionPolicy: sandbox
---

# LawOffice OS delegated specialist

This is a native Antigravity subagent definition, not a copy of the installed Agency skill. The parent must actually invoke this definition in a distinct conversation. Loading this file or a profile in the parent is not execution evidence.

Read docs/AGENCY_AGENTS.md, GEMINI.md, the assigned task card, its project skills, and only the references needed for your assigned slice. Read the complete project-local profile at $($profile.source), resolve it from the workspace root, verify YAML name $($profile.metadataName), and report its actual SHA-256 and inventory drift. Missing/unreadable/misnamed profiles stop dependent work; do not silently substitute. Project rules and task scope take precedence over generic profile advice.

Task-specific specialty: $($profile.purpose)

Follow the parent's explicit assignment: task ID, lead/support role, base/reviewed SHA, owned paths, workspace, allowed actions, required checks, and expected result. Without these, request a bounded assignment before editing. As a lead, edit only owned application paths and reconcile support findings. As a support, inspect the pinned snapshot and run relevant checks without changing application source. Use isolated build/test workspaces when commands could conflict. The parent coordinates commits/publication; do not switch its branch, stage unrelated work, push, merge, or revert other contributors' changes. Do not spawn nested agents.

Return your native conversation ID or observable UI reference, actual role, profile path/name/hash, inspected SHA, owned/examined files, findings with locations and impact, changes if authorized, commands with real exit statuses, artifacts, and NOT RUN limits. Report results to the parent for reconciliation. Never mark the task ACCEPTED, release its successor, claim Codex approval, or use real client data/secrets.
"@
    [IO.File]::WriteAllText((Join-Path $agentRoot ($slug + '.md')), $definition.TrimEnd() + "`n", [Text.UTF8Encoding]::new($false))
}
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
    $lines.Add('- Native execution is required: use invoke_subagent to launch the lead and each assigned support as distinct real sessions using .agents/agents/<profile-name>.md. Read docs/AGENCY_AGENTS.md for the preflight, ownership, snapshot, and evidence contract. Reading profiles or performing same-session role passes does not satisfy this assignment.')
    $lines.Add('- Run the canonical-name or registered-native-alias preflight in docs/AGENCY_AGENTS.md before dependent implementation. If a canonical TypeName is rejected but define_subagent is available, register its canonical instructions under the documented lawoffice-native- alias and actually invoke that alias; record the profile/definition/type/ID mapping. This is native registration, not a persona fallback. If the bounded native preflight fails, report BLOCKED_NATIVE_AGENTS and stop dependent implementation. Do not continue directly, install/upgrade tools, change the model, or invent an agent ID.')
    $lines.Add('- Task focus: ' + $task.focus)
    $lines.Add('- Resolve profile and definition paths from the current workspace root. A skill name is its frontmatter name, not its folder name. Read the project-local files in full; do not infer activation from a directory listing. If a required profile is missing/unreadable or has the wrong name, stop dependent implementation and report the exact name/path. Do not delete extra installed profiles, install replacements, or silently substitute one.')
    $lines.Add('- The parent coordinates the task; the delegated lead implements owned paths. Give each child the task ID, role, required references/skills, owned paths, snapshot SHA, allowed actions, and checks. Freeze a committed checkpoint before support review; supports inspect that snapshot in separate contexts and use separate worktrees when commands could conflict. Reconcile findings through the lead and rerun affected checks. Parallelize independent work only; do not write the same files concurrently or spawn nested agents. Preserve the approved LawOffice stack, task scope, project skills, and Codex review ownership.')
    $lines.Add('- Before submission, record actual native invocation/conversation IDs for all assigned roles, definition paths, profile metadata/path/SHA-256, ownership, inspected SHA, concrete findings/actions, lead reconciliation, and test results. Mark missing runtime evidence NOT RUN; a portable validator or a profile-load list does not prove execution. Do not self-approve or merge main.')
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
'Native Agency Agent definitions and task assignments are current for all routed tasks.'
