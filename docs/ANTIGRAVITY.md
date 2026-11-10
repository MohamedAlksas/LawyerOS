# Antigravity setup and skill selection

Open `D:\Lawyer` as the workspace. These project-specific skills are instruction-only packages maintained alongside the plan. They require no Codex plugin, host-specific binary, account connection, or global installation. Application code, deployment, and real-data migration remain separate tasks.

Use `https://github.com/MohamedAlksas/LawyerOS.git` as origin and read `docs/GIT_WORKFLOW.md`. Each task card includes its exact dedicated branch, checkpoint commit/push rules, PR handoff, and remote-SHA verification. The planning baseline must normally be merged into main before T01. Access in a running Antigravity session must still be verified; Codex's GitHub access does not prove that session's credentials are working.

## How loading works

Antigravity documents workspace skills at `.agents/skills/<name>/SKILL.md`, supports selecting a skill by name, and reads the full file when applying it. Sources: [official Agent Skills documentation](https://antigravity.google/docs/skills/). The prompts explicitly name paths so loading can be verified even if automatic discovery is unavailable. A fresh conversation may be needed after adding skills; actual discovery in your installed Antigravity session has not been observed here.

For T01, read exactly:

- [lawoffice-delivery](../.agents/skills/lawoffice-delivery/SKILL.md)
- [lawoffice-foundation](../.agents/skills/lawoffice-foundation/SKILL.md)

The first prompt tells the implementer to report the files it actually loaded. If it cannot read a required file, it must report that path instead of claiming successful skill activation. Reading instructions is not proof that tests passed.

## Bundled skill map

| Skill | Use when | Main decisions it governs |
|---|---|---|
| `lawoffice-delivery` | Every task or correction | Single-task scope, accepted-predecessor evidence, honest submission and stopping |
| `lawoffice-foundation` | T01–T02 | Compatibility proof, pinned versions, minimal scaffold, local runtime |
| `lawoffice-domain` | Parties/matters/scheduling/import/link integration | Correct relations, date-only values, atomic commands, manual legal review |
| `lawoffice-arabic-ui` | Visible forms, shell/PWA, statements, PDF, pilot | Arabic RTL, readable operational UI, real states and rendered verification |
| `lawoffice-finance` | T13, T14, T15a, T15b, T15c | Exact piastres, balanced immutable postings, allocations, refunds and advances |
| `lawoffice-security-operations` | Auth, files, exports, deployment/recovery, cutover | Private access, fail-closed scans, retention, consistent backup and key recovery |
| `lawoffice-testing` | Behavioral implementation and verification | Public Interfaces, real PostgreSQL, relevant browser checks and actual evidence |

Use only the skills named by the current card. Do not load every skill or substitute a generic design workflow for the project's established screens and constraints. Extra installed skills may be used for a demonstrated need, but their availability is not required by this package; identify them and preserve task scope.

## One card per conversation assignment

1. Start with [T01](tasks/T01.md). It requires no prior acceptance.
2. The implementer reads the card, named skills, and required references, then performs only that assignment.
3. Return its exact submission report to Codex. Codex checks implementation and writes the corresponding review decision.
4. Give the next card only after its named predecessor is accepted. A submitted report, plan, or screenshot is not acceptance.
5. If a task is too large for a reviewable change, Codex issues a smaller assignment under the same ID. Antigravity does not invent missing predecessors or expand a task to a milestone.

`docs/PROMPTS.md` indexes all cards. The generated prompt collection contains their complete copyable blocks. The planning ZIP includes the actual `.agents/skills/` folders and all task cards; extract the complete kit, including hidden directories, when transferring machines.

No Antigravity session, model availability, UI discovery, implementation, or live deployment has been verified by creating these files. The concrete deliverable is a local skill-and-prompt package ready for that session.
