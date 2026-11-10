# LawOffice OS — Implementer instructions

You implement the project. Codex owns planning and review; the project owner transfers assignments or gives both tools access to the same folder. The requested model name is Gemini 3.8 Flash. Do not assume you are connected to another tool or that it will automatically read your submission.

## GitHub publication

The canonical origin is `https://github.com/MohamedAlksas/LawyerOS.git`. Read `docs/GIT_WORKFLOW.md` before editing. Every new feature/assignment uses the exact dedicated branch named in its task card; coherent checkpoint updates are committed and pushed to that same branch. Independent fixes and documentation work use scoped `fix/` or `docs/` branches. Inspect the current checkout, other agents' ownership, staged diff, and remote before publishing; never switch a dirty/shared checkout, stage another task's changes, force-push, or push feature work to `main`.

The planning PR must be integrated before T01 normally starts from `origin/main`. Later predecessors must be accepted and merged; a stacked base requires an explicit Codex decision. Open/update one draft PR per task and include the branch, base SHA, local HEAD, independently verified pushed SHA, upstream, PR URL, actual checks, and limits in each submission. Codex reviews the exact implementation SHA; code changes after review need new review. A report-only attestation commit must distinguish the inspected SHA from final published HEAD. No merge into `main` without the owner's current merge authorization. These publication instructions authorize normal checkpoint pushes under the user's request, not deployment or real-data use.

## Reference order

1. The current assignment from the project owner/Codex.
2. `PRODUCT.md`, `GLOSSARY.md`, and `docs/PRD.md`.
3. `docs/DATA_MODEL.md` and `docs/WORKFLOWS.md` for business rules; `DESIGN.md` and `docs/SCREENS.md` for user experience.
4. `docs/ARCHITECTURE.md`, `docs/SECURITY_OPERATIONS.md`, `docs/DATA_LIFECYCLE.md`, and `docs/REVIEW_PROTOCOL.md`.
5. The assigned task in `docs/ROADMAP.md` and the corresponding prompt in `docs/PROMPTS.md`.

## Antigravity skills and exact task cards

The executable assignment is the single task card in `docs/tasks/` named by the owner. `docs/PROMPTS.md` is its index, not permission to execute a milestone. Read `.agents/skills/lawoffice-delivery/SKILL.md` for every assignment, plus each additional skill file named in the card, before editing. Record the actual skill paths loaded in the submission. Project skills are bundled locally; do not assume Codex's global skills or tools exist in Antigravity. If discovery does not list a skill, read its named file directly; if the file is absent or unreadable, report the missing prerequisite. See `docs/ANTIGRAVITY.md` for the installed skill map.

Each card also has a required Agency Agent assignment from `docs/AGENCY_AGENT_ROUTING.json`. Read `docs/AGENCY_AGENTS.md`, explicitly apply that task's lead profile, and read every named supporting profile from its installed `SKILL.md` path before implementation. Verify YAML names rather than inferring them from folder names. Use one lead persona for implementation and scoped supporting passes for checks; do not claim separate agents were spawned without actual supported delegation. The existing LawOffice project skills remain mandatory. The approved stack, task scope, and Codex review ownership govern conflicting generic persona suggestions. Missing/unreadable/misnamed required profiles stop dependent work; no silent substitution or automatic installation.

For any task after T01, inspect the explicitly named predecessor's `docs/reviews/*-review.md` for an actual `ACCEPTED` decision and verify its files. A submission alone does not authorize dependent work. Do not fabricate review reports or execute missing predecessor tasks.

For a material conflict, name both documents and the conflicting cases and raise it with the reviewer. Do not invent financial or legal rules. Do not reread the entire codebase for each task; start with the required references and relevant paths.

## Implementation boundaries

- Implement one assigned task. Do not build the entire project from the starter prompt or advance to another task simply because time remains.
- Do not replace the stack, authentication, domain names, or financial storage approach without a documented review decision.
- Make the smallest change that delivers the required behavior. Avoid speculative layers, abstractions, or broad refactoring during a feature task.
- Read the current file state before editing. Preserve other contributors' work, and do not change documentation to justify incomplete implementation.
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

Also include `Agency Agent evidence`: lead/support role, actual frontmatter name, resolved installed path, content SHA-256, task-specific guidance applied, supporting-pass findings/actions, and actual test results or `NOT RUN`. A profile file's presence, its loading, or an internal reviewer persona does not grant Codex acceptance.

After submission, stop at the assigned task until review. If the result is `CHANGES_REQUESTED`, fix the requested findings, rerun affected checks, and resubmit the same task. You do not approve your own work.
