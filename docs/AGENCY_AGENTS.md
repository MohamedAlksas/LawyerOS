# Agency Agents: task routing and usage contract

## What is installed, and what activation means

The Agency Agents Antigravity integration packages specialist profiles as skills with `agency-` names. Its documented global installation location is `~/.gemini/config/skills/`; project-scoped skills use `.agents/skills/`. This describes instruction loading, not the automatic creation of an independent agent process. [Agency Antigravity integration](https://github.com/msitarzewski/agency-agents/blob/main/integrations/antigravity/README.md).

Antigravity documents skill discovery, activation by reading `SKILL.md`, and these global/workspace locations. The frontmatter `name` identifies the skill; when absent, the folder name is the default. Use the actual installed metadata rather than inferring a slug from a directory. [Antigravity skills documentation](https://antigravity.google/docs/skills).

Local inspection on 10 November 2026 verified installed profiles under `C:/Users/Alksas/.gemini/config/skills/`. For example, `engineering-software-architect/SKILL.md` declares `agency-software-architect`; its activation name is not `engineering-software-architect`. This is a local inventory observation, not proof that a running Antigravity session discovered or applied the profile. Another machine must resolve and verify its own installation.

## One routing source

[AGENCY_AGENT_ROUTING.json](AGENCY_AGENT_ROUTING.json) is the source of truth for the installed profile registry and task assignments: slug, installed folder, inventoried file SHA, and each task's lead, support profiles, scope, and rationale. Read the current task entry and its task card; the generated prompt collection displays that assignment. Do not maintain a competing 23-row table here or load the entire Agency roster for every task.

Agency profiles supplement the seven tracked LawOffice project skills. Every project skill named by the task card remains required. The approved task scope, stack, domain rules, security policy, and established Arabic RTL design govern implementation; generic Agency advice does not authorize new branding, a replacement architecture, extra features, or a larger milestone.

The global Agency installation is not assumed to be copied into this repository. On the verified machine, resolve the registered folder under `C:/Users/Alksas/.gemini/config/skills/`; on another machine, resolve `~/.gemini/config/skills/` for that user. Do not silently download, reinstall, or vendor profiles. Installation is separate work requiring a user request.

## Execute the assigned roles honestly

1. Read `GEMINI.md`, the current task card, its routing entry, and every named project skill. Resolve the lead and each listed support profile to its installed `SKILL.md`, read the complete instructions, verify its metadata name, and calculate the actual file SHA against the inventory.
2. Report a missing, unreadable, or misnamed required profile by exact expected slug and resolved path, and stop dependent implementation for resolution. Inventory hash drift is informational rather than an automatic stop: record the actual hash, read the updated instructions, and raise a substantive scope conflict if one exists. Do not claim activation, substitute a generic persona, or continue with zero Agency profiles. Lead and listed supports are required unless the current assignment explicitly marks a support optional. An optional profile's absence is still reported, never silently omitted.
3. Apply the lead profile to the assigned implementation slice. Use support profiles for their listed checks and return their findings to the lead before submission. If the environment has verified native subagent tooling, report actual invocations and ownership. Loading a skill alone does not launch child processes.
4. If native subagent tooling is unavailable, perform explicit sequential role passes in the same session: lead implementation, each assigned support examination, then lead reconciliation. Label this as sequential role application, not parallel agents or independent review. A pass may conclude that it found no issues, but must state what it actually examined and what remains untested.
5. Preserve the task's branch, prerequisites, file ownership, and stopping rule. Supports do not self-approve work or release the next task. Codex independently reviews the actual published implementation and required evidence under `docs/REVIEW_PROTOCOL.md`.

## Required submission evidence

For each Agency profile, record its lead/support role, actual frontmatter name, resolved path, actual file SHA, whether it matched the inventory, rules applied to this task, and support findings with their resolution. Distinguish direct file reading, UI discovery, and actual native subagent execution; claim only what was observed.

Retain the task's normal `Skills loaded`, base/head/pushed SHA, exact commands and exit statuses, screenshots or artifacts, migrations, and `NOT RUN` limitations. Profile loading, a role-pass narrative, or a support's confident verdict is not evidence that the application, Arabic UI, financial behavior, backup, or recovery passed validation. Never retroactively claim profiles were used in earlier work before they were read.

## Integrating this routing update with active T01

T01 may already be active in `D:/Lawyer`. Preparing this documentation does not authorize switching that checkout, rewriting its changes, or claiming the new routing was previously applied. Wait for this documentation PR to be merged through the project's approval process, then inspect and fetch the current state before integrating the updated `origin/main` into the actual T01 feature branch.

Perform that integration only in a clean, task-owned working tree, or a separately coordinated worktree, preserving all existing work. No reset, force push, automatic stash, or branch switch beneath another agent. Resolve integration conflicts within the documented task ownership and obtain Codex guidance on substantive conflicts. Report the resulting baseline and newly applied profile evidence before continuing T01; do not fabricate predecessor acceptance or start T02 as part of integration.
