$ErrorActionPreference = 'Stop'
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$taskIds = @('T01','T02','T03','T04','T05','T06','T07','T08','T09','T10','T11','T12','T13','T14','T15a','T15b','T15c','T16','T17','T18','T19','T20','T21')
$lines = [System.Collections.Generic.List[string]]::new()
$intro = @'
# Antigravity implementation prompts — one task at a time

Each linked card contains one complete, copyable prompt. Give Antigravity only the currently assigned card. Codex plans and reviews; the selected Gemini model implements. English documentation and Arabic RTL application requirements remain unchanged.

## Start now

Open `D:\Lawyer` in Antigravity and copy the full prompt in [T01](tasks/T01.md). It explicitly loads `lawoffice-delivery` and `lawoffice-foundation` from their actual `.agents/skills/` files. T01 is the only task without a predecessor acceptance requirement. The generated output `LawOffice-OS-Antigravity-T01.md` contains the same prompt.

## Task and skill map

Every task loads `lawoffice-delivery`. Additional skills are listed below; every card includes their exact paths. See [Antigravity setup](ANTIGRAVITY.md) for the bundled skills. Do not load all skills or execute all cards together. Each predecessor refers to an actual `docs/reviews/<ID>-review.md` decision stating `ACCEPTED`, with delivered files inspected. A submission is not acceptance.

| Task | Exact card | Required predecessor | Additional required skills |
|---|---|---|---|
'@
$lines.Add($intro)
$previous = 'None — first task'
foreach ($taskId in $taskIds) {
    $relative = 'docs/tasks/' + $taskId + '.md'
    $body = [System.IO.File]::ReadAllText((Join-Path $projectRoot $relative))
    $skillNames = @([regex]::Matches($body, '\.agents/skills/([a-z0-9-]+)/SKILL\.md') | ForEach-Object { $_.Groups[1].Value } | Select-Object -Unique | Where-Object { $_ -ne 'lawoffice-delivery' })
    $skills = ($skillNames | ForEach-Object { '`' + $_ + '`' }) -join ', '
    $lines.Add('| ' + $taskId + ' | [' + $taskId + '](tasks/' + $taskId + '.md) | ' + $previous + ' | ' + $skills + ' |')
    $previous = $taskId
}
$outro = @'

## What every prompt specifies

- One exact task ID and accepted-predecessor gate.
- Required skill names and actual `SKILL.md` paths to read before editing.
- Relevant plan files/sections, owned code paths, and exclusions.
- Concrete implementation steps, domain invariants, positive and negative checks.
- Exact submission report path, actual command exit statuses, and `NOT RUN` limitations.
- A stop for Codex review, without implementing missing predecessors or the next task.

These cards are specific to the planned architecture. Ordinary file-layout details must be reconciled with the accepted checkout, not an imagined scaffold. If Codex accepts a documented design change, it updates the affected card before dispatch. Do not weaken the plan to fit an incomplete implementation.

## Submission and review

The implementer uses the exact `docs/reviews/Txx-submission.md` path named by its card and the format in [REVIEW_PROTOCOL](REVIEW_PROTOCOL.md), including loaded skill paths. Codex reviews actual changes and evidence and writes the matching `*-review.md`. On `CHANGES_REQUESTED`, the implementer fixes that same task's findings, reruns affected checks, updates its submission, and stops again. Do not fill in a review decision on Codex's behalf.

Future production/pilot cards do not authorize unknown destinations, credentials, service purchases, or guessed data. Missing actual prerequisites are reported honestly; prepare independent authorized work and mark unexecuted checks `NOT RUN`.

## Corrections to staged dependencies

T05 introduces the shared audit/idempotency foundation for business writes. T08 adds minimal Task and durable outbox structures without a worker. T09 supplies deadline/task screens. T10 supplies dispatch. T12 connects existing POA/hearing/deadline records to documents and adds document metadata to search. T15c supplies the reviewed opening-balance command before T21 can use it. Each card states its own boundary; no later feature is silently claimed complete early.

## GitHub publication for every task

The canonical origin is `https://github.com/MohamedAlksas/LawyerOS.git`. Every card specifies its exact dedicated feature branch and requires reading [GIT_WORKFLOW](GIT_WORKFLOW.md). Commit and push coherent updates on that same branch, update its draft PR, and report the verified remote SHA. Do not create a new branch for every save or push feature work directly to main. The initial planning PR and later task prerequisites must normally be reviewed and integrated into origin/main before dependent work; no automatic merge is implied.
'@
$lines.Add($outro)
[System.IO.File]::WriteAllText((Join-Path $projectRoot 'docs/PROMPTS.md'), ($lines -join [Environment]::NewLine) + [Environment]::NewLine, [System.Text.UTF8Encoding]::new($false))
'Generated task-specific prompt index.'
