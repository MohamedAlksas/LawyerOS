# Agency Agents: native execution contract

## Decision and scope

The owner requested actual delegated agents on 11 November 2026. From the next implementation assignment or correction round after this policy is integrated, each assigned Agency lead and support must run in a distinct native Antigravity session. Same-session persona passes no longer satisfy the contract. Earlier submissions remain historical evidence and must not be rewritten to claim delegation that did not occur. This changes delivery and evidence requirements, not product scope or the stack.

Agency's Antigravity integration supplies profiles as skills. A skill file alone is not a running agent. [Agency integration source](https://github.com/msitarzewski/agency-agents/blob/main/integrations/antigravity/README.md).

Current Antigravity documentation provides `invoke_subagent` and workspace definitions in `.agents/agents/`, with `subagent: true` and inherited model selection. The repository now supplies thin definitions for its 14 selected installed profiles. [Official custom-subagent documentation](https://antigravity.google/docs/subagents). These definitions are prepared configuration, not proof of execution in the owner's installed session.

## Sources of truth

- [AGENCY_AGENT_ROUTING.json](AGENCY_AGENT_ROUTING.json) names the task's lead/support profiles and required execution policy.
- `.agents/agents/<profile-name>.md` is the generated native definition, using the same name as the profile. Regenerate it with `scripts/Update-AgencyAgentPrompts.ps1`; do not hand-edit derived definitions.
- `.agents/skills/<registered-folder>/SKILL.md` is now the project-local profile source. Read it in each delegated session, verify its frontmatter name, and record the loaded SHA-256. The 149 recovered Agency profiles are byte-identical copies from the owner's surviving global installation; only the 14 routed specialties receive native definitions. The global installation remains unchanged. [Recovery inventory](../outputs/Agency-Profile-Recovery.json).
- Every LawOffice project skill listed by the task remains mandatory. Project rules govern generic Agency suggestions.

Retain [the upstream MIT license](third-party/agency-agents-LICENSE.txt) with redistributed profiles. Do not automatically update the recovered files or load the entire roster for a single task. The planning ZIP includes the project-local profiles and native definitions; the consolidated reading document omits the full roster's instruction bodies.

Observed profile hashes are inventory snapshots. Record drift, read the actual file, and escalate a substantive conflict; drift alone is not a missing-profile failure. A missing, unreadable, or misnamed required profile stops dependent work with an exact path/name report.

## Capability preflight

Before dependent implementation, the parent coordinator checks that its actual session exposes `invoke_subagent`, discovers every assigned `.agents/agents/<profile-name>.md`, and supports the definition's declared tool names. The definitions use the documented `view_file`, `grep_search`, `run_command`, and `replace_file_content` names. Antigravity warns that unrecognized tool names can hang a subagent; do not guess an alternative tool schema. [Official tool configuration](https://antigravity.google/docs/subagents#frontmatter-configuration-yaml).

If discovery, invocation, permissions, or model inheritance fails, report **BLOCKED_NATIVE_AGENTS** with the installed version if observable, missing capability/error, affected task/roles, and the last successful step. Stop dependent implementation. Do not simulate children with role headings, invent IDs, install or upgrade tools, change models, or fall back silently. Prepared configuration and portable CI cannot establish that the running session has the capability. Resolve that specific prerequisite with the owner/Codex.

The owner selected the main implementation model; definitions use `model: inherit`. Record the resolved model if the environment exposes it, otherwise mark it unobserved. Do not substitute another model merely to obtain delegation. Actual launch is the decisive discovery check, and any launch failure remains visible.

## Coordinator, implementation, and review ownership

1. The parent inspects Git state and prerequisites, reads the task/required references, and assigns one real lead child and each routed support child. It coordinates the task and publication; it does not satisfy the lead assignment by taking that persona itself.
2. Give every child a complete bounded assignment: task ID, role/profile, required project skills/references, base or reviewed SHA, workspace, owned/examined paths, allowed actions, acceptance criteria, checks, and report destination. Native children may start without the parent's conversation history, so passing a role name alone is insufficient.
3. The lead owns only the assigned implementation slice. One writer owns a file at a time. Children preserve existing changes and do not switch the parent's branch, stage unrelated files, publish, merge, or spawn nested agents. The parent handles coherent commits/pushes on the task's existing feature branch.
4. Before support review, the parent creates a committed checkpoint and freezes application source. Each support examines that exact SHA in its own session; support review does not edit application source. Give build/test runs separate worktrees when generated files, ports, databases, or watchers could conflict. Independent support reviews may run concurrently; dependent implementation and reconciliation stay ordered.
5. Supports return concrete findings and test evidence. The lead reconciles them; the parent records dispositions. If implementation changes, commit a new checkpoint and rerun the affected support checks against it. A report about an older SHA does not verify new code.
6. Normally use one lead plus at most two routed supports, at most three active children. Do not load or launch the entire Agency roster. Each task's routing remains the scope limit. Supports can finish with no findings but must state what they examined and what remains untested.
7. Codex independently reviews the published implementation. Native delegation, a support verdict, a green build, and a successful portable validator never grant task acceptance, a main merge, or the next assignment.

## Required execution evidence

Extend `docs/reviews/Txx-submission.md` with one row per required child:

| Role/profile | Native invocation or conversation ID | Definition path | Loaded profile path/name/hash | Owned/examined paths | Inspected SHA | Result and evidence |
|---|---|---|---|---|---|---|
| Assigned lead or support | Actual tool result or observable UI reference | Actual discovered file | Actual file read, metadata, SHA-256 and drift | Explicit scope | Exact code checkpoint | Findings/actions, commands/exits, artifacts or NOT RUN |

IDs must be distinct and attributable to native tool/UI output. Retain a concise invocation record and the returned result/artifact reference; if no durable log is exposed, state that limit and provide the observable conversation reference. Do not request hidden reasoning or publish full conversations containing secrets. Record lead reconciliation and which checks were rerun after changes.

Missing execution evidence is **NOT RUN**, not a completed Agency requirement. Profile reading and SHA lists remain useful but cannot replace native invocation records. Synthetic data only; no credentials or client records in Git, logs, or reports.

## Integration with active work

Prepare this policy on its own documentation branch/PR from `origin/main`; do not change the active task's checkout or mix in its application fixes. After owner-approved integration into main, safely integrate the policy into the existing task branch at a clean checkpoint before assigning the next correction round. No automatic stash, reset, force-push, or branch switch beneath another agent. Current uncommitted work is preserved, and earlier sequential execution is never retroactively relabeled as native delegation.

Owner-installed agent assets are owned work even before a Git commit. Never clean/delete `.agents/`, `.codex/`, or `.opencode/` content merely because it is untracked or a validator expects fewer files. The project validator checks its seven `lawoffice-*` skills separately from Agency profiles. Resolve a mismatch by checking validator scope and preserving additions. Deletion requires an explicit owner assignment naming the target. Native definitions and recovered profiles are committed so normal untracked-file cleanup cannot remove them, but Git tracking does not prevent every deletion and does not replace this rule.
