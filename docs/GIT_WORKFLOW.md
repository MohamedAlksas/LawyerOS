# Git, branches, and pull-request workflow

## Repository and responsibilities

The canonical repository is [MohamedAlksas/LawyerOS](https://github.com/MohamedAlksas/LawyerOS), using `https://github.com/MohamedAlksas/LawyerOS.git` as `origin`. It is intended to remain private. `main` is the stable, reviewed integration branch. Codex plans assignments and independently reviews their actual changes; Antigravity implements the assigned task using the owner's selected Gemini model. Access from Antigravity to the repository, GitHub, or local files must be verified rather than assumed.

Read `GEMINI.md`, the assigned card in `docs/tasks/`, and `docs/REVIEW_PROTOCOL.md` before application implementation. Git publication does not approve a task, deploy the application, or authorize real client data. Permission to push a feature branch is separate from permission to merge it into `main`.

## Initial repository setup and branch names

The initial `main` contains a minimal repository bootstrap. The planning package and this workflow belong on `docs/project-plan-and-git-workflow`, with a pull request back to `main`; their presence in a local folder is not evidence of a merge.

After that planning PR is reviewed and explicitly approved for merging, T01 starts on `feature/t01-toolchain-foundation`. Use one branch per reviewable assignment:

| Work | Branch pattern / example |
|---|---|
| Initial planning package | `docs/project-plan-and-git-workflow` |
| T01 implementation | `feature/t01-toolchain-foundation` |
| Subsequent assigned feature | `feature/t03-identity-sessions` |
| Independent documentation correction | `docs/clarify-backup-runbook` |
| Independent defect correction | `fix/hearing-result-retry` |

Corrections requested on an open task stay on that task's existing branch and PR. Do not create a branch for every save, checkpoint commit, or review comment. A new independent fix or documentation assignment gets its own scoped branch. T15a, T15b, and T15c are separate delivery units and retain their separate reviews and branches.

## Before starting an assignment

1. Inspect the actual repository root, status, current branch, worktrees, and remotes. Fetch without changing local files:

   ```powershell
   git rev-parse --show-toplevel
   git status --short --branch
   git branch --show-current
   git worktree list
   git remote -v
   git fetch origin
   ```

2. Verify `origin` points to the canonical owner/repository. Verify the named predecessor review actually states `ACCEPTED`, identifies the inspected implementation, and corresponds to delivered files. A submission, local commit, pushed branch, or unmerged draft PR is not an accepted integration base.
3. The predecessor must also be merged into `origin/main` before dependent implementation begins. Check the PR's merged state and resulting merge/squash commit against fetched `origin/main`. With a squash merge, the original reviewed feature SHA need not be an ancestor; record the resulting integration commit and verify it contains the reviewed implementation. Never invent acceptance or implement a missing predecessor inside the next task.
4. By default, create the new branch from fetched `origin/main`. Stacked branches require an explicit Codex decision recording the source branch/SHA, dependencies, and review/merge order. Never silently base a new task on another unreviewed feature branch.

Do not switch branches, reset, clean, discard, or automatically stash someone else's dirty work. Inspect who owns the changes and preserve them. For parallel assignments, use separate Git worktrees and separate branches, coordinating shared-schema changes; two agents must not change the checkout branch underneath one another.

When the existing checkout is clean, exclusively owned, and its local `main` can advance without divergent commits, the ordinary sequential path is:

```powershell
git switch main
git pull --ff-only origin main
git switch -c feature/t01-toolchain-foundation origin/main
git branch --show-current
git log -1 --format=fuller
```

This is the T01 example after the planning merge, not a command to run during an unrelated assignment. A non-fast-forward pull stops the sequence; inspect the divergence instead of resetting or force-pushing. Where another checkout is active, create the assigned worktree from `origin/main` without switching that checkout.

## Checkpoints and publication

Make coherent checkpoint commits that explain delivered behavior, such as a compatible toolchain, an atomic hearing-result path, or a reviewed correction. Before each commit, inspect the diff and stage only owned files. Do not bundle unrelated edits or manufacture empty commits just to show activity.

Ignore local `work/` staging, environment secrets, uploads, backups, recovery/encryption keys, dependency directories such as `node_modules/`, and generated build output such as `.next/`. A sanitized `.env.example` may be tracked. The project-local `.agents/skills/` instructions are intentionally tracked; do not ignore the whole `.agents/` tree. Gitignore does not remove an already tracked secret, so inspect staged content before publishing. Review reports and fixtures use synthetic data only.

Verify the current branch and its intended remote before the first push. For the assigned branch, publish once with:

```powershell
git branch --show-current
git remote get-url origin
git push -u origin HEAD
```

Use `git push` for later checkpoints after verifying the upstream still matches the same branch. If a normal push is rejected, fetch and inspect the actual divergence; coordinate integration without rewriting published history. No force push, force-with-lease, direct feature push to `main`, or unscheduled branch replacement is part of this workflow.

## Pull requests and exact-head review

Create a draft PR on the first reviewable push. Use the repository template, target `main`, and keep updating the same PR as checkpoints and fixes are pushed. If GitHub access is unavailable, report that the PR step is unperformed and give the pushed branch; do not fabricate a URL or imply a PR exists.

Keep the PR draft while the assigned checks or required evidence are incomplete. Mark it ready only when the implementation is reviewable with actual results, including clearly identified `NOT RUN` limitations. Ready status is not Codex acceptance or production approval.

The submission in `docs/reviews/` records:

- task ID and base SHA;
- current branch, upstream, and local head SHA;
- pushed remote head SHA, independently checked after publication;
- PR URL and state, or the unperformed step and reason;
- exact commands/exit statuses, evidence, migrations, and limitations required by the review protocol.

Use `git rev-parse HEAD`, `git rev-parse --abbrev-ref --symbolic-full-name '@{upstream}'`, and `git ls-remote --heads origin` with the actual branch to inspect publication. A successful push message alone does not prove a later local head was published. If local and remote heads differ, state both and resolve the mismatch before claiming the branch is synchronized.

Codex reviews the exact pushed implementation head and records its inspected SHA. New code, schema, dependency, configuration, test, or behavior changes invalidate acceptance of the previous head and require review of the new diff and appropriate rerun checks.

A review report may be committed after the implementation was inspected. If that final commit is documentation-only review attestation, record both `inspectedImplementationSHA` and `finalPublishedHeadSHA`, and explain that the intervening diff contains only the attestation. Verify that claim against the diff. A mixed attestation-and-code commit cannot inherit the old acceptance.

## Merge and subsequent tasks

Do not auto-merge when checks pass or Codex accepts a task. Merging into `main` requires the owner's current, explicit merge approval for that PR/head. An earlier instruction to create a branch or push updates is not merge approval. Record the merge result, fetch `origin/main`, and verify the integration commit before releasing a dependent task.

Local hooks may catch accidental direct-main pushes or missing checks, but they are bypassable convenience controls, not GitHub enforcement. This workflow does not itself configure branch protection or a ruleset: do not assume the remote rejects unauthorized direct-main pushes, force pushes, or unchecked merges. A GitHub administrator may later configure PR requirements, required checks, review rules, and history protections after checking account/repository support. Until verified, these remain documented operating rules rather than claimed server-side guarantees; that optional setup does not block preparing the branch and PR.

Enable this repository's local direct-main push guard in each clone with `git config core.hooksPath .githooks`. The initial empty-repository bootstrap occurs before this hook is installed. Normal checkpoint pushes to feature/docs/fix branches remain allowed. The planning CI workflow validates task cards, skill references, and maintained text artifacts; it does not certify the future application or replace its later tests.
