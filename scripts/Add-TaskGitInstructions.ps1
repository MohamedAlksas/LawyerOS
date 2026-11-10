$ErrorActionPreference = 'Stop'
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$branches = [ordered]@{
    T01='feature/t01-toolchain-foundation'; T02='feature/t02-runtime-ci'; T03='feature/t03-identity-sessions'; T04='feature/t04-arabic-pwa-shell'
    T05='feature/t05-parties'; T06='feature/t06-matters-proceedings'; T07='feature/t07-search-archiving'; T08='feature/t08-hearing-results'
    T09='feature/t09-deadlines-tasks'; T10='feature/t10-reminders'; T11='feature/t11-private-uploads'; T12='feature/t12-document-versions'
    T13='feature/t13-fees-collections'; T14='feature/t14-expenses-advances'; T15a='feature/t15a-reversals'; T15b='feature/t15b-refunds-adjustments'
    T15c='feature/t15c-statements-opening-balances'; T16='feature/t16-print-export'; T17='feature/t17-csv-import'; T18='feature/t18-restricted-deployment'
    T19='feature/t19-backup-restore'; T20='feature/t20-lawyer-pilot'; T21='feature/t21-office-handover'
}
foreach ($taskId in $branches.Keys) {
    $taskPath = Join-Path $projectRoot ('docs/tasks/' + $taskId + '.md')
    $body = [System.IO.File]::ReadAllText($taskPath)
    if ($body.Contains('Git delivery contract (required):')) { continue }
    $contract = @"
Git delivery contract (required):
- Read docs/GIT_WORKFLOW.md. Canonical origin is https://github.com/MohamedAlksas/LawyerOS.git.
- Use the dedicated branch $($branches[$taskId]). Inspect current changes, origin, and latest origin/main before editing. Do not switch a dirty/shared checkout or stage another agent's work. Use an isolated worktree if another task is active.
- Start from updated origin/main only after the planning baseline and this task's required predecessor are accepted and merged. A stacked base requires an explicit Codex decision naming that base; do not choose one yourself.
- Commit each coherent task update and push it to this same task branch. The first push sets upstream; later updates use that branch's upstream. Inspect staged files and exclude work/, secrets, client data, and unrelated changes. Never force-push or push directly to main.
- Open one draft pull request from this branch to main when there is a reviewable checkpoint; update that PR for subsequent commits rather than creating a new branch for every save. Missing GitHub credentials/access is reported honestly, not treated as a successful push.
- The submission must include branch, base SHA, local HEAD SHA, verified remote pushed SHA, upstream, PR URL, and actual checks. Stop for Codex review. No main merge without the owner's current merge authorization.

"@
    $marker = '```text' + "`n"
    $normalized = $body.Replace("`r`n", "`n")
    if (-not $normalized.Contains($marker)) { throw ('Missing prompt fence: ' + $taskId) }
    $normalized = $normalized.Replace($marker, $marker + $contract.Replace("`r`n", "`n") + "`n")
    $normalized = $normalized.Replace('real base commit', 'actual base commit or recorded snapshot')
    [System.IO.File]::WriteAllText($taskPath, $normalized, [System.Text.UTF8Encoding]::new($false))
}
'Task-specific Git delivery contracts are current.'
