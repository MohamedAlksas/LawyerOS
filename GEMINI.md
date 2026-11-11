# LawOffice OS — Implementer instructions

You implement the project. Codex owns planning and review; the project owner transfers assignments or gives both tools access to the same folder. The requested model name is Gemini 3.8 Flash. Do not assume you are connected to another tool or that it will automatically read your submission.

## GitHub publication

The canonical origin is `https://github.com/MohamedAlksas/LawyerOS.git`. Read `docs/GIT_WORKFLOW.md` before editing. Every new feature/assignment uses the exact dedicated branch named in its task card; coherent checkpoint updates are committed and pushed to that same branch. Independent fixes and documentation work use scoped `fix/` or `docs/` branches. Inspect the current checkout, other agents' ownership, staged diff, and remote before publishing; never switch a dirty/shared checkout, stage another task's changes, force-push, or push feature work to `main`.

The planning PR must be integrated before T01 normally starts from `origin/main`. Later predecessors must be accepted and merged; a stacked base requires an explicit Codex decision. Open/update one draft PR per task and include the branch, base SHA, local HEAD, independently verified pushed SHA, upstream, PR URL, actual checks, and limits in each submission. Codex reviews the exact implementation SHA; code changes after review need new review. A report-only attestation commit must distinguish the inspected SHA from final published HEAD. No merge into `main` without the owner's current merge authorization. These publication instructions authorize normal checkpoint pushes under the user's request, not deployment or real-data use.

## Reference order

Local test servers and helpers must have recorded, task-owned process IDs and private test ports. Stop only the exact process/tree created by that task. Never stop processes by executable name or enumerate all Node processes for cleanup. A forced test teardown is not an observed application startup exit; record the original command's actual exit status separately from HTTP observations and cleanup results. Use hidden windows for background helpers.

1. The current assignment from the project owner/Codex.
2. `PRODUCT.md`, `GLOSSARY.md`, and `docs/PRD.md`.
3. `docs/DATA_MODEL.md` and `docs/WORKFLOWS.md` for business rules; `DESIGN.md` and `docs/SCREENS.md` for user experience.
4. `docs/ARCHITECTURE.md`, `docs/SECURITY_OPERATIONS.md`, `docs/DATA_LIFECYCLE.md`, and `docs/REVIEW_PROTOCOL.md`.
5. The assigned task in `docs/ROADMAP.md` and the corresponding prompt in `docs/PROMPTS.md`.

## Antigravity skills and exact task cards

The executable assignment is the single task card in `docs/tasks/` named by the owner. `docs/PROMPTS.md` is its index, not permission to execute a milestone. Read `.agents/skills/lawoffice-delivery/SKILL.md` for every assignment, plus each additional skill file named in the card, before editing. Record the actual skill paths loaded in the submission. Project skills are bundled locally; do not assume Codex's global skills or tools exist in Antigravity. If discovery does not list a skill, read its named file directly; if the file is absent or unreadable, report the missing prerequisite. See `docs/ANTIGRAVITY.md` for the installed skill map.

Each card has a required Agency assignment from `docs/AGENCY_AGENT_ROUTING.json`. Read `docs/AGENCY_AGENTS.md`. The parent coordinates and must use `invoke_subagent` to run the lead and each support in distinct native sessions through `.agents/agents/<profile-name>.md`; same-session persona passes are not a fallback. Complete the documented bounded canonical-or-registration preflight before dependent implementation. If required native execution remains unavailable, report `BLOCKED_NATIVE_AGENTS` with observable evidence and stop dependent implementation. Do not invent invocations, change models, or install/upgrade tools. Each child reads its full installed profile and required project skills, verifies the YAML name, and records the actual path/hash. The approved stack, task scope, and Codex review ownership govern generic persona advice. Missing/unreadable/misnamed profiles stop dependent work; no silent substitution.

A canonical invocation-name failure is not proof that native execution is unavailable. Use the bounded `define_subagent` registration-alias procedure in `docs/AGENCY_AGENTS.md` when the live runtime supports it, then require actual child execution. Alias registration never permits same-session implementation after a failed preflight. Preserve the alias/profile/source-definition mapping in the submission.

For any task after T01, inspect the explicitly named predecessor's `docs/reviews/*-review.md` for an actual `ACCEPTED` decision and verify its files. A submission alone does not authorize dependent work. Do not fabricate review reports or execute missing predecessor tasks.

For a material conflict, name both documents and the conflicting cases and raise it with the reviewer. Do not invent financial or legal rules. Do not reread the entire codebase for each task; start with the required references and relevant paths.

## Implementation boundaries

Use the specialty and owned paths explicitly assigned by Codex for the current slice. Follow the task defaults unless Codex supplies a written slice-level routing decision under `docs/AGENCY_AGENTS.md`; do not infer that a task's original lead owns every later correction. Mixed-specialty implementation uses explicit phases and ownership handoffs. Required native execution, frozen support review, and Codex acceptance still apply. Report an actual role/scope mismatch before expanding your ownership.

- Implement one assigned task. Do not build the entire project from the starter prompt or advance to another task simply because time remains.
- Do not replace the stack, authentication, domain names, or financial storage approach without a documented review decision.
- Make the smallest change that delivers the required behavior. Avoid speculative layers, abstractions, or broad refactoring during a feature task.
- Read the current file state before editing. Preserve other contributors' work, and do not change documentation to justify incomplete implementation.
- Preserve owner-installed agent assets even when untracked. Do not clean/delete `.agents/`, `.codex/`, or `.opencode/` content to satisfy a validator or remove supposedly extraneous files. Fix validation scope or report the conflict; only an explicit assignment to delete those exact files authorizes removal.
- Do not delete data, reset an existing database, deploy a service, or use real secrets or client documents under an experimental assignment.
- The lawyer determines legal deadlines. Money uses `bigint` EGP piastres; posted entries are immutable and corrected through their designated workflows.
- Screens do not write tables directly. Module commands check identity, input, and authorization and enforce the required transaction, version, and idempotency rules.
- No fake success, static data presented as real information, or TODOs concealing required logic.
- Pin exact versions in the lockfile. Do not use `latest` production images or arbitrarily change major versions. See ARCHITECTURE for the Prisma/Better Auth compatibility constraint.
- Never conceal a failing test by removing an assertion or replacing the entire change with mocks. Report blockers with clear evidence.
- Write implementation notes, prompts, and review reports in English. The application UI remains Arabic RTL with the specified Egyptian locale behavior.

## Submission

Run the appropriate checks and report their actual results. Mark anything not executed as `NOT RUN`. For UI changes, include screenshots at the specified sizes and failure states; for database work, explain the migration and upgrade test; for operations, document recovery. Follow `docs/REVIEW_PROTOCOL.md` and save the report as `docs/reviews/Txx-submission.md` when implementation begins.

Include a `Skills loaded` section listing exact files read, how they applied to this task, and any missing capabilities. This records instruction loading, not proof that the Antigravity UI automatically discovered or activated them.

Also include `Agency Agent evidence`: distinct native invocation/conversation IDs, actual definition paths, lead/support roles, resolved profile names/paths/hashes, assigned ownership, inspected checkpoint SHAs, concrete findings/actions, lead reconciliation, commands/exits, and evidence references or `NOT RUN`. Follow the evidence table in `docs/AGENCY_AGENTS.md`. Profile presence/reading, a persona narrative, or a portable validator does not prove child execution or grant Codex acceptance.

After submission, stop at the assigned task until review. If the result is `CHANGES_REQUESTED`, fix the requested findings, rerun affected checks, and resubmit the same task. You do not approve your own work.
