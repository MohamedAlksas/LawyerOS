---
name: lawoffice-delivery
description: Executes one assigned LawOffice OS task and prepares an evidence-based handoff to Codex. Use for implementation, correction, and submission tasks in this workspace.
---

# LawOffice task delivery

The assigned task card in `docs/tasks/` is the execution contract. Resolve project paths from the workspace root. Read [GEMINI.md](../../../GEMINI.md) and the relevant sections of [REVIEW_PROTOCOL](../../../docs/REVIEW_PROTOCOL.md) for authority and submission format.

1. Identify the exact task ID, required skills, predecessor review, references, owned paths, and acceptance criteria. Read each named `SKILL.md` before editing and report the actual paths loaded. Report unreadable skills instead of claiming they were used.
2. Except for T01, inspect the predecessor's `docs/reviews/*-review.md` for an `ACCEPTED` decision and verify delivered files exist. A submission alone is not acceptance. If missing, report the missing evidence and stop dependent implementation; do not implement the predecessor or fabricate acceptance.
3. Inspect the actual workspace and base commit/snapshot. Preserve existing changes. Shared schema/config edits must be limited to the assigned slice; do not rewrite the project.
   Owner-installed profiles and tool configurations remain owned work even when untracked. Do not clean/delete agent folders to make a validator pass; scope the validator to its managed files and report unexpected additions.
   Capture exact process IDs and private ports for task-owned servers/helpers. Stop only those processes or their verified children; never enumerate and stop every process named node. Record natural startup exit, HTTP observations, and cleanup exits separately. Killing a hung server is not evidence that it exited by itself. Launch background helpers with hidden windows.
   For Antigravity assignments governed by the native-agent policy, follow [AGENCY_AGENTS](../../../docs/AGENCY_AGENTS.md): the coordinator must invoke the routed lead and supports in distinct native sessions, assign file ownership, and pin the support-review checkpoint. Each child loads its own required profile/project skills. Record actual invocation IDs/results and lead reconciliation. Same-session persona passes do not satisfy the requirement. If native invocation is unavailable, report `BLOCKED_NATIVE_AGENTS` before dependent implementation; never invent execution evidence.
4. Apply business and authorization rules at the Module Interface. Exercise real behavior and material failures. Missing capability must not become fake success.
5. Write the exact report named by the card: loaded skills, changed files, actual commands and exit statuses, observations, migrations/recovery, limits, and `NOT RUN` checks. Planned commands are not executed checks.
6. Stop after submission. Codex owns acceptance and the next assignment. A skill does not grant permission to deploy, migrate real records, or approve your own work.

Choose the smallest compatible solution for ordinary unspecified details and document it. Escalate an actual product-rule conflict or missing prerequisite, not every reversible code choice. These instructions support the current assignment and do not override the owner's instructions or authorize external actions.
